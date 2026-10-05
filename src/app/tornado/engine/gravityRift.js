// @ts-check
import * as THREE from 'three';
import { bannerHost } from '../utils/banners.js';

/**
 * ===========================================================================
 * SECTION GR — Gravity Rift
 * ===========================================================================
 * Opened by Roger's Gravitron (heroWeapons.js), aimed like the Black Hole
 * Gun: a ring on the ground shows the circle and the trigger opens it
 * there (`openAt`), one at a time. Inside the circle gravity lets go of
 * everything (on request, 2026-10-05: it used to miss some people and
 * aliens, and left most of the town alone): people, cars, trees, loose
 * debris, the street clutter (bicycles, benches, bins, hydrants, signs,
 * mailboxes), every enemy in the register -- the alien crew, Terminators,
 * the machines, HAVOC, Hank, Patient Zero and his clones, the T-Rex, the
 * Yeti -- and the alien ships, the landing ship and the hunters. They float
 * up, turning slowly, to between 10 and 24 m (the enemies higher, the ships
 * far higher). Then it comes back all at once: everything is slammed down.
 *
 * Only the living go up in it (on request): a person bursts where they
 * land, and every enemy is killed through its own kill path (enemies.js
 * `defeat`), with a blast; a ship is downed and falls burning. Cars, trees,
 * debris and the clutter just crash down where they land and stay there.
 *
 * Phases:
 *  - 'warning': the ring on the ground pulses, the vortex on the ground
 *               starts to turn, the banner warns;
 *  - 'rise':    everything inside floats up (new arrivals too, up to the
 *               caps below) to its own height, each in a violet glow, with
 *               a storm of grit and stones drifting up the column;
 *  - 'hang':    a moment of weightless stillness, the column flickering;
 *  - 'drop':    the slam, with a shock ring running out over the ground.
 *               Whatever has not landed after dropMaxSeconds lands where it is;
 *  - 'fading':  the column and ring fade out.
 *
 * The lift of physics objects works through the ordinary physics
 * (physics.js): each frame a lifted object gets back the gravity physics is
 * about to take off it, plus a spring towards its height, so a tornado, a
 * blast or a wall still act on it as usual. Enemies and ships are not
 * physics objects: they are held 'frozen' in the enemy register (their
 * owner skips them) and their `position` lifted here, as the grappling hook does
 * (player/grapple.js). The street clutter is instanced: its instances are
 * moved here and put back by a reset. Roger, the car he is driving,
 * buildings and the samurai (on Roger's side) are left alone.
 */

export const RIFT = {
  // Energy segments a shot (10% each): the Gravitron's price.
  cost: 4,
  warningSeconds: 2.2,
  riseSeconds: 6,
  hangSeconds: 1.4,
  // The slam: straight down at this, and anything still up after the
  // window lands where it is.
  dropSpeed: 34,
  dropMaxSeconds: 3.5,
  fadeSeconds: 1.6,
  radius: 40,
  height: [10, 24],
  // Enemies go higher, and the ships higher than they hang.
  enemyHeight: [18, 30],
  shipRise: 22,
  // Metres a second at most while rising, and how hard it pulls to its height.
  riseSpeed: 5,
  spring: 0.9,
  // Horizontal drift damping while weightless (per second).
  hold: 1.6,
  spin: 0.9,
  caps: { car: 40, person: 140, debris: 90, tree: 40, alien: 60, enemy: 16, clutter: 70 },
  personBlast: 0.9,
  alienBlast: 1.1,
  enemyBlast: 2.2,
  score: { open: 300 },
  columnHeight: 46,
  colour: 0x9d6bff,
  bannerSeconds: 3.2,
  // The look: stones drifting up the column, the glow round each thing held.
  motes: 180,
  auras: 96
};

/** Street clutter it takes (environment/roadsDecor.js); not the lamp posts or the fences. */
const CLUTTER = ['bicycle', 'bench', 'mailbox', 'trashCan', 'hydrant', 'sign'];
/** Registry kinds it leaves alone: on Roger's side, or handled above. */
const SKIP_KINDS = new Set(['samurai', 'alien']);

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

const VORTEX_FRAGMENT = /* glsl */`
  uniform float uTime;
  uniform float uOpacity;
  uniform float uFlash;
  varying vec2 vUv;
  void main() {
    // A spiral turning on the ground: arms winding in to a bright eye.
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float a = atan(p.y, p.x);
    float arms = sin(a * 5.0 + log(r + 0.02) * 9.0 - uTime * 3.2);
    float spiral = smoothstep(0.55, 1.0, arms) * (1.0 - smoothstep(0.75, 1.0, r));
    float eye = 1.0 - smoothstep(0.0, 0.32, r);
    float rim = smoothstep(0.9, 0.98, r) * (1.0 - smoothstep(0.98, 1.0, r));
    float a1 = (spiral * 0.45 + eye * 0.5 + rim * 0.6) * uOpacity;
    vec3 colour = mix(vec3(0.45, 0.25, 1.0), vec3(1.0, 0.85, 1.0), eye * 0.6 + uFlash);
    gl_FragColor = vec4(colour, a1);
  }
`;

/**
 * @param {Object} ctx
 * @returns {{
 *   initGravityRift: () => void,
 *   updateGravityRift: (dt: number) => void,
 *   openAt: (x: number, z: number) => boolean,
 *   isOpen: () => boolean,
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
    /** @type {Map<Object, {height: number, as: string}>} physics objects held up */
    lifted: new Map(),
    /** @type {Map<Object, {height: number, y: number, vy: number, kind: Object}>} the alien crew */
    aliens: new Map(),
    /** @type {Map<Object, {height: number, y: number, vy: number, base: number, kind: Object, pos: THREE.Vector3, ship: boolean}>} every other enemy, and the ships */
    enemies: new Map(),
    /** @type {{mesh: THREE.InstancedMesh, i: number, p: THREE.Vector3, q: THREE.Quaternion, s: THREE.Vector3, rest: number, height: number, y: number, vy: number, spin: THREE.Vector3, landed: boolean}[]} */
    clutter: [],
    /** @type {{held: boolean, y: number, vy: number, base: number, height: number}|null} the landing ship, while held */
    ufo: null,
    counts: { car: 0, person: 0, debris: 0, tree: 0, alien: 0, enemy: 0, clutter: 0 },
    shock: -1
  };
  /**
   * Every clutter instance moved this run, with the matrix it had, for the
   * reset to put back.
   * @type {Map<THREE.InstancedMesh, Map<number, THREE.Matrix4>>}
   */
  const moved = new Map();

  /** @type {THREE.Mesh|null} */
  let column = null;
  /** @type {THREE.Mesh|null} */
  let ring = null;
  /** @type {THREE.Mesh|null} */
  let vortex = null;
  /** @type {THREE.Mesh|null} */
  let shock = null;
  /** @type {THREE.InstancedMesh|null} */
  let motes = null;
  /** @type {THREE.InstancedMesh|null} */
  let auras = null;
  /** @type {{x: number, y: number, z: number, vy: number, spin: number, size: number}[]} */
  let moteState = [];
  /** @type {HTMLDivElement|null} */
  let banner = null;
  const scratch = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const q4 = new THREE.Quaternion();
  const e3 = new THREE.Euler();
  const s3 = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);

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
    const flat = {
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    };
    ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: RIFT.colour, opacity: 0, ...flat }));
    ring.name = 'gravityRift_ring';
    ring.position.y = 0.15;
    ring.visible = false;
    ring.renderOrder = 2;
    scene.add(ring);

    // The vortex turning on the ground inside the ring.
    const discGeo = new THREE.PlaneGeometry(RIFT.radius * 2, RIFT.radius * 2);
    discGeo.rotateX(-Math.PI / 2);
    vortex = new THREE.Mesh(discGeo, new THREE.ShaderMaterial({
      vertexShader: COLUMN_VERTEX,
      fragmentShader: VORTEX_FRAGMENT,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uFlash: { value: 0 } },
      ...flat
    }));
    vortex.name = 'gravityRift_vortex';
    vortex.position.y = 0.12;
    vortex.visible = false;
    vortex.renderOrder = 2;
    scene.add(vortex);

    // The slam's shock ring, running out over the ground.
    const shockGeo = new THREE.RingGeometry(0.86, 1, 96);
    shockGeo.rotateX(-Math.PI / 2);
    shock = new THREE.Mesh(shockGeo, new THREE.MeshBasicMaterial({ color: 0xe6d8ff, opacity: 0, ...flat }));
    shock.name = 'gravityRift_shock';
    shock.position.y = 0.2;
    shock.visible = false;
    scene.add(shock);

    // Grit and stones drifting up the column (one draw call).
    const moteGeo = new THREE.IcosahedronGeometry(0.28, 0);
    motes = new THREE.InstancedMesh(moteGeo, new THREE.MeshStandardMaterial({
      color: 0x4a4458, roughness: 0.9, flatShading: true, emissive: new THREE.Color(0.35, 0.18, 0.75), emissiveIntensity: 0.8
    }), RIFT.motes);
    motes.name = 'gravityRift_motes';
    motes.frustumCulled = false;
    motes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    motes.visible = false;
    scene.add(motes);
    moteState = [];
    for (let i = 0; i < RIFT.motes; i++) moteState.push({ x: 0, y: 0, z: 0, vy: 0, spin: 0, size: 1 });

    // A violet glow round each thing held (one draw call).
    const auraGeo = new THREE.SphereGeometry(1, 16, 10);
    auras = new THREE.InstancedMesh(auraGeo, new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.55, 0.3, 1.1), transparent: true, opacity: 0.26, depthWrite: false, blending: THREE.AdditiveBlending
    }), RIFT.auras);
    auras.name = 'gravityRift_auras';
    auras.frustumCulled = false;
    auras.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    auras.visible = false;
    scene.add(auras);

    banner = document.createElement('div');
    banner.className = 'downburst-banner';
    banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
    bannerHost(container).appendChild(banner);
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
   * Opens one at (x, z): the Gravitron's shot. Refused while one is open.
   * @param {number} x
   * @param {number} z
   * @returns {boolean} whether it opened
   */
  function openAt(x, z) {
    if (state.phase !== 'idle') return false;
    Object.assign(state, { phase: 'warning', age: 0, x, z, shock: -1 });
    state.counts = { car: 0, person: 0, debris: 0, tree: 0, alien: 0, enemy: 0, clutter: 0 };
    if (column) column.position.set(x, 0, z);
    if (ring) ring.position.set(x, 0.15, z);
    if (vortex) vortex.position.set(x, 0.12, z);
    if (shock) shock.position.set(x, 0.2, z);
    for (const m of moteState) seedMote(m, true);
    showBanner('⚠ GRAVITY RIFT', 'Gravity is letting go · get out of the circle', true);
    return true;
  }

  /**
   * A stone somewhere in the circle, on the ground (or anywhere up the
   * column, at the start, so it does not open with them all in a layer).
   * @param {{x: number, y: number, z: number, vy: number, spin: number, size: number}} m
   * @param {boolean} anywhere
   * @returns {void}
   */
  function seedMote(m, anywhere) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * RIFT.radius * 0.97;
    m.x = state.x + Math.cos(a) * r;
    m.z = state.z + Math.sin(a) * r;
    m.y = anywhere ? Math.random() * 6 : 0;
    m.vy = 1.5 + Math.random() * 4;
    m.spin = Math.random() * 6;
    m.size = 0.5 + Math.random() * 1.6;
  }

  /**
   * @param {Object} obj a Sim.objects entry
   * @returns {'car'|'person'|'debris'|'tree'|null} what the rift may lift it as
   */
  function liftableAs(obj) {
    if (obj.playerControlled) return null;
    if (obj.type === 'car') {
      return obj.mesh && obj.mesh.parent && !obj.mesh.userData.heroDriving ? 'car' : null;
    }
    if (obj.type === 'person') {
      return obj.mesh && obj.mesh.parent && !obj.abducted && !obj.statue && !obj.heroName ? 'person' : null;
    }
    if (obj.type === 'tree') {
      return obj.mesh && obj.mesh.parent && obj.damageState !== 'flattened' ? 'tree' : null;
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
      const as = liftableAs(obj);
      if (!as || state.counts[as] >= RIFT.caps[as]) continue;
      const pos = obj.pooled ? obj.position : obj.mesh.position;
      if (!inside(pos.x, pos.z)) continue;
      // Taken out of a funnel's hands too: the rift has it now.
      if (obj.captureState === 'orbiting' || obj.captureState === 'rising') obj.captureState = 'falling';
      state.counts[as]++;
      state.lifted.set(obj, { height: between(RIFT.height), as });
      obj.rooted = false;
      if (as === 'car') {
        obj.mesh.userData.parked = false;
        obj.angularVelocity.set((Math.random() - 0.5) * RIFT.spin, (Math.random() - 0.5) * RIFT.spin, (Math.random() - 0.5) * RIFT.spin);
      } else if (as === 'tree') {
        // Torn out by the roots, as a funnel does (damage/trees.js uprootTree).
        obj.damageState = 'uprooted';
        obj.liftEligible = 0.85;
        obj.drag = 0.6;
        obj.angularVelocity.set((Math.random() - 0.5) * RIFT.spin, (Math.random() - 0.5) * RIFT.spin, (Math.random() - 0.5) * RIFT.spin);
      } else if (as === 'person' && obj.motion) {
        obj.motion.active = false;
        obj.motion.dropped = true;
        ctx.systems.speechBubbles.exclaim(obj);
      }
    }
    const enemies = ctx.systems.enemies;
    for (const kind of enemies.kinds()) {
      if (kind.kind === 'alien') {
        for (const alien of kind.list()) {
          if (state.aliens.has(alien) || state.counts.alien >= RIFT.caps.alien) continue;
          const p = kind.position(alien);
          if (!inside(p.x, p.z)) continue;
          state.counts.alien++;
          state.aliens.set(alien, { height: between(RIFT.enemyHeight), y: alien.root.position.y, vy: 0, kind });
        }
        continue;
      }
      if (SKIP_KINDS.has(kind.kind)) continue;
      for (const e of kind.list()) {
        if (state.enemies.has(e) || state.counts.enemy >= RIFT.caps.enemy) continue;
        if (enemies.getState(e, 'disintegrated') || enemies.getState(e, 'absorbed')) continue;
        // The owner's own position: Patient Zero draws his figure from it.
        const pos = kind.position(e);
        if (!pos || !inside(pos.x, pos.z)) continue;
        const ship = kind.kind === 'hunterShip';
        state.counts.enemy++;
        state.enemies.set(e, {
          height: ship ? pos.y + RIFT.shipRise : between(RIFT.enemyHeight), y: pos.y, vy: 0, base: pos.y, kind, pos, ship
        });
      }
    }
    // The landing ship, while it hangs over town or hunts.
    const aliens = ctx.systems.aliens;
    if (!state.ufo && aliens && aliens.riftShip) {
      const g = aliens.riftShip(state.x, state.z, RIFT.radius);
      if (g) state.ufo = { held: true, y: g.position.y, vy: 0, base: g.position.y, height: g.position.y + RIFT.shipRise };
    }
    gatherClutter();
  }

  /**
   * The street clutter inside: bicycles, benches, bins, hydrants, signs and
   * mailboxes (instances of environment/roadsDecor.js's meshes).
   * @returns {void}
   */
  function gatherClutter() {
    const decor = ctx.Environment && ctx.Environment.decorMeshes;
    if (!decor) return;
    for (const name of CLUTTER) {
      const mesh = decor[name];
      if (!mesh) continue;
      let done = moved.get(mesh);
      for (let i = 0; i < mesh.count; i++) {
        if (state.counts.clutter >= RIFT.caps.clutter) return;
        if (state.clutter.some((c) => c.mesh === mesh && c.i === i)) continue;
        mesh.getMatrixAt(i, m4);
        s3.setFromMatrixPosition(m4);
        if (!inside(s3.x, s3.z)) continue;
        if (!done) {
          done = new Map();
          moved.set(mesh, done);
        }
        if (!done.has(i)) done.set(i, m4.clone());
        const p = new THREE.Vector3();
        const q = new THREE.Quaternion();
        const s = new THREE.Vector3();
        m4.decompose(p, q, s);
        state.counts.clutter++;
        state.clutter.push({
          mesh, i, p, q, s, rest: p.y, height: between(RIFT.height), y: p.y, vy: 0, landed: false,
          spin: new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2)
        });
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
      alien.root.rotation.x = Math.sin(state.time * 1.3 + a.height) * 0.5;
    }
    for (const [e, h] of state.enemies) {
      if (!enemyHeld(e, h)) {
        state.enemies.delete(e);
        continue;
      }
      enemies.setState(e, 'frozen', 0.25);
      h.y += (h.height - h.y) * Math.min(1, dt * (h.ship ? 0.4 : 0.5));
      h.pos.y = h.y;
      const obj = h.kind.object ? h.kind.object(e) : null;
      if (obj && !h.ship) obj.rotation.z = Math.sin(state.time * 1.1 + h.height) * 0.35;
    }
    if (state.ufo) {
      const g2 = ctx.systems.aliens.riftHold(0.25);
      if (!g2) state.ufo = null;
      else {
        state.ufo.y += (state.ufo.height - state.ufo.y) * Math.min(1, dt * 0.35);
        g2.position.y = state.ufo.y;
      }
    }
    for (const c of state.clutter) {
      c.y += (c.height - c.y) * Math.min(1, dt * 0.7);
      e3.set(c.spin.x * state.time, c.spin.y * state.time, c.spin.z * state.time);
      placeClutter(c, q4.setFromEuler(e3).premultiply(c.q));
    }
  }

  /**
   * @param {{mesh: THREE.InstancedMesh, i: number, p: THREE.Vector3, s: THREE.Vector3, y: number}} c
   * @param {THREE.Quaternion} q
   * @returns {void}
   */
  function placeClutter(c, q) {
    s3.set(c.p.x, c.y, c.p.z);
    m4.compose(s3, q, c.s);
    c.mesh.setMatrixAt(c.i, m4);
    c.mesh.instanceMatrix.needsUpdate = true;
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
    if (alien.phase === 'exiting') alien.phase = 'patrol';
    if (alien.phase === 'patrol' || alien.phase === 'escort') return true;
    alien.root.position.y = 0;
    alien.root.rotation.x = 0;
    return false;
  }

  /**
   * @param {Object} e
   * @param {{kind: Object, pos: THREE.Vector3, base: number, ship: boolean}} h
   * @returns {boolean} still in its owner's list (not killed or taken by something else)
   */
  function enemyHeld(e, h) {
    if (h.kind.list().includes(e) && !ctx.systems.enemies.getState(e, 'disintegrated')) return true;
    if (!h.ship) h.pos.y = h.base;
    return false;
  }

  /** @returns {void} */
  function slam() {
    state.phase = 'drop';
    state.age = 0;
    state.shock = 0;
    for (const [obj] of state.lifted) obj.velocity.y = -RIFT.dropSpeed;
    for (const [, a] of state.aliens) a.vy = -RIFT.dropSpeed;
    for (const [e, h] of state.enemies) {
      h.vy = -RIFT.dropSpeed;
      // A ship is downed where it hangs and falls burning on its own.
      if (h.ship) {
        state.enemies.delete(e);
        if (h.kind.defeat) h.kind.defeat(e, { type: 'gravity', at: { x: h.pos.x, y: h.pos.y, z: h.pos.z } });
      }
    }
    if (state.ufo) {
      ctx.systems.aliens.riftDown();
      state.ufo = null;
    }
    for (const c of state.clutter) c.vy = -RIFT.dropSpeed;
    scratch.set(state.x, 1, state.z);
    if (ctx.systems.downburstSound) ctx.systems.downburstSound.playSlam();
    if (ctx.systems.gamefeel) ctx.systems.gamefeel.event('downburst', scratch);
    if (ctx.systems.earthquake) ctx.systems.earthquake.kickDust(state.x, state.z, RIFT.radius * 0.8, 3);
    showBanner('GRAVITY RETURNS!', 'Everything that went up is coming down', true);
  }

  /**
   * A person landing: they burst. Everything else lifted just lands.
   * @param {Object} obj
   * @returns {void}
   */
  function land(obj) {
    if (!alive(obj)) return;
    if (obj.type === 'person') {
      ctx.systems.people.explodePerson(obj);
      ctx.systems.gamefeel.event('person', obj.mesh.position);
    }
  }

  /**
   * @param {Object} alien
   * @param {{kind: Object}} a
   * @returns {void}
   */
  function blowAlien(alien, a) {
    alien.root.position.y = 0;
    alien.root.rotation.x = 0;
    const p = alien.root.position;
    scratch.set(p.x, 1, p.z);
    ctx.systems.explosions.spawnImpactBurst(scratch, RIFT.alienBlast);
    if (alien.phase === 'patrol' || alien.phase === 'escort') {
      a.kind.defeat(alien, { type: 'gravity', at: { x: p.x, y: 1, z: p.z } });
    }
  }

  /**
   * Any other enemy coming down: a blast where it lands, and killed through
   * its own kill path (its owner's `defeat`).
   * @param {Object} e
   * @param {{kind: Object, pos: THREE.Vector3, base: number}} h
   * @returns {void}
   */
  function blowEnemy(e, h) {
    h.pos.y = h.base;
    const obj = h.kind.object ? h.kind.object(e) : null;
    if (obj) obj.rotation.z = 0;
    scratch.set(h.pos.x, 1.5, h.pos.z);
    ctx.systems.explosions.spawnImpactBurst(scratch, RIFT.enemyBlast);
    ctx.systems.enemies.setState(e, 'frozen', 0);
    if (h.kind.defeat) h.kind.defeat(e, { type: 'gravity', at: { x: h.pos.x, y: 1, z: h.pos.z } });
  }

  /**
   * The slam: everything down; the living go up in flames on contact.
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
      land(obj);
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
    for (const [e, h] of state.enemies) {
      if (!enemyHeld(e, h)) {
        state.enemies.delete(e);
        continue;
      }
      h.y += h.vy * dt;
      if (h.y > h.base && !late) {
        enemies.setState(e, 'frozen', 0.2);
        h.pos.y = h.y;
        continue;
      }
      state.enemies.delete(e);
      blowEnemy(e, h);
    }
    let up = 0;
    for (const c of state.clutter) {
      if (c.landed) continue;
      c.y += c.vy * dt;
      if (c.y > c.rest && !late) {
        up++;
        e3.set(c.spin.x * state.time, c.spin.y * state.time, c.spin.z * state.time);
        placeClutter(c, q4.setFromEuler(e3).premultiply(c.q));
        continue;
      }
      // Down where it landed, knocked over on its side.
      c.landed = true;
      c.y = c.rest + 0.15;
      e3.set(Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1), Math.random() * Math.PI * 2, 0, 'YXZ');
      placeClutter(c, q4.setFromEuler(e3));
    }
    if (!state.lifted.size && !state.aliens.size && !state.enemies.size && !up) {
      state.clutter = [];
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
    }
    updateVisuals(dt);
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateVisuals(dt) {
    if (!column || !ring || !vortex || !shock || !motes || !auras) return;
    const phase = state.phase;
    const on = phase !== 'idle';
    column.visible = on && phase !== 'warning';
    ring.visible = vortex.visible = on;
    motes.visible = on && phase !== 'warning';
    auras.visible = phase === 'rise' || phase === 'hang' || phase === 'drop';
    if (!on) {
      shock.visible = false;
      return;
    }
    const u = /** @type {THREE.ShaderMaterial} */ (column.material).uniforms;
    const v = /** @type {THREE.ShaderMaterial} */ (vortex.material).uniforms;
    const ringMat = /** @type {THREE.MeshBasicMaterial} */ (ring.material);
    u.uTime.value = state.time;
    v.uTime.value = state.time * (phase === 'hang' ? 2.2 : 1);
    let lift = 0;
    if (phase === 'warning') {
      ringMat.opacity = 0.35 + 0.35 * Math.sin(state.time * 10);
      v.uOpacity.value = Math.min(0.6, state.age / RIFT.warningSeconds);
      v.uFlash.value = 0;
    } else if (phase === 'rise') {
      u.uDir.value = 1;
      u.uFlash.value = 0;
      u.uOpacity.value = Math.min(1, state.age / 1.2);
      ringMat.opacity = 0.75;
      v.uOpacity.value = 0.85;
      lift = 1;
    } else if (phase === 'hang') {
      u.uOpacity.value = 0.7 + 0.3 * Math.sin(state.time * 30);
      ringMat.opacity = 0.9;
      v.uOpacity.value = 1;
      v.uFlash.value = 0.25 + 0.25 * Math.sin(state.time * 30);
      lift = 0.15;
    } else if (phase === 'drop') {
      // Streaks reversed and flashed white for the slam.
      u.uDir.value = -6;
      u.uFlash.value = Math.max(0, 1 - state.age * 2.5);
      u.uOpacity.value = 1;
      ringMat.opacity = 1;
      v.uFlash.value = Math.max(0, 1 - state.age * 2);
      v.uOpacity.value = Math.max(0.3, 1 - state.age * 0.5);
      lift = -8;
    } else {
      const f = Math.max(0, 1 - state.age / RIFT.fadeSeconds);
      u.uOpacity.value = f;
      u.uFlash.value = 0;
      ringMat.opacity = 0.8 * f;
      v.uOpacity.value = 0.3 * f;
      v.uFlash.value = 0;
    }
    // The shock ring of the slam: out to half again the circle in 0.7 s.
    if (state.shock >= 0) {
      state.shock += dt;
      const k = state.shock / 0.7;
      if (k >= 1) {
        state.shock = -1;
        shock.visible = false;
      } else {
        shock.visible = true;
        shock.scale.setScalar(2 + k * RIFT.radius * 1.5);
        /** @type {THREE.MeshBasicMaterial} */ (shock.material).opacity = (1 - k) * 0.9;
      }
    }
    updateMotes(dt, lift);
    updateAuras();
  }

  /**
   * The stones drifting up the column (down hard in the slam).
   * @param {number} dt
   * @param {number} lift
   * @returns {void}
   */
  function updateMotes(dt, lift) {
    if (!motes || !motes.visible) return;
    const top = RIFT.columnHeight * 0.75;
    for (let i = 0; i < moteState.length; i++) {
      const m = moteState[i];
      if (lift < 0) m.y = Math.max(0, m.y + lift * 4 * dt);
      else m.y += m.vy * Math.max(lift, 0.1) * dt;
      if (m.y > top && lift > 0) seedMote(m, false);
      m.spin += dt * 2;
      const fade = state.phase === 'fading' ? Math.max(0, 1 - state.age / RIFT.fadeSeconds) : 1;
      e3.set(m.spin, m.spin * 0.7, 0);
      s3.set(m.x, m.y, m.z);
      m4.compose(s3, q4.setFromEuler(e3), scratch.setScalar(m.size * fade * (m.y > 0 || lift > 0 ? 1 : 0.6)));
      motes.setMatrixAt(i, m4);
    }
    motes.instanceMatrix.needsUpdate = true;
  }

  /**
   * A violet glow round everything held, pulsing.
   * @returns {void}
   */
  function updateAuras() {
    if (!auras || !auras.visible) return;
    let n = 0;
    const pulse = 1 + 0.12 * Math.sin(state.time * 6);
    /**
     * @param {number} x @param {number} y @param {number} z @param {number} r
     */
    const put = (x, y, z, r) => {
      if (n >= RIFT.auras) return;
      s3.set(x, y, z);
      m4.compose(s3, q4.identity(), scratch.setScalar(r * pulse));
      auras.setMatrixAt(n++, m4);
    };
    for (const [obj, entry] of state.lifted) {
      if (obj.pooled || !obj.mesh) continue;
      const p = obj.mesh.position;
      if (entry.as === 'car') put(p.x, p.y + 0.8, p.z, 3);
      else if (entry.as === 'tree') put(p.x, p.y + 3, p.z, 3.4);
      else put(p.x, p.y + 0.9, p.z, 1.3);
    }
    for (const [alien] of state.aliens) put(alien.root.position.x, alien.root.position.y + 0.8, alien.root.position.z, 1.3);
    for (const [e, h] of state.enemies) {
      const size = h.kind.size ? h.kind.size(e) : (h.kind.hitbox ? h.kind.hitbox(e).top : 3);
      put(h.pos.x, h.pos.y + size * 0.5, h.pos.z, Math.max(1.6, size * 0.6));
    }
    for (let i = n; i < RIFT.auras; i++) auras.setMatrixAt(i, zero);
    auras.instanceMatrix.needsUpdate = true;
  }

  /** @returns {void} */
  function resetGravityRift() {
    // The town is rebuilt by resetEnvironment; the aliens and the rest are
    // put back down in case this runs without one.
    for (const [alien] of state.aliens) if (alien.root) alien.root.position.y = 0;
    for (const [, h] of state.enemies) if (!h.ship) h.pos.y = h.base;
    state.aliens.clear();
    state.enemies.clear();
    state.lifted.clear();
    state.ufo = null;
    state.clutter = [];
    // The street clutter put back as it was.
    for (const [mesh, map] of moved) {
      for (const [i, matrix] of map) if (i < mesh.count) mesh.setMatrixAt(i, matrix);
      mesh.instanceMatrix.needsUpdate = true;
    }
    moved.clear();
    state.phase = 'idle';
    state.age = 0;
    state.shock = -1;
    state.bannerTimer = 0;
    for (const mesh of [column, ring, vortex, shock, motes, auras]) if (mesh) mesh.visible = false;
    if (banner) banner.classList.remove('visible');
  }

  /** @returns {void} */
  function disposeGravityRift() {
    const scene = Sim.three.scene;
    for (const mesh of [column, ring, vortex, shock, motes, auras]) {
      if (!mesh) continue;
      scene.remove(mesh);
      mesh.geometry.dispose();
      /** @type {THREE.Material} */ (mesh.material).dispose();
      if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
    }
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    column = ring = vortex = shock = null;
    motes = auras = null;
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
    initGravityRift, updateGravityRift, openAt, isOpen: () => state.phase !== 'idle', resetGravityRift, disposeGravityRift, gravityRiftZone
  };
}
