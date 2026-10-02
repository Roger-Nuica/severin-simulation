// @ts-check
import * as THREE from 'three';
import { hitRogerAt, setOffExplosivesAt } from '../../explosives.js';
import { FACTORY } from './config.js';
import { BLAST_SIZE } from '../../player/energy.js';
/** @typedef {import('./config.js').Barrel} Barrel */

/**
 * ===========================================================================
 * SECTION FA.2 — The chain of explosions
 * ===========================================================================
 * Catching fire, the barrels popping one after another, the tank, and the
 * blast that takes the works and what is round it.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see factory.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createFactoryBlast(ctx, S, api) {
  const { Sim } = ctx;

  /**
   * Starts the chain. Called by the fuse, or early by a tornado crossing the
   * yard.
   * @returns {void}
   */
  function ignite() {
    if (S.state.phase !== 'idle') return;
    S.state.phase = 'chain';
    S.state.timer = 0;
    S.state.nextPop = 0;
    api.showBanner('CHEMICAL WORKS!', `${FACTORY.barrels} barrels cooking off`);
  }

  /**
   * Pops one barrel: a small burst, and the barrel itself thrown.
   * @param {Barrel} barrel
   * @returns {void}
   */
  function popBarrel(barrel) {
    barrel.state = 'flying';
    const angle = Math.random() * Math.PI * 2;
    const speed = api.between(FACTORY.popSpeed);
    barrel.vel.set(Math.cos(angle) * speed * 0.55, speed, Math.sin(angle) * speed * 0.55);
    barrel.spin.set(
      (Math.random() - 0.5) * FACTORY.popSpin,
      (Math.random() - 0.5) * FACTORY.popSpin,
      (Math.random() - 0.5) * FACTORY.popSpin
    );
    ctx.systems.explosions.spawnImpactBurst(barrel.pos.clone(), FACTORY.popStrength);
    ctx.events.emit('explosion', { x: barrel.pos.x, z: barrel.pos.z, size: BLAST_SIZE.barrel, source: barrel });
    S.state.lit++;
  }

  /**
   * The next barrel to catch: the one nearest any already-lit barrel, so the
   * fire creeps across the yard instead of jumping about at random.
   * @returns {Barrel|null}
   */
  function nextBarrel() {
    /** @type {Barrel|null} */
    let best = null;
    let bestD = Infinity;
    const lit = S.barrels.filter(b => b.state !== 'stacked');
    for (const b of S.barrels) {
      if (b.state !== 'stacked') continue;
      if (!lit.length) return b;
      for (const source of lit) {
        const d = b.pos.distanceToSquared(source.pos);
        if (d < bestD) { bestD = d; best = b; }
      }
    }
    // Nothing within reach of the fire: jump to whatever is left, so the
    // chain cannot stall on a barrel that rolled clear.
    if (best && bestD > FACTORY.chainReach * FACTORY.chainReach) {
      return S.barrels.find(b => b.state === 'stacked') || null;
    }
    return best;
  }

  /**
   * One storage tank going, ahead of the works itself.
   * @param {number} index 0 or 1
   * @returns {void}
   */
  function blowTank(index) {
    const at = new THREE.Vector3(
      FACTORY.x - FACTORY.shedWidth * 0.5 - FACTORY.tankRadius - 2,
      FACTORY.tankHeight * 0.6,
      FACTORY.z + (index === 0 ? -6 : 6)
    );
    ctx.systems.explosions.spawnImpactBurst(at, FACTORY.tankStrength);
    ctx.systems.lightning.flashScreen(at, 0.35);
    ctx.systems.gamefeel.event('tanker', at);
    ctx.events.emit('explosion', { x: at.x, z: at.z, size: BLAST_SIZE.factoryTank, source: `factoryTank${index}` });
  }

  /**
   * The finale itself: the works goes. Everything past this point is the
   * pressure wave travelling outward, which updateBlast() below drives.
   * @returns {void}
   */
  function detonate() {
    S.state.phase = 'blast';
    S.state.timer = 0;
    S.state.satellitesFired = 0;
    S.state.nextSatellite = 0;
    S.state.nextPuff = 0;
    S.state.shockRadius = 0;
    S.state.shockDone.clear();
    const at = new THREE.Vector3(FACTORY.x, 6, FACTORY.z);

    ctx.systems.explosions.spawnImpactBurst(at, FACTORY.blastStrength);
    ctx.systems.cues.playLargeExplosion();
    ctx.systems.lightning.flashScreen(at, 1);

    // The site itself is burnt into the ground for the rest of the run.
    if (!S.scorchTexture) S.scorchTexture = api.createScorchTexture();
    const scorchMat = new THREE.MeshBasicMaterial({
      map: S.scorchTexture, transparent: true, depthWrite: false, opacity: 0.92
    });
    S.materials.push(scorchMat);
    const scorch = new THREE.Mesh(
      new THREE.PlaneGeometry(FACTORY.scorchRadius * 2, FACTORY.scorchRadius * 2), scorchMat
    );
    scorch.rotation.x = -Math.PI / 2;
    scorch.rotation.z = Math.random() * Math.PI * 2;
    // Level with the meteor craters, above the roads and the path scars.
    scorch.position.set(FACTORY.x, 0.025, FACTORY.z);
    scorch.name = 'factory_scorch';
    S.group.add(scorch);

    if (S.shockRing) {
      S.shockRing.visible = true;
      S.shockRing.position.set(FACTORY.x, 0.6, FACTORY.z);
      S.shockRing.scale.setScalar(0.01);
      S.shockRing.material.opacity = 0.85;
    }

    ctx.systems.gamefeel.event('factory', at);
    ctx.events.emit('explosion', { x: at.x, z: at.z, size: BLAST_SIZE.factory, source: 'factoryBlast' });
    ctx.systems.damage.addDamageScore(FACTORY.score);
    api.showBanner('CHEMICAL WORKS GONE!', `Catastrophic detonation · +${FACTORY.score} bonus`);

    // The works, its lights and the yard all stop existing together.
    if (S.shed) S.shed.visible = false;
    if (S.markers) S.markers.visible = false;
    if (S.flareLight) S.flareLight.intensity = 0;
    if (S.floodLight) S.floodLight.intensity = 0;
    for (const b of S.barrels) b.state = 'gone';
    api.writeBarrels();
  }

  /**
   * The pressure wave. It reaches things in order of distance rather than
   * flattening the whole radius on the frame of the bang, which is the
   * difference between a blast and a state change: the near row of houses is
   * already coming down while the far one is still standing.
   * @param {number} dt
   * @returns {void}
   */
  function updateBlast(dt) {
    const at = new THREE.Vector3(FACTORY.x, 2, FACTORY.z);
    const previous = S.state.shockRadius;
    S.state.shockRadius = Math.min(FACTORY.blastRadius, previous + FACTORY.shockSpeed * dt);

    if (S.shockRing && S.shockRing.visible) {
      S.shockRing.scale.setScalar(Math.max(0.01, S.state.shockRadius));
      const through = S.state.shockRadius / FACTORY.blastRadius;
      S.shockRing.material.opacity = 0.85 * (1 - through) * (1 - through);
      if (through >= 1) S.shockRing.visible = false;
    }

    // Satellite detonations walking outward from the site, and the fire
    // column climbing out of it.
    S.state.nextSatellite -= dt;
    while (S.state.satellitesFired < FACTORY.satellites && S.state.nextSatellite <= 0) {
      const a = Math.random() * Math.PI * 2;
      const r = (0.25 + Math.random() * 0.75) * FACTORY.satelliteSpread;
      ctx.systems.explosions.spawnImpactBurst(new THREE.Vector3(
        at.x + Math.cos(a) * r, 2 + Math.random() * 40, at.z + Math.sin(a) * r
      ), FACTORY.blastStrength * (0.45 + Math.random() * 0.3));
      S.state.satellitesFired++;
      S.state.nextSatellite += FACTORY.satelliteInterval;
    }
    S.state.nextPuff -= dt;
    while (S.state.timer < FACTORY.mushroomSeconds && S.state.nextPuff <= 0) {
      const climb = S.state.timer / FACTORY.mushroomSeconds;
      ctx.systems.explosions.spawnImpactBurst(new THREE.Vector3(
        at.x + (Math.random() - 0.5) * 80 * climb,
        6 + climb * FACTORY.mushroomRise,
        at.z + (Math.random() - 0.5) * 80 * climb
      ), FACTORY.blastStrength * (0.7 - climb * 0.3));
      S.state.nextPuff += FACTORY.mushroomInterval;
    }

    // What the wave has just reached, once each.
    for (const obj of Sim.objects) {
      if (obj.type === 'building' || obj.rooted || S.state.shockDone.has(obj)) continue;
      const pos = obj.pooled ? obj.position : (obj.mesh && obj.mesh.position);
      if (!pos) continue;
      const d = Math.hypot(pos.x - at.x, pos.z - at.z);
      if (d > S.state.shockRadius) continue;
      S.state.shockDone.add(obj);
      const falloff = 1 - d / FACTORY.blastRadius;
      const dir = S.waveDir.set(pos.x - at.x, 0, pos.z - at.z);
      if (dir.lengthSq() < 1e-6) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      dir.normalize().multiplyScalar(FACTORY.throwForce * falloff);
      obj.velocity.add(dir);
      obj.velocity.y += FACTORY.throwForce * falloff * 0.7;
      obj.angularVelocity.set(
        (Math.random() - 0.5) * 11, (Math.random() - 0.5) * 11, (Math.random() - 0.5) * 11
      );
    }

    const { shockBuilding } = ctx.systems.damage;
    if (shockBuilding && ctx.Environment) {
      for (const building of ctx.Environment.buildings) {
        if (S.state.shockDone.has(building)) continue;
        const p = building.mesh.position;
        const d = Math.hypot(p.x - at.x, p.z - at.z);
        if (d > S.state.shockRadius) continue;
        S.state.shockDone.add(building);
        shockBuilding(building, FACTORY.buildingShock * (1 - d / FACTORY.blastRadius), at);
      }
    }

    // The far town (environment/backdrop.js) goes over as the wave crosses it,
    // out to where it has lost most of its force.
    if (ctx.systems.backdrop) {
      ctx.systems.backdrop.damageAt(at.x, at.z, Math.min(S.state.shockRadius, FACTORY.blastRadius * 0.8));
    }

    // Fire and faults spread with the wave rather than landing at once.
    if (previous < FACTORY.fireRadius) {
      const reach = Math.min(S.state.shockRadius, FACTORY.fireRadius);
      ctx.systems.buildingFire.igniteNear(at.x, at.z, reach);
      ctx.systems.powerLines.faultAt(at.x, at.z, reach);
      // Any gas main the wave passes over is torn open and already alight
      // (engine/gasMains.js), so the blast does not stop at its own radius --
      // it carries on down whichever streets it reached -- and it sets off
      // the tanker if it reaches it (engine/explosives.js).
      setOffExplosivesAt(ctx, at.x, at.z, reach);
    }
    // Roger on the wave's front inside the scorched ground is caught in it.
    if (previous < FACTORY.scorchRadius) {
      hitRogerAt(ctx, at.x, at.z, Math.min(S.state.shockRadius, FACTORY.scorchRadius));
    }
    if (S.state.shockRadius >= FACTORY.blastRadius && S.state.timer >= FACTORY.mushroomSeconds) {
      S.state.phase = 'done';
    }
  }

  return { ignite, popBarrel, nextBarrel, blowTank, detonate, updateBlast };
}
