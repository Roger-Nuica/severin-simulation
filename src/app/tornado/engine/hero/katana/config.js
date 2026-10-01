// @ts-check

/**
 * ===========================================================================
 * SECTION KT.7 -- The slicing core's numbers
 * ===========================================================================
 * Local to the Katana. Nothing here raises an existing cap (R-048): the
 * piece cap is the Katana's own, chosen (Q4, option B) so the pieces fit the
 * 400 draw-call budget (perf/budget.js): at most three draws a piece (two
 * material groups and one cap), so 32 pieces cost at most 96.
 */
export const KATANA_PIECES = {
  /** Live pieces at once; the oldest is recycled past it. */
  maxPieces: 32,
  /** Cuts deep a piece can be (three clipping planes a material, always). */
  maxDepth: 3,
  /** Seconds a piece lives on the world clock, fade included. */
  lifetime: 6,
  /** The last seconds of its life in which it fades out. */
  fadeSeconds: 1.5,
  /** Metres per second the halves are pushed apart along the cut's normal. */
  pushSpeed: 2.6,
  /** Extra upward pop, metres per second. */
  popSpeed: 1.6,
  /** Spin, radians per second: the least and the most. */
  spin: [1.5, 4.0],
  /** Gravity, metres per second squared. */
  gravity: 14,
  /** Height of a piece's pivot when it lies on the ground, metres. */
  restHeight: 0.18,
  /** Share of the fall speed kept by a bounce, and of the sliding speed lost to it. */
  restitution: 0.35,
  bounceFriction: 0.7,
  /** Slowest fall speed that still bounces, metres per second. */
  bounceMin: 1.2,
  /** How fast sliding and spin die away on the ground, per second. */
  groundDrag: 4,
  /** Sliding speed under which a piece on the ground stops moving, metres per second. */
  restSpeed: 0.08,
  /** The glowing cut face: the alien's inner teal-green, over 1 so it blooms. */
  capColour: [0.2, 1.5, 0.9],
  /** The detail group's faint glow (guns, eyes, hat): the shared colour of its emissive. */
  detailEmissive: 0x0a1c10
};

/**
 * ===========================================================================
 * SECTION KT.8 -- Alien blood: goo burst, drips and splatter decals
 * ===========================================================================
 * Local to the Katana. The goo pool is one tracked pool of the shared
 * 10,000-particle budget (perf/caps.js): it is small, and every emission is
 * clamped to `particleRoom()` as well. Nothing here raises `CAPS.particles`
 * (R-048).
 */
export const KATANA_GOO = {
  /** Particles in the one goo pool (a fixed size, made once a simulation). */
  poolSize: 600,
  /** Most particles one cut may emit, drips included. */
  burstMax: 80,
  /** Fewest particles a cut emits, however short its line. */
  burstMin: 12,
  /** Droplets per metre of cut line (a 1.8 m cut reaches `burstMax`). */
  perMetre: 44,
  /** Droplet speed away from the cut plane, metres per second: the least and the most. */
  spray: [1.4, 4.6],
  /** Extra upward speed, metres per second: the least and the most. */
  lift: [0.4, 2.6],
  /** Seconds a droplet lives, at most (it ends sooner on the ground). */
  life: [0.6, 1.5],
  /** Droplet size, world units: the least and the most. */
  size: [0.12, 0.3],
  /** Gravity on the goo, metres per second squared. */
  gravity: 13,
  /** Height, metres, under which a droplet counts as on the ground. */
  groundY: 0.03,
  /** The share of a droplet's life over which it fades. */
  fadeShare: 0.3,
  /** Alpha at full strength. */
  alpha: 0.95,
  /** Alien green, not red: the brightest and the darkest of the droplets (rgb, 0 to 1). */
  colourBright: [0.5, 1.0, 0.22],
  colourDark: [0.16, 0.55, 0.1],
  /** Drip sources a cut makes (half on each side of the cut), and how long each drips, seconds. */
  dripSources: 8,
  dripLife: [1.2, 2.2],
  /** Seconds between two drips from one source. */
  dripEvery: 0.11,
  /** Most drip sources alive at once (the oldest is recycled). */
  dripSlots: 24,
  /** Drip size, world units. */
  dripSize: 0.1,
  /** Chance a droplet leaves a decal where it lands, and the same for a drip. */
  decalChance: 0.1,
  dripDecalChance: 0.35,
  /** Most decals one frame may stamp. */
  decalsPerFrame: 3,
  /** Decals in the ring: the oldest is recycled once it is full. */
  decalCapacity: 48,
  /** Seconds a decal lasts on the world clock, and the last seconds it fades over. */
  decalLife: 16,
  decalFade: 5,
  /** Decal width, metres: the least and the most. */
  decalSize: [0.35, 1.0],
  /** Height of the decals above the ground, metres (polygon offset does the rest). */
  decalY: 0.03,
  /** The decals' colour: a wet, dark alien green. */
  decalColour: 0x2f9a1a
};

/**
 * ===========================================================================
 * SECTION KT.9 -- Game feel and scoring
 * ===========================================================================
 * Local to the Katana. The base alien kill stays `ALIENS.killScore`, scored
 * once by the alien owner's sliceKill; the bonuses here are additive and go
 * through damage.addDamageScore only (R-026, R-027), so the combo and the
 * Firenado multiplier apply once, as for every other score.
 */
export const KATANA_FEEL = {
  /** Id of the Katana's own world time hold (never `timeSlow`, `actionHero` or a later `bladeMode`). */
  holdId: 'katanaHitStop',
  /** World time scale while the hit-stop lasts (near, not at, a standstill). */
  holdScale: 0.05,
  /** Real seconds the hit-stop lasts (about 65 ms; frame-rate independent). */
  holdSeconds: 0.065,
  /** Real seconds after a hit-stop ends before another may start, so cuts cannot chain into a freeze. */
  holdRefractory: 0.12,
  /** Extra camera shake on a multi-cut: peak offset (world units) and real seconds; addShake keeps the stronger. */
  multiShake: 0.3,
  multiShakeTime: 0.18,
  /** Bonus points for each alien cut beyond the first in one slash (the base kill is not repeated). */
  multiCutBonus: 50,
  /** Bonus points for each already-cut piece cut again in one slash. */
  extraPieceBonus: 20,
  /** The slash flash: real seconds it lasts, its thickness (metres) at the start, and its colour (over 1 so it blooms). */
  flashSeconds: 0.14,
  flashThickness: 0.07,
  flashColour: [1.6, 2.0, 2.2]
};

/**
 * ===========================================================================
 * SECTION KT.10 -- Blade Mode
 * ===========================================================================
 * Local to the Katana. Blade Mode holds the world through its own named time
 * hold, so it never reuses (or releases) `timeSlow`, `actionHero` or the
 * hit-stop's `katanaHitStop`. The hold resolves by the lowest scale per group
 * (time.js): 0.1 beats Time Slow (0.3), combo slow-motion (0.3) and Action
 * Hero (0.35), while Bullet Time (0.03) stays lower. Both timers run on REAL
 * time. It does not slow Roger (Q3 default): the `player` group is not held.
 */
export const KATANA_BLADE = {
  /** Id of Blade Mode's own world time hold. */
  holdId: 'bladeMode',
  /** World time scale while Blade Mode lasts. */
  holdScale: 0.1,
  /** Real seconds the button is held before Blade Mode begins. */
  holdSeconds: 0.25,
  /** Real seconds Blade Mode lasts at most. */
  maxSeconds: 4,
  /** Cuts in one Blade Mode window; the mode ends after the last. */
  maxCuts: 3,
  /** A drag shorter than this, in pixels, is "no line": letting go of it leaves Blade Mode. */
  minLinePx: 24,
  /**
   * How near the cut plane must pass to the alien's body axis, metres. Under
   * the alien's half width (0.35 m), so the cut face always fits inside the
   * silhouette and a graze is rejected.
   */
  bodyRadius: 0.25,
  /** The same for a piece lying about, measured to its pivot, metres. */
  pieceRadius: 0.3,
  /** How far, in pixels, the cut may lie beyond the drawn segment's ends and still touch an alien. */
  segmentPadPx: 24
};

/**
 * ===========================================================================
 * SECTION KT.11 -- Blade Mode visuals
 * ===========================================================================
 * Presentation only. The vignette's strength and ease live beside the grade
 * in engine/post.js; nothing here changes a gameplay value.
 */
export const KATANA_BLADE_UI = {
  /** Highlight markers in the one fixed pool (R-048). */
  markerPool: 16,
  /** Metres from Roger within which an alien is highlighted (the slash's reach, slash.js). */
  highlightReach: 3.0,
  /** Marker ring radii in metres (inner, outer) on the ground under the alien. */
  markerRadius: [0.42, 0.55],
  /** Marker opacity at its brightest, and its pulse speed in radians per real second. */
  markerOpacity: 0.4,
  markerPulse: 5,
  /** Marker colour (rgb, over 1 so it blooms a little): the cut face's teal. */
  markerColour: [0.3, 1.4, 1.0],
  /** Cut line thickness in pixels and its colour (css). */
  lineThickness: 3,
  lineColour: 'rgba(170, 245, 255, 0.95)',
  lineGlow: '0 0 6px rgba(120, 235, 255, 0.95), 0 0 16px rgba(60, 200, 255, 0.7)',
  /** Shortest line drawn, in pixels (a bare press shows nothing). */
  lineMinPx: 2
};
