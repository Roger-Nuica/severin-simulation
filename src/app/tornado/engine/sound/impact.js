// @ts-check
import * as THREE from 'three';
import { createShortNoiseBuffer } from './thunder.js';
import { soundRandom } from './random.js';

/**
 * @param {Object} engineCtx
 * @returns {{ playImpactSound: (strength: number, distance: number) => void }}
 */
export function createImpactSoundSystem(engineCtx) {
  const { SoundSystem } = engineCtx;

  // Hard ceiling on simultaneous explosion voices, in the same spirit as
  // DEBRIS_CAP: at EF5 the triggers can fire in bulk, and an uncapped
  // one-voice-per-blast policy would pile up both CPU cost and level. Past the
  // cap the newest blast is simply dropped -- the ones already sounding are
  // covering the same moment anyway. Kept to 4 rather than the old 5 because
  // each explosion is now up to four nodes deep and rings on far longer.
  const IMPACT_MAX_VOICES = 4;
  // Minimum spacing between triggers. Two blasts closer together than this
  // are a single audible event, and stacking sub-bass booms inside one window
  // just sums into mud rather than reading as two explosions.
  const IMPACT_MIN_GAP = 0.07;

  /**
   * Synthesises one bomb-like explosion, fired in sync with each visual
   * fireball from spawnImpactBurst(). Procedural Web Audio throughout, in the
   * same idiom as the wind/rumble beds and playThunder() -- noise through
   * filters plus envelopes, no sample files.
   *
   * Four layers, staged the way a real blast arrives: a sharp detonation
   * crack, a lowpass-swept roar as the fireball expands, a long sub-bass boom
   * that drops to near-subsonic and rings on, and (on bigger blasts only) a
   * quiet tail of rubble settling. The boom is what carries the weight -- it
   * outlasts everything else by a wide margin, which is what separates a bomb
   * from a hit.
   *
   * It stays distinguishable from playThunder() despite both being big and
   * low: thunder's signature is a diffuse 2-4s lowpassed rumble with no
   * fundamental, whereas this has a clear pitched sub sweeping 150Hz down to
   * ~26Hz, and its crack is a highpassed transient rather than thunder's
   * bandpassed 900-2400Hz one. Distant blasts are also delayed by travel time
   * from the camera, which is most of what sells their size.
   *
   * Level is managed three ways so clustered blasts can't clip or machine-gun:
   * blasts closer together than IMPACT_MIN_GAP are dropped outright, voices
   * are capped at IMPACT_MAX_VOICES, and each new voice is ducked by how many
   * are already sounding. The bus limiter (see initSoundSystem) is the
   * backstop under all three. Pitch and level are jittered per blast so a
   * rapid sequence doesn't sound like one looped sample.
   * @param {number} strength ~0.4..2, matching spawnImpactBurst's scale
   * @param {number} distance world units from the camera to the blast
   * @returns {void}
   */
  function playImpactSound(strength, distance) {
    // See the same guard in thunder.js: re-resumes after a Safari tab-blur
    // suspend, but never creates the context from outside a gesture.
    if (SoundSystem && SoundSystem.graphBuilt && !engineCtx.systems.sound.ensureAudioReady()) return;
    // Guarded on SoundSystem itself, not just its context: this runs from
    // per-frame callers, so a missing sound system must be a silent no-op
    // rather than an exception on every frame.
    const ctx = SoundSystem && SoundSystem.context;
    if (!ctx || !SoundSystem.impactLimiter) return;
    // A suspended context's clock doesn't advance, so a voice started here
    // would never reach its scheduled stop() and never fire onended -- the
    // voice counter would climb to IMPACT_MAX_VOICES and stick there,
    // silencing explosions for the rest of the session. Reachable in
    // practice: spawnImpactBurst() can fire from chase mode's capture check
    // before the Start button has ever resumed the context.
    if (ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - SoundSystem.impactLastPlay < IMPACT_MIN_GAP) return;
    if (SoundSystem.impactVoices >= IMPACT_MAX_VOICES) return;

    // Near-silent past ~200 units; no point spending a voice on a blast the
    // player cannot hear, and dropping it early keeps the cap for audible
    // ones. Explosions carry further than the old debris thud did.
    const proximity = 1 - THREE.MathUtils.clamp(distance / 200, 0, 1);
    if (proximity <= 0.02) return;

    SoundSystem.impactLastPlay = now;
    SoundSystem.impactVoices++;

    // Bigger blasts sit lower and ring on longer; the jitter keeps repeats
    // from sounding like one looped sample.
    const size = THREE.MathUtils.clamp((strength - 0.4) / 1.3, 0, 1);
    const jitter = 0.88 + soundRandom() * 0.24;
    // Duck against the voices *already* sounding, not including this one, so
    // an isolated blast plays at full level and only genuinely overlapping
    // ones are pulled down. Counting this voice would quietly attenuate every
    // explosion in the game for no reason.
    const duck = 1 / (1 + (SoundSystem.impactVoices - 1) * 0.7);
    const level = proximity * proximity * duck * (0.55 + size * 0.45);

    // Sound travels ~343 m/s; at this scene's scale a distant blast arriving
    // noticeably after its flash is most of what sells the *size* of it. The
    // existing thunder does the same thing with its pendingThunder delay.
    const t0 = now + Math.min(0.55, distance / 140);

    // --- 1. Detonation crack: the sharp leading edge, gone in ~60ms. This is
    // what makes it read as an explosion rather than a slow whoomph, and it
    // sits well above thunder's 900-2400Hz crack band so the two never blur.
    const crackDuration = 0.06 + size * 0.03;
    const crack = ctx.createBufferSource();
    crack.buffer = createShortNoiseBuffer(ctx, crackDuration);
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = 'highpass';
    crackFilter.frequency.value = THREE.MathUtils.lerp(1800, 900, size) * jitter;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.0001, t0);
    crackGain.gain.linearRampToValueAtTime(level * 0.75, t0 + 0.002);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, t0 + crackDuration);
    crack.connect(crackFilter);
    crackFilter.connect(crackGain);
    crackGain.connect(SoundSystem.impactLimiter);
    crack.start(t0);
    crack.stop(t0 + crackDuration + 0.02);

    // --- 2. Blast roar: noise through a lowpass swept steeply downward. The
    // sweep is the "whoomph" of the fireball expanding, and carries most of
    // the explosion's perceived body.
    const roarDuration = 0.5 + size * 0.5;
    const roar = ctx.createBufferSource();
    roar.buffer = createShortNoiseBuffer(ctx, roarDuration);
    const roarFilter = ctx.createBiquadFilter();
    roarFilter.type = 'lowpass';
    roarFilter.Q.value = 3;
    roarFilter.frequency.setValueAtTime(THREE.MathUtils.lerp(900, 1400, size) * jitter, t0);
    roarFilter.frequency.exponentialRampToValueAtTime(
      THREE.MathUtils.lerp(120, 70, size), t0 + roarDuration
    );
    const roarGain = ctx.createGain();
    roarGain.gain.setValueAtTime(0.0001, t0);
    roarGain.gain.linearRampToValueAtTime(level * 0.95, t0 + 0.012);
    roarGain.gain.exponentialRampToValueAtTime(0.0001, t0 + roarDuration);
    roar.connect(roarFilter);
    roarFilter.connect(roarGain);
    roarGain.connect(SoundSystem.impactLimiter);
    roar.start(t0);
    roar.stop(t0 + roarDuration + 0.02);

    // --- 3. Sub boom: the "bomb" itself. A sine dropped from chest-thump
    // range down to near-subsonic over the first third of its life, ringing on
    // far longer than anything in the old debris-impact sound. Triangle rather
    // than sine for the biggest blasts so there's some harmonic content left
    // on small speakers that can't reproduce 30Hz at all.
    const boomDuration = 0.75 + size * 0.75;
    const boom = ctx.createOscillator();
    boom.type = size > 0.55 ? 'triangle' : 'sine';
    boom.frequency.setValueAtTime(THREE.MathUtils.lerp(150, 95, size) * jitter, t0);
    boom.frequency.exponentialRampToValueAtTime(
      THREE.MathUtils.lerp(42, 26, size) * jitter, t0 + boomDuration * 0.35
    );
    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(0.0001, t0);
    boomGain.gain.linearRampToValueAtTime(level * (0.8 + size * 0.5), t0 + 0.008);
    boomGain.gain.exponentialRampToValueAtTime(0.0001, t0 + boomDuration);
    boom.connect(boomGain);
    boomGain.connect(SoundSystem.impactLimiter);
    boom.start(t0);
    boom.stop(t0 + boomDuration + 0.02);

    // --- 4. Debris tail: quiet, heavily lowpassed rubble settling after the
    // blast. Only worth synthesising for the bigger explosions -- on a small
    // one it would just muddy the mix.
    let tail = null;
    let tailFilter = null;
    let tailGain = null;
    if (size > 0.3) {
      const tailDuration = 0.9 + size * 0.9;
      tail = ctx.createBufferSource();
      tail.buffer = createShortNoiseBuffer(ctx, tailDuration);
      tailFilter = ctx.createBiquadFilter();
      tailFilter.type = 'lowpass';
      tailFilter.frequency.setValueAtTime(320, t0 + 0.1);
      tailFilter.frequency.exponentialRampToValueAtTime(90, t0 + tailDuration);
      tailGain = ctx.createGain();
      tailGain.gain.setValueAtTime(0.0001, t0 + 0.08);
      tailGain.gain.linearRampToValueAtTime(level * 0.3 * size, t0 + 0.18);
      tailGain.gain.exponentialRampToValueAtTime(0.0001, t0 + tailDuration);
      tail.connect(tailFilter);
      tailFilter.connect(tailGain);
      tailGain.connect(SoundSystem.impactLimiter);
      tail.start(t0 + 0.08);
      tail.stop(t0 + tailDuration + 0.02);
      SoundSystem.activeImpactNodes.push(tail);
      const tailRef = tail, tailFilterRef = tailFilter, tailGainRef = tailGain;
      tailRef.onended = () => {
        try { tailFilterRef.disconnect(); tailGainRef.disconnect(); } catch { /* already disconnected */ }
        SoundSystem.activeImpactNodes = SoundSystem.activeImpactNodes.filter(n => n !== tailRef);
      };
    }

    SoundSystem.activeImpactNodes.push(crack, roar, boom);
    crack.onended = () => {
      try { crackFilter.disconnect(); crackGain.disconnect(); } catch { /* already disconnected */ }
      SoundSystem.activeImpactNodes = SoundSystem.activeImpactNodes.filter(n => n !== crack);
    };
    roar.onended = () => {
      try { roarFilter.disconnect(); roarGain.disconnect(); } catch { /* already disconnected */ }
      SoundSystem.activeImpactNodes = SoundSystem.activeImpactNodes.filter(n => n !== roar);
    };
    // The boom outlasts the crack and the roar, so the voice count is released
    // here -- releasing on whichever source happened to end first would let
    // the cap drift upward while voices were still sounding. (The debris tail
    // can run marginally longer, but it's near-silent by then and holding a
    // voice open for it would needlessly throttle new explosions.)
    boom.onended = () => {
      try { boomGain.disconnect(); } catch { /* already disconnected */ }
      SoundSystem.activeImpactNodes = SoundSystem.activeImpactNodes.filter(n => n !== boom);
      SoundSystem.impactVoices = Math.max(0, SoundSystem.impactVoices - 1);
    };
  }

  return { playImpactSound };
}
