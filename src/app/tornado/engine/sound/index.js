// @ts-check
import * as THREE from 'three';
import { loadSample } from './samples.js';
import { soundRandom } from './random.js';

// The synthesised pre-storm breeze and crickets. Off: city-sound.wav is the
// only thing heard before the storm (see updateSoundSystem).
const AMBIENT_SYNTH = false;

/**
 * ===========================================================================
 * SECTION K — Procedural sound: reactive wind + rumble
 * ===========================================================================
 */

/**
 * @param {Object} engineCtx
 * @returns {{
 *   SoundSystem: Object,
 *   initSoundSystem: () => void,
 *   ensureAudioReady: () => boolean,
 *   resumeSoundSystem: () => void,
 *   updateSoundSystem: (dt: number) => void,
 *   detachAudioGestureListeners: () => void,
 *   setMuffle: (amount: number) => void
 * }}
 */
export function createSoundSystem(engineCtx) {
  const { Sim } = engineCtx;

  const SoundSystem = {
    listener: /** @type {THREE.AudioListener|null} */ (null),
    context: /** @type {AudioContext|null} */ (null),
    noiseSource: /** @type {AudioBufferSourceNode|null} */ (null),
    windGain: /** @type {GainNode|null} */ (null),
    windFilter: /** @type {BiquadFilterNode|null} */ (null),
    rumbleOsc: /** @type {OscillatorNode|null} */ (null),
    rumbleGain: /** @type {GainNode|null} */ (null),
    masterGain: /** @type {GainNode|null} */ (null),
    muffle: /** @type {BiquadFilterNode|null} */ (null),
    effectsGain: /** @type {GainNode|null} */ (null),
    bedDuckGain: /** @type {GainNode|null} */ (null),
    muted: false,
    volume: 0.7,
    // Ambient pre-storm layer (crickets + light breeze): its own bus gain
    // feeding into masterGain, faded to 0 once the storm takes over.
    ambientGain: /** @type {GainNode|null} */ (null),
    ambientWindSource: /** @type {AudioBufferSourceNode|null} */ (null),
    ambientWindFilter: /** @type {BiquadFilterNode|null} */ (null),
    ambientLevel: 1,
    ambientFading: false,
    cricketTimer: 1 + soundRandom() * 2,
    activeAmbientNodes: /** @type {AudioScheduledSourceNode[]} */ ([]),
    earlyResumeHandler: /** @type {(() => void)|null} */ (null),
    visibilityHandler: /** @type {(() => void)|null} */ (null),
    // True once buildAudioGraph() has run. Everything below stays null until
    // then, because the AudioContext itself is only created from inside a
    // user gesture (see initSoundSystem/ensureAudioReady).
    graphBuilt: false,
    // Impact layer (see playImpactSound): its own bus gain so debris hits can
    // be balanced against wind/rumble/thunder independently, fed through a
    // compressor acting as a limiter so a cluster of simultaneous hits can't
    // sum past full scale.
    // Thunder gets its own limited bus for the same reason the impacts do:
    // at EF5 strikes now land roughly twice a second while each tail rings for
    // 3-5s, so a dozen claps can be sounding at once and would otherwise sum
    // straight past full scale.
    thunderGain: /** @type {GainNode|null} */ (null),
    thunderLimiter: /** @type {DynamicsCompressorNode|null} */ (null),
    thunderVoices: 0,
    impactGain: /** @type {GainNode|null} */ (null),
    impactLimiter: /** @type {DynamicsCompressorNode|null} */ (null),
    impactVoices: 0,
    impactLastPlay: -1,
    activeImpactNodes: /** @type {AudioScheduledSourceNode[]} */ ([]),
    // Scream layer (see playScream in scream.js): its own bus/limiter/voice
    // cap for the same reason impact/thunder each get one -- several people
    // can be swept up within the same couple of frames at high intensity.
    screamGain: /** @type {GainNode|null} */ (null),
    screamLimiter: /** @type {DynamicsCompressorNode|null} */ (null),
    screamVoices: 0,
    screamLastPlay: -1,
    activeScreamNodes: /** @type {AudioScheduledSourceNode[]} */ ([]),
    // Decoded recordings; empty/null until loading finishes (thunder/screams/
    // the stinger are simply skipped until then). Three scream recordings
    // rather than one, so playScream() (scream.js) can pick a different voice
    // each time instead of the same person screaming every capture.
    screamSamples: /** @type {import('./samples.js').Sample[]} */ ([]),
    thunderSample: /** @type {import('./samples.js').Sample|null} */ (null),
    // The "world-end" stinger (see sound/stinger.js): Start, Doomsday, a
    // Fujiwhara merge. Its own last-play stamp rather than reusing the
    // scream/impact ones, since it is a wholly different bus and cadence.
    stingerSample: /** @type {import('./samples.js').Sample|null} */ (null),
    stingerLastPlay: -1,
    activeStingerNodes: /** @type {AudioScheduledSourceNode[]} */ ([]),
    // The tornado's EMP shockwave (see sound/shockwave.js): fired alongside
    // every electricStorm.js EMP discharge.
    shockwaveSample: /** @type {import('./samples.js').Sample|null} */ (null),
    shockwaveLastPlay: -1,
    activeShockwaveNodes: /** @type {AudioScheduledSourceNode[]} */ ([]),
    // Played by sound/cues.js: the screen cracking, the big explosions, the
    // town's background before Start and the Chase Mode music.
    glassCrackSample: /** @type {import('./samples.js').Sample|null} */ (null),
    largeExplosionSample: /** @type {import('./samples.js').Sample|null} */ (null),
    earthquakeSample: /** @type {import('./samples.js').Sample|null} */ (null),
    citySample: /** @type {import('./samples.js').Sample|null} */ (null),
    carMusicSample: /** @type {import('./samples.js').Sample|null} */ (null),
    // Roger's plasma rifle and the alien mothership (sound/cues.js).
    sonicBoomSample: /** @type {import('./samples.js').Sample|null} */ (null),
    shipMusicSample: /** @type {import('./samples.js').Sample|null} */ (null),
    // Hero Mode's Terminator music and the hunter ships' (sound/cues.js).
    terminatorMusicSample: /** @type {import('./samples.js').Sample|null} */ (null),
    drobetaMusicSample: /** @type {import('./samples.js').Sample|null} */ (null),
    // city-sound.wav, the panel's other music choice: 12 MB, so loaded by
    // sound/cues.js only once it is chosen.
    cityRecordingSample: /** @type {import('./samples.js').Sample|null} */ (null),
    // Set by sound/cues.js each frame: how far everything but the music and
    // the screams is turned down (1 = not at all), so a track that has to be
    // heard over the storm and the rain is.
    musicDuck: 1
  };

  engineCtx.SoundSystem = SoundSystem;

  // Explosions are now the biggest thing in the mix when one goes off nearby,
  // so this sits level with a full-power thunder crack rather than under it.
  // The limiter below keeps that safe when several overlap.
  const IMPACT_BUS_LEVEL = 0.85;
  // Thunder and screams are recorded samples that have to cut through the
  // continuous wind bed (which peaks around 0.5 on the master bus), so both
  // run at full bus level; their limiters keep overlaps in check.
  const THUNDER_BUS_LEVEL = 1.0;
  const SCREAM_BUS_LEVEL = 1.0;
  // Testing switch: true silences wind, rumble, ambient, thunder, impacts and
  // fire so only screams are heard. Set back to false to restore them.
  const SCREAMS_ONLY = false;
  // Wind/rumble level while any scream is sounding (about -8dB): enough for
  // the scream to sit on top of the storm without the storm cutting out.
  const SCREAM_BED_DUCK = 0.4;

  /**
   * Generates a 2-second buffer of white noise for the looped wind layer.
   * @param {AudioContext} ctx
   * @returns {AudioBuffer}
   */
  function createNoiseBuffer(ctx) {
    const duration = 2;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = soundRandom() * 2 - 1;
    }
    return buffer;
  }

  /**
   * Builds (but does not audibly start) the wind/rumble Web Audio graph:
   * looped white noise through a lowpass filter (wind), plus a low sine
   * oscillator (rumble), both feeding a single master gain wired into the
   * THREE.AudioListener's mix bus.
   *
   * Only ever called from inside a user-gesture handler, via
   * ensureAudioReady(). Constructing `new THREE.AudioListener()` is what
   * constructs the page's AudioContext (three.js's AudioContext.getContext()
   * lazily news one up), and a context *created* outside a gesture is what
   * produces the console warning "The AudioContext was not allowed to start.
   * It must be resumed (or created) after a user gesture on the page." —
   * resuming it later silences nothing, because the complaint is about
   * creation. So the graph is built no earlier than the first real gesture.
   * @returns {void}
   */
  function buildAudioGraph() {
    if (SoundSystem.graphBuilt) return;
    SoundSystem.graphBuilt = true;
    const listener = new THREE.AudioListener();
    Sim.three.camera.add(listener);
    const ctx = listener.context;

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0;
    // Everything through one lowpass, wide open except in Bullet Time
    // (setMuffle), when the whole world is heard as if under water.
    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 20000;
    muffle.Q.value = 0.7;
    masterGain.connect(muffle);
    muffle.connect(listener.getInput());
    SoundSystem.muffle = muffle;

    // Every layer except screams feeds this, so they can be muted as one.
    const effectsGain = ctx.createGain();
    effectsGain.gain.value = SCREAMS_ONLY ? 0 : 1;
    effectsGain.connect(masterGain);

    // The continuous wind/rumble beds pass through this so they can be
    // lowered under screams; one-off events (thunder, impacts, fire) don't.
    const bedDuckGain = ctx.createGain();
    bedDuckGain.connect(effectsGain);

    // Wind layer: looped white noise shaped by a lowpass filter whose cutoff
    // rises with tornado strength, so the "hiss" visibly thickens with it.
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = createNoiseBuffer(ctx);
    noiseSource.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 400;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    noiseSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(bedDuckGain);
    noiseSource.start();

    // Rumble layer: a low sine tone whose pitch tracks rotation speed, giving
    // a deep undertone beneath the wind hiss.
    const rumbleOsc = ctx.createOscillator();
    rumbleOsc.type = 'sine';
    rumbleOsc.frequency.value = 45;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    rumbleOsc.connect(rumbleGain);
    rumbleGain.connect(bedDuckGain);
    rumbleOsc.start();

    // Ambient pre-storm layer: a soft, bandpassed "light breeze" noise bed
    // (a distinct timbre from the storm wind's lowpass sweep above), plus
    // occasional cricket chirps synthesised in playCricketChirp(). Both feed
    // this bus's own gain node so the whole layer can be faded as one unit
    // once the storm takes over (see updateSoundSystem()/resumeSoundSystem()).
    const ambientGain = ctx.createGain();
    ambientGain.gain.value = 0;
    ambientGain.connect(effectsGain);

    const ambientWindSource = ctx.createBufferSource();
    ambientWindSource.buffer = createNoiseBuffer(ctx);
    ambientWindSource.loop = true;
    const ambientWindFilter = ctx.createBiquadFilter();
    ambientWindFilter.type = 'bandpass';
    ambientWindFilter.frequency.value = 1100;
    ambientWindFilter.Q.value = 0.6;
    const ambientWindLevel = ctx.createGain();
    ambientWindLevel.gain.value = 0.35;
    ambientWindSource.connect(ambientWindFilter);
    ambientWindFilter.connect(ambientWindLevel);
    ambientWindLevel.connect(ambientGain);
    ambientWindSource.start();

    // Impact layer bus. Voices are built per hit in playImpactSound() and
    // connect into the limiter; the limiter's output passes through
    // impactGain, so the balance control sits *after* compression and can be
    // trimmed without changing how hard the limiter works. Threshold/ratio
    // are set for brick-wall behaviour on transients (2ms attack catches the
    // crack itself) while the 0.12s release keeps it from pumping audibly
    // between closely-spaced hits.
    const impactLimiter = ctx.createDynamicsCompressor();
    // Threshold sits high deliberately. At -12dB it took ~8dB off a single
    // isolated hit, flattening the very transient the effect exists for and
    // leaving impacts ~15dB under a thunder crack. At -3dB a lone hit passes
    // essentially untouched and the limiter only engages once hits genuinely
    // stack, which is the case it's here for.
    impactLimiter.threshold.value = -3;
    impactLimiter.knee.value = 6;
    impactLimiter.ratio.value = 14;
    impactLimiter.attack.value = 0.002;
    impactLimiter.release.value = 0.12;
    // Thunder bus. Softer knee and slower release than the impact limiter:
    // thunder is a long diffuse wash rather than a transient, so fast gain
    // movement on it would be audible as pumping.
    const thunderLimiter = ctx.createDynamicsCompressor();
    thunderLimiter.threshold.value = -6;
    thunderLimiter.knee.value = 10;
    thunderLimiter.ratio.value = 10;
    thunderLimiter.attack.value = 0.005;
    thunderLimiter.release.value = 0.35;
    const thunderGain = ctx.createGain();
    thunderGain.gain.value = THUNDER_BUS_LEVEL;
    thunderLimiter.connect(thunderGain);
    thunderGain.connect(effectsGain);
    SoundSystem.thunderLimiter = thunderLimiter;
    SoundSystem.thunderGain = thunderGain;

    const impactGain = ctx.createGain();
    impactGain.gain.value = IMPACT_BUS_LEVEL;
    impactLimiter.connect(impactGain);
    impactGain.connect(effectsGain);
    SoundSystem.impactLimiter = impactLimiter;
    SoundSystem.impactGain = impactGain;

    // Scream bus. A tighter release than the impact/thunder limiters: each
    // voice is a single short (<1s) yell rather than a multi-second wash or
    // a rumbling tail, so the limiter can let go again quickly between them
    // without audible pumping.
    const screamLimiter = ctx.createDynamicsCompressor();
    screamLimiter.threshold.value = -8;
    screamLimiter.knee.value = 6;
    screamLimiter.ratio.value = 12;
    screamLimiter.attack.value = 0.003;
    screamLimiter.release.value = 0.15;
    const screamGain = ctx.createGain();
    screamGain.gain.value = SCREAM_BUS_LEVEL;
    screamLimiter.connect(screamGain);
    screamGain.connect(masterGain);
    SoundSystem.screamLimiter = screamLimiter;
    SoundSystem.screamGain = screamGain;

    SoundSystem.ambientGain = ambientGain;
    SoundSystem.ambientWindSource = ambientWindSource;
    SoundSystem.ambientWindFilter = ambientWindFilter;

    // Every load, so a benchmark (engine/perf/bench.js) can wait for them all
    // before its first frame: code that picks a sample at random draws a
    // random number only once there is a sample to pick, and loads finishing
    // at different moments would make two runs draw differently.
    const loads = [];
    const track = (promise) => {
      loads.push(promise);
      return promise;
    };
    // Loaded independently rather than awaited together: each pushes itself
    // into screamSamples as soon as it is ready, so playScream() has one or
    // two voices to draw from well before the slowest of the three finishes
    // decoding, instead of every scream waiting on all of them.
    for (const url of ['/sounds/human_scream1.mp3', '/sounds/human_scream2.wav', '/sounds/human_scream3.wav']) {
      track(loadSample(ctx, url)
        .then(sample => { SoundSystem.screamSamples.push(sample); })
        .catch(err => console.error(`Scream sample failed to load (${url}):`, err)));
    }
    track(loadSample(ctx, '/sounds/lightning.mp3')
      .then(sample => { SoundSystem.thunderSample = sample; })
      .catch(err => console.error('Thunder sample failed to load:', err)));
    track(loadSample(ctx, '/sounds/world-end.wav')
      .then(sample => { SoundSystem.stingerSample = sample; })
      .catch(err => console.error('Stinger sample failed to load:', err)));
    track(loadSample(ctx, '/sounds/shockwave.wav')
      .then(sample => { SoundSystem.shockwaveSample = sample; })
      .catch(err => console.error('Shockwave sample failed to load:', err)));
    for (const [key, url] of [
      ['glassCrackSample', '/sounds/glass-crack.wav'],
      ['largeExplosionSample', '/sounds/large-explosion.wav'],
      ['citySample', '/sounds/guta.mp3'],
      ['carMusicSample', '/sounds/car-music.wav']
    ]) {
      track(loadSample(ctx, url)
        .then(sample => { SoundSystem[key] = sample; })
        .catch(err => console.error(`Sample failed to load (${url}):`, err)));
    }

    // Warnings rather than errors if missing: both are optional extras, and
    // the rifle has its procedural shot (sound/hero.js) underneath anyway.
    for (const [key, url] of [
      ['sonicBoomSample', '/sounds/sonic-boom.mp3'],
      ['shipMusicSample', '/sounds/space-ship-music.wav'],
      ['terminatorMusicSample', '/sounds/terminator.wav'],
      ['drobetaMusicSample', '/sounds/drobeta.mp3']
    ]) {
      track(loadSample(ctx, url)
        .then(sample => { SoundSystem[key] = sample; })
        .catch(() => console.warn(`public${url} not found; add it to hear it.`)));
    }

    // The earthquake's recorded rumble (engine/chasm.js). A warning rather
    // than an error if it is missing: the quake still has its procedural
    // layers (sound/earthquake.js) to fall back on.
    track(loadSample(ctx, '/sounds/earthquake.wav')
      .then(sample => { SoundSystem.earthquakeSample = sample; })
      .catch(() => console.warn('public/sounds/earthquake.wav not found; the quake uses its procedural rumble only.')));

    SoundSystem.samplesReady = Promise.allSettled(loads);

    SoundSystem.listener = listener;
    SoundSystem.context = ctx;
    SoundSystem.noiseSource = noiseSource;
    SoundSystem.windGain = windGain;
    SoundSystem.windFilter = windFilter;
    SoundSystem.rumbleOsc = rumbleOsc;
    SoundSystem.rumbleGain = rumbleGain;
    SoundSystem.masterGain = masterGain;
    SoundSystem.effectsGain = effectsGain;
    SoundSystem.bedDuckGain = bedDuckGain;
  }

  /**
   * Creates the audio graph on first call and resumes the context whenever it
   * is not running. Safe (and cheap) to call from anywhere: building the graph
   * is guarded by SoundSystem.graphBuilt, and resume() on an already-running
   * context is a no-op.
   *
   * Two distinct jobs, both of which have to happen from a gesture at least
   * once:
   *  - the *first* call must come from inside a user-gesture handler, since
   *    that is the only place the AudioContext may legally be created (see
   *    buildAudioGraph). The gesture listeners armed by initSoundSystem() and
   *    the Start button (resumeSoundSystem) both guarantee that;
   *  - every later call is the defensive re-resume. Safari suspends the
   *    context on tab-blur (and iOS interrupts it outright, leaving state
   *    'interrupted'), so a context that was running before the user switched
   *    tabs can come back suspended with no gesture in sight. Once a context
   *    has been unlocked by a gesture, resume() is permitted again without a
   *    fresh one, so every sound-triggering event calls this first.
   *
   * resume() resolves asynchronously, so `state` is still 'suspended' when
   * this returns even on a successful call — callers use the return value as
   * "can I schedule audio *this frame*", and the event that follows the first
   * resumed frame is the one heard.
   * @returns {boolean} whether the context is running and safe to schedule on
   */
  function ensureAudioReady() {
    buildAudioGraph();
    const ctx = SoundSystem.context;
    if (!ctx) return false;
    // 'interrupted' is Safari/iOS-only and absent from the spec's enum, hence
    // the state != 'running' test rather than a list of suspended-ish states.
    if (ctx.state !== 'running' && ctx.state !== 'closed') {
      // A rejected resume (no gesture has ever unlocked this context) is
      // expected rather than exceptional: the next gesture will get it.
      ctx.resume().catch(() => { /* still locked; a later gesture will do it */ });
    }
    return ctx.state === 'running';
  }

  /**
   * Arms the listeners that bring audio up on the first user gesture, and the
   * one that brings it back after a tab-blur. Creates nothing audible and, in
   * particular, no AudioContext — that is exactly the point (see
   * buildAudioGraph).
   *
   * Waiting for the Start button specifically would mean the ambient
   * pre-storm layer could never be heard before Start is pressed, so the
   * very first pointerdown/keydown/touchstart anywhere on the page (e.g.
   * touching a slider) builds and starts the graph — without triggering the
   * ambient fade-out, which stays tied specifically to
   * resumeSoundSystem()/startSim().
   * @returns {void}
   */
  function initSoundSystem() {
    const startOnce = () => {
      ensureAudioReady();
      detachAudioGestureListeners();
    };
    SoundSystem.earlyResumeHandler = startOnce;
    // Not { once: true }: a first pointerdown that somehow fails to unlock
    // the context (a gesture the browser does not count as activation) would
    // otherwise consume the listener and leave the page permanently silent.
    // detachAudioGestureListeners() is called from startOnce only after a
    // successful build, and unconditionally from dispose().
    window.addEventListener('pointerdown', startOnce, { signal: engineCtx.signal });
    window.addEventListener('keydown', startOnce, { signal: engineCtx.signal });
    window.addEventListener('touchstart', startOnce, { signal: engineCtx.signal });

    // Safari suspends the context when the tab loses focus; coming back is
    // not a user gesture, but the context has already been unlocked by then,
    // so resuming here is allowed.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && SoundSystem.graphBuilt) ensureAudioReady();
    };
    SoundSystem.visibilityHandler = onVisible;
    document.addEventListener('visibilitychange', onVisible, { signal: engineCtx.signal });
  }

  /**
   * Removes the first-gesture listeners (not the visibilitychange one, which
   * stays useful for the whole session and is removed by dispose()).
   * @returns {void}
   */
  function detachAudioGestureListeners() {
    if (!SoundSystem.earlyResumeHandler) return;
    const handler = SoundSystem.earlyResumeHandler;
    window.removeEventListener('pointerdown', handler);
    window.removeEventListener('keydown', handler);
    window.removeEventListener('touchstart', handler);
    SoundSystem.earlyResumeHandler = null;
  }

  /**
   * Brings audio up from the Start button's click handler — a real user
   * gesture, which is what makes it a legal place to create/resume the
   * AudioContext even if nothing on the page has been touched before. Also
   * marks the ambient pre-storm layer (crickets/light breeze) to begin
   * fading out, handing off to the reactive wind/rumble/lightning layers.
   * @returns {void}
   */
  function resumeSoundSystem() {
    ensureAudioReady();
    SoundSystem.ambientFading = true;
  }

  /**
   * Advances the sound graph to match the current simulation strength. Called
   * once per frame from animate(). All time-varying params are smoothed via
   * setTargetAtTime to avoid zipper noise from per-frame value jumps.
   * @param {number} dt
   * @returns {void}
   */
  function updateSoundSystem(dt) {
    if (!SoundSystem.context) return;
    const p = Sim.params;
    const ctx = SoundSystem.context;
    const now = ctx.currentTime;
    const smoothing = 0.4;

    // Low idle presence when not running, so the storm still "breathes" at
    // rest (matching the funnel, which already idles pre-Start); full
    // reactive strength once running.
    const strength = Sim.state.running
      ? THREE.MathUtils.clamp(p.intensity * 0.7 + (p.windSpeed / 320) * 0.3, 0, 1)
      : 0.12;

    // Slow motion (engine/gamefeel.js) is not applied to the audio graph:
    // updateSoundSystem is deliberately called with *real* delta time, so
    // nothing here is stretched. Instead the storm drops in pitch and loses
    // some top end while the world is slowed -- enough to sell the moment,
    // well short of the muffled-underwater cliché that literally slowing the
    // playback would give. 1 (no effect) whenever no slow-motion is running.
    // engineCtx, not the local `ctx` a few lines above -- that one is the
    // AudioContext.
    const slow = engineCtx.GameFeel ? engineCtx.GameFeel.timeScale : 1;
    const pitchDrop = 0.55 + 0.45 * slow;
    const toneDrop = 0.6 + 0.4 * slow;

    // Weighted by the storm's own ramp (context.js stormRamp: 0 while standing
    // by, easing to 1 once the storm is on), so before Start the storm beds
    // are silent and the town's recorded background (sound/cues.js
    // city-sound.wav) is the only thing heard. The idle hiss used to read as
    // rain falling on a dry, rainless town.
    const storm = Sim.state.stormRamp;
    const windCutoff = (250 + strength * 2600) * toneDrop;
    // The panel's Rain sound switch (engine/settings.js): this hiss is the
    // wind and the rain together; off, only the storm's rumble is left.
    const hissOn = engineCtx.systems.settings.get('rainSound') ? 1 : 0;
    const windLevel = (0.12 + strength * 0.55) * storm * hissOn;
    const rumbleLevel = (0.05 + strength * 0.4) * storm;
    const rumblePitch = (35 + THREE.MathUtils.clamp(p.rotationSpeed / 6, 0, 1) * 35) * pitchDrop;

    SoundSystem.windFilter.frequency.setTargetAtTime(windCutoff, now, smoothing);
    SoundSystem.windGain.gain.setTargetAtTime(windLevel, now, smoothing);
    SoundSystem.rumbleGain.gain.setTargetAtTime(rumbleLevel, now, smoothing);
    SoundSystem.rumbleOsc.frequency.setTargetAtTime(rumblePitch, now, smoothing);

    // Fast dip when a scream starts, slower recovery once the last one ends.
    const ducking = SoundSystem.screamVoices > 0;
    SoundSystem.bedDuckGain.gain.setTargetAtTime(
      ducking ? SCREAM_BED_DUCK : 1, now, ducking ? 0.08 : 0.5
    );

    // Ambient pre-storm layer: fades to silence over a few seconds once
    // resumeSoundSystem()/startSim() flips ambientFading, while new cricket
    // chirps simply stop being scheduled once it's faded low enough to be
    // inaudible under the storm layers above.
    if (SoundSystem.ambientFading) {
      SoundSystem.ambientLevel = Math.max(0, SoundSystem.ambientLevel - dt / 3.5);
    }
    // The synthesised breeze-and-crickets bed is kept silent: before Start the
    // city recording is the pre-storm ambience, and the two together only
    // muddied it.
    if (SoundSystem.ambientGain) {
      SoundSystem.ambientGain.gain.setTargetAtTime(0, now, smoothing);
    }
    if (AMBIENT_SYNTH && SoundSystem.ambientLevel > 0.05) {
      SoundSystem.cricketTimer -= dt;
      if (SoundSystem.cricketTimer <= 0) {
        playCricketChirp();
        SoundSystem.cricketTimer = 0.5 + soundRandom() * 2.2;
      }
    }

    // Under the music that has to carry over the storm (sound/cues.js
    // musicDuck): the wind and rain hiss, thunder and effects all go down
    // together, over a second, and come back as it fades.
    if (SoundSystem.effectsGain && !SCREAMS_ONLY) {
      SoundSystem.effectsGain.gain.setTargetAtTime(SoundSystem.musicDuck, now, 0.4);
    }

    const target = SoundSystem.muted ? 0 : SoundSystem.volume;
    SoundSystem.masterGain.gain.setTargetAtTime(target, now, 0.15);
  }

  /**
   * Synthesises one cricket chirp: a short trill of 2-4 quick pulses at a
   * randomised high pitch, each shaped with a fast attack/decay envelope
   * through a narrow bandpass filter, built the same procedural Web-Audio
   * way as the rest of SoundSystem (no audio files). Routed into
   * ambientGain, so it fades and mutes along with the rest of that layer.
   * @returns {void}
   */
  function playCricketChirp() {
    if (!SoundSystem.context || !SoundSystem.ambientGain) return;
    const ctx = SoundSystem.context;
    const now = ctx.currentTime;
    const baseFreq = 2800 + soundRandom() * 1400;
    const pulses = 2 + Math.floor(soundRandom() * 3);

    for (let i = 0; i < pulses; i++) {
      const t = now + i * (0.055 + soundRandom() * 0.02);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq * (0.98 + soundRandom() * 0.04), t);
      const chirpFilter = ctx.createBiquadFilter();
      chirpFilter.type = 'bandpass';
      chirpFilter.frequency.value = baseFreq;
      chirpFilter.Q.value = 8;
      const chirpGain = ctx.createGain();
      chirpGain.gain.setValueAtTime(0.0001, t);
      chirpGain.gain.linearRampToValueAtTime(0.22, t + 0.006);
      chirpGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      osc.connect(chirpFilter);
      chirpFilter.connect(chirpGain);
      chirpGain.connect(SoundSystem.ambientGain);
      osc.start(t);
      osc.stop(t + 0.07);

      SoundSystem.activeAmbientNodes.push(osc);
      osc.onended = () => {
        try { chirpFilter.disconnect(); chirpGain.disconnect(); } catch { /* already disconnected */ }
        SoundSystem.activeAmbientNodes = SoundSystem.activeAmbientNodes.filter(n => n !== osc);
      };
    }
  }

  /**
   * Bullet Time's muffling: everything heard through a closing lowpass.
   * @param {number} amount 0 (open) .. 1 (muffled)
   * @returns {void}
   */
  function setMuffle(amount) {
    const f = SoundSystem.muffle;
    if (!f || !SoundSystem.context) return;
    f.frequency.setTargetAtTime(amount > 0 ? 20000 * Math.pow(600 / 20000, amount) : 20000, SoundSystem.context.currentTime, 0.18);
  }

  return {
    SoundSystem, initSoundSystem, ensureAudioReady, resumeSoundSystem,
    updateSoundSystem, detachAudioGestureListeners, setMuffle
  };
}
