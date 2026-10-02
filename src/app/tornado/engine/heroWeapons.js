// @ts-check
import * as THREE from 'three';
import { LIGHTING } from './lightingTuning.js';
import { HOLE } from './player/blackHole.js';
import { tableDamage, shipKindOf } from './health/enemyDamage.js';
import { createBullets } from './hero/bullets.js';
import { createFireGun } from './hero/fireGun.js';
import { createKatanaSlash } from './hero/katana/slash.js';
import { createKatanaPieces } from './hero/katana/pieces.js';
import { createKatanaGoo } from './hero/katana/goo.js';
import { createKatanaFeel } from './hero/katana/feel.js';
import { createKatanaBlade } from './hero/katana/blade.js';
import { createKatanaBladeUi } from './hero/katana/bladeUi.js';
import { createKatanaBladeCut } from './hero/katana/bladeCut.js';

/**
 * ===========================================================================
 * SECTION AM.1 — Hero Mode weapons
 * ===========================================================================
 * Roger carries six weapons (engine/heroMode.js), and the mouse wheel
 * cycles through them on foot (Q did, until it went to Time Slow): the
 * plasma rifle, the minigun, the railgun, the Fire Gun, the Black Hole
 * Gun and the Katana. Whichever is
 * in hand, the right mouse button raises it into first person as before,
 * and the left button (or Enter) is its trigger. The plasma rifle is
 * heroMode.js's own; this module is the other three and their close-up
 * models. (The slow motion that was here is the Time Slow ability now,
 * engine/player/abilities.js.)
 *
 *  - **Minigun**: fires while the trigger is held, MINIGUN.rate rounds a
 *    second, each with a little scatter, from a belt of MINIGUN.ammo (not
 *    refilled for now). Every round is traced down the sights
 *    (heroMode.js traceAim) and flies there as a real bullet
 *    (hero/bullets.js: brass, a glowing tip, a tracer, a casing thrown out;
 *    Bullet Time hangs them in the air), and it hurts only three
 *    things: people, who die, Terminators -- Roger's own pursuers and
 *    the squad (terminator.js bulletHit) -- which go down on the
 *    MINIGUN.terminatorHits-th round, and the hunter ships (the shared
 *    register's hunterShip kind, a quarter of their hull a round).
 *    Everything else stops the round and shrugs it off: buildings, cars,
 *    trees, aliens, the UFO and the mothership, the funnel.
 *  - **Railgun**: the Lightning tile's strike (engine/strikeTargeting.js)
 *    in Roger's hands. Raised, a ring on the ground marks where the
 *    crosshair meets the town, as the Lightning tile's ring does under the
 *    pointer, and every pull of the trigger calls one bolt down on it
 *    (strikeTargeting.js boltAt) -- with everything a bolt does there.
 *    Not within RAILGUN.minRange of his own feet: a bolt that close would
 *    be his too.
 *  - **Fire Gun**: the cyber T-Rex's flame in Roger's hands, while the
 *    trigger is held (hero/fireGun.js): it sets buildings alight, burns
 *    people and aliens, and is the one weapon that hurts the Cyber Yeti.
 *    No energy, no ammunition.
 *  - **Black Hole Gun**: aimed the same way; a ring on the ground shows the
 *    no-escape line round where it would open, and the trigger opens a
 *    black hole there (engine/player/blackHole.js) for 20 s, at HOLE.cost
 *    energy segments (half the bar). Firing while one is open makes it
 *    collapse and opens the new one behind it.
 *
 * Meshes are made through heroMode.js's keepGeo/keepMat, so they go with
 * the rest of a run's resources when Hero Mode ends.
 */

export const WEAPONS = ['rifle', 'minigun', 'railgun', 'fire', 'blackhole', 'katana'];
/** The most a single frame's mouse movement may add to a first-person swipe, pixels (a pointer-lock spike is scaled down to it). */
const SWIPE_FRAME_MAX_PX = 400;
const WEAPON_NAMES = { rifle: 'PLASMA RIFLE', minigun: 'MINIGUN', railgun: 'RAILGUN', fire: 'FIRE GUN', blackhole: 'BLACK HOLE GUN', katana: 'KATANA' };
// Each weapon's colour on the HUD's WEAPON line (the railgun is yellow now).
const WEAPON_COLOURS = { rifle: '', minigun: '#e8c46a', railgun: '#ffd83a', fire: '#ff8a3a', blackhole: '#c99bff', katana: '#9fe8ff' };
// The railgun's yellow: its coils, its flash, its ring.
// Held to ~1-1.5 so the core stays yellow instead of clipping to white.
const RAIL_YELLOW = new THREE.Color(1.5, 1.15, 0.1);
// The ring: a deeper, more saturated amber than the core, so it separates.
const RAIL_RING = new THREE.Color(1.0, 0.45, 0.04).multiplyScalar(LIGHTING.railgunRingEmissive);

export const MINIGUN = {
  ammo: 200,               // on request (2026-10-01): 200 again (it was 600)
  rate: 18,                // rounds a second while the trigger is held
  spread: 0.018,           // radians of scatter per round
  terminatorHits: 30,      // rounds that bring a Terminator down
  personEnergy: 400,       // damage.js impact scale: over a person's 90, fatal
  spinUp: 14,              // barrel spin, radians/sec^2 of the trigger held
  spinMax: 40
};
const RAILGUN = {
  cooldown: 0.2,           // seconds between two bolts
  minRange: 9
};
const HOLE_GUN = {
  minRange: 12,            // not opened on his own feet
  cooldown: 0.6
};

const UP = new THREE.Vector3(0, 1, 0);

/**
 * @typedef {Object} HeroApi what heroMode.js lends the weapons
 * @property {(geometry: THREE.BufferGeometry) => THREE.BufferGeometry} keepGeo
 * @property {(material: THREE.Material) => THREE.Material} keepMat
 * @property {(o: THREE.Vector3, d: THREE.Vector3) => {t: number, kind: string, obj: Object|null}} traceAim
 * @property {(text: string) => void} flashMessage
 * @property {() => THREE.Vector3} rogerPosition
 * @property {(unit: Object, killAt: number) => number} pursuerBulletHit one
 *   of his own pursuers hit by a round; the rounds it has taken so far
 * @property {import('./hero/katana/slash.js').KatanaSlashEnv} katanaBody what
 *   the Katana's quick slash needs of Roger (heading, state, movement helpers)
 */

/**
 * @typedef {Object} KatanaInput the Katana's swipe input (Subtask 2), read by
 *   the slash logic later; the numbers are the mouse's own movement, in pixels
 * @property {boolean} drawn out of the sheath on the back: set automatically while it is the weapon in hand (running or in first person)
 * @property {boolean} down the left button is held
 * @property {number} pressX where the virtual cursor was when the button went down (the cut line's start)
 * @property {number} pressY
 * @property {number} swipeX mouse movement along x since the button went down
 * @property {number} swipeY mouse movement along y since the button went down
 * @property {number} cursorX the virtual cursor, driven by accumulated movement (0 to innerWidth)
 * @property {number} cursorY the virtual cursor (0 to innerHeight)
 */

/**
 * @typedef {Object} KatanaRelease what a button release hands the slash logic
 * @property {number} dx swipe movement along x
 * @property {number} dy swipe movement along y
 */

/**
 * @param {Object} ctx
 * @param {HeroApi} hero
 * @returns {{
 *   startRun: () => void,
 *   endRun: () => void,
 *   dispose: () => void,
 *   current: () => string,
 *   cycle: (dir?: number) => void,
 *   showView: (on: boolean) => void,
 *   triggerDown: () => boolean,
 *   triggerUp: () => void,
 *   placeView: (cam: THREE.Camera, sway: number) => void,
 *   update: (rawDt: number, aiming: boolean, cam: THREE.Camera, aimDir: THREE.Vector3) => void,
 *   hudLine: () => string,
 *   isHot: (kind: string) => boolean|null,
 *   bulletTime: (on: boolean) => void,
 *   hudColour: () => string,
 *   katanaDraw: () => boolean,
 *   katanaPress: (centred?: boolean) => boolean,
 *   katanaRelease: () => KatanaRelease|null,
 *   katanaCancel: () => void,
 *   katanaLook: (dx: number, dy: number, centred?: boolean) => void,
 *   katanaState: () => Readonly<KatanaInput>,
 *   guestFlame: (gun: {tick: number}, dt: number, muzzle: THREE.Vector3, dir: THREE.Vector3) => void,
 *   katanaBladeToggle: () => boolean,
 *   katanaBlade: () => import('./hero/katana/blade.js').KatanaBlade,
 *   katanaBladeLine: () => Readonly<import('./hero/katana/bladeUi.js').BladeLine>
 * }}
 */
export function createHeroWeapons(ctx, hero) {
  const { Sim } = ctx;
  const state = {
    weapon: 0,
    ammo: MINIGUN.ammo,
    firing: false,
    fireClock: 0,
    spin: 0,
    recoil: 0,
    railCooldown: 0,
    shown: false
  };
  /** @type {{group: THREE.Group, muzzle: THREE.Object3D, flash: THREE.Mesh, barrels?: THREE.Group, glow?: THREE.MeshBasicMaterial}|null} */
  let minigunView = null;
  /** @type {{group: THREE.Group, muzzle: THREE.Object3D, flash: THREE.Mesh, glow: THREE.MeshBasicMaterial}|null} */
  let railgunView = null;
  /** @type {{group: THREE.Group, muzzle: THREE.Object3D, flash: THREE.Mesh, glow: THREE.MeshBasicMaterial, core: THREE.Mesh, rings: THREE.Group}|null} */
  let holeView = null;
  /** @type {THREE.Group|null} the Black Hole Gun's aim: a point and the no-escape line */
  let holeReticle = null;
  let holeCooldown = 0;
  /** @type {ReturnType<typeof createBullets>|null} the rounds in flight */
  let bullets = null;
  /** @type {ReturnType<typeof createFireGun>|null} */
  let fireGun = null;
  /** @type {{group: THREE.Group, muzzle: THREE.Object3D, flash: THREE.Mesh, pilot: THREE.Mesh}|null} */
  let fireView = null;
  /** @type {KatanaInput} */
  const katana = { drawn: false, down: false, pressX: 0, pressY: 0, swipeX: 0, swipeY: 0, cursorX: 0, cursorY: 0 };
  /** @type {ReturnType<typeof createKatanaPieces>|null} the cut halves (hero/katana/pieces.js), made on first use, disposed in endRun */
  let pieces = null;
  /**
   * The slicing core, made when the Katana is first drawn or first cuts.
   * @returns {ReturnType<typeof createKatanaPieces>}
   */
  function ensurePieces() {
    if (!pieces) {
      pieces = createKatanaPieces(ctx, {
        onCut: (from, to, normal, human) => {
          ensureGoo().burst(from, to, normal, human);
          feel.flash(from, to);
        }
      });
    }
    return pieces;
  }
  /** @type {ReturnType<typeof createKatanaGoo>|null} the alien blood (hero/katana/goo.js): made once a simulation, emptied in endRun, disposed with the simulation */
  let goo = null;
  /**
   * The alien blood, made on the first cut (its pool is tracked by the
   * particle budget, which cannot untrack, so it is never remade per run).
   * @returns {ReturnType<typeof createKatanaGoo>}
   */
  function ensureGoo() {
    if (!goo) goo = createKatanaGoo(ctx);
    return goo;
  }
  /** The cut's hit-stop, shake, flash and bonus score (hero/katana/feel.js): one per simulation, cleared in endRun, disposed with the simulation. */
  const feel = createKatanaFeel(ctx);
  /** The Katana's quick slash (hero/katana/slash.js): one per simulation, cleared with `katanaCancel`. */
  const slash = createKatanaSlash(ctx, { ...hero.katanaBody, pieces: ensurePieces, feel: () => feel });
  /** Blade Mode (hero/katana/blade.js): one per simulation, left by `katanaCancel`, freed in dispose. */
  const bladeCut = createKatanaBladeCut(ctx, {
    input: () => katana,
    position: hero.katanaBody.position,
    rig: hero.katanaBody.rig,
    pieces: ensurePieces,
    feel: () => feel
  });
  const blade = createKatanaBlade(ctx, { canAct: hero.katanaBody.canAct, cut: bladeCut.resolve });
  /** Blade Mode's vignette, alien highlights and cut line (hero/katana/bladeUi.js): one per simulation, cleared in katanaCancel and endRun, freed in dispose. */
  /** First person with the Katana in hand (set each frame in `update`): the cut line is drawn while the left button is dragged. */
  let tracing = false;
  const bladeUi = createKatanaBladeUi(ctx, {
    active: blade.active, input: () => katana, position: hero.katanaBody.position, tracing: () => tracing
  });
  const muzzleAt = new THREE.Vector3();
  /** @type {THREE.Mesh|null} the railgun's ring on the ground */
  let reticle = null;
  const railPoint = new THREE.Vector3();
  let railHasPoint = false;
  const scratch = new THREE.Vector3();
  // The hunter a landing round was aimed at, and where it lands: read by
  // roundVisit below (set just before each lookup, never kept).
  /** @type {{target: any, at: THREE.Vector3 | null, stopped: boolean}} */
  const round = { target: null, at: null, stopped: false };
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  const lift = new THREE.Vector3();

  /** @returns {string} */
  function current() {
    return WEAPONS[state.weapon];
  }

  // ---------------------------------------------------------------------
  // The close-up models
  // ---------------------------------------------------------------------

  /**
   * The parts every close-up model shares: the gloved hands and red sleeves,
   * and a muzzle with a flash on it.
   * @param {THREE.Group} group
   * @param {number} muzzleZ
   * @param {THREE.Color} flashColour
   * @returns {{muzzle: THREE.Object3D, flash: THREE.Mesh}}
   */
  function addHandsAndMuzzle(group, muzzleZ, flashColour) {
    const glove = hero.keepMat(new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.8 }));
    const sleeve = hero.keepMat(new THREE.MeshStandardMaterial({ color: 0xc0282d, roughness: 0.7 }));
    /**
     * @param {THREE.BufferGeometry} geo
     * @param {THREE.Material} mat
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {THREE.Mesh}
     */
    const add = (geo, mat, x, y, z) => {
      const mesh = new THREE.Mesh(hero.keepGeo(geo), mat);
      mesh.position.set(x, y, z);
      mesh.frustumCulled = false;
      group.add(mesh);
      return mesh;
    };
    add(new THREE.BoxGeometry(0.13, 0.14, 0.2), glove, 0.01, -0.16, -0.22);
    add(new THREE.CylinderGeometry(0.075, 0.09, 0.7, 10), sleeve, 0.06, -0.35, 0.1).rotation.x = 1.0;
    add(new THREE.BoxGeometry(0.12, 0.1, 0.18), glove, -0.04, -0.14, -0.72);
    add(new THREE.CylinderGeometry(0.07, 0.085, 0.9, 10), sleeve, -0.22, -0.4, -0.45).rotation.set(0.9, 0, -0.6);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0, muzzleZ);
    group.add(muzzle);
    const flash = new THREE.Mesh(hero.keepGeo(new THREE.SphereGeometry(0.1, 10, 8)), hero.keepMat(new THREE.MeshBasicMaterial({
      color: flashColour, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
    })));
    flash.visible = false;
    flash.frustumCulled = false;
    muzzle.add(flash);
    return { muzzle, flash };
  }

  /**
   * The minigun: a squat receiver, an ammo box on its side and six barrels
   * round a spindle that spins up while the trigger is held.
   * @returns {NonNullable<typeof minigunView>}
   */
  function buildMinigun() {
    const group = new THREE.Group();
    group.name = 'hero_view_minigun';
    const dark = hero.keepMat(new THREE.MeshStandardMaterial({ color: 0x33373d, metalness: 0.8, roughness: 0.35, emissive: 0x0c0e11 }));
    const steel = hero.keepMat(new THREE.MeshStandardMaterial({ color: 0x9aa1ab, metalness: 0.9, roughness: 0.25, emissive: 0x15181c }));
    const olive = hero.keepMat(new THREE.MeshStandardMaterial({ color: 0x4b5233, roughness: 0.7 }));
    /**
     * @param {THREE.BufferGeometry} geo
     * @param {THREE.Material} mat
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {THREE.Object3D} [parent]
     * @returns {THREE.Mesh}
     */
    const add = (geo, mat, x, y, z, parent = group) => {
      const mesh = new THREE.Mesh(hero.keepGeo(geo), mat);
      mesh.position.set(x, y, z);
      mesh.frustumCulled = false;
      parent.add(mesh);
      return mesh;
    };
    add(new THREE.BoxGeometry(0.24, 0.22, 0.5), dark, 0, 0, -0.3);            // receiver
    add(new THREE.BoxGeometry(0.2, 0.2, 0.26), olive, -0.2, -0.05, -0.28);     // ammo box
    add(new THREE.BoxGeometry(0.05, 0.14, 0.05), dark, 0, 0.16, -0.22);        // carry handle posts
    add(new THREE.BoxGeometry(0.05, 0.03, 0.3), dark, 0, 0.23, -0.3);
    const barrels = new THREE.Group();
    barrels.position.set(0, 0, -0.55);
    group.add(barrels);
    const barrelGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.75, 8);
    barrelGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      add(barrelGeo, steel, Math.cos(a) * 0.055, Math.sin(a) * 0.055, -0.37, barrels);
    }
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.75, 6).rotateX(Math.PI / 2), dark, 0, 0, -0.37, barrels);
    for (const z of [-0.12, -0.7]) {
      add(new THREE.TorusGeometry(0.075, 0.015, 6, 18), steel, 0, 0, z, barrels);
    }
    const { muzzle, flash } = addHandsAndMuzzle(group, -1.3, new THREE.Color(3, 1.8, 0.5));
    group.traverse((child) => { child.castShadow = false; child.receiveShadow = false; });
    group.visible = false;
    Sim.three.scene.add(group);
    return { group, muzzle, flash, barrels };
  }

  /**
   * The railgun: two long rails with a gap between them, violet coils
   * glowing along it (brighter as it recharges to the next bolt) and a
   * stock.
   * @returns {NonNullable<typeof railgunView>}
   */
  function buildRailgun() {
    const group = new THREE.Group();
    group.name = 'hero_view_railgun';
    const dark = hero.keepMat(new THREE.MeshStandardMaterial({ color: 0x23262e, metalness: 0.8, roughness: 0.3, emissive: 0x0b0c10 }));
    const steel = hero.keepMat(new THREE.MeshStandardMaterial({ color: 0xb4bac6, metalness: 0.9, roughness: 0.2, emissive: 0x16181d }));
    const glow = /** @type {THREE.MeshBasicMaterial} */ (hero.keepMat(new THREE.MeshBasicMaterial({ color: RAIL_YELLOW.clone() })));
    /**
     * @param {THREE.BufferGeometry} geo
     * @param {THREE.Material} mat
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {THREE.Mesh}
     */
    const add = (geo, mat, x, y, z) => {
      const mesh = new THREE.Mesh(hero.keepGeo(geo), mat);
      mesh.position.set(x, y, z);
      mesh.frustumCulled = false;
      group.add(mesh);
      return mesh;
    };
    add(new THREE.BoxGeometry(0.18, 0.2, 0.55), dark, 0, 0, -0.28);            // body
    add(new THREE.BoxGeometry(0.12, 0.16, 0.3), dark, 0, -0.04, 0.05);         // stock
    for (const y of [0.07, -0.05]) add(new THREE.BoxGeometry(0.1, 0.035, 1.05), steel, 0, y, -0.95);
    for (let i = 0; i < 5; i++) {
      const coil = add(new THREE.TorusGeometry(0.085, 0.018, 6, 18), glow, 0, 0.01, -0.6 - i * 0.17);
      coil.rotation.y = 0;
    }
    add(new THREE.BoxGeometry(0.02, 0.02, 0.9), glow, 0, 0.01, -0.95);         // the charge between the rails
    const { muzzle, flash } = addHandsAndMuzzle(group, -1.5, new THREE.Color(3, 2.6, 0.6));
    group.traverse((child) => { child.castShadow = false; child.receiveShadow = false; });
    group.visible = false;
    Sim.three.scene.add(group);
    return { group, muzzle, flash, glow };
  }

  /**
   * The Black Hole Gun: a squat dark emitter with a black sphere held in
   * spinning violet rings at the muzzle, glowing brighter when the bar can
   * pay for a shot.
   * @returns {NonNullable<typeof holeView>}
   */
  function buildHoleGun() {
    const group = new THREE.Group();
    group.name = 'hero_view_blackhole';
    const dark = hero.keepMat(new THREE.MeshStandardMaterial({ color: 0x1a1622, metalness: 0.8, roughness: 0.3, emissive: 0x0a0610 }));
    const glow = /** @type {THREE.MeshBasicMaterial} */ (hero.keepMat(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 0.5, 2.4) })));
    const black = hero.keepMat(new THREE.MeshBasicMaterial({ color: 0x000000 }));
    /**
     * @param {THREE.BufferGeometry} geo
     * @param {THREE.Material} mat
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {THREE.Object3D} [parent]
     * @returns {THREE.Mesh}
     */
    const add = (geo, mat, x, y, z, parent = group) => {
      const mesh = new THREE.Mesh(hero.keepGeo(geo), mat);
      mesh.position.set(x, y, z);
      mesh.frustumCulled = false;
      parent.add(mesh);
      return mesh;
    };
    add(new THREE.BoxGeometry(0.22, 0.22, 0.6), dark, 0, 0, -0.3);
    add(new THREE.CylinderGeometry(0.09, 0.13, 0.4, 12).rotateX(Math.PI / 2), dark, 0, 0, -0.75);
    for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.24, 0.02, 0.05), glow, 0, 0.12, -0.15 - i * 0.14);
    const core = add(new THREE.SphereGeometry(0.075, 16, 12), black, 0, 0, -1.08);
    const rings = new THREE.Group();
    rings.position.set(0, 0, -1.08);
    group.add(rings);
    for (let i = 0; i < 2; i++) {
      const ring = add(new THREE.TorusGeometry(0.13 + i * 0.04, 0.008, 6, 32), glow, 0, 0, 0, rings);
      ring.rotation.set(i ? 1.1 : 0.4, i ? 0.5 : -0.3, 0);
    }
    const { muzzle, flash } = addHandsAndMuzzle(group, -1.08, new THREE.Color(1.4, 0.6, 2.8));
    group.traverse((child) => { child.castShadow = false; child.receiveShadow = false; });
    group.visible = false;
    Sim.three.scene.add(group);
    return { group, muzzle, flash, glow, core, rings };
  }

  /**
   * The bullets, the Fire Gun's flames and the aiming rings, made on first
   * use.
   * @returns {void}
   */
  function buildEffects() {
    if (bullets) return;
    bullets = createBullets(ctx);
    fireGun = createFireGun(ctx, hero);
    const ring = hero.keepGeo(new THREE.RingGeometry(3.2, 3.8, 40));
    ring.rotateX(-Math.PI / 2);
    reticle = new THREE.Mesh(ring, hero.keepMat(new THREE.MeshBasicMaterial({
      color: RAIL_RING.clone(), transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
    })));
    reticle.name = 'hero_railgun_reticle';
    reticle.renderOrder = 3;
    reticle.visible = false;
    Sim.three.scene.add(reticle);

    // The Black Hole Gun's: a point where it opens and the no-escape line
    // round it, so you can see what it will take.
    holeReticle = new THREE.Group();
    holeReticle.name = 'hero_blackhole_reticle';
    const holeMat = hero.keepMat(new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.1, 0.45, 2.2), transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
    }));
    const centre = new THREE.Mesh(hero.keepGeo(new THREE.RingGeometry(2.4, 3.2, 40).rotateX(-Math.PI / 2)), holeMat);
    const line = new THREE.Mesh(hero.keepGeo(new THREE.RingGeometry(HOLE.escape - 0.6, HOLE.escape, 96).rotateX(-Math.PI / 2)), holeMat);
    for (const m of [centre, line]) { m.renderOrder = 3; holeReticle.add(m); }
    holeReticle.visible = false;
    Sim.three.scene.add(holeReticle);
  }

  /**
   * @returns {{group: THREE.Group, muzzle: THREE.Object3D, flash: THREE.Mesh}|null}
   *   the close-up model of the weapon in hand; null for the rifle, which is
   *   heroMode.js's
   */
  function view() {
    if (current() === 'minigun') return minigunView || (minigunView = buildMinigun());
    if (current() === 'railgun') return railgunView || (railgunView = buildRailgun());
    if (current() === 'blackhole') return holeView || (holeView = buildHoleGun());
    if (current() === 'fire') {
      buildEffects();
      return fireView || (fireView = /** @type {NonNullable<typeof fireGun>} */ (fireGun).build(addHandsAndMuzzle));
    }
    return null;
  }

  /**
   * Shows the close-up model of the weapon in hand (aim mode) or hides them
   * all.
   * @param {boolean} on
   * @returns {void}
   */
  function showView(on) {
    state.shown = on;
    if (!on) triggerUp();
    buildEffects();
    const inHand = on ? view() : null;
    for (const vm of [minigunView, railgunView, holeView, fireView]) if (vm) vm.group.visible = vm === inHand;
    if (reticle && !on) reticle.visible = false;
    if (holeReticle && !on) holeReticle.visible = false;
  }

  /**
   * The model in hand, placed in the camera's frame as the rifle is.
   * @param {THREE.Camera} cam
   * @param {number} sway -1..1 of the walk
   * @returns {void}
   */
  function placeView(cam, sway) {
    const vm = state.shown ? view() : null;
    if (!vm) return;
    const shake = state.firing && (current() === 'minigun' || current() === 'fire') ? (Math.random() - 0.5) * 0.008 : 0;
    vm.group.position.set(0.3 + sway * 0.012 + shake, -0.3 + Math.abs(sway) * 0.012 + state.recoil * 0.02 + shake, -0.32 + state.recoil * 0.1)
      .applyQuaternion(cam.quaternion).add(cam.position);
    vm.group.quaternion.copy(cam.quaternion);
    vm.group.rotateX(state.recoil * 0.08);
    vm.group.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------

  /**
   * The mouse wheel: the next weapon, or the one before.
   * @param {number} [dir] 1 next, -1 previous
   * @returns {void}
   */
  function cycle(dir = 1) {
    triggerUp();
    katanaCancel();
    state.weapon = (state.weapon + (dir < 0 ? WEAPONS.length - 1 : 1)) % WEAPONS.length;
    if (state.shown) showView(true);
    const w = current();
    const extra = w === 'minigun' ? ` · ${state.ammo} rounds`
      : w === 'railgun' ? ' · click to call a bolt down'
        : w === 'fire' ? ' · hold to burn · the only thing the Yeti fears'
          : w === 'blackhole' ? ` · ${HOLE.cost * 10}% energy a shot`
            : w === 'katana' ? ' · drawn · RIGHT-CLICK for first person · hold the left button and drag a line to cut along it' : '';
    hero.flashMessage(`${WEAPON_NAMES[w]}${extra}`);
  }

  /**
   * The trigger going down, for the minigun and the railgun.
   * @returns {boolean} whether it was theirs; false leaves it to the rifle
   */
  function triggerDown() {
    const w = current();
    if (w === 'minigun') {
      if (state.ammo <= 0) {
        ctx.systems.heroSound.playDryClick();
        hero.flashMessage('MINIGUN EMPTY — wheel for another weapon');
        return true;
      }
      state.firing = true;
      // The first round goes on the press.
      state.fireClock = 1 / MINIGUN.rate;
      return true;
    }
    if (w === 'railgun') {
      fireRail();
      return true;
    }
    if (w === 'fire') {
      state.firing = true;
      return true;
    }
    if (w === 'blackhole') {
      fireHole();
      return true;
    }
    return false;
  }

  /** @returns {void} */
  function triggerUp() {
    state.firing = false;
  }

  // ---------------------------------------------------------------------
  // The Katana's draw state, swipe input and quick slash
  // ---------------------------------------------------------------------

  /**
   * Draws the Katana from the sheath on the back. Called each frame by
   * hero/input.js while the Katana is the weapon in hand and Roger is on foot,
   * upright and unfrozen. It asks for no pointer lock and touches no camera:
   * the lock and the first-person view belong to enterAim/leaveAim
   * (hero/plasma.js) alone. The virtual cursor starts at the middle of the window.
   * @returns {boolean} whether it was drawn by this call (false: already out, or not in hand)
   */
  function katanaDraw() {
    if (katana.drawn || current() !== 'katana') return false;
    katana.drawn = true;
    // The cut's shader variants are built now, not at the first cut.
    ensurePieces().prewarm();
    katana.cursorX = window.innerWidth / 2;
    katana.cursorY = window.innerHeight / 2;
    return true;
  }

  /**
   * The left button goes down on the drawn Katana: the swipe starts from zero.
   * @param {boolean} [centred] first person: start the swipe at the crosshair
   * @returns {boolean} whether it was taken (drawn and not already down)
   */
  function katanaPress(centred = false) {
    if (!katana.drawn || katana.down) return false;
    katana.down = true;
    // First person: the swipe and the Blade Mode cut line start at the
    // crosshair, the middle of the window.
    if (centred) {
      katana.cursorX = window.innerWidth / 2;
      katana.cursorY = window.innerHeight / 2;
    }
    katana.pressX = katana.cursorX;
    katana.pressY = katana.cursorY;
    katana.swipeX = 0;
    katana.swipeY = 0;
    return true;
  }

  /**
   * Takes the press's swipe and clears it, with no slash.
   * @returns {KatanaRelease|null} null if no press was taken
   */
  function takeRelease() {
    if (!katana.down) return null;
    const out = { dx: katana.swipeX, dy: katana.swipeY };
    katana.down = false;
    katana.swipeX = 0;
    katana.swipeY = 0;
    return out;
  }

  /**
   * The left button comes up: Blade Mode, if it is on, takes the release and
   * keeps its window going (a cut, a miss, or a drag too short to be a line);
   * otherwise any press is a quick slash (a swipe picks its direction, a plain
   * click runs the chain), however long it was held.
   * @returns {KatanaRelease|null} the swipe, or null if no press was taken
   */
  function katanaRelease() {
    const out = takeRelease();
    if (out && katana.drawn && !blade.release(out)) slash.release(out);
    return out;
  }

  /**
   * Puts the Katana away and drops anything held: the wheel, a blur, a car, a
   * daze, a freeze, death, the run ending. It never touches the pointer lock
   * (that is aim mode's, released by leaveAim).
   * @returns {void}
   */
  function katanaCancel() {
    katana.drawn = false;
    takeRelease();
    blade.cancel();
    bladeUi.clear();
    slash.cancel();
  }

  /**
   * The frame's mouse movement, handed on by hero/input.js (which is the one
   * place that drains the input's look, so it is not drained twice).
   * In first person (`centred`) the movement only arrives here while the
   * button is down (the look is frozen then): it is the swipe, and the
   * virtual cursor is the crosshair plus the swipe, kept inside the window.
   * A large pointer-lock delta is scaled down as a whole (its direction is
   * kept) to SWIPE_FRAME_MAX_PX a frame.
   * @param {number} dx
   * @param {number} dy
   * @param {boolean} [centred] first person: the cursor is anchored at the crosshair
   * @returns {void}
   */
  function katanaLook(dx, dy, centred = false) {
    if (!katana.drawn || (!dx && !dy)) return;
    const size = Math.hypot(dx, dy);
    if (centred && size > SWIPE_FRAME_MAX_PX) {
      const k = SWIPE_FRAME_MAX_PX / size;
      dx *= k;
      dy *= k;
    }
    if (centred) {
      if (katana.down) {
        katana.swipeX += dx;
        katana.swipeY += dy;
        katana.cursorX = Math.min(window.innerWidth, Math.max(0, katana.pressX + katana.swipeX));
        katana.cursorY = Math.min(window.innerHeight, Math.max(0, katana.pressY + katana.swipeY));
      }
      return;
    }
    katana.cursorX = Math.min(window.innerWidth, Math.max(0, katana.cursorX + dx));
    katana.cursorY = Math.min(window.innerHeight, Math.max(0, katana.cursorY + dy));
    if (katana.down) {
      katana.swipeX += dx;
      katana.swipeY += dy;
    }
  }

  /**
   * Q with the Katana in hand: Blade Mode on, or off if it is on already. It
   * costs no energy and is not Time Slow. Only a drawn Katana on a Roger who
   * can act begins it; leaving it is always allowed.
   * @returns {boolean} whether Blade Mode is on afterwards
   */
  function katanaBladeToggle() {
    if (blade.active()) {
      blade.cancel();
      bladeUi.clear();
      return false;
    }
    return katana.drawn && current() === 'katana' && blade.enter();
  }

  /** @returns {Readonly<KatanaInput>} the live swipe state (one object, updated in place) */
  function katanaState() {
    return katana;
  }

  // ---------------------------------------------------------------------
  // Firing
  // ---------------------------------------------------------------------

  /**
   * One minigun round down the sights, with its scatter.
   * @param {THREE.Camera} cam
   * @param {THREE.Vector3} aimDir
   * @returns {void}
   */
  function fireBullet(cam, aimDir) {
    state.ammo--;
    state.recoil = Math.min(1, state.recoil + 0.35);
    // Scatter: a random nudge across the line of fire.
    side.crossVectors(aimDir, UP).normalize();
    lift.crossVectors(side, aimDir).normalize();
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * MINIGUN.spread;
    dir.copy(aimDir).addScaledVector(side, Math.cos(a) * r).addScaledVector(lift, Math.sin(a) * r).normalize();
    const hit = hero.traceAim(cam.position, dir);
    const at = scratch.copy(cam.position).addScaledVector(dir, hit.t).clone();
    const vm = view();
    const from = vm ? vm.muzzle.getWorldPosition(new THREE.Vector3()) : cam.position.clone();
    if (vm) {
      vm.flash.visible = true;
      vm.flash.material.opacity = 0.9;
      vm.flash.scale.setScalar(0.8 + Math.random() * 0.8);
      vm.flash.userData.life = 0.04;
    }
    // The round flies there (hero/bullets.js), and its hit lands when it
    // arrives (landRound); the casing goes out of the gun's right side.
    const eject = vm ? vm.group.localToWorld(muzzleAt.set(0.12, 0.02, -0.4)) : from;
    if (bullets) bullets.fire(from, at, { kind: hit.kind, obj: hit.obj, at }, eject.clone(), side);
    ctx.systems.heroSound.playBullet();
    if (state.ammo <= 0) {
      state.firing = false;
      hero.flashMessage('MINIGUN EMPTY — wheel for another weapon');
    }
  }

  /**
   * Finds the hunter a round was aimed at among the live ones of the shared
   * register (a downed or gone ship is no longer listed) and hits it.
   * @param {any} e
   * @param {{kind: string}} kind
   * @returns {void}
   */
  function roundVisit(e, kind) {
    if (e !== round.target || kind.kind !== 'hunterShip') return;
    round.stopped = ctx.systems.enemies.hit(e, /** @type {any} */ (kind), { type: 'bullet', at: round.at });
  }

  /**
   * A round arriving where it was aimed: what it does there.
   * @param {{kind: string, obj: any, at: THREE.Vector3}} hit
   * @returns {void}
   */
  function landRound(hit) {
    const at = hit.at;
    const s = ctx.systems;
    if (hit.kind === 'person' && hit.obj) {
      if (!hit.obj.mesh || !hit.obj.mesh.parent) return;
      s.damage.damageFromImpact(hit.obj, at, MINIGUN.personEnergy);
      // A killing breaks Smooth Criminal's spell (engine/smoothCriminal.js).
      ctx.events.emit('rogerKill');
    } else if (hit.kind === 'terminator' && hit.obj) {
      const n = hero.pursuerBulletHit(hit.obj, MINIGUN.terminatorHits);
      if (n > 0 && n < MINIGUN.terminatorHits) hero.flashMessage(`TERMINATOR HIT ${n} / ${MINIGUN.terminatorHits}`);
    } else if (hit.kind === 'enemy' && hit.obj) {
      // An enemy of the shared register (engine/enemies.js): the T-Rex.
      if (s.enemies.hit(hit.obj.e, hit.obj.kind, { type: 'bullet', at })) ctx.events.emit('rogerKill');
    } else if (hit.kind === 'samurai' && hit.obj && s.spaceship) {
      // One of Landing Support's samurai: only Roger can bring one down.
      if (s.spaceship.hitSamurai(hit.obj, 'bullet')) ctx.events.emit('rogerKill');
    } else if (hit.kind === 'ship' && hit.obj && hit.obj.hunter) {
      // A hunter ship only (the UFO, below, and the mothership carry no `hunter`). Rounds take time to arrive: the ship is looked up by
      // identity now, and a downed or gone one is simply not found.
      round.target = hit.obj.hunter;
      round.at = at;
      round.stopped = false;
      s.enemies.each(roundVisit);
      round.target = null;
      round.at = null;
      if (round.stopped) ctx.events.emit('rogerKill');
    } else if (hit.kind === 'ship' && hit.obj && shipKindOf(hit.obj.name)) {
      // The alien ship or the mothership (D1, D3): a round chips its hull by the table.
      if (hit.obj.hit(tableDamage(/** @type {string} */ (shipKindOf(hit.obj.name)), { type: 'bullet' })) === 0) ctx.events.emit('rogerKill');
    } else if (hit.kind === 'nuclear' && hit.obj && s.nuclear) {
      // The reactor (D3): a round chips the containment.
      s.nuclear.chipPlant(hit.obj, { type: 'bullet' });
    } else if (hit.kind === 'tornado' && hit.obj && s.heroMode) {
      // A funnel (D3): a round chips its health; at 0 it is neutralised.
      s.heroMode.chipTornado(hit.obj, { type: 'bullet' });
    } else if (hit.kind === 'unit' && hit.obj && s.terminator) {
      const n = s.terminator.bulletHit(hit.obj, MINIGUN.terminatorHits);
      if (n > 0 && n < MINIGUN.terminatorHits) hero.flashMessage(`TERMINATOR HIT ${n} / ${MINIGUN.terminatorHits}`);
    }
  }

  /**
   * Bullet Time (player/abilities.js, Q with the minigun in hand): the
   * rounds in the air hang, new ones hang after a few metres; off, they all
   * go on together.
   * @param {boolean} on
   * @returns {void}
   */
  function bulletTime(on) {
    buildEffects();
    if (bullets) bullets.setFrozen(on);
  }

  /**
   * One railgun bolt, on the ring.
   * @returns {void}
   */
  function fireRail() {
    if (state.railCooldown > 0) return;
    if (!railHasPoint) {
      hero.flashMessage('RAILGUN — aim at the ground or a target');
      return;
    }
    const r = hero.rogerPosition();
    if (Math.hypot(railPoint.x - r.x, railPoint.z - r.z) < RAILGUN.minRange) {
      hero.flashMessage('TOO CLOSE — the bolt would hit Roger');
      return;
    }
    state.railCooldown = RAILGUN.cooldown;
    state.recoil = 1;
    // Anyone -- a person or an alien -- where it lands is killed, and a
    // killing breaks Smooth Criminal's spell (engine/smoothCriminal.js).
    const victims = ctx.Environment.people.some(p => p.mesh.parent && Math.hypot(p.mesh.position.x - railPoint.x, p.mesh.position.z - railPoint.z) < 5)
      || (ctx.systems.aliens && ctx.systems.aliens.targets().some(a => Math.hypot(a.root.position.x - railPoint.x, a.root.position.z - railPoint.z) < 5))
      // A samurai under it (Landing Support): the bolt is Roger's, so it can.
      || (!!ctx.systems.spaceship && ctx.systems.spaceship.hitSamuraiArea(railPoint.x, railPoint.z, 5, 'bolt') > 0);
    ctx.systems.strikeTargeting.boltAt(railPoint.x, railPoint.z);
    if (victims) ctx.events.emit('rogerKill');
    const vm = view();
    if (vm) {
      vm.flash.visible = true;
      vm.flash.material.opacity = 1;
      vm.flash.scale.setScalar(2);
      vm.flash.userData.life = 0.12;
    }
    ctx.systems.heroSound.playZap();
  }

  /**
   * The Black Hole Gun: a hole where the crosshair meets the town, paid for
   * from the energy bar.
   * @returns {void}
   */
  function fireHole() {
    if (holeCooldown > 0) return;
    if (!railHasPoint) {
      hero.flashMessage('BLACK HOLE GUN — aim at the ground or a target');
      return;
    }
    const r = hero.rogerPosition();
    if (Math.hypot(railPoint.x - r.x, railPoint.z - r.z) < HOLE_GUN.minRange) {
      hero.flashMessage('TOO CLOSE — aim further out');
      return;
    }
    const energy = ctx.systems.energy.hero;
    if (!energy.canSpend(HOLE.cost)) {
      ctx.systems.heroSound.playDryClick();
      hero.flashMessage(`BLACK HOLE GUN — needs ${HOLE.cost * 10}% energy`);
      return;
    }
    const result = ctx.systems.blackHole.fire(railPoint.x, railPoint.z);
    if (!result) return;
    energy.spend(HOLE.cost);
    ctx.systems.energy.glow();
    holeCooldown = HOLE_GUN.cooldown;
    state.recoil = 1;
    hero.flashMessage(result === 'queued'
      ? '🕳️ The open one collapses · the next opens behind it'
      : `🕳️ BLACK HOLE · ${HOLE.seconds} s · ${HOLE.escape} m and no way back`);
    const vm = view();
    if (vm) {
      vm.flash.visible = true;
      vm.flash.material.opacity = 1;
      vm.flash.scale.setScalar(2.4);
      vm.flash.userData.life = 0.18;
    }
    ctx.systems.heroSound.playZap();
  }

  // ---------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------

  /**
   * Real time: the minigun's rounds and barrels,
   * the railgun's ring, and the tracers and flashes fading.
   * @param {number} rawDt
   * @param {boolean} aiming
   * @param {THREE.Camera} cam
   * @param {THREE.Vector3} aimDir
   * @returns {void}
   */
  function update(rawDt, aiming, cam, aimDir) {
    state.recoil = Math.max(0, state.recoil - rawDt * 5);
    state.railCooldown = Math.max(0, state.railCooldown - rawDt);
    // Blade Mode times itself out on real time (it is begun by Q, katanaBladeToggle).
    blade.update(rawDt);
    // The quick slash's cooldown, wind-up and lunge, on the same real clock.
    slash.update(rawDt);
    // Blade Mode's vignette, highlights and cut line follow the virtual cursor
    // (real time); in first person the line also shows while a cut is dragged.
    tracing = aiming && current() === 'katana' && katana.drawn;
    bladeUi.update(rawDt);
    // The cut halves fly, bounce and fade on the world clock (slow motion applies).
    if (pieces) pieces.update(rawDt * ctx.systems.time.scale('world'));
    if (goo) goo.update(rawDt * ctx.systems.time.scale('world'));
    // The cut's hit-stop and flash run on real time, so they end in slow motion too.
    feel.update(rawDt);

    if (aiming && state.firing && current() === 'minigun') {
      state.fireClock += rawDt;
      const every = 1 / MINIGUN.rate;
      while (state.fireClock >= every && state.firing) {
        state.fireClock -= every;
        fireBullet(cam, aimDir);
      }
    }
    if (minigunView) {
      const spinning = aiming && state.firing && current() === 'minigun';
      state.spin = spinning
        ? Math.min(MINIGUN.spinMax, state.spin + MINIGUN.spinUp * rawDt * 4)
        : Math.max(0, state.spin - MINIGUN.spinUp * rawDt);
      minigunView.barrels.rotation.z += state.spin * rawDt;
    }
    if (railgunView) {
      const ready = 1 - state.railCooldown / RAILGUN.cooldown;
      railgunView.glow.color.copy(RAIL_YELLOW).multiplyScalar(0.45 + 0.55 * ready);
    }
    // The rounds in flight (Roger's, on real time; the casings on the
    // world's), and the Fire Gun's breath.
    if (bullets) bullets.update(rawDt, ctx.systems.time.scale('world'), landRound);
    if (fireGun) {
      const burning = aiming && state.firing && current() === 'fire' && !!fireView;
      fireGun.update(rawDt, burning, burning && fireView ? fireView.muzzle.getWorldPosition(muzzleAt) : null, aimDir);
      if (fireView) fireView.pilot.scale.setScalar(burning ? 0.6 : 1 + 0.2 * Math.sin(performance.now() * 0.02));
    }

    holeCooldown = Math.max(0, holeCooldown - rawDt);
    if (holeView) {
      holeView.rings.rotation.z += rawDt * 4;
      holeView.rings.rotation.y += rawDt * 2.6;
      const ready = ctx.systems.energy.hero.canSpend(HOLE.cost) ? 1 : 0.25;
      holeView.glow.color.setRGB(1.3 * ready, 0.5 * ready, 2.4 * ready);
    }

    // The railgun's ring (and the Black Hole Gun's): where the crosshair
    // meets the town.
    railHasPoint = false;
    if (aiming && (current() === 'railgun' || current() === 'blackhole')) {
      const hit = hero.traceAim(cam.position, aimDir);
      if (hit.kind !== 'sky') {
        railPoint.copy(cam.position).addScaledVector(aimDir, hit.t);
        railHasPoint = true;
      }
    }
    if (holeReticle) {
      holeReticle.visible = railHasPoint && current() === 'blackhole';
      if (holeReticle.visible) holeReticle.position.set(railPoint.x, 0.08, railPoint.z);
    }
    if (reticle) {
      reticle.visible = railHasPoint && current() === 'railgun';
      if (railHasPoint) {
        reticle.position.set(railPoint.x, 0.07, railPoint.z);
        reticle.material.opacity = 0.55 + 0.3 * Math.sin(performance.now() * 0.012);
      }
    }

    for (const vm of [minigunView, railgunView, holeView, fireView]) {
      if (!vm || !vm.flash.visible) continue;
      vm.flash.userData.life -= rawDt;
      vm.flash.material.opacity = Math.max(0, vm.flash.userData.life * 20);
      if (vm.flash.userData.life <= 0) vm.flash.visible = false;
    }
  }

  /**
   * The HUD's weapon line.
   * @returns {string}
   */
  function hudLine() {
    const w = current();
    if (w === 'minigun') return `${WEAPON_NAMES[w]} · ${state.ammo}${ctx.systems.time.scale('world') < 1 ? ' · ⏱' : ''}`;
    if (w === 'blackhole') return `${WEAPON_NAMES[w]} · ${HOLE.cost * 10}%${ctx.systems.blackHole.isOpen() ? ' · 🕳️' : ''}`;
    return WEAPON_NAMES[w];
  }

  /**
   * Whether the crosshair should turn red over this kind of target with the
   * weapon in hand. Null for the rifle, which heroMode.js decides.
   * @param {string} kind traceAim's
   * @returns {boolean|null}
   */
  function isHot(kind) {
    const w = current();
    if (w === 'minigun') return kind === 'person' || kind === 'terminator' || kind === 'unit' || kind === 'enemy';
    if (w === 'railgun' || w === 'blackhole') return kind !== 'sky';
    if (w === 'fire') return kind === 'person' || kind === 'enemy' || kind === 'building';
    // The Katana's crosshair (first person, at the centre) never turns red.
    return null;
  }

  // ---------------------------------------------------------------------
  // A run
  // ---------------------------------------------------------------------

  /**
   * A fresh run: the rifle in hand, a full belt.
   * @returns {void}
   */
  function startRun() {
    katanaCancel();
    blade.clear();
    bladeUi.clear();
    feel.clear();
    Object.assign(state, {
      weapon: 0, ammo: MINIGUN.ammo, firing: false, fireClock: 0, spin: 0, recoil: 0,
      railCooldown: 0, shown: false
    });
  }

  /**
   * The run over: the meshes out of the scene
   * (their geometry and materials go with heroMode.js's run resources).
   * @returns {void}
   */
  function endRun() {
    katanaCancel();
    blade.clear();
    bladeUi.clear();
    state.firing = false;
    state.shown = false;
    for (const vm of [minigunView, railgunView, holeView, fireView]) if (vm) Sim.three.scene.remove(vm.group);
    if (bullets) bullets.dispose();
    if (fireGun) fireGun.dispose();
    if (pieces) pieces.dispose();
    pieces = null;
    if (goo) goo.clear();
    // Their GPU resources (the flash quad, the ring pool, the cut-line node)
    // go with the run; each is rebuilt on first use in the next one.
    feel.dispose();
    bladeUi.dispose();
    if (reticle) Sim.three.scene.remove(reticle);
    if (holeReticle) Sim.three.scene.remove(holeReticle);
    minigunView = null;
    railgunView = null;
    holeView = null;
    holeReticle = null;
    fireView = null;
    bullets = null;
    fireGun = null;
    reticle = null;
  }

  /**
   * The end of the simulation: what outlives a run is freed (the alien blood's pool).
   * @returns {void}
   */
  function dispose() {
    endRun();
    blade.dispose();
    bladeUi.dispose();
    if (goo) goo.dispose();
    goo = null;
    feel.dispose();
  }

  return {
    startRun, endRun, dispose, current, cycle, showView, triggerDown, triggerUp,
    placeView, update, hudLine, isHot, bulletTime,
    katanaDraw, katanaPress, katanaRelease, katanaCancel, katanaLook, katanaState, katanaBladeToggle,
    katanaBlade: () => blade,
    // Co-op guests' Fire Gun (engine/net/system.js): built on first use.
    guestFlame: (/** @type {{tick: number}} */ gun, /** @type {number} */ dt, /** @type {THREE.Vector3} */ muzzle, /** @type {THREE.Vector3} */ dir) => {
      buildEffects();
      if (fireGun) fireGun.breathe(gun, dt, muzzle, dir);
    },
    katanaBladeLine: () => bladeUi.line(),
    hudColour: () => WEAPON_COLOURS[/** @type {keyof typeof WEAPON_COLOURS} */ (current())] || ''
  };
}
