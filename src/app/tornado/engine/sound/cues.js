import { playOnce, loadSample } from './samples.js';

/**
 * ===========================================================================
 * SECTION K.6 — Recorded cues and music
 * ===========================================================================
 * The rest of the recorded sounds in public/sounds, loaded by sound/index.js
 * alongside the screams, thunder, stinger and shockwave:
 *
 *  - glass-crack.wav: the screen breaking as an EF5 wedge comes up
 *    (engine/screenCrack.js);
 *  - large-explosion.wav: a meteor hitting the ground (meteors.js impact),
 *    the chemical works going up (environment/factory.js) and the petrol
 *    tanker (environment/tanker.js);
 *  - the music: a playlist of guta.mp3 (citySample -- it was
 *    city-sound.wav) and drobeta.mp3, each played to its end and then the
 *    other, round and round, for as long as the page is open (PLAYLIST,
 *    updatePlaylist). Or, chosen in the panel's Sounds section
 *    (engine/settings.js musicTrack), the old city-sound.wav, looped
 *    (cityTrack). The two crossfade over about a second when the choice
 *    changes; the one not chosen carries on silent underneath. The city
 *    recording is levelled to the playlist's loudness (its RMS against the
 *    songs', loudness()), so switching does not jump the volume. On request, nothing in the game stops it, restarts it
 *    or swaps it out -- Roger living or dying, a run starting or ending,
 *    Chase Mode, the Terminators, the ships. (It used to be a two-minute
 *    rotation that the event tracks below replaced outright, and that
 *    started again from the top whenever one of them ended.)
 *  - terminator.wav: MUSIC.overlaySeconds of it over the playlist when a
 *    Terminator comes within MUSIC.terminatorOn of Roger in Hero Mode
 *    (heroMode.js terminatorDistance); again only once they have all been
 *    further than MUSIC.terminatorOff;
 *  - space-ship-music.wav: the same, over the playlist, when the alien
 *    mothership arrives (engine/mothership.js).
 *  - car-music.wav: Chase Mode's loop, kept but switched off
 *    (MUSIC.chaseTrack): it would play on top of the playlist.
 *
 * While Smooth Criminal's song plays (engine/smoothCriminal.js) the
 * playlist goes silent and the storm is ducked, as under an overlay.
 *
 * While an overlay plays the playlist dips to MUSIC.dip, and everything
 * else but the screams (the wind and rain hiss, thunder, effects) is turned
 * down to MUSIC.duck (sound/index.js reads SoundSystem.musicDuck); the storm
 * is ducked the same way while the red hunter ships are in the sky, so the
 * playlist is heard over the rain then.
 *
 * The one-shots play whole, from the start, like the stinger (samples.js
 * playOnce). The playlist and the chase loop are driven by state rather
 * than by events (see updateCues), so nothing has to remember to switch them
 * on or off at every place a run can start or end.
 */

// Seconds between two large explosions: meteors of one volley can land
// within a frame of each other, and two copies started together are one
// explosion twice as loud rather than two.
const EXPLOSION_MIN_GAP = 0.2;
const EXPLOSION_MAX_VOICES = 4;
// earthquake.wav runs far longer than the shaking it goes with (its siren
// tail went on long after the ground had settled), so it is cut here, with a
// long fade so the cut reads as the quake dying away.
const EARTHQUAKE_SECONDS = 7;
const EARTHQUAKE_FADE = 1.6;
const LOOPS = {
  chase: { sample: 'carMusicSample', level: 0.55, fadeIn: 0.6, fadeOut: 1.2 }
};
// Time constant of the music's level changes: ~1 s to settle, so switching
// tracks is a one-second crossfade.
const MUSIC_FADE = 0.3;
const CITY_TRACK = '/sounds/city-sound.wav';
/**
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
const clampTo = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// The playlist, in order: guta.mp3, then drobeta.mp3, then round again.
const PLAYLIST = ['citySample', 'drobetaMusicSample'];
const MUSIC = {
  level: 0.9,              // the playlist
  dip: 0.45,               // of that, under an overlay
  overlaySeconds: 6,       // of terminator.wav / space-ship-music.wav over it
  overlayLevel: 1.1,
  overlayFade: 1.5,
  terminatorOn: 50,        // metres: a Terminator this near Roger sets it off
  terminatorOff: 75,       // and it can go again once they are all further than this
  duck: 0.3,               // the rest of the mix under an overlay or the hunters
  chaseTrack: false        // car-music.wav in Chase Mode (see the header)
};

/**
 * @param {Object} engineCtx
 * @returns {{
 *   playGlassCrack: () => void,
 *   playLargeExplosion: () => void,
 *   playSonicBoom: (gain?: number) => void,
 *   updateCues: () => void,
 *   stopAllCues: () => void,
 *   playEarthquake: () => void,
 *   musicLevels: () => {playlist: number, city: number}
 * }}
 */
export function createCueSoundSystem(engineCtx) {
  const { SoundSystem } = engineCtx;

  /** @type {AudioScheduledSourceNode[]} */
  let oneShots = [];
  let explosionLastPlay = -1;
  let explosionVoices = 0;

  /** @type {Record<string, {source: AudioBufferSourceNode|null, gain: GainNode|null}>} */
  const tracks = { chase: { source: null, gain: null } };
  // The playlist: which song, where it was started on the AudioContext's
  // clock and how long it runs, and its own gain (dipped under overlays).
  const playlist = {
    index: 0,
    /** @type {AudioBufferSourceNode|null} */
    source: null,
    /** @type {GainNode|null} */
    gain: null,
    startedAt: 0,
    duration: 0
  };
  // The other music choice: city-sound.wav, looped, with its own gain and
  // the trim that levels it to the playlist (see the header).
  const cityTrack = {
    /** @type {AudioBufferSourceNode|null} */
    source: null,
    /** @type {GainNode|null} */
    gain: null,
    trim: 1,
    loading: false
  };
  // The overlays: seconds left of the one playing, and whether each may
  // go again (the Terminator's re-arms once they have fallen back, the
  // mothership's once it has gone).
  const overlay = {
    timer: 0, lastTime: 0, terminatorArmed: true, motherArmed: true,
    /** @type {AudioScheduledSourceNode|null} the one playing now */
    source: null
  };

  /**
   * @returns {AudioContext|null} the context, if sound can be scheduled now
   */
  function readyContext() {
    // Same guard as the other recorded sounds (scream.js, stinger.js): never
    // creates the context from outside a gesture, re-resumes after a blur.
    if (SoundSystem.graphBuilt && !engineCtx.systems.sound.ensureAudioReady()) return null;
    const ctx = SoundSystem.context;
    if (!ctx || ctx.state !== 'running') return null;
    return ctx;
  }

  /**
   * @param {import('./samples.js').Sample|null} sample
   * @param {number} gain
   * @param {{maxDuration?: number, fadeOut?: number}} [trim] cut the recording short
   * @returns {AudioBufferSourceNode|null}
   */
  function fire(sample, gain, trim = {}) {
    const ctx = readyContext();
    if (!ctx || !sample) return null;
    const source = playOnce(ctx, sample, {
      gain,
      destination: SoundSystem.effectsGain,
      fadeIn: 0.005,
      fadeOut: trim.fadeOut || 0.4,
      maxDuration: trim.maxDuration,
      onEnd: () => { oneShots = oneShots.filter(n => n !== source); }
    });
    oneShots.push(source);
    return source;
  }

  /** @returns {void} */
  function playGlassCrack() {
    fire(SoundSystem.glassCrackSample, 1);
  }

  /**
   * @param {{priority?: boolean, gain?: number}} [options] `priority` skips
   *   the spacing and voice cap below -- for the set-piece blasts (the
   *   tanker) that must never be the one dropped because a meteor happened to
   *   land in the same fifth of a second.
   * @returns {void}
   */
  function playLargeExplosion(options = {}) {
    const ctx = readyContext();
    if (!ctx) return;
    if (!options.priority) {
      if (ctx.currentTime - explosionLastPlay < EXPLOSION_MIN_GAP) return;
      if (explosionVoices >= EXPLOSION_MAX_VOICES) return;
    }
    const source = fire(SoundSystem.largeExplosionSample, options.gain || 1);
    if (!source) return;
    explosionLastPlay = ctx.currentTime;
    explosionVoices++;
    source.addEventListener('ended', () => { explosionVoices = Math.max(0, explosionVoices - 1); }, { signal: engineCtx.signal });
  }

  /**
   * Starts or fades one looped track so it matches `want`. Does nothing while
   * the answer is unchanged, or before its recording has loaded (it then
   * simply starts on the first frame it can).
   * @param {'chase'} name
   * @param {boolean} want
   * @returns {void}
   */
  function drive(name, want) {
    const track = tracks[name];
    const def = LOOPS[name];
    if (want === !!track.source) return;
    const ctx = readyContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    if (want) {
      const sample = SoundSystem[def.sample];
      if (!sample) return;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(def.level, now + def.fadeIn);
      // Straight to the master bus: music and the town's background are not
      // effects, and should not dip with them.
      gain.connect(SoundSystem.masterGain);
      const source = ctx.createBufferSource();
      source.buffer = sample.buffer;
      source.loop = true;
      source.connect(gain);
      source.start(now);
      track.source = source;
      track.gain = gain;
      return;
    }

    const { source, gain } = track;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + def.fadeOut);
    source.onended = () => { try { gain.disconnect(); } catch { /* already disconnected */ } };
    source.stop(now + def.fadeOut + 0.05);
    track.source = null;
    track.gain = null;
  }

  /**
   * Starts playlist song `index`, or -- if that one has not loaded (a
   * missing file) -- the next one that has, so one missing song never
   * leaves the music silent.
   * @param {AudioContext} ctx
   * @param {number} index
   * @returns {void}
   */
  function startSong(ctx, index) {
    for (let k = 0; k < PLAYLIST.length; k++) {
      const i = (index + k) % PLAYLIST.length;
      const sample = SoundSystem[PLAYLIST[i]];
      if (!sample) continue;
      const source = ctx.createBufferSource();
      source.buffer = sample.buffer;
      source.connect(playlist.gain);
      source.start(ctx.currentTime);
      Object.assign(playlist, { index: i, source, startedAt: ctx.currentTime, duration: sample.buffer.duration });
      return;
    }
  }

  /**
   * How loud a recording is: its RMS over every 16th sample of its channels
   * (a few milliseconds for a song, once).
   * @param {AudioBuffer} buffer
   * @returns {number}
   */
  function loudness(buffer) {
    let sum = 0;
    let n = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i += 16) { sum += data[i] * data[i]; n++; }
    }
    return n ? Math.sqrt(sum / n) : 0;
  }

  /**
   * The city recording, per frame: started (looped) the first time it is
   * wanted and its file is in, then only faded in and out.
   * @param {AudioContext} ctx
   * @param {number} level what it should be at now
   * @returns {void}
   */
  function updateCityTrack(ctx, level) {
    const sample = SoundSystem.cityRecordingSample;
    if (!cityTrack.source) {
      if (level <= 0) return;
      if (!sample) {
        // 12 MB of WAV: fetched the first time it is chosen, not at start-up.
        if (!cityTrack.loading) {
          cityTrack.loading = true;
          loadSample(ctx, CITY_TRACK)
            .then(loaded => { SoundSystem.cityRecordingSample = loaded; })
            .catch(() => console.warn(`public${CITY_TRACK} not found; add it to hear it.`));
        }
        return;
      }
      // Levelled to the playlist's songs that are in (see the header).
      const songs = PLAYLIST.map(key => SoundSystem[key]).filter(Boolean);
      const own = loudness(sample.buffer);
      if (songs.length && own > 0) {
        const target = songs.reduce((a, song) => a + loudness(song.buffer), 0) / songs.length;
        cityTrack.trim = clampTo(target / own, 0.25, 4);
      }
      cityTrack.gain = ctx.createGain();
      cityTrack.gain.gain.value = 0;
      cityTrack.gain.connect(SoundSystem.masterGain);
      const source = ctx.createBufferSource();
      source.buffer = sample.buffer;
      source.loop = true;
      source.connect(cityTrack.gain);
      source.start(ctx.currentTime);
      cityTrack.source = source;
    }
    /** @type {GainNode} */ (cityTrack.gain).gain.setTargetAtTime(level * cityTrack.trim, ctx.currentTime, MUSIC_FADE);
  }

  /**
   * The playlist, per frame: once a song has played to its end, the next
   * one, from the top; and its level, dipped under an overlay. The city
   * recording too, whichever of the two is chosen fading in.
   * @param {AudioContext} ctx
   * @returns {void}
   */
  function updatePlaylist(ctx) {
    if (!playlist.gain) {
      playlist.gain = ctx.createGain();
      playlist.gain.gain.value = MUSIC.level;
      // Straight to the master bus, like every music track: not an effect.
      playlist.gain.connect(SoundSystem.masterGain);
    }
    // Silent under Smooth Criminal's song (engine/smoothCriminal.js), which
    // plays on its own; dipped under an overlay.
    // Off, too, with the panel's Music switch (engine/settings.js); the
    // playlist carries on underneath, so it comes back where it would be.
    const song = !!(engineCtx.systems.smoothCriminal && engineCtx.systems.smoothCriminal.songPlaying());
    const settings = engineCtx.systems.settings;
    const level = song || !settings.get('music') ? 0 : MUSIC.level * (overlay.timer > 0 ? MUSIC.dip : 1);
    const city = settings.choice('musicTrack') === 'city';
    updateCityTrack(ctx, city ? level : 0);
    // The playlist holds until the city recording is in and playing (its
    // first fetch takes a few seconds), so the change is a crossfade, never
    // a silence.
    playlist.gain.gain.setTargetAtTime(city && cityTrack.source ? 0 : level, ctx.currentTime, MUSIC_FADE);
    if (playlist.source) {
      if (ctx.currentTime - playlist.startedAt < playlist.duration) return;
      try { playlist.source.disconnect(); } catch { /* already */ }
      playlist.source = null;
      startSong(ctx, playlist.index + 1);
      return;
    }
    startSong(ctx, playlist.index);
  }

  /**
   * A few seconds of a recorded track over the playlist.
   * @param {import('./samples.js').Sample|null} sample
   * @returns {void}
   */
  function playOverlay(sample) {
    const ctx = readyContext();
    if (!ctx || !sample) return;
    const source = playOnce(ctx, sample, {
      gain: MUSIC.overlayLevel,
      destination: SoundSystem.masterGain,
      fadeIn: 0.05,
      fadeOut: MUSIC.overlayFade,
      maxDuration: MUSIC.overlaySeconds,
      onEnd: () => { oneShots = oneShots.filter(n => n !== source); }
    });
    if (!source) return;
    oneShots.push(source);
    overlay.source = source;
    overlay.timer = MUSIC.overlaySeconds;
  }

  /**
   * Per frame, from animate(): the playlist, the overlays and the duck
   * under them (see the header).
   * @returns {void}
   */
  function updateCues() {
    const ctx = SoundSystem.context;
    if (!ctx || ctx.state !== 'running' || !SoundSystem.masterGain) return;
    updatePlaylist(ctx);
    drive('chase', MUSIC.chaseTrack && !!(engineCtx.Chase && engineCtx.Chase.active));

    const { mothership, aliens, heroMode, smoothCriminal } = engineCtx.systems;
    // Nothing plays over Smooth Criminal's song (engine/smoothCriminal.js):
    // the Terminator and mothership tracks wait (they stay armed) until it ends.
    const songOn = !!(smoothCriminal && smoothCriminal.songPlaying());
    // One already playing when the song starts is cut.
    if (songOn && overlay.source) {
      try { overlay.source.stop(); } catch { /* already stopped */ }
      overlay.source = null;
      overlay.timer = 0;
    }
    const near = heroMode ? heroMode.terminatorDistance() : Infinity;
    if (overlay.terminatorArmed && near < MUSIC.terminatorOn && !songOn) {
      overlay.terminatorArmed = false;
      playOverlay(SoundSystem.terminatorMusicSample);
    } else if (!overlay.terminatorArmed && near > MUSIC.terminatorOff) {
      overlay.terminatorArmed = true;
    }
    const mother = !!(mothership && mothership.musicWanted());
    if (overlay.motherArmed && mother && !songOn) {
      overlay.motherArmed = false;
      playOverlay(SoundSystem.shipMusicSample);
    } else if (!mother) {
      overlay.motherArmed = true;
    }
    // Real time: the AudioContext's own clock, a frame's worth at a time.
    const now = ctx.currentTime;
    overlay.timer = Math.max(0, overlay.timer - (now - (overlay.lastTime || now)));
    overlay.lastTime = now;
    const hunters = !!(aliens && aliens.huntersPresent());
    SoundSystem.musicDuck = overlay.timer > 0 || hunters || songOn ? MUSIC.duck : 1;
  }

  /**
   * public/sounds/sonic-boom.mp3, for one shot of the plasma rifle.
   * @param {number} [gain]
   * @returns {void}
   */
  function playSonicBoom(gain = 1) {
    fire(SoundSystem.sonicBoomSample, gain);
  }

  /** @returns {void} */
  function stopAllCues() {
    for (const node of oneShots) {
      try { node.stop(); } catch { /* already stopped */ }
      try { node.disconnect(); } catch { /* already disconnected */ }
    }
    oneShots = [];
    explosionVoices = 0;
    SoundSystem.musicDuck = 1;
    if (playlist.source) {
      try { playlist.source.stop(); } catch { /* already stopped */ }
    }
    if (playlist.gain) {
      try { playlist.gain.disconnect(); } catch { /* already disconnected */ }
    }
    Object.assign(playlist, { index: 0, source: null, gain: null, startedAt: 0, duration: 0 });
    if (cityTrack.source) {
      try { cityTrack.source.stop(); } catch { /* already stopped */ }
    }
    if (cityTrack.gain) {
      try { cityTrack.gain.disconnect(); } catch { /* already disconnected */ }
    }
    Object.assign(cityTrack, { source: null, gain: null, trim: 1 });
    overlay.timer = 0;
    for (const track of Object.values(tracks)) {
      if (!track.source) continue;
      try { track.source.stop(); } catch { /* already stopped */ }
      try { track.gain.disconnect(); } catch { /* already disconnected */ }
      track.source = null;
      track.gain = null;
    }
  }

  /**
   * public/sounds/earthquake.wav when the ground splits open
   * (engine/chasm.js): the first EARTHQUAKE_SECONDS of it, faded out.
   * @returns {void}
   */
  function playEarthquake() {
    fire(SoundSystem.earthquakeSample, 1.3, { maxDuration: EARTHQUAKE_SECONDS, fadeOut: EARTHQUAKE_FADE });
  }

  /**
   * The two music tracks' levels now (the city one with its trim), for the
   * performance overlay and the checks.
   * @returns {{playlist: number, city: number}}
   */
  function musicLevels() {
    return {
      playlist: playlist.gain ? playlist.gain.gain.value : 0,
      city: cityTrack.gain ? cityTrack.gain.gain.value : 0
    };
  }

  return { playGlassCrack, playLargeExplosion, playEarthquake, playSonicBoom, updateCues, stopAllCues, musicLevels };
}
