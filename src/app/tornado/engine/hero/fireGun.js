// @ts-check
import * as THREE from 'three';
import { createTrexFlames } from '../trex/flames.js';
import { ALIENS } from '../aliens/config.js';
import { tableDamage, shipKindOf } from '../health/enemyDamage.js';

/**
 * ===========================================================================
 * SECTION AM.3 — The Fire Gun
 * ===========================================================================
 * Roger's flamethrower (on the wheel, heroWeapons.js): the cyber T-Rex's own
 * fire in his hands -- the same flame particles (trex/flames.js, its own
 * pool), the same roar (sound/creatures.js's flame loop, here as
 * 'fireGun'), and the same burning: while the trigger is held it breathes a
 * continuous cone of flame, and every FIRE_GUN.tick seconds what is in the
 * cone burns --
 *  - buildings catch fire (buildingFire.js), as from the T-Rex;
 *  - townspeople go up (a killing: Smooth Criminal's spell breaks);
 *  - every enemy that answers to fire (engine/enemies.js 'fire') is hit:
 *    the aliens burn, and the Cyber Yeti -- which nothing else Roger
 *    carries can hurt -- takes YETI.damage.fire a tick until it falls;
 *  - Landing Support's samurai go down (only Roger's weapons can do that).
 * No energy, no ammunition.
 */

export const FIRE_GUN = {
  range: 42,                // metres the cone reaches
  halfAngle: 0.26,          // radians either side
  rate: 170,                // flame particles a second
  tick: 0.25,               // seconds between two burns
  ahead: 3.5,               // the flame starts this far in front of the muzzle
  flameSize: 0.42,          // of the T-Rex's flame particles
  flameAlpha: 0.55
};

/**
 * @param {Object} ctx
 * @param {{keepGeo: (g: THREE.BufferGeometry) => THREE.BufferGeometry, keepMat: (m: THREE.Material) => THREE.Material,
 *   flashMessage: (text: string) => void, rogerPosition: () => THREE.Vector3}} hero
 * @returns {{
 *   build: (addHandsAndMuzzle: (group: THREE.Group, z: number, colour: THREE.Color) => {muzzle: THREE.Object3D, flash: THREE.Mesh}) => {group: THREE.Group, muzzle: THREE.Object3D, flash: THREE.Mesh, pilot: THREE.Mesh},
 *   update: (dt: number, firing: boolean, muzzle: THREE.Vector3|null, aimDir: THREE.Vector3) => void,
 *   clear: () => void,
 *   dispose: () => void
 * }}
 */
export function createFireGun(ctx, hero) {
  const { Sim } = ctx;
  // The T-Rex's fire, at a man's scale: at its own size, a metre in front
  // of the camera, it filled the whole screen with white-orange.
  const flames = createTrexFlames(ctx, { size: FIRE_GUN.flameSize, alpha: FIRE_GUN.flameAlpha, name: 'fire_gun_flames' });
  flames.init();
  let tickClock = 0;
  const from = new THREE.Vector3();

  /**
   * The close-up model: a fuel tank under a stubby barrel, a wide nozzle
   * with a blue pilot flame at its lip.
   * @param {(group: THREE.Group, z: number, colour: THREE.Color) => {muzzle: THREE.Object3D, flash: THREE.Mesh}} addHandsAndMuzzle
   * @returns {{group: THREE.Group, muzzle: THREE.Object3D, flash: THREE.Mesh, pilot: THREE.Mesh}}
   */
  function build(addHandsAndMuzzle) {
    const group = new THREE.Group();
    group.name = 'hero_view_firegun';
    const steel = hero.keepMat(new THREE.MeshStandardMaterial({ color: 0x5c5f66, metalness: 0.85, roughness: 0.35, emissive: 0x101114 }));
    const red = hero.keepMat(new THREE.MeshStandardMaterial({ color: 0xa3261b, metalness: 0.4, roughness: 0.5 }));
    const blue = hero.keepMat(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.2, 3), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    /**
     * @param {THREE.BufferGeometry} geo
     * @param {THREE.Material} mat
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {THREE.Mesh}
     */
    const add = (geo, mat, x, y, z) => {
      const mesh = new THREE.Mesh(hero.keepGeo(geo), mat);
      mesh.position.set(x, y, z);
      mesh.frustumCulled = false;
      group.add(mesh);
      return mesh;
    };
    add(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 14).rotateX(Math.PI / 2), red, 0, -0.12, -0.3);      // the tank
    add(new THREE.BoxGeometry(0.12, 0.12, 0.5), steel, 0, 0.04, -0.3);                                  // body
    add(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 10).rotateX(Math.PI / 2), steel, 0, 0.04, -0.82); // barrel
    add(new THREE.CylinderGeometry(0.07, 0.045, 0.14, 12).rotateX(Math.PI / 2), steel, 0, 0.04, -1.16); // nozzle
    const pilot = add(new THREE.SphereGeometry(0.03, 8, 6), blue, 0, 0.04, -1.25);
    const { muzzle, flash } = addHandsAndMuzzle(group, -1.25, new THREE.Color(3, 1.6, 0.5));
    muzzle.position.y = 0.04;
    group.traverse((child) => { child.castShadow = false; child.receiveShadow = false; });
    group.visible = false;
    Sim.three.scene.add(group);
    return { group, muzzle, flash, pilot };
  }

  /**
   * Is (x, z) in the cone from (ox, oz) along dir, as far as range?
   * @param {number} ox
   * @param {number} oz
   * @param {THREE.Vector3} dir
   * @param {number} x
   * @param {number} z
   * @param {number} [radius] how wide the target is: a giant is caught by its edge
   * @returns {boolean}
   */
  function inCone(ox, oz, dir, x, z, radius = 2) {
    const dx = x - ox;
    const dz = z - oz;
    const d = Math.hypot(dx, dz);
    if (d > FIRE_GUN.range + radius) return false;
    if (d < 3 + radius) return true;
    const off = Math.atan2(dx, dz) - Math.atan2(dir.x, dir.z);
    return Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) < FIRE_GUN.halfAngle + radius / d;
  }

  /**
   * Is a point in the air inside the cone, by the real (3D) angle? The flat
   * test cannot tell a hunter ship hovering ~26 m up from the ground under
   * it, so a flame pointed at the street would burn it. No allocation.
   * @param {THREE.Vector3} origin
   * @param {THREE.Vector3} dir unit aim direction
   * @param {THREE.Vector3} q the target's position
   * @param {number} radius
   * @returns {boolean}
   */
  function inCone3D(origin, dir, q, radius) {
    const dx = q.x - origin.x;
    const dy = q.y - origin.y;
    const dz = q.z - origin.z;
    const len = Math.hypot(dx, dy, dz);
    if (len > FIRE_GUN.range + radius) return false;
    if (len < 3 + radius) return true;
    const cos = (dx * dir.x + dy * dir.y + dz * dir.z) / len;
    return Math.acos(Math.min(1, Math.max(-1, cos))) < FIRE_GUN.halfAngle + radius / len;
  }

  /**
   * What the flame has reached, burning.
   * @param {THREE.Vector3} dir
   * @returns {void}
   */
  function scorch(dir, origin) {
    const r = origin || hero.rogerPosition();
    const fire = ctx.systems.buildingFire;
    for (const b of ctx.Environment.buildings) {
      if (b.damageState === 'collapsed' || fire.isBurning(b)) continue;
      const q = b.mesh.position;
      if (inCone(r.x, r.z, dir, q.x, q.z)) fire.igniteBuilding(b, 0.6);
    }
    /** @type {SimObject[]} */
    const people = [];
    ctx.systems.area.forEachInRadius({ x: r.x, z: r.z, radius: FIRE_GUN.range, targets: ['person'] }, (hit) => {
      if (inCone(r.x, r.z, dir, hit.x, hit.z)) people.push(hit.target);
    });
    for (const person of people) ctx.systems.people.explodePerson(person);
    let killed = people.length > 0;
    // Every enemy in the cone (D1: every weapon hurts every enemy; the register
    // applies the table's damage per tick, the old weaknesses unchanged).
    /** @type {{e: any, kind: any, at: {x: number, z: number}}[]} */
    const found = [];
    ctx.systems.enemies.each((e, kind) => {
      const q = kind.position(e);
      const hunter = kind.kind === 'hunterShip';
      // A hunter has no hitbox: its radius is its disc (as shipTargets and boltAt).
      const radius = hunter ? 15 * ALIENS.hunterScale : kind.hitbox ? kind.hitbox(e).radius : 1;
      // A hunter ship hovers high above the ground: it needs the 3D test.
      const inside = hunter ? inCone3D(r, dir, q, radius) : inCone(r.x, r.z, dir, q.x, q.z, radius);
      if (inside) found.push({ e, kind, at: q });
    });
    for (const f of found) {
      if (ctx.systems.enemies.hit(f.e, f.kind, { type: 'fire', at: f.at })) killed = true;
    }
    // Landing Support's samurai: only Roger can burn one.
    const support = ctx.systems.spaceship;
    if (support) {
      for (const box of support.samuraiTargets()) {
        if (inCone(r.x, r.z, dir, box.x, box.z, 0.5) && support.hitSamurai(box.unit, 'fire')) killed = true;
      }
    }
    // The alien ship (the UFO is not in the register): a chip of its hull per
    // tick (D1), seen as a disc in 3D like a hunter.
    if (ctx.systems.aliens) {
      for (const ship of ctx.systems.aliens.shipTargets()) {
        if (ship.name === 'UFO' && inCone3D(r, dir, ship, ship.radius) && ship.hit(tableDamage('ufo', { type: 'fire' })) === 0) killed = true;
      }
    }
    // The mothership (D3): the same chip, seen as its disc in 3D.
    const mother = ctx.systems.mothership && ctx.systems.mothership.shipTarget();
    if (mother && shipKindOf(mother.name) && inCone3D(r, dir, mother, mother.radius) && mother.hit(tableDamage('mothership', { type: 'fire' })) === 0) killed = true;
    // The reactors in the cone chip their containment (D3); a funnel in it
    // loses health, and at 0 is neutralised (Hero Mode only).
    if (ctx.systems.nuclear) {
      let last = null;
      for (const part of ctx.systems.nuclear.aimTargets()) {
        // One chip per plant per tick, however many of its buildings are in the cone.
        if (part.plant !== last && inCone(r.x, r.z, dir, part.x, part.z, part.radius)) {
          last = part.plant;
          ctx.systems.nuclear.chipPlant(part.plant, { type: 'fire' });
        }
      }
    }
    if (ctx.systems.heroMode) {
      for (const { Vortex } of ctx.tornadoes.active) {
        if (Vortex.neutralized || Vortex.birth < 0.5) continue;
        if (inCone(r.x, r.z, dir, Vortex.center.x, Vortex.center.z, Sim.params.radius * (Vortex.sizeMul || 1) * 0.9)) {
          ctx.systems.heroMode.chipTornado(Vortex, { type: 'fire' });
        }
      }
    }
    if (killed) ctx.events.emit('rogerKill');
  }

  /**
   * @param {number} dt real seconds (the gun is Roger's: it does not slow)
   * @param {boolean} firing the trigger held, the gun raised
   * @param {THREE.Vector3|null} muzzle the close-up model's muzzle in the world
   * @param {THREE.Vector3} aimDir
   * @returns {void}
   */
  function update(dt, firing, muzzle, aimDir) {
    flames.update(dt);
    if (!firing || !muzzle) {
      tickClock = 0;
      return;
    }
    from.copy(muzzle).addScaledVector(aimDir, FIRE_GUN.ahead);
    flames.emit(from, aimDir, Math.round(FIRE_GUN.rate * dt + Math.random()));
    ctx.systems.creatureSounds.loop('fireGun', from, 0.9);
    // A tick every FIRE_GUN.tick of real time, however slow the frames.
    tickClock -= dt;
    for (let n = 0; tickClock <= 0 && n < 4; n++) {
      tickClock += FIRE_GUN.tick;
      scorch(aimDir);
    }
    if (tickClock <= 0) tickClock = FIRE_GUN.tick;
  }

  /**
   * A co-op guest's flame (engine/net/system.js): the same particles, sound
   * and burning as Roger's, from their own position. Their own tick clock,
   * so two guns do not share one.
   * @param {{tick: number}} gun the guest's clock holder
   * @param {number} dt
   * @param {THREE.Vector3} muzzle
   * @param {THREE.Vector3} aimDir
   * @returns {void}
   */
  function breathe(gun, dt, muzzle, aimDir) {
    from.copy(muzzle).addScaledVector(aimDir, FIRE_GUN.ahead);
    flames.emit(from, aimDir, Math.round(FIRE_GUN.rate * dt + Math.random()));
    ctx.systems.creatureSounds.loop('fireGun', from, 0.9);
    gun.tick -= dt;
    for (let n = 0; gun.tick <= 0 && n < 4; n++) {
      gun.tick += FIRE_GUN.tick;
      scorch(aimDir, muzzle);
    }
    if (gun.tick <= 0) gun.tick = FIRE_GUN.tick;
  }

  /** @returns {void} */
  function clear() {
    flames.clear();
    tickClock = 0;
  }

  /** @returns {void} */
  function dispose() {
    flames.release();
  }

  return { build, update, breathe, clear, dispose };
}
