// @ts-check
import * as THREE from 'three';
import { HERO } from './config.js';
import { ENERGY } from '../player/energy.js';
import { HEALTH } from '../health/config.js';

/** Shortest real gap in milliseconds between two hit flashes, so the screen never flashes above about 3 Hz. */
const FLASH_GAP_MS = 340;
/** Real seconds the direction arrow stays up after a hit. */
const ARROW_SECONDS = 1;
/** Glow steps written to the DOM (1 / 20), so the style changes only a few times a second. */
const GLOW_STEPS = 20;

/**
 * ===========================================================================
 * SECTION HM.7 — Death, cameras and the HUD
 * ===========================================================================
 * How Roger dies (and the camera on it), the follow and aim cameras, the
 * HUD, and the banners and messages.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see heroMode.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createHeroScreen(ctx, S, api) {
  const { Sim, container } = ctx;

  /**
   * The hit indicator's per-instance state: which of the two alternating
   * animation classes the last flash used (swapping restarts a CSS animation
   * without a forced reflow), when it ran, and where the arrow points.
   * @type {{flip: boolean, flashedAt: number, arrowLeft: number, x: number, z: number, angle: string}}
   */
  const hurt = { flip: false, flashedAt: -Infinity, arrowLeft: 0, x: 0, z: 0, angle: '' };

  /**
   * Roger lost health but lives: a brief red vignette pulse (CSS, 0.2 s) and,
   * when the attacker's position is known, an arrow toward it. Pulses are at
   * least `FLASH_GAP_MS` apart (a hit window of 0.2 s must not strobe).
   * @param {{position?: {x: number, z: number} | null}} hit the `playerHurt` event
   * @returns {void}
   */
  function hurtFlash(hit) {
    if (!S.hurt || S.state.overShown) return;
    const now = performance.now();
    const pulse = now - hurt.flashedAt >= FLASH_GAP_MS;
    if (pulse) {
      hurt.flashedAt = now;
      hurt.flip = !hurt.flip;
      S.hurt.classList.toggle('a', hurt.flip);
      S.hurt.classList.toggle('b', !hurt.flip);
    }
    if (hit.position && S.hurtDir) {
      hurt.x = hit.position.x;
      hurt.z = hit.position.z;
      hurt.arrowLeft = ARROW_SECONDS;
      hurt.angle = '';
      if (pulse) {
        S.hurt.classList.toggle('da', hurt.flip);
        S.hurt.classList.toggle('db', !hurt.flip);
      }
    }
  }

  /**
   * Turns the arrow to the attacker as the view turns, while it is up;
   * writes only when the angle changes.
   * @param {number} rawDt real seconds since the last frame
   * @returns {void}
   */
  function updateHurtArrow(rawDt) {
    if (!S.hurtDir || hurt.arrowLeft <= 0) return;
    hurt.arrowLeft -= rawDt;
    const cam = Sim.three.camera;
    cam.getWorldDirection(S.scratch);
    const cl = Math.hypot(S.scratch.x, S.scratch.z) || 1;
    const fx = S.scratch.x / cl;
    const fz = S.scratch.z / cl;
    const bx = hurt.x - cam.position.x;
    const bz = hurt.z - cam.position.z;
    const angle = Math.atan2(-fz * bx + fx * bz, fx * bx + fz * bz).toFixed(2);
    if (angle !== hurt.angle) {
      hurt.angle = angle;
      S.hurtDir.style.setProperty('--a', `${angle}rad`);
    }
  }

  /**
   * Takes every hit indicator away (GAME OVER, Restart, Exit, reset).
   * @returns {void}
   */
  function clearHurt() {
    hurt.arrowLeft = 0;
    hurt.flashedAt = -Infinity;
    hurt.angle = '';
    if (S.hurt) S.hurt.classList.remove('a', 'b', 'da', 'db', 'low');
  }

  /**
   * @param {string} title
   * @param {string} sub
   * @param {''|'electric'|'loss'} [look] electric blue for the machine's
   *   death, red for Roger's; gold otherwise
   * @returns {void}
   */
  function showBanner(title, sub, look = '') {
    if (!S.banner) return;
    S.banner.querySelector('.title').textContent = title;
    S.banner.querySelector('.sub').textContent = sub;
    S.banner.classList.toggle('electric', look === 'electric');
    S.banner.classList.toggle('loss', look === 'loss');
    S.banner.classList.add('visible');
    S.state.bannerTimer = HERO.bannerSeconds;
  }

  /**
   * A line in the HUD from another system (engine/empCharge.js), while a
   * run is on.
   * @param {string} text
   * @returns {void}
   */
  function notify(text) {
    if (S.Hero.active) flashMessage(text);
  }

  /**
   * A short line in the HUD, for feedback that is not an event.
   * @param {string} text
   * @returns {void}
   */
  function flashMessage(text) {
    if (!S.hud) return;
    S.hud.querySelector('.hero-msg').textContent = text;
    S.state.msgTimer = 1.8;
  }

  /**
   * Roger is dead: struck down where he stands (or, for 'fall', over the edge
   * of the chasm), the controls gone, and after a moment GAME OVER with
   * Restart and Exit.
   * @param {string} title
   * @param {string} sub
   * @param {''|'fall'} [kind]
   * @returns {void}
   */
  function killRoger(title, sub, kind = '') {
    if (!S.Hero.active || !S.roger || S.state.phase === 'dying' || S.state.phase === 'won') return;
    // The spawn shield: nothing gets him in his first seconds.
    if (S.state.spawnShield > 0) return;
    // Co-op: while a teammate is up Roger goes down, not out (engine/net/system.js).
    if (ctx.systems.net && ctx.systems.net.interceptRogerDeath(kind)) return;
    if (S.state.phase === 'aiming') api.leaveAim();
    api.cancelCharge();
    const wasDriving = S.state.phase === 'driving';
    const at = S.roger.mesh.position.clone();
    api.exitCar();
    // Out of the car and into the gap, not beside it.
    if (wasDriving && kind === 'fall') S.roger.mesh.position.copy(at);
    api.releaseKeys();
    S.state.phase = 'dying';
    S.state.timer = 0;
    S.state.deathKind = kind;
    S.state.deathVy = 0;
    S.state.overShown = false;
    S.state.deathTitle = title;
    S.state.deathSub = sub;
    if (S.beam) S.beam.visible = false;
    if (S.stars) S.stars.visible = false;
    ctx.systems.gamefeel.addShake(1.2, 0.6);
    ctx.systems.lightning.flashScreen(S.scratch.copy(S.roger.mesh.position).setY(HERO.muzzleHeight), 0.5, '#ff6b5a');
    showBanner(title, sub, 'loss');
  }

  /**
   * Something lethal landing over an area (a ship coming down, the
   * mothership's beam): Roger inside it dies.
   * @param {number} x
   * @param {number} z
   * @param {number} radius
   * @param {string} title
   * @param {string} sub
   * @param {string} [source] key into `HEALTH.damage`; goes through the health API as an instant kill (R-035)
   * @returns {void}
   */
  function hitArea(x, z, radius, title, sub, source = 'explosion') {
    if (!S.Hero.active || !S.roger) return;
    // A co-op guest inside the area is hit the same way (friendly fire, D4).
    if (ctx.systems.net) {
      ctx.systems.net.hitGuestsArea(x, z, radius, { source, instantKill: true, title, sub, position: { x, y: 0, z } });
    }
    const p = S.roger.mesh.position;
    if (Math.hypot(p.x - x, p.z - z) < radius) {
      ctx.systems.health.damagePlayer({ source, instantKill: true, title, sub, position: { x, y: 0, z } });
    }
  }

  /**
   * A banner from another system (a ship shot down), while a run is on.
   * @param {string} title
   * @param {string} sub
   * @returns {void}
   */
  function announce(title, sub) {
    if (S.Hero.active) showBanner(title, sub);
  }

  /**
   * The earthquake's chasm (engine/chasm.js): standing (or driving) over the
   * gap is the end of him.
   * @returns {void}
   */
  function checkChasm() {
    const chasm = ctx.systems.chasm;
    if (!chasm) return;
    const p = S.roger.mesh.position;
    if (chasm.gapAt(p.x, p.z) > HERO.chasmMargin) {
      ctx.systems.health.damagePlayer({
        source: 'chasm', instantKill: true, title: 'OVER THE EDGE', sub: 'Roger fell into the chasm', kind: 'fall',
        position: { x: p.x, y: 0, z: p.z }
      });
    }
  }

  /**
   * Per frame while dead: the stagger and the drop into the chasm, or the
   * fall where he stood; the death camera; then the GAME OVER card.
   * @param {number} dt
   * @param {number} rawDt
   * @returns {void}
   */
  function updateDeath(dt, rawDt) {
    S.state.timer += dt;
    const root = S.roger.mesh;
    if (S.state.deathKind === 'fall') {
      if (S.state.timer < HERO.chasmStagger) {
        // Arms flung out, teetering at the edge.
        const L = S.roger.limbs;
        L.armL.rotation.set(-2.4 + Math.sin(S.state.timer * 30) * 0.4, 0, -0.8);
        L.armR.rotation.set(-2.4 - Math.sin(S.state.timer * 30) * 0.4, 0, 0.8);
        root.rotation.z = Math.sin(S.state.timer * 22) * 0.25;
      } else {
        S.state.deathVy += 30 * dt;
        root.position.y -= S.state.deathVy * dt;
        root.rotation.x -= dt * 3;
        root.rotation.z += dt * 2;
      }
      S.nameTag.position.set(root.position.x, root.position.y + HERO.tagHeight, root.position.z);
      const cam = Sim.three.camera;
      S.camGoal.set(root.position.x + HERO.followBack * 0.6, HERO.followHeight * 1.2, root.position.z + HERO.followBack * 0.6);
      cam.position.lerp(S.camGoal, Math.min(1, rawDt * 3));
      Sim.three.controls.target.set(root.position.x, Math.max(-20, root.position.y), root.position.z);
      cam.lookAt(Sim.three.controls.target);
      if (root.position.y < -40) root.visible = false;
    } else {
      const f = Math.min(1, S.state.timer / 0.7);
      root.rotation.x = -f * f * (Math.PI / 2 - 0.1);
      placeDeathCamera(rawDt);
    }
    if (!S.state.overShown && S.state.timer >= HERO.overAfter) {
      S.state.overShown = true;
      if (S.over) {
        S.over.querySelector('.hero-over-cause').textContent = S.state.deathSub;
        S.over.classList.add('visible');
      }
      // The card on its own: the banner and the HUD step aside for it
      // (startHero brings the HUD back).
      if (S.banner) S.banner.classList.remove('visible');
      S.state.bannerTimer = 0;
      if (S.hud) S.hud.classList.remove('visible');
      clearHurt();
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }

  // ---------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------

  // Bullet Time's drift round Roger (placeFollowCamera), radians.
  let btOrbit = 0;
  let btLast = performance.now();

  /**
   * Behind and above Roger, looking a little ahead of him.
   * @param {number} k how far to close on the goal this frame, 0..1
   * @returns {void}
   */
  function placeFollowCamera(k) {
    const p = S.roger.mesh.position;
    // Bullet Time (player/abilities.js): the camera drifts slowly round him
    // and back a little, so the hanging bullets can be looked round; it
    // swings back behind him when it ends. In first person the mouse looks.
    const now = performance.now();
    const step = Math.min(0.05, (now - btLast) / 1000);
    btLast = now;
    const bt = ctx.systems.post.Post.bulletTime > 0;
    btOrbit = bt ? btOrbit + step * 0.32 : btOrbit * Math.max(0, 1 - step * 3);
    const heading = S.state.heading + btOrbit;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    // At a life-size man's distance the camera sits below the roofs, so it
    // is pulled in towards him when a building stands between them, rather
    // than ending up inside it looking at a wall.
    let back = HERO.followBack;
    for (let i = 1; i <= HERO.cameraProbes; i++) {
      const d = HERO.followBack * i / HERO.cameraProbes;
      if (api.inBuilding(p.x - fx * d, p.z - fz * d, HERO.cameraClearance)) {
        back = Math.max(HERO.cameraMinBack, d - HERO.followBack / HERO.cameraProbes);
        break;
      }
    }
    const pull = 1 + Math.min(1, Math.abs(btOrbit) * 2) * 0.35;
    S.camGoal.set(p.x - fx * back * pull, HERO.followHeight * pull, p.z - fz * back * pull);
    S.lookAt.set(p.x + fx * HERO.lookAhead, HERO.lookHeight, p.z + fz * HERO.lookAhead);
    const cam = Sim.three.camera;
    cam.position.lerp(S.camGoal, k);
    if (cam.position.y < HERO.lookHeight) cam.position.y = HERO.lookHeight;
    Sim.three.controls.target.lerp(S.lookAt, k);
    cam.lookAt(Sim.three.controls.target);
  }

  /**
   * First person: at Roger's eyes, looking where the mouse points, with the
   * rifle held in front in the lower right. Eased in over a few frames from
   * the follow camera, then locked to the look exactly.
   * @param {number} rawDt
   * @returns {void}
   */
  function placeAimCamera(rawDt) {
    const p = S.roger.mesh.position;
    const cam = Sim.three.camera;
    S.state.aimBlend = Math.min(1, S.state.aimBlend + rawDt * 5);
    const k = S.state.aimBlend >= 1 ? 1 : Math.min(1, rawDt * 14);
    // A step's bob while walking, and the kick of the last shot.
    const bob = S.state.speed > 0 ? Math.sin(performance.now() * 0.011) * 0.05 : 0;
    S.camGoal.set(p.x, HERO.eyeHeight + bob, p.z);
    cam.position.lerp(S.camGoal, k);
    S.eyeEuler.set(S.state.pitch + S.state.recoil * 0.035, S.state.yaw + Math.PI, 0);
    S.eyeQuat.setFromEuler(S.eyeEuler);
    cam.quaternion.slerp(S.eyeQuat, k);
    const fov = THREE.MathUtils.lerp(S.state.savedFov, HERO.aimFov, S.state.aimBlend);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    const cp = Math.cos(S.state.pitch);
    S.aimDir.set(Math.sin(S.state.yaw) * cp, Math.sin(S.state.pitch), Math.cos(S.state.yaw) * cp);
    Sim.three.controls.target.copy(cam.position).addScaledVector(S.aimDir, 10);
    // The rifle, placed in the camera's own frame: right, down and ahead,
    // pushed back by the recoil and swaying with the walk.
    if (S.viewRifle) {
      const g = S.viewRifle.group;
      const sway = S.state.speed > 0 ? Math.sin(performance.now() * 0.0055) : 0;
      g.position.set(0.3 + sway * 0.012, -0.29 + Math.abs(sway) * 0.012 + S.state.recoil * 0.03, -0.32 + S.state.recoil * 0.14)
        .applyQuaternion(cam.quaternion).add(cam.position);
      g.quaternion.copy(cam.quaternion);
      g.rotateX(S.state.recoil * 0.12);
      g.updateMatrixWorld(true);
    }
    // The Katana's blade (hero/katana/model.js) while it is the weapon in hand.
    if (S.katanaRig) S.katanaRig.placeView(cam, S.weapons.current() === 'katana');
    S.weapons.placeView(cam, S.state.speed > 0 ? Math.sin(performance.now() * 0.0055) : 0);
  }

  /**
   * Holding on the moment he is caught: a slow turn round him.
   * @param {number} dt
   * @returns {void}
   */
  function placeDeathCamera(dt) {
    const p = S.roger.mesh.position;
    const a = S.state.heading + Math.PI * 0.75 + S.state.timer * 0.35;
    S.camGoal.set(p.x + Math.sin(a) * HERO.followBack, HERO.followHeight, p.z + Math.cos(a) * HERO.followBack);
    const cam = Sim.three.camera;
    cam.position.lerp(S.camGoal, Math.min(1, dt * 3));
    Sim.three.controls.target.set(p.x, HERO.lookHeight, p.z);
    cam.lookAt(Sim.three.controls.target);
  }

  // ---------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------

  /**
   * @param {number} threat distance to the nearest machine hunting him
   * @param {number} rawDt
   * @returns {void}
   */
  function updateHud(threat, rawDt) {
    if (!S.hud) return;
    /** @type {HTMLElement} */ (S.hud.querySelector('.hero-cell i')).style.width = `${S.state.cell.toFixed(0)}%`;
    S.hud.querySelector('.hero-cellpct').textContent = `${Math.floor(S.state.cell)}%`;
    const wname = S.hud.querySelector('.hero-wname');
    wname.textContent = S.weapons.hudLine();
    wname.style.color = S.weapons.hudColour();
    // The HEALTH bar (engine/health): width, percentage, the glow level and
    // the low state are each written only when they change, like the energy
    // bar below; the glow's pulse itself is a CSS animation.
    const health = ctx.systems.health;
    if (health) {
      const hp = Math.ceil(health.state('0').value);
      const glow = (Math.round(health.glow('0') * GLOW_STEPS) / GLOW_STEPS).toFixed(2);
      const shownHp = `${hp}|${glow}`;
      if (S.hud.dataset.health !== shownHp) {
        S.hud.dataset.health = shownHp;
        /** @type {HTMLElement} */ (S.hud.querySelector('.hero-hbar i')).style.width = `${((hp / HEALTH.max) * 100).toFixed(0)}%`;
        S.hud.querySelector('.hero-hpct').textContent = `${hp}%`;
        const row = /** @type {HTMLElement} */ (S.hud.querySelector('.hero-health'));
        row.style.setProperty('--glow', glow);
        row.classList.toggle('glowing', Number(glow) > 0);
        const low = hp <= HEALTH.max * HEALTH.lowThreshold;
        row.classList.toggle('low', low);
        if (S.hurt) S.hurt.classList.toggle('low', low && !S.state.overShown);
      }
    }
    // The partner's small bar in co-op (the local bar above stays the large one).
    const net = ctx.systems.net;
    const partner = net && net.coopActive() ? net.players.get('1') : null;
    const partnerRow = /** @type {HTMLElement} */ (S.hud.querySelector('.hero-partner'));
    const partnerHp = partner && health ? (partner.state === 'up' ? Math.ceil(health.state('1').value) : 0) : -1;
    if (S.hud.dataset.partner !== String(partnerHp)) {
      S.hud.dataset.partner = String(partnerHp);
      partnerRow.hidden = partnerHp < 0;
      if (partnerHp >= 0) {
        /** @type {HTMLElement} */ (partnerRow.querySelector('.hero-pbar i')).style.width = `${((partnerHp / HEALTH.max) * 100).toFixed(0)}%`;
        partnerRow.querySelector('.hero-ppct').textContent = partner.state === 'up' ? `${partnerHp}%` : 'DOWN';
        partnerRow.classList.toggle('low', partnerHp <= HEALTH.max * HEALTH.lowThreshold);
      }
    }
    updateHurtArrow(rawDt);
    // The energy bar: ten segments (engine/player/energy.js), and the
    // abilities it pays for.
    // Each segment is filled as far as the level goes (the one being filled
    // part way), written only when the level changes; the bar glows for a
    // moment after an explosion charged it.
    const level = ctx.systems.energy.hero.level();
    const shown = level.toFixed(3);
    if (S.hud.dataset.energy !== shown) {
      S.hud.dataset.energy = shown;
      const segments = S.hud.querySelectorAll('.hero-ebar i');
      for (let i = 0; i < segments.length; i++) {
        const fill = Math.max(0, Math.min(1, level * ENERGY.segments - i));
        /** @type {HTMLElement} */ (segments[i]).style.setProperty('--fill', `${(fill * 100).toFixed(0)}%`);
      }
      S.hud.querySelector('.hero-epct').textContent = `${Math.round(level * 100)}%`;
    }
    S.hud.querySelector('.hero-energy').classList.toggle('charging', ctx.systems.energy.flashing());
    S.hud.querySelector('.hero-abilities').textContent = ctx.systems.abilities.hudLine();
    S.hud.classList.toggle('low', S.state.cell < HERO.cellCost);
    const chargePct = (S.state.charge / HERO.chargeSeconds) * 100;
    /** @type {HTMLElement} */ (S.hud.querySelector('.hero-chargebar i')).style.width = `${chargePct.toFixed(0)}%`;
    S.hud.querySelector('.hero-chargepct').textContent = S.state.megaReady ? 'MEGA' : `${S.state.charge.toFixed(1)} s`;
    if (S.crosshair) S.crosshair.style.setProperty('--charge', `${(chargePct / 100).toFixed(3)}`);
    const p = S.roger.mesh.position;
    const bx = S.bunker.x - p.x;
    const bz = S.bunker.z - p.z;
    S.hud.querySelector('.hero-dist').textContent = `${Math.round(Math.hypot(bx, bz))} m`;
    // The arrow points the way to the bunker as seen on screen: up is the
    // way the camera looks.
    const cam = Sim.three.camera;
    cam.getWorldDirection(S.scratch);
    const cl = Math.hypot(S.scratch.x, S.scratch.z) || 1;
    const fx = S.scratch.x / cl;
    const fz = S.scratch.z / cl;
    const across = -fz * bx + fx * bz;
    const ahead = fx * bx + fz * bz;
    /** @type {HTMLElement} */ (S.hud.querySelector('.hero-arrow')).style.transform = `rotate(${Math.atan2(across, ahead)}rad)`;
    // Nothing hunting him: the tracker says why and stops pulsing.
    const hunting = Number.isFinite(threat);
    const idle = S.pursuers.every(unit => unit.p.state === 'gone') ? 'DOWN FOR GOOD'
      : S.pursuers.some(unit => unit.p.state === 'down') ? 'REBOOTING…' : 'SHORTING OUT';
    S.hud.querySelector('.hero-tdist').textContent = hunting ? `${Math.round(threat)} m` : idle;
    S.hud.classList.toggle('clear', !hunting);
    const blip = /** @type {HTMLElement} */ (S.hud.querySelector('.hero-blip'));
    blip.style.animationDuration = `${THREE.MathUtils.clamp(threat / 60, 0.18, 1.4).toFixed(2)}s`;
    S.hud.classList.toggle('danger', threat < 25);
    const charge = ctx.systems.empCharge ? ctx.systems.empCharge.chargedTimeLeft() : 0;
    S.hud.classList.toggle('charged', charge > 0);
    if (charge > 0) S.hud.querySelector('.hero-emptime').textContent = `${Math.ceil(charge)} s`;
    if (S.state.msgTimer > 0) {
      S.state.msgTimer -= rawDt;
      if (S.state.msgTimer <= 0) S.hud.querySelector('.hero-msg').textContent = '';
    }
    if (S.state.hintTimer > 0) {
      S.state.hintTimer -= rawDt;
      S.hud.classList.toggle('hint', S.state.hintTimer > 0);
    }

    if (S.crosshair && S.state.phase === 'aiming') {
      // What the beam would hit, checked each frame: red over anything it
      // would blast, with its name under the crosshair.
      const hit = api.traceAim(cam.position, S.aimDir);
      S.state.aimKind = hit.kind;
      const weaponHot = S.weapons.isHot(hit.kind);
      const hot = weaponHot !== null ? weaponHot : hit.kind === 'terminator' || hit.kind === 'unit' || hit.kind === 'enemy' || hit.kind === 'tornado'
        || hit.kind === 'alien' || hit.kind === 'person' || hit.kind === 'ship' || hit.kind === 'tanker' || hit.kind === 'nuclear';
      S.crosshair.classList.toggle('on', hot);
      S.crosshair.style.setProperty('--gap', `${(5 + S.state.spread * 14 + (S.state.speed > 0 ? 4 : 0)).toFixed(1)}px`);
      const label = hit.kind === 'ship' ? hit.obj.name : ({
        terminator: 'TERMINATOR', unit: 'TERMINATOR', tornado: 'TORNADO', alien: 'ALIEN', person: 'CIVILIAN',
        building: 'BUILDING', car: 'CAR', tanker: 'FUEL TANKER', nuclear: 'NUCLEAR PLANT', tree: '', ground: '', sky: ''
      })[hit.kind];
      S.crosshair.querySelector('.hero-target').textContent = hit.kind === 'sky' ? '' : `${label}${label ? ' · ' : ''}${Math.round(hit.t)} m`;
    }
  }

  return { showBanner, notify, flashMessage, killRoger, hitArea, announce, checkChasm, updateDeath, hurtFlash, clearHurt, placeFollowCamera, placeAimCamera, placeDeathCamera, updateHud };
}
