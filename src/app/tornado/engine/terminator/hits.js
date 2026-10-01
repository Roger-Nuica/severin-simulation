import * as THREE from 'three';
import { T800 } from './config.js';
/** @typedef {import('./config.js').Unit} Unit */

/**
 * ===========================================================================
 * SECTION TM.3 — Hits and death
 * ===========================================================================
 * What stops one (an EMP, Roger's plasma and bullets, an alien's ray), its
 * death, and one being taken up by the aliens.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see terminator.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createTerminatorHits(ctx, S, api) {
  /**
   * The EMP has it: sparks and a shudder, the eyes flickering out, then over
   * backwards.
   * @param {Unit} unit
   * @param {number} dt
   * @returns {void}
   */
  function die(unit, dt) {
    // Shutting down, the moment it starts to go (sound/creatures.js).
    if (unit.timer === 0) ctx.systems.creatureSounds.play('powerDown', unit.root.position, { size: 1.2 });
    unit.timer += dt;
    const p = unit.root.position;
    const j = unit.joints;
    if (unit.timer < T800.dyingSeconds) {
      const u = unit.timer / T800.dyingSeconds;
      // Seized joints twitching.
      j.body.rotation.z = (Math.random() - 0.5) * 0.12 * (1 - u * 0.5);
      j.head.rotation.y = (Math.random() - 0.5) * 0.6;
      j.shoulderL.rotation.x = -0.4 + (Math.random() - 0.5) * 0.8;
      j.shoulderR.rotation.x = -0.4 + (Math.random() - 0.5) * 0.8;
      // Eyes stuttering, fading.
      const on = Math.random() < 1 - u * 0.8 ? 1 : 0.05;
      unit.eyeMat.color.copy(T800.eye).multiplyScalar(on * (1 - u * 0.7));
      if (Math.random() < dt * 8) {
        S.scratch.set(p.x + (Math.random() - 0.5) * 2, 2 + Math.random() * 3, p.z + (Math.random() - 0.5) * 2);
        ctx.systems.explosions.spawnImpactBurst(S.scratch, 0.45);
      }
      return;
    }
    const f = Math.min(1, (unit.timer - T800.dyingSeconds) / T800.fallSeconds);
    unit.root.rotation.x = -f * f * (Math.PI / 2 - 0.08);
    unit.eyeMat.color.setRGB(0.02, 0, 0);
    if (f >= 1 && unit.phase === 'dying') {
      unit.phase = 'dead';
      S.scratch.set(p.x, 1.5, p.z);
      ctx.systems.explosions.spawnImpactBurst(S.scratch, 3);
      ctx.systems.cues.playLargeExplosion({ priority: true, gain: 0.8 });
      ctx.systems.gamefeel.event('factory', S.scratch);
      ctx.systems.damage.addDamageScore(T800.destroyScore);
      const left = api.aliveCount();
      if (left > 0) {
        api.showBanner('TERMINATED', `The EMP took one down · +${T800.destroyScore} · ${left} left`);
      } else {
        api.showBanner('ALL TERMINATED', `The EMP took the last one down · +${T800.destroyScore}`);
        if (S.button) S.button.disabled = false;
      }
    }
  }

  /**
   * Called by electricStorm.js as its EMP ring sweeps outward.
   * @param {number} x ring centre
   * @param {number} z
   * @param {number} radius how far the ring has reached
   * @returns {void}
   */
  function empSweep(x, z, radius) {
    for (const unit of S.units) {
      if (unit.phase !== 'walking') continue;
      const p = unit.root.position;
      if (Math.hypot(p.x - x, p.z - z) > radius) continue;
      unit.phase = 'dying';
      unit.timer = 0;
      ctx.systems.lightning.flashScreen(S.scratch.set(p.x, 6, p.z), 0.4, '#cfeaff');
      api.showBanner('EMP HIT!', 'Its circuits are failing');
    }
  }

  /**
   * The walking machine nearest a point, within `radius`, for the aliens.
   * @param {number} x
   * @param {number} z
   * @param {number} radius
   * @returns {Unit|null}
   */
  function nearestWalking(x, z, radius) {
    let best = null;
    let bestD = radius;
    for (const unit of S.units) {
      if (unit.phase !== 'walking') continue;
      const d = Math.hypot(unit.root.position.x - x, unit.root.position.z - z);
      if (d < bestD) {
        bestD = d;
        best = unit;
      }
    }
    return best;
  }

  /**
   * Hands a machine over to the aliens' tractor: it stops walking and they
   * move it from here on.
   * @param {Unit} unit
   * @returns {THREE.Group} its root, for them to carry
   */
  function takeUnit(unit) {
    unit.phase = 'taken';
    unit.root.rotation.x = 0;
    api.showBanner('TERMINATOR CAPTURED', 'The aliens are taking it aboard');
    return unit.root;
  }

  /**
   * It has gone through the hatch: gone for good, as good as destroyed.
   * @param {Unit} unit
   * @returns {void}
   */
  function finishTaken(unit) {
    unit.phase = 'dead';
    unit.root.visible = false;
    if (api.aliveCount() === 0 && S.button) S.button.disabled = false;
  }

  /**
   * The ship went down with it on the ramp: dropped, and back on its feet.
   * @param {Unit} unit
   * @returns {void}
   */
  function releaseUnit(unit) {
    if (unit.phase !== 'taken') return;
    unit.phase = 'walking';
    unit.root.position.y = 0;
    unit.root.scale.setScalar(T800.scale);
    api.collideBuildings(unit.root.position);
    unit.watchX = unit.root.position.x;
    unit.watchZ = unit.root.position.z;
  }

  /**
   * An alien ray hitting it: sparks off the chrome and nothing more.
   * @param {Unit} unit
   * @returns {void}
   */
  function rayHit(unit) {
    const p = unit.root.position;
    ctx.systems.creatureSounds.play('robotHit', p, { size: 1.2 });
    S.scratch.set(p.x, 3, p.z);
    ctx.systems.explosions.spawnImpactBurst(S.scratch, 0.35);
  }

  /**
   * Roger's plasma rifle (engine/heroMode.js): a normal shot throws it back
   * a few steps in a shower of sparks; a mega beam brings it down for good,
   * as the EMP would.
   * @param {Unit} unit
   * @param {boolean} mega
   * @param {THREE.Vector3} from where the shot came from
   * @returns {void}
   */
  function plasmaHit(unit, mega, from) {
    if (unit.phase !== 'walking') return;
    const p = unit.root.position;
    S.scratch.set(p.x, 4, p.z);
    ctx.systems.explosions.spawnImpactBurst(S.scratch, mega ? 2 : 0.7);
    ctx.systems.creatureSounds.play('robotHit', p, { size: 1.2 });
    if (mega) {
      unit.phase = 'dying';
      unit.timer = 0;
      api.showBanner('MEGA BEAM!', 'It is going down');
      return;
    }
    const dx = p.x - from.x;
    const dz = p.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    p.x += (dx / d) * 4;
    p.z += (dz / d) * 4;
    api.collideBuildings(p);
  }

  /**
   * One of Roger's minigun rounds (engine/heroWeapons.js): sparks off the
   * chassis, and on the `killAt`th round it goes down, as the EMP would bring it.
   * @param {Unit} unit
   * @param {number} killAt rounds it takes
   * @returns {number} rounds it has taken so far
   */
  function bulletHit(unit, killAt) {
    if (unit.phase !== 'walking') return 0;
    unit.bulletHits = (unit.bulletHits || 0) + 1;
    ctx.systems.creatureSounds.play('robotHit', unit.root.position, { size: 1.2, gain: 0.5, pitch: 1.3 });
    if (unit.bulletHits >= killAt) {
      unit.phase = 'dying';
      unit.timer = 0;
      api.showBanner('MINIGUN!', 'It is going down');
    }
    return unit.bulletHits;
  }

  /** @returns {Unit[]} the ones walking, for Roger's sights */
  function walkingUnits() {
    return S.units.filter(unit => unit.phase === 'walking');
  }

  return { die, empSweep, nearestWalking, takeUnit, finishTaken, releaseUnit, rayHit, plasmaHit, bulletHit, walkingUnits };
}
