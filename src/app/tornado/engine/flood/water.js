import * as THREE from 'three';
import { FLOOD, CREST_BACK } from './config.js';

/**
 * ===========================================================================
 * SECTION FL.1 — The water
 * ===========================================================================
 * Where the water is and how deep, the two meshes posed for the current
 * front (their look is flood/shader.js), and what it does to everything in
 * it:
 *
 *  - **Loose things** (debris, people, cars, uprooted trees, wreckage) are
 *    dragged towards the water's own speed -- fast at the wave, slower in
 *    the flood behind -- and float up to its surface, so they travel with
 *    the flow rather than being shoved once and left.
 *  - **Cars and trees** the wave reaches take one hard impact each through
 *    damage.js (a car thrown, a tree torn out by the roots), then ride it.
 *  - **People** are taken off their feet and carried; the wave itself
 *    kills some of those it hits.
 *  - **Buildings** take damage in proportion to the flow's force on them --
 *    depth there x speed squared -- every FLOOD.buildingTick seconds they
 *    stand in it, through damage.js damageFromImpact on their upstream face:
 *    pieces torn off one after another until they come down, and the
 *    pieces are debris the water then carries. Scored and comboed like any
 *    other destruction (it is the same route).
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see flood.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createFloodWater(ctx, S, api) {
  void api;
  const { Sim } = ctx;
  const at = new THREE.Vector3();
  /** @type {WeakMap<Object, number>} when each building is next hit */
  let nextHit = new WeakMap();
  /** @type {{sun: THREE.DirectionalLight|null, hemi: THREE.HemisphereLight|null}|null} */
  let lights = null;

  /**
   * How far either side of the centreline the water reaches at a given x: a
   * narrow jet at the breach fanning out as it crosses the map.
   * @param {number} x
   * @returns {number}
   */
  function spreadAt(x) {
    const t = THREE.MathUtils.clamp((x - FLOOD.damX) / (FLOOD.endX - FLOOD.damX), 0, 1);
    return THREE.MathUtils.lerp(FLOOD.spreadAtDam, FLOOD.spreadAtEnd, t);
  }

  /**
   * The wave's height now: building height at the breach, lower as it
   * spreads, gone as the flood drains.
   * @returns {number}
   */
  function crestHeight() {
    const run = THREE.MathUtils.clamp((S.state.frontX - FLOOD.damX) / (FLOOD.endX - FLOOD.damX), 0, 1);
    return THREE.MathUtils.lerp(FLOOD.crestHeight, FLOOD.crestHeightEnd, run) * S.state.fade;
  }

  /**
   * Where the toe of the wave is at this z (it bows forward in the middle).
   * @param {number} z
   * @returns {number}
   */
  function toeAt(z) {
    const a = z / spreadAt(S.state.frontX);
    return S.state.frontX - FLOOD.frontBow * a * a;
  }

  /**
   * @param {number} x
   * @param {number} z
   * @returns {boolean} whether a point is inside the flooded corridor
   */
  function inWater(x, z) {
    if (S.state.phase === 'idle' || x < FLOOD.damX) return false;
    if (Math.abs(z) > spreadAt(x)) return false;
    return x <= toeAt(z);
  }

  /**
   * The water's surface height at a point (0 where it is dry): the wave's
   * profile near the toe, the flood's depth behind it, shoaling to the
   * ground at the corridor's edges -- as the shader draws it, less the chop.
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  function surfaceAt(x, z) {
    if (!inWater(x, z)) return 0;
    const a = Math.abs(z) / spreadAt(x);
    const edge = 1 - THREE.MathUtils.smoothstep(a, 0.78, 1);
    const depth = FLOOD.depth * S.state.fade;
    const H = crestHeight();
    if (S.state.phase !== 'surge' || H <= 0) return depth * edge;
    const b = (toeAt(z) - x) / H;
    let h;
    if (b < 0.12) h = H * (b / 0.12) * 0.95;
    else if (b < 0.4) h = H;
    else if (b < CREST_BACK) h = THREE.MathUtils.lerp(H, depth, (b - 0.4) / (CREST_BACK - 0.4));
    else h = depth;
    return Math.max(h, b < 0.12 ? 0 : depth) * edge;
  }

  /**
   * @param {number} x
   * @param {number} z
   * @returns {boolean} whether a point is under the breaking wave itself
   */
  function atCrest(x, z) {
    return S.state.phase === 'surge' && inWater(x, z) && toeAt(z) - x < crestHeight() * CREST_BACK;
  }

  /**
   * Carries everything loose the water is over: dragged towards the water's
   * speed, floated up to its surface. Cars and trees the wave reaches are
   * thrown or torn out first; people are taken off their feet, and the wave
   * kills some.
   * @param {number} dt
   * @returns {void}
   */
  function sweepObjects(dt) {
    /** @type {Object[]} people the crest has killed, dealt with after the loop */
    const drowned = [];
    /** @type {Object[]} cars and trees the crest has just reached */
    const struck = [];
    for (const obj of Sim.objects) {
      if (obj.type === 'building' || obj.type === 'viaduct') continue;
      // Anything the vortex has is the vortex's.
      if (obj.captureState && obj.captureState !== 'grounded' && obj.captureState !== 'falling') continue;
      const pos = obj.pooled ? obj.position : (obj.mesh && obj.mesh.position);
      if (!pos || !obj.velocity || !inWater(pos.x, pos.z)) continue;
      const crest = atCrest(pos.x, pos.z);

      if (obj.rooted && obj.damageState === 'intact') {
        // A standing tree holds until the wave itself reaches it.
        if (crest && !S.state.crestHit.has(obj)) {
          S.state.crestHit.add(obj);
          struck.push(obj);
        }
        continue;
      }
      if (obj.rooted) continue;

      const flow = crest ? FLOOD.flowCrest : FLOOD.flowBody;
      const drag = Math.min(1, (crest ? FLOOD.dragCrest : FLOOD.dragBody) * dt);
      obj.velocity.x += (flow - obj.velocity.x) * drag;
      obj.velocity.z += (-obj.velocity.z * 0.5 + (Math.random() - 0.5) * flow * 0.4) * drag;
      // Floats: pushed up by how far under it is, and damped there so it
      // bobs on the surface rather than bouncing off it.
      const surface = surfaceAt(pos.x, pos.z);
      const under = surface - 0.4 - pos.y;
      if (under > 0) {
        obj.velocity.y += FLOOD.buoyancy * Math.min(under, 4) * dt;
        obj.velocity.y *= Math.max(0, 1 - 2.5 * dt);
      }
      if (obj.angularVelocity && crest) {
        obj.angularVelocity.x += (Math.random() - 0.5) * 6 * dt;
        obj.angularVelocity.z += (Math.random() - 0.5) * 6 * dt;
      }

      // A person in the water stops walking and is carried, handed over the
      // same way peopleMotion hands them to the vortex.
      if (obj.type === 'person' && obj.motion && obj.motion.active) {
        obj.motion.active = false;
        obj.motion.dropped = true;
        ctx.systems.speechBubbles.exclaim(obj);
      }
      if (!crest || S.state.crestHit.has(obj)) continue;
      S.state.crestHit.add(obj);
      // The wall of water itself kills some of those it hits: decided once
      // per person, as the crest reaches them, storm or no storm.
      if (obj.type === 'person') {
        if (Math.random() < FLOOD.crestKillChance) drowned.push(obj);
      } else if (obj.type === 'car' && obj.damageState === 'intact') {
        struck.push(obj);
      }
    }
    // After the loop: a death splices Sim.objects, an impact may too.
    for (const obj of struck) {
      // It may have gone since (swallowed, or released to the pool).
      const p = obj.pooled ? obj.position : obj.mesh && obj.mesh.position;
      if (!p || obj.consumed) continue;
      at.set(p.x - 1, 1, p.z);
      const tree = obj.type === 'tree';
      ctx.systems.damage.damageFromImpact(obj, at, tree ? FLOOD.treeEnergy : FLOOD.carEnergy);
      if (obj.velocity) obj.velocity.set(FLOOD.flowCrest * 0.6, 4 + Math.random() * 3, (Math.random() - 0.5) * 4);
      if (tree && !obj.rooted) obj.damageState = 'uprooted';
    }
    for (const person of drowned) {
      if (person.mesh && person.mesh.parent) ctx.systems.damage.damageFromImpact(person, person.mesh.position, FLOOD.crestKillEnergy);
    }
  }

  /**
   * The flow's force on every building standing in it, as impacts on its
   * upstream face: depth x speed², every FLOOD.buildingTick seconds, at most
   * FLOOD.buildingsPerTick a frame.
   * @returns {void}
   */
  function hitBuildings() {
    const damage = ctx.systems.damage;
    if (!damage || !ctx.Environment) return;
    const now = S.state.waveTime;
    let hits = 0;
    for (const building of ctx.Environment.buildings) {
      if (hits >= FLOOD.buildingsPerTick) break;
      if (building.damageState === 'collapsed' || !building.mesh || !building.mesh.parent) continue;
      const p = building.mesh.position;
      if (!inWater(p.x, p.z)) continue;
      if ((nextHit.get(building) || 0) > now) continue;
      nextHit.set(building, now + FLOOD.buildingTick * (0.8 + Math.random() * 0.4));
      const crest = atCrest(p.x, p.z);
      const speed = crest ? FLOOD.flowCrest : FLOOD.flowBody;
      const depth = surfaceAt(p.x, p.z);
      const energy = FLOOD.buildingForce * depth * speed * speed;
      // Below what holes it, the water only scuffs: nothing to show.
      if (energy < 400 * ((building.breakThreshold || 8) / 8)) continue;
      const fp = building.mesh.userData.footprint;
      at.set(p.x - (fp ? fp.width / 2 : 5), Math.min(depth * 0.5, 6), p.z + (Math.random() - 0.5) * 4);
      damage.damageFromImpact(building, at, energy);
      hits++;
      if (building.damageState === 'collapsed') {
        if (ctx.systems.floodSound) ctx.systems.floodSound.playCrash(0.6);
        S.state.collapsed++;
      }
    }
  }

  /**
   * The buildings the water is frothing round, nearest the front first, into
   * the shader's obstacle list.
   * @returns {void}
   */
  function updateObstacles() {
    const list = S.obstacles;
    /** @type {{x: number, z: number, r: number, d: number}[]} */
    const found = [];
    if (ctx.Environment) {
      for (const building of ctx.Environment.buildings) {
        if (building.damageState === 'collapsed' || !building.mesh || !building.mesh.parent) continue;
        const p = building.mesh.position;
        if (!inWater(p.x, p.z)) continue;
        const fp = building.mesh.userData.footprint;
        const r = fp ? Math.hypot(fp.width, fp.depth) * 0.42 : 5;
        found.push({ x: p.x, z: p.z, r, d: S.state.frontX - p.x });
      }
    }
    found.sort((a, b) => a.d - b.d);
    const n = Math.min(found.length, list.length);
    for (let i = 0; i < n; i++) list[i].set(found[i].x, found[i].z, found[i].r, 1);
    for (const mesh of [S.body, S.crest]) mesh.material.uniforms.uObstacleCount.value = n;
    S.state.obstacleCount = n;
  }

  /**
   * The scene's light on the water: the sun's direction and colour, the sky
   * it reflects (the fog's colour), and how bright it all is, so it darkens
   * with the day/night cycle like everything else.
   * @param {THREE.ShaderMaterial} material
   * @returns {void}
   */
  function lightWater(material) {
    const scene = Sim.three.scene;
    if (!lights) {
      lights = {
        sun: /** @type {THREE.DirectionalLight|null} */ (scene.getObjectByName('light_sun') || null),
        hemi: /** @type {THREE.HemisphereLight|null} */ (scene.getObjectByName('light_hemisphere') || null)
      };
    }
    const u = material.uniforms;
    const sun = lights.sun;
    let level = 0.8;
    if (sun) {
      u.uSunDir.value.copy(sun.position).sub(sun.target.position).normalize();
      u.uSunColour.value.copy(sun.color).multiplyScalar(Math.min(1.2, sun.intensity * 0.6));
      level = 0.35 + sun.intensity * 0.35 + (lights.hemi ? lights.hemi.intensity * 0.25 : 0.2);
    }
    u.uLight.value = THREE.MathUtils.clamp(level, 0.18, 1.25);
    if (scene.fog) u.uSky.value.copy(scene.fog.color);
  }

  /**
   * Poses the two meshes for the current front.
   * @param {number} fade 0..1, for the drain
   * @returns {void}
   */
  function poseWater(fade) {
    S.state.fade = fade;
    const depth = FLOOD.depth * fade;
    const showing = depth > 0.05;
    S.body.visible = showing;
    S.crest.visible = showing && S.state.phase === 'surge';
    if (!showing) return;
    const H = crestHeight();
    updateObstacles();
    for (const mesh of [S.body, S.crest]) {
      const u = mesh.material.uniforms;
      u.uTime.value = S.state.waveTime;
      u.uFrontX.value = S.state.frontX;
      u.uDepth.value = depth;
      // Draining: the wave has gone, the body's end goes to the edge of the
      // map with nothing reared up.
      u.uCrest.value = S.state.phase === 'surge' ? H : 0;
      u.uFoamBoost.value = 0.6 + 0.4 * fade;
      lightWater(mesh.material);
    }
  }

  /** @returns {void} forgets the buildings' hit clocks (a new surge) */
  function resetWater() {
    nextHit = new WeakMap();
    lights = null;
  }

  return { spreadAt, inWater, surfaceAt, atCrest, crestHeight, toeAt, sweepObjects, hitBuildings, poseWater, resetWater };
}
