// @ts-check
import * as THREE from 'three';
import { createSpinningStarsTexture } from '../../utils/textures.js';
import { HERO } from './config.js';
import { HEALTH } from '../health/config.js';
import { createKatanaRig } from './katana/model.js';
import { createWeaponModels } from './weaponModels.js';
import { dressAsRoger, rogerLimbs } from './rogerLook.js';

/**
 * ===========================================================================
 * SECTION HM.1 — Hero Mode's models
 * ===========================================================================
 * Roger, his rifle (in the world and in first person), the bars over his
 * head and the machines sent after him; materials and geometries
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
   * The two small bars over Roger's head (no name: removed on request,
   * 2026-10-03): HEALTH on top, green turning red when low and glowing
   * while it regenerates, and the ENERGY segments under it in gold. One
   * sprite on one little canvas, redrawn by drawOverhead only when what it
   * shows changes.
   * @returns {THREE.Sprite}
   */
  function buildOverhead() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 36;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    S.runTextures.push(texture);
    const sprite = new THREE.Sprite(keepMat(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })));
    sprite.scale.set(HERO.overheadWidth, HERO.overheadWidth * (36 / 128), 1);
    sprite.renderOrder = 20;
    sprite.userData.shown = '';
    return sprite;
  }

  /**
   * @param {THREE.Sprite} sprite
   * @param {number} health 0..1
   * @param {number} glow 0..1, regenerating
   * @param {number} energy 0..1
   * @param {number} segments how many the energy bar has
   * @returns {void}
   */
  function drawOverhead(sprite, health, glow, energy, segments) {
    const key = `${Math.round(health * 100)}|${Math.round(glow * 4)}|${Math.round(energy * 100)}`;
    if (sprite.userData.shown === key) return;
    sprite.userData.shown = key;
    const texture = /** @type {THREE.CanvasTexture} */ (/** @type {THREE.SpriteMaterial} */ (sprite.material).map);
    const canvas = /** @type {HTMLCanvasElement} */ (texture.image);
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    g.clearRect(0, 0, 128, 36);
    // A dark rounded plate behind both bars, so they read against the sky.
    g.fillStyle = 'rgba(8, 12, 20, 0.72)';
    g.beginPath();
    g.roundRect(1, 1, 126, 34, 8);
    g.fill();
    const low = health <= HEALTH.lowThreshold;
    g.fillStyle = 'rgba(120, 255, 150, 0.16)';
    g.fillRect(7, 6, 114, 11);
    g.fillStyle = low ? '#ff4a3a' : glow > 0 ? '#b8ffd0' : '#4dff8a';
    g.fillRect(7, 6, 114 * Math.max(0, Math.min(1, health)), 11);
    if (glow > 0) {
      g.strokeStyle = `rgba(184, 255, 208, ${0.4 + glow * 0.6})`;
      g.lineWidth = 2;
      g.strokeRect(6, 5, 116, 13);
    }
    const gap = 2;
    const w = (114 - gap * (segments - 1)) / segments;
    for (let i = 0; i < segments; i++) {
      const fill = Math.max(0, Math.min(1, energy * segments - i));
      const x = 7 + i * (w + gap);
      g.fillStyle = 'rgba(255, 211, 90, 0.18)';
      g.fillRect(x, 22, w, 7);
      if (fill > 0) {
        g.fillStyle = '#ffd35a';
        g.fillRect(x, 22, w * fill, 7);
      }
    }
    texture.needsUpdate = true;
  }

  /**
   * Roger as the Storm Ranger (hero/rogerLook.js dressAsRoger: a shaped
   * suit with knees, a closed helmet with a glass visor, the Storm Core on
   * his back; since 2026-10-03, replacing the leather jacket and pompadour) -- with the rifle in his
   * right hand, the bars over his head, and a ring of stars for when he is
   * dazed. Everything is added to createPerson's figure, so the limbs the
   * walk and the aim pose move are the same ones.
   * @param {number} x
   * @param {number} z
   * @returns {Object}
   */
  function buildRoger(x, z) {
    const obj = ctx.systems.people.createPerson(x, z, 90000);
    obj.mesh.name = 'hero_roger';
    const name = obj.mesh.name;
    const dressed = dressAsRoger(obj.mesh, { geo: keepGeo, mat: keepMat });
    obj.torso = dressed.torso;
    obj.core = dressed.core;
    // createPerson names its parts after the root it was built with.
    obj.limbs = rogerLimbs(obj.mesh);
    obj.armSplay = Math.abs(obj.limbs.armL.rotation.z);
    S.rifle = buildRifle();
    obj.limbs.armR.add(S.rifle);
    // The Katana's sheath, blade and swoosh (hero/katana/model.js), posed by poseRoger.
    S.katanaRig = createKatanaRig(ctx, S, { keepGeo, keepMat });
    S.katanaRig.attach(obj);
    S.overhead = buildOverhead();
    Sim.three.scene.add(S.overhead);
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
   * -z, with his gloved hand on the grip and a readout of the charge
   * on its back (like the ammo counter on a shooter's rifle). Placed in
   * front of the camera every frame rather than parented to it: the camera
   * is not in the scene graph.
   * @returns {{group: THREE.Group, muzzle: THREE.Object3D, flash: THREE.Mesh, energy: THREE.MeshBasicMaterial, panel: THREE.CanvasTexture, shown: number}}
   */
  function buildViewRifle() {
    const vm = { ...createWeaponModels({
      scene: Sim.three.scene, keepGeo, keepMat,
      keepTexture: (texture) => { S.runTextures.push(texture); return texture; }
    }).buildRifle(), shown: -1 };
    drawChargePanel(vm);
    return vm;
  }

  /**
   * The rifle's readout: READY, the charge building toward the MEGA BEAM
   * (seconds held, and a bar), or MEGA once it is there. Redrawn only when
   * what it shows changes (tenths of a second while charging).
   * @param {{panel: THREE.CanvasTexture, shown: number}} vm
   * @returns {void}
   */
  function drawChargePanel(vm) {
    const k = Math.min(1, S.state.charge / HERO.chargeSeconds);
    const value = S.state.charging ? Math.round(k * 10) : -1;
    if (value === vm.shown) return;
    vm.shown = value;
    const canvas = /** @type {HTMLCanvasElement} */ (vm.panel.image);
    const g = canvas.getContext('2d');
    const mega = value >= 10;
    g.fillStyle = '#04121c';
    g.fillRect(0, 0, 128, 80);
    g.fillStyle = mega ? '#ffd35a' : '#7fe3ff';
    g.font = `bold ${value < 0 ? 30 : 40}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(value < 0 ? 'READY' : mega ? 'MEGA' : `${(k * HERO.chargeSeconds).toFixed(1)}`, 64, 34);
    g.fillStyle = 'rgba(127, 227, 255, 0.25)';
    g.fillRect(12, 64, 104, 8);
    g.fillStyle = mega ? '#ffd35a' : '#7fe3ff';
    g.fillRect(12, 64, 104 * Math.max(0, k), 8);
    vm.panel.needsUpdate = true;
  }

  return { keepMat, keepGeo, buildRifle, buildOverhead, drawOverhead, buildRoger, buildPursuer, buildViewRifle, drawChargePanel };
}
