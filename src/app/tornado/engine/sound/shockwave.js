// @ts-check
import { playOnce } from './samples.js';

/**
 * ===========================================================================
 * SECTION K.5 — The tornado's EMP shockwave (public/sounds/shockwave.wav)
 * ===========================================================================
 * Fired alongside every EMP discharge (engine/electricStorm.js's fireEMP()):
 * the ring that travels outward across the map, faulting the grid as it goes,
 * gets its own boom rather than sharing playImpactSound()'s synthesised
 * explosion -- the EMP is a wave through the whole town, not a blast at a
 * point, and deserves a distinct sound of its own. Played with samples.js's
 * playOnce(), the same "from the start, not a random slice" way the
 * "world-end" stinger is (see sound/stinger.js).
 */

// Seconds between triggers: guards against two funnels' EMPs (an Outbreak
// with more than one Electric Tornado active) landing close enough together
// to double the boom up.
const SHOCKWAVE_MIN_GAP = 1.2;

/**
 * @param {Object} engineCtx
 * @returns {{ playShockwave: () => void }}
 */
export function createShockwaveSoundSystem(engineCtx) {
  const { SoundSystem } = engineCtx;

  /**
   * Plays public/sounds/shockwave.wav once, in full, from its own start.
   * @returns {void}
   */
  function playShockwave() {
    // See the same guard in scream.js/thunder.js: re-resumes after a Safari
    // tab-blur suspend, but never creates the context from outside a gesture.
    if (SoundSystem.graphBuilt && !engineCtx.systems.sound.ensureAudioReady()) return;
    const ctx = SoundSystem.context;
    const sample = SoundSystem.shockwaveSample;
    if (!ctx || !sample) return;
    if (ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - SoundSystem.shockwaveLastPlay < SHOCKWAVE_MIN_GAP) return;
    SoundSystem.shockwaveLastPlay = now;

    const source = playOnce(ctx, sample, {
      gain: 1,
      destination: SoundSystem.effectsGain,
      fadeIn: 0.02,
      fadeOut: 0.4,
      onEnd: () => {
        SoundSystem.activeShockwaveNodes = SoundSystem.activeShockwaveNodes.filter(n => n !== source);
      }
    });
    SoundSystem.activeShockwaveNodes.push(source);
  }

  return { playShockwave };
}
