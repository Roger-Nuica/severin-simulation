// @ts-check
import * as THREE from 'three';
import { playSlice } from './samples.js';
import { soundRandom, soundRandFloat } from './random.js';

/**
 * ===========================================================================
 * SECTION K.1 — Screams (recorded samples: public/sounds/human_scream1.mp3,
 * human_scream2.wav, human_scream2.wav)
 * ===========================================================================
 */

// Hard ceiling on simultaneous scream voices: several people can enter
// 'rising' within the same couple of frames at high intensity, and one voice
// per person would quickly stack into a wall of yelling rather than reading
// as several distinct captures.
const SCREAM_MAX_VOICES = 4;
// Minimum spacing between triggers, so two captures a frame apart don't fire
// two screams that are indistinguishable from one.
const SCREAM_MIN_GAP = 0.12;
// The default camera sits ~110 units from the town centre and captured
// people were measured at 147-174 units away, so the range has to reach well
// past that or no scream is ever heard in normal viewing.
const SCREAM_RANGE = 400;
const SCREAM_LENGTH = 5;

/**
 * @param {Object} engineCtx
 * @returns {{ playScream: (pos: THREE.Vector3, distance: number) => void }}
 */
export function createScreamSoundSystem(engineCtx) {
  const { SoundSystem } = engineCtx;

  /**
   * Plays a random 5 second slice of the scream recording, fired from
   * updateCaptureState() the moment a person object enters the 'rising'
   * state. Triggers closer together than SCREAM_MIN_GAP are dropped, voices
   * are capped at SCREAM_MAX_VOICES, and each new voice is ducked by how many
   * are already sounding; the scream bus limiter is the backstop under all
   * three.
   * @param {THREE.Vector3} pos world-space position of the capture
   * @param {number} distance world units from the camera to `pos`
   * @returns {void}
   */
  function playScream(pos, distance) {
    // See the same guard in thunder.js: re-resumes after a Safari tab-blur
    // suspend, but never creates the context from outside a gesture.
    if (SoundSystem.graphBuilt && !engineCtx.systems.sound.ensureAudioReady()) return;
    const ctx = SoundSystem.context;
    const samples = SoundSystem.screamSamples;
    if (!ctx || !SoundSystem.screamLimiter || !samples.length) return;
    // A different voice each time rather than always the first to load, so a
    // run doesn't read as one person screaming over and over.
    const sample = samples[Math.floor(soundRandom() * samples.length)];
    // A suspended context's clock doesn't advance, so a voice started here
    // would never end and the voice counter would stick at the cap.
    if (ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - SoundSystem.screamLastPlay < SCREAM_MIN_GAP) return;
    if (SoundSystem.screamVoices >= SCREAM_MAX_VOICES) return;

    const proximity = 1 - THREE.MathUtils.clamp(distance / SCREAM_RANGE, 0, 1);
    if (proximity <= 0.02) return;

    SoundSystem.screamLastPlay = now;
    SoundSystem.screamVoices++;

    // Duck against the voices already sounding, not including this one, so a
    // lone scream plays at full level.
    const duck = 1 / (1 + (SoundSystem.screamVoices - 1) * 0.6);
    const source = playSlice(ctx, sample, {
      length: SCREAM_LENGTH,
      fadeOut: 0.5,
      // A floor of 0.5 keeps a capture across town clearly audible; distance
      // still makes nearby screams noticeably louder.
      gain: (0.5 + 0.5 * proximity) * duck,
      destination: SoundSystem.screamLimiter,
      // Slight pitch variation so overlapping screams aren't the same voice.
      playbackRate: soundRandFloat(0.93, 1.07),
      onEnd: () => {
        SoundSystem.activeScreamNodes = SoundSystem.activeScreamNodes.filter(n => n !== source);
        SoundSystem.screamVoices = Math.max(0, SoundSystem.screamVoices - 1);
      },
    });
    SoundSystem.activeScreamNodes.push(source);
  }

  return { playScream };
}
