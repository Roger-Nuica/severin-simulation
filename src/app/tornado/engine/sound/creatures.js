// @ts-check
import { createShortNoiseBuffer } from './thunder.js';
import { RECIPES } from './creatures/recipes.js';

/**
 * ===========================================================================
 * SECTION S.12 — Creature sounds
 * ===========================================================================
 * The voices, steps, attacks, hurts and deaths of the game's creatures --
 * the aliens, the cyber Yeti and T-Rex, Hank Granite, the Terminators,
 * Patient Zero and its clones, Captain Spotless, Landing Support's samurai
 * -- placed where they are (positional), procedural like the rest of
 * sound/ (the recipes are in creatures/recipes.js). Michael's song and the
 * existing sounds (the ships, Roger's pursuers, the cows, the screams) are
 * left as they were.
 *
 *  - play(kind, at, options): a one-shot at a point. Into one of
 *    CREATURE.voices pooled voices, each a level and a PannerNode
 *    (equal-power, inverse distance) made once. A sound farther than its
 *    hearing range is not played at all; with every voice busy, the
 *    quietest one at the listener is stopped for it -- or, if the new one
 *    would be quieter still, the new one is dropped. Each kind has a
 *    minimum gap (GAP), so a swarm -- fifty clones, a crowd of aliens --
 *    shares a few voices rather than one each.
 *  - loop(id, at, level): a held sound, every frame it should be heard --
 *    the aliens' hover hum, the abduction beam, the Yeti's cold gun, the
 *    T-Rex's flame, the giants' clash, Captain Spotless's shimmer. One graph
 *    each, built the first time and left running silent; fades out when
 *    nobody asks for it.
 *  - `size` (1 a person) makes a creature lower and its hearing range
 *    longer: the giants are deepest and heard from farthest.
 *
 * The listener follows the camera every frame. The whole lot goes through
 * one bus, which the panel's Creature sounds switch (engine/settings.js
 * creatures) fades out. Built on first use once the AudioContext is
 * running -- only ever after a gesture (sound/index.js ensureAudioReady).
 */

export const CREATURE = {
  voices: 18,
  busLevel: 0.85,
  refDistance: 7,          // metres, for size 1: full level inside it
  hearing: 26,             // refDistances: beyond, a sound is not played
  loopFade: 0.15           // seconds, time constant of a loop's level
};

// Seconds between two sounds of one kind, wherever they come from.
const GAP = {
  alienChirp: 0.18, alienZap: 0.05, alienDeath: 0.08, shipBolt: 0.08, rayImpact: 0.07,
  groan: 0.35, snarl: 0.2, zombieDeath: 0.12,
  footstep: 0.12, robotStep: 0.1, robotHit: 0.08, boot: 0.15, servo: 0.4, iceCrackle: 0.15, sparkle: 0.2, punch: 0.1,
  samuraiShout: 0.7, katanaSwish: 0.06, katanaHit: 0.07, samuraiDeath: 0.15
};

/** @typedef {{kind: string, at: {x: number, y?: number, z: number}, level: number}} Request */

/**
 * @param {Object} engineCtx
 * @returns {{
 *   play: (kind: string, at: {x: number, y?: number, z: number}, options?: {pitch?: number, size?: number, gain?: number, shake?: number}) => number,
 *   loop: (id: string, at: {x: number, y?: number, z: number}, level: number, param?: number) => void,
 *   pitchOf: (who: object) => number,
 *   voicesInUse: () => number,
 *   updateCreatureSounds: () => void,
 *   resetCreatureSounds: () => void,
 *   disposeCreatureSounds: () => void
 * }}
 */
export function createCreatureSoundSystem(engineCtx) {
  /**
   * @typedef {Object} Voice
   * @property {GainNode} input
   * @property {GainNode} level
   * @property {PannerNode} panner
   * @property {AudioScheduledSourceNode[]} sources
   * @property {number} until context time it is busy until
   * @property {number} loudness its level at the listener when it started
   */
  /**
   * @typedef {Object} Loop
   * @property {GainNode} level
   * @property {PannerNode} panner
   * @property {AudioScheduledSourceNode[]} sources
   * @property {(param: number) => void} tick per frame, while heard
   * @property {boolean} asked this frame
   */
  /** @type {{ctx: AudioContext, bus: GainNode, noise: AudioBuffer, voices: Voice[], loops: Map<string, Loop>}|null} */
  let graph = null;
  /** @type {Map<string, number>} */
  const lastPlayed = new Map();
  /** @type {WeakMap<object, number>} */
  const pitches = new WeakMap();
  /** @type {AudioScheduledSourceNode[]} where the kit collects a sound's sources */
  let collecting = [];

  /** @returns {typeof graph} */
  function ensureGraph() {
    const SoundSystem = engineCtx.SoundSystem;
    if (!SoundSystem || !SoundSystem.graphBuilt) return null;
    if (!engineCtx.systems.sound.ensureAudioReady()) return null;
    const ctx = SoundSystem.context;
    if (!ctx || ctx.state !== 'running' || !SoundSystem.effectsGain) return null;
    if (graph && graph.ctx === ctx) return graph;
    const bus = ctx.createGain();
    bus.gain.value = CREATURE.busLevel;
    bus.connect(SoundSystem.effectsGain);
    /** @type {Voice[]} */
    const voices = [];
    for (let i = 0; i < CREATURE.voices; i++) {
      const input = ctx.createGain();
      const level = ctx.createGain();
      const panner = makePanner(ctx, 1);
      input.connect(level);
      level.connect(panner);
      panner.connect(bus);
      voices.push({ input, level, panner, sources: [], until: 0, loudness: 0 });
    }
    graph = { ctx, bus, noise: createShortNoiseBuffer(ctx, 2), voices, loops: new Map() };
    return graph;
  }

  /**
   * @param {AudioContext} ctx
   * @param {number} size
   * @returns {PannerNode}
   */
  function makePanner(ctx, size) {
    const panner = ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = CREATURE.refDistance * size;
    panner.rolloffFactor = 1;
    panner.maxDistance = 10000;
    return panner;
  }

  /**
   * @param {PannerNode} panner
   * @param {{x: number, y?: number, z: number}} at
   * @returns {void}
   */
  function place(panner, at) {
    if (panner.positionX) {
      panner.positionX.value = at.x;
      panner.positionY.value = at.y || 1;
      panner.positionZ.value = at.z;
    } else {
      panner.setPosition(at.x, at.y || 1, at.z);
    }
  }

  /**
   * The recipes' kit: sources started and stopped on time, collected so a
   * stolen voice can cut them.
   * @param {AudioContext} ctx
   * @param {AudioBuffer} noise
   * @returns {import('./creatures/recipes.js').Kit}
   */
  function kit(ctx, noise) {
    return {
      ctx,
      osc(type, freq, t0, t1, dest) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        o.connect(dest);
        o.start(t0);
        o.stop(t1);
        collecting.push(o);
        return o;
      },
      noise(t0, t1, dest, rate = 1) {
        const src = ctx.createBufferSource();
        src.buffer = noise;
        src.loop = true;
        src.playbackRate.value = rate;
        src.connect(dest);
        src.start(t0, Math.random() * 1.5);
        src.stop(t1);
        collecting.push(src);
        return src;
      },
      filter(type, freq, q, dest) {
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q;
        f.connect(dest);
        return f;
      },
      env(dest, t0, attack, peak, decay) {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
        g.connect(dest);
        return g;
      }
    };
  }

  /**
   * How loud something at `at` would be at the listener (the camera), and
   * how far away it is.
   * @param {{x: number, y?: number, z: number}} at
   * @param {number} size
   * @returns {{loudness: number, near: number, heard: boolean}}
   */
  function atListener(at, size) {
    const cam = engineCtx.Sim.three.camera.position;
    const d = Math.hypot(cam.x - at.x, cam.y - (at.y || 1), cam.z - at.z);
    const ref = CREATURE.refDistance * size;
    const range = ref * CREATURE.hearing;
    return { loudness: ref / (ref + Math.max(0, d - ref)), near: Math.max(0, 1 - d / range), heard: d < range };
  }

  /**
   * A one-shot at a point.
   * @param {string} kind a recipe in creatures/recipes.js
   * @param {{x: number, y?: number, z: number}} at
   * @param {{pitch?: number, size?: number, gain?: number, shake?: number}} [options]
   *   shake: camera shake at full nearness (the giants' roars and steps)
   * @returns {number} how near it was, 0..1 (0: not played)
   */
  function play(kind, at, options = {}) {
    const recipe = RECIPES[kind];
    if (!recipe || !engineCtx.systems.settings.get('creatures')) return 0;
    const size = options.size || 1;
    const where = atListener(at, size);
    if (!where.heard) return 0;
    const g = ensureGraph();
    if (!g) return 0;
    const now = g.ctx.currentTime;
    const gap = GAP[kind] || 0;
    if (gap && now - (lastPlayed.get(kind) ?? -1) < gap) return 0;
    const gain = options.gain ?? 1;
    const loudness = where.loudness * gain;
    // A free voice, or the quietest one if it is quieter than this.
    let voice = null;
    let quietest = null;
    for (const v of g.voices) {
      if (v.until <= now) { voice = v; break; }
      if (!quietest || v.loudness < quietest.loudness) quietest = v;
    }
    if (!voice) {
      if (!quietest || quietest.loudness >= loudness) return 0;
      voice = quietest;
      for (const s of voice.sources) {
        try { s.stop(); } catch { /* already */ }
      }
    }
    lastPlayed.set(kind, now);
    voice.panner.refDistance = CREATURE.refDistance * size;
    place(voice.panner, at);
    voice.level.gain.setValueAtTime(gain, now);
    collecting = [];
    const length = recipe(kit(g.ctx, g.noise), voice.input, now + 0.01, { pitch: options.pitch || 1, size });
    voice.sources = collecting;
    voice.until = now + length + 0.05;
    voice.loudness = loudness;
    if (options.shake && where.near > 0.05) engineCtx.systems.gamefeel.addShake(options.shake * where.near, 0.3);
    return where.near;
  }

  // ---------------------------------------------------------------------
  // The loops
  // ---------------------------------------------------------------------

  /**
   * Builds a loop's graph once.
   * @param {string} id
   * @returns {Loop|null}
   */
  function buildLoop(id) {
    const g = /** @type {NonNullable<typeof graph>} */ (graph);
    const ctx = g.ctx;
    collecting = [];
    const k = kit(ctx, g.noise);
    const level = ctx.createGain();
    level.gain.value = 0;
    const size = id === 'yetiGun' || id === 'trexFlame' || id === 'clash' ? 4 : id === 'spotless' ? 6 : id === 'fireGun' ? 1.6 : 1;
    const panner = makePanner(ctx, size);
    level.connect(panner);
    panner.connect(g.bus);
    const forever = ctx.currentTime + 1e6;
    const t = ctx.currentTime;
    /** @type {(param: number) => void} */
    let tick = () => {};
    /**
     * A gain held at `value`, into the loop.
     * @param {number} value
     * @returns {GainNode}
     */
    const part = (value) => {
      const gn = ctx.createGain();
      gn.gain.value = value;
      gn.connect(level);
      return gn;
    };
    if (id === 'alienHover') {
      // A small hum: two close sines beating, and a slow wobble.
      const hum = part(0.22);
      for (const f of [176, 179.5]) k.osc('sine', f, t, forever, hum);
      k.osc('triangle', 352, t, forever, part(0.05));
    } else if (id === 'beam') {
      // The abduction beam: a deep hum, wobbling through a filter, and a
      // high shimmer.
      const lp = k.filter('lowpass', 500, 4, part(0.35));
      k.osc('sawtooth', 136, t, forever, lp);
      k.osc('sine', 68, t, forever, part(0.3));
      const wobble = ctx.createGain();
      wobble.gain.value = 260;
      wobble.connect(lp.frequency);
      k.osc('sine', 5, t, forever, wobble);
      const shimmer = part(0.05);
      k.osc('sine', 1760, t, forever, shimmer);
    } else if (id === 'yetiGun') {
      // The cold gun: airy, icy, crackling -- high hiss, a crackle that
      // stutters, a thin whistle.
      k.noise(t, forever, k.filter('highpass', 2600, 0.6, part(0.35)));
      const crackle = part(0);
      k.noise(t, forever, k.filter('bandpass', 6800, 1.2, crackle), 1.3);
      k.osc('sine', 3150, t, forever, part(0.03));
      tick = () => crackle.gain.setTargetAtTime(Math.random() < 0.35 ? 0.5 : 0.05, ctx.currentTime, 0.015);
    } else if (id === 'trexFlame' || id === 'fireGun') {
      // The flame: a roaring whoosh low down, a rumble, a crackle -- the
      // opposite end of the spectrum from the cold gun. Roger's Fire Gun
      // is the same fire, so the same sound, from his own loop.
      k.noise(t, forever, k.filter('lowpass', 800, 0.8, part(0.7)), 0.7);
      k.noise(t, forever, k.filter('bandpass', 180, 1, part(0.6)), 0.5);
      const crackle = part(0);
      k.noise(t, forever, k.filter('bandpass', 2000, 1.5, crackle));
      tick = () => crackle.gain.setTargetAtTime(Math.random() < 0.3 ? 0.35 : 0.04, ctx.currentTime, 0.02);
    } else if (id === 'clash') {
      // Flame against frost: steam hissing, fat sizzling, a low roar, and a
      // pressure tone that climbs over the 15 s (param 0..1).
      k.noise(t, forever, k.filter('highpass', 3800, 0.7, part(0.3)));
      const sizzle = part(0);
      k.noise(t, forever, k.filter('bandpass', 1500, 1.2, sizzle));
      k.noise(t, forever, k.filter('lowpass', 220, 0.8, part(0.45)), 0.6);
      const pressure = part(0);
      const tone = k.osc('sawtooth', 70, t, forever, k.filter('lowpass', 700, 2, pressure));
      tick = (param) => {
        const now = ctx.currentTime;
        sizzle.gain.setTargetAtTime(Math.random() < 0.4 ? 0.4 : 0.08, now, 0.025);
        tone.frequency.setTargetAtTime(70 + 120 * param, now, 0.2);
        pressure.gain.setTargetAtTime(0.05 + 0.25 * param, now, 0.2);
      };
    } else if (id === 'spotless') {
      // A giant of light: a held major chord, slowly breathing, and a
      // sparkle of air over it.
      const pad = part(0.07);
      for (const f of [262, 330, 392, 523]) k.osc('sine', f, t, forever, pad);
      const breathe = ctx.createGain();
      breathe.gain.value = 0.04;
      breathe.connect(pad.gain);
      k.osc('sine', 0.3, t, forever, breathe);
      k.noise(t, forever, k.filter('highpass', 7000, 0.7, part(0.06)));
    } else {
      return null;
    }
    const loopDef = { level, panner, sources: collecting, tick, asked: false };
    collecting = [];
    g.loops.set(id, loopDef);
    return loopDef;
  }

  /**
   * A held sound, heard this frame at `at` at `level` (0..1).
   * @param {string} id
   * @param {{x: number, y?: number, z: number}} at
   * @param {number} level
   * @param {number} [param] what the loop's own shape follows (the clash's pressure)
   * @returns {void}
   */
  function loop(id, at, level, param = 0) {
    if (level <= 0 || !engineCtx.systems.settings.get('creatures')) return;
    const g = ensureGraph();
    if (!g) return;
    const l = g.loops.get(id) || buildLoop(id);
    if (!l) return;
    // Out of hearing: as good as silent.
    if (!atListener(at, l.panner.refDistance / CREATURE.refDistance).heard) return;
    l.asked = true;
    place(l.panner, at);
    l.level.gain.setTargetAtTime(level, g.ctx.currentTime, CREATURE.loopFade);
    l.tick(param);
  }

  /**
   * Per frame: the listener on the camera, the loops nobody asked for faded
   * out, and the bus by the panel's switch.
   * @returns {void}
   */
  function updateCreatureSounds() {
    if (!graph) return;
    const ctx = graph.ctx;
    const cam = engineCtx.Sim.three.camera;
    const listener = ctx.listener;
    const p = cam.position;
    const e = cam.matrixWorld.elements;
    // The camera looks down its -z; its up is its +y.
    const fx = -e[8]; const fy = -e[9]; const fz = -e[10];
    const ux = e[4]; const uy = e[5]; const uz = e[6];
    if (listener.positionX) {
      listener.positionX.value = p.x; listener.positionY.value = p.y; listener.positionZ.value = p.z;
      listener.forwardX.value = fx; listener.forwardY.value = fy; listener.forwardZ.value = fz;
      listener.upX.value = ux; listener.upY.value = uy; listener.upZ.value = uz;
    } else {
      listener.setPosition(p.x, p.y, p.z);
      listener.setOrientation(fx, fy, fz, ux, uy, uz);
    }
    for (const l of graph.loops.values()) {
      if (!l.asked) l.level.gain.setTargetAtTime(0, ctx.currentTime, CREATURE.loopFade);
      l.asked = false;
    }
    const on = engineCtx.systems.settings.get('creatures');
    graph.bus.gain.setTargetAtTime(on ? CREATURE.busLevel : 0, ctx.currentTime, 0.1);
  }

  /**
   * Each creature its own pitch, kept for as long as it lives.
   * @param {object} who
   * @returns {number}
   */
  function pitchOf(who) {
    let p = pitches.get(who);
    if (p === undefined) {
      p = 0.82 + Math.random() * 0.4;
      pitches.set(who, p);
    }
    return p;
  }

  /** @returns {number} */
  function voicesInUse() {
    if (!graph) return 0;
    const now = graph.ctx.currentTime;
    return graph.voices.filter(v => v.until > now).length;
  }

  /** @returns {void} */
  function resetCreatureSounds() {
    if (!graph) return;
    for (const v of graph.voices) {
      for (const s of v.sources) {
        try { s.stop(); } catch { /* already */ }
      }
      v.sources = [];
      v.until = 0;
    }
    for (const l of graph.loops.values()) l.level.gain.setValueAtTime(0, graph.ctx.currentTime);
    lastPlayed.clear();
  }

  /** @returns {void} */
  function disposeCreatureSounds() {
    if (!graph) return;
    resetCreatureSounds();
    for (const l of graph.loops.values()) {
      for (const s of l.sources) {
        try { s.stop(); } catch { /* already */ }
      }
    }
    try { graph.bus.disconnect(); } catch { /* already */ }
    graph = null;
  }

  return { play, loop, pitchOf, voicesInUse, updateCreatureSounds, resetCreatureSounds, disposeCreatureSounds };
}
