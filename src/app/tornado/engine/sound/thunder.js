// @ts-check
import * as THREE from 'three';
import { playSlice } from './samples.js';
import { soundRandom, soundRandFloat } from './random.js';

// White noise buffers, made once and shared (performance pass): every
// explosion used to fill two or three fresh buffers with random numbers --
// over a hundred thousand of them for a big blast, milliseconds of CPU at
// the moment of the blast, several blasts a second in a busy run. White
// noise is white noise: a few buffers per length, handed out in turn, sound
// the same through the filters and envelopes each sound puts on them.
// Lengths are rounded up to NOISE_STEP seconds so the handful of lengths in
// use share them; every caller stops its source itself or loops it.
const NOISE_STEP = 0.25;
const NOISE_VARIANTS = 3;
/** @type {WeakMap<BaseAudioContext, Map<number, {buffers: AudioBuffer[], next: number}>>} */
const noiseBuffers = new WeakMap();

/**
 * Short noise buffer for one-shot and looped synthesised sounds (the debris
 * impact and fire layers, the hums). Distinct from the wind layer's
 * createNoiseBuffer(): shorter, and shared (see NOISE_VARIANTS) rather than
 * one long looped bed. At least `duration` long.
 * @param {BaseAudioContext} ctx
 * @param {number} duration seconds
 * @returns {AudioBuffer}
 */
export function createShortNoiseBuffer(ctx, duration) {
  const seconds = Math.ceil(duration / NOISE_STEP - 1e-9) * NOISE_STEP;
  const length = Math.ceil(ctx.sampleRate * seconds);
  let byLength = noiseBuffers.get(ctx);
  if (!byLength) {
    byLength = new Map();
    noiseBuffers.set(ctx, byLength);
  }
  let entry = byLength.get(length);
  if (!entry) {
    entry = { buffers: [], next: 0 };
    byLength.set(length, entry);
  }
  if (entry.buffers.length < NOISE_VARIANTS) {
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = soundRandom() * 2 - 1;
    entry.buffers.push(buffer);
    return buffer;
  }
  const buffer = entry.buffers[entry.next];
  entry.next = (entry.next + 1) % NOISE_VARIANTS;
  return buffer;
}

// Overlapping claps past this point add nothing but level, so the newest is
// dropped rather than piling onto the limiter.
const THUNDER_MAX_VOICES = 5;
const THUNDER_MIN_LENGTH = 1;
const THUNDER_MAX_LENGTH = 2;

/**
 * @param {Object} engineCtx
 * @returns {{ playThunder: (power: number, muffle: number) => void }}
 */
export function createThunderSystem(engineCtx) {
  const { SoundSystem } = engineCtx;

  /**
   * Plays a random 1-2 second slice of the thunder recording
   * (public/sounds/lightning.mp3) on the thunder bus. Stronger strikes play
   * louder; distant ones are quieter and lowpassed, since distance strips the
   * high frequencies first.
   * @param {number} power 0..1, how strong/close the strike was
   * @param {number} muffle 0..1, higher = more distant/muffled tone
   * @returns {void}
   */
  function playThunder(power, muffle) {
    // Re-resumes a context Safari suspended on tab-blur; a no-op otherwise.
    // Never *creates* one -- the graph is only ever built from a gesture (see
    // sound/index.js), and this can fire from a frame callback.
    if (SoundSystem.graphBuilt && !engineCtx.systems.sound.ensureAudioReady()) return;
    const ctx = SoundSystem.context;
    const sample = SoundSystem.thunderSample;
    if (!ctx || !SoundSystem.thunderLimiter || !sample) return;
    if (ctx.state !== 'running') return;
    if (SoundSystem.thunderVoices >= THUNDER_MAX_VOICES) return;
    SoundSystem.thunderVoices++;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = THREE.MathUtils.lerp(16000, 900, muffle);
    filter.connect(SoundSystem.thunderLimiter);

    const source = playSlice(ctx, sample, {
      length: soundRandFloat(THUNDER_MIN_LENGTH, THUNDER_MAX_LENGTH),
      gain: (0.45 + power * 0.55) * (1 - muffle * 0.45),
      destination: filter,
      playbackRate: soundRandFloat(0.9, 1.05),
      fadeIn: 0.005,
      fadeOut: 0.35,
      onEnd: () => {
        filter.disconnect();
        SoundSystem.thunderVoices = Math.max(0, SoundSystem.thunderVoices - 1);
        engineCtx.Lightning.activeAudioNodes = engineCtx.Lightning.activeAudioNodes.filter(n => n !== source);
      },
    });
    engineCtx.Lightning.activeAudioNodes.push(source);
  }

  return { playThunder };
}
