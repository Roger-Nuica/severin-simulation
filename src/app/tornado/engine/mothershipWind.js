// @ts-check
import * as THREE from 'three';
import { createSoftDotTexture } from '../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from './particlePool.js';

/**
 * ===========================================================================
 * SECTION AL.2 — The mothership's downwash
 * ===========================================================================
 * In place of the camera shake (removed on request, 2026-10-04: in Hero Mode
 * the screen never stopped moving), the mothership is felt on the ground the
 * way a helicopter landing is, only far worse: a wind blasting down from it
 * and out along the street, worst where its beam is cutting.
 *
 *  - **dust storm**: dust and grit torn off the ground and thrown outwards
 *    from the beam's foot (from under the ship before it fires), billowing
 *    up near the middle; every gust a ring of dust blown out fast, like
 *    the rotor wash's ring;
 *  - **trees** bent hard away from it, fluttering, standing back up when
 *    it has gone;
 *  - **loose things** (debris, wreckage, cars knocked loose) blown outwards
 *    and lifted; **people** near the beam knocked off their feet;
 *  - **Roger** pushed by it, gently on his feet, much harder in the air on
 *    the jetpack (heroMode.js pushRoger) -- never hurt by it;
 *  - **sound**: a roaring wind with the whump of a rotor in it
 *    (sound/downwash.js), rising with it.
 *
 * Driven by mothership.js, which hands it a strength (0..1, by phase) and a
 * centre every frame. Fixed pools only: one particle pool (tracked against
 * the shared particle cap), a map of the trees it has bent.
 */

export const WASH = {
  reach: 110,             // metres from the centre it is felt
  core: 14,               // full strength inside this
  swirl: 0.35,            // of the outflow, turning round the centre
  dustMax: 900,
  dustRate: 320,          // puffs a second at full strength
  ringEvery: [0.7, 1.6],  // seconds between gusts' dust rings
  ringPuffs: 36,
  treeBend: [0.1, 0.55],  // radians, edge to core
  push: 40,               // m/s^2 on loose objects at the core
  lift: 5,
  knockReach: 28,         // people this near the centre are knocked flat
  knockChance: 0.6,
  rogerPush: 4,           // m/s on foot at the core
  rogerAirPush: 10        // m/s in the air
};

/**
 * @param {Object} ctx
 * @returns {{
 *   initWind: () => void,
 *   updateWind: (dt: number, strength: number, cx: number, cz: number) => void,
 *   resetWind: () => void,
 *   disposeWind: () => void
 * }}
 */
export function createMothershipWind(ctx) {
  const { Sim } = ctx;
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let dust = null;
  let dustAlive = false;
  let owed = 0;
  let time = 0;
  let ringTimer = 0;
  let level = 0;
  let gust = 0;
  /** @type {Map<any, {q0: THREE.Quaternion, bend: number}>} */
  const bent = new Map();
  /** @type {WeakSet<object>} people already knocked over */
  let knocked = new WeakSet();
  const bendQuat = new THREE.Quaternion();
  const bendAxis = new THREE.Vector3();
  // windAt's answer, reused.
  const w = { x: 0, z: 0, f: 0 };

  /**
   * The wind at (x, z): its direction (outwards, swirling a little) into w.x,
   * w.z and how strong, 0..1, into w.f -- before the overall strength.
   * @param {number} x @param {number} z
   * @param {number} cx @param {number} cz
   * @returns {typeof w}
   */
  function windAt(x, z, cx, cz) {
    let dx = x - cx;
    let dz = z - cz;
    const d = Math.hypot(dx, dz);
    if (d >= WASH.reach) {
      w.f = 0;
      return w;
    }
    if (d < 1e-3) {
      dx = 1;
      dz = 0;
    } else {
      dx /= d;
      dz /= d;
    }
    w.x = dx - dz * WASH.swirl;
    w.z = dz + dx * WASH.swirl;
    const len = Math.hypot(w.x, w.z);
    w.x /= len;
    w.z /= len;
    w.f = d < WASH.core ? 1 : Math.pow(1 - (d - WASH.core) / (WASH.reach - WASH.core), 1.2);
    return w;
  }

  /**
   * One puff of dust at (x, z), thrown along the wind there.
   * @param {number} x @param {number} z
   * @param {number} cx @param {number} cz
   * @param {number} speed how fast it leaves
   * @param {boolean} grit a small dark fleck rather than a cloud
   * @returns {void}
   */
  function puff(x, z, cx, cz, speed, grit) {
    if (!dust) return;
    const p = dust;
    const i = p.next;
    p.next = (p.next + 1) % p.life.length;
    const life = grit ? 0.6 + Math.random() * 0.6 : 1.2 + Math.random() * 1.3;
    p.life[i] = life;
    p.maxLife[i] = life;
    p.seed[i] = grit ? -Math.random() : Math.random();
    const v = i * 3;
    p.positions[v] = x;
    p.positions[v + 1] = 0.3 + Math.random() * (grit ? 1.5 : 0.8);
    p.positions[v + 2] = z;
    windAt(x, z, cx, cz);
    const near = w.f;
    p.velocities[v] = w.x * speed * (0.7 + Math.random() * 0.6);
    p.velocities[v + 1] = (grit ? 2 + Math.random() * 4 : 0.8 + Math.random() * 2) + near * near * 7;
    p.velocities[v + 2] = w.z * speed * (0.7 + Math.random() * 0.6);
    dustAlive = true;
  }

  /**
   * The dust storm: new puffs (more near the middle), a ring on each gust,
   * and every puff's flight.
   * @param {number} dt @param {number} s strength
   * @param {number} cx @param {number} cz
   * @returns {void}
   */
  function stepDust(dt, s, cx, cz) {
    if (!dust) return;
    const room = ctx.systems.caps.particleRoom();
    if (s > 0.02) {
      owed += WASH.dustRate * s * dt;
      let n = Math.min(Math.floor(owed), room);
      owed -= Math.floor(owed);
      while (n-- > 0) {
        const a = Math.random() * Math.PI * 2;
        const r = 2 + Math.pow(Math.random(), 1.6) * WASH.reach * 0.75;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        puff(x, z, cx, cz, 10 + 28 * s * windAt(x, z, cx, cz).f, Math.random() < 0.22);
      }
      ringTimer -= dt;
      if (ringTimer <= 0 && s > 0.4) {
        ringTimer = WASH.ringEvery[0] + Math.random() * (WASH.ringEvery[1] - WASH.ringEvery[0]);
        gust = 1;
        const puffs = Math.min(WASH.ringPuffs, Math.max(0, room - 40));
        for (let k = 0; k < puffs; k++) {
          const a = (k / puffs) * Math.PI * 2 + Math.random() * 0.1;
          puff(cx + Math.cos(a) * 6, cz + Math.sin(a) * 6, cx, cz, 34 * s, false);
        }
      }
    }
    if (!dustAlive) return;
    const p = dust;
    p.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    let any = false;
    const drag = Math.max(0, 1 - dt * 0.7);
    for (let i = 0; i < p.life.length; i++) {
      if (p.life[i] <= 0) {
        if (p.sizes[i] !== 0) {
          p.colours[i * 4 + 3] = 0;
          p.sizes[i] = 0;
        }
        continue;
      }
      any = true;
      p.life[i] -= dt;
      const t = 1 - Math.max(0, p.life[i]) / p.maxLife[i];
      const v = i * 3;
      const grit = p.seed[i] < 0;
      p.velocities[v] *= drag;
      p.velocities[v + 1] = p.velocities[v + 1] * drag - (grit ? 6 : -0.4) * dt;
      p.velocities[v + 2] *= drag;
      p.positions[v] += p.velocities[v] * dt;
      p.positions[v + 1] = Math.max(0.1, p.positions[v + 1] + p.velocities[v + 1] * dt);
      p.positions[v + 2] += p.velocities[v + 2] * dt;
      const c = i * 4;
      if (grit) {
        p.colours[c] = 0.22;
        p.colours[c + 1] = 0.2;
        p.colours[c + 2] = 0.18;
        p.colours[c + 3] = 0.85 * (1 - t);
        p.sizes[i] = 0.25;
      } else {
        // Lit a little green by the beam near the middle.
        p.colours[c] = 0.78;
        p.colours[c + 1] = 0.76;
        p.colours[c + 2] = 0.66;
        p.colours[c + 3] = 0.72 * Math.min(1, t * 5) * (1 - t * t);
        p.sizes[i] = (3 + 9 * t) * (0.7 + 0.6 * p.seed[i]);
      }
    }
    markPoolDirty(p);
    dustAlive = any;
  }

  /**
   * The trees in its reach bent away from it, fluttering; let go as it eases.
   * @param {number} dt @param {number} s
   * @param {number} cx @param {number} cz
   * @returns {void}
   */
  function stepTrees(dt, s, cx, cz) {
    if (s > 0.02) {
      for (const tree of ctx.Environment.trees) {
        if (bent.has(tree) || tree.damageState !== 'intact' || !tree.mesh.parent) continue;
        const p = tree.mesh.position;
        if (Math.abs(p.x - cx) > WASH.reach || Math.abs(p.z - cz) > WASH.reach) continue;
        if (windAt(p.x, p.z, cx, cz).f <= 0) continue;
        bent.set(tree, { q0: tree.mesh.quaternion.clone(), bend: 0 });
      }
    }
    for (const [tree, b] of bent) {
      if (tree.damageState !== 'intact' || !tree.mesh.parent) {
        bent.delete(tree);
        continue;
      }
      const p = tree.mesh.position;
      windAt(p.x, p.z, cx, cz);
      const flutter = 0.75 + 0.25 * Math.sin(time * 6.5 + tree.id * 1.7) + 0.15 * gust;
      const target = s * w.f * THREE.MathUtils.lerp(WASH.treeBend[0], WASH.treeBend[1], w.f) * flutter;
      b.bend += (target - b.bend) * Math.min(1, dt * 5);
      if (s <= 0.02 && b.bend < 0.004) {
        tree.mesh.quaternion.copy(b.q0);
        bent.delete(tree);
        continue;
      }
      // Bent along the wind: about the axis across it.
      bendAxis.set(w.z, 0, -w.x);
      bendQuat.setFromAxisAngle(bendAxis, b.bend);
      tree.mesh.quaternion.copy(bendQuat).multiply(b.q0);
    }
  }

  /**
   * Loose things blown out and lifted; people near it knocked flat.
   * @param {number} dt @param {number} s
   * @param {number} cx @param {number} cz
   * @returns {void}
   */
  function stepObjects(dt, s, cx, cz) {
    if (s <= 0.05) return;
    for (const obj of Sim.objects) {
      if (obj.type === 'building' || obj.type === 'tree') continue;
      if (obj.captureState === 'orbiting' || obj.captureState === 'rising') continue;
      if (obj.playerControlled) continue;
      const pos = obj.pooled ? obj.position : (obj.mesh && obj.mesh.position);
      if (!pos) continue;
      if (Math.abs(pos.x - cx) > WASH.reach || Math.abs(pos.z - cz) > WASH.reach) continue;
      windAt(pos.x, pos.z, cx, cz);
      if (w.f <= 0) continue;
      if (obj.type === 'person') {
        const any = /** @type {any} */ (obj);
        if (knocked.has(obj) || any.heroName) continue;
        if (Math.hypot(pos.x - cx, pos.z - cz) < WASH.knockReach && Math.random() < WASH.knockChance * s * dt * 4) {
          knocked.add(obj);
          if (any.motion && any.motion.active) {
            any.motion.active = false;
            any.motion.dropped = true;
            ctx.systems.speechBubbles.exclaim(obj);
          }
          obj.velocity.x += w.x * 9 * s;
          obj.velocity.z += w.z * 9 * s;
          obj.velocity.y += 3;
        }
        continue;
      }
      if (obj.rooted && obj.damageState === 'intact') continue;
      const push = WASH.push * w.f * s * (0.8 + 0.4 * gust) * dt;
      obj.velocity.x += w.x * push;
      obj.velocity.z += w.z * push;
      obj.velocity.y += WASH.lift * w.f * s * dt * (obj.pooled ? 1.6 : 0.5);
    }
  }

  /**
   * Roger leaning into it: pushed a little on his feet, a lot in the air.
   * @param {number} dt @param {number} s
   * @param {number} cx @param {number} cz
   * @returns {void}
   */
  function stepRoger(dt, s, cx, cz) {
    const hero = ctx.systems.heroMode;
    if (!hero || s <= 0.05) return;
    const roger = hero.rogerTarget();
    if (!roger || !roger.onFoot) return;
    windAt(roger.x, roger.z, cx, cz);
    if (w.f <= 0) return;
    const speed = (hero.rogerAirborne && hero.rogerAirborne() ? WASH.rogerAirPush : WASH.rogerPush) * w.f * s * (0.75 + 0.5 * gust);
    hero.pushRoger(w.x * speed * dt, w.z * speed * dt);
  }

  /** @returns {void} */
  function initWind() {
    dust = createParticlePool(Sim.three.scene, WASH.dustMax, createSoftDotTexture(), THREE.NormalBlending, 'mothership_wash');
    ctx.systems.caps.trackPool(dust);
  }

  /**
   * @param {number} dt simulation seconds
   * @param {number} strength 0..1, what the mothership is doing
   * @param {number} cx @param {number} cz the centre: the beam's foot, or under the ship
   * @returns {void}
   */
  function updateWind(dt, strength, cx, cz) {
    if (dt <= 0) return;
    time += dt;
    level += (strength - level) * Math.min(1, dt * 1.5);
    gust = Math.max(0, gust - dt * 1.4);
    const s = level < 0.002 ? 0 : level;
    stepDust(dt, s, cx, cz);
    if (s > 0 || bent.size) stepTrees(dt, s, cx, cz);
    stepObjects(dt, s, cx, cz);
    stepRoger(dt, s, cx, cz);
    const sfx = ctx.systems.downwashSound;
    if (sfx) sfx.updateDownwash(s, gust, Math.max(0, 1 - Math.hypot(Sim.three.camera.position.x - cx, Sim.three.camera.position.z - cz) / (WASH.reach * 1.6)));
  }

  /** @returns {void} */
  function resetWind() {
    for (const [tree, b] of bent) tree.mesh.quaternion.copy(b.q0);
    bent.clear();
    knocked = new WeakSet();
    level = gust = owed = 0;
    if (dust) {
      dust.life.fill(0);
      dust.sizes.fill(0);
      for (let i = 3; i < dust.colours.length; i += 4) dust.colours[i] = 0;
      markPoolDirty(dust);
    }
    dustAlive = false;
    const sfx = ctx.systems.downwashSound;
    if (sfx) sfx.updateDownwash(0, 0, 0);
  }

  /** @returns {void} */
  function disposeWind() {
    resetWind();
    if (dust) disposeParticlePool(Sim.three.scene, dust);
    dust = null;
  }

  return { initWind, updateWind, resetWind, disposeWind };
}
