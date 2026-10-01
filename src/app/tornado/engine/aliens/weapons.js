// @ts-check
import * as THREE from 'three';
import { ALIENS, RAY_COLOURS, UP } from './config.js';

/**
 * ===========================================================================
 * SECTION AK.5 — Ray guns and tracking lasers
 * ===========================================================================
 * The crew's green rays and the hunters' red ones (a fixed pool of beams),
 * and the ships' tracking lasers.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the aliens' shared state (see aliens.js)
 * @param {Object} api every aliens module's functions, by name
 * @returns {Object}
 */
export function createAlienWeapons(ctx, S, api) {
  /**
   * One green ray from a point (a gun's muzzle) to another, fading over
   * rayLife.
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} to
   * @param {'green'|'red'} [colour]
   * @returns {void}
   */
  function fireRay(from, to, colour = 'green') {
    const ray = S.rays.find(r => r.life <= 0) || S.rays[0];
    const c = RAY_COLOURS[colour];
    ray.core.material.color.copy(c.core);
    ray.glow.material.color.copy(c.glow);
    ray.flare.material.color.copy(c.flare);
    ray.splash.material.color.copy(c.splash);
    const dir = S.scratch.subVectors(to, from);
    const length = dir.length();
    if (length < 0.01) return;
    ray.mesh.position.copy(from);
    ray.mesh.quaternion.setFromUnitVectors(UP, dir.divideScalar(length));
    ray.mesh.scale.set(1, length, 1);
    ray.mesh.visible = true;
    ray.flare.position.copy(from);
    ray.splash.position.copy(to);
    ray.flare.visible = ray.splash.visible = true;
    ray.life = ALIENS.rayLife;
  }

  /**
   * Raises an alien's gun arm at a point and shoots it from the muzzle.
   * @param {Alien} alien
   * @param {THREE.Vector3} to
   * @returns {void}
   */
  function shoot(alien, to) {
    const p = alien.root.position;
    alien.heading = Math.atan2(to.x - p.x, to.z - p.z);
    alien.root.rotation.y = alien.heading;
    raiseGun(alien, to);
    alien.aim = Math.max(alien.aim, ALIENS.aimHold);
    alien.root.updateMatrixWorld(true);
    const from = alien.muzzle.getWorldPosition(new THREE.Vector3());
    fireRay(from, to);
    ctx.systems.creatureSounds.play('alienZap', from, { pitch: ctx.systems.creatureSounds.pitchOf(alien) });
  }

  /**
   * The gun arm straight out at a point: forward, and tipped up or down
   * with the height of what it is aimed at.
   * @param {Alien} alien
   * @param {THREE.Vector3|null} to
   * @returns {void}
   */
  function raiseGun(alien, to) {
    let tilt = 0;
    if (to) {
      const p = alien.root.position;
      const shoulder = 1.1 * ALIENS.scale;
      tilt = Math.atan2(to.y - shoulder, Math.hypot(to.x - p.x, to.z - p.z) || 1);
    }
    alien.limbs.armR.rotation.x = -Math.PI / 2 - THREE.MathUtils.clamp(tilt, -0.8, 0.8);
    alien.limbs.armR.rotation.z = 0.05;
  }

  /** @param {number} dt @returns {void} */
  function updateRays(dt) {
    for (const ray of S.rays) {
      if (ray.life <= 0) continue;
      ray.life -= dt;
      const k = Math.max(0, ray.life / ALIENS.rayLife);
      const flicker = 0.85 + 0.15 * Math.random();
      ray.core.material.opacity = k * flicker;
      ray.glow.material.opacity = 0.55 * k * flicker;
      ray.flare.material.opacity = k * k;
      ray.flare.scale.setScalar(0.6 + (1 - k) * 1.6);
      ray.splash.material.opacity = 0.9 * k;
      ray.splash.scale.setScalar(1 + (1 - k) * 3);
      ray.mesh.scale.x = ray.mesh.scale.z = 0.5 + k * 0.7;
      if (ray.life <= 0) ray.mesh.visible = ray.flare.visible = ray.splash.visible = false;
    }
  }

  /**
   * A ship's tracking laser on Roger: it comes down off to one side of him
   * and crawls after him, slower than he runs, for ALIENS.laserSeconds.
   * @param {Object} tr one of the trackers made in initAliens
   * @param {THREE.Vector3} from where it leaves the ship
   * @param {boolean} armed whether this ship may start a new burst now
   * @param {number} dt
   * @returns {void}
   */
  function updateTracker(tr, from, armed, dt) {
    const hero = api.heroTarget();
    if (!tr.active) {
      tr.cooldown -= dt;
      const inRange = hero && Math.hypot(hero.x - from.x, hero.z - from.z) < ALIENS.laserRange;
      if (!armed || !inRange || tr.cooldown > 0) {
        tr.group.visible = tr.foot.visible = false;
        return;
      }
      tr.active = true;
      tr.timer = 0;
      const a = Math.random() * Math.PI * 2;
      tr.fx = hero.x + Math.cos(a) * ALIENS.laserStart;
      tr.fz = hero.z + Math.sin(a) * ALIENS.laserStart;
      ctx.systems.heroSound.playShipLaser(ALIENS.laserSeconds);
    }
    tr.timer += dt;
    if (hero) {
      const dx = hero.x - tr.fx;
      const dz = hero.z - tr.fz;
      const d = Math.hypot(dx, dz);
      const step = Math.min(d, ALIENS.laserSpeed * dt);
      if (d > 0.01) {
        tr.fx += (dx / d) * step;
        tr.fz += (dz / d) * step;
      }
      if (d - step < ALIENS.laserKill) {
        ctx.systems.heroMode.killRoger('VAPORISED', 'An alien ship\'s laser caught Roger');
      }
    }
    const to = S.scratch.set(tr.fx, 0.1, tr.fz);
    const dir = S.trackerDir.subVectors(to, from);
    const length = dir.length();
    tr.group.position.copy(from);
    tr.group.quaternion.setFromUnitVectors(UP, dir.divideScalar(length || 1));
    tr.group.scale.set(1, length, 1);
    const flicker = 0.8 + 0.2 * Math.random();
    tr.core.material.opacity = flicker;
    tr.glow.material.opacity = 0.45 * flicker;
    tr.foot.position.set(tr.fx, 0.12, tr.fz);
    tr.foot.material.opacity = 0.7 * flicker;
    tr.foot.scale.setScalar(0.8 + 0.3 * Math.random());
    tr.group.visible = tr.foot.visible = true;
    if (Math.random() < dt * 10 && ctx.systems.earthquake) ctx.systems.earthquake.kickDust(tr.fx, tr.fz, 1, 0.8);
    if (tr.timer >= ALIENS.laserSeconds || !hero) {
      tr.active = false;
      tr.cooldown = api.between(ALIENS.laserEvery);
      tr.group.visible = tr.foot.visible = false;
    }
  }

  /**
   * @param {Object} tr
   * @returns {void}
   */
  function stopTracker(tr) {
    if (!tr) return;
    tr.active = false;
    tr.cooldown = api.between(ALIENS.laserEvery);
    tr.group.visible = tr.foot.visible = false;
  }

  return { fireRay, shoot, raiseGun, updateRays, updateTracker, stopTracker };
}
