// @ts-check
/**
 * ===========================================================================
 * SECTION AM.4 — The nuclear plants' test buttons
 * ===========================================================================
 * Two tiles in 💥 Disasters, to try this step without waiting for the
 * aliens to do it:
 *  - 🔌 Plug In: Hero Mode on, the energy bar down to 10%, and Roger put
 *    down at the terminal of the plant nearest him still standing -- the
 *    bar fills in front of you.
 *  - ☢️ Meltdown: a plant goes critical and up (in Hero Mode the one
 *    farthest from Roger, so the blast does not end the run), with the
 *    green EMP and the mass mutation after it.
 * Each is disabled while there is no plant left standing; a Reset brings
 * both plants back.
 */

/**
 * @param {Object} ctx
 * @param {{
 *   standing: () => {x: number, z: number}[],
 *   meltdownAt: (plant: Object) => void,
 *   terminalNear: (x: number, z: number) => {x: number, z: number}|null
 * }} api
 * @returns {{ wire: () => void, sync: () => void }}
 */
export function createNuclearPanel(ctx, api) {
  /** @type {HTMLButtonElement[]} */
  let buttons = [];

  /** @returns {void} the buttons follow whether a plant still stands */
  function sync() {
    const none = api.standing().length === 0;
    for (const button of buttons) {
      button.disabled = none;
      button.title = none ? 'Both plants are gone: Reset brings them back' : button.dataset.title || '';
    }
  }

  /** @returns {void} */
  function plugIn() {
    const hero = ctx.systems.heroMode;
    if (!ctx.Hero || !ctx.Hero.active) {
      const start = document.getElementById('btn-hero');
      if (start) start.click();
    }
    const roger = hero.rogerTarget();
    if (!roger) return;
    const at = api.terminalNear(roger.x, roger.z);
    if (!at) return;
    // A step in front of the terminal, towards the middle of town.
    const d = Math.hypot(at.x, at.z) || 1;
    hero.placeRoger(at.x - (at.x / d) * 2, at.z - (at.z / d) * 2);
    ctx.systems.energy.hero.set(0.1);
    ctx.events.emit('announce', { title: 'PLUG-IN TEST', sub: 'Energy at 10% · stand at the terminal to recharge' });
  }

  /** @returns {void} */
  function meltdown() {
    const plants = api.standing();
    if (!plants.length) return;
    const roger = ctx.systems.heroMode && ctx.systems.heroMode.rogerTarget();
    let pick = plants[0];
    if (roger) {
      let far = -1;
      for (const plant of plants) {
        const d = Math.hypot(plant.x - roger.x, plant.z - roger.z);
        if (d > far) { far = d; pick = plant; }
      }
    }
    api.meltdownAt(pick);
    sync();
  }

  /** @returns {void} */
  function wire() {
    buttons = [];
    for (const [id, action] of /** @type {[string, () => void][]} */ ([['btn-test-plug', plugIn], ['btn-meltdown', meltdown]])) {
      const button = /** @type {HTMLButtonElement|null} */ (document.getElementById(id));
      if (!button) continue;
      button.dataset.title = button.title;
      button.addEventListener('click', action, { signal: ctx.signal });
      buttons.push(button);
    }
    sync();
  }

  return { wire, sync };
}
