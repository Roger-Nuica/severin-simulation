// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION D.8 — The STORM 7 news helicopter
 * ===========================================================================
 * A TV news helicopter, white with a blue stripe and STORM 7 on its sides,
 * is the town's eye in the sky. Before the storm it makes slow, wide
 * circles over the town; once a tornado is on the ground it goes after it
 * and circles it at a safe distance, nose in and banked, with its
 * searchlight on the funnel's foot. A red beacon blinks on its tail. The
 * news line at the bottom of the screen (ui/newsTicker.js) is its
 * broadcast.
 *
 * Purely visual: not Sim.objects, the wind leaves it alone (it keeps its
 * distance), no shadow, a handful of draw calls. The searchlight is a
 * glowing cone, not a light (no lights are ever added at runtime).
 */

export const CHOPPER = Object.freeze({
  /** Circling the town: radius, height (m), and angular speed (rad/s). */
  town: { radius: 70, height: 50, speed: 0.07 },
  /** Circling a tornado: radius from its centre, height, angular speed. */
  storm: { radius: 82, height: 46, speed: 0.11 },
  /** How fast it moves to its circle (per second, a smoothing rate). */
  follow: 0.55
});

/**
 * The STORM 7 livery for the body's sides.
 * @returns {THREE.CanvasTexture}
 */
function createLiveryTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  g.fillStyle = '#f4f6fa';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#1f5fbf';
  g.fillRect(0, 78, 512, 22);
  g.fillStyle = '#d62839';
  g.fillRect(0, 100, 512, 8);
  g.fillStyle = '#123a7a';
  g.font = '900 64px system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.fillText('STORM 7', 60, 42);
  g.fillStyle = '#d62839';
  g.beginPath();
  g.arc(32, 42, 13, 0, Math.PI * 2);
  g.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The helicopter's model: the body, rotors, beacon and searchlight cone, and everything to release with it.
 * Adds nothing to the scene (the host's system and the co-op guest each place their own).
 * @returns {{root: THREE.Group, rotor: THREE.Group, tailRotor: THREE.Group, beacon: THREE.Mesh, beam: THREE.Mesh,
 *   geometries: THREE.BufferGeometry[], materials: THREE.Material[], textures: THREE.Texture[]}}
 */
function buildChopperModel() {
  /** @type {THREE.BufferGeometry[]} */
  const geometries = [];
  /** @type {THREE.Material[]} */
  const materials = [];
  /** @type {THREE.Texture[]} */
  const textures = [];
  const geo = (/** @type {THREE.BufferGeometry} */ g) => (geometries.push(g), g);
  const mat = (/** @type {THREE.Material} */ m) => (materials.push(m), m);
  const livery = createLiveryTexture();
  textures.push(livery);
  const white = mat(new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.45, metalness: 0.2 }));
  const blue = mat(new THREE.MeshStandardMaterial({ color: 0x1f5fbf, roughness: 0.5, metalness: 0.2 }));
  const dark = mat(new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.6, metalness: 0.4 }));
  const glass = mat(new THREE.MeshStandardMaterial({ color: 0x223448, roughness: 0.1, metalness: 0.7 }));
  const side = mat(new THREE.MeshStandardMaterial({ map: livery, roughness: 0.45 }));
  const blur = mat(new THREE.MeshBasicMaterial({ color: 0x9aa4b2, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
  const red = mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.15), toneMapped: false }));
  const lightMat = mat(new THREE.MeshBasicMaterial({
    color: 0xfff3cf, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending
  }));
  const root = new THREE.Group();
  root.name = 'newsChopper';
  /** @param {THREE.BufferGeometry} g @param {THREE.Material} m @param {number} x @param {number} y @param {number} z */
  const add = (g, m, x, y, z, parent = /** @type {THREE.Object3D} */ (root)) => {
    const mesh = new THREE.Mesh(geo(g), m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  // The body: a rounded cabin, the livery on its flat sides, a glazed nose.
  add(new THREE.CapsuleGeometry(0.95, 2.2, 4, 12).rotateX(Math.PI / 2), white, 0, 0, 0).scale.set(1, 0.95, 1);
  for (const sx of [-1, 1]) {
    const panel = add(new THREE.PlaneGeometry(2.6, 0.7), side, sx * 0.97, 0.05, -0.1);
    panel.rotation.y = sx * Math.PI / 2;
  }
  add(new THREE.SphereGeometry(0.88, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), glass, 0, 0.12, 1.25);
  // The tail boom, fin and its stripe, the skids.
  add(new THREE.CylinderGeometry(0.16, 0.32, 4.2, 8).rotateX(Math.PI / 2), white, 0, 0.35, -3.3);
  add(new THREE.BoxGeometry(0.12, 1.2, 0.8), blue, 0, 0.9, -5.2);
  add(new THREE.BoxGeometry(1.6, 0.08, 0.5), blue, 0, 0.4, -5.0);
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.1, 0.1, 3.4), dark, sx * 0.85, -1.25, 0.1);
    for (const z of [-0.8, 0.9]) add(new THREE.BoxGeometry(0.08, 0.5, 0.08), dark, sx * 0.7, -1.0, z);
  }
  // The main rotor: a mast, two long blades, and the blur of them spinning.
  add(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 8), dark, 0, 1.15, 0.1);
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.42, 0.1);
  root.add(rotor);
  for (const a of [0, Math.PI / 2]) add(new THREE.BoxGeometry(0.22, 0.04, 9.2), dark, 0, 0, 0, rotor).rotation.y = a;
  add(new THREE.CircleGeometry(4.6, 32).rotateX(-Math.PI / 2), blur, 0, 0.02, 0, rotor);
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.12, 0.95, -5.3);
  root.add(tailRotor);
  add(new THREE.BoxGeometry(0.04, 1.4, 0.12), dark, 0, 0, 0, tailRotor);
  const beacon = add(new THREE.SphereGeometry(0.12, 8, 6), red, 0, 1.5, -5.4);
  // The searchlight: a cone hanging from the nose, pointed by update().
  const beam = add(new THREE.ConeGeometry(5, 46, 20, 1, true).translate(0, -23, 0), lightMat, 0, -0.9, 1.6);
  root.traverse((o) => { o.castShadow = false; });
  root.scale.setScalar(1.4);
  return { root, rotor, tailRotor, beacon, beam, geometries, materials, textures };
}

/**
 * @param {Object} ctx
 * @returns {{initNewsChopper: () => void, updateNewsChopper: (dt: number) => void,
 *   resetNewsChopper: () => void, disposeNewsChopper: () => void, chasing: () => boolean,
 *   buildGuestModel: () => any, replicaState: () => any, localRoots: () => THREE.Object3D[]}}
 */
export function createNewsChopperSystem(ctx) {
  const { Sim } = ctx;
  /** @type {THREE.Group|null} */
  let root = null;
  /** @type {THREE.Object3D|null} */
  let rotor = null;
  /** @type {THREE.Object3D|null} */
  let tailRotor = null;
  /** @type {THREE.Mesh|null} */
  let beacon = null;
  /** @type {THREE.Mesh|null} */
  let beam = null;
  /** @type {THREE.BufferGeometry[]} */
  const geometries = [];
  /** @type {THREE.Material[]} */
  const materials = [];
  /** @type {THREE.Texture[]} */
  const textures = [];
  let angle = 0;
  let clock = 0;
  let chasing = false;
  const goal = new THREE.Vector3();
  const look = new THREE.Vector3();
  const prev = new THREE.Vector3();
  const focus = new THREE.Vector3();

  /** @returns {void} */
  function initNewsChopper() {
    const m = buildChopperModel();
    root = m.root;
    rotor = m.rotor;
    tailRotor = m.tailRotor;
    beacon = m.beacon;
    beam = m.beam;
    geometries.push(...m.geometries);
    materials.push(...m.materials);
    textures.push(...m.textures);
    Sim.three.scene.add(root);
    resetNewsChopper();
  }

  /**
   * The tornado to follow: the primary while it is on the ground, else any
   * other on the ground, else none.
   * @returns {THREE.Vector3|null}
   */
  function funnel() {
    if (!Sim.state.running) return null;
    for (const v of ctx.tornadoes ? ctx.tornadoes.activeVortices : []) {
      if ((v.birth ?? 1) > 0.25) return v.center;
    }
    return null;
  }

  /** @param {number} dt @returns {void} */
  function updateNewsChopper(dt) {
    if (!root || !rotor || !tailRotor || !beacon || !beam || dt <= 0) return;
    clock += dt;
    const target = funnel();
    chasing = !!target;
    const c = chasing ? CHOPPER.storm : CHOPPER.town;
    angle += c.speed * dt;
    const cx = target ? target.x : 0;
    const cz = target ? target.z : 0;
    goal.set(cx + Math.cos(angle) * c.radius, c.height + Math.sin(clock * 0.4) * 1.5, cz + Math.sin(angle) * c.radius);
    prev.copy(root.position);
    root.position.lerp(goal, Math.min(1, dt * CHOPPER.follow));
    // Nose toward what it films (the funnel, or the town's middle), banked into the turn.
    focus.set(cx, 0, cz);
    look.subVectors(focus, root.position);
    const yaw = Math.atan2(look.x, look.z);
    const turnRate = (root.position.x - prev.x) * Math.cos(yaw) - (root.position.z - prev.z) * Math.sin(yaw);
    root.rotation.set(0.08, yaw, THREE.MathUtils.clamp(-turnRate * 0.25, -0.3, 0.3), 'YXZ');
    rotor.rotation.y += dt * 28;
    tailRotor.rotation.x += dt * 40;
    beacon.visible = (clock % 1.1) < 0.12;
    // The searchlight on the funnel's foot while chasing; idle, down on the town.
    // (The cone hangs straight down; tipping it forward by its angle from
    // the vertical puts its end on the target.)
    const dist = Math.hypot(look.x, look.z);
    const fromVertical = Math.atan2(dist, root.position.y);
    beam.rotation.set(chasing ? -fromVertical : -0.35, 0, 0);
    /** @type {THREE.MeshBasicMaterial} */ (beam.material).opacity = chasing ? 0.13 : 0.06;
  }

  /** @returns {void} */
  function resetNewsChopper() {
    angle = Math.random() * Math.PI * 2;
    chasing = false;
    if (root) root.position.set(Math.cos(angle) * CHOPPER.town.radius, CHOPPER.town.height, Math.sin(angle) * CHOPPER.town.radius);
  }

  /** @returns {void} */
  function disposeNewsChopper() {
    root?.removeFromParent();
    root = rotor = tailRotor = beacon = beam = null;
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
    geometries.length = materials.length = textures.length = 0;
  }

  /**
   * For the co-op guest (net/system.js, `flyers` rows): a second helicopter
   * from the same builder, with the geometry, materials and livery texture to
   * release. Nothing is added to the scene and no state is touched.
   * @returns {ReturnType<typeof buildChopperModel>}
   */
  const buildGuestModel = () => buildChopperModel();

  /**
   * What the guest needs to draw it (a `flyers` row, net/flyerPose.js), or
   * null before it exists. Read-only.
   * @returns {{x: number, y: number, z: number, quaternion: THREE.Quaternion, chasing: boolean}|null}
   */
  function replicaState() {
    if (!root) return null;
    const p = root.position;
    return { x: p.x, y: p.y, z: p.z, quaternion: root.quaternion, chasing };
  }

  /** The helicopter's own scene object, for the guest to hold back while the host's is drawn. @returns {THREE.Object3D[]} */
  const localRoots = () => (root ? [root] : []);

  return { initNewsChopper, updateNewsChopper, resetNewsChopper, disposeNewsChopper, chasing: () => chasing, buildGuestModel, replicaState, localRoots };
}
