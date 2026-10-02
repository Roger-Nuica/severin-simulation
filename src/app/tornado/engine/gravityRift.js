// @ts-check
import * as THREE from 'three';
import { bannerHost } from '../utils/banners.js';
import { BLAST_SIZE } from './player/energy.js';

/**
 * ===========================================================================
 * SECTION GR — Gravity Rift
 * ===========================================================================
 * A manually triggered disaster (btn-gravity-rift), opened under what the
 * camera is looking at. Inside a circle gravity lets go: cars, people, loose
 * debris and the alien crew float up, turning slowly, to between 10 and
 * 24 m. Then it comes back all at once: everything is slammed down, and
 * everything that went up blows up where it lands (owner's request,
 * BACKLOG.md).
 *
 * Phases:
 *  - 'warning': the ring on the ground pulses, the banner warns;
 *  - 'rise':    everything inside floats up (new arrivals too, up to the
 *               caps below) to its own height;
 *  - 'hang':    a moment of weightless stillness, the column flickering;
 *  - 'drop':    the slam. Everything lifted is thrown down at dropSpeed and
 *               goes up on contact: a car burns out with a fireball (the
 *               fuel-station chain's look, engine/fuelFire/chain.js), a
 *               person and a piece of debris burst, an alien is killed
 *               through its own kill path (enemies.js `defeat`). Whatever
 *               has not landed after dropMaxSeconds goes up where it is;
 *  - 'fading':  the column and ring fade out.
 *
 * The lift works through the ordinary physics (physics.js): each frame a
 * lifted object gets back the gravity physics is about to take off it, plus
 * a spring towards its height, so a tornado, a blast or a wall still act on
 * it as usual. Aliens are not physics objects: they are held 'frozen' in the
 * enemy register (their owner skips them) and moved here, as the grappling
 * hook does (player/grapple.js). Roger, the car he is driving, buildings,
 * trees and the other enemies are left alone.
 */

const RIFT = {
  warningSeconds: 2.2,
  riseSeconds: 6,
  hangSeconds: 1.4,
  // The slam: straight down at this, and anything still up after the
  // window goes up where it is.
  dropSpeed: 34,
  dropMaxSeconds: 3.5,
  fadeSeconds: 1.6,
  radius: 40,
  // Opened under the camera's target, kept this close to the middle of town.
  reach: 90,
  height: [10, 24],
  // Metres a second at most while rising, and how hard it pulls to its height.
  riseSpeed: 5,
  spring: 0.9,
  // Horizontal drift damping while weightless (per second).
  hold: 1.6,
  spin: 0.9,
  caps: { car: 30, person: 60, debris: 40, alien: 16 },
  carBlast: 1.5,
  personBlast: 0.9,
  debrisBlast: 0.45,
  // Of the debris that lands, how many get a burst of their own (the burst
  // pool is 36 slots, explosions/index.js).
  debrisBurstChance: 0.35,
  alienBlast: 1.1,
  // People standing next to a car going up go with it (fuelFire/chain.js).
  carKillRadius: 3.5,
  score: { open: 300, car: 60, alien: 0 },
  columnHeight: 46,
  colour: 0x9d6bff,
  bannerSeconds: 3.2
};

const COLUMN_VERTEX = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const COLUMN_FRAGMENT = /* glsl */`
  uniform float uTime;
  uniform float uOpacity;
  uniform float uDir;
  uniform float uFlash;
  varying vec2 vUv;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    // Thin streaks of light running up the wall (down, in the slam).
    float column = floor(vUv.x * 140.0);
    float across = fract(vUv.x * 140.0);
    float thin = smoothstep(0.3, 0.5, across) * (1.0 - smoothstep(0.5, 0.7, across));
    float speed = 0.5 + hash(column) * 0.7;
    float streak = fract(vUv.y * 3.0 - uDir * uTime * speed + hash(column + 7.0));
    float light = smoothstep(0.8, 1.0, streak) * thin * step(0.45, hash(column + 3.0));
    float fade = (1.0 - smoothstep(0.35, 1.0, vUv.y)) * smoothstep(0.0, 0.04, vUv.y);
    float a = (0.05 + 0.45 * light) * fade * uOpacity;
    vec3 colour = mix(vec3(0.55, 0.35, 1.0), vec3(1.0), uFlash);
    gl_FragColor = vec4(colour, a);
  }
`;

/**
 * @param {Object} ctx
 * @returns {{
 *   initGravityRift: () => void,
 *   updateGravityRift: (dt: number) => void,
 *   triggerGravityRift: () => void,
 *   resetGravityRift: () => void,
 *   disposeGravityRift: () => void,
 *   gravityRiftZone: () => null|{x: number, z: number, radius: number, phase: string}
 * }}
 */
export function createGravityRiftSystem(ctx) {
  const { Sim, container } = ctx;

  const state = {
    /** @type {'idle'|'warning'|'rise'|'hang'|'drop'|'fading'} */
    phase: 'idle',
    age: 0,
    time: 0,
    x: 0,
    z: 0,
    bannerTimer: 0,
    /** @type {Map<Object, {height: number}>} physics objects held up */
    lifted: new Map(),
    /** @type {Map<Object, {height: number, y: number, vy: number, kind: Object}>} */
    aliens: new Map(),
    counts: { car: 0, person: 0, debris: 0, alien: 0 }
  };

  /** @type {THREE.Mesh|null} */
  let column = null;
  /** @type {THREE.Mesh|null} */
  let ring = null;
  /** @type {HTMLDivElement|null} */
  let banner = null;
  const scratch = new THREE.Vector3();

  /** @returns {void} */
  function initGravityRift() {
    const scene = Sim.three.scene;
    const columnGeo = new THREE.CylinderGeometry(RIFT.radius, RIFT.radius, RIFT.columnHeight, 64, 1, true);
    columnGeo.translate(0, RIFT.columnHeight / 2, 0);
    column = new THREE.Mesh(columnGeo, new THREE.ShaderMaterial({
      vertexShader: COLUMN_VERTEX,
      fragmentShader: COLUMN_FRAGMENT,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uDir: { value: 1 }, uFlash: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    }));
    column.name = 'gravityRift_column';
    column.visible = false;
    column.renderOrder = 3;
    scene.add(column);

    const ringGeo = new THREE.RingGeometry(RIFT.radius - 1.4, RIFT.radius, 96);
    ringGeo.rotateX(-Math.PI / 2);
    ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: RIFT.colour,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    }));
    ring.name = 'gravityRift_ring';
    ring.position.y = 0.15;
    ring.visible = false;
    ring.renderOrder = 2;
    scene.add(ring);

    banner = document.createElement('div');
    banner.className = 'downburst-banner';
    banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
    bannerHost(container).appendChild(banner);

    const button = document.getElementById('btn-gravity-rift');
    if (button) button.addEventListener('click', () => triggerGravityRift(), { signal: ctx.signal });
  }

  /**
   * @param {string} title
   * @param {string} sub
   * @param {boolean} [alert]
   * @returns {void}
   */
  function showBanner(title, sub, alert = false) {
    if (!banner) return;
    /** @type {HTMLElement} */ (banner.querySelector('.title')).textContent = title;
    /** @type {HTMLElement} */ (banner.querySelector('.sub')).textContent = sub;
    banner.classList.toggle('alert', alert);
    banner.classList.add('visible');
    state.bannerTimer = RIFT.bannerSeconds;
  }

  /**
   * @param {boolean} on
   * @returns {void}
   */
  function setButtonActive(on) {
    const button = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-gravity-rift'));
    if (!button) return;
    button.classList.toggle('active', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.disabled = on;
  }

  /**
   * @param {ReadonlyArray<number>} range
   * @returns {number}
   */
  function between(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  /**
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  function inside(x, z) {
    const dx = x - state.x;
    const dz = z - state.z;
    return dx * dx + dz * dz < RIFT.radius * RIFT.radius;
  }

  /**
   * Opens one under what the camera is looking at. Ignored while one is
   * already open.
   * @returns {void}
   */
  function triggerGravityRift() {
    if (state.phase !== 'idle') return;
    const target = Sim.three.controls ? Sim.three.controls.target : scratch.set(0, 0, 0);
    let x = target.x;
    let z = target.z;
    const r = Math.hypot(x, z);
    if (r > RIFT.reach) {
      x *= RIFT.reach / r;
      z *= RIFT.reach / r;
    }
    Object.assign(state, { phase: 'warning', age: 0, x, z });
    state.counts = { car: 0, person: 0, debris: 0, alien: 0 };
    if (column) column.position.set(x, 0, z);
    if (ring) ring.position.set(x, 0.15, z);
    showBanner('⚠ GRAVITY RIFT', 'Gravity is letting go · get out of the circle', true);
    setButtonActive(true);
  }

  /**
   * @param {Object} obj a Sim.objects entry
   * @returns {'car'|'person'|'debris'|null} what the rift may lift it as
   */
  function liftableAs(obj) {
    if (obj.playerControlled) return null;
    if (obj.type === 'car') {
      return obj.mesh && obj.mesh.parent && !obj.mesh.userData.heroDriving ? 'car' : null;
    }
    if (obj.type === 'person') {
      return obj.mesh && obj.mesh.parent && !obj.abducted && !obj.statue && !obj.heroName ? 'person' : null;
    }
    if (obj.pooled) return 'debris';
    return null;
  }

  /**
   * Takes hold of everything inside that is not held yet, up to the caps.
   * @returns {void}
   */
  function gather() {
    for (const obj of Sim.objects) {
      if (state.lifted.has(obj)) continue;
      if (obj.captureState === 'orbiting' || obj.captureState === 'rising') continue;
      const as = liftableAs(obj);
      if (!as || state.counts[as] >= RIFT.caps[as]) continue;
      const pos = obj.pooled ? obj.position : obj.mesh.position;
      if (!inside(pos.x, pos.z)) continue;
      state.counts[as]++;
      state.lifted.set(obj, { height: between(RIFT.height) });
      obj.rooted = false;
      if (as === 'car') {
        obj.mesh.userData.parked = false;
        obj.angularVelocity.set((Math.random() - 0.5) * RIFT.spin, (Math.random() - 0.5) * RIFT.spin, (Math.random() - 0.5) * RIFT.spin);
      } else if (as === 'person' && obj.motion && obj.motion.active) {
        obj.motion.active = false;
        obj.motion.dropped = true;
        ctx.systems.speechBubbles.exclaim(obj);
      }
    }
    const enemies = ctx.systems.enemies;
    for (const kind of enemies.kinds()) {
      if (kind.kind !== 'alien') continue;
      for (const alien of kind.list()) {
        if (state.aliens.has(alien) || state.counts.alien >= RIFT.caps.alien) continue;
        const p = kind.position(alien);
        if (!inside(p.x, p.z)) continue;
        state.counts.alien++;
        state.aliens.set(alien, { height: between(RIFT.height), y: alien.root.position.y, vy: 0, kind });
      }
    }
  }

  /**
   * Holds everything lifted up against gravity, drifting to its height.
   * @param {number} dt
   * @returns {void}
   */
  function float(dt) {
    const g = 9.8 * ctx.systems.physics.gravity.scale;
    const damp = Math.max(0, 1 - RIFT.hold * dt);
    for (const [obj, entry] of state.lifted) {
      if (!alive(obj)) {
        state.lifted.delete(obj);
        continue;
      }
      const pos = obj.pooled ? obj.position : obj.mesh.position;
      const want = THREE.MathUtils.clamp((entry.height - pos.y) * RIFT.spring, -RIFT.riseSpeed, RIFT.riseSpeed);
      // Back the gravity physics.js takes off this frame, then ease to `want`.
      obj.velocity.y += (want - obj.velocity.y) * Math.min(1, dt * 3) + g * dt;
      obj.velocity.x *= damp;
      obj.velocity.z *= damp;
      if (obj.type === 'person') obj.captureState = 'falling';
    }
    const enemies = ctx.systems.enemies;
    for (const [alien, a] of state.aliens) {
      if (!alienHeld(alien)) {
        state.aliens.delete(alien);
        continue;
      }
      enemies.setState(alien, 'frozen', 0.25);
      a.y += (a.height - a.y) * Math.min(1, dt * 0.6);
      alien.root.position.y = a.y;
      alien.root.rotation.y += dt * 0.8;
    }
  }

  /**
   * @param {Object} obj
   * @returns {boolean} whether it is still in play
   */
  function alive(obj) {
    // A recycled slot holds a new object (debris.js spawnDebris).
    if (obj.pooled) return ctx.systems.debris.DebrisPool.slots[obj.kind][obj.poolIndex] === obj;
    return !!(obj.mesh && obj.mesh.parent);
  }

  /**
   * @param {Object} alien
   * @returns {boolean} still standing (not killed by something else mid-air)
   */
  function alienHeld(alien) {
    if (alien.phase === 'patrol' || alien.phase === 'escort') return true;
    alien.root.position.y = 0;
    return false;
  }

  /** @returns {void} */
  function slam() {
    state.phase = 'drop';
    state.age = 0;
    for (const [obj] of state.lifted) obj.velocity.y = -RIFT.dropSpeed;
    for (const [, a] of state.aliens) a.vy = -RIFT.dropSpeed;
    scratch.set(state.x, 1, state.z);
    if (ctx.systems.downburstSound) ctx.systems.downburstSound.playSlam();
    if (ctx.systems.gamefeel) ctx.systems.gamefeel.event('downburst', scratch);
    showBanner('GRAVITY RETURNS!', 'Everything that went up is coming down', true);
  }

  /**
   * One car going up where it landed: the fuel-station chain's look
   * (fuelFire/chain.js explode), without setting off its neighbours.
   * @param {Object} car
   * @returns {void}
   */
  function blowCar(car) {
    const p = car.mesh.position;
    scratch.set(p.x, p.y + 1.2, p.z);
    ctx.systems.explosions.spawnImpactBurst(scratch, RIFT.carBlast);
    ctx.systems.gamefeel.event('gas', scratch);
    car.velocity.set((Math.random() - 0.5) * 6, 7 + Math.random() * 5, (Math.random() - 0.5) * 6);
    car.angularVelocity.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6);
    if (car.damageState === 'intact') {
      car.damageState = 'tipped';
      Sim.stats.vehiclesOverturned++;
    }
    car.mesh.traverse((/** @type {any} */ o) => {
      if (o.userData && o.userData.carPart === 'body' && o.material && o.material.color) {
        o.material.color.multiplyScalar(0.12);
      }
    });
    /** @type {Object[]} */
    const caught = [];
    ctx.systems.area.forEachInRadius({ x: p.x, z: p.z, radius: RIFT.carKillRadius, targets: ['person'] },
      (/** @type {any} */ hit) => caught.push(hit.target));
    for (const person of caught) if (person.mesh.parent) ctx.systems.people.explodePerson(person);
    ctx.systems.damage.addDamageScore(RIFT.score.car);
    ctx.events.emit('explosion', { x: p.x, z: p.z, size: BLAST_SIZE.car, source: car });
  }

  /**
   * Whatever it was, going up where it landed.
   * @param {Object} obj
   * @returns {void}
   */
  function blowUp(obj) {
    if (!alive(obj)) return;
    if (obj.type === 'car') blowCar(obj);
    else if (obj.type === 'person') {
      ctx.systems.people.explodePerson(obj);
      ctx.systems.gamefeel.event('person', obj.mesh.position);
    } else if (obj.pooled && Math.random() < RIFT.debrisBurstChance) {
      ctx.systems.explosions.spawnImpactBurst(scratch.copy(obj.position), RIFT.debrisBlast);
    }
  }

  /**
   * @param {Object} alien
   * @param {{kind: Object}} a
   * @returns {void}
   */
  function blowAlien(alien, a) {
    alien.root.position.y = 0;
    const p = alien.root.position;
    scratch.set(p.x, 1, p.z);
    ctx.systems.explosions.spawnImpactBurst(scratch, RIFT.alienBlast);
    if (alien.phase === 'patrol' || alien.phase === 'escort') {
      a.kind.defeat(alien, { type: 'gravity', at: { x: p.x, y: 1, z: p.z } });
    }
  }

  /**
   * The slam: everything down, and up in flames on contact.
   * @param {number} dt
   * @returns {void}
   */
  function fall(dt) {
    const g = 9.8 * ctx.systems.physics.gravity.scale;
    const late = state.age > RIFT.dropMaxSeconds;
    /** @type {Object[]} */
    const landed = [];
    for (const [obj] of state.lifted) {
      if (!alive(obj)) {
        state.lifted.delete(obj);
        continue;
      }
      const pos = obj.pooled ? obj.position : obj.mesh.position;
      const floor = obj.pooled ? 0 : (obj.groundFloor || 0);
      if (late || pos.y <= floor + 0.4) landed.push(obj);
      // Held at the slam's speed: physics.js would otherwise let it slow.
      else if (obj.velocity.y > -RIFT.dropSpeed) obj.velocity.y = -RIFT.dropSpeed + g * dt;
    }
    // After the loop: a death splices Sim.objects.
    for (const obj of landed) {
      state.lifted.delete(obj);
      blowUp(obj);
    }
    const enemies = ctx.systems.enemies;
    for (const [alien, a] of state.aliens) {
      if (!alienHeld(alien)) {
        state.aliens.delete(alien);
        continue;
      }
      a.y += a.vy * dt;
      if (a.y > 0 && !late) {
        enemies.setState(alien, 'frozen', 0.2);
        alien.root.position.y = a.y;
        continue;
      }
      state.aliens.delete(alien);
      blowAlien(alien, a);
    }
    if (!state.lifted.size && !state.aliens.size) {
      state.phase = 'fading';
      state.age = 0;
    }
  }

  /**
   * @param {number} dt world time
   * @returns {void}
   */
  function updateGravityRift(dt) {
    if (banner && state.bannerTimer > 0) {
      state.bannerTimer -= dt;
      if (state.bannerTimer <= 0) banner.classList.remove('visible');
    }
    if (state.phase === 'idle') return;
    state.age += dt;
    state.time += dt;

    if (state.phase === 'warning') {
      if (state.age >= RIFT.warningSeconds) {
        state.phase = 'rise';
        state.age = 0;
        ctx.systems.damage.addDamageScore(RIFT.score.open);
        showBanner('GRAVITY RIFT!', 'Everything inside is floating up');
      }
    } else if (state.phase === 'rise') {
      gather();
      float(dt);
      if (state.age >= RIFT.riseSeconds) {
        state.phase = 'hang';
        state.age = 0;
      }
    } else if (state.phase === 'hang') {
      float(dt);
      if (state.age >= RIFT.hangSeconds) slam();
    } else if (state.phase === 'drop') {
      fall(dt);
    } else if (state.phase === 'fading' && state.age >= RIFT.fadeSeconds) {
      state.phase = 'idle';
      setButtonActive(false);
    }
    updateVisuals();
  }

  /** @returns {void} */
  function updateVisuals() {
    if (!column || !ring) return;
    const phase = state.phase;
    const on = phase !== 'idle';
    column.visible = on && phase !== 'warning';
    ring.visible = on;
    if (!on) return;
    const u = /** @type {THREE.ShaderMaterial} */ (column.material).uniforms;
    const ringMat = /** @type {THREE.MeshBasicMaterial} */ (ring.material);
    u.uTime.value = state.time;
    if (phase === 'warning') {
      ringMat.opacity = 0.35 + 0.35 * Math.sin(state.time * 10);
    } else if (phase === 'rise') {
      u.uDir.value = 1;
      u.uFlash.value = 0;
      u.uOpacity.value = Math.min(1, state.age / 1.2);
      ringMat.opacity = 0.75;
    } else if (phase === 'hang') {
      u.uOpacity.value = 0.7 + 0.3 * Math.sin(state.time * 30);
      ringMat.opacity = 0.9;
    } else if (phase === 'drop') {
      // Streaks reversed and flashed white for the slam.
      u.uDir.value = -6;
      u.uFlash.value = Math.max(0, 1 - state.age * 2.5);
      u.uOpacity.value = 1;
      ringMat.opacity = 1;
    } else {
      const f = Math.max(0, 1 - state.age / RIFT.fadeSeconds);
      u.uOpacity.value = f;
      u.uFlash.value = 0;
      ringMat.opacity = 0.8 * f;
    }
  }

  /** @returns {void} */
  function resetGravityRift() {
    // The town is rebuilt by resetEnvironment; the aliens are put back down
    // in case this runs without one.
    for (const [alien] of state.aliens) if (alien.root) alien.root.position.y = 0;
    state.aliens.clear();
    state.lifted.clear();
    state.phase = 'idle';
    state.age = 0;
    state.bannerTimer = 0;
    if (column) column.visible = false;
    if (ring) ring.visible = false;
    if (banner) banner.classList.remove('visible');
    setButtonActive(false);
  }

  /** @returns {void} */
  function disposeGravityRift() {
    const scene = Sim.three.scene;
    for (const mesh of [column, ring]) {
      if (!mesh) continue;
      scene.remove(mesh);
      mesh.geometry.dispose();
      /** @type {THREE.Material} */ (mesh.material).dispose();
    }
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    column = null;
    ring = null;
    banner = null;
  }

  /**
   * For the minimap and tests: the circle, while there is one.
   * @returns {null|{x: number, z: number, radius: number, phase: string}}
   */
  function gravityRiftZone() {
    if (state.phase === 'idle') return null;
    return { x: state.x, z: state.z, radius: RIFT.radius, phase: state.phase };
  }

  return {
    initGravityRift, updateGravityRift, triggerGravityRift, resetGravityRift, disposeGravityRift, gravityRiftZone
  };
}
