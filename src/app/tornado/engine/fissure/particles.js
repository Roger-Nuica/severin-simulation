/** @typedef {import('./config.js').Vent} Vent */
import * as THREE from 'three';
import { pointScaleFor, markPoolDirty } from '../particlePool.js';
import { FISSURE, CALDERA, FOUNTAIN, SPATTER, ASH, between, pointAlong } from './config.js';

/**
 * ===========================================================================
 * SECTION FS.3 — Vents, light, spatter and ash
 * ===========================================================================
 * The vents' activity, the light they and the calderas ask for, and the
 * lava spatter and ash particles.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see fissure.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createFissureParticles(ctx, S, api) {
  const { Sim } = ctx;

  /**
   * Pushes vents up as the tear reaches them and works out how brightly
   * each one is glowing.
   * @param {number} dt
   * @param {number} glow
   * @returns {void}
   */
  function updateVents(dt, glow) {
    const epicentreLava = S.fissures.reduce((m, f) => Math.max(m, f.lava.value), 0);
    const anyGrowing = S.fissures.some(f => f.growthProgress > 0.15);
    for (const vent of S.vents) {
      // A vent the flood has put out stays out: the strength envelope below
      // would otherwise light it again the moment the next tremor came
      // through (see quench).
      if (vent.quenched) continue;
      if (!vent.fissure) vent.lava.value = epicentreLava;
      if (!vent.active) {
        vent.active = vent.fissure ? vent.fissure.reveal.value >= vent.along : anyGrowing;
        vent.mesh.visible = vent.active;
        if (!vent.active) continue;
        ctx.systems.powerLines.faultAt(vent.x, vent.z, vent.radius + FISSURE.poleFaultMargin);
      }
      vent.rise = Math.min(1, vent.rise + dt / FISSURE.ventRise);
      vent.mesh.scale.y = vent.radius * FISSURE.ventHeight * THREE.MathUtils.smoothstep(vent.rise, 0, 1) + 0.001;
      vent.level = vent.rise * vent.lava.value * glow;
    }
  }

  /**
   * Asks the shared light budget for a light at every glowing vent; the pool
   * decides which get one (the brightest, which favours the big epicentre).
   * @returns {void}
   */
  /**
   * One light for the newest crater, well above a vent's: a lake this size is
   * the brightest thing on the map while it is molten.
   * @returns {void}
   */
  function requestCalderaLight() {
    const caldera = S.calderas.length ? S.calderas[S.calderas.length - 1] : null;
    if (!caldera || caldera.glow.value <= 0.03) return;
    ctx.systems.lightPool.requestLight({
      x: caldera.x,
      y: CALDERA.lakeY + 2.5,
      z: caldera.z,
      colour: FISSURE.lightColour,
      intensity: CALDERA.lightPeak * caldera.glow.value,
      distance: CALDERA.lightDistance,
      priority: CALDERA.lightPriority
    });
  }

  function requestVentLights() {
    const { requestLight } = ctx.systems.lightPool;
    for (const vent of S.vents) {
      if (!vent.active || vent.level <= 0.01) continue;
      const phase = vent.seed * 40;
      const flicker = 0.8 + 0.12 * Math.sin(S.time * 13 + phase) + 0.08 * Math.sin(S.time * 23 + phase * 1.3);
      requestLight({
        x: vent.x, y: FISSURE.lightHeight, z: vent.z,
        colour: FISSURE.lightColour,
        intensity: FISSURE.lightPeak * vent.level * flicker * Math.min(1, vent.radius / FISSURE.ventRadius[1]),
        distance: FISSURE.lightDistance,
        priority: FISSURE.lightPriority
      });
    }
  }

  /**
   * One gob of lava thrown up from a ground point.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {void}
   */
  function spawnSpatter(x, y, z, fountain = false) {
    const p = S.spatter;
    const i = p.next;
    p.next = (p.next + 1) % SPATTER.max;
    const angle = Math.random() * Math.PI * 2;
    // The fountain throws from the same pool under the same gravity; it just
    // throws much harder and much straighter up, which is the whole
    // difference between spatter off a seam and a volcanic jet.
    const speed = between(fountain ? FOUNTAIN.spread : SPATTER.spread);
    const jitter = fountain ? 1.4 : 0.6;
    p.positions[i * 3] = x + (Math.random() - 0.5) * jitter;
    p.positions[i * 3 + 1] = y;
    p.positions[i * 3 + 2] = z + (Math.random() - 0.5) * jitter;
    p.velocities[i * 3] = Math.cos(angle) * speed;
    p.velocities[i * 3 + 1] = between(fountain ? FOUNTAIN.rise : SPATTER.rise);
    p.velocities[i * 3 + 2] = Math.sin(angle) * speed;
    p.life[i] = p.maxLife[i] = between(fountain ? FOUNTAIN.life : SPATTER.life);
    // Carried into the draw so a fountain blob is drawn bigger than a fleck
    // of seam spatter (see the spatter update, which scales by seed).
    p.seed[i] = fountain ? 1 : Math.random();
  }

  /**
   * One puff of ash drifting up off a vent.
   * @param {Vent} vent
   * @returns {void}
   */
  function spawnAsh(vent) {
    const p = S.ash;
    const i = p.next;
    p.next = (p.next + 1) % ASH.max;
    p.positions[i * 3] = vent.x + (Math.random() - 0.5) * vent.radius;
    p.positions[i * 3 + 1] = vent.mesh.scale.y + 0.3;
    p.positions[i * 3 + 2] = vent.z + (Math.random() - 0.5) * vent.radius;
    p.velocities[i * 3] = (Math.random() - 0.5) * 0.8;
    p.velocities[i * 3 + 1] = 0.8 + Math.random() * 0.8;
    p.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
    p.life[i] = p.maxLife[i] = between(ASH.life);
    p.seed[i] = Math.random();
  }

  /**
   * Spatter from vents and from the seams of opened fissures, ash from
   * vents only, both at rates that follow the eruption's level.
   * @param {number} dt
   * @param {number} level 0..1
   * @returns {void}
   */
  function emit(dt, level) {
    const live = S.vents.filter(v => v.active && v.level > 0.02);
    const open = S.fissures.filter(f => f.lava.value > 0);
    S.spatterAccumulator += SPATTER.rate * level * dt;
    while (S.spatterAccumulator >= 1) {
      S.spatterAccumulator -= 1;
      if (live.length && (Math.random() < SPATTER.ventShare || !open.length)) {
        const vent = live[Math.floor(Math.random() * live.length)];
        spawnSpatter(vent.x, vent.mesh.scale.y + 0.1, vent.z);
      } else if (open.length) {
        const at = pointAlong(open[Math.floor(Math.random() * open.length)], Math.random() * 0.85);
        spawnSpatter(at.x, FISSURE.y + 0.1, at.z);
      }
    }
    // The fountain: a sustained jet out of the crater, which is the one vent
    // with no parent fissure (see the epicentre vent in erupt). This is what
    // separates an eruption from a glowing crack in the floor, so it emits on
    // its own budget rather than competing with the seam spatter above.
    const crater = live.find(v => !v.fissure);
    if (crater) {
      S.fountainAccumulator += FOUNTAIN.rate * level * dt;
      while (S.fountainAccumulator >= 1) {
        S.fountainAccumulator -= 1;
        spawnSpatter(crater.x, crater.mesh.scale.y + 0.2, crater.z, true);
      }
    } else {
      S.fountainAccumulator = 0;
    }

    // Bubbles bursting on the lake. The bursts themselves are drawn by the
    // lake shader, which this cannot see into -- so this throws spatter from
    // random points across the surface at a rate that follows the same glow,
    // which is what the bursts are keyed to as well. The two line up closely
    // enough that the spatter reads as coming from them.
    const molten = S.calderas.length ? S.calderas[S.calderas.length - 1] : null;
    if (molten && molten.glow.value > 0.05) {
      S.burstAccumulator += CALDERA.burstRate * molten.glow.value * dt;
      while (S.burstAccumulator >= 1) {
        S.burstAccumulator -= 1;
        const a = Math.random() * Math.PI * 2;
        // Square-rooted, so the points are spread evenly over the disc rather
        // than bunched at its centre.
        const rr = Math.sqrt(Math.random()) * molten.lakeR * molten.rise;
        spawnSpatter(
          molten.x + Math.cos(a) * rr,
          CALDERA.lakeY + 0.2,
          molten.z + Math.sin(a) * rr
        );
      }
    } else {
      S.burstAccumulator = 0;
    }

    S.ashAccumulator += ASH.rate * level * dt;
    while (S.ashAccumulator >= 1) {
      S.ashAccumulator -= 1;
      if (live.length) spawnAsh(live[Math.floor(Math.random() * live.length)]);
    }
  }

  /**
   * Arcs spatter under gravity, cooling it from yellow through red to
   * black, and lets ash rise and spread. Spatter dies where it lands.
   * @param {number} dt
   * @returns {void}
   */
  function updateParticles(dt) {
    S.particlesAlive = 0;
    const s = S.spatter;
    for (let i = 0; i < SPATTER.max; i++) {
      if (s.life[i] <= 0) continue;
      s.life[i] -= dt;
      s.velocities[i * 3 + 1] -= SPATTER.gravity * dt;
      for (let k = 0; k < 3; k++) s.positions[i * 3 + k] += s.velocities[i * 3 + k] * dt;
      if (s.life[i] <= 0 || (s.positions[i * 3 + 1] < 0.05 && s.velocities[i * 3 + 1] < 0)) {
        s.life[i] = 0;
        s.colours[i * 4 + 3] = 0;
        s.sizes[i] = 0;
        continue;
      }
      S.particlesAlive++;
      const u = 1 - s.life[i] / s.maxLife[i];
      const c = u < 0.4
        ? S.scratch.copy(SPATTER.hot).lerp(SPATTER.warm, u / 0.4)
        : S.scratch.copy(SPATTER.warm).lerp(SPATTER.cold, Math.min(1, (u - 0.4) / 0.45));
      s.colours[i * 4] = c.r;
      s.colours[i * 4 + 1] = c.g;
      s.colours[i * 4 + 2] = c.b;
      s.colours[i * 4 + 3] = Math.min(1, s.life[i] / 0.2);
      // Fountain blobs carry seed 1 (see spawnSpatter) and so come out at the
      // top of this range, reading as lumps of thrown lava rather than as the
      // flecks the seams spit.
      s.sizes[i] = (s.seed[i] >= 1 ? FOUNTAIN.size : SPATTER.size)
        * (0.6 + 0.8 * s.seed[i]) * (1 - 0.35 * u);
    }

    const a = S.ash;
    const damping = Math.exp(-ASH.drag * dt);
    for (let i = 0; i < ASH.max; i++) {
      if (a.life[i] <= 0) continue;
      a.life[i] -= dt;
      if (a.life[i] <= 0) {
        a.colours[i * 4 + 3] = 0;
        a.sizes[i] = 0;
        continue;
      }
      S.particlesAlive++;
      a.velocities[i * 3 + 1] -= ASH.gravity * dt;
      for (let k = 0; k < 3; k++) {
        a.velocities[i * 3 + k] *= damping;
        a.positions[i * 3 + k] += a.velocities[i * 3 + k] * dt;
      }
      const u = 1 - a.life[i] / a.maxLife[i];
      a.colours[i * 4] = ASH.colour.r;
      a.colours[i * 4 + 1] = ASH.colour.g;
      a.colours[i * 4 + 2] = ASH.colour.b;
      a.colours[i * 4 + 3] = 0.5 * Math.min(1, u / 0.15) * (1 - u);
      a.sizes[i] = ASH.size * (0.6 + 0.6 * a.seed[i]) * (0.6 + u);
    }

    markPoolDirty(S.spatter);
    markPoolDirty(S.ash);
    const scale = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    S.spatter.points.material.uniforms.uScale.value = scale;
    S.ash.points.material.uniforms.uScale.value = scale;
  }

  return { updateVents, requestCalderaLight, requestVentLights, spawnSpatter, spawnAsh, emit, updateParticles };
}
