// @ts-check
import { playOnce } from './samples.js';

/**
 * ===========================================================================
 * SECTION K.4 — The "world-end" stinger (public/sounds/world-end.wav)
 * ===========================================================================
 * One dramatic one-shot cue, played at the three moments that mark a run
 * properly tipping over into chaos: Start being pressed, Doomsday being
 * switched on, and two tornadoes merging (Fujiwhara). Played with
 * samples.js's playOnce() -- from the start of the recording, unlike the
 * scream/thunder samples' playSlice() -- since this is a single authored
 * line, not a texture to draw random moments from.
 */

// Seconds between triggers. Doomsday switches itself on by calling
// startSim() internally, so the two calls can land in the same instant when
// Doomsday is the very first thing pressed; this collapses that pair (and
// any other coincidence, a merge landing right as Doomsday comes up, say)
// into a single play rather than two copies stacked on top of each other.
const STINGER_MIN_GAP = 2;

/**
 * @param {Object} engineCtx
 * @returns {{ playStinger: () => void }}
 */
export function createStingerSoundSystem(engineCtx) {
  const { SoundSystem } = engineCtx;

  /**
   * Plays public/sounds/world-end.wav once, in full, from its own start.
   * @returns {void}
   */
  function playStinger() {
    // See the same guard in scream.js/thunder.js: re-resumes after a Safari
    // tab-blur suspend, but never creates the context from outside a gesture.
    if (SoundSystem.graphBuilt && !engineCtx.systems.sound.ensureAudioReady()) return;
    const ctx = SoundSystem.context;
    const sample = SoundSystem.stingerSample;
    if (!ctx || !sample) return;
    if (ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - SoundSystem.stingerLastPlay < STINGER_MIN_GAP) return;
    SoundSystem.stingerLastPlay = now;

    const source = playOnce(ctx, sample, {
      gain: 1,
      destination: SoundSystem.effectsGain,
      fadeIn: 0.03,
      fadeOut: 0.6,
      onEnd: () => {
        SoundSystem.activeStingerNodes = SoundSystem.activeStingerNodes.filter(n => n !== source);
      }
    });
    SoundSystem.activeStingerNodes.push(source);
  }

  return { playStinger };
}
