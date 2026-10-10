// @ts-check

/**
 * ===========================================================================
 * SECTION NK — The host's sky on the guest's screen
 * ===========================================================================
 * The host's snapshot `env` row [running, stormRamp, intensity, wind, radius,
 * daylight, timeScale] sets the few numbers the guest's own clouds, rain,
 * wind and storm sound already read: `Sim.state.stormRamp`,
 * `Sim.params.intensity / windSpeed / radius` and the day or night level
 * (`DayNight.follow`, dayNight.js). Nothing new is drawn. `Sim.state.running`
 * is never written (it would start the guest's own run); `env.running` is
 * ignored. Time Slow arrives as `timeScale < 1`: only the colour-drained
 * grade (`Post.bulletTime`) and the muffled sound, never `GameFeel`, so the
 * guest is not slowed (the full shared slow is Subtask 17). No camera shake.
 * The guest's own panel values are saved when mirroring starts and restored
 * by `release` (session end, a new welcome), so a later single-player run
 * starts from them (R-047).
 */

/** Easing time constants, seconds: the ramp is already eased on the host, the rest can jump. */
export const SKY_TAU = { ramp: 0.25, params: 0.6, daylight: 0.3 };
/** Below this host time scale the guest shows the Time Slow look. */
export const SLOW_LOOK_BELOW = 0.9;
/** The muffle source key of the guest's Time Slow look. */
export const MUFFLE_KEY = 'net';

/**
 * @typedef {Object} EnvTargets
 * @property {number} ramp 0..1
 * @property {number} intensity 0..10
 * @property {number} wind 0..1000
 * @property {number} radius 0..1000
 * @property {number} daylight 0..1
 * @property {number} timeScale 0..10
 */

/**
 * The row as targets; null for anything that is not a full finite row.
 * `running` (index 0) is deliberately dropped.
 * @param {ReadonlyArray<number>|null|undefined} row
 * @returns {EnvTargets|null}
 */
export function readEnv(row) {
  if (!Array.isArray(row) || row.length < 7) return null;
  for (let i = 1; i < 7; i++) if (!Number.isFinite(row[i])) return null;
  const c = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  return {
    ramp: c(row[1], 0, 1), intensity: c(row[2], 0, 10), wind: c(row[3], 0, 1000),
    radius: c(row[4], 0, 1000), daylight: c(row[5], 0, 1), timeScale: c(row[6], 0, 10)
  };
}

/**
 * Frame-rate independent ease of `cur` towards `target`.
 * @param {number} cur @param {number} target @param {number} dt seconds @param {number} tau seconds
 * @returns {number}
 */
export function easeValue(cur, target, dt, tau) {
  if (!(dt > 0)) return cur;
  if (!(tau > 0)) return target;
  const next = cur + (target - cur) * (1 - Math.exp(-dt / tau));
  return Math.abs(target - next) < 1e-4 ? target : next;
}

/**
 * The linear progress whose smoothstep is `k` (dayNight.js eases progress
 * and shows its smoothstep), so a followed daylight hands back seamlessly.
 * @param {number} k 0..1
 * @returns {number}
 */
export function unsmooth(k) {
  const c = Math.min(1, Math.max(0, k));
  return 0.5 - Math.sin(Math.asin(1 - 2 * c) / 3);
}

/**
 * @param {number} timeScale the host's
 * @returns {boolean} whether the guest shows the Time Slow look
 */
export const slowLook = (timeScale) => timeScale < SLOW_LOOK_BELOW;

/**
 * @param {Object} ctx
 * @returns {{
 *   feed: (row: ReadonlyArray<number>|null|undefined) => void,
 *   apply: (rawDt: number) => void,
 *   release: () => void,
 *   active: () => boolean
 * }}
 */
export function createSky(ctx) {
  const { Sim } = ctx;
  /** @type {EnvTargets|null} */
  let target = null;
  /** The mirrored state, per instance. @type {null|{ramp:number,intensity:number,wind:number,radius:number,daylight:number}} */
  let shown = null;
  /** The guest's own values, put back by `release`. @type {null|{intensity:number,windSpeed:number,radius:number,day:boolean}} */
  let saved = null;
  let slowOn = false;

  /**
   * @param {ReadonlyArray<number>|null|undefined} row
   * @returns {void}
   */
  function feed(row) {
    const t = readEnv(row);
    if (t) target = t;
  }

  /**
   * @param {boolean} on
   * @returns {void}
   */
  function setSlowLook(on) {
    if (on === slowOn) return;
    slowOn = on;
    const post = ctx.systems.post && ctx.systems.post.Post;
    if (post) post.bulletTime = on ? 1 : 0;
    if (ctx.systems.sound) ctx.systems.sound.setMuffle(on ? 1 : 0, MUFFLE_KEY);
  }

  /**
   * Once a frame on the guest, before the day and night and atmosphere updates.
   * @param {number} rawDt real seconds
   * @returns {void}
   */
  function apply(rawDt) {
    if (!target) return;
    const dn = ctx.DayNight;
    if (!saved) {
      saved = { intensity: Sim.params.intensity, windSpeed: Sim.params.windSpeed, radius: Sim.params.radius, day: dn ? dn.day : false };
      shown = {
        ramp: Sim.state.stormRamp, intensity: Sim.params.intensity, wind: Sim.params.windSpeed,
        radius: Sim.params.radius, daylight: dn ? dn.daylight : 0
      };
    }
    const s = /** @type {NonNullable<typeof shown>} */ (shown);
    s.ramp = easeValue(s.ramp, target.ramp, rawDt, SKY_TAU.ramp);
    s.intensity = easeValue(s.intensity, target.intensity, rawDt, SKY_TAU.params);
    s.wind = easeValue(s.wind, target.wind, rawDt, SKY_TAU.params);
    s.radius = easeValue(s.radius, target.radius, rawDt, SKY_TAU.params);
    s.daylight = easeValue(s.daylight, target.daylight, rawDt, SKY_TAU.daylight);
    Sim.state.stormRamp = s.ramp;
    Sim.params.intensity = s.intensity;
    Sim.params.windSpeed = s.wind;
    Sim.params.radius = s.radius;
    if (dn) dn.follow = s.daylight;
    setSlowLook(slowLook(target.timeScale));
  }

  /**
   * Gives the guest's own values back (session end, a new welcome, reset).
   * The storm ramp is not restored: the frame's own ramp eases it to the
   * guest's state, so the rain fades instead of cutting.
   * @returns {void}
   */
  function release() {
    target = null;
    setSlowLook(false);
    if (!saved) return;
    Sim.params.intensity = saved.intensity;
    Sim.params.windSpeed = saved.windSpeed;
    Sim.params.radius = saved.radius;
    const dn = ctx.DayNight;
    if (dn) {
      dn.follow = null;
      dn.day = saved.day;
    }
    saved = null;
    shown = null;
  }

  return { feed, apply, release, active: () => saved !== null };
}
