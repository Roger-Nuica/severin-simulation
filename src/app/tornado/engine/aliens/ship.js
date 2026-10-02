// @ts-check
import * as THREE from 'three';
import { onRailway } from '../environment/train.js';
import { VIADUCT_Z } from '../environment/viaduct.js';
import { buildSaucer } from '../spaceship.js';
import { setOffExplosivesAt } from '../explosives.js';
import { ALIENS } from './config.js';

/**
 * ===========================================================================
 * SECTION AK.2 — The landing ship
 * ===========================================================================
 * Where it comes down, its arrival, being caught by a funnel or shot down,
 * its wreck, and what can hit it.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the aliens' shared state (see aliens.js)
 * @param {Object} api every aliens module's functions, by name
 * @returns {Object}
 */
export function createAlienShip(ctx, S, api) {
  const { Sim } = ctx;

  /**
   * @param {number} x
   * @param {number} z
   * @returns {boolean} whether the ship can hang over here
   */
  function clearSpot(x, z) {
    if (onRailway(x, z)) return false;
    // The highway's deck is at about the height the ship hangs at.
    if (Math.abs(z - VIADUCT_Z) < ALIENS.viaductClearance) return false;
    for (const tornado of ctx.tornadoes.active) {
      const c = tornado.Vortex.center;
      if (Math.hypot(x - c.x, z - c.z) < ALIENS.funnelClearance) return false;
    }
    for (const building of ctx.Environment.buildings) {
      if (building.damageState === 'collapsed') continue;
      const p = building.mesh.position;
      const fp = building.mesh.userData.footprint;
      if (!fp) continue;
      if (Math.abs(x - p.x) < fp.width / 2 + ALIENS.clearance
        && Math.abs(z - p.z) < fp.depth / 2 + ALIENS.clearance) return false;
    }
    if (ctx.systems.chasm && ctx.systems.chasm.gapAt(x, z) > -4) return false;
    return true;
  }

  /**
   * Somewhere open to hang over, falling back to the least bad place tried.
   * @returns {{x: number, z: number}}
   */
  function pickSpot() {
    let fallback = { x: 0, z: 0 };
    for (let i = 0; i < 80; i++) {
      const x = (Math.random() * 2 - 1) * ALIENS.spotBound;
      const z = (Math.random() * 2 - 1) * ALIENS.spotBound;
      if (clearSpot(x, z)) return { x, z };
      if (i === 0) fallback = { x, z };
    }
    return fallback;
  }

  /**
   * Where the ship comes down, decided ahead of its arrival so the start of
   * the game can be set up round it: the opening camera (frameLanding) and
   * the Chase Mode car parked beside it (chase/index.js). Once it is here,
   * where it is. `dirX`/`dirZ` is the way its ramp runs out (towards the
   * middle of town), which the car keeps clear of.
   * @returns {{x: number, z: number, dirX: number, dirZ: number}}
   */
  function plannedSpot() {
    if (S.state.phase !== 'idle') return { x: S.state.x, z: S.state.z, dirX: S.state.dirX, dirZ: S.state.dirZ };
    if (!S.planned) S.planned = pickSpot();
    const far = Math.hypot(S.planned.x, S.planned.z) > 5;
    const a = far ? Math.atan2(-S.planned.z, -S.planned.x) : 0;
    return { x: S.planned.x, z: S.planned.z, dirX: Math.cos(a), dirZ: Math.sin(a) };
  }

  /**
   * The opening shot, on request: the camera on the aliens' landing spot,
   * from behind the ship and a little to one side, so the ship coming down,
   * its ramp running out towards town and the crew walking down it are all
   * in view -- and the Chase Mode car parked beside it.
   * @returns {void}
   */
  function frameLanding() {
    const spot = plannedSpot();
    // Across the ramp: the side the car is parked on (chase/index.js).
    const sideX = -spot.dirZ;
    const sideZ = spot.dirX;
    const cam = Sim.three.camera;
    cam.position.set(
      spot.x - spot.dirX * ALIENS.frameBack + sideX * ALIENS.frameSide,
      ALIENS.frameHeight,
      spot.z - spot.dirZ * ALIENS.frameBack + sideZ * ALIENS.frameSide
    );
    Sim.three.controls.target.set(spot.x + spot.dirX * 8, ALIENS.hoverHeight * 0.5, spot.z + spot.dirZ * 8);
    cam.lookAt(Sim.three.controls.target);
    Sim.three.controls.update();
  }

  /**
   * The ship comes down, at the start of a run.
   * @returns {void}
   */
  function arrive() {
    // Where it was planned (plannedSpot: the opening camera and the parked
    // car are already there), or a fresh one.
    const spot = S.planned || pickSpot();
    S.planned = null;
    S.state.x = spot.x;
    S.state.z = spot.z;
    // The ramp runs out towards the middle of town, where the people are.
    const a = Math.hypot(spot.x, spot.z) > 5 ? Math.atan2(-spot.z, -spot.x) : Math.random() * Math.PI * 2;
    S.state.dirX = Math.cos(a);
    S.state.dirZ = Math.sin(a);

    S.ship = buildSaucer();
    S.ship.group.name = 'alien_ship';
    for (const leg of S.ship.legs) leg.visible = false;
    for (const mat of S.ship.glow) mat.color.copy(ALIENS.glow);
    S.ship.group.position.set(S.state.x, ALIENS.arriveFrom, S.state.z);
    Sim.three.scene.add(S.ship.group);

    S.rampPivot = api.buildRamp();
    S.beltTexture = S.rampPivot.userData.belt;
    // Hinged at the edge of the hatch on the ramp's side, pointing outwards.
    S.rampPivot.position.set(S.state.dirX * ALIENS.hatchRadius, 1.2, S.state.dirZ * ALIENS.hatchRadius);
    S.rampPivot.rotation.y = -a;
    S.rampPivot.userData.tilt.scale.x = 0.001;
    S.ship.group.add(S.rampPivot);
    S.beam = api.buildBeam();
    S.beam.visible = false;
    S.rampPivot.userData.tilt.add(S.beam);

    const L = api.rampLength();
    const run = L * Math.cos(ALIENS.rampAngle);
    S.rampTop.set(S.state.x + S.state.dirX * ALIENS.hatchRadius, ALIENS.hoverHeight + 1.2, S.state.z + S.state.dirZ * ALIENS.hatchRadius);
    S.rampFoot.set(S.rampTop.x + S.state.dirX * run, 0, S.rampTop.z + S.state.dirZ * run);

    S.state.phase = 'arriving';
    S.state.timer = 0;
    S.state.hull = ALIENS.shipHull;
    S.state.damage = 0;
    S.state.crashing = false;
    S.state.abductClock = 0;
    S.state.nextAbduct = 0;
    S.state.exitTimer = 0;
    S.state.spawned = 0;
    S.state.spin = 0;
    // The goal, as the game opens (on request).
    api.showBanner('STOP THE ALIENS', `Before they abduct ${ALIENS.mothershipAfter} people · then the mothership comes`, ALIENS.goalSeconds);
  }

  // ---------------------------------------------------------------------
  // The ship
  // ---------------------------------------------------------------------

  /**
   * Height on the way in: a pure function of time, easing out onto the hover.
   * @param {number} t seconds since it started coming down
   * @returns {number}
   */
  function arrivalHeight(t) {
    const u = Math.min(1, t / ALIENS.arriveSeconds);
    const e = 1 - Math.pow(1 - u, 3);
    return THREE.MathUtils.lerp(ALIENS.arriveFrom, ALIENS.hoverHeight, e);
  }

  /**
   * Whether a funnel has reached the ship.
   * @returns {Object|null} the Vortex that has, if any
   */
  function funnelAtShip() {
    for (const { Vortex } of ctx.tornadoes.active) {
      if (Vortex.birth < 0.5) continue;
      const reach = Sim.params.radius * (Vortex.sizeMul || 1) + ALIENS.wreckReach;
      if (Math.hypot(Vortex.center.x - S.state.x, Vortex.center.z - S.state.z) < reach) return Vortex;
    }
    return null;
  }

  /**
   * Torn out of the sky: everyone still on the ramp goes with it.
   * @returns {void}
   */
  function wreck() {
    S.state.phase = 'wrecked';
    S.state.timer = 0;
    api.stopTracker(S.shipTracker);
    for (const a of S.abductees) {
      if (a.machine) ctx.systems.terminator.releaseUnit(a.machine);
      else if (a.person.mesh.parent) ctx.systems.people.explodePerson(a.person);
      api.releaseEscorts(a);
    }
    S.abductees = [];
    // Any of the crew inside go down with the ship.
    for (const alien of S.aliens) {
      if (alien.phase !== 'aboard') continue;
      alien.phase = 'dead';
      Sim.three.scene.remove(alien.root);
      alien.skin.dispose();
    }
    if (S.beam) S.beam.visible = false;
  }

  /**
   * The wreck spinning up the funnel, then blown apart.
   * @param {number} dt
   * @returns {void}
   */
  function updateWreck(dt) {
    S.state.timer += dt;
    const g = S.ship.group;
    if (S.state.crashing) {
      // Shot down: falls, spinning and listing, and blows up on the ground.
      g.position.y = Math.max(0, g.position.y - (6 + S.state.timer * 22) * dt);
      S.state.spin += dt * (2 + S.state.timer * 3);
      g.rotation.set(0.35 * S.state.timer, S.state.spin, 0.5);
    } else {
      const Vortex = ctx.tornadoes.nearest(g.position.x, g.position.z);
      const k = Math.min(1, dt * 1.5);
      g.position.x += (Vortex.center.x - g.position.x) * k;
      g.position.z += (Vortex.center.z - g.position.z) * k;
      g.position.y += (22 + S.state.timer * 18) * dt;
      S.state.spin += dt * (4 + S.state.timer * 6);
      g.rotation.set(0.5 * Math.sin(S.state.timer * 3), S.state.spin, 0.45);
    }
    if (Math.random() < dt * 8) {
      S.scratch.copy(g.position).add(new THREE.Vector3((Math.random() - 0.5) * 20, 3, (Math.random() - 0.5) * 20));
      ctx.systems.explosions.spawnImpactBurst(S.scratch, 1.2);
    }
    if (S.state.crashing ? g.position.y > 0.5 : S.state.timer < ALIENS.wreckSeconds) return;

    S.scratch.copy(g.position);
    if (S.state.crashing) {
      crashAt(S.scratch, 1, ALIENS.crashScore);
      ctx.events.emit('announce', { title: 'UFO DESTROYED', sub: `Shot down · +${ALIENS.crashScore}` });
    }
    ctx.systems.explosions.spawnImpactBurst(S.scratch, 4);
    for (let i = 0; i < 4; i++) {
      ctx.systems.explosions.spawnImpactBurst(
        S.scratch.clone().add(new THREE.Vector3((Math.random() - 0.5) * 24, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 24)), 2
      );
    }
    ctx.systems.lightning.flashScreen(S.scratch, 0.7);
    ctx.systems.cues.playLargeExplosion({ priority: true, gain: 1.3 });
    ctx.systems.gamefeel.event('factory', S.scratch);
    ctx.systems.damage.addDamageScore(ALIENS.wreckScore);
    removeShip();
    S.state.phase = 'gone';
  }

  /** @returns {void} */
  function removeShip() {
    if (!S.ship) return;
    const geometries = new Set();
    const materials = new Set();
    S.ship.group.traverse((child) => {
      if (child.geometry) geometries.add(child.geometry);
      if (child.material) materials.add(child.material);
    });
    Sim.three.scene.remove(S.ship.group);
    for (const geo of geometries) geo.dispose();
    for (const mat of materials) mat.dispose();
    S.ship = null;
    S.rampPivot = null;
    S.beam = null;
    if (S.beltTexture) S.beltTexture.dispose();
    S.beltTexture = null;
    if (S.light) S.light.intensity = 0;
  }

  /**
   * A crashed ship going up where it came down.
   * @param {THREE.Vector3} at
   * @param {number} size 1 for the ship, less for a hunter
   * @param {number} score
   * @returns {void}
   */
  function crashAt(at, size, score) {
    const ground = new THREE.Vector3(at.x, 2, at.z);
    ctx.systems.explosions.spawnImpactBurst(ground, 4 * size);
    ctx.systems.cues.playLargeExplosion({ priority: true, gain: 1.2 });
    ctx.systems.gamefeel.event('factory', ground);
    if (ctx.systems.earthquake) ctx.systems.earthquake.kickDust(at.x, at.z, 8, 3 * size);
    const damage = ctx.systems.damage;
    const reach = 22 * size;
    for (const building of ctx.Environment.buildings) {
      const p = building.mesh.position;
      const d = Math.hypot(p.x - at.x, p.z - at.z);
      if (d < reach) damage.shockBuilding(building, 3 * (1 - d / reach) + 0.6, ground);
    }
    for (const person of ctx.Environment.people.slice()) {
      if (!person.mesh.parent) continue;
      if (Math.hypot(person.mesh.position.x - at.x, person.mesh.position.z - at.z) < reach * 0.6) {
        ctx.systems.people.explodePerson(person);
      }
    }
    if (ctx.systems.heroMode) ctx.systems.heroMode.hitArea(at.x, at.z, reach * 0.5, 'CRUSHED', 'A falling ship came down on Roger');
    setOffExplosivesAt(ctx, at.x, at.z, reach * 0.6);
    damage.addDamageScore(score);
  }

  /**
   * One of Roger's plasma shots on the ship.
   * @param {number} points of hull it takes (heroMode.js SHIP_DAMAGE)
   * @param {THREE.Vector3} at
   * @returns {number} the share of the hull left (0 when it goes down), or
   *   -1 when there was nothing left to hit
   */
  function hitShip(points, at) {
    const heavy = points > 1;
    ctx.systems.explosions.spawnImpactBurst(at, heavy ? 3 : 1.4);
    if (!S.ship || S.state.phase === 'wrecked') return -1;
    S.state.hull = Math.max(0, S.state.hull - points);
    S.state.damage++;
    ctx.systems.cues.playLargeExplosion({ priority: true, gain: heavy ? 1 : 0.6 });
    if (S.state.hull <= 0) {
      S.state.crashing = true;
      api.stopTracker(S.shipTracker);
      wreck();
    }
    return S.state.hull / ALIENS.shipHull;
  }

  /**
   * What Roger's sights can hit in the air: the ship and the hunters, each as
   * an upright disc.
   * @returns {{x: number, y: number, z: number, radius: number, bottom: number, top: number, name: string, hit: (points: number, at: THREE.Vector3) => number}[]}
   */
  function shipTargets() {
    const out = [];
    if (S.ship && S.state.phase !== 'wrecked' && S.state.phase !== 'gone' && S.state.phase !== 'idle') {
      const p = S.ship.group.position;
      out.push({ x: p.x, y: p.y, z: p.z, radius: 14.5, bottom: p.y + 0.5, top: p.y + 7, name: 'UFO', hit: hitShip });
    }
    for (const hunter of S.hunters) {
      if (hunter.phase !== 'hunting' && hunter.phase !== 'arriving') continue;
      const p = hunter.group.position;
      const s = ALIENS.hunterScale;
      out.push({
        x: p.x, y: p.y, z: p.z, radius: 15 * s, bottom: p.y + 0.5 * s, top: p.y + 7 * s, name: 'HUNTER SHIP', hunter,
        hit: (points, at) => api.hitHunter(hunter, points, at)
      });
    }
    return out;
  }

  return { clearSpot, pickSpot, plannedSpot, frameLanding, arrive, arrivalHeight, funnelAtShip, wreck, updateWreck, removeShip, crashAt, hitShip, shipTargets };
}
