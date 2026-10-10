// @ts-check
import * as THREE from 'three';
import { soundRandom } from './sound/random.js';

/**
 * ===========================================================================
 * SECTION CW — Cows (the funnel's favourite passengers)
 * ===========================================================================
 * A fenced pasture out on the southern edge of town (COWS.pasture) with a
 * small herd grazing in it. They are ordinary physics objects (Sim.objects,
 * type 'cow'), so a funnel that comes by lifts them like anything else:
 * round and round the column, legs out, mooing all the way up -- and
 * wherever they come down, dazed but unhurt, they shake it off and go back
 * to grazing right there, in the middle of the road if need be.
 *
 * Each cow moos once as it leaves the ground (a low sawtooth pair through a
 * closing low-pass: no sound file), louder the nearer the camera. Every
 * take-off counts in Sim.stats.cowsFlown (the AIR COWBOY mission,
 * engine/missions.js).
 *
 * Cheap: COWS.count cows of six meshes each, sharing their geometry and
 * three materials; the grazing is a few multiply-adds a frame.
 */

export const COWS = {
  count: 8,
  pasture: { x: 58, z: 104, halfX: 20, halfZ: 11 },
  mass: 2.6,
  liftEligible: 0.62,       // lighter than a car to the funnel, heavier than a box
  walk: 0.6,                // m/s while grazing
  mooGain: 0.35
};

/**
 * @param {Object} ctx
 * @returns {{
 *   cows: () => SimObject[],
 *   initCows: () => void,
 *   updateCows: (dt: number) => void,
 *   resetCows: () => void,
 *   disposeCows: () => void,
 *   buildGuestModel: () => any,
 *   replicaState: () => any[],
 *   localRoots: () => THREE.Object3D[]
 * }}
 */
export function createCowSystem(ctx) {
  const { Sim } = ctx;
  /** @type {SimObject[]} */
  let herd = [];
  /** @type {THREE.Group|null} the fence */
  let fence = null;
  /** @type {Object<string, THREE.BufferGeometry>} */
  const geo = {};
  /** @type {THREE.Material[]} */
  const mats = [];

  /**
   * One cow, facing +z, feet at y = 0.
   * @param {number} i
   * @returns {THREE.Group}
   */
  function buildCow(i) {
    const [white, black, pink] = mats;
    const g = new THREE.Group();
    g.name = `cow_${i}`;
    /**
     * @param {THREE.BufferGeometry} bg
     * @param {THREE.Material} m
     * @param {number[]} p
     * @param {number[]} [s]
     * @returns {THREE.Mesh}
     */
    const add = (bg, m, p, s = [1, 1, 1]) => {
      const mesh = new THREE.Mesh(bg, m);
      mesh.position.set(p[0], p[1], p[2]);
      mesh.scale.set(s[0], s[1], s[2]);
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };
    add(geo.body, white, [0, 1.15, 0]);
    // Patches, different on every cow.
    const r = (/** @type {number} */ k) => Math.sin(i * 12.9898 + k * 78.233) * 0.5 + 0.5;
    add(geo.patch, black, [0.46, 1.2 + (r(1) - 0.5) * 0.3, (r(2) - 0.5) * 1.2], [0.1, 0.5 + r(3) * 0.4, 0.5 + r(4) * 0.6]);
    add(geo.patch, black, [-0.46, 1.15 + (r(5) - 0.5) * 0.3, (r(6) - 0.5) * 1.2], [0.1, 0.4 + r(7) * 0.4, 0.4 + r(8) * 0.6]);
    const head = add(geo.head, white, [0, 1.35, 1.25]);
    head.name = 'head';
    // Kept, rather than looked up by name every frame for every cow.
    g.userData.head = head;
    add(geo.snout, pink, [0, 1.2, 1.62]);
    for (const [x, z] of [[-0.3, 0.7], [0.3, 0.7], [-0.3, -0.7], [0.3, -0.7]]) add(geo.leg, white, [x, 0.4, z]);
    for (const x of [-0.22, 0.22]) add(geo.horn, pink, [x, 1.72, 1.2]);
    return g;
  }

  /**
   * A moo: two detuned sawtooths gliding down under a closing low-pass.
   * @param {THREE.Vector3} at
   * @returns {void}
   */
  function moo(at) {
    const SoundSystem = ctx.SoundSystem;
    const actx = SoundSystem && SoundSystem.context;
    if (!actx || actx.state !== 'running' || !SoundSystem.effectsGain) return;
    const cam = Sim.three.camera.position;
    const near = Math.max(0, 1 - cam.distanceTo(at) / 220);
    if (near <= 0.02) return;
    const now = actx.currentTime;
    const length = 1 + soundRandom() * 0.5;
    const pitch = 95 + soundRandom() * 35;
    const gain = actx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(COWS.mooGain * near, now + 0.12);
    gain.gain.setTargetAtTime(0.0001, now + length * 0.7, 0.12);
    const filter = actx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(350, now);
    filter.frequency.linearRampToValueAtTime(1200, now + 0.25);
    filter.frequency.linearRampToValueAtTime(300, now + length);
    filter.connect(gain);
    gain.connect(SoundSystem.effectsGain);
    for (const detune of [0, 7]) {
      const osc = actx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(pitch, now);
      osc.frequency.linearRampToValueAtTime(pitch * 1.25, now + 0.3);
      osc.frequency.linearRampToValueAtTime(pitch * 0.85, now + length);
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(now);
      osc.stop(now + length + 0.4);
      osc.onended = () => { try { osc.disconnect(); } catch { /* gone */ } };
    }
    setTimeout(() => { try { gain.disconnect(); filter.disconnect(); } catch { /* gone */ } }, (length + 0.6) * 1000);
  }

  /** @returns {void} the herd in its field, as physics objects */
  function placeHerd() {
    for (const cow of herd) {
      const i = Sim.objects.indexOf(cow);
      if (i !== -1) Sim.objects.splice(i, 1);
    }
    const P = COWS.pasture;
    herd.forEach((cow, i) => {
      const u = (i + 0.5) / herd.length;
      cow.mesh.position.set(P.x + (u - 0.5) * P.halfX * 1.6, 0, P.z + Math.sin(i * 2.4) * P.halfZ * 0.6);
      cow.mesh.rotation.set(0, i * 1.7, 0);
      cow.velocity.set(0, 0, 0);
      cow.angularVelocity.set(0, 0, 0);
      cow.captureState = 'grounded';
      cow.damageState = 'intact';
      /** @type {any} */ (cow).mooed = false;
      /** @type {any} */ (cow).graze = Math.random() * 6;
      cow.mesh.visible = true;
      if (!cow.mesh.parent) Sim.three.scene.add(cow.mesh);
      Sim.objects.push(cow);
    });
  }

  /** @returns {void} */
  function initCows() {
    geo.body = new THREE.BoxGeometry(0.9, 0.85, 2);
    geo.patch = new THREE.BoxGeometry(1, 1, 1);
    geo.head = new THREE.BoxGeometry(0.55, 0.55, 0.7);
    geo.snout = new THREE.BoxGeometry(0.45, 0.3, 0.2);
    geo.leg = new THREE.BoxGeometry(0.18, 0.8, 0.18);
    geo.horn = new THREE.ConeGeometry(0.06, 0.25, 5);
    geo.post = new THREE.BoxGeometry(0.15, 1.3, 0.15);
    geo.rail = new THREE.BoxGeometry(1, 0.08, 0.08);
    mats.push(
      new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: 0xe6a79b, roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.95 })
    );
    // The fence round the field: posts every few metres, two rails.
    const P = COWS.pasture;
    fence = new THREE.Group();
    fence.name = 'cow_fence';
    const wood = mats[3];
    const side = (/** @type {number} */ x0, /** @type {number} */ z0, /** @type {number} */ x1, /** @type {number} */ z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.round(len / 4));
      for (let k = 0; k <= n; k++) {
        const post = new THREE.Mesh(geo.post, wood);
        post.position.set(x0 + (x1 - x0) * k / n, 0.65, z0 + (z1 - z0) * k / n);
        fence.add(post);
      }
      for (const y of [0.5, 1.0]) {
        const rail = new THREE.Mesh(geo.rail, wood);
        rail.scale.x = len;
        rail.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
        rail.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
        fence.add(rail);
      }
    };
    const x0 = P.x - P.halfX;
    const x1 = P.x + P.halfX;
    const z0 = P.z - P.halfZ;
    const z1 = P.z + P.halfZ;
    side(x0, z0, x1, z0);
    side(x1, z0, x1, z1);
    side(x1, z1, x0, z1);
    side(x0, z1, x0, z0);
    // Static: its matrices are worked out once (see PROJECT_HISTORY.md, findings: "matrices").
    fence.updateMatrixWorld(true);
    fence.traverse((o) => { o.matrixAutoUpdate = false; });
    fence.matrixWorldAutoUpdate = false;
    Sim.three.scene.add(fence);
    herd = [];
    for (let i = 0; i < COWS.count; i++) {
      herd.push(/** @type {SimObject} */ ({
        id: ctx.nextObjectId.value++,
        type: 'cow',
        mesh: buildCow(i),
        velocity: new THREE.Vector3(),
        angularVelocity: new THREE.Vector3(),
        mass: COWS.mass,
        drag: 0.35,
        rooted: false,
        damageState: 'intact',
        breakThreshold: Infinity,
        liftEligible: COWS.liftEligible,
        pooled: false,
        poolIndex: -1,
        lifeTimer: 0,
        captureState: 'grounded'
      }));
    }
    placeHerd();
  }

  /**
   * Grazing, mooing on the way up, getting back up after landing.
   * @param {number} dt
   * @returns {void}
   */
  function updateCows(dt) {
    if (dt <= 0) return;
    const P = COWS.pasture;
    for (const cow of herd) {
      const c = /** @type {any} */ (cow);
      if (!cow.mesh.parent) continue;
      if (cow.captureState !== 'grounded') {
        if (!c.mooed) {
          c.mooed = true;
          c.flown = true;
          Sim.stats.cowsFlown = (Sim.stats.cowsFlown || 0) + 1;
          moo(cow.mesh.position);
        }
        continue;
      }
      c.mooed = false;
      // Back on its feet: upright again, however it landed.
      cow.mesh.rotation.x *= Math.max(0, 1 - dt * 3);
      cow.mesh.rotation.z *= Math.max(0, 1 - dt * 3);
      // Grazing: a slow amble and the head going down to the grass. Inside
      // the fence it turns back at the rails; out in town it grazes where
      // it landed.
      c.graze += dt;
      const p = cow.mesh.position;
      const walking = Math.sin(c.graze * 0.4) > 0.3;
      if (walking) {
        const h = cow.mesh.rotation.y;
        p.x += Math.sin(h) * COWS.walk * dt;
        p.z += Math.cos(h) * COWS.walk * dt;
        if (!c.flown && (Math.abs(p.x - P.x) > P.halfX - 1.5 || Math.abs(p.z - P.z) > P.halfZ - 1.5)) {
          cow.mesh.rotation.y = Math.atan2(P.x - p.x, P.z - p.z);
        }
      } else if (Math.random() < dt * 0.1) {
        cow.mesh.rotation.y += (Math.random() - 0.5) * 1.5;
      }
      const head = cow.mesh.userData.head;
      if (head) head.position.y = walking ? 1.35 : 1.0 + Math.sin(c.graze * 3) * 0.05;
    }
  }

  /** @returns {void} */
  function resetCows() {
    for (const cow of herd) /** @type {any} */ (cow).flown = false;
    placeHerd();
  }

  /** @returns {void} */
  function disposeCows() {
    for (const cow of herd) {
      Sim.three.scene.remove(cow.mesh);
      const i = Sim.objects.indexOf(cow);
      if (i !== -1) Sim.objects.splice(i, 1);
    }
    herd = [];
    if (fence) Sim.three.scene.remove(fence);
    fence = null;
    for (const g of Object.values(geo)) g.dispose();
    for (const m of mats) m.dispose();
    mats.length = 0;
  }

  /**
   * For the co-op guest (net/system.js, `flyers` rows): the cow builder over
   * this system's own shared geometry and materials (the guest releases
   * nothing of them). Null before the herd is built. Nothing is added to the
   * scene and nothing goes on `Sim.objects` (R-048).
   * @returns {{build: (index: number) => THREE.Group, geometries: THREE.BufferGeometry[], materials: THREE.Material[]}|null}
   */
  function buildGuestModel() {
    if (!geo.body || !mats.length) return null;
    return { build: (i) => buildCow(i), geometries: [], materials: [] };
  }

  /**
   * What the guest needs to draw each cow (`flyers` rows, net/flyerPose.js).
   * Read-only.
   * @returns {{index: number, x: number, y: number, z: number, quaternion: THREE.Quaternion, lifted: boolean, headY: number}[]}
   */
  function replicaState() {
    const out = [];
    herd.forEach((cow, index) => {
      if (!cow.mesh.parent) return;
      const p = cow.mesh.position;
      const head = cow.mesh.userData.head;
      out.push({ index, x: p.x, y: p.y, z: p.z, quaternion: cow.mesh.quaternion, lifted: cow.captureState !== 'grounded', headY: head ? head.position.y : 1.35 });
    });
    return out;
  }

  /** The herd's own scene objects, for the guest to hold back while the host's are drawn. @returns {THREE.Object3D[]} */
  const localRoots = () => herd.map((cow) => cow.mesh);

  return { cows: () => herd, initCows, updateCows, resetCows, disposeCows, buildGuestModel, replicaState, localRoots };
}
