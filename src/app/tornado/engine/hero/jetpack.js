// @ts-check
import * as THREE from 'three';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from '../particlePool.js';
import { createSoftDotTexture } from '../../utils/textures.js';

/**
 * ===========================================================================
 * SECTION HM.9 — The jump and the jetpack (Space)
 * ===========================================================================
 * Roger leaves the ground for the first time (BACKLOG.md "Jetpack / double
 * jump", on request):
 *
 *  - **Space on the ground**: a plain jump, about a metre, free.
 *  - **Space again in the air**: the jetpack on his back fires for
 *    JETPACK.burnSeconds -- climbing at up to JETPACK.climbSpeed and driving
 *    him ahead (the way he faces on foot, the way he looks or walks in first
 *    person) at up to JETPACK.flySpeed -- with two flames under the nozzles,
 *    smoke and a roar (sound/grappleJet.js). Once a flight, for one energy
 *    segment (engine/player/abilities.js, its HUD slot "Space JETPACK") and a
 *    cooldown. It burns out and he comes down under gravity, carried on by
 *    the speed he has, steering a little.
 *
 * About twenty metres up at the top: over the houses, the shops and the
 * townhouses, and onto a roof if he comes down over one. A roof is ground
 * (groundAt): he stands and walks on it, and walks off the edge and falls.
 * The walls he cannot clear still stop him (movement.js pushOut with his
 * height). A building that collapses under him drops him with it. Nothing
 * hurts him on landing: he is a hero.
 *
 * The state is S.state.alt (his feet's height), vy, airborne, jetBurn and
 * jetUsed (the one burn per flight), airVx / airVz (his speed over the
 * ground while airborne). Real time, like the rest of him (Time Slow does not
 * slow him). The flames and the pack are parts of Roger's own mesh (gone with
 * it at the end of the run); the smoke is one pooled Points (particlePool.js),
 * tracked against the shared particle cap and made once.
 */

export const JETPACK = {
  key: 'Space',
  jumpSpeed: 6.2,       // m/s up, the plain jump (about a metre)
  gravity: 18,          // m/s^2, a game's gravity rather than 9.8: snappier
  maxFall: 32,          // m/s, terminal
  cost: 1,              // energy segments (10%)
  cooldown: 3,          // seconds, after the burn
  burnSeconds: 1.5,     // how long it fires
  climbSpeed: 13,       // m/s up at full thrust
  lift: 42,             // m/s^2 towards climbSpeed
  flySpeed: 15,         // m/s ahead while it burns
  thrust: 22,           // m/s^2 towards flySpeed
  airControl: 5,        // m/s^2 of steering once it has burned out
  stepUp: 0.35,         // a ledge this high is stepped onto (and a roof is landed on from this far below its top)
  landShake: 0.45,      // a hard landing's camera shake, at most
  smokeMax: 320,        // particles in the smoke pool
  smokeRate: 110        // particles a second per nozzle while it burns
};

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see heroMode.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createHeroJetpack(ctx, S, api) {
  const { Sim } = ctx;
  /** @type {import('../particlePool.js').ParticlePool|null} */
  let smoke = null;
  let smokeAlive = false;
  /** The flames and the pack on the current Roger (rebuilt each run). */
  /** @type {{pack: THREE.Group, flames: THREE.Mesh[], cores: THREE.Mesh[]}|null} */
  let rig = null;
  const nozzle = new THREE.Vector3();
  let roaring = false;
  let flicker = 0;

  /** @returns {any} */
  function sound() {
    return ctx.systems.grappleJetSound;
  }

  /**
   * The ground under (x, z) for feet at `alt`: the highest standing top
   * (a roof) whose box covers the point and that he is no more than
   * JETPACK.stepUp below, else the street (0).
   * @param {number} x
   * @param {number} z
   * @param {number} alt
   * @returns {number}
   */
  function groundAt(x, z, alt) {
    let ground = 0;
    api.someSolid((/** @type {number} */ cx, /** @type {number} */ cz, /** @type {number} */ hw, /** @type {number} */ hd, /** @type {number} */ top) => {
      if (top > ground && top <= alt + JETPACK.stepUp && Math.abs(x - cx) < hw && Math.abs(z - cz) < hd) ground = top;
      return false;
    });
    return ground;
  }

  /**
   * Space pressed, with Roger on his feet: a jump from the ground, the
   * jetpack in the air (through the abilities, for its cost and cooldown).
   * @returns {void}
   */
  function pressJump() {
    const st = S.state;
    if (st.phase !== 'running' && st.phase !== 'aiming') return;
    if (st.zipActive) return;
    if (!st.airborne) {
      st.vy = JETPACK.jumpSpeed;
      st.airborne = true;
      st.jetUsed = false;
      // Off the ground with the speed he has.
      if (st.phase === 'running') {
        st.airVx = Math.sin(st.heading) * st.speed;
        st.airVz = Math.cos(st.heading) * st.speed;
      } else {
        st.airVx = st.aimVx || 0;
        st.airVz = st.aimVz || 0;
      }
      const sfx = sound();
      if (sfx) sfx.playJump();
      return;
    }
    ctx.systems.abilities.press(JETPACK.key);
  }

  /**
   * The jetpack lit (the ability's start).
   * @returns {void}
   */
  function ignite() {
    const st = S.state;
    st.jetBurn = JETPACK.burnSeconds;
    st.jetUsed = true;
    if (st.vy < 0) st.vy *= 0.3;
    const sfx = sound();
    if (sfx) {
      sfx.startJet();
      roaring = true;
    }
    ctx.systems.gamefeel.addShake(0.25, 0.25);
    ctx.events.emit('notice', { text: '🚀 JETPACK' });
  }

  /**
   * Out of fuel, cut off (a daze, a car, death) or the run over.
   * @returns {void}
   */
  function cutOut() {
    S.state.jetBurn = 0;
    if (roaring) {
      const sfx = sound();
      if (sfx) sfx.stopJet();
      roaring = false;
    }
  }

  /**
   * Everything in the air forgotten: on the ground at (his) street level.
   * For a new run, a car, a teleport.
   * @param {number} [ground]
   * @returns {void}
   */
  function landNow(ground = 0) {
    const st = S.state;
    cutOut();
    st.alt = ground;
    st.vy = 0;
    st.airborne = false;
    st.jetUsed = false;
    st.airVx = st.airVz = 0;
  }

  /**
   * His speed over the ground in the air, a step this frame: the wish is
   * what the keys ask for (as on the ground), or straight ahead at
   * JETPACK.flySpeed while the pack burns. Moves `p`.
   * @param {THREE.Vector3} p
   * @param {number} dt
   * @param {number} wishX
   * @param {number} wishZ
   * @param {boolean} steering whether any key asks for anything
   * @returns {void}
   */
  function airMove(p, dt, wishX, wishZ, steering) {
    const st = S.state;
    const burning = st.jetBurn > 0;
    let wx = wishX;
    let wz = wishZ;
    if (burning) {
      // Ahead at full speed: where the keys point, else where he faces.
      const len = Math.hypot(wishX, wishZ);
      const fx = len > 1e-3 ? wishX / len : Math.sin(st.heading);
      const fz = len > 1e-3 ? wishZ / len : Math.cos(st.heading);
      wx = fx * JETPACK.flySpeed;
      wz = fz * JETPACK.flySpeed;
    }
    if (burning || steering) {
      const accel = (burning ? JETPACK.thrust : JETPACK.airControl) * dt;
      const dx = wx - st.airVx;
      const dz = wz - st.airVz;
      const d = Math.hypot(dx, dz);
      if (d <= accel) {
        st.airVx = wx;
        st.airVz = wz;
      } else {
        st.airVx += (dx / d) * accel;
        st.airVz += (dz / d) * accel;
      }
    }
    p.x += st.airVx * dt;
    p.z += st.airVz * dt;
    st.speed = Math.hypot(st.airVx, st.airVz);
  }

  /**
   * Up and down, a step this frame: the burn's lift or gravity, a roof or
   * the street to land on. Runs in every phase on his feet (a daze, a freeze
   * and a co-op knock-down still fall).
   * @param {number} dt
   * @returns {void}
   */
  function stepAir(dt) {
    const st = S.state;
    const p = S.roger.mesh.position;
    if (st.jetBurn > 0) {
      st.jetBurn = Math.max(0, st.jetBurn - dt);
      st.vy = Math.min(JETPACK.climbSpeed, st.vy + JETPACK.lift * dt);
      if (st.jetBurn <= 0) cutOut();
    } else if (st.airborne) {
      st.vy = Math.max(-JETPACK.maxFall, st.vy - JETPACK.gravity * dt);
    }
    const ground = groundAt(p.x, p.z, st.alt);
    if (!st.airborne) {
      // Walked off a roof (or it fell in under him): falling.
      if (st.alt > ground + 0.05) {
        st.airborne = true;
        st.vy = 0;
        st.jetUsed = false;
        st.airVx = Math.sin(st.heading) * Math.max(0, st.speed);
        st.airVz = Math.cos(st.heading) * Math.max(0, st.speed);
      } else {
        st.alt = ground;
        return;
      }
    }
    st.alt += st.vy * dt;
    if (st.alt <= ground && st.vy <= 0) {
      const impact = -st.vy;
      landNow(ground);
      // Carry a little of the speed into the run, so landing is not a stop.
      st.speed = Math.min(st.speed, 9);
      if (impact > 9) ctx.systems.gamefeel.addShake(Math.min(JETPACK.landShake, impact / 60), 0.3);
      const sfx = sound();
      if (sfx) sfx.playLand(Math.min(1, impact / 25));
      if (impact > 9) puff(p.x, ground, p.z, 14);
    }
  }

  /**
   * Smoke from (x, y, z): `n` puffs, within the shared particle cap.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} n
   * @param {number} [vy] how fast they leave, downwards
   * @returns {void}
   */
  function puff(x, y, z, n, vy = 0) {
    if (!smoke) return;
    const count = Math.min(n, ctx.systems.caps.particleRoom());
    for (let k = 0; k < count; k++) {
      const i = smoke.next;
      smoke.next = (smoke.next + 1) % smoke.life.length;
      const life = 0.6 + Math.random() * 0.7;
      smoke.life[i] = life;
      smoke.maxLife[i] = life;
      smoke.seed[i] = Math.random();
      const v = i * 3;
      smoke.positions[v] = x + (Math.random() - 0.5) * 0.2;
      smoke.positions[v + 1] = y;
      smoke.positions[v + 2] = z + (Math.random() - 0.5) * 0.2;
      const a = Math.random() * Math.PI * 2;
      const spread = vy ? 1.2 : 4;
      smoke.velocities[v] = Math.cos(a) * spread * Math.random();
      smoke.velocities[v + 1] = vy ? -vy * (0.6 + Math.random() * 0.4) : 0.6 + Math.random();
      smoke.velocities[v + 2] = Math.sin(a) * spread * Math.random();
    }
    if (count > 0) smokeAlive = true;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function stepSmoke(dt) {
    if (!smoke || !smokeAlive) return;
    smoke.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    let any = false;
    for (let i = 0; i < smoke.life.length; i++) {
      if (smoke.life[i] <= 0) {
        if (smoke.sizes[i] !== 0) {
          smoke.colours[i * 4 + 3] = 0;
          smoke.sizes[i] = 0;
        }
        continue;
      }
      any = true;
      smoke.life[i] -= dt;
      const t = 1 - Math.max(0, smoke.life[i]) / smoke.maxLife[i];
      const v = i * 3;
      // Slowing, and drifting up as it cools.
      const drag = Math.max(0, 1 - dt * 2.5);
      smoke.velocities[v] *= drag;
      smoke.velocities[v + 1] = smoke.velocities[v + 1] * drag + 1.4 * dt;
      smoke.velocities[v + 2] *= drag;
      smoke.positions[v] += smoke.velocities[v] * dt;
      smoke.positions[v + 1] = Math.max(0.05, smoke.positions[v + 1] + smoke.velocities[v + 1] * dt);
      smoke.positions[v + 2] += smoke.velocities[v + 2] * dt;
      // Hot orange at the nozzle, grey as it spreads.
      const hot = Math.max(0, 1 - t * 4);
      const c = i * 4;
      smoke.colours[c] = 0.45 + 0.55 * hot;
      smoke.colours[c + 1] = 0.43 + 0.2 * hot;
      smoke.colours[c + 2] = 0.42 - 0.3 * hot;
      smoke.colours[c + 3] = 0.55 * Math.min(1, t * 8) * (1 - t);
      smoke.sizes[i] = 0.35 + t * (1.6 + smoke.seed[i]);
    }
    markPoolDirty(smoke);
    smokeAlive = any;
  }

  /**
   * The pack on Roger's back: two tanks, two nozzles and a flame under
   * each. Parts of his mesh (in its built units), in the run's geometry and
   * material lists.
   * @param {Object} roger the figure from buildRoger
   * @returns {void}
   */
  function attachJetpack(roger) {
    const metal = api.keepMat(new THREE.MeshStandardMaterial({ color: 0x5b6470, metalness: 0.75, roughness: 0.35 }));
    const dark = api.keepMat(new THREE.MeshStandardMaterial({ color: 0x1b1e23, metalness: 0.6, roughness: 0.5 }));
    const stripe = api.keepMat(new THREE.MeshBasicMaterial({ color: 0xffb02e }));
    const flameMat = api.keepMat(new THREE.MeshBasicMaterial({
      color: 0xff7a1a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    const coreMat = api.keepMat(new THREE.MeshBasicMaterial({
      color: 0xfff2b0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    const tankGeo = api.keepGeo(new THREE.CylinderGeometry(0.085, 0.085, 0.46, 12));
    const capGeo = api.keepGeo(new THREE.SphereGeometry(0.085, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2));
    const nozzleGeo = api.keepGeo(new THREE.CylinderGeometry(0.06, 0.09, 0.1, 12, 1, true));
    const stripeGeo = api.keepGeo(new THREE.CylinderGeometry(0.087, 0.087, 0.035, 12));
    const frameGeo = api.keepGeo(new THREE.BoxGeometry(0.3, 0.36, 0.05));
    // A flame: a cone hanging point-down from the nozzle, scaled by the thrust.
    const flameGeo = api.keepGeo(new THREE.ConeGeometry(0.075, 1, 10, 1, true));
    flameGeo.rotateX(Math.PI);
    flameGeo.translate(0, -0.5, 0);
    const coreGeo = api.keepGeo(new THREE.ConeGeometry(0.04, 1, 8, 1, true));
    coreGeo.rotateX(Math.PI);
    coreGeo.translate(0, -0.5, 0);

    const pack = new THREE.Group();
    pack.name = 'hero_jetpack';
    const frame = new THREE.Mesh(frameGeo, dark);
    frame.position.set(0, 0, 0.03);
    pack.add(frame);
    /** @type {THREE.Mesh[]} */
    const flames = [];
    /** @type {THREE.Mesh[]} */
    const cores = [];
    for (const side of [-1, 1]) {
      const tank = new THREE.Mesh(tankGeo, metal);
      tank.position.set(side * 0.1, 0, -0.04);
      tank.castShadow = true;
      const cap = new THREE.Mesh(capGeo, metal);
      cap.position.set(0, 0.23, 0);
      tank.add(cap);
      const band = new THREE.Mesh(stripeGeo, stripe);
      band.position.set(0, 0.1, 0);
      tank.add(band);
      const noz = new THREE.Mesh(nozzleGeo, dark);
      noz.position.set(0, -0.28, 0);
      tank.add(noz);
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(0, -0.32, 0);
      flame.visible = false;
      flame.frustumCulled = false;
      tank.add(flame);
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.position.set(0, -0.32, 0);
      core.visible = false;
      core.frustumCulled = false;
      tank.add(core);
      flames.push(flame);
      cores.push(core);
      pack.add(tank);
    }
    // High on the back, behind the Katana's sheath.
    pack.position.set(0, 1.12, -0.4);
    pack.rotation.x = 0.08;
    roger.mesh.add(pack);
    rig = { pack, flames, cores };
  }

  /**
   * The flames, the smoke and the roar, a frame. Real time.
   * @param {number} dt
   * @returns {void}
   */
  function updateJetFx(dt) {
    const st = S.state;
    const burning = st.jetBurn > 0 && (st.phase === 'running' || st.phase === 'aiming');
    if (!burning && st.jetBurn > 0) cutOut();
    if (rig) {
      flicker += dt * 40;
      const k = burning ? Math.min(1, st.jetBurn / 0.25) : 0;
      for (let i = 0; i < rig.flames.length; i++) {
        const flame = rig.flames[i];
        const core = rig.cores[i];
        flame.visible = core.visible = k > 0;
        if (k <= 0) continue;
        const wobble = 0.85 + 0.3 * Math.abs(Math.sin(flicker + i * 1.7)) + Math.random() * 0.12;
        flame.scale.set(1 + 0.15 * wobble, (0.7 + 0.6 * k) * wobble, 1 + 0.15 * wobble);
        core.scale.set(1, (0.35 + 0.3 * k) * wobble, 1);
        if (dt > 0) {
          // Smoke from under the nozzle, blown down and back.
          core.getWorldPosition(nozzle);
          nozzle.y -= 0.3;
          const owed = JETPACK.smokeRate * dt + Math.random();
          puff(nozzle.x, nozzle.y, nozzle.z, Math.floor(owed), 7);
        }
      }
      // The pack is seen in first person only from outside; hide nothing.
    }
    if (roaring) {
      const sfx = sound();
      if (sfx) sfx.updateJet(burning ? Math.min(1, st.jetBurn / 0.3) : 0, Math.max(0, st.vy) / JETPACK.climbSpeed);
    }
    if (burning) {
      // A warm light under him while it burns (the shared pool decides whether it is drawn).
      const p = S.roger.mesh.position;
      ctx.systems.lightPool.requestLight({ x: p.x, y: p.y + 0.4, z: p.z, colour: 0xff8a2a, intensity: 3.5, distance: 14 });
    }
    stepSmoke(dt);
  }

  /**
   * The pose in the air, over the walk: legs together and trailing, arms
   * back for the burn, out for balance in the fall. Not while dazed or
   * aiming (the rifle and the Katana keep their arms).
   * @param {Object} L the limbs
   * @param {any} root
   * @param {boolean} armsFree
   * @returns {void}
   */
  function poseAir(L, root, armsFree) {
    const st = S.state;
    const burning = st.jetBurn > 0;
    const t = flicker * 0.05;
    L.legL.rotation.set(burning ? 0.25 : -0.35 + Math.sin(t * 6) * 0.15, 0, -0.05);
    L.legR.rotation.set(burning ? 0.35 : 0.2 - Math.sin(t * 6) * 0.15, 0, 0.05);
    root.rotation.x = burning ? 0.32 : 0.1;
    root.rotation.z = 0;
    if (S.roger.torso) S.roger.torso.rotation.y = 0;
    if (!armsFree) return;
    if (burning) {
      L.armL.rotation.set(0.5, 0, -0.35);
      L.armR.rotation.set(0.5, 0, 0.35);
    } else {
      L.armL.rotation.set(-0.3, 0, -1.25);
      L.armR.rotation.set(-0.3, 0, 1.25);
    }
  }

  /**
   * The smoke's pool, made once.
   * @returns {void}
   */
  function initJetpack() {
    smoke = createParticlePool(Sim.three.scene, JETPACK.smokeMax, createSoftDotTexture(), THREE.NormalBlending, 'hero_jet_smoke');
    ctx.systems.caps.trackPool(smoke);
  }

  /**
   * The ability (engine/player/abilities.js): its cost, cooldown and HUD
   * slot, pressed through pressJump while airborne. Registered as a run
   * starts, so it is the last slot on the HUD line (after the auto-registered
   * Q E R G C); registering again replaces it in place.
   * @returns {void}
   */
  function registerJetpack() {
    ctx.systems.abilities.register({
      id: 'jetpack', name: 'JETPACK', keys: [JETPACK.key], cost: JETPACK.cost, seconds: 0, cooldown: JETPACK.cooldown,
      canStart: () => {
        const st = S.state;
        if (!st.airborne) {
          ctx.events.emit('notice', { text: 'JETPACK · jump first (SPACE), then SPACE again' });
          return false;
        }
        if (st.jetUsed) {
          ctx.events.emit('notice', { text: 'JETPACK · once a flight' });
          return false;
        }
        if (st.phase !== 'running' && st.phase !== 'aiming') return false;
        return true;
      },
      start: ignite
    });
  }

  /**
   * The run over: out of the air, the smoke cleared.
   * @returns {void}
   */
  function resetJetpack() {
    landNow(0);
    rig = null;
    if (smoke) {
      smoke.life.fill(0);
      smoke.sizes.fill(0);
      for (let i = 3; i < smoke.colours.length; i += 4) smoke.colours[i] = 0;
      markPoolDirty(smoke);
      smokeAlive = false;
    }
  }

  /** @returns {void} */
  function disposeJetpack() {
    resetJetpack();
    if (smoke) disposeParticlePool(Sim.three.scene, smoke);
    smoke = null;
  }

  return {
    groundAt, pressJump, landNow, airMove, stepAir, attachJetpack, updateJetFx, poseAir,
    initJetpack, registerJetpack, resetJetpack, disposeJetpack, cutJet: cutOut
  };
}
