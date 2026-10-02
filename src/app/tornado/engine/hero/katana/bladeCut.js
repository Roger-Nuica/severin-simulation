// @ts-check
import * as THREE from 'three';
import { KATANA_BLADE as CFG, KATANA_BLADE_UI } from './config.js';
import { createKatanaTargets, inReach } from './targets.js';
import { classifySwipe } from './slash.js';

/**
 * ===========================================================================
 * SECTION KT.13 -- Blade Mode cut resolution
 * ===========================================================================
 * Turns the line the player drew into a cut.
 *
 *  - **The plane.** The screen line's two ends are turned into normalised
 *    device coordinates with the canvas's own rectangle, unprojected through
 *    the camera's matrices of the frame the cut EXECUTES in (the follow
 *    camera is lerped every frame, so the press frame would be wrong), and
 *    the plane passes through the camera and both points. Anything the drawn
 *    line crosses on screen therefore lies on the plane: the cut runs exactly
 *    along the line. Its point stays at the camera (it is never re-aimed at
 *    a chest, unlike the quick slash's plane), so the line is kept.
 *  - **What it touches.** The aliens (and lying pieces) within
 *    KATANA_BLADE_UI.highlightReach of Roger, the same ring that lights them
 *    up, re-tested against their CURRENT positions. The plane must pass
 *    within KATANA_BLADE.bodyRadius of the alien's body axis (feet to head),
 *    so a mere graze, whose cap would be larger than the silhouette, cuts
 *    nothing; and the crossing point must project near the drawn segment, so
 *    an alien elsewhere on the infinite plane is not cut. Every other kind in
 *    the line's way parries (the T-Rex accepts `blade` for the samurai, R-020,
 *    so it is never sent one, R-013).
 *  - **The window.** One press-drag-release is one cut. While the mode stays
 *    on, the next press-drag-release is the next cut (blade.js decides when
 *    the mode ends). Pieces already lying about are cut first, so the halves
 *    this very cut makes are not cut by it again; each piece can go as deep as
 *    the slicing core allows.
 *  - **Feel and score.** One `feel.cut` per executed cut (hit-stop, shake,
 *    combo event, bonus score for extra aliens or pieces); the base kill is
 *    scored once in the alien owner. The camera is never moved.
 *  - **No lunge.** Blade Mode is for what is already near (the highlighted
 *    ring); Roger does not slide.
 *
 * State lives in this closure, made once per simulation by heroWeapons.js.
 * Nothing is allocated per cut apart from the canvas's rectangle (R-048).
 */

/** Pieces that can be cut in one go (the slicing core's own cap is far lower). */
const MAX_PIECES = 64;
/** The body height the plane is tested against for a piece's pivot, metres. */
const PIECE_HEIGHT = 0;

/**
 * @typedef {Object} View the canvas's rectangle, in the same pixels as the cursor
 * @property {number} left
 * @property {number} top
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {'none'|'miss'|'cut'} CutOutcome
 *   `none`: no line was drawn (nothing happens, the mode stays on); `miss`: a line, but it
 *   crossed nothing; `cut`: something was cut
 */

/**
 * @typedef {Object} KatanaBladeCutEnv what the cut needs from Hero Mode
 * @property {() => Readonly<{pressX: number, pressY: number, cursorX: number, cursorY: number}>} input
 *   the Katana's live input (heroWeapons.katanaState)
 * @property {() => {x: number, y: number, z: number}} position Roger's position
 * @property {() => ({slash: (kind: import('./model.js').SlashKind) => boolean, isSlashing: () => boolean}|null)} rig
 * @property {() => (import('./pieces.js').KatanaPieces|null)} pieces
 * @property {() => (import('./feel.js').KatanaFeel|null)} feel
 */

/**
 * @typedef {Object} KatanaBladeCut
 * @property {() => CutOutcome} resolve cut along the line drawn by the press that just ended
 * @property {(x0: number, y0: number, x1: number, y1: number, view: View, out: import('./targets.js').CutPlaneLike) => boolean} planeFor
 *   aims `out` (point at the camera, unit normal) along a screen line, using
 *   the camera's current matrices; false if the line is degenerate
 */

/**
 * @param {Object} ctx
 * @param {KatanaBladeCutEnv} env
 * @returns {KatanaBladeCut}
 */
export function createKatanaBladeCut(ctx, env) {
  const { Sim } = /** @type {any} */ (ctx);
  const targets = createKatanaTargets(ctx);
  /** @type {import('./slash.js').CutPlane} */
  const plane = { point: new THREE.Vector3(), normal: new THREE.Vector3(0, 0, 1), kind: 'vertical' };
  /** @type {View} */
  const view = { left: 0, top: 0, width: 1, height: 1 };
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const cross = new THREE.Vector3();
  /** The point being tested, then its normalised device position. */
  const probe = new THREE.Vector3();
  const toBody = new THREE.Vector3();
  const back = new THREE.Vector3();
  const roger = new THREE.Vector3();
  /** The reach query: a full circle round Roger, the highlight's range. */
  const reach = { x: 0, z: 0, dirX: 0, dirZ: 1, reach: KATANA_BLADE_UI.highlightReach, cosArc: -1 };
  /** The drawn line in pixels, kept for the tests while a cut resolves. */
  const line = { x0: 0, y0: 0, x1: 0, y1: 0 };
  /** @type {any[]} */
  const candidates = new Array(MAX_PIECES).fill(null);
  let candidateCount = 0;

  /**
   * Aims `out` along a screen line: a plane through the camera and the two
   * unprojected ends.
   * @param {number} x0 pixels
   * @param {number} y0
   * @param {number} x1
   * @param {number} y1
   * @param {View} rect
   * @param {import('./targets.js').CutPlaneLike} out
   * @returns {boolean}
   */
  function planeFor(x0, y0, x1, y1, rect, out) {
    const cam = Sim.three.camera;
    // The frame the cut executes in, not the press: the follow camera moves.
    cam.updateMatrixWorld();
    a.set(((x0 - rect.left) / rect.width) * 2 - 1, -((y0 - rect.top) / rect.height) * 2 + 1, 0.5).unproject(cam);
    b.set(((x1 - rect.left) / rect.width) * 2 - 1, -((y1 - rect.top) / rect.height) * 2 + 1, 0.5).unproject(cam);
    out.point.setFromMatrixPosition(cam.matrixWorld);
    a.sub(out.point);
    b.sub(out.point);
    cross.crossVectors(a, b);
    if (cross.lengthSq() < 1e-12) return false;
    out.normal.copy(cross).normalize();
    return true;
  }

  /**
   * Distance in pixels from the point (px, py) to the drawn segment.
   * @param {number} px
   * @param {number} py
   * @returns {number}
   */
  function pixelsFromLine(px, py) {
    const dx = line.x1 - line.x0;
    const dy = line.y1 - line.y0;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - line.x0) * dx + (py - line.y0) * dy) / len2)) : 0;
    return Math.hypot(px - (line.x0 + dx * t), py - (line.y0 + dy * t));
  }

  /**
   * Whether the cut passes through a body: its axis (from (x, y, z) up
   * `height`) comes within `radius` of the plane, and where it does, the body
   * projects near the drawn segment and in front of the camera.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} height
   * @param {number} radius
   * @returns {boolean}
   */
  function touches(x, y, z, height, radius) {
    const n = plane.normal;
    const c = plane.point;
    const d0 = n.x * (x - c.x) + n.y * (y - c.y) + n.z * (z - c.z);
    const d1 = d0 + n.y * height;
    let t = 0;
    if (d0 * d1 <= 0) {
      // The axis crosses the plane: the cut goes through the body.
      t = d0 === d1 ? 0 : d0 / (d0 - d1);
    } else {
      if (Math.min(Math.abs(d0), Math.abs(d1)) >= radius) return false;
      t = Math.abs(d0) <= Math.abs(d1) ? 0 : 1;
    }
    probe.set(x, y + height * t, z);
    // In front of the camera (the plane also holds the space behind it); the
    // camera looks down its own -Z, so column 2 of its matrix points backwards.
    back.setFromMatrixColumn(Sim.three.camera.matrixWorld, 2);
    if (toBody.subVectors(probe, c).dot(back) > 0) return false;
    probe.project(Sim.three.camera);
    const px = (probe.x * 0.5 + 0.5) * view.width + view.left;
    const py = (-probe.y * 0.5 + 0.5) * view.height + view.top;
    return pixelsFromLine(px, py) <= CFG.segmentPadPx;
  }

  /**
   * The slicing core's visitor, created once: lying pieces near Roger that
   * the line passes through.
   * @param {{pos: THREE.Vector3, depth: number, dead: boolean}} piece
   * @returns {void}
   */
  function visitPiece(piece) {
    if (candidateCount >= MAX_PIECES || piece.dead) return;
    if (!inReach(reach, piece.pos.x, piece.pos.z, 0.35)) return;
    if (!touches(piece.pos.x, piece.pos.y, piece.pos.z, PIECE_HEIGHT, CFG.pieceRadius)) return;
    candidates[candidateCount++] = piece;
  }

  /**
   * Cuts the candidate pieces with the plane (collected first, so pieces born
   * from this cut are not cut again).
   * @param {import('./pieces.js').KatanaPieces} pieces
   * @returns {number} pieces cut
   */
  function cutPieces(pieces) {
    candidateCount = 0;
    pieces.each(visitPiece);
    let cut = 0;
    for (let i = 0; i < candidateCount; i++) {
      const p = candidates[i];
      candidates[i] = null;
      if (p && pieces.cutPiece(p, plane)) cut++;
    }
    return cut;
  }

  /**
   * The canvas's rectangle into `view`, in the cursor's pixels.
   * @returns {void}
   */
  function readView() {
    const rect = Sim.three.renderer.domElement.getBoundingClientRect();
    view.left = rect.left;
    view.top = rect.top;
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
  }

  /** @returns {CutOutcome} */
  function resolve() {
    const input = env.input();
    line.x0 = input.pressX;
    line.y0 = input.pressY;
    line.x1 = input.cursorX;
    line.y1 = input.cursorY;
    const dx = line.x1 - line.x0;
    const dy = line.y1 - line.y0;
    if (Math.hypot(dx, dy) < CFG.minLinePx) return 'none';

    // The swing: the line's own angle picks the slash, as a swipe's does.
    const sys = /** @type {any} */ (ctx).systems;
    const rig = env.rig();
    if (rig) rig.slash(classifySwipe(dx, dy));
    if (sys.katanaSound) sys.katanaSound.playSwing();

    readView();
    if (!planeFor(line.x0, line.y0, line.x1, line.y1, view, plane)) return 'miss';
    const at = env.position();
    roger.set(at.x, at.y, at.z);
    reach.x = roger.x;
    reach.z = roger.z;

    const pieces = env.pieces();
    const recut = pieces ? cutPieces(pieces) : 0;
    const result = targets.strikeAlong(reach, touches, CFG.bodyRadius, pieces ? pieces.takeOver : undefined, plane);
    if (result.cut + result.people + recut === 0) return 'miss';
    if (sys.katanaSound) sys.katanaSound.playSlice();
    // A killing breaks Smooth Criminal's spell, as the other weapons' do.
    ctx.events.emit('rogerKill');
    const feel = env.feel();
    if (feel) feel.cut(result.cut, recut, roger, result.people);
    return 'cut';
  }

  return { resolve, planeFor };
}
