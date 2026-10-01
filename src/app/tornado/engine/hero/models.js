// @ts-check
import * as THREE from 'three';
import { createSpinningStarsTexture } from '../../utils/textures.js';
import { HERO } from './config.js';

/**
 * ===========================================================================
 * SECTION HM.1 — Hero Mode's models
 * ===========================================================================
 * Roger, his rifle (in the world and in first person), his name tag, the
 * bunker marker and the machines sent after him; materials and geometries
 * made for a run are kept (keepMat, keepGeo) and disposed when it ends.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see heroMode.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createHeroModels(ctx, S, api) {
  const { Sim, container } = ctx;

  // ---------------------------------------------------------------------
  // Models
  // ---------------------------------------------------------------------

  /**
   * @template {THREE.Material} M
   * @param {M} material
   * @returns {M}
   */
  function keepMat(material) {
    S.runMaterials.push(material);
    return material;
  }

  /**
   * @template {THREE.BufferGeometry} G
   * @param {G} geometry
   * @returns {G}
   */
  function keepGeo(geometry) {
    S.runGeometries.push(geometry);
    return geometry;
  }

  /**
   * The plasma rifle: a long, angular dark body with a glowing blue energy
   * strip along its top, a finned barrel and a glowing muzzle. Built along
   * +z in the arm's own (pre-scale) units, then turned to hang along the
   * arm, so it points wherever the raised arm points.
   * @returns {THREE.Group}
   */
  function buildRifle() {
    const group = new THREE.Group();
    group.name = 'hero_rifle';
    const dark = keepMat(new THREE.MeshStandardMaterial({ color: 0x2a2f3a, metalness: 0.7, roughness: 0.35 }));
    const trim = keepMat(new THREE.MeshStandardMaterial({ color: 0x8c96a8, metalness: 0.8, roughness: 0.25 }));
    const energy = keepMat(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.7, 4.2) }));
    /**
     * @param {THREE.BufferGeometry} geo
     * @param {THREE.Material} mat
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {THREE.Mesh}
     */
    const part = (geo, mat, x, y, z) => {
      const mesh = new THREE.Mesh(keepGeo(geo), mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      group.add(mesh);
      return mesh;
    };
    part(new THREE.BoxGeometry(0.07, 0.11, 0.24), dark, 0, -0.01, -0.14);        // stock
    part(new THREE.BoxGeometry(0.1, 0.13, 0.52), dark, 0, 0.02, 0.2);           // body
    part(new THREE.BoxGeometry(0.06, 0.05, 0.44), trim, 0, 0.1, 0.22);          // top ridge
    part(new THREE.BoxGeometry(0.028, 0.03, 0.66), energy, 0, 0.135, 0.26);     // energy strip
    for (const side of [-1, 1]) {
      part(new THREE.BoxGeometry(0.02, 0.03, 0.5), energy, side * 0.052, 0.02, 0.22);
      const fin = part(new THREE.BoxGeometry(0.16, 0.012, 0.13), trim, side * 0.1, 0.03, 0.44);
      fin.rotation.z = side * 0.35;
    }
    part(new THREE.BoxGeometry(0.05, 0.12, 0.06), dark, 0, -0.1, 0.02);         // grip
    const barrel = part(new THREE.CylinderGeometry(0.03, 0.036, 0.36, 8), trim, 0, 0.03, 0.62);
    barrel.rotation.x = Math.PI / 2;
    const tip = part(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10), energy, 0, 0.03, 0.8);
    tip.rotation.x = Math.PI / 2;
    S.muzzle = new THREE.Object3D();
    S.muzzle.position.set(0, 0.03, 0.84);
    group.add(S.muzzle);
    // Hung along the arm: the arm's geometry runs down -y from the shoulder,
    // so the rifle's +z is turned onto -y, the grip at the hand.
    group.rotation.x = Math.PI / 2;
    group.position.set(0, -0.44, 0.03);
    group.visible = false;
    return group;
  }

  /**
   * A text sprite for Roger's name tag.
   * @returns {THREE.Sprite}
   */
  function buildNameTag() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const g = canvas.getContext('2d');
    g.fillStyle = 'rgba(10, 14, 24, 0.75)';
    g.beginPath();
    g.roundRect(8, 8, 240, 48, 24);
    g.fill();
    g.strokeStyle = '#ffc94d';
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = '#ffe7a8';
    g.font = '800 30px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('ROGER', 128, 33);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    S.runTextures.push(texture);
    const sprite = new THREE.Sprite(keepMat(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })));
    sprite.scale.set(HERO.tagHeight * 0.5, HERO.tagHeight * 0.125, 1);
    sprite.renderOrder = 20;
    return sprite;
  }

  /**
   * The bunker's own glyph: a gold plate with a squat bunker and door, and
   * BUNKER under it -- nothing like the green shelter signs.
   * @returns {THREE.Texture}
   */
  function bunkerGlyphTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffb627';
    g.beginPath();
    g.roundRect(6, 6, 116, 116, 22);
    g.fill();
    g.strokeStyle = '#fff4d0';
    g.lineWidth = 6;
    g.stroke();
    g.fillStyle = '#1a1206';
    g.beginPath();
    g.moveTo(24, 78);
    g.lineTo(40, 40);
    g.lineTo(88, 40);
    g.lineTo(104, 78);
    g.closePath();
    g.fill();
    g.fillStyle = '#ffb627';
    g.fillRect(56, 54, 16, 24);
    g.fillStyle = '#1a1206';
    g.font = '900 20px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('BUNKER', 64, 104);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    S.runTextures.push(texture);
    return texture;
  }

  /**
   * The bunker marker: a tall gold beacon of light, the glyph floating over
   * it, and a ring on the ground showing where to stand.
   * @returns {THREE.Group}
   */
  function buildMarker() {
    const group = new THREE.Group();
    group.name = 'hero_bunker_marker';
    const beaconMat = keepMat(new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.4, 1.3, 0.25), transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    }));
    const outer = new THREE.Mesh(keepGeo(new THREE.CylinderGeometry(1.6, 2.4, 90, 16, 1, true)), beaconMat);
    outer.position.y = 45;
    group.add(outer);
    const coreMat = keepMat(new THREE.MeshBasicMaterial({
      color: new THREE.Color(4, 3, 1.2), transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    const core = new THREE.Mesh(keepGeo(new THREE.CylinderGeometry(0.35, 0.5, 90, 8, 1, true)), coreMat);
    core.position.y = 45;
    group.add(core);
    const glyph = new THREE.Sprite(keepMat(new THREE.SpriteMaterial({ map: bunkerGlyphTexture(), transparent: true })));
    glyph.scale.set(7, 7, 1);
    glyph.position.y = 17;
    glyph.name = 'hero_bunker_glyph';
    group.add(glyph);
    const ring = new THREE.Mesh(keepGeo(new THREE.RingGeometry(HERO.winRadius - 0.6, HERO.winRadius, 40)), keepMat(new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.2, 1.3, 0.3), transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    })));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    group.add(ring);
    group.userData.glyph = glyph;
    group.userData.ring = ring;
    return group;
  }

  /**
   * Roger, made cool on request: a muscled build (broad chest, big
   * shoulders and arms), a black leather jacket over a white T-shirt with its
   * collar up, dark jeans, black boots, an Elvis Presley pompadour with
   * sideburns, and dark glasses -- with the rifle in his right hand, a name
   * tag and a ring of stars for when he is dazed. (He was a town figure in a
   * red jacket and blue jeans.) Everything is added to createPerson's
   * figure, so the limbs the walk and the aim pose move are the same ones.
   * @param {number} x
   * @param {number} z
   * @returns {Object}
   */
  function buildRoger(x, z) {
    const obj = ctx.systems.people.createPerson(x, z, 90000);
    obj.mesh.name = 'hero_roger';
    const name = obj.mesh.name;
    const leather = keepMat(new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 0.32, metalness: 0.25 }));
    const jeans = keepMat(new THREE.MeshStandardMaterial({ color: 0x1d2a44, roughness: 0.85 }));
    const tee = keepMat(new THREE.MeshStandardMaterial({ color: 0xf1efe8, roughness: 0.8 }));
    const hair = keepMat(new THREE.MeshStandardMaterial({ color: 0x0b0a0d, roughness: 0.25, metalness: 0.35 }));
    const shades = keepMat(new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.05, metalness: 0.9 }));
    const boot = keepMat(new THREE.MeshStandardMaterial({ color: 0x0c0b0a, roughness: 0.4, metalness: 0.2 }));
    let skin = null;
    const replaced = new Set();
    obj.mesh.traverse((child) => {
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
      const mesh = new THREE.Mesh(keepGeo(geometry), material);
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
    obj.quiff = quiff;
    obj.torso = torso;
    // createPerson names its parts after the root it was built with.
    const limb = (/** @type {string} */ part) => obj.mesh.children.find(c => c.name.endsWith(part));
    obj.limbs = { legL: limb('_legL'), legR: limb('_legR'), armL: limb('_armL'), armR: limb('_armR') };
    obj.armSplay = Math.abs(obj.limbs.armL.rotation.z);
    S.rifle = buildRifle();
    obj.limbs.armR.add(S.rifle);
    S.nameTag = buildNameTag();
    Sim.three.scene.add(S.nameTag);
    const starsTexture = createSpinningStarsTexture();
    S.runTextures.push(starsTexture);
    S.stars = new THREE.Sprite(keepMat(new THREE.SpriteMaterial({ map: starsTexture, transparent: true, depthWrite: false })));
    S.stars.scale.set(HERO.starsSize, HERO.starsSize, 1);
    S.stars.visible = false;
    Sim.three.scene.add(S.stars);
    obj.captureState = 'grounded';
    obj.heroName = name;
    return obj;
  }

  /**
   * The pursuer: the Terminator's own build (terminator.js buildModel),
   * taller, in dark gunmetal, with a red core glowing in its chest besides
   * the eyes.
   * @param {number} x
   * @param {number} z
   * @returns {Object}
   */
  function buildPursuer(x, z) {
    const unit = ctx.systems.terminator.buildModel();
    unit.root.name = 'hero_pursuer';
    unit.root.scale.multiplyScalar(HERO.pursuerScale);
    const [chrome, joint] = unit.materials;
    chrome.color.set(0x3a4049);
    chrome.emissive.set(0x0b0c0f);
    joint.color.set(0x15171b);
    const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.25, 0.1) });
    const coreGeo = new THREE.SphereGeometry(0.055, 8, 6);
    unit.materials.push(coreMat);
    unit.geometries.push(coreGeo);
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.set(0, 1.2, 0.11);
    unit.joints.body.add(core);
    unit.root.position.set(x, 0, z);
    Sim.three.scene.add(unit.root);
    return unit;
  }

  // ---------------------------------------------------------------------
  // Aim mode: first person, and the plasma beam
  // ---------------------------------------------------------------------

  /**
   * The rifle as seen down its length from Roger's eyes, for aim mode: the
   * same plasma rifle, built bigger and in more detail, along the camera's
   * -z, with his gloved hand on the grip and a readout of the plasma cell
   * on its back (like the ammo counter on a shooter's rifle). Placed in
   * front of the camera every frame rather than parented to it: the camera
   * is not in the scene graph.
   * @returns {{group: THREE.Group, muzzle: THREE.Object3D, flash: THREE.Mesh, energy: THREE.MeshBasicMaterial, panel: THREE.CanvasTexture, shown: number}}
   */
  function buildViewRifle() {
    const group = new THREE.Group();
    group.name = 'hero_view_rifle';
    const dark = keepMat(new THREE.MeshStandardMaterial({ color: 0x2c323d, metalness: 0.75, roughness: 0.32, emissive: 0x0c1016 }));
    const trim = keepMat(new THREE.MeshStandardMaterial({ color: 0x8d98aa, metalness: 0.85, roughness: 0.22, emissive: 0x151a22 }));
    const glove = keepMat(new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.8 }));
    // His leather jacket's sleeve (buildRoger).
    const sleeve = keepMat(new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 0.32, metalness: 0.25 }));
    // Barely over 1: this close to the eye, anything brighter blooms the
    // whole rifle into one blue glare.
    const energy = keepMat(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.22, 0.8, 1.35) }));
    /**
     * @param {THREE.BufferGeometry} geo
     * @param {THREE.Material} mat
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {THREE.Mesh}
     */
    const part = (geo, mat, x, y, z) => {
      const mesh = new THREE.Mesh(keepGeo(geo), mat);
      mesh.position.set(x, y, z);
      mesh.frustumCulled = false;
      group.add(mesh);
      return mesh;
    };
    part(new THREE.BoxGeometry(0.17, 0.2, 0.62), dark, 0, 0, -0.35);            // receiver
    part(new THREE.BoxGeometry(0.14, 0.16, 0.5), dark, 0, 0.01, -0.86);         // fore-end
    part(new THREE.BoxGeometry(0.09, 0.05, 0.9), trim, 0, 0.125, -0.55);        // top rail
    part(new THREE.BoxGeometry(0.03, 0.03, 0.95), energy, 0, 0.16, -0.56);      // energy strip
    for (const side of [-1, 1]) {
      part(new THREE.BoxGeometry(0.02, 0.045, 0.8), energy, side * 0.088, 0.01, -0.58);
      const fin = part(new THREE.BoxGeometry(0.2, 0.015, 0.2), trim, side * 0.12, 0.03, -0.98);
      fin.rotation.z = side * 0.35;
    }
    const barrel = part(new THREE.CylinderGeometry(0.045, 0.055, 0.5, 12), trim, 0, 0.02, -1.3);
    barrel.rotation.x = Math.PI / 2;
    const ring = part(new THREE.TorusGeometry(0.07, 0.018, 8, 20), energy, 0, 0.02, -1.55);
    ring.rotation.y = 0;
    const tip = part(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 12), energy, 0, 0.02, -1.58);
    tip.rotation.x = Math.PI / 2;
    // The readout, on the back of the receiver facing the eye.
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 80;
    const panel = new THREE.CanvasTexture(canvas);
    panel.colorSpace = THREE.SRGBColorSpace;
    S.runTextures.push(panel);
    const screen = part(new THREE.PlaneGeometry(0.15, 0.094), keepMat(new THREE.MeshBasicMaterial({ map: panel, toneMapped: false })), 0, 0.16, -0.12);
    screen.rotation.x = -0.55;
    // His hand on the grip and the red sleeve running out of shot.
    part(new THREE.BoxGeometry(0.13, 0.14, 0.2), glove, 0.01, -0.14, -0.22);
    const arm = part(new THREE.CylinderGeometry(0.075, 0.09, 0.7, 10), sleeve, 0.06, -0.33, 0.1);
    arm.rotation.x = 1.0;
    // The other hand, under the fore-end.
    part(new THREE.BoxGeometry(0.12, 0.1, 0.18), glove, -0.02, -0.12, -0.9);
    const arm2 = part(new THREE.CylinderGeometry(0.07, 0.085, 0.9, 10), sleeve, -0.2, -0.38, -0.62);
    arm2.rotation.set(0.9, 0, -0.6);
    const muzzleNode = new THREE.Object3D();
    muzzleNode.position.set(0, 0.02, -1.62);
    group.add(muzzleNode);
    const flashMesh = new THREE.Mesh(keepGeo(new THREE.SphereGeometry(0.12, 12, 8)), keepMat(new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.8, 1.8, 4), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
    })));
    flashMesh.visible = false;
    flashMesh.frustumCulled = false;
    muzzleNode.add(flashMesh);
    group.traverse((child) => { child.castShadow = false; child.receiveShadow = false; });
    group.visible = false;
    Sim.three.scene.add(group);
    const vm = { group, muzzle: muzzleNode, flash: flashMesh, energy, panel, shown: -1 };
    drawCellPanel(vm);
    return vm;
  }

  /**
   * The rifle's readout: the cell as a big number, and a bar under it.
   * Redrawn only when the whole-number value changes.
   * @param {{panel: THREE.CanvasTexture, shown: number}} vm
   * @returns {void}
   */
  function drawCellPanel(vm) {
    const value = Math.floor(S.state.cell);
    if (value === vm.shown) return;
    vm.shown = value;
    const canvas = /** @type {HTMLCanvasElement} */ (vm.panel.image);
    const g = canvas.getContext('2d');
    const ready = S.state.cell >= HERO.cellCost;
    g.fillStyle = '#04121c';
    g.fillRect(0, 0, 128, 80);
    g.fillStyle = ready ? '#7fe3ff' : '#ff7a5a';
    g.font = 'bold 44px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(value), 64, 34);
    g.fillStyle = 'rgba(127, 227, 255, 0.25)';
    g.fillRect(12, 64, 104, 8);
    g.fillStyle = ready ? '#7fe3ff' : '#ff7a5a';
    g.fillRect(12, 64, 104 * (S.state.cell / 100), 8);
    vm.panel.needsUpdate = true;
  }

  return { keepMat, keepGeo, buildRifle, buildNameTag, bunkerGlyphTexture, buildMarker, buildRoger, buildPursuer, buildViewRifle, drawCellPanel };
}
