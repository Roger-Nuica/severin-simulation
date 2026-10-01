// @ts-check
/**
 * ===========================================================================
 * SECTION AG — Screen crack overlay
 * ===========================================================================
 * A DOM overlay drawn over the whole page (in the same spirit as killcam.js's
 * letterbox/fade and lightning.js's flash), rather than anything in the
 * Three.js scene: a crack in the glass has nothing to do with the world being
 * rendered, it is something happening to the screen itself.
 *
 * One crack pattern -- radiating fractures from a single impact point, with
 * shorter branches off the main ones and a dense cluster right at the centre
 * -- is drawn once into an offscreen canvas and used as the overlay's
 * background image. It follows how far into an EF5 wedge (engine/wedge.js)
 * the funnel currently is: setWedgeLevel() is called every frame from
 * updateWedge() with the same blend value that ramps the funnel up to wedge
 * scale, and the glass breaks all at once when that passes CRACK_AT -- with a
 * "shatter" brightness pulse (tornado.css) and the glass-crack sound -- and
 * clears again when the wedge drops back below it. Reversible, because what
 * it represents is itself reversible, unlike a permanent battle-damage
 * overlay; re-armed every time the wedge comes up again.
 */

const TEXTURE_SIZE = 1024;
const MAIN_CRACKS = 14;
const MAIN_SEGMENTS_MIN = 4;
const MAIN_SEGMENTS_MAX = 6;
const BRANCH_CHANCE = 0.6;
const CLUSTER_LINES = 10;
// How far into the wedge's ramp (engine/wedge.js blend) the glass breaks --
// and, on the way back down, clears again.
const CRACK_AT = 0.6;

/**
 * @param {number} x0
 * @param {number} y0
 * @param {number} angle radians
 * @param {number} length
 * @param {number} segments
 * @param {number} maxJitter perpendicular wander at the far end
 * @returns {{x: number, y: number}[]}
 */
function buildJaggedPoints(x0, y0, angle, length, segments, maxJitter) {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const perpX = -dirY;
  const perpY = dirX;
  const points = [{ x: x0, y: y0 }];
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const along = length * t;
    const jitter = (Math.random() - 0.5) * 2 * maxJitter * t;
    points.push({
      x: x0 + dirX * along + perpX * jitter,
      y: y0 + dirY * along + perpY * jitter
    });
  }
  return points;
}

/**
 * Strokes a jagged path as a thin bright line with a soft dark halo, the way
 * real damaged glass catches the light -- one pass, using the canvas's own
 * shadow rather than a second offset stroke.
 * @param {CanvasRenderingContext2D} g
 * @param {{x: number, y: number}[]} points
 * @param {{width: number, blur: number, alpha: number}} look
 * @returns {void}
 */
function strokeCrackLine(g, points, { width, blur, alpha }) {
  g.save();
  g.shadowColor = `rgba(0, 0, 0, ${(alpha * 0.7).toFixed(2)})`;
  g.shadowBlur = blur;
  g.strokeStyle = `rgba(235, 242, 250, ${alpha.toFixed(2)})`;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
  g.stroke();
  g.restore();
}

/**
 * Draws one fresh crack pattern and returns it as a data URL for the
 * overlay's CSS background-image.
 * @returns {string}
 */
function buildCrackDataUrl() {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const g = canvas.getContext('2d');

  // Off-centre, roughly where a hand or an object would actually strike --
  // dead-centre reads as a decal, not damage.
  const ox = TEXTURE_SIZE * (0.38 + Math.random() * 0.24);
  const oy = TEXTURE_SIZE * (0.32 + Math.random() * 0.3);
  const reach = TEXTURE_SIZE * 0.62;

  // A dense little starburst right at the point of impact.
  for (let i = 0; i < CLUSTER_LINES; i++) {
    const angle = Math.random() * Math.PI * 2;
    const points = buildJaggedPoints(ox, oy, angle, TEXTURE_SIZE * (0.03 + Math.random() * 0.05), 3, 6);
    strokeCrackLine(g, points, { width: 1.6, blur: 2, alpha: 0.85 });
  }

  // Main fractures radiating out towards the edges, roughly evenly spaced
  // but perturbed so they never look like a deliberate spoke pattern, each
  // with a chance of a shorter branch part-way along.
  for (let i = 0; i < MAIN_CRACKS; i++) {
    const angle = (i / MAIN_CRACKS) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const length = reach * (0.55 + Math.random() * 0.45);
    const segments = MAIN_SEGMENTS_MIN + Math.floor(Math.random() * (MAIN_SEGMENTS_MAX - MAIN_SEGMENTS_MIN + 1));
    const points = buildJaggedPoints(ox, oy, angle, length, segments, TEXTURE_SIZE * 0.05);
    strokeCrackLine(g, points, { width: 2.2, blur: 4, alpha: 0.8 });

    if (Math.random() < BRANCH_CHANCE && points.length > 2) {
      const start = points[1 + Math.floor(Math.random() * (points.length - 2))];
      const branchAngle = angle + (Math.random() - 0.5) * 1.6;
      const branchPoints = buildJaggedPoints(
        start.x, start.y, branchAngle, length * (0.3 + Math.random() * 0.3),
        2 + Math.floor(Math.random() * 2), TEXTURE_SIZE * 0.03
      );
      strokeCrackLine(g, branchPoints, { width: 1.3, blur: 2.5, alpha: 0.6 });
    }
  }

  return canvas.toDataURL('image/png');
}

/**
 * @param {Object} ctx
 * @returns {{
 *   initScreenCrack: () => void,
 *   setWedgeLevel: (level: number) => void,
 *   resetScreenCrack: () => void,
 *   disposeScreenCrack: () => void
 * }}
 */
export function createScreenCrackSystem(ctx) {
  const state = { level: 0, wasFull: false };
  /** @type {HTMLDivElement|null} */
  let overlay = null;

  /**
   * @param {number} value
   * @returns {void}
   */
  function applyOpacity(value) {
    if (overlay) overlay.style.opacity = value.toFixed(3);
  }

  /** @returns {void} */
  function initScreenCrack() {
    overlay = document.createElement('div');
    overlay.className = 'screen-crack';
    overlay.style.backgroundImage = `url(${buildCrackDataUrl()})`;
    ctx.container.appendChild(overlay);
  }

  /** @returns {void} */
  function triggerShatter() {
    if (!overlay) return;
    // Remove-and-reflow-and-reAdd, so the keyframe animation restarts even
    // though the class may already be set from an earlier wedge (see the
    // 'shatter' rule in tornado.css) -- the same technique killcam.js's
    // classList toggling relies on not needing, because that one runs on a
    // freshly-hidden element every time.
    overlay.classList.remove('shatter');
    void overlay.offsetWidth;
    overlay.classList.add('shatter');
  }

  /**
   * Called every frame from wedge.js's updateWedge() with its live blend
   * (0 at rest, 1 at full wedge) -- the crack breaks and clears as that
   * crosses CRACK_AT, so it comes and goes with the wedge itself rather than
   * accumulating.
   * @param {number} level 0..1
   * @returns {void}
   */
  function setWedgeLevel(level) {
    state.level = level;
    // All at once, with the glass-crack sound (sound/cues.js), rather than
    // fading in over the whole ramp: a crack that creeps in over seven
    // seconds has no moment for the sound to land on.
    const cracked = level >= CRACK_AT;
    if (cracked && !state.wasFull) {
      state.wasFull = true;
      applyOpacity(1);
      triggerShatter();
      if (ctx.systems.cues) ctx.systems.cues.playGlassCrack();
    } else if (!cracked && state.wasFull) {
      state.wasFull = false;
      applyOpacity(0);
    }
  }

  /**
   * Wipes the crack and draws a fresh pattern, so a new run doesn't open
   * already cracked from the last one, or crack in the exact same shape
   * twice running.
   * @returns {void}
   */
  function resetScreenCrack() {
    state.level = 0;
    state.wasFull = false;
    if (overlay) {
      overlay.classList.remove('shatter');
      overlay.style.backgroundImage = `url(${buildCrackDataUrl()})`;
      applyOpacity(0);
    }
  }

  /** @returns {void} */
  function disposeScreenCrack() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
  }

  return { initScreenCrack, setWedgeLevel, resetScreenCrack, disposeScreenCrack };
}
