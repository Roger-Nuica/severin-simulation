// @ts-check
/**
 * ===========================================================================
 * SECTION S.R — The sound's own random numbers
 * ===========================================================================
 * The sound draws its random numbers (a pitch jitter, which scream, the
 * white noise itself) from this generator, not from Math.random. Whether a
 * sound plays at all depends on things outside the game -- the audio
 * context running yet, a sample finished loading, the audio clock -- so
 * draws from the game's own stream there made the rest of the game's
 * random numbers depend on them too: two benchmark runs of the same code
 * (engine/perf/bench.js) came out different. It needs no seed and holds
 * nothing that belongs to one game, so it is shared by every instance.
 */

let state = (Math.floor(Math.random() * 0x7fffffff) | 1) >>> 0;

/**
 * xorshift32: a number in [0, 1), like Math.random.
 * @returns {number}
 */
export function soundRandom() {
  state ^= state << 13;
  state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5;
  state >>>= 0;
  return state / 4294967296;
}

/**
 * A number in [low, high), like THREE.MathUtils.randFloat (which draws from
 * Math.random, the game's stream).
 * @param {number} low
 * @param {number} high
 * @returns {number}
 */
export function soundRandFloat(low, high) {
  return low + soundRandom() * (high - low);
}
