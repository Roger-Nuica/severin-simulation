// @ts-check
import * as THREE from 'three';
import { ALIENS } from '../aliens/config.js';
import { buildAlienRamp, alienRampLength } from '../aliens/models.js';
import { SHIP, SUPPORT, buildSaucer } from './config.js';
import { SAMURAI } from './samuraiModel.js';

/**
 * ===========================================================================
 * SECTION SS.1 — The samurai ship
 * ===========================================================================
 * Samurai Support's call-in (R in targeting mode): a ship comes down on the
 * marker and lets the squad out (spaceship/samurai.js). No piloting, and
 * Roger keeps control throughout; the camera glides over to the drop zone
 * for the landing (camera.js glideWith, the same 1 s glide a new
 * character's arrival gets), holds there, and glides back.
 *
 *  - **The drop**: the scripted descent the old landing had -- the height
 *    a single function of time (altitudeAt), near-linear and then a
 *    quartic ease-out, joined so the speed is continuous, SHIP.duration
 *    seconds from the call; the retro-thrusters lighting up, the dust
 *    kicked off the streets as it gets low, the shake climbing. It comes
 *    down to the aliens' hover height (ALIENS.hoverHeight) rather than the
 *    ground, and arrives with a burst of dust and two shock rings -- it is
 *    ours, so nothing under it is hurt.
 *  - **The ramp** runs out towards the camera, the aliens' own ramp
 *    (aliens/models.js buildAlienRamp) in gold, over ALIENS.rampSeconds;
 *    the squad comes down it one every ALIENS.exitEvery seconds.
 *  - **The leaving**: once the last is down the ramp, it folds away and the
 *    ship lifts off and is gone (removeShip); it does not wait for the
 *    squad, which stays on the ground (spaceship/samurai.js) until the area
 *    has been clear for SUPPORT.clearGrace seconds or SUPPORT.stay runs out.
 *    SUPPORT.cooldown starts once the squad has ended AND the ship has gone
 *    (finishSupport), so a second call can never overlap a living squad.
 * One squad at a time.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see spaceship.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createSpaceshipDescent(ctx, S, api) {
  const { Sim } = ctx;

  /**
   * The tallest thing standing in town, measured rather than read off the
   * building variants, so a town the storm has already levelled gives a
   * lower figure than a fresh one.
   * @returns {number}
   */
  function tallestBuilding() {
    let tallest = 0;
    const box = new THREE.Box3();
    if (ctx.Environment) {
      for (const building of ctx.Environment.buildings) {
        if (!building.mesh || building.damageState === 'collapsed') continue;
        box.setFromObject(building.mesh);
        if (!box.isEmpty()) tallest = Math.max(tallest, box.max.y);
      }
    }
    return tallest || 22;
  }

  /**
   * The call: a ship on its way down to (x, z).
   * @param {number} x
   * @param {number} z
   * @returns {boolean} whether it was called
   */
  function callSamurai(x, z) {
    if (S.state.phase !== 'idle' || S.state.squad || !S.group) return false;
    S.state.squad = true;
    S.drop.set(x, 0, z);
    S.landing.copy(S.drop);
    // The ramp runs out towards the camera, so the squad comes down it in
    // view; the ship comes in from behind the camera along the same line.
    const camera = Sim.three.camera;
    S.dir.set(camera.position.x - x, 0, camera.position.z - z);
    if (S.dir.lengthSq() < 1) S.dir.set(0, 0, 1);
    S.dir.normalize();
    S.heading.copy(S.dir).negate();

    const hover = ALIENS.hoverHeight;
    S.state.startY = THREE.MathUtils.clamp(tallestBuilding() * SHIP.startMultiple, SHIP.startHeight[0], SHIP.startHeight[1]);
    // Where the linear phase hands over to the ease-out, chosen so the speed
    // is the same either side of the join (see altitudeAt). Heights here are
    // above the hover, which is where the drop ends.
    const span = S.state.startY - hover;
    const a = SHIP.linearShare;
    const exitRate = (a + 2 * (1 - a)) / SHIP.brakeAt;       // of the phase-one drop, per second
    const easeRate = 4 / (SHIP.duration - SHIP.brakeAt);      // quartic ease-out's initial slope
    S.state.brakeY = span * exitRate / (exitRate + easeRate);

    S.ship = buildShip();
    S.group.add(S.ship.group);
    const rampAngle = Math.atan2(S.dir.z, S.dir.x);
    S.ramp = buildAlienRamp({ glow: SHIP.rim, seam: '#ffcf5a', emissive: 0xff8a2c });
    S.ramp.position.set(S.dir.x * ALIENS.hatchRadius, 1.2, S.dir.z * ALIENS.hatchRadius);
    S.ramp.rotation.y = -rampAngle;
    S.ramp.userData.tilt.scale.x = 0.001;
    S.ship.group.add(S.ramp);
    const run = alienRampLength() * Math.cos(ALIENS.rampAngle);
    S.rampTop.set(x + S.dir.x * ALIENS.hatchRadius, hover + 1.2, z + S.dir.z * ALIENS.hatchRadius);
    S.rampFoot.set(S.rampTop.x + S.dir.x * run, 0, S.rampTop.z + S.dir.z * run);

    S.state.phase = 'descending';
    S.state.t = 0;
    S.state.timer = 0;
    S.state.spawned = 0;
    S.state.exitTimer = 0;
    S.state.stay = SUPPORT.stay;
    S.state.clearFor = 0;
    placeShip();

    // The camera over to the drop zone for the landing, and back.
    const bearing = Math.atan2(camera.position.x - x, camera.position.z - z);
    ctx.systems.camera.glideWith((position, target) => {
      position.set(x + Math.sin(bearing) * 78, 40, z + Math.cos(bearing) * 78);
      target.set(x, 10, z);
    }, { always: true, hold: SUPPORT.watchHold });
    api.showBanner('SAMURAI SUPPORT', `Inbound · ${SAMURAI.count} samurai · guarding ${SUPPORT.coverage} m`);
    return true;
  }

  /**
   * The saucer in black lacquer and gold, glowing crimson underneath, its
   * legs kept in (it hangs, like the aliens' ship).
   * @returns {import('./config.js').Ship}
   */
  function buildShip() {
    const ship = buildSaucer();
    ship.group.name = 'samurai_ship';
    for (const leg of ship.legs) leg.visible = false;
    ship.group.traverse((/** @type {any} */ child) => {
      if (child.name === 'spaceship_hull') child.material.color.setHex(SHIP.hull);
    });
    for (const mat of ship.glow) mat.color.copy(SHIP.glow);
    ship.rim.color.copy(SHIP.rim);
    return ship;
  }

  /**
   * The ship's height above the hover at a given time into the drop: a pure
   * function of time, not an integration, which pins its arrival to exactly
   * SHIP.duration. Phase one (0..brakeAt) a mostly-linear fall, phase two
   * a quartic ease-out to the hover, joined with no kink (callSamurai).
   * @param {number} t
   * @returns {number}
   */
  function altitudeAt(t) {
    const span = S.state.startY - ALIENS.hoverHeight;
    const brakeY = S.state.brakeY;
    if (t < SHIP.brakeAt) {
      const u = t / SHIP.brakeAt;
      const a = SHIP.linearShare;
      return span - (span - brakeY) * (a * u + (1 - a) * u * u);
    }
    const u = Math.min(1, (t - SHIP.brakeAt) / (SHIP.duration - SHIP.brakeAt));
    return brakeY * Math.pow(1 - u, 4);
  }

  /**
   * How hard the retro-thrusters are firing: a pre-burn flicker through the
   * last half second of the fall, full burn by the middle of the ease-out.
   * @param {number} t
   * @returns {number} 0..1
   */
  function brakeAt(t) {
    return 0.45 * THREE.MathUtils.smoothstep(t, SHIP.brakeAt - 0.5, SHIP.brakeAt)
      + 0.55 * THREE.MathUtils.smoothstep(t, SHIP.brakeAt, SHIP.brakeAt + 1.1);
  }

  /**
   * Places the ship for the current time of the drop: the run-in closing
   * at the same rate as the height.
   * @returns {void}
   */
  function placeShip() {
    const above = altitudeAt(S.state.t);
    const run = SHIP.drift * (above / Math.max(1, S.state.startY - ALIENS.hoverHeight));
    S.ship.group.position.set(S.drop.x - S.heading.x * run, ALIENS.hoverHeight + above, S.drop.z - S.heading.z * run);
  }

  /**
   * One frame of the drop.
   * @param {number} dt
   * @returns {void}
   */
  function updateDescent(dt) {
    const before = S.ship.group.position.y;
    S.state.t = Math.min(SHIP.duration, S.state.t + dt);
    placeShip();
    const y = S.ship.group.position.y;
    const fallSpeed = dt > 0 ? (before - y) / dt : 0;
    const brake = brakeAt(S.state.t);
    const progress = S.state.t / SHIP.duration;
    setGlow(0.6 + 2.2 * brake);
    if (dt > 0) api.emitThrust(dt, brake, fallSpeed);
    if (S.light) {
      S.light.position.set(S.ship.group.position.x, y - 1, S.ship.group.position.z);
      S.light.intensity = SHIP.lightPeak * (0.12 + 0.88 * brake);
    }
    // Ground wash: the burn kicking dust off the streets once it is close.
    if (dt > 0 && y < 60 && ctx.systems.earthquake && Math.random() < dt * 14 * brake) {
      const a = Math.random() * Math.PI * 2;
      const r = SHIP.radius * (0.7 + Math.random() * 0.8);
      ctx.systems.earthquake.kickDust(S.drop.x + Math.cos(a) * r, S.drop.z + Math.sin(a) * r, 1, 1.2 + (1 - y / 60));
    }
    if (dt > 0) ctx.systems.gamefeel.addShake(0.25 * brake, 0.14);
    ctx.systems.spaceshipSound.updateSpaceshipSound(THREE.MathUtils.smoothstep(S.state.t, 0, 0.5), progress, brake);
    if (S.state.t >= SHIP.duration) arrive();
  }

  /**
   * The ship hanging over the drop point: dust out across the streets, two
   * shock rings, a jolt -- and nothing under it hurt.
   * @returns {void}
   */
  function arrive() {
    const at = S.drop;
    ctx.systems.gamefeel.addShake(SHIP.arrivalShake, 0.5);
    ctx.systems.spaceshipSound.playLandingImpact();
    api.spawnShockRing(at, SHIP.radius, 110, 0.75, 2, SHIP.glow);
    api.spawnShockRing(at, SHIP.radius, 70, 1.1, 1.1, SHIP.rim);
    if (ctx.systems.earthquake) {
      const quake = ctx.systems.earthquake;
      quake.kickDust(at.x, at.z, 6, 2.6);
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        quake.kickDust(at.x + Math.cos(a) * SHIP.radius * 1.3, at.z + Math.sin(a) * SHIP.radius * 1.3, 1, 2);
      }
    }
    S.state.phase = 'deploying';
    S.state.timer = 0;
  }

  /**
   * @param {number} level how hard the underside is glowing
   * @returns {void}
   */
  function setGlow(level) {
    for (const mat of S.ship.glow) mat.color.copy(SHIP.glow).multiplyScalar(level / 2);
  }

  /**
   * Per frame, on the world's time (the samurai slow with it).
   * @param {number} dt
   * @returns {void}
   */
  function updateShip(dt) {
    const phase = S.state.phase;
    if (phase === 'idle' || !S.ship) return;
    if (phase === 'descending') {
      updateDescent(dt);
      return;
    }
    S.state.timer += dt;
    S.state.time += dt;
    const g = S.ship.group;
    if (phase === 'leaving') {
      const u = Math.min(1, S.state.timer / SHIP.leaveSeconds);
      g.position.y = ALIENS.hoverHeight + SHIP.leaveHeight * u * u;
      setGlow(1.4 + 1.2 * (1 - u));
      if (dt > 0) api.emitThrust(dt, 0.6 * (1 - u), -SHIP.leaveHeight * 2 * u / SHIP.leaveSeconds);
      ctx.systems.spaceshipSound.updateSpaceshipSound(1 - u, 0.5, 0.6 * (1 - u));
      if (S.light) S.light.intensity = SHIP.lightPeak * 0.3 * (1 - u);
      if (u >= 1) depart();
      return;
    }
    // Hanging there: a slow bob, the glow breathing, the thruster sound
    // dying away after the arrival.
    g.position.y = ALIENS.hoverHeight + 0.35 * Math.sin(S.state.time * 1.3);
    setGlow(1.4 + 0.4 * Math.sin(S.state.time * 4));
    if (S.light) {
      S.light.position.set(S.drop.x, g.position.y - 2, S.drop.z);
      S.light.intensity = THREE.MathUtils.lerp(S.light.intensity, 60, Math.min(1, dt * 2));
    }
    ctx.systems.spaceshipSound.updateSpaceshipSound(Math.max(0, 1 - S.state.timer / 2) * 0.6, 1, 0);
    const belt = S.ramp && S.ramp.userData.belt;
    if (phase === 'deploying') {
      const u = Math.min(1, S.state.timer / ALIENS.rampSeconds);
      S.ramp.userData.tilt.scale.x = Math.max(0.001, u);
      if (u >= 1) {
        S.state.phase = 'unloading';
        S.state.timer = 0;
        S.state.exitTimer = 0;
      }
    } else if (phase === 'unloading') {
      // Down the ramp one at a time, as the aliens come off theirs.
      S.state.exitTimer -= dt;
      if (S.state.exitTimer <= 0 && S.state.spawned < SAMURAI.count) {
        S.state.exitTimer = ALIENS.exitEvery;
        api.spawnUnit(S.state.spawned++);
      }
      if (S.state.spawned >= SAMURAI.count && S.state.timer > SAMURAI.count * ALIENS.exitEvery + api.rampSeconds()) {
        // The ramp is empty: the squad is on the ground and on its own
        // clock from here (api.beginGuard); the ship does not wait for it.
        api.beginGuard();
        S.state.phase = 'retracting';
        S.state.timer = 0;
      }
    } else if (phase === 'retracting') {
      const u = Math.min(1, S.state.timer / ALIENS.rampSeconds);
      S.ramp.userData.tilt.scale.x = Math.max(0.001, 1 - u);
      if (u >= 1) {
        S.state.phase = 'leaving';
        S.state.timer = 0;
      }
    }
    // The belt runs down the ramp, the way they came out.
    if (belt && dt > 0) {
      belt.offset.x = (belt.offset.x - (alienRampLength() / ALIENS.climbSeconds / ALIENS.beltStripe) * dt + 1) % 1;
    }
  }

  /**
   * The ship gone (the squad stays on the ground): the cooldown starts once
   * the squad has ended as well.
   * @returns {void}
   */
  function depart() {
    removeShip();
    S.state.phase = 'idle';
    ctx.systems.spaceshipSound.fadeOutSpaceshipSound();
    finishSupport();
  }

  /**
   * Starts the samurai cooldown once, and only when both the ship has gone
   * and the squad has ended; called by whichever of the two ends last.
   * @returns {void}
   */
  function finishSupport() {
    if (S.state.phase === 'idle' && !S.state.squad) S.cooldown.samurai = SUPPORT.cooldown;
  }

  /** @returns {void} */
  function removeShip() {
    if (!S.ship) return;
    if (S.ramp && S.ramp.userData.belt) S.ramp.userData.belt.dispose();
    api.disposeShip(S.ship);
    S.ship = null;
    S.ramp = null;
    if (S.light) S.light.intensity = 0;
  }

  return { tallestBuilding, callSamurai, altitudeAt, brakeAt, placeShip, updateShip, removeShip, finishSupport };
}
