// @ts-check
import * as THREE from 'three';
import { setOffExplosivesAt } from '../explosives.js';
import { SHIP_DAMAGE, HERO } from './config.js';
import { PERSON, CHARACTERS } from '../scale.js';
import { chipTarget, fullHealth } from '../health/enemyDamage.js';
import { insideMuzzleGuard, mayHurtPlayer, splashAmount } from '../health/friendlyFire.js';
import { HEALTH } from '../health/config.js';
import { createWeaponFx } from './weaponFx.js';
import { createShooter, tell, credit, KILL_CREDIT, pointAlong, withinRange } from './shooter.js';
import { buildBeamMeshes, placeBeamMesh, fadeBeamMeshes, buildRingMeshes, placeRingMeshes, ringsTotal } from './plasmaBeam.js';

/**
 * ===========================================================================
 * SECTION HM.4 — Aiming and the plasma rifle
 * ===========================================================================
 * The aim view, the ray trace against the town, the plasma shot and its
 * hits, and the charged MEGA BEAM (rings, the beam, what it neutralises).
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see heroMode.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createHeroPlasma(ctx, S, api) {
  const { Sim, container } = ctx;
  /** Announces the rifle's shots to the co-op guest (hero/weaponFx.js); nothing happens outside a room with a guest. */
  const weaponFx = createWeaponFx(ctx);
  /** The host's Roger as a shooter (hero/shooter.js): refilled with the camera and the aim at the top of each shot. */
  const hostShot = createShooter('0', true);
  /** @param {string} text @returns {void} the host's screen */
  const flash = (text) => api.flashMessage(text);
  /** @param {import('./shooter.js').Shooter} shooter @param {string} text @returns {void} to the shooter's own screen */
  const say = (shooter, text) => tell(shooter, text, flash);

  /**
   * The trigger goes down: the charge starts. The rifle has no ammunition
   * or cell to run dry (removed 2026-10-03, on request): only its short
   * cooldown between shots.
   * @returns {void}
   */
  function beginCharge() {
    if (S.state.phase !== 'aiming' || S.state.charging) return;
    S.state.charging = true;
    S.state.charge = 0;
    S.state.megaReady = false;
    ctx.systems.heroSound.startCharge();
  }

  /**
   * The trigger comes up: the shot goes, at whatever charge it has.
   * @returns {void}
   */
  function releaseCharge() {
    if (!S.state.charging) return;
    const level = S.state.charge;
    cancelCharge();
    firePlasma(level);
  }

  /**
   * Stops a charge without firing (the rifle put away, the window losing
   * focus, Roger knocked down).
   * @returns {void}
   */
  function cancelCharge() {
    if (S.state.charging) ctx.systems.heroSound.stopCharge();
    S.state.charging = false;
    S.state.charge = 0;
    S.state.megaReady = false;
    if (S.crosshair) S.crosshair.classList.remove('mega', 'charging');
    if (S.hud) S.hud.classList.remove('charging', 'mega');
  }

  /**
   * Per frame while the trigger is held: the charge filling, the hum
   * climbing, the rifle glowing.
   * @param {number} dt
   * @returns {void}
   */
  function updateCharge(dt) {
    const level = S.state.charging ? S.state.charge / HERO.chargeSeconds : 0;
    if (S.viewRifle) {
      // The rifle's energy strips brighten, and a ball of plasma grows at
      // the muzzle -- kept under bloom's glare (see buildViewRifle).
      S.viewRifle.energy.color.setRGB(0.22 + level * 0.5, 0.8 + level * 0.9, 1.35 + level * 1.3);
      const orb = S.viewRifle.flash;
      if (S.state.charging) {
        orb.visible = true;
        orb.userData.life = 0;
        // Small: this close to the eye, a bigger ball blooms into a glare
        // over half the view.
        orb.material.opacity = (0.12 + 0.3 * level) * (0.85 + 0.15 * Math.random());
        orb.scale.setScalar(0.3 + level * 0.55);
      }
    }
    if (!S.state.charging) return;
    S.state.charge = Math.min(HERO.chargeSeconds, S.state.charge + dt);
    ctx.systems.heroSound.updateCharge(S.state.charge / HERO.chargeSeconds);
    if (S.hud) S.hud.classList.add('charging');
    if (S.crosshair) S.crosshair.classList.add('charging');
    if (!S.state.megaReady && S.state.charge >= HERO.chargeSeconds) {
      S.state.megaReady = true;
      api.flashMessage('⚡ MEGA BEAM READY');
      if (S.hud) S.hud.classList.add('mega');
      if (S.crosshair) S.crosshair.classList.add('mega');
    }
  }

  /**
   * The right mouse button: the rifle drawn (aim mode) or put away.
   * @returns {void}
   */
  function toggleAim() {
    if (S.state.phase === 'aiming') leaveAim();
    else enterAim();
  }

  /**
   * Into first person: the weapon in hand comes up (the Katana too), Roger's own figure is hidden,
   * the crosshair appears and the pointer is locked.
   * @returns {void}
   */
  function enterAim() {
    if (S.state.phase !== 'running') return;
    // Raising the view mid-Blade-Mode would re-aim its cut line: it ends instead.
    if (S.weapons.katanaBlade().active()) S.weapons.katanaCancel();
    S.state.drawn = true;
    if (S.rifle) S.rifle.visible = true;
    S.state.phase = 'aiming';
    S.state.yaw = S.state.heading;
    S.state.pitch = 0.02;
    S.state.aimBlend = 0;
    S.state.speed = 0;
    if (!S.viewRifle) S.viewRifle = api.buildViewRifle();
    S.viewRifle.group.visible = S.weapons.current() === 'rifle';
    S.weapons.showView(true);
    S.roger.mesh.visible = false;
    S.overhead.visible = false;
    const cam = Sim.three.camera;
    S.state.savedFov = cam.fov;
    if (S.crosshair) S.crosshair.classList.add('visible');
    if (S.hud) S.hud.classList.add('aiming');
    const canvas = Sim.three.renderer.domElement;
    // On a touch screen the right thumb looks (hero/touch.js): no lock.
    if (S.touchActive) return;
    try {
      const request = canvas.requestPointerLock && canvas.requestPointerLock();
      if (request && typeof request.catch === 'function') request.catch(() => {});
    } catch {
      // No lock (an embedding frame may not allow it): the mouse still looks.
    }
  }

  /**
   * Back to the follow camera, the weapon lowered.
   * @returns {void}
   */
  function leaveAim() {
    cancelCharge();
    // Blade Mode ends with the view (right-click out, Esc, pointer-lock loss, a wheel change).
    if (S.weapons.katanaBlade().active()) S.weapons.katanaCancel();
    if (S.state.phase === 'aiming') S.state.phase = 'running';
    S.state.drawn = false;
    if (S.rifle) S.rifle.visible = false;
    S.state.heading = S.state.yaw;
    if (S.roger) S.roger.mesh.visible = true;
    if (S.overhead) S.overhead.visible = true;
    if (S.viewRifle) S.viewRifle.group.visible = false;
    if (S.katanaRig) S.katanaRig.placeView(Sim.three.camera, false);
    S.weapons.showView(false);
    if (S.crosshair) S.crosshair.classList.remove('visible');
    if (S.hud) S.hud.classList.remove('aiming');
    const cam = Sim.three.camera;
    cam.fov = S.state.savedFov;
    cam.updateProjectionMatrix();
    if (document.pointerLockElement === Sim.three.renderer.domElement) document.exitPointerLock();
    S.state.locked = false;
  }

  /**
   * Where a ray from the eye along `dir` meets a vertical cylinder standing
   * on the ground (or from y0 to y1), if it does, nearer than `max`.
   * @param {THREE.Vector3} o
   * @param {THREE.Vector3} d unit
   * @param {number} cx
   * @param {number} cz
   * @param {number} r
   * @param {number} y0
   * @param {number} y1
   * @returns {number} distance along the ray; Infinity for a miss
   */
  function rayCylinder(o, d, cx, cz, r, y0, y1) {
    const ox = o.x - cx;
    const oz = o.z - cz;
    const a = d.x * d.x + d.z * d.z;
    if (a < 1e-8) return Infinity;
    const b = ox * d.x + oz * d.z;
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - a * c;
    if (disc < 0) return Infinity;
    const t = (-b - Math.sqrt(disc)) / a;
    if (t < 0.5) return Infinity;
    const y = o.y + d.y * t;
    return y >= y0 && y <= y1 ? t : Infinity;
  }

  /**
   * A closed cylinder: its side (rayCylinder) and its two flat ends. For a
   * ship overhead, where the sights come up through its belly rather than
   * in at its rim.
   * @param {THREE.Vector3} o
   * @param {THREE.Vector3} d unit
   * @param {number} cx
   * @param {number} cz
   * @param {number} r
   * @param {number} y0
   * @param {number} y1
   * @returns {number} distance along the ray; Infinity for a miss
   */
  function rayCappedCylinder(o, d, cx, cz, r, y0, y1) {
    let best = rayCylinder(o, d, cx, cz, r, y0, y1);
    if (Math.abs(d.y) > 1e-6) {
      for (const y of [y0, y1]) {
        const t = (y - o.y) / d.y;
        if (t < 0.5 || t >= best) continue;
        if (Math.hypot(o.x + d.x * t - cx, o.z + d.z * t - cz) <= r) best = t;
      }
    }
    return best;
  }

  /**
   * Slab test against an axis-aligned box.
   * @param {THREE.Vector3} o
   * @param {THREE.Vector3} d unit
   * @param {number[]} lo min x, y, z
   * @param {number[]} hi max x, y, z
   * @returns {number} distance along the ray; Infinity for a miss
   */
  function rayBox(o, d, lo, hi) {
    let tMin = 0;
    let tMax = Infinity;
    const os = [o.x, o.y, o.z];
    const ds = [d.x, d.y, d.z];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(ds[i]) < 1e-9) {
        if (os[i] < lo[i] || os[i] > hi[i]) return Infinity;
        continue;
      }
      let t1 = (lo[i] - os[i]) / ds[i];
      let t2 = (hi[i] - os[i]) / ds[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return Infinity;
    }
    return tMin > 0.5 ? tMin : Infinity;
  }

  /**
   * What is first down the crosshair: the funnel, the Terminator, an alien,
   * a person, a car, a tree, a building, the ground, or nothing (the sky).
   * Shapes are the simple ones each thing stands in: an upright cylinder, or
   * a building's footprint box.
   * @param {THREE.Vector3} o
   * @param {THREE.Vector3} d unit
   * @returns {{t: number, kind: string, obj: Object|null}}
   */
  function traceAim(o, d) {
    let t = HERO.beamRange;
    let kind = 'sky';
    /** @type {Object|null} */
    let obj = null;
    /**
     * @param {number} hit
     * @param {string} k
     * @param {Object|null} what
     * @returns {void}
     */
    const take = (hit, k, what) => {
      if (hit < t) {
        t = hit;
        kind = k;
        obj = what;
      }
    };
    if (d.y < -1e-4) take(-o.y / d.y, 'ground', null);
    for (const building of ctx.Environment.buildings) {
      if (building.damageState === 'collapsed') continue;
      const fp = building.mesh.userData.footprint;
      if (!fp) continue;
      const b = building.mesh.position;
      const h = (building.mesh.userData.wallHeight || 6) * 1.3;
      take(rayBox(o, d, [b.x - fp.width / 2, 0, b.z - fp.depth / 2], [b.x + fp.width / 2, h, b.z + fp.depth / 2]), 'building', building);
    }
    for (const person of ctx.Environment.people) {
      if (!person.mesh.parent || person.abducted) continue;
      const q = person.mesh.position;
      take(rayCylinder(o, d, q.x, q.z, PERSON.height * 0.2, q.y - 0.2, q.y + PERSON.height * 1.05), 'person', person);
    }
    for (const car of ctx.Environment.cars) {
      if (!car.mesh || !car.mesh.parent) continue;
      const q = car.mesh.position;
      take(rayCylinder(o, d, q.x, q.z, 2.4, q.y - 1.5, q.y + 2.2), 'car', car);
    }
    // The fuel tanker (environment/tanker.js): the tank and the cab.
    const tanker = ctx.systems.tanker && ctx.systems.tanker.tankerTarget();
    for (const part of tanker || []) take(rayCylinder(o, d, part.x, part.z, part.radius, 0, part.top), 'tanker', part);
    // The nuclear plants (engine/nuclear.js): each building of the site.
    if (ctx.systems.nuclear) {
      for (const part of ctx.systems.nuclear.aimTargets()) {
        take(rayCylinder(o, d, part.x, part.z, part.radius, 0, part.top), 'nuclear', part.plant);
      }
    }
    for (const tree of ctx.Environment.trees) {
      if (tree.damageState !== 'intact' || !tree.mesh || !tree.mesh.parent) continue;
      const q = tree.mesh.position;
      take(rayCylinder(o, d, q.x, q.z, 1.4, 0, 8), 'tree', tree);
    }
    const aliens = ctx.systems.aliens;
    if (aliens) {
      for (const alien of aliens.targets()) {
        const q = alien.root.position;
        take(rayCylinder(o, d, q.x, q.z, CHARACTERS.alien.height * 0.25, 0, CHARACTERS.alien.height * 1.05), 'alien', alien);
      }
    }
    for (const unit of api.huntingPursuers()) {
      const q = unit.root.position;
      take(rayCylinder(o, d, q.x, q.z, CHARACTERS.terminator.height * 0.3, 0, CHARACTERS.terminator.height * HERO.pursuerScale * 1.05), 'terminator', unit);
    }
    // The Terminator squad (terminator.js), which comes for him too.
    if (ctx.systems.terminator) {
      for (const unit of ctx.systems.terminator.walkingUnits()) {
        const q = unit.root.position;
        take(rayCylinder(o, d, q.x, q.z, CHARACTERS.terminator.height * 0.28, 0, CHARACTERS.terminator.height * 1.05), 'unit', unit);
      }
    }
    // Landing Support's samurai (engine/spaceship/samurai.js): nothing but
    // Roger's weapons can touch them, and these can.
    const support = ctx.systems.spaceship;
    if (support) {
      for (const box of support.samuraiTargets()) take(rayCylinder(o, d, box.x, box.z, box.radius, 0, box.top), 'samurai', box.unit);
    }
    // Enemies of the shared register with a hitbox (engine/enemies.js): the
    // cyber T-Rex, and the enemies to come.
    for (const enemyKind of ctx.systems.enemies.kinds()) {
      if (!enemyKind.hitbox) continue;
      for (const e of enemyKind.list()) {
        const box = enemyKind.hitbox(e);
        take(rayCylinder(o, d, box.x, box.z, box.radius, 0, box.top), 'enemy', { e, kind: enemyKind });
      }
    }
    // The ships in the air: the alien ship, the hunters, the mothership.
    const ships = [...(aliens ? aliens.shipTargets() : [])];
    const mother = ctx.systems.mothership && ctx.systems.mothership.shipTarget();
    if (mother) ships.push(mother);
    for (const ship of ships) take(rayCappedCylinder(o, d, ship.x, ship.z, ship.radius, ship.bottom, ship.top), 'ship', ship);
    for (const { Vortex } of ctx.tornadoes.active) {
      if (Vortex.neutralized || Vortex.birth < 0.5) continue;
      const R = Sim.params.radius * (Vortex.sizeMul || 1) * 0.9;
      take(rayCylinder(o, d, Vortex.center.x, Vortex.center.z, R, 0, 400), 'tornado', Vortex);
    }
    return { t, kind, obj };
  }

  /**
   * The beam's meshes, made on the first shot of a run: a unit length
   * along +y from its base, stretched and pointed per frame.
   * @returns {void}
   */
  function buildBeam() {
    const meshes = buildBeamMeshes(Sim.three.scene, api);
    S.beam = meshes.beam;
    S.beamSplash = meshes.splash;
  }

  /**
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} to
   * @returns {void}
   */
  function placeBeam(from, to) {
    placeBeamMesh(S.beam, from, to, S.scratchB);
  }

  /**
   * The shot: straight down the crosshair from the eye, drawn from the
   * rifle's muzzle to wherever that lands, and everything there blasted.
   * @param {number} level seconds the trigger was held; HERO.chargeSeconds
   *   and over is a mega beam
   * @returns {void}
   */
  function firePlasma(level) {
    if (S.state.plasmaTimer > 0 || !S.viewRifle) return;
    const mega = level >= HERO.chargeSeconds;
    S.state.plasmaTimer = HERO.plasmaCooldown;
    S.state.beamMega = mega;
    S.state.beamLength = mega ? HERO.megaBeamSeconds : HERO.beamSeconds;
    // Part of a charge widens a normal shot a little; a full one is the mega.
    S.state.beamWidth = mega ? HERO.megaWidth : 1 + 0.35 * (level / HERO.chargeSeconds);
    S.state.beamTimer = S.state.beamLength;
    S.state.recoil = mega ? 1.6 : 1;
    S.state.spread = 1;
    const cam = Sim.three.camera;
    hostShot.eye = cam.position;
    hostShot.dir = S.aimDir;
    const hit = traceBeam(hostShot, mega, S.beamTo);
    if (!S.beam) buildBeam();
    S.beam.visible = true;
    S.beamSplash.visible = hit.kind !== 'sky';
    S.beamSplash.position.copy(S.beamTo);
    S.viewRifle.flash.visible = true;
    S.viewRifle.flash.userData.life = 0.12;
    ctx.systems.heroSound.playPlasma(S.state.beamLength);
    // public/sounds/sonic-boom.mp3 on every shot, louder for a mega beam.
    ctx.systems.cues.playSonicBoom(mega ? 1.4 : 0.75);
    if (mega) {
      ctx.systems.heroSound.playMegaBoom();
      ctx.systems.gamefeel.addShake(2.4, 0.8);
      ctx.systems.lightning.flashScreen(S.beamTo, 0.3, '#bfe6ff');
      launchRings();
      trailFire(cam.position, hit.t);
    } else {
      ctx.systems.gamefeel.addShake(0.9, 0.35);
    }
    if (hit.kind !== 'sky') plasmaHit(hit, S.beamTo, mega, hostShot);
    weaponFx.announce(mega ? 'mega' : 'plasma', cam.position, S.beamTo, hit.kind, Math.round(level * 100));
  }

  /**
   * The beam's trace: down the shooter's aim from its eye to whatever is first
   * there, the end point into `to`, and the other Rogers in the line of fire
   * hurt once (co-op friendly fire, R-053; the blast at the end then finds
   * them already hit).
   * @param {import('./shooter.js').Shooter} shooter
   * @param {boolean} mega
   * @param {THREE.Vector3} to receives the end point
   * @returns {{t: number, kind: string, obj: Object|null}}
   */
  function traceBeam(shooter, mega, to) {
    const eye = /** @type {THREE.Vector3} */ (shooter.eye);
    const dir = /** @type {THREE.Vector3} */ (shooter.dir);
    const hit = traceAim(eye, dir);
    to.copy(eye).addScaledVector(dir, hit.t);
    if (ctx.systems.net) ctx.systems.net.hurtRay(shooter.id, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, hit.t, mega ? 'mega' : 'plasma');
    return hit;
  }

  /**
   * A co-op guest's rifle tap, resolved by the host's own code: the same
   * trace and friendly-fire ray, the same `plasmaHit` where it lands (the
   * thing hit, the blast round the point, the people in it), announced with
   * the guest as shooter. No charge, no beam on this screen (the net mirror
   * draws that), no shake, no sound of the host's own.
   * @param {import('./shooter.js').Shooter} shooter
   * @param {number} range metres the guest's rifle reaches
   * @param {THREE.Vector3} to receives the end point
   * @returns {string} the `traceAim` kind the shot ended on
   */
  function guestPlasma(shooter, range, to) {
    const eye = /** @type {THREE.Vector3} */ (shooter.eye);
    const dir = /** @type {THREE.Vector3} */ (shooter.dir);
    const hit = withinRange(traceAim(eye, dir), range);
    pointAlong(shooter, hit.t, to);
    if (ctx.systems.net) ctx.systems.net.hurtRay(shooter.id, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, hit.t, 'plasma');
    if (hit.kind !== 'sky') plasmaHit(hit, to, false, shooter);
    weaponFx.announce('plasma', shooter.muzzle || eye, to, hit.kind, 0, shooter.id);
    return hit.kind;
  }

  /**
   * The mega beam's rings of plasma: made on its first shot, then reused.
   * Tori round the beam's axis, bursting outwards from the muzzle one after
   * another and running a little way down the beam.
   * @returns {void}
   */
  function launchRings() {
    if (!S.rings.length) S.rings.push(...buildRingMeshes(Sim.three.scene, api));
    S.state.ringTimer = ringsTotal();
  }

  /**
   * Per frame: the rings running out from the muzzle along the beam and
   * opening up as they fade.
   * @param {number} dt
   * @returns {void}
   */
  function updateRings(dt) {
    if (S.state.ringTimer <= 0 || !S.rings.length) return;
    S.state.ringTimer -= dt;
    const total = ringsTotal();
    const since = total - S.state.ringTimer;
    const from = S.viewRifle ? S.viewRifle.muzzle.getWorldPosition(S.scratch) : S.scratch.copy(S.roger.mesh.position).setY(S.state.alt + HERO.muzzleHeight);
    placeRingMeshes(S.rings, since, from, S.beamTo, S.scratchB);
    if (S.state.ringTimer <= 0) for (const ring of S.rings) ring.visible = false;
  }

  /**
   * Fire running down the mega beam's length: bursts spaced along it, kept
   * back from the eye so they never white out the view.
   * @param {THREE.Vector3} eye
   * @param {number} length how far the beam runs
   * @returns {void}
   */
  function trailFire(eye, length) {
    for (let i = 1; i <= HERO.megaTrail; i++) {
      const d = 25 + (length - 25) * (i / (HERO.megaTrail + 1));
      if (d <= 25 || d >= length) continue;
      const at = eye.clone().addScaledVector(S.aimDir, d);
      at.x += (Math.random() - 0.5) * 1.5;
      at.y += (Math.random() - 0.5) * 1.5;
      at.z += (Math.random() - 0.5) * 1.5;
      ctx.systems.explosions.spawnImpactBurst(at, 0.6 + 0.6 * (d / length));
    }
  }

  /**
   * Friendly fire (D4): Roger's own blast hurts him if he stands inside it,
   * falling away with distance. Nothing for an impact inside the muzzle guard
   * (a trace that began inside geometry), or when friendly fire is off.
   * @param {{t: number}} hit
   * @param {THREE.Vector3} at
   * @param {number} radius
   * @param {boolean} mega
   * @param {import('./shooter.js').Shooter} shooter whose blast it is (a guest's hurts the host's Roger too)
   * @returns {void}
   */
  function hurtRogerInBlast(hit, at, radius, mega, shooter) {
    if (!HEALTH.friendlyFire.enabled || insideMuzzleGuard(hit.t)) return;
    // The partner in the blast (co-op friendly fire, D4).
    if (ctx.systems.net) ctx.systems.net.splashGuests(at, radius, mega ? 'mega' : 'plasma', shooter.id);
    if (!mayHurtPlayer(shooter.id, '0', { coop: !shooter.isHost, friendlyFire: true })) return;
    const p = S.roger.mesh.position;
    const amount = splashAmount(mega ? 'mega' : 'plasma', Math.hypot(p.x - at.x, p.z - at.z), radius);
    if (amount <= 0) return;
    ctx.systems.health.damagePlayer({
      source: 'friendlyFire', amount, type: 'blast', position: { x: at.x, y: at.y, z: at.z },
      title: 'FRIENDLY FIRE', sub: shooter.isHost ? 'Caught in your own blast' : `Caught in Player ${shooter.id}'s blast`
    });
  }

  /**
   * Everything the beam does where it lands: the thing it hit, then a blast
   * round the point -- far bigger for a mega beam.
   * @param {{t: number, kind: string, obj: Object|null}} hit
   * @param {THREE.Vector3} at
   * @param {boolean} mega
   * @param {import('./shooter.js').Shooter} [shooter] who fired (default: the host's Roger)
   * @returns {void}
   */
  function plasmaHit(hit, at, mega, shooter = hostShot) {
    const s = ctx.systems;
    // Scaled down up close, or a point-blank shot whites out the view.
    const near = THREE.MathUtils.clamp(hit.t / 25, 0.3, 1);
    s.explosions.spawnImpactBurst(at, (hit.kind === 'building' ? 3 : 2.2) * near * (mega ? 2.2 : 1));
    s.lightning.flashScreen(at, 0.45 * near, '#bfe6ff');
    if (hit.kind === 'tornado') {
      // A MEGA BEAM is enough for a funnel; a normal shot only chips its health (D3).
      if (mega) neutralise(hit.obj);
      else if (!chipTornado(hit.obj, { type: 'plasma' })) {
        say(shooter, `STRONG FUNNEL ${Math.round((hit.obj.health / fullHealth('tornado')) * 100)}% — hold ENTER ${HERO.chargeSeconds} s for a MEGA BEAM`);
      }
      return;
    }
    if (hit.kind === 'ship') {
      // Every shot holes it; a mega beam does SHIP_DAMAGE.mega times as much.
      const left = hit.obj.hit(mega ? SHIP_DAMAGE.mega : SHIP_DAMAGE.normal, at);
      if (left < 0) return;
      say(shooter, left === 0 ? `${hit.obj.name} GOING DOWN!` : `DIRECT HIT ON THE ${hit.obj.name} · HULL ${Math.round(left * 100)}%`);
      return;
    }
    if (hit.kind === 'nuclear') {
      // A mega beam goes straight through the containment; a normal shot chips it (engine/nuclear.js, D3).
      if (mega) {
        s.nuclear.megaHit(hit.obj);
        say(shooter, 'REACTOR BREACHED — GET CLEAR');
      } else if (s.nuclear.chipPlant(hit.obj, { type: 'plasma' })) {
        say(shooter, 'REACTOR BREACHED — GET CLEAR');
      } else {
        say(shooter, 'REINFORCED CONTAINMENT — a MEGA BEAM breaks it at once');
      }
      return;
    }
    if (hit.kind === 'tanker') {
      // Any shot sets it off: the biggest blast in the game (tanker.js).
      // Whichever of them it was: the one on the ring, or a parked one.
      if (hit.obj && hit.obj.detonate) hit.obj.detonate();
      else s.tanker.detonate();
      say(shooter, 'FUEL TANKER DETONATED');
      return;
    }
    if (hit.kind === 'terminator') {
      if (mega) api.megaKillPursuer(hit.obj);
      else api.knockdownPursuer(hit.obj);
    }
    if (hit.kind === 'unit') s.terminator.plasmaHit(hit.obj, mega, shooter.isHost ? S.roger.mesh.position : shooter.feet);
    if (hit.kind === 'enemy') {
      if (s.enemies.hit(hit.obj.e, hit.obj.kind, { type: 'plasma', mega, at })) { ctx.events.emit('rogerKill'); credit(shooter, KILL_CREDIT, false); }
    }
    if (hit.kind === 'alien') {
      s.aliens.plasmaKill(hit.obj, at);
      ctx.events.emit('rogerKill');
    }
    const R = mega ? HERO.megaBlastRadius : HERO.blastRadius;
    // A samurai hit, or caught in the blast.
    if (hit.kind === 'samurai') s.spaceship.hitSamurai(hit.obj, 'plasma');
    if (s.spaceship && s.spaceship.hitSamuraiArea(at.x, at.z, R, 'plasma')) ctx.events.emit('rogerKill');
    else if (hit.kind === 'samurai') ctx.events.emit('rogerKill');
    // The tanker, the chemical works, a gas main or a power line in the blast
    // goes off (engine/explosives.js).
    setOffExplosivesAt(ctx, at.x, at.z, R);
    hurtRogerInBlast(hit, at, R, mega, shooter);
    const { damageFromImpact, shockBuilding, addDamageScore, flattenTree } = s.damage;
    // The building it struck takes the whole of it, and catches.
    if (hit.kind === 'building') {
      damageFromImpact(hit.obj, at, mega ? HERO.megaImpactEnergy : HERO.impactEnergy);
      shockBuilding(hit.obj, mega ? HERO.megaBuildingShock : HERO.buildingShock, at);
      if (Math.random() < HERO.igniteChance && s.buildingFire) s.buildingFire.igniteBuilding(hit.obj);
    }
    // A mega beam takes down the buildings round the point too.
    if (mega) {
      for (const building of ctx.Environment.buildings) {
        if (building === hit.obj || building.damageState === 'collapsed') continue;
        const q = building.mesh.position;
        const d = Math.hypot(q.x - at.x, q.z - at.z);
        if (d < R) shockBuilding(building, HERO.megaBuildingShock * (1 - d / R) + 0.5, at);
      }
    }
    // People near it are blown apart.
    let killed = 0;
    for (const person of ctx.Environment.people.slice()) {
      if (!person.mesh.parent || person.abducted) continue;
      const q = person.mesh.position;
      if (Math.hypot(q.x - at.x, q.z - at.z) < R && q.y < at.y + 6) {
        s.people.explodePerson(person);
        killed++;
      }
    }
    if (killed) addDamageScore(20 * killed);
    if (killed) credit(shooter, 20 * killed, true);
    // A killing breaks Smooth Criminal's spell (engine/smoothCriminal.js).
    if (killed) ctx.events.emit('rogerKill');
    // Trees knocked flat, cars and anything loose thrown.
    for (const tree of ctx.Environment.trees) {
      if (tree.damageState !== 'intact' || !tree.mesh) continue;
      const q = tree.mesh.position;
      const dx = q.x - at.x;
      const dz = q.z - at.z;
      const d = Math.hypot(dx, dz);
      if (d < R) flattenTree(tree, dx / (d || 1), dz / (d || 1));
    }
    const throwForce = mega ? HERO.megaThrowForce : HERO.throwForce;
    for (const obj of Sim.objects) {
      if (obj.type === 'building' || obj.type === 'person' || obj.rooted || !obj.velocity) continue;
      const pos = obj.pooled ? obj.position : (obj.mesh && obj.mesh.position);
      if (!pos) continue;
      const dx = pos.x - at.x;
      const dz = pos.z - at.z;
      const d = Math.hypot(dx, dz);
      if (d > R * 1.6) continue;
      const k = throwForce * (1 - d / (R * 1.6));
      obj.velocity.x += (dx / (d || 1)) * k;
      obj.velocity.z += (dz / (d || 1)) * k;
      obj.velocity.y += k * 0.8;
      if (obj.angularVelocity) obj.angularVelocity.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
    }
    // Any alien in the blast is killed.
    if (s.aliens) {
      for (const alien of s.aliens.targets()) {
        const q = alien.root.position;
        if (Math.hypot(q.x - at.x, q.z - at.z) < R) {
          s.aliens.plasmaKill(alien, at);
          ctx.events.emit('rogerKill');
        }
      }
    }
    if (s.terminator && hit.kind !== 'unit') {
      for (const unit of s.terminator.walkingUnits()) {
        const q = unit.root.position;
        if (Math.hypot(q.x - at.x, q.z - at.z) < R * 0.7) s.terminator.plasmaHit(unit, mega, at);
      }
    }
    for (const unit of api.huntingPursuers()) {
      if (unit === hit.obj) continue;
      const q = unit.root.position;
      if (Math.hypot(q.x - at.x, q.z - at.z) < R * 0.7) {
        if (mega) api.megaKillPursuer(unit);
        else api.knockdownPursuer(unit);
      }
    }
    if (hit.kind === 'ground' && s.earthquake) s.earthquake.kickDust(at.x, at.z, mega ? 10 : 4, mega ? 3 : 1.6);
  }

  /**
   * One of Roger's weapons but the MEGA BEAM and the katana on a funnel (D3,
   * health/damageTable.js): a chip of its health, with no effect of its own.
   * At 0 it is neutralised like a MEGA BEAM (the existing removal path).
   * @param {Object} v the Vortex hit
   * @param {{type: string}} hit
   * @returns {boolean} whether it brought the funnel down
   */
  function chipTornado(v, hit) {
    if (v.neutralized) return false;
    const left = chipTarget('tornado', v.health, hit);
    v.health = left.health;
    if (!left.spent) return false;
    neutralise(v, 'Roger\'s weapons wore it down');
    return true;
  }

  /**
   * The hit: the funnel ropes out and is gone, with everything a moment like
   * that deserves.
   * @param {Object} v the Vortex hit
   * @param {string} [cause] for the banner
   * @returns {void}
   */
  function neutralise(v, cause = 'Roger\'s plasma beam') {
    v.neutralized = true;
    v.health = 0;
    S.state.neutralised = true;
    const base = new THREE.Vector3(v.center.x, 2, v.center.z);
    ctx.systems.explosions.spawnImpactBurst(base, 5);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.systems.explosions.spawnImpactBurst(base.clone().add(new THREE.Vector3(Math.cos(a) * 10, 3, Math.sin(a) * 10)), 2);
    }
    if (ctx.systems.earthquake) ctx.systems.earthquake.kickDust(base.x, base.z, 10, 4);
    ctx.systems.shockwaveSound.playShockwave();
    ctx.systems.cues.playLargeExplosion({ priority: true, gain: 1.4 });
    ctx.systems.gamefeel.event('tanker', base);
    ctx.systems.damage.addDamageScore(HERO.neutraliseScore);
    api.showBanner('TORNADO NEUTRALIZED', `${cause} · +${HERO.neutraliseScore}`);
  }

  /**
   * Per frame: the beam burning down, the muzzle flash, the rifle's charge
   * readout, the recoil settling.
   * @param {number} dt
   * @returns {void}
   */
  function updatePlasma(dt) {
    if (S.state.plasmaTimer > 0) S.state.plasmaTimer -= dt;
    S.state.recoil = Math.max(0, S.state.recoil - dt * 6);
    S.state.spread = Math.max(0, S.state.spread - dt * 3);
    updateRings(dt);
    if (S.viewRifle) {
      api.drawChargePanel(S.viewRifle);
      const f = S.viewRifle.flash;
      // While charging, the flash is the growing orb (updateCharge).
      if (f.visible && !S.state.charging) {
        f.userData.life -= dt;
        const k = Math.max(0, f.userData.life / 0.12);
        f.material.opacity = k;
        f.scale.setScalar(1 + (1 - k) * 3);
        if (k <= 0) f.visible = false;
      }
    }
    if (!S.beam || S.state.beamTimer <= 0) return;
    S.state.beamTimer -= dt;
    const from = S.state.phase === 'aiming' && S.viewRifle
      ? S.viewRifle.muzzle.getWorldPosition(S.scratch)
      : (S.muzzle ? S.muzzle.getWorldPosition(S.scratch) : S.scratch.copy(S.roger.mesh.position).setY(S.state.alt + HERO.muzzleHeight));
    placeBeam(from, S.beamTo);
    const k = Math.max(0, S.state.beamTimer / S.state.beamLength);
    fadeBeamMeshes(S.beam, S.beamSplash, k, S.state.beamWidth, S.state.beamMega);
    if (S.state.beamTimer <= 0) S.beam.visible = S.beamSplash.visible = false;
  }

  return { beginCharge, releaseCharge, cancelCharge, updateCharge, toggleAim, enterAim, leaveAim, rayCylinder, rayCappedCylinder, rayBox, traceAim, buildBeam, placeBeam, firePlasma, guestPlasma, launchRings, updateRings, trailFire, plasmaHit, neutralise, chipTornado, updatePlasma };
}
