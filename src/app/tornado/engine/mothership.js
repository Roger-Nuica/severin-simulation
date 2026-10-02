// @ts-check
import * as THREE from 'three';
import { buildSaucer } from './spaceship.js';
import { setOffExplosivesAt } from './explosives.js';
import { MOTHERSHIP_CRASH_BLAST } from './explosions/megaBlast.js';

/**
 * ===========================================================================
 * SECTION AL — The mothership
 * ===========================================================================
 * What leaving the alien ship alone costs (engine/aliens.js). Once it has
 * taken five people (aliens.js ALIENS.mothershipAfter) and is still hanging
 * over the town, it calls this in: the same saucer (spaceship.js buildSaucer) at MOTHER.scale times
 * the size, filling the sky over the middle of town. The scene dims under it
 * (tornadoEngine.js updateBrightness reads dimming()).
 *
 * Once it is in place it charges, then drives a green-white beam from its
 * belly down onto one of the town's boulevards and runs it from one end to
 * the other -- and keeps going: the beam stays down for MOTHER.beamSeconds
 * (two minutes), carving pass after pass across the town, each from where
 * the last one ended to a new point, with the ship drifting along above it.
 * (It used to cut the one boulevard in eight seconds and leave.) Everything
 * the beam passes over goes: buildings struck and brought down and set
 * alight, people, cars and trees destroyed, the tanker, the chemical works
 * and the gas mains set off (engine/explosives.js), dust thrown up, and a
 * scorched strip left along every pass. Then it lifts away and the light comes back.
 * While a nuclear plant is standing (engine/nuclear.js), every pass after
 * the first runs straight at the nearest one, and the beam sets it off.
 *
 * Only Roger can stop it (engine/heroMode.js): every plasma shot holes its
 * hull -- a normal shot one point, a mega beam (the rifle's two-second
 * charge) five (heroMode.js SHIP_DAMAGE) -- and MOTHER.hull points bring it
 * down -- it burns, lists and falls out of the sky onto the town,
 * and goes up where it lands: the biggest explosion in the game after a
 * nuclear plant (explosions/megaBlast.js MOTHERSHIP_CRASH_BLAST -- a
 * white-out, a fireball dome, a pressure wave across the whole map and a
 * mushroom cloud that hangs over the town), bigger than the fuel tanker and
 * the chemical works, on request. Landing on a nuclear plant sets it off. Its beam kills Roger if it runs over him. It
 * comes at most once per run; a Reset sends it away. While it is here its
 * music plays (sound/cues.js, space-ship-music.wav).
 */

const MOTHER = {
  scale: 7,                 // of the landing ship's saucer (radius 15 -> 105)
  height: 125,
  arriveFrom: 520,
  arriveSeconds: 7,
  dim: 0.5,                 // how much of the scene's light it takes, at most
  dimSeconds: 4,
  chargeSeconds: 2.5,
  beamSeconds: 120,         // the beam stays down this long, pass after pass
  sweepSpeed: 26,           // world units/sec the beam's foot travels (a boulevard in ~8 s)
  passMin: 60,              // length of a pass after the first
  passBound: 110,           // where passes may end
  followRate: 0.35,         // how fast the ship drifts over the beam's foot
  leaveSeconds: 6,
  // The beam.
  beamRadius: 4.5,
  cutRadius: 10,            // everything this near the beam's foot goes
  impactEnergy: 12000,
  buildingShock: 9,
  scorchWidth: 14,
  scorchY: 0.035,
  score: 3000,
  colour: new THREE.Color(2.2, 5.5, 3),
  // The beam's glow, dimmed on request (2026-10-02: it washed the screen
  // out): light 900, beam opacity 0.8, foot 0.6 before.
  lightPeak: 300,
  beamOpacity: 0.4,
  footOpacity: 0.3,
  lightDistance: 90,
  // Hull points: a normal plasma shot takes 1, a mega beam 5 -- fifteen
  // shots, or three mega beams. (It was mega beams only, which read as the
  // rifle not working on it at all.)
  hull: 15,
  // Shot down: how long it takes to fall, and what it does where it lands.
  fallSeconds: 5.5,
  crashRadius: 60,
  crashScore: 20000
};

// The boulevards, as roadsDecor.js lays them out (peopleMotion.js keeps the
// same numbers): streets along X at these Z, and along Z at these X, each
// running +-HALF_LENGTH.
const STREETS_ALONG_X = [-20, -8, 8, 20];
const STREETS_ALONG_Z = [-30, 30];
const HALF_LENGTH = 105;

const UP = new THREE.Vector3(0, 1, 0);

/**
 * @param {Object} ctx
 * @returns {{
 *   initMothership: () => void,
 *   updateMothership: (dt: number) => void,
 *   summon: () => void,
 *   dimming: () => number,
 *   shipTarget: () => Object|null,
 *   musicWanted: () => boolean,
 *   resetMothership: () => void,
 *   disposeMothership: () => void
 * }}
 */
export function createMothershipSystem(ctx) {
  const { Sim } = ctx;

  const state = {
    /** @type {'idle'|'arriving'|'charging'|'cutting'|'leaving'|'falling'} */
    phase: 'idle',
    hull: 0,
    // Mega beams taken, for the smoke and fire it trails.
    damage: 0,
    // Chip hits taken (a small spark on every fourth).
    chips: 0,
    fallFrom: 0,
    timer: 0,
    dim: 0,
    dustTimer: 0,
    // Seconds the beam has been down, and how far along this pass it is.
    beamClock: 0,
    passU: 0,
    passLength: 1
  };
  /** @type {{group: THREE.Group, glow: THREE.Material[]}|null} */
  let ship = null;
  /** @type {THREE.Mesh|null} */
  let beam = null;
  /** @type {THREE.Mesh|null} */
  let foot = null;
  /** @type {THREE.Mesh|null} the strip being burnt on this pass */
  let scorch = null;
  /** @type {THREE.Mesh[]} every pass's strip, this one included */
  let scorches = [];
  /** @type {THREE.Object3D|null} */
  let light = null;
  // The boulevard being cut: from `start` to `end` on the ground.
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  const contact = new THREE.Vector3();
  const belly = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  /** @type {Set<Object>} buildings already struck on this pass */
  const struck = new Set();

  /** @returns {void} */
  function initMothership() {
    // Made now at zero and never removed: adding a light mid-run recompiles
    // every lit material in the scene.
    light = ctx.systems.lightPool.createLight(0x9dffb8, 0, MOTHER.lightDistance, 1.4);
    light.name = 'mothership_light';
    Sim.three.scene.add(light);
    // For the black hole (engine/effects/consumables.js): gone, no crash.
    ctx.systems.consumables.register({
      kind: 'mothership',
      list: () => (ship && state.phase !== 'idle' && state.phase !== 'falling' ? [ship] : []),
      position: (s) => s.group.position,
      object: (s) => s.group,
      big: true,
      consume: () => removeShip(true)
    });
  }

  /**
   * Called by aliens.js when its ship has been left alone for too long.
   * @returns {void}
   */
  function summon() {
    if (state.phase !== 'idle' || ship) return;
    // Which boulevard, and which way along it.
    const alongX = Math.random() < 0.67;
    const line = alongX
      ? STREETS_ALONG_X[Math.floor(Math.random() * STREETS_ALONG_X.length)]
      : STREETS_ALONG_Z[Math.floor(Math.random() * STREETS_ALONG_Z.length)];
    const dir = Math.random() < 0.5 ? 1 : -1;
    if (alongX) {
      start.set(-HALF_LENGTH * dir, 0, line);
      end.set(HALF_LENGTH * dir, 0, line);
    } else {
      start.set(line, 0, -HALF_LENGTH * dir);
      end.set(line, 0, HALF_LENGTH * dir);
    }

    const saucer = buildSaucer();
    ship = { group: saucer.group, glow: saucer.glow };
    ship.group.name = 'mothership';
    for (const leg of saucer.legs) leg.visible = false;
    ship.group.scale.setScalar(MOTHER.scale);
    // Too big for the sun's shadow map to do anything but smear; the
    // dimming is its shadow.
    ship.group.traverse((child) => { child.castShadow = false; });
    ship.group.position.set((start.x + end.x) / 2, MOTHER.arriveFrom, (start.z + end.z) / 2);
    Sim.three.scene.add(ship.group);

    // The beam: a unit cylinder from its base up +y, stretched and pointed
    // from the ground contact to the belly each frame.
    const beamGeo = new THREE.CylinderGeometry(MOTHER.beamRadius * 0.6, MOTHER.beamRadius, 1, 16, 1, true);
    beamGeo.translate(0, 0.5, 0);
    beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
      color: MOTHER.colour.clone(), transparent: true, opacity: MOTHER.beamOpacity,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    }));
    beam.name = 'mothership_beam';
    beam.visible = false;
    beam.frustumCulled = false;
    Sim.three.scene.add(beam);

    foot = new THREE.Mesh(new THREE.CircleGeometry(MOTHER.cutRadius, 24), new THREE.MeshBasicMaterial({
      color: MOTHER.colour.clone(), transparent: true, opacity: MOTHER.footOpacity,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    foot.rotation.x = -Math.PI / 2;
    foot.name = 'mothership_beam_foot';
    foot.visible = false;
    Sim.three.scene.add(foot);

    beginPass();
    state.phase = 'arriving';
    state.timer = 0;
    state.beamClock = 0;
    state.hull = MOTHER.hull;
    state.damage = 0;
  }

  /**
   * For Roger's sights (heroMode.js): the hull as an upright disc, while it
   * is there to be shot at.
   * @returns {{x: number, y: number, z: number, radius: number, bottom: number, top: number, name: string, hit: (points: number, at: THREE.Vector3) => number}|null}
   */
  function shipTarget() {
    if (!ship || state.phase === 'falling' || state.phase === 'leaving' || state.phase === 'idle') return null;
    const p = ship.group.position;
    return {
      x: p.x, y: p.y, z: p.z,
      radius: 15 * MOTHER.scale * 0.95,
      bottom: p.y + 1 * MOTHER.scale,
      top: p.y + 6 * MOTHER.scale,
      name: 'MOTHERSHIP',
      hit: hitByPlasma
    };
  }

  /**
   * One of Roger's shots on the hull.
   * @param {number} points of hull it takes (heroMode.js SHIP_DAMAGE)
   * @param {THREE.Vector3} [at] where; a chip may leave it out
   * @returns {number} the share of the hull left (0 when it goes down), or
   *   -1 when there was nothing left to hit
   */
  function hitByPlasma(points, at) {
    const heavy = points > 1;
    // Under one point (D3: the minigun, fire gun and railgun chip the hull) it
    // is a chip: no burst or shake, a spark on every fourth within the budget.
    const chip = points < 1;
    if (!chip) ctx.systems.explosions.spawnImpactBurst(at, heavy ? 5 : 2);
    if (!ship || state.phase === 'falling') return -1;
    state.hull = Math.max(0, state.hull - points);
    // Smoke off the hull (updateMothership) builds with the damage taken.
    state.damage = Math.ceil(((MOTHER.hull - state.hull) / MOTHER.hull) * 4);
    if (chip) {
      state.chips++;
      if (state.chips % 4 === 0 && state.hull > 0 && ctx.systems.caps.particleRoom() > 0) {
        ctx.systems.explosions.spawnImpactBurst(at || ship.group.position, 0.4);
      }
      if (state.hull > 0) ctx.systems.cues.playLargeExplosion({ gain: 0.25 });
    } else {
      ctx.systems.cues.playLargeExplosion({ priority: true, gain: heavy ? 1 : 0.6 });
      ctx.systems.gamefeel.addShake(heavy ? 1 : 0.4, 0.5);
    }
    if (state.hull <= 0) shootDown();
    return state.hull / MOTHER.hull;
  }

  /**
   * Out of the sky: the beam cut, fire all over the hull, and down.
   * @returns {void}
   */
  function shootDown() {
    state.phase = 'falling';
    state.timer = 0;
    state.fallFrom = ship.group.position.y;
    if (beam) beam.visible = false;
    if (foot) foot.visible = false;
    if (light) light.intensity = 0;
    ctx.systems.lightning.flashScreen(scratch.copy(ship.group.position), 0.9, '#c8ffd8');
    ctx.systems.gamefeel.event('tanker', ship.group.position);
    ctx.events.emit('announce', { title: 'MOTHERSHIP DOWN', sub: 'It is falling on the town' });
  }

  /**
   * The fall: listing, burning, faster and faster; then it goes up where
   * it lands, and takes what is under it.
   * @param {number} dt
   * @returns {void}
   */
  function updateFall(dt) {
    const g = ship.group;
    const u = Math.min(1, state.timer / MOTHER.fallSeconds);
    g.position.y = Math.max(0, state.fallFrom * (1 - u * u));
    g.rotation.z = 0.35 * u;
    g.rotation.x = 0.18 * u;
    g.rotation.y += dt * 0.4;
    if (Math.random() < dt * 14) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 15 * MOTHER.scale;
      scratch.set(g.position.x + Math.cos(a) * r, g.position.y + 2 + Math.random() * 20, g.position.z + Math.sin(a) * r);
      ctx.systems.explosions.spawnImpactBurst(scratch, 2 + Math.random() * 3);
    }
    if (u < 1) return;
    const at = new THREE.Vector3(g.position.x, 2, g.position.z);
    // The whole catastrophe: flash, fireball, pressure wave, mushroom cloud
    // (explosions/megaBlast.js).
    ctx.systems.megaBlast.detonate(at, MOTHERSHIP_CRASH_BLAST);
    // Right on top of a nuclear plant, it takes that with it (nuclear.js).
    if (ctx.systems.nuclear) ctx.systems.nuclear.hitArea(at.x, at.z, MOTHER.crashRadius, 'mothership');
    const damage = ctx.systems.damage;
    damage.addDamageScore(MOTHER.crashScore);
    ctx.events.emit('announce', { title: 'MOTHERSHIP DESTROYED', sub: `+${MOTHER.crashScore}` });
    removeShip();
  }

  /**
   * Whether its music should be playing (sound/cues.js): from the moment it
   * arrives until it is destroyed or has gone.
   * @returns {boolean}
   */
  function musicWanted() {
    return !!ship && state.phase !== 'falling' && state.phase !== 'leaving';
  }

  /**
   * A new pass from `start` to `end`: its own burnt strip, grown along it as
   * the beam goes, and every building fair game again.
   * @returns {void}
   */
  function beginPass() {
    const length = Math.max(1, start.distanceTo(end));
    const scorchGeo = new THREE.PlaneGeometry(1, MOTHER.scorchWidth);
    scorchGeo.translate(0.5, 0, 0);
    scorch = new THREE.Mesh(scorchGeo, new THREE.MeshStandardMaterial({
      color: 0x0c0d0c, roughness: 1, emissive: 0x1a3a12, emissiveIntensity: 0.6,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    }));
    scorch.rotation.x = -Math.PI / 2;
    scorch.rotation.z = Math.atan2(-(end.z - start.z), end.x - start.x);
    // Each strip a hair above the last, so crossings do not flicker.
    scorch.position.set(start.x, MOTHER.scorchY + (scorches.length % 8) * 0.0008, start.z);
    scorch.scale.set(0.001, 1, 1);
    scorch.userData.length = length;
    scorch.receiveShadow = true;
    scorch.name = 'mothership_scorch';
    Sim.three.scene.add(scorch);
    scorches.push(scorch);
    state.passU = 0;
    state.passLength = length;
    struck.clear();
  }

  /**
   * The next pass, from where the last one ended: half the time down one of
   * the boulevards, otherwise straight to a random point across town.
   * @returns {void}
   */
  function nextPass() {
    start.copy(end);
    // A nuclear plant still standing: straight at it (engine/nuclear.js).
    const plant = ctx.systems.nuclear ? ctx.systems.nuclear.nearestIntact(start.x, start.z) : null;
    if (plant) {
      end.set(plant.x, 0, plant.z);
      beginPass();
      return;
    }
    for (let i = 0; i < 20; i++) {
      if (Math.random() < 0.5) {
        const alongX = Math.random() < 0.67;
        const line = alongX
          ? STREETS_ALONG_X[Math.floor(Math.random() * STREETS_ALONG_X.length)]
          : STREETS_ALONG_Z[Math.floor(Math.random() * STREETS_ALONG_Z.length)];
        const along = (Math.random() * 2 - 1) * HALF_LENGTH;
        if (alongX) end.set(along, 0, line);
        else end.set(line, 0, along);
      } else {
        end.set((Math.random() * 2 - 1) * MOTHER.passBound, 0, (Math.random() * 2 - 1) * MOTHER.passBound);
      }
      if (end.distanceTo(start) >= MOTHER.passMin) break;
    }
    beginPass();
  }

  /**
   * Everything within cutRadius of the beam's foot.
   * @param {THREE.Vector3} at
   * @returns {void}
   */
  function cutAt(at) {
    const damage = ctx.systems.damage;
    for (const building of ctx.Environment.buildings) {
      if (building.damageState === 'collapsed' || struck.has(building)) continue;
      const p = building.mesh.position;
      const fp = building.mesh.userData.footprint;
      const hx = fp ? fp.width / 2 : 3;
      const hz = fp ? fp.depth / 2 : 3;
      // Distance from the beam's foot to the footprint.
      const dx = Math.max(0, Math.abs(at.x - p.x) - hx);
      const dz = Math.max(0, Math.abs(at.z - p.z) - hz);
      if (Math.hypot(dx, dz) > MOTHER.cutRadius) continue;
      struck.add(building);
      scratch.set(p.x, 4, p.z);
      damage.damageFromImpact(building, scratch, MOTHER.impactEnergy);
      damage.shockBuilding(building, MOTHER.buildingShock, at);
      if (ctx.systems.buildingFire) ctx.systems.buildingFire.igniteBuilding(building);
      ctx.systems.explosions.spawnImpactBurst(scratch, 1.6);
      ctx.systems.cues.playLargeExplosion();
    }
    // The tanker, the chemical works, the gas mains and the power lines under
    // the beam go off too (engine/explosives.js): storm or no storm.
    setOffExplosivesAt(ctx, at.x, at.z, MOTHER.cutRadius + 4);
    // A nuclear plant under it goes (engine/nuclear.js).
    if (ctx.systems.nuclear) ctx.systems.nuclear.hitArea(at.x, at.z, MOTHER.cutRadius, 'mothership');
    // Roger (engine/heroMode.js), on foot or in a car.
    if (ctx.systems.heroMode) {
      ctx.systems.heroMode.hitArea(at.x, at.z, MOTHER.cutRadius, 'VAPORISED', 'The mothership\'s beam ran over Roger', 'mothershipBeam');
    }
    // A copy: a person killed here is spliced out of Sim.objects on the spot.
    for (const obj of Sim.objects.slice()) {
      if (obj.type !== 'car' && obj.type !== 'tree' && obj.type !== 'person') continue;
      const pos = obj.pooled ? obj.position : (obj.mesh && obj.mesh.position);
      if (!pos) continue;
      if (Math.hypot(pos.x - at.x, pos.z - at.z) > MOTHER.cutRadius) continue;
      if (obj.type === 'person') {
        ctx.systems.people.explodePerson(obj);
        continue;
      }
      scratch.set(pos.x, pos.y + 0.5, pos.z);
      damage.damageFromImpact(obj, scratch, MOTHER.impactEnergy);
    }
  }

  /**
   * Points the beam from the ground contact up to the belly.
   * @returns {void}
   */
  function placeBeam() {
    belly.copy(ship.group.position);
    belly.y += 1.2 * MOTHER.scale;
    const dir = scratch.subVectors(belly, contact);
    const length = dir.length();
    beam.position.copy(contact);
    beam.quaternion.setFromUnitVectors(UP, dir.divideScalar(length));
    beam.scale.set(1, length, 1);
    foot.position.set(contact.x, 0.06, contact.z);
    light.position.set(contact.x, 6, contact.z);
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateMothership(dt) {
    // The light comes and goes with it, whatever phase.
    const wantDim = ship && state.phase !== 'leaving' && state.phase !== 'falling' ? MOTHER.dim : 0;
    const dimStep = (MOTHER.dim / MOTHER.dimSeconds) * dt;
    state.dim = state.dim < wantDim ? Math.min(wantDim, state.dim + dimStep) : Math.max(wantDim, state.dim - dimStep);
    if (!ship || dt <= 0) return;

    const g = ship.group;
    if (state.phase === 'falling') {
      state.timer += dt;
      updateFall(dt);
      return;
    }
    // Smooth Criminal (engine/smoothCriminal.js): it hangs where it is with
    // its beam off, and takes up again where it left off.
    if (ctx.systems.smoothCriminal && ctx.systems.smoothCriminal.peace() && state.phase !== 'leaving') {
      if (beam) beam.visible = false;
      if (foot) foot.visible = false;
      state.held = true;
      return;
    }
    if (state.held) {
      state.held = false;
      if (state.phase === 'cutting' && beam) beam.visible = foot.visible = true;
    }
    state.timer += dt;
    g.rotation.y += dt * 0.05;
    // Hit: smoke and fire off the hull, more with each mega beam taken.
    if (state.damage > 0 && Math.random() < dt * 3 * state.damage) {
      const a = Math.random() * Math.PI * 2;
      const r = (0.4 + Math.random() * 0.55) * 15 * MOTHER.scale;
      scratch.set(g.position.x + Math.cos(a) * r, g.position.y + 3 * MOTHER.scale * Math.random(), g.position.z + Math.sin(a) * r);
      ctx.systems.explosions.spawnImpactBurst(scratch, 1.5 + Math.random() * 2);
    }
    const pulse = 1.2 + 0.4 * Math.sin(state.timer * 3);
    for (const mat of ship.glow) mat.color.copy(MOTHER.colour).multiplyScalar(pulse * 0.35);

    if (state.phase === 'arriving') {
      const u = Math.min(1, state.timer / MOTHER.arriveSeconds);
      g.position.y = THREE.MathUtils.lerp(MOTHER.arriveFrom, MOTHER.height, 1 - Math.pow(1 - u, 3));
      if (u >= 1) {
        state.phase = 'charging';
        state.timer = 0;
        contact.copy(start);
        ctx.systems.shockwaveSound.playShockwave();
      }
      return;
    }

    if (state.phase === 'charging') {
      // The beam comes down thin and flickering, then opens up.
      const u = Math.min(1, state.timer / MOTHER.chargeSeconds);
      beam.visible = true;
      foot.visible = true;
      placeBeam();
      beam.scale.x = beam.scale.z = 0.15 + 0.85 * u * u;
      beam.material.opacity = MOTHER.beamOpacity * (0.375 + 0.625 * u) * (0.75 + 0.25 * Math.random());
      light.intensity = MOTHER.lightPeak * u;
      ctx.systems.gamefeel.addShake(0.3 * u, 0.3);
      if (u >= 1) {
        state.phase = 'cutting';
        state.timer = 0;
        ctx.systems.lightning.flashScreen(scratch.copy(contact).setY(10), 0.8, '#c8ffd8');
        ctx.systems.gamefeel.event('tanker', contact);
        ctx.systems.damage.addDamageScore(MOTHER.score);
      }
      return;
    }

    if (state.phase === 'cutting') {
      state.beamClock += dt;
      state.passU = Math.min(1, state.passU + (MOTHER.sweepSpeed * dt) / state.passLength);
      const u = state.passU;
      contact.lerpVectors(start, end, u);
      // The ship drifts along over the beam, so it never leans far.
      const k = Math.min(1, dt * MOTHER.followRate);
      g.position.x += (contact.x - g.position.x) * k;
      g.position.z += (contact.z - g.position.z) * k;
      placeBeam();
      beam.material.opacity = MOTHER.beamOpacity * (0.8 + 0.2 * Math.random());
      light.intensity = MOTHER.lightPeak * (0.85 + 0.15 * Math.random());
      scorch.scale.x = Math.max(0.001, u * scorch.userData.length);
      ctx.systems.gamefeel.addShake(0.55, 0.2);
      cutAt(contact);
      state.dustTimer -= dt;
      if (state.dustTimer <= 0 && ctx.systems.earthquake) {
        state.dustTimer = 0.12;
        ctx.systems.earthquake.kickDust(contact.x, contact.z, 3, 3);
      }
      if (state.beamClock >= MOTHER.beamSeconds) {
        state.phase = 'leaving';
        state.timer = 0;
        beam.visible = false;
        foot.visible = false;
        light.intensity = 0;
      } else if (u >= 1) {
        nextPass();
      }
      return;
    }

    if (state.phase === 'leaving') {
      const u = Math.min(1, state.timer / MOTHER.leaveSeconds);
      g.position.y = MOTHER.height + (MOTHER.arriveFrom * 1.5 - MOTHER.height) * u * u;
      if (u >= 1) removeShip();
    }
  }

  /**
   * @returns {number} how much of the scene's light it is taking, 0..MOTHER.dim
   */
  function dimming() {
    return state.dim;
  }

  /**
   * @param {boolean} keepScorch whether the burnt strip stays (it does once
   *   the mothership has simply gone; a Reset clears it)
   * @returns {void}
   */
  function removeShip(keepScorch = true) {
    for (const mesh of [ship && ship.group, beam, foot, ...(keepScorch ? [] : scorches)]) {
      if (!mesh) continue;
      Sim.three.scene.remove(mesh);
      mesh.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    ship = null;
    beam = null;
    foot = null;
    if (!keepScorch) {
      scorch = null;
      scorches = [];
    }
    if (light) light.intensity = 0;
    state.phase = 'idle';
    state.timer = 0;
    state.damage = 0;
  }

  /** @returns {void} */
  function resetMothership() {
    removeShip(false);
    for (const strip of scorches) {
      Sim.three.scene.remove(strip);
      strip.geometry.dispose();
      strip.material.dispose();
    }
    scorches = [];
    scorch = null;
    state.dim = 0;
    struck.clear();
  }

  /** @returns {void} */
  function disposeMothership() {
    resetMothership();
    if (light) Sim.three.scene.remove(light);
    light = null;
  }

  return {
    initMothership, updateMothership, summon, dimming, shipTarget, musicWanted, resetMothership, disposeMothership
  };
}
