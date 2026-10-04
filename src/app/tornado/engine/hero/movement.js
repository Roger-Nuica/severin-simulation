// @ts-check
import * as THREE from 'three';
import { PERSON_SCALE } from '../environment/people.js';
import { HERO, STREETS_ALONG_X, STREETS_ALONG_Z } from './config.js';
import { JETPACK } from './jetpack.js';
import { steerRun } from './touchMath.js';
import { kneeBend } from '../net/rogerView.js';

/**
 * ===========================================================================
 * SECTION HM.2 — Roger on foot
 * ===========================================================================
 * Where he may stand (not inside a building), where he comes in, his walk
 * and his swagger, being dazed.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see heroMode.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createHeroMovement(ctx, S, api) {
  const { Sim, container } = ctx;

  // ---------------------------------------------------------------------
  // Placing things
  // ---------------------------------------------------------------------

  /**
   * @param {number} x
   * @param {number} z
   * @param {number} pad
   * @param {number} [above] only boxes standing higher than this count (the
   *   follow camera over the roofs while he flies; hero/jetpack.js)
   * @returns {boolean} whether a standing building's footprint covers it
   */
  function inBuilding(x, z, pad, above = 0) {
    return someSolid((cx, cz, hw, hd, top) => top > above && Math.abs(x - cx) < hw + pad && Math.abs(z - cz) < hd + pad);
  }

  /**
   * Every box on the ground that Roger and his pursuers stop against: the
   * town's standing buildings, the backdrop town's blocks still standing
   * (environment/backdrop.js) now that he can walk out to them, and the dam
   * wall (flood.js; open at the breach once it has burst). Each is visited
   * as its centre, half extents and the height of its top (a roof Roger can
   * land on with the jetpack, hero/jetpack.js; Infinity for the dam and the
   * volcano, which he does not fly over), until `visit` says to stop.
   * @param {(cx: number, cz: number, hw: number, hd: number, top: number) => boolean} visit
   * @returns {boolean} whether `visit` stopped it
   */
  function someSolid(visit) {
    for (const building of ctx.Environment.buildings) {
      if (building.damageState === 'collapsed') continue;
      const fp = building.mesh.userData.footprint;
      if (!fp) continue;
      const b = building.mesh.position;
      if (visit(b.x, b.z, fp.width / 2, fp.depth / 2, building.mesh.userData.wallHeight || Infinity)) return true;
    }
    const backdrop = ctx.systems.backdrop;
    for (const block of backdrop ? backdrop.solidBlocks() : []) {
      if (block.state === 0 && visit(block.x, block.z, block.hw, block.hd, block.h)) return true;
    }
    const flood = ctx.systems.flood;
    for (const wall of flood ? flood.damSolids() : []) {
      if (visit(wall.x, wall.z, wall.hw, wall.hd, Infinity)) return true;
    }
    // The volcano's cone (engine/volcano.js).
    const volcano = ctx.systems.volcano;
    for (const block of volcano ? volcano.solids() : []) {
      if (visit(block.x, block.z, block.hw, block.hd, Infinity)) return true;
    }
    return false;
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {number} pad
   * @returns {boolean} whether something walking can stand here
   */
  function blockedAt(x, z, pad) {
    if (Math.abs(x) > HERO.bound || Math.abs(z) > HERO.bound) return true;
    // The dam is the west edge of the world (flood/dam.js westLimit).
    if (x < ctx.systems.flood.westLimit() + pad) return true;
    if (ctx.systems.chasm && ctx.systems.chasm.gapAt(x, z) > -1.5) return true;
    return inBuilding(x, z, pad);
  }

  /**
   * How far along a level ray the first solid box is (someSolid): from
   * (x, z) along the unit direction (dx, dz), up to `max` metres. A box the
   * ray starts inside is not counted. For the grappling hook
   * (engine/player/grapple.js).
   * @param {number} x
   * @param {number} z
   * @param {number} dx
   * @param {number} dz
   * @param {number} max
   * @returns {number} the distance, or Infinity when nothing is that near
   */
  function solidAlong(x, z, dx, dz, max) {
    let best = Infinity;
    someSolid((cx, cz, hw, hd) => {
      let lo = 0;
      let hi = max;
      if (Math.abs(dx) < 1e-9) {
        if (Math.abs(x - cx) > hw) return false;
      } else {
        const a = (cx - hw - x) / dx;
        const b = (cx + hw - x) / dx;
        lo = Math.max(lo, Math.min(a, b));
        hi = Math.min(hi, Math.max(a, b));
      }
      if (Math.abs(dz) < 1e-9) {
        if (Math.abs(z - cz) > hd) return false;
      } else {
        const a = (cz - hd - z) / dz;
        const b = (cz + hd - z) / dz;
        lo = Math.max(lo, Math.min(a, b));
        hi = Math.min(hi, Math.max(a, b));
      }
      if (lo <= hi && lo > 0 && lo < best) best = lo;
      return false;
    });
    return best;
  }

  /**
   * Out of any footprint along the shorter way, as the Terminator is.
   * @param {THREE.Vector3} p mutated in place
   * @param {number} pad
   * @param {number} [alt] feet this high (Roger in the air or on a roof,
   *   hero/jetpack.js) pass over any box whose top is within a step of them
   * @returns {void}
   */
  function pushOut(p, pad, alt = 0) {
    someSolid((cx, cz, hw, hd, top) => {
      if (top <= alt + JETPACK.stepUp) return false;
      const dx = p.x - cx;
      const dz = p.z - cz;
      const ox = hw + pad - Math.abs(dx);
      const oz = hd + pad - Math.abs(dz);
      if (ox <= 0 || oz <= 0) return false;
      if (ox < oz) p.x += Math.sign(dx || 1) * ox;
      else p.z += Math.sign(dz || 1) * oz;
      return false;
    });
    p.x = THREE.MathUtils.clamp(p.x, Math.max(-HERO.bound, ctx.systems.flood.westLimit() + pad), HERO.bound);
    p.z = THREE.MathUtils.clamp(p.z, -HERO.bound, HERO.bound);
  }

  /**
   * A pavement spot on one of the streets, clear of buildings and well away
   * from every funnel.
   * @returns {{x: number, z: number}}
   */
  function pickSpawn() {
    let fallback = { x: 0, z: -8 };
    for (let i = 0; i < 40; i++) {
      const alongX = Math.random() < 0.67;
      const lines = alongX ? STREETS_ALONG_X : STREETS_ALONG_Z;
      const line = lines[Math.floor(Math.random() * lines.length)] + (Math.random() < 0.5 ? -3.5 : 3.5);
      const along = (Math.random() * 2 - 1) * 90;
      const x = alongX ? along : line;
      const z = alongX ? line : along;
      if (i === 0) fallback = { x, z };
      if (blockedAt(x, z, 2)) continue;
      let clear = true;
      for (const { Vortex } of ctx.tornadoes.active) {
        if (Math.hypot(x - Vortex.center.x, z - Vortex.center.z) < HERO.spawnFunnelClearance) clear = false;
      }
      if (clear) return { x, z };
    }
    return fallback;
  }

  // ---------------------------------------------------------------------
  // Roger
  // ---------------------------------------------------------------------

  /**
   * Poses the figure: a swagger rather than the town's plain run, on
   * request -- the shoulders rolling against the stride, the hips swaying
   * side to side, a spring in the step, the knees bending as each leg swings
   * through (net/rogerView.js kneeBend) -- whose rate is the ground
   * covered; the rifle held up while aiming; and the dazed stagger with arms
   * out. (It used to be a stiff lean-forward run.)
   * @param {number} moved world units covered this frame
   * @param {number} dt real seconds, for the Katana's draw and slash animation
   * @returns {void}
   */
  function poseRoger(moved, dt) {
    const L = S.roger.limbs;
    const frac = THREE.MathUtils.clamp(Math.abs(S.state.speed) / HERO.runSpeed, 0, 1);
    S.state.cycle += moved * HERO.stride;
    const s = Math.sin(S.state.cycle);
    const c = Math.cos(S.state.cycle);
    const moving = frac > 0.02;
    const legAmp = moving ? 0.4 + 0.7 * frac : 0;
    L.legL.rotation.set(s * legAmp, 0, moving ? -0.06 : -0.03);
    L.legR.rotation.set(-s * legAmp, 0, moving ? 0.06 : 0.03);
    if (L.kneeL) {
      L.kneeL.rotation.x = kneeBend(S.state.cycle, moving ? 0.35 + 0.65 * frac : 0, true);
      L.kneeR.rotation.x = kneeBend(S.state.cycle, moving ? 0.35 + 0.65 * frac : 0, false);
    }
    const root = S.roger.mesh;
    // The spring: up on each step, twice a stride; on top of his height off
    // the street (a roof, the air: hero/jetpack.js).
    root.position.y = S.state.alt + (S.state.airborne ? 0 : Math.abs(c) * 0.13 * frac * PERSON_SCALE);
    root.rotation.x = 0.14 * frac;
    // Hips swaying over the planted foot, shoulders rolling against the legs.
    root.rotation.z = moving ? s * 0.07 * (0.5 + frac) : 0;
    if (S.roger.torso) S.roger.torso.rotation.y = moving ? -s * 0.28 * (0.4 + frac) : 0;
    // The little tornado in the Storm Core on his back (hero/rogerLook.js),
    // spinning faster as he runs.
    if (S.roger.core) S.roger.core.rotation.y += dt * (5 + 9 * frac);

    // The Katana's rig (hero/katana/model.js) shows the sheath while it is the
    // weapon in hand and takes the arms once it is drawn; a daze or the rifle's
    // aim puts it away at once. It reads the weapons API, never S.state.drawn.
    // In first person the blade stays at the ready while he walks: the run
    // carry (blade swung back) would take it out of the view.
    const weapons = S.weapons;
    const katanaHeld = S.katanaRig && weapons
      ? S.katanaRig.step(
        dt, weapons.current() === 'katana', weapons.katanaState().drawn, S.state.phase === 'aiming' ? 0 : frac,
        S.state.phase === 'dazed' || (S.state.phase === 'aiming' && !weapons.katanaState().drawn)
      )
      : false;
    if (S.state.phase === 'dazed') {
      L.armL.rotation.set(-0.55 - s * 0.12, 0, -1.15);
      L.armR.rotation.set(-0.55 + s * 0.12, 0, 1.15);
      root.rotation.z = Math.sin(S.state.timer * 3.4) * 0.18;
      root.rotation.x = 0;
      return;
    }
    const aiming = S.state.drawn && S.state.phase !== 'won';
    // In the air: the flight pose (hero/jetpack.js), the arms left to the
    // rifle and the Katana when they have them.
    if (S.state.airborne && !S.state.zipActive) {
      api.poseAir(L, root, !aiming && !katanaHeld);
      if (aiming) {
        L.armR.rotation.set(-1.45, 0, 0.05);
        L.armL.rotation.set(-1.25, 0, -0.45);
      }
      return;
    }
    if (aiming) {
      // The rifle up and forward, the left hand under the barrel.
      L.armR.rotation.set(-1.45, 0, 0.05);
      L.armL.rotation.set(-1.25, 0, -0.45);
    } else {
      // Arms swinging past the body, a little out from it.
      const armAmp = moving ? 0.35 + 0.65 * frac : 0;
      const out = S.roger.armSplay + 0.04 + 0.06 * frac;
      L.armL.rotation.set(-s * armAmp, s * 0.25 * frac, -out);
      L.armR.rotation.set(s * armAmp, s * 0.25 * frac, out);
      if (katanaHeld) S.katanaRig.applyArms(L.armL, L.armR);
    }
  }

  /**
   * Knocked silly at the edge of a funnel: out of the player's hands for a
   * while, flung a little way, and perhaps without the rifle afterwards.
   * @param {Object} v the Vortex that caught him
   * @returns {void}
   */
  function daze(v) {
    if (S.state.phase === 'aiming') api.leaveAim();
    S.state.phase = 'dazed';
    S.state.timer = 0;
    S.state.speed = 0;
    const p = S.roger.mesh.position;
    const away = Math.atan2(p.x - v.center.x, p.z - v.center.z);
    S.state.flingX = Math.sin(away) * 14;
    S.state.flingZ = Math.cos(away) * 14;
    S.state.dazeHeading = away + (Math.random() - 0.5) * 2;
    S.state.dazeSpin = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.6);
    ctx.systems.speechBubbles.sayDazed(S.roger);
    ctx.systems.gamefeel.addShake(0.6, 0.4);
  }

  /**
   * @param {number} dt real seconds
   * @returns {void}
   */
  function updateRoger(dt) {
    const p = S.roger.mesh.position;
    let moved = 0;
    const x0 = p.x;
    const z0 = p.z;
    // The grappling hook's zip (engine/player/grapple.js): only on his feet;
    // anything else (a daze, a car, death) lets go of the rope.
    const onFeet = S.state.phase === 'running' || S.state.phase === 'aiming';
    if (S.state.zipActive && !onFeet) S.state.zipActive = false;
    const zipping = S.state.zipActive;
    let zipStep = 0;
    let zipLeft = 0;

    // In the air (the jump and the jetpack, hero/jetpack.js): his own speed
    // over the ground, steered by the keys as on foot; a daze keeps its own.
    const flying = S.state.airborne && !zipping && S.state.phase !== 'dazed';

    if (zipping) {
      const dx = S.state.zipX - p.x;
      const dz = S.state.zipZ - p.z;
      zipLeft = Math.hypot(dx, dz);
      zipStep = S.state.zipSpeed * dt;
      if (zipLeft <= zipStep || zipLeft < 1e-3) {
        p.x = S.state.zipX;
        p.z = S.state.zipZ;
        S.state.zipActive = false;
      } else {
        p.x += (dx / zipLeft) * zipStep;
        p.z += (dz / zipLeft) * zipStep;
      }
      // Facing the way the rope pulls (on foot; aiming, the mouse keeps the view).
      if (S.state.phase === 'running' && zipLeft > 1e-3) S.state.heading = Math.atan2(dx, dz);
      S.state.speed = 0;
    } else if (flying && S.state.phase === 'running') {
      let ahead;
      if (S.stick.x || S.stick.y) {
        // The touch joystick, as on the ground (hero/touch.js).
        const cam = Sim.three.camera.position;
        const steer = steerRun(S.state.heading, Math.atan2(p.x - cam.x, p.z - cam.z), S.stick.x, S.stick.y, dt);
        S.state.heading = steer.heading;
        ahead = HERO.runSpeed * steer.speed;
      } else {
        const turn = (S.keys.left ? 1 : 0) - (S.keys.right ? 1 : 0);
        S.state.heading += turn * HERO.turnRate * dt;
        ahead = S.keys.up ? HERO.runSpeed : S.keys.down ? -HERO.backSpeed : 0;
      }
      api.airMove(p, dt, Math.sin(S.state.heading) * ahead, Math.cos(S.state.heading) * ahead, ahead !== 0);
    } else if (flying && S.state.phase === 'aiming') {
      S.state.heading = S.state.yaw;
      const fx = Math.sin(S.state.yaw);
      const fz = Math.cos(S.state.yaw);
      const analog = S.stick.x || S.stick.y;
      const ahead = analog ? -S.stick.y : (S.keys.up ? 1 : 0) - (S.keys.down ? 1 : 0);
      const across = analog ? -S.stick.x : (S.keys.left ? 1 : 0) - (S.keys.right ? 1 : 0);
      const mx = (fx * ahead + fz * across) * HERO.aimWalkSpeed;
      const mz = (fz * ahead - fx * across) * HERO.aimWalkSpeed;
      api.airMove(p, dt, mx, mz, ahead !== 0 || across !== 0);
    } else if (S.state.phase === 'running') {
      let want;
      if (S.stick.x || S.stick.y) {
        // The touch joystick (hero/touch.js): the way it points on screen,
        // from the camera, and as fast as it is pushed.
        const cam = Sim.three.camera.position;
        const steer = steerRun(S.state.heading, Math.atan2(p.x - cam.x, p.z - cam.z), S.stick.x, S.stick.y, dt);
        S.state.heading = steer.heading;
        want = HERO.runSpeed * steer.speed;
      } else {
        const turn = (S.keys.left ? 1 : 0) - (S.keys.right ? 1 : 0);
        S.state.heading += turn * HERO.turnRate * dt;
        want = S.keys.up ? HERO.runSpeed : S.keys.down ? -HERO.backSpeed : 0;
      }
      const step = HERO.accel * dt;
      S.state.speed = S.state.speed < want ? Math.min(want, S.state.speed + step) : Math.max(want, S.state.speed - step * 1.5);
      p.x += Math.sin(S.state.heading) * S.state.speed * dt;
      p.z += Math.cos(S.state.heading) * S.state.speed * dt;
    } else if (S.state.phase === 'dazed') {
      S.state.timer += dt;
      // Flung clear first, then the wandering stagger.
      const fling = Math.max(0, 1 - S.state.timer / 0.5);
      p.x += S.state.flingX * fling * dt * 2;
      p.z += S.state.flingZ * fling * dt * 2;
      S.state.dazeHeading += S.state.dazeSpin * dt;
      S.state.heading = S.state.dazeHeading + Math.sin(S.state.timer * 0.85) * 1.1;
      S.state.speed = 3;
      p.x += Math.sin(S.state.heading) * S.state.speed * dt;
      p.z += Math.cos(S.state.heading) * S.state.speed * dt;
      if (S.state.timer > HERO.dazeSeconds * 0.55 && !S.state.saidTwice) {
        S.state.saidTwice = true;
        ctx.systems.speechBubbles.sayDazed(S.roger);
      }
      if (S.state.timer >= HERO.dazeSeconds) {
        S.state.phase = 'running';
        S.state.speed = 0;
        S.state.saidTwice = false;
        S.state.dazeImmunity = HERO.dazeImmunity;
      }
    } else if (S.state.phase === 'aiming') {
      // First person: the mouse looks, W A S D walk (slowly) relative to
      // it -- up/down forward and back, left/right strafe.
      S.state.heading = S.state.yaw;
      const fx = Math.sin(S.state.yaw);
      const fz = Math.cos(S.state.yaw);
      const analog = S.stick.x || S.stick.y;
      // The touch joystick walks as far as it is pushed; keys walk full pace.
      const ahead = analog ? -S.stick.y : (S.keys.up ? 1 : 0) - (S.keys.down ? 1 : 0);
      const across = analog ? -S.stick.x : (S.keys.left ? 1 : 0) - (S.keys.right ? 1 : 0);
      // Left of forward is (fz, -fx) with this module's heading convention.
      let mx = fx * ahead + fz * across;
      let mz = fz * ahead - fx * across;
      const len = Math.hypot(mx, mz);
      const pace = HERO.aimWalkSpeed * (analog ? Math.min(1, len) : 1);
      S.state.speed = len > 0 ? pace : 0;
      if (len > 0) {
        mx /= len;
        mz /= len;
        p.x += mx * pace * dt;
        p.z += mz * pace * dt;
      }
      // What a jump from here takes with it.
      S.state.aimVx = len > 0 ? mx * pace : 0;
      S.state.aimVz = len > 0 ? mz * pace : 0;
    }
    const xBefore = p.x;
    const zBefore = p.z;
    pushOut(p, HERO.pad * 0.5, S.state.alt);
    // Against a wall in the air: that way's speed is gone.
    if (flying) {
      if (Math.abs(p.x - xBefore) > 1e-4) S.state.airVx = 0;
      if (Math.abs(p.z - zBefore) > 1e-4) S.state.airVz = 0;
    }
    moved = Math.hypot(p.x - x0, p.z - z0);
    // Pulled into a wall short of the hook: the zip is over.
    if (zipping && S.state.zipActive && dt > 0 && moved < zipStep * 0.3) S.state.zipActive = false;
    // Ran into a wall: the run cycle stops with him.
    if (S.state.phase === 'running' && !flying && moved < Math.abs(S.state.speed) * dt * 0.3) S.state.speed *= 0.5;
    S.roger.mesh.rotation.y = S.state.heading;
    // Up and down: the jump, the jetpack, a roof, a fall (hero/jetpack.js).
    api.stepAir(dt);
    poseRoger(moved, dt);
    // A hop along the rope: up and down again over the zip.
    if (zipping && S.state.zipTotal > 0) {
      const u = THREE.MathUtils.clamp(1 - zipLeft / S.state.zipTotal, 0, 1);
      p.y += Math.sin(Math.PI * u) * HERO.zipHop;
    }

    S.overhead.position.set(p.x, p.y + HERO.overheadHeight, p.z);
    S.stars.visible = S.state.phase === 'dazed';
    if (S.stars.visible) {
      S.stars.position.set(p.x, S.state.alt + HERO.starsHeight + Math.sin(S.state.timer * 2.2) * 0.06, p.z);
      S.stars.material.rotation += dt * 2.6;
    }

    // The storm: dazed, never killed.
    if (S.state.dazeImmunity > 0) S.state.dazeImmunity -= dt;
    if ((S.state.phase === 'running' || S.state.phase === 'aiming') && !S.state.invincible) {
      for (const { Vortex } of ctx.tornadoes.active) {
        if (Vortex.neutralized || Vortex.birth < 0.3 || S.state.dazeImmunity > 0) continue;
        const reach = Sim.params.radius * HERO.dazeReach * (Vortex.sizeMul || 1) * Vortex.birth;
        if (Math.hypot(p.x - Vortex.center.x, p.z - Vortex.center.z) < reach) {
          daze(Vortex);
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------------
  // Death
  // ---------------------------------------------------------------------

  /**
   * Roger for the things hunting him (aliens.js, terminator.js): where he
   * is, and whether he is on foot (the crew cannot grab or shoot him in a
   * car; the ships' lasers still can). Null when there is no Roger to get.
   * @returns {{x: number, z: number, onFoot: boolean}|null}
   */
  function rogerTarget() {
    if (!S.Hero.active || !S.roger) return null;
    if (S.state.phase === 'dying' || S.state.phase === 'won' || S.state.coopDown) return null;
    const p = S.roger.mesh.position;
    return { x: p.x, z: p.z, onFoot: S.state.phase !== 'driving' };
  }

  return { inBuilding, someSolid, solidAlong, blockedAt, pushOut, pickSpawn, poseRoger, daze, updateRoger, rogerTarget };
}
