// @ts-check

/**
 * ===========================================================================
 * SECTION S.12.1 — Creature sounds: the recipes
 * ===========================================================================
 * Every creature's one-shot sounds, procedural like the rest of sound/:
 * oscillators and the shared noise buffer through a filter or two, shaped by
 * envelopes. Each recipe plays into a pooled voice's input (creatures.js
 * owns the voices, their panners and the stealing) and returns how long it
 * lasts. `p.pitch` (around 1) shifts it per creature -- each alien its own --
 * and `p.size` (1 a person) lowers it: the giants are the deepest.
 *
 * Sources and the little envelope gains are made per sound (a Web Audio
 * source plays once); everything after the voice's input -- level, panner,
 * bus -- is pooled.
 */

/**
 * @typedef {Object} Kit
 * @property {AudioContext} ctx
 * @property {(type: OscillatorType, freq: number, t0: number, t1: number, dest: AudioNode) => OscillatorNode} osc
 * @property {(t0: number, t1: number, dest: AudioNode, rate?: number) => AudioBufferSourceNode} noise
 * @property {(type: BiquadFilterType, freq: number, q: number, dest: AudioNode) => BiquadFilterNode} filter
 * @property {(dest: AudioNode, t0: number, attack: number, peak: number, decay: number) => GainNode} env
 */

/**
 * @typedef {(k: Kit, out: AudioNode, t: number, p: {pitch: number, size: number}) => number} Recipe
 */

/**
 * A deep voice: two detuned saws through two formant band-passes, with a
 * growl (amplitude flutter) and a breath of noise -- a roar, a grunt, a
 * moan, depending on its numbers.
 * @param {Kit} k
 * @param {AudioNode} out
 * @param {number} t
 * @param {{f0: number, f1: number, formants: number[], seconds: number, growl: number, breath: number, peak: number}} v
 * @returns {number}
 */
function voice(k, out, t, v) {
  const end = t + v.seconds;
  const amp = k.env(out, t, Math.min(0.12, v.seconds * 0.2), v.peak, v.seconds * 0.8);
  // The growl: the voice's level fluttering.
  const flutter = k.ctx.createGain();
  flutter.gain.value = 1 - v.growl * 0.5;
  flutter.connect(amp);
  const lfoDepth = k.ctx.createGain();
  lfoDepth.gain.value = v.growl * 0.5;
  lfoDepth.connect(flutter.gain);
  k.osc('sine', 17 + Math.random() * 8, t, end, lfoDepth);
  const formantIn = k.ctx.createGain();
  for (const f of v.formants) {
    const bp = k.filter('bandpass', f, 2.5, flutter);
    formantIn.connect(bp);
  }
  for (const detune of [1, 1.013]) {
    const o = k.osc('sawtooth', v.f0 * detune, t, end, formantIn);
    o.frequency.setValueAtTime(v.f0 * detune, t);
    o.frequency.linearRampToValueAtTime(v.f1 * detune, end);
  }
  if (v.breath > 0) {
    const g = k.ctx.createGain();
    g.gain.value = v.breath;
    g.connect(flutter);
    k.noise(t, end, k.filter('lowpass', v.formants[0] * 1.5, 0.8, g));
  }
  return v.seconds;
}

/**
 * A footfall: a sub thump (lower and longer the bigger the walker) under a
 * short thud of noise; a metal one adds a clank and a hiss.
 * @param {Kit} k
 * @param {AudioNode} out
 * @param {number} t
 * @param {number} size
 * @param {number} level
 * @param {boolean} metal
 * @returns {number}
 */
function step(k, out, t, size, level, metal) {
  const s = Math.sqrt(size);
  const len = 0.12 + 0.12 * s;
  const thump = k.env(out, t, 0.008, level, len);
  const o = k.osc('sine', 150 / s, t, t + len + 0.05, thump);
  o.frequency.exponentialRampToValueAtTime(Math.max(22, 55 / s), t + len);
  k.noise(t, t + 0.12, k.filter('lowpass', 420 / s + 80, 0.7, k.env(out, t, 0.004, level * 0.7, 0.1)));
  if (metal) {
    const clank = k.env(out, t + 0.01, 0.002, level * 0.35, 0.22);
    for (const f of [1700, 2630, 3910]) k.osc('square', f / Math.sqrt(s), t, t + 0.25, k.filter('bandpass', f / Math.sqrt(s), 12, clank));
  }
  return len + 0.1;
}

/** @type {Record<string, Recipe>} */
export const RECIPES = {
  // ---- Aliens --------------------------------------------------------------
  // A warbling chirp: a sine frequency-modulated by a fast wobble, sliding,
  // with a click either side.
  alienChirp(k, out, t, p) {
    const len = 0.16 + Math.random() * 0.14;
    const f = 1000 * p.pitch;
    const amp = k.env(out, t, 0.01, 0.35, len);
    const carrier = k.osc('sine', f, t, t + len + 0.05, amp);
    const up = Math.random() < 0.5;
    carrier.frequency.setValueAtTime(f * (up ? 0.8 : 1.25), t);
    carrier.frequency.linearRampToValueAtTime(f * (up ? 1.3 : 0.75), t + len);
    const depth = k.ctx.createGain();
    depth.gain.value = 260 * p.pitch;
    depth.connect(carrier.frequency);
    k.osc('sine', 22 + Math.random() * 14, t, t + len + 0.05, depth);
    for (const at of [t, t + len * 0.6]) k.noise(at, at + 0.012, k.filter('highpass', 3000, 0.7, k.env(out, at, 0.001, 0.25, 0.01)));
    return len + 0.06;
  },
  // The crew's blaster (redone 2026-10-05: the old zap was lost past 20 m):
  // a bright "pew", a square and a sine diving together through a low-pass,
  // a crack of noise on the front, and a short ring after. Each alien's own
  // pitch, and a touch of chance, so no two shots sound alike.
  alienZap(k, out, t, p) {
    const f = p.pitch * (0.92 + Math.random() * 0.16);
    const len = 0.15 + Math.random() * 0.05;
    const lp = k.filter('lowpass', 5200, 1.4, k.env(out, t, 0.002, 0.55, len));
    lp.frequency.exponentialRampToValueAtTime(900, t + len);
    const sq = k.osc('square', 1650 * f, t, t + len + 0.05, lp);
    sq.frequency.exponentialRampToValueAtTime(240 * f, t + len);
    const si = k.osc('sine', 2400 * f, t, t + len + 0.05, k.env(out, t, 0.002, 0.4, len * 0.9));
    si.frequency.exponentialRampToValueAtTime(380 * f, t + len * 0.9);
    k.noise(t, t + 0.03, k.filter('bandpass', 6500, 1.1, k.env(out, t, 0.001, 0.35, 0.025)));
    const ring = k.osc('sine', 3100 * f, t + 0.02, t + 0.32, k.env(out, t + 0.02, 0.005, 0.07, 0.25));
    ring.frequency.exponentialRampToValueAtTime(2600 * f, t + 0.3);
    return len + 0.3;
  },
  // A ship's lance: heavier and lower than the crew's blaster. Two detuned
  // saws diving from a scream to a growl under a closing low-pass, a sub
  // thump, and a sizzle of noise that trails off.
  shipBolt(k, out, t) {
    const lp = k.filter('lowpass', 3200, 5, k.env(out, t, 0.004, 0.6, 0.5));
    lp.frequency.exponentialRampToValueAtTime(280, t + 0.45);
    for (const f of [640, 655]) {
      const s = k.osc('sawtooth', f, t, t + 0.55, lp);
      s.frequency.exponentialRampToValueAtTime(f / 9, t + 0.45);
    }
    const sub = k.osc('sine', 120, t, t + 0.4, k.env(out, t, 0.004, 0.65, 0.32));
    sub.frequency.exponentialRampToValueAtTime(38, t + 0.32);
    k.noise(t, t + 0.4, k.filter('highpass', 2600, 0.8, k.env(out, t, 0.003, 0.22, 0.35)));
    return 0.6;
  },
  // A shot landing on Roger: a hard, short crackle and a hiss, so a hit
  // is heard where it lands even through the shield.
  rayImpact(k, out, t) {
    k.noise(t, t + 0.12, k.filter('bandpass', 3800, 1.6, k.env(out, t, 0.001, 0.6, 0.1)), 1.6);
    k.noise(t + 0.03, t + 0.3, k.filter('highpass', 6000, 0.7, k.env(out, t + 0.03, 0.01, 0.2, 0.24)));
    const tick = k.osc('triangle', 900, t, t + 0.08, k.env(out, t, 0.001, 0.3, 0.06));
    tick.frequency.exponentialRampToValueAtTime(260, t + 0.06);
    return 0.32;
  },
  // A wet squelch: noise through a resonant low-pass sweeping down, a
  // falling blip, and a last chirp dying.
  alienDeath(k, out, t, p) {
    const lp = k.filter('lowpass', 1800, 9, k.env(out, t, 0.01, 0.6, 0.45));
    lp.frequency.exponentialRampToValueAtTime(180, t + 0.4);
    k.noise(t, t + 0.5, lp, 0.6);
    const blip = k.osc('sine', 320 * p.pitch, t, t + 0.4, k.env(out, t, 0.005, 0.35, 0.35));
    blip.frequency.exponentialRampToValueAtTime(50, t + 0.35);
    const last = k.osc('sine', 1300 * p.pitch, t + 0.1, t + 0.5, k.env(out, t + 0.1, 0.01, 0.15, 0.35));
    last.frequency.exponentialRampToValueAtTime(300, t + 0.45);
    return 0.55;
  },

  // ---- The giants ----------------------------------------------------------
  yetiRoar(k, out, t, p) {
    return voice(k, out, t, { f0: 95 / Math.sqrt(p.size) * p.pitch, f1: 62 / Math.sqrt(p.size) * p.pitch, formants: [380, 820], seconds: 1.7, growl: 0.8, breath: 0.6, peak: 0.9 });
  },
  yetiGrunt(k, out, t, p) {
    return voice(k, out, t, { f0: 110 / Math.sqrt(p.size) * p.pitch, f1: 80 / Math.sqrt(p.size) * p.pitch, formants: [420, 900], seconds: 0.5, growl: 0.6, breath: 0.5, peak: 0.8 });
  },
  yetiDeath(k, out, t, p) {
    const len = voice(k, out, t, { f0: 105 / Math.sqrt(p.size) * p.pitch, f1: 35 / Math.sqrt(p.size), formants: [360, 760], seconds: 2.4, growl: 1, breath: 0.7, peak: 1 });
    step(k, out, t + 1.6, p.size * 2, 1, false);
    return len + 0.4;
  },
  trexRoar(k, out, t, p) {
    const s = Math.sqrt(p.size);
    const len = voice(k, out, t, { f0: 70 / s * p.pitch, f1: 44 / s * p.pitch, formants: [260, 640, 1400], seconds: 2.4, growl: 0.9, breath: 0.9, peak: 1 });
    return len;
  },
  // Hurt: a short screech with a grind in it.
  trexHurt(k, out, t, p) {
    return voice(k, out, t, { f0: 210 * p.pitch, f1: 130 * p.pitch, formants: [900, 1700], seconds: 0.6, growl: 0.7, breath: 0.4, peak: 0.8 });
  },
  trexDeath(k, out, t, p) {
    const s = Math.sqrt(p.size);
    voice(k, out, t, { f0: 80 / s, f1: 25 / s, formants: [240, 600], seconds: 3, growl: 1, breath: 1, peak: 1 });
    step(k, out, t + 1.5, p.size * 2, 1, true);
    return 3.2;
  },
  stomp(k, out, t, p) {
    return step(k, out, t, p.size, 1, false);
  },
  metalStomp(k, out, t, p) {
    return step(k, out, t, p.size, 1, true);
  },
  // A servo: a whining saw sliding up through a narrow band.
  servo(k, out, t, p) {
    const len = 0.3 + Math.random() * 0.2;
    const amp = k.env(out, t, 0.04, 0.22, len);
    const o = k.osc('sawtooth', 420 * p.pitch, t, t + len + 0.05, k.filter('bandpass', 1400 * p.pitch, 5, amp));
    o.frequency.linearRampToValueAtTime((Math.random() < 0.5 ? 900 : 650) * p.pitch, t + len);
    return len + 0.05;
  },
  // Hydraulics: a hiss of air let out.
  hydraulic(k, out, t, p) {
    const len = 0.45;
    k.noise(t, t + len, k.filter('bandpass', 3400 * p.pitch, 1.4, k.env(out, t, 0.02, 0.35, len)));
    return len;
  },
  // Ice crackling over something frozen: a scatter of tiny high ticks.
  iceCrackle(k, out, t, p) {
    const hp = k.filter('highpass', 2600 * p.pitch, 0.8, out);
    for (let i = 0; i < 9; i++) {
      const at = t + Math.random() * 0.45;
      k.noise(at, at + 0.015, k.env(hp, at, 0.001, 0.25 + Math.random() * 0.25, 0.012));
    }
    k.osc('sine', 4200 * p.pitch, t, t + 0.3, k.env(out, t, 0.005, 0.06, 0.25));
    return 0.5;
  },
  // Where flame meets frost: a crack and a burst of hiss.
  clashBurst(k, out, t, p) {
    const bp = k.filter('bandpass', 5200, 0.9, k.env(out, t, 0.004, 0.6, 0.55));
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.5);
    k.noise(t, t + 0.6, bp);
    const thud = k.osc('sine', 90 * p.pitch, t, t + 0.35, k.env(out, t, 0.003, 0.5, 0.3));
    thud.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    return 0.6;
  },

  // ---- Hank Granite --------------------------------------------------------
  // His voice: a short, gruff "hah!" with a man's formants.
  hankGrunt(k, out, t, p) {
    return voice(k, out, t, { f0: 135 * p.pitch, f1: 105 * p.pitch, formants: [620, 1150], seconds: 0.28, growl: 0.4, breath: 0.6, peak: 0.7 });
  },
  // A punch landing: a body thump and a slap.
  punch(k, out, t, p) {
    const o = k.osc('sine', 120 * p.pitch, t, t + 0.25, k.env(out, t, 0.002, 0.9, 0.2));
    o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    k.noise(t, t + 0.06, k.filter('highpass', 1400, 0.8, k.env(out, t, 0.001, 0.7, 0.05)));
    return 0.3;
  },
  // His entrance: two low hits, a film's "dun, dun".
  hankArrive(k, out, t, p) {
    for (const [at, f] of [[0, 55], [0.42, 49]]) {
      const amp = k.env(out, t + at, 0.01, 0.7, 0.55);
      k.osc('sawtooth', f * p.pitch, t + at, t + at + 0.6, k.filter('lowpass', 420, 1, amp));
      k.osc('sine', f * 0.5 * p.pitch, t + at, t + at + 0.6, amp);
    }
    return 1.1;
  },
  footstep(k, out, t, p) {
    return step(k, out, t, p.size, 0.45, false);
  },
  // A puff of dust: air rushing out.
  poof(k, out, t) {
    const lp = k.filter('lowpass', 2400, 0.7, k.env(out, t, 0.02, 0.6, 0.6));
    lp.frequency.exponentialRampToValueAtTime(300, t + 0.6);
    k.noise(t, t + 0.7, lp);
    return 0.7;
  },

  // ---- The Terminators -----------------------------------------------------
  // Booting up: a rising square sweep and two beeps.
  boot(k, out, t, p) {
    const o = k.osc('square', 180 * p.pitch, t, t + 0.6, k.filter('lowpass', 2400, 1, k.env(out, t, 0.02, 0.18, 0.55)));
    o.frequency.exponentialRampToValueAtTime(1300 * p.pitch, t + 0.55);
    for (const at of [0.65, 0.8]) k.osc('sine', 2100, t + at, t + at + 0.07, k.env(out, t + at, 0.003, 0.2, 0.06));
    return 0.95;
  },
  // A machine's step: a light metal footfall.
  robotStep(k, out, t, p) {
    return step(k, out, t, p.size, 0.45, true);
  },
  // A hit on a metal chassis: a clang ringing out.
  robotHit(k, out, t, p) {
    const amp = k.env(out, t, 0.002, 0.5, 0.5);
    for (const f of [520, 1310, 2290]) k.osc('triangle', f * p.pitch, t, t + 0.55, k.filter('bandpass', f * p.pitch, 15, amp));
    k.noise(t, t + 0.04, k.filter('highpass', 2500, 0.7, k.env(out, t, 0.001, 0.4, 0.03)));
    return 0.55;
  },
  // Powering down: a falling saw and a crackle of shorting circuits.
  powerDown(k, out, t, p) {
    const o = k.osc('sawtooth', 900 * p.pitch, t, t + 1.2, k.filter('lowpass', 1800, 2, k.env(out, t, 0.01, 0.35, 1.1)));
    o.frequency.exponentialRampToValueAtTime(30, t + 1.1);
    const hp = k.filter('highpass', 3000, 0.7, out);
    for (let i = 0; i < 7; i++) {
      const at = t + Math.random() * 0.8;
      k.noise(at, at + 0.03, k.env(hp, at, 0.001, 0.35, 0.025));
    }
    return 1.2;
  },

  // ---- Patient Zero and the clones -----------------------------------------
  groan(k, out, t, p) {
    const len = 0.8 + Math.random() * 0.5;
    const f = 105 * p.pitch;
    return voice(k, out, t, { f0: f, f1: f * (0.75 + Math.random() * 0.2), formants: [480, 1050], seconds: len, growl: 0.5, breath: 0.4, peak: 0.45 });
  },
  snarl(k, out, t, p) {
    return voice(k, out, t, { f0: 170 * p.pitch, f1: 140 * p.pitch, formants: [850, 1600], seconds: 0.35, growl: 0.9, breath: 0.8, peak: 0.6 });
  },
  zombieDeath(k, out, t, p) {
    voice(k, out, t, { f0: 120 * p.pitch, f1: 50, formants: [450, 900], seconds: 0.7, growl: 0.4, breath: 0.5, peak: 0.45 });
    const lp = k.filter('lowpass', 1200, 7, k.env(out, t + 0.1, 0.01, 0.4, 0.35));
    lp.frequency.exponentialRampToValueAtTime(160, t + 0.45);
    k.noise(t + 0.1, t + 0.5, lp, 0.5);
    return 0.8;
  },

  // ---- Captain Spotless ----------------------------------------------------
  // A chime: a bright bell triad, ringing out.
  chime(k, out, t, p) {
    [523, 659, 784, 1047].forEach((f, i) => k.osc('sine', f * p.pitch, t + i * 0.07, t + 1.6, k.env(out, t + i * 0.07, 0.005, 0.18, 1.4)));
    return 1.7;
  },
  // A sparkle: quick high pings, as something is disintegrated.
  sparkle(k, out, t, p) {
    for (let i = 0; i < 6; i++) {
      const at = t + i * 0.045;
      k.osc('sine', (2200 + Math.random() * 2400) * p.pitch, at, at + 0.25, k.env(out, at, 0.002, 0.14, 0.2));
    }
    return 0.5;
  },

  // ---- The samurai (Landing Support) ---------------------------------------
  // The battle shout: a man's open "HAAA-i!", rising then cut off, with a
  // hard breath on the front.
  samuraiShout(k, out, t, p) {
    const len = 0.42 + Math.random() * 0.2;
    const f = 150 * p.pitch;
    voice(k, out, t, { f0: f * 0.9, f1: f * 1.25, formants: [720, 1180, 2600], seconds: len, growl: 0.25, breath: 0.7, peak: 0.75 });
    k.noise(t, t + 0.06, k.filter('bandpass', 1800, 1.2, k.env(out, t, 0.004, 0.35, 0.05)));
    return len + 0.05;
  },
  // A katana cutting the air: a narrow band of noise swept down fast.
  katanaSwish(k, out, t, p) {
    const bp = k.filter('bandpass', 5200 * p.pitch, 3, k.env(out, t, 0.03, 0.42, 0.16));
    bp.frequency.exponentialRampToValueAtTime(900 * p.pitch, t + 0.19);
    k.noise(t, t + 0.22, bp, 1.3);
    return 0.24;
  },
  // The cut landing: a thick chop, a body thump, and a short steel ring.
  katanaHit(k, out, t, p) {
    const thump = k.osc('sine', 140 * p.pitch, t, t + 0.2, k.env(out, t, 0.002, 0.7, 0.16));
    thump.frequency.exponentialRampToValueAtTime(45, t + 0.16);
    k.noise(t, t + 0.08, k.filter('bandpass', 2400, 1, k.env(out, t, 0.001, 0.6, 0.07)));
    const ring = k.env(out, t + 0.005, 0.002, 0.16, 0.45);
    for (const f of [2210, 3370, 5030]) k.osc('sine', f * p.pitch, t, t + 0.5, ring);
    return 0.5;
  },
  // Struck down by Roger: a cut-off grunt and the armour hitting the road.
  samuraiDeath(k, out, t, p) {
    voice(k, out, t, { f0: 140 * p.pitch, f1: 70 * p.pitch, formants: [560, 1050], seconds: 0.5, growl: 0.5, breath: 0.6, peak: 0.6 });
    step(k, out, t + 0.55, 1.4, 0.8, true);
    return 0.9;
  }
};
