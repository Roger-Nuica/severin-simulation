// @ts-check
import * as THREE from 'three';
import { KATANA_FEEL as CFG } from './config.js';

/**
 * ===========================================================================
 * SECTION KT.9 -- Game feel and scoring of a cut
 * ===========================================================================
 * What a landed cut feels like, and what it is worth.
 *
 *  - **Hit-stop.** A short world hold under the Katana's own time-hold id
 *    (`katanaHitStop`), so it never releases Time Slow, Bullet Time or any
 *    other hold. It is timed and released on REAL time (the weapons' raw
 *    dt), so it ends in slow motion too and is frame-rate independent. A
 *    cut during a running hold does not extend it, and a refractory gap
 *    follows it, so cuts cannot stack into a long freeze (R-029, R-032).
 *  - **Shake.** `gamefeel.event('slice', at)` carries the small per-cut
 *    shake; a multi-cut adds a bigger `addShake` on top (the stronger wins).
 *  - **Flash.** One pooled additive quad along the cut line, made on first
 *    use, reused by every cut, fading on real time. The last cut of a slash
 *    owns it.
 *  - **Combo and score.** Each landed slash calls `gamefeel.event('slice')`
 *    immediately before ONE `damage.addDamageScore` (R-026, R-027). The
 *    score is additive: nothing for the first alien (its base kill is scored
 *    once by sliceKill), `multiCutBonus` for each further alien in the same
 *    slash and `extraPieceBonus` for each piece cut again. The combo and
 *    Firenado multipliers are applied once, inside addDamageScore. GameFeel's
 *    own slow-motion and its 6 s cooldown are never touched from here.
 *
 * No alien stagger: sliceKill hands the alien over at the strike, and a
 * delay there would complicate the takeOver contract.
 *
 * State lives in this closure; `clear` (run end) releases the hold and takes
 * the flash out of the scene, `dispose` frees the flash (R-047). Nothing is
 * allocated per cut or per frame (R-048).
 */

/**
 * @typedef {Object} KatanaFeel
 * @property {(aliens: number, pieces: number, at: THREE.Vector3, people?: number) => number} cut a slash landed: hit-stop, shake, combo event and score; returns the bonus points scored
 * @property {(from: THREE.Vector3, to: THREE.Vector3) => void} flash lights the cut line
 * @property {(realDt: number) => void} update per frame, real seconds
 * @property {() => void} clear hold released, flash removed
 * @property {() => void} dispose
 * @property {() => boolean} holding whether the hit-stop hold is on (for checks)
 */

/**
 * The bonus a slash earns beyond the base kill.
 * @param {number} aliens aliens cut by the slash
 * @param {number} pieces pieces cut again by it
 * @returns {number} points, before the combo and Firenado multipliers
 */
export const sliceBonus = (aliens, pieces) =>
  Math.max(0, aliens - 1) * CFG.multiCutBonus + Math.max(0, pieces) * CFG.extraPieceBonus;

/**
 * @param {Object} ctx
 * @returns {KatanaFeel}
 */
export function createKatanaFeel(ctx) {
  const { Sim } = ctx;
  /** Real seconds of hit-stop left, and of the gap before the next may start. */
  let holdLeft = 0;
  let refractory = 0;
  let flashLeft = 0;
  /** @type {THREE.Mesh|null} */
  let flashMesh = null;
  /** @type {THREE.MeshBasicMaterial|null} */
  let flashMaterial = null;
  /** @type {THREE.PlaneGeometry|null} */
  let flashGeometry = null;
  const xAxis = new THREE.Vector3();
  const yAxis = new THREE.Vector3();
  const zAxis = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const basis = new THREE.Matrix4();

  /**
   * Starts the hit-stop unless one is running or has just ended.
   * @returns {void}
   */
  function startHold() {
    if (holdLeft > 0 || refractory > 0 || !ctx.systems.time) return;
    holdLeft = CFG.holdSeconds;
    ctx.systems.time.hold(CFG.holdId, 'world', CFG.holdScale);
  }

  /** @returns {void} */
  function stopHold() {
    if (ctx.systems.time) ctx.systems.time.release(CFG.holdId);
    holdLeft = 0;
  }

  /**
   * @param {number} aliens
   * @param {number} pieces
   * @param {THREE.Vector3} at where the cut landed, for the shake falloff
   * @param {number} [people] civilians cut: they trigger the hit-stop, the
   *   combo event and the shake, but earn no multi-cut bonus (each is scored once, by the cut itself)
   * @returns {number}
   */
  function cut(aliens, pieces, at, people = 0) {
    if (aliens + pieces + people <= 0) return 0;
    startHold();
    const feel = ctx.systems.gamefeel;
    if (feel) {
      // The event first: it extends the chain, then the score below is
      // multiplied by the chain's new value, once.
      feel.event('slice', at);
      if (aliens + pieces + people > 1) feel.addShake(CFG.multiShake, CFG.multiShakeTime);
    }
    const bonus = sliceBonus(aliens, pieces);
    if (ctx.systems.damage) ctx.systems.damage.addDamageScore(bonus);
    return bonus;
  }

  /**
   * Builds the one flash quad, on first use.
   * @returns {THREE.Mesh}
   */
  function ensureFlash() {
    if (flashMesh) return flashMesh;
    flashGeometry = new THREE.PlaneGeometry(1, 1);
    flashMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(CFG.flashColour[0], CFG.flashColour[1], CFG.flashColour[2]),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false
    });
    flashMesh = new THREE.Mesh(flashGeometry, flashMaterial);
    flashMesh.renderOrder = 999;
    flashMesh.frustumCulled = false;
    return flashMesh;
  }

  /**
   * Lays the flash along the cut line, its face turned to the camera.
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} to
   * @returns {void}
   */
  function flash(from, to) {
    const mesh = ensureFlash();
    xAxis.subVectors(to, from);
    const length = xAxis.length();
    if (length < 1e-4) return;
    xAxis.multiplyScalar(1 / length);
    mid.addVectors(from, to).multiplyScalar(0.5);
    zAxis.subVectors(Sim.three.camera.position, mid).normalize();
    yAxis.crossVectors(zAxis, xAxis);
    if (yAxis.lengthSq() < 1e-6) return;
    yAxis.normalize();
    zAxis.crossVectors(xAxis, yAxis);
    basis.makeBasis(xAxis, yAxis, zAxis);
    mesh.quaternion.setFromRotationMatrix(basis);
    mesh.position.copy(mid);
    mesh.scale.set(length * 1.15, CFG.flashThickness, 1);
    if (!mesh.parent) Sim.three.scene.add(mesh);
    mesh.visible = true;
    flashLeft = CFG.flashSeconds;
    if (flashMaterial) flashMaterial.opacity = 1;
  }

  /**
   * @param {number} realDt real seconds (the weapons' raw dt)
   * @returns {void}
   */
  function update(realDt) {
    if (holdLeft > 0) {
      holdLeft -= realDt;
      if (holdLeft <= 0) {
        stopHold();
        refractory = CFG.holdRefractory;
      }
    } else if (refractory > 0) {
      refractory = Math.max(0, refractory - realDt);
    }
    if (flashLeft > 0 && flashMesh && flashMaterial) {
      flashLeft -= realDt;
      if (flashLeft <= 0) {
        flashMesh.visible = false;
      } else {
        const k = flashLeft / CFG.flashSeconds;
        flashMaterial.opacity = k;
        flashMesh.scale.y = CFG.flashThickness * (0.4 + 0.6 * k);
      }
    }
  }

  /** @returns {void} */
  function clear() {
    stopHold();
    refractory = 0;
    flashLeft = 0;
    if (flashMesh) {
      flashMesh.visible = false;
      Sim.three.scene.remove(flashMesh);
    }
  }

  /** @returns {void} */
  function dispose() {
    clear();
    if (flashGeometry) flashGeometry.dispose();
    if (flashMaterial) flashMaterial.dispose();
    flashMesh = null;
    flashGeometry = null;
    flashMaterial = null;
  }

  return { cut, flash, update, clear, dispose, holding: () => holdLeft > 0 };
}
