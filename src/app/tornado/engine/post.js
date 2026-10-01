// @ts-check
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GTAOShader, generateMagicSquareNoise } from 'three/examples/jsm/shaders/GTAOShader.js';

/**
 * ===========================================================================
 * SECTION P — Post-processing: HDR bloom, ambient occlusion, colour grading
 * ===========================================================================
 * A hand-driven pipeline rather than an EffectComposer chain, because every
 * stage here wants the *same* two inputs -- the HDR scene colour and the
 * scene depth from the one main render -- and a composer's ping-ponging
 * read/write buffers would make "which target holds this frame's depth"
 * alternate from frame to frame. Per frame:
 *
 *   1. SCENE. One render of the scene into an MSAA, half-float target with a
 *      depth texture attached. Half-float is what lets light sources be
 *      genuinely brighter than white (see "HDR light sources" below); the
 *      depth texture is resolved out of the MSAA buffer by three alongside
 *      the colour, so it costs no extra scene render.
 *
 *   2. AMBIENT OCCLUSION. GTAO (three's GTAOShader) at reduced resolution,
 *      reading that depth texture and reconstructing normals from it, then a
 *      small depth-aware blur. three's own GTAOPass is not used: in r160 its
 *      setGBuffer()/setSize() dereference a normal render target that does
 *      not exist when it is handed an external depth texture, and without an
 *      external depth texture it re-renders the whole scene every frame just
 *      to get normals. SSAOPass is worse still -- it renders the scene twice.
 *
 *   3. BLOOM. Luminance-threshold bloom over the full HDR scene, via
 *      UnrealBloomPass's mip pyramid. This replaces the earlier camera-layer
 *      approach, which drew only the explosion fire into the bloom buffer:
 *      that render had no depth from the rest of the scene, so extending it
 *      to lit windows would have made every window on the far side of a
 *      building glow straight through the wall. Thresholding the real scene
 *      is occlusion-correct for free, and needs no second scene render.
 *
 *   4. COMPOSITE + GRADE, drawn straight to the canvas: AO applied, bloom
 *      added, a highlight shoulder to bring HDR values back into display
 *      range, the colour grade, a vignette, and the sRGB encode.
 *
 * HDR light sources. Selectivity comes from the threshold, not from a mask:
 * the lit windows, streetlight lamps and lightning cores are authored with
 * colours well above 1.0 (see WINDOW_GLOW_GAIN, STREETLIGHT_LAMP_HDR,
 * LIGHTNING_CORE_HDR), explosion fire exceeds 1.0 by additive stacking, and
 * a lightning flash drives the surfaces it lights past 1.0 on its own. The
 * lit town itself peaks well below the threshold (the sun at intensity 1.3
 * on a light wall lands around 0.15 linear), so it never glows.
 */

// --- Bloom ---------------------------------------------------------------
// Threshold is in linear luminance. 0.9 sits well above anything the scene
// lights produce on ordinary surfaces and below every HDR source listed in
// the header, with a soft knee so sources ramp in rather than popping.
const BLOOM_THRESHOLD = 0.9;
const BLOOM_KNEE = 0.35;
const BLOOM_STRENGTH = 0.95;
const BLOOM_RADIUS = 0.55;
// Per-mip tint, finest to widest: the tight core stays the source's own
// colour, the wide halo drifts warm. This is most of the "warm highlights
// near light sources" half of the grade -- light spills warm into the cold
// storm palette around every window, lamp, bolt and fireball.
const BLOOM_MIP_TINTS = [
  [1.0, 1.0, 1.0],
  [1.02, 0.96, 0.88],
  [1.06, 0.92, 0.78],
  [1.1, 0.88, 0.7],
  [1.12, 0.86, 0.66]
];

// --- Ambient occlusion ---------------------------------------------------
// Performance knobs, in the order to reach for them if the frame budget is
// exceeded (resolution first, then samples; bloom is left alone because it
// has the largest visual effect per millisecond of anything in this file).
const AO_RESOLUTION_SCALE = 0.5;
// Was 16; halved for weak GPUs (the depth-aware blur hides the extra noise).
const AO_SAMPLES = 8;
// World-space units. The radius is sized to the contact creases this is
// for -- building/ground, car/ground, debris against debris -- rather than
// to whole-building occlusion, which would read as dirty haloes.
const AO_RADIUS = 2.8;
// MSAA samples of the scene target (see initPostProcessing).
export const SCENE_SAMPLES = 2;
const AO_THICKNESS = 2.5;
const AO_DISTANCE_EXPONENT = 1.4;
const AO_POWER = 2.1;
const AO_STRENGTH = 0.9;

// --- Gravitational lensing (engine/player/blackHole.js) ------------------
// Folded into the composite shader rather than a separate render target: it
// already samples tScene/tBloom once per pixel every frame, so warping that
// one sample instead of adding a new pass costs nothing extra outside the
// hole's own screen-space reach (uLensStrength is 0 -- set from JS, not a
// shader branch alone -- whenever the hole is shut, off-screen or far
// enough that its apparent radius would round to nothing). AO and depth are
// sampled at the *un*warped vUv: they describe this pixel's own real
// geometry, and threading the warp through the AO pass too would need a
// second GTAO run for a difference too small to read.
const LENS_PULL = 0.34;        // peak fraction the sample is pulled toward the centre
const LENS_SWIRL = 1.05;       // radians of peak rotation round the centre
const LENS_CHROMA = 0.045;     // extra per-channel pull split, near the inner ring

// --- Exposure ------------------------------------------------------------
// One overall brightness knob, applied to the scene colour in the composite
// (after AO, before bloom and the grade). Scaling here rather than raising
// individual light intensities lifts shadow and lit areas together and
// leaves every intensity-driven darkening (sky/fog colour and density in
// scene.js, contrast/split toning below) working on top of it unchanged,
// just from a brighter base. It is not applied to the bloom input, so it
// does not change which surfaces cross the bloom threshold.
const EXPOSURE = 1.45;

// --- Grade ---------------------------------------------------------------
// Contrast is a power curve about a pivot in perceptual space rather than
// the usual linear "(x - 0.5) * k + 0.5": this scene is mostly dark, and a
// linear stretch about 0.5 drives the storm sky to pure black (measured in
// the earlier pass), whereas a power curve darkens it proportionally and
// can never cross zero.
const GRADE_PIVOT = 0.38;
const GRADE_CONTRAST_BASE = 1.12;
const GRADE_CONTRAST_INTENSITY = 0.12;
const GRADE_SATURATION_BASE = 1.12;
const GRADE_SATURATION_INTENSITY = 0.1;
// Split toning, multiplied in perceptual space. Shadows go blue-teal for the
// storm, highlights go warm; SPLIT scales both and rises with intensity.
const GRADE_SHADOW_TINT = new THREE.Vector3(0.88, 1.0, 1.12);
const GRADE_HIGHLIGHT_TINT = new THREE.Vector3(1.1, 1.0, 0.86);
const GRADE_SPLIT_BASE = 0.75;
const GRADE_SPLIT_INTENSITY = 0.35;
// A small teal lift in the deepest blacks -- the "never quite black" toe of
// a graded film image, and what makes the shadows read as *storm* blue
// rather than simply dark.
const GRADE_TOE_LIFT = new THREE.Vector3(0.0, 0.006, 0.013);
const GRADE_VIGNETTE = 0.32;
// Extra vignette at full Blade Mode, and the seconds its ease takes to cover
// about 63 % of the way (a time-based lerp, not a per-frame one).
const BLADE_VIGNETTE = 0.16;
const BLADE_VIGNETTE_TAU = 0.15;
// Above this (linear, per channel max) values start rolling off smoothly
// towards 1.0 instead of clipping; everything below is untouched.
const HIGHLIGHT_KNEE = 0.75;

/**
 * @param {Object} ctx
 * @returns {{
 *   Post: Object,
 *   initPostProcessing: () => void,
 *   resizePostProcessing: () => void,
 *   renderFrame: () => void,
 *   disposePostProcessing: () => void
 * }}
 */
export function createPostSystem(ctx) {
  const { Sim } = ctx;
  // Scratch, reused every frame rather than allocated (performance pass).
  const clearScratch = new THREE.Color();
  const lensScratch = new THREE.Vector3();
  const lensViewScratch = new THREE.Vector3();

  const Post = {
    sceneTarget: /** @type {THREE.WebGLRenderTarget|null} */ (null),
    aoTarget: /** @type {THREE.WebGLRenderTarget|null} */ (null),
    aoBlurTarget: /** @type {THREE.WebGLRenderTarget|null} */ (null),
    gtaoMaterial: /** @type {THREE.ShaderMaterial|null} */ (null),
    aoBlurMaterial: /** @type {THREE.ShaderMaterial|null} */ (null),
    bloomPass: /** @type {UnrealBloomPass|null} */ (null),
    compositeMaterial: /** @type {THREE.ShaderMaterial|null} */ (null),
    quad: /** @type {FullScreenQuad|null} */ (null),
    // Runtime toggles, so the cost of each stage can be measured in isolation
    // from a devtools console (scene.userData.post.enabled.ao = false, etc.).
    // debugView 1 shows the blurred AO buffer on its own.
    enabled: { ao: true, bloom: true },
    debugView: 0,
    exposure: EXPOSURE,
    // Transient multiplier on exposure, set every frame by lightning.js: a
    // brief dip while a flash is lit, like a camera's auto-exposure, so the
    // flash's many additive parts can never blow the whole frame out.
    exposureScale: 1,
    // Overall lift on top of the exposure, driven by the run's clock in
    // tornadoEngine.js (updateBrightness): the storm and the damage darken the
    // scene a great deal, and past a couple of minutes little was visible.
    brightness: 1,
    // Bullet Time (player/abilities.js): 1 while it runs. The picture eases
    // to it (bulletTimeShown): drained of colour, a heavier vignette.
    bulletTime: 0,
    bulletTimeShown: 0,
    // Katana Blade Mode (hero/katana/bladeUi.js): 1 while it lasts. A vignette
    // only (never saturation or camera), eased in REAL seconds so it is
    // frame-rate independent; `bladeVignetteAt` is the last frame's clock.
    bladeVignette: 0,
    bladeVignetteShown: 0,
    bladeVignetteAt: 0
  };

  const FULLSCREEN_VERTEX = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `;

  /**
   * Depth-aware 5x5 box blur. 5x5 matches the tile of GTAO's magic-square
   * noise, so a plain box over it averages the per-pixel rotation pattern out
   * exactly; the depth weight stops occlusion bleeding across silhouettes
   * (a dark fringe around a building against the sky, say).
   * @returns {THREE.ShaderMaterial}
   */
  function createAOBlurMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: {
        tAO: { value: null },
        tDepth: { value: null },
        aoTexel: { value: new THREE.Vector2() },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 2000 }
      },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: `
        #include <packing>
        uniform sampler2D tAO;
        uniform highp sampler2D tDepth;
        uniform vec2 aoTexel;
        uniform float cameraNear;
        uniform float cameraFar;
        varying vec2 vUv;

        float viewDepth( vec2 uv ) {
          return -perspectiveDepthToViewZ( texture2D( tDepth, uv ).x, cameraNear, cameraFar );
        }

        void main() {
          float d0 = viewDepth( vUv );
          // Tolerance grows with distance, since depth-reconstructed surfaces
          // get coarser the further away they are.
          float tolerance = d0 * 0.04 + 0.15;
          float sum = 0.0;
          float weight = 0.0;
          for ( int x = -2; x <= 2; x++ ) {
            for ( int y = -2; y <= 2; y++ ) {
              vec2 uv = vUv + vec2( float( x ), float( y ) ) * aoTexel;
              float w = max( 0.0, 1.0 - abs( viewDepth( uv ) - d0 ) / tolerance );
              sum += texture2D( tAO, uv ).r * w;
              weight += w;
            }
          }
          gl_FragColor = vec4( vec3( weight > 0.0 ? sum / weight : 1.0 ), 1.0 );
        }
      `,
      depthTest: false,
      depthWrite: false
    });
  }

  /**
   * The final pass: AO, bloom, highlight roll-off, grade, vignette, dither,
   * sRGB encode. All in one fragment shader so the whole grade costs one
   * fullscreen draw.
   * @returns {THREE.ShaderMaterial}
   */
  function createCompositeMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null },
        tDepth: { value: null },
        tAO: { value: null },
        tBloom: { value: null },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 2000 },
        uFogDensity: { value: 0 },
        uAOStrength: { value: AO_STRENGTH },
        uExposure: { value: EXPOSURE },
        uBloomStrength: { value: 1 },
        uContrast: { value: GRADE_CONTRAST_BASE },
        uSaturation: { value: GRADE_SATURATION_BASE },
        uSplit: { value: GRADE_SPLIT_BASE },
        uShadowTint: { value: GRADE_SHADOW_TINT.clone() },
        uHighlightTint: { value: GRADE_HIGHLIGHT_TINT.clone() },
        uToeLift: { value: GRADE_TOE_LIFT.clone() },
        uVignette: { value: GRADE_VIGNETTE },
        uAspect: { value: 1 },
        uDebugView: { value: 0 },
        uLensCenter: { value: new THREE.Vector2() },
        uLensRadius: { value: 0 },
        uLensStrength: { value: 0 }
      },
      defines: {
        GRADE_PIVOT: GRADE_PIVOT.toFixed(4),
        HIGHLIGHT_KNEE: HIGHLIGHT_KNEE.toFixed(4),
        LENS_PULL: LENS_PULL.toFixed(4),
        LENS_SWIRL: LENS_SWIRL.toFixed(4),
        LENS_CHROMA: LENS_CHROMA.toFixed(4)
      },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: `
        #include <packing>
        uniform sampler2D tScene;
        uniform highp sampler2D tDepth;
        uniform sampler2D tAO;
        uniform sampler2D tBloom;
        uniform float cameraNear;
        uniform float cameraFar;
        uniform float uFogDensity;
        uniform float uAOStrength;
        uniform float uExposure;
        uniform float uBloomStrength;
        uniform float uContrast;
        uniform float uSaturation;
        uniform float uSplit;
        uniform vec3 uShadowTint;
        uniform vec3 uHighlightTint;
        uniform vec3 uToeLift;
        uniform float uVignette;
        uniform float uAspect;
        uniform int uDebugView;
        uniform vec2 uLensCenter;
        uniform float uLensRadius;
        uniform float uLensStrength;
        varying vec2 vUv;

        const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );

        // Where to actually sample tScene/tBloom for this pixel: pulled and
        // swirled toward the hole's screen centre, strongest just outside
        // the core and fading to nothing at uLensRadius, so the background
        // visibly bends round it. chroma splits the pull slightly per
        // channel, for the thin colour fringe right at the inner ring.
        vec2 lensSample( vec2 uv, float chroma ) {
          vec2 d = ( uv - uLensCenter ) * vec2( uAspect, 1.0 );
          float r = length( d );
          float u = clamp( r / max( uLensRadius, 1e-4 ), 0.0, 1.0 );
          float profile = smoothstep( 0.0, 0.18, u ) * smoothstep( 1.0, 0.3, u );
          float amount = uLensStrength * profile * ( LENS_PULL + chroma );
          float angle = uLensStrength * profile * LENS_SWIRL;
          float s = sin( angle ), c = cos( angle );
          vec2 rotated = mat2( c, -s, s, c ) * d;
          vec2 pulled = rotated * ( 1.0 - amount );
          return uLensCenter + pulled / vec2( uAspect, 1.0 );
        }

        // Hue-preserving shoulder: scales the whole colour by how far its
        // brightest channel is compressed, so a 2x-overbright window stays
        // amber instead of clipping to yellow-white per channel. Values that
        // are very far over 1.0 are allowed to drift towards white, which is
        // how an incandescent core actually reads.
        vec3 highlightShoulder( vec3 c ) {
          float m = max( max( c.r, c.g ), c.b );
          if ( m <= HIGHLIGHT_KNEE ) return c;
          float range = 1.0 - HIGHLIGHT_KNEE;
          float mapped = HIGHLIGHT_KNEE + range * ( 1.0 - exp( -( m - HIGHLIGHT_KNEE ) / range ) );
          vec3 scaled = c * ( mapped / m );
          float toWhite = clamp( ( m - 1.0 ) * 0.22, 0.0, 0.5 );
          return mix( scaled, vec3( mapped ), toWhite );
        }

        // A single NaN or Inf pixel from any material is spread by the
        // bloom's mip pyramid into a blocky black patch the size of the
        // screen. Dropped here so one bad fragment costs one pixel at most.
        vec3 finite( vec3 c ) {
          bvec3 bad = bvec3(
            isnan( c.r ) || isinf( c.r ),
            isnan( c.g ) || isinf( c.g ),
            isnan( c.b ) || isinf( c.b )
          );
          return any( bad ) ? vec3( 0.0 ) : c;
        }

        void main() {
          vec3 scene;
          vec2 bloomUv = vUv;
          if ( uLensStrength > 0.001 ) {
            // Three samples, one per channel, each pulled a slightly
            // different amount -- the fringe only shows up where the pull
            // itself is strong, i.e. right at the inner ring.
            scene = vec3(
              texture2D( tScene, lensSample( vUv, LENS_CHROMA ) ).r,
              texture2D( tScene, lensSample( vUv, 0.0 ) ).g,
              texture2D( tScene, lensSample( vUv, -LENS_CHROMA ) ).b
            );
            bloomUv = lensSample( vUv, 0.0 );
          } else {
            scene = texture2D( tScene, vUv ).rgb;
          }
          scene = finite( scene );

          // --- Ambient occlusion -------------------------------------------
          // Faded by the same FogExp2 term the scene materials use (three's
          // fog depth is view-space z), so AO never darkens geometry the fog
          // has already washed out; and faded off on emissive pixels, so a
          // lit window near a corner stays lit.
          float viewZ = -perspectiveDepthToViewZ( texture2D( tDepth, vUv ).x, cameraNear, cameraFar );
          float fogVisibility = exp( -uFogDensity * uFogDensity * viewZ * viewZ );
          float emissive = smoothstep( 0.6, 1.2, dot( scene, LUMA ) );
          float ao = texture2D( tAO, vUv ).r;
          if ( uDebugView == 1 ) {
            gl_FragColor = vec4( vec3( ao ), 1.0 );
            return;
          }
          scene *= mix( 1.0, ao, uAOStrength * fogVisibility * ( 1.0 - emissive ) );
          scene *= uExposure;

          vec3 colour = scene + finite( texture2D( tBloom, bloomUv ).rgb ) * uBloomStrength;
          colour = highlightShoulder( max( colour, vec3( 0.0 ) ) );

          // --- Grade, in approximate perceptual space ----------------------
          // sqrt is a cheap stand-in for a gamma-2 encode; grading linear
          // light directly would spend the whole curve on the few bright
          // pixels and leave this mostly dark scene untouched.
          vec3 p = sqrt( colour );

          p = GRADE_PIVOT * pow( p / GRADE_PIVOT, vec3( uContrast ) );

          float l = dot( p, LUMA );
          float shadowWeight = 1.0 - smoothstep( 0.0, 0.45, l );
          float highlightWeight = smoothstep( 0.35, 0.9, l );
          p *= mix( vec3( 1.0 ), uShadowTint, shadowWeight * uSplit );
          p *= mix( vec3( 1.0 ), uHighlightTint, highlightWeight * uSplit );
          p += uToeLift * ( 1.0 - smoothstep( 0.0, 0.25, l ) );

          l = dot( p, LUMA );
          p = mix( vec3( l ), p, uSaturation );

          vec2 fromCentre = ( vUv - 0.5 ) * vec2( uAspect, 1.0 );
          p *= 1.0 - uVignette * smoothstep( 0.35, 1.0, length( fromCentre ) * 1.25 );

          // Half-LSB dither: the graded storm sky is a large, very dark,
          // slow gradient, which is exactly where 8-bit banding shows.
          float noise = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
          p += ( noise - 0.5 ) / 255.0;

          p = max( p, vec3( 0.0 ) );
          gl_FragColor = vec4( p * p, 1.0 );
          #include <colorspace_fragment>
        }
      `,
      depthTest: false,
      depthWrite: false
    });
  }

  /**
   * @param {THREE.WebGLRenderer} renderer
   * @returns {THREE.Vector2} drawing-buffer size in device pixels
   */
  function getBufferSize(renderer) {
    return renderer.getDrawingBufferSize(new THREE.Vector2());
  }

  /**
   * Builds the targets and materials. Called once from the bootstrap, after
   * initScene() has created the renderer.
   * @returns {void}
   */
  function initPostProcessing() {
    const { renderer } = Sim.three;
    const size = getBufferSize(renderer);

    // Multisampled here because rendering into a target bypasses the canvas's
    // own antialias (which is now off: it was never seen). 2 samples rather
    // than 4 for weak GPUs; quality.js can take it to 0.
    // UnsignedIntType depth matches the DEPTH_COMPONENT24 renderbuffer three
    // allocates for the MSAA side, which the depth blit requires.
    Post.sceneTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: SCENE_SAMPLES,
      depthTexture: new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType)
    });

    const aoW = Math.max(1, Math.round(size.x * AO_RESOLUTION_SCALE));
    const aoH = Math.max(1, Math.round(size.y * AO_RESOLUTION_SCALE));
    Post.aoTarget = new THREE.WebGLRenderTarget(aoW, aoH, { depthBuffer: false });
    Post.aoBlurTarget = new THREE.WebGLRenderTarget(aoW, aoH, { depthBuffer: false });

    const gtao = new THREE.ShaderMaterial({
      defines: {
        ...GTAOShader.defines,
        // 0 = reconstruct normals from depth, so no normal render is needed.
        NORMAL_VECTOR_TYPE: 0,
        SAMPLES: AO_SAMPLES
      },
      uniforms: THREE.UniformsUtils.clone(GTAOShader.uniforms),
      vertexShader: GTAOShader.vertexShader,
      fragmentShader: GTAOShader.fragmentShader,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false
    });
    gtao.uniforms.tNoise.value = generateMagicSquareNoise();
    gtao.uniforms.tDepth.value = Post.sceneTarget.depthTexture;
    gtao.uniforms.radius.value = AO_RADIUS;
    gtao.uniforms.thickness.value = AO_THICKNESS;
    gtao.uniforms.distanceExponent.value = AO_DISTANCE_EXPONENT;
    gtao.uniforms.scale.value = AO_POWER;
    Post.gtaoMaterial = gtao;

    Post.aoBlurMaterial = createAOBlurMaterial();
    Post.aoBlurMaterial.uniforms.tAO.value = Post.aoTarget.texture;
    Post.aoBlurMaterial.uniforms.tDepth.value = Post.sceneTarget.depthTexture;

    // UnrealBloomPass builds its pyramid at half of whatever it is sized to,
    // so sizing it to the full drawing buffer gives a half-res bloom.
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD
    );
    bloom.highPassUniforms.smoothWidth.value = BLOOM_KNEE;
    bloom.bloomTintColors = BLOOM_MIP_TINTS.map(([r, g, b]) => new THREE.Vector3(r, g, b));
    Post.bloomPass = bloom;

    Post.compositeMaterial = createCompositeMaterial();
    const cu = Post.compositeMaterial.uniforms;
    cu.tScene.value = Post.sceneTarget.texture;
    cu.tDepth.value = Post.sceneTarget.depthTexture;
    cu.tAO.value = Post.aoBlurTarget.texture;
    cu.tBloom.value = bloom.renderTargetsHorizontal[0].texture;

    Post.quad = new FullScreenQuad(null);
    resizePostProcessing();
    Sim.three.scene.userData.post = Post;
  }

  /**
   * Keeps every target matched to the canvas. Called from onWindowResize()
   * after the renderer itself has been resized.
   * @returns {void}
   */
  function resizePostProcessing() {
    if (!Post.sceneTarget) return;
    const size = getBufferSize(Sim.three.renderer);
    Post.sceneTarget.setSize(size.x, size.y);
    const aoW = Math.max(1, Math.round(size.x * AO_RESOLUTION_SCALE));
    const aoH = Math.max(1, Math.round(size.y * AO_RESOLUTION_SCALE));
    Post.aoTarget.setSize(aoW, aoH);
    Post.aoBlurTarget.setSize(aoW, aoH);
    Post.gtaoMaterial.uniforms.resolution.value.set(aoW, aoH);
    Post.aoBlurMaterial.uniforms.aoTexel.value.set(1 / aoW, 1 / aoH);
    Post.bloomPass.setSize(size.x, size.y);
    Post.compositeMaterial.uniforms.uAspect.value = size.x / size.y;
  }

  /**
   * Draws a fullscreen material into a target, cleared to `clearHex` first.
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Material} material
   * @param {THREE.WebGLRenderTarget|null} target
   * @param {number|null} clearHex null to skip the clear
   * @returns {void}
   */
  function drawQuad(renderer, material, target, clearHex) {
    renderer.setRenderTarget(target);
    if (clearHex !== null) {
      renderer.setClearColor(clearHex, 1);
      renderer.clear(true, false, false);
    }
    Post.quad.material = material;
    Post.quad.render(renderer);
  }

  /**
   * GTAO into aoTarget, then the depth-aware blur into aoBlurTarget.
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.PerspectiveCamera} camera
   * @returns {void}
   */
  function renderAO(renderer, camera) {
    const g = Post.gtaoMaterial.uniforms;
    g.cameraNear.value = camera.near;
    g.cameraFar.value = camera.far;
    g.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
    g.cameraProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
    g.cameraWorldMatrix.value.copy(camera.matrixWorld);
    // Cleared to white because GTAO discards sky pixels (depth 1.0) rather
    // than writing "unoccluded" for them.
    drawQuad(renderer, Post.gtaoMaterial, Post.aoTarget, 0xffffff);

    const b = Post.aoBlurMaterial.uniforms;
    b.cameraNear.value = camera.near;
    b.cameraFar.value = camera.far;
    drawQuad(renderer, Post.aoBlurMaterial, Post.aoBlurTarget, null);
  }

  /**
   * Runs UnrealBloomPass's threshold, blur pyramid and mip composite, and
   * stops there. The pass's own render() would finish by additively
   * blending the bloom back into its input target; here the bloom is kept
   * separate (in renderTargetsHorizontal[0]) so the composite can apply AO
   * to the scene without also darkening the glow. The steps below are
   * UnrealBloomPass.render() from three r160 minus that final blend;
   * package.json's ^0.160.0 pins three to 0.160.x, so these fields are
   * stable for as long as that range is.
   * @param {THREE.WebGLRenderer} renderer
   * @returns {void}
   */
  function renderBloom(renderer) {
    const bloom = Post.bloomPass;
    bloom.highPassUniforms.tDiffuse.value = Post.sceneTarget.texture;
    bloom.highPassUniforms.luminosityThreshold.value = bloom.threshold;
    renderer.setClearColor(0x000000, 0);
    drawQuad(renderer, bloom.materialHighPassFilter, bloom.renderTargetBright, 0x000000);

    let input = bloom.renderTargetBright;
    for (let i = 0; i < bloom.nMips; i++) {
      const blur = bloom.separableBlurMaterials[i];
      blur.uniforms.colorTexture.value = input.texture;
      blur.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
      drawQuad(renderer, blur, bloom.renderTargetsHorizontal[i], 0x000000);
      blur.uniforms.colorTexture.value = bloom.renderTargetsHorizontal[i].texture;
      blur.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
      drawQuad(renderer, blur, bloom.renderTargetsVertical[i], 0x000000);
      input = bloom.renderTargetsVertical[i];
    }

    const composite = bloom.compositeMaterial.uniforms;
    composite.bloomStrength.value = bloom.strength;
    composite.bloomRadius.value = bloom.radius;
    composite.bloomTintColors.value = bloom.bloomTintColors;
    drawQuad(renderer, bloom.compositeMaterial, bloom.renderTargetsHorizontal[0], 0x000000);
  }

  /**
   * The lensing uniforms for this frame: where the hole sits on screen, how
   * big its reach looks from here, and how strongly to warp -- 0 whenever
   * there is no open hole, it is behind the camera, or it would round to an
   * imperceptible radius, so the shader's own branch (lensSample) skips the
   * extra sampling entirely in every one of those cases.
   * @param {THREE.PerspectiveCamera} camera
   * @returns {void}
   */
  function updateLens(camera) {
    const u = Post.compositeMaterial.uniforms;
    // The adaptive quality ladder (engine/quality.js), already the one place
    // that steps the whole game down on a weak machine: past its AO/MSAA
    // steps, the lensing's reach is shrunk too, and it is dropped
    // altogether once the machine is visibly struggling, rather than this
    // effect running its own separate FPS watch.
    const step = ctx.systems.quality ? ctx.systems.quality.qualityStep() : 0;
    if (step >= 3) {
      u.uLensStrength.value = 0;
      return;
    }
    const info = ctx.systems.blackHole && ctx.systems.blackHole.lensInfo();
    if (!info) {
      u.uLensStrength.value = 0;
      return;
    }
    lensScratch.set(info.x, info.y, info.z);
    // Behind the camera: project() would still return a (wrong-reading)
    // in-range NDC point for it, so the view-space depth is checked first.
    const viewZ = lensViewScratch.copy(lensScratch).applyMatrix4(camera.matrixWorldInverse).z;
    if (viewZ > -0.5) {
      u.uLensStrength.value = 0;
      return;
    }
    const dist = camera.position.distanceTo(lensScratch);
    lensScratch.project(camera);
    const uvX = lensScratch.x * 0.5 + 0.5;
    const uvY = lensScratch.y * 0.5 + 0.5;
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const reach = info.reach * (1 - step * 0.22);
    const radius = 0.5 * reach / (Math.max(1, dist) * Math.tan(fovRad / 2));
    if (radius < 0.01 || uvX + radius < 0 || uvX - radius > 1 || uvY + radius < 0 || uvY - radius > 1) {
      u.uLensStrength.value = 0;
      return;
    }
    u.uLensCenter.value.set(uvX, uvY);
    u.uLensRadius.value = radius;
    u.uLensStrength.value = info.strength;
  }

  /**
   * Draws one frame through the whole pipeline, replacing the loop's old
   * direct renderer.render() call.
   * @returns {void}
   */
  function renderFrame() {
    const { scene, camera, renderer } = Sim.three;
    if (!Post.sceneTarget) {
      renderer.render(scene, camera);
      return;
    }

    const prevClear = renderer.getClearColor(clearScratch);
    const prevClearAlpha = renderer.getClearAlpha();
    const prevAutoClear = renderer.autoClear;

    renderer.setRenderTarget(Post.sceneTarget);
    renderer.render(scene, camera);
    renderer.autoClear = false;

    if (Post.enabled.ao) renderAO(renderer, camera);
    if (Post.enabled.bloom) renderBloom(renderer);

    const u = Post.compositeMaterial.uniforms;
    const intensity = Sim.params.intensity;
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    u.uFogDensity.value = scene.fog ? scene.fog.density : 0;
    u.uAOStrength.value = Post.enabled.ao ? AO_STRENGTH : 0;
    u.uBloomStrength.value = Post.enabled.bloom ? 1 : 0;
    u.uContrast.value = GRADE_CONTRAST_BASE + intensity * GRADE_CONTRAST_INTENSITY;
    Post.bulletTimeShown += (Post.bulletTime - Post.bulletTimeShown) * 0.12;
    const bt = Post.bulletTimeShown;
    u.uSaturation.value = (GRADE_SATURATION_BASE - intensity * GRADE_SATURATION_INTENSITY) * (1 - 0.55 * bt);
    // Idle (no Blade Mode, fully eased out): no clock read, no exp, and the
    // last-frame clock is dropped so the next ease starts from a zero step.
    if (Post.bladeVignette > 0 || Post.bladeVignetteShown > 0.0005) {
      const now = performance.now();
      const bladeDt = Post.bladeVignetteAt > 0 ? Math.min(0.25, Math.max(0, (now - Post.bladeVignetteAt) / 1000)) : 0;
      Post.bladeVignetteAt = now;
      Post.bladeVignetteShown += (Post.bladeVignette - Post.bladeVignetteShown) * (1 - Math.exp(-bladeDt / BLADE_VIGNETTE_TAU));
    } else {
      Post.bladeVignetteShown = 0;
      Post.bladeVignetteAt = 0;
    }
    u.uVignette.value = GRADE_VIGNETTE + 0.4 * bt + BLADE_VIGNETTE * Post.bladeVignetteShown;
    u.uSplit.value = GRADE_SPLIT_BASE + intensity * GRADE_SPLIT_INTENSITY;
    u.uDebugView.value = Post.debugView;
    u.uExposure.value = Post.exposure * Post.exposureScale * Post.brightness;
    updateLens(camera);
    drawQuad(renderer, Post.compositeMaterial, null, null);

    renderer.autoClear = prevAutoClear;
    renderer.setClearColor(prevClear, prevClearAlpha);
  }

  /**
   * Releases every GPU resource this section owns. Without it, React
   * StrictMode's dev-mode mount -> unmount -> mount leaves a full set of
   * screen-sized targets alive until the old context is garbage collected.
   * @returns {void}
   */
  function disposePostProcessing() {
    if (!Post.sceneTarget) return;
    Post.sceneTarget.depthTexture.dispose();
    Post.sceneTarget.dispose();
    Post.aoTarget.dispose();
    Post.aoBlurTarget.dispose();
    Post.gtaoMaterial.uniforms.tNoise.value.dispose();
    Post.gtaoMaterial.dispose();
    Post.aoBlurMaterial.dispose();
    Post.bloomPass.dispose();
    Post.compositeMaterial.dispose();
    Post.quad.dispose();
    Post.sceneTarget = null;
  }

  return { Post, initPostProcessing, resizePostProcessing, renderFrame, disposePostProcessing };
}
