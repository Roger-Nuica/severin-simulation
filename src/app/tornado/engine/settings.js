// @ts-check
/**
 * ===========================================================================
 * SECTION ST — Player settings
 * ===========================================================================
 * The panel's "🔊 Sounds" switches, kept between sessions (localStorage).
 * Each is on or off, and read by the system it concerns every frame, so a
 * Reset or a reload never changes one and a switch works whatever the game
 * is doing:
 *   rainVisual  the rain drawn (weather.js)
 *   rainSound   the storm's wind-and-rain hiss (sound/index.js: the game has
 *               no separate rain recording; the hiss is what the rain sounds
 *               like). The storm's low rumble is not part of it.
 *   creatures   the creatures' voices, steps, attacks and deaths
 *               (sound/creatures.js): the aliens, the giants, Hank, the
 *               Terminators, Patient Zero, Captain Spotless.
 *   music       the background music (sound/cues.js). The tracks of an
 *               event (the Terminator, the ships, Smooth Criminal's song)
 *               still play: they are part of the event.
 *
 * And the choices, one of a few (CHOICES), kept the same way:
 *   musicTrack  which background music: the playlist (guta.mp3 and
 *               drobeta.mp3, the default) or the old city-sound.wav, looped.
 *               One button per option, `set-<key>-<option>`.
 *
 * To add a switch: a key in SETTINGS, a button with id `set-<key>` in the
 * Sounds section of TornadoSimulator.js, and whoever it concerns reads
 * ctx.systems.settings.get('<key>').
 */

export const SETTINGS = {
  rainVisual: { label: 'Rain', on: true },
  rainSound: { label: 'Rain sound', on: true },
  music: { label: 'Music', on: true },
  creatures: { label: 'Creature sounds', on: true }
};
export const CHOICES = {
  musicTrack: { options: ['playlist', 'city'], value: 'playlist' }
};
const STORAGE_KEY = 'tornado-settings';

/** @typedef {keyof typeof SETTINGS} SettingKey */
/** @typedef {keyof typeof CHOICES} ChoiceKey */

/**
 * @param {Object} ctx
 * @returns {{
 *   get: (key: SettingKey) => boolean,
 *   set: (key: SettingKey, on: boolean) => void,
 *   choice: (key: ChoiceKey) => string,
 *   choose: (key: ChoiceKey, option: string) => void,
 *   initSettings: () => void
 * }}
 */
export function createSettingsSystem(ctx) {
  /** @type {Record<string, boolean>} */
  const values = {};
  for (const key of Object.keys(SETTINGS)) values[key] = SETTINGS[/** @type {SettingKey} */ (key)].on;
  /** @type {Record<string, string>} */
  const choices = {};
  for (const key of Object.keys(CHOICES)) choices[key] = CHOICES[/** @type {ChoiceKey} */ (key)].value;

  // What was saved last time, if the browser lets us read it (a private
  // window may not: then the defaults).
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
    for (const key of Object.keys(SETTINGS)) if (typeof saved[key] === 'boolean') values[key] = saved[key];
    for (const key of /** @type {ChoiceKey[]} */ (Object.keys(CHOICES))) {
      if (CHOICES[key].options.includes(saved[key])) choices[key] = saved[key];
    }
  } catch {
    // No storage: the defaults.
  }

  /**
   * @param {SettingKey} key
   * @returns {boolean}
   */
  function get(key) {
    return values[key];
  }

  /**
   * @param {SettingKey} key
   * @param {boolean} on
   * @returns {void}
   */
  function set(key, on) {
    values[key] = on;
    save();
    syncButton(key);
  }

  /** @returns {void} */
  function save() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...values, ...choices }));
    } catch {
      // Not saved: still on for this session.
    }
  }

  /**
   * @param {ChoiceKey} key
   * @returns {string} the option chosen
   */
  function choice(key) {
    return choices[key];
  }

  /**
   * @param {ChoiceKey} key
   * @param {string} option one of CHOICES[key].options
   * @returns {void}
   */
  function choose(key, option) {
    if (!CHOICES[key].options.includes(option)) return;
    choices[key] = option;
    save();
    syncChoice(key);
  }

  /**
   * @param {ChoiceKey} key
   * @returns {void}
   */
  function syncChoice(key) {
    for (const option of CHOICES[key].options) {
      const button = document.getElementById(`set-${key}-${option}`);
      if (!button) continue;
      const on = choices[key] === option;
      button.setAttribute('aria-pressed', String(on));
      button.classList.toggle('active', on);
    }
  }

  /**
   * @param {SettingKey} key
   * @returns {void}
   */
  function syncButton(key) {
    const button = document.getElementById(`set-${key}`);
    if (!button) return;
    const on = values[key];
    button.setAttribute('aria-pressed', String(on));
    button.classList.toggle('active', on);
    button.textContent = `${SETTINGS[key].label}: ${on ? 'on' : 'off'}`;
  }

  /**
   * The Sounds section's switches: each shows its setting and flips it.
   * @returns {void}
   */
  function initSettings() {
    for (const key of /** @type {SettingKey[]} */ (Object.keys(SETTINGS))) {
      const button = document.getElementById(`set-${key}`);
      if (!button) continue;
      syncButton(key);
      button.addEventListener('click', () => set(key, !values[key]), { signal: ctx.signal });
    }
    for (const key of /** @type {ChoiceKey[]} */ (Object.keys(CHOICES))) {
      for (const option of CHOICES[key].options) {
        const button = document.getElementById(`set-${key}-${option}`);
        if (button) button.addEventListener('click', () => choose(key, option), { signal: ctx.signal });
      }
      syncChoice(key);
    }
  }

  return { get, set, choice, choose, initSettings };
}
