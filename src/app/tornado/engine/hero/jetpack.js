// @ts-check
import * as THREE from 'three';
import { createParticlePool, pointScaleFor, markPoolDirty, disposeParticlePool } from '../particlePool.js';
import { createSoftDotTexture } from '../../utils/textures.js';
import { buildJetpackPack } from './jetpackPack.js';

/**
 * ===========================================================================
 * SECTION HM.9 — The jump and the jetpack (Space)
 * ===========================================================================
 * Roger leaves the ground for the first time (TODO.md, feature backlog, "Jetpack / double
 * jump", on request):
 *
 *  - **Space** (on the ground or in the air) lights the jetpack at once
 *    (one press, on request 2026-10-05: it used to be a jump first and Space
 *    again in the air). It flies the way the one in San Andreas does:
 *    **Space held climbs** (up to JETPACK.climbSpeed), **let go it sinks
 *    gently** (JETPACK.hoverSink) so he comes down when he wants, and W A S D
 *    fly him about at up to JETPACK.flySpeed (the way he faces on foot, the
 *    way he looks in first person) -- no keys, he holds his place in the air.
 *    No fuel and no energy: he flies as long as he likes (also on request);
 *    it goes out when he lands. Two flames from the thrusters at his hips,
 *    longer as he climbs, smoke and a roar (sound/grappleJet.js). Its HUD
 *    slot is "Space JETPACK" (engine/player/abilities.js), free.

 * The pack is the San Andreas kind, fitted to the Storm Ranger suit: two
 * slim fuel tanks either side of the Storm Core on his back, a yoke round
 * to two thrusters at his hips with bell nozzles, and a control arm from
 * each to a grip in front of him, which he holds while it
 * burns -- upright, legs dangling.
 *
 * Over the houses, the shops and the townhouses, and onto a roof if he comes
 * down over one. A roof is ground
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
  cost: 0,              // energy segments: free (1 until 2026-10-05)
  cooldown: 0,          // seconds (3 until 2026-10-05)
  burnSeconds: Infinity, // no fuel: it fires until he lands (4 s until 2026-10-05)
  climbSpeed: 11,       // m/s up with Space held
  hoverSink: 1.6,       // m/s down with Space let go: a slow, steerable descent
  lift: 30,             // m/s^2 towards climbSpeed / the hover
  flySpeed: 12,         // m/s about with W A S D while it burns
  thrust: 16,           // m/s^2 towards flySpeed (and to a stop with no keys)
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
    // Already burning: Space held is the climb (S.keys.jump), nothing more.
    if (st.jetBurn > 0) return;
    if (!st.airborne) {
      // Off the ground with the speed he has, and the pack lit at once.
      st.vy = JETPACK.jumpSpeed;
      st.airborne = true;
      if (st.phase === 'running') {
        st.airVx = Math.sin(st.heading) * st.speed;
        st.airVz = Math.cos(st.heading) * st.speed;
      } else {
        st.airVx = st.aimVx || 0;
        st.airVz = st.aimVz || 0;
      }
      const sfx = sound();
      if (sfx) sfx.playJump();
    }
    ignite();
  }

  /**
   * The jetpack lit (the ability's start).
   * @returns {void}
   */
  function ignite() {
    const st = S.state;
    if (st.jetBurn > 0) return;
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
      // Where the keys point at flying speed; no keys, he holds his place.
      const len = Math.hypot(wishX, wishZ);
      wx = len > 1e-3 ? (wishX / len) * JETPACK.flySpeed : 0;
      wz = len > 1e-3 ? (wishZ / len) * JETPACK.flySpeed : 0;
      // Backing off is slower, as on foot.
      if (len > 1e-3 && st.phase === 'running' && S.keys.down && !S.keys.up) {
        wx *= 0.5;
        wz *= 0.5;
      }
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
      // Space held: climb; let go: hover, sinking slowly.
      const want = S.keys.jump ? JETPACK.climbSpeed : -JETPACK.hoverSink;
      const step = JETPACK.lift * dt;
      st.vy = st.vy < want ? Math.min(want, st.vy + step) : Math.max(want, st.vy - step);
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
   * The pack, San Andreas style (the model is hero/jetpackPack.js, shared with the
   * co-op figures): hung on his back, parts of his mesh in the run's geometry and
   * material lists.
   * @param {Object} roger the figure from buildRoger
   * @returns {void}
   */
  function attachJetpack(roger) {
    const parts = buildJetpackPack(api.keepGeo, api.keepMat);
    roger.mesh.add(parts.pack);
    rig = parts;
  }

  /**
   * One nozzle's flame and core, longer as he climbs (shared by Roger's own pack and the
   * co-op figures').
   * @param {THREE.Mesh} flame
   * @param {THREE.Mesh} core
   * @param {number} k 0..1 how strongly it burns
   * @param {number} climb 0..1 how fast he climbs
   * @param {number} wobble the flicker
   * @returns {void}
   */
  function shapeFlame(flame, core, k, climb, wobble) {
    const len = (0.45 + 0.9 * climb) * k;
    flame.scale.set(1 + 0.15 * wobble, len * wobble, 1 + 0.15 * wobble);
    core.scale.set(1, len * 0.55 * wobble, 1);
  }

  // ---------------------------------------------------------------------
  // The co-op figures' jetpacks (visual only)
  // ---------------------------------------------------------------------

  /** Most partner figures a pack is made for (the room holds two players; a spare for a rejoin). */
  const REMOTE_MAX = 3;
  /** @type {{id: number, pack: THREE.Group, flames: THREE.Mesh[], cores: THREE.Mesh[], live: boolean, phase: number}[]} */
  const remotes = [];
  /** What the remote packs share (disposed with the system). @type {THREE.BufferGeometry[]} */
  const remoteGeos = [];
  /** @type {THREE.Material[]} */
  const remoteMats = [];
  const keepRemoteGeo = (/** @type {THREE.BufferGeometry} */ g) => { remoteGeos.push(g); return g; };
  const keepRemoteMat = (/** @type {THREE.Material} */ m) => { remoteMats.push(m); return m; };

  /**
   * The burning pack on a co-op figure that is in the air, for one frame: the same model, flames,
   * smoke and warm light as Roger's own, hung in the scene at the figure's place (never on the
   * figure's mesh, which is released on its own). The caller names the figure's id, position and
   * heading and how hard it climbs (0..1). Drawing only: nothing here moves, hurts or scores.
   * Call `stepRemoteJets` once after the frame's calls.
   * @param {number} id the player's id
   * @param {number} x @param {number} y feet height @param {number} z
   * @param {number} yaw the figure's heading (radians)
   * @param {number} climb 0..1
   * @param {number} dt real seconds
   * @returns {void}
   */
  function showRemoteJet(id, x, y, z, yaw, climb, dt) {
    let r = remotes.find((v) => v.id === id);
    if (!r) {
      if (remotes.length >= REMOTE_MAX) return;
      const parts = buildJetpackPack(keepRemoteGeo, keepRemoteMat);
      parts.pack.name = 'coop_jetpack';
      parts.pack.visible = false;
      Sim.three.scene.add(parts.pack);
      r = { id, pack: parts.pack, flames: parts.flames, cores: parts.cores, live: false, phase: remotes.length * 2.3 };
      remotes.push(r);
    }
    r.live = true;
    r.phase += dt * 40;
    r.pack.visible = true;
    r.pack.position.set(x, y, z);
    r.pack.rotation.y = yaw;
    r.pack.updateMatrixWorld(true);
    for (let i = 0; i < r.flames.length; i++) {
      const flame = r.flames[i];
      const core = r.cores[i];
      flame.visible = core.visible = true;
      const wobble = 0.85 + 0.3 * Math.abs(Math.sin(r.phase + i * 1.7)) + Math.random() * 0.12;
      shapeFlame(flame, core, 1, climb, wobble);
      if (dt > 0) {
        core.getWorldPosition(nozzle);
        nozzle.y -= 0.3;
        const owed = JETPACK.smokeRate * dt + Math.random();
        puff(nozzle.x, nozzle.y, nozzle.z, Math.floor(owed * (0.5 + climb)), 7);
      }
    }
    ctx.systems.lightPool.requestLight({ x, y: y + 0.4, z, colour: 0xff8a2a, intensity: 3.5, distance: 14 });
  }

  /**
   * Ends the frame for the co-op packs: any pack not shown this frame is hidden, and the smoke
   * is stepped when Roger's own `updateJetFx` is not running (a guest, or no run), so it moves once a frame.
   * @param {number} dt real seconds
   * @returns {void}
   */
  function stepRemoteJets(dt) {
    for (const r of remotes) {
      if (r.live) { r.live = false; continue; }
      r.pack.visible = false;
    }
    if (!S.Hero.active || !S.roger) stepSmoke(dt);
  }

  /** Hides every co-op pack at once (leaving a room, a restart). @returns {void} */
  function clearRemoteJets() {
    for (const r of remotes) r.pack.visible = false;
  }

  /** Removes the co-op packs and what they made. @returns {void} */
  function disposeRemoteJets() {
    for (const r of remotes) Sim.three.scene.remove(r.pack);
    remotes.length = 0;
    for (const g of remoteGeos) g.dispose();
    for (const m of remoteMats) m.dispose();
    remoteGeos.length = remoteMats.length = 0;
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
        // Longer while he climbs, a short steady jet in the hover.
        const climb = THREE.MathUtils.clamp(st.vy / JETPACK.climbSpeed, 0, 1);
        shapeFlame(flame, core, k, climb, wobble);
        if (dt > 0) {
          // Smoke from under the nozzle, blown down and back.
          core.getWorldPosition(nozzle);
          nozzle.y -= 0.3;
          const owed = JETPACK.smokeRate * dt + Math.random();
          puff(nozzle.x, nozzle.y, nozzle.z, Math.floor(owed * (0.5 + climb)), 7);
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
   * The pose in the air, over the walk. On the jetpack, San Andreas style:
   * upright, a hand on each grip in front of him, legs dangling and swinging
   * a little with the way he flies. Falling: legs trailing, arms out for
   * balance. Not while dazed; the rifle and the Katana keep their arms.
   * @param {Object} L the limbs
   * @param {any} root
   * @param {boolean} armsFree
   * @returns {void}
   */
  function poseAir(L, root, armsFree) {
    const st = S.state;
    const burning = st.jetBurn > 0;
    const t = flicker * 0.05;
    if (burning) {
      // A lean into the way he flies, as the pack tilts.
      const fwd = st.airVx * Math.sin(st.heading) + st.airVz * Math.cos(st.heading);
      const lean = THREE.MathUtils.clamp(fwd / JETPACK.flySpeed, -1, 1) * 0.18;
      const sway = Math.sin(t * 5) * 0.08;
      L.legL.rotation.set(0.12 + sway - lean, 0, -0.06);
      L.legR.rotation.set(0.18 - sway - lean, 0, 0.06);
      root.rotation.x = 0.04 + lean;
    } else {
      L.legL.rotation.set(-0.35 + Math.sin(t * 6) * 0.15, 0, -0.05);
      L.legR.rotation.set(0.2 - Math.sin(t * 6) * 0.15, 0, 0.05);
      root.rotation.x = 0.1;
    }
    root.rotation.z = 0;
    if (S.roger.torso) S.roger.torso.rotation.y = 0;
    if (!armsFree) return;
    if (burning) {
      // Down and forward to the grips at his hips.
      L.armL.rotation.set(-0.6, 0, -0.14);
      L.armR.rotation.set(-0.6, 0, 0.14);
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
        return st.jetBurn <= 0 && (st.phase === 'running' || st.phase === 'aiming');
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
    clearRemoteJets();
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
    disposeRemoteJets();
    if (smoke) disposeParticlePool(Sim.three.scene, smoke);
    smoke = null;
  }

  return {
    groundAt, pressJump, landNow, airMove, stepAir, attachJetpack, updateJetFx, poseAir,
    initJetpack, registerJetpack, resetJetpack, disposeJetpack, cutJet: cutOut,
    showRemoteJet, stepRemoteJets, clearRemoteJets
  };
}
