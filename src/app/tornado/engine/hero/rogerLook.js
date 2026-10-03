// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION HM.2 -- Roger's suit, shared by every Roger on screen
 * ===========================================================================
 * The Storm Ranger, second cut (2026-10-03, on request: the first cut's
 * bulging arms, ball pauldrons and stick legs "look horrible", "uncanny").
 * Rather than padding the town's capsule-and-stick figure, Roger now has a
 * body of his own built over its joints, in a clean, stylised hero suit:
 *   - a shaped torso (narrow waist, chest, sloped shoulders, oval in section
 *     rather than a round pillar), a pelvis, a neck -- no bulges anywhere;
 *   - legs with a knee: a thigh hung from the hip and a shin on a knee joint
 *     (the walk bends it, hero/movement.js and net/rogerView.js `kneeBend`),
 *     ending in shaped boots instead of boxes;
 *   - slim arms with a small shoulder cap, a forearm guard with a lit cuff,
 *     a gloved hand;
 *   - a closed helmet with a dark glass visor and a thin lit line across the
 *     eyes: no face to look odd, the look of a game hero;
 *   - pearl armour shells, accents in the player's colour (gold for the
 *     host), lights in cyan (in the player's colour for a guest);
 *   - on his back, the Storm Core: a glass capsule with a little tornado
 *     spinning inside (hero/movement.js poseRoger spins it, faster as he runs).
 * The person's own limb meshes stay as the joints the poses turn (same names,
 * same pivots, so the walk, aim pose and Katana grip are unchanged); their
 * own material is swapped for an invisible one and the suit hangs on them.
 * Lifted out of hero/models.js `buildRoger` so a co-op player's figure is the
 * same Roger (net/rogerView.js rogerStyle `tee`). Disposal lives here as well.
 */

/**
 * @typedef {Object} Keeper Where a built figure registers what it made, so the owner can dispose it.
 * @property {<G extends THREE.BufferGeometry>(g: G) => G} geo
 * @property {<M extends THREE.Material>(m: M) => M} mat
 */

/** The host's colours; a guest's `tee` replaces the accents and the lights. */
const SUIT = Object.freeze({
  under: 0x2a3654,
  shell: 0xdfe5ee,
  accent: 0xe8b23a,
  light: 0x59f3ff,
  visor: 0x070b12,
  boot: 0x171d29
});

// Where the shoulders are, against the torso's sides (the Katana and the
// rifle read the arm's own position, hero/katana/model.js placeKatana), and
// how far the arms hang out at rest.
const SHOULDER_X = 0.31;
const ARM_REST = 0.1;
// The person's legs are short (hips 0.7 up a 1.82 figure); Roger's hips sit
// higher, for the longer legs a hero is drawn with. The knee, in the leg's
// frame, halves the leg.
const HIP_Y = 0.86;
const HIP_X = 0.1;
const KNEE_Y = -0.42;
// The helmet, smaller than the person's head, so the figure is not a toy.
const HELMET_R = 0.145;
const HEAD_Y = 1.65;

/**
 * A torso profile for a lathe, bottom to top: [radius, height] in the
 * torso's frame (centred 1.1 above the feet): the waist over the hips, the
 * chest, the shoulders sloping into the neck.
 */
const TORSO_PROFILE = [
  [0, -0.22], [0.15, -0.22], [0.144, -0.14], [0.15, -0.03], [0.178, 0.07],
  [0.196, 0.17], [0.2, 0.25], [0.186, 0.32], [0.14, 0.375], [0.07, 0.4], [0, 0.4]
];
// The torso's section is an oval: wider than deep.
const TORSO_WIDE = 1.25;
const TORSO_DEEP = 0.74;

/**
 * Dresses a `people.createPerson` figure as Roger, the Storm Ranger: hides
 * the person's own shapes and builds the suit on its joints. The limbs keep
 * the names the walk and aim poses look up.
 * @param {THREE.Object3D} root The figure's root (the person's `mesh`).
 * @param {Keeper} keep Registers every material and geometry made.
 * @param {{tee?: number|null}} [opts] `tee`: a guest's colour, for the accents and the lights (null or absent: the host's gold and cyan).
 * @returns {{torso: THREE.Object3D, core: THREE.Object3D, kneeL: THREE.Object3D, kneeR: THREE.Object3D}} The parts the caller keeps: the torso, the Storm Core's spinning tornado and the knees.
 */
export function dressAsRoger(root, keep, opts = {}) {
  const guest = typeof opts.tee === 'number';
  const tint = guest ? /** @type {number} */ (opts.tee) : null;
  const under = keep.mat(new THREE.MeshStandardMaterial({ color: SUIT.under, roughness: 0.62, metalness: 0.1 }));
  const shell = keep.mat(new THREE.MeshStandardMaterial({ color: SUIT.shell, roughness: 0.32, metalness: 0.3 }));
  const accent = keep.mat(new THREE.MeshStandardMaterial({ color: tint ?? SUIT.accent, roughness: 0.3, metalness: 0.7 }));
  const light = keep.mat(new THREE.MeshBasicMaterial({ color: tint ?? SUIT.light, toneMapped: false }));
  const visor = keep.mat(new THREE.MeshStandardMaterial({ color: SUIT.visor, roughness: 0.08, metalness: 0.9 }));
  const boot = keep.mat(new THREE.MeshStandardMaterial({ color: SUIT.boot, roughness: 0.45, metalness: 0.3 }));
  const glass = keep.mat(new THREE.MeshStandardMaterial({
    color: 0xcff8ff, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.2, depthWrite: false
  }));
  const swirl = keep.mat(new THREE.MeshBasicMaterial({
    color: tint ?? SUIT.light, transparent: true, opacity: 0.85, toneMapped: false,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  }));
  // The person's own shapes: kept as the joints, never drawn.
  const hidden = keep.mat(new THREE.MeshBasicMaterial({ visible: false }));

  const replaced = new Set();
  root.traverse((/** @type {any} */ child) => {
    if (!child.material) return;
    replaced.add(child.material);
    child.material = hidden;
    child.castShadow = false;
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
  const part = (/** @type {string} */ suffix) => /** @type {THREE.Object3D} */ (root.children.find(c => c.name.endsWith(suffix)));
  /** A lathe from [radius, height] pairs, optionally only round the front. */
  const lathe = (/** @type {number[][]} */ points, grow = 0, phiStart = 0, phiLength = Math.PI * 2) => new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r > 0 ? r + grow : 0, y)), 20, phiStart, phiLength
  );

  // The torso: the shaped body, a chest shell over its front, the emblem.
  const torso = part('_torso');
  const body = add(torso, lathe(TORSO_PROFILE), under, 0, 0, 0, true);
  body.scale.set(TORSO_WIDE, 1, TORSO_DEEP);
  const chestProfile = TORSO_PROFILE.slice(4, 9);
  const chest = add(torso, lathe(chestProfile, 0.012, -1.05, 2.1), shell, 0, 0, 0, true);
  chest.scale.copy(body.scale);
  // Its lower edge in the accent colour.
  const rim = add(torso, new THREE.CylinderGeometry(0.191, 0.191, 0.022, 20, 1, true, -1.05, 2.1), accent, 0, 0.075, 0);
  rim.scale.copy(body.scale);
  // The emblem: a little tornado in a lit ring, on the breastbone.
  const emblemZ = 0.196 * TORSO_DEEP + 0.018;
  const emblem = add(torso, new THREE.ConeGeometry(0.036, 0.085, 12), light, 0, 0.17, emblemZ);
  emblem.rotation.x = Math.PI;
  emblem.scale.z = 0.3;
  add(torso, new THREE.TorusGeometry(0.056, 0.008, 6, 24), light, 0, 0.17, emblemZ - 0.003);
  // The belt, its light, the buckle.
  const belt = add(torso, new THREE.CylinderGeometry(0.158, 0.16, 0.05, 20), boot, 0, -0.19, 0);
  belt.scale.set(TORSO_WIDE, 1, TORSO_DEEP);
  const beltLight = add(torso, new THREE.CylinderGeometry(0.161, 0.161, 0.01, 20, 1, true), light, 0, -0.19, 0);
  beltLight.scale.copy(belt.scale);
  add(torso, new THREE.CylinderGeometry(0.03, 0.03, 0.015, 14), accent, 0, -0.19, 0.16 * TORSO_DEEP + 0.006).rotation.x = Math.PI / 2;

  // The pelvis, on the root so it stays square while the shoulders roll.
  add(root, new THREE.SphereGeometry(0.16, 16, 10), under, 0, 0.9, 0, true).scale.set(1.12, 0.6, 0.7);

  // Arms: a shoulder cap, the sleeve, a forearm guard with a lit cuff, a glove.
  for (const side of [-1, 1]) {
    const arm = part(side < 0 ? '_armL' : '_armR');
    arm.position.x = side * SHOULDER_X;
    arm.rotation.z = side * ARM_REST;
    add(arm, new THREE.SphereGeometry(0.074, 14, 10), shell, -side * 0.008, -0.025, 0, true).scale.set(1, 1.05, 1);
    add(arm, new THREE.CapsuleGeometry(0.052, 0.17, 4, 10), under, 0, -0.13, 0, true);
    add(arm, new THREE.CapsuleGeometry(0.05, 0.12, 4, 10), shell, 0, -0.355, 0, true);
    add(arm, new THREE.CylinderGeometry(0.053, 0.053, 0.012, 12, 1, true), light, 0, -0.43, 0);
    add(arm, new THREE.SphereGeometry(0.052, 10, 8), boot, 0, -0.49, 0.004).scale.set(0.9, 1.15, 1);
  }

  // Legs: a thigh from the hip, the knee joint, a shin guard, a boot.
  /** @type {THREE.Object3D[]} */
  const knees = [];
  for (const side of [-1, 1]) {
    const leg = part(side < 0 ? '_legL' : '_legR');
    leg.position.set(side * HIP_X, HIP_Y, 0);
    add(leg, new THREE.CapsuleGeometry(0.078, 0.26, 4, 10), under, 0, -0.2, 0, true);
    const knee = new THREE.Group();
    knee.name = `${root.name}_knee${side < 0 ? 'L' : 'R'}`;
    knee.position.y = KNEE_Y;
    leg.add(knee);
    knees.push(knee);
    add(knee, new THREE.SphereGeometry(0.068, 12, 8), under, 0, 0, 0);
    add(knee, new THREE.CapsuleGeometry(0.064, 0.24, 4, 10), shell, 0, -0.17, 0, true);
    // The boot: a cuff with a lit band, then the foot, rounded at the toe and
    // heel; its sole on the ground when the leg is straight.
    add(knee, new THREE.CylinderGeometry(0.07, 0.066, 0.08, 12), boot, 0, -0.34, 0);
    const foot = add(knee, new THREE.CapsuleGeometry(0.056, 0.12, 4, 10), boot, 0, -0.392, 0.045, true);
    foot.rotation.x = Math.PI / 2;
    foot.scale.set(1.05, 1, 0.82);
    add(knee, new THREE.CylinderGeometry(0.071, 0.071, 0.012, 12, 1, true), light, 0, -0.31, 0);
  }

  // The helmet: closed, a dark glass visor across the face with a thin lit
  // line at the eyes, a low crest in the accent colour, lit ear discs.
  const head = part('_head');
  head.position.y = HEAD_Y;
  const R = HELMET_R;
  add(head, new THREE.CylinderGeometry(0.058, 0.068, 0.12, 12), under, 0, -R - 0.02, 0);
  const helmetShape = new THREE.Vector3(0.94, 1.06, 1.04);
  add(head, new THREE.SphereGeometry(R, 22, 16), shell, 0, 0, 0, true).scale.copy(helmetShape);
  const front = Math.PI / 2;
  add(head, new THREE.SphereGeometry(R + 0.004, 22, 10, front - 1.05, 2.1, Math.PI * 0.34, Math.PI * 0.3), visor, 0, 0, 0.003)
    .scale.copy(helmetShape);
  add(head, new THREE.SphereGeometry(R + 0.006, 22, 2, front - 0.85, 1.7, Math.PI * 0.455, Math.PI * 0.035), light, 0, 0, 0.003)
    .scale.copy(helmetShape);
  add(head, new THREE.BoxGeometry(0.022, 0.026, 0.2), accent, 0, R * 1.06 - 0.002, -0.01);
  for (const side of [-1, 1]) {
    const ear = add(head, new THREE.CylinderGeometry(0.036, 0.036, 0.02, 16), accent, side * (R * 0.94 - 0.002), -0.005, -0.01);
    ear.rotation.z = Math.PI / 2;
    const dot = add(head, new THREE.CylinderGeometry(0.015, 0.015, 0.024, 10), light, side * R * 0.94, -0.005, -0.01);
    dot.rotation.z = Math.PI / 2;
  }

  // The Storm Core on his back: a slim mount, a glass capsule, a little
  // tornado spinning inside. In the root's frame, against the shoulder blades.
  const back = 0.2 * TORSO_DEEP;
  add(root, new THREE.BoxGeometry(0.16, 0.3, 0.035), shell, 0, 1.2, -back - 0.01, true);
  add(root, new THREE.CapsuleGeometry(0.06, 0.17, 4, 12), glass, 0, 1.2, -back - 0.085);
  for (const y of [1.06, 1.34]) add(root, new THREE.CylinderGeometry(0.07, 0.07, 0.026, 14), accent, 0, y, -back - 0.085);
  const core = new THREE.Group();
  core.position.set(0, 1.2, -back - 0.085);
  root.add(core);
  const funnel = add(core, new THREE.ConeGeometry(0.05, 0.2, 12, 1, true), swirl, 0, 0, 0);
  funnel.rotation.x = Math.PI;
  const inner = add(core, new THREE.ConeGeometry(0.024, 0.17, 8, 1, true), light, 0, 0.01, 0);
  inner.rotation.set(Math.PI, 0, 0.12);
  return { torso, core, kneeL: knees[0], kneeR: knees[1] };
}

/**
 * Finds a Roger's four limbs and two knees by name.
 * @param {THREE.Object3D} root The figure's root.
 * @returns {{legL: THREE.Object3D, legR: THREE.Object3D, armL: THREE.Object3D, armR: THREE.Object3D, kneeL: THREE.Object3D, kneeR: THREE.Object3D}} The limbs.
 */
export function rogerLimbs(root) {
  const limb = (/** @type {string} */ suffix) => /** @type {THREE.Object3D} */ (root.children.find((c) => c.name.endsWith(suffix)));
  const legL = limb('_legL');
  const legR = limb('_legR');
  // The knees hang in the legs (dressAsRoger).
  const knee = (/** @type {THREE.Object3D} */ leg, /** @type {string} */ suffix) => /** @type {THREE.Object3D} */ (leg.children.find((c) => c.name.endsWith(suffix)));
  return { legL, legR, armL: limb('_armL'), armR: limb('_armR'), kneeL: knee(legL, '_kneeL'), kneeR: knee(legR, '_kneeR') };
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
