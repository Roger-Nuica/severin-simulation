// @ts-check
import * as THREE from 'three';
import { KATANA_BLADE_UI as CFG } from './config.js';
import { inReach } from './targets.js';

/**
 * ===========================================================================
 * SECTION KT.12 -- Blade Mode visuals (vignette, alien highlights, cut line)
 * ===========================================================================
 * Presentation only; no gameplay value is read or changed here, and no cut is
 * resolved or queued (Subtask 12 reads `line()` to do that).
 *
 *  - Vignette: sets the one smoothed scalar `Post.bladeVignette` (engine/post.js)
 *    to 1 while Blade Mode is on and 0 otherwise. The ease runs in real
 *    seconds inside post.js and only touches `uVignette`, never saturation
 *    or the camera. `Post.bulletTime` is deliberately not used.
 *  - Highlight: a fixed pool of CFG.markerPool flat rings on the ground under
 *    the aliens within CFG.highlightReach of Roger. Their skin and emissive
 *    are not touched (that would take them out of the instancer). The pool
 *    shares one geometry and one material, is made on first use and removed
 *    from the scene in `clear`; nothing is allocated per frame (R-048).
 *  - Cut line: one `pointer-events: none` DOM element that runs from the
 *    press point to the virtual cursor (hero/katana input, in screen pixels).
 *    It is created on first use, appended to the simulation's container and
 *    removed in `dispose` (R-047). The live line is readable through `line()`.
 *
 * State lives in this closure, made once per simulation by heroWeapons.js.
 */

/**
 * @typedef {Object} KatanaBladeUiEnv what the visuals need from Hero Mode
 * @property {() => boolean} active whether Blade Mode is on
 * @property {() => Readonly<{down: boolean, pressX: number, pressY: number, cursorX: number, cursorY: number}>} input
 *   the Katana's live input (heroWeapons.katanaState)
 * @property {() => {x: number, y: number, z: number}} position Roger's position
 * @property {() => boolean} [tracing] first person with the Katana: the cut
 *   line is shown while the left button is dragged, Blade Mode or not (no
 *   vignette or highlights then)
 */

/**
 * @typedef {Object} BladeLine the drawn line, in screen pixels (one live object)
 * @property {boolean} visible true while the line is being drawn
 * @property {number} x0 the press point
 * @property {number} y0
 * @property {number} x1 the virtual cursor
 * @property {number} y1
 */

/**
 * @typedef {Object} KatanaBladeUi
 * @property {(rawDt: number) => void} update per frame, real time
 * @property {() => Readonly<BladeLine>} line the live line (updated in place, never replaced)
 * @property {() => number} markerCount markers shown this frame (for checks)
 * @property {() => void} clear hide everything at once (run start and end, cancel)
 * @property {() => void} dispose as `clear`, and free the pool and the DOM node
 */

/**
 * @param {Object} ctx the simulation's context
 * @param {KatanaBladeUiEnv} env
 * @returns {KatanaBladeUi}
 */
export function createKatanaBladeUi(ctx, env) {
  const { Sim, container } = /** @type {any} */ (ctx);
  /** @type {BladeLine} */
  const drawn = { visible: false, x0: 0, y0: 0, x1: 0, y1: 0 };
  /** Whether the button was down last frame, to catch the press. */
  let wasDown = false;
  /** @type {HTMLDivElement|null} */
  let node = null;
  /** @type {THREE.Mesh[]|null} the one fixed pool, made on first use */
  let markers = null;
  /** @type {THREE.RingGeometry|null} */
  let markerGeometry = null;
  /** @type {THREE.MeshBasicMaterial|null} */
  let markerMaterial = null;
  let shown = 0;
  let pulse = 0;
  /** The aliens-in-range query, reused: a full circle round Roger. */
  const query = { x: 0, z: 0, dirX: 0, dirZ: 1, reach: CFG.highlightReach, cosArc: -1 };
  /** What the line element last showed, so an unchanged frame writes nothing. */
  let lastTransform = '';
  let lastWidth = -1;

  /**
   * The post system's Post state, if it is there.
   * @returns {{bladeVignette: number}|null}
   */
  function post() {
    const s = /** @type {any} */ (ctx).systems.post;
    return s && s.Post ? s.Post : null;
  }

  /**
   * The line's element, made once and appended to the container.
   * @returns {HTMLDivElement}
   */
  function ensureNode() {
    if (node) return node;
    const el = document.createElement('div');
    el.className = 'katana-cut-line';
    const st = el.style;
    st.position = 'fixed';
    st.left = '0';
    st.top = `${-CFG.lineThickness / 2}px`;
    st.height = `${CFG.lineThickness}px`;
    st.width = '0';
    st.borderRadius = `${CFG.lineThickness}px`;
    st.background = CFG.lineColour;
    st.boxShadow = CFG.lineGlow;
    st.transformOrigin = '0 50%';
    st.pointerEvents = 'none';
    st.zIndex = '14';
    st.display = 'none';
    container.appendChild(el);
    node = el;
    return el;
  }

  /**
   * The marker pool, made once: one ring geometry and one material shared by all.
   * @returns {THREE.Mesh[]}
   */
  function ensureMarkers() {
    if (markers) return markers;
    markerGeometry = new THREE.RingGeometry(CFG.markerRadius[0], CFG.markerRadius[1], 24);
    markerGeometry.rotateX(-Math.PI / 2);
    markerMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: CFG.markerOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    markerMaterial.color.setRGB(CFG.markerColour[0], CFG.markerColour[1], CFG.markerColour[2]);
    markers = [];
    for (let i = 0; i < CFG.markerPool; i++) {
      const m = new THREE.Mesh(markerGeometry, markerMaterial);
      m.visible = false;
      m.frustumCulled = false;
      markers.push(m);
    }
    return markers;
  }

  /**
   * The aliens' visitor, created once: places the next marker under an alien.
   * @param {{phase: string, root: THREE.Object3D}} alien
   * @returns {void}
   */
  function visit(alien) {
    if (!markers || shown >= markers.length) return;
    const p = alien.root.position;
    if (!inReach(query, p.x, p.z, 0.35)) return;
    const m = markers[shown++];
    m.position.set(p.x, p.y + 0.06, p.z);
    if (!m.parent) Sim.three.scene.add(m);
    m.visible = true;
  }

  /**
   * Hides the highlight rings, leaving the pool in place.
   * @returns {void}
   */
  function hideMarkers() {
    if (markers) for (const m of markers) m.visible = false;
    shown = 0;
  }

  /**
   * Hides the line element.
   * @returns {void}
   */
  function hideLine() {
    drawn.visible = false;
    if (node) node.style.display = 'none';
    lastTransform = '';
    lastWidth = -1;
  }

  /**
   * Draws the line element from the press point to the cursor.
   * @returns {void}
   */
  function drawLine() {
    const el = ensureNode();
    const dx = drawn.x1 - drawn.x0;
    const dy = drawn.y1 - drawn.y0;
    const length = Math.hypot(dx, dy);
    if (length < CFG.lineMinPx) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    const transform = `translate(${drawn.x0.toFixed(1)}px, ${drawn.y0.toFixed(1)}px) rotate(${Math.atan2(dy, dx).toFixed(4)}rad)`;
    if (transform !== lastTransform) {
      el.style.transform = transform;
      lastTransform = transform;
    }
    if (length !== lastWidth) {
      el.style.width = `${length.toFixed(1)}px`;
      lastWidth = length;
    }
  }

  /**
   * @param {number} rawDt real seconds
   * @returns {void}
   */
  function update(rawDt) {
    const on = env.active();
    const input = env.input();
    const p = post();
    if (p) p.bladeVignette = on ? 1 : 0;

    // The press point, recorded by the press itself (heroWeapons.katanaPress),
    // since the cut reads the same point when the button comes up.
    if (input.down) {
      drawn.x0 = input.pressX;
      drawn.y0 = input.pressY;
    }
    wasDown = input.down;

    if (!on) {
      // A quick slash being dragged in first person: the line from the
      // crosshair to the virtual cursor, the cut it will make on release.
      if (input.down && env.tracing && env.tracing()) {
        drawn.x1 = input.cursorX;
        drawn.y1 = input.cursorY;
        drawn.visible = true;
        drawLine();
      } else if (drawn.visible) {
        hideLine();
      }
      if (shown > 0) hideMarkers();
      return;
    }

    // The line shows only while a drag is under way; between cuts of one
    // window (button up, mode still on) there is none.
    if (input.down) {
      drawn.x1 = input.cursorX;
      drawn.y1 = input.cursorY;
      drawn.visible = true;
      drawLine();
    } else if (drawn.visible) {
      hideLine();
    }

    ensureMarkers();
    const at = env.position();
    query.x = at.x;
    query.z = at.z;
    hideMarkers();
    const aliens = /** @type {any} */ (ctx).systems.aliens;
    if (aliens) aliens.eachCuttable(visit);
    pulse += rawDt * CFG.markerPulse;
    if (markerMaterial) markerMaterial.opacity = CFG.markerOpacity * (0.7 + 0.3 * Math.sin(pulse));
  }

  /** @returns {Readonly<BladeLine>} */
  function line() {
    return drawn;
  }

  /** @returns {void} */
  function clear() {
    const p = post();
    if (p) p.bladeVignette = 0;
    wasDown = false;
    hideLine();
    hideMarkers();
    if (markers) for (const m of markers) if (m.parent) m.parent.remove(m);
  }

  /** @returns {void} */
  function dispose() {
    clear();
    if (node && node.parentNode) node.parentNode.removeChild(node);
    node = null;
    if (markerGeometry) markerGeometry.dispose();
    if (markerMaterial) markerMaterial.dispose();
    markerGeometry = null;
    markerMaterial = null;
    markers = null;
  }

  return { update, line, markerCount: () => shown, clear, dispose };
}
