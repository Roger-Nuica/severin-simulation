// @ts-check

/**
 * ===========================================================================
 * Lighting tuning -- the one place the railgun flash and the building lights
 * are dialled in. Tuning only: nothing here adds behaviour.
 * ===========================================================================
 * The storm's own lightning, explosions and the Black Hole's glow do not read
 * these (the railgun reuses the lightning bolt, so its flash is scaled here
 * and the storm's is left exactly as it was).
 */
export const LIGHTING = {
  /** Railgun flash light: multiplies the storm flash's peak (it was blown out). */
  railgunLightIntensity: 0.5,
  /** How far the railgun flash light reaches, in metres (0 = unlimited, as the storm's). */
  railgunLightDistance: 60,
  /** How long the railgun flash lasts, seconds: a spike with a fast falloff. */
  railgunFlashSeconds: 0.1,
  /** Opacity multiplier on the railgun bolt's additive glow shell. */
  railgunGlowOpacity: 0.6,
  /** Scale multiplier on that glow shell's width. */
  railgunGlowScale: 0.6,
  /** HDR level of the railgun's saturated yellow core (kept near 1-1.5, not white). */
  railgunCoreHdr: 1.4,
  /** Brightness of the railgun's ground ring: above the ground, under clipping. */
  railgunRingEmissive: 0.85,
  /** Scales every building light: window glow, street lamps, backdrop windows. */
  buildingEmissiveScale: 0.65,
  /** Scales the halo pools under street lamps. */
  buildingHaloScale: 0.7,
  /** Bloom pass strength and luminance threshold (post.js). */
  bloomStrength: 0.95,
  bloomThreshold: 1.05
};
