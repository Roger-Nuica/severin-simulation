// @ts-check
import * as THREE from 'three';
import { glowMaterial, withGlow, REPLICATOR } from './model.js';

/**
 * ===========================================================================
 * SECTION PZ.3 — The encirclement
 * ===========================================================================
 * When Patient Zero has ENCIRCLE.trigger (15) clones standing, they stop
 * hunting the town and go for Roger together (on request, 2026-10-04):
 *
 *  1. **gather** -- every standing clone comes apart into its blocks, which
 *     stream across town, and builds itself again on a ring ENCIRCLE.radius
 *     (100 m) round Roger, evenly spaced, a ring of red light on the ground
 *     marking it; the swarm call (sound/replicator.js) and a banner;
 *  2. **hold** -- ENCIRCLE.holdSeconds of them all standing still, facing
 *     him, their light flaring;
 *  3. **close** -- the noose tightens at ENCIRCLE.closeSpeed m/s, centred on
 *     Roger wherever he goes, each clone keeping its place on it at up to
 *     ENCIRCLE.runSpeed; inside ENCIRCLE.throwFrom metres each one, every few
 *     seconds, raises an arm and throws a nanite shard at where he is
 *     (ENCIRCLE.shardSpeed, HEALTH.damage.replicatorShard a hit): shots from
 *     every side. At ENCIRCLE.endRadius the ring has closed and they are on
 *     him: the touch, as ever, is infection (instant death).
 *
 * A clone shot down leaves a gap in the ring -- the way out, if he makes it
 * there in time. Fewer than ENCIRCLE.minMembers left and the ring breaks:
 * they go back to hunting one by one. Roger out of play (no run, dead,
 * safe) ends it too. Then ENCIRCLE.cooldown seconds before it can happen
 * again, if there are still 15.
 *
 * The clones' own motion is patientZero.js's (step), reading what this sets
 * on each member: `ring`, `slotX`, `slotZ`, `wind` (the throw's wind-up). The
 * shards are one InstancedMesh pool, the noose one mesh; nothing per frame.
 */

export const ENCIRCLE = {
  trigger: 15,          // clones standing
  radius: 100,          // metres from Roger, where they gather
  holdSeconds: 1.6,
  gatherSeconds: 4,     // at most, waiting for the last to build itself
  closeSpeed: 6,        // m/s the ring shrinks
  runSpeed: 15,         // m/s, a clone keeping its place
  endRadius: 3.5,       // metres: closed, and they are on him
  minMembers: 4,
  cooldown: 25,         // seconds before another
  throwFrom: 75,        // metres: inside this the shards start
  throwEvery: [2.2, 4], // seconds, per clone
  windSeconds: 0.35,    // the arm up before the throw
  shardSpeed: 30,       // m/s
  shardLife: 3,
  shardReach: 0.85,     // metres from Roger's middle: a hit
  maxShards: 48,
  bound: 285            // gather spots kept inside the map
};

/**
 * @param {Object} ctx
 * @param {{
 *   clones: () => any[],
 *   warp: (c: any, x: number, z: number, delay: number) => void,
 *   banner: (title: string, sub: string) => void,
 *   flare: (level: number) => void
 * }} host
 * @returns {{
 *   update: (dt: number) => void,
 *   phase: () => string,
 *   radius: () => number,
 *   reset: () => void,
 *   dispose: () => void
 * }}
 */
export function createEncircle(ctx, host) {
  const { Sim } = ctx;
  /** @type {'idle'|'gather'|'hold'|'close'} */
  let phase = 'idle';
  let timer = 0;
  let radius = ENCIRCLE.radius;
  let cooldown = 0;
  /** @type {any[]} */
  let members = [];

  // The noose: a thin red ring on the ground, scaled to the radius.
  const nooseGeo = new THREE.RingGeometry(0.985, 1, 160);
  nooseGeo.rotateX(-Math.PI / 2);
  const nooseMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(3, 0.15, 0.1), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  });
  const noose = new THREE.Mesh(nooseGeo, nooseMat);
  noose.name = 'replicator_noose';
  noose.visible = false;
  noose.frustumCulled = false;
  Sim.three.scene.add(noose);

  // The shards: thin three-sided spikes, lit hot green.
  const shardGeo = withGlow(new THREE.ConeGeometry(0.05, 0.6, 3), REPLICATOR.greenHot);
  const shardMat = glowMaterial(1.6);
  const shards = new THREE.InstancedMesh(shardGeo, shardMat, ENCIRCLE.maxShards);
  shards.name = 'replicator_shards';
  shards.frustumCulled = false;
  shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shards.count = 0;
  Sim.three.scene.add(shards);
  const sPos = new Float32Array(ENCIRCLE.maxShards * 3);
  const sVel = new Float32Array(ENCIRCLE.maxShards * 3);
  const sLife = new Float32Array(ENCIRCLE.maxShards);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const d = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);

  /** @returns {any} */
  function hero() {
    return ctx.systems.heroMode;
  }

  /**
   * @param {any} c
   * @returns {boolean} standing, whole and not on its way somewhere
   */
  function standing(c) {
    return c.form >= 1 && !c.warp;
  }

  /**
   * @param {{x: number, z: number}} roger
   * @returns {void}
   */
  function start(roger) {
    members = host.clones().filter(standing);
    const n = members.length;
    const base = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const c = members[i];
      const a = base + (i / n) * Math.PI * 2;
      c.ring = true;
      c.slot = a;
      c.wind = 0;
      c.throwT = ENCIRCLE.throwEvery[0] + Math.random() * (ENCIRCLE.throwEvery[1] - ENCIRCLE.throwEvery[0]);
      const x = THREE.MathUtils.clamp(roger.x + Math.sin(a) * ENCIRCLE.radius, -ENCIRCLE.bound, ENCIRCLE.bound);
      const z = THREE.MathUtils.clamp(roger.z + Math.cos(a) * ENCIRCLE.radius, -ENCIRCLE.bound, ENCIRCLE.bound);
      c.slotX = x;
      c.slotZ = z;
      host.warp(c, x, z, i * 0.07);
    }
    phase = 'gather';
    timer = 0;
    radius = ENCIRCLE.radius;
    host.banner('THE SWARM CLOSES IN', `${n} replicas surround Roger at ${ENCIRCLE.radius} m · shoot a gap and run`);
    const sfx = ctx.systems.replicatorSound;
    if (sfx) sfx.playSwarmCall();
    ctx.systems.gamefeel.addShake(0.5, 0.8);
  }

  /** @returns {void} the ring broken or closed: back to the hunt */
  function end() {
    for (const c of members) {
      c.ring = false;
      c.wind = 0;
    }
    members = [];
    phase = 'idle';
    cooldown = ENCIRCLE.cooldown;
    noose.visible = false;
    host.flare(1);
  }

  /**
   * A shard from clone `c` at where Roger is now.
   * @param {any} c
   * @param {{x: number, z: number}} roger
   * @returns {void}
   */
  function throwShard(c, roger) {
    let slot = -1;
    for (let i = 0; i < ENCIRCLE.maxShards; i++) if (sLife[i] <= 0) { slot = i; break; }
    if (slot < 0) return;
    const y0 = 1.7 * (c.size || 1);
    const ty = (hero().rogerHeight ? hero().rogerHeight() : 0) + 1.1;
    d.set(roger.x - c.pos.x, ty - y0, roger.z - c.pos.z).normalize();
    const j = slot * 3;
    sPos[j] = c.pos.x + d.x * 0.6;
    sPos[j + 1] = y0;
    sPos[j + 2] = c.pos.z + d.z * 0.6;
    sVel[j] = d.x * ENCIRCLE.shardSpeed;
    sVel[j + 1] = d.y * ENCIRCLE.shardSpeed;
    sVel[j + 2] = d.z * ENCIRCLE.shardSpeed;
    sLife[slot] = ENCIRCLE.shardLife;
    const sfx = ctx.systems.replicatorSound;
    if (sfx) sfx.playShard(c.pos.x, c.pos.z);
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateShards(dt) {
    const h = hero();
    const roger = h && h.rogerTarget();
    const ry = (h && h.rogerHeight ? h.rogerHeight() : 0) + 1;
    let top = 0;
    for (let i = 0; i < ENCIRCLE.maxShards; i++) {
      if (sLife[i] <= 0) {
        shards.setMatrixAt(i, zero);
        continue;
      }
      sLife[i] -= dt;
      const j = i * 3;
      sPos[j] += sVel[j] * dt;
      sPos[j + 1] += sVel[j + 1] * dt;
      sPos[j + 2] += sVel[j + 2] * dt;
      if (roger && Math.hypot(sPos[j] - roger.x, sPos[j + 1] - ry, sPos[j + 2] - roger.z) < ENCIRCLE.shardReach) {
        ctx.systems.health.damagePlayer({
          source: 'replicatorShard', type: 'ray', title: 'SHREDDED', sub: 'Replicator shards from every side',
          position: { x: sPos[j] - sVel[j], y: sPos[j + 1], z: sPos[j + 2] - sVel[j + 2] }
        });
        sLife[i] = 0;
      }
      if (sPos[j + 1] < 0) sLife[i] = 0;
      if (sLife[i] <= 0) {
        shards.setMatrixAt(i, zero);
        continue;
      }
      d.set(sVel[j], sVel[j + 1], sVel[j + 2]).normalize();
      q.setFromUnitVectors(up, d);
      m4.compose(p.set(sPos[j], sPos[j + 1], sPos[j + 2]), q, one);
      shards.setMatrixAt(i, m4);
      top = i + 1;
    }
    shards.count = top;
    shards.instanceMatrix.needsUpdate = true;
  }

  /**
   * @param {number} dt simulation seconds
   * @returns {void}
   */
  function update(dt) {
    if (dt <= 0) return;
    if (cooldown > 0) cooldown -= dt;
    updateShards(dt);
    const h = hero();
    const roger = h && h.rogerTarget();
    if (phase === 'idle') {
      if (!roger || cooldown > 0) return;
      let n = 0;
      for (const c of host.clones()) if (standing(c)) n++;
      if (n >= ENCIRCLE.trigger) start(roger);
      return;
    }
    if (!roger) {
      end();
      return;
    }
    // The fallen are out of the ring.
    const alive = host.clones();
    members = members.filter((c) => alive.includes(c));
    if (members.length < ENCIRCLE.minMembers) {
      host.banner('THE RING IS BROKEN', 'Too few replicas left to hold it');
      end();
      return;
    }
    timer += dt;
    noose.visible = true;
    noose.position.set(roger.x, 0.07, roger.z);
    noose.scale.set(radius, 1, radius);
    nooseMat.opacity = 0.55 + 0.35 * Math.sin(timer * (phase === 'close' ? 9 : 4));
    if (phase === 'gather') {
      if (members.every(standing) || timer > ENCIRCLE.gatherSeconds) {
        phase = 'hold';
        timer = 0;
        host.flare(2.4);
      }
      return;
    }
    if (phase === 'hold') {
      if (timer >= ENCIRCLE.holdSeconds) {
        phase = 'close';
        timer = 0;
        host.flare(1.6);
      }
      return;
    }
    // Closing.
    radius = Math.max(ENCIRCLE.endRadius, radius - ENCIRCLE.closeSpeed * dt);
    for (const c of members) {
      c.slotX = roger.x + Math.sin(c.slot) * radius;
      c.slotZ = roger.z + Math.cos(c.slot) * radius;
      if (radius > ENCIRCLE.throwFrom || !standing(c)) continue;
      if (c.wind > 0) {
        c.wind -= dt;
        if (c.wind <= 0) throwShard(c, roger);
        continue;
      }
      c.throwT -= dt;
      if (c.throwT <= 0) {
        c.throwT = ENCIRCLE.throwEvery[0] + Math.random() * (ENCIRCLE.throwEvery[1] - ENCIRCLE.throwEvery[0]);
        c.wind = ENCIRCLE.windSeconds;
      }
    }
    if (radius <= ENCIRCLE.endRadius) end();
  }

  /** @returns {void} */
  function reset() {
    for (const c of members) c.ring = false;
    members = [];
    phase = 'idle';
    cooldown = 0;
    noose.visible = false;
    sLife.fill(0);
    shards.count = 0;
  }

  /** @returns {void} */
  function dispose() {
    reset();
    Sim.three.scene.remove(noose, shards);
    nooseGeo.dispose();
    nooseMat.dispose();
    shards.dispose();
    shardGeo.dispose();
    shardMat.dispose();
  }

  return { update, phase: () => phase, radius: () => radius, reset, dispose };
}
