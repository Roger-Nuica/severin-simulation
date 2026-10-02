// @ts-check
import * as THREE from 'three';
import { BLAST_SIZE } from '../player/energy.js';

/**
 * ===========================================================================
 * SECTION CB — A car going up
 * ===========================================================================
 * One car exploding where it is, with the fuel-station chain's look
 * (fuelFire/chain.js explode) but without setting off its neighbours: a
 * fireball, a hard shake, the car thrown up and burnt out, anyone standing
 * right beside it killed, and the 'explosion' event (marked `own`: Roger
 * caused it, so it does not refill his energy, engine/player/energy.js).
 * Shared by the gravity rift (gravityRift.js) and telekinesis
 * (player/telekinesis.js). Never Roger: engine/effects/area.js leaves him
 * out.
 *
 * A pure function of ctx: no state of its own.
 */

const CAR_BLAST = {
  killRadius: 3.5,
  score: 60
};

const at = new THREE.Vector3();

/**
 * @param {Object} ctx
 * @param {any} car a Sim.objects car
 * @param {number} strength explosions/index.js spawnImpactBurst's
 * @returns {void}
 */
export function blowUpCar(ctx, car, strength) {
  if (!car.mesh || !car.mesh.parent) return;
  const { Sim } = ctx;
  const p = car.mesh.position;
  at.set(p.x, p.y + 1.2, p.z);
  ctx.systems.explosions.spawnImpactBurst(at, strength);
  ctx.systems.gamefeel.event('gas', at);
  car.rooted = false;
  car.mesh.userData.parked = false;
  car.velocity.set((Math.random() - 0.5) * 6, 7 + Math.random() * 5, (Math.random() - 0.5) * 6);
  car.angularVelocity.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6);
  if (car.damageState === 'intact') {
    car.damageState = 'tipped';
    Sim.stats.vehiclesOverturned++;
  }
  car.mesh.traverse((/** @type {any} */ o) => {
    if (o.userData && o.userData.carPart === 'body' && o.material && o.material.color) {
      o.material.color.multiplyScalar(0.12);
    }
  });
  /** @type {any[]} */
  const caught = [];
  ctx.systems.area.forEachInRadius({ x: p.x, z: p.z, radius: CAR_BLAST.killRadius, targets: ['person'] },
    (/** @type {any} */ hit) => caught.push(hit.target));
  // After the visit: a death splices the people list.
  for (const person of caught) if (person.mesh.parent) ctx.systems.people.explodePerson(person);
  ctx.systems.damage.addDamageScore(CAR_BLAST.score);
  // `own`: Roger set it off (the Gravitron, telekinesis), so it gives him no
  // energy (player/energy.js absorb); co-op still shows it (net/system.js).
  ctx.events.emit('explosion', { x: p.x, z: p.z, size: BLAST_SIZE.car, source: car, own: true });
}
