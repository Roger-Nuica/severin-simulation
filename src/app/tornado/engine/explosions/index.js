// @ts-check
import * as THREE from 'three';
import { createSoftDotTexture, createFireTexture, createShockRingTexture } from '../../utils/textures.js';
import { createParticlePool, markPoolDirty, disposeParticlePool } from '../particlePool.js';

/**
 * ===========================================================================
 * SECTION O — Explosions
 * ===========================================================================
 * A full fireball explosion fired wherever the tornado destroys something:
 * a building shedding a roof or wall piece (and a much bigger one when it
 * collapses), a tree being uprooted, a car being swept off the ground, and
 * any object the first time it's pulled up into the orbiting column.
 *
 * Five layers, deliberately staged so the explosion evolves rather than
 * just appearing and fading:
 *   1. a shockwave ring that snaps outward and is gone in a third of a second
 *   2. a fireball core of overlapping additive sprites, expanding fast
 *   3. burning fire particles thrown radially out of the core
 *   4. bright embers that arc out under gravity and outlive the flame
 *   5. a dark smoke plume that rises, expands and lingers after the fire dies
 *
 * The fire layers use AdditiveBlending, which is what actually makes fire
 * look hot: overlapping particles accumulate toward white at the core
 * instead of averaging to a flat wash. The smoke deliberately does not --
 * it's on NormalBlending so it reads as opaque soot occluding the scene, and
 * so the plume darkens the fireball as it takes over rather than brightening
 * it. The point light spikes hard and warm to throw real firelight onto the
 * surrounding geometry, and close/large blasts also shake the camera,
 * reusing the existing lightning shake rather than duplicating it.
 *
 * Everything is pooled and allocated once at init; nothing here allocates
 * during a storm. The particles of every slot share two systems -- the hot
 * ones (fire and embers, additive) and the smoke -- from particlePool.js,
 * which takes size and alpha per particle, so explosions of different ages
 * still fade and grow independently: each slot owns a fixed run of each
 * system and writes its layers' size and alpha into it. They used to be
 * three Points per slot, each with its own material: 34 explosions at once
 * in a busy run (the nuclear plants, the mothership) was a hundred draws
 * for the particles alone (measured, performance pass). The fireball and
 * shock ring sprites stay one per slot: they live under half a second.
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   ImpactBursts: Object,
 *   initImpactBursts: () => void,
 *   spawnImpactBurst: (position: THREE.Vector3, strength?: number) => void,
 *   updateImpactBursts: (dt: number) => void,
 *   resetImpactBursts: () => void,
 *   disposeImpactBursts: () => void
 * }}
 */
export function createExplosionsSystem(ctx) {
  const { Sim, Lightning } = ctx;
  const { playImpactSound } = ctx.systems.impact;

  // Raised from 24 for the mothership crash and the nuclear plants
  // (explosions/megaBlast.js), which run many big ones at once.
  const BURST_SLOT_COUNT = 36;    // concurrent explosions; the next one recycles the oldest slot
  const BURST_FIRE_COUNT = 18;    // burning particles thrown out of the core
  const BURST_EMBER_COUNT = 14;   // small, bright, gravity-bound
  const BURST_SMOKE_COUNT = 28;   // dark plume, outlives everything else
  const BURST_FIREBALL_SPRITES = 3;
  // Fixed light count, created once: the number of lights in the scene is
  // baked into every material's compiled shader, so spawning/removing lights
  // per explosion would trigger a shader recompile mid-storm.
  const BURST_FLASH_LIGHTS = 3;

  // Sub-effect durations, all in seconds and all measured from the moment of
  // detonation. The slot's own maxLife is governed by the smoke, which is by
  // far the longest-lived layer.
  const BURST_SHOCK_DURATION = 0.3;
  const BURST_FIREBALL_DURATION = 0.42;
  const BURST_FIRE_DURATION = 0.55;
  const BURST_EMBER_DURATION = 0.95;
  const BURST_FLASH_DURATION = 0.3;

  // Peak candela for the fireball light. Calibrated against the lightning
  // flash, which runs at 220..1120 with decay 1.15 from y=80 -- roughly 1.5
  // effective at ground level against a 1.3-intensity sun. With decay 2 here,
  // 260 gives ~16 at 4m and ~2.6 at 10m: genuinely bright firelight close up,
  // still clearly visible across a street, and nothing at all a block away.
  const BURST_FLASH_PEAK = 260;
  const BURST_FIRE_GRAVITY = -2.5;  // negative: flame is buoyant and rises
  const BURST_EMBER_GRAVITY = 9;
  const BURST_SMOKE_GRAVITY = -1.6; // buoyant, slower than flame
  // Per-second velocity retention, applied as pow(drag, dt) for frame-rate
  // independence. Fire is checked hard (a fireball stalls almost as soon as it
  // forms); embers keep far more of their speed so they visibly arc away.
  const BURST_FIRE_DRAG = 0.05;
  const BURST_EMBER_DRAG = 0.55;
  const BURST_SMOKE_DRAG = 0.08;

  const ImpactBursts = {
    slots: /** @type {Object[]} */ ([]),
    lights: /** @type {{light:THREE.Object3D, life:number, peak:number}[]} */ ([]),
    nextSlot: 0,
    nextLight: 0
  };

  // The two shared particle systems (see the header), made in init.
  /** @type {import('../particlePool.js').ParticlePool|null} */
  let hotPool = null;
  /** @type {import('../particlePool.js').ParticlePool|null} */
  let smokePool = null;
  const bufferSize = new THREE.Vector2();

  /**
   * One layer of one slot (its fire, embers or smoke): a fixed run of
   * particles in a shared pool. `positions` is a view into the pool's own
   * buffer, so moving them moves what is drawn.
   * @param {import('../particlePool.js').ParticlePool} pool
   * @param {number} start first particle of the run
   * @param {number} count
   * @param {number} size world size, as PointsMaterial's size was
   * @param {number} colour
   * @param {number} opacity
   * @returns {{pool: Object, start: number, count: number, positions: Float32Array, velocities: Float32Array, colour: THREE.Color, baseSize: number, baseOpacity: number}}
   */
  function burstLayer(pool, start, count, size, colour, opacity) {
    return {
      pool, start, count,
      positions: pool.positions.subarray(start * 3, (start + count) * 3),
      velocities: new Float32Array(count * 3),
      colour: new THREE.Color(colour),
      baseSize: size,
      baseOpacity: opacity
    };
  }

  /**
   * Writes a layer's colour, alpha and size into its run of the pool.
   * @param {ReturnType<typeof burstLayer>} layer
   * @param {number} alpha 0 hides it
   * @param {number} size
   * @returns {void}
   */
  function paintLayer(layer, alpha, size) {
    const { colours, sizes } = layer.pool;
    const { r, g, b } = layer.colour;
    for (let i = layer.start, end = layer.start + layer.count; i < end; i++) {
      colours[i * 4] = r;
      colours[i * 4 + 1] = g;
      colours[i * 4 + 2] = b;
      colours[i * 4 + 3] = alpha;
      sizes[i] = size;
    }
  }

  /**
   * @param {Object} slot
   * @returns {void} the slot's particles hidden
   */
  function hideSlotParticles(slot) {
    paintLayer(slot.fire, 0, 0);
    paintLayer(slot.ember, 0, 0);
    paintLayer(slot.smoke, 0, 0);
  }

  /**
   * Allocates the explosion slot pool and the shared flash lights, all parked
   * inactive until spawnImpactBurst() claims one.
   * @returns {void}
   */
  function initImpactBursts() {
    const dotTexture = createSoftDotTexture();
    const fireTexture = createFireTexture();
    const ringTexture = createShockRingTexture();

    const hotPerSlot = BURST_FIRE_COUNT + BURST_EMBER_COUNT;
    hotPool = createParticlePool(
      Sim.three.scene, BURST_SLOT_COUNT * hotPerSlot, fireTexture, THREE.AdditiveBlending,
      'explosionParticles_fire', { alphaFromGreen: true }
    );
    // Smoke stays on NormalBlending so the plume actually occludes what's
    // behind it; additive smoke would brighten the scene instead of sooting
    // it, which is the single biggest giveaway of a fake explosion.
    smokePool = createParticlePool(
      Sim.three.scene, BURST_SLOT_COUNT * BURST_SMOKE_COUNT, dotTexture, THREE.NormalBlending,
      'explosionParticles_smoke', { alphaFromGreen: true }
    );

    for (let i = 0; i < BURST_SLOT_COUNT; i++) {
      const fire = burstLayer(hotPool, i * hotPerSlot, BURST_FIRE_COUNT, 1.6, 0xffb057, 0.95);
      const ember = burstLayer(hotPool, i * hotPerSlot + BURST_FIRE_COUNT, BURST_EMBER_COUNT, 0.42, 0xffd9a0, 1);
      const smoke = burstLayer(smokePool, i * BURST_SMOKE_COUNT, BURST_SMOKE_COUNT, 2.2, 0x2b2622, 0.65);

      // One shared material across this slot's fireball sprites: they all fade
      // together, and only their scales and offsets differ.
      const fireballMat = new THREE.SpriteMaterial({
        map: fireTexture,
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending
      });
      const fireballs = [];
      for (let j = 0; j < BURST_FIREBALL_SPRITES; j++) {
        const sprite = new THREE.Sprite(fireballMat);
        sprite.name = `explosionFireball_${i}_${j}`;
        sprite.visible = false;
        fireballs.push(sprite);
        Sim.three.scene.add(sprite);
      }

      const shock = new THREE.Sprite(new THREE.SpriteMaterial({
        map: ringTexture,
        color: 0xffd9a8,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending
      }));
      shock.name = `explosionShockRing_${i}`;
      shock.visible = false;

      Sim.three.scene.add(shock);
      ImpactBursts.slots.push({
        active: false, life: 0, maxLife: 1, strength: 1,
        origin: new THREE.Vector3(),
        fire, ember, smoke, fireballs, fireballMat, shock,
        fireballOffsets: /** @type {THREE.Vector3[]} */ ([
          new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()
        ]),
        fireballScales: /** @type {number[]} */ ([1, 1, 1])
      });
    }

    for (let i = 0; i < BURST_FLASH_LIGHTS; i++) {
      const light = ctx.systems.lightPool.createLight(0xffa347, 0, 60, 2);
      light.name = `explosionFlashLight_${i}`;
      Sim.three.scene.add(light);
      ImpactBursts.lights.push({ light, life: 0, peak: 0 });
    }
  }

  /**
   * Seeds one sub-system's particles at the blast point with outward
   * velocities. Directions are sampled uniformly on a sphere and then bent
   * upward by `upBias`, so material is thrown up and out of the blast instead
   * of half of it firing straight into the ground where it would never be
   * seen. The bias deliberately leaves the vectors non-unit, which gives a
   * natural spread of speeds for free.
   * @param {{positions:Float32Array, velocities:Float32Array}} sys
   * @param {THREE.Vector3} origin
   * @param {number} minSpeed
   * @param {number} maxSpeed
   * @param {number} upBias 0 = raw sphere, 1 = fully upper hemisphere
   * @param {number} jitter positional scatter around the blast point
   * @returns {void}
   */
  function seedBurstParticles(sys, origin, minSpeed, maxSpeed, upBias, jitter) {
    const { positions, velocities } = sys;
    const count = positions.length / 3;
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const y = Math.random() * 2 - 1;
      const horiz = Math.sqrt(Math.max(0, 1 - y * y));
      const dirY = y * (1 - upBias) + Math.abs(y) * upBias;
      const speed = minSpeed + Math.random() * (maxSpeed - minSpeed);
      velocities[i * 3] = Math.cos(theta) * horiz * speed;
      velocities[i * 3 + 1] = dirY * speed;
      velocities[i * 3 + 2] = Math.sin(theta) * horiz * speed;
      positions[i * 3] = origin.x + (Math.random() - 0.5) * jitter;
      positions[i * 3 + 1] = origin.y + (Math.random() - 0.5) * jitter;
      positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * jitter;
    }
  }

  /**
   * Detonates one explosion at a world position. `strength` (~0.4 .. 2) scales
   * blast radius, fireball size, light output and sound together, so a
   * building collapsing reads far bigger than a chip of debris being drawn
   * into the column without each call site needing its own tuning.
   *
   * Slots are claimed round-robin and overwritten unconditionally, so a storm
   * dense enough to saturate the pool cuts the oldest explosion short rather
   * than allocating or dropping the newest -- the newest is always the one the
   * player is most likely to be looking at.
   * @param {THREE.Vector3} position
   * @param {number} [strength]
   * @returns {void}
   */
  function spawnImpactBurst(position, strength = 1) {
    if (!ImpactBursts.slots.length) return;
    // Ceiling raised from 2 for the fuel tanker (environment/tanker.js),
    // whose detonation is meant to read as comparable to the funnel itself.
    // Everything else still asks for 0.6-2.6, so the range below 2 is
    // unchanged and nothing else is affected by this.
    // Raised again, to 60, for the tanker at six times and the chemical works
    // at five times their original blasts.
    const s = THREE.MathUtils.clamp(strength, 0.4, 60);

    const slot = ImpactBursts.slots[ImpactBursts.nextSlot];
    ImpactBursts.nextSlot = (ImpactBursts.nextSlot + 1) % BURST_SLOT_COUNT;
    slot.active = true;
    slot.life = 0;
    // Governed by the smoke plume, which long outlives the flame.
    slot.maxLife = 1.6 + Math.random() * 0.6;
    slot.strength = s;
    slot.origin.copy(position);

    seedBurstParticles(slot.fire, position, 3 * s, 9 * s, 0.35, 0.4 * s);
    seedBurstParticles(slot.ember, position, 8 * s, 18 * s, 0.55, 0.3 * s);
    seedBurstParticles(slot.smoke, position, 1.5 * s, 5 * s, 0.5, 0.6 * s);

    // Fireball core: overlapping sprites at small random offsets and differing
    // scales, so the core is a lumpy mass rather than one obvious circle.
    for (let j = 0; j < BURST_FIREBALL_SPRITES; j++) {
      slot.fireballOffsets[j].set(
        (Math.random() - 0.5) * 0.7 * s,
        (Math.random() - 0.5) * 0.5 * s + 0.2 * s,
        (Math.random() - 0.5) * 0.7 * s
      );
      slot.fireballScales[j] = (0.75 + Math.random() * 0.5) * s;
      slot.fireballs[j].position.copy(position).add(slot.fireballOffsets[j]);
      slot.fireballs[j].visible = true;
    }
    slot.fireballMat.opacity = 0;

    slot.shock.position.copy(position);
    slot.shock.visible = true;
    slot.shock.material.opacity = 0;

    const entry = ImpactBursts.lights[ImpactBursts.nextLight];
    ImpactBursts.nextLight = (ImpactBursts.nextLight + 1) % BURST_FLASH_LIGHTS;
    entry.light.position.set(position.x, position.y + 0.6, position.z);
    entry.peak = BURST_FLASH_PEAK * s;
    entry.life = 0;
    entry.light.intensity = entry.peak;

    // Camera shake for big, close blasts, reusing the lightning shake rather
    // than duplicating the machinery -- updateLightning() already applies it
    // every frame, after the controls have had their say. Taking the max
    // rather than overwriting means an explosion can't cut short a stronger
    // shake already running from a nearby lightning strike.
    const distance = Sim.three.camera.position.distanceTo(position);
    const proximity = 1 - THREE.MathUtils.clamp(distance / 90, 0, 1);
    const shakeMag = proximity * proximity * s * 0.22;
    if (shakeMag > Lightning.shake.magnitude * (Lightning.shake.timer > 0 ? 1 : 0)) {
      Lightning.shake.magnitude = shakeMag;
      Lightning.shake.duration = 0.18 + s * 0.12;
      Lightning.shake.timer = Lightning.shake.duration;
    }

    playImpactSound(s, distance);
  }

  /**
   * Integrates one sub-system's particles for a frame and applies its fade.
   * Drag is applied as pow(drag, dt) rather than a raw per-frame multiply so
   * the explosion decelerates identically at 30fps and 144fps, the same
   * technique updateCockpitWheel and the chase camera use for smoothing.
   * @param {ReturnType<typeof burstLayer>} sys
   * @param {number} dt
   * @param {number} gravity negative values are buoyant (flame/smoke rise)
   * @param {number} drag
   * @param {number} fade 1 at spawn, 0 at death
   * @param {number} sizeScale
   * @returns {void}
   */
  function advanceBurstParticles(sys, dt, gravity, drag, fade, sizeScale) {
    const { positions, velocities } = sys;
    const damping = Math.pow(drag, dt);
    for (let i = 0; i < positions.length; i += 3) {
      velocities[i + 1] -= gravity * dt;
      velocities[i] *= damping;
      velocities[i + 1] *= damping;
      velocities[i + 2] *= damping;
      positions[i] += velocities[i] * dt;
      positions[i + 1] += velocities[i + 1] * dt;
      positions[i + 2] += velocities[i + 2] * dt;
      // Settle on the ground rather than sinking through it.
      if (positions[i + 1] < 0.05) {
        positions[i + 1] = 0.05;
        velocities[i + 1] = 0;
      }
    }
    paintLayer(sys, sys.baseOpacity * fade, sys.baseSize * sizeScale);
  }

  /**
   * Advances every live explosion and flash light. Called from animate()
   * whenever the sim isn't paused -- not only while it's running, since chase
   * mode can trigger one with the storm stopped (see the call site) -- so
   * pausing freezes an explosion mid-bloom rather than letting it play out
   * over a stopped storm or stranding it on screen forever.
   * @param {number} dt
   * @returns {void}
   */
  function updateImpactBursts(dt) {
    if (!hotPool || !smokePool) return;
    // PointsMaterial's own sizing: world size times half the drawing
    // buffer's height, over the distance.
    const scale = Sim.three.renderer.getDrawingBufferSize(bufferSize).y * 0.5;
    hotPool.points.material.uniforms.uScale.value = scale;
    smokePool.points.material.uniforms.uScale.value = scale;
    for (const slot of ImpactBursts.slots) {
      if (slot.active) {
        slot.life += dt;
        const t = slot.life / slot.maxLife;
        if (t >= 1) {
          slot.active = false;
          hideSlotParticles(slot);
          slot.shock.visible = false;
          for (const sprite of slot.fireballs) sprite.visible = false;
        } else {
          const s = slot.strength;

          // Fire: bright and buoyant, burning out well before the smoke does.
          const fireT = Math.min(1, slot.life / BURST_FIRE_DURATION);
          advanceBurstParticles(
            slot.fire, dt, BURST_FIRE_GRAVITY, BURST_FIRE_DRAG,
            Math.pow(1 - fireT, 1.5), s * (1 + fireT * 1.1)
          );

          // Embers: outlive the flame, arc down under real gravity, and hold
          // their brightness longer so they read as glowing debris.
          const emberT = Math.min(1, slot.life / BURST_EMBER_DURATION);
          advanceBurstParticles(
            slot.ember, dt, BURST_EMBER_GRAVITY, BURST_EMBER_DRAG,
            Math.pow(1 - emberT, 0.9), s * (1 - emberT * 0.35)
          );

          // Smoke: fades in over the first moments as the fire takes hold,
          // then billows outward and lingers for the rest of the slot's life.
          const smokeFade = Math.min(1, slot.life / 0.18) * Math.pow(1 - t, 1.3);
          advanceBurstParticles(
            slot.smoke, dt, BURST_SMOKE_GRAVITY, BURST_SMOKE_DRAG,
            smokeFade, s * (0.8 + t * 2.4)
          );

          // Fireball core: snaps open, then fades as the smoke takes over.
          const fbT = slot.life / BURST_FIREBALL_DURATION;
          if (fbT >= 1) {
            for (const sprite of slot.fireballs) sprite.visible = false;
          } else {
            // Fast early expansion easing to a stop, rather than linear growth.
            const expand = 1 - Math.pow(1 - fbT, 2.2);
            slot.fireballMat.opacity = Math.min(1, fbT / 0.08) * Math.pow(1 - fbT, 1.4);
            for (let j = 0; j < BURST_FIREBALL_SPRITES; j++) {
              const scale = slot.fireballScales[j] * (1.2 + expand * 3.4);
              slot.fireballs[j].scale.set(scale, scale, 1);
              // Drift upward as it burns, the way a real fireball lifts.
              slot.fireballs[j].position.set(
                slot.origin.x + slot.fireballOffsets[j].x,
                slot.origin.y + slot.fireballOffsets[j].y + expand * 1.1 * s,
                slot.origin.z + slot.fireballOffsets[j].z
              );
            }
          }

          // Shockwave: races out and is gone almost immediately.
          const shockT = slot.life / BURST_SHOCK_DURATION;
          if (shockT >= 1) {
            slot.shock.visible = false;
          } else {
            const ring = s * (1.5 + shockT * 9);
            slot.shock.scale.set(ring, ring, 1);
            slot.shock.material.opacity = 0.75 * Math.pow(1 - shockT, 1.6);
          }
        }
      }
    }

    for (const entry of ImpactBursts.lights) {
      if (entry.peak <= 0) continue;
      entry.life += dt;
      const lt = entry.life / BURST_FLASH_DURATION;
      if (lt >= 1) {
        entry.light.intensity = 0;
        entry.peak = 0;
      } else {
        // Squared falloff, plus a fast flicker so the firelight on nearby
        // geometry looks like combustion rather than a fading bulb.
        const flicker = 0.82 + Math.random() * 0.18;
        entry.light.intensity = entry.peak * (1 - lt) * (1 - lt) * flicker;
      }
    }
    markPoolDirty(hotPool);
    markPoolDirty(smokePool);
  }

  /**
   * Retires every live explosion immediately, called from resetSim() alongside
   * resetPathTrack()/clearSkidMarks() so a fresh run doesn't inherit the
   * previous run's fireballs and smoke hanging in mid-air.
   * @returns {void}
   */
  function resetImpactBursts() {
    for (const slot of ImpactBursts.slots) {
      slot.active = false;
      slot.life = 0;
      hideSlotParticles(slot);
      slot.shock.visible = false;
      for (const sprite of slot.fireballs) sprite.visible = false;
    }
    for (const entry of ImpactBursts.lights) {
      entry.peak = 0;
      entry.life = 0;
      entry.light.intensity = 0;
    }
    if (hotPool) markPoolDirty(hotPool);
    if (smokePool) markPoolDirty(smokePool);
  }

  /**
   * Frees the two shared particle systems (their textures with them).
   * @returns {void}
   */
  function disposeImpactBursts() {
    if (hotPool) disposeParticlePool(Sim.three.scene, hotPool);
    if (smokePool) disposeParticlePool(Sim.three.scene, smokePool);
    hotPool = null;
    smokePool = null;
  }

  return { ImpactBursts, initImpactBursts, spawnImpactBurst, updateImpactBursts, resetImpactBursts, disposeImpactBursts };
}
