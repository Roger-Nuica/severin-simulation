// @ts-check
import * as THREE from 'three';
import { setOffExplosivesAt } from '../explosives.js';
import { METEOR } from './config.js';
/** @typedef {import('./config.js').Meteor} Meteor */

/**
 * ===========================================================================
 * SECTION MT.2 — Impacts
 * ===========================================================================
 * A rock landing (blast, thrown debris, fires, the flood), one bursting in
 * the air, and the craters left.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see meteors.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createMeteorImpact(ctx, S, api) {
  const { Sim } = ctx;

  /**
   * Everything the strike does. Reuses the same routes the rest of the
   * simulation already uses for destruction, so nothing downstream needs to
   * know a meteor exists.
   * @param {Meteor} meteor
   * @returns {void}
   */
  function impact(meteor) {
    const at = meteor.to.clone();
    at.y = 1.5;

    // Fireball, plus offset secondaries so the blast reads wider than one
    // sphere.
    ctx.systems.explosions.spawnImpactBurst(at, METEOR.blastStrength);
    ctx.systems.cues.playLargeExplosion();
    for (let i = 0; i < METEOR.satellites; i++) {
      ctx.systems.explosions.spawnImpactBurst(new THREE.Vector3(
        at.x + (Math.random() - 0.5) * 48, at.y + Math.random() * 22, at.z + (Math.random() - 0.5) * 48
      ), METEOR.blastStrength * (0.4 + Math.random() * 0.3));
    }
    // The white-out. A rock this size landing inside the town should black
    // the frame for an instant, not just light it.
    ctx.systems.lightning.flashScreen(at, 0.95);

    // The pieces that broke off land around it, each with its own smaller
    // burst, so the strike arrives as a cluster rather than a single point.
    for (const frag of meteor.fragments) {
      ctx.systems.explosions.spawnImpactBurst(new THREE.Vector3(
        at.x + frag.driftX, 1.5, at.z + frag.driftZ
      ), METEOR.blastStrength * 0.3);
      ctx.systems.buildingFire.igniteNear(at.x + frag.driftX, at.z + frag.driftZ, 12);
    }

    // Ejecta thrown out of the crater.
    for (let i = 0; i < METEOR.ejectaCount; i++) {
      const p = S.trail;
      const idx = p.next;
      p.next = (p.next + 1) % METEOR.maxParticles;
      const a = Math.random() * Math.PI * 2;
      const speed = api.between(METEOR.ejectaSpeed);
      p.positions[idx * 3] = at.x;
      p.positions[idx * 3 + 1] = 1;
      p.positions[idx * 3 + 2] = at.z;
      p.velocities[idx * 3] = Math.cos(a) * speed * 0.6;
      p.velocities[idx * 3 + 1] = speed;
      p.velocities[idx * 3 + 2] = Math.sin(a) * speed * 0.6;
      p.life[idx] = p.maxLife[idx] = api.between(METEOR.ejectaLife);
      p.seed[idx] = 1;
    }

    // Kills the people close to where it lands, through the same route a
    // piece of debris takes (damage.js damageFromImpact) -- storm or no
    // storm. Before, the blast only threw them, and a barrage set off before
    // the Tornado button left the town shaken but everyone alive.
    const { damageFromImpact } = ctx.systems.damage;
    for (const person of ctx.Environment.people.slice()) {
      const q = person.mesh.position;
      if (Math.hypot(q.x - at.x, q.z - at.z) < METEOR.killRadius) damageFromImpact(person, q, METEOR.killEnergy);
    }
    // Roger too, in Hero Mode, on foot or in a car.
    if (ctx.systems.heroMode) {
      ctx.systems.heroMode.hitArea(at.x, at.z, METEOR.killRadius, 'HIT BY A METEOR', 'A meteor came down on Roger');
    }

    // Throws everything loose, away from the point of impact.
    for (const obj of Sim.objects) {
      if (obj.type === 'building' || obj.rooted) continue;
      const pos = obj.pooled ? obj.position : (obj.mesh && obj.mesh.position);
      if (!pos) continue;
      const d = Math.hypot(pos.x - at.x, pos.z - at.z);
      if (d > METEOR.blastRadius) continue;
      const falloff = 1 - d / METEOR.blastRadius;
      const dir = new THREE.Vector3(pos.x - at.x, 0, pos.z - at.z);
      if (dir.lengthSq() < 1e-6) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      dir.normalize().multiplyScalar(METEOR.throwForce * falloff);
      obj.velocity.add(dir);
      obj.velocity.y += METEOR.throwForce * falloff * 0.7;
      obj.angularVelocity.set(
        (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10
      );
    }

    // Flattens what it lands on, through the chain-collapse shock -- so a
    // building brought down by a meteor goes on to shock its own neighbours
    // exactly as any other collapse does.
    const { shockBuilding, addDamageScore } = ctx.systems.damage;
    if (shockBuilding && ctx.Environment) {
      for (const building of ctx.Environment.buildings) {
        const p = building.mesh.position;
        const d = Math.hypot(p.x - at.x, p.z - at.z);
        if (d > METEOR.blastRadius) continue;
        shockBuilding(building, METEOR.buildingShock * (1 - d / METEOR.blastRadius), at);
      }
    }
    ctx.systems.buildingFire.igniteNear(at.x, at.z, METEOR.fireRadius);
    ctx.systems.powerLines.faultAt(at.x, at.z, METEOR.fireRadius);
    ctx.systems.viaduct.fissureUnder(at.x, at.z, METEOR.blastRadius * 0.4);
    // A crater through a street takes the main under it with it, and there is
    // a fireball sitting on top of the break (engine/gasMains.js) -- and a
    // tanker or the chemical works it lands by go up (engine/explosives.js).
    setOffExplosivesAt(ctx, at.x, at.z, METEOR.blastRadius * 0.35);

    addCrater(at.x, at.z);
    if (ctx.systems.backdrop) ctx.systems.backdrop.damageAt(at.x, at.z, METEOR.blastRadius * 0.6);

    ctx.systems.gamefeel.event('meteor', at);
    addDamageScore(METEOR.score);
    meteor.mesh.visible = false;
    meteor.state = 'done';
  }

  /**
   * The rock that never lands. It comes apart two hundred metres up, and what
   * reaches the town is only the pressure front.
   *
   * Deliberately nothing like impact(): no crater, no ejecta, nothing thrown
   * upward, and the blast radius is more than twice as wide because none of
   * the energy went into the ground. What it leaves behind is a pattern
   * rather than a hole -- trees flat for a hundred and sixty units in every
   * direction, each pointing away from a patch of ground where nothing
   * happened at all.
   * @param {Meteor} meteor
   * @returns {void}
   */
  function detonateAirburst(meteor) {
    const at = meteor.mesh.position.clone();

    // The fireball, aloft. Spread wide and high rather than clustered at a
    // point: this is a rock coming apart across the sky, not a bomb.
    ctx.systems.explosions.spawnImpactBurst(at, METEOR.blastStrength);
    for (let i = 0; i < METEOR.burstSatellites; i++) {
      ctx.systems.explosions.spawnImpactBurst(new THREE.Vector3(
        at.x + (Math.random() - 0.5) * 120,
        at.y + (Math.random() - 0.5) * 70,
        at.z + (Math.random() - 0.5) * 120
      ), METEOR.blastStrength * (0.3 + Math.random() * 0.4));
    }
    ctx.systems.lightning.flashScreen(at, METEOR.burstFlash);
    ctx.systems.gamefeel.event('meteor', at);
    ctx.systems.damage.addDamageScore(METEOR.burstScore);
    api.showBanner('AIRBURST!', 'Nothing reached the ground');

    // The front starts under it and runs outward. Everything it does is done
    // as it passes, so the town goes over in a visible ring rather than all
    // at once -- the same construction the chemical works' pressure wave uses
    // (environment/factory.js).
    S.bursts.push({ x: at.x, y: at.y, z: at.z, radius: 0, hit: new WeakSet() });
  }

  /**
   * The pressure front crossing the ground.
   * @param {number} dt
   * @returns {void}
   */
  function updateBursts(dt) {
    const damage = ctx.systems.damage;
    for (let i = S.bursts.length - 1; i >= 0; i--) {
      const burst = S.bursts[i];
      const previous = burst.radius;
      burst.radius = Math.min(METEOR.burstRadius, burst.radius + METEOR.burstSpeed * dt);
      const fade = 1 - burst.radius / METEOR.burstRadius;

      // Trees. The signature of the whole effect: flat, and every one of them
      // pointing away from a spot with no crater in it.
      if (ctx.Environment && damage.flattenTree) {
        const treeReach = METEOR.burstRadius * METEOR.burstTreeRadius;
        for (const tree of ctx.Environment.trees) {
          if (burst.hit.has(tree) || tree.damageState !== 'intact') continue;
          const p = tree.mesh.position;
          const dx = p.x - burst.x;
          const dz = p.z - burst.z;
          const d = Math.hypot(dx, dz);
          if (d > burst.radius || d <= previous) continue;
          burst.hit.add(tree);
          if (d > treeReach) continue;
          damage.flattenTree(tree, dx / (d || 1), dz / (d || 1));
        }
      }

      // Buildings: frames shaken, hard under it and barely at the edge.
      // Nothing is crushed -- there is no impact to crush with.
      if (ctx.Environment && damage.shockBuilding) {
        for (const building of ctx.Environment.buildings) {
          if (burst.hit.has(building) || building.damageState === 'collapsed') continue;
          const p = building.mesh.position;
          const d = Math.hypot(p.x - burst.x, p.z - burst.z);
          if (d > burst.radius || d <= previous) continue;
          burst.hit.add(building);
          damage.shockBuilding(
            building, METEOR.burstBuildingShock * fade,
            new THREE.Vector3(burst.x, 0, burst.z)
          );
        }
      }

      // Everything loose, shoved outward along the front.
      for (const obj of Sim.objects) {
        if (obj.type === 'building' || obj.rooted) continue;
        if (burst.hit.has(obj)) continue;
        const pos = obj.pooled ? obj.position : (obj.mesh && obj.mesh.position);
        if (!pos) continue;
        const dx = pos.x - burst.x;
        const dz = pos.z - burst.z;
        const d = Math.hypot(dx, dz);
        if (d > burst.radius || d <= previous) continue;
        burst.hit.add(obj);
        const push = METEOR.burstThrow * fade;
        obj.velocity.x += (dx / (d || 1)) * push;
        obj.velocity.z += (dz / (d || 1)) * push;
        obj.velocity.y += push * 0.35;
        obj.angularVelocity.set(
          (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9
        );
        if (obj.type === 'person' && obj.motion && obj.motion.active) {
          obj.motion.active = false;
          obj.motion.dropped = true;
        }
      }

      // Dust kicked up all the way round the front, which is the only thing
      // that makes an invisible pressure wave visible.
      const puffs = 10;
      for (let k = 0; k < puffs; k++) {
        const angle = (k / puffs) * Math.PI * 2 + burst.radius * 0.02;
        ctx.systems.earthquake.kickDust(
          burst.x + Math.cos(angle) * burst.radius,
          burst.z + Math.sin(angle) * burst.radius,
          1, 1.5 + fade
        );
      }
      ctx.systems.powerLines.faultAt(burst.x, burst.z, burst.radius);

      if (burst.radius >= METEOR.burstRadius) S.bursts.splice(i, 1);
    }
  }

  /**
   * The scar a strike leaves, for the rest of the run. Held to a ceiling and
   * recycled oldest-first: volleys are unlimited, so this is otherwise the one
   * thing in the barrage that grows without bound.
   * @param {number} x
   * @param {number} z
   * @returns {void}
   */
  function addCrater(x, z) {
    const craterRadius = api.between(METEOR.craterRadius);
    if (S.craters.length >= METEOR.craterMax) {
      const oldest = S.craters.shift();
      S.group.remove(oldest);
      oldest.geometry.dispose();
      oldest.material.dispose();
    }
    const mat = new THREE.MeshBasicMaterial({
      map: S.craterTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.95
    });
    const crater = new THREE.Mesh(new THREE.PlaneGeometry(craterRadius * 2, craterRadius * 2), mat);
    crater.rotation.x = -Math.PI / 2;
    crater.rotation.z = Math.random() * Math.PI * 2;
    crater.position.set(x, METEOR.craterY, z);
    crater.name = 'meteor_crater';
    S.group.add(crater);
    S.craters.push(crater);
  }

  return { impact, detonateAirburst, updateBursts, addCrater };
}
