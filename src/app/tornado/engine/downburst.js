import * as THREE from 'three';
import { createSoftDotTexture } from '../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from './particlePool.js';
import { bannerHost } from '../utils/banners.js';

/**
 * ===========================================================================
 * SECTION F.2 — Downburst
 * ===========================================================================
 * A manually-triggered event (btn-downburst): a column of air falling out of
 * the storm cell, hitting the ground and spreading as straight-line wind.
 * Where a tornado pulls everything round in a circle, this shoves everything
 * one way, so the thing to read on the ground is the *direction*: every tree
 * bent or laid flat on the same bearing, every building thrown the same way,
 * cars and people carried down one axis.
 *
 * Phases:
 *  - 'warning': the HUD alert, the shaft of rain and air coming down out of
 *    the cloud, the high roar dropping in pitch as it comes, and the square
 *    it is going to hit marked out on the ground;
 *  - 'blast': the slam, then the square blast zone growing out from the
 *    epicentre. Everything it reaches is hit once as the edge passes (trees
 *    bent or flattened, buildings shocked downwind, cars tipped, people
 *    knocked flat) and pushed for as long as it stays inside. Gusts come
 *    through every few seconds and tear more off the buildings in the core;
 *  - 'fading': the wind easing over the last few seconds; bent trees stand
 *    back up.
 * Shorter than a tornado and harder while it lasts.
 */

const DOWNBURST = {
  warningSeconds: 3.6,
  // Seconds of wind once it hits.
  duration: [32, 46],
  // Seconds for the square to grow to its full size.
  expandSeconds: 5,
  rampOut: 6,
  // Half the side of the square blast zone.
  halfSize: [72, 96],
  // The epicentre goes down under what the camera is looking at, kept this
  // close to the middle of town.
  epicentreReach: 70,
  windMph: [120, 165],
  // Loose objects: an impulse as the edge passes, then a steady shove.
  frontThrow: 20,
  push: 55,
  lift: 6,
  // Of people the edge reaches, how many it kills outright (at the core).
  personKill: 0.3,
  killEnergy: 50000,
  // Of cars, how many it rolls (at the core).
  carTip: 0.85,
  // Trees: laid flat in the core, bent everywhere else.
  treeFlattenCore: 0.62,
  treeFlatten: 0.55,
  treeBend: [0.18, 0.52],
  // Building shock as the edge passes, on damage.js's chain scale (ordinary
  // buildings resist 0.7..1.7), edge to core.
  buildingShock: [0.5, 2.3],
  gustEvery: [3, 6],
  gustShock: 1.1,
  gustBuildings: 3,
  // Camera shake at full strength, world units.
  shake: 0.45,
  shaftHeight: 150,
  bannerSeconds: 3.2,
  score: 400
};

const DUST = {
  max: 700,
  rate: 150,
  life: [0.9, 1.9],
  size: 2.8,
  colour: new THREE.Color(0.58, 0.55, 0.5)
};

const SHAFT_VERTEX = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SHAFT_FRAGMENT = /* glsl */`
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vUv;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    // Thin falling streaks of rain over a grey veil.
    float column = floor(vUv.x * 180.0);
    float across = fract(vUv.x * 180.0);
    float thin = smoothstep(0.3, 0.5, across) * (1.0 - smoothstep(0.5, 0.7, across));
    float speed = 1.6 + hash(column) * 1.4;
    float streak = fract(vUv.y * 5.0 + uTime * speed + hash(column + 7.0));
    float rain = smoothstep(0.72, 1.0, streak) * thin * step(0.35, hash(column + 3.0));
    float fade = smoothstep(0.0, 0.15, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
    float a = (0.16 + 0.3 * rain) * fade * uOpacity;
    gl_FragColor = vec4(vec3(0.3, 0.33, 0.38) + rain * 0.12, a);
  }
`;

const ZONE_VERTEX = /* glsl */`
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const ZONE_FRAGMENT = /* glsl */`
  uniform float uTime;
  uniform vec2 uCentre;
  uniform vec2 uDir;
  uniform float uHalf;
  uniform float uTarget;
  uniform float uWarn;
  uniform float uOpacity;
  varying vec3 vWorld;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    vec2 p = vWorld.xz - uCentre;
    float u = dot(p, uDir);
    float v = dot(p, vec2(-uDir.y, uDir.x));
    float box = max(abs(u), abs(v));
    vec3 colour = vec3(0.0);
    float a = 0.0;
    // The square it is about to hit, dashed and pulsing.
    if (uWarn > 0.0) {
      float line = 1.0 - smoothstep(0.0, 0.9, abs(box - uTarget));
      float along = abs(u) > abs(v) ? v : u;
      float dash = step(0.5, fract(along * 0.08 - uTime * 0.8));
      float pulse = 0.55 + 0.45 * sin(uTime * 9.0);
      a += line * dash * pulse * uWarn;
      colour += vec3(0.9, 0.3, 0.12) * line * dash * pulse * uWarn;
    }
    if (uHalf > 0.5) {
      float d = box / uHalf;
      float inside = 1.0 - smoothstep(0.99, 1.0, d);
      float edge = smoothstep(0.975, 1.0, d) * (1.0 - smoothstep(1.0, 1.02, d));
      // Long thin streaks of dust racing downwind, one per lane.
      float lane = floor(v * 0.4);
      float across = fract(v * 0.4);
      float thin = smoothstep(0.35, 0.5, across) * (1.0 - smoothstep(0.5, 0.65, across));
      float streak = fract(u * 0.02 - uTime * (1.0 + hash(lane) * 0.8) + hash(lane + 5.0));
      float s = smoothstep(0.7, 1.0, streak) * thin * step(0.4, hash(lane + 9.0)) * inside;
      a += (0.06 * inside + 0.22 * s + 0.5 * edge) * uOpacity;
      colour += vec3(0.62, 0.6, 0.56) * (0.06 * inside + 0.22 * s) * uOpacity
        + vec3(0.85, 0.45, 0.2) * 0.5 * edge * uOpacity;
    }
    if (a < 0.003) discard;
    gl_FragColor = vec4(colour / max(a, 0.001), min(a, 0.9));
  }
`;

/**
 * @param {Object} ctx
 * @returns {{
 *   initDownburst: () => void,
 *   updateDownburst: (dt: number) => void,
 *   triggerDownburst: () => void,
 *   resetDownburst: () => void,
 *   disposeDownburst: () => void,
 *   downburstZone: () => null|{x: number, z: number, half: number, dirX: number, dirZ: number, strength: number, warning: boolean}
 * }}
 */
export function createDownburstSystem(ctx) {
  const { Sim, container } = ctx;

  const state = {
    /** @type {'idle'|'warning'|'blast'|'fading'} */
    phase: 'idle',
    age: 0,
    duration: 40,
    time: 0,
    x: 0,
    z: 0,
    dirX: 1,
    dirZ: 0,
    halfTarget: 80,
    half: 0,
    // 0..1 how hard it is blowing right now, gusts included.
    strength: 0,
    descent: 0,
    mph: 140,
    gustTimer: 0,
    gustBoost: 0,
    bannerTimer: 0,
    /** @type {WeakSet<Object>} everything the edge has already reached */
    hit: new WeakSet(),
    /** @type {Map<Object, {q0: THREE.Quaternion, max: number, bend: number}>} */
    bent: new Map()
  };

  /** @type {import('./particlePool.js').ParticlePool|null} */
  let dust = null;
  let dustAccumulator = 0;
  let dustAlive = 0;
  /** @type {THREE.Mesh|null} */
  let shaft = null;
  /** @type {THREE.Mesh|null} */
  let zone = null;
  /** @type {HTMLDivElement|null} */
  let banner = null;
  const bendQuat = new THREE.Quaternion();
  const bendAxis = new THREE.Vector3();

  /** @returns {void} */
  function initDownburst() {
    const scene = Sim.three.scene;
    dust = createParticlePool(scene, DUST.max, createSoftDotTexture(), THREE.NormalBlending, 'downburst_dust');

    const shaftGeo = new THREE.CylinderGeometry(24, 42, 1, 40, 1, true);
    shaftGeo.translate(0, 0.5, 0);
    shaft = new THREE.Mesh(shaftGeo, new THREE.ShaderMaterial({
      vertexShader: SHAFT_VERTEX,
      fragmentShader: SHAFT_FRAGMENT,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    }));
    shaft.name = 'downburst_shaft';
    shaft.visible = false;
    shaft.renderOrder = 3;
    scene.add(shaft);

    const zoneSize = DOWNBURST.halfSize[1] * 2 + 20;
    const zoneGeo = new THREE.PlaneGeometry(zoneSize, zoneSize);
    zoneGeo.rotateX(-Math.PI / 2);
    zone = new THREE.Mesh(zoneGeo, new THREE.ShaderMaterial({
      vertexShader: ZONE_VERTEX,
      fragmentShader: ZONE_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uCentre: { value: new THREE.Vector2() },
        uDir: { value: new THREE.Vector2(1, 0) },
        uHalf: { value: 0 },
        uTarget: { value: 0 },
        uWarn: { value: 0 },
        uOpacity: { value: 0 }
      },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    }));
    zone.name = 'downburst_zone';
    zone.position.y = 0.14;
    zone.visible = false;
    zone.renderOrder = 2;
    scene.add(zone);

    banner = document.createElement('div');
    banner.className = 'downburst-banner';
    banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
    bannerHost(container).appendChild(banner);

    const button = document.getElementById('btn-downburst');
    if (button) button.addEventListener('click', () => triggerDownburst(), { signal: ctx.signal });
  }

  /**
   * @param {string} title
   * @param {string} sub
   * @param {boolean} [alert] the flashing warning style
   * @returns {void}
   */
  function showBanner(title, sub, alert = false) {
    if (!banner) return;
    banner.querySelector('.title').textContent = title;
    banner.querySelector('.sub').textContent = sub;
    banner.classList.toggle('alert', alert);
    banner.classList.add('visible');
    state.bannerTimer = DOWNBURST.bannerSeconds;
  }

  /**
   * @param {ReadonlyArray<number>} range
   * @returns {number}
   */
  function between(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  /**
   * @param {number} dx
   * @param {number} dz
   * @returns {string} a compass point for the way the wind is going
   */
  function compass(dx, dz) {
    // +x east, -z north, as the minimap draws them.
    const bearing = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(bearing / 45) % 8];
  }

  /**
   * @param {boolean} on
   * @returns {void}
   */
  function setButtonActive(on) {
    const button = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-downburst'));
    if (!button) return;
    button.classList.toggle('active', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    // Held off while one is on its way or blowing; free again once it is over.
    button.disabled = on;
  }

  /**
   * Brings one down under what the camera is looking at. Ignored while one
   * is already on its way or blowing.
   * @returns {void}
   */
  function triggerDownburst() {
    if (state.phase !== 'idle') return;
    const target = Sim.three.controls ? Sim.three.controls.target : new THREE.Vector3();
    let x = target.x + (Math.random() - 0.5) * 30;
    let z = target.z + (Math.random() - 0.5) * 30;
    const r = Math.hypot(x, z);
    if (r > DOWNBURST.epicentreReach) {
      x *= DOWNBURST.epicentreReach / r;
      z *= DOWNBURST.epicentreReach / r;
    }
    const angle = Math.random() * Math.PI * 2;
    Object.assign(state, {
      phase: 'warning',
      age: 0,
      x, z,
      dirX: Math.cos(angle),
      dirZ: Math.sin(angle),
      halfTarget: between(DOWNBURST.halfSize),
      half: 0,
      duration: between(DOWNBURST.duration),
      mph: Math.round(between(DOWNBURST.windMph)),
      strength: 0,
      descent: 0,
      gustTimer: between(DOWNBURST.gustEvery),
      gustBoost: 0,
      hit: new WeakSet()
    });
    showBanner('⚠ DOWNBURST WARNING', 'Straight-line winds coming down · take cover', true);
    state.bannerTimer = DOWNBURST.warningSeconds;
    setButtonActive(true);
  }

  /** @returns {void} */
  function slam() {
    state.phase = 'blast';
    state.age = 0;
    const at = new THREE.Vector3(state.x, 1, state.z);
    showBanner('DOWNBURST!',
      `${state.mph} mph straight-line winds · blowing ${compass(state.dirX, state.dirZ)}`, true);
    ctx.systems.downburstSound.playSlam();
    if (ctx.systems.gamefeel) ctx.systems.gamefeel.event('downburst', at);
    ctx.systems.damage.addDamageScore(DOWNBURST.score);
    if (ctx.systems.earthquake) ctx.systems.earthquake.kickDust(state.x, state.z, 10, 3);
    if (ctx.systems.powerLines) ctx.systems.powerLines.faultAt(state.x, state.z, state.halfTarget * 0.7);
  }

  /**
   * Where a ground point sits in the blast zone.
   * @param {number} x
   * @param {number} z
   * @param {number} half the square's current half-size
   * @returns {number} 0 outside, else 0.45 (edge)..1 (epicentre)
   */
  function coreAt(x, z, half) {
    if (half <= 0) return 0;
    const px = x - state.x;
    const pz = z - state.z;
    const u = px * state.dirX + pz * state.dirZ;
    const v = -px * state.dirZ + pz * state.dirX;
    const box = Math.max(Math.abs(u), Math.abs(v));
    if (box > half) return 0;
    return 1 - 0.55 * (box / state.halfTarget);
  }

  /**
   * Everything the growing square has reached this frame, once each.
   * @returns {void}
   */
  function hitNew() {
    const damage = ctx.systems.damage;
    const env = ctx.Environment;
    if (!env) return;

    for (const tree of env.trees) {
      if (state.hit.has(tree) || tree.damageState !== 'intact' || !tree.mesh.parent) continue;
      const p = tree.mesh.position;
      const core = coreAt(p.x, p.z, state.half);
      if (!core) continue;
      state.hit.add(tree);
      if (core > DOWNBURST.treeFlattenCore && Math.random() < DOWNBURST.treeFlatten) {
        // Laid flat on the wind's own bearing: the pattern that says downburst.
        if (damage.flattenTree(tree, state.dirX, state.dirZ)) ctx.systems.gamefeel.event('tree', p);
        continue;
      }
      state.bent.set(tree, {
        q0: tree.mesh.quaternion.clone(),
        max: THREE.MathUtils.lerp(DOWNBURST.treeBend[0], DOWNBURST.treeBend[1], core) * (0.85 + Math.random() * 0.3),
        bend: 0
      });
    }

    for (const building of env.buildings) {
      if (state.hit.has(building) || building.damageState === 'collapsed') continue;
      const p = building.mesh.position;
      const core = coreAt(p.x, p.z, state.half);
      if (!core) continue;
      state.hit.add(building);
      // From upwind, so what comes off it and what falls goes downwind.
      const origin = new THREE.Vector3(p.x - state.dirX * 10, 0, p.z - state.dirZ * 10);
      const shock = THREE.MathUtils.lerp(DOWNBURST.buildingShock[0], DOWNBURST.buildingShock[1], (core - 0.45) / 0.55);
      damage.shockBuilding(building, shock * (0.85 + Math.random() * 0.3), origin);
    }
  }

  /**
   * One gust: a surge in the wind and more torn off the buildings in the core.
   * @returns {void}
   */
  function gust() {
    state.gustBoost = 1;
    ctx.systems.downburstSound.playGust(state.strength);
    const env = ctx.Environment;
    if (!env) return;
    const standing = env.buildings.filter(b => b.damageState !== 'collapsed'
      && coreAt(b.mesh.position.x, b.mesh.position.z, state.half) > 0.6);
    for (let i = 0; i < DOWNBURST.gustBuildings && standing.length; i++) {
      const building = standing.splice(Math.floor(Math.random() * standing.length), 1)[0];
      const p = building.mesh.position;
      ctx.systems.damage.shockBuilding(
        building, DOWNBURST.gustShock * (0.7 + Math.random() * 0.6),
        new THREE.Vector3(p.x - state.dirX * 10, 0, p.z - state.dirZ * 10)
      );
    }
  }

  /**
   * The steady shove on everything loose in the zone, and the one-off knock
   * as the edge first reaches it.
   * @param {number} dt
   * @returns {void}
   */
  function pushObjects(dt) {
    /** @type {Object[]} */
    const killed = [];
    const s = state.strength;
    for (const obj of Sim.objects) {
      if (obj.type === 'building' || obj.type === 'tree') continue;
      if (obj.rooted && obj.damageState === 'intact') continue;
      if (obj.captureState === 'orbiting' || obj.captureState === 'rising') continue;
      if (obj.playerControlled) continue;
      const pos = obj.pooled ? obj.position : (obj.mesh && obj.mesh.position);
      if (!pos) continue;
      const core = coreAt(pos.x, pos.z, state.half);
      if (!core) continue;

      if (!state.hit.has(obj)) {
        state.hit.add(obj);
        const throwSpeed = DOWNBURST.frontThrow * core * s;
        obj.velocity.x += state.dirX * throwSpeed;
        obj.velocity.z += state.dirZ * throwSpeed;
        obj.velocity.y += 2 + 3 * core;
        if (obj.type === 'person') {
          if (obj.motion && obj.motion.active) {
            obj.motion.active = false;
            obj.motion.dropped = true;
            ctx.systems.speechBubbles.exclaim(obj);
          }
          if (Math.random() < DOWNBURST.personKill * core) killed.push(obj);
        } else if (obj.type === 'car' && obj.damageState === 'intact'
          && Math.random() < DOWNBURST.carTip * core) {
          obj.damageState = 'tipped';
          obj.mesh.userData.parked = false;
          // Rolled over about the axis across the wind.
          obj.angularVelocity.set(state.dirZ * 4.5, (Math.random() - 0.5) * 1.5, -state.dirX * 4.5);
          obj.velocity.y += 3;
          Sim.stats.vehiclesOverturned++;
          ctx.systems.gamefeel.event('car', pos);
          ctx.systems.damage.addDamageScore(15);
        }
      }

      const push = DOWNBURST.push * core * s * dt;
      obj.velocity.x += state.dirX * push;
      obj.velocity.z += state.dirZ * push;
      obj.velocity.y += DOWNBURST.lift * core * s * dt * (obj.pooled ? 1.6 : 0.6);
    }
    // After the loop: a death splices Sim.objects.
    for (const person of killed) {
      if (person.mesh.parent) {
        ctx.systems.damage.damageFromImpact(person, person.mesh.position, DOWNBURST.killEnergy);
      }
    }
  }

  /**
   * Bends every tree the wind has hold of along its bearing, with a flutter,
   * and lets them back up as it eases.
   * @param {number} dt
   * @returns {void}
   */
  function updateBentTrees(dt) {
    bendAxis.set(state.dirZ, 0, -state.dirX);
    for (const [tree, b] of state.bent) {
      if (tree.damageState !== 'intact' || !tree.mesh.parent) {
        state.bent.delete(tree);
        continue;
      }
      const flutter = 0.82 + 0.18 * Math.sin(state.time * 5.5 + tree.id * 1.7);
      const target = b.max * state.strength * flutter;
      b.bend += (target - b.bend) * Math.min(1, dt * 4);
      bendQuat.setFromAxisAngle(bendAxis, b.bend);
      tree.mesh.quaternion.copy(bendQuat).multiply(b.q0);
      if (state.phase === 'idle' && b.bend < 0.004) {
        tree.mesh.quaternion.copy(b.q0);
        state.bent.delete(tree);
      }
    }
  }

  /**
   * @param {number} x
   * @param {number} z
   * @returns {void}
   */
  function spawnStreak(x, z) {
    const p = dust;
    const i = p.next;
    p.next = (p.next + 1) % DUST.max;
    const speed = (26 + Math.random() * 22) * (0.4 + 0.6 * state.strength);
    p.positions[i * 3] = x;
    p.positions[i * 3 + 1] = 0.3 + Math.random() * 4.5;
    p.positions[i * 3 + 2] = z;
    p.velocities[i * 3] = state.dirX * speed + (Math.random() - 0.5) * 3;
    p.velocities[i * 3 + 1] = Math.random() * 1.5;
    p.velocities[i * 3 + 2] = state.dirZ * speed + (Math.random() - 0.5) * 3;
    p.life[i] = p.maxLife[i] = between(DUST.life);
    p.seed[i] = Math.random();
    dustAlive++;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateDust(dt) {
    const p = dust;
    dustAlive = 0;
    for (let i = 0; i < DUST.max; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      if (p.life[i] <= 0) {
        p.colours[i * 4 + 3] = 0;
        p.sizes[i] = 0;
        continue;
      }
      dustAlive++;
      p.positions[i * 3] += p.velocities[i * 3] * dt;
      p.positions[i * 3 + 1] += p.velocities[i * 3 + 1] * dt;
      p.positions[i * 3 + 2] += p.velocities[i * 3 + 2] * dt;
      const u = 1 - p.life[i] / p.maxLife[i];
      p.colours[i * 4] = DUST.colour.r;
      p.colours[i * 4 + 1] = DUST.colour.g;
      p.colours[i * 4 + 2] = DUST.colour.b;
      p.colours[i * 4 + 3] = 0.5 * Math.min(1, u * 6) * (1 - u);
      p.sizes[i] = DUST.size * (0.6 + 0.8 * p.seed[i]) * (0.7 + 0.9 * u);
    }
    markPoolDirty(p);
    p.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
  }

  /** @returns {void} */
  function applyCameraShake() {
    const mag = DOWNBURST.shake * state.strength;
    if (mag <= 0.0005) return;
    const cam = Sim.three.camera;
    // Buffeted along the wind rather than jittered at random.
    const buffet = Math.sin(state.time * 13.1) * 0.6 + Math.sin(state.time * 29.3 + 1.1) * 0.4;
    cam.position.x += (state.dirX * buffet + (Math.random() - 0.5) * 0.4) * mag;
    cam.position.y += (Math.random() - 0.5) * mag * 0.3;
    cam.position.z += (state.dirZ * buffet + (Math.random() - 0.5) * 0.4) * mag;
  }

  /**
   * Per frame, not while paused.
   * @param {number} dt
   * @returns {void}
   */
  function updateDownburst(dt) {
    if (!dust) return;
    state.time += dt;

    if (state.phase === 'warning') {
      state.age += dt;
      state.descent = Math.min(1, state.age / DOWNBURST.warningSeconds);
      if (state.age >= DOWNBURST.warningSeconds) slam();
    } else if (state.phase === 'blast' || state.phase === 'fading') {
      state.age += dt;
      state.descent = 1;
      state.half = state.halfTarget * THREE.MathUtils.smoothstep(state.age, 0, DOWNBURST.expandSeconds);
      if (state.phase === 'blast' && state.age >= state.duration - DOWNBURST.rampOut) {
        state.phase = 'fading';
        showBanner('Winds easing', 'The downburst is blowing itself out');
      }
      state.gustTimer -= dt;
      if (state.gustTimer <= 0 && state.phase === 'blast') {
        gust();
        state.gustTimer = between(DOWNBURST.gustEvery);
      }
      state.gustBoost = Math.max(0, state.gustBoost - dt * 0.8);
      const envelope = THREE.MathUtils.smoothstep(state.age, 0, 0.6)
        * (1 - THREE.MathUtils.smoothstep(state.age, state.duration - DOWNBURST.rampOut, state.duration));
      const gusty = 0.82 + 0.1 * Math.sin(state.time * 1.7) + 0.08 * Math.sin(state.time * 4.3);
      state.strength = Math.min(1, envelope * (gusty + 0.25 * state.gustBoost));
      if (state.age >= state.duration) {
        state.phase = 'idle';
        state.strength = 0;
        state.descent = 0;
        state.half = 0;
        setButtonActive(false);
      }
    }

    const blowing = state.phase === 'blast' || state.phase === 'fading';
    if (blowing) {
      hitNew();
      pushObjects(dt);
      applyCameraShake();
      dustAccumulator += DUST.rate * state.strength * dt;
      while (dustAccumulator >= 1) {
        dustAccumulator -= 1;
        // Anywhere in the square, from its upwind half so a streak crosses it.
        const u = (Math.random() * 1.6 - 1) * state.half;
        const v = (Math.random() * 2 - 1) * state.half;
        spawnStreak(
          state.x + state.dirX * u - state.dirZ * v,
          state.z + state.dirZ * u + state.dirX * v
        );
      }
    }
    if (state.bent.size) updateBentTrees(dt);
    if (blowing || dustAlive > 0) updateDust(dt);
    updateVisuals();

    ctx.systems.downburstSound.updateDownburstSound(
      blowing ? state.strength : 0, state.phase === 'warning' ? state.descent : 0, dt
    );

    if (state.bannerTimer > 0) {
      state.bannerTimer -= dt;
      if (state.bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }
  }

  /** @returns {void} */
  function updateVisuals() {
    const warning = state.phase === 'warning';
    const blowing = state.phase === 'blast' || state.phase === 'fading';
    const on = warning || blowing;
    shaft.visible = on;
    zone.visible = on;
    if (!on) return;

    // The column comes down out of the cloud during the warning, then
    // thins out with the wind.
    const bottom = warning ? DOWNBURST.shaftHeight * (1 - state.descent * state.descent) : 0;
    shaft.position.set(state.x, bottom, state.z);
    shaft.scale.set(1, Math.max(1, DOWNBURST.shaftHeight - bottom), 1);
    const su = shaft.material.uniforms;
    su.uTime.value = state.time;
    su.uOpacity.value = warning ? Math.min(1, state.descent * 2) : 0.35 + 0.65 * state.strength;

    const zu = zone.material.uniforms;
    zone.position.x = state.x;
    zone.position.z = state.z;
    zu.uTime.value = state.time;
    zu.uCentre.value.set(state.x, state.z);
    zu.uDir.value.set(state.dirX, state.dirZ);
    zu.uHalf.value = state.half;
    zu.uTarget.value = state.halfTarget;
    zu.uWarn.value = warning ? 1 : Math.max(0, 1 - state.age * 1.5);
    zu.uOpacity.value = blowing ? Math.min(1, state.strength * 1.2) : 0;
  }

  /** @returns {void} */
  function resetDownburst() {
    // The trees are rebuilt by resetEnvironment; stand any still bent back up
    // in case this is called without one.
    for (const [tree, b] of state.bent) tree.mesh.quaternion.copy(b.q0);
    state.bent.clear();
    state.phase = 'idle';
    state.age = 0;
    state.strength = 0;
    state.descent = 0;
    state.half = 0;
    state.bannerTimer = 0;
    state.hit = new WeakSet();
    dustAccumulator = 0;
    dustAlive = 0;
    if (dust) {
      dust.life.fill(0);
      dust.colours.fill(0);
      dust.sizes.fill(0);
      markPoolDirty(dust);
    }
    if (shaft) shaft.visible = false;
    if (zone) zone.visible = false;
    if (banner) banner.classList.remove('visible');
    setButtonActive(false);
    ctx.systems.downburstSound.fadeOutDownburstSound();
  }

  /** @returns {void} */
  function disposeDownburst() {
    const scene = Sim.three.scene;
    if (dust) disposeParticlePool(scene, dust);
    for (const mesh of [shaft, zone]) {
      if (!mesh) continue;
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    ctx.systems.downburstSound.disposeDownburstSound();
    dust = null;
    shaft = null;
    zone = null;
    banner = null;
  }

  /**
   * For the minimap: the square, while there is one to draw.
   * @returns {null|{x: number, z: number, half: number, dirX: number, dirZ: number, strength: number, warning: boolean}}
   */
  function downburstZone() {
    if (state.phase === 'idle') return null;
    const warning = state.phase === 'warning';
    return {
      x: state.x, z: state.z,
      half: warning ? state.halfTarget : state.half,
      dirX: state.dirX, dirZ: state.dirZ,
      strength: state.strength, warning
    };
  }

  return {
    initDownburst, updateDownburst, triggerDownburst, resetDownburst, disposeDownburst, downburstZone
  };
}
