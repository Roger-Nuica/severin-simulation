// @ts-check
import { bannerHost } from '../utils/banners.js';

/**
 * ===========================================================================
 * SECTION MI — Timed missions
 * ===========================================================================
 * Missions read the statistics the game already keeps (Sim.stats), so none
 * of them needs a hook of its own in the systems it is about: each one
 * takes a snapshot of its counter when it starts and counts from there.
 *
 *   Demolition   30 buildings down in 60 s        (buildingsCollapsed)
 *   Evacuation   50 people out on the buses, 4 min (peopleEvacuated)
 *   Fire crew    every alien in town burned by the Firenado, 2 min
 *                (aliensBurned; the goal is how many aliens are on the
 *                ground when it starts -- none, and it cannot start)
 *   Safe house   40 people into the shelters, 90 s (peopleSheltered)
 *   Air cowboy   4 cows up the funnel, 2 min     (cowsFlown, engine/cows.js)
 *
 * One at a time. Started from the panel (🎯 Missions); a small tracker at
 * the top of the screen shows it -- title, a bar, the count and the time
 * left. Done: a banner and its reward added to the score. Out of time: a
 * banner, nothing else. A Reset ends it.
 */

export const MISSIONS = [
  { id: 'demolition', title: 'DEMOLITION', goalText: 'Bring down 30 buildings', seconds: 60, reward: 5000, stat: 'buildingsCollapsed', goal: 30 },
  { id: 'evacuation', title: 'EVACUATION', goalText: 'Get 50 people out on the buses', seconds: 240, reward: 6000, stat: 'peopleEvacuated', goal: 50 },
  { id: 'fireCrew', title: 'FIRE CREW', goalText: 'Burn every alien with the Firenado', seconds: 120, reward: 7000, stat: 'aliensBurned', goal: 0 },
  { id: 'safeHouse', title: 'SAFE HOUSE', goalText: 'Get 40 people into the shelters', seconds: 90, reward: 4000, stat: 'peopleSheltered', goal: 40 },
  { id: 'airCowboy', title: 'AIR COWBOY', goalText: 'Send 4 cows up the funnel', seconds: 120, reward: 3000, stat: 'cowsFlown', goal: 4 }
];

/** @typedef {typeof MISSIONS[number]} Mission */

/**
 * @param {Object} ctx
 * @returns {{
 *   start: (id: string) => boolean,
 *   active: () => ({id: string, value: number, goal: number, left: number}|null),
 *   initMissions: () => void,
 *   updateMissions: (dt: number) => void,
 *   resetMissions: () => void,
 *   disposeMissions: () => void
 * }}
 */
export function createMissionSystem(ctx) {
  const { Sim } = ctx;
  /** @type {{m: Mission, base: number, goal: number, left: number}|null} */
  let run = null;
  /** @type {HTMLDivElement|null} */
  let hud = null;
  /** @type {HTMLDivElement|null} */
  let banner = null;
  let bannerTimer = 0;
  // Seconds the tracker keeps showing how the last mission ended (the town's
  // pop-up banners are suppressed: utils/banners.js).
  let resultTimer = 0;

  /**
   * @param {string} title
   * @param {string} sub
   * @returns {void}
   */
  function showBanner(title, sub) {
    if (banner) {
      /** @type {HTMLElement} */ (banner.querySelector('.title')).textContent = title;
      /** @type {HTMLElement} */ (banner.querySelector('.sub')).textContent = sub;
      banner.classList.add('visible');
      bannerTimer = 3.5;
    }
    ctx.events.emit('announce', { title, sub });
  }

  /**
   * @param {string} stat
   * @returns {number}
   */
  function count(stat) {
    return /** @type {any} */ (Sim.stats)[stat] || 0;
  }

  /** @returns {number} aliens on the ground right now */
  function aliensAlive() {
    const aliens = ctx.systems.aliens;
    return aliens ? aliens.targets().length : 0;
  }

  /** @returns {void} the panel's buttons: which is running, and the rest off */
  function syncButtons() {
    for (const m of MISSIONS) {
      const b = /** @type {HTMLButtonElement|null} */ (document.getElementById(`mission-${m.id}`));
      if (!b) continue;
      b.classList.toggle('active', !!run && run.m === m);
      b.disabled = !!run && run.m !== m;
    }
  }

  /**
   * @param {string} id
   * @returns {boolean} whether it started
   */
  function start(id) {
    const m = MISSIONS.find(x => x.id === id);
    if (!m || run) return false;
    let goal = m.goal;
    if (m.id === 'fireCrew') {
      goal = aliensAlive();
      if (!goal) {
        showBanner('NO ALIENS', 'Fire crew needs aliens on the ground: call the UFO first');
        return false;
      }
    }
    run = { m, base: count(m.stat), goal, left: m.seconds };
    showBanner(`MISSION: ${m.title}`, `${m.goalText.replace(/every alien/, `all ${goal} aliens`)} · ${m.seconds} s`);
    syncButtons();
    draw();
    return true;
  }

  /** @returns {void} the tracker */
  function draw() {
    if (!hud) return;
    if (!run) {
      if (resultTimer <= 0) hud.classList.remove('visible', 'won', 'lost');
      return;
    }
    hud.classList.remove('won', 'lost');
    const value = Math.min(run.goal, count(run.m.stat) - run.base);
    hud.classList.add('visible');
    /** @type {HTMLElement} */ (hud.querySelector('.mission-title')).textContent = `🎯 ${run.m.title}`;
    /** @type {HTMLElement} */ (hud.querySelector('.mission-goal')).textContent = run.m.goalText;
    /** @type {HTMLElement} */ (hud.querySelector('.mission-count')).textContent = `${value} / ${run.goal}`;
    /** @type {HTMLElement} */ (hud.querySelector('.mission-time')).textContent = `${Math.ceil(run.left)} s`;
    /** @type {HTMLElement} */ (hud.querySelector('.mission-bar i')).style.width = `${(value / run.goal) * 100}%`;
    hud.classList.toggle('late', run.left < 10);
  }

  /**
   * @param {boolean} won
   * @returns {void}
   */
  function end(won) {
    if (!run) return;
    const { m } = run;
    if (won) {
      ctx.systems.damage.addDamageScore(m.reward);
      showBanner('MISSION COMPLETE', `${m.title} · +${m.reward}`);
    } else {
      showBanner('MISSION FAILED', `${m.title} · out of time`);
    }
    if (hud) {
      /** @type {HTMLElement} */ (hud.querySelector('.mission-goal')).textContent = won ? `✅ COMPLETE · +${m.reward}` : '❌ FAILED · out of time';
      if (won) /** @type {HTMLElement} */ (hud.querySelector('.mission-count')).textContent = `${run.goal} / ${run.goal}`;
      /** @type {HTMLElement} */ (hud.querySelector('.mission-bar i')).style.width = won ? '100%' : /** @type {HTMLElement} */ (hud.querySelector('.mission-bar i')).style.width;
      hud.classList.add(won ? 'won' : 'lost');
      resultTimer = 3;
    }
    run = null;
    syncButtons();
    draw();
  }

  /** @returns {void} */
  function initMissions() {
    hud = document.createElement('div');
    hud.className = 'mission-hud';
    hud.innerHTML = '<div class="mission-head"><span class="mission-title"></span><span class="mission-time"></span></div>'
      + '<div class="mission-goal"></div><div class="mission-bar"><i></i></div><div class="mission-count"></div>';
    bannerHost(ctx.container).appendChild(hud);
    banner = document.createElement('div');
    banner.className = 'tanker-banner';
    banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
    bannerHost(ctx.container).appendChild(banner);
    for (const m of MISSIONS) {
      const b = document.getElementById(`mission-${m.id}`);
      if (b) b.addEventListener('click', () => { start(m.id); }, { signal: ctx.signal });
    }
    // The panel's test: the storm on, and Demolition.
    const test = document.getElementById('btn-test-mission');
    if (test) {
      test.addEventListener('click', () => {
        if (!Sim.state.running) {
          const go = document.getElementById('btn-start');
          if (go) go.click();
        }
        start('demolition');
      }, { signal: ctx.signal });
    }
    syncButtons();
  }

  /**
   * @param {number} dt simulation seconds (0 while paused)
   * @returns {void}
   */
  function updateMissions(dt) {
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }
    if (resultTimer > 0 && !run) {
      resultTimer -= dt;
      if (resultTimer <= 0) draw();
    }
    if (!run || dt <= 0) return;
    run.left -= dt;
    if (count(run.m.stat) - run.base >= run.goal) end(true);
    else if (run.left <= 0) end(false);
    else draw();
  }

  /** @returns {void} */
  function resetMissions() {
    run = null;
    resultTimer = 0;
    syncButtons();
    draw();
    bannerTimer = 0;
    if (banner) banner.classList.remove('visible');
  }

  /** @returns {void} */
  function disposeMissions() {
    for (const el of [hud, banner]) if (el && el.parentNode) el.parentNode.removeChild(el);
    hud = null;
    banner = null;
  }

  return {
    start,
    active: () => (run ? { id: run.m.id, value: count(run.m.stat) - run.base, goal: run.goal, left: run.left } : null),
    initMissions, updateMissions, resetMissions, disposeMissions
  };
}
