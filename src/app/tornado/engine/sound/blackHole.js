// @ts-check
import { createShortNoiseBuffer } from './thunder.js';
import { soundRandom } from './random.js';

/**
 * ===========================================================================
 * SECTION S.14 — The Black Hole Gun
 * ===========================================================================
 * The hole's own voice, positional (PannerNode, equal-power/inverse --
 * sound/creatures.js's exact panner setup, reused) so it is heard falling
 * off across its own HOLE.influence (100 m), layered on top of the shared
 * shockwave cue (sound/shockwave.js, already played on open by
 * engine/player/blackHole.js):
 *
 *  - **hum**: the gravity well itself, for as long as it is open -- two
 *    detuned sub oscillators (felt more than heard) under a slow LFO
 *    wobble, a low rumble layer, and the pull's wind -- bandpassed noise
 *    whose level and brightness rise with how much is being drawn in right
 *    now. All positioned at the hole and driven every frame by
 *    `updateHum(level, consuming, x, y, z)`, the same 0..1 `hole.size` the
 *    visuals use, so it swells and fades with the opening/closing curve and
 *    never needs its own open/close bookkeeping -- the pattern
 *    sound/empHum.js and engine/empCharge.js already use for a level-driven
 *    ambience, rather than discrete start/stop events;
 *  - **whine**: one rising tone per object on the inward spiral, pitch
 *    climbing as it nears the horizon -- WHINE.voices shared, positional
 *    voices (creatures.js's pooling, simplified: past the cap, a new object
 *    on the spiral is simply not given one, rather than stealing an
 *    already-whining voice mid-note); `updateWhine(target, through, x, y,
 *    z)` is called once per caught object per frame from blackHole.js's own
 *    drawIn() loop, `releaseWhine(target)` when it is swallowed, fades, or
 *    the hole itself closes;
 *  - **swallow**: a short positional "whoomp" plus a send into the shared
 *    reverse-reverb bus (a synthesised rising-noise impulse response -- no
 *    files, like every other procedural module here) for its tail, capped
 *    at SWALLOW.max simultaneous so a crowd going in at once is a thicker
 *    whoomp, not a stutter;
 *  - **spawn**: a reverse-reverb suck through the same bus, then a deep
 *    thump, positional;
 *  - **collapse**: a deeper boom fading to silence over its own length,
 *    positional.
 *
 * Built the first time it is needed, like the other procedural modules.
 */

const BUS_LEVEL = 0.85;
const HUM_LEVEL = 0.5;
const WIND_LEVEL = 0.24;
const RUMBLE_LEVEL = 0.22;
const WOBBLE_RATE = 0.42;      // Hz, the sub drone's slow LFO
const WOBBLE_DEPTH = 0.12;
const TIME_CONSTANT = 0.15;
const REF_DISTANCE = 18;       // metres: full level inside this
const MAX_DISTANCE = 280;
const REVERB_SECONDS = 0.6;
const REVERB_SEND = 0.55;

const WHINE = {
  voices: 10,
  level: 0.2,
  freq: [140, 820]          // Hz: at the no-escape line, and at the horizon
};
const SWALLOW = { max: 6, level: 0.65 };
// A gentle duck, not Bullet Time's full muffle -- "everything nearby sounds
// pulled", not underwater.
const MUFFLE_PEAK = 0.3;

/**
 * @param {AudioContext} ctx
 * @returns {PannerNode}
 */
function makePanner(ctx) {
  const panner = ctx.createPanner();
  panner.panningModel = 'equalpower';
  panner.distanceModel = 'inverse';
  panner.refDistance = REF_DISTANCE;
  panner.rolloffFactor = 1;
  panner.maxDistance = MAX_DISTANCE;
  return panner;
}

/**
 * @param {PannerNode} panner
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {void}
 */
function place(panner, x, y, z) {
  if (panner.positionX) {
    panner.positionX.value = x; panner.positionY.value = y; panner.positionZ.value = z;
  } else {
    panner.setPosition(x, y, z);
  }
}

/**
 * A reverse-reverb impulse response: noise rising in over REVERB_SECONDS
 * instead of decaying -- a normal reverb tail played backwards -- so
 * anything convolved with it gets a swelling "sucked in" tail rather than a
 * fading one.
 * @param {AudioContext} ctx
 * @returns {AudioBuffer}
 */
function reverseReverbBuffer(ctx) {
  const length = Math.floor(ctx.sampleRate * REVERB_SECONDS);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const u = i / length;
      data[i] = (Math.random() * 2 - 1) * (u * u * u);
    }
  }
  return buffer;
}

/**
 * @param {Object} engineCtx
 * @returns {{
 *   playOpen: (x: number, y: number, z: number) => void,
 *   updateHum: (level: number, consuming: number, x: number, y: number, z: number) => void,
 *   updateWhine: (target: object, through: number, x: number, y: number, z: number) => void,
 *   releaseWhine: (target: object) => void,
 *   clearWhines: () => void,
 *   playSwallow: (x: number, y: number, z: number) => void,
 *   playClose: (x: number, y: number, z: number) => void,
 *   disposeBlackHoleSound: () => void
 * }}
 */
export function createBlackHoleSoundSystem(engineCtx) {
  /**
   * @typedef {Object} Graph
   * @property {AudioContext} ctx
   * @property {GainNode} bus
   * @property {AudioBuffer} noise
   * @property {AudioBuffer} reverseIR
   * @property {PannerNode} humPanner
   * @property {GainNode} hum
   * @property {GainNode} rumble
   * @property {GainNode} wind
   * @property {BiquadFilterNode} windFilter
   * @property {ConvolverNode} reverb
   * @property {GainNode} reverbReturn
   * @property {AudioScheduledSourceNode[]} sources
   * @property {{osc: OscillatorNode, gain: GainNode, panner: PannerNode, target: object|null}[]} whines
   */
  /** @type {Graph|null} */
  let graph = null;
  let lastHum = 0;
  /** @type {Map<object, number>} target -> index into graph.whines */
  const whineOf = new Map();
  let swallowActive = 0;

  /** @returns {Graph|null} built on first use; null while there is no running AudioContext */
  function ensureGraph() {
    const SoundSystem = engineCtx.SoundSystem;
    if (SoundSystem && SoundSystem.graphBuilt) engineCtx.systems.sound.ensureAudioReady();
    const ctx = SoundSystem && SoundSystem.context;
    if (!ctx || ctx.state !== 'running' || !SoundSystem.effectsGain) return null;
    if (graph && graph.ctx === ctx) return graph;

    const bus = ctx.createGain();
    bus.gain.value = BUS_LEVEL;
    bus.connect(SoundSystem.effectsGain);

    const humPanner = makePanner(ctx);
    humPanner.connect(bus);

    // The pull: two detuned subs through a lowpass, wobbled slowly by an
    // LFO on their own gain -- felt more than heard.
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 160;
    lowpass.Q.value = 2;
    const hum = ctx.createGain();
    hum.gain.value = 0;
    lowpass.connect(hum);
    hum.connect(humPanner);
    const subs = [46, 46.7].map((f) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      osc.connect(lowpass);
      osc.start();
      return osc;
    });
    const wobble = ctx.createOscillator();
    wobble.frequency.value = WOBBLE_RATE;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = WOBBLE_DEPTH;
    wobble.connect(wobbleDepth);
    wobbleDepth.connect(hum.gain);
    wobble.start();

    // The rumble: a low, slightly rougher layer under the subs.
    const rumbleOsc = ctx.createOscillator();
    rumbleOsc.type = 'sawtooth';
    rumbleOsc.frequency.value = 28;
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 90;
    const rumble = ctx.createGain();
    rumble.gain.value = 0;
    rumbleOsc.connect(rumbleFilter);
    rumbleFilter.connect(rumble);
    rumble.connect(humPanner);
    rumbleOsc.start();

    // The wind: bandpassed noise, level and brightness driven by how much
    // is being pulled in right now.
    const noiseBuffer = createShortNoiseBuffer(ctx, 2);
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 700;
    windFilter.Q.value = 1.1;
    const wind = ctx.createGain();
    wind.gain.value = 0;
    noiseSource.connect(windFilter);
    windFilter.connect(wind);
    wind.connect(humPanner);
    noiseSource.start();

    // The reverse-reverb send: anything feeding into it gets a swelling
    // tail rather than a decaying one, shared by every swallow/spawn cue so
    // only one convolution runs regardless of how many are going at once.
    const reverb = ctx.createConvolver();
    reverb.buffer = reverseReverbBuffer(ctx);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.8;
    reverb.connect(reverbReturn);
    reverbReturn.connect(bus);

    // The whine pool: WHINE.voices shared oscillators, each silent and
    // unpositioned until a caught object is handed it.
    const whines = [];
    for (let i = 0; i < WHINE.voices; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = WHINE.freq[0];
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const panner = makePanner(ctx);
      osc.connect(gain);
      gain.connect(panner);
      panner.connect(bus);
      osc.start();
      whines.push({ osc, gain, panner, target: null });
    }

    graph = {
      ctx, bus, noise: noiseBuffer, reverseIR: reverb.buffer, humPanner, hum, rumble, wind, windFilter,
      reverb, reverbReturn, sources: [...subs, wobble, rumbleOsc, noiseSource, ...whines.map((w) => w.osc)], whines
    };
    return graph;
  }

  /**
   * Per frame: `hole.size` (0..1, the visuals' own opening/closing curve)
   * and roughly how much is being pulled in right now (0..1, e.g.
   * caughtCount()/HOLE.maxCaught), at the hole's position.
   * @param {number} level
   * @param {number} consuming
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {void}
   */
  function updateHum(level, consuming, x, y, z) {
    if (level <= 0 && lastHum <= 0) return;
    const g = ensureGraph();
    if (!g) return;
    lastHum = level;
    place(g.humPanner, x, y, z);
    const now = g.ctx.currentTime;
    g.hum.gain.setTargetAtTime(HUM_LEVEL * level, now, TIME_CONSTANT);
    g.rumble.gain.setTargetAtTime(RUMBLE_LEVEL * level, now, TIME_CONSTANT);
    const intensity = Math.min(1, Math.max(0, consuming));
    const crackle = soundRandom() < 0.4 ? 1 : 0.3;
    g.wind.gain.setTargetAtTime(WIND_LEVEL * level * (0.4 + 0.6 * intensity) * crackle, now, 0.04);
    g.windFilter.frequency.setTargetAtTime(700 + intensity * 2600, now, 0.12);
  }

  /**
   * One object on the inward spiral: its own rising tone, `through` the
   * same 0..1 nearness blackHole.js's drawIn() already computes (0 at the
   * no-escape line, 1 at the horizon). Past WHINE.voices already in use by
   * other objects, this one simply has none -- no voice is stolen mid-note.
   * @param {object} target
   * @param {number} through
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {void}
   */
  function updateWhine(target, through, x, y, z) {
    const g = ensureGraph();
    if (!g) return;
    let voice = whineOf.has(target) ? g.whines[/** @type {number} */ (whineOf.get(target))] : null;
    if (!voice) {
      const i = g.whines.findIndex((w) => w.target === null);
      if (i < 0) return;
      voice = g.whines[i];
      voice.target = target;
      whineOf.set(target, i);
    }
    const now = g.ctx.currentTime;
    const [f0, f1] = WHINE.freq;
    voice.osc.frequency.setTargetAtTime(f0 + (f1 - f0) * through * through, now, 0.1);
    voice.gain.gain.setTargetAtTime(WHINE.level * Math.min(1, through * 3), now, 0.08);
    place(voice.panner, x, y, z);
  }

  /**
   * The object is gone (swallowed, faded, or the hole itself closed) --
   * its voice freed for the next one.
   * @param {object} target
   * @returns {void}
   */
  function releaseWhine(target) {
    const i = whineOf.get(target);
    if (i === undefined || !graph) { whineOf.delete(target); return; }
    const voice = graph.whines[i];
    voice.gain.gain.setTargetAtTime(0, graph.ctx.currentTime, 0.12);
    voice.target = null;
    whineOf.delete(target);
  }

  /**
   * Every whine silenced at once, for a hard Reset mid-cast: resetBlackHole()
   * (engine/player/blackHole.js) clears its caught[] array directly rather
   * than swallowing each entry (matter.js/dissolve.js's own clear() exist
   * for the same reason), so nothing would otherwise call releaseWhine() for
   * whatever was still in flight and its voice would be left sounding.
   * @returns {void}
   */
  function clearWhines() {
    if (graph) {
      const now = graph.ctx.currentTime;
      for (const voice of graph.whines) {
        voice.gain.gain.setTargetAtTime(0, now, 0.08);
        voice.target = null;
      }
    }
    whineOf.clear();
  }

  /**
   * Something goes under the horizon: a short whoomp, plus a send into the
   * shared reverse-reverb bus for its tail. Capped: past SWALLOW.max already
   * sounding, this one is silent rather than piling on.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {void}
   */
  function playSwallow(x, y, z) {
    if (swallowActive >= SWALLOW.max) return;
    const g = ensureGraph();
    if (!g) return;
    swallowActive++;
    const { ctx, noise, reverb } = g;
    const now = ctx.currentTime;
    const panner = makePanner(ctx);
    place(panner, x, y, z);
    panner.connect(g.bus);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(140, now);
    sub.frequency.exponentialRampToValueAtTime(38, now + 0.22);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.exponentialRampToValueAtTime(SWALLOW.level, now + 0.015);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    sub.connect(subGain);
    subGain.connect(panner);
    sub.start(now);
    sub.stop(now + 0.32);
    const thump = ctx.createBufferSource();
    thump.buffer = noise;
    thump.loop = true;
    const thumpFilter = ctx.createBiquadFilter();
    thumpFilter.type = 'lowpass';
    thumpFilter.frequency.value = 500;
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(SWALLOW.level * 0.7, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    thump.connect(thumpFilter);
    thumpFilter.connect(thumpGain);
    thumpGain.connect(panner);
    thump.start(now);
    thump.stop(now + 0.2);
    // Its own portion into the shared reverse-reverb bus.
    const sendGain = ctx.createGain();
    sendGain.gain.setValueAtTime(0.0001, now);
    sendGain.gain.exponentialRampToValueAtTime(SWALLOW.level * REVERB_SEND, now + 0.02);
    sendGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    subGain.connect(sendGain);
    sendGain.connect(reverb);
    // Cleanup on whichever of the two actually finishes last (sub, at
    // 0.32 s) -- tying it to the shorter one would cut the longer one off
    // mid-envelope by disconnecting its gain node out from under it.
    sub.onended = () => {
      swallowActive = Math.max(0, swallowActive - 1);
      try { subGain.disconnect(); thumpGain.disconnect(); sendGain.disconnect(); panner.disconnect(); } catch { /* already */ }
    };
  }

  /**
   * It opens: a reverse-reverb suck, then a deep thump, where it opened.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {void}
   */
  function playOpen(x, y, z) {
    const g = ensureGraph();
    if (!g) return;
    const { ctx, reverb } = g;
    const now = ctx.currentTime;
    const panner = makePanner(ctx);
    place(panner, x, y, z);
    panner.connect(g.bus);
    // The suck: noise climbing into the reverse-reverb's rising tail.
    const suck = ctx.createBufferSource();
    suck.buffer = g.noise;
    suck.loop = true;
    const suckFilter = ctx.createBiquadFilter();
    suckFilter.type = 'bandpass';
    suckFilter.Q.value = 1.4;
    suckFilter.frequency.setValueAtTime(260, now);
    suckFilter.frequency.exponentialRampToValueAtTime(3400, now + 0.45);
    const suckGain = ctx.createGain();
    suckGain.gain.setValueAtTime(0.0001, now);
    suckGain.gain.exponentialRampToValueAtTime(0.75, now + 0.42);
    suckGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    suck.connect(suckFilter);
    suckFilter.connect(suckGain);
    suckGain.connect(panner);
    suckGain.connect(reverb);
    suck.start(now);
    suck.stop(now + 0.55);
    suck.onended = () => { try { suckGain.disconnect(); } catch { /* already */ } };
    // The thump, right as the suck tops out.
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(30, now + 0.4);
    sub.frequency.exponentialRampToValueAtTime(85, now + 0.75);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.0001, now + 0.4);
    subGain.gain.exponentialRampToValueAtTime(1.1, now + 0.46);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.68);
    sub.connect(subGain);
    subGain.connect(panner);
    sub.start(now + 0.4);
    sub.stop(now + 0.7);
    sub.onended = () => { try { subGain.disconnect(); panner.disconnect(); } catch { /* already */ } };
  }

  /**
   * It finishes: a deeper boom, fading to silence where it was.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {void}
   */
  function playClose(x, y, z) {
    const g = ensureGraph();
    if (!g) return;
    const { ctx } = g;
    const now = ctx.currentTime;
    const panner = makePanner(ctx);
    place(panner, x, y, z);
    panner.connect(g.bus);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(65, now);
    sub.frequency.exponentialRampToValueAtTime(22, now + 0.9);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.exponentialRampToValueAtTime(1.2, now + 0.04);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
    sub.connect(subGain);
    subGain.connect(panner);
    sub.start(now);
    sub.stop(now + 1.15);
    const crack = ctx.createBufferSource();
    crack.buffer = g.noise;
    crack.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 4600;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    crack.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    crack.start(now);
    crack.stop(now + 0.09);
    // The crack is the short one of the two (0.09 s against the boom's
    // 1.15 s): only its own gain is safe to disconnect this early.
    crack.onended = () => { try { gain.disconnect(); } catch { /* already */ } };
    sub.onended = () => { try { subGain.disconnect(); panner.disconnect(); } catch { /* already */ } };
  }

  /** @returns {void} */
  function disposeBlackHoleSound() {
    if (graph) {
      for (const source of graph.sources) {
        try { source.stop(); } catch { /* already */ }
      }
      try { graph.bus.disconnect(); } catch { /* already */ }
    }
    graph = null;
    lastHum = 0;
    whineOf.clear();
    swallowActive = 0;
  }

  return { playOpen, updateHum, updateWhine, releaseWhine, clearWhines, playSwallow, playClose, disposeBlackHoleSound };
}
