// @ts-check
import * as THREE from 'three';
import { createSoftDotTexture } from '../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from './particlePool.js';
import { AIR, mayStartStrike, mayKill, nextWeapon, pickTarget, inRange } from './airSupport/plan.js';
import { buildFighterGeometry, buildFighter, REACH } from './airSupport/model.js';
import { makeSegment, setSegment, pointAt, headingAt, secondsLeft } from './airSupport/flight.js';

/**
 * ===========================================================================
 * SECTION AS — GHOST flight: air support against the aliens
 * ===========================================================================
 * Thirty seconds into a run (world time) three American stealth fighters,
 * callsigns GHOST 1-3, come in low from the horizon in a V, invisible but
 * for a glassy shimmer. Over the edge of town they drop the cloak all at
 * once (a cyan scan line runs down each from tail to nose), with a sonic
 * boom and a vapour cone round each fuselage, scream over the rooftops and
 * break left, right and up into a racetrack above the town. There they
 * stay, banking round, fading in and out of sight.
 *
 * Every so often one of them goes after an alien (R-056: never more than
 * one alien down every 5 s for the whole flight): it peels off the circle,
 * cloaked, a red lock ring appears round its target on the ground and a
 * faint red line joins the two, it decloaks as it tips into the dive, and
 * fires either
 *   - the gun: a stream of tracer rounds that walks across the ground into
 *     the alien, kicking up sparks and dust (the minigun's look, bigger), or
 *   - two rockets off the wing pylons, wobbling and trailing smoke, that
 *     land on it in two blasts,
 * then pulls out hard on afterburner with vapour off the wingtips, pops a
 * fan of flares, cloaks again and rejoins the circle. The kill goes through
 * the aliens' own plasmaKill (the burn and the score), like the other
 * weapons that call their owner directly (engine/enemies.js).
 *
 * Purely the aliens': nothing else is hit, the blasts are visual (no
 * `explosion` event, nobody hurt). Not Sim.objects. No shadows, no lights
 * added (the glow is emissive and additive), particles from two pools of
 * its own, tracked by the caps. Nothing is allocated per frame.
 */

const TRACERS = 72;
const ROCKETS = 4;
const FLARES = 16;
const SMOKE = 900;
const GLOW = 420;

/**
 * @typedef {Object} Strike
 * @property {boolean} active
 * @property {any} alien the target (alien.root.position is where it is)
 * @property {'gun'|'rockets'} weapon
 * @property {THREE.Vector3} target where the weapons aim (kept on the alien while it lives)
 * @property {THREE.Vector3} dir the dive's direction, flat
 * @property {boolean} fired
 * @property {boolean} done the hit has landed (or there was nothing to hit)
 * @property {number} burst seconds into the gun burst
 * @property {number} owed rounds owed to the gun
 * @property {number} rounds fired so far
 * @property {number} rocketsOut
 * @property {number} rocketTimer
 * @property {boolean} flares popped on the pull-out
 */

/**
 * @typedef {Object} Jet
 * @property {number} index
 * @property {string} name
 * @property {ReturnType<typeof buildFighter>} look
 * @property {'off'|'ingress'|'orbit'|'run'} mode
 * @property {THREE.Vector3} pos
 * @property {THREE.Vector3} fwd
 * @property {number} yaw
 * @property {number} bank
 * @property {number} speed
 * @property {import('./airSupport/flight.js').Segment[]} path
 * @property {number} segs
 * @property {number} seg
 * @property {number} u
 * @property {number} vis 0 cloaked .. 1 seen
 * @property {number} visGoal
 * @property {number} cloakTimer seconds to the next change while circling
 * @property {number} throttle 0..1
 * @property {number} collar seconds left of the vapour cone
 * @property {boolean} boomed
 * @property {number} seenFor seconds to stay seen after a run
 * @property {Strike} strike
 */

/**
 * @param {Object} ctx
 * @returns {{initAirSupport: () => void, updateAirSupport: (dt: number) => void, resetAirSupport: () => void,
 *   disposeAirSupport: () => void, up: () => boolean, kills: () => number, summon: () => void, debug: () => Object,
 *   buildGuestModel: () => any, replicaState: () => any[], localRoots: () => THREE.Object3D[]}}
 */
export function createAirSupportSystem(ctx) {
  const { Sim } = ctx;
  /** @type {Jet[]} */
  let jets = [];
  /** @type {ReturnType<typeof buildFighterGeometry>|null} */
  let geo = null;
  /** @type {THREE.Material[]} */
  const sharedMaterials = [];
  /** @type {THREE.BufferGeometry[]} */
  const sharedGeometries = [];
  /** @type {THREE.InstancedMesh|null} */
  let tracerMesh = null;
  /** @type {{group: THREE.Group, alive: boolean, pos: THREE.Vector3, dir: THREE.Vector3, speed: number, age: number,
   *   aim: THREE.Vector3, alien: any, killer: boolean, strike: Strike|null, wobble: number}[]} */
  let rockets = [];
  /** @type {{alive: boolean, pos: THREE.Vector3, vel: THREE.Vector3, life: number}[]} */
  let flares = [];
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let smoke = null;
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let glow = null;
  /** Per particle: size growth (m/s), fade-in alpha, gravity (m/s²), drag. */
  const smokeGrow = new Float32Array(SMOKE);
  const smokeAlpha = new Float32Array(SMOKE);
  const glowAlpha = new Float32Array(GLOW);
  const glowFall = new Float32Array(GLOW);
  const glowRGB = new Float32Array(GLOW * 3);
  const smokeShade = new Float32Array(SMOKE);
  let particlesAlive = false;
  /** @type {THREE.Mesh|null} */
  let reticle = null;
  /** @type {THREE.Mesh|null} */
  let lockLine = null;
  /** @type {Jet|null} the jet the lock ring belongs to */
  let locked = null;
  let reticleFlash = 0;

  // Tracers: from, to, age, duration; each a live round.
  const trFrom = new Float32Array(TRACERS * 3);
  const trTo = new Float32Array(TRACERS * 3);
  const trAge = new Float32Array(TRACERS);
  const trDur = new Float32Array(TRACERS);
  /** @type {(Strike|null)[]} which strike a round is the killing one for */
  const trKill = new Array(TRACERS).fill(null);
  let trNext = 0;
  let tracersAlive = false;

  let clock = 0;
  let arrived = false;
  let lastKill = -Infinity;
  /** @type {'gun'|'rockets'|null} */
  let lastWeapon = null;
  let killCount = 0;
  let orbitPhase = 0;
  let strikeCheck = 0;
  let tickerQuiet = 0;

  // Scratch.
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const v3 = new THREE.Vector3();
  const v4 = new THREE.Vector3();
  const flat = new THREE.Vector3();
  const side = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const one = new THREE.Vector3(1, 1, 1);
  const Z = new THREE.Vector3(0, 0, 1);
  const Y = new THREE.Vector3(0, 1, 0);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  /** @type {{x: number, z: number}[]} */
  const alienSpots = [];
  /** @type {any[]} */
  const alienList = [];

  /** @returns {void} */
  function initAirSupport() {
    geo = buildFighterGeometry();
    const glowMat = (/** @type {THREE.ColorRepresentation|THREE.Color} */ c, opacity = 1) => {
      const m = new THREE.MeshBasicMaterial({
        color: c, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
      });
      sharedMaterials.push(m);
      return m;
    };
    const glowSet = {
      flame: glowMat(new THREE.Color(1.6, 0.62, 0.22), 0.75),
      core: glowMat(new THREE.Color(1.4, 1.6, 2.4), 0.9),
      red: glowMat(new THREE.Color(4, 0.2, 0.15)),
      green: glowMat(new THREE.Color(0.2, 4, 0.5)),
      strobe: glowMat(new THREE.Color(5, 5, 5))
    };
    jets = [];
    for (let i = 0; i < AIR.jets; i++) {
      const look = buildFighter(geo, glowSet);
      look.group.visible = false;
      Sim.three.scene.add(look.group);
      jets.push({
        index: i, name: AIR.callsigns[i], look, mode: 'off',
        pos: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, 1), yaw: 0, bank: 0, speed: AIR.orbit.speed,
        path: [makeSegment(), makeSegment(), makeSegment(), makeSegment()], segs: 0, seg: 0, u: 0,
        vis: 0, visGoal: 0, cloakTimer: 0, throttle: 0.3, collar: 0, boomed: false, seenFor: 0,
        strike: {
          active: false, alien: null, weapon: 'gun', target: new THREE.Vector3(), dir: new THREE.Vector3(),
          fired: false, done: false, burst: 0, owed: 0, rounds: 0, rocketsOut: 0, rocketTimer: 0, flares: false
        }
      });
    }

    // Tracer rounds: long thin glowing slugs.
    const tracerGeo = new THREE.BoxGeometry(0.16, 0.16, 5.5);
    sharedGeometries.push(tracerGeo);
    tracerMesh = new THREE.InstancedMesh(tracerGeo, glowMat(new THREE.Color(3.2, 1.7, 0.45)), TRACERS);
    tracerMesh.name = 'ghostTracers';
    tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    tracerMesh.frustumCulled = false;
    for (let i = 0; i < TRACERS; i++) tracerMesh.setMatrixAt(i, zero);
    Sim.three.scene.add(tracerMesh);

    // Rockets: a white body with a dark nose and a bright motor.
    const bodyGeo = new THREE.CylinderGeometry(0.16, 0.16, 2.6, 8).rotateX(Math.PI / 2);
    const noseGeo = new THREE.ConeGeometry(0.16, 0.5, 8).rotateX(Math.PI / 2).translate(0, 0, 1.55);
    const motorGeo = new THREE.ConeGeometry(0.3, 1.8, 8, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -2.1);
    sharedGeometries.push(bodyGeo, noseGeo, motorGeo);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.5, metalness: 0.3 });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.5 });
    sharedMaterials.push(bodyMat, noseMat);
    const motorMat = glowMat(new THREE.Color(2.4, 1.3, 0.5), 0.9);
    rockets = [];
    for (let i = 0; i < ROCKETS; i++) {
      const group = new THREE.Group();
      group.name = 'ghostRocket';
      for (const [g, m] of [[bodyGeo, bodyMat], [noseGeo, noseMat], [motorGeo, motorMat]]) {
        const mesh = new THREE.Mesh(/** @type {THREE.BufferGeometry} */ (g), /** @type {THREE.Material} */ (m));
        mesh.castShadow = false;
        group.add(mesh);
      }
      group.visible = false;
      Sim.three.scene.add(group);
      rockets.push({
        group, alive: false, pos: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 0, age: 0,
        aim: new THREE.Vector3(), alien: null, killer: false, strike: null, wobble: 0
      });
    }
    flares = [];
    for (let i = 0; i < FLARES; i++) flares.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0 });

    // The lock ring on the ground: a ring and four ticks; and the red line.
    const ring = new THREE.RingGeometry(2.4, 2.75, 40);
    const ticks = [0, 1, 2, 3].map((k) => {
      const t = new THREE.PlaneGeometry(0.28, 1.3);
      t.translate(0, 3.5, 0);
      t.rotateZ((k * Math.PI) / 2);
      return t;
    });
    const parts = [ring.toNonIndexed(), ...ticks.map((t) => t.toNonIndexed())];
    for (const p of parts) p.deleteAttribute('uv');
    const reticleGeo = new THREE.BufferGeometry();
    {
      let n = 0;
      for (const p of parts) n += p.attributes.position.count;
      const pos = new Float32Array(n * 3);
      let o = 0;
      for (const p of parts) {
        pos.set(/** @type {Float32Array} */ (p.attributes.position.array), o);
        o += p.attributes.position.array.length;
        p.dispose();
      }
      reticleGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    }
    ring.dispose();
    for (const t of ticks) t.dispose();
    reticleGeo.rotateX(-Math.PI / 2);
    sharedGeometries.push(reticleGeo);
    const reticleMat = glowMat(new THREE.Color(3, 0.25, 0.15), 0.9);
    reticleMat.side = THREE.DoubleSide;
    reticle = new THREE.Mesh(reticleGeo, reticleMat);
    reticle.name = 'ghostLock';
    reticle.visible = false;
    reticle.renderOrder = 3;
    Sim.three.scene.add(reticle);
    const lineGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 5, 1, true).translate(0, 0.5, 0);
    sharedGeometries.push(lineGeo);
    lockLine = new THREE.Mesh(lineGeo, glowMat(new THREE.Color(2.5, 0.2, 0.1), 0.3));
    lockLine.name = 'ghostLockLine';
    lockLine.visible = false;
    lockLine.frustumCulled = false;
    Sim.three.scene.add(lockLine);

    smoke = createParticlePool(Sim.three.scene, SMOKE, createSoftDotTexture(), THREE.NormalBlending, 'ghost_smoke');
    glow = createParticlePool(Sim.three.scene, GLOW, createSoftDotTexture(), THREE.AdditiveBlending, 'ghost_glow');
    ctx.systems.caps.trackPool(smoke);
    ctx.systems.caps.trackPool(glow);
  }

  // ---------------------------------------------------------------------
  // Particles
  // ---------------------------------------------------------------------

  /**
   * A puff of smoke.
   * @param {THREE.Vector3} at
   * @param {number} vx @param {number} vy @param {number} vz
   * @param {number} life @param {number} size @param {number} grow
   * @param {number} shade 0 black .. 1 white
   * @param {number} alpha
   */
  function puff(at, vx, vy, vz, life, size, grow, shade, alpha) {
    if (!smoke || ctx.systems.caps.particleRoom() <= 0) return;
    const i = smoke.next;
    smoke.next = (i + 1) % SMOKE;
    smoke.life[i] = life;
    smoke.maxLife[i] = life;
    smoke.positions[i * 3] = at.x;
    smoke.positions[i * 3 + 1] = at.y;
    smoke.positions[i * 3 + 2] = at.z;
    smoke.velocities[i * 3] = vx;
    smoke.velocities[i * 3 + 1] = vy;
    smoke.velocities[i * 3 + 2] = vz;
    smoke.sizes[i] = size;
    smokeGrow[i] = grow;
    smokeShade[i] = shade;
    smokeAlpha[i] = alpha;
    particlesAlive = true;
  }

  /**
   * A spark, flare or flash: additive.
   * @param {THREE.Vector3} at
   * @param {number} vx @param {number} vy @param {number} vz
   * @param {number} life @param {number} size
   * @param {number} r @param {number} g @param {number} b
   * @param {number} fall gravity
   */
  function spark(at, vx, vy, vz, life, size, r, g, b, fall) {
    if (!glow || ctx.systems.caps.particleRoom() <= 0) return;
    const i = glow.next;
    glow.next = (i + 1) % GLOW;
    glow.life[i] = life;
    glow.maxLife[i] = life;
    glow.positions[i * 3] = at.x;
    glow.positions[i * 3 + 1] = at.y;
    glow.positions[i * 3 + 2] = at.z;
    glow.velocities[i * 3] = vx;
    glow.velocities[i * 3 + 1] = vy;
    glow.velocities[i * 3 + 2] = vz;
    glow.sizes[i] = size;
    glowRGB[i * 3] = r;
    glowRGB[i * 3 + 1] = g;
    glowRGB[i * 3 + 2] = b;
    glowAlpha[i] = 1;
    glowFall[i] = fall;
    particlesAlive = true;
  }

  /** @param {number} dt */
  function stepParticles(dt) {
    if (!smoke || !glow || !particlesAlive) return;
    const scale = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    smoke.points.material.uniforms.uScale.value = scale;
    glow.points.material.uniforms.uScale.value = scale;
    let any = false;
    for (let i = 0; i < SMOKE; i++) {
      if (smoke.life[i] <= 0) {
        if (smoke.sizes[i] !== 0) { smoke.sizes[i] = 0; smoke.colours[i * 4 + 3] = 0; }
        continue;
      }
      any = true;
      smoke.life[i] -= dt;
      const t = 1 - Math.max(0, smoke.life[i]) / smoke.maxLife[i];
      const k = i * 3;
      const drag = 1 - Math.min(1, dt * 1.4);
      smoke.velocities[k] *= drag;
      smoke.velocities[k + 1] = smoke.velocities[k + 1] * drag + dt * 0.6;
      smoke.velocities[k + 2] *= drag;
      smoke.positions[k] += smoke.velocities[k] * dt;
      smoke.positions[k + 1] += smoke.velocities[k + 1] * dt;
      smoke.positions[k + 2] += smoke.velocities[k + 2] * dt;
      smoke.sizes[i] += smokeGrow[i] * dt;
      const s = smokeShade[i];
      smoke.colours[i * 4] = 0.55 + s * 0.4;
      smoke.colours[i * 4 + 1] = 0.55 + s * 0.4;
      smoke.colours[i * 4 + 2] = 0.58 + s * 0.4;
      smoke.colours[i * 4 + 3] = smokeAlpha[i] * Math.min(1, t * 8) * (1 - t) * (1 - t);
    }
    for (let i = 0; i < GLOW; i++) {
      if (glow.life[i] <= 0) {
        if (glow.sizes[i] !== 0) { glow.sizes[i] = 0; glow.colours[i * 4 + 3] = 0; }
        continue;
      }
      any = true;
      glow.life[i] -= dt;
      const t = 1 - Math.max(0, glow.life[i]) / glow.maxLife[i];
      const k = i * 3;
      glow.velocities[k + 1] -= glowFall[i] * dt;
      glow.positions[k] += glow.velocities[k] * dt;
      glow.positions[k + 1] += glow.velocities[k + 1] * dt;
      glow.positions[k + 2] += glow.velocities[k + 2] * dt;
      if (glow.positions[k + 1] < 0.1) {
        glow.positions[k + 1] = 0.1;
        glow.velocities[k + 1] *= -0.3;
      }
      const fade = (1 - t) * glowAlpha[i];
      glow.colours[i * 4] = glowRGB[k];
      glow.colours[i * 4 + 1] = glowRGB[k + 1] * (1 - t * 0.5);
      glow.colours[i * 4 + 2] = glowRGB[k + 2] * (1 - t);
      glow.colours[i * 4 + 3] = fade;
    }
    markPoolDirty(smoke);
    markPoolDirty(glow);
    particlesAlive = any;
  }

  // ---------------------------------------------------------------------
  // Sound
  // ---------------------------------------------------------------------

  /** @param {THREE.Vector3} at @param {number} [reach] @returns {number} loudness 0..1 by distance */
  function loudness(at, reach = 650) {
    const d = at.distanceTo(Sim.three.camera.position);
    const k = Math.max(0, 1 - d / reach);
    return k * k;
  }

  // ---------------------------------------------------------------------
  // Flight
  // ---------------------------------------------------------------------

  /** @param {number} angle @param {Jet} jet @param {THREE.Vector3} out */
  function orbitPoint(angle, jet, out) {
    return out.set(Math.cos(angle) * AIR.orbit.radius, AIR.orbit.height + jet.index * AIR.orbit.step, Math.sin(angle) * AIR.orbit.radius);
  }

  /** @param {number} angle @param {THREE.Vector3} out the direction of travel round the circle */
  function orbitHeading(angle, out) {
    return out.set(-Math.sin(angle), 0, Math.cos(angle));
  }

  /** @param {Jet} jet @returns {number} where its place on the circle is now */
  function slotAngle(jet) {
    return orbitPhase + (jet.index * Math.PI * 2) / AIR.jets;
  }

  /**
   * Adds the last leg of a path: from the end of segment `from` back to the
   * jet's place on the circle, wherever that will have moved to by then.
   * @param {Jet} jet
   * @param {number} slot index of the segment to fill
   * @param {number} timeBefore seconds of flying before this leg starts
   */
  function rejoinLeg(jet, slot, timeBefore) {
    const prev = jet.path[slot - 1];
    const start = prev.p1;
    headingAt(prev, 1, v1);
    const w = AIR.orbit.speed / AIR.orbit.radius;
    let guess = 6;
    for (let k = 0; k < 2; k++) {
      const a = slotAngle(jet) + w * (timeBefore + guess);
      orbitPoint(a, jet, v2);
      orbitHeading(a, v3);
      setSegment(jet.path[slot], start, v1, v2, v3, prev.v1, AIR.orbit.speed);
      guess = secondsLeft(jet.path[slot]);
    }
  }

  /**
   * Plans GHOST's entrance: in low in a V, cloaked, over the middle of town
   * and up into the circle.
   */
  function startIngress() {
    arrived = true;
    const a0 = Math.random() * Math.PI * 2;
    // The direction they fly in along.
    flat.set(Math.cos(a0), 0, Math.sin(a0));
    side.set(-flat.z, 0, flat.x);
    // Their places on the circle: the leader's just past the far side,
    // tangent along their heading, the wingmen a third round either way.
    orbitPhase = Math.atan2(-flat.x, flat.z) + 0.5;
    const lateral = [0, -22, 22];
    const back = [0, 30, 30];
    for (const jet of jets) {
      const L = lateral[jet.index % 3];
      const B = back[jet.index % 3] + Math.floor(jet.index / 3) * 40;
      v1.copy(flat).multiplyScalar(-AIR.ingress.from - B).addScaledVector(side, L).setY(AIR.ingress.height + jet.index * 2);
      v2.copy(flat).multiplyScalar(30 - B).addScaledVector(side, L).setY(48 + jet.index * 3);
      setSegment(jet.path[0], v1, flat, v2, flat, AIR.ingress.speed, AIR.ingress.speed * 0.9);
      jet.segs = 2;
      // The break: up and round to its place.
      const w = AIR.orbit.speed / AIR.orbit.radius;
      const before = secondsLeft(jet.path[0]);
      let guess = 6;
      for (let k = 0; k < 2; k++) {
        const a = slotAngle(jet) + w * (before + guess);
        orbitPoint(a, jet, v3);
        orbitHeading(a, v4);
        setSegment(jet.path[1], v2, flat, v3, v4, AIR.ingress.speed * 0.9, AIR.orbit.speed);
        guess = secondsLeft(jet.path[1]);
      }
      jet.seg = 0;
      jet.u = 0;
      jet.mode = 'ingress';
      jet.pos.copy(v1);
      jet.fwd.copy(flat);
      jet.yaw = Math.atan2(flat.x, flat.z);
      jet.bank = 0;
      jet.vis = 0;
      jet.visGoal = 0;
      jet.boomed = false;
      jet.throttle = 1;
      jet.look.group.visible = true;
    }
    ctx.events.emit('announce', { title: 'AIR SUPPORT', sub: 'GHOST flight: three stealth fighters hunting the aliens' });
  }

  /**
   * Moves a jet along its path. Returns false once the path has run out.
   * @param {Jet} jet
   * @param {number} dt
   * @returns {boolean}
   */
  function flyPath(jet, dt) {
    let seg = jet.path[jet.seg];
    jet.speed = seg.v0 + (seg.v1 - seg.v0) * jet.u;
    jet.u += (dt * jet.speed) / seg.len;
    while (jet.u >= 1) {
      if (jet.seg + 1 >= jet.segs) {
        jet.u = 1;
        pointAt(seg, 1, jet.pos);
        headingAt(seg, 1, jet.fwd);
        return false;
      }
      jet.u = (jet.u - 1) * seg.len;
      jet.seg++;
      seg = jet.path[jet.seg];
      jet.u /= seg.len;
      onSegment(jet);
    }
    pointAt(seg, jet.u, jet.pos);
    headingAt(seg, jet.u, jet.fwd);
    return true;
  }

  /**
   * A jet starts a new leg of its path.
   * @param {Jet} jet
   */
  function onSegment(jet) {
    if (jet.mode === 'run') {
      // 0 the roll-in, 1 the dive, 2 the pull-out, 3 home.
      if (jet.seg === 1) jet.visGoal = 1;
      if (jet.seg === 2) {
        jet.throttle = 1;
        jet.seenFor = AIR.afterRun;
        if (!jet.strike.flares) {
          jet.strike.flares = true;
          popFlares(jet);
        }
        ctx.systems.jetSound?.playFlyby(loudness(jet.pos, 500));
      }
      if (jet.seg === 3) jet.throttle = 0.5;
    }
  }

  /**
   * The jet's pose from its position, heading and the way it is turning.
   * @param {Jet} jet
   * @param {number} dt
   */
  function pose(jet, dt) {
    const yaw = Math.atan2(jet.fwd.x, jet.fwd.z);
    let dYaw = yaw - jet.yaw;
    if (dYaw > Math.PI) dYaw -= Math.PI * 2;
    if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const rate = dt > 0 ? dYaw / dt : 0;
    jet.yaw = yaw;
    // Into the turn: a right-hand turn (yaw falling) rolls the right wing down.
    const goal = THREE.MathUtils.clamp(-rate * 0.9, -1.25, 1.25);
    jet.bank += (goal - jet.bank) * Math.min(1, dt * 3);
    const pitch = Math.asin(THREE.MathUtils.clamp(jet.fwd.y, -1, 1));
    const g = jet.look.group;
    g.position.copy(jet.pos);
    e.set(-pitch, yaw, jet.bank, 'YXZ');
    g.quaternion.setFromEuler(e);
  }

  // ---------------------------------------------------------------------
  // Strikes
  // ---------------------------------------------------------------------

  /** @returns {{x: number, z: number}|null} */
  function rogerSpot() {
    if (!ctx.Hero || !ctx.Hero.active || !ctx.systems.heroMode?.rogerPosition) return null;
    return ctx.systems.heroMode.rogerPosition();
  }

  /** The aliens that can be hit now, and their spots. */
  function gatherAliens() {
    alienList.length = 0;
    alienSpots.length = 0;
    const list = ctx.systems.aliens?.targets ? ctx.systems.aliens.targets() : [];
    for (const a of list) {
      alienList.push(a);
      alienSpots.push(a.root.position);
    }
  }

  /** @param {any} alien @returns {boolean} */
  function alive(alien) {
    return !!alien && (alien.phase === 'patrol' || alien.phase === 'escort');
  }

  /**
   * Tries to send one jet after one alien.
   * @returns {boolean} whether a run began
   */
  function tryStrike() {
    if (jets.some((j) => j.mode === 'run' && j.strike.active && !j.strike.done)) return false;
    gatherAliens();
    if (!alienList.length) return false;
    const roger = rogerSpot();
    for (const jet of jets) {
      if (jet.mode !== 'orbit') continue;
      // A wheel: it rolls in off the circle, turning toward the target, and
      // the dive starts where the turn ends.
      v1.copy(jet.pos).addScaledVector(jet.fwd, AIR.attack.turn);
      const pick = pickTarget(alienSpots, v1, roger, { keepClear: 10, minDist: AIR.attack.minDive + AIR.attack.turn * 0.7 });
      if (pick < 0) continue;
      const alien = alienList[pick];
      const T = alien.root.position;
      const s = jet.strike;
      s.weapon = nextWeapon(lastWeapon, Math.random());
      const range = s.weapon === 'gun' ? AIR.attack.gunRange : AIR.attack.rocketRange;
      // The dive's line, flat, from where the turn ends.
      s.dir.set(T.x - v1.x, 0, T.z - v1.z).normalize();
      const reach = Math.hypot(T.x - v1.x, T.z - v1.z) - AIR.attack.turn * 0.7;
      // 0: the roll-in, to the top of the dive.
      v2.set(T.x, jet.pos.y - 4, T.z).addScaledVector(s.dir, -reach);
      v3.set(T.x, AIR.attack.pullHeight, T.z).addScaledVector(s.dir, -AIR.attack.pullOut);
      v4.subVectors(v3, v2).normalize();
      setSegment(jet.path[0], jet.pos, jet.fwd, v2, v4, jet.speed, AIR.attack.speed);
      // 1: the dive.
      setSegment(jet.path[1], v2, v4, v3, v4, AIR.attack.speed, AIR.attack.speed + 14);
      // 2: the pull-out, climbing hard past the target.
      v1.set(T.x, 118, T.z).addScaledVector(s.dir, 200);
      v2.set(s.dir.x, 0.55, s.dir.z).normalize();
      setSegment(jet.path[2], v3, v4, v1, v2, AIR.attack.speed + 14, AIR.attack.speed);
      // When the weapons go, roughly: the dive, until the target is in range.
      const dive = jet.path[1];
      const diveFlat = Math.max(1, reach - AIR.attack.pullOut);
      const before = Math.max(0, (reach - range) / diveFlat) * secondsLeft(dive);
      const toFire = secondsLeft(jet.path[0]) + before;
      if (!mayStartStrike({ busy: false, now: clock, lastKill, lead: toFire + (s.weapon === 'gun' ? 0.6 : 1.1) })) return false;
      // 3: home to its place on the circle.
      rejoinLeg(jet, 3, secondsLeft(jet.path[0]) + secondsLeft(jet.path[1]) + secondsLeft(jet.path[2]));
      jet.segs = 4;
      jet.seg = 0;
      jet.u = 0;
      jet.mode = 'run';
      jet.visGoal = 0;
      jet.throttle = 0.6;
      s.active = true;
      s.alien = alien;
      s.target.copy(T);
      s.fired = false;
      s.done = false;
      s.burst = 0;
      s.owed = 0;
      s.rounds = 0;
      s.rocketsOut = 0;
      s.rocketTimer = 0;
      s.flares = false;
      lastWeapon = s.weapon;
      locked = jet;
      reticleFlash = 0;
      return true;
    }
    return false;
  }

  /**
   * The weapons, while a jet is on its run.
   * @param {Jet} jet
   * @param {number} dt
   */
  function runWeapons(jet, dt) {
    const s = jet.strike;
    if (!s.active || s.done) return;
    // Keep the aim on the alien while it lives; if it has gone (someone
    // else got it), the nearest one near it, else nothing to hit.
    if (alive(s.alien)) {
      s.target.copy(s.alien.root.position);
    } else if (!s.fired) {
      gatherAliens();
      let best = null;
      let bestD = 35;
      for (const a of alienList) {
        const d = Math.hypot(a.root.position.x - s.target.x, a.root.position.z - s.target.z);
        if (d < bestD) { bestD = d; best = a; }
      }
      if (best) s.alien = best;
      else { s.done = true; return; }
    }
    if (jet.seg < 1) return;
    const dist = Math.hypot(jet.pos.x - s.target.x, jet.pos.z - s.target.z);
    if (s.weapon === 'gun') {
      if (!s.fired && (dist <= AIR.attack.gunRange || jet.seg >= 2)) {
        s.fired = true;
        ctx.systems.jetSound?.playGun(loudness(jet.pos, 700), AIR.gun.burst);
      }
      if (!s.fired || s.burst >= AIR.gun.burst) return;
      s.burst += dt;
      s.owed += dt * AIR.gun.rate;
      while (s.owed >= 1) {
        s.owed -= 1;
        const k = Math.min(1, s.burst / AIR.gun.burst);
        // The burst walks along the ground into the alien.
        v1.copy(s.target).addScaledVector(s.dir, -AIR.gun.walk * (1 - k));
        v1.x += (Math.random() - 0.5) * 1.6;
        v1.z += (Math.random() - 0.5) * 1.6;
        v1.y = 0.4;
        const muzzle = v2.copy(geo ? geo.muzzle : Z).applyQuaternion(jet.look.group.quaternion).add(jet.pos);
        // The last rounds of the burst are on the alien: any of them may finish it.
        const killer = k >= 0.8 && !s.done;
        fireTracer(muzzle, v1, killer ? s : null);
        s.rounds++;
        if (s.rounds % 4 === 0) spark(muzzle, 0, 0, 0, 0.08, 2.2, 3, 2.2, 0.8, 0);
      }
    } else {
      if (!s.fired && (dist <= AIR.attack.rocketRange || jet.seg >= 2)) {
        s.fired = true;
        s.rocketTimer = 0;
      }
      if (!s.fired || s.rocketsOut >= AIR.rockets.count) return;
      s.rocketTimer -= dt;
      if (s.rocketTimer <= 0) {
        s.rocketTimer = AIR.rockets.gap;
        launchRocket(jet, s.rocketsOut);
        s.rocketsOut++;
      }
    }
  }

  /**
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} to
   * @param {Strike|null} killer the strike this round may finish
   */
  function fireTracer(from, to, killer) {
    const i = trNext;
    trNext = (trNext + 1) % TRACERS;
    trFrom[i * 3] = from.x; trFrom[i * 3 + 1] = from.y; trFrom[i * 3 + 2] = from.z;
    trTo[i * 3] = to.x; trTo[i * 3 + 1] = to.y; trTo[i * 3 + 2] = to.z;
    trAge[i] = 0;
    trDur[i] = Math.max(0.05, from.distanceTo(to) / AIR.gun.speed);
    trKill[i] = killer;
    tracersAlive = true;
  }

  /** @param {number} dt */
  function stepTracers(dt) {
    if (!tracerMesh || !tracersAlive) return;
    let any = false;
    for (let i = 0; i < TRACERS; i++) {
      if (trDur[i] <= 0) continue;
      trAge[i] += dt;
      const k = i * 3;
      if (trAge[i] >= trDur[i]) {
        // The round lands: sparks and a kick of dust.
        v1.set(trTo[k], trTo[k + 1], trTo[k + 2]);
        for (let n = 0; n < 3; n++) {
          spark(v1, (Math.random() - 0.5) * 10, 3 + Math.random() * 7, (Math.random() - 0.5) * 10, 0.35 + Math.random() * 0.25, 0.5, 3, 1.8, 0.6, 22);
        }
        puff(v1, (Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2, 1.2, 1.4, 2.2, 0.55, 0.55);
        const strike = trKill[i];
        if (strike) finish(strike, v1, 'gun');
        trDur[i] = 0;
        trKill[i] = null;
        tracerMesh.setMatrixAt(i, zero);
        continue;
      }
      any = true;
      const t = trAge[i] / trDur[i];
      v1.set(trFrom[k], trFrom[k + 1], trFrom[k + 2]);
      v2.set(trTo[k], trTo[k + 1], trTo[k + 2]);
      v3.subVectors(v2, v1).normalize();
      v1.lerp(v2, t);
      q.setFromUnitVectors(Z, v3);
      m4.compose(v1, q, one);
      tracerMesh.setMatrixAt(i, m4);
    }
    tracerMesh.instanceMatrix.needsUpdate = true;
    tracersAlive = any;
  }

  /**
   * @param {Jet} jet
   * @param {number} n which of the pair
   */
  function launchRocket(jet, n) {
    const r = rockets.find((x) => !x.alive);
    if (!r || !geo) return;
    const s = jet.strike;
    r.alive = true;
    r.age = 0;
    r.pos.copy(geo.pylons[n % 2]).applyQuaternion(jet.look.group.quaternion).add(jet.pos);
    r.dir.copy(jet.fwd);
    r.speed = AIR.rockets.speed0 + jet.speed * 0.3;
    r.killer = true;
    r.alien = n === 0 ? s.alien : null;
    r.strike = s;
    r.wobble = Math.random() * 10;
    // The second lands just past the first, to one side.
    side.set(-s.dir.z, 0, s.dir.x);
    r.aim.copy(s.target).addScaledVector(s.dir, n === 0 ? 0 : 4).addScaledVector(side, n === 0 ? 0 : (Math.random() < 0.5 ? -3 : 3));
    r.aim.y = 0.6;
    r.group.visible = true;
    // The motor lighting: a flash at the pylon.
    spark(r.pos, 0, 0, 0, 0.12, 4, 3, 2, 0.8, 0);
    ctx.systems.jetSound?.playRocketLaunch(loudness(r.pos, 600));
  }

  /** @param {number} dt */
  function stepRockets(dt) {
    for (const r of rockets) {
      if (!r.alive) continue;
      r.age += dt;
      if (r.alien && alive(r.alien)) r.aim.set(r.alien.root.position.x, 1, r.alien.root.position.z);
      // Accelerating and homing, with a wobble.
      r.speed = Math.min(AIR.rockets.speed1, r.speed + dt * 260);
      v1.subVectors(r.aim, r.pos).normalize();
      v1.x += Math.sin(r.age * 9 + r.wobble) * 0.06;
      v1.y += Math.cos(r.age * 7 + r.wobble) * 0.05;
      r.dir.lerp(v1, Math.min(1, dt * AIR.rockets.turn * (0.4 + r.age))).normalize();
      r.pos.addScaledVector(r.dir, r.speed * dt);
      r.group.position.copy(r.pos);
      q.setFromUnitVectors(Z, r.dir);
      r.group.quaternion.copy(q);
      // The trail: thick white smoke and the motor's glow.
      v2.copy(r.pos).addScaledVector(r.dir, -2.2);
      puff(v2, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, 2.4 + Math.random(), 1.1, 2.6, 0.95, 0.7);
      spark(v2, 0, 0, 0, 0.1, 1.6, 3, 1.6, 0.5, 0);
      if (r.pos.distanceTo(r.aim) < 2.2 || r.pos.y < 0.5 || r.age > 6) {
        r.alive = false;
        r.group.visible = false;
        blast(r.pos, r.alien ? 1.4 : 1);
        if (r.killer && r.strike) finish(r.strike, r.pos, 'rockets');
        r.strike = null;
        r.alien = null;
      }
    }
  }

  /**
   * A rocket landing: the shared impact burst, a ring of dust and a column
   * of smoke.
   * @param {THREE.Vector3} at
   * @param {number} strength
   */
  function blast(at, strength) {
    v3.copy(at);
    v3.y = Math.max(1.2, v3.y);
    ctx.systems.explosions.spawnImpactBurst(v3, strength);
    for (let n = 0; n < 14; n++) {
      const a = (n / 14) * Math.PI * 2;
      puff(v3, Math.cos(a) * 14, 1 + Math.random() * 2, Math.sin(a) * 14, 1.8 + Math.random(), 2.2, 3.5, 0.35, 0.6);
    }
    for (let n = 0; n < 6; n++) {
      puff(v3, (Math.random() - 0.5) * 3, 6 + Math.random() * 6, (Math.random() - 0.5) * 3, 3 + Math.random() * 1.5, 3, 3, 0.15, 0.7);
    }
    for (let n = 0; n < 18; n++) {
      spark(v3, (Math.random() - 0.5) * 30, 6 + Math.random() * 18, (Math.random() - 0.5) * 30, 0.6 + Math.random() * 0.6, 0.7, 3, 1.6, 0.5, 26);
    }
    ctx.systems.jetSound?.playBlast(loudness(v3, 700));
  }

  /**
   * The hit that ends a strike: the alien goes down, if the limit allows.
   * @param {Strike} s
   * @param {THREE.Vector3} at
   * @param {'gun'|'rockets'} how
   */
  function finish(s, at, how) {
    if (s.done) return;
    const alien = s.alien;
    // Wide of it (it moved, or the round fell short): the next one may do it.
    if (alive(alien) && Math.hypot(alien.root.position.x - at.x, alien.root.position.z - at.z) > 7) return;
    s.done = true;
    if (!alive(alien) || !mayKill(clock, lastKill)) return;
    ctx.systems.aliens.plasmaKill(alien, alien.root.position);
    lastKill = clock;
    killCount++;
    reticleFlash = 0.45;
    const jet = jets.find((j) => j.strike === s);
    const who = jet ? jet.name : 'GHOST';
    const line = how === 'gun' ? `${who}: "Guns, guns, guns!" · splash one` : `${who}: "Rockets away!" · splash one`;
    if (ctx.Hero && ctx.Hero.active) ctx.events.emit('notice', { text: line });
    if (killCount === 1 || (killCount % 5 === 0 && tickerQuiet <= 0)) {
      tickerQuiet = 20;
      ctx.systems.newsTicker?.say(killCount === 1
        ? `${who} takes out an alien with ${how === 'gun' ? 'its gun' : 'two rockets'} · the Air Force is over the town`
        : `GHOST flight has now taken out ${killCount} aliens`);
    }
  }

  /** @param {Jet} jet */
  function popFlares(jet) {
    let made = 0;
    for (const f of flares) {
      if (f.alive || made >= 8) continue;
      const k = made - 3.5;
      f.alive = true;
      f.life = 1.8 + Math.random() * 0.8;
      f.pos.copy(jet.pos).addScaledVector(jet.fwd, -6);
      side.set(-jet.fwd.z, 0, jet.fwd.x).normalize();
      f.vel.copy(jet.fwd).multiplyScalar(jet.speed * 0.35).addScaledVector(side, k * 7).add(v1.set(0, -4 - Math.random() * 6, 0));
      made++;
    }
    ctx.systems.jetSound?.playFlares(loudness(jet.pos, 500));
  }

  /** @param {number} dt */
  function stepFlares(dt) {
    for (const f of flares) {
      if (!f.alive) continue;
      f.life -= dt;
      f.vel.y -= 9 * dt;
      f.vel.multiplyScalar(1 - Math.min(1, dt * 0.9));
      f.pos.addScaledVector(f.vel, dt);
      spark(f.pos, 0, 0, 0, 0.16, 2.4, 3.4, 2.2, 1, 0);
      puff(f.pos, 0, 0, 0, 2.2, 0.9, 2.2, 1, 0.45);
      if (f.life <= 0 || f.pos.y < 1) f.alive = false;
    }
  }

  // ---------------------------------------------------------------------
  // The frame
  // ---------------------------------------------------------------------

  /** @param {Jet} jet @param {number} dt */
  function look(jet, dt) {
    const L = jet.look;
    const step = dt / AIR.cloakSeconds;
    jet.vis += THREE.MathUtils.clamp(jet.visGoal - jet.vis, -step, step);
    L.uniforms.uReveal.value = -REACH + 2 * REACH * jet.vis;
    L.uniforms.uEdge.value = 1;
    L.uniforms.uTime.value = clock + jet.index * 3.1;
    L.uniforms.uShell.value = 0.5;
    const shown = jet.vis > 0.55;
    const flicker = 0.85 + Math.random() * 0.3;
    const len = (0.45 + jet.throttle * 1.25) * flicker;
    const width = jet.vis * (0.7 + jet.throttle * 0.4);
    for (const f of L.flames) {
      f.visible = shown;
      f.scale.set(width, width, len);
    }
    for (const l of L.lights) l.visible = shown;
    L.strobe.visible = shown && ((clock + jet.index * 0.4) % 1.3) < 0.07;
    if (jet.collar > 0) {
      jet.collar -= dt;
      const k = Math.max(0, jet.collar) / 0.7;
      L.collar.visible = jet.collar > 0;
      /** @type {THREE.MeshBasicMaterial} */ (L.collar.material).opacity = 0.42 * Math.sin(Math.PI * k);
      L.collar.scale.setScalar(1 + (1 - k) * 0.35);
    }
    // Vapour off the wingtips when pulling hard, and a heat shimmer behind.
    if (geo && shown && jet.mode === 'run' && jet.seg === 2) {
      for (const tip of geo.wingtips) {
        v1.copy(tip).applyQuaternion(L.group.quaternion).add(jet.pos);
        puff(v1, 0, 0, 0, 0.7, 0.35, 1.6, 1, 0.55);
      }
    }
  }

  /** @param {number} dt */
  function updateAirSupport(dt) {
    if (!geo || dt <= 0) return;
    clock += dt;
    if (!arrived) {
      if (clock >= AIR.arriveAfter) startIngress();
      else return;
    }
    orbitPhase += (AIR.orbit.speed / AIR.orbit.radius) * dt;
    if (tickerQuiet > 0) tickerQuiet -= dt;
    let humLevel = 0;
    let humStrain = 0;
    for (const jet of jets) {
      if (jet.mode === 'ingress') {
        jet.throttle = 1;
        const flying = flyPath(jet, dt);
        // Over the edge of town: the cloak drops, the boom.
        if (!jet.boomed && Math.hypot(jet.pos.x, jet.pos.z) < AIR.ingress.reveal) {
          jet.boomed = true;
          jet.visGoal = 1;
          jet.collar = 0.7;
          if (jet.index === 0) {
            ctx.systems.jetSound?.playSonicBoom(loudness(jet.pos, 900));
            ctx.systems.jetSound?.playFlyby(loudness(jet.pos, 900));
          }
        }
        if (!flying) {
          jet.mode = 'orbit';
          jet.cloakTimer = inRange(AIR.seen, Math.random());
        }
      } else if (jet.mode === 'orbit') {
        const a = slotAngle(jet);
        orbitPoint(a, jet, v1);
        v1.y += Math.sin(clock * 0.4 + jet.index * 2) * 2;
        // Eased onto its exact place, in case it came home a little off.
        jet.pos.lerp(v1, Math.min(1, dt * 1.5));
        orbitHeading(a, jet.fwd);
        jet.speed = AIR.orbit.speed;
        jet.throttle = 0.3;
        jet.cloakTimer -= dt;
        if (jet.cloakTimer <= 0) {
          jet.visGoal = jet.visGoal > 0.5 ? 0 : 1;
          jet.cloakTimer = inRange(jet.visGoal > 0.5 ? AIR.seen : AIR.hidden, Math.random());
        }
      } else if (jet.mode === 'run') {
        const flying = flyPath(jet, dt);
        if (jet.seg === 0 && jet.u > 0.55) jet.visGoal = 1;
        runWeapons(jet, dt);
        if (jet.seenFor > 0) {
          jet.seenFor -= dt;
          if (jet.seenFor <= 0) jet.visGoal = 0;
        }
        if (!flying) {
          jet.mode = 'orbit';
          jet.strike.active = false;
          jet.cloakTimer = inRange(AIR.hidden, Math.random());
          if (locked === jet) locked = null;
        }
      }
      pose(jet, dt);
      look(jet, dt);
      const lvl = loudness(jet.pos, 600) * (0.35 + 0.65 * jet.vis);
      if (lvl > humLevel) {
        humLevel = lvl;
        humStrain = jet.throttle;
      }
    }
    ctx.systems.jetSound?.updateJetHum(humLevel, humStrain);

    strikeCheck -= dt;
    if (strikeCheck <= 0) {
      strikeCheck = 0.4;
      tryStrike();
    }
    stepTracers(dt);
    stepRockets(dt);
    stepFlares(dt);
    stepParticles(dt);
    updateReticle(dt);
  }

  /** @param {number} dt */
  function updateReticle(dt) {
    if (!reticle || !lockLine) return;
    const s = locked ? locked.strike : null;
    if (reticleFlash > 0) reticleFlash -= dt;
    const showing = !!(s && s.active && (!s.done || reticleFlash > 0));
    reticle.visible = showing;
    lockLine.visible = showing && !!s && !s.done;
    if (!showing || !s || !locked) return;
    reticle.position.set(s.target.x, 0.25, s.target.z);
    const mat = /** @type {THREE.MeshBasicMaterial} */ (reticle.material);
    if (s.done) {
      // The kill: a white flash, opening out.
      const k = Math.max(0, reticleFlash) / 0.45;
      reticle.scale.setScalar(1 + (1 - k) * 1.6);
      mat.color.setRGB(3, 3, 3);
      mat.opacity = k;
    } else {
      // Closing in as the jet comes down, turning, pulsing.
      const closing = locked.seg >= 1 ? 1 : locked.u * 0.6;
      reticle.scale.setScalar(2.2 - closing * 1.2 + Math.sin(clock * 10) * 0.06);
      reticle.rotation.y += dt * (1.2 + closing * 3);
      mat.color.setRGB(3, 0.25, 0.15);
      mat.opacity = 0.55 + 0.35 * Math.sin(clock * 12);
    }
    if (lockLine.visible) {
      v1.set(s.target.x, 0.3, s.target.z);
      v2.subVectors(locked.pos, v1);
      const len = v2.length();
      lockLine.position.copy(v1);
      lockLine.quaternion.setFromUnitVectors(Y, v2.normalize());
      lockLine.scale.set(1, len, 1);
      /** @type {THREE.MeshBasicMaterial} */ (lockLine.material).opacity = 0.18 + 0.12 * Math.sin(clock * 14);
    }
  }

  /** @returns {void} */
  function resetAirSupport() {
    clock = 0;
    arrived = false;
    lastKill = -Infinity;
    lastWeapon = null;
    killCount = 0;
    orbitPhase = 0;
    strikeCheck = 0;
    tickerQuiet = 0;
    locked = null;
    reticleFlash = 0;
    for (const jet of jets) {
      jet.mode = 'off';
      jet.look.group.visible = false;
      jet.vis = 0;
      jet.visGoal = 0;
      jet.collar = 0;
      jet.look.collar.visible = false;
      jet.strike.active = false;
      jet.strike.alien = null;
    }
    for (const r of rockets) {
      r.alive = false;
      r.group.visible = false;
      r.alien = null;
      r.strike = null;
    }
    for (const f of flares) f.alive = false;
    trDur.fill(0);
    trKill.fill(null);
    if (tracerMesh) {
      for (let i = 0; i < TRACERS; i++) tracerMesh.setMatrixAt(i, zero);
      tracerMesh.instanceMatrix.needsUpdate = true;
    }
    tracersAlive = false;
    for (const pool of [smoke, glow]) {
      if (!pool) continue;
      pool.life.fill(0);
      pool.sizes.fill(0);
      pool.colours.fill(0);
      markPoolDirty(pool);
    }
    particlesAlive = false;
    if (reticle) reticle.visible = false;
    if (lockLine) lockLine.visible = false;
    ctx.systems.jetSound?.updateJetHum(0, 0);
  }

  /** @returns {void} */
  function disposeAirSupport() {
    for (const jet of jets) {
      jet.look.group.removeFromParent();
      for (const m of jet.look.materials) m.dispose();
    }
    jets = [];
    for (const r of rockets) r.group.removeFromParent();
    rockets = [];
    flares = [];
    tracerMesh?.removeFromParent();
    tracerMesh?.dispose();
    tracerMesh = null;
    reticle?.removeFromParent();
    lockLine?.removeFromParent();
    reticle = lockLine = null;
    if (geo) {
      for (const g of [geo.body, geo.canopy, geo.flame, geo.core, geo.light, geo.collar]) g.dispose();
      geo = null;
    }
    for (const g of sharedGeometries) g.dispose();
    for (const m of sharedMaterials) m.dispose();
    sharedGeometries.length = sharedMaterials.length = 0;
    if (smoke) disposeParticlePool(Sim.three.scene, smoke);
    if (glow) disposeParticlePool(Sim.three.scene, glow);
    smoke = glow = null;
  }

  /**
   * For the co-op guest (net/system.js, `flyers` rows): the fighter's own
   * builder with its own geometry and glow materials, so the guest's jets
   * cloak each on their own. Nothing is added to the scene, no state touched.
   * @returns {{build: (index: number) => ReturnType<typeof buildFighter>, geometries: THREE.BufferGeometry[], materials: THREE.Material[], reach: number}}
   */
  function buildGuestModel() {
    const own = buildFighterGeometry();
    const materials = /** @type {THREE.Material[]} */ ([]);
    const glow = (/** @type {THREE.Color} */ c, opacity = 1) => {
      const m = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      materials.push(m);
      return m;
    };
    const set = {
      flame: glow(new THREE.Color(1.6, 0.62, 0.22), 0.75),
      core: glow(new THREE.Color(1.4, 1.6, 2.4), 0.9),
      red: glow(new THREE.Color(4, 0.2, 0.15)),
      green: glow(new THREE.Color(0.2, 4, 0.5)),
      strobe: glow(new THREE.Color(5, 5, 5))
    };
    return { build: () => buildFighter(own, set), geometries: [own.body, own.canopy, own.flame, own.core, own.light, own.collar], materials, reach: REACH };
  }

  /**
   * What the guest needs to draw each jet in the air (`flyers` rows,
   * net/flyerPose.js). Read-only; none before the flight arrives.
   * @returns {{index: number, x: number, y: number, z: number, quaternion: THREE.Quaternion, vis: number, throttle: number}[]}
   */
  function replicaState() {
    const out = [];
    for (const jet of jets) {
      if (jet.mode === 'off') continue;
      const p = jet.look.group.position;
      out.push({ index: jet.index, x: p.x, y: p.y, z: p.z, quaternion: jet.look.group.quaternion, vis: jet.vis, throttle: jet.throttle });
    }
    return out;
  }

  /** The jets' own scene objects, for the guest to hold back while the host's are drawn. @returns {THREE.Object3D[]} */
  const localRoots = () => jets.map((j) => j.look.group);

  return {
    initAirSupport, updateAirSupport, resetAirSupport, disposeAirSupport, buildGuestModel, replicaState, localRoots,
    up: () => arrived, kills: () => killCount,
    /** What each jet is doing (for testing from the console). */
    debug: () => ({
      clock, lastKill, killCount,
      jets: jets.map((j) => ({ mode: j.mode, seg: j.seg, u: +j.u.toFixed(2), vis: +j.vis.toFixed(2), y: Math.round(j.pos.y),
        strike: j.strike.active ? { weapon: j.strike.weapon, fired: j.strike.fired, done: j.strike.done, rounds: j.strike.rounds, rockets: j.strike.rocketsOut, phase: j.strike.alien && j.strike.alien.phase } : null }))
    }),
    /** Brings the flight in now (for testing from the console). */
    summon: () => { if (!arrived) clock = AIR.arriveAfter; }
  };
}
