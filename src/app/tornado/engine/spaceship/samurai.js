// @ts-check
import * as THREE from 'three';
import { ALIENS } from '../aliens/config.js';
import { alienRampLength } from '../aliens/models.js';
import { SUPPORT } from './config.js';
import { fullHealth, healthAfter, tableDamage } from '../health/enemyDamage.js';
import { SAMURAI, buildSamuraiKit, buildSamurai, disposeSamuraiKit } from './samuraiModel.js';

/**
 * ===========================================================================
 * SECTION SS.5 — The samurai squad
 * ===========================================================================
 * Landing Support's first option (R in targeting mode): SAMURAI.count
 * samurai off the ship that came down on the marker (spaceship/descent.js).
 *
 *  - **Down the ramp** exactly as the aliens come off theirs: one every
 *    ALIENS.exitEvery seconds, each walking from the hatch to the foot in
 *    rampLength / walkSpeed / 1.6 seconds (aliens/crew.js 'exiting').
 *  - **Guarding** SUPPORT.coverage metres round the drop point: with
 *    nothing to fight they stand guard round it, katana raised, moving to a
 *    new post now and then.
 *  - **Hunting** everything hostile in the coverage: every kind in the
 *    enemy register (engine/enemies.js) that answers to 'blade' -- the
 *    aliens of every wave and the mutants, and the cyber T-Rex. Each picks
 *    the nearest with the fewest of the squad already on it, so a lone
 *    alien draws one or two and the T-Rex draws the rest; round a giant they
 *    take posts all the way round it. A cut every SAMURAI.slashEvery
 *    seconds: an alien goes down to one, the T-Rex loses SAMURAI.trexCut of
 *    its 40 -- ten of them take it down in twenty-odd seconds. The Cyber
 *    Yeti does not answer to a blade (only the Fire Gun and the Black Hole
 *    Gun hurt it), and they leave it alone. Townspeople and Roger they
 *    ignore.
 *  - **Untouchable** by anything but Roger: they are in no list an enemy, a
 *    funnel, the flood or a blast goes through. Roger's weapons find them
 *    (hitSamurai / hitSamuraiArea / aimTargets, called from the rifle, the
 *    minigun, the railgun, the Fire Gun, the Black Hole Gun and the Rocket
 *    Strike), and kill them.
 *  - **Standing down** on its own clock once the last is down the ramp
 *    (beginGuard; the ship has already left, descent.js): when no hostile has
 *    been in the coverage for SUPPORT.clearGrace seconds, or SUPPORT.stay
 *    seconds have passed, or none is left, the squad is cleared (clearSquad)
 *    and the cooldown starts (once the ship has gone too).
 */

/**
 * @typedef {Object} Samurai
 * @property {import('./samuraiModel.js').SamuraiRig} rig
 * @property {'exiting'|'guard'|'hunt'|'caught'|'dying'|'dead'} phase
 * @property {number} timer
 * @property {number} heading
 * @property {number} cycle walk cycle
 * @property {number} slot its place round a big target
 * @property {{e: any, kind: any}|null} target
 * @property {number} retarget seconds to its next look
 * @property {number} slashClock seconds to its next cut
 * @property {number} swing seconds into the cut, or -1
 * @property {boolean} cutDone this cut has landed
 * @property {number} health what is left of SAMURAI health (health/damageTable.js)
 * @property {number} gx its guard post
 * @property {number} gz
 * @property {number} postTimer seconds to a new post
 * @property {number} pitch its voice
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see spaceship.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createSamuraiSquad(ctx, S, api) {
  const { Sim } = ctx;
  /** @type {import('./samuraiModel.js').SamuraiKit|null} */
  let kit = null;
  /** @type {Samurai[]} */
  let units = [];
  /** @type {Map<any, number>} how many of the squad are on each target */
  const claims = new Map();
  const scratch = new THREE.Vector3();
  let hostileSeen = false;
  /** Allocation-free probe for hostilesInCoverage (one closure per squad). */
  const markHostile = (/** @type {any} */ e, /** @type {any} */ kind) => {
    if (hostilePosition(e, kind)) hostileSeen = true;
  };

  /** @returns {void} */
  function initSquad() {
    // The black hole (engine/effects/consumables.js): Roger's own weapon,
    // so it takes them like anything else.
    ctx.systems.consumables.register({
      kind: 'samurai',
      list: () => units.filter(onGround),
      position: (u) => u.rig.root.position,
      object: (u) => u.rig.root,
      size: () => 1.8,
      take: (u) => { u.phase = 'caught'; },
      consume: (u) => removeUnit(u)
    });
  }

  /**
   * @param {Samurai} u
   * @returns {boolean} on its feet in the town (exiting, guarding, hunting)
   */
  function onGround(u) {
    return u.phase === 'exiting' || u.phase === 'guard' || u.phase === 'hunt';
  }

  /**
   * The next one down the ramp.
   * @param {number} index
   * @returns {void}
   */
  function spawnUnit(index) {
    if (!kit) kit = buildSamuraiKit();
    const rig = buildSamurai(kit, index);
    rig.root.position.copy(S.rampTop);
    Sim.three.scene.add(rig.root);
    units.push({
      rig, phase: 'exiting', timer: 0, heading: Math.atan2(S.dir.x, S.dir.z), cycle: Math.random() * 6,
      slot: index, target: null, retarget: Math.random() * SAMURAI.retarget, slashClock: 0, swing: -1, cutDone: false,
      health: fullHealth('samurai'), gx: S.drop.x, gz: S.drop.z, postTimer: 0, pitch: 0.85 + Math.random() * 0.3
    });
  }

  /** @returns {number} seconds for one of them to walk the ramp: the aliens' figure */
  function rampSeconds() {
    return alienRampLength() / ALIENS.walkSpeed / 1.6;
  }

  // ---------------------------------------------------------------------
  // Moving
  // ---------------------------------------------------------------------

  /**
   * @param {number} x
   * @param {number} z
   * @returns {boolean} whether a standing building covers this point
   */
  function blocked(x, z) {
    for (const building of ctx.Environment.buildings) {
      if (building.damageState === 'collapsed') continue;
      const fp = building.mesh.userData.footprint;
      if (!fp) continue;
      const b = building.mesh.position;
      if (Math.abs(x - b.x) < fp.width / 2 + 0.4 && Math.abs(z - b.z) < fp.depth / 2 + 0.4) return true;
    }
    return false;
  }

  /**
   * Towards (tx, tz) at `speed`, turning as it goes and sliding along a
   * wall it walks into.
   * @param {Samurai} u
   * @param {number} tx
   * @param {number} tz
   * @param {number} speed
   * @param {number} dt
   * @returns {number} metres it covered
   */
  function moveTo(u, tx, tz, speed, dt) {
    const p = u.rig.root.position;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return 0;
    turnTo(u, Math.atan2(dx, dz), dt);
    const step = Math.min(d, speed * dt);
    const sx = (dx / d) * step;
    const sz = (dz / d) * step;
    if (!blocked(p.x + sx, p.z + sz)) {
      p.x += sx;
      p.z += sz;
    } else if (!blocked(p.x + sx, p.z)) {
      p.x += sx;
    } else if (!blocked(p.x, p.z + sz)) {
      p.z += sz;
    } else {
      // Boxed in (stood inside a footprint when it came down): straight out.
      p.x += sx;
      p.z += sz;
    }
    return step;
  }

  /**
   * @param {Samurai} u
   * @param {number} want
   * @param {number} dt
   * @returns {void}
   */
  function turnTo(u, want, dt) {
    let diff = want - u.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    u.heading += THREE.MathUtils.clamp(diff, -SAMURAI.turnRate * dt, SAMURAI.turnRate * dt);
    u.rig.root.rotation.y = u.heading;
  }

  /**
   * A new guard post round the drop point, clear of buildings.
   * @param {Samurai} u
   * @returns {void}
   */
  function pickPost(u) {
    const [lo, hi] = SAMURAI.guardRadius;
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = lo + Math.random() * (hi - lo);
      const x = S.drop.x + Math.cos(a) * r;
      const z = S.drop.z + Math.sin(a) * r;
      if (blocked(x, z)) continue;
      u.gx = x;
      u.gz = z;
      break;
    }
    u.postTimer = 6 + Math.random() * 6;
  }

  // ---------------------------------------------------------------------
  // The pose
  // ---------------------------------------------------------------------

  /**
   * The limbs for this frame: the run (blade trailing low), the guard
   * (two hands on it, raised before him), and the cut (up overhead, down
   * in front, back to guard) over everything else.
   * @param {Samurai} u
   * @param {number} speed metres a second it is moving at
   * @param {number} dt
   * @returns {void}
   */
  function pose(u, speed, dt) {
    const r = u.rig;
    u.cycle += dt * (2 + speed * 1.15);
    const s = Math.sin(u.cycle);
    const amp = Math.min(0.95, speed * 0.12);
    r.legL.rotation.x = s * amp;
    r.legR.rotation.x = -s * amp;
    const running = speed > 3;
    r.pelvis.rotation.x = running ? 0.22 : 0.04;
    r.pelvis.position.y = running ? Math.abs(Math.cos(u.cycle)) * 0.06 : 0.01 * Math.sin(u.cycle * 0.5);
    if (u.swing >= 0) {
      const { windup, swing, recover } = SAMURAI;
      let a;
      if (u.swing < windup) a = THREE.MathUtils.lerp(-0.9, -3.25, THREE.MathUtils.smoothstep(u.swing, 0, windup));
      else if (u.swing < windup + swing) a = THREE.MathUtils.lerp(-3.25, -0.25, (u.swing - windup) / swing);
      else a = THREE.MathUtils.lerp(-0.25, -0.9, Math.min(1, (u.swing - windup - swing) / recover));
      r.armR.rotation.set(a, 0, 0.3);
      r.armL.rotation.set(a, 0, -0.3);
      const cut = (u.swing - windup) / swing;
      const glow = cut > 0 && cut < 1.8 ? Math.sin(Math.min(1, cut / 1.8) * Math.PI) : 0;
      r.trail.visible = glow > 0.01;
      r.trailMat.opacity = 0.75 * glow;
      return;
    }
    r.trail.visible = false;
    if (running) {
      r.armR.rotation.set(0.55, 0, 0.22);
      r.armL.rotation.set(-s * amp * 0.8, 0, -0.08);
    } else {
      // The guard: both hands on the grip before him, the blade up.
      r.armR.rotation.set(-0.95 + 0.04 * Math.sin(u.cycle * 0.5), 0, 0.32);
      r.armL.rotation.set(-0.95 + 0.04 * Math.sin(u.cycle * 0.5), 0, -0.32);
    }
  }

  // ---------------------------------------------------------------------
  // Targets
  // ---------------------------------------------------------------------

  /**
   * @param {any} kind
   * @param {any} e
   * @returns {number} its radius, metres
   */
  function radiusOf(kind, e) {
    return kind.hitbox ? kind.hitbox(e).radius : 0.4;
  }

  /**
   * Whether this target is still there and still in the coverage.
   * @param {{e: any, kind: any}} t
   * @returns {boolean}
   */
  function stillThere(t) {
    if (!t.kind.list().includes(t.e)) return false;
    const q = t.kind.position(t.e);
    return Math.hypot(q.x - S.drop.x, q.z - S.drop.z) < SUPPORT.coverage + SAMURAI.keepMargin;
  }

  /**
   * The one test of what the squad counts as hostile: answers to 'blade',
   * not absorbed, inside the coverage ring.
   * @param {any} e
   * @param {any} kind
   * @returns {{x: number, z: number}|null} its position, or null if it does not count
   */
  function hostilePosition(e, kind) {
    if (!kind.accepts.includes('blade')) return null;
    if (ctx.systems.enemies.getState(e, 'absorbed')) return null;
    const q = kind.position(e);
    return Math.hypot(q.x - S.drop.x, q.z - S.drop.z) > SUPPORT.coverage ? null : q;
  }

  /** @returns {boolean} whether any hostile is inside the coverage ring now */
  function hostilesInCoverage() {
    hostileSeen = false;
    ctx.systems.enemies.each(markHostile);
    return hostileSeen;
  }

  /**
   * The best target for this one: the nearest hostile in the coverage, with
   * those the squad is already on counting as farther.
   * @param {Samurai} u
   * @returns {{e: any, kind: any}|null}
   */
  function pickTarget(u) {
    const p = u.rig.root.position;
    /** @type {{e: any, kind: any}|null} */
    let best = null;
    let bestScore = Infinity;
    ctx.systems.enemies.each((e, kind) => {
      const q = hostilePosition(e, kind);
      if (!q) return;
      // A giant takes the whole squad; anything else, one or two.
      const big = radiusOf(kind, e) > 2;
      const score = Math.hypot(q.x - p.x, q.z - p.z) + (big ? 0 : 14 * (claims.get(e) || 0));
      if (score < bestScore) {
        bestScore = score;
        best = { e, kind };
      }
    });
    return best;
  }

  /**
   * @param {Samurai} u
   * @param {{e: any, kind: any}|null} t
   * @returns {void}
   */
  function setTarget(u, t) {
    if (u.target) claims.set(u.target.e, Math.max(0, (claims.get(u.target.e) || 1) - 1));
    const fresh = t && (!u.target || u.target.e !== t.e);
    u.target = t;
    if (t) claims.set(t.e, (claims.get(t.e) || 0) + 1);
    if (fresh && u.phase === 'guard') {
      u.phase = 'hunt';
      if (Math.random() < SAMURAI.shoutChance) shout(u);
    }
    if (!t && u.phase === 'hunt') {
      u.phase = 'guard';
      pickPost(u);
    }
  }

  /**
   * @param {Samurai} u
   * @returns {void}
   */
  function shout(u) {
    ctx.systems.creatureSounds.play('samuraiShout', u.rig.root.position, { pitch: u.pitch });
  }

  // ---------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------

  /**
   * One samurai's frame.
   * @param {Samurai} u
   * @param {number} dt
   * @returns {void}
   */
  function updateUnit(u, dt) {
    const p = u.rig.root.position;
    if (u.phase === 'exiting') {
      // Down the ramp from the hatch, at a walk.
      u.timer += dt;
      const t = Math.min(1, u.timer / rampSeconds());
      p.lerpVectors(S.rampTop, S.rampFoot, t);
      p.y += 0.2;
      u.heading = Math.atan2(S.dir.x, S.dir.z);
      u.rig.root.rotation.y = u.heading;
      pose(u, ALIENS.walkSpeed, dt);
      if (t < 1) return;
      u.phase = 'guard';
      p.y = 0;
      pickPost(u);
      if (Math.random() < SAMURAI.shoutChance) shout(u);
      return;
    }
    if (u.phase === 'dying') {
      u.timer += dt;
      const fall = Math.min(1, u.timer / SAMURAI.deathSeconds);
      u.rig.root.rotation.x = -fall * fall * (Math.PI / 2 - 0.08);
      const sink = u.timer - SAMURAI.deathSeconds - SAMURAI.lieSeconds;
      if (sink > 0) p.y = -0.6 * Math.min(1, sink / SAMURAI.sinkSeconds);
      if (sink >= SAMURAI.sinkSeconds) removeUnit(u);
      return;
    }
    if (u.phase !== 'guard' && u.phase !== 'hunt') return;

    u.slashClock -= dt;
    u.retarget -= dt;
    if (u.target && !stillThere(u.target)) setTarget(u, null);
    if (u.retarget <= 0) {
      u.retarget = SAMURAI.retarget;
      const t = pickTarget(u);
      if (t && (!u.target || t.e !== u.target.e)) {
        // Only swap off a target it is not already cutting at.
        if (!u.target || u.swing < 0) setTarget(u, t);
      }
    }

    let speed = 0;
    if (u.phase === 'hunt' && u.target) {
      const { e, kind } = u.target;
      const q = kind.position(e);
      const radius = radiusOf(kind, e);
      const reach = radius + SAMURAI.reach;
      // Round a giant, its own post (its slot); anything smaller, straight in.
      let ax;
      let az;
      if (radius > 2) {
        const a = (u.slot / SAMURAI.count) * Math.PI * 2;
        ax = q.x + Math.cos(a) * (radius + SAMURAI.reach * 0.6);
        az = q.z + Math.sin(a) * (radius + SAMURAI.reach * 0.6);
      } else {
        const dx = p.x - q.x;
        const dz = p.z - q.z;
        const d = Math.hypot(dx, dz) || 1;
        ax = q.x + (dx / d) * (radius + SAMURAI.reach * 0.7);
        az = q.z + (dz / d) * (radius + SAMURAI.reach * 0.7);
      }
      const gap = Math.hypot(q.x - p.x, q.z - p.z) - radius;
      const pace = u.swing >= 0 ? SAMURAI.runSpeed * 0.5 : SAMURAI.runSpeed;
      speed = moveTo(u, ax, az, pace, dt) / Math.max(dt, 1e-4);
      if (gap < SAMURAI.reach + 0.6) {
        turnTo(u, Math.atan2(q.x - p.x, q.z - p.z), dt);
        if (u.swing < 0 && u.slashClock <= 0) {
          u.swing = 0;
          u.cutDone = false;
          ctx.systems.creatureSounds.play('katanaSwish', p, { pitch: u.pitch });
        }
      }
    } else {
      u.postTimer -= dt;
      if (u.postTimer <= 0) pickPost(u);
      speed = moveTo(u, u.gx, u.gz, SAMURAI.guardSpeed, dt) / Math.max(dt, 1e-4);
      if (speed < 0.1) turnTo(u, Math.atan2(u.gx - S.drop.x, u.gz - S.drop.z), dt);
    }

    if (u.swing >= 0) {
      u.swing += dt;
      if (!u.cutDone && u.swing >= SAMURAI.windup + SAMURAI.swing) {
        u.cutDone = true;
        cut(u);
      }
      if (u.swing >= SAMURAI.windup + SAMURAI.swing + SAMURAI.recover) {
        u.swing = -1;
        u.slashClock = SAMURAI.slashEvery[0] + Math.random() * (SAMURAI.slashEvery[1] - SAMURAI.slashEvery[0])
          - (SAMURAI.windup + SAMURAI.swing + SAMURAI.recover);
      }
    }
    pose(u, speed, dt);
  }

  /**
   * The cut landing on whatever it was aimed at, if it is still in reach.
   * @param {Samurai} u
   * @returns {void}
   */
  function cut(u) {
    if (!u.target || !stillThere(u.target)) return;
    const { e, kind } = u.target;
    const q = kind.position(e);
    const p = u.rig.root.position;
    if (Math.hypot(q.x - p.x, q.z - p.z) - radiusOf(kind, e) > SAMURAI.reach + 0.8) return;
    scratch.set((p.x + q.x) / 2, 1.2, (p.z + q.z) / 2);
    ctx.systems.creatureSounds.play('katanaHit', scratch, { pitch: u.pitch });
    ctx.systems.explosions.spawnImpactBurst(scratch, 0.18);
    const down = ctx.systems.enemies.hit(e, kind, { type: 'blade', amount: SAMURAI.trexCut, at: { x: scratch.x, y: scratch.y, z: scratch.z } });
    if (down) {
      setTarget(u, null);
      if (Math.random() < 0.4) shout(u);
    }
  }

  /**
   * @param {number} dt the world's
   * @returns {void}
   */
  function updateSquad(dt) {
    if (dt <= 0) return;
    if (units.length) {
      for (const u of units) updateUnit(u, dt);
      units = units.filter(u => u.phase !== 'dead');
    }
    if (S.state.guarding) updateGuard(dt);
  }

  /**
   * The last one is down the ramp: the squad's own clock starts.
   * @returns {void}
   */
  function beginGuard() {
    S.state.guarding = true;
    S.state.stay = SUPPORT.stay;
    S.state.clearFor = 0;
  }

  /**
   * The stay and the all-clear. Ends the squad when none is left standing
   * (once the fallen have sunk), when the stay runs out, or when no hostile
   * has been in the ring for SUPPORT.clearGrace seconds.
   * @param {number} dt the world's
   * @returns {void}
   */
  function updateGuard(dt) {
    S.state.stay -= dt;
    if (standing() === 0) {
      if (!units.length) endSquad();
      return;
    }
    S.state.clearFor = hostilesInCoverage() ? 0 : S.state.clearFor + dt;
    if (S.state.stay <= 0 || S.state.clearFor >= SUPPORT.clearGrace) {
      S.state.stay = 0;
      endSquad();
      api.showBanner('SAMURAI SUPPORT', 'The squad stands down');
    }
  }

  /**
   * The squad done: cleared, and the cooldown started if the ship has gone.
   * @returns {void}
   */
  function endSquad() {
    clearSquad();
    api.finishSupport();
  }

  // ---------------------------------------------------------------------
  // The squad, for the ship and for Roger
  // ---------------------------------------------------------------------

  /** @returns {number} how many are still with the squad (not killed) */
  function standing() {
    let n = 0;
    for (const u of units) if (u.phase !== 'dying' && u.phase !== 'dead' && u.phase !== 'caught') n++;
    return n;
  }

  /**
   * What Roger's sights can hit: each one on the ground, as a standing
   * cylinder (hero/plasma.js traceAim).
   * @returns {{x: number, z: number, radius: number, top: number, unit: Samurai}[]}
   */
  function aimTargets() {
    const out = [];
    for (const u of units) {
      if (!onGround(u)) continue;
      const p = u.rig.root.position;
      out.push({ x: p.x, z: p.z, radius: 0.4, top: p.y + SAMURAI.height * 1.05, unit: u });
    }
    return out;
  }

  /**
   * One of Roger's weapons on one of them, by the weapon x enemy table
   * (health/damageTable.js, D1): the minigun round takes a third of its 3
   * health (SAMURAI.bulletHits rounds), a rifle shot, a bolt or a rocket
   * blast all of it, and fire a small chip per tick. Only Roger's weapons
   * call this: enemies and disasters never do, so they cannot kill one.
   * @param {Samurai} u
   * @param {string} type 'plasma' | 'bullet' | 'bolt' | 'fire' | 'blast'
   * @returns {boolean} whether it went down
   */
  function hitSamurai(u, type) {
    if (!u || !onGround(u)) return false;
    u.health = healthAfter(u.health, tableDamage('samurai', { type }));
    if (u.health > 0) {
      // A minigun round keeps its small spark; fire and the rest add no particles.
      if (type === 'bullet') ctx.systems.explosions.spawnImpactBurst(scratch.copy(u.rig.root.position).setY(1.2), 0.15);
      return false;
    }
    kill(u, type);
    return true;
  }

  /**
   * Every one of them within `radius` of (x, z), by one of Roger's weapons.
   * @param {number} x
   * @param {number} z
   * @param {number} radius
   * @param {string} type
   * @returns {number} how many went down
   */
  function hitSamuraiArea(x, z, radius, type) {
    let n = 0;
    for (const u of units) {
      if (!onGround(u)) continue;
      const p = u.rig.root.position;
      if (Math.hypot(p.x - x, p.z - z) < radius && hitSamurai(u, type)) n++;
    }
    return n;
  }

  /**
   * @param {Samurai} u
   * @param {string} type
   * @returns {void}
   */
  function kill(u, type) {
    setTarget(u, null);
    u.phase = 'dying';
    u.timer = 0;
    u.swing = -1;
    u.rig.trail.visible = false;
    u.rig.root.position.y = 0;
    const p = u.rig.root.position;
    ctx.systems.creatureSounds.play('samuraiDeath', p, { pitch: u.pitch });
    if (type === 'fire' || type === 'blast' || type === 'plasma') {
      ctx.systems.explosions.spawnImpactBurst(scratch.copy(p).setY(1), 0.7);
    }
    ctx.events.emit('notice', { text: `⚔️ SAMURAI DOWN · ${standing()} left` });
  }

  /**
   * @param {Samurai} u
   * @returns {void}
   */
  function removeUnit(u) {
    if (u.phase === 'dead') return; // already freed (a black-hole take, then a clear)
    if (u.target) setTarget(u, null);
    u.phase = 'dead';
    Sim.three.scene.remove(u.rig.root);
    u.rig.trailMat.dispose();
  }

  /** @returns {void} every one of them gone (the ship left, or a Reset) */
  function clearSquad() {
    for (const u of units) removeUnit(u);
    units = [];
    claims.clear();
    S.state.squad = false;
    S.state.guarding = false;
  }

  /** @returns {THREE.Vector3[]} where they are, for the minimap */
  function squadPositions() {
    return units.filter(onGround).map(u => u.rig.root.position);
  }

  /**
   * The co-op guest's samurai (net/system.js): a kit of their own (geometry
   * and materials) and a function making one figure in an armour colour.
   * Nothing is added to the scene and no state is touched; `release` frees
   * the kit (and the sword arms the model keeps for every colour).
   * @returns {{build: (variant: number) => import('./samuraiModel.js').SamuraiRig, release: () => void, consts: Object}}
   */
  function buildGuestModel() {
    const own = buildSamuraiKit();
    return {
      build: (variant) => buildSamurai(own, variant),
      release: () => disposeSamuraiKit(own),
      consts: { windup: SAMURAI.windup, swing: SAMURAI.swing, recover: SAMURAI.recover, runSpeed: SAMURAI.runSpeed, deathSeconds: SAMURAI.deathSeconds }
    };
  }

  /**
   * What the guest needs to draw each samurai (`figures` rows, net/figurePose.js):
   * those on the ramp, standing, cutting or falling. Read-only.
   * @returns {{key: object, x: number, y: number, z: number, heading: number, phase: string, swing: number, timer: number, variant: number}[]}
   */
  function replicaState() {
    const out = [];
    for (const u of units) {
      if (u.phase === 'caught' || u.phase === 'dead') continue;
      const p = u.rig.root.position;
      out.push({ key: u, x: p.x, y: p.y, z: p.z, heading: u.heading, phase: u.phase, swing: u.swing, timer: u.timer, variant: u.slot });
    }
    return out;
  }

  /** @returns {void} */
  function disposeSquad() {
    clearSquad();
    if (kit) disposeSamuraiKit(kit);
    kit = null;
  }

  return {
    initSquad, spawnUnit, rampSeconds, updateSquad, standing, beginGuard, hostilesInCoverage,
    aimTargets, hitSamurai, hitSamuraiArea, clearSquad, squadPositions, disposeSquad, buildGuestModel, replicaState
  };
}
