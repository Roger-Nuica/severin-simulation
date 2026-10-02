import * as THREE from 'three';
import { T800, PAD } from './config.js';
/** @typedef {import('./config.js').Unit} Unit */

/**
 * ===========================================================================
 * SECTION TM.2 — The hunt
 * ===========================================================================
 * Choosing who to go for, and the walk there round the buildings, with a
 * check that it is getting anywhere.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see terminator.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createTerminatorMovement(ctx, S, api) {
  const { Sim, container } = ctx;

  // ---------------------------------------------------------------------
  // Behaviour
  // ---------------------------------------------------------------------

  /**
   * The nearest person still walking about.
   * @param {Unit} unit
   * @returns {Object|null}
   */
  function nearestPerson(unit) {
    const p = unit.root.position;
    let best = null;
    let bestD = Infinity;
    for (const person of ctx.Environment.people) {
      if (!person.mesh || !person.mesh.parent || person.inChasm || person.electrocuted || person.abducted) continue;
      if (person === unit.ignore) continue;
      if (person.captureState && person.captureState !== 'grounded') continue;
      const q = person.mesh.position;
      const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = person;
      }
    }
    return best;
  }

  /**
   * Keeps it out of the buildings it walks into: pushed back out of any
   * footprint along the shorter axis.
   * @param {THREE.Vector3} p mutated in place
   * @returns {void}
   */
  function collideBuildings(p) {
    const pad = PAD;
    for (const building of ctx.Environment.buildings) {
      if (building.damageState === 'collapsed') continue;
      const fp = building.mesh.userData.footprint;
      if (!fp) continue;
      const b = building.mesh.position;
      const dx = p.x - b.x;
      const dz = p.z - b.z;
      const ox = fp.width / 2 + pad - Math.abs(dx);
      const oz = fp.depth / 2 + pad - Math.abs(dz);
      if (ox <= 0 || oz <= 0) continue;
      if (ox < oz) p.x += Math.sign(dx || 1) * ox;
      else p.z += Math.sign(dz || 1) * oz;
    }
  }

  /**
   * Whether a point is somewhere it cannot stand: inside a standing
   * building's footprint, off the edge of town, or over the chasm.
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  function blockedAt(x, z) {
    if (Math.abs(x) > T800.bound || Math.abs(z) > T800.bound) return true;
    const chasm = ctx.systems.chasm;
    if (chasm && chasm.gapAt(x, z) > -1.5) return true;
    for (const building of ctx.Environment.buildings) {
      if (building.damageState === 'collapsed') continue;
      const fp = building.mesh.userData.footprint;
      if (!fp) continue;
      const b = building.mesh.position;
      if (Math.abs(x - b.x) < fp.width / 2 + PAD && Math.abs(z - b.z) < fp.depth / 2 + PAD) return true;
    }
    return false;
  }

  /**
   * @param {THREE.Vector3} p
   * @param {number} heading
   * @returns {boolean} whether the way ahead along `heading` is clear
   */
  function clearAhead(p, heading) {
    const sx = Math.sin(heading);
    const cz = Math.cos(heading);
    for (const d of T800.probe) {
      if (blockedAt(p.x + sx * d, p.z + cz * d)) return false;
    }
    return true;
  }

  /**
   * The heading to actually walk on, given the one it wants. Straight at it
   * when that is clear; otherwise the nearest clear heading, trying the side
   * it last turned to first, and held for T800.detourSeconds so it follows
   * a wall round rather than dithering at the corner.
   * @param {Unit} unit
   * @param {number} want
   * @param {number} dt
   * @returns {number}
   */
  function steer(unit, want, dt) {
    const p = unit.root.position;
    if (unit.detourTimer > 0) {
      unit.detourTimer -= dt;
      if (clearAhead(p, unit.detourHeading)) return unit.detourHeading;
    }
    if (clearAhead(p, want)) return want;
    for (let k = 1; k <= 7; k++) {
      for (const side of [unit.detourSide, -unit.detourSide]) {
        const h = want + side * k * 0.42;
        if (!clearAhead(p, h)) continue;
        unit.detourSide = side;
        unit.detourHeading = h;
        unit.detourTimer = T800.detourSeconds;
        return h;
      }
    }
    // Boxed in on every side: back the way it came.
    unit.detourHeading = unit.heading + Math.PI;
    unit.detourTimer = T800.detourSeconds;
    return unit.detourHeading;
  }

  /**
   * The watchdog: a machine that has hardly moved for T800.watchdogSeconds
   * strikes out on a random clear heading and leaves its target alone for a
   * while.
   * @param {Unit} unit
   * @param {number} dt
   * @returns {void}
   */
  function watchProgress(unit, dt) {
    if (unit.ignoreTimer > 0) {
      unit.ignoreTimer -= dt;
      if (unit.ignoreTimer <= 0) unit.ignore = null;
    }
    unit.watchTimer -= dt;
    if (unit.watchTimer > 0) return;
    const p = unit.root.position;
    const moved = Math.hypot(p.x - unit.watchX, p.z - unit.watchZ);
    unit.watchX = p.x;
    unit.watchZ = p.z;
    unit.watchTimer = T800.watchdogSeconds;
    if (moved > T800.speed * T800.watchdogSeconds * T800.watchdogProgress) return;
    collideBuildings(p);
    const start = Math.random() * Math.PI * 2;
    for (let k = 0; k < 12; k++) {
      const h = start + (k / 12) * Math.PI * 2;
      if (!clearAhead(p, h)) continue;
      unit.detourHeading = h;
      break;
    }
    unit.detourTimer = T800.breakoutSeconds;
    if (unit.target) {
      unit.ignore = unit.target;
      unit.ignoreTimer = T800.ignoreSeconds;
      unit.target = null;
      unit.retarget = T800.breakoutSeconds;
    }
  }

  /**
   * @param {Unit} unit
   * @param {number} dt
   * @returns {void}
   */
  function walk(unit, dt) {
    const p = unit.root.position;
    // Into an EMP-charged funnel (engine/empCharge.js): the discharge does
    // what the EMP ring does.
    const empCharge = ctx.systems.empCharge;
    if (empCharge && empCharge.lethalAt(p.x, p.z)) {
      unit.phase = 'dying';
      unit.timer = 0;
      empCharge.arcAround(p, 3 * T800.scale * 0.6);
      ctx.systems.lightning.flashScreen(S.scratch.set(p.x, 6, p.z), 0.4, '#cfeaff');
      api.showBanner('EMP HIT!', 'The charged funnel shorted it out');
      return;
    }
    watchProgress(unit, dt);
    unit.retarget -= dt;
    if (unit.retarget <= 0 || !unit.target || !unit.target.mesh || !unit.target.mesh.parent || unit.target.electrocuted || unit.target.abducted) {
      unit.retarget = T800.retarget;
      unit.target = nearestPerson(unit);
    }

    // An alien in sight and nearer than its target comes first.
    const aliens = ctx.systems.aliens;
    unit.strikeTimer -= dt;
    unit.foe = null;
    if (aliens) {
      const foe = aliens.nearestAlien(p.x, p.z, T800.alienSight);
      if (foe) {
        const fd = Math.hypot(foe.root.position.x - p.x, foe.root.position.z - p.z);
        const td = unit.target
          ? Math.hypot(unit.target.mesh.position.x - p.x, unit.target.mesh.position.z - p.z)
          : Infinity;
        if (fd < td) unit.foe = foe;
      }
    }

    // Roger, while Hero Mode is on: he is the only target (and the aliens
    // are left alone).
    // Co-op: the nearest player who is up, Roger included (engine/net/system.js).
    const coop = ctx.systems.net ? ctx.systems.net.pickTarget(p.x, p.z) : null;
    const hero = coop || (ctx.systems.heroMode ? ctx.systems.heroMode.rogerTarget() : null);
    if (hero) unit.foe = null;

    // Towards the target, or on round the town if there is nobody left.
    let want = unit.heading;
    if (hero) {
      want = Math.atan2(hero.x - p.x, hero.z - p.z);
      if (Math.hypot(hero.x - p.x, hero.z - p.z) < T800.reach + 0.8) {
        if (coop && coop.id !== '0') ctx.systems.net.catchPlayer(coop.id, 'TERMINATED', `A Terminator reached Player ${coop.id}`);
        else ctx.systems.heroMode.killRoger('TERMINATED', 'A Terminator reached Roger');
      }
    } else if (unit.foe) {
      const q = unit.foe.root.position;
      want = Math.atan2(q.x - p.x, q.z - p.z);
      if (Math.hypot(q.x - p.x, q.z - p.z) < T800.strikeReach && unit.strikeTimer <= 0) {
        unit.strikeTimer = T800.strikeCooldown;
        aliens.strikeAlien(unit.foe, p);
        // The arm's servos and the blow (sound/creatures.js).
        ctx.systems.creatureSounds.play('servo', p, { pitch: 1.2 });
        ctx.systems.creatureSounds.play('punch', p, { pitch: 0.8 });
      }
    } else if (unit.target) {
      const q = unit.target.mesh.position;
      want = Math.atan2(q.x - p.x, q.z - p.z);
    } else if (Math.hypot(p.x, p.z) > T800.bound * 0.8) {
      want = Math.atan2(-p.x, -p.z);
    }
    // Round buildings, the chasm and the edge of town rather than into them.
    want = steer(unit, want, dt);

    let turn = Math.atan2(Math.sin(want - unit.heading), Math.cos(want - unit.heading));
    const maxTurn = T800.turnRate * dt;
    turn = THREE.MathUtils.clamp(turn, -maxTurn, maxTurn);
    unit.heading += turn;
    const step = T800.speed * dt;
    p.x += Math.sin(unit.heading) * step;
    p.z += Math.cos(unit.heading) * step;
    p.x = THREE.MathUtils.clamp(p.x, -T800.bound, T800.bound);
    p.z = THREE.MathUtils.clamp(p.z, -T800.bound, T800.bound);
    collideBuildings(p);
    unit.root.rotation.y = unit.heading;

    // The walk: a heavy, even stride, arms swinging against the legs, and a
    // little lean into the wind when a funnel is close -- it bends, it does
    // not go.
    const before = unit.cycle;
    unit.cycle += step * T800.stride / T800.scale;
    // A metal footfall every half stride (sound/creatures.js).
    if (Math.floor(before / Math.PI) !== Math.floor(unit.cycle / Math.PI)) {
      ctx.systems.creatureSounds.play('robotStep', p, { size: 1.2, gain: 0.7 });
    }
    const s = Math.sin(unit.cycle);
    const j = unit.joints;
    j.hipL.rotation.x = s * 0.55;
    j.hipR.rotation.x = -s * 0.55;
    j.kneeL.rotation.x = Math.max(0, -s) * 0.7;
    j.kneeR.rotation.x = Math.max(0, s) * 0.7;
    j.shoulderL.rotation.x = -s * 0.4;
    // The right arm swung through for a blow, just after one lands.
    j.shoulderR.rotation.x = unit.strikeTimer > T800.strikeCooldown - 0.35 ? -1.6 : s * 0.4;
    j.body.position.y = Math.abs(Math.cos(unit.cycle)) * 0.03;
    const vortex = ctx.tornadoes.nearest(p.x, p.z);
    const near = vortex && vortex.birth > 0
      ? Math.max(0, 1 - Math.hypot(p.x - vortex.center.x, p.z - vortex.center.z) / (Sim.params.radius * 2 * vortex.sizeMul))
      : 0;
    unit.root.rotation.x = near * (0.22 + 0.05 * Math.sin(unit.cycle * 3));

    // Anyone it reaches is terminated.
    if (!hero && unit.target && unit.target.mesh && unit.target.mesh.parent) {
      const q = unit.target.mesh.position;
      if (Math.hypot(q.x - p.x, q.z - p.z) < T800.reach) {
        ctx.systems.people.explodePerson(unit.target);
        ctx.systems.damage.addDamageScore(T800.killScore);
        unit.target = null;
        unit.retarget = 0;
      }
    }
  }

  return { nearestPerson, collideBuildings, blockedAt, clearAhead, steer, watchProgress, walk };
}
