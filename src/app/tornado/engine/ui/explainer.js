// @ts-check

/**
 * ===========================================================================
 * SECTION UI.X — "What am I looking at?"
 * ===========================================================================
 * Four short cards for someone opening the simulator for the first time:
 * what the town is, how its people react, what the buttons do, and how to
 * follow what happens (the STORM 7 news line, the helicopter). Shown once
 * on a first visit (remembered in localStorage), and again from the ? button
 * in the top right corner or the H key. Next / Back / Skip, Enter and
 * Escape. `?explainer=1` forces it, `?explainer=0` never shows it.
 */

const STORAGE_KEY = 'severin-explainer-seen-v1';

const CARDS = [
  {
    icon: '🌪️',
    title: 'A town, and the storm of the century',
    body: 'This is a disaster sandbox: a small town of 165 people going about their evening, with traffic in the streets and gulls overhead, until you start the storm.'
  },
  {
    icon: '👥',
    title: 'Watch the town react',
    body: 'When a funnel touches down the gulls scatter, drivers leave town and people run for the four storm shelters. Buses and ambulances get others out; firefighters fight the fires.'
  },
  {
    icon: '🎮',
    title: 'You are in charge',
    body: '🌪️ Tornado starts the storm (Control Tornado steers it). 💥 Disasters adds earthquakes, meteors, floods and more. 🦸 Hero puts you on the ground as Roger, to save the town.'
  },
  {
    icon: '📺',
    title: 'Follow the news',
    body: 'The STORM 7 helicopter follows the tornado, and the news line at the bottom tells you what is happening: who is safe, what has been destroyed. The panel on the left keeps the score.'
  }
];

/**
 * @param {Object} ctx
 * @returns {{initExplainer: () => void, disposeExplainer: () => void, open: () => void, close: () => void}}
 */
export function createExplainerSystem(ctx) {
  /** @type {HTMLElement|null} */
  let card = null;
  /** @type {HTMLButtonElement|null} */
  let help = null;
  let index = -1;

  /** @returns {void} */
  function initExplainer() {
    const params = new URLSearchParams(window.location.search);
    const opts = { signal: ctx.signal };
    help = document.createElement('button');
    help.type = 'button';
    help.className = 'explainer-help';
    help.textContent = '?';
    help.title = 'What am I looking at? (H)';
    help.setAttribute('aria-label', 'What am I looking at? Show the explanation');
    help.addEventListener('click', () => (index >= 0 ? close() : open()), opts);
    ctx.container.appendChild(help);

    card = document.createElement('section');
    card.className = 'explainer';
    card.hidden = true;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'What this is');
    card.innerHTML = `
      <div class="explainer-head"><span class="explainer-icon" aria-hidden="true"></span><h2></h2></div>
      <p></p>
      <div class="explainer-foot">
        <span class="explainer-step"></span>
        <div class="explainer-buttons">
          <button type="button" data-act="skip">Skip</button>
          <button type="button" data-act="back">Back</button>
          <button type="button" data-act="next" class="primary">Next</button>
        </div>
      </div>`;
    ctx.container.appendChild(card);
    card.addEventListener('click', (e) => {
      const act = /** @type {HTMLElement} */ (e.target).dataset?.act;
      if (act === 'skip') close();
      else if (act === 'back') show(index - 1);
      else if (act === 'next') (index >= CARDS.length - 1 ? close() : show(index + 1));
    }, opts);
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = /** @type {HTMLElement} */ (e.target);
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      // Not while Roger is out: his keys are his.
      if (ctx.Hero && ctx.Hero.active) return;
      if (e.key === 'h' || e.key === 'H') {
        if (index >= 0) close();
        else open();
      } else if (index >= 0 && e.key === 'Escape') close();
      else if (index >= 0 && e.key === 'Enter') (index >= CARDS.length - 1 ? close() : show(index + 1));
    }, opts);

    const wanted = params.get('explainer');
    if (wanted === '1' || (wanted !== '0' && !seen())) open();
  }

  /** @returns {boolean} */
  function seen() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  /** @returns {void} */
  function open() {
    show(0);
    help?.classList.add('on');
  }

  /** @returns {void} */
  function close() {
    index = -1;
    if (card) card.hidden = true;
    help?.classList.remove('on');
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // Storage off: it shows again next time.
    }
  }

  /** @param {number} i */
  function show(i) {
    if (!card || i < 0 || i >= CARDS.length) return;
    index = i;
    const c = CARDS[i];
    card.hidden = false;
    /** @type {HTMLElement} */ (card.querySelector('.explainer-icon')).textContent = c.icon;
    /** @type {HTMLElement} */ (card.querySelector('h2')).textContent = c.title;
    /** @type {HTMLElement} */ (card.querySelector('p')).textContent = c.body;
    /** @type {HTMLElement} */ (card.querySelector('.explainer-step')).textContent = `${i + 1} / ${CARDS.length}`;
    /** @type {HTMLButtonElement} */ (card.querySelector('[data-act="back"]')).disabled = i === 0;
    /** @type {HTMLElement} */ (card.querySelector('[data-act="next"]')).textContent = i === CARDS.length - 1 ? 'Got it' : 'Next';
  }

  /** @returns {void} */
  function disposeExplainer() {
    card?.remove();
    help?.remove();
    card = null;
    help = null;
  }

  return { initExplainer, disposeExplainer, open, close };
}
