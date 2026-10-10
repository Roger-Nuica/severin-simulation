// @ts-check
import * as THREE from 'three';
import { createSoftDotTexture } from '../utils/textures.js';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from './particlePool.js';
import { GUNNER, caught, turnToward, lead, nextPhase } from './gunner/config.js';
import { buildGunnerKit, buildGunner, buildRoundMeshes } from './gunner/model.js';
import { createWeaponFx } from './hero/weaponFx.js';
import { roundTo, ROUND_EVERY, ROUND_BACKLOG } from './net/enemyFx.js';

/**
 * ===========================================================================
 * SECTION GN — HAVOC, the heavy gunner, and stopping bullets
 * ===========================================================================
 * An enemy for Hero Mode, sent in from the panel (🔫 HAVOC) or the phone's
 * 🔫 button, one more per press, up to GUNNER.max (R-057).
 *
 * He walks in from 60 m, stops at 26-40 m and works in a cycle:
 *  - spin-up (1.25 s): the barrels wind up with a rising whine, a red laser
 *    sight finds Roger, the barrel tips start to glow. The first time in a
 *    run Roger's HUD says what to do: press Q (⏱ on a phone) to slow time;
 *  - firing (2.8 s): 16 rounds a second at 70 m/s, slow enough to see
 *    coming, each a red tracer. His gun swings at most 42°/s, so running
 *    sideways makes the stream lag behind; rounds that hit take 3 health;
 *  - cool-down (2.6 s): the barrels glowing orange, hissing, he steps aside.
 *
 * Stopping bullets. The rounds fly on the world's clock, so Time Slow (Q)
 * slows the stream to a crawl, and while it lasts any round that comes
 * within GUNNER.catchRadius of Roger stops dead in the air: a shimmering
 * sphere of slowed time shows round him, every round that enters it leaves
 * a ripple where it stops and hangs there, trembling, nose still pointed at
 * him. When Time Slow ends, every caught round turns round, glows cyan and
 * goes back to the man who fired it ("RETURN TO SENDER"), pinging off his
 * armour: a whole caught burst brings him down.
 *
 * In the shared enemy register (engine/enemies.js) with a hitbox, so every
 * weapon of Roger's aims at him and takes the table's damage (24 health; an
 * EMP stuns him). A HAVOC brought down topples, his drum cooking off in
 * sparks, and is gone after a few seconds. No lights, rounds instanced, one
 * small particle pool, nothing allocated per frame.
 */

/**
 * @typedef {Object} Unit
 * @property {ReturnType<typeof buildGunner>} look
 * @property {'walking'|'spinning'|'firing'|'cooling'} phase
 * @property {number} timer
 * @property {number} yaw
 * @property {number} spin barrel speed, rad/s
 * @property {number} heat 0..1
 * @property {number} owed rounds owed this frame
 * @property {number} stride
 * @property {number} stun
 * @property {number} flinch
 * @property {number} flashHit
 * @property {number} side which way he steps on cool-down
 * @property {number} alt which of his two guns fired last (gunner/model.js guns)
 * @property {boolean} dying
 * @property {number} dead seconds since he went down
 * @property {boolean} gone
 */

const RIPPLES = 10;
const SPARKS = 260;

/** Round states. */
const FREE = 0;
const FLYING = 1;
const CAUGHT = 2;
const RETURNING = 3;
const FALLING = 4;

/**
 * @param {Object} ctx
 * @returns {{initGunners: () => void, updateGunners: (dt: number, rawDt: number) => void, resetGunners: () => void,
 *   disposeGunners: () => void, send: () => boolean, buildGuestModel: () => any, replicaState: () => any[], count: () => number, caughtCount: () => number, positions: () => THREE.Vector3[], returnedHits: () => number, debug: () => Object[]}}
 */
export function createGunnerSystem(ctx) {
  const { Sim } = ctx;
  /** @type {ReturnType<typeof buildGunnerKit>|null} */
  let kit = null;
  /** @type {Unit[]} */
  let units = [];
  /** @type {Object|null} */
  let kind = null;
  /** @type {THREE.InstancedMesh|null} */
  let heads = null;
  /** @type {THREE.InstancedMesh|null} */
  let trails = null;
  /** @type {THREE.Mesh|null} */
  let bubble = null;
  /** @type {{mesh: THREE.Mesh, t: number}[]} */
  let ripples = [];
  /** @type {import('./particlePool.js').ParticlePool|null} */
  let sparks = null;
  let sparksAlive = false;
  /** @type {THREE.Material[]} */
  const ownMaterials = [];
  /** @type {THREE.BufferGeometry[]} */
  const ownGeometries = [];
  /** @type {HTMLButtonElement|null} */
  let button = null;

  // The rounds.
  const N = GUNNER.rounds;
  const rPos = new Float32Array(N * 3);
  const rVel = new Float32Array(N * 3);
  const rLife = new Float32Array(N);
  const rState = new Uint8Array(N);
  const rWhizz = new Uint8Array(N);
  /** @type {(Unit|null)[]} */
  const rOwner = new Array(N).fill(null);
  let rNext = 0;
  let roundsAlive = false;
  let caughtNow = 0;

  let wasSlow = false;
  let bubbleLevel = 0;
  let hinted = false;
  let caughtHinted = false;
  let whizzQuiet = 0;
  let clock = 0;
  /** Whether this game's pair (GUNNER.autoAt) has come. */
  let autoSent = false;
  let frameNo = 0;
  /** Rounds sent back that landed on him, this run (for testing). */
  let returnedHits = 0;
  const rogerPrev = new THREE.Vector3();
  const rogerVel = new THREE.Vector3();
  let rogerKnown = false;

  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const v3 = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const Z = new THREE.Vector3(0, 0, 1);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const red = new THREE.Color(3, 0.55, 0.18);
  const cyan = new THREE.Color(0.55, 2.2, 3.4);
  const bubbleUniforms = { uTime: { value: 0 }, uAlpha: { value: 0 } };
  /** Announces some of the rounds to the co-op guest (hero/weaponFx.js); nothing happens outside a room with a guest. */
  const weaponFx = createWeaponFx(ctx);
  const fxEnd = { x: 0, y: 0, z: 0 };
  let fxCount = 0;

  /** @returns {void} */
  function initGunners() {
    kit = buildGunnerKit();
    // A round: a slug with a long tracer behind it (gunner/model.js, shared with the co-op guest's drawing).
    ({ heads, trails } = buildRoundMeshes(Sim.three.scene, N, red, { geos: ownGeometries, mats: ownMaterials }));

    // The sphere of slowed time round Roger: a rim of light with ripples running over it.
    const bubbleGeo = new THREE.SphereGeometry(GUNNER.catchRadius, 40, 24);
    ownGeometries.push(bubbleGeo);
    const bubbleMat = new THREE.ShaderMaterial({
      uniforms: bubbleUniforms,
      vertexShader: `
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main() {
          vP = position;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uTime; uniform float uAlpha;
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main() {
          float rim = pow(1.0 - abs(dot(vN, vV)), 2.5);
          float bands = 0.5 + 0.5 * sin(vP.y * 5.0 - uTime * 2.0 + sin(vP.x * 2.0 + uTime) * 1.5);
          float a = uAlpha * (rim * 0.7 + 0.05 + bands * rim * 0.4);
          gl_FragColor = vec4(vec3(0.5, 0.85, 1.0) * a, a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    ownMaterials.push(bubbleMat);
    bubble = new THREE.Mesh(bubbleGeo, bubbleMat);
    bubble.name = 'havoc_timeBubble';
    bubble.visible = false;
    bubble.renderOrder = 4;
    Sim.three.scene.add(bubble);

    // Ripples where a round stops.
    const ringGeo = new THREE.RingGeometry(0.2, 0.32, 24);
    ownGeometries.push(ringGeo);
    ripples = [];
    for (let i = 0; i < RIPPLES; i++) {
      const m = new THREE.MeshBasicMaterial({
        color: new THREE.Color(1.2, 2.2, 3), transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false
      });
      ownMaterials.push(m);
      const mesh = new THREE.Mesh(ringGeo, m);
      mesh.visible = false;
      Sim.three.scene.add(mesh);
      ripples.push({ mesh, t: 1 });
    }

    sparks = createParticlePool(Sim.three.scene, SPARKS, createSoftDotTexture(), THREE.AdditiveBlending, 'havoc_sparks');
    ctx.systems.caps.trackPool(sparks);

    kind = {
      kind: 'gunner',
      list: () => units.filter((u) => !u.dying && !u.gone),
      position: (/** @type {Unit} */ u) => u.look.root.position,
      hitbox: (/** @type {Unit} */ u) => ({ x: u.look.root.position.x, z: u.look.root.position.z, radius: 0.75, top: GUNNER.height }),
      // An EMP stuns him; everything else is the table's damage.
      accepts: ['emp'],
      damage: (/** @type {Unit} */ u) => {
        u.stun = GUNNER.stun;
        for (const g of u.look.guns) g.laser.visible = g.flash.visible = false;
        u.phase = 'cooling';
        u.timer = 0;
        return false;
      },
      defeat: (/** @type {Unit} */ u) => {
        down(u);
        return true;
      },
      wounded: (/** @type {Unit} */ u) => {
        u.flashHit = 0.12;
        u.flinch = 0.2;
      },
      consume: (/** @type {Unit} */ u) => remove(u),
      object: (/** @type {Unit} */ u) => u.look.root,
      size: () => GUNNER.height
    };
    ctx.systems.enemies.registerKind(kind);

    button = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-gunner'));
    button?.addEventListener('click', () => send(), { signal: ctx.signal });
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  /** @returns {{x: number, z: number, onFoot: boolean}|null} */
  function roger() {
    if (!ctx.Hero || !ctx.Hero.active) return null;
    return ctx.systems.heroMode?.rogerTarget ? ctx.systems.heroMode.rogerTarget() : null;
  }

  /** @returns {number} */
  function rogerBase() {
    return ctx.systems.heroMode?.rogerHeight ? ctx.systems.heroMode.rogerHeight() : 0;
  }

  /** @param {THREE.Vector3} at @param {number} [reach] */
  function loudness(at, reach = 140) {
    const d = at.distanceTo(Sim.three.camera.position);
    return Math.max(0, 1 - d / reach);
  }

  /** @param {string} text */
  function notice(text) {
    ctx.events.emit('notice', { text });
  }

  /** @returns {boolean} */
  function touch() {
    return document.body.classList.contains('hero-touch-on');
  }

  /**
   * @param {THREE.Vector3} at
   * @param {number} n
   * @param {number} speed
   * @param {number} r @param {number} g @param {number} b
   */
  function spray(at, n, speed, r, g, b) {
    if (!sparks) return;
    const count = Math.min(n, ctx.systems.caps.particleRoom());
    for (let k = 0; k < count; k++) {
      const i = sparks.next;
      sparks.next = (i + 1) % SPARKS;
      const life = 0.25 + Math.random() * 0.35;
      sparks.life[i] = life;
      sparks.maxLife[i] = life;
      sparks.positions[i * 3] = at.x;
      sparks.positions[i * 3 + 1] = at.y;
      sparks.positions[i * 3 + 2] = at.z;
      sparks.velocities[i * 3] = (Math.random() - 0.5) * speed;
      sparks.velocities[i * 3 + 1] = Math.random() * speed * 0.8;
      sparks.velocities[i * 3 + 2] = (Math.random() - 0.5) * speed;
      sparks.sizes[i] = 0.18 + Math.random() * 0.12;
      sparks.colours[i * 4] = r;
      sparks.colours[i * 4 + 1] = g;
      sparks.colours[i * 4 + 2] = b;
      sparks.colours[i * 4 + 3] = 1;
    }
    if (count > 0) sparksAlive = true;
  }

  /** @param {number} dt */
  function stepSparks(dt) {
    if (!sparks || !sparksAlive) return;
    sparks.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    let any = false;
    for (let i = 0; i < SPARKS; i++) {
      if (sparks.life[i] <= 0) {
        if (sparks.sizes[i] !== 0) { sparks.sizes[i] = 0; sparks.colours[i * 4 + 3] = 0; }
        continue;
      }
      any = true;
      sparks.life[i] -= dt;
      const k = i * 3;
      sparks.velocities[k + 1] -= 18 * dt;
      sparks.positions[k] += sparks.velocities[k] * dt;
      sparks.positions[k + 1] += sparks.velocities[k + 1] * dt;
      sparks.positions[k + 2] += sparks.velocities[k + 2] * dt;
      sparks.colours[i * 4 + 3] = Math.max(0, sparks.life[i] / sparks.maxLife[i]);
    }
    markPoolDirty(sparks);
    sparksAlive = any;
  }

  // ---------------------------------------------------------------------
  // Sending one in, and taking one out
  // ---------------------------------------------------------------------

  /** @returns {boolean} whether one came */
  function send(offset = 0) {
    if (!kit) return false;
    const r = roger();
    if (!r) {
      ctx.systems.newsTicker?.say('HAVOC only comes for Roger: start 🦸 Hero first');
      return false;
    }
    if (units.filter((u) => !u.dying && !u.gone).length >= GUNNER.max) return false;
    if (!ctx.systems.caps.canSpawn('gunner')) return false;
    // In front of Roger, a little to one side, somewhere he can stand.
    const pose = ctx.systems.heroMode?.rogerPose ? ctx.systems.heroMode.rogerPose() : null;
    const facing = pose ? pose.heading : 0;
    let x = r.x;
    let z = r.z;
    for (let k = 0; k < 16; k++) {
      const a = facing + offset + (k % 2 ? 1 : -1) * (0.35 + Math.ceil(k / 2) * 0.3);
      x = r.x + Math.sin(a) * GUNNER.spawnDistance;
      z = r.z + Math.cos(a) * GUNNER.spawnDistance;
      if (!ctx.systems.heroMode?.standable || ctx.systems.heroMode.standable(x, z)) break;
    }
    const look = buildGunner(kit);
    look.root.position.set(x, 0, z);
    Sim.three.scene.add(look.root);
    /** @type {Unit} */
    const u = {
      look, phase: 'walking', timer: 0, yaw: Math.atan2(r.x - x, r.z - z), spin: 0, heat: 0, owed: 0, stride: 0,
      stun: 0, flinch: 0, flashHit: 0, side: Math.random() < 0.5 ? -1 : 1, dying: false, dead: 0, gone: false, alt: 0
    };
    units.push(u);
    // He arrives in a cloud of dust and sparks.
    spray(v1.set(x, 0.3, z), 30, 8, 2, 1.4, 0.7);
    ctx.systems.explosions.spawnImpactBurst(v1.set(x, 0.6, z), 0.5);
    notice('🔫 HAVOC is coming · heavy minigun');
    return true;
  }

  /** @param {Unit} u brought down: he topples, his drum cooks off */
  function down(u) {
    if (u.dying) return;
    u.dying = true;
    u.dead = 0;
    u.look.marker.visible = false;
    for (const g of u.look.guns) g.laser.visible = g.flash.visible = false;
    ctx.systems.explosions.spawnImpactBurst(v1.copy(u.look.root.position).setY(1.4), 1.1);
    ctx.systems.damage.addDamageScore(GUNNER.score);
    notice(`💥 HAVOC DOWN · +${GUNNER.score}`);
  }

  /** @param {Unit} u gone at once (the black hole, a reset) */
  function remove(u) {
    u.gone = true;
    u.dying = true;
    u.look.root.removeFromParent();
    for (const m of u.look.own) m.dispose();
  }

  // ---------------------------------------------------------------------
  // The rounds
  // ---------------------------------------------------------------------

  /**
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} dir unit length
   * @param {Unit} owner
   */
  function fireRound(from, dir, owner) {
    const i = rNext;
    rNext = (rNext + 1) % N;
    if (rState[i] === CAUGHT) caughtNow = Math.max(0, caughtNow - 1);
    rPos[i * 3] = from.x;
    rPos[i * 3 + 1] = from.y;
    rPos[i * 3 + 2] = from.z;
    rVel[i * 3] = dir.x * GUNNER.speed;
    rVel[i * 3 + 1] = dir.y * GUNNER.speed;
    rVel[i * 3 + 2] = dir.z * GUNNER.speed;
    rLife[i] = GUNNER.roundLife;
    rState[i] = FLYING;
    rWhizz[i] = 0;
    rOwner[i] = owner;
    heads?.setColorAt(i, red);
    trails?.setColorAt(i, red);
    if (heads?.instanceColor) heads.instanceColor.needsUpdate = true;
    if (trails?.instanceColor) trails.instanceColor.needsUpdate = true;
    roundsAlive = true;
    // Last: the co-op guest sees one round in ROUND_EVERY (net/enemyFx.js `round`), and none while rows wait; one read outside a room.
    const net = ctx.systems.net;
    if (net && net.fxLive() && ++fxCount % ROUND_EVERY === 0 && net.fxPending() < ROUND_BACKLOG) {
      weaponFx.announce('round', from, roundTo(fxEnd, from, dir), '', 0);
    }
  }

  /** @param {Unit} u @returns {THREE.Vector3} his chest, in v3 */
  function chest(u) {
    return v3.copy(u.look.root.position).setY(1.5);
  }

  /** Time Slow is over: every caught round goes back to whoever fired it. */
  function sendBack() {
    let n = 0;
    for (let i = 0; i < N; i++) {
      if (rState[i] !== CAUGHT) continue;
      const owner = rOwner[i];
      const target = owner && !owner.dying ? owner : units.find((u) => !u.dying && !u.gone) || null;
      if (!target) {
        rState[i] = FALLING;
        rVel[i * 3] = rVel[i * 3 + 2] = 0;
        rVel[i * 3 + 1] = -1;
        rLife[i] = 1.5;
        continue;
      }
      rOwner[i] = target;
      const c = chest(target);
      v1.set(c.x - rPos[i * 3], c.y - rPos[i * 3 + 1], c.z - rPos[i * 3 + 2]).normalize();
      rVel[i * 3] = v1.x * GUNNER.returnSpeed;
      rVel[i * 3 + 1] = v1.y * GUNNER.returnSpeed;
      rVel[i * 3 + 2] = v1.z * GUNNER.returnSpeed;
      rLife[i] = 3;
      rState[i] = RETURNING;
      heads?.setColorAt(i, cyan);
      trails?.setColorAt(i, cyan);
      n++;
    }
    if (heads?.instanceColor) heads.instanceColor.needsUpdate = true;
    if (trails?.instanceColor) trails.instanceColor.needsUpdate = true;
    caughtNow = 0;
    if (n > 0) {
      ctx.systems.gunnerSound?.playSendBack();
      notice(`↩ RETURN TO SENDER · ${n} round${n === 1 ? '' : 's'}`);
    }
  }

  /** @param {THREE.Vector3} at @param {THREE.Vector3} facing */
  function ripple(at, facing) {
    const r = ripples.find((x) => x.t >= 1) || ripples[0];
    r.t = 0;
    r.mesh.position.copy(at);
    q.setFromUnitVectors(Z, facing);
    r.mesh.quaternion.copy(q);
    r.mesh.visible = true;
  }

  /**
   * @param {number} dt world seconds
   * @param {number} rawDt real seconds
   * @param {boolean} slowOn
   */
  function stepRounds(dt, rawDt, slowOn) {
    if (!heads || !trails || !roundsAlive) return;
    const r = roger();
    const base = rogerBase();
    let any = false;
    for (let i = 0; i < N; i++) {
      const st = rState[i];
      if (st === FREE) continue;
      const k = i * 3;
      any = true;
      if (st === CAUGHT) {
        // Hanging there, trembling, still pointed at him.
        v1.set(rVel[k], rVel[k + 1], rVel[k + 2]).normalize();
        v2.set(rPos[k] + Math.sin(clock * 37 + i) * 0.008, rPos[k + 1] + Math.sin(clock * 29 + i * 1.7) * 0.008, rPos[k + 2]);
        q.setFromUnitVectors(Z, v1);
        heads.setMatrixAt(i, m4.compose(v2, q, sc.set(1, 1, 1)));
        trails.setMatrixAt(i, m4.compose(v2, q, sc.set(1, 1, 0.25)));
        continue;
      }
      rLife[i] -= dt;
      const x0 = rPos[k];
      const y0 = rPos[k + 1];
      const z0 = rPos[k + 2];
      if (st === FALLING) rVel[k + 1] -= 9.8 * dt;
      rPos[k] += rVel[k] * dt;
      rPos[k + 1] += rVel[k + 1] * dt;
      rPos[k + 2] += rVel[k + 2] * dt;
      if (st === FLYING && r) {
        // The closest it came to Roger along this step.
        const dx = rPos[k] - x0;
        const dz = rPos[k + 2] - z0;
        const len2 = dx * dx + dz * dz || 1;
        const t = THREE.MathUtils.clamp(((r.x - x0) * dx + (r.z - z0) * dz) / len2, 0, 1);
        const cx = x0 + dx * t;
        const cz = z0 + dz * t;
        const cy = y0 + (rPos[k + 1] - y0) * t;
        const d = Math.hypot(cx - r.x, cz - r.z);
        const yIn = cy >= base - 0.1 && cy <= base + GUNNER.rogerTall;
        if (caught(Math.hypot(rPos[k] - r.x, rPos[k + 1] - (base + 1.1), rPos[k + 2] - r.z), slowOn && r.onFoot)) {
          rState[i] = CAUGHT;
          caughtNow++;
          v1.set(rVel[k], rVel[k + 1], rVel[k + 2]).normalize();
          ripple(v2.set(rPos[k], rPos[k + 1], rPos[k + 2]), v1);
          if (caughtNow === 1) ctx.systems.gunnerSound?.playCatch();
          if (!caughtHinted) {
            caughtHinted = true;
            notice('⏱ ROUNDS STOPPED · when time runs again, they go back to him');
          }
          continue;
        }
        if (d < GUNNER.rogerRadius && yIn && r.onFoot) {
          ctx.systems.health.damagePlayer({
            source: 'gunnerRound', type: 'ray', title: 'GUNNED DOWN', sub: 'HAVOC\'s minigun',
            position: { x: x0, y: y0, z: z0 }
          });
          spray(v1.set(cx, cy, cz), 4, 4, 3, 0.6, 0.3);
          rLife[i] = 0;
        } else if (!rWhizz[i] && d < 2.4 && yIn) {
          rWhizz[i] = 1;
          if (whizzQuiet <= 0) {
            whizzQuiet = 0.07;
            ctx.systems.gunnerSound?.playWhizz(0.8);
          }
        }
      } else if (st === RETURNING) {
        const owner = rOwner[i];
        if (owner && !owner.dying) {
          const c = chest(owner);
          // The closest it came to his chest along this step (a returned
          // round covers several metres a frame).
          const sx = rPos[k] - x0;
          const sy = rPos[k + 1] - y0;
          const sz = rPos[k + 2] - z0;
          const s2 = sx * sx + sy * sy + sz * sz || 1;
          const u = THREE.MathUtils.clamp(((c.x - x0) * sx + (c.y - y0) * sy + (c.z - z0) * sz) / s2, 0, 1);
          if (Math.hypot(x0 + sx * u - c.x, y0 + sy * u - c.y, z0 + sz * u - c.z) < 1.0) {
            spray(v1.set(rPos[k], rPos[k + 1], rPos[k + 2]), 5, 7, 0.8, 2, 3);
            ctx.systems.gunnerSound?.playPing(loudness(c));
            if (kind) ctx.systems.enemies.hit(owner, kind, { type: 'bullet', at: { x: c.x, y: c.y, z: c.z } });
            returnedHits++;
            rLife[i] = 0;
          }
        }
      }
      // Into a wall: it stops there, in sparks (cover works). Checked for
      // each round every third frame: a round flies 3.5 m in that time and
      // no building is thinner than that.
      if ((st === FLYING || st === RETURNING) && (i + frameNo) % 3 === 0 && rPos[k + 1] < 30
        && ctx.systems.heroMode?.standable && !ctx.systems.heroMode.standable(rPos[k], rPos[k + 2])) {
        spray(v1.set(rPos[k], rPos[k + 1], rPos[k + 2]), 3, 5, 2.6, 1.3, 0.5);
        rLife[i] = 0;
      }
      if (rPos[k + 1] < 0.05) {
        if (st !== FALLING) spray(v1.set(rPos[k], 0.1, rPos[k + 2]), 2, 4, 2.6, 1.3, 0.5);
        rLife[i] = 0;
      }
      if (rLife[i] <= 0) {
        rState[i] = FREE;
        rOwner[i] = null;
        heads.setMatrixAt(i, zero);
        trails.setMatrixAt(i, zero);
        continue;
      }
      v1.set(rVel[k], rVel[k + 1], rVel[k + 2]);
      const speed = v1.length();
      v1.divideScalar(speed || 1);
      v2.set(rPos[k], rPos[k + 1], rPos[k + 2]);
      q.setFromUnitVectors(Z, v1);
      heads.setMatrixAt(i, m4.compose(v2, q, sc.set(1, 1, 1)));
      // The tracer as long as a few hundredths of a second of flight: in
      // Time Slow, short; stopped, a stub.
      const worldScale = rawDt > 0 ? dt / rawDt : 1;
      trails.setMatrixAt(i, m4.compose(v2, q, sc.set(1, 1, Math.max(0.3, speed * 0.06 * Math.max(0.15, worldScale)))));
    }
    heads.instanceMatrix.needsUpdate = true;
    trails.instanceMatrix.needsUpdate = true;
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
    if (trails.instanceColor) trails.instanceColor.needsUpdate = true;
    roundsAlive = any;
  }

  // ---------------------------------------------------------------------
  // HAVOC himself
  // ---------------------------------------------------------------------

  /**
   * @param {Unit} u
   * @param {number} dt
   * @param {{x: number, z: number, onFoot: boolean}} r
   */
  function think(u, dt, r) {
    const L = u.look;
    const p = L.root.position;
    const dx = r.x - p.x;
    const dz = r.z - p.z;
    const dist = Math.hypot(dx, dz);
    const inRange = dist >= GUNNER.range[0] - 4 && dist <= GUNNER.range[1];
    if (ctx.systems.enemies.getState(u, 'frozen')) return;
    if (u.stun > 0) {
      u.stun -= dt;
      u.spin *= Math.max(0, 1 - dt * 2);
      if (Math.random() < dt * 14) spray(v1.copy(p).setY(1.2 + Math.random()), 3, 5, 1.2, 1.8, 3);
      return;
    }
    // Where to aim: Roger's chest, led a little; the gun swings at most its traverse.
    const aim = lead(p, r, rogerVel, GUNNER.speed);
    const wantYaw = Math.atan2(aim.x - p.x, aim.z - p.z);
    const firing = u.phase === 'firing' || u.phase === 'spinning';
    u.yaw = turnToward(u.yaw, wantYaw, (firing ? THREE.MathUtils.degToRad(GUNNER.traverse) : 2.5) * dt);
    u.timer += dt;
    // Buried (a building came down on him): he climbs out toward Roger,
    // whatever is in the way, until he stands clear.
    if (ctx.systems.heroMode?.standable && !ctx.systems.heroMode.standable(p.x, p.z)) {
      p.x += (dx / (dist || 1)) * GUNNER.walkSpeed * 1.5 * dt;
      p.z += (dz / (dist || 1)) * GUNNER.walkSpeed * 1.5 * dt;
      u.stride += dt * 7;
      return;
    }
    if (u.phase === 'walking') {
      // To the middle of his range, round anything in the way.
      const goal = (GUNNER.range[0] + GUNNER.range[1]) / 2;
      const dir = dist > goal ? 1 : -1;
      if (Math.abs(dist - goal) > 3) {
        const step = GUNNER.walkSpeed * dt * dir;
        const nx = p.x + (dx / (dist || 1)) * step;
        const nz = p.z + (dz / (dist || 1)) * step;
        if (!ctx.systems.heroMode?.standable || ctx.systems.heroMode.standable(nx, nz)) {
          p.x = nx;
          p.z = nz;
        } else {
          p.x += (dz / (dist || 1)) * GUNNER.walkSpeed * dt * u.side;
          p.z -= (dx / (dist || 1)) * GUNNER.walkSpeed * dt * u.side;
        }
        u.stride += dt * 7;
      }
      if (inRange && u.timer > 0.6) startPhase(u, 'spinning');
    } else if (u.phase === 'spinning') {
      u.spin = Math.min(40, u.spin + dt * 34);
      u.heat = Math.max(u.heat, Math.min(0.3, u.timer * 0.25));
      if (u.timer >= GUNNER.spinUp) startPhase(u, 'firing');
    } else if (u.phase === 'firing') {
      u.spin = 40;
      u.heat = Math.min(1, u.heat + dt * 0.35);
      u.owed += dt * GUNNER.rate;
      while (u.owed >= 1) {
        u.owed -= 1;
        // The two guns in turn (gunner/model.js).
        u.alt = (u.alt + 1) % L.guns.length;
        L.guns[u.alt].muzzle.getWorldPosition(v1);
        const ty = rogerBase() + 1.2;
        const flat = Math.hypot(aim.x - v1.x, aim.z - v1.z);
        v2.set(Math.sin(u.yaw), (ty - v1.y) / Math.max(1, flat), Math.cos(u.yaw));
        v2.x += (Math.random() - 0.5) * GUNNER.spread * 2;
        v2.y += (Math.random() - 0.5) * GUNNER.spread * 2;
        v2.z += (Math.random() - 0.5) * GUNNER.spread * 2;
        v2.normalize();
        fireRound(v1, v2, u);
      }
      if (u.timer >= GUNNER.burst) startPhase(u, 'cooling');
    } else {
      // Cooling: a step to the side, barrels glowing and hissing.
      u.spin *= Math.max(0, 1 - dt * 1.5);
      u.heat = Math.max(0, u.heat - dt * 0.3);
      const nx = p.x + (dz / (dist || 1)) * 1.8 * dt * u.side;
      const nz = p.z - (dx / (dist || 1)) * 1.8 * dt * u.side;
      if (!ctx.systems.heroMode?.standable || ctx.systems.heroMode.standable(nx, nz)) {
        p.x = nx;
        p.z = nz;
        u.stride += dt * 4;
      }
      if (Math.random() < dt * 6 * u.heat) {
        L.guns[Math.random() < 0.5 ? 0 : 1].muzzle.getWorldPosition(v1);
        spray(v1, 1, 1.5, 0.6, 0.6, 0.65);
      }
      if (u.timer >= GUNNER.coolDown) {
        u.side = -u.side;
        startPhase(u, nextPhase('cooling', inRange));
      }
    }
  }

  /** @param {Unit} u @param {'walking'|'spinning'|'firing'|'cooling'} phase */
  function startPhase(u, phase) {
    u.phase = phase;
    u.timer = 0;
    const level = loudness(u.look.root.position);
    if (phase === 'spinning') {
      ctx.systems.gunnerSound?.playSpinUp(level, GUNNER.spinUp);
      if (!hinted) {
        hinted = true;
        notice(touch()
          ? '⚠ HAVOC is spinning up · tap ⏱ Slow to slow time: his rounds stop dead round you'
          : '⚠ HAVOC is spinning up · press Q to slow time: his rounds stop dead round you');
      }
    } else if (phase === 'firing') {
      ctx.systems.gunnerSound?.playBurst(level, GUNNER.burst);
    } else if (phase === 'cooling') {
      ctx.systems.gunnerSound?.playWindDown(level);
    }
  }

  /** @param {Unit} u @param {number} dt @param {{x: number, z: number}|null} r */
  function animate(u, dt, r) {
    const L = u.look;
    L.root.rotation.y = u.yaw;
    L.marker.position.y = 3.05 + Math.sin(clock * 4) * 0.12;
    L.marker.rotation.y += dt * 2;
    for (const g of L.guns) g.barrels.rotation.z += u.spin * dt * (g === L.guns[0] ? 1 : -1);
    // The heat: dark steel to dull red to bright orange.
    L.heat.emissive.setRGB(u.heat * 2.2, u.heat * u.heat * 0.9, u.heat * u.heat * u.heat * 0.2);
    // The legs stride while he moves; braced while he fires.
    const swing = Math.sin(u.stride) * 0.45;
    L.legs[0].rotation.x = swing;
    L.legs[1].rotation.x = -swing;
    if (u.flinch > 0) u.flinch -= dt;
    L.body.rotation.x = u.phase === 'firing' ? -0.06 + Math.sin(clock * 60) * 0.012 : 0;
    if (u.flinch > 0) L.body.rotation.x -= u.flinch * 0.6;
    if (u.flashHit > 0) {
      u.flashHit -= dt;
      L.visor.color.setRGB(4, 4, 4);
    } else {
      L.visor.color.setRGB(3.2, 0.15, 0.1);
    }
    const firing = u.phase === 'firing' && u.stun <= 0;
    // The laser sights on Roger while he spins up and fires, one per gun,
    // and each gun tilted to Roger's chest so its laser lands on him.
    const laserOn = (u.phase === 'spinning' || firing) && u.stun <= 0 && !!r;
    for (let k = 0; k < L.guns.length; k++) {
      const g = L.guns[k];
      // The flash on the gun that just fired, and now and then the other.
      g.flash.visible = firing && (k === u.alt ? Math.random() < 0.85 : Math.random() < 0.3);
      if (g.flash.visible) {
        g.flash.rotation.z = Math.random() * Math.PI;
        g.flash.scale.setScalar(0.6 + Math.random() * 0.7);
      }
      g.laser.visible = laserOn;
      if (laserOn && r) {
        g.muzzle.getWorldPosition(v1);
        const d = Math.hypot(r.x - v1.x, r.z - v1.z);
        g.laser.scale.set(1, 1, d);
        g.gun.rotation.x = -Math.atan2(rogerBase() + 1.2 - v1.y, d);
        /** @type {THREE.MeshBasicMaterial} */ (g.laser.material).opacity = u.phase === 'spinning' ? 0.35 + 0.35 * Math.sin(clock * 30) : 0.55;
      }
    }
    // The gun arms recoil back and forth while they fire.
    const kick = firing ? Math.sin(clock * 55) * 0.03 : 0;
    L.guns[0].gun.position.z = 0.02 + kick;
    L.guns[1].gun.position.z = 0.02 - kick;
  }

  /** @param {Unit} u @param {number} dt */
  function topple(u, dt) {
    u.dead += dt;
    const L = u.look;
    const k = Math.min(1, u.dead / 0.9);
    L.body.rotation.x = -k * k * 1.45;
    L.body.position.z = -k * 0.4;
    u.spin *= Math.max(0, 1 - dt * 3);
    for (const g of L.guns) g.barrels.rotation.z += u.spin * dt;
    // The drum cooking off.
    if (u.dead < 2.4 && Math.random() < dt * 10) {
      v1.copy(L.root.position);
      v1.x -= Math.sin(u.yaw) * 1.2;
      v1.z -= Math.cos(u.yaw) * 1.2;
      v1.y = 0.5;
      spray(v1, 6, 9, 3, 1.6, 0.5);
      if (Math.random() < 0.25) ctx.systems.gunnerSound?.playPing(loudness(v1) * 0.6);
    }
    if (u.dead > 4) L.root.position.y = -(u.dead - 4) * 1.2;
    if (u.dead > 5) remove(u);
  }

  /**
   * @param {number} dt world seconds
   * @param {number} rawDt real seconds
   */
  function updateGunners(dt, rawDt) {
    if (!kit) return;
    clock += rawDt;
    frameNo++;
    if (whizzQuiet > 0) whizzQuiet -= rawDt;
    const r = roger();
    const any = units.length > 0 || roundsAlive;
    if (!r) {
      // Out of Hero Mode: he goes with Roger.
      if (any) resetGunners();
      if (button) button.classList.remove('on');
      return;
    }
    // A minute into the game, a pair comes by itself (GUNNER.autoAt); a
    // Reset starts the clock, and so the wait, again.
    const session = ctx.systems.sessionClock ? ctx.systems.sessionClock.seconds() : clock;
    if (session < GUNNER.autoAt) autoSent = false;
    else if (!autoSent) {
      autoSent = true;
      let sent = 0;
      for (let i = 0; i < GUNNER.autoCount; i++) if (send((i - (GUNNER.autoCount - 1) / 2) * 1.4)) sent++;
      if (sent) ctx.events.emit('announce', { title: `HAVOC ×${sent}`, sub: 'Heavy gunners inbound · Q stops their bullets' });
    }
    // Roger's velocity, for the lead.
    if (rogerKnown && dt > 0) {
      v1.set((r.x - rogerPrev.x) / dt, 0, (r.z - rogerPrev.z) / dt);
      if (v1.lengthSq() < 400) rogerVel.lerp(v1, Math.min(1, dt * 4));
    }
    rogerPrev.set(r.x, 0, r.z);
    rogerKnown = true;

    const slowOn = !!ctx.systems.abilities?.isActive && ctx.systems.abilities.isActive('timeSlow');
    if (wasSlow && !slowOn) sendBack();
    wasSlow = slowOn;

    for (const u of units) {
      if (u.gone) continue;
      if (u.dying) topple(u, dt);
      else if (dt > 0) think(u, dt, r);
      if (!u.gone && !u.dying) animate(u, dt, r);
    }
    if (units.some((u) => u.gone)) units = units.filter((u) => !u.gone);

    stepRounds(dt, rawDt, slowOn);
    stepSparks(dt > 0 ? dt : rawDt * 0.1);

    // The sphere of slowed time round Roger: while Time Slow runs and HAVOC
    // is about, or rounds hang in it.
    const want = slowOn && (units.length > 0 || caughtNow > 0) ? 1 : 0;
    bubbleLevel += THREE.MathUtils.clamp(want - bubbleLevel, -rawDt * 4, rawDt * 4);
    if (bubble) {
      bubble.visible = bubbleLevel > 0.01;
      if (bubble.visible) {
        bubble.position.set(r.x, rogerBase() + 1.1, r.z);
        bubbleUniforms.uTime.value = clock;
        bubbleUniforms.uAlpha.value = bubbleLevel * (0.55 + 0.1 * Math.sin(clock * 3));
        bubble.scale.setScalar(0.96 + 0.04 * Math.sin(clock * 2.2));
      }
    }
    for (const rp of ripples) {
      if (rp.t >= 1) continue;
      rp.t = Math.min(1, rp.t + rawDt * 1.8);
      rp.mesh.scale.setScalar(1 + rp.t * 4);
      /** @type {THREE.MeshBasicMaterial} */ (rp.mesh.material).opacity = (1 - rp.t) * 0.9;
      if (rp.t >= 1) rp.mesh.visible = false;
    }
  }

  /** @returns {void} */
  function resetGunners() {
    for (const u of units) if (!u.gone) remove(u);
    units = [];
    rState.fill(FREE);
    rOwner.fill(null);
    rLife.fill(0);
    if (heads && trails) {
      for (let i = 0; i < N; i++) {
        heads.setMatrixAt(i, zero);
        trails.setMatrixAt(i, zero);
      }
      heads.instanceMatrix.needsUpdate = true;
      trails.instanceMatrix.needsUpdate = true;
    }
    roundsAlive = false;
    caughtNow = 0;
    wasSlow = false;
    bubbleLevel = 0;
    if (bubble) bubble.visible = false;
    for (const rp of ripples) {
      rp.t = 1;
      rp.mesh.visible = false;
    }
    hinted = false;
    caughtHinted = false;
    returnedHits = 0;
    rogerKnown = false;
    rogerVel.set(0, 0, 0);
    if (sparks) {
      sparks.life.fill(0);
      sparks.sizes.fill(0);
      markPoolDirty(sparks);
    }
    sparksAlive = false;
  }

  /** @returns {void} */
  function disposeGunners() {
    resetGunners();
    heads?.removeFromParent();
    trails?.removeFromParent();
    heads?.dispose();
    trails?.dispose();
    heads = trails = null;
    bubble?.removeFromParent();
    bubble = null;
    for (const rp of ripples) rp.mesh.removeFromParent();
    ripples = [];
    for (const g of ownGeometries) g.dispose();
    for (const m of ownMaterials) m.dispose();
    ownGeometries.length = ownMaterials.length = 0;
    if (kit) {
      for (const g of kit.all.geos) g.dispose();
      for (const m of kit.all.mats) m.dispose();
      kit = null;
    }
    if (sparks) disposeParticlePool(Sim.three.scene, sparks);
    sparks = null;
    button = null;
  }

  /**
   * The co-op guest's HAVOC (net/system.js): the model's shared kit, and a
   * function making one gunner from it (each has its own heat and visor
   * materials, as here). Nothing is added to the scene and no state is touched.
   * @returns {{kit: ReturnType<typeof buildGunnerKit>, build: () => ReturnType<typeof buildGunner>, geometries: THREE.BufferGeometry[], materials: THREE.Material[]}}
   */
  function buildGuestModel() {
    const own = buildGunnerKit();
    return { kit: own, build: () => buildGunner(own), geometries: own.all.geos, materials: own.all.mats };
  }

  /**
   * What the guest needs to draw each HAVOC still on the field (`figures`
   * rows, net/figurePose.js). Read-only.
   * @returns {{key: object, x: number, y: number, z: number, yaw: number, phase: string, stunned: boolean, spin: number, heat: number, dying: boolean, dead: number}[]}
   */
  function replicaState() {
    const out = [];
    for (const u of units) {
      if (u.gone) continue;
      const p = u.look.root.position;
      out.push({ key: u, x: p.x, y: p.y, z: p.z, yaw: u.yaw, phase: u.phase, stunned: u.stun > 0, spin: u.spin, heat: u.heat, dying: u.dying, dead: u.dead });
    }
    return out;
  }

  return {
    initGunners, updateGunners, resetGunners, disposeGunners, send, buildGuestModel, replicaState,
    count: () => units.filter((u) => !u.dying && !u.gone).length,
    /** Where each HAVOC still up is (the minimap, ui/minimap.js). */
    positions: () => units.filter((u) => !u.dying && !u.gone).map((u) => u.look.root.position),
    caughtCount: () => caughtNow,
    /** What each HAVOC is doing (for testing from the console). */
    returnedHits: () => returnedHits,
    debug: () => units.map((u) => ({ phase: u.phase, t: +u.timer.toFixed(2), heat: +u.heat.toFixed(2), dying: u.dying,
      x: Math.round(u.look.root.position.x), z: Math.round(u.look.root.position.z) }))
  };
}
