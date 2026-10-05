// @ts-check
import { createShortNoiseBuffer } from './thunder.js';
import { loadSample, playOnce } from './samples.js';
import { soundRandom } from './random.js';

/**
 * ===========================================================================
 * SECTION S.9 — Hero Mode
 * ===========================================================================
 * The sounds of Hero Mode (engine/heroMode.js), procedural like the rest of
 * sound/: no files.
 *
 *  - **zap**: the plasma rifle's normal shot. A sawtooth dropping from ~1.9kHz
 *    to ~260Hz in an eighth of a second through a bandpass, with a click of
 *    highpassed noise on the front -- sharp and energetic, not a gunshot;
 *  - **plasma**: the aim-mode beam. A crack of highpassed noise, a detuned
 *    sawtooth pair diving from 330Hz to 48Hz through a closing lowpass, a
 *    sizzle of bandpassed noise chopped at 38Hz, and a sub thump under it
 *    all. A stand-in: when a recorded plasma sound is supplied, drop it in
 *    public/sounds and name it in PLASMA_SAMPLE_URL, and that plays instead;
 *  - **charge**: the rifle filling for a mega beam while the trigger is
 *    held -- two detuned sawtooths and a sine climbing from ~70Hz to ~560Hz
 *    over the charge (HERO.chargeSeconds) through an opening lowpass, with a tremolo that
 *    speeds up as it fills, then a steady whine once full;
 *  - **mega boom**: the mega beam's release, on top of the recorded sonic
 *    boom (sound/cues.js): a deep sine drop from 80Hz to 24Hz and a bright
 *    crack of highpassed noise;
 *  - **ship laser**: an alien ship's tracking laser (engine/aliens.js), a
 *    buzzing square wave through a bandpass for as long as it burns;
 *  - **bullet**: one round of the minigun (engine/heroWeapons.js), a
 *    sharp crack of bandpassed noise over a short low thump, pitched a
 *    little differently each time so a stream of them rattles rather than
 *    buzzes; **dry click** when the belt is empty;
 *  - **slow-mo**: the whoosh of time dropping (W with the minigun), a
 *    sine swept down under a closing lowpass of noise;
 *  - **footstep**: the Terminator's tread. A lowpassed noise thud over a
 *    55Hz sine knock, played at whatever level the caller asks, so it can be
 *    brought up and made more frequent as the machine closes in.
 *
 * Built the first time any of them is asked for rather than at load, exactly
 * like the spaceship and the quake: by then the AudioContext exists and is
 * running. Each one-shot is a handful of short-lived nodes feeding one bus.
 */

const BUS_LEVEL = 0.9;
const ZAP_LEVEL = 0.55;
const STEP_LEVEL = 1.4;
const PLASMA_LEVEL = 0.85;
const BULLET_LEVEL = 0.5;
// The recorded plasma-beam sound, once there is one (public/sounds/...);
// null plays the procedural stand-in. Kept null until the file is in the
// repo, so there is no 404 in the console for a file that is not there.
/** @type {string|null} */
const PLASMA_SAMPLE_URL = null;

/**
 * @param {Object} engineCtx
 * @returns {{
 *   playZap: () => void,
 *   playFootstep: (level: number) => void,
 *   playPlasma: (seconds: number) => void,
 *   startCharge: () => void,
 *   updateCharge: (level: number) => void,
 *   stopCharge: () => void,
 *   playMegaBoom: () => void,
 *   playShipLaser: (seconds: number, warm: number, colour?: 'green'|'red') => void,
 *   playBullet: () => void,
 *   playDryClick: () => void,
 *   playSlowmo: () => void,
 *   playTimeWarp: () => void,
 *   playRelease: () => void,
 *   disposeHeroSound: () => void
 * }}
 */
export function createHeroSoundSystem(engineCtx) {
  /** @type {{ctx: AudioContext, bus: GainNode, noise: AudioBuffer}|null} */
  let graph = null;
  /** @type {number[]} when the ship lasers now sounding end (context time) */
  const laserUntil = [];
  /** @type {Object|null} the recorded plasma sound, when there is one */
  let plasmaSample = null;
  let plasmaRequested = false;

  /**
   * @returns {{ctx: AudioContext, bus: GainNode, noise: AudioBuffer}|null} the
   *   graph, built on first use; null while there is no running AudioContext
   */
  function ensureGraph() {
    const SoundSystem = engineCtx.SoundSystem;
    // Same guard as the other procedural modules: re-resumes after a Safari
    // tab-blur suspend, but never creates the context from outside a gesture.
    if (SoundSystem && SoundSystem.graphBuilt) engineCtx.systems.sound.ensureAudioReady();
    const ctx = SoundSystem && SoundSystem.context;
    if (!ctx || ctx.state !== 'running' || !SoundSystem.effectsGain) return null;
    if (graph && graph.ctx === ctx) return graph;
    const bus = ctx.createGain();
    bus.gain.value = BUS_LEVEL;
    bus.connect(SoundSystem.effectsGain);
    graph = { ctx, bus, noise: createShortNoiseBuffer(ctx, 1) };
    return graph;
  }

  /**
   * A burst of the shared noise through one filter, with its own envelope.
   * @param {{ctx: AudioContext, bus: GainNode, noise: AudioBuffer}} g
   * @param {BiquadFilterType} type
   * @param {number} frequency
   * @param {number} peak
   * @param {number} attack
   * @param {number} decay
   * @returns {void}
   */
  function noiseBurst(g, type, frequency, peak, attack, decay) {
    const { ctx, bus, noise } = g;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    source.start(now);
    source.stop(now + attack + decay + 0.05);
    source.onended = () => { try { gain.disconnect(); } catch { /* already */ } };
  }

  /** @returns {void} */
  function playZap() {
    const g = ensureGraph();
    if (!g) return;
    const { ctx, bus } = g;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1900, now);
    osc.frequency.exponentialRampToValueAtTime(260, now + 0.13);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1400;
    filter.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(ZAP_LEVEL, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    osc.start(now);
    osc.stop(now + 0.18);
    osc.onended = () => { try { gain.disconnect(); } catch { /* already */ } };
    noiseBurst(g, 'highpass', 5000, ZAP_LEVEL * 0.8, 0.002, 0.05);
  }

  /**
   * @param {number} level 0..1, how close it is
   * @returns {void}
   */
  function playFootstep(level) {
    const g = ensureGraph();
    if (!g) return;
    const { ctx, bus } = g;
    const now = ctx.currentTime;
    const peak = STEP_LEVEL * level;
    noiseBurst(g, 'lowpass', 180, peak, 0.004, 0.22);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(70, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.2);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peak * 0.8, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(now);
    osc.stop(now + 0.28);
    osc.onended = () => { try { gain.disconnect(); } catch { /* already */ } };
  }

  /**
   * @param {number} seconds how long the beam burns
   * @returns {void}
   */
  function playPlasma(seconds) {
    const g = ensureGraph();
    if (!g) return;
    const { ctx, bus } = g;
    if (PLASMA_SAMPLE_URL && !plasmaRequested) {
      plasmaRequested = true;
      loadSample(ctx, PLASMA_SAMPLE_URL).then((sample) => { plasmaSample = sample; }).catch(() => {});
    }
    if (plasmaSample) {
      playOnce(ctx, plasmaSample, { gain: PLASMA_LEVEL, destination: bus, fadeOut: 0.15 });
      return;
    }
    const now = ctx.currentTime;
    const end = now + seconds + 0.45;
    // The crack.
    noiseBurst(g, 'highpass', 4200, PLASMA_LEVEL, 0.002, 0.09);
    // The dive.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(5200, now);
    filter.frequency.exponentialRampToValueAtTime(380, end);
    filter.Q.value = 3;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(PLASMA_LEVEL, now + 0.012);
    gain.gain.setValueAtTime(PLASMA_LEVEL * 0.8, now + seconds * 0.5);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    filter.connect(gain);
    gain.connect(bus);
    const oscs = [0, 17].map((detune) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(330, now);
      osc.frequency.exponentialRampToValueAtTime(48, end);
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(now);
      osc.stop(end + 0.05);
      return osc;
    });
    oscs[0].onended = () => { try { gain.disconnect(); } catch { /* already */ } };
    // The sizzle, chopped by a fast square LFO.
    const sizzle = ctx.createBufferSource();
    sizzle.buffer = g.noise;
    sizzle.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2600;
    band.Q.value = 1.4;
    const chop = ctx.createGain();
    chop.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 38;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth);
    depth.connect(chop.gain);
    const sizzleGain = ctx.createGain();
    sizzleGain.gain.setValueAtTime(PLASMA_LEVEL * 0.6, now);
    sizzleGain.gain.exponentialRampToValueAtTime(0.0001, end);
    sizzle.connect(band);
    band.connect(chop);
    chop.connect(sizzleGain);
    sizzleGain.connect(bus);
    sizzle.start(now);
    lfo.start(now);
    sizzle.stop(end + 0.05);
    lfo.stop(end + 0.05);
    sizzle.onended = () => { try { sizzleGain.disconnect(); } catch { /* already */ } };
    // The thump.
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(110, now);
    sub.frequency.exponentialRampToValueAtTime(32, now + 0.35);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(PLASMA_LEVEL * 1.1, now);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    sub.connect(subGain);
    subGain.connect(bus);
    sub.start(now);
    sub.stop(now + 0.45);
    sub.onended = () => { try { subGain.disconnect(); } catch { /* already */ } };
  }

  /** @type {{oscs: OscillatorNode[], filter: BiquadFilterNode, gain: GainNode, trem: OscillatorNode, tremDepth: GainNode}|null} */
  let charge = null;

  /**
   * The charging hum starts: silent at first, brought up by updateCharge.
   * @returns {void}
   */
  function startCharge() {
    stopCharge();
    const g = ensureGraph();
    if (!g) return;
    const { ctx, bus } = g;
    const now = ctx.currentTime;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 6;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.12);
    // Tremolo: a sine on the gain, sped up as the charge fills.
    const trem = ctx.createOscillator();
    trem.frequency.value = 4;
    const tremDepth = ctx.createGain();
    tremDepth.gain.value = 0.06;
    trem.connect(tremDepth);
    tremDepth.connect(gain.gain);
    filter.connect(gain);
    gain.connect(bus);
    const oscs = [['sawtooth', 0], ['sawtooth', 9], ['sine', 1200]].map(([type, detune]) => {
      const osc = ctx.createOscillator();
      osc.type = /** @type {OscillatorType} */ (type);
      osc.frequency.value = 70;
      osc.detune.value = /** @type {number} */ (detune);
      osc.connect(filter);
      osc.start(now);
      return osc;
    });
    trem.start(now);
    charge = { oscs, filter, gain, trem, tremDepth };
  }

  /**
   * @param {number} level 0..1 how full the charge is
   * @returns {void}
   */
  function updateCharge(level) {
    if (!charge || !graph) return;
    const now = graph.ctx.currentTime;
    const f = 70 * Math.pow(8, level);
    for (const osc of charge.oscs) osc.frequency.setTargetAtTime(f, now, 0.05);
    charge.filter.frequency.setTargetAtTime(400 + level * 3800, now, 0.05);
    charge.trem.frequency.setTargetAtTime(level >= 1 ? 22 : 4 + level * 14, now, 0.1);
    charge.gain.gain.setTargetAtTime(0.14 + level * 0.3, now, 0.08);
  }

  /** @returns {void} */
  function stopCharge() {
    if (!charge || !graph) {
      charge = null;
      return;
    }
    const now = graph.ctx.currentTime;
    const { oscs, gain, trem } = charge;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(0, now, 0.03);
    for (const osc of oscs) osc.stop(now + 0.15);
    trem.stop(now + 0.15);
    oscs[0].onended = () => { try { gain.disconnect(); } catch { /* already */ } };
    charge = null;
  }

  /**
   * The mega beam going: a deep drop and a crack, under the recorded boom.
   * @returns {void}
   */
  function playMegaBoom() {
    const g = ensureGraph();
    if (!g) return;
    const { ctx, bus } = g;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.exponentialRampToValueAtTime(24, now + 0.9);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(1.6, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.3);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(now);
    osc.stop(now + 1.35);
    osc.onended = () => { try { gain.disconnect(); } catch { /* already */ } };
    noiseBurst(g, 'highpass', 5200, 1.1, 0.002, 0.16);
  }

  /**
   * A ship's tracking laser (redone 2026-10-05: one flat buzz before). A
   * charging whine rising over the aiming line, then the beam: two detuned
   * saws thrumming under a low-pass that wobbles, and a crackling sizzle on
   * top, cut off as the beam thins out. The landing ship's green laser sits
   * higher than the hunters' red. At most two at once, so a sky of ships
   * does not stack into a wall of noise.
   * @param {number} seconds how long the laser lasts, aiming included
   * @param {number} warm seconds of the aiming line before it burns
   * @param {'green'|'red'} [colour]
   * @returns {void}
   */
  function playShipLaser(seconds, warm, colour = 'red') {
    const g = ensureGraph();
    if (!g) return;
    const { ctx, bus, noise } = g;
    const now = ctx.currentTime;
    if (laserUntil.filter(u => u > now).length >= 2) return;
    laserUntil.push(now + seconds);
    if (laserUntil.length > 4) laserUntil.shift();
    const base = colour === 'green' ? 92 : 64;
    const end = now + seconds + 0.25;
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(bus);
    /** @type {AudioScheduledSourceNode[]} */
    const sources = [];

    // The charge: a sine sweeping up through the aiming line.
    const whine = ctx.createOscillator();
    whine.type = 'sine';
    whine.frequency.setValueAtTime(260, now);
    whine.frequency.exponentialRampToValueAtTime(1900, now + warm);
    const whineGain = ctx.createGain();
    whineGain.gain.setValueAtTime(0.0001, now);
    whineGain.gain.exponentialRampToValueAtTime(0.09, now + warm * 0.9);
    whineGain.gain.exponentialRampToValueAtTime(0.0001, now + warm + 0.08);
    whine.connect(whineGain);
    whineGain.connect(out);
    whine.start(now);
    whine.stop(now + warm + 0.1);
    sources.push(whine);

    // The beam: detuned saws under a wobbling low-pass.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    lp.Q.value = 6;
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 9;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 500;
    wobble.connect(wobbleDepth);
    wobbleDepth.connect(lp.frequency);
    const beam = ctx.createGain();
    beam.gain.setValueAtTime(0.0001, now + warm);
    beam.gain.exponentialRampToValueAtTime(0.16, now + warm + 0.04);
    beam.gain.setValueAtTime(0.16, now + seconds - 0.25);
    beam.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    lp.connect(beam);
    beam.connect(out);
    for (const detune of [-14, 11]) {
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.value = base;
      saw.detune.value = detune;
      saw.connect(lp);
      saw.start(now + warm);
      saw.stop(end);
      sources.push(saw);
    }
    wobble.start(now + warm);
    wobble.stop(end);
    sources.push(wobble);

    // The sizzle.
    const hiss = ctx.createBufferSource();
    hiss.buffer = noise;
    hiss.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = colour === 'green' ? 4200 : 3000;
    band.Q.value = 1.2;
    const hissGain = ctx.createGain();
    hissGain.gain.setValueAtTime(0.0001, now + warm);
    hissGain.gain.exponentialRampToValueAtTime(0.07, now + warm + 0.03);
    hissGain.gain.setValueAtTime(0.07, now + seconds - 0.25);
    hissGain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    hiss.connect(band);
    band.connect(hissGain);
    hissGain.connect(out);
    hiss.start(now + warm);
    hiss.stop(end);
    sources.push(hiss);

    sources[1].onended = () => { try { out.disconnect(); } catch { /* already */ } };
  }

  /**
   * One minigun round.
   * @returns {void}
   */
  function playBullet() {
    const g = ensureGraph();
    if (!g) return;
    const { ctx, bus } = g;
    const now = ctx.currentTime;
    noiseBurst(g, 'bandpass', 1800 + soundRandom() * 900, BULLET_LEVEL, 0.001, 0.045);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150 + soundRandom() * 30, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.05);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(BULLET_LEVEL * 0.9, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(now);
    osc.stop(now + 0.07);
    osc.onended = () => { try { gain.disconnect(); } catch { /* already */ } };
  }

  /**
   * The trigger pulled on an empty belt.
   * @returns {void}
   */
  function playDryClick() {
    const g = ensureGraph();
    if (!g) return;
    noiseBurst(g, 'highpass', 4200, 0.35, 0.001, 0.025);
  }

  /**
   * Time dropping into slow motion.
   * @returns {void}
   */
  function playSlowmo() {
    const g = ensureGraph();
    if (!g) return;
    const { ctx, bus } = g;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.7);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.7, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(now);
    osc.stop(now + 0.95);
    osc.onended = () => { try { gain.disconnect(); } catch { /* already */ } };
    noiseBurst(g, 'lowpass', 900, 0.5, 0.05, 0.7);
  }

  /**
   * Into Bullet Time: a deep warp -- two detuned tones sliding down to a
   * sub drone over a second and a half, under a slow whoosh of air.
   * @returns {void}
   */
  function playTimeWarp() {
    const g = ensureGraph();
    if (!g) return;
    const { ctx, bus } = g;
    const now = ctx.currentTime;
    for (const [f0, f1] of [[260, 38], [271, 41]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f0, now);
      osc.frequency.exponentialRampToValueAtTime(f1, now + 1.4);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1800, now);
      filter.frequency.exponentialRampToValueAtTime(160, now + 1.5);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.32, now + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.9);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(bus);
      osc.start(now);
      osc.stop(now + 2);
      osc.onended = () => { try { gain.disconnect(); } catch { /* already */ } };
    }
    noiseBurst(g, 'bandpass', 420, 0.35, 0.4, 1.2);
  }

  /**
   * Out of Bullet Time: a sharp rising whoosh as everything lets go.
   * @returns {void}
   */
  function playRelease() {
    const g = ensureGraph();
    if (!g) return;
    const { ctx, bus, noise } = g;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.6;
    filter.frequency.setValueAtTime(500, now);
    filter.frequency.exponentialRampToValueAtTime(6500, now + 0.35);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.9, now + 0.25);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    source.start(now);
    source.stop(now + 0.65);
    source.onended = () => { try { gain.disconnect(); } catch { /* already */ } };
  }

  /** @returns {void} */
  function disposeHeroSound() {
    stopCharge();
    if (graph) {
      try { graph.bus.disconnect(); } catch { /* already */ }
    }
    graph = null;
  }

  return {
    playZap, playFootstep, playPlasma, startCharge, updateCharge, stopCharge, playMegaBoom,
    playShipLaser, playBullet, playDryClick, playSlowmo, playTimeWarp, playRelease, disposeHeroSound
  };
}
