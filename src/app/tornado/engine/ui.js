import { INITIAL_PEOPLE } from './environment/index.js';
import { STORM } from './scale.js';

/**
 * ===========================================================================
 * SECTION H — UI panel wiring
 * ===========================================================================
 */

const SLIDER_DEFS = [
  { id: 'intensity', fmt: v => v.toFixed(2) },
  { id: 'windSpeed', fmt: v => `${v} mph` },
  { id: 'radius', fmt: v => `${v} m` },
  { id: 'rotationSpeed', fmt: v => `${v.toFixed(1)} rad/s` },
  { id: 'debrisCount', fmt: v => `${v}` },
  { id: 'debrisSize', fmt: v => `${v.toFixed(1)}x` }
];

/**
 * Named presets (Instrucțiunea GG): every slider at once. Values sit
 * exactly on each slider's step (see SLIDER_DEFS in TornadoSimulator.js),
 * which is what lets a preset be recognised as "active" again after the
 * sliders have been moved and moved back.
 *
 * There is deliberately no separate multi-vortex preset: satellite
 * sub-vortices are driven by intensity alone (vortex.js SUB.gateLow/
 * gateHigh), and are already continuous and at full count from 0.95, so it
 * would be "EF5 Monster" with a slightly different radius.
 *
 * Fujiwhara (once "Outbreak") is the one preset that also sets how many
 * tornadoes there are: `startWith` of them when it is applied, and
 * `tornadoes` is the [min, max] the panel still recognises as this preset
 * once more have formed (engine/tornadoes.js). It always starts with two, so
 * there is a pair to merge, and a third forms on its own a minute into the
 * run (engine/fujiwhara.js setFujiwharaMode). Every other preset goes back to
 * one. It is sandbox-only: Chase Mode runs a single tornado (chase/index.js),
 * and the button is disabled while it is on.
 * @type {{id: string, label: string, params: Object<string, number>, tornadoes?: number[], startWith?: number, inDisasters?: boolean}[]}
 */
export const PRESETS = [
  {
    id: 'calm',
    label: 'Calm',
    params: { intensity: 0.25, windSpeed: 80, radius: 14, rotationSpeed: 1.5, debrisCount: 15, debrisSize: 0.8 }
  },
  {
    // The simulator's defaults: the EF4 baseline. Funnel radii are against
    // a town of real-size buildings (engine/scale.js STORM): 60 m across
    // takes a block at a time.
    id: 'severe',
    label: 'Severe',
    params: { intensity: 0.75, windSpeed: 220, radius: STORM.radius.default, rotationSpeed: 3.5, debrisCount: 40, debrisSize: 1.0 }
  },
  {
    id: 'monster',
    label: 'Monster',
    params: { intensity: 1, windSpeed: 320, radius: 44, rotationSpeed: 5.5, debrisCount: 50, debrisSize: 1.6 }
  },
  {
    // Two full-size, strong-EF4 tornadoes set up to merge, and a third a
    // minute later.
    id: 'fujiwhara',
    label: 'Fujiwhara',
    // Shown among the disasters (TornadoSimulator.js), not the presets:
    // it sets off an event rather than just tuning the storm.
    inDisasters: true,
    params: { intensity: 0.8, windSpeed: 240, radius: 26, rotationSpeed: 4, debrisCount: 50, debrisSize: 1.2 },
    tornadoes: [2, 3],
    startWith: 2
  }
];

/**
 * @param {Object} ctx
 * @param {{ startSim: () => void, togglePause: () => void, resetSim: () => void }} controllers
 *   SECTION J's start/pause/reset controllers -- passed in explicitly rather
 *   than looked up lazily via ctx.systems, since they stay owned by
 *   tornadoEngine.js itself (orchestration glue touching nearly every
 *   system) rather than becoming their own factory module.
 * @returns {{
 *   initUI: () => void,
 *   updateStatsPanel: () => void,
 *   setStat: (label: string, value: number|string) => void,
 *   applyPreset: (id: string) => void,
 *   setParams: (params: Object<string, number>) => void
 * }}
 */
/**
 * Where the panel's open/shut state is remembered between visits. Namespaced
 * because this page can be running inside a Luigi shell alongside others.
 *
 * Exported because TornadoSimulator.js reads it too: the *initial* state has
 * to be applied before the first paint, which is long before this module's
 * initUI() runs (see the note on the layout effect there). This module owns
 * the toggle; the component owns the start.
 */
export const PANEL_STORAGE_KEY = 'tornado.panel.collapsed';

export function createUISystem(ctx, controllers) {
  const { Sim } = ctx;
  const { startSim, togglePause, resetSim } = controllers;
  // Each stats readout's element and the text last written to it (setStat).
  /** @type {Map<string, {el: HTMLElement|null, text: string|null}>} */
  const statCache = new Map();

  /**
   * Marks the preset whose values every slider currently matches, if any.
   * Reads the sliders rather than Sim.params, because Chase Mode drives
   * intensity/wind/rotation underneath the untouched sliders.
   * @returns {void}
   */
  function highlightMatchingPreset() {
    const count = ctx.tornadoes.count();
    // The Presets fold's summary names the one in force, so a shut fold
    // still says which it is.
    let current = 'Custom';
    for (const preset of PRESETS) {
      const [min, max] = preset.tornadoes || [1, 1];
      const matches = count >= min && count <= max && Object.entries(preset.params).every(([id, value]) => {
        const input = /** @type {HTMLInputElement|null} */ (document.getElementById('p-' + id));
        return !!input && Math.abs(parseFloat(input.value) - value) < 1e-6;
      });
      const button = document.getElementById('preset-' + preset.id);
      if (button) {
        button.classList.toggle('active', matches);
        button.setAttribute('aria-pressed', String(matches));
      }
      if (matches) current = preset.label;
    }
    const note = document.getElementById('fold-note-presets');
    if (note) note.textContent = current;
  }

  /**
   * Sets one parameter from the UI: slider, readout and Sim.params
   * together, exactly as dragging the slider does, so it applies live
   * whether the run is idle, running or paused.
   *
   * Chase Mode is the one exception. While it is active, applyChaseDifficulty()
   * (chase/drive.js) rewrites intensity/windSpeed/rotationSpeed in Sim.params
   * every frame from its own ramp, and exitChaseMode() then restores the
   * snapshot Chase.savedParams took on entry. Writing Sim.params here would
   * therefore be undone twice over: the ramp overwrites it on the next frame,
   * and the stale snapshot overwrites it again on exit -- leaving the slider
   * and its readout showing a wind speed the sandbox never actually goes back
   * to. So a change to one of those three is written into the snapshot
   * instead, which is exactly what the panel is promising: "this is what the
   * sandbox will be running once the chase ends".
   * @param {{id: string, fmt: (v: number) => string}} def
   * @param {number} value
   * @returns {void}
   */
  function setParam(def, value) {
    const saved = ctx.Chase && ctx.Chase.active ? ctx.Chase.savedParams : null;
    if (saved && def.id in saved) saved[def.id] = value;
    else Sim.params[def.id] = value;
    document.getElementById('v-' + def.id).textContent = def.fmt(value);
    if (def.id === 'debrisCount') ctx.systems.debris.reconcileDebrisTarget();
  }

  /**
   * Writes a group of parameters into the panel exactly as dragging their
   * sliders would: slider position, readout and Sim.params together. Ids the
   * object does not mention are left alone.
   *
   * Exists for the storm modes that own the sliders rather than merely reading
   * them -- at present the EF5 wedge (engine/wedge.js), which maxes them out on
   * the way up. A mode writing Sim.params directly would leave every slider and
   * readout in the panel describing a storm that is no longer running.
   * @param {Object<string, number>} params
   * @returns {void}
   */
  function setParams(params) {
    for (const def of SLIDER_DEFS) {
      if (!(def.id in params)) continue;
      const input = /** @type {HTMLInputElement|null} */ (document.getElementById('p-' + def.id));
      if (input) input.value = String(params[def.id]);
      setParam(def, params[def.id]);
    }
    highlightMatchingPreset();
  }

  /**
   * Applies a named preset to every slider at once.
   * @param {string} id
   * @returns {void}
   */
  function applyPreset(id) {
    const preset = PRESETS.find(p => p.id === id);
    if (!preset) return;
    // Presets that set how many tornadoes there are belong to the sandbox
    // alone: Chase Mode and Possess mode each drive one funnel, and so does
    // an EF5 wedge (which has already switched an Outbreak down to one on its
    // way up, and would end up fighting a Fujiwhara merge over the same field
    // if a second came back). Looked up lazily so this module stays
    // constructible before any of them.
    const single = (ctx.Chase && ctx.Chase.active)
      || (ctx.Possess && ctx.Possess.active)
      || (ctx.systems.wedge && ctx.systems.wedge.isActive());
    if (preset.tornadoes && single) return;
    const [min, max] = preset.tornadoes || [1, 1];
    ctx.tornadoes.setCount(preset.startWith || min + Math.floor(Math.random() * (max - min + 1)));
    // The extra tornado a minute in belongs to this preset alone.
    ctx.systems.fujiwhara.setFujiwharaMode(preset.id === 'fujiwhara');
    setParams(preset.params);
  }

  /** @returns {void} */
  /**
   * Opens or shuts the panel. The class does the animating (see tornado.css);
   * everything here is the state that has to agree with it -- what the button
   * says, what it announces, and what the player gets next time.
   * @param {boolean} collapsed
   * @returns {void}
   */
  function setPanelCollapsed(collapsed) {
    const panel = document.getElementById('ui-panel');
    const button = document.getElementById('btn-panel-toggle');
    if (!panel || !button) return;
    panel.classList.toggle('collapsed', collapsed);
    button.setAttribute('aria-expanded', String(!collapsed));
    const label = collapsed ? 'Show the controls' : 'Hide the controls';
    button.title = label;
    const sr = button.querySelector('.sr-only');
    if (sr) sr.textContent = label;
    try {
      window.localStorage.setItem(PANEL_STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      // Not being able to remember it is not a reason to fail to do it.
    }
  }

  /**
   * Wires the toggle. The panel is already open or shut by the time this runs
   * -- TornadoSimulator.js decides that before the first paint, because this
   * module is only reached at the end of the engine's start-up and on a phone
   * that is several seconds of the panel being visibly wrong. All this does is
   * adopt the state that is already there and take the click from then on.
   * @returns {void}
   */
  function initPanelToggle() {
    const panel = document.getElementById('ui-panel');
    const button = document.getElementById('btn-panel-toggle');
    if (!panel || !button) return;
    setPanelCollapsed(panel.classList.contains('collapsed'));
    // Start-up is over: from here a fold is a fold (see the layout effect in
    // TornadoSimulator.js).
    panel.classList.remove('panel-boot');
    button.addEventListener('click', () => {
      setPanelCollapsed(!panel.classList.contains('collapsed'));
    }, { signal: ctx.signal });
  }

  function initUI() {
    for (const def of SLIDER_DEFS) {
      const input = /** @type {HTMLInputElement|null} */ (document.getElementById('p-' + def.id));
      const label = document.getElementById('v-' + def.id);
      label.textContent = def.fmt(Sim.params[def.id]);
      input.addEventListener('input', () => {
        setParam(def, parseFloat(input.value));
        highlightMatchingPreset();
      }, { signal: ctx.signal });
    }
    for (const preset of PRESETS) {
      const button = document.getElementById('preset-' + preset.id);
      // Picking a preset starts the storm if it is not already running (the
      // Tornado button being the other way), on request.
      if (button) {
        button.addEventListener('click', () => {
          applyPreset(preset.id);
          // Mid-run, startSim brings back a funnel Roger has put out.
          startSim();
        }, { signal: ctx.signal });
      }
    }
    highlightMatchingPreset();

    initPanelToggle();

    document.getElementById('btn-start').addEventListener('click', startSim, { signal: ctx.signal });
    document.getElementById('btn-pause').addEventListener('click', togglePause, { signal: ctx.signal });
    document.getElementById('btn-reset').addEventListener('click', resetSim, { signal: ctx.signal });

    const { SoundSystem } = ctx.systems.sound;

    const muteBtn = document.getElementById('btn-mute');
    muteBtn.addEventListener('click', () => {
      SoundSystem.muted = !SoundSystem.muted;
      muteBtn.textContent = SoundSystem.muted ? 'Unmute' : 'Mute';
      muteBtn.setAttribute('aria-pressed', String(SoundSystem.muted));
      muteBtn.classList.toggle('active', SoundSystem.muted);
    }, { signal: ctx.signal });

    const volumeInput = /** @type {HTMLInputElement|null} */ (document.getElementById('p-volume'));
    SoundSystem.volume = parseFloat(volumeInput.value);
    volumeInput.addEventListener('input', () => {
      SoundSystem.volume = parseFloat(volumeInput.value);
    }, { signal: ctx.signal });

    // The button's own text and state are set by setCinematicView (camera.js),
    // which is also reached without a click.
    const cinematicBtn = document.getElementById('btn-cinematic');
    cinematicBtn.addEventListener('click', () => ctx.setCinematicView(!ctx.Cinematic.active), { signal: ctx.signal });

    ctx.systems.chase.initChaseUI();
    ctx.systems.possess.initPossessUI();
  }

  /**
   * @param {string} label
   * @param {number|string} value
   * @returns {void}
   */
  function setStat(label, value) {
    // Written only when it changes (performance pass): a DOM write per stat
    // per frame was a third of a millisecond a frame for text that mostly
    // reads the same.
    const text = String(value);
    let entry = statCache.get(label);
    if (!entry) {
      entry = { el: document.getElementById(label), text: null };
      statCache.set(label, entry);
    }
    if (!entry.el || entry.text === text) return;
    entry.text = text;
    entry.el.textContent = text;
  }

  /** @returns {void} */
  function updateStatsPanel() {
    const p = Sim.params;
    const s = Sim.stats;
    // Rounded, not printed raw. The sliders only ever produce values on their
    // own step (windSpeed in fives, radius whole metres), so the raw numbers
    // read fine in the sandbox -- but Chase Mode's difficulty ramp
    // (chase/drive.js) lerps these continuously, and this row then showed
    // "243.87532112 mph" against the slider's untouched "220 mph". The stats
    // panel is the readout that tracks what is actually driving the
    // simulation, so it is the one that has to stay legible while the ramp
    // owns the value.
    setStat('s-windSpeed', `${Math.round(p.windSpeed)} mph`);
    setStat('s-intensity', `EF${Math.min(5, Math.floor(p.intensity * 6))}`);
    // The funnel's actual size, not the slider's: a Fujiwhara monster and an
    // EF5 wedge are both several times wider than the Radius slider can ask
    // for (Vortex.sizeMul), and this row is the one that reports what is
    // really out there. The slider keeps its own readout in the Storm fold.
    setStat('s-radius', `${Math.round(p.radius * ctx.Vortex.sizeMul)} m`);
    setStat('s-affected', s.objectsAffected);
    // No duration any more: the storm runs until the player resets it, so
    // this is a stopwatch rather than a countdown.
    setStat('s-elapsed', `${Sim.state.elapsed.toFixed(0)} s`);
    setStat('s-score', s.damageScore);
    // Buildings a neighbour's collapse brought down, of the total collapsed
    // (see the chain-reaction block in damage.js).
    setStat('s-chain', `${s.chainCollapses} / ${s.buildingsCollapsed}`);
    // Burning right now, and how many the fire has finished off over the run
    // (engine/buildingFire.js).
    setStat('s-fire', `${ctx.systems.buildingFire.burningCount()} / ${s.buildingsBurned}`);
    setStat('s-impacts', s.debrisImpacts);
    setStat('s-sheltered', s.peopleSheltered);
    // Two numbers: how many are reeling right now, and how many have been
    // dropped and picked themselves back up over the whole run.
    const dazedNow = ctx.Environment.people.reduce(
      (n, person) => n + (person.motion && person.motion.mode === 'dazed' ? 1 : 0), 0
    );
    setStat('s-dazed', `${dazedNow} / ${s.peopleDazed}`);
    // At large: still on their feet in the open. Struck or sheltered people
    // leave the list; anyone the vortex has taken hands their motion over
    // to physics for good (peopleMotion.js), even once dropped back down.
    setStat('s-atlarge', ctx.Environment.people.reduce((n, p) => n + (p.motion && p.motion.active ? 1 : 0), 0));

    // The other side of the ledger: what the town managed to hang on to
    // (engine/emergency/index.js, engine/evacuation.js). Saved is the total
    // of every way out -- a shelter door, an ambulance, a bus -- because that
    // is the number the damage score is really being weighed against.
    const saved = s.peopleSheltered + s.peopleRescued + s.peopleEvacuated;
    setStat('s-saved', saved);
    setStat('s-rescued', `${s.peopleRescued} / ${s.peopleEvacuated}`);
    setStat('s-doused', s.firesDoused);
    // Everyone the town has had this run, and where they are now: still out
    // in it, got out (a shelter, an ambulance, a bus), or lost.
    const total = INITIAL_PEOPLE + ctx.systems.reinforcements.spawnedCount();
    const left = ctx.Environment.people.length;
    const lost = Math.max(0, total - left - saved);
    setStat('humans-left', left);
    setStat('humans-total', total);
    setStat('humans-saved', saved);
    setStat('humans-lost', lost);
    // What "safe" is made of, on hover: it only moves when someone gets into
    // a bunker or onto an ambulance or a bus, which is why it can sit still
    // for most of a run once the bunkers have filled up early on.
    const detail = document.getElementById('humans-sub-detail');
    if (detail) {
      detail.title = `Safe: ${s.peopleSheltered} in bunkers · ${s.peopleRescued} by ambulance · `
        + `${s.peopleEvacuated} by evacuation bus. Dead: killed by the storm, fire, water, electrocution or the ground, `
        + `or abducted by the aliens (${ctx.systems.aliens.abductedCount()} so far).`;
    }
    const fleet = ctx.systems.emergency.fleetStatus();
    setStat('s-units', `${fleet.live} / ${fleet.total}`);

    // A shut fold still shows the one number that section is about, so
    // collapsing the panel costs no information worth having at a glance.
    setStat('fold-note-storm', `${Math.round(p.windSpeed)} mph · EF${Math.min(5, Math.floor(p.intensity * 6))}`);
    setStat('fold-note-stats', `${s.damageScore} pts · ${saved} saved`);

    const label = document.getElementById('damage-label');
    let text = 'STANDING BY';
    let colour = '#1c2430';
    if (Sim.state.running) {
      if (s.damageScore < 50) { text = 'MINOR'; colour = '#2f6fe0'; }
      else if (s.damageScore < 250) { text = 'MODERATE'; colour = '#d1a11b'; }
      else if (s.damageScore < 800) { text = 'SEVERE'; colour = '#d15c1b'; }
      else { text = 'CATASTROPHIC'; colour = '#c22a2a'; }
    }
    label.textContent = text;
    label.style.background = colour;
  }

  return { initUI, updateStatsPanel, setStat, applyPreset, setParams, highlightMatchingPreset };
}
