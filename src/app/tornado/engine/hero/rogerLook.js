// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION HM.2 -- Roger's suit, shared by every Roger on screen
 * ===========================================================================
 * The Storm Ranger (2026-10-03, on request: "be creative, a unique avatar";
 * it replaced the black leather jacket, jeans and pompadour, which read as
 * a black blob behind him on a phone):
 *   - a deep-navy under-suit, athletic build;
 *   - armour plates in the player's colour (gold for the host): a chest
 *     plate, shoulder pauldrons, gauntlets, knee guards, a crest on the helmet;
 *   - a helmet over the top and back of the head with a glowing visor band
 *     and ear discs, the face showing under it;
 *   - glowing lines that bloom: the visor, a tornado emblem in a ring on the
 *     chest, the belt, the cuffs, the boot soles;
 *   - on his back, the Storm Core: a glass capsule on a gold mount, a little
 *     tornado spinning inside it (hero/movement.js poseRoger spins it, faster
 *     as he runs). The follow camera sits behind him, so this is the view of
 *     him the player has most.
 * Lifted out of hero/models.js `buildRoger` so a co-op player's figure (the
 * host's view of the guest, the guest's own view of both) is the same Roger,
 * not a second design: a guest's plates and lights are in their colour
 * (net/rogerView.js rogerStyle `tee`). Per-figure disposal lives here as well.
 */

/**
 * @typedef {Object} Keeper Where a built figure registers what it made, so the owner can dispose it.
 * @property {<G extends THREE.BufferGeometry>(g: G) => G} geo
 * @property {<M extends THREE.Material>(m: M) => M} mat
 */

/** The host's colours; a guest's `tee` replaces the plates and the light. */
const SUIT = Object.freeze({
  under: 0x1a2440,
  shell: 0x111827,
  plate: 0xe8b23a,
  light: 0x59f3ff,
  boot: 0x0c111c
});

/**
 * Dresses a `people.createPerson` figure as Roger, the Storm Ranger:
 * replaces its clothes and adds the armour, the helmet, the lights and the
 * Storm Core. The limbs keep the names the walk and aim poses look up.
 * @param {THREE.Object3D} root The figure's root (the person's `mesh`).
 * @param {Keeper} keep Registers every material and geometry made.
 * @param {{tee?: number|null}} [opts] `tee`: a guest's colour, for the plates and the lights (null or absent: the host's gold and cyan).
 * @returns {{torso: THREE.Object3D, core: THREE.Object3D}} The parts the caller keeps: the torso, and the Storm Core's spinning tornado.
 */
export function dressAsRoger(root, keep, opts = {}) {
  const guest = typeof opts.tee === 'number';
  const under = keep.mat(new THREE.MeshStandardMaterial({ color: SUIT.under, roughness: 0.55, metalness: 0.15 }));
  const shell = keep.mat(new THREE.MeshStandardMaterial({ color: SUIT.shell, roughness: 0.25, metalness: 0.6 }));
  const plate = keep.mat(new THREE.MeshStandardMaterial({
    color: guest ? /** @type {number} */ (opts.tee) : SUIT.plate, roughness: 0.3, metalness: 0.75
  }));
  const light = keep.mat(new THREE.MeshBasicMaterial({ color: guest ? /** @type {number} */ (opts.tee) : SUIT.light, toneMapped: false }));
  const visor = keep.mat(new THREE.MeshBasicMaterial({
    color: guest ? /** @type {number} */ (opts.tee) : SUIT.light, toneMapped: false, side: THREE.DoubleSide
  }));
  const boot = keep.mat(new THREE.MeshStandardMaterial({ color: SUIT.boot, roughness: 0.4, metalness: 0.35 }));
  const glass = keep.mat(new THREE.MeshStandardMaterial({
    color: 0xcff8ff, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.2, depthWrite: false
  }));
  const swirl = keep.mat(new THREE.MeshBasicMaterial({
    color: guest ? /** @type {number} */ (opts.tee) : SUIT.light, transparent: true, opacity: 0.85, toneMapped: false,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  }));

  const replaced = new Set();
  root.traverse((/** @type {any} */ child) => {
    // The head keeps its skin (the face under the visor).
    if (!child.material || /_head/.test(child.name)) return;
    replaced.add(child.material);
    child.material = under;
  });
  for (const material of replaced) material.dispose();

  /**
   * @param {THREE.Object3D} parent
   * @param {THREE.BufferGeometry} geometry
   * @param {THREE.Material} material
   * @param {number} px
   * @param {number} py
   * @param {number} pz
   * @param {boolean} [cast] only the big pieces cast a shadow
   * @returns {THREE.Mesh}
   */
  const add = (parent, geometry, material, px, py, pz, cast = false) => {
    const mesh = new THREE.Mesh(keep.geo(geometry), material);
    mesh.position.set(px, py, pz);
    mesh.castShadow = cast;
    parent.add(mesh);
    return mesh;
  };
  const part = (/** @type {string} */ suffix) => root.children.find(c => c.name.endsWith(suffix));

  // The build: a broad, deep chest, the arms further out to clear it.
  const torso = part('_torso');
  torso.scale.set(1.3, 1.05, 1.15);
  // Chest plate with the emblem: a little tornado in a ring.
  const chest = add(torso, new THREE.BoxGeometry(0.3, 0.26, 0.07), plate, 0, 0.1, 0.17, true);
  chest.rotation.x = -0.12;
  const emblem = add(torso, new THREE.ConeGeometry(0.05, 0.12, 12), light, 0, 0.1, 0.215);
  emblem.rotation.x = Math.PI;
  emblem.scale.z = 0.35;
  add(torso, new THREE.TorusGeometry(0.075, 0.011, 6, 24), light, 0, 0.1, 0.212);
  // The belt, its light, the buckle.
  add(torso, new THREE.CylinderGeometry(0.205, 0.205, 0.06, 18), shell, 0, -0.2, 0);
  add(torso, new THREE.CylinderGeometry(0.208, 0.208, 0.012, 18), light, 0, -0.2, 0);
  add(torso, new THREE.BoxGeometry(0.07, 0.07, 0.03), plate, 0, -0.2, 0.2);

  for (const side of [-1, 1]) {
    const arm = part(side < 0 ? '_armL' : '_armR');
    arm.position.x = side * 0.35;
    // Pauldron, the upper arm built up, a gauntlet with a lit cuff, a fist.
    // (Built round the arm rather than scaling it, which would shear the
    // rifle in his hand.)
    add(arm, new THREE.SphereGeometry(0.13, 12, 8), plate, 0, 0.02, 0, true).scale.set(1.15, 0.78, 1.1);
    add(arm, new THREE.SphereGeometry(0.085, 10, 8), under, 0, -0.17, 0.01).scale.set(1, 1.45, 1.05);
    add(arm, new THREE.CylinderGeometry(0.07, 0.06, 0.2, 10), plate, 0, -0.39, 0);
    add(arm, new THREE.CylinderGeometry(0.073, 0.073, 0.018, 10), light, 0, -0.3, 0);
    add(arm, new THREE.SphereGeometry(0.06, 8, 6), shell, 0, -0.52, 0);
    const leg = part(side < 0 ? '_legL' : '_legR');
    leg.scale.set(1.2, 1, 1.2);
    // Knee guard, boot, glowing sole.
    add(leg, new THREE.BoxGeometry(0.12, 0.13, 0.05), plate, 0, -0.32, 0.075);
    add(leg, new THREE.BoxGeometry(0.135, 0.15, 0.24), boot, 0, -0.62, 0.035);
    add(leg, new THREE.BoxGeometry(0.14, 0.022, 0.25), light, 0, -0.69, 0.035);
  }

  // The helmet: a shell over the top and back of the head, a lit visor band
  // across the eyes, a crest, ear discs. The face shows under the visor.
  const head = part('_head');
  add(head, new THREE.SphereGeometry(0.176, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.56), shell, 0, 0.012, -0.012, true);
  add(head, new THREE.CylinderGeometry(0.169, 0.169, 0.055, 24, 1, true, -Math.PI * 0.42, Math.PI * 0.84), visor, 0, 0.02, 0);
  add(head, new THREE.BoxGeometry(0.03, 0.085, 0.27), plate, 0, 0.175, -0.02);
  for (const side of [-1, 1]) {
    const ear = add(head, new THREE.CylinderGeometry(0.048, 0.048, 0.035, 14), plate, side * 0.17, 0.0, 0);
    ear.rotation.z = Math.PI / 2;
    const dot = add(head, new THREE.CylinderGeometry(0.022, 0.022, 0.04, 10), light, side * 0.172, 0.0, 0);
    dot.rotation.z = Math.PI / 2;
  }

  // The Storm Core on his back: a gold mount, a glass capsule, a little
  // tornado spinning inside. In the root's frame (the torso is scaled).
  add(root, new THREE.BoxGeometry(0.2, 0.36, 0.04), plate, 0, 1.17, -0.255, true);
  add(root, new THREE.CapsuleGeometry(0.075, 0.2, 4, 12), glass, 0, 1.17, -0.335);
  for (const y of [1.02, 1.32]) add(root, new THREE.CylinderGeometry(0.086, 0.086, 0.03, 14), plate, 0, y, -0.335);
  const core = new THREE.Group();
  core.position.set(0, 1.17, -0.335);
  root.add(core);
  const funnel = add(core, new THREE.ConeGeometry(0.062, 0.24, 12, 1, true), swirl, 0, 0, 0);
  funnel.rotation.x = Math.PI;
  const inner = add(core, new THREE.ConeGeometry(0.03, 0.2, 8, 1, true), light, 0, 0.01, 0);
  inner.rotation.set(Math.PI, 0, 0.12);
  return { torso, core };
}

/**
 * Finds a Roger's four limbs by name.
 * @param {THREE.Object3D} root The figure's root.
 * @returns {{legL: THREE.Object3D, legR: THREE.Object3D, armL: THREE.Object3D, armR: THREE.Object3D}} The limbs.
 */
export function rogerLimbs(root) {
  const limb = (/** @type {string} */ suffix) => /** @type {THREE.Object3D} */ (root.children.find((c) => c.name.endsWith(suffix)));
  return { legL: limb('_legL'), legR: limb('_legR'), armL: limb('_armL'), armR: limb('_armR') };
}

/**
 * Something a figure owns and must release: its own geometries, materials and textures.
 * @typedef {Object} Owned
 * @property {THREE.BufferGeometry[]} geos
 * @property {THREE.Material[]} mats
 * @property {THREE.Texture[]} texs
 * @property {Keeper & {tex: (t: THREE.Texture) => THREE.Texture}} keep
 */

/** @returns {Owned} An empty ownership record with its registering functions. */
export function newOwned() {
  /** @type {Owned} */
  const owned = {
    geos: [], mats: [], texs: [],
    keep: {
      geo: (g) => { owned.geos.push(g); return g; },
      mat: (m) => { owned.mats.push(m); return m; },
      tex: (t) => { owned.texs.push(t); return t; }
    }
  };
  return owned;
}

/**
 * Releases a Roger figure: what `createPerson` made (its own geometries and
 * materials), and everything registered in `owned`. Safe to call twice.
 * @param {THREE.Object3D} root The figure's root.
 * @param {Owned} owned What the figure registered.
 * @returns {void}
 */
export function disposeRoger(root, owned) {
  root.traverse((/** @type {any} */ child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  });
  for (const g of owned.geos) g.dispose();
  for (const m of owned.mats) m.dispose();
  for (const t of owned.texs) t.dispose();
  owned.geos.length = owned.mats.length = owned.texs.length = 0;
}
