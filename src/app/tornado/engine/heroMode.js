import * as THREE from 'three';
import { bannerHost } from '../utils/banners.js';
import { createHeroWeapons, MINIGUN } from './heroWeapons.js';
import { HERO, EXCLUSIVE_BUTTONS } from './hero/config.js';
import { createHeroModels } from './hero/models.js';
import { createHeroMovement } from './hero/movement.js';
import { createHeroInput } from './hero/input.js';
import { createHeroPlasma } from './hero/plasma.js';
import { createHeroCar } from './hero/car.js';
import { createHeroPursuers } from './hero/pursuers.js';
import { createHeroScreen } from './hero/screen.js';
import { ENERGY } from './player/energy.js';
import { fullHealth } from './health/enemyDamage.js';
export { SHIP_DAMAGE } from './hero/config.js';

/**
 * ===========================================================================
 * SECTION AM — Hero Mode
 * ===========================================================================
 * A playable sequence of its own: the player is Roger, on foot in the storm,
 * and has to get to a marked bunker across town with two Terminators on
 * his heels (HERO.pursuers; it was one), set off together on either side of
 * the line behind him. Started and ended from the panel (btn-hero); it does not start the
 * tornado (the Tornado button or a preset does that), so Roger can take on
 * the aliens first. It ends when Roger reaches the bunker (SAFE) or dies,
 * which puts up a GAME OVER card with Restart and Exit; either way the
 * camera goes back the way it was found.
 *
 * Roger is one of the town's own figures (people.js createPerson) with his
 * own look, a name tag and a run cycle driven by the ground he covers, so the
 * legs never slide. He runs at the Chase Mode car's top speed
 * (HERO.runSpeed, the Chase Mode car's old top speed), steered like the car with W A S D
 * keys (no WASD for movement; Q W E R are the abilities): up/down run and back off, left/right turn, with a
 * follow camera behind and above him.
 *
 * Three weapons, the mouse wheel to cycle on foot (engine/heroWeapons.js): the plasma
 * rifle below, a minigun (200 rounds, people and Terminators only -- 30
 * rounds bring a Terminator down), a yellow railgun that calls one
 * lightning bolt down per click where its ring lies on the ground (it kills
 * aliens too), the Fire Gun and the Black Hole Gun (heroWeapons.js). Each
 * is raised with the right mouse button and fired with the left button or
 * Enter (pullTrigger / releaseTrigger). The abilities are on Q E R
 * (engine/player/abilities.js): Q is Time Slow, five seconds of the world
 * at 10% (with the minigun in hand, Bullet Time: the world at 3%, its
 * bullets hanging in the air), E Teleport, R the EMP; G is the grappling
 * hook (engine/player/grapple.js). The controls are read through engine/player/input.js
 * (hero/input.js consumeInput).
 *
 * The plasma rifle is drawn and put away with the right mouse button.
 * Drawn, the view goes first person, like a shooter: the camera is at
 * Roger's eyes, the rifle held in front of it in the lower right (its own
 * close-up model, with a readout of the plasma cell on its back) and a
 * Counter-Strike crosshair in the middle of the screen. The mouse looks
 * (pointer lock when the browser gives it); W A S D walk -- up/down
 * forward and back, left/right strafe. The crosshair turns red over
 * something the beam will hit hard, and names it.
 *
 * Enter fires (so does the left mouse button while aiming), and holding it
 * charges: a tap is a normal shot; two seconds (HERO.chargeSeconds) is a
 * **mega beam** -- the
 * HUD's charge bar full, MEGA BEAM READY, the rifle glowing and the hum
 * (sound/hero.js) at its top. On release it fires what it has:
 *  - a normal shot is a thick white-blue beam down the crosshair: people
 *    blown apart, buildings smashed and set alight, cars and trees thrown,
 *    any alien killed, the fuel tanker (environment/tanker.js) set off,
 *    the Terminator thrown flat on its back for a few
 *    seconds, and a point off an alien ship's hull (SHIP_DAMAGE);
 *  - a mega beam is three and a half times as wide, with rings of plasma
 *    bursting outwards round it and a trail of fire down its length, a
 *    sonic boom and a heavy shake, and a far bigger blast where it lands. It
 *    destroys the Terminator outright, takes five points off an alien ship
 *    (the ship, the hunters and the mothership; the HUD reads out the hull
 *    left) and neutralises a tornado: it ropes out fast (tornadoEngine.js updateBirth,
 *    Vortex.neutralized) and stays gone until Hero Mode ends. A normal shot
 *    does nothing to a funnel.
 * Every shot plays sonic-boom.mp3 (sound/cues.js) and drains a quarter of
 * the cell, which refills over a few seconds.
 *
 * For his first HERO.spawnShieldSeconds he is untouchable, and blinks:
 * nothing kills him (killRoger does nothing while state.spawnShield runs).
 *
 * What kills Roger: a Terminator (or any of the Terminator squad, which
 * come straight for him while Hero Mode is on) reaching him; an alien getting
 * its hands on him, or an alien ray hitting him where he stood when it aimed;
 * an alien ship's tracking laser catching him (aliens.js); the mothership's
 * beam running over him; a ship coming down on him; a meteor landing within
 * its kill radius of him (meteors.js); an EMP wave reaching him on foot
 * (empSweep: electrocuted -- in a car he is shielded); and falling into the
 * earthquake's chasm (engine/chasm.js) -- he staggers at the edge and drops.
 *
 * The tornado never kills Roger. Caught at the edge of one he is dazed --
 * stars, the wobbling walk, a dazed line -- and loses control for a few
 * seconds, and may drop the rifle. That, and aiming, and running into walls,
 * is what lets the Terminator catch up: it walks straight at him, round
 * whatever is in the way, a little slower than he can run, and never stops.
 * Its footsteps (sound/hero.js) come faster and louder as it closes.
 *
 * Two things kill the Terminator: a mega beam, and an EMP -- an EMP-charged funnel
 * (engine/empCharge.js) -- a tornado that has just brought a power line down
 * carries the discharge for a few seconds, kills the machine walking into its
 * pull, and sends EMP waves out across the ground that kill it wherever they
 * reach it -- or the Electric Tornado's own EMP ring (electricStorm.js). Both
 * call empSweep. It seizes rigid mid-stride in a storm of arcs, falls
 * stiffly, and goes off in a small EMP burst. TERMINATOR TERMINATED, a big
 * bonus, and after a few seconds it reboots and comes on again, once; kill
 * each of them twice and the chase is over for the run, leaving only the
 * bunker. terminatorDistance tells the Terminator music (sound/cues.js)
 * how near the nearest machine is.
 *
 * The parked cars can be driven, and the nearest ones are marked on the
 * minimap. Walking up to one, its driver's door (the left side) glows;
 * touching it and pressing Enter (rifle away) puts Roger in the driver's
 * seat: the car leaves the physics while he has it, handles like
 * the Chase Mode car (chase/car.js CHASE_TUNE), and the camera switches to
 * Chase Mode's, behind it. E, Q or Esc gets him out by the same door, on his
 * feet, with his own controls and camera back. A funnel that reaches the
 * car throws him out dazed; the Terminator reaching it tears him out.
 *
 * The Chase Mode car (chase/index.js, parked beside the aliens and drawn
 * CHASE_TUNE.carScale times the size of the others) is one of them, with a
 * difference: touching its driver's door is enough -- he is in and driving
 * it in Chase Mode style with no key pressed (state.chaseDoorArmed stops
 * the door taking him straight back after he gets out). It stays out of the
 * physics whoever has it, as it always has.
 *
 * Single tornado: like Chase Mode, the mode switches an Outbreak down to one
 * funnel for its duration and hands the count back afterwards.
 */

/*
 * The code is split by job across engine/hero/ (moved as it was, nothing
 * changed; the benchmark's fingerprint is the same before and after):
 *   config.js    every tunable (HERO and the street layout)
 *   models.js    Roger, the rifles, the marker, the machines
 *   movement.js  Roger on foot, spawn and bunker
 *   input.js     the controls
 *   plasma.js    aiming, the plasma rifle, the mega beam
 *   car.js       getting in, driving, getting out
 *   pursuers.js  the machines after him
 *   screen.js    death, cameras, HUD and messages
 * and this file: set-up, start and end, the frame, reset and dispose. Their
 * shared state is the one object S made below; each module calls the
 * others' functions through `api`.
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initHero: () => void,
 *   updateHero: (rawDt: number) => void,
 *   markers: () => ({bunker: THREE.Vector3, pursuers: THREE.Vector3[], roger: THREE.Vector3, car: Object|null}|null),
 *   terminatorDistance: () => number,
 *   drivingCar: () => ({mesh: THREE.Object3D, speed: number}|null),
 *   notify: (text: string) => void,
 *   announce: (title: string, sub: string) => void,
 *   empSweep: (x: number, z: number, radius: number) => void,
 *   rogerTarget: () => ({x: number, z: number, onFoot: boolean}|null),
 *   placeRoger: (x: number, z: number) => boolean,
 *   rogerFacing: () => ({x: number, z: number, heading: number}|null),
 *   standable: (x: number, z: number) => boolean,
 *   freezeRoger: (seconds: number) => boolean,
 *   zipRoger: (x: number, z: number, speed: number) => boolean,
 *   rogerZipping: () => boolean,
 *   stopZip: () => void,
 *   solidAlong: (x: number, z: number, dx: number, dz: number, max: number) => number,
 *   rogerFrozen: () => boolean,
 *   rogerShielded: () => boolean,
 *   rogerPhase: () => string,
 *   killRoger: (title: string, sub: string, kind?: string) => void,
 *   hitArea: (x: number, z: number, radius: number, title: string, sub: string, source?: string) => void,
 *   resetHero: () => void,
 *   disposeHero: () => void
 * }}
 */
export function createHeroModeSystem(ctx) {
  const { Sim, container } = ctx;
  // Everything this system's modules share (see the header): each of them
  // reads and writes it as S.
  const S = {
    Hero: { active: false },

    state: {
      /** @type {'running'|'aiming'|'driving'|'dazed'|'won'|'dying'} */
      phase: 'running',
      timer: 0,
      heading: 0,
      speed: 0,
      cycle: 0,
      drawn: false,
      // The trigger held: how long (seconds, up to HERO.chargeSeconds).
      charging: false,
      charge: 0,
      megaReady: false,
      // The shot in flight: how wide and how long, and whether it is a mega.
      beamWidth: 1,
      beamLength: 0.55,
      beamMega: false,
      ringTimer: 0,
      // How Roger died: 'fall' into the chasm, else struck down where he stood.
      deathKind: '',
      deathVy: 0,
      overShown: false,
      deathTitle: '',
      deathSub: '',
      // The plasma cell, 0..100, and the shot in flight.
      cell: 100,
      plasmaTimer: 0,
      beamTimer: 0,
      recoil: 0,
      spread: 0,
      neutralised: false,
      dazeImmunity: 0,
      // Co-op: down but revivable (engine/net/system.js), not dead.
      coopDown: false,
      // The Chase Mode car's door takes him in by itself; after he gets out it
      // waits until he has walked away, or he would be straight back in.
      chaseDoorArmed: true,
      spawnShield: 0,
      // Invincible (V): nothing hurts, kills, dazes or freezes him. A toggle
      // with no timer, cost or cooldown; it stays on (Restart included) until
      // V is pressed again.
      invincible: false,
      // The grappling hook's zip (engine/player/grapple.js): Roger drawn along
      // the rope to (zipX, zipZ) at zipSpeed m/s; zipTotal is the distance at
      // the start, for the hop. Ends on arrival, against a wall, or when he
      // stops being on his feet.
      zipActive: false,
      zipX: 0,
      zipZ: 0,
      zipSpeed: 0,
      zipTotal: 0,
      dazeHeading: 0,
      dazeSpin: 0,
      flingX: 0,
      flingZ: 0,
      hintTimer: 0,
      msgTimer: 0,
      // Aim mode: where he looks, how far into the eyes the camera has come,
      // whether the pointer is locked, and what is under the crosshair.
      yaw: 0,
      pitch: 0,
      aimBlend: 0,
      locked: false,
      /** @type {string} */
      aimKind: 'sky',
      savedFov: 55,
      // Driving.
      carSpeed: 0,
      carHeading: 0,
      burstTimer: 0,
      // Nearest machine hunting him last frame (Infinity for none): the HUD
      // and the Terminator music (sound/cues.js) read it.
      threat: Infinity,
      saidTwice: false,
      stepTimer: 0,
      bannerTimer: 0
    },

    saved: {
      cinematic: false,
      pos: new THREE.Vector3(),
      target: new THREE.Vector3(),
      tornadoes: 1
    },
    // W A S D: the only movement keys, in every mode (the arrows do nothing).
    keys: { up: false, down: false, left: false, right: false },
  
    /** @type {Object|null} Roger: a people.js figure, never in Sim.objects */
    roger: null,
    /** @type {THREE.Group|null} */
    rifle: null,
    /** @type {THREE.Object3D|null} */
    muzzle: null,
    /** @type {THREE.Sprite|null} */
    nameTag: null,
    /** @type {THREE.Sprite|null} */
    stars: null,
    /**
     * The machines hunting him (HERO.pursuers of them): terminator.js models,
     * each with its own chase state in `p` (see spawnPursuer).
     * @type {Object[]}
     */
    pursuers: [],
    /** @type {THREE.Group|null} the bunker's beacon, glyph and ring */
    marker: null,
    /** @type {Object|null} the car he is driving, an Environment.cars SimObject */
    driven: null,
    /** @type {Object|null} the car whose door he is touching */
    doorCar: null,
    /** @type {THREE.Mesh|null} the glow over that door */
    doorGlow: null,
    /** @type {THREE.Group|null} the plasma beam: core, sheath and halo */
    beam: null,
    /** @type {THREE.Mesh|null} its flare where it lands */
    beamSplash: null,
    /** @type {{group: THREE.Group, muzzle: THREE.Object3D, flash: THREE.Mesh, energy: THREE.MeshBasicMaterial, panel: THREE.CanvasTexture, shown: number}|null} */
    viewRifle: null,
    /** @type {THREE.Mesh|null} the EMP burst ring when the machine goes down */
    burst: null,
    /** @type {THREE.Mesh[]} the mega beam's rings of plasma */
    rings: [],
    /** @type {HTMLDivElement|null} the GAME OVER card */
    over: null,
    /** @type {THREE.Material[]} materials made for a run, disposed with it */
    runMaterials: [],
    /** @type {THREE.BufferGeometry[]} */
    runGeometries: [],
    /** @type {THREE.Texture[]} */
    runTextures: [],

    bunker: new THREE.Vector3(),

    aimDir: new THREE.Vector3(),

    beamTo: new THREE.Vector3(),

    eyeQuat: new THREE.Quaternion(),

    eyeEuler: new THREE.Euler(0, 0, 0, 'YXZ'),

    lookAt: new THREE.Vector3(),

    camGoal: new THREE.Vector3(),

    scratch: new THREE.Vector3(),

    scratchB: new THREE.Vector3(),
  
    /** @type {HTMLButtonElement|null} */
    button: null,
    /** @type {HTMLDivElement|null} */
    hud: null,
    /** @type {HTMLDivElement|null} the crosshair, aim mode only */
    crosshair: null,
    /** @type {HTMLDivElement|null} */
    banner: null,

    weapons: null
  };

  // Every function of every module, by name, for the others to call.
  const api = {};
  Object.assign(api,
    createHeroModels(ctx, S, api),
    createHeroMovement(ctx, S, api),
    createHeroInput(ctx, S, api),
    createHeroPlasma(ctx, S, api),
    createHeroCar(ctx, S, api),
    createHeroPursuers(ctx, S, api),
    createHeroScreen(ctx, S, api),
    {  }
  );

  // Published for the systems that must stand aside while it runs (keyPan,
  // Chase Mode, tornado control).
  ctx.Hero = S.Hero;
  // The minigun and the railgun, and Q between them and the rifle
  // (engine/heroWeapons.js). Made once every module is in `api`.
  S.weapons = createHeroWeapons(ctx, {
    keepGeo: api.keepGeo, keepMat: api.keepMat, traceAim: api.traceAim,
    flashMessage: api.flashMessage, pursuerBulletHit: api.pursuerBulletHit,
    rogerPosition: () => S.roger.mesh.position,
    // What the Katana's quick slash reads of Roger (hero/katana/slash.js);
    // the movement helpers are looked up lazily, as `api` fills in.
    katanaBody: {
      heading: () => S.state.heading,
      // On foot, or raised into first person with the Katana; never dazed, driving or dying.
      canAct: () => (S.state.phase === 'running' || S.state.phase === 'aiming') && !(S.state.frozen > 0),
      rig: () => S.katanaRig || null,
      position: () => S.roger.mesh.position,
      blockedAt: (x, z, pad) => api.blockedAt(x, z, pad),
      pushOut: (p, pad) => api.pushOut(p, pad)
    }
  });

  // ---------------------------------------------------------------------
  // Set-up
  // ---------------------------------------------------------------------

  /** @returns {void} */
  function initHero() {
    // News from the rest of the game (engine/events.js).
    ctx.events.on('announce', ({ title, sub }) => api.announce(title, sub));
    ctx.events.on('notice', ({ text }) => api.notify(text));
    ctx.events.on('empPulse', ({ x, z, radius }) => api.empSweep(x, z, radius));
    ctx.events.on('playerHurt', (hurt) => api.hurtFlash(hurt));
    // Roger's own pursuers, in the shared register of enemies
    // (engine/enemies.js).
    ctx.systems.enemies.registerKind({
      kind: 'pursuer',
      list: api.huntingPursuers,
      position: (unit) => unit.root.position,
      accepts: ['plasma', 'bullet', 'bolt', 'emp'],
      damage: (unit, hit) => {
        if (hit.type === 'plasma') {
          if (hit.mega) api.megaKillPursuer(unit);
          else api.knockdownPursuer(unit);
        } else if (hit.type === 'bullet') api.pursuerBulletHit(unit, MINIGUN.terminatorHits);
        else api.startPursuerDeath(unit);
        return unit.p.state !== 'hunting';
      },
      // Out of health (D1, health/damageTable.js): down as an EMP brings it down.
      defeat: (unit) => {
        if (unit.p.state === 'hunting') api.startPursuerDeath(unit);
        return unit.p.state !== 'hunting';
      },
      // The black hole: out of the hunt and gone, with no death of its own.
      consume: (unit) => {
        unit.p.state = 'gone';
        unit.root.visible = false;
      }
    });
    S.button = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-hero'));
    if (S.button) S.button.addEventListener('click', () => (S.Hero.active ? endHero(null) : startHero()), { signal: ctx.signal });

    S.hud = document.createElement('div');
    S.hud.className = 'hero-hud';
    S.hud.innerHTML = `
      <div class="hero-name">🦸 ROGER</div>
      <div class="hero-row hero-weapon">WEAPON <span class="hero-wname"></span></div>
      <div class="hero-row hero-health">HEALTH <span class="hero-cell hero-hbar"><i></i></span> <span class="hero-hpct"></span></div>
      <div class="hero-row hero-partner" hidden>PARTNER <span class="hero-cell hero-hbar hero-pbar"><i></i></span> <span class="hero-hpct hero-ppct"></span></div>
      <div class="hero-row hero-energy">ENERGY <span class="hero-ebar">${'<i></i>'.repeat(ENERGY.segments)}</span> <span class="hero-epct"></span></div>
      <div class="hero-row hero-abilities"></div>
      <div class="hero-row hero-invincible">🛡 INVINCIBLE · V to turn off</div>
      <div class="hero-row">PLASMA <span class="hero-cell"><i></i></span> <span class="hero-cellpct"></span></div>
      <div class="hero-row hero-charge">CHARGE <span class="hero-cell hero-chargebar"><i></i></span> <span class="hero-chargepct"></span></div>
      <div class="hero-row">BUNKER <span class="hero-arrow">▲</span> <span class="hero-dist"></span></div>
      <div class="hero-row hero-threat">TERMINATOR <span class="hero-blip"></span> <span class="hero-tdist"></span></div>
      <div class="hero-row hero-emp">⚡ EMP CHARGED <span class="hero-emptime"></span></div>
      <div class="hero-row hero-door">🚗 ENTER — get in the car</div>
      <div class="hero-row hero-drive">🚗 DRIVING · E / Q / Esc — get out</div>
      <div class="hero-msg"></div>
      <div class="hero-keys">W A S D run · Right-click raise / lower weapon · Wheel switch weapon<br>Click or Enter fire · rifle: hold 2 s for a MEGA BEAM · Q time slow (bullet time with the minigun) · E teleport · R EMP · G grappling hook · V invincible<br>T Landing Support (then R samurai · T rocket · Esc cancel) · Enter at a car's glowing door to drive</div>`;
    container.appendChild(S.hud);

    S.over = document.createElement('div');
    S.over.className = 'hero-over';
    S.over.innerHTML = `
      <div class="hero-over-title">GAME OVER</div>
      <div class="hero-over-cause"></div>
      <div class="hero-over-buttons">
        <button type="button" class="hero-over-restart">↻ Restart</button>
        <button type="button" class="hero-over-exit">Exit Hero Mode</button>
      </div>`;
    S.over.querySelector('.hero-over-restart').addEventListener('click', () => {
      endHero('restart');
      startHero();
    }, { signal: ctx.signal });
    S.over.querySelector('.hero-over-exit').addEventListener('click', () => endHero('dead'), { signal: ctx.signal });
    container.appendChild(S.over);

    S.crosshair = document.createElement('div');
    S.crosshair.className = 'hero-crosshair';
    S.crosshair.innerHTML = '<i class="n"></i><i class="s"></i><i class="w"></i><i class="e"></i><b></b><span class="hero-target"></span>';
    container.appendChild(S.crosshair);

    // Hit flash, low-health vignette and direction arrow (hero/screen.js).
    S.hurt = document.createElement('div');
    S.hurt.className = 'hero-hurt';
    S.hurt.innerHTML = '<i class="hero-hurt-flash"></i><i class="hero-hurt-low"></i><b class="hero-hurt-dir">▲</b>';
    S.hurtDir = S.hurt.querySelector('.hero-hurt-dir');
    container.appendChild(S.hurt);

    S.banner = document.createElement('div');
    S.banner.className = 'hero-banner';
    S.banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
    bannerHost(container).appendChild(S.banner);
  }

  /** @returns {void} */
  function startHero() {
    if (S.Hero.active) return;
    const s = ctx.systems;
    if ((ctx.Chase && ctx.Chase.active) || (ctx.Possess && ctx.Possess.active)
      || (s.spaceship && s.spaceship.isLanding()) || (s.killcam && s.killcam.isReplaying())) {
      return;
    }
    // The tornado is not started here (on request): the Tornado button or a
    // preset does that, and Roger can take on the aliens first.

    S.saved.cinematic = !!(ctx.Cinematic && ctx.Cinematic.active);
    if (S.saved.cinematic) ctx.setCinematicView(false);
    S.saved.pos.copy(Sim.three.camera.position);
    S.saved.target.copy(Sim.three.controls.target);
    S.saved.tornadoes = ctx.tornadoes.count();
    ctx.tornadoes.setCount(1);
    s.wedge.setWedge(false);
    s.doomsday.setDoomsday(false);
    for (const id of EXCLUSIVE_BUTTONS) {
      const el = /** @type {HTMLButtonElement|null} */ (document.getElementById(id));
      if (el) el.disabled = true;
    }
    Sim.three.controls.enabled = false;

    const spawn = api.pickSpawn();
    const door = api.pickBunker(spawn.x, spawn.z);
    S.bunker.set(door.x, 0, door.z);
    S.roger = api.buildRoger(spawn.x, spawn.z);
    Sim.three.scene.add(S.roger.mesh);
    S.state.heading = Math.atan2(S.bunker.x - spawn.x, S.bunker.z - spawn.z);
    S.roger.mesh.rotation.y = S.state.heading;

    api.spawnPursuers();

    S.marker = api.buildMarker();
    S.marker.position.copy(S.bunker);
    Sim.three.scene.add(S.marker);

    Object.assign(S.state, {
      phase: 'running', timer: 0, speed: 0, cycle: 0, drawn: false,
      charging: false, charge: 0, megaReady: false, beamMega: false, ringTimer: 0,
      deathKind: '', deathVy: 0, overShown: false,
      cell: 100, plasmaTimer: 0, beamTimer: 0, recoil: 0, spread: 0,
      neutralised: false, dazeImmunity: 0, spawnShield: HERO.spawnShieldSeconds,
      burstTimer: 0, aimBlend: 0, threat: Infinity,
      stepTimer: 0.5, hintTimer: HERO.hintSeconds, msgTimer: 0, aimKind: 'sky', frozen: 0,
      zipActive: false
    });
    S.weapons.startRun();
    // A fresh energy bar for the run (engine/player/energy.js).
    ctx.systems.energy.resetEnergy();
    api.attachKeys();
    S.Hero.active = true;
    // Every run, Restart included, starts at full health (health/system.js).
    if (ctx.systems.health) ctx.systems.health.resetHealth();
    if (S.button) {
      S.button.textContent = '✕ Exit Hero';
      S.button.classList.add('active');
      S.button.setAttribute('aria-pressed', 'true');
    }
    if (S.hud) S.hud.classList.add('visible');
    api.placeFollowCamera(1);
    api.showBanner('HERO MODE', 'Get Roger to the bunker. Something is coming for him.');
  }

  /**
   * Ends the run, whichever way: tears down everything built for it and
   * hands back the camera, the tornado count and the buttons as they were.
   * @param {string|null} outcome for the record; null when simply abandoned
   * @returns {void}
   */
  function endHero(outcome) {
    if (!S.Hero.active) return;
    if (S.state.phase === 'aiming') api.leaveAim();
    api.cancelCharge();
    api.exitCar();
    S.weapons.endRun();
    S.Hero.active = false;
    if (S.over) S.over.classList.remove('visible');
    api.clearHurt();
    api.detachKeys();
    // Time Slow (or any ability) let go with the run.
    ctx.systems.abilities.cancelAll();
    // The funnel it put out comes back down now.
    for (const tornado of ctx.tornadoes.instances) {
      tornado.Vortex.neutralized = false;
      tornado.Vortex.health = fullHealth('tornado');
    }
    ctx.tornadoes.setCount(S.saved.tornadoes);

    if (S.roger) {
      Sim.three.scene.remove(S.roger.mesh);
      S.roger.mesh.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material && !S.runMaterials.includes(child.material)) child.material.dispose();
      });
      S.roger = null;
    }
    api.removePursuers();
    for (const obj of [S.marker, S.nameTag, S.stars, S.beam, S.beamSplash, S.burst, S.doorGlow]) if (obj) Sim.three.scene.remove(obj);
    if (S.viewRifle) Sim.three.scene.remove(S.viewRifle.group);
    if (S.katanaRig) S.katanaRig.disposeView();
    for (const ring of S.rings) Sim.three.scene.remove(ring);
    for (const g of S.runGeometries) g.dispose();
    for (const m of S.runMaterials) m.dispose();
    for (const t of S.runTextures) t.dispose();
    S.runGeometries = [];
    S.runMaterials = [];
    S.runTextures = [];
    S.marker = S.nameTag = S.stars = S.beam = S.beamSplash = S.burst = S.rifle = S.muzzle = S.doorGlow = null;
    S.rings = [];
    S.viewRifle = null;
    S.doorCar = null;
    // The Katana's rig went with S.roger's meshes above; no stale reference between runs.
    S.katanaRig = null;
    if (S.hud) S.hud.classList.remove('door', 'driving');

    for (const id of EXCLUSIVE_BUTTONS) {
      const el = /** @type {HTMLButtonElement|null} */ (document.getElementById(id));
      if (el) el.disabled = false;
    }
    Sim.three.controls.enabled = true;
    Sim.three.camera.position.copy(S.saved.pos);
    Sim.three.controls.target.copy(S.saved.target);
    Sim.three.camera.lookAt(S.saved.target);
    if (S.saved.cinematic) ctx.setCinematicView(true);

    if (S.button) {
      S.button.textContent = '🦸 Hero';
      S.button.classList.remove('active');
      S.button.setAttribute('aria-pressed', 'false');
    }
    if (S.hud) S.hud.classList.remove('visible');
    S.state.phase = 'running';
    void outcome;
  }

  // ---------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------

  /**
   * Per frame, in real time: Roger, his pursuers and the camera. After every
   * other camera writer bar the game-feel shake and the kill-cam.
   * @param {number} rawDt
   * @returns {void}
   */
  function updateHero(rawDt) {
    if (S.state.bannerTimer > 0) {
      S.state.bannerTimer -= rawDt;
      if (S.state.bannerTimer <= 0 && S.banner) S.banner.classList.remove('visible');
    }
    if (!S.Hero.active || !S.roger) return;
    const dt = Sim.state.paused ? 0 : rawDt;
    // What the player did since the last frame (engine/player/input.js).
    api.consumeInput();
    // The abilities' clocks run on the player's time, dying included, or the
    // world would stay slow under the GAME OVER card.
    ctx.systems.abilities.updateAbilities(dt);

    if (S.state.phase === 'dying') {
      api.updateDeath(dt, rawDt);
      // The chase itself carries on around the body.
      api.updatePursuers(dt);
      return;
    }
    if (S.state.phase === 'won') {
      S.state.timer += dt;
      // Through the door.
      const p = S.roger.mesh.position;
      p.x += (S.bunker.x - p.x) * Math.min(1, dt * 3);
      p.z += (S.bunker.z - p.z) * Math.min(1, dt * 3);
      S.roger.mesh.visible = S.state.timer < 1;
      S.nameTag.visible = S.roger.mesh.visible;
      api.placeFollowCamera(Math.min(1, rawDt * 4));
      if (S.state.timer >= HERO.endSeconds) endHero('safe');
      return;
    }

    if (S.state.spawnShield > 0) {
      S.state.spawnShield = Math.max(0, S.state.spawnShield - dt);
      // Blinking while it lasts, as in any arcade respawn (only while he is
      // on show: aiming and driving hide him).
      if (S.state.phase !== 'aiming' && S.state.phase !== 'driving') {
        S.roger.mesh.visible = S.state.spawnShield <= 0 || Math.floor(S.state.spawnShield * 10) % 2 === 0;
      }
    }
    // Frozen solid (engine/effects/freeze.js): he cannot move until it thaws.
    if (S.state.frozen > 0) S.state.frozen = Math.max(0, S.state.frozen - dt);
    if (S.state.phase === 'driving') api.updateCar(dt);
    else if (!(S.state.frozen > 0) && !S.state.coopDown) api.updateRoger(dt);
    api.updateDoorCue();
    // Time Slow slows the machines with the rest of the world (its time
    // group, engine/time.js); Roger runs at his own pace.
    const threat = api.updatePursuers(dt * ctx.systems.time.scale('world'));
    api.updateBurst(dt);
    api.updateCharge(dt);
    if (dt > 0) api.checkChasm();
    if (S.state.phase === 'dying') return;

    if (S.state.phase === 'aiming') api.placeAimCamera(rawDt);
    else if (S.state.phase === 'driving') api.placeDriveCamera(rawDt);
    else api.placeFollowCamera(Math.min(1, rawDt * 5));
    // After the camera, so the beam leaves the muzzle where it is drawn.
    api.updatePlasma(dt);
    S.weapons.update(dt, S.state.phase === 'aiming', Sim.three.camera, S.aimDir);

    // The bunker's glyph bobbing and turning to the light.
    if (S.marker) {
      S.marker.userData.glyph.position.y = 17 + Math.sin(performance.now() * 0.002) * 0.8;
      S.marker.userData.ring.material.opacity = 0.55 + 0.3 * Math.sin(performance.now() * 0.005);
    }

    api.updateHud(threat, rawDt);

    // Touched -- by a machine on its feet: 50 per touch, then its 3 s cooldown
    // (health/melee.js). A lethal touch is the old "caught" death.
    if (dt > 0 && !S.state.coopDown) {
      api.touchByPursuers(dt * ctx.systems.time.scale('world'));
      if (S.state.phase === 'dying') return;
    }
    // Safe.
    const p = S.roger.mesh.position;
    if (!S.state.coopDown && Math.hypot(p.x - S.bunker.x, p.z - S.bunker.z) < HERO.winRadius && S.state.phase !== 'dazed') {
      if (S.state.phase === 'aiming') api.leaveAim();
      api.exitCar();
      S.state.phase = 'won';
      S.state.timer = 0;
      const score = S.state.neutralised ? HERO.doubleScore : HERO.winScore;
      ctx.systems.damage.addDamageScore(score);
      api.showBanner('SAFE', S.state.neutralised
        ? `Roger reached the bunker! Double heroics · +${score}`
        : `Roger reached the bunker! +${score}`);
    }
  }

  /**
   * How near the nearest machine after him is -- his own pursuers and the
   * Terminator squad's (terminator.js) -- for the Terminator music
   * (sound/cues.js). Infinity when there is no run or nothing hunting him.
   * @returns {number}
   */
  function terminatorDistance() {
    if (!S.Hero.active || !S.roger || S.state.phase === 'dying' || S.state.phase === 'won') return Infinity;
    let nearest = S.state.threat;
    const r = S.roger.mesh.position;
    if (ctx.systems.terminator) {
      for (const unit of ctx.systems.terminator.walkingUnits()) {
        nearest = Math.min(nearest, Math.hypot(unit.root.position.x - r.x, unit.root.position.z - r.z));
      }
    }
    return nearest;
  }

  /**
   * Roger put down somewhere else in an instant, on foot and in play (the
   * panel's test buttons; Teleport next). Out of any building he would land
   * in, like his own steps.
   * @param {number} x
   * @param {number} z
   * @returns {boolean} whether he was moved
   */
  function placeRoger(x, z) {
    if (!S.Hero.active || !S.roger || S.driven) return false;
    if (S.state.phase === 'dying' || S.state.phase === 'won') return false;
    const p = S.roger.mesh.position;
    p.x = x;
    p.z = z;
    api.pushOut(p, HERO.pad);
    api.placeFollowCamera(1);
    return true;
  }

  /**
   * Roger drawn along the grappling hook's rope (engine/player/grapple.js)
   * to (x, z), on foot and in play; hero/movement.js moves him there.
   * @param {number} x
   * @param {number} z
   * @param {number} speed metres a second
   * @returns {boolean} whether the zip started
   */
  function zipRoger(x, z, speed) {
    const target = api.rogerTarget();
    if (!target || !target.onFoot || S.state.frozen > 0 || S.state.phase === 'dazed') return false;
    Object.assign(S.state, { zipActive: true, zipX: x, zipZ: z, zipSpeed: speed, zipTotal: Math.hypot(x - target.x, z - target.z) });
    return true;
  }

  /**
   * Where Roger is and which way he looks (his aim when the weapon is up),
   * on foot and in play; null otherwise (for Teleport).
   * @returns {{x: number, z: number, heading: number}|null}
   */
  function rogerFacing() {
    const target = api.rogerTarget();
    if (!target || !target.onFoot) return null;
    return { x: target.x, z: target.z, heading: S.state.heading };
  }

  /**
   * Roger frozen solid for a while (the Yeti's storm, the Blizzard): he
   * cannot move, fire or use an ability until it thaws. Not in a car.
   * @param {number} seconds
   * @returns {boolean} whether he was (and was not already)
   */
  function freezeRoger(seconds) {
    const target = api.rogerTarget();
    if (!target || !target.onFoot || S.state.frozen > 0 || S.state.invincible) return false;
    S.state.frozen = seconds;
    return true;
  }

  /**
   * @param {number} x
   * @param {number} z
   * @returns {boolean} whether Roger could stand there: not in a building,
   *   not over the chasm, inside the map
   */
  function standable(x, z) {
    return !api.blockedAt(x, z, HERO.pad);
  }

  /**
   * For the minimap.
   * @returns {{bunker: THREE.Vector3, pursuers: THREE.Vector3[], roger: THREE.Vector3, car: {x: number, z: number, heading: number}|null, cars: {x: number, z: number, heading: number}[]}|null}
   */
  function markers() {
    if (!S.Hero.active || !S.roger) return null;
    // A machine that is down is no longer something to find on the map.
    const hunting = S.pursuers.filter(unit => unit.p.state !== 'down' && unit.p.state !== 'gone').map(unit => unit.root.position);
    const car = S.driven ? { x: S.driven.mesh.position.x, z: S.driven.mesh.position.z, heading: S.state.carHeading } : null;
    // On foot: the parked cars he could take, nearest first, so there is
    // always one to find on the map.
    const cars = [];
    if (!S.driven && S.state.phase !== 'dying') {
      const r = S.roger.mesh.position;
      const near = [];
      for (const c of ctx.Environment.cars) {
        if (!c.mesh || !api.drivable(c)) continue;
        const d = Math.hypot(c.mesh.position.x - r.x, c.mesh.position.z - r.z);
        if (d < 150) near.push({ c, d });
      }
      near.sort((a, b) => a.d - b.d);
      for (const { c } of near.slice(0, 8)) cars.push({ x: c.mesh.position.x, z: c.mesh.position.z, heading: c.mesh.rotation.y });
    }
    return { bunker: S.bunker, pursuers: hunting, roger: S.roger.mesh.position, car, cars };
  }

  /** @returns {void} */
  function resetHero() {
    endHero(null);
    S.state.bannerTimer = 0;
    if (S.banner) S.banner.classList.remove('visible');
  }

  /** @returns {void} */
  function disposeHero() {
    resetHero();
    if (S.weapons) S.weapons.dispose();
    for (const el of [S.hud, S.crosshair, S.banner, S.over, S.hurt]) if (el && el.parentNode) el.parentNode.removeChild(el);
    S.hud = S.crosshair = S.banner = S.over = S.hurt = S.hurtDir = null;
    S.button = null;
  }

  return {
    initHero, updateHero, markers, terminatorDistance, drivingCar: api.drivingCar, notify: api.notify, announce: api.announce, empSweep: api.empSweep, rogerTarget: api.rogerTarget, placeRoger, rogerFacing, standable, freezeRoger,
    zipRoger, rogerZipping: () => S.state.zipActive, stopZip: () => { S.state.zipActive = false; }, solidAlong: api.solidAlong, rogerFrozen: () => S.state.frozen > 0, rogerShielded: () => S.state.spawnShield > 0 || S.state.invincible, rogerPhase: () => S.state.phase, killRoger: api.killRoger, hitArea: api.hitArea, chipTornado: api.chipTornado,
    resetHero, disposeHero,
    // Co-op (engine/net/system.js): Roger's pose for the shared snapshot, and
    // the down-not-dead state while a teammate can still revive him.
    rogerPose: () => {
      if (!S.Hero.active || !S.roger) return null;
      const p = S.roger.mesh.position;
      return { x: p.x, z: p.z, heading: S.state.heading, weapon: S.weapons ? S.weapons.current() : '', driving: S.state.phase === 'driving' };
    },
    guestFlame: (/** @type {any} */ gun, /** @type {number} */ dt, /** @type {THREE.Vector3} */ muzzle, /** @type {THREE.Vector3} */ dir) => { if (S.weapons) S.weapons.guestFlame(gun, dt, muzzle, dir); },
    setCoopDown: (/** @type {boolean} */ down) => {
      if (!S.roger) return;
      S.state.coopDown = down;
      if (down) {
        if (S.state.phase === 'aiming') api.leaveAim();
        api.cancelCharge();
        api.exitCar();
        api.releaseKeys();
        S.roger.mesh.rotation.x = -Math.PI / 2 + 0.1;
      } else {
        S.roger.mesh.rotation.x = 0;
        // A breath of safety after the revive (the spawn shield, as at the start).
        S.state.spawnShield = 2;
      }
    },
    // The weapon in hand (the minigun turns Time Slow into Bullet Time,
    // player/abilities.js), and Bullet Time's hold on its bullets.
    weapon: () => (S.weapons ? S.weapons.current() : ''),
    bulletTime: (/** @type {boolean} */ on) => { if (S.weapons) S.weapons.bulletTime(on); }
  };
}
