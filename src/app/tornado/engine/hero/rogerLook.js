// @ts-check
import * as THREE from 'three';
import { HERO } from './config.js';
import { PERSON_SCALE } from '../environment/people.js';

/**
 * ===========================================================================
 * SECTION HM.2 -- Roger's costume, shared by every Roger on screen
 * ===========================================================================
 * The leather jacket, jeans, boots, pompadour and dark glasses Roger wears,
 * lifted out of hero/models.js `buildRoger` so a co-op player's figure (the
 * host's view of the guest, the guest's own view of both) is the same Roger,
 * not a second design. `buildRoger` calls `dressAsRoger` too, so there is one
 * costume. A name tag and per-figure disposal live here as well.
 */

/**
 * @typedef {Object} Keeper Where a built figure registers what it made, so the owner can dispose it.
 * @property {<G extends THREE.BufferGeometry>(g: G) => G} geo
 * @property {<M extends THREE.Material>(m: M) => M} mat
 */

/**
 * Dresses a `people.createPerson` figure as Roger: replaces its clothes and
 * adds the jacket details, the build, the hair and the glasses. The limbs
 * keep the names the walk and aim poses look up.
 * @param {THREE.Object3D} root The figure's root (the person's `mesh`).
 * @param {Keeper} keep Registers every material and geometry made.
 * @param {{tee?: number|null}} [opts] `tee`: a hex colour for the T-shirt (null or absent: Roger's white).
 * @returns {{quiff: THREE.Mesh, torso: THREE.Object3D}} The parts the caller keeps.
 */
export function dressAsRoger(root, keep, opts = {}) {
  const obj = { mesh: root };
    const leather = keep.mat(new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 0.32, metalness: 0.25 }));
    const jeans = keep.mat(new THREE.MeshStandardMaterial({ color: 0x1d2a44, roughness: 0.85 }));
    const tee = keep.mat(new THREE.MeshStandardMaterial({ color: opts.tee === null || opts.tee === undefined ? 0xf1efe8 : opts.tee, roughness: 0.8 }));
    const hair = keep.mat(new THREE.MeshStandardMaterial({ color: 0x0b0a0d, roughness: 0.25, metalness: 0.35 }));
    const shades = keep.mat(new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.05, metalness: 0.9 }));
    const boot = keep.mat(new THREE.MeshStandardMaterial({ color: 0x0c0b0a, roughness: 0.4, metalness: 0.2 }));
    let skin = null;
    const replaced = new Set();
    obj.mesh.traverse((/** @type {any} */ child) => {
      if (!child.material) return;
      if (/_head/.test(child.name)) {
        skin = child.material;
        return;
      }
      replaced.add(child.material);
      child.material = /_leg/.test(child.name) ? jeans : leather;
    });
    for (const material of replaced) material.dispose();
    /**
     * @param {THREE.Object3D} parent
     * @param {THREE.BufferGeometry} geometry
     * @param {THREE.Material} material
     * @param {number} px
     * @param {number} py
     * @param {number} pz
     * @returns {THREE.Mesh}
     */
    const add = (parent, geometry, material, px, py, pz) => {
      const mesh = new THREE.Mesh(keep.geo(geometry), material);
      mesh.position.set(px, py, pz);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const part = (/** @type {string} */ suffix) => obj.mesh.children.find(c => c.name.endsWith(suffix));
    // The build: a broad, deep chest, the arms further out to clear it.
    const torso = part('_torso');
    torso.scale.set(1.38, 1.05, 1.18);
    // The T-shirt showing where the jacket is open, and the collar up.
    add(torso, new THREE.BoxGeometry(0.14, 0.44, 0.05), tee, 0, 0.02, 0.205);
    for (const side of [-1, 1]) {
      const lapel = add(torso, new THREE.BoxGeometry(0.07, 0.4, 0.04), leather, side * 0.1, 0.02, 0.215);
      lapel.rotation.z = side * 0.12;
      const collar = add(torso, new THREE.BoxGeometry(0.14, 0.12, 0.04), leather, side * 0.12, 0.33, 0.12);
      collar.rotation.set(-0.35, side * 0.5, side * 0.35);
    }
    for (const side of [-1, 1]) {
      const arm = part(side < 0 ? '_armL' : '_armR');
      arm.position.x = side * 0.36;
      // Shoulders, biceps and forearms in the jacket; a fist at the end.
      // (Built up round the arm rather than scaling it, which would shear
      // the rifle in his hand.)
      add(arm, new THREE.SphereGeometry(0.125, 10, 8), leather, 0, 0, 0).scale.set(1.1, 0.9, 1.1);
      add(arm, new THREE.SphereGeometry(0.095, 10, 8), leather, 0, -0.16, 0.01).scale.set(1, 1.45, 1.05);
      add(arm, new THREE.SphereGeometry(0.075, 8, 6), leather, 0, -0.36, 0.005).scale.set(1, 1.6, 1);
      add(arm, new THREE.SphereGeometry(0.06, 8, 6), skin, 0, -0.52, 0);
      const leg = part(side < 0 ? '_legL' : '_legR');
      leg.scale.set(1.25, 1, 1.25);
      add(leg, new THREE.BoxGeometry(0.13, 0.1, 0.22), boot, 0, -0.66, 0.04);
    }
    // The head: the pompadour -- a big glossy quiff swept up and forward,
    // the sides slicked back -- sideburns, and dark glasses.
    const head = part('_head');
    const quiff = add(head, new THREE.SphereGeometry(0.14, 14, 10), hair, 0, 0.13, 0.05);
    quiff.scale.set(0.95, 0.75, 1.25);
    quiff.rotation.x = -0.35;
    add(head, new THREE.SphereGeometry(0.165, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 0.01, -0.012).scale.set(1.02, 1, 1.05);
    for (const side of [-1, 1]) {
      add(head, new THREE.BoxGeometry(0.03, 0.1, 0.05), hair, side * 0.155, -0.03, 0.03);
      add(head, new THREE.BoxGeometry(0.1, 0.045, 0.02), shades, side * 0.055, 0.01, 0.162);
    }
    add(head, new THREE.BoxGeometry(0.2, 0.012, 0.012), shades, 0, 0.02, 0.168);
  return { quiff, torso };
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
 * A name tag sprite for a co-op Roger, a child of the figure (so it follows
 * it and is disposed with it). The figure is scaled by `PERSON_SCALE`, which
 * the tag undoes so it keeps the hero tag's size and height.
 * @param {string} label The text.
 * @param {string} accent CSS colour of the outline and text.
 * @param {Keeper & {tex: (t: THREE.Texture) => THREE.Texture}} keep Registers the texture, material and geometry made.
 * @returns {THREE.Sprite} The sprite.
 */
export function createRogerTag(label, accent, keep) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  g.fillStyle = 'rgba(10, 14, 24, 0.75)';
  g.beginPath();
  g.roundRect(8, 8, 240, 48, 24);
  g.fill();
  g.strokeStyle = accent;
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = accent;
  g.font = '800 28px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, 128, 33);
  const texture = /** @type {THREE.CanvasTexture} */ (keep.tex(new THREE.CanvasTexture(canvas)));
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(keep.mat(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })));
  sprite.name = 'roger_tag';
  sprite.scale.set((HERO.tagHeight * 0.5) / PERSON_SCALE, (HERO.tagHeight * 0.125) / PERSON_SCALE, 1);
  sprite.position.y = HERO.tagHeight / PERSON_SCALE;
  sprite.renderOrder = 20;
  return sprite;
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
