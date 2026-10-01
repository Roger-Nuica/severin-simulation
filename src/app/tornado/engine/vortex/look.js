import * as THREE from 'three';
import { FLASH, FUNNEL_LOOK, FIRE_GLOW, ELECTRIC_GLOW, ICE_GLOW, WHITE } from './config.js';

/**
 * ===========================================================================
 * SECTION V.1 — The funnel's look
 * ===========================================================================
 * Its materials and their shader patches, the density baked into the
 * vertices, the wall cloud's tint, and the lightning, fire and electric
 * glows on every shell.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see vortex.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createVortexLook(ctx, S, api) {
  /**
   * Patches a funnel material to see the scene fog at FUNNEL_LOOK.fogScale
   * of its density and, when `rim` is given, to add a fresnel edge
   * highlight driven by its uniform.
   * @param {THREE.Material} material
   * @param {{value: number}|null} rim shared rim-strength uniform, or null for no rim
   * @param {boolean} [pointSizes] Points only: scale each point by its `aSize` attribute
   * @returns {void}
   */
  function applyFunnelLook(material, rim, pointSizes = false) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uFunnelFogScale = { value: FUNNEL_LOOK.fogScale };
      if (pointSizes) {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aSize;')
          .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;');
      }
      let frag = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uFunnelFogScale;')
        .replace('#include <fog_fragment>', `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float funnelFogD = fogDensity * uFunnelFogScale;
    float fogFactor = 1.0 - exp( - funnelFogD * funnelFogD * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth ) * uFunnelFogScale;
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`);
      if (rim) {
        shader.uniforms.uRim = rim;
        shader.uniforms.uRimColour = { value: FUNNEL_LOOK.rimColour };
        frag = frag
          .replace('#include <common>', `#include <common>
uniform float uRim;
uniform vec3 uRimColour;`)
          .replace('#include <opaque_fragment>', `#include <opaque_fragment>
{
  // abs(): the funnel is double-sided, so back faces' normals point away.
  float funnelNdotV = abs( dot( normalize( vNormal ), normalize( vViewPosition ) ) );
  float funnelRim = pow( 1.0 - clamp( funnelNdotV, 0.0, 1.0 ), ${FUNNEL_LOOK.rimPower.toFixed(2)} );
  gl_FragColor.rgb += uRimColour * funnelRim * uRim;
  gl_FragColor.a = min( 1.0, gl_FragColor.a + funnelRim * ${FUNNEL_LOOK.rimAlpha.toFixed(2)} * uRim );
}`);
      }
      shader.fragmentShader = frag;
    };
    material.customProgramCacheKey = () => (rim ? 'funnel-look-rim' : pointSizes ? 'funnel-look-sized' : 'funnel-look');
  }

  /**
   * Bakes the per-vertex RGBA density/tint profile onto a funnel geometry:
   * dirt-stained and near-opaque at the ground contact, thinning to a pale
   * translucent wisp at the top. Done once per geometry rather than per frame
   * because it depends only on a vertex's base height, which never changes —
   * the turbulence passes only ever displace vertices radially.
   * three.js applies the alpha channel of a 4-component colour attribute only
   * when the material is transparent, which both funnel materials are.
   * @param {THREE.BufferGeometry} geo
   * @param {number} height full height of the profile, for normalising y
   * @returns {void}
   */
  function bakeFunnelDensity(geo, height) {
    const vertexCount = geo.attributes.position.count;
    const colours = new Float32Array(vertexCount * 4);
    const upperTint = new THREE.Color(0xcbd6e3);
    const groundTint = new THREE.Color(0x9c9280);
    const tint = new THREE.Color();
    for (let i = 0; i < vertexCount; i++) {
      const hT = THREE.MathUtils.clamp(geo.attributes.position.getY(i) / height, 0, 1);
      // Biased towards the square so the lower third stays genuinely solid
      // instead of fading away from the very first metre upwards.
      // Fades fully out over the top of the funnel (Instrucțiunea LL), rather
      // than ending at 30% opacity in a flat, hard rim against the sky.
      const density = THREE.MathUtils.lerp(1, 0.3, hT * hT * 0.55 + hT * 0.45)
        * (1 - THREE.MathUtils.smoothstep(hT, 0.72, 1));
      tint.copy(groundTint).lerp(upperTint, THREE.MathUtils.smoothstep(hT, 0.02, 0.32));
      colours[i * 4] = tint.r;
      colours[i * 4 + 1] = tint.g;
      colours[i * 4 + 2] = tint.b;
      colours[i * 4 + 3] = density;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colours, 4));
  }

  /**
   * Bakes a two-tone RGBA gradient onto a shell geometry, by normalised
   * height: tint from `groundTint` to `upperTint`, alpha from `alphaAt`.
   * @param {THREE.BufferGeometry} geo
   * @param {number} height full height of the shell, for normalising y
   * @param {number} groundTint
   * @param {number} upperTint
   * @param {(hT: number) => number} alphaAt
   * @returns {void}
   */
  function bakeShellGradient(geo, height, groundTint, upperTint, alphaAt) {
    const count = geo.attributes.position.count;
    const colours = new Float32Array(count * 4);
    const lower = new THREE.Color(groundTint);
    const upper = new THREE.Color(upperTint);
    const tint = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const hT = THREE.MathUtils.clamp(geo.attributes.position.getY(i) / height, 0, 1);
      tint.copy(lower).lerp(upper, hT);
      colours[i * 4] = tint.r;
      colours[i * 4 + 1] = tint.g;
      colours[i * 4 + 2] = tint.b;
      colours[i * 4 + 3] = alphaAt(hT);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colours, 4));
  }

  /**
   * A translucent, vertex-tinted shell material in the funnel's style,
   * streaked by (a clone of) its band texture.
   * @param {THREE.Texture} bandTexture
   * @returns {THREE.MeshStandardMaterial}
   */
  function createShellMaterial(bandTexture) {
    const band = bandTexture.clone();
    band.needsUpdate = true;
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      map: band,
      alphaMap: band,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 1,
      emissive: new THREE.Color(FLASH.colour),
      emissiveIntensity: 0
    });
  }

  /**
   * Tints the wall-cloud collar from the low cloud layer's current colours
   * (night, day, intensity): mostly its shadowed belly at night, mostly its
   * sunlit top by day. Installed as the collar's onBeforeRender.
   * @returns {void}
   */
  function tintCrown() {
    const cloudLayers = ctx.systems.clouds && ctx.systems.clouds.Clouds.layers;
    const low = cloudLayers && cloudLayers.find(l => l.def.name === 'cloudLayer_low');
    if (!low) return;
    const daylight = ctx.DayNight ? ctx.DayNight.daylight : 0;
    S.Vortex.crown.material.color
      .copy(low.material.uniforms.uBellyColour.value)
      .lerp(low.material.uniforms.uTopColour.value, 0.35 + 0.45 * daylight);
  }

  /**
   * Lightning strike hook, called by lightning.js for every strike: a bolt
   * landing within FLASH.reach of the funnel's axis (or into the funnel
   * itself) lights the funnel surface, more the closer and stronger it is.
   * @param {THREE.Vector3} end where the bolt lands
   * @param {number} power 0..1 strike power
   * @returns {void}
   */
  function onLightningStrike(end, power) {
    const d = Math.hypot(end.x - S.Vortex.center.x, end.z - S.Vortex.center.z);
    const proximity = 1 - THREE.MathUtils.clamp(d / FLASH.reach, 0, 1);
    if (proximity <= 0) return;
    const now = ctx.now();
    // Keep whichever of the fading current flash and the new one is brighter.
    const current = S.Vortex.flashPeak * Math.exp(-(now - S.Vortex.flashTime) * FLASH.decay);
    const strength = (0.35 + 0.65 * power) * proximity * proximity;
    if (strength > current) {
      S.Vortex.flashPeak = strength;
      S.Vortex.flashTime = now;
    }
  }

  /**
   * Writes the current lightning flash into every funnel surface's
   * emissive intensity: a sharp rise, a fast exponential fade and a quick
   * flicker, like the lightning overlay's own.
   * @returns {void}
   */
  function applyFlash() {
    const age = ctx.now() - S.Vortex.flashTime;
    const flicker = 0.75 + 0.25 * Math.sin(age * 55);
    S.Vortex.flash = age < 0 ? 0 : S.Vortex.flashPeak * Math.exp(-age * FLASH.decay) * flicker;
    const glow = S.Vortex.flash < 0.01 ? 0 : S.Vortex.flash * FLASH.gain;
    const fire = S.Vortex.fire * FIRE_GLOW.gain;
    // The Electric Tornado's charge (engine/electricStorm.js): a cold blue
    // light from inside the column, flickering with the current, so the
    // funnel itself reads as charged rather than as a grey cone with arcs
    // drawn over it.
    const elec = S.Vortex.electric * ELECTRIC_GLOW.gain * (0.7 + 0.3 * Math.sin(age * 37 + S.Vortex.index));
    // The core is denser and darker, so it catches less of the flash, but
    // burns hottest; the skirt, where the burning debris is thickest,
    // catches more of the fire too.
    // The Blizzard's ice (engine/blizzard.js), steady.
    const ice = (S.Vortex.ice || 0) * ICE_GLOW.gain;
    setGlow(S.Vortex.funnelMesh.material, glow, fire, elec, ice);
    setGlow(S.Vortex.coreMesh.material, glow * 0.55, fire * 1.15, elec * 1.6, ice * 0.8);
    setGlow(S.Vortex.skirtMesh.material, glow * 0.8, fire * 1.2, elec * 0.5, ice * 1.2);
    for (const sub of S.Vortex.subVortices) setGlow(sub.mesh.material, glow, fire, elec, ice);
    S.Vortex.particles.material.color.copy(WHITE)
      .lerp(ICE_GLOW.swirlTint, Math.min(1, S.Vortex.ice || 0))
      .lerp(ELECTRIC_GLOW.swirlTint, Math.min(1, S.Vortex.electric))
      .lerp(FIRE_GLOW.swirlTint, Math.min(1, S.Vortex.fire));
  }

  /**
   * Sets a funnel material's emissive to the lightning flash plus the
   * Firenado burn, each in its own colour.
   * @param {THREE.MeshStandardMaterial} material
   * @param {number} flash emissive strength of the lightning flash
   * @param {number} fire emissive strength of the fire glow
   * @param {number} [elec] the Electric Tornado's glow
   * @param {number} [ice] the Blizzard's glow
   * @returns {void}
   */
  function setGlow(material, flash, fire, elec = 0, ice = 0) {
    material.emissive.setHex(FLASH.colour).multiplyScalar(flash)
      .add(S.emissiveScratch.copy(FIRE_GLOW.colour).multiplyScalar(fire))
      .add(S.emissiveScratch.copy(ELECTRIC_GLOW.colour).multiplyScalar(elec))
      .add(S.emissiveScratch.copy(ICE_GLOW.colour).multiplyScalar(ice));
    material.emissiveIntensity = 1;
  }

  return { applyFunnelLook, bakeFunnelDensity, bakeShellGradient, createShellMaterial, tintCrown, onLightningStrike, applyFlash, setGlow };
}
