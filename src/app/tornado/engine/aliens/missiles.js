// @ts-check
import * as THREE from 'three';
import { createWeaponFx } from '../hero/weaponFx.js';
import { missileSeconds, missileExtra, missileEase } from '../net/enemyFx.js';

/**
 * ===========================================================================
 * SECTION AK.7 — The landing ship's homing missiles
 * ===========================================================================
 * Once the landing ship has taken its four people it pulls its ramp in,
 * climbs and turns hunter (aliens.js, ship.js liftOff), and its weapon is
 * these: dark missiles with a red eye in the nose, launched in pairs from
 * its rim, that follow Roger wherever he goes until they reach him (on
 * request). They are faster than he runs and turn hard, so running alone
 * does not lose them; they climb over a building in their way rather than
 * go into it, and one that has flown for MISSILE.life seconds goes up where
 * it is. Each leaves a smoke trail and a red glow.
 *
 * `stepMissile` is the flight, free of three.js so it runs under
 * `node --test` (tests/alienMissiles.test.mjs).
 */

export const MISSILE = Object.freeze({
  /** At most this many in the air at once. */
  max: 6,
  /** Launch speed and top speed (m/s); Roger runs at 9 (hero/config.js). */
  speed0: 14,
  speed1: 30,
  accel: 14,
  /** How fast it turns towards him (rad/s). */
  turn: 2.6,
  /** It reaches him within this (m). */
  hitRadius: 1.7,
  /** Seconds before it gives up and goes up where it is. */
  life: 16,
  /** Its blast: anyone this near is caught (m). */
  blastRadius: 3.2,
  /** Seconds between pairs, and between the two of a pair. */
  every: Object.freeze([3.6, 5.4]),
  pairGap: 0.35,
  /** It only fires at Roger this near (m, on the ground). */
  range: 140,
  /** Trail: puffs per missile, and how long one lasts (s). */
  trail: 16,
  trailEvery: 0.045,
  trailLife: 0.75
});

/**
 * @typedef {Object} Flight
 * @property {number} x @property {number} y @property {number} z
 * @property {number} dx @property {number} dy @property {number} dz unit heading
 * @property {number} speed
 * @property {number} age
 */

/**
 * One step of a missile's flight: it speeds up, turns towards the target
 * by at most MISSILE.turn·dt, and moves. `climb` lifts its aim (a building
 * ahead). Mutates and returns `m`.
 * @param {Flight} m
 * @param {{x: number, y: number, z: number}} target
 * @param {number} dt
 * @param {number} [climb] metres to aim above the target this step
 * @returns {Flight}
 */
export function stepMissile(m, target, dt, climb = 0) {
  m.age += dt;
  m.speed = Math.min(MISSILE.speed1, m.speed + MISSILE.accel * dt);
  let tx = target.x - m.x;
  let ty = target.y + climb - m.y;
  let tz = target.z - m.z;
  const d = Math.hypot(tx, ty, tz) || 1;
  tx /= d;
  ty /= d;
  tz /= d;
  const cos = Math.max(-1, Math.min(1, m.dx * tx + m.dy * ty + m.dz * tz));
  const angle = Math.acos(cos);
  const max = MISSILE.turn * dt;
  if (angle <= max || angle < 1e-6) {
    m.dx = tx;
    m.dy = ty;
    m.dz = tz;
  } else {
    // Slerp the heading towards the target by `max` radians.
    const k = max / angle;
    m.dx += (tx - m.dx) * k;
    m.dy += (ty - m.dy) * k;
    m.dz += (tz - m.dz) * k;
    const n = Math.hypot(m.dx, m.dy, m.dz) || 1;
    m.dx /= n;
    m.dy /= n;
    m.dz /= n;
  }
  m.x += m.dx * m.speed * dt;
  m.y += m.dy * m.speed * dt;
  m.z += m.dz * m.speed * dt;
  return m;
}

/**
 * @param {Object} ctx
 * @param {Object} S the aliens' shared state (see aliens.js)
 * @param {Object} api every aliens module's functions, by name
 * @returns {Object}
 */
export function createAlienMissiles(ctx, S, api) {
  const { Sim } = ctx;
  /** @type {THREE.BufferGeometry[]} */
  let geometries = [];
  /** @type {THREE.Material[]} */
  let materials = [];
  /**
   * `fly` is a co-op guest's drawing of a host missile (net/enemyFx.js): an eased straight path
   * from `x0..` to `x1..` over `dur` seconds, no homing; `on` is false for the host's own.
   * @type {{group: THREE.Group, alive: boolean, f: Flight, puffT: number, puffs: Float32Array, head: number,
   *   fly: {on: boolean, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, t: number, dur: number, sound: boolean}}[]}
   */
  let pool = [];
  /** @type {THREE.InstancedMesh|null} */
  let smoke = null;
  /** @type {THREE.InstancedMesh|null} */
  let flame = null;
  const Z = new THREE.Vector3(0, 0, 1);
  const dir = new THREE.Vector3();
  const at = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s3 = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const target = { x: 0, y: 0, z: 0 };
  /** Announces each launch to the co-op guest (hero/weaponFx.js); nothing happens outside a room with a guest. */
  const weaponFx = createWeaponFx(ctx);
  const fxEnd = { x: 0, y: 0, z: 0 };

  /** @returns {void} */
  function initMissiles() {
    const body = new THREE.CylinderGeometry(0.22, 0.26, 2.2, 8).rotateX(Math.PI / 2);
    const nose = new THREE.ConeGeometry(0.22, 0.7, 8).rotateX(Math.PI / 2).translate(0, 0, 1.45);
    const eye = new THREE.SphereGeometry(0.16, 8, 6).translate(0, 0, 1.55);
    const fin = new THREE.BoxGeometry(0.9, 0.05, 0.5).translate(0, 0, -0.85);
    const motor = new THREE.ConeGeometry(0.34, 1.6, 8, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -1.9);
    const puff = new THREE.IcosahedronGeometry(0.5, 1);
    geometries = [body, nose, eye, fin, motor, puff];
    const hull = new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.4, metalness: 0.7 });
    const red = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.25, 0.2) });
    const fire = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.9, 0.35), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const grey = new THREE.MeshBasicMaterial({ color: 0x9a9da3, transparent: true, opacity: 0.42, depthWrite: false });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.35, 0.18), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    materials = [hull, red, fire, grey, glow];
    pool = [];
    for (let i = 0; i < MISSILE.max; i++) {
      const group = new THREE.Group();
      group.name = 'alien_missile';
      group.add(new THREE.Mesh(body, hull), new THREE.Mesh(nose, hull), new THREE.Mesh(eye, red), new THREE.Mesh(motor, fire));
      const finA = new THREE.Mesh(fin, hull);
      const finB = new THREE.Mesh(fin, hull);
      finB.rotation.z = Math.PI / 2;
      group.add(finA, finB);
      group.visible = false;
      Sim.three.scene.add(group);
      pool.push({ group, alive: false, f: { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, speed: 0, age: 0 }, puffT: 0, puffs: new Float32Array(MISSILE.trail * 4), head: 0,
        fly: { on: false, x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0, t: 0, dur: 1, sound: false } });
    }
    const n = MISSILE.max * MISSILE.trail;
    smoke = new THREE.InstancedMesh(puff, grey, n);
    flame = new THREE.InstancedMesh(puff, glow, n);
    for (const mesh of [smoke, flame]) {
      mesh.name = 'alien_missile_trail';
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      for (let i = 0; i < n; i++) mesh.setMatrixAt(i, zero);
      Sim.three.scene.add(mesh);
    }
  }

  /** @returns {number} missiles in the air */
  function missilesOut() {
    let n = 0;
    for (const m of pool) if (m.alive) n++;
    return n;
  }

  /**
   * One missile off the ship's rim at `from`, first heading `heading` (a unit vector).
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} heading
   * @returns {boolean} whether there was one free
   */
  function launchMissile(from, heading) {
    const m = pool.find(x => !x.alive);
    if (!m) return false;
    m.alive = true;
    Object.assign(m.f, { x: from.x, y: from.y, z: from.z, dx: heading.x, dy: heading.y, dz: heading.z, speed: MISSILE.speed0, age: 0 });
    m.puffT = 0;
    m.puffs.fill(0);
    m.group.visible = true;
    ctx.systems.jetSound?.playRocketLaunch(level(from));
    // Last: the co-op guest sees it fly too (net/enemyFx.js `missile`); one read outside a room.
    const net = ctx.systems.net;
    if (net && net.fxLive()) announceLaunch(from, heading);
    return true;
  }

  /**
   * The host's launch as a row: where it left, where it is expected to arrive (Roger's chest now,
   * or straight on and down when no one is there) and how long that should take.
   * @param {THREE.Vector3} from @param {THREE.Vector3} heading unit
   * @returns {void}
   */
  function announceLaunch(from, heading) {
    const hero = api.heroTarget(from.x, from.z);
    if (hero) {
      fxEnd.x = hero.x;
      fxEnd.y = heroY(hero);
      fxEnd.z = hero.z;
    } else {
      fxEnd.x = from.x + heading.x * 40;
      fxEnd.y = 0;
      fxEnd.z = from.z + heading.z * 40;
    }
    const d = Math.hypot(fxEnd.x - from.x, fxEnd.y - from.y, fxEnd.z - from.z);
    weaponFx.announce('missile', from, fxEnd, '', missileExtra(missileSeconds(d)));
  }

  /**
   * A missile the co-op host announced, drawn on this screen: the same model and trail, flown on an
   * eased straight path from where it left to where the host expected it to arrive, and a cosmetic
   * burst there. It homes on nothing here and hurts nobody (R-053). It takes one of the pool's
   * slots (no new cap, R-048); with none free it is not drawn.
   * @param {{x: number, y: number, z: number}} from @param {{x: number, y: number, z: number}} to
   * @param {number} seconds the flight
   * @param {boolean} sound the launch and the burst may be heard (the mirror's rate cap)
   * @returns {boolean} whether there was a slot
   */
  function showMissile(from, to, seconds, sound) {
    const m = pool.find(x => !x.alive);
    if (!m) return false;
    const w = m.fly;
    w.on = true;
    w.x0 = from.x; w.y0 = from.y; w.z0 = from.z;
    w.x1 = to.x; w.y1 = to.y; w.z1 = to.z;
    w.t = 0;
    w.dur = Math.max(0.1, seconds);
    w.sound = sound;
    dir.set(w.x1 - w.x0, w.y1 - w.y0, w.z1 - w.z0);
    if (dir.lengthSq() < 1e-6) dir.set(0, -0.35, 1);
    dir.normalize();
    m.alive = true;
    Object.assign(m.f, { x: from.x, y: from.y, z: from.z, dx: dir.x, dy: dir.y, dz: dir.z, speed: MISSILE.speed0, age: 0 });
    m.puffT = 0;
    m.puffs.fill(0);
    m.group.position.set(from.x, from.y, from.z);
    m.group.quaternion.setFromUnitVectors(Z, dir);
    m.group.visible = true;
    if (sound) ctx.systems.jetSound?.playRocketLaunch(level(from));
    return true;
  }

  /**
   * One step of a drawn missile: along its eased path, its trail, and the burst at the end.
   * @param {Object} m
   * @param {number} dt
   * @returns {void}
   */
  function stepShown(m, dt) {
    const w = m.fly;
    const f = m.f;
    w.t += dt;
    const u = Math.min(1, w.t / w.dur);
    const s = missileEase(u);
    f.x = w.x0 + (w.x1 - w.x0) * s;
    f.y = w.y0 + (w.y1 - w.y0) * s;
    f.z = w.z0 + (w.z1 - w.z0) * s;
    m.group.position.set(f.x, f.y, f.z);
    trailPuff(m, f, dt);
    if (u < 1) return;
    w.on = false;
    m.alive = false;
    m.group.visible = false;
    at.set(f.x, Math.max(1, f.y), f.z);
    ctx.systems.explosions.cosmeticExplosion(at.x, at.y, at.z, 1.6, w.sound);
    if (w.sound) ctx.systems.jetSound?.playBlast(level(at));
  }

  /**
   * The smoke puff a missile leaves every `MISSILE.trailEvery` seconds (the host's and a drawn one's).
   * @param {Object} m
   * @param {Flight} f
   * @param {number} dt
   * @returns {void}
   */
  function trailPuff(m, f, dt) {
    m.puffT -= dt;
    if (m.puffT > 0) return;
    m.puffT = MISSILE.trailEvery;
    const k = m.head * 4;
    m.puffs[k] = f.x - f.dx * 2.2;
    m.puffs[k + 1] = f.y - f.dy * 2.2;
    m.puffs[k + 2] = f.z - f.dz * 2.2;
    m.puffs[k + 3] = MISSILE.trailLife;
    m.head = (m.head + 1) % MISSILE.trail;
  }

  /**
   * @param {{x: number, y: number, z: number}} p
   * @returns {number} 0..1, how loud something there is at the camera
   */
  function level(p) {
    const c = Sim.three.camera.position;
    return Math.max(0, 1 - Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z) / 450);
  }

  /**
   * The height it must clear for a building just ahead of it, 0 if none.
   * @param {Flight} f
   * @returns {number}
   */
  function climbFor(f) {
    const ax = f.x + f.dx * 7;
    const az = f.z + f.dz * 7;
    let lift = 0;
    for (const b of ctx.Environment.buildings) {
      if (b.damageState === 'collapsed') continue;
      const fp = b.mesh.userData.footprint;
      if (!fp) continue;
      const p = b.mesh.position;
      if (Math.abs(ax - p.x) > fp.width / 2 + 1.5 || Math.abs(az - p.z) > fp.depth / 2 + 1.5) continue;
      const top = (b.mesh.userData.wallHeight || 12) + 3;
      if (f.y < top) lift = Math.max(lift, top);
    }
    return lift;
  }

  /**
   * A missile going up: the burst, the sound, and Roger caught if near.
   * @param {Object} m
   * @param {boolean} direct it reached him
   * @returns {void}
   */
  function burst(m, direct) {
    m.alive = false;
    m.group.visible = false;
    at.set(m.f.x, Math.max(1, m.f.y), m.f.z);
    ctx.systems.explosions.spawnImpactBurst(at, 1.6);
    ctx.systems.jetSound?.playBlast(level(at));
    if (ctx.systems.gamefeel) ctx.systems.gamefeel.event('person', at);
    const hero = api.heroTarget(at.x, at.z);
    if (!hero) return;
    const hy = heroY(hero);
    if (direct || Math.hypot(hero.x - at.x, hy - at.y, hero.z - at.z) < MISSILE.blastRadius) {
      ctx.systems.health.damagePlayer({
        source: 'alienMissile', type: 'blast', title: 'MISSILE HIT', sub: 'A homing missile from the alien ship caught Roger', targetId: hero.id ?? '0'
      });
    }
    for (const person of ctx.Environment.people.slice()) {
      if (!person.mesh.parent || person.abducted) continue;
      const p = person.mesh.position;
      if (Math.hypot(p.x - at.x, p.z - at.z) < MISSILE.blastRadius && p.y < at.y + 3) ctx.systems.people.explodePerson(person);
    }
  }

  /**
   * @param {{x: number, z: number, y?: number}} hero
   * @returns {number} the height of his chest
   */
  function heroY(hero) {
    if (hero.y !== undefined) return hero.y + 1.1;
    const hm = ctx.systems.heroMode;
    return (hm && hm.rogerHeight ? hm.rogerHeight() : 0) + 1.1;
  }

  /**
   * @param {number} dt world time
   * @returns {void}
   */
  function updateMissiles(dt) {
    if (!smoke || !flame) return;
    let i = 0;
    for (const m of pool) {
      if (m.alive && m.fly.on) {
        stepShown(m, dt);
      } else if (m.alive) {
        const f = m.f;
        const hero = api.heroTarget(f.x, f.z);
        if (hero) {
          target.x = hero.x;
          target.y = heroY(hero);
          target.z = hero.z;
        } else {
          // Roger gone (dead, out of Hero Mode): straight on and down.
          target.x = f.x + f.dx * 40;
          target.y = 0;
          target.z = f.z + f.dz * 40;
        }
        // A building ahead: over it first, then down on him again.
        const top = climbFor(f);
        if (top > 0) {
          target.x = f.x + f.dx * 10;
          target.y = top + 2;
          target.z = f.z + f.dz * 10;
        }
        stepMissile(f, target, dt);
        m.group.position.set(f.x, f.y, f.z);
        q.setFromUnitVectors(Z, dir.set(f.dx, f.dy, f.dz));
        m.group.quaternion.copy(q);
        trailPuff(m, f, dt);
        const reached = hero && Math.hypot(hero.x - f.x, heroY(hero) - f.y, hero.z - f.z) < MISSILE.hitRadius;
        if (reached || f.y < 0.3 || f.age > MISSILE.life || hitsBuilding(f)) burst(m, !!reached);
      }
      // The trail fades even after it has gone up.
      for (let t = 0; t < MISSILE.trail; t++, i++) {
        const k = t * 4;
        if (m.puffs[k + 3] <= 0) {
          smoke.setMatrixAt(i, zero);
          flame.setMatrixAt(i, zero);
          continue;
        }
        m.puffs[k + 3] -= dt;
        const u = Math.max(0, m.puffs[k + 3] / MISSILE.trailLife);
        at.set(m.puffs[k], m.puffs[k + 1] + (1 - u) * 0.8, m.puffs[k + 2]);
        m4.compose(at, q.identity(), s3.setScalar(0.5 + (1 - u) * 2.2));
        smoke.setMatrixAt(i, m4);
        m4.compose(at, q, s3.setScalar(u > 0.6 ? (u - 0.6) * 2.2 : 0));
        flame.setMatrixAt(i, m4);
      }
    }
    smoke.instanceMatrix.needsUpdate = true;
    flame.instanceMatrix.needsUpdate = true;
  }

  /**
   * @param {Flight} f
   * @returns {boolean} whether it has flown into a standing building
   */
  function hitsBuilding(f) {
    for (const b of ctx.Environment.buildings) {
      if (b.damageState === 'collapsed') continue;
      const fp = b.mesh.userData.footprint;
      if (!fp) continue;
      const p = b.mesh.position;
      if (Math.abs(f.x - p.x) < fp.width / 2 && Math.abs(f.z - p.z) < fp.depth / 2 && f.y < (b.mesh.userData.wallHeight || 12)) {
        ctx.systems.damage.shockBuilding(b, 1.2, at.set(f.x, f.y, f.z));
        return true;
      }
    }
    return false;
  }

  /** @returns {void} */
  function resetMissiles() {
    for (const m of pool) {
      m.alive = false;
      m.fly.on = false;
      m.group.visible = false;
      m.puffs.fill(0);
    }
    const n = MISSILE.max * MISSILE.trail;
    for (const mesh of [smoke, flame]) {
      if (!mesh) continue;
      for (let i = 0; i < n; i++) mesh.setMatrixAt(i, zero);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** @returns {void} */
  function disposeMissiles() {
    for (const m of pool) Sim.three.scene.remove(m.group);
    for (const mesh of [smoke, flame]) if (mesh) {
      Sim.three.scene.remove(mesh);
      mesh.dispose();
    }
    for (const g of geometries) g.dispose();
    for (const mat of materials) mat.dispose();
    pool = [];
    smoke = flame = null;
    geometries = [];
    materials = [];
  }

  return { MISSILE, initMissiles, launchMissile, showMissile, updateMissiles, missilesOut, resetMissiles, disposeMissiles };
}
