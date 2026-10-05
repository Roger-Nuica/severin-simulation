// @ts-check

/**
 * ===========================================================================
 * SECTION UI.C — The session clock
 * ===========================================================================
 * On request (2026-10-05): how long this game has been going, in the lower
 * left corner, where nothing else needs the space on a phone (the co-op box
 * moves up above it on a desktop, tornado.css). It counts real time while
 * the game is not paused (the wall clock, not the frame's clamped step), from the moment the page opened, and a Reset
 * starts it again (a new game). Other systems read it too: HAVOC's pair
 * comes at a minute (engine/gunner.js, GUNNER.autoAt).
 */

/**
 * @param {number} seconds
 * @returns {string} m:ss, or h:mm:ss from an hour
 */
export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * @param {Object} ctx
 * @returns {{initSessionClock: () => void, updateSessionClock: (paused: boolean) => void, resetSessionClock: () => void,
 *   disposeSessionClock: () => void, seconds: () => number}}
 */
export function createSessionClockSystem(ctx) {
  let elapsed = 0;
  let shown = -1;
  /** @type {HTMLDivElement|null} */
  let root = null;
  /** @type {HTMLSpanElement|null} */
  let value = null;

  /** @returns {void} */
  function initSessionClock() {
    root = document.createElement('div');
    root.className = 'session-clock';
    root.setAttribute('role', 'timer');
    root.setAttribute('aria-label', 'Time played');
    root.title = 'Time played this game (Reset starts it again)';
    root.innerHTML = '<span aria-hidden="true">⏱</span><span class="session-clock-value">0:00</span>';
    value = /** @type {HTMLSpanElement} */ (root.querySelector('.session-clock-value'));
    ctx.container.appendChild(root);
  }

  let last = -1;

  /**
   * Wall-clock time, not the frame's clamped dt: a slow frame still counts
   * in full (a gap of over 2 s -- the tab hidden -- counts as nothing).
   * @param {boolean} paused
   * @returns {void}
   */
  function updateSessionClock(paused) {
    const now = performance.now();
    const step = last < 0 ? 0 : (now - last) / 1000;
    last = now;
    if (!paused && step < 2) elapsed += step;
    const whole = Math.floor(elapsed);
    if (whole === shown || !value) return;
    shown = whole;
    value.textContent = formatClock(whole);
  }

  /** @returns {void} */
  function resetSessionClock() {
    elapsed = 0;
    shown = -1;
    last = -1;
    updateSessionClock(true);
  }

  /** @returns {void} */
  function disposeSessionClock() {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = value = null;
  }

  return { initSessionClock, updateSessionClock, resetSessionClock, disposeSessionClock, seconds: () => elapsed };
}
