// @ts-check
import * as THREE from 'three';
import { createWeaponFx } from '../hero/weaponFx.js';
import { warpEnds } from '../net/figureFx.js';

/**
 * ===========================================================================
 * SECTION PT — Teleport (E)
 * ===========================================================================
 * The hero's short jump: TELEPORT.distance metres the way he looks (his
 * heading on foot, his aim with the weapon up), in an instant, for one
 * energy segment (engine/player/abilities.js), with TELEPORT.cooldown
 * seconds before the next.
 *
 * Never into a building or over the earthquake's chasm, and never off the
 * map: the landing spot is searched from the full distance back towards
 * him, a metre at a time, for the first place he could stand
 * (heroMode.standable). With nowhere to land it is refused, with a message,
 * and nothing is spent (the ability's canStart).
 *
 * The distortion at both ends: where he was, a shimmering column that
 * collapses inward and a ring drawn in; where he lands, a column that
 * bursts outward and a ring thrown out. Each is a pair of additive meshes,
 * made once and reused (no lights, nothing allocated per jump).
 */

export const TELEPORT = {
  keys: ['KeyE'],        // E since 2026-10-01 (W walks now)
  cost: 1,              // segments (10%)
  cooldown: 1.5,        // seconds
  distance: 18,         // metres
  minDistance: 4,       // shorter than this is not worth the energy
  step: 1,              // metres between two landing spots tried
  effectSeconds: 0.45,
  colour: new THREE.Color(0.6, 1.6, 3)
};

/**
 * @param {Object} ctx
 * @returns {{
 *   jump: () => boolean,
 *   warpAt: (x: number, z: number, inward: boolean) => void,
 *   landingSpot: () => ({x: number, z: number}|null),
 *   initTeleport: () => void,
 *   updateTeleport: (rawDt: number) => void,
 *   resetTeleport: () => void,
 *   disposeTeleport: () => void
 * }}
 */
export function createTeleportSystem(ctx) {
  const { Sim } = ctx;
  // Co-op: the host's jump announced to the guest as a `warp` row (nothing is built outside a room with a guest).
  const weaponFx = createWeaponFx(ctx);
  const fxFrom = { x: 0, y: 0, z: 0 };
  const fxTo = { x: 0, y: 0, z: 0 };
  /**
   * @typedef {Object} Warp
   * @property {THREE.Mesh} column
   * @property {THREE.Mesh} ring
   * @property {number} t 0..1 through the effect; 1 is idle
   * @property {boolean} inward collapsing (departure) rather than bursting
   */
  /** @type {Warp[]} */
  const warps = [];
  /** @type {THREE.BufferGeometry[]} */
  const geometries = [];

  /**
   * @param {string} text
   * @returns {void}
   */
  function say(text) {
    ctx.events.emit('notice', { text });
  }

  /**
   * The first place he could stand along his line of sight, from the full
   * distance back.
   * @returns {{x: number, z: number}|null}
   */
  function landingSpot() {
    const hero = ctx.systems.heroMode;
    const from = hero && hero.rogerFacing();
    if (!from) return null;
    const sx = Math.sin(from.heading);
    const sz = Math.cos(from.heading);
    for (let d = TELEPORT.distance; d >= TELEPORT.minDistance; d -= TELEPORT.step) {
      const x = from.x + sx * d;
      const z = from.z + sz * d;
      if (hero.standable(x, z)) return { x, z };
    }
    return null;
  }

  /**
   * One end's distortion.
   * @param {number} x
   * @param {number} z
   * @param {boolean} inward
   * @returns {void}
   */
  function warpAt(x, z, inward) {
    const w = warps.find(v => v.t >= 1) || warps[0];
    if (!w) return;
    w.t = 0;
    w.inward = inward;
    w.column.position.set(x, 1.4, z);
    w.ring.position.set(x, 0.06, z);
    w.column.visible = w.ring.visible = true;
  }

  /**
   * The jump itself (after the energy is spent).
   * @returns {boolean} whether he went
   */
  function jump() {
    const hero = ctx.systems.heroMode;
    const from = hero && hero.rogerTarget();
    const to = landingSpot();
    if (!from || !to) return false;
    const leftX = from.x;
    const leftZ = from.z;
    warpAt(from.x, from.z, true);
    if (!hero.placeRoger(to.x, to.z)) return false;
    const landed = hero.rogerTarget();
    warpAt(landed ? landed.x : to.x, landed ? landed.z : to.z, false);
    if (ctx.systems.powerArcSound) ctx.systems.powerArcSound.playZap(1);
    ctx.systems.gamefeel.event('impact', new THREE.Vector3(to.x, 1, to.z));
    // Last: what the guest's screen is told of this jump (a no-op unless a guest is in the room).
    const net = ctx.systems.net;
    if (net && net.fxLive()) {
      warpEnds(fxFrom, fxTo, leftX, leftZ, landed ? landed.x : to.x, landed ? landed.z : to.z);
      weaponFx.announce('warp', fxFrom, fxTo, '', 0);
    }
    return true;
  }

  /** @returns {void} */
  function initTeleport() {
    const columnGeo = new THREE.CylinderGeometry(1, 1, 2.8, 20, 1, true);
    const ringGeo = new THREE.RingGeometry(0.85, 1, 40, 1);
    ringGeo.rotateX(-Math.PI / 2);
    geometries.push(columnGeo, ringGeo);
    for (let i = 0; i < 4; i++) {
      const material = () => new THREE.MeshBasicMaterial({
        color: TELEPORT.colour, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide
      });
      const column = new THREE.Mesh(columnGeo, material());
      const ring = new THREE.Mesh(ringGeo, material());
      column.name = 'teleport_column';
      ring.name = 'teleport_ring';
      column.visible = ring.visible = false;
      column.frustumCulled = ring.frustumCulled = false;
      Sim.three.scene.add(column, ring);
      warps.push({ column, ring, t: 1, inward: false });
    }
    ctx.systems.abilities.register({
      id: 'teleport', name: 'TELEPORT', keys: TELEPORT.keys, cost: TELEPORT.cost, seconds: 0, cooldown: TELEPORT.cooldown,
      canStart: () => {
        if (landingSpot()) return true;
        say('TELEPORT · no room to land that way');
        return false;
      },
      start: () => { jump(); }
    });
  }

  /**
   * The distortions play out on real time (a Time Slow does not stretch
   * them).
   * @param {number} rawDt
   * @returns {void}
   */
  function updateTeleport(rawDt) {
    for (const w of warps) {
      if (w.t >= 1) continue;
      w.t = Math.min(1, w.t + rawDt / TELEPORT.effectSeconds);
      const fade = 1 - w.t;
      const colMat = /** @type {THREE.MeshBasicMaterial} */ (w.column.material);
      const ringMat = /** @type {THREE.MeshBasicMaterial} */ (w.ring.material);
      if (w.inward) {
        // Pulled in and up: the column narrows to a thread, the ring closes.
        w.column.scale.set(1.3 * fade + 0.05, 1 + w.t * 1.5, 1.3 * fade + 0.05);
        w.ring.scale.setScalar(4 * fade + 0.1);
      } else {
        // Thrown out: the column swells, the ring races outward.
        w.column.scale.set(0.2 + w.t * 1.8, 1.6 - w.t * 0.6, 0.2 + w.t * 1.8);
        w.ring.scale.setScalar(0.5 + w.t * 7);
      }
      colMat.opacity = 0.8 * fade;
      ringMat.opacity = 0.9 * fade;
      if (w.t >= 1) w.column.visible = w.ring.visible = false;
    }
  }

  /** @returns {void} */
  function resetTeleport() {
    for (const w of warps) {
      w.t = 1;
      w.column.visible = w.ring.visible = false;
    }
  }

  /** @returns {void} */
  function disposeTeleport() {
    for (const w of warps) {
      Sim.three.scene.remove(w.column, w.ring);
      /** @type {THREE.Material} */ (w.column.material).dispose();
      /** @type {THREE.Material} */ (w.ring.material).dispose();
    }
    warps.length = 0;
    for (const g of geometries) g.dispose();
    geometries.length = 0;
  }

  return { jump, warpAt, landingSpot, initTeleport, updateTeleport, resetTeleport, disposeTeleport };
}
