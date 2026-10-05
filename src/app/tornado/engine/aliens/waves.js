// @ts-check
import * as THREE from 'three';
import { PERSON_SCALE } from '../environment/people.js';
import { buildSaucer } from '../spaceship.js';
import { ALIEN_SKIN_GLOW, ALIENS } from './config.js';

/**
 * ===========================================================================
 * SECTION AK.6 — The second wave, the mutation and the hunters
 * ===========================================================================
 * The sombrero wave's transport ship, people turned into crew by the
 * nuclear plants' EMP, and the two hunter ships.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the aliens' shared state (see aliens.js)
 * @param {Object} api every aliens module's functions, by name
 * @returns {Object}
 */
export function createAlienWaves(ctx, S, api) {
  const { Sim } = ctx;

  /**
   * One of Roger's plasma shots on a hunter.
   * @param {Object} hunter
   * @param {number} points of hull it takes (heroMode.js SHIP_DAMAGE)
   * @param {THREE.Vector3} at
   * @returns {number} the share of the hull left (0 when it goes down), or
   *   -1 when there was nothing left to hit
   */
  function hitHunter(hunter, points, at) {
    // A downed or dead ship is ignored before any effect, so a late hit adds
    // no second explosion, cue or score.
    if (hunter.phase === 'downed' || hunter.phase === 'dead') return -1;
    const heavy = points > 1;
    hunter.hull = Math.max(0, hunter.hull - points);
    hunter.damage++;
    const downed = hunter.hull <= 0;
    if (points >= 1 || downed) {
      // A plasma hit, or the last one: the full burst and the large cue.
      ctx.systems.explosions.spawnImpactBurst(at, heavy ? 3 : 1.4);
      ctx.systems.cues.playLargeExplosion({ priority: true, gain: heavy ? 1 : 0.6 });
    } else {
      // A sub-point hit (a minigun round, a flame tick): a small spark on
      // every fourth, within the particle budget, and a quiet cue that the
      // spacing and voice cap may drop, so rapid fire cannot flood either.
      if (hunter.damage % 4 === 0 && ctx.systems.caps.particleRoom() > 0) ctx.systems.explosions.spawnImpactBurst(at, 0.4);
      ctx.systems.cues.playLargeExplosion({ gain: 0.25 });
    }
    if (downed) {
      hunter.phase = 'downed';
      hunter.timer = 0;
      api.stopTracker(hunter.tracker);
    }
    return hunter.hull / ALIENS.hunterHull;
  }

  /**
   * Whether the hunter ships are in the sky (on their way in or hunting),
   * for their music (sound/cues.js, drobeta.mp3).
   * @returns {boolean}
   */
  function huntersPresent() {
    return S.hunters.some(h => h.phase === 'arriving' || h.phase === 'hunting');
  }

  // ---------------------------------------------------------------------
  // The second wave
  // ---------------------------------------------------------------------

  /**
   * The transport comes down with the second wave aboard.
   * @returns {void}
   */
  function sendWave() {
    S.wave.sent = true;
    const spot = api.pickSpot();
    const a = Math.hypot(spot.x, spot.z) > 5 ? Math.atan2(-spot.z, -spot.x) : Math.random() * Math.PI * 2;
    const dirX = Math.cos(a);
    const dirZ = Math.sin(a);
    const saucer = buildSaucer();
    saucer.group.name = 'alien_transport';
    for (const leg of saucer.legs) leg.visible = false;
    for (const mat of saucer.glow) mat.color.copy(ALIENS.waveGlow);
    saucer.group.position.set(spot.x, ALIENS.arriveFrom, spot.z);
    Sim.three.scene.add(saucer.group);
    const ramp = api.buildRamp();
    ramp.position.set(dirX * ALIENS.hatchRadius, 1.2, dirZ * ALIENS.hatchRadius);
    ramp.rotation.y = -a;
    ramp.userData.tilt.scale.x = 0.001;
    saucer.group.add(ramp);
    const run = api.rampLength() * Math.cos(ALIENS.rampAngle);
    S.wave.top.set(spot.x + dirX * ALIENS.hatchRadius, ALIENS.hoverHeight + 1.2, spot.z + dirZ * ALIENS.hatchRadius);
    S.wave.foot.set(S.wave.top.x + dirX * run, 0, S.wave.top.z + dirZ * run);
    Object.assign(S.wave, {
      ship: saucer, ramp, phase: 'arriving', timer: 0, spawned: 0, exitTimer: 0, heading: Math.atan2(dirX, dirZ)
    });
    api.showBanner('SECOND WAVE', `${ALIENS.waveCount} more of them · in sombreros`);
  }

  /**
   * The second wave now, rather than at ALIENS.waveAt -- once per run. For a
   * panel button or a test; the clock calls sendWave itself.
   * @returns {void}
   */
  function sendSecondWave() {
    if (!S.wave.sent) sendWave();
  }

  /**
   * Per frame: the transport down, its ramp out, the crew off one at a time,
   * the ramp in, and away.
   * @param {number} dt
   * @returns {void}
   */
  function updateWave(dt) {
    if (!S.wave.ship) return;
    S.wave.timer += dt;
    const g = S.wave.ship.group;
    const tilt = S.wave.ramp.userData.tilt;
    if (S.wave.phase === 'arriving') {
      g.position.y = api.arrivalHeight(S.wave.timer);
      if (S.wave.timer >= ALIENS.arriveSeconds) Object.assign(S.wave, { phase: 'deploying', timer: 0 });
    } else if (S.wave.phase === 'deploying') {
      const u = Math.min(1, S.wave.timer / ALIENS.rampSeconds);
      tilt.scale.x = Math.max(0.001, u);
      if (u >= 1) Object.assign(S.wave, { phase: 'unloading', timer: 0 });
    } else if (S.wave.phase === 'unloading') {
      if (S.wave.spawned < ALIENS.waveCount) {
        S.wave.exitTimer -= dt;
        if (S.wave.exitTimer <= 0) {
          S.wave.exitTimer = ALIENS.exitEvery;
          const alien = api.buildAlien(true);
          Object.assign(alien, {
            wave: true, exitTop: S.wave.top.clone(), exitFoot: S.wave.foot.clone(), exitHeading: S.wave.heading
          });
          alien.root.position.copy(S.wave.top);
          Sim.three.scene.add(alien.root);
          S.aliens.push(alien);
          S.wave.spawned++;
        }
      } else if (!S.aliens.some(alien => alien.wave && alien.phase === 'exiting')) {
        Object.assign(S.wave, { phase: 'retracting', timer: 0 });
      }
    } else if (S.wave.phase === 'retracting') {
      const u = Math.min(1, S.wave.timer / ALIENS.rampSeconds);
      tilt.scale.x = Math.max(0.001, 1 - u);
      if (u >= 1) Object.assign(S.wave, { phase: 'leaving', timer: 0 });
    } else if (S.wave.phase === 'leaving') {
      const u = Math.min(1, S.wave.timer / ALIENS.waveLeaveSeconds);
      g.position.y = THREE.MathUtils.lerp(ALIENS.hoverHeight, ALIENS.arriveFrom * 1.5, u * u);
      if (u >= 1) removeWave();
    }
  }

  /**
   * The transport out of the scene, and its geometry, materials and belt
   * disposed.
   * @returns {void}
   */
  function removeWave() {
    if (!S.wave.ship) return;
    const geometries = new Set();
    const materials = new Set();
    S.wave.ship.group.traverse((/** @type {any} */ child) => {
      if (child.geometry) geometries.add(child.geometry);
      if (child.material) materials.add(child.material);
    });
    Sim.three.scene.remove(S.wave.ship.group);
    for (const geo of geometries) geo.dispose();
    for (const mat of materials) mat.dispose();
    if (S.wave.ramp && S.wave.ramp.userData.belt) S.wave.ramp.userData.belt.dispose();
    Object.assign(S.wave, { ship: null, ramp: null, phase: 'none', timer: 0 });
  }

  // ---------------------------------------------------------------------
  // Mutation (the nuclear plants' green EMP)
  // ---------------------------------------------------------------------

  /**
   * The green EMP has reached someone: they start turning into one of the
   * crew (see the header). Out of everyone else's hands the way an abductee
   * is -- the funnel, physics, their own walking, the other ships' sights.
   * @param {Object} person
   * @returns {boolean} whether it took them (false when they were already
   *   gone, taken, or not on their feet)
   */
  function mutate(person) {
    if (!S.alienGeo || !person.mesh || !person.mesh.parent || person.abducted || person.electrocuted || person.inChasm) return false;
    if (person.captureState !== 'grounded') return false;
    const p = person.mesh.position;
    const living = S.aliens.filter(a => a.phase !== 'dead' && a.phase !== 'burning').length;
    // Too many on their feet already: the ray only kills.
    if (living + S.mutants.length >= ALIENS.mutantMax) {
      api.fireRay(new THREE.Vector3(p.x, 50, p.z), new THREE.Vector3(p.x, 1, p.z), 'green', { style: 'ship' });
      ctx.systems.people.explodePerson(person);
      return true;
    }
    person.abducted = true;
    person.mutating = true;
    if (person.motion) {
      person.motion.active = false;
      person.motion.dropped = false;
    }
    const at = Sim.objects.indexOf(person);
    if (at !== -1) Sim.objects.splice(at, 1);
    /** @type {THREE.MeshStandardMaterial[]} */
    const materials = [];
    person.mesh.traverse((/** @type {any} */ child) => {
      const m = child.material;
      if (m && m.emissive && !materials.includes(m)) materials.push(m);
    });
    const alien = api.buildAlien(true);
    alien.phase = 'mutating';
    alien.wave = true;
    alien.mutant = true;
    alien.heading = person.mesh.rotation.y;
    alien.root.rotation.y = alien.heading;
    alien.root.position.set(p.x, 0, p.z);
    alien.root.scale.setScalar(0.001);
    Sim.three.scene.add(alien.root);
    S.aliens.push(alien);
    const halo = new THREE.Mesh(S.haloGeo, new THREE.MeshBasicMaterial({
      color: ALIENS.mutantColour, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    }));
    halo.frustumCulled = false;
    halo.position.set(p.x, 0, p.z);
    Sim.three.scene.add(halo);
    S.mutants.push({ person, alien, halo, materials, x: p.x, z: p.z, timer: 0 });
    if (ctx.systems.powerArcSound && S.mutants.length < 6) ctx.systems.powerArcSound.playZap(0.5);
    return true;
  }

  /**
   * Per frame: each of them a little further from a person and a little
   * nearer to one of the crew.
   * @param {number} dt
   * @returns {void}
   */
  function updateMutants(dt) {
    for (let i = 0; i < S.mutants.length; i++) {
      const m = S.mutants[i];
      m.timer += dt;
      const u = Math.min(1, m.timer / ALIENS.mutateSeconds);
      const person = m.person;
      // The bolt: a tall bright column coming down on them, then a glow
      // round them for the rest of it.
      const strike = Math.min(1, m.timer / ALIENS.mutateStrike);
      const height = strike < 1 ? 70 * (1 - strike) + 6 : 6 + 1.5 * Math.sin(m.timer * 12);
      const width = strike < 1 ? 0.8 + strike * 0.6 : 1.4 + 0.5 * u;
      m.halo.scale.set(width, height, width);
      m.halo.material.opacity = (strike < 1 ? 1 : 0.55 + 0.25 * Math.sin(m.timer * 20)) * (1 - Math.max(0, u - 0.85) / 0.15);
      // The person: glowing green, shaking, stretching up and thinning,
      // then shrinking away (gone by 90% of the way through).
      if (person.mesh.parent) {
        const glow = (0.5 + 0.5 * Math.sin(m.timer * 30)) * Math.min(1, m.timer * 2);
        for (const mat of m.materials) {
          mat.emissive.setRGB(0.1 * glow, 1.4 * glow + 0.3, 0.25 * glow);
          if (mat.color) mat.color.lerp(ALIENS.mutantColour, Math.min(1, dt * 1.5));
        }
        const stretch = 1 + 0.45 * Math.min(1, u / 0.6);
        const fade = u < 0.55 ? 1 : Math.max(0.001, 1 - (u - 0.55) / 0.35);
        person.mesh.scale.set(PERSON_SCALE * fade / Math.sqrt(stretch), PERSON_SCALE * stretch * fade, PERSON_SCALE * fade / Math.sqrt(stretch));
        person.mesh.position.set(m.x + (Math.random() - 0.5) * 0.25 * (1 - u), 0.15 * Math.sin(m.timer * 9), m.z + (Math.random() - 0.5) * 0.25 * (1 - u));
        person.mesh.rotation.y += dt * 4 * u;
        if (u >= 0.9) api.disposePerson(person);
      }
      // The alien growing up out of the same spot, overshooting a little.
      const g = u < 0.4 ? 0 : (u - 0.4) / 0.6;
      const pop = g <= 0 ? 0.001 : g * (1 + 0.25 * Math.sin(g * Math.PI));
      m.alien.root.scale.setScalar(ALIENS.scale * Math.max(0.001, pop));
      m.alien.skin.emissive.setRGB(0.05, 0.22 + 1.4 * (1 - g), 0.06);
      m.alien.root.rotation.y = m.alien.heading + (1 - g) * 6 * g;
      if (u < 1) continue;
      // Done: one of the crew, straight on the rampage.
      if (person.mesh.parent) api.disposePerson(person);
      Sim.three.scene.remove(m.halo);
      m.halo.material.dispose();
      m.alien.root.scale.setScalar(ALIENS.scale);
      m.alien.root.rotation.y = m.alien.heading;
      m.alien.skin.emissive.setHex(ALIEN_SKIN_GLOW);
      if (m.alien.phase === 'mutating') {
        m.alien.phase = 'patrol';
        m.alien.rayTimer = 0.8 + Math.random() * 2;
      }
      S.mutated++;
      S.mutants.splice(i--, 1);
    }
  }

  /** @returns {number} people turned into crew this run */
  function mutatedCount() {
    return S.mutated;
  }

  // ---------------------------------------------------------------------
  // The hunter ships
  // ---------------------------------------------------------------------

  /**
   * Hunter ships, spread round town: the first two at ALIENS.huntersAt, and
   * two more when the landing ship turns hunter (ship.js liftOff).
   * @param {number} [count]
   * @param {string} [title]
   * @param {string} [sub]
   * @returns {void}
   */
  function sendHunters(count = ALIENS.hunterCount, title = 'HUNTER SHIPS INBOUND', sub = 'Two more ships · they kill on sight') {
    if (count === ALIENS.hunterCount && title === 'HUNTER SHIPS INBOUND') S.state.huntersSent = true;
    const base = Math.random() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      // One tracking laser each, from the pool made in initAliens.
      const tracker = S.hunterTrackers.find((/** @type {Object} */ tr) => !S.hunters.some((/** @type {Object} */ h) => h.tracker === tr && h.phase !== 'dead'));
      if (!tracker) break;
      const a = base + (i / count) * Math.PI * 2;
      const saucer = buildSaucer();
      saucer.group.name = 'alien_hunter';
      for (const leg of saucer.legs) leg.visible = false;
      for (const mat of saucer.glow) mat.color.copy(ALIENS.hunterGlow);
      saucer.group.scale.setScalar(ALIENS.hunterScale);
      const x = Math.cos(a) * 75;
      const z = Math.sin(a) * 75;
      saucer.group.position.set(x, ALIENS.hunterArriveFrom, z);
      Sim.three.scene.add(saucer.group);
      S.hunters.push({
        group: saucer.group, glow: saucer.glow, phase: 'arriving', timer: 0,
        hull: ALIENS.hunterHull, damage: 0, target: null, retarget: 0,
        shotTimer: api.between(ALIENS.hunterShotEvery), tracker, spin: 0
      });
      tracker.cooldown = api.between(ALIENS.laserEvery);
    }
    api.showBanner(title, sub);
  }

  /**
   * The person nearest a point, on their feet.
   * @param {number} x
   * @param {number} z
   * @returns {Object|null}
   */
  function nearestPerson(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const person of ctx.Environment.people) {
      if (!person.mesh.parent || person.abducted || person.inChasm || person.captureState !== 'grounded') continue;
      const d = (person.mesh.position.x - x) ** 2 + (person.mesh.position.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = person;
      }
    }
    return best;
  }

  /**
   * @param {Object} h a hunter
   * @param {number} dt
   * @returns {void}
   */
  function updateHunter(h, dt) {
    const g = h.group;
    h.timer += dt;
    // A solar storm (engine/solarStorm.js): its systems stutter -- lights
    // flickering, the hull sagging and rocking; over half, it holds its fire.
    const jam = h.phase === 'hunting' && ctx.systems.solarStorm ? ctx.systems.solarStorm.jamAt(g.position.x, g.position.z) : 0;
    h.jam = jam;
    const glow = (1.4 + 0.6 * Math.sin(h.timer * 6)) * (1 - jam * (Math.random() < 0.55 ? 0.92 : 0.2));
    for (const mat of h.glow) mat.color.copy(ALIENS.hunterGlow).multiplyScalar(glow / 2);
    if (h.phase === 'arriving') {
      const u = Math.min(1, h.timer / ALIENS.hunterArriveSeconds);
      g.position.y = THREE.MathUtils.lerp(ALIENS.hunterArriveFrom, ALIENS.hunterHeight, 1 - Math.pow(1 - u, 3));
      if (u >= 1) {
        h.phase = 'hunting';
        h.timer = 0;
      }
      return;
    }
    if (h.phase === 'downed') {
      g.position.y = Math.max(0, g.position.y - (5 + h.timer * 20) * dt);
      h.spin += dt * (3 + h.timer * 4);
      g.rotation.set(0.4 * h.timer, h.spin, 0.5);
      if (Math.random() < dt * 10) {
        ctx.systems.explosions.spawnImpactBurst(S.scratch.copy(g.position).add(new THREE.Vector3((Math.random() - 0.5) * 8, 2, (Math.random() - 0.5) * 8)), 0.9);
      }
      if (g.position.y <= 0.5) {
        api.crashAt(g.position, 0.7, ALIENS.crashScore);
        ctx.events.emit('announce', { title: 'HUNTER DESTROYED', sub: `Shot down · +${ALIENS.crashScore}` });
        removeHunter(h);
      }
      return;
    }
    if (h.phase !== 'hunting') return;
    // Held up by a gravity rift (engine/gravityRift.js): it moves it.
    if (ctx.systems.enemies.getState(h, 'frozen')) {
      api.updateTracker(h.tracker, S.trackerFrom.set(g.position.x, g.position.y + 0.4, g.position.z), false, dt);
      return;
    }
    // Smoke off it once it has been holed.
    if (h.damage > 0 && Math.random() < dt * 4) {
      ctx.systems.explosions.spawnImpactBurst(S.scratch.copy(g.position).add(new THREE.Vector3((Math.random() - 0.5) * 7, 2.5, (Math.random() - 0.5) * 7)), 0.7);
    }
    // Smooth Criminal: hanging where it is, holding its fire. Jammed by a
    // solar storm, the same, sagging and rocking.
    if (S.frame.peace || jam > 0.5) {
      g.position.y = ALIENS.hunterHeight + 0.6 * Math.sin(h.timer * 1.7) - jam * 4;
      h.spin += dt * 0.8 * (1 - jam * 0.8);
      g.rotation.set(jam * 0.16 * Math.sin(h.timer * 9.1), h.spin, jam * 0.14 * Math.sin(h.timer * 7.3));
      api.updateTracker(h.tracker, S.trackerFrom.set(g.position.x, g.position.y + 0.4, g.position.z), false, dt);
      return;
    }
    // A nuclear plant still standing comes first (engine/nuclear.js).
    const nuclear = ctx.systems.nuclear;
    const plant = nuclear ? nuclear.nearestIntact(g.position.x, g.position.z) : null;
    if (plant) {
      attackPlant(h, plant, nuclear, dt);
      api.updateTracker(h.tracker, S.trackerFrom.set(g.position.x, g.position.y + 0.4, g.position.z), true, dt);
      return;
    }
    h.retarget -= dt;
    if (h.retarget <= 0 || !h.target || !h.target.mesh.parent || h.target.abducted) {
      h.retarget = 2;
      h.target = nearestPerson(g.position.x, g.position.z);
    }
    g.position.y = ALIENS.hunterHeight + 0.6 * Math.sin(h.timer * 1.7) - jam * 4;
    h.spin += dt * 0.8;
    g.rotation.set(jam * 0.16 * Math.sin(h.timer * 9.1), h.spin, jam * 0.14 * Math.sin(h.timer * 7.3));
    const t = h.target;
    if (t) {
      const q = t.mesh.position;
      const dx = q.x - g.position.x;
      const dz = q.z - g.position.z;
      const d = Math.hypot(dx, dz);
      if (d > ALIENS.hunterHover) {
        const step = Math.min(d - ALIENS.hunterHover, ALIENS.hunterSpeed * dt);
        g.position.x += (dx / d) * step;
        g.position.z += (dz / d) * step;
        g.rotation.z = -0.12 * (dx / d);
        g.rotation.x = 0.12 * (dz / d);
      }
      h.shotTimer -= dt;
      if (h.shotTimer <= 0 && d < ALIENS.hunterShootRange) {
        h.shotTimer = api.between(ALIENS.hunterShotEvery);
        const from = S.scratch.copy(g.position);
        from.y += 0.4;
        api.fireRay(from.clone(), new THREE.Vector3(q.x, 1.5, q.z), 'red');
        ctx.systems.people.explodePerson(t);
        ctx.systems.damage.addDamageScore(20);
        h.target = null;
      }
    }
    const belly = S.trackerFrom.set(g.position.x, g.position.y + 0.4, g.position.z);
    api.updateTracker(h.tracker, belly, true, dt);
  }

  /**
   * A hunter going for a nuclear plant: in to its stand-off, hanging there,
   * and a red ray into it every few seconds.
   * @param {Object} h
   * @param {{x: number, z: number, aim: THREE.Vector3}} plant
   * @param {Object} nuclear the nuclear.js system
   * @param {number} dt
   * @returns {void}
   */
  function attackPlant(h, plant, nuclear, dt) {
    const g = h.group;
    g.position.y = ALIENS.hunterHeight + 0.6 * Math.sin(h.timer * 1.7) - (h.jam || 0) * 4;
    h.spin += dt * 0.8;
    g.rotation.y = h.spin;
    const dx = plant.x - g.position.x;
    const dz = plant.z - g.position.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d > ALIENS.plantStandOff) {
      const step = Math.min(d - ALIENS.plantStandOff, ALIENS.hunterSpeed * dt);
      g.position.x += (dx / d) * step;
      g.position.z += (dz / d) * step;
      g.rotation.z = -0.12 * (dx / d);
      g.rotation.x = 0.12 * (dz / d);
    }
    h.plantTimer = (h.plantTimer === undefined ? api.between(ALIENS.plantShotEvery) : h.plantTimer) - dt;
    if (h.plantTimer <= 0 && d < ALIENS.plantShootRange) {
      h.plantTimer = api.between(ALIENS.plantShotEvery);
      api.fireRay(new THREE.Vector3(g.position.x, g.position.y + 0.4, g.position.z), plant.aim.clone(), 'red');
      nuclear.shipHit(plant, plant.aim);
    }
  }

  /**
   * @param {Object} h
   * @returns {void}
   */
  function removeHunter(h) {
    h.phase = 'dead';
    api.stopTracker(h.tracker);
    const geometries = new Set();
    const materials = new Set();
    h.group.traverse((/** @type {any} */ child) => {
      if (child.geometry) geometries.add(child.geometry);
      if (child.material) materials.add(child.material);
    });
    Sim.three.scene.remove(h.group);
    for (const geo of geometries) geo.dispose();
    for (const mat of materials) mat.dispose();
  }

  return { hitHunter, huntersPresent, sendWave, sendSecondWave, updateWave, removeWave, mutate, updateMutants, mutatedCount, sendHunters, nearestPerson, updateHunter, attackPlant, removeHunter };
}
