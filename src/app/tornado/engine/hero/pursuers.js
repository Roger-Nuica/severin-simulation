// @ts-check
import * as THREE from 'three';
import { HERO } from './config.js';
import { createTouchState } from '../health/melee.js';
import { stepTelegraph, cancelTelegraph, applyTelegraph } from '../terminator/telegraph.js';

/**
 * ===========================================================================
 * SECTION HM.6 — The machines after Roger
 * ===========================================================================
 * Spawning them, their hunt, being shot, knocked down, EMP'd or killed by the
 * mega beam, and catching him.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see heroMode.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createHeroPursuers(ctx, S, api) {
  const { Sim, container } = ctx;

  // ---------------------------------------------------------------------
  // Starting and ending
  // ---------------------------------------------------------------------

  /**
   * A machine ~pursuerDistance behind Roger (the way he is not facing),
   * turned `bearing` off that line: when sent, and again when one has been
   * killed and reboots.
   * @param {number} bearing radians off the line behind him
   * @param {number} kills times this machine has already been brought down
   * @returns {Object} the machine
   */
  function spawnPursuer(bearing, kills) {
    const r = S.roger.mesh.position;
    const away = S.state.heading + Math.PI + bearing;
    let px = r.x;
    let pz = r.z;
    for (let k = 0; k < 12; k++) {
      const a = away + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.35;
      px = THREE.MathUtils.clamp(r.x + Math.sin(a) * HERO.pursuerDistance, -HERO.bound, HERO.bound);
      pz = THREE.MathUtils.clamp(r.z + Math.cos(a) * HERO.pursuerDistance, -HERO.bound, HERO.bound);
      if (!api.blockedAt(px, pz, 1.5)) break;
    }
    const unit = api.buildPursuer(px, pz);
    unit.eyeBase = unit.eyeMat.color.clone();
    api.pushOut(unit.root.position, 1.5);
    unit.p = {
      bearing, kills,
      heading: Math.atan2(r.x - px, r.z - pz),
      cycle: 0,
      stagger: 0,
      touch: createTouchState(),
      touchClock: 0,
      heavy: false,
      /** @type {'hunting'|'seizing'|'falling'|'down'|'gone'} */
      state: 'hunting',
      timer: 0,
      knockX: 0,
      knockZ: 0,
      // What brought it down, for the banner: 'mega' or '' (the EMP).
      cause: ''
    };
    return unit;
  }

  /**
   * HERO.pursuers machines, fanned out behind him.
   * @returns {void}
   */
  function spawnPursuers() {
    S.pursuers = Array.from({ length: HERO.pursuers }, (_, i) =>
      spawnPursuer((i - (HERO.pursuers - 1) / 2) * HERO.pursuerSpread, 0));
  }

  /**
   * @param {Object} unit
   * @returns {void}
   */
  function removePursuer(unit) {
    Sim.three.scene.remove(unit.root);
    for (const g of unit.geometries) g.dispose();
    for (const m of unit.materials) m.dispose();
  }

  /** @returns {void} */
  function removePursuers() {
    for (const unit of S.pursuers) removePursuer(unit);
    S.pursuers = [];
  }

  /**
   * @returns {Object[]} the machines on their feet and after him
   */
  function huntingPursuers() {
    return S.pursuers.filter(unit => unit.p.state === 'hunting');
  }

  /**
   * A minigun round on one of his pursuers (heroWeapons.js): sparks off it,
   * and on the `killAt`th round it goes down, as a mega beam brings it down.
   * @param {Object} unit
   * @param {number} killAt
   * @returns {number} rounds it has taken; 0 when it was not on its feet
   */
  function pursuerBulletHit(unit, killAt) {
    if (!unit.p || unit.p.state !== 'hunting') return 0;
    unit.p.bulletHits = (unit.p.bulletHits || 0) + 1;
    if (unit.p.bulletHits >= killAt) {
      unit.p.cause = 'minigun';
      startPursuerDeath(unit);
    }
    return unit.p.bulletHits;
  }

  /**
   * A mega beam on the machine: it goes down, the way the EMP brings it
   * down.
   * @param {Object} unit
   * @returns {void}
   */
  function megaKillPursuer(unit) {
    if (unit.p.state !== 'hunting') return;
    unit.p.cause = 'mega';
    startPursuerDeath(unit);
  }

  /**
   * The beam has hit the machine: thrown flat on its back and a few seconds
   * getting up. Not killed -- only an EMP does that.
   * @param {Object} unit
   * @returns {void}
   */
  function knockdownPursuer(unit) {
    if (unit.p.state !== 'hunting') return;
    const m = unit.p;
    const p = unit.root.position;
    const r = S.roger.mesh.position;
    const d = Math.hypot(p.x - r.x, p.z - r.z) || 1;
    m.stagger = HERO.knockdownSeconds;
    m.heavy = true;
    m.knockX = (p.x - r.x) / d;
    m.knockZ = (p.z - r.z) / d;
    // Knocked flat facing the shot.
    m.heading = Math.atan2(-m.knockX, -m.knockZ);
    unit.root.rotation.y = m.heading;
    ctx.systems.explosions.spawnImpactBurst(S.scratch.set(p.x, 5, p.z), 1.4);
    api.flashMessage('TERMINATOR DOWN — it will get up');
  }

  // ---------------------------------------------------------------------
  // The pursuer
  // ---------------------------------------------------------------------

  /**
   * @param {THREE.Vector3} p
   * @param {number} heading
   * @returns {boolean}
   */
  function clearAhead(p, heading) {
    for (const d of [3, 6]) {
      if (api.blockedAt(p.x + Math.sin(heading) * d, p.z + Math.cos(heading) * d, 1.4)) return false;
    }
    return true;
  }

  /**
   * Straight at Roger, round whatever is in the way, and never stopping.
   * Real time: the bullet time of aiming does not slow it.
   * @param {Object} unit
   * @param {number} dt real seconds
   * @returns {number} distance to Roger; Infinity when it is not hunting him
   */
  function updatePursuer(unit, dt) {
    const m = unit.p;
    if (m.state !== 'hunting') {
      updatePursuerDeath(unit, dt);
      return Infinity;
    }
    // Frozen (engine/effects/freeze.js): it stands in its block of ice.
    if (ctx.systems.enemies.getState(unit, 'frozen')) return Infinity;
    const p = unit.root.position;
    // Co-op: the nearest player who is up (engine/net/system.js); Roger alone otherwise.
    const r = (ctx.systems.net && ctx.systems.net.pickTarget(p.x, p.z)) || S.roger.mesh.position;
    const dist = Math.hypot(r.x - p.x, r.z - p.z);
    const j = unit.joints;
    let speed = HERO.pursuerSpeed;

    // An EMP-charged funnel is the one thing that stops it.
    if (ctx.systems.empCharge && ctx.systems.empCharge.lethalAt(p.x, p.z)) {
      startPursuerDeath(unit);
      return Infinity;
    }

    if (m.stagger > 0 && m.heavy) {
      // Flat on its back from the plasma beam: flung, down, then up again.
      m.stagger -= dt;
      const since = HERO.knockdownSeconds - m.stagger;
      const fling = Math.max(0, 1 - since / 0.45);
      p.x += m.knockX * HERO.knockdownFling * fling * dt;
      p.z += m.knockZ * HERO.knockdownFling * fling * dt;
      const down = Math.min(Math.min(1, since / 0.3), Math.min(1, m.stagger / 0.6));
      unit.root.rotation.x = -down * (Math.PI / 2 - 0.08);
      unit.eyeMat.color.copy(unit.eyeBase).multiplyScalar(Math.random() < 0.3 ? 0.1 : 1);
      if (Math.random() < dt * 8) {
        S.scratch.set(p.x + (Math.random() - 0.5) * 3, 0.8 + Math.random() * 2, p.z + (Math.random() - 0.5) * 3);
        ctx.systems.explosions.spawnImpactBurst(S.scratch, 0.35);
      }
      api.pushOut(p, 1.2);
      if (m.stagger <= 0) {
        m.heavy = false;
        unit.eyeMat.color.copy(unit.eyeBase);
      }
      return dist;
    }
    if (m.stagger > 0) {
      // Knocked back, sparking, then on again.
      m.stagger -= dt;
      const k = Math.max(0, m.stagger / HERO.staggerSeconds);
      p.x += m.knockX * HERO.staggerSpeed * k * dt;
      p.z += m.knockZ * HERO.staggerSpeed * k * dt;
      unit.root.rotation.x = -0.35 * k;
      j.head.rotation.y = (Math.random() - 0.5) * 0.6 * k;
      if (Math.random() < dt * 6) {
        S.scratch.set(p.x + (Math.random() - 0.5) * 2, 3 + Math.random() * 3, p.z + (Math.random() - 0.5) * 2);
        ctx.systems.explosions.spawnImpactBurst(S.scratch, 0.3);
      }
      api.pushOut(p, 1.2);
      return dist;
    }
    unit.root.rotation.x = 0;
    j.head.rotation.y = 0;

    let want = Math.atan2(r.x - p.x, r.z - p.z);
    if (!clearAhead(p, want)) {
      for (let k = 1; k <= 7; k++) {
        const h1 = want + k * 0.42;
        const h2 = want - k * 0.42;
        if (clearAhead(p, h1)) { want = h1; break; }
        if (clearAhead(p, h2)) { want = h2; break; }
      }
    }
    let turn = Math.atan2(Math.sin(want - m.heading), Math.cos(want - m.heading));
    turn = THREE.MathUtils.clamp(turn, -4 * dt, 4 * dt);
    m.heading += turn;
    if (dist < 1.5) speed = 0;
    p.x += Math.sin(m.heading) * speed * dt;
    p.z += Math.cos(m.heading) * speed * dt;
    api.pushOut(p, 1.2);
    unit.root.rotation.y = m.heading;

    // The same heavy stride as the squad's, sped up to its pace.
    m.cycle += speed * dt * 0.9;
    const s = Math.sin(m.cycle);
    j.hipL.rotation.x = s * 0.6;
    j.hipR.rotation.x = -s * 0.6;
    j.kneeL.rotation.x = Math.max(0, -s) * 0.8;
    j.kneeR.rotation.x = Math.max(0, s) * 0.8;
    j.shoulderL.rotation.x = -s * 0.45;
    j.shoulderR.rotation.x = s * 0.45;
    return dist;
  }

  /**
   * Every machine, and a rebooted one back on its way once its time down is
   * up. The tread is the nearest one's, louder and faster the closer it is.
   * @param {number} dt real seconds
   * @returns {number} distance to the nearest one hunting him; Infinity for
   *   none
   */
  function updatePursuers(dt) {
    // Smooth Criminal (engine/smoothCriminal.js): they stand where they are.
    if (ctx.systems.smoothCriminal && ctx.systems.smoothCriminal.peace()) return;
    let nearest = Infinity;
    S.pursuers = S.pursuers.map((unit) => {
      nearest = Math.min(nearest, updatePursuer(unit, dt));
      if (unit.p.state !== 'down' || unit.p.timer < HERO.respawnDelay) return unit;
      removePursuer(unit);
      api.flashMessage('Another Terminator is coming');
      return spawnPursuer(unit.p.bearing, unit.p.kills);
    });
    if (Number.isFinite(nearest)) {
      S.state.stepTimer -= dt;
      if (S.state.stepTimer <= 0) {
        const near = THREE.MathUtils.clamp(nearest / 90, 0, 1);
        S.state.stepTimer = THREE.MathUtils.lerp(0.5, 1.1, near);
        ctx.systems.heroSound.playFootstep(THREE.MathUtils.clamp(1 - nearest / 110, 0.12, 1));
      }
    }
    S.state.threat = nearest;
    return nearest;
  }

  /**
   * Each machine on its feet (not knocked flat or staggering) that closes to
   * `HEALTH.melee.telegraphRange` winds up, and strikes for 50 if Roger is
   * within `contactReach` as the wind-up ends, then waits out its 3 s cooldown.
   * The pose (raised arm, eye flare) is written here, after `updatePursuer`.
   * The cooldown clock is world time, so Time Slow stretches it like the
   * machines' own movement.
   * @param {number} worldDt seconds of world time since the last frame
   * @returns {boolean} whether a touch landed this frame
   */
  function touchByPursuers(worldDt) {
    const rogerAt = S.roger.mesh.position;
    const sub = S.state.phase === 'dazed' ? 'Caught while he was reeling' : 'The Terminator caught Roger';
    let landed = false;
    for (const unit of S.pursuers) {
      const m = unit.p;
      if (m.state !== 'hunting') { cancelTelegraph(m); applyTelegraph(unit, m, unit.eyeBase); continue; }
      m.touchClock += worldDt;
      // Co-op: the same nearest player it chases (net.pickTarget), touched
      // through `damagePlayer(targetId)`; Roger alone otherwise.
      const coop = ctx.systems.net ? ctx.systems.net.pickTarget(unit.root.position.x, unit.root.position.z) : null;
      const r = coop || rogerAt;
      const id = coop ? coop.id : '0';
      const d = Math.hypot(unit.root.position.x - r.x, unit.root.position.z - r.z);
      const hit = stepTelegraph(ctx, m, d, m.stagger > 0, unit.root.position, id === '0' ? sub : `A Terminator caught Player ${id}`, id);
      if (hit) landed = true;
      applyTelegraph(unit, m, unit.eyeBase);
    }
    return landed;
  }

  /**
   * An EMP ring sweeping out from (x, z) has reached `radius`: every
   * machine on its feet inside it shorts out -- and Roger, reached by it on
   * foot, is electrocuted. In a car he is shielded (the body is a cage the
   * discharge runs round). Called by empCharge.js's discharge waves and
   * electricStorm.js's EMP.
   * @param {number} x
   * @param {number} z
   * @param {number} radius
   * @returns {void}
   */
  function empSweep(x, z, radius) {
    if (!S.Hero.active || !S.roger) return;
    for (const unit of huntingPursuers()) {
      const p = unit.root.position;
      if (Math.hypot(p.x - x, p.z - z) <= radius) startPursuerDeath(unit);
    }
    const r = S.roger.mesh.position;
    if (S.state.phase === 'dying' || S.state.phase === 'won' || Math.hypot(r.x - x, r.z - z) > radius) return;
    if (S.state.phase === 'driving') {
      api.flashMessage('EMP WAVE — the car shielded Roger');
      return;
    }
    if (S.state.spawnShield > 0 || S.state.invincible) return;
    ctx.systems.empCharge.arcAround(r, 3);
    ctx.systems.powerArcSound.playZap(1);
    ctx.systems.health.damagePlayer({
      source: 'empWave', instantKill: true, title: 'ELECTROCUTED', sub: 'An EMP wave went through Roger',
      position: { x, y: 0, z }
    });
  }

  /**
   * Shorted out: it locks where it stands, mid-stride.
   * @param {Object} unit
   * @returns {void}
   */
  function startPursuerDeath(unit) {
    const m = unit.p;
    m.state = 'seizing';
    m.timer = 0;
    cancelTelegraph(m);
    m.stagger = 0;
    m.heavy = false;
    unit.root.rotation.x = 0;
    const p = unit.root.position;
    unit.base = p.clone();
    ctx.systems.empCharge.arcAround(p, 7);
    ctx.systems.lightning.flashScreen(S.scratch.set(p.x, 5, p.z), 0.45, '#bfe8ff');
    ctx.systems.powerArcSound.playZap(1);
  }

  /**
   * The seizure, the rigid fall and the burst; after it the machine lies
   * there, down (updatePursuers brings a rebooted one back) or gone.
   * @param {Object} unit
   * @param {number} dt
   * @returns {void}
   */
  function updatePursuerDeath(unit, dt) {
    const m = unit.p;
    const root = unit.root;
    const p = root.position;
    m.timer += dt;
    if (m.state === 'seizing') {
      // Frozen joints; the whole frame shuddering; eyes stuttering; arcs
      // crawling over it and sparks spitting off.
      p.set(unit.base.x + (Math.random() - 0.5) * 0.25, 0, unit.base.z + (Math.random() - 0.5) * 0.25);
      root.rotation.z = (Math.random() - 0.5) * 0.08;
      unit.eyeMat.color.copy(unit.eyeBase).multiplyScalar(Math.random() < 0.5 ? 1 : 0.05);
      if (Math.random() < dt * 14) ctx.systems.empCharge.arcAround(p, 7);
      if (Math.random() < dt * 10) {
        S.scratch.set(p.x + (Math.random() - 0.5) * 1.5, 1 + Math.random() * 6, p.z + (Math.random() - 0.5) * 1.5);
        ctx.systems.explosions.spawnImpactBurst(S.scratch, 0.35);
      }
      if (Math.random() < dt * 5) ctx.systems.powerArcSound.playZap(0.6);
      if (m.timer >= HERO.seizeSeconds) {
        m.state = 'falling';
        m.timer = 0;
        p.copy(unit.base);
        root.rotation.z = 0;
        unit.eyeMat.color.setRGB(0.02, 0, 0);
      }
      return;
    }
    if (m.state === 'falling') {
      // Stiff as a board: the whole frame pivots at the feet, gathering
      // speed, nothing bending.
      const u = Math.min(1, m.timer / HERO.fallSeconds);
      root.rotation.x = -u * u * (Math.PI / 2 - 0.04);
      if (u >= 1) pursuerDown(unit);
    }
  }

  /**
   * On the ground: the burst, the banner, the bonus.
   * @param {Object} unit
   * @returns {void}
   */
  function pursuerDown(unit) {
    const m = unit.p;
    const p = unit.root.position;
    m.kills++;
    m.state = m.kills > HERO.respawns ? 'gone' : 'down';
    m.timer = 0;
    if (!S.burst) {
      S.burst = new THREE.Mesh(api.keepGeo(new THREE.RingGeometry(0.75, 1, 48)), api.keepMat(new THREE.MeshBasicMaterial({
        color: new THREE.Color(1.2, 3.2, 6), transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      })));
      S.burst.rotation.x = -Math.PI / 2;
      S.burst.name = 'hero_emp_burst';
      Sim.three.scene.add(S.burst);
    }
    S.burst.position.set(p.x, 0.4, p.z);
    S.burst.visible = true;
    S.state.burstTimer = HERO.burstSeconds;
    ctx.systems.empCharge.arcAround(p, 3);
    ctx.systems.lightning.flashScreen(S.scratch.set(p.x, 3, p.z), 0.8, '#9fe4ff');
    if (ctx.systems.earthquake) ctx.systems.earthquake.kickDust(p.x, p.z, 5, 2.4);
    ctx.systems.powerArcSound.playZap(1);
    ctx.systems.gamefeel.event('merge', p);
    ctx.systems.damage.addDamageScore(HERO.empKillScore);
    const cause = ({ mega: 'MEGA BEAM', minigun: 'MINIGUN' })[m.cause] || 'EMP';
    m.cause = '';
    const over = S.pursuers.every(other => other.p.state === 'gone');
    const next = m.state === 'down' ? 'another one is coming' : over ? 'the chase is over' : 'one more still hunting';
    api.showBanner('TERMINATOR TERMINATED', `${cause} · +${HERO.empKillScore} · ${next}`, 'electric');
  }

  /**
   * The ring of the burst running out over the ground.
   * @param {number} dt
   * @returns {void}
   */
  function updateBurst(dt) {
    if (!S.burst || S.state.burstTimer <= 0) return;
    S.state.burstTimer -= dt;
    const u = 1 - Math.max(0, S.state.burstTimer / HERO.burstSeconds);
    S.burst.scale.setScalar(1 + u * HERO.burstReach);
    S.burst.material.opacity = 1 - u;
    if (S.state.burstTimer <= 0) S.burst.visible = false;
  }

  return { spawnPursuer, spawnPursuers, removePursuer, removePursuers, huntingPursuers, pursuerBulletHit, megaKillPursuer, knockdownPursuer, clearAhead, updatePursuer, updatePursuers, touchByPursuers, empSweep, startPursuerDeath, updatePursuerDeath, pursuerDown, updateBurst };
}
