// @ts-check
import { bannerHost } from '../utils/banners.js';

/**
 * ===========================================================================
 * SECTION K — Doomsday
 * ===========================================================================
 * One button that fires everything, in an order that was chosen.
 *
 * All of it could already be pressed by hand, and that is exactly the problem:
 * pressed by hand the disasters arrive in whatever order the player's mouse
 * found them, each one landing on a town the last one has already finished
 * with. Nothing overlaps, so nothing compounds -- a dam break across a town
 * that is only rubble is water running over gravel.
 *
 * So the script is a running order, not a list. Every beat is placed to land
 * on top of what the beat before it left:
 *
 *   0s   the quake opens the ground              -- fissures, and lava in them
 *   6s   the gas mains rupture                   -- into the fresh cracks, and
 *                                                   fire runs down the streets
 *  12s   the dam goes                            -- water reaches molten ground:
 *                                                   steam explosions (collisions.js)
 *  19s   the meteors come in                     -- craters through the flood,
 *                                                   an airburst over the town
 *  27s   the grid goes live                       -- an arc storm over standing
 *                                                   water and broken lines
 *  33s   the ground gives way                    -- a sinkhole under whichever
 *                                                   muster point is fullest
 *  39s   the wedge                               -- and now there is nowhere
 *                                                   beside the tornado either
 *  48s   the funnel catches                      -- a wedge of fire, feeding on
 *                                                   everything already burning
 *
 * The beats only ever call the same public triggers the panel buttons call, so
 * this module knows nothing about how any disaster works and adding one to the
 * running order is one line. Each disaster raises its own banner as it arrives;
 * what this adds on top is a single line naming what is coming next and when,
 * because the whole point of a choreographed run is that it is not a surprise.
 *
 * Pressing it again stands the script down. What has already happened stays
 * happened -- nothing here undoes damage -- and whatever is still running
 * (the arc storm, the wedge, the fires) stays running and can be switched off
 * on its own button. Reset is what puts the town back.
 */

const DOOM = {
  meteorCount: 5,
  // Seconds the script stays up after its last beat, while the wedge finishes
  // growing and the fire it lit finishes spreading.
  tailSeconds: 12,
  // Seconds of "that was all of it" at the end before the HUD line goes away.
  outroSeconds: 6,
  bannerSeconds: 5
};

/**
 * The running order. `run` is handed the ctx so a beat is a single expression
 * calling a system's own public trigger, and is looked up at fire time rather
 * than at construction, so this module can be built in any order relative to
 * the systems it drives.
 * @type {{at: number, label: string, sub: string, run: (ctx: Object) => void}[]}
 */
const SCRIPT = [
  {
    at: 0, label: 'THE GROUND OPENS', sub: 'Fissures · lava',
    run: (ctx) => ctx.systems.earthquake.triggerEarthquake()
  },
  {
    at: 6, label: 'THE MAINS GO', sub: 'Fire down the streets',
    run: (ctx) => ctx.systems.gasMains.ruptureRandom()
  },
  {
    at: 12, label: 'THE DAM GOES', sub: 'Water onto molten ground',
    run: (ctx) => ctx.systems.flood.breakDam()
  },
  {
    at: 19, label: 'FROM ABOVE', sub: `${DOOM.meteorCount} impacts · one airburst`,
    run: (ctx) => ctx.systems.meteors.callVolley(DOOM.meteorCount)
  },
  {
    at: 27, label: 'THE GRID GOES', sub: 'Arc storm over standing water',
    run: (ctx) => ctx.systems.electricStorm.setElectric(true)
  },
  {
    at: 33, label: 'THE GROUND GIVES', sub: 'Under the fullest muster point',
    run: (ctx) => ctx.systems.sinkhole.openSinkhole()
  },
  {
    at: 39, label: 'THE WEDGE', sub: 'Nowhere beside it to stand',
    run: (ctx) => ctx.systems.wedge.setWedge(true)
  },
  {
    at: 48, label: 'THE FUNNEL CATCHES', sub: 'A wedge of fire',
    run: (ctx) => ctx.systems.firenado.ignite(true)
  }
];

const LAST_BEAT = SCRIPT[SCRIPT.length - 1].at;

/**
 * @param {Object} ctx
 * @param {{ startSim: () => void }} controllers tornadoEngine.js's own start
 *   controller: the script has to be able to begin a run, and a scripted
 *   apocalypse that needs the player to press Start first is a worse button.
 * @returns {{
 *   initDoomsday: () => void,
 *   updateDoomsday: (dt: number) => void,
 *   setDoomsday: (on: boolean) => boolean,
 *   isRunning: () => boolean,
 *   resetDoomsday: () => void,
 *   disposeDoomsday: () => void
 * }}
 */
export function createDoomsdaySystem(ctx, controllers) {
  const { startSim } = controllers;

  const state = {
    running: false,
    clock: 0,
    // Index of the next beat to fire, so a beat can never fire twice however
    // the clock moves.
    next: 0,
    // Counts down once the last beat has landed, then clears the HUD line.
    outro: 0,
    bannerTimer: 0
  };

  /** @type {HTMLElement|null} */
  let banner = null;
  /** @type {HTMLElement|null} */
  let hud = null;

  /** @returns {void} */
  function initDoomsday() {
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'doomsday-banner';
      banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
      bannerHost(ctx.container).appendChild(banner);
    }
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'doomsday-hud';
      // Pinned: it is the running order rather than an event, so it is exempt
      // from the stack's cap on how many banners show at once and keeps its
      // place at the bottom of the column (utils/banners.js).
      hud.className = 'stack-pinned';
      bannerHost(ctx.container).appendChild(hud);
    }
    const button = document.getElementById('btn-doomsday');
    if (button) button.addEventListener('click', () => setDoomsday(!state.running), { signal: ctx.signal });
  }

  /**
   * @param {string} title
   * @param {string} sub
   * @returns {void}
   */
  function showBanner(title, sub) {
    if (!banner) return;
    banner.querySelector('.title').textContent = title;
    banner.querySelector('.sub').textContent = sub;
    banner.classList.add('visible');
    state.bannerTimer = DOOM.bannerSeconds;
  }

  /** @returns {void} */
  function syncButton() {
    const button = document.getElementById('btn-doomsday');
    if (!button) return;
    button.setAttribute('aria-pressed', String(state.running));
    button.classList.toggle('active', state.running);
  }

  /** @returns {boolean} */
  function isRunning() {
    return state.running;
  }

  /**
   * Starts or stands down the script.
   * @param {boolean} on
   * @returns {boolean} whether the script is now what was asked for; false only
   *   when starting it was refused (Chase Mode is driving -- the script ends in
   *   a wedge, which Chase Mode cannot have).
   */
  function setDoomsday(on) {
    if (on === state.running) return true;
    if (on && ctx.Chase && ctx.Chase.active) return false;
    state.running = on;
    syncButton();
    if (on) {
      state.clock = 0;
      state.next = 0;
      state.outro = 0;
      // A scripted run begins the run: every beat below is a disaster the town
      // has to be alive to suffer.
      startSim();
      showBanner('DOOMSDAY', `${SCRIPT.length} beats · ${LAST_BEAT} seconds`);
      // Called unconditionally rather than left to startSim()'s own trigger:
      // if the run was already going (Start pressed by hand first, Doomsday
      // switched on afterwards), startSim() above no-ops and this is the only
      // thing that still marks the moment. The stinger's own min-gap debounce
      // collapses the two into one play when they do land together.
      ctx.systems.stinger.playStinger();
    } else {
      state.outro = 0;
      if (hud) hud.classList.remove('visible');
      showBanner('STOOD DOWN', 'What is already running keeps running');
    }
    return true;
  }

  /**
   * Fires whatever is due, and keeps the one line of HUD honest about what is
   * coming next. Runs on simulation time (so a slow-motion beat stretches the
   * gap to the next one rather than cutting it short) and only while the run is
   * live, so pausing pauses the apocalypse.
   * @param {number} dt
   * @returns {void}
   */
  function updateDoomsday(dt) {
    if (state.bannerTimer > 0) {
      state.bannerTimer -= dt;
      if (state.bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }

    if (!state.running) {
      if (state.outro > 0) {
        state.outro -= dt;
        if (state.outro <= 0 && hud) hud.classList.remove('visible');
      }
      return;
    }

    state.clock += dt;
    while (state.next < SCRIPT.length && state.clock >= SCRIPT[state.next].at) {
      const beat = SCRIPT[state.next];
      state.next++;
      // A beat that throws is a beat that is missing a system, and taking the
      // whole frame down with it would take the rest of the script with it too.
      try {
        beat.run(ctx);
      } catch {
        // Nothing to do about it here; the next beat still gets its turn.
      }
    }

    if (state.next < SCRIPT.length) {
      if (hud) {
        const beat = SCRIPT[state.next];
        const countdown = Math.max(0, Math.ceil(beat.at - state.clock));
        hud.textContent = `NEXT · ${beat.label} in ${countdown}s`;
        hud.classList.add('visible');
      }
      return;
    }

    // Every beat has landed. The script holds on for its tail rather than
    // declaring itself finished on the same frame as its last beat -- the
    // wedge is still growing and the fire is still spreading, and that is the
    // part worth watching.
    if (hud) {
      hud.textContent = 'DOOMSDAY · everything is out';
      hud.classList.add('visible');
    }
    if (state.clock >= LAST_BEAT + DOOM.tailSeconds) {
      // The script is over; what it started is not.
      state.running = false;
      state.outro = DOOM.outroSeconds;
      syncButton();
      showBanner('ALL OF IT', 'Everything at once, as promised');
    }
  }

  /** @returns {void} */
  function resetDoomsday() {
    state.running = false;
    state.clock = 0;
    state.next = 0;
    state.outro = 0;
    state.bannerTimer = 0;
    if (banner) banner.classList.remove('visible');
    if (hud) hud.classList.remove('visible');
    syncButton();
  }

  /** @returns {void} */
  function disposeDoomsday() {
    for (const el of [banner, hud]) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    banner = null;
    hud = null;
  }

  return { initDoomsday, updateDoomsday, setDoomsday, isRunning, resetDoomsday, disposeDoomsday };
}
