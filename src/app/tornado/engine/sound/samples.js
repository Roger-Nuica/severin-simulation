// @ts-check
import { soundRandom } from './random.js';

/**
 * Recorded one-shot samples (the scream and thunder mp3s in public/sounds),
 * decoded once and then played back as short random slices so repeated
 * triggers don't sound like the same clip restarting.
 */

/**
 * @typedef {Object} Sample
 * @property {AudioBuffer} buffer
 * @property {number[]} loudStarts offsets (seconds) of windows loud enough to
 *   start a slice on, so a slice never begins in a silent gap of the recording
 */

const WINDOW_SECONDS = 0.1;
// Relative to the loudest window: low enough to keep plenty of candidate
// offsets, high enough to skip breaths and silence between takes.
const LOUD_FRACTION = 0.35;

/**
 * @param {AudioBuffer} buffer
 * @returns {number[]}
 */
function findLoudStarts(buffer) {
  const data = buffer.getChannelData(0);
  const windowSize = Math.max(1, Math.round(buffer.sampleRate * WINDOW_SECONDS));
  const rms = [];
  for (let start = 0; start + windowSize <= data.length; start += windowSize) {
    let sum = 0;
    for (let i = start; i < start + windowSize; i++) sum += data[i] * data[i];
    rms.push(Math.sqrt(sum / windowSize));
  }
  const loudest = Math.max(0, ...rms);
  return rms
    .map((level, i) => ({ level, t: i * WINDOW_SECONDS }))
    .filter(w => w.level >= loudest * LOUD_FRACTION)
    .map(w => w.t);
}

/**
 * @param {BaseAudioContext} ctx
 * @param {string} url
 * @returns {Promise<Sample>}
 */
export async function loadSample(ctx, url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
  return { buffer, loudStarts: findLoudStarts(buffer) };
}

/**
 * @param {Sample} sample
 * @param {number} length seconds of buffer time the slice needs
 * @returns {number}
 */
function pickSliceStart(sample, length) {
  const maxStart = Math.max(0, sample.buffer.duration - length);
  const candidates = sample.loudStarts.filter(t => t <= maxStart);
  if (candidates.length === 0) return soundRandom() * maxStart;
  return candidates[Math.floor(soundRandom() * candidates.length)];
}

/**
 * @typedef {Object} SliceOptions
 * @property {number} length audible length in seconds
 * @property {number} gain peak linear gain
 * @property {AudioNode} destination
 * @property {number} [playbackRate]
 * @property {number} [fadeIn] seconds
 * @property {number} [fadeOut] seconds
 * @property {() => void} [onEnd]
 */

/**
 * Plays a random loud slice of `sample` with a short fade at each end, so
 * cutting into the middle of the recording never clicks.
 * @param {AudioContext} ctx
 * @param {Sample} sample
 * @param {SliceOptions} options
 * @returns {AudioBufferSourceNode}
 */
export function playSlice(ctx, sample, {
  length, gain, destination, playbackRate = 1, fadeIn = 0.02, fadeOut = 0.25, onEnd,
}) {
  const now = ctx.currentTime;
  // start()'s duration is in buffer time, which playbackRate stretches.
  const bufferLength = Math.min(length * playbackRate, sample.buffer.duration);
  const audibleLength = bufferLength / playbackRate;
  const offset = pickSliceStart(sample, bufferLength);

  const source = ctx.createBufferSource();
  source.buffer = sample.buffer;
  source.playbackRate.value = playbackRate;

  const envelope = ctx.createGain();
  const fadeOutStart = Math.max(now + fadeIn, now + audibleLength - fadeOut);
  envelope.gain.setValueAtTime(0, now);
  envelope.gain.linearRampToValueAtTime(gain, now + fadeIn);
  envelope.gain.setValueAtTime(gain, fadeOutStart);
  envelope.gain.linearRampToValueAtTime(0, now + audibleLength);

  source.connect(envelope);
  envelope.connect(destination);
  source.onended = () => {
    envelope.disconnect();
    if (onEnd) onEnd();
  };
  source.start(now, offset, bufferLength);
  return source;
}

/**
 * @typedef {Object} OnceOptions
 * @property {number} gain peak linear gain
 * @property {AudioNode} destination
 * @property {number} [fadeIn] seconds
 * @property {number} [fadeOut] seconds
 * @property {number} [maxDuration] seconds: cut a long recording short here,
 *   fading out over `fadeOut` so the cut never clicks
 * @property {() => void} [onEnd]
 */

/**
 * Plays `sample` once, in full, from the very start of the recording, with a
 * short fade at each end. Unlike playSlice() above, this is for a single
 * authored one-shot cue (a stinger, a shockwave) rather than a recording to
 * draw a random moment out of -- there is no loud-window offset to pick.
 * @param {AudioContext} ctx
 * @param {Sample} sample
 * @param {OnceOptions} options
 * @returns {AudioBufferSourceNode}
 */
export function playOnce(ctx, sample, { gain, destination, fadeIn = 0.02, fadeOut = 0.4, maxDuration = Infinity, onEnd }) {
  const now = ctx.currentTime;
  const duration = Math.min(sample.buffer.duration, maxDuration);

  const source = ctx.createBufferSource();
  source.buffer = sample.buffer;

  const envelope = ctx.createGain();
  const fadeOutStart = Math.max(now + fadeIn, now + duration - fadeOut);
  envelope.gain.setValueAtTime(0, now);
  envelope.gain.linearRampToValueAtTime(gain, now + fadeIn);
  envelope.gain.setValueAtTime(gain, fadeOutStart);
  envelope.gain.linearRampToValueAtTime(0, now + duration);

  source.connect(envelope);
  envelope.connect(destination);
  source.onended = () => {
    envelope.disconnect();
    if (onEnd) onEnd();
  };
  source.start(now);
  if (duration < sample.buffer.duration) source.stop(now + duration + 0.02);
  return source;
}
