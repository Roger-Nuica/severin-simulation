// @ts-check
import * as THREE from 'three';
import { lightningPath, BOLT_VERTEX, BOLT_FRAGMENT } from './environment/powerLines.js';

/**
 * ===========================================================================
 * SECTION AN — EMP-charged funnels
 * ===========================================================================
 * A tornado that brings a power line down absorbs the discharge. When a pole
 * falls or a span is cut (environment/powerLines.js calls lineDown) within a
 * funnel's pull radius, that funnel is EMP-charged for EMP.seconds:
 * `Vortex.empCharged` is set, it crackles with blue-white arcs up and round
 * its surface -- the power lines' own midpoint-displacement bolts
 * (powerLines.js lightningPath and bolt shader), drawn on the funnel instead
 * of between poles -- takes on the Electric Tornado's cold blue tint
 * (Vortex.electric, vortex.js applyFlash) and hums (sound/empHum.js). Left
 * alone, the charge runs out and it fades back to an ordinary funnel.
 *
 * It kills Terminators two ways. One walking into it dies (lethalAt): the
 * squad's machines (terminator.js) and Hero Mode's pursuer (heroMode.js)
 * both ask. And a charged funnel discharges: the moment it takes the charge,
 * and every EMP.waveEvery seconds while it holds it, it sends an EMP wave --
 * a ring of light across the ground, like the Electric Tornado's -- out to
 * EMP.waveRadius, and any Terminator the ring passes over shorts out
 * (terminator.js and heroMode.js empSweep). Before the wave there was only
 * the walk-in, and a pursuer that never quite followed Roger into the
 * funnel's pull was never killed. A funnel the Hero Mode beam puts out
 * loses its charge with it.
 */

const EMP = {
  seconds: 10,
  fadeSeconds: 1.5,
  chargeReach: 1.8,        // of the funnel radius: its pull radius, as physics.js has it
  killReach: 1.8,          // likewise, for a Terminator walking into it
  glow: 0.95,              // Vortex.electric while fully charged
  // The arcs.
  boltsPerFunnel: 7,
  boltLife: [0.08, 0.2],
  boltLevels: 4,
  boltRoughness: 0.3,
  boltWidth: 1.2,
  core: new THREE.Color(4.5, 5, 5.5),
  glowColour: new THREE.Color(0.35, 1.5, 3.2),
  // A burst of arcs round a point (arcAround), for a machine shorting out.
  burstBolts: 5,
  // The discharge wave.
  waveRadius: 240,
  waveSpeed: 200,          // world units/sec the ring runs out at
  waveEvery: 3.5,          // seconds between two while the charge holds
  waveMax: 4
};

const BOLT_POINTS = (1 << EMP.boltLevels) + 1;

/**
 * @param {number[]} range
 * @returns {number}
 */
function between(range) {
  return range[0] + Math.random() * (range[1] - range[0]);
}

/**
 * @param {Object} ctx
 * @returns {{
 *   initEmpCharge: () => void,
 *   updateEmpCharge: (dt: number) => void,
 *   lineDown: (x: number, z: number) => void,
 *   lethalAt: (x: number, z: number) => Object|null,
 *   chargedTimeLeft: () => number,
 *   arcAround: (at: THREE.Vector3, height: number) => void,
 *   waveRings: () => {x: number, z: number, radius: number, strength: number}[],
 *   resetEmpCharge: () => void,
 *   disposeEmpCharge: () => void
 * }}
 */
export function createEmpChargeSystem(ctx) {
  const { Sim } = ctx;

  /**
   * @typedef {Object} Arc
   * @property {THREE.Mesh} mesh
   * @property {THREE.ShaderMaterial} material
   * @property {THREE.Vector3[]} path
   * @property {number} life
   */
  /** @type {Arc[]} */
  const arcs = [];
  /**
   * The discharge waves in flight: a fixed pool of ground rings.
   * @type {{mesh: THREE.Mesh, x: number, z: number, radius: number, alive: boolean}[]}
   */
  const waves = [];
  const tangent = new THREE.Vector3();
  const toCamera = new THREE.Vector3();
  const side = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  /** @returns {void} */
  function initEmpCharge() {
    const uvs = new Float32Array(BOLT_POINTS * 4);
    /** @type {number[]} */
    const indices = [];
    for (let i = 0; i < BOLT_POINTS; i++) {
      uvs.set([0, i / (BOLT_POINTS - 1), 1, i / (BOLT_POINTS - 1)], i * 4);
      if (i < BOLT_POINTS - 1) indices.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    }
    const count = EMP.boltsPerFunnel * 3 + EMP.burstBolts * 2;
    for (let n = 0; n < count; n++) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOLT_POINTS * 6), 3)
        .setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uCore: { value: EMP.core },
          uGlow: { value: EMP.glowColour },
          uOpacity: { value: 0 }
        },
        vertexShader: BOLT_VERTEX,
        fragmentShader: BOLT_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `empCharge_arc_${n}`;
      mesh.frustumCulled = false;
      mesh.visible = false;
      Sim.three.scene.add(mesh);
      arcs.push({ mesh, material, path: [], life: 0 });
    }
    const ringGeo = new THREE.RingGeometry(0.97, 1, 128);
    ringGeo.rotateX(-Math.PI / 2);
    for (let n = 0; n < EMP.waveMax; n++) {
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.5, 2.2, 4), transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      }));
      mesh.name = `empCharge_wave_${n}`;
      mesh.frustumCulled = false;
      mesh.visible = false;
      Sim.three.scene.add(mesh);
      waves.push({ mesh, x: 0, z: 0, radius: 0, alive: false });
    }
  }

  /**
   * A discharge from a charged funnel: a ring sent out across the ground.
   * @param {Object} v the Vortex
   * @returns {void}
   */
  function fireWave(v) {
    const wave = waves.find(w => !w.alive) || waves[0];
    wave.alive = true;
    wave.x = v.center.x;
    wave.z = v.center.z;
    wave.radius = 1;
    wave.mesh.position.set(wave.x, 0.6, wave.z);
    wave.mesh.visible = true;
    ctx.systems.lightning.flashScreen(a.set(wave.x, 12, wave.z), 0.3, '#bfe8ff');
    if (ctx.systems.powerArcSound) ctx.systems.powerArcSound.playZap(0.8);
  }

  /**
   * The rings running out, and every Terminator they pass shorted out.
   * @param {number} dt
   * @returns {void}
   */
  function updateWaves(dt) {
    for (const wave of waves) {
      if (!wave.alive) continue;
      wave.radius += EMP.waveSpeed * dt;
      const k = Math.max(0, 1 - wave.radius / EMP.waveRadius);
      wave.mesh.scale.setScalar(wave.radius);
      wave.mesh.material.opacity = 0.9 * k * (0.8 + 0.2 * Math.random());
      if (ctx.systems.terminator) ctx.systems.terminator.empSweep(wave.x, wave.z, wave.radius);
      ctx.events.emit('empPulse', { x: wave.x, z: wave.z, radius: wave.radius });
      if (wave.radius >= EMP.waveRadius) {
        wave.alive = false;
        wave.mesh.visible = false;
      }
    }
  }

  /**
   * For the minimap, drawn like the Electric Tornado's ring.
   * @returns {{x: number, z: number, radius: number, strength: number}[]}
   */
  function waveRings() {
    return waves.filter(w => w.alive)
      .map(w => ({ x: w.x, z: w.z, radius: w.radius, strength: Math.max(0, 1 - w.radius / EMP.waveRadius) }));
  }

  /**
   * The funnel's world shape, read off its group's transform the way
   * electricStorm.js does, so the arcs sit on its surface at any size.
   * @param {Object} instance a tornado registry instance
   * @returns {{height: number, radiusAt: (y: number) => number}}
   */
  function funnelShape(instance) {
    const v = instance.Vortex;
    const horizontal = v.group.scale.x;
    const vertical = v.group.scale.y;
    return {
      height: v.height * vertical,
      radiusAt: (y) => instance.funnelRadiusAt(y / vertical) * horizontal
    };
  }

  /**
   * One arc from `from` to `to`, in a free slot or the oldest.
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} to
   * @returns {void}
   */
  function spawnArc(from, to) {
    const arc = arcs.find(x => x.life <= 0) || arcs.reduce((p, q) => (q.life < p.life ? q : p));
    arc.path = lightningPath(from, to, EMP.boltLevels, EMP.boltRoughness);
    arc.life = between(EMP.boltLife);
    arc.mesh.visible = true;
    writeArc(arc);
  }

  /**
   * Rewrites a live arc's strip to face the camera, as powerLines.js does.
   * @param {Arc} arc
   * @returns {void}
   */
  function writeArc(arc) {
    const camera = Sim.three.camera.position;
    const pos = arc.mesh.geometry.attributes.position.array;
    const path = arc.path;
    const last = path.length - 1;
    path.forEach((p, i) => {
      tangent.subVectors(path[Math.min(i + 1, last)], path[Math.max(i - 1, 0)]);
      toCamera.subVectors(camera, p);
      const taper = 0.4 + 0.6 * Math.sin(Math.PI * i / last);
      side.crossVectors(tangent, toCamera).normalize().multiplyScalar(EMP.boltWidth * 0.5 * taper);
      pos.set([p.x + side.x, p.y + side.y, p.z + side.z, p.x - side.x, p.y - side.y, p.z - side.z], i * 6);
    });
    arc.mesh.geometry.attributes.position.needsUpdate = true;
    arc.material.uniforms.uOpacity.value = (0.6 + 0.4 * Math.random()) * Math.min(1, arc.life / 0.05);
  }

  /**
   * Arcs up and round a charged funnel's surface, some cutting inside it.
   * @param {Object} instance
   * @param {number} level 0..1 how charged
   * @returns {void}
   */
  function strikeFunnel(instance, level) {
    const shape = funnelShape(instance);
    const c = instance.Vortex.center;
    const n = Math.round(EMP.boltsPerFunnel * level);
    for (let i = 0; i < n; i++) {
      if (Math.random() > 0.55) continue;
      const y1 = shape.height * (0.03 + Math.random() * 0.8);
      const y2 = Math.min(shape.height * 0.95, y1 + 4 + Math.random() * 14);
      const a1 = Math.random() * Math.PI * 2;
      const a2 = a1 + (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 1.4);
      // Mostly on the surface; now and then through the middle of it.
      const inner = Math.random() < 0.25 ? 0.35 : 1.02;
      const r1 = shape.radiusAt(y1) * 1.02;
      const r2 = shape.radiusAt(y2) * inner;
      a.set(c.x + Math.cos(a1) * r1, y1, c.z + Math.sin(a1) * r1);
      b.set(c.x + Math.cos(a2) * r2, y2, c.z + Math.sin(a2) * r2);
      spawnArc(a, b);
    }
  }

  /**
   * A crackle of arcs round a point: a machine shorting out.
   * @param {THREE.Vector3} at its feet
   * @param {number} height how tall it is
   * @returns {void}
   */
  function arcAround(at, height) {
    for (let i = 0; i < EMP.burstBolts; i++) {
      const y1 = Math.random() * height;
      const ang = Math.random() * Math.PI * 2;
      a.set(at.x + Math.cos(ang) * 0.8, y1, at.z + Math.sin(ang) * 0.8);
      b.set(at.x + (Math.random() - 0.5) * 4, y1 + (Math.random() - 0.3) * height * 0.6, at.z + (Math.random() - 0.5) * 4);
      spawnArc(a, b);
    }
  }

  /**
   * @param {Object} v a Vortex
   * @param {number} reach of the funnel radius
   * @returns {number} its pull radius, grown in with its touchdown
   */
  function pullRadius(v, reach) {
    return Sim.params.radius * (v.sizeMul || 1) * reach * v.birth;
  }

  /**
   * A pole has come down or a span been cut at (x, z): the nearest funnel
   * with the line inside its pull takes the charge.
   * @param {number} x
   * @param {number} z
   * @returns {void}
   */
  function lineDown(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const { Vortex } of ctx.tornadoes.active) {
      if (Vortex.birth < 0.5 || Vortex.neutralized) continue;
      const d = Math.hypot(x - Vortex.center.x, z - Vortex.center.z);
      if (d < pullRadius(Vortex, EMP.chargeReach) && d < bestD) {
        bestD = d;
        best = Vortex;
      }
    }
    if (!best) return;
    const fresh = !best.empCharged;
    best.empCharged = true;
    best.empTimer = EMP.seconds;
    // Discharges at once on taking the charge.
    if (fresh) best.empWaveTimer = 0;
    if (fresh) {
      ctx.systems.lightning.flashScreen(a.set(best.center.x, 20, best.center.z), 0.35, '#bfe8ff');
      ctx.events.emit('notice', { text: '⚡ TORNADO EMP-CHARGED — its EMP waves kill the Terminator' });
    }
  }

  /**
   * The charged funnel, if any, whose pull a Terminator standing at (x, z)
   * is inside. Asked by terminator.js and heroMode.js every frame.
   * @param {number} x
   * @param {number} z
   * @returns {Object|null} the Vortex
   */
  function lethalAt(x, z) {
    for (const { Vortex } of ctx.tornadoes.active) {
      if (!Vortex.empCharged || Vortex.neutralized) continue;
      if (Math.hypot(x - Vortex.center.x, z - Vortex.center.z) < pullRadius(Vortex, EMP.killReach)) return Vortex;
    }
    return null;
  }

  /** @returns {number} seconds of charge left on the most charged funnel */
  function chargedTimeLeft() {
    let t = 0;
    for (const { Vortex } of ctx.tornadoes.active) if (Vortex.empCharged) t = Math.max(t, Vortex.empTimer);
    return t;
  }

  /**
   * After electricStorm.js, whose tint of the same funnels it tops up
   * rather than overwrites.
   * @param {number} dt
   * @returns {void}
   */
  function updateEmpCharge(dt) {
    let hum = 0;
    const stormMode = ctx.systems.electricStorm && ctx.systems.electricStorm.isActive();
    for (const instance of ctx.tornadoes.instances) {
      const v = instance.Vortex;
      let level = 0;
      if (v.empCharged) {
        v.empTimer -= dt;
        // Put out with the funnel, or simply run down.
        if (v.empTimer <= 0 || v.neutralized || !v.active) {
          v.empCharged = false;
          v.empTimer = 0;
        } else {
          level = Math.min(1, v.empTimer / EMP.fadeSeconds) * v.groundPresence;
          v.empWaveTimer = (v.empWaveTimer || 0) - dt;
          if (v.empWaveTimer <= 0) {
            v.empWaveTimer = EMP.waveEvery;
            fireWave(v);
          }
        }
      }
      const glow = level * EMP.glow * (0.8 + 0.2 * Math.random());
      v.electric = stormMode ? Math.max(v.electric, glow) : glow;
      if (level > 0) strikeFunnel(instance, level);
      hum = Math.max(hum, level);
    }
    for (const arc of arcs) {
      if (arc.life <= 0) continue;
      arc.life -= dt;
      if (arc.life <= 0) arc.mesh.visible = false;
      else writeArc(arc);
    }
    updateWaves(dt);
    // The aftermath of the player's lightning strikes (engine/
    // strikeTargeting.js) shares the one hum.
    const strikes = ctx.systems.strikeTargeting;
    ctx.systems.empHum.updateEmpHum(Math.max(hum, strikes ? strikes.humLevel() : 0));
  }

  /** @returns {void} */
  function resetEmpCharge() {
    for (const instance of ctx.tornadoes.instances) {
      instance.Vortex.empCharged = false;
      instance.Vortex.empTimer = 0;
    }
    for (const arc of arcs) {
      arc.life = 0;
      arc.mesh.visible = false;
    }
    for (const wave of waves) {
      wave.alive = false;
      wave.mesh.visible = false;
    }
    ctx.systems.empHum.updateEmpHum(0);
  }

  /** @returns {void} */
  function disposeEmpCharge() {
    for (const arc of arcs) {
      Sim.three.scene.remove(arc.mesh);
      arc.mesh.geometry.dispose();
      arc.material.dispose();
    }
    arcs.length = 0;
    if (waves.length) waves[0].mesh.geometry.dispose();
    for (const wave of waves) {
      Sim.three.scene.remove(wave.mesh);
      wave.mesh.material.dispose();
    }
    waves.length = 0;
    ctx.systems.empHum.disposeEmpHum();
  }

  return {
    initEmpCharge, updateEmpCharge, lineDown, lethalAt, chargedTimeLeft, arcAround, waveRings,
    resetEmpCharge, disposeEmpCharge
  };
}
