import * as THREE from 'three';
import { danceAlien } from '../dance.js';
import { STAND_OFF, standOffStep } from './standOff.js';
import { ALIENS } from './config.js';
import { HEALTH } from '../health/config.js';
import { touchAttempt } from '../health/melee.js';

/**
 * ===========================================================================
 * SECTION AK.4 — The crew on the ground
 * ===========================================================================
 * Each alien's walk, patrol, dance, targets and fights: the rampage, hunting
 * Roger, catching fire, and being killed by Roger's weapons or lightning.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the aliens' shared state (see aliens.js)
 * @param {Object} api every aliens module's functions, by name
 * @returns {Object}
 */
export function createAlienCrew(ctx, S, api) {
  const { Sim } = ctx;

  // ---------------------------------------------------------------------
  // The crew
  // ---------------------------------------------------------------------

  /**
   * @param {number} x
   * @param {number} z
   * @returns {boolean} whether a standing building covers this point
   */
  function insideBuilding(x, z) {
    for (const building of ctx.Environment.buildings) {
      if (building.damageState === 'collapsed') continue;
      const fp = building.mesh.userData.footprint;
      if (!fp) continue;
      const b = building.mesh.position;
      if (Math.abs(x - b.x) < fp.width / 2 + 1 && Math.abs(z - b.z) < fp.depth / 2 + 1) return true;
    }
    return false;
  }

  /**
   * A new spot to walk to, round the ship and clear of buildings.
   * @param {Alien} alien
   * @returns {void}
   */
  function pickPatrolTarget(alien) {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = ALIENS.patrol[0] + Math.random() * (ALIENS.patrol[1] - ALIENS.patrol[0]);
      const x = S.state.x + Math.cos(a) * r;
      const z = S.state.z + Math.sin(a) * r;
      if (insideBuilding(x, z)) continue;
      alien.tx = x;
      alien.tz = z;
      return;
    }
    alien.tx = S.rampFoot.x;
    alien.tz = S.rampFoot.z;
  }

  /**
   * @param {Alien} alien
   * @param {number} speed world units/sec it covered this frame, for the stride
   * @returns {void}
   */
  function poseWalk(alien, speed) {
    const s = Math.sin(alien.cycle);
    const amp = speed > 0 ? 0.5 : 0;
    alien.limbs.legL.rotation.x = s * amp;
    alien.limbs.legR.rotation.x = -s * amp;
    alien.limbs.armL.rotation.x = -s * amp * 0.6;
    // The gun arm stays up, aimed, while it is about to shoot or just has.
    if (alien.aim > 0) return;
    alien.limbs.armR.rotation.x = s * amp * 0.6;
    alien.limbs.armR.rotation.z = 0.18;
  }

  /**
   * @param {Alien} alien
   * @param {number} dt
   * @returns {void}
   */
  function updateAlien(alien, dt) {
    // Frozen (engine/effects/freeze.js): it stands in its block of ice.
    if (ctx.systems.enemies.getState(alien, 'frozen')) return;
    const p = alien.root.position;
    if (alien.phase === 'exiting') {
      // Down the ramp from the hatch, at a walk.
      alien.timer += dt;
      const u = Math.min(1, alien.timer / (api.rampLength() / ALIENS.walkSpeed / 1.6));
      // The second wave walks down the transport's ramp, not the ship's.
      p.lerpVectors(alien.exitTop || S.rampTop, alien.exitFoot || S.rampFoot, u);
      p.y += 0.2;
      alien.heading = alien.exitTop ? alien.exitHeading : Math.atan2(S.state.dirX, S.state.dirZ);
      alien.root.rotation.y = alien.heading;
      alien.cycle += dt * 8;
      poseWalk(alien, 1);
      if (u >= 1) {
        alien.phase = 'patrol';
        p.y = 0;
        pickPatrolTarget(alien);
        // Down the ramp: a chirp, its own pitch (sound/creatures.js).
        ctx.systems.creatureSounds.play('alienChirp', p, { pitch: ctx.systems.creatureSounds.pitchOf(alien) });
      }
      return;
    }
    if (alien.phase === 'burning' && alien.slain) {
      // Cut down by a samurai (slashKill): it reels back, drops, and is gone
      // -- the burning's timing, without the fire.
      alien.timer += dt;
      const u = alien.timer / ALIENS.burnSeconds;
      alien.skin.emissive.setRGB(0.02, 0.06 * (1 - u), 0.02);
      alien.root.rotation.x = -Math.min(1, u * 3) * (Math.PI / 2 - 0.1);
      if (u >= 1) {
        alien.phase = 'dead';
        Sim.three.scene.remove(alien.root);
        alien.skin.dispose();
      }
      return;
    }
    if (alien.phase === 'burning') {
      alien.timer += dt;
      const u = alien.timer / ALIENS.burnSeconds;
      const flicker = 0.6 + 0.4 * Math.random();
      alien.skin.emissive.setRGB(2.4 * (1 - u) * flicker, 0.7 * (1 - u) * flicker, 0.05);
      alien.skin.color.setRGB(0.35 * (1 - u) + 0.04, 0.4 * (1 - u) + 0.03, 0.03);
      if (Math.random() < dt * 9) {
        S.scratch.set(p.x + (Math.random() - 0.5) * 2, 1 + Math.random() * 4, p.z + (Math.random() - 0.5) * 2);
        ctx.systems.explosions.spawnImpactBurst(S.scratch, 0.5);
      }
      if (u > 0.5) alien.root.rotation.x = -Math.min(1, (u - 0.5) * 2.5) * (Math.PI / 2 - 0.1);
      if (u >= 1) {
        alien.phase = 'dead';
        Sim.three.scene.remove(alien.root);
        alien.skin.dispose();
      }
      return;
    }
    if (alien.phase === 'escort') {
      // Moved by updateAbductees; only the fire can stop it.
      checkFirenado(alien);
      return;
    }
    if (alien.phase === 'aboard') {
      alien.timer += dt;
      if (alien.timer >= ALIENS.aboardSeconds && S.ship && S.state.phase === 'hovering') {
        alien.phase = 'exiting';
        alien.timer = 0;
        alien.root.visible = true;
        alien.root.scale.setScalar(ALIENS.scale);
        alien.root.position.copy(S.rampTop);
      }
      return;
    }
    if (alien.phase !== 'patrol') return;
    // Chirps and clicks among themselves, now and then, each its own pitch.
    if (Math.random() < dt * 0.3) ctx.systems.creatureSounds.play('alienChirp', p, { pitch: ctx.systems.creatureSounds.pitchOf(alien), gain: 0.8 });
    if (alien.aim > 0) alien.aim -= dt;

    // Thrown back by a Terminator's blow: skidding away, rocked back.
    if (alien.knockTimer > 0) {
      alien.knockTimer -= dt;
      const nx = p.x + alien.knockX * ALIENS.knockSpeed * dt;
      const nz = p.z + alien.knockZ * ALIENS.knockSpeed * dt;
      if (!insideBuilding(nx, nz)) {
        p.x = nx;
        p.z = nz;
      }
      alien.root.rotation.x = -0.5 * Math.max(0, alien.knockTimer / ALIENS.knockSeconds);
      checkFirenado(alien);
      return;
    }
    alien.root.rotation.x = 0;

    // Smooth Criminal: nothing but dancing.
    if (S.frame.peace) {
      dance(alien, dt);
      checkFirenado(alien);
      return;
    }
    // Roger near: he comes first, ship or no ship.
    const hero = api.heroTarget(alien.root.position.x, alien.root.position.z);
    if (hero && huntRoger(alien, hero, dt)) {
      unDance(alien);
      checkFirenado(alien);
      return;
    }
    // No humans left to go after: they dance where they stand.
    if (S.frame.noHumans) {
      dance(alien, dt);
      checkFirenado(alien);
      return;
    }
    unDance(alien);

    // With no ship to guard -- or brought by the transport, which leaves --
    // they go through town after people.
    if (!S.ship || S.state.phase === 'wrecked' || S.state.phase === 'lifting' || S.state.phase === 'hunting' || alien.wave) {
      rampage(alien, dt);
      checkFirenado(alien);
      return;
    }

    // Wandering round the ship, with a pause at each spot.
    let speed = 0;
    if (alien.pause > 0) {
      alien.pause -= dt;
      // Heads turning towards the town.
      alien.root.rotation.y = alien.heading + 0.4 * Math.sin(alien.cycle * 0.7 + alien.timer);
      alien.timer += dt;
    } else {
      const dx = alien.tx - p.x;
      const dz = alien.tz - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.8) {
        alien.pause = 1.5 + Math.random() * 3;
        pickPatrolTarget(alien);
      } else {
        const want = Math.atan2(dx, dz);
        let turn = Math.atan2(Math.sin(want - alien.heading), Math.cos(want - alien.heading));
        turn = THREE.MathUtils.clamp(turn, -ALIENS.turnRate * dt, ALIENS.turnRate * dt);
        alien.heading += turn;
        speed = ALIENS.walkSpeed;
        const nx = p.x + Math.sin(alien.heading) * speed * dt;
        const nz = p.z + Math.cos(alien.heading) * speed * dt;
        // Blocked (a building has come down across the way): another spot.
        if (insideBuilding(nx, nz)) pickPatrolTarget(alien);
        else {
          p.x = nx;
          p.z = nz;
        }
        alien.root.rotation.y = alien.heading;
        alien.cycle += speed * dt * 3;
      }
    }
    poseWalk(alien, speed);
    checkFirenado(alien);
  }

  /**
   * @param {Alien} alien
   * @param {number} dt
   * @returns {void}
   */
  function dance(alien, dt) {
    alien.dancing = true;
    alien.aim = 0;
    alien.danceTime = (alien.danceTime || 0) + dt;
    danceAlien(alien, alien.danceTime);
  }

  /**
   * Out of a dance, limbs back where the walk and the gun arm expect them.
   * @param {Alien} alien
   * @returns {void}
   */
  function unDance(alien) {
    if (!alien.dancing) return;
    alien.dancing = false;
    const L = alien.limbs;
    L.armL.rotation.set(0, 0, -0.18);
    L.armR.rotation.set(0, 0, 0.18);
    L.legL.rotation.set(0, 0, 0);
    L.legR.rotation.set(0, 0, 0);
    alien.root.position.y = 0;
    alien.root.rotation.z = 0;
    alien.root.rotation.y = alien.heading;
  }

  /**
   * The one thing that kills them outright: the burning funnel.
   * @param {Alien} alien
   * @returns {void}
   */
  function checkFirenado(alien) {
    const fire = ctx.systems.firenado;
    if (!fire || !fire.burning()) return;
    const p = alien.root.position;
    const v = ctx.Vortex;
    const reach = Sim.params.radius * (v.sizeMul || 1) * ALIENS.fireReach;
    if (Math.hypot(p.x - v.center.x, p.z - v.center.z) < reach) {
      const was = alien.phase;
      ignite(alien);
      // Counted for the Fire crew mission (engine/missions.js).
      if (was !== 'burning' && alien.phase === 'burning') Sim.stats.aliensBurned++;
    }
  }

  /**
   * @param {Alien} alien
   * @returns {void}
   */
  function ignite(alien) {
    if (alien.phase === 'burning' || alien.phase === 'dead') return;
    alien.phase = 'burning';
    alien.timer = 0;
    alien.root.rotation.x = 0;
    ctx.systems.creatureSounds.play('alienDeath', alien.root.position, { pitch: ctx.systems.creatureSounds.pitchOf(alien) });
    ctx.systems.damage.addDamageScore(ALIENS.killScore);
    if (!alien.slain) ctx.systems.gamefeel.event('fire', alien.root.position);
  }

  // ---------------------------------------------------------------------
  // The rampage
  // ---------------------------------------------------------------------

  /**
   * An alien's target this frame. The full search (nearestTarget: every
   * person and building in town) runs every ALIENS.retargetSeconds, or at
   * once when the one it had is gone -- taken, dead, fallen down; in
   * between only the distance to the same target is brought up to date.
   * It ran for every alien every frame, which with a hundred of them after
   * a mutation was the larger part of the aliens' cost (performance pass).
   * @param {Alien} alien
   * @param {THREE.Vector3} p
   * @param {number} dt
   * @returns {{kind: 'person'|'building', obj: Object, x: number, z: number, d: number}|null}
   */
  function currentTarget(alien, p, dt) {
    alien.retarget = (alien.retarget || 0) - dt;
    let t = alien.target || null;
    if (t) {
      const o = t.obj;
      const gone = t.kind === 'person'
        ? !o.mesh.parent || o.abducted || o.electrocuted || o.captureState !== 'grounded'
        : o.damageState === 'collapsed';
      if (gone) t = null;
    }
    if (!t || alien.retarget <= 0) {
      alien.retarget = ALIENS.retargetSeconds * (0.8 + Math.random() * 0.4);
      t = nearestTarget(p);
      alien.target = t;
      return t;
    }
    const q = t.obj.mesh.position;
    t.x = q.x;
    t.z = q.z;
    if (t.kind === 'person') {
      t.d = Math.hypot(q.x - p.x, q.z - p.z);
    } else {
      const fp = t.obj.mesh.userData.footprint;
      t.d = Math.max(0, Math.hypot(q.x - p.x, q.z - p.z) - (fp ? Math.max(fp.width, fp.depth) / 2 : 0));
    }
    return t;
  }

  /**
   * The nearest thing worth shooting: a person on their feet or a standing
   * building, within ALIENS.raySight.
   * @param {THREE.Vector3} p
   * @returns {{kind: 'person'|'building', obj: Object, x: number, z: number, d: number}|null}
   */
  function nearestTarget(p) {
    /** @type {{kind: 'person'|'building', obj: Object, x: number, z: number, d: number}|null} */
    let best = null;
    let bestD = ALIENS.raySight;
    for (const person of ctx.Environment.people) {
      if (!person.mesh.parent || person.abducted || person.electrocuted || person.captureState !== 'grounded') continue;
      const q = person.mesh.position;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'person', obj: person, x: q.x, z: q.z, d };
      }
    }
    for (const building of ctx.Environment.buildings) {
      if (building.damageState === 'collapsed') continue;
      const q = building.mesh.position;
      // Measured to the nearer face rather than the middle, roughly.
      const fp = building.mesh.userData.footprint;
      const d = Math.max(0, Math.hypot(q.x - p.x, q.z - p.z) - (fp ? Math.max(fp.width, fp.depth) / 2 : 0));
      if (d < bestD) {
        bestD = d;
        best = { kind: 'building', obj: building, x: q.x, z: q.z, d };
      }
    }
    return best;
  }

  /**
   * With the ship gone: at the nearest person or building, to within range,
   * and shooting. A Terminator in range is shot at too, for all the good it
   * does.
   * @param {Alien} alien
   * @param {number} dt
   * @returns {void}
   */
  function rampage(alien, dt) {
    const p = alien.root.position;
    const target = currentTarget(alien, p, dt);
    let speed = 0;
    if (target) {
      const want = Math.atan2(target.x - p.x, target.z - p.z);
      let turn = Math.atan2(Math.sin(want - alien.heading), Math.cos(want - alien.heading));
      turn = THREE.MathUtils.clamp(turn, -ALIENS.turnRate * dt, ALIENS.turnRate * dt);
      alien.heading += turn;
      if (target.d > ALIENS.rayRange * 0.8) {
        speed = ALIENS.walkSpeed * 1.3;
        const nx = p.x + Math.sin(alien.heading) * speed * dt;
        const nz = p.z + Math.cos(alien.heading) * speed * dt;
        if (!insideBuilding(nx, nz)) {
          p.x = nx;
          p.z = nz;
        } else {
          // Round the corner rather than into the wall.
          alien.heading += 1.2 * dt * 4;
        }
        alien.cycle += speed * dt * 3;
      }
      alien.root.rotation.y = alien.heading;
    }
    alien.rayTimer -= dt;
    // The gun comes up a moment before the shot, at what it is going to hit.
    const inRange = target && target.d <= ALIENS.rayRange;
    if (inRange && alien.rayTimer < ALIENS.aimLead) {
      alien.aim = Math.max(alien.aim, alien.rayTimer + 0.05);
      api.raiseGun(alien, S.scratch.set(target.x, target.kind === 'person' ? 1.5 : 4, target.z));
    }
    poseWalk(alien, speed);
    if (alien.rayTimer > 0) return;
    const machine = ctx.systems.terminator && ctx.systems.terminator.nearestWalking(p.x, p.z, ALIENS.rayRange);
    if (!target && !machine) return;
    alien.rayTimer = ALIENS.rayEvery[0] + Math.random() * (ALIENS.rayEvery[1] - ALIENS.rayEvery[0]);
    if (machine && Math.random() < 0.4) {
      api.shoot(alien, new THREE.Vector3(machine.root.position.x, 3, machine.root.position.z));
      ctx.systems.terminator.rayHit(machine);
      return;
    }
    if (!inRange) return;
    const hit = new THREE.Vector3(target.x, target.kind === 'person' ? 1.5 : 4, target.z);
    api.shoot(alien, hit);
    if (target.kind === 'person') {
      ctx.systems.people.explodePerson(target.obj);
      ctx.systems.damage.addDamageScore(20);
      return;
    }
    const damage = ctx.systems.damage;
    damage.damageFromImpact(target.obj, hit, ALIENS.rayEnergy);
    damage.shockBuilding(target.obj, ALIENS.rayShock, hit);
    if (Math.random() < ALIENS.rayIgnite && ctx.systems.buildingFire) ctx.systems.buildingFire.igniteBuilding(target.obj);
    ctx.systems.explosions.spawnImpactBurst(hit, 0.8);
  }

  // ---------------------------------------------------------------------
  // Fighting the Terminators
  // ---------------------------------------------------------------------

  /**
   * The alien still on its feet nearest a point, within `radius`, for a
   * Terminator to go for.
   * @param {number} x
   * @param {number} z
   * @param {number} radius
   * @returns {Alien|null}
   */
  function nearestAlien(x, z, radius) {
    let best = null;
    let bestD = radius;
    for (const alien of S.aliens) {
      if (alien.phase !== 'patrol') continue;
      const d = Math.hypot(alien.root.position.x - x, alien.root.position.z - z);
      if (d < bestD) {
        bestD = d;
        best = alien;
      }
    }
    return best;
  }

  /**
   * @param {THREE.Vector3} p
   * @returns {boolean} whether there is fire at hand: the Firenado close by,
   *   or a building burning next to it
   */
  function fireAt(p) {
    const fire = ctx.systems.firenado;
    if (fire && fire.burning()) {
      const v = ctx.Vortex.center;
      if (Math.hypot(v.x - p.x, v.z - p.z) < ALIENS.fireNear) return true;
    }
    const buildingFire = ctx.systems.buildingFire;
    if (buildingFire) {
      for (const building of buildingFire.burning()) {
        const q = building.mesh.position;
        if (Math.hypot(q.x - p.x, q.z - p.z) < ALIENS.burningNear) return true;
      }
    }
    return false;
  }

  /**
   * A Terminator's blow. With fire at hand it kills -- the alien goes up as
   * the Firenado would burn it -- otherwise it only throws it back.
   * @param {Alien} alien
   * @param {THREE.Vector3} from where the blow came from
   * @returns {void}
   */
  function strikeAlien(alien, from) {
    if (alien.phase !== 'patrol') return;
    const p = alien.root.position;
    S.scratch.set(p.x, 2.5, p.z);
    ctx.systems.explosions.spawnImpactBurst(S.scratch, 0.4);
    if (fireAt(p)) {
      ignite(alien);
      return;
    }
    const dx = p.x - from.x;
    const dz = p.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    alien.knockX = dx / d;
    alien.knockZ = dz / d;
    alien.knockTimer = ALIENS.knockSeconds;
  }

  /**
   * While the ship is there to take it to: a Terminator that comes near any
   * of the crew is taken up the ramp, one at a time.
   * @returns {void}
   */
  function grabTerminators() {
    const terminator = ctx.systems.terminator;
    if (!terminator || api.beltBusy() || S.abductees.some(a => a.machine)) return;
    for (const alien of S.aliens) {
      if (alien.phase !== 'patrol') continue;
      const p = alien.root.position;
      const unit = terminator.nearestWalking(p.x, p.z, ALIENS.grabReach);
      if (!unit) continue;
      api.shoot(alien, new THREE.Vector3(unit.root.position.x, 3, unit.root.position.z));
      api.abductMachine(unit);
      return;
    }
  }

  // ---------------------------------------------------------------------
  // Roger (engine/heroMode.js)
  // ---------------------------------------------------------------------

  /**
   * A crew member near Roger goes for him: closes in to grab him, and shoots
   * at where he stood as its gun came up.
   * @param {Alien} alien
   * @param {{x: number, z: number, onFoot: boolean, id?: string}} hero the player it hunts (`id` '0' or absent: Roger)
   * @param {number} dt
   * @returns {boolean} whether it is busy with him (and so not patrolling)
   */
  function huntRoger(alien, hero, dt) {
    const p = alien.root.position;
    const d = Math.hypot(hero.x - p.x, hero.z - p.z);
    if (d > STAND_OFF.sight || !hero.onFoot) {
      alien.locked = false;
      return false;
    }
    // Never up close (on request): in while he is far, then round him at
    // STAND_OFF.ring, shooting from there, always on the move (standOff.js).
    alien.flip = (alien.flip ?? api.between(STAND_OFF.flip)) - dt;
    if (alien.flip <= 0 || !alien.circle) {
      alien.flip = api.between(STAND_OFF.flip);
      alien.circle = alien.circle ? -alien.circle : (Math.random() < 0.5 ? -1 : 1);
    }
    const step = standOffStep(hero.x - p.x, hero.z - p.z, alien.circle);
    const want = Math.atan2(step.x, step.z);
    let turn = Math.atan2(Math.sin(want - alien.heading), Math.cos(want - alien.heading));
    turn = THREE.MathUtils.clamp(turn, -ALIENS.turnRate * 3 * dt, ALIENS.turnRate * 3 * dt);
    alien.heading += turn;
    const speed = ALIENS.huntSpeed;
    const nx = p.x + Math.sin(alien.heading) * speed * dt;
    const nz = p.z + Math.cos(alien.heading) * speed * dt;
    if (!insideBuilding(nx, nz)) {
      p.x = nx;
      p.z = nz;
    } else {
      // A wall: the other way round him.
      alien.circle = -alien.circle;
      alien.heading += Math.PI * 0.5 * alien.circle;
    }
    alien.cycle += speed * dt * 3;
    // Facing the way it walks, or him while the gun is up.
    alien.root.rotation.y = alien.locked || alien.aim > 0 ? Math.atan2(hero.x - p.x, hero.z - p.z) : alien.heading;
    poseWalk(alien, speed);
    if (alien.aim > 0) alien.aim -= dt;
    // Melee: one touch of 34 per 3 s of world time per alien (health/melee.js).
    alien.touchClock += dt;
    const touch = touchAttempt(alien.touch, d, HEALTH, alien.touchClock, { source: 'alienTouch' });
    alien.touch = touch.state;
    if (touch.damage > 0) {
      ctx.systems.health.damagePlayer({
        source: 'alienTouch', type: 'melee', title: 'KILLED BY ALIENS', sub: 'They got their hands on Roger', targetId: hero.id ?? '0',
        position: { x: p.x, y: p.y, z: p.z }
      });
    }
    // The shot: aimed where he is as the gun comes up, and fired there.
    alien.rayTimer -= dt;
    if (!alien.locked && alien.rayTimer < ALIENS.aimLead) {
      alien.locked = true;
      alien.lockX = hero.x;
      alien.lockZ = hero.z;
    }
    if (alien.locked) {
      const at = S.scratch.set(alien.lockX, 2, alien.lockZ);
      api.raiseGun(alien, at);
      alien.aim = Math.max(alien.aim, 0.1);
      if (alien.rayTimer <= 0) {
        // Whether it hits is settled now, where he stands as it fires; the
        // damage lands with the bolt (aliens/weapons.js), on his chest.
        const onTarget = Math.hypot(hero.x - alien.lockX, hero.z - alien.lockZ) < ALIENS.rayHitRadius;
        const hit = onTarget ? {
          source: 'alienRay', type: 'ray', title: 'ZAPPED', sub: 'An alien ray hit Roger', targetId: hero.id ?? '0',
          position: { x: alien.root.position.x, y: alien.root.position.y, z: alien.root.position.z }
        } : null;
        api.shoot(alien, new THREE.Vector3(alien.lockX, onTarget ? 1.3 : 2, alien.lockZ), { hit, sizzle: onTarget });
        alien.rayTimer = api.between(ALIENS.rayEvery);
        alien.locked = false;
      }
    }
    return true;
  }

  /**
   * Roger's plasma: any shot kills one of the crew outright.
   * @param {Alien} alien
   * @param {THREE.Vector3} at
   * @returns {void}
   */
  function plasmaKill(alien, at) {
    if (alien.phase !== 'patrol' && alien.phase !== 'escort') return;
    // Out of the group it was bringing in, which goes on without it.
    for (const a of S.abductees) if (a.escorts) a.escorts = a.escorts.filter(e => e !== alien);
    ctx.systems.explosions.spawnImpactBurst(S.scratch.set(alien.root.position.x, 2.5, alien.root.position.z), 0.9);
    void at;
    ignite(alien);
  }

  /**
   * A samurai's sword (Landing Support, engine/spaceship/samurai.js): it
   * goes down where it stands, with a green splash rather than a fire.
   * @param {Alien} alien
   * @returns {void}
   */
  function slashKill(alien) {
    if (alien.phase !== 'patrol' && alien.phase !== 'escort' && alien.phase !== 'exiting') return;
    for (const a of S.abductees) if (a.escorts) a.escorts = a.escorts.filter(e => e !== alien);
    const p = alien.root.position;
    p.y = 0;
    ctx.systems.explosions.spawnImpactBurst(S.scratch.set(p.x, 0.9, p.z), 0.35);
    alien.slain = true;
    ignite(alien);
  }

  /**
   * The Katana (engine/hero/katana): the alien is cut and leaves the crew
   * at once, with no fire and no burning animation. Additive beside
   * slashKill. The base kill (ALIENS.killScore) is scored here exactly once,
   * as ignite() would, but Sim.stats.aliensBurned is not touched (it counts
   * burned aliens for the Fire crew mission) and no death cry or fire event
   * is played: the Katana's own sound and game feel do that.
   *
   * Ownership of `alien.root`: when `takeOver` is given it receives the root
   * (still in the scene, at the alien's pose) and becomes responsible for
   * removing it; the owner then neither removes it nor disposes the skin
   * here (resetAliens still disposes the skin on reset, so the taker must
   * clone any material it keeps). Without `takeOver` the root is removed and
   * the skin disposed straight away, as the burning path does when it ends.
   * `plane` (the cut's plane in world space) and the alien's own skin are
   * handed on to `takeOver` with the root, for the slicing core
   * (hero/katana/pieces.js).
   * @param {Alien} alien
   * @param {((root: THREE.Object3D, plane?: any, skin?: THREE.Material) => void)} [takeOver]
   * @param {any} [plane] the slash's cut plane ({point, normal}), read at once by `takeOver`
   * @returns {boolean} whether the alien was cut (false: not in a cuttable phase)
   */
  function sliceKill(alien, takeOver, plane) {
    if (alien.phase !== 'patrol' && alien.phase !== 'escort' && alien.phase !== 'exiting') return false;
    for (const a of S.abductees) if (a.escorts) a.escorts = a.escorts.filter(e => e !== alien);
    alien.phase = 'dead';
    ctx.systems.damage.addDamageScore(ALIENS.killScore);
    if (takeOver) {
      takeOver(alien.root, plane, alien.skin);
    } else {
      Sim.three.scene.remove(alien.root);
      alien.skin.dispose();
    }
    return true;
  }

  /**
   * A lightning bolt landing (strikeTargeting.js -- the Lightning tile, and
   * Roger's railgun): any of the crew inside `radius` of it burns, as the
   * Firenado or a plasma shot would take them.
   * @param {number} x
   * @param {number} z
   * @param {number} radius
   * @returns {number} how many it killed
   */
  function boltKill(x, z, radius) {
    let killed = 0;
    for (const alien of S.aliens) {
      if (alien.phase !== 'patrol' && alien.phase !== 'escort' && alien.phase !== 'exiting') continue;
      const p = alien.root.position;
      if (Math.hypot(p.x - x, p.z - z) > radius) continue;
      for (const a of S.abductees) if (a.escorts) a.escorts = a.escorts.filter(e => e !== alien);
      alien.root.position.y = 0;
      ignite(alien);
      killed++;
    }
    return killed;
  }

  return { insideBuilding, pickPatrolTarget, poseWalk, updateAlien, dance, unDance, checkFirenado, ignite, currentTarget, nearestTarget, rampage, nearestAlien, fireAt, strikeAlien, grabTerminators, huntRoger, plasmaKill, slashKill, sliceKill, boltKill };
}
