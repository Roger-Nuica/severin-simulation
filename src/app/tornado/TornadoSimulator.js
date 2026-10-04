'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { createSimulation } from './tornadoEngine.js';
import { PRESETS, PANEL_STORAGE_KEY } from './engine/ui.js';
import { STORM } from './engine/scale.js';

/**
 * Parameter sliders shown in the UI panel — kept as a plain data array
 * (matching SLIDER_DEFS inside tornadoEngine.js, which reads the exact
 * same "p-" and "v-" prefixed element ids via document.getElementById) so
 * adding a slider only means adding one entry here and one entry in
 * tornadoEngine.js.
 */
const SLIDER_DEFS = [
  { id: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, defaultValue: 0.75, display: '0.75' },
  { id: 'windSpeed', label: 'Wind Speed', min: 20, max: 320, step: 5, defaultValue: 220, display: '220 mph' },
  { id: 'radius', label: 'Tornado Radius', min: STORM.radius.min, max: STORM.radius.max, step: 1, defaultValue: STORM.radius.default, display: `${STORM.radius.default} m` },
  { id: 'rotationSpeed', label: 'Rotation Speed', min: 0.5, max: 6, step: 0.1, defaultValue: 3.5, display: '3.5 rad/s' },
  { id: 'debrisCount', label: 'Debris Count', min: 10, max: 50, step: 5, defaultValue: 40, display: '40' },
  { id: 'debrisSize', label: 'Debris Size', min: 0.4, max: 2.5, step: 0.1, defaultValue: 1.0, display: '1.0x' },
];

/**
 * Client component hosting the tornado simulator. It renders a plain-DOM
 * UI panel / stats panel / fps counter (same element ids the engine below
 * queries), and mounts the Three.js engine (tornadoEngine.js) into a ref'd
 * container div. All interactivity (slider input, start/pause/reset, stat
 * updates) is handled imperatively inside tornadoEngine.js via
 * document.getElementById — this component's only React-specific
 * responsibility is mounting/unmounting the engine.
 * @returns {import('react').JSX.Element}
 */
export default function TornadoSimulator() {
  const mountRef = useRef(null);

  // Whether the controls start folded away, decided before the first paint.
  //
  // This cannot wait for the engine. createSimulation() builds the town, its
  // textures and its shaders synchronously and only calls initUI() at the end
  // of all that, which on a phone is several seconds of blocked main thread --
  // and for every one of those seconds the panel would be sitting fully open
  // across the screen before snapping shut. useLayoutEffect runs before the
  // browser paints and before the engine's own useEffect below, so the panel
  // is never seen in the wrong state.
  //
  // It is here rather than in the markup because the decision needs `window`,
  // and this page is prerendered: choosing during render would mean the server
  // and the client disagreeing about the class, which React treats as a
  // hydration error.
  useLayoutEffect(() => {
    const panel = document.getElementById('ui-panel');
    if (!panel) return;
    let collapsed = null;
    try {
      const stored = window.localStorage.getItem(PANEL_STORAGE_KEY);
      if (stored === '1') collapsed = true;
      else if (stored === '0') collapsed = false;
    } catch {
      // Storage can be unavailable outright -- a private window, blocked site
      // data, or this page running in a Luigi iframe with third-party storage
      // partitioned off. Fall through to the viewport.
    }
    if (collapsed === null) {
      // No remembered choice: open on a laptop, shut on a phone, where the
      // panel is most of the screen and the storm is the point.
      collapsed = window.matchMedia('(max-width: 700px)').matches;
    }
    panel.classList.toggle('collapsed', collapsed);
    // Folding is a transition, and a transition applied at start-up is not a
    // fold, it is the panel visibly shutting itself while the player watches.
    // Worse here than usual: the engine blocks the main thread for seconds
    // immediately after this, so the animation cannot even tick and the panel
    // hangs half closed. ui.js takes this back off once it has finished
    // booting and wired the button up, which is exactly when an animated fold
    // starts being something the player asked for.
    panel.classList.add('panel-boot');
  }, []);

  useEffect(() => {
    const simulation = createSimulation(mountRef.current);
    // Cleanup: stops the render loop, removes listeners, disposes the
    // WebGL context. Runs if this component ever unmounts (e.g. the user
    // navigates to another Luigi node and this iframe's document is torn
    // down) — without it the requestAnimationFrame loop would keep running
    // forever against a detached canvas.
    return () => simulation.dispose();
  }, []);

  return (
    <>
      <div id="ui-panel">
        {/* The header is the one part of the panel that never collapses, so
            the control that brings it back is always on screen and always in
            the same place. Everything below it lives in #panel-body, which is
            what actually folds away (see ui.js setPanelCollapsed). */}
        <div className="panel-header">
          <span className="swirl" aria-hidden="true" />
          <h1>TORNADO SIMULATOR</h1>
          <button
            id="btn-panel-toggle"
            className="panel-toggle"
            type="button"
            aria-expanded="true"
            aria-controls="panel-body"
            title="Hide the controls"
          >
            <span className="panel-toggle-icon" aria-hidden="true" />
            <span className="sr-only">Hide the controls</span>
          </button>
        </div>

        <div id="panel-body">

        {/* Named presets: ui.js sets every slider from PRESETS and marks the
            one the sliders currently match (and names it in the summary).
            Folded by default, like every section below, so the panel opens
            on the buttons that start things. Fujiwhara is one of PRESETS but
            sets off an event, so it is shown among the disasters. */}
        <details className="fold">
          <summary><span className="fold-icon" aria-hidden="true">🎮</span>Presets<span className="fold-note" id="fold-note-presets" /></summary>
          <div className="fold-body">
            <div className="presets" role="group" aria-label="Storm presets">
              {PRESETS.filter((preset) => !preset.inDisasters).map((preset) => (
                <button key={preset.id} id={`preset-${preset.id}`} type="button" aria-pressed="false">
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </details>

        {/* The panel is folded into <details> sections rather than one long
            column: with twelve stat rows, six sliders and four disaster
            buttons it had grown past the height of a laptop viewport, and
            everything below the fold was only reachable by scrolling the
            panel itself. Each section keeps the exact element ids the engine
            queries, so folding is purely presentational. */}
        <details className="fold">
          <summary><span className="fold-icon" aria-hidden="true">🌪️</span>Storm<span className="fold-note" id="fold-note-storm" /></summary>
          <div className="fold-body">
            {SLIDER_DEFS.map((def) => (
              <div className="group" key={def.id}>
                <label>
                  {def.label} <span className="val" id={`v-${def.id}`}>{def.display}</span>
                </label>
                <input
                  type="range"
                  id={`p-${def.id}`}
                  min={def.min}
                  max={def.max}
                  step={def.step}
                  defaultValue={def.defaultValue}
                />
              </div>
            ))}
          </div>
        </details>

        {/* engine/settings.js: the sound and rain switches, kept between
            sessions. A new switch is a button with id "set-<key>" here and a
            key in SETTINGS there. */}
        <details className="fold">
          <summary><span className="fold-icon" aria-hidden="true">🔊</span>Sounds</summary>
          <div className="fold-body">
            <div className="group audio-group">
              <label>
                Sound
                <button id="btn-mute" className="pill" type="button" aria-pressed="false">Mute</button>
              </label>
              <input type="range" id="p-volume" min="0" max="1" step="0.05" defaultValue={0.7} />
            </div>

            <div className="group settings-group">
              <span className="pill-row">
                <button id="set-rainVisual" className="pill" type="button" aria-pressed="true"
                  title="The rain drawn over the town">Rain: on</button>
                <button id="set-rainSound" className="pill" type="button" aria-pressed="true"
                  title="The storm's wind-and-rain hiss (its low rumble stays)">Rain sound: on</button>
                <button id="set-music" className="pill" type="button" aria-pressed="true"
                  title="The background music (an event's own track still plays)">Music: on</button>
                <button id="set-creatures" className="pill" type="button" aria-pressed="true"
                  title="The creatures' voices, steps, attacks and deaths: aliens, the Yeti and T-Rex, Hank, Terminators, Patient Zero, Captain Spotless">Creature sounds: on</button>
              </span>
              {/* Which background music (engine/settings.js CHOICES,
                  sound/cues.js): crossfades over about a second. */}
              <span className="pill-row" role="group" aria-label="Music track">
                <button id="set-musicTrack-playlist" className="pill" type="button" aria-pressed="true"
                  title="The current background music: guta.mp3 and drobeta.mp3, in turn">🎵 Guta · Drobeta</button>
                <button id="set-musicTrack-city" className="pill" type="button" aria-pressed="false"
                  title="The old background track: city-sound.wav, looped">🏙️ City sound</button>
              </span>
            </div>
          </div>
        </details>

        {/* engine/missions.js: timed missions over the game's statistics
            (plan PR 7). One at a time; the tracker shows at the top. */}
        <details className="fold">
          <summary><span className="fold-icon" aria-hidden="true">🎯</span>Missions</summary>
          <div className="fold-body">
            <div className="group missions-group">
              <span className="pill-row">
                <button id="mission-demolition" className="pill" type="button"
                  title="Bring down 30 buildings in 60 s · +5000">Demolition</button>
                <button id="mission-evacuation" className="pill" type="button"
                  title="Get 50 people out on the evacuation buses in 4 min · +6000">Evacuation</button>
                <button id="mission-fireCrew" className="pill" type="button"
                  title="Burn every alien on the ground with the Firenado in 2 min · +7000 (needs aliens: call the UFO first)">Fire crew</button>
                <button id="mission-safeHouse" className="pill" type="button"
                  title="Get 40 people into the storm shelters in 90 s · +4000">Safe house</button>
                <button id="mission-airCowboy" className="pill" type="button"
                  title="Send 4 cows from the pasture up the funnel in 2 min · +3000">Air cowboy</button>
              </span>
            </div>
          </div>
        </details>

        {/* engine/environment/crowd.js: how the townspeople behave when the
            funnel comes (plan PR 6). A preset sets the sliders; the sliders
            can then be moved on their own. */}
        <details className="fold">
          <summary><span className="fold-icon" aria-hidden="true">👥</span>Crowd</summary>
          <div className="fold-body">
            <div className="group crowd-group">
              <span className="pill-row">
                <button id="crowd-normal" className="pill" type="button" aria-pressed="true"
                  title="As the town always was">Normal</button>
                <button id="crowd-aggressive" className="pill" type="button" aria-pressed="false"
                  title="Many stand their ground facing the funnel (dark red)">Aggressive</button>
                <button id="crowd-coward" className="pill" type="button" aria-pressed="false"
                  title="They run off in random directions and forget the shelters">Coward</button>
                <button id="crowd-leader" className="pill" type="button" aria-pressed="false"
                  title="A few leaders (orange vests) take the others to the shelters">Leader</button>
                <button id="crowd-mixed" className="pill" type="button" aria-pressed="false"
                  title="A bit of everything">Mixed</button>
              </span>
              {[['panic', 'Panic', 'How early they notice the funnel and how hard they run'],
                ['herd', 'Herd', 'How much they run the way the others run'],
                ['shelter', 'Shelter', 'How many think of a storm shelter']].map(([key, label, title]) => (
                <label key={key} className="crowd-slider" title={title}>
                  {label} <span id={`crowd-${key}-value`} className="crowd-value"></span>
                  <input type="range" id={`crowd-${key}`} min="0" max="100" step="5" />
                </label>
              ))}
            </div>
          </div>
        </details>

        <details className="fold">
          <summary><span className="fold-icon" aria-hidden="true">🎥</span>Camera</summary>
          <div className="fold-body">
            <div className="group camera-group">
              <label>
                Drive
                <span className="pill-row">
                  <button id="btn-chase" className="pill" type="button" aria-pressed="false">Chase Mode</button>
                  <button id="btn-cockpit" className="pill" type="button" aria-pressed="false" disabled>Cockpit View</button>
                </span>
              </label>
              {/* Hidden for now, on request: Day Mode (engine/dayNight.js) is
                  kept working behind it, just not offered. */}
              <label style={{ display: 'none' }}>
                Scene
                <button id="btn-daymode" className="pill" type="button" aria-pressed="false">Day Mode</button>
              </label>
            </div>
          </div>
        </details>

        <details className="fold">
          <summary><span className="fold-icon" aria-hidden="true">💥</span>Disasters</summary>
          <div className="fold-body">
            {/* Every disaster the same chunky tile, the modes that stay on
                (Electric Tornado, Final Boss, Doomsday) and Fujiwhara
                included: they light up while they are on. What each one
                does is on hover. */}
            <div className="event-grid">
              <button id="btn-electric" className="pill event" type="button" aria-pressed="false"
                title="Electric Tornado: arc storm · chain lightning · EMP">⚡ Electric</button>
              {/* engine/wedge.js: the funnel at the scale where the town has
                  no outside left. */}
              <button id="btn-wedge" className="pill event" type="button" aria-pressed="false"
                title="Final Boss: wider than the town · nowhere beside it">👹 Final Boss</button>
              {/* engine/doomsday.js: the running order for all of them. */}
              <button id="btn-doomsday" className="pill event" type="button" aria-pressed="false"
                title="Doomsday: every disaster, in order, on a timer">☠️ Doomsday</button>
              {/* A preset underneath (ui.js PRESETS), wired by its id. */}
              <button id="preset-fujiwhara" className="pill event" type="button" aria-pressed="false"
                title="Fujiwhara: twin vortices · rotation merge">🌀 Fujiwhara</button>
              <button id="btn-ignite" className="pill event" type="button">🔥 Ignite</button>
              <button id="btn-earthquake" className="pill event" type="button">🌎 Earthquake</button>
              <button id="btn-flood" className="pill event" type="button">🌊 Dam Break</button>
              <button id="btn-meteors" className="pill event" type="button">☄️ Meteors</button>
              {/* engine/downburst.js: comes down under whatever the camera is
                  looking at. */}
              <button id="btn-downburst" className="pill event" type="button" aria-pressed="false"
                title="Downburst: a column of air slams down and blows everything one way · 30-45 s">⬇️ Downburst</button>
              {/* engine/solarStorm.js: aurora and a town-wide blackout;
                  engines and machines stall, and Roger's EMP runs down the
                  power lines while it lasts. */}
              <button id="btn-solar" className="pill event" type="button" aria-pressed="false"
                title="Solar Storm: a flare, then aurora overhead and a blackout across town · cars stall, Terminators and ships lock up · in Hero Mode your EMP (R) runs down the power lines · ~40 s">☀️ Solar Storm</button>
              {/* engine/strikeTargeting.js: click (or drag) the ground to
                  call lightning down; Esc or the tile again to stop. */}
              <button id="btn-strike" className="pill event" type="button" aria-pressed="false"
                title="Lightning: click the ground to call down 3-5 strikes, hold and drag to paint · Esc to stop">🌩️ Lightning</button>
              <button id="btn-gas" className="pill event" type="button">🛢️ Gas Main</button>
              {/* engine/fuelFire.js: a leak at a fuel station (the one nearest
                  Roger in Hero Mode): alarm, fire, then the blast. */}
              <button id="btn-fuel-station" className="pill event" type="button"
                title="Fuel station: the pumps rupture, the fuel catches and the tanks go up, with the cars round it. In Hero Mode, the station nearest Roger: stand near the blast to soak up energy.">⛽ Fuel Station</button>
              {/* engine/spaceship.js: Landing Support. Opens the targeting
                  marker (the same as T); R or T then picks the option. */}
              <button id="btn-landing" className="pill event" type="button" aria-pressed="false"
                title="Landing Support (T): aim the marker, then R for Samurai Support (10 samurai clear 100 m of aliens and the T-Rex) or T for a Rocket Strike (steer it with W A S D as it falls). Esc or right-click cancels.">🛸 Landing</button>
              {/* engine/terminator.js: only the Electric Tornado's EMP stops it. */}
              <button id="btn-terminator" className="pill event" type="button"
                title="Send in a Terminator. It hunts people, and only an EMP discharge from the Electric Tornado can destroy it.">🤖 Terminator</button>
              {/* engine/gunner.js: HAVOC, Hero Mode only. Time Slow (Q) stops his rounds. */}
              <button id="btn-gunner" className="pill event" type="button"
                title="Hero Mode: send in HAVOC, a heavy gunner with a minigun (one more per press, up to 3). Press Q to slow time: his rounds stop dead round Roger, and go back to him when time runs again.">🔫 HAVOC</button>
              {/* engine/trex.js: a cyber T-Rex walks into town breathing fire
                  (plan PR 3). One at a time. */}
              <button id="btn-trex" className="pill event" type="button"
                title="Cyber T-Rex: a giant with metal implants walks in and breathes fire that sets buildings alight. In Hero Mode it hunts Roger. Plasma, the minigun, lightning and Roger's EMP (E, stuns it) hurt it; the mega beam kills it.">🦖 Cyber T-Rex</button>
              {/* engine/yeti.js and engine/blizzard.js (plan PR 4). */}
              <button id="btn-yeti" className="pill event" type="button"
                title="Cyber Yeti: an elite enemy inside its own ice storm. Stay in the snow and Roger freezes; enemies freeze in blocks of ice; people become ice statues that shatter at any impact.">🦍 Cyber Yeti</button>
              <button id="btn-blizzard" className="pill event" type="button" aria-pressed="false"
                title="Blizzard: every funnel becomes an ice tornado. People near it turn to ice statues, enemies and Roger freeze, the dam's water and the earthquake's lava freeze over. Press again to stop (the water and the chasm thaw).">❄️ Blizzard</button>
              {/* engine/actionHero.js and engine/cleaner.js (plan PR 10): the
                  random events, also on demand. Original characters. */}
              <button id="btn-hank" className="pill event" type="button"
                title="Hank Granite: a cinematic scene. The camera locks on him, the world slows, five people line up and he punches them one by one -- one blown apart, the rest thrown off the map. Only from this button.">👊 Hank Granite</button>
              <button id="btn-spotless" className="pill event" type="button"
                title="Captain Spotless: a giant of light strides across town. Debris gone, fires out, enemies disintegrated, and a blinding glare. Also comes at random once a run.">✨ Captain Spotless</button>
              {/* engine/waterspout.js (plan PR 9): a tornado over the dam's lake. */}
              <button id="btn-waterspout" className="pill event" type="button"
                title="Waterspout: a tornado over the lake behind the dam. Waves, spray and mist; it takes the boats; left against the dam it throws the lake over the wall.">🌊 Waterspout</button>
              {/* engine/volcano.js (plan PR 8): a cone over the quake's caldera
                  (or on open ground, with a quake), then 60 s of lava bombs. */}
              <button id="btn-volcano" className="pill event" type="button"
                title="Volcano: a cone grows over the earthquake's caldera (or out on open ground, with a quake) and erupts for 60 s, throwing lava bombs that set buildings alight. Press again once it sleeps to wake it. The Blizzard freezes it.">🌋 Volcano</button>
              {/* engine/missions.js: the storm on and Demolition (plan PR 7). */}
              <button id="btn-test-mission" className="pill event" type="button"
                title="Mission test: starts the storm and the Demolition mission (30 buildings in 60 s).">🎯 Mission</button>
              {/* engine/patientZero.js. (The black hole is a weapon now: the
                  Black Hole Gun on Roger's wheel, engine/heroWeapons.js.) */}
              <button id="btn-patient-zero" className="pill event" type="button"
                title="Patient Zero: it copies itself (up to 50 clones) and turns anyone it touches into one. The original wears a green halo; kill it and every clone dies with it.">🧟 Patient Zero</button>
              {/* engine/environment/crowd.js: the next crowd preset, with the
                  storm started if it is not (plan PR 6). */}
              <button id="btn-test-crowd" className="pill event" type="button"
                title="Crowd test: switches to the next crowd preset (Normal, Aggressive, Coward, Leader, Mixed) and starts the storm if it is not running.">👥 Crowd</button>
              {/* engine/nuclear/panel.js: the nuclear plants (plan PR 1b). */}
              <button id="btn-test-plug" className="pill event" type="button"
                title="Plug in: starts Hero Mode with 10% energy and puts Roger at a nuclear plant's charging terminal. Standing there fills the bar to 100%.">🔌 Plug In</button>
              <button id="btn-meltdown" className="pill event" type="button"
                title="Meltdown: a nuclear plant goes critical and up (in Hero Mode, the one farthest from Roger): the biggest blast in the game and the green EMP that turns everyone into aliens.">☢️ Meltdown</button>
            </div>
          </div>
        </details>

        {/* Kept beside Tornado/Pause/Reset rather than folded away under
            "Camera & sound", so the mode that lets you fly the tornado
            (engine/possess.js) and the cinematic orbit (engine/camera.js)
            are both visible without expanding anything. */}
        <div className="buttons">
          <button id="btn-possess" className="primary" type="button" aria-pressed="false">🕹️ Control Tornado</button>
          <button id="btn-cinematic" type="button" aria-pressed="false">🎬 Cinematic View</button>
        </div>
        {/* engine/heroMode.js: a game mode of its own, so it sits with the
            other two rather than among the one-off events. */}
        <div className="buttons hero-row">
          <button id="btn-hero" type="button" aria-pressed="false"
            title="Play as Roger, free in town. Send in the Terminators from the panel when you are ready. Right-click raises a weapon, left-click or Enter fires, the wheel switches weapon.">🦸 Hero</button>
          {/* engine/smoothCriminal.js: a stage in the middle of town, the
              song, and everyone dancing. Up here beside Hero, on request,
              rather than among the disasters. */}
          <button id="btn-smooth" type="button" aria-pressed="false"
            title="Smooth Criminal: a stage in the middle of town, the song, and everyone -- people and aliens -- stops fighting and dances. Kill anyone and it is over.">🕺 Smooth Criminal</button>
        </div>

        <div className="buttons">
          <button id="btn-start" className="primary">🌪️ Tornado</button>
          <button id="btn-pause" disabled>⏸ Pause</button>
          <button id="btn-reset">↺ Reset</button>
        </div>

        <div id="damage-label" style={{ background: '#1c2430' }}>STANDING BY</div>

        {/* Always visible, not folded: who is still out there (ui.js). */}
        <div id="humans-status" aria-live="off">
          <span className="humans-main">👥 <strong id="humans-left">0</strong> / <span id="humans-total">0</span> humans left</span>
          <span className="humans-sub" id="humans-sub-detail">safe <span id="humans-saved">0</span> · dead <span id="humans-lost">0</span></span>
        </div>

        <details className="fold">
          <summary><span className="fold-icon" aria-hidden="true">📊</span>Readout<span className="fold-note" id="fold-note-stats" /></summary>
          <div className="fold-body">
            <div id="stats-panel">
              <div className="row"><span>Wind</span><span className="v" id="s-windSpeed">0 mph</span></div>
              <div className="row"><span>Rating</span><span className="v" id="s-intensity">EF0</span></div>
              <div className="row"><span>Radius</span><span className="v" id="s-radius">0 m</span></div>
              <div className="row"><span>Affected</span><span className="v" id="s-affected">0</span></div>
              <div className="row"><span>Elapsed</span><span className="v" id="s-elapsed">0 s</span></div>
              <div className="row"><span>Score</span><span className="v" id="s-score">0</span></div>
              <div className="row"><span>Chain</span><span className="v" id="s-chain">0</span></div>
              <div className="row"><span>Alight</span><span className="v" id="s-fire">0</span></div>
              <div className="row"><span>Impacts</span><span className="v" id="s-impacts">0</span></div>
              <div className="row"><span>Sheltered</span><span className="v" id="s-sheltered">0</span></div>
              <div className="row"><span>Dazed</span><span className="v" id="s-dazed">0</span></div>
              <div className="row"><span>At large</span><span className="v" id="s-atlarge">0</span></div>
              <div className="row" title="Reached a bunker, or carried off by an ambulance or an evacuation bus"><span>Safe</span><span className="v" id="s-saved">0</span></div>
              <div className="row"><span>Amb / bus</span><span className="v" id="s-rescued">0 / 0</span></div>
              <div className="row"><span>Doused</span><span className="v" id="s-doused">0</span></div>
              <div className="row"><span>Units</span><span className="v" id="s-units">0 / 0</span></div>
            </div>
          </div>
        </details>
        </div>
      </div>

      <div id="fps">-- fps</div>

      {/* Where every event banner goes (utils/banners.js). They used to be
          eight independent fixed elements at the same height, which drew on
          top of each other whenever two disasters overlapped — now routine,
          since the electric tornado stays on while everything else happens. */}
      <div id="banner-stack" />

      {/* Hidden until a chain is worth showing; engine/gamefeel.js sets the
          text, size and opacity every frame while one is running (same
          engine-manipulates-DOM-by-id pattern as #damage-label above). */}
      <div id="combo-hud" />

      {/* Hidden by default; tornadoEngine.js toggles "visible" on chase
          mode enter/exit and refreshes the two readouts every frame while
          driving (same engine-manipulates-DOM-by-id pattern as #damage-label
          above). */}
      <div id="chase-hud">
        <div className="row"><span>Speed</span><span id="chase-hud-speed">0 mph</span></div>
        <div className="row"><span>Distance to core</span><span id="chase-hud-distance">0 m</span></div>
        <div className="row"><span>Danger</span><span id="chase-hud-intensity">EF3</span></div>
      </div>

      {/* Hidden by default; engine/possess.js toggles "visible" on mode
          enter/exit and lights up whichever arrow matches the key(s)
          currently held, every frame while the mode is active (same
          engine-manipulates-DOM-by-id pattern as #chase-hud above). */}
      <div id="possess-hud">
        <div className="possess-pad">
          <span id="possess-key-up" className="possess-key up">▲</span>
          <span id="possess-key-left" className="possess-key left">◀</span>
          <span id="possess-key-down" className="possess-key down">▼</span>
          <span id="possess-key-right" className="possess-key right">▶</span>
        </div>
      </div>

      {/* Hidden by default; tornadoEngine.js toggles the "visible" class
          on game over / restart (same engine-manipulates-DOM-by-id pattern
          as #damage-label above). */}
      <div id="chase-gameover">
        <div className="panel">
          <h2 id="chase-gameover-title">Caught by the tornado!</h2>
          <div className="row"><span>Time survived</span><span id="chase-gameover-time">0 s</span></div>
          <div className="row"><span>Closest approach</span><span id="chase-gameover-distance">0 m</span></div>
          <button id="btn-chase-restart" className="primary">Restart</button>
        </div>
      </div>

      {/* tornadoEngine.js's initScene() appends the WebGL <canvas> here. */}
      <div ref={mountRef} />
    </>
  );
}
