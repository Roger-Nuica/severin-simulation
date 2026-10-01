// @ts-check
import * as THREE from 'three';
import { soundRandom } from '../sound/random.js';

/**
 * ===========================================================================
 * SECTION AM.1 — Plugging in at a nuclear plant
 * ===========================================================================
 * Each plant has a charging terminal on the front of its pad: a squat
 * cabinet with a glowing panel. Roger standing at it on foot, while the
 * plant stands, is plugged in: an arc crackles from the terminal to him and
 * the hero's energy (engine/player/energy.js) fills to 100% in
 * CHARGER.fullSeconds from empty. He can walk away at any point and keeps
 * what he took.
 *
 * Once he has taken anything, the terminal needs CHARGER.cooldown seconds
 * before it gives again (its panel red, then green): a full recharge is
 * the reward for getting there, not a tap left open. A plant that has been
 * destroyed, or is going critical, gives nothing.
 *
 * The panel: green ready, pulsing yellow while charging, red cooling down.
 */

export const CHARGER = {
  // Where the terminal stands, in the plant's frame (+z towards town): the
  // front-left corner of the pad (52 x 48), clear of the reactor.
  local: { x: -15, z: 20 },
  reach: 4.5,          // metres from the terminal to be plugged in
  fullSeconds: 3,      // empty to full
  cooldown: 60,        // seconds after he unplugs before it gives again
  zapEvery: 0.28,      // seconds between two crackles of the arc
  arcPoints: 10
};

const PANEL_READY = new THREE.Color(0.2, 2.2, 0.6);
const PANEL_CHARGING = new THREE.Color(2.6, 2.1, 0.3);
const PANEL_COOLING = new THREE.Color(2.2, 0.15, 0.1);

/**
 * @typedef {Object} Terminal
 * @property {{x: number, z: number}} at world position
 * @property {THREE.Group} group
 * @property {THREE.MeshBasicMaterial} panelMat its own, for its colour
 * @property {number} cooldown seconds left
 * @property {boolean} gave whether this plug-in has given anything yet
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   build: (plantGroup: THREE.Group) => Terminal,
 *   update: (plants: {phase: string, terminal: Terminal}[], dt: number) => void,
 *   nearest: (plants: {phase: string, terminal: Terminal}[], x: number, z: number) => Terminal|null,
 *   release: (terminal: Terminal) => void,
 *   init: () => void,
 *   clear: () => void,
 *   dispose: () => void
 * }}
 */
export function createPlantCharger(ctx) {
  const { Sim } = ctx;
  /** @type {THREE.Line|null} the arc to Roger (one Roger) */
  let arc = null;
  /** @type {Terminal|null} the terminal he is plugged into */
  let plugged = null;
  /** @type {Terminal|null} the cooling terminal he was last told about */
  let warned = null;
  let zapTimer = 0;
  let time = 0;
  const cabinetGeo = new THREE.BoxGeometry(1.6, 2.4, 1.1);
  const panelGeo = new THREE.PlaneGeometry(1.1, 0.8);
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.6, 6);
  const cabinetMat = new THREE.MeshStandardMaterial({ color: 0x3b4148, roughness: 0.6, metalness: 0.4 });

  /** @returns {void} the arc's line, made once */
  function init() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CHARGER.arcPoints * 3), 3));
    arc = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: new THREE.Color(1.6, 2.4, 3), transparent: true, opacity: 0.95 }));
    arc.name = 'nuclear_charge_arc';
    arc.frustumCulled = false;
    arc.visible = false;
    Sim.three.scene.add(arc);
  }

  /**
   * The terminal for one plant, added to its group.
   * @param {THREE.Group} plantGroup
   * @returns {Terminal}
   */
  function build(plantGroup) {
    const group = new THREE.Group();
    group.name = 'nuclear_terminal';
    group.position.set(CHARGER.local.x, 0, CHARGER.local.z);
    const cabinet = new THREE.Mesh(cabinetGeo, cabinetMat);
    cabinet.position.y = 1.2;
    cabinet.castShadow = true;
    const panelMat = new THREE.MeshBasicMaterial({ color: PANEL_READY.clone() });
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.position.set(0, 1.6, 0.56);
    // The socket the arc leaves from.
    const pole = new THREE.Mesh(poleGeo, cabinetMat);
    pole.position.set(0, 3.2, 0);
    group.add(cabinet, panel, pole);
    plantGroup.add(group);
    plantGroup.updateMatrixWorld(true);
    const world = new THREE.Vector3(0, 0, 0).applyMatrix4(group.matrixWorld);
    return { at: { x: world.x, z: world.z }, group, panelMat, cooldown: 0, gave: false };
  }

  /**
   * The terminal nearest (x, z) at a plant still standing.
   * @param {{phase: string, terminal: Terminal}[]} plants
   * @param {number} x
   * @param {number} z
   * @returns {Terminal|null}
   */
  function nearest(plants, x, z) {
    let best = null;
    let bestD = Infinity;
    for (const plant of plants) {
      if (plant.phase !== 'standing') continue;
      const d = Math.hypot(plant.terminal.at.x - x, plant.terminal.at.z - z);
      if (d < bestD) { bestD = d; best = plant.terminal; }
    }
    return best;
  }

  /**
   * @param {string} text
   * @returns {void}
   */
  function say(text) {
    ctx.events.emit('notice', { text });
  }

  /**
   * He has walked off (or the plant is gone): the terminal cools down if
   * it gave anything.
   * @returns {void}
   */
  function unplug() {
    if (!plugged) return;
    if (plugged.gave) plugged.cooldown = CHARGER.cooldown;
    plugged.gave = false;
    plugged = null;
    if (arc) arc.visible = false;
  }

  /**
   * The arc from the socket to Roger's chest, jittered every frame.
   * @param {Terminal} terminal
   * @param {{x: number, z: number}} roger
   * @returns {void}
   */
  function drawArc(terminal, roger) {
    if (!arc) return;
    const positions = /** @type {THREE.BufferAttribute} */ (arc.geometry.attributes.position);
    const n = CHARGER.arcPoints;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const wobble = i === 0 || i === n - 1 ? 0 : 0.45;
      positions.setXYZ(i,
        THREE.MathUtils.lerp(terminal.at.x, roger.x, t) + (soundRandom() - 0.5) * wobble,
        THREE.MathUtils.lerp(4, 1.4, t) + Math.sin(t * Math.PI) * 1.2 + (soundRandom() - 0.5) * wobble,
        THREE.MathUtils.lerp(terminal.at.z, roger.z, t) + (soundRandom() - 0.5) * wobble);
    }
    positions.needsUpdate = true;
    arc.visible = true;
  }

  /**
   * Per frame: the panels, and Roger plugged in or not.
   * @param {{phase: string, terminal: Terminal}[]} plants
   * @param {number} dt
   * @returns {void}
   */
  function update(plants, dt) {
    time += dt;
    for (const plant of plants) {
      const t = plant.terminal;
      if (t.cooldown > 0) t.cooldown = Math.max(0, t.cooldown - dt);
      const colour = plant.phase !== 'standing' || t.cooldown > 0 ? PANEL_COOLING
        : t === plugged ? PANEL_CHARGING : PANEL_READY;
      const pulse = t === plugged ? 0.6 + 0.4 * Math.sin(time * 14) : 1;
      t.panelMat.color.copy(colour).multiplyScalar(pulse);
    }

    const hero = ctx.systems.heroMode;
    const roger = hero && hero.rogerTarget();
    const terminal = roger && roger.onFoot ? nearest(plants, roger.x, roger.z) : null;
    const inReach = !!terminal && Math.hypot(terminal.at.x - roger.x, terminal.at.z - roger.z) < CHARGER.reach;
    if (!roger || !inReach) {
      unplug();
      warned = null;
      return;
    }
    if (plugged !== terminal) {
      unplug();
      if (terminal.cooldown > 0) {
        // Said once as he arrives, not every frame he stands there.
        if (warned !== terminal) say(`🔌 TERMINAL COOLING DOWN · ${Math.ceil(terminal.cooldown)} s`);
        warned = terminal;
        return;
      }
      plugged = terminal;
      zapTimer = 0;
      say('🔌 PLUGGED IN · CHARGING');
    }
    const energy = ctx.systems.energy;
    if (energy.hero.level() >= 1) {
      if (plugged.gave) say('⚡ FULLY CHARGED');
      // Already told: no "cooling down" the next frame he stands there.
      warned = plugged;
      unplug();
      return;
    }
    const got = energy.hero.charge(dt / CHARGER.fullSeconds);
    if (got > 0) {
      plugged.gave = true;
      energy.glow();
    }
    drawArc(plugged, roger);
    zapTimer -= dt;
    if (zapTimer <= 0) {
      zapTimer = CHARGER.zapEvery;
      if (ctx.systems.powerArcSound) ctx.systems.powerArcSound.playZap(0.35);
    }
  }

  /**
   * One plant's terminal freed (the plant is being removed).
   * @param {Terminal} terminal
   * @returns {void}
   */
  function release(terminal) {
    if (plugged === terminal) unplug();
    terminal.panelMat.dispose();
  }

  /** @returns {void} a Reset */
  function clear() {
    unplug();
    warned = null;
    zapTimer = 0;
  }

  /** @returns {void} */
  function dispose() {
    clear();
    if (arc) {
      Sim.three.scene.remove(arc);
      arc.geometry.dispose();
      /** @type {THREE.Material} */ (arc.material).dispose();
    }
    arc = null;
    cabinetGeo.dispose();
    panelGeo.dispose();
    poleGeo.dispose();
    cabinetMat.dispose();
  }

  return { build, update, nearest, release, init, clear, dispose };
}
