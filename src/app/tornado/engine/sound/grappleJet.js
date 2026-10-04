// @ts-check
import { createShortNoiseBuffer } from './thunder.js';
import { loadSample, playOnce } from './samples.js';

/**
 * ===========================================================================
 * SECTION S.10 — The grappling hook's shout, and the jetpack
 * ===========================================================================
 * Procedural like the rest of sound/, built on first use:
 *
 *  - **GET OVER HERE!**: the grappling hook (engine/player/grapple.js)
 *    thrown at an enemy, on request, in the spirit of the arcade spear. Our
 *    own take, not the game's recording: the browser's speech synthesis
 *    says the line as low and slow as it goes, over a growl in the rhythm
 *    of its three beats -- a distorted sawtooth through vowel formants,
 *    "get" / "o-ver" / "HERE", the last one long -- with an arena echo
 *    after it. Where there is no speech synthesis the growl plays alone.
 *    A recording supplied in public/sounds and named in SHOUT_SAMPLE_URL
 *    plays instead of both (null until there is one, so no 404);
 *  - **chain**: the hook's flight, a rattle of short metallic ticks
 *    (bandpassed noise through a ringing filter) for as long as it flies,
 *    then a **clank** where it bites;
 *  - **jump**: a short whoosh; **land**: a thud, as heavy as the fall;
 *  - **jet**: the jetpack's burn (hero/jetpack.js), a looped roar of
 *    lowpassed noise, a crackle on top and a low rumble, swelling as it
 *    climbs, faded out when it burns out.
 *
 * The speech is not part of the Web Audio graph: it follows the master
 * mute and volume when it starts.
 */

const BUS_LEVEL = 0.9;
const GROWL_LEVEL = 0.32;
const CHAIN_LEVEL = 0.28;
const JET_LEVEL = 0.75;
const SHOUT_LINE = 'Get over here!';
/** @type {string|null} a recorded shout (public/sounds/...), when there is one */
const SHOUT_SAMPLE_URL = null;
// The growl's three beats: start, length (seconds), pitch (Hz), and the
// first two formants (Hz) of the vowel.
const BEATS = [
  { at: 0.0, len: 0.16, pitch: 118, f1: 560, f2: 1750 },  // "get"
  { at: 0.22, len: 0.34, pitch: 108, f1: 620, f2: 1100 }, // "o-ver"
  { at: 0.62, len: 0.75, pitch: 132, f1: 330, f2: 2200 }  // "HERE"
];

/**
 * @param {Object} engineCtx
 * @returns {{
 *   playGetOverHere: () => void,
 *   playChain: (seconds: number) => void,
 *   playClank: () => void,
 *   playJump: () => void,
 *   playLand: (level: number) => void,
 *   startJet: () => void,
 *   updateJet: (level: number, climb: number) => void,
 *   stopJet: () => void,
 *   disposeGrappleJetSound: () => void
 * }}
 */
export function createGrappleJetSoundSystem(engineCtx) {
  /** @type {{ctx: AudioContext, bus: GainNode, noise: AudioBuffer, curve: Float32Array}|null} */
  let graph = null;
  /** @type {{nodes: AudioNode[], sources: AudioScheduledSourceNode[], gain: GainNode, roar: BiquadFilterNode}|null} */
  let jet = null;
  /** @type {Object|null} */
  let shoutSample = null;
  let shoutRequested = false;
  /** @type {SpeechSynthesisVoice|null|undefined} undefined until looked for */
  let voice;

  /**
   * @returns {{ctx: AudioContext, bus: GainNode, noise: AudioBuffer, curve: Float32Array}|null}
   */
  function ensureGraph() {
    const SoundSystem = engineCtx.SoundSystem;
    if (SoundSystem && SoundSystem.graphBuilt) engineCtx.systems.sound.ensureAudioReady();
    const ctx = SoundSystem && SoundSystem.context;
    if (!ctx || ctx.state !== 'running' || !SoundSystem.effectsGain) return null;
    if (graph && graph.ctx === ctx) return graph;
    const bus = ctx.createGain();
    bus.gain.value = BUS_LEVEL;
    bus.connect(SoundSystem.effectsGain);
    // A soft-clipping curve for the growl's grit.
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 6);
    }
    graph = { ctx, bus, noise: createShortNoiseBuffer(ctx, 1), curve };
    return graph;
  }

  /**
   * @param {AudioNode} node
   * @returns {void}
   */
  function quietly(node) {
    try { node.disconnect(); } catch { /* already */ }
  }

  /**
   * A burst of the shared noise through one filter, with its own envelope,
   * starting `delay` seconds from now.
   * @param {NonNullable<typeof graph>} g
   * @param {BiquadFilterType} type
   * @param {number} frequency
   * @param {number} q
   * @param {number} peak
   * @param {number} attack
   * @param {number} decay
   * @param {number} [delay]
   * @returns {void}
   */
  function noiseBurst(g, type, frequency, q, peak, attack, decay, delay = 0) {
    const { ctx, bus, noise } = g;
    const t = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    source.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    source.start(t, Math.random() * 0.5);
    source.stop(t + attack + decay + 0.05);
    source.onended = () => quietly(gain);
  }

  // ---------------------------------------------------------------------
  // GET OVER HERE!
  // ---------------------------------------------------------------------

  /**
   * A deep English voice, if the browser has one (looked for once).
   * @param {SpeechSynthesis} synth
   * @returns {SpeechSynthesisVoice|null}
   */
  function pickVoice(synth) {
    if (voice !== undefined && voice !== null) return voice;
    const voices = synth.getVoices();
    if (!voices.length) return null; // not loaded yet: try again next time
    const english = voices.filter(v => /^en(-|_|$)/i.test(v.lang));
    const deep = /male|daniel|fred|alex|david|george|james|arthur|ralph|guy|mark/i;
    voice = english.find(v => deep.test(v.name) && !/female/i.test(v.name)) || english[0] || null;
    return voice;
  }

  /**
   * The line, said through the browser's speech synthesis.
   * @returns {boolean} whether it was spoken
   */
  function speak() {
    const SoundSystem = engineCtx.SoundSystem;
    if (!SoundSystem || SoundSystem.muted || !(SoundSystem.volume > 0)) return false;
    if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return false;
    const synth = window.speechSynthesis;
    synth.cancel();
    const line = new SpeechSynthesisUtterance(SHOUT_LINE);
    line.lang = 'en-US';
    const v = pickVoice(synth);
    if (v) line.voice = v;
    line.pitch = 0.1;   // as low as it goes
    line.rate = 0.8;    // drawn out: "Get ... over ... HERE!"
    line.volume = Math.min(1, SoundSystem.volume * 1.4);
    synth.speak(line);
    return true;
  }

  /**
   * The growl under the line: a distorted, vibrato'd sawtooth through two
   * vowel formants, beat by beat, into an echo.
   * @param {NonNullable<typeof graph>} g
   * @param {number} level
   * @returns {void}
   */
  function growl(g, level) {
    const { ctx, bus, curve } = g;
    const now = ctx.currentTime + 0.05;
    const end = now + 2.6;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const sub = ctx.createOscillator();
    sub.type = 'square';
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 7;
    const vibratoDepth = ctx.createGain();
    vibratoDepth.gain.value = 4;
    vibrato.connect(vibratoDepth);
    vibratoDepth.connect(osc.frequency);
    const shaper = ctx.createWaveShaper();
    shaper.curve = curve;
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.Q.value = 6;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.Q.value = 9;
    const f2Level = ctx.createGain();
    f2Level.gain.value = 0.6;
    const voiceGain = ctx.createGain();
    voiceGain.gain.setValueAtTime(0, now);
    // The arena: a feedback echo.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.23;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    const out = ctx.createGain();
    out.gain.value = level;

    osc.connect(shaper);
    sub.connect(shaper);
    shaper.connect(f1);
    shaper.connect(f2);
    f2.connect(f2Level);
    f1.connect(voiceGain);
    f2Level.connect(voiceGain);
    voiceGain.connect(out);
    voiceGain.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(out);
    out.connect(bus);

    for (const b of BEATS) {
      const t = now + b.at;
      const last = b === BEATS[BEATS.length - 1];
      osc.frequency.setValueAtTime(b.pitch, t);
      sub.frequency.setValueAtTime(b.pitch / 2, t);
      // "HERE" rises, then falls away as it is held.
      if (last) {
        osc.frequency.linearRampToValueAtTime(b.pitch * 1.18, t + 0.18);
        osc.frequency.linearRampToValueAtTime(b.pitch * 0.82, t + b.len);
        sub.frequency.linearRampToValueAtTime(b.pitch * 0.41, t + b.len);
      }
      f1.frequency.setValueAtTime(b.f1, t);
      f2.frequency.setValueAtTime(b.f2, t);
      voiceGain.gain.setValueAtTime(0.0001, t);
      voiceGain.gain.linearRampToValueAtTime(last ? 1 : 0.8, t + 0.03);
      voiceGain.gain.setValueAtTime(last ? 1 : 0.8, t + b.len * 0.7);
      voiceGain.gain.linearRampToValueAtTime(0.0001, t + b.len);
      // The consonants: a "t" at the end of "get", a "v" in "over", an "h" on "here".
      if (b.at === 0) noiseBurst(g, 'highpass', 3500, 0.7, 0.35 * level, 0.005, 0.05, 0.05 + b.len);
      else if (!last) noiseBurst(g, 'bandpass', 2200, 1.2, 0.18 * level, 0.02, 0.07, 0.05 + b.at + b.len * 0.45);
      else noiseBurst(g, 'bandpass', 1500, 0.8, 0.4 * level, 0.03, 0.12, 0.05 + b.at - 0.06);
    }
    for (const s of [osc, sub, vibrato]) {
      s.start(now);
      s.stop(end);
    }
    osc.onended = () => {
      for (const n of [osc, sub, vibrato, vibratoDepth, shaper, f1, f2, f2Level, voiceGain, delay, feedback, wet, out]) quietly(n);
    };
  }

  /**
   * The hook's war cry: the recording when there is one, else the spoken
   * line over the growl (or the growl alone).
   * @returns {void}
   */
  function playGetOverHere() {
    const g = ensureGraph();
    if (SHOUT_SAMPLE_URL && g) {
      if (!shoutRequested) {
        shoutRequested = true;
        loadSample(g.ctx, SHOUT_SAMPLE_URL).then((sample) => { shoutSample = sample; }).catch(() => {});
      }
      if (shoutSample) {
        playOnce(g.ctx, /** @type {any} */ (shoutSample), { gain: 1, destination: g.bus, fadeOut: 0.2 });
        return;
      }
    }
    const spoken = speak();
    if (g) growl(g, spoken ? GROWL_LEVEL : GROWL_LEVEL * 2);
  }

  // ---------------------------------------------------------------------
  // The chain and the hook
  // ---------------------------------------------------------------------

  /**
   * The chain paying out: a tick every few hundredths of a second for
   * `seconds`, each a different pitch, with a whip of air on the front.
   * @param {number} seconds
   * @returns {void}
   */
  function playChain(seconds) {
    const g = ensureGraph();
    if (!g) return;
    noiseBurst(g, 'bandpass', 900, 0.8, 0.35, 0.02, 0.25);
    const ticks = Math.min(30, Math.max(4, Math.round(seconds / 0.028)));
    for (let i = 0; i < ticks; i++) {
      const at = i * 0.028 + Math.random() * 0.01;
      noiseBurst(g, 'bandpass', 3800 + Math.random() * 2600, 14, CHAIN_LEVEL * (1 - (i / ticks) * 0.5), 0.002, 0.04, at);
    }
  }

  /**
   * The hook biting: a metal clank, a ring and a thump.
   * @returns {void}
   */
  function playClank() {
    const g = ensureGraph();
    if (!g) return;
    const { ctx, bus } = g;
    const now = ctx.currentTime;
    noiseBurst(g, 'bandpass', 2600, 4, 0.6, 0.002, 0.12);
    noiseBurst(g, 'lowpass', 300, 0.7, 0.5, 0.004, 0.18);
    for (const f of [1870, 2960]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
      osc.connect(gain);
      gain.connect(bus);
      osc.start(now);
      osc.stop(now + 0.5);
      osc.onended = () => quietly(gain);
    }
  }

  // ---------------------------------------------------------------------
  // The jump and the jetpack
  // ---------------------------------------------------------------------

  /** @returns {void} */
  function playJump() {
    const g = ensureGraph();
    if (!g) return;
    noiseBurst(g, 'bandpass', 700, 1.2, 0.22, 0.03, 0.18);
  }

  /**
   * @param {number} level 0..1, how hard he came down
   * @returns {void}
   */
  function playLand(level) {
    const g = ensureGraph();
    if (!g) return;
    const { ctx, bus } = g;
    const now = ctx.currentTime;
    noiseBurst(g, 'lowpass', 400 + 500 * level, 0.7, 0.2 + 0.6 * level, 0.004, 0.12 + 0.25 * level);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.25);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15 + 0.6 * level, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(now);
    osc.stop(now + 0.35);
    osc.onended = () => quietly(gain);
  }

  /**
   * The burn's loop: lowpassed noise (the roar), highpassed noise chopped
   * fast (the crackle) and a low rumble, under one gain.
   * @returns {void}
   */
  function startJet() {
    const g = ensureGraph();
    if (!g) return;
    stopJet();
    const { ctx, bus, noise } = g;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(JET_LEVEL, now + 0.08);
    gain.connect(bus);

    const roarSource = ctx.createBufferSource();
    roarSource.buffer = noise;
    roarSource.loop = true;
    const roar = ctx.createBiquadFilter();
    roar.type = 'lowpass';
    roar.frequency.value = 900;
    roar.Q.value = 1.4;
    roarSource.connect(roar);
    roar.connect(gain);

    const crackleSource = ctx.createBufferSource();
    crackleSource.buffer = noise;
    crackleSource.loop = true;
    crackleSource.playbackRate.value = 1.3;
    const crackleFilter = ctx.createBiquadFilter();
    crackleFilter.type = 'highpass';
    crackleFilter.frequency.value = 2500;
    const crackleGain = ctx.createGain();
    crackleGain.gain.value = 0.12;
    const chop = ctx.createOscillator();
    chop.type = 'square';
    chop.frequency.value = 31;
    const chopDepth = ctx.createGain();
    chopDepth.gain.value = 0.1;
    chop.connect(chopDepth);
    chopDepth.connect(crackleGain.gain);
    crackleSource.connect(crackleFilter);
    crackleFilter.connect(crackleGain);
    crackleGain.connect(gain);

    const rumble = ctx.createOscillator();
    rumble.type = 'triangle';
    rumble.frequency.value = 52;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.35;
    rumble.connect(rumbleGain);
    rumbleGain.connect(gain);

    // The ignition: a pop.
    noiseBurst(g, 'lowpass', 1600, 0.8, 0.7, 0.003, 0.2);

    for (const s of [roarSource, crackleSource, chop, rumble]) s.start(now);
    jet = {
      nodes: [roar, crackleFilter, crackleGain, chopDepth, rumbleGain, gain],
      sources: [roarSource, crackleSource, chop, rumble],
      gain,
      roar
    };
  }

  /**
   * @param {number} level 0..1, the burn (0 fades it)
   * @param {number} climb 0..1, how fast he is going up: the roar opens
   * @returns {void}
   */
  function updateJet(level, climb) {
    if (!jet || !graph) return;
    const now = graph.ctx.currentTime;
    jet.gain.gain.setTargetAtTime(Math.max(0.0001, JET_LEVEL * level), now, 0.05);
    jet.roar.frequency.setTargetAtTime(700 + 1300 * climb, now, 0.08);
  }

  /** @returns {void} the burn faded out and let go */
  function stopJet() {
    if (!jet) return;
    const current = jet;
    jet = null;
    const ctx = graph ? graph.ctx : null;
    if (!ctx) {
      for (const n of [...current.sources, ...current.nodes]) quietly(n);
      return;
    }
    const now = ctx.currentTime;
    current.gain.gain.cancelScheduledValues(now);
    current.gain.gain.setTargetAtTime(0.0001, now, 0.08);
    for (const s of current.sources) {
      try { s.stop(now + 0.4); } catch { /* already */ }
    }
    current.sources[0].onended = () => {
      for (const n of [...current.sources, ...current.nodes]) quietly(n);
    };
  }

  /** @returns {void} */
  function disposeGrappleJetSound() {
    stopJet();
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    if (graph) quietly(graph.bus);
    graph = null;
  }

  return { playGetOverHere, playChain, playClank, playJump, playLand, startJet, updateJet, stopJet, disposeGrappleJetSound };
}
