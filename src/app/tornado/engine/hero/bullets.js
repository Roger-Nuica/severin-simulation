// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION AM.2 — The minigun's bullets, and Bullet Time
 * ===========================================================================
 * The minigun's rounds are bullets now, not dots of light: a brass capsule
 * with a glowing tip and a thin tracer trail behind it, flying from the
 * muzzle to where the sights were on when it was fired. Each carries its
 * hit with it (traced down the sights as it leaves, heroWeapons.js), and
 * the hit lands when the bullet gets there -- sparks and dust on anything
 * hard, the damage on what it was aimed at. Spent casings spin out of the
 * gun and bounce on the ground.
 *
 * **Bullet Time** (Q with the minigun in hand, player/abilities.js): the
 * world drops to almost a stop, and so do the bullets. Rounds already in
 * the air hang where they are, trails and all; rounds fired during it fly
 * BULLETS.hangAfter metres and then hang too, so a held trigger builds a
 * spray of suspended bullets in front of Roger. When it ends, every one of
 * them goes on at its own speed and direction, and they all hit together.
 *
 * Everything is instanced: one mesh each for the bodies, the tips, the
 * trails and the casings, at most BULLETS.max bullets and BULLETS.casings
 * casings alive (the oldest is reused).
 */

export const BULLETS = {
  max: 300,
  speed: 320,               // m/s
  length: 0.42,             // the body, metres (drawn a little larger than life to be seen)
  radius: 0.05,
  trail: 7,                 // metres of tracer behind it at full speed
  hangAfter: 5,             // metres a round fired in Bullet Time flies before it hangs
  crawl: 0.004,             // and then its speed, of full: a metre or so a second
  casings: 140,
  casingLife: 4,
  sparkEvery: 2,            // sparks on every second hard hit
  brass: 0xc9a043
};

/**
 * @typedef {Object} BulletHit
 * @property {string} kind traceAim's
 * @property {any} obj
 * @property {THREE.Vector3} at
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   fire: (from: THREE.Vector3, to: THREE.Vector3, hit: BulletHit, eject: THREE.Vector3, side: THREE.Vector3) => void,
 *   setFrozen: (on: boolean) => void,
 *   suspended: () => number,
 *   update: (rawDt: number, worldScale: number, onHit: (hit: BulletHit) => void) => void,
 *   clear: () => void,
 *   dispose: () => void
 * }}
 */
export function createBullets(ctx) {
  const { Sim } = ctx;
  const N = BULLETS.max;
  const bodyGeo = new THREE.CapsuleGeometry(BULLETS.radius, BULLETS.length, 3, 8);
  bodyGeo.rotateX(Math.PI / 2);
  const brass = new THREE.MeshStandardMaterial({ color: BULLETS.brass, metalness: 0.9, roughness: 0.3, emissive: 0x2a1d06 });
  const bodies = new THREE.InstancedMesh(bodyGeo, brass, N);
  const tipGeo = new THREE.SphereGeometry(BULLETS.radius * 1.3, 8, 6);
  const tipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.8, 0.7), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const tips = new THREE.InstancedMesh(tipGeo, tipMat, N);
  // A unit tracer along -z from its origin (the bullet), stretched per round.
  const trailGeo = new THREE.CylinderGeometry(0.018, 0.006, 1, 5, 1, true);
  trailGeo.rotateX(Math.PI / 2);
  trailGeo.translate(0, 0, -0.5);
  const trailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.5, 0.6), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const trails = new THREE.InstancedMesh(trailGeo, trailMat, N);
  const casingGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.11, 6);
  const casings = new THREE.InstancedMesh(casingGeo, brass, BULLETS.casings);
  for (const mesh of [bodies, tips, trails, casings]) {
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = false;
    Sim.three.scene.add(mesh);
  }
  bodies.name = 'minigun_bullets';
  trails.name = 'minigun_tracers';
  casings.name = 'minigun_casings';

  /** @type {{pos: THREE.Vector3, dir: THREE.Vector3, left: number, flown: number, hang: number, hit: BulletHit|null, live: boolean}[]} */
  const bullets = [];
  for (let i = 0; i < N; i++) {
    bullets.push({ pos: new THREE.Vector3(), dir: new THREE.Vector3(), left: 0, flown: 0, hang: Infinity, hit: null, live: false });
  }
  /** @type {{pos: THREE.Vector3, vel: THREE.Vector3, spin: THREE.Vector3, rot: THREE.Euler, life: number}[]} */
  const shells = [];
  for (let i = 0; i < BULLETS.casings; i++) {
    shells.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), rot: new THREE.Euler(), life: 0 });
  }
  let nextBullet = 0;
  let nextShell = 0;
  let frozen = false;
  let sparkCount = 0;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const tipAt = new THREE.Vector3();
  const Z = new THREE.Vector3(0, 0, 1);
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  /**
   * One round out of the muzzle, and its casing out of the side.
   * @param {THREE.Vector3} from the muzzle
   * @param {THREE.Vector3} to where it will stop
   * @param {BulletHit} hit what happens there
   * @param {THREE.Vector3} eject where the casing comes out
   * @param {THREE.Vector3} side the gun's right, for the casing's throw
   * @returns {void}
   */
  function fire(from, to, hit, eject, side) {
    const b = bullets[nextBullet];
    nextBullet = (nextBullet + 1) % N;
    // The oldest still flying is finished now rather than lost.
    b.pos.copy(from);
    b.dir.subVectors(to, from);
    b.left = b.dir.length();
    b.dir.divideScalar(b.left || 1);
    b.flown = 0;
    b.hang = frozen ? BULLETS.hangAfter : Infinity;
    b.hit = hit;
    b.live = true;
    const c = shells[nextShell];
    nextShell = (nextShell + 1) % BULLETS.casings;
    c.pos.copy(eject);
    c.vel.copy(side).multiplyScalar(2.5 + Math.random() * 1.5);
    c.vel.y += 2 + Math.random() * 1.5;
    c.spin.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
    c.rot.set(Math.random() * 6, Math.random() * 6, 0);
    c.life = BULLETS.casingLife;
  }

  /**
   * Bullet Time on or off: on, what flies hangs; off, it all goes on.
   * @param {boolean} on
   * @returns {void}
   */
  function setFrozen(on) {
    frozen = on;
    if (!on) for (const b of bullets) b.hang = Infinity;
  }

  /** @returns {number} rounds hanging in the air */
  function suspended() {
    let n = 0;
    for (const b of bullets) if (b.live && frozen && b.flown >= b.hang) n++;
    return n;
  }

  /**
   * @param {number} rawDt real seconds
   * @param {number} worldScale the world's time scale (for the casings)
   * @param {(hit: BulletHit) => void} onHit what a round does where it lands
   * @returns {void}
   */
  function update(rawDt, worldScale, onHit) {
    let any = 0;
    for (let i = 0; i < N; i++) {
      const b = bullets[i];
      if (!b.live) {
        bodies.setMatrixAt(i, hidden);
        tips.setMatrixAt(i, hidden);
        trails.setMatrixAt(i, hidden);
        continue;
      }
      any = i + 1;
      // In Bullet Time a round crawls with the world, once it has flown its
      // few metres; otherwise at full speed.
      const free = frozen && b.flown < b.hang;
      const step = BULLETS.speed * rawDt * (frozen && !free ? BULLETS.crawl : 1);
      const move = Math.min(step, b.left, free ? b.hang - b.flown + 1e-3 : Infinity);
      b.pos.addScaledVector(b.dir, move);
      b.left -= move;
      b.flown += move;
      if (b.left <= 1e-3) {
        b.live = false;
        if (b.hit) {
          if (b.hit.kind !== 'sky' && b.hit.kind !== 'person' && ++sparkCount % BULLETS.sparkEvery === 0) {
            ctx.systems.explosions.spawnImpactBurst(b.hit.at, 0.2);
            if (b.hit.kind === 'ground' && ctx.systems.earthquake) ctx.systems.earthquake.kickDust(b.hit.at.x, b.hit.at.z, 0.4, 0.5);
          }
          onHit(b.hit);
        }
        bodies.setMatrixAt(i, hidden);
        tips.setMatrixAt(i, hidden);
        trails.setMatrixAt(i, hidden);
        continue;
      }
      q.setFromUnitVectors(Z, b.dir);
      m4.compose(b.pos, q, s.set(1, 1, 1));
      bodies.setMatrixAt(i, m4);
      tipAt.copy(b.pos).addScaledVector(b.dir, BULLETS.length * 0.5 + BULLETS.radius);
      m4.compose(tipAt, q, s.set(1, 1, 1));
      tips.setMatrixAt(i, m4);
      // The tracer: as long as it has flown, up to its full length.
      const len = Math.min(BULLETS.trail, b.flown);
      m4.compose(b.pos, q, s.set(1, 1, Math.max(0.01, len)));
      trails.setMatrixAt(i, m4);
    }
    for (const mesh of [bodies, tips, trails]) {
      mesh.count = any;
      mesh.instanceMatrix.needsUpdate = true;
    }

    // The casings: on the world's time, so they hang in Bullet Time too.
    const dt = rawDt * worldScale;
    let shown = 0;
    for (let i = 0; i < BULLETS.casings; i++) {
      const c = shells[i];
      if (c.life <= 0) {
        casings.setMatrixAt(i, hidden);
        continue;
      }
      shown = i + 1;
      c.life -= dt;
      c.vel.y -= 9.8 * dt;
      c.pos.addScaledVector(c.vel, dt);
      if (c.pos.y < 0.03) {
        c.pos.y = 0.03;
        c.vel.y = Math.abs(c.vel.y) * 0.35;
        c.vel.x *= 0.6;
        c.vel.z *= 0.6;
        c.spin.multiplyScalar(0.6);
      }
      c.rot.x += c.spin.x * dt;
      c.rot.y += c.spin.y * dt;
      c.rot.z += c.spin.z * dt;
      q.setFromEuler(c.rot);
      m4.compose(c.pos, q, s.set(1, 1, 1));
      casings.setMatrixAt(i, c.life > 0 ? m4 : hidden);
    }
    casings.count = shown;
    casings.instanceMatrix.needsUpdate = true;
  }

  /** @returns {void} everything gone (a run ending) */
  function clear() {
    for (const b of bullets) b.live = false;
    for (const c of shells) c.life = 0;
    frozen = false;
    for (const mesh of [bodies, tips, trails, casings]) mesh.count = 0;
  }

  /** @returns {void} */
  function dispose() {
    for (const mesh of [bodies, tips, trails, casings]) {
      Sim.three.scene.remove(mesh);
      mesh.dispose();
    }
    for (const g of [bodyGeo, tipGeo, trailGeo, casingGeo]) g.dispose();
    for (const m of [brass, tipMat, trailMat]) m.dispose();
  }

  return { fire, setFrozen, suspended, update, clear, dispose };
}
