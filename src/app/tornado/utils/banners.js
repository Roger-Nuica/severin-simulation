// @ts-check
/**
 * ===========================================================================
 * Shared: where event banners go
 * ===========================================================================
 * A dozen systems raise a banner -- the firenado, the Fujiwhara merge, the
 * earthquake, the fuel tanker, the chemical works, the dam break, the meteor
 * barrage, the electric tornado, the wedge, the Doomsday script and more --
 * and each used to append its own to the canvas container as a fixed element
 * at the same 16% down the screen. With one disaster at a time that was fine.
 * It is not any more: the electric tornado is a mode that stays on while
 * everything else happens, and the meteor barrage now runs for fifteen
 * seconds, so two banners drawing on top of each other is the normal case
 * rather than a freak collision.
 *
 * They all go into one stack instead, which lays them out in a column. The
 * element is rendered by TornadoSimulator.js; the fallback keeps every caller
 * working if it is ever absent.
 *
 * A column has its own limit, though, and the Doomsday script (engine/
 * doomsday.js) walks straight past it: eight disasters inside a minute, each
 * one setting off two or three more, and measured at six banners on screen at
 * once -- 40-point capitals from the top of the viewport to the bottom, with
 * the simulation they are describing somewhere behind them. So the stack is
 * capped. The newest MAX_VISIBLE banners show and any older one still up is
 * folded away until it expires on its own.
 *
 * It is done by watching the stack rather than by asking every system to
 * co-operate: each one owns its own banner, its own text and its own timer,
 * and none of them can know what the others are doing. They keep toggling
 * `visible` exactly as they always did; this adds `stack-hidden` on top of it
 * and takes it off again, and a banner that was folded away simply goes when
 * its owner's timer runs out, with nothing to put back.
 */

// How many banners may be on screen at once. Three is what fits above the
// panel's fold on a laptop without reaching the horizon.
const MAX_VISIBLE = 3;

// Which banners are actually allowed to show, by the owning system's own
// class name (earthquake.js's 'earthquake-banner', flood.js's 'flood-banner',
// and so on -- every system already gives its banner a distinct one). Cut
// down, on request, to just the Fujiwhara merge: every other system's banner
// call is left exactly as it was (still sets its text, still starts its own
// timer, still toggles 'visible'), only the pop-up itself is suppressed here,
// centrally, rather than by touching each of the dozen call sites. None of
// the score/shake/kill-cam logic those calls sit alongside is affected.
// Hero Mode's own banner (engine/heroMode.js) is let through too: its
// outcome -- safe, terminated, the tornado neutralised -- is the whole point
// of the mode.
// The mission tracker (engine/missions.js) is not a pop-up but the HUD of a
// mission the player chose to start, so it shows too.
// So are a cinematic scene's black bars and title (engine/actionHero.js).
const ALLOWED_BANNER_CLASSES = new Set(['merge-banner', 'hero-banner', 'mission-hud', 'cinema-bars', 'cinema-title', 'spotless-glare']);

/**
 * @param {HTMLElement} el
 * @returns {boolean}
 */
function isAllowedBanner(el) {
  for (const cls of el.classList) {
    if (ALLOWED_BANNER_CLASSES.has(cls)) return true;
  }
  return false;
}

// Elements currently marked visible, oldest first. Pinned children (the
// Doomsday running order, which is a HUD line rather than an event) never
// enter it and never count towards the cap.
/** @type {HTMLElement[]} */
const shown = [];
/** @type {MutationObserver|null} */
let observer = null;

/**
 * @param {HTMLElement} fallback the container to use if the stack is missing
 * @returns {HTMLElement}
 */
export function bannerHost(fallback) {
  return document.getElementById('banner-stack') || fallback;
}

/**
 * @param {HTMLElement} el
 * @returns {void}
 */
function track(el) {
  if (el.classList.contains('stack-pinned')) return;
  // Not on the allow-list: strip 'visible' straight back off before it ever
  // gets to `shown`. This mutation re-enters the observer, converging the
  // same way enforce()'s own writes do (see its comment) -- the class is
  // simply gone on the second pass, so there is nothing left to record.
  if (el.classList.contains('visible') && !isAllowedBanner(el)) {
    el.classList.remove('visible');
    return;
  }
  const at = shown.indexOf(el);
  const visible = el.classList.contains('visible');
  if (visible && at === -1) shown.push(el);
  else if (!visible && at !== -1) shown.splice(at, 1);
}

/**
 * Folds away everything past the newest MAX_VISIBLE.
 *
 * Its own writes come back to the observer -- a MutationObserver callback is a
 * microtask, so a flag set around these lines would always have been cleared
 * again by the time it ran, and there is nothing to guard with. It converges
 * instead: the second pass toggles every class to the value it already has,
 * which changes no attribute and therefore records no mutation.
 * @returns {void}
 */
function enforce() {
  // A disposed simulation takes its own banners out of the stack with it (see
  // each system's dispose), so anything no longer in the document is dropped
  // here rather than counting towards the cap forever.
  for (let i = shown.length - 1; i >= 0; i--) {
    if (!shown[i].isConnected) shown.splice(i, 1);
  }
  const cut = shown.length - MAX_VISIBLE;
  shown.forEach((el, i) => el.classList.toggle('stack-hidden', i < cut));
}

/**
 * Starts capping the stack. Called once at start-up; safe to call again.
 *
 * Deliberately not torn down with the simulation, which is the one piece of
 * state in the engine that is not per-createSimulation() call: the stack it
 * watches belongs to the page rather than to a run, and React StrictMode's
 * dev-mode mount -> cleanup -> mount would otherwise have the dying instance
 * disconnect the live one's observer. It holds nothing but a class toggle and
 * a list it prunes itself.
 * @returns {void}
 */
export function initBannerStack() {
  const stack = document.getElementById('banner-stack');
  if (!stack || observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) track(/** @type {HTMLElement} */ (m.target));
    enforce();
  });
  observer.observe(stack, { attributes: true, attributeFilter: ['class'], subtree: true });
}
