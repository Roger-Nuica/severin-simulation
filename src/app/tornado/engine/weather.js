// @ts-check
import * as THREE from 'three';
import { createFireTexture } from '../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from './particlePool.js';

/**
 * ===========================================================================
 * SECTION N — Weather: rain, drifting embers, lightning light shafts
 * ===========================================================================
 * Purely visual, like the clouds: reads Sim.params, the vortex position,
 * the active explosions and lightning strikes; writes nothing back.
 *
 * WIND. A prevailing wind direction that veers slowly over time, with a
 * strength taken from the wind-speed slider. The rain slants along it and
 * the embers drift on it; close to the funnel, the rain is also swept
 * round it (see the swirl term in the rain shader).
 *
 * RAIN. Thin streaks, not droplets: each drop is one instanced quad
 * stretched along its own velocity and turned about that axis to face the
 * camera, fading from a bright head to a clear tail like a motion-blurred
 * streak. Animation is entirely in the vertex shader -- every drop is a
 * fixed random offset carried along by velocity * time and wrapped through
 * a box that follows the camera -- so rain costs no CPU per frame and
 * nothing is uploaded after start-up. Density is simply how many instances
 * are drawn (instanceCount), from a light drizzle at the bottom of the wind
 * slider to heavy, driving rain at EF4-EF5. Drops fade out close to the
 * camera, so nothing smears across the lens (or through the cockpit).
 *
 * EMBERS. A sparse layer of glowing fire-textured particles (particlePool.js)
 * drifting up and downwind with a wobble. A low ambient baseline appears
 * across the view during a strong run, plus extra embers thrown off every
 * active explosion. Pushed past 1.0 so post.js blooms them.
 *
 * LIGHT SHAFTS. On each strike, a fan of soft additive cones spreads down
 * from where the bolt leaves the cloud base -- a cheap stand-in for
 * volumetric light: brightest along the core facing the camera, fading at
 * the silhouettes and towards the ground, then gone within half a second.
 * A small fixed pool of cones is reused for every strike.
 */

// --- Wind ----------------------------------------------------------------
const WIND_BASE_ANGLE = 0.6;          // radians, prevailing direction
const WIND_VEER = 0.45;               // radians of slow swing either side
const WIND_VEER_RATE = 0.025;         // radians/second of the veer's phase

// --- Rain ----------------------------------------------------------------
const RAIN_MAX = 14000;               // hard cap: the instance buffer size
const RAIN_DENSITY_MIN = 0.07;        // share of RAIN_MAX drawn at the lowest wind
const RAIN_BOX = new THREE.Vector3(120, 80, 120); // wrap volume around the camera
const RAIN_FALL_SPEED = 34;           // world units/second
const RAIN_SLANT_MIN = 0.12;          // horizontal/vertical speed ratio at low wind...
const RAIN_SLANT_MAX = 0.85;          // ...and at the top of the wind range
const RAIN_LENGTH = [1.1, 2.2];       // streak length, low -> high wind
const RAIN_WIDTH = 0.028;
const RAIN_OPACITY = [0.12, 0.3];
const RAIN_COLOUR = new THREE.Color(0.6, 0.66, 0.76);
// Day Mode (engine/dayNight.js): pale streaks vanish against a bright sky,
// so by day they are darker and a little more opaque, reading as grey rain
// against the haze instead.
const RAIN_COLOUR_DAY = new THREE.Color(0.3, 0.34, 0.41);
const RAIN_DAY_OPACITY_GAIN = 1.5;
const RAIN_SWIRL = 26;                // tangential speed added near the funnel
const RAIN_SWIRL_RADIUS = 90;

// --- Embers --------------------------------------------------------------
const EMBER_MAX = 260;
const EMBER_AMBIENT_RATE = 22;        // per second at full intensity during a run
const EMBER_BURST_RATE = 14;          // per second per active explosion
const EMBER_AMBIENT_RADIUS = 70;      // around the camera's ground position
const EMBER_LIFE = [4, 9];
const EMBER_SIZE = [0.16, 0.34];
const EMBER_COLOUR = new THREE.Color(2.3, 0.9, 0.22);

// --- Light shafts --------------------------------------------------------
const SHAFT_STRIKES = 4;              // strikes that can have shafts at once
const SHAFTS_PER_STRIKE = 5;
const SHAFT_LIFE = 0.55;              // seconds
const SHAFT_ATTACK = 0.04;            // seconds to peak
const SHAFT_SPREAD = 45;              // world units of scatter at the ground
const SHAFT_RADIUS = [7, 17];         // at the far end
const SHAFT_COLOUR = new THREE.Color(0xffe2a8);
// Lowered from 1.3: at the old value the shafts alone were enough to clip a
// large part of the frame on a close strike (Instrucțiunea HH).
const SHAFT_INTENSITY = 0.85;

const RAIN_VERTEX = /* glsl */`
  attribute vec4 aSeed;
  uniform float uTime;
  uniform vec3 uBox;
  uniform vec3 uCam;
  uniform vec3 uVel;
  uniform float uLength;
  uniform float uWidth;
  uniform vec3 uVortex;
  uniform float uSwirl;
  uniform float uSwirlRadius;
  uniform float uFunnelRadius;
  varying float vAlpha;
  #include <fog_pars_vertex>

  void main() {
    float speed = 0.85 + 0.3 * aSeed.w;
    vec3 vel = uVel * speed;
    // World-anchored drop, wrapped into a box centred on the camera.
    vec3 p = aSeed.xyz * uBox + vel * uTime;
    p = mod( p - uCam + 0.5 * uBox, uBox ) - 0.5 * uBox + uCam;

    // Swept round the funnel close in.
    vec2 d = p.xz - uVortex.xz;
    float r = max( length( d ), 1.0 );
    vec2 tangent = vec2( -d.y, d.x ) / r;
    vel.xz += tangent * uSwirl * ( 1.0 - smoothstep( 8.0, uSwirlRadius, r ) );

    vec3 dir = normalize( vel );
    vec3 toCam = normalize( cameraPosition - p );
    // Guarded: looking exactly along a drop makes this cross product zero,
    // and normalising zero is NaN (see the note in SHAFT_FRAGMENT on what a
    // single NaN does to the frame once bloom spreads it).
    vec3 across = cross( dir, toCam );
    float acrossLen = length( across );
    vec3 side = acrossLen > 1e-4 ? across / acrossLen : vec3( 1.0, 0.0, 0.0 );
    // position.x in [-1, 1] across the streak, position.y 0 (head) .. 1 (tail).
    vec3 world = p + side * position.x * uWidth - dir * position.y * uLength;

    float camDist = length( cameraPosition - p );
    // Faded out close to the camera: a streak a few metres away is several
    // pixels wide and reads as a white bar rather than rain.
    vAlpha = ( 1.0 - position.y ) * smoothstep( 3.0, 10.0, camDist );

    // Thinned where it hangs between the camera and the funnel, so the
    // funnel is not drowned behind a curtain of streaks: a drop counts when
    // it is nearer than the funnel and inside the (ground-plane) angle the
    // funnel subtends from the camera.
    vec2 toFunnel = uVortex.xz - cameraPosition.xz;
    float funnelDist = max( length( toFunnel ), 1.0 );
    vec2 fwd = toFunnel / funnelDist;
    vec2 rel = p.xz - cameraPosition.xz;
    float along = dot( rel, fwd );
    float offAxis = abs( dot( rel, vec2( -fwd.y, fwd.x ) ) ) / max( along, 1.0 );
    float halfAngle = uFunnelRadius / funnelDist;
    float inFront = step( 0.0, along ) * ( 1.0 - smoothstep( funnelDist - uFunnelRadius, funnelDist, along ) );
    float inCone = 1.0 - smoothstep( halfAngle * 0.7, halfAngle * 1.3, offAxis );
    vAlpha *= 1.0 - 0.6 * inFront * inCone;

    vec4 mvPosition = viewMatrix * vec4( world, 1.0 );
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const RAIN_FRAGMENT = /* glsl */`
  uniform vec3 uColour;
  uniform float uOpacity;
  uniform float uFlash;
  varying float vAlpha;
  #include <fog_pars_fragment>
  void main() {
    // A lightning flash lights the rain up for an instant.
    gl_FragColor = vec4( uColour * ( 1.0 + uFlash * 2.5 ), uOpacity * vAlpha * ( 1.0 + uFlash ) );
    #include <fog_fragment>
  }
`;

const SHAFT_VERTEX = /* glsl */`
  varying float vAlong;
  varying float vFacing;
  #include <fog_pars_vertex>
  void main() {
    // Geometry is built apex at y = 0, far end at y = -1.
    vAlong = -position.y;
    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
    vec3 n = normalize( normalMatrix * normal );
    vFacing = abs( dot( n, normalize( -mvPosition.xyz ) ) );
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const SHAFT_FRAGMENT = /* glsl */`
  uniform vec3 uColour;
  uniform float uIntensity;
  varying float vAlong;
  varying float vFacing;
  #include <fog_pars_fragment>
  void main() {
    // Bright through the core facing the camera, soft at the silhouettes,
    // fading in off the apex and out towards the ground.
    // Both pow() bases are clamped: interpolation can carry vAlong a hair
    // past 1.0 at the cone's rim, and pow() of a negative base is NaN on
    // real GPUs -- which the bloom pyramid then smears into black blocks
    // across the whole frame (seen on every strike before this clamp).
    float body = pow( clamp( vFacing, 0.0, 1.0 ), 1.6 );
    float along = smoothstep( 0.0, 0.08, vAlong ) * pow( clamp( 1.0 - vAlong, 0.0, 1.0 ), 1.3 );
    gl_FragColor = vec4( uColour * uIntensity * body * along, 1.0 );
    #include <fog_fragment>
  }
`;

/**
 * @param {Object} ctx
 * @returns {{
 *   Weather: Object,
 *   initWeather: () => void,
 *   updateWeather: (dt: number) => void,
 *   onLightningStrike: (start: THREE.Vector3, end: THREE.Vector3, power: number) => void,
 *   disposeWeather: () => void
 * }}
 */
export function createWeatherSystem(ctx) {
  const { Sim } = ctx;

  const Weather = {
    // Unit vector on the ground plane the wind blows towards; read by
    // anything else that wants to drift with the weather.
    windDir: new THREE.Vector2(Math.cos(WIND_BASE_ANGLE), Math.sin(WIND_BASE_ANGLE)),
    windStrength: 0,
    time: 0,
    rain: /** @type {THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>|null} */ (null),
    embers: /** @type {import('./particlePool.js').ParticlePool|null} */ (null),
    shafts: /** @type {{meshes:THREE.Mesh[], materials:THREE.ShaderMaterial[], age:number, peak:number}[]} */ ([]),
    nextShaftSlot: 0,
    group: /** @type {THREE.Group|null} */ (null)
  };

  /**
   * @param {number[]} range [min, max]
   * @returns {number}
   */
  function inRange(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  /**
   * 0 at the bottom of the wind slider, 1 at the top -- weighted by
   * Sim.state.stormRamp (see context.js), so the rain is calm while standing
   * by rather than already driving at whatever the sliders are set to the
   * moment the page loads.
   * @returns {number}
   */
  function windFactor() {
    return THREE.MathUtils.clamp((Sim.params.windSpeed - 20) / 300, 0, 1) * Sim.state.stormRamp;
  }

  /** @returns {THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>} */
  function buildRain() {
    const quad = new THREE.InstancedBufferGeometry();
    // Two triangles: x across the streak (-1..1), y along it (0 head, 1 tail).
    quad.setAttribute('position', new THREE.Float32BufferAttribute([
      -1, 0, 0, 1, 0, 0, 1, 1, 0,
      -1, 0, 0, 1, 1, 0, -1, 1, 0
    ], 3));
    const seeds = new Float32Array(RAIN_MAX * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    quad.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    quad.instanceCount = 0;

    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 },
        uBox: { value: RAIN_BOX.clone() },
        uCam: { value: new THREE.Vector3() },
        uVel: { value: new THREE.Vector3() },
        uLength: { value: RAIN_LENGTH[0] },
        uWidth: { value: RAIN_WIDTH },
        uVortex: { value: new THREE.Vector3() },
        uFunnelRadius: { value: 20 },
        uSwirl: { value: 0 },
        uSwirlRadius: { value: RAIN_SWIRL_RADIUS },
        uColour: { value: RAIN_COLOUR.clone() },
        uOpacity: { value: RAIN_OPACITY[0] },
        uFlash: { value: 0 }
      }]),
      vertexShader: RAIN_VERTEX,
      fragmentShader: RAIN_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true
    });
    const mesh = new THREE.Mesh(quad, material);
    mesh.name = 'weather_rain';
    // Positions come from the shader, around the camera wherever it is.
    mesh.frustumCulled = false;
    return mesh;
  }

  /**
   * Builds the shaft pool: SHAFT_STRIKES slots of SHAFTS_PER_STRIKE cones
   * sharing one open-ended cone geometry (apex at y 0, far end at y -1).
   * @returns {void}
   */
  function buildShafts() {
    const geometry = new THREE.CylinderGeometry(0.04, 1, 1, 18, 1, true);
    geometry.translate(0, -0.5, 0);
    for (let s = 0; s < SHAFT_STRIKES; s++) {
      const meshes = [];
      const materials = [];
      for (let k = 0; k < SHAFTS_PER_STRIKE; k++) {
        const material = new THREE.ShaderMaterial({
          uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
            uColour: { value: SHAFT_COLOUR.clone() },
            uIntensity: { value: 0 }
          }]),
          vertexShader: SHAFT_VERTEX,
          fragmentShader: SHAFT_FRAGMENT,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          fog: true
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `weather_lightShaft_${s}_${k}`;
        mesh.visible = false;
        Weather.group.add(mesh);
        meshes.push(mesh);
        materials.push(material);
      }
      Weather.shafts.push({ meshes, materials, age: SHAFT_LIFE, peak: 0 });
    }
  }

  /** @returns {void} */
  function initWeather() {
    const group = new THREE.Group();
    group.name = 'weather';
    Weather.group = group;
    Weather.rain = buildRain();
    group.add(Weather.rain);
    buildShafts();
    Sim.three.scene.add(group);
    Weather.embers = createParticlePool(Sim.three.scene, EMBER_MAX, createFireTexture(), THREE.AdditiveBlending, 'weather_embers');
  }

  /**
   * Called by lightning.js for every strike: fans a set of light shafts
   * down from the bolt's top.
   * @param {THREE.Vector3} start where the bolt leaves the cloud base
   * @param {THREE.Vector3} end where it lands
   * @param {number} power 0..1
   * @returns {void}
   */
  function onLightningStrike(start, end, power) {
    if (!Weather.shafts.length) return;
    const slot = Weather.shafts[Weather.nextShaftSlot];
    Weather.nextShaftSlot = (Weather.nextShaftSlot + 1) % Weather.shafts.length;
    slot.age = 0;
    slot.peak = SHAFT_INTENSITY * (0.45 + 0.55 * power);
    const down = new THREE.Vector3();
    const axis = new THREE.Vector3(0, -1, 0);
    for (const mesh of slot.meshes) {
      const target = end.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 2 * SHAFT_SPREAD, 0, (Math.random() - 0.5) * 2 * SHAFT_SPREAD
      ));
      target.y = 0;
      down.subVectors(target, start);
      const length = down.length() * (0.8 + Math.random() * 0.35);
      down.normalize();
      const radius = inRange(SHAFT_RADIUS);
      mesh.position.copy(start);
      mesh.quaternion.setFromUnitVectors(axis, down);
      mesh.scale.set(radius, length, radius);
      mesh.visible = true;
    }
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} camPos
   * @param {number} wind 0..1
   * @returns {void}
   */
  function updateRain(dt, camPos, wind) {
    const rain = Weather.rain;
    const u = rain.material.uniforms;
    // The `RAIN_DENSITY_MIN` floor below is a light drizzle baseline "at the
    // bottom of the wind slider" (see its own comment) rather than true zero,
    // so it is scaled by the storm ramp too -- otherwise standing by would
    // still show a faint drizzle rather than the clear, still sky "pace"
    // asks for.
    const density = (RAIN_DENSITY_MIN + (1 - RAIN_DENSITY_MIN) * Math.pow(wind, 1.4)) * Sim.state.stormRamp;
    rain.geometry.instanceCount = Math.round(RAIN_MAX * density);
    // The panel's Rain switch (engine/settings.js).
    rain.visible = ctx.systems.settings.get('rainVisual');
    const slant = THREE.MathUtils.lerp(RAIN_SLANT_MIN, RAIN_SLANT_MAX, wind);
    u.uVel.value.set(
      Weather.windDir.x * RAIN_FALL_SPEED * slant,
      -RAIN_FALL_SPEED,
      Weather.windDir.y * RAIN_FALL_SPEED * slant
    );
    u.uTime.value = Weather.time;
    u.uCam.value.copy(camPos);
    u.uLength.value = THREE.MathUtils.lerp(RAIN_LENGTH[0], RAIN_LENGTH[1], wind);
    const daylight = ctx.DayNight ? ctx.DayNight.daylight : 0;
    u.uOpacity.value = THREE.MathUtils.lerp(RAIN_OPACITY[0], RAIN_OPACITY[1], wind) * (1 + (RAIN_DAY_OPACITY_GAIN - 1) * daylight);
    u.uColour.value.copy(RAIN_COLOUR).lerp(RAIN_COLOUR_DAY, daylight);
    u.uVortex.value.copy(ctx.Vortex.center);
    // The funnel's upper width, as it currently stands on screen.
    u.uFunnelRadius.value = ctx.Vortex.topRadius * ctx.Vortex.group.scale.x * 0.8;
    u.uSwirl.value = RAIN_SWIRL * Sim.params.intensity * Sim.state.stormRamp;
    const flashLight = ctx.Lightning && ctx.Lightning.flashLight;
    u.uFlash.value = flashLight ? Math.min(1, flashLight.intensity / 900) : 0;
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} camPos
   * @param {number} wind 0..1
   * @returns {void}
   */
  function updateEmbers(dt, camPos, wind) {
    const pool = Weather.embers;
    const count = pool.life.length;
    /** @type {(x:number, y:number, z:number, spread:number) => void} */
    const spawn = (x, y, z, spread) => {
      const i = pool.next;
      pool.next = (pool.next + 1) % count;
      pool.positions[i * 3] = x + (Math.random() - 0.5) * spread;
      pool.positions[i * 3 + 1] = y + Math.random() * spread * 0.5;
      pool.positions[i * 3 + 2] = z + (Math.random() - 0.5) * spread;
      pool.velocities[i * 3] = (Math.random() - 0.5) * 1.5;
      pool.velocities[i * 3 + 1] = 0.4 + Math.random() * 0.9;
      pool.velocities[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
      pool.life[i] = pool.maxLife[i] = inRange(EMBER_LIFE);
      pool.seed[i] = Math.random();
    };

    // Ambient baseline: only during a run, rising steeply with intensity.
    if (Sim.state.running) {
      const rate = EMBER_AMBIENT_RATE * Math.pow(Sim.params.intensity, 2);
      pool.accumulator += rate * dt;
      while (pool.accumulator >= 1) {
        pool.accumulator -= 1;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * EMBER_AMBIENT_RADIUS;
        spawn(camPos.x + Math.cos(a) * r, 1 + Math.random() * 20, camPos.z + Math.sin(a) * r, 2);
      }
    }
    // Near fires: every live explosion throws embers off.
    const bursts = ctx.systems.explosions.ImpactBursts.slots;
    for (const slot of bursts) {
      if (!slot.active || Math.random() >= EMBER_BURST_RATE * dt) continue;
      spawn(slot.origin.x, slot.origin.y, slot.origin.z, 4);
    }

    const t = Weather.time;
    const drift = 1.2 + wind * 3.5;
    const dx = Weather.windDir.x * drift;
    const dz = Weather.windDir.y * drift;
    for (let i = 0; i < count; i++) {
      const c = i * 4;
      if (pool.life[i] <= 0) {
        pool.colours[c + 3] = 0;
        pool.sizes[i] = 0;
        continue;
      }
      pool.life[i] -= dt;
      const age = 1 - Math.max(pool.life[i], 0) / pool.maxLife[i];
      const seed = pool.seed[i];
      const v = i * 3;
      // Drift downwind, rise, and wobble on two slow sines.
      const wobble = Math.sin(t * (1.3 + seed) + seed * 40) * 0.9;
      pool.positions[v] += (pool.velocities[v] + dx + wobble) * dt;
      pool.positions[v + 1] += pool.velocities[v + 1] * dt;
      pool.positions[v + 2] += (pool.velocities[v + 2] + dz + Math.cos(t * (1.1 + seed) + seed * 17) * 0.9) * dt;
      const flicker = 0.55 + 0.45 * Math.sin(t * (9 + seed * 8) + seed * 60);
      const fade = Math.min(1, age * 6) * (1 - age);
      pool.colours[c] = EMBER_COLOUR.r;
      pool.colours[c + 1] = EMBER_COLOUR.g;
      pool.colours[c + 2] = EMBER_COLOUR.b;
      pool.colours[c + 3] = fade * flicker;
      pool.sizes[i] = THREE.MathUtils.lerp(EMBER_SIZE[0], EMBER_SIZE[1], seed) * (1 - age * 0.4);
    }
    pool.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    markPoolDirty(pool);
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateShafts(dt) {
    for (const slot of Weather.shafts) {
      if (slot.age >= SHAFT_LIFE) continue;
      slot.age += dt;
      const done = slot.age >= SHAFT_LIFE;
      const rise = Math.min(1, slot.age / SHAFT_ATTACK);
      const fall = Math.pow(Math.max(0, 1 - (slot.age - SHAFT_ATTACK) / (SHAFT_LIFE - SHAFT_ATTACK)), 2);
      // A little flicker, in step with the flash's own.
      const flicker = 0.75 + 0.25 * Math.sin(slot.age * 45);
      const intensity = done ? 0 : slot.peak * rise * fall * flicker;
      slot.materials.forEach((m, k) => {
        m.uniforms.uIntensity.value = intensity * (0.6 + 0.4 * ((k * 7919) % 5) / 4);
      });
      if (done) for (const mesh of slot.meshes) mesh.visible = false;
    }
  }

  /**
   * Per-frame driver. Runs every frame regardless of running state, like
   * the clouds: the weather does not stop because the simulation is paused.
   * Rain is weighted by Sim.state.stormRamp (see windFactor()/updateRain()),
   * so it is calm while standing by rather than already at the sliders'
   * full storm before the player has done anything.
   * @param {number} dt
   * @returns {void}
   */
  function updateWeather(dt) {
    if (!Weather.rain) return;
    Weather.time += dt;
    const angle = WIND_BASE_ANGLE + Math.sin(Weather.time * WIND_VEER_RATE) * WIND_VEER;
    Weather.windDir.set(Math.cos(angle), Math.sin(angle));
    const wind = windFactor();
    Weather.windStrength = wind;
    const camPos = Sim.three.camera.position;
    updateRain(dt, camPos, wind);
    updateEmbers(dt, camPos, wind);
    updateShafts(dt);
  }

  /** @returns {void} */
  function disposeWeather() {
    if (!Weather.group) return;
    Sim.three.scene.remove(Weather.group);
    Weather.rain.geometry.dispose();
    Weather.rain.material.dispose();
    const shaftGeometry = Weather.shafts[0] && Weather.shafts[0].meshes[0].geometry;
    for (const slot of Weather.shafts) for (const m of slot.materials) m.dispose();
    if (shaftGeometry) shaftGeometry.dispose();
    disposeParticlePool(Sim.three.scene, Weather.embers);
    Weather.group = null;
  }

  return { Weather, initWeather, updateWeather, onLightningStrike, disposeWeather };
}
