// @ts-check
import { createShortNoiseBuffer } from './thunder.js';
import { soundRandom } from './random.js';

/**
 * ===========================================================================
 * SECTION S.8 — Spaceship landing
 * ===========================================================================
 * The soundtrack for the scripted landing (engine/spaceship.js), built the
 * same procedural way as the earthquake rumble (sound/earthquake.js): looped
 * noise and a couple of oscillators through filters and gains, no audio
 * files beyond the shared large-explosion sample layered on the impact.
 *
 * Three looped layers, all feeding one bus:
 *  - a **whoosh**: noise through a resonant bandpass whose centre sweeps from
 *    ~2.8kHz down to ~180Hz over the fall, so the descent opens as a thin,
 *    high rush of air and deepens as the ground comes up;
 *  - a **roar**: noise through a lowpass (~90Hz) that swells with the whoosh,
 *    the felt body of something very large moving very fast;
 *  - a **thruster whine**: a detuned pair of sawtooths through a bandpass,
 *    plus a hiss of highpassed noise, silent through the fall and brought up
 *    hard for the braking ease-out -- the retro-thrusters firing.
 *
 * And one-shots for the touchdown: a long sub-bass drop (the earthquake's
 * boom, stretched and much louder), a low noise slam, and a stuttered run of
 * cracks for the debris settling.
 *
 * Built the first time a landing starts rather than at load, exactly like
 * the quake: by then the AudioContext exists and is running. Between
 * landings the loops keep running at zero gain.
 */

const BUS_LEVEL = 0.9;
const WHOOSH_LEVEL = 0.55;
const ROAR_LEVEL = 0.7;
const WHINE_LEVEL = 0.16;
const HISS_LEVEL = 0.22;
// The sweep of the whoosh filter across the fall, Hz.
const WHOOSH_HIGH = 2800;
const WHOOSH_LOW = 180;
// The thruster whine rises in pitch as it bites, Hz.
const WHINE_LOW = 420;
const WHINE_HIGH = 880;
const BOOM_LEVEL = 1.6;
const SLAM_LEVEL = 3.2;
const CRACK_LEVEL = 2.2;
const FADE_TIME_CONSTANT = 0.08;

/**
 * @param {Object} engineCtx
 * @returns {{
 *   updateSpaceshipSound: (fall: number, progress: number, brake: number) => void,
 *   playLandingImpact: () => void,
 *   fadeOutSpaceshipSound: () => void,
 *   disposeSpaceshipSound: () => void
 * }}
 */
export function createSpaceshipSoundSystem(engineCtx) {
  /**
   * @typedef {Object} ShipGraph
   * @property {AudioScheduledSourceNode[]} sources
   * @property {AudioBuffer} buffer
   * @property {GainNode} bus
   * @property {GainNode} whoosh
   * @property {BiquadFilterNode} whooshFilter
   * @property {GainNode} roar
   * @property {GainNode} whine
   * @property {BiquadFilterNode} whineFilter
   * @property {OscillatorNode[]} whineOscs
   * @property {GainNode} hiss
   */
  /** @type {ShipGraph|null} */
  let graph = null;

  /**
   * @param {AudioContext} ctx
   * @param {AudioBuffer} buffer
   * @param {BiquadFilterType} type
   * @param {number} frequency
   * @param {number} q
   * @param {GainNode} bus
   * @returns {{source: AudioBufferSourceNode, filter: BiquadFilterNode, gain: GainNode}}
   */
  function createNoiseLayer(ctx, buffer, type, frequency, q, bus) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    source.start(0, soundRandom() * buffer.duration);
    return { source, filter, gain };
  }

  /**
   * @returns {ShipGraph|null} the graph, built on first use; null while there
   *   is no running AudioContext to build it in
   */
  function ensureGraph() {
    if (graph) return graph;
    const SoundSystem = engineCtx.SoundSystem;
    // Same guard as earthquake.js: re-resumes after a Safari tab-blur
    // suspend, but never creates the context from outside a gesture.
    if (SoundSystem && SoundSystem.graphBuilt) engineCtx.systems.sound.ensureAudioReady();
    const ctx = SoundSystem && SoundSystem.context;
    if (!ctx || ctx.state !== 'running' || !SoundSystem.effectsGain) return null;
    const buffer = createShortNoiseBuffer(ctx, 3);
    const bus = ctx.createGain();
    bus.gain.value = BUS_LEVEL;
    bus.connect(SoundSystem.effectsGain);

    const whoosh = createNoiseLayer(ctx, buffer, 'bandpass', WHOOSH_HIGH, 1.6, bus);
    const roar = createNoiseLayer(ctx, buffer, 'lowpass', 90, 0.9, bus);
    const hiss = createNoiseLayer(ctx, buffer, 'highpass', 4200, 0.7, bus);

    const whineFilter = ctx.createBiquadFilter();
    whineFilter.type = 'bandpass';
    whineFilter.frequency.value = WHINE_LOW * 2;
    whineFilter.Q.value = 3;
    const whine = ctx.createGain();
    whine.gain.value = 0;
    whineFilter.connect(whine);
    whine.connect(bus);
    const whineOscs = [0, 7].map((detune) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = WHINE_LOW;
      osc.detune.value = detune;
      osc.connect(whineFilter);
      osc.start();
      return osc;
    });

    graph = {
      sources: [whoosh.source, roar.source, hiss.source, ...whineOscs],
      buffer, bus,
      whoosh: whoosh.gain, whooshFilter: whoosh.filter,
      roar: roar.gain,
      whine, whineFilter, whineOscs,
      hiss: hiss.gain
    };
    return graph;
  }

  /**
   * Per frame during the descent.
   * @param {number} fall 0..1 how loud the fall layers should be (0 once
   *   landed, ramping in over the first moments of the drop)
   * @param {number} progress 0..1 how far down the ship is, which drives the
   *   whoosh's pitch sweep
   * @param {number} brake 0..1 how hard the retro-thrusters are firing
   * @returns {void}
   */
  function updateSpaceshipSound(fall, progress, brake) {
    if (fall <= 0 && brake <= 0 && !graph) return;
    const g = ensureGraph();
    if (!g) return;
    const now = g.bus.context.currentTime;
    // Exponential sweep, so each second of the fall drops by a similar
    // musical interval rather than all of the change landing at the top.
    const whooshHz = WHOOSH_HIGH * Math.pow(WHOOSH_LOW / WHOOSH_HIGH, progress);
    g.whooshFilter.frequency.setTargetAtTime(whooshHz, now, 0.06);
    // Thin at the top, full and loud near the ground; the braking thrusters
    // take over from it rather than stacking on it.
    const body = fall * (0.25 + 0.75 * progress) * (1 - 0.55 * brake);
    g.whoosh.gain.setTargetAtTime(body * WHOOSH_LEVEL, now, 0.08);
    g.roar.gain.setTargetAtTime(fall * progress * progress * ROAR_LEVEL, now, 0.1);

    const whineHz = WHINE_LOW + (WHINE_HIGH - WHINE_LOW) * brake;
    for (const osc of g.whineOscs) osc.frequency.setTargetAtTime(whineHz, now, 0.05);
    g.whineFilter.frequency.setTargetAtTime(whineHz * 2, now, 0.05);
    // A little flutter on the thrusters, so they read as combustion rather
    // than as a test tone.
    const flutter = 0.85 + soundRandom() * 0.3;
    g.whine.gain.setTargetAtTime(brake * WHINE_LEVEL * flutter, now, 0.04);
    g.hiss.gain.setTargetAtTime(brake * HISS_LEVEL * flutter, now, 0.04);
  }

  /**
   * The touchdown: a long sub-bass drop, a low slam of noise, and a
   * stuttering run of cracks for everything around it giving way. Also cuts
   * the fall layers, which should stop dead on contact rather than fade.
   * @returns {void}
   */
  function playLandingImpact() {
    const g = ensureGraph();
    if (!g) return;
    const ctx = g.bus.context;
    const now = ctx.currentTime;

    for (const gain of [g.whoosh, g.roar, g.whine, g.hiss]) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.setTargetAtTime(0, now, 0.03);
    }

    // Sub-bass: the earthquake boom's pitch drop, twice as long and several
    // times as loud -- the biggest single low-end hit in the game.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(95, now);
    osc.frequency.exponentialRampToValueAtTime(20, now + 1.1);
    const boom = ctx.createGain();
    boom.gain.setValueAtTime(0.0001, now);
    boom.gain.exponentialRampToValueAtTime(BOOM_LEVEL, now + 0.015);
    boom.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
    osc.connect(boom);
    boom.connect(g.bus);
    osc.start(now);
    osc.stop(now + 1.9);
    osc.onended = () => { boom.disconnect(); };

    // The slam: noise pitched right down through a low lowpass.
    const slam = ctx.createBufferSource();
    slam.buffer = g.buffer;
    slam.playbackRate.value = 0.35;
    const slamFilter = ctx.createBiquadFilter();
    slamFilter.type = 'lowpass';
    slamFilter.frequency.setValueAtTime(900, now);
    slamFilter.frequency.exponentialRampToValueAtTime(120, now + 0.8);
    const slamGain = ctx.createGain();
    slamGain.gain.setValueAtTime(SLAM_LEVEL, now);
    slamGain.gain.setTargetAtTime(0.0001, now + 0.02, 0.28);
    slam.connect(slamFilter);
    slamFilter.connect(slamGain);
    slamGain.connect(g.bus);
    slam.start(now, soundRandom() * (g.buffer.duration - 1.5));
    slam.stop(now + 1.8);
    slam.onended = () => { slamGain.disconnect(); };

    // Debris settling: a ragged run of cracks through a resonant bandpass,
    // thinning out over a second and a half.
    const debris = ctx.createBufferSource();
    debris.buffer = g.buffer;
    debris.playbackRate.value = 0.7;
    const debrisFilter = ctx.createBiquadFilter();
    debrisFilter.type = 'bandpass';
    debrisFilter.frequency.value = 1400;
    debrisFilter.Q.value = 1.4;
    const debrisGain = ctx.createGain();
    debrisGain.gain.setValueAtTime(0.0001, now);
    let t = now + 0.08;
    const cracks = 9 + Math.floor(soundRandom() * 5);
    for (let k = 0; k < cracks; k++) {
      t += 0.03 + soundRandom() * 0.16;
      const level = CRACK_LEVEL * (0.3 + soundRandom() * 0.7) * (1 - k / (cracks + 2));
      debrisGain.gain.setValueAtTime(level, t);
      debrisGain.gain.setTargetAtTime(0.0001, t + 0.004, 0.025 + soundRandom() * 0.04);
    }
    debris.connect(debrisFilter);
    debrisFilter.connect(debrisGain);
    debrisGain.connect(g.bus);
    debris.start(now, soundRandom() * (g.buffer.duration - 2));
    debris.stop(t + 0.5);
    debris.onended = () => { debrisGain.disconnect(); };
  }

  /**
   * Fades every looped layer to silence, for a reset mid-landing. The loops
   * keep running at zero gain, as between landings.
   * @returns {void}
   */
  function fadeOutSpaceshipSound() {
    if (!graph) return;
    const now = graph.bus.context.currentTime;
    for (const gain of [graph.whoosh, graph.roar, graph.whine, graph.hiss]) {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, FADE_TIME_CONSTANT);
    }
  }

  /**
   * Fades the bus out and stops the loops once it is silent, rather than
   * cutting them mid-waveform.
   * @returns {void}
   */
  function disposeSpaceshipSound() {
    if (!graph) return;
    const { sources, bus } = graph;
    try {
      const now = bus.context.currentTime;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setTargetAtTime(0, now, FADE_TIME_CONSTANT);
      for (const source of sources) source.stop(now + 0.4);
      sources[0].onended = () => {
        for (const s of sources) {
          try { s.disconnect(); } catch { /* already disconnected */ }
        }
        try { bus.disconnect(); } catch { /* already disconnected */ }
      };
    } catch {
      // The context is already closed: nothing left to hear or free.
    }
    graph = null;
  }

  return { updateSpaceshipSound, playLandingImpact, fadeOutSpaceshipSound, disposeSpaceshipSound };
}
