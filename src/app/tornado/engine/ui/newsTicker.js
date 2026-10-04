// @ts-check
import { INITIAL_PEOPLE } from '../environment/index.js';
import { enqueueHeadline } from './headlines.js';

/**
 * ===========================================================================
 * SECTION UI.N — STORM 7 news line
 * ===========================================================================
 * Someone watching the town for the first time (a country head in a demo)
 * sees gulls, cars, a helicopter and then a lot of destruction, and needs
 * telling what it means. The STORM 7 news line at the bottom of the screen
 * does that like a TV channel's lower third: a red LIVE badge and one
 * headline at a time, in plain words, about what just happened and what
 * it adds up to:
 *
 *   calm      the town's evening: how many people are out, the traffic,
 *             the gulls, and what to press to start the storm
 *   storm     the warning, the touchdown with its EF rating and wind, the
 *             birds and drivers fleeing, people reaching the shelters, the
 *             buses and ambulances, buildings down, fires, cows in the air
 *   big news  every `announce` the game makes (the mothership, the
 *             nuclear plants...) as BREAKING
 *
 * It reads what the game already counts (Sim.stats, the people) twice a
 * second and the event bus; nothing else calls it. Headlines queue (the
 * oldest dropped past QUEUE), each shown a few seconds. Hidden in Hero Mode
 * (Roger's own HUD tells his story) and with `?news=0`.
 */

const SHOW_SECONDS = 5.5;
const HURRY_SECONDS = 3;
const QUEUE = 4;
const CHECK_SECONDS = 0.5;
/** Seconds between two calm lines while nothing happens. */
const CALM_EVERY = 9;

const CALM_LINES = [
  (/** @type {number} */ n) => `A quiet evening: ${n} people out and about, traffic moving normally`,
  () => 'Gulls circling over the town · winds light for now',
  () => 'Forecast: the storm of the century · press 🌪️ Tornado to start it',
  () => 'Four storm shelters are open, one in each quarter of town',
  () => 'Try Disasters for an earthquake, meteors or a flood · 🦸 Hero to save the town as Roger'
];

/**
 * @param {Object} ctx
 * @returns {{initNewsTicker: () => void, updateNewsTicker: (dt: number) => void,
 *   resetNewsTicker: () => void, disposeNewsTicker: () => void, say: (text: string, breaking?: boolean) => void}}
 */
export function createNewsTickerSystem(ctx) {
  const { Sim } = ctx;
  /** @type {HTMLElement|null} */
  let root = null;
  /** @type {HTMLElement|null} */
  let line = null;
  /** @type {HTMLElement|null} */
  let tag = null;
  /** @type {{text: string, breaking: boolean}[]} */
  let queue = [];
  let left = 0;
  let shown = 0;
  let check = 0;
  let calmIn = 2;
  let calmTurn = 0;
  /** What has been said this run, so each milestone is said once. */
  let said = new Set();
  /** The counts at the last look. */
  let last = { sheltered: 0, evacuated: 0, rescued: 0, collapsed: 0, cows: 0, burned: 0, lost: 0, overturned: 0 };
  /** @type {(() => void)[]} */
  let detach = [];

  /** @returns {void} */
  function initNewsTicker() {
    if (new URLSearchParams(window.location.search).get('news') === '0') return;
    root = document.createElement('div');
    root.className = 'news-ticker';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.innerHTML = '<span class="news-badge"><i></i>LIVE · STORM 7</span><span class="news-tag"></span><span class="news-line"></span>';
    tag = root.querySelector('.news-tag');
    line = root.querySelector('.news-line');
    ctx.container.appendChild(root);
    detach = [
      ctx.events.on('announce', (/** @type {any} */ p) => say(`${p.title}${p.sub ? ` · ${p.sub}` : ''}`, true))
    ];
    resetNewsTicker();
  }

  /**
   * Queues a headline.
   * @param {string} text
   * @param {boolean} [breaking]
   * @returns {void}
   */
  function say(text, breaking = false) {
    if (!root) return;
    enqueueHeadline(queue, { text, breaking }, QUEUE);
    if (left <= 0) next();
  }

  function next() {
    const item = queue.shift();
    if (!item || !root || !line || !tag) return;
    line.textContent = item.text;
    tag.textContent = item.breaking ? 'BREAKING' : '';
    root.classList.toggle('breaking', item.breaking);
    root.classList.remove('pop');
    void root.offsetWidth;
    root.classList.add('pop');
    left = SHOW_SECONDS;
    shown = 0;
  }

  /** The first time only, this run. @param {string} key @param {string} text @param {boolean} [breaking] */
  function once(key, text, breaking = false) {
    if (said.has(key)) return;
    said.add(key);
    say(text, breaking);
  }

  /** Looks at the town and says what changed. */
  function look() {
    const s = Sim.stats;
    const running = Sim.state.running;
    const vortices = ctx.tornadoes ? ctx.tornadoes.activeVortices : [];
    const down = running && vortices.some((/** @type {any} */ v) => (v.birth ?? 1) > 0.25);
    if (running) once('warning', 'Tornado warning: a funnel is forming over the town · take shelter', true);
    if (down) {
      const ef = Math.min(5, Math.floor(Sim.params.intensity * 6));
      once('touchdown', `Tornado on the ground · EF${ef}, winds of ${Math.round(Sim.params.windSpeed)} mph`, true);
      if (vortices.length > 1) once('outbreak', `${vortices.length} tornadoes on the ground at once`, true);
      if (ctx.systems.streetTraffic?.leaving()) once('traffic', 'Drivers are leaving town as fast as they can');
      if (ctx.systems.birds?.fleeing()) once('birds', 'The gulls were the first to go: flocks fleeing the funnel');
      if (ctx.systems.newsChopper?.chasing()) once('chopper', 'The STORM 7 helicopter is following the tornado');
    }
    // The ledger: safe, and lost.
    const total = INITIAL_PEOPLE + (ctx.systems.reinforcements ? ctx.systems.reinforcements.spawnedCount() : 0);
    const saved = s.peopleSheltered + s.peopleRescued + s.peopleEvacuated;
    const lost = Math.max(0, total - ctx.Environment.people.length - saved);
    stepped('sheltered', s.peopleSheltered, 5, (n) => `${n} people safe in the storm shelters`);
    stepped('evacuated', s.peopleEvacuated, 5, (n) => `Evacuation buses have taken ${n} people out of town`);
    stepped('rescued', s.peopleRescued, 3, (n) => `Ambulances have picked up ${n} injured`);
    stepped('collapsed', s.buildingsCollapsed, 3, (n) => `${n} building${n === 1 ? '' : 's'} destroyed so far`);
    stepped('overturned', s.vehiclesOverturned, 5, (n) => `${n} cars thrown by the wind`);
    stepped('burned', s.buildingsBurned, 2, (n) => `Fires are spreading: ${n} buildings burned out`);
    stepped('cows', s.cowsFlown, 1, (n) => (n === 1 ? 'A cow has been taken up the funnel 🐄' : `${n} cows have now flown 🐄`));
    stepped('lost', lost, 5, (n) => `${n} people caught by the storm · ${saved} safe so far`);
    if (!running && !queue.length && left <= 0) {
      calmIn -= CHECK_SECONDS;
      if (calmIn <= 0) {
        calmIn = CALM_EVERY;
        say(CALM_LINES[calmTurn++ % CALM_LINES.length](ctx.Environment.people.length));
      }
    }
  }

  /**
   * Says a count each time it has grown by at least `step` since it was
   * last said.
   * @param {keyof typeof last} key
   * @param {number} value
   * @param {number} step
   * @param {(n: number) => string} text
   */
  function stepped(key, value, step, text) {
    if (value >= last[key] + step || (value > 0 && last[key] === 0 && step === 1)) {
      last[key] = value;
      say(text(value));
    } else if (value < last[key]) {
      last[key] = value;
    }
  }

  /** @param {number} dt real seconds @returns {void} */
  function updateNewsTicker(dt) {
    if (!root) return;
    root.classList.toggle('hidden', !!(ctx.Hero && ctx.Hero.active));
    check -= dt;
    if (check <= 0) {
      check = CHECK_SECONDS;
      look();
    }
    if (left <= 0) return;
    left -= dt;
    shown += dt;
    if (queue.length && shown >= HURRY_SECONDS) next();
    else if (left <= 0 && queue.length) next();
  }

  /** @returns {void} */
  function resetNewsTicker() {
    queue = [];
    said = new Set();
    last = { sheltered: 0, evacuated: 0, rescued: 0, collapsed: 0, cows: 0, burned: 0, lost: 0, overturned: 0 };
    calmIn = 1.5;
    left = 0;
    if (line) line.textContent = '';
    say(CALM_LINES[0](INITIAL_PEOPLE));
    calmTurn = 1;
  }

  /** @returns {void} */
  function disposeNewsTicker() {
    for (const off of detach) off();
    detach = [];
    root?.remove();
    root = line = tag = null;
  }

  return { initNewsTicker, updateNewsTicker, resetNewsTicker, disposeNewsTicker, say };
}
