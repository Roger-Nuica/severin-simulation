// @ts-check
import * as THREE from 'three';
import { PERSON } from '../scale.js';

/**
 * ===========================================================================
 * SECTION PG — Grappling hook (G)
 * ===========================================================================
 * A hook on a cable, thrown the way Roger looks (his heading on foot, his
 * aim with the weapon up), for one energy segment
 * (engine/player/abilities.js). What it does depends on the first thing it
 * meets along that line, up to GRAPPLE.range metres:
 *
 *  - an **alien** (patrol or escort): reeled in to GRAPPLE.pullStop metres
 *    in front of him, held still while it comes and stunned for
 *    GRAPPLE.stunSeconds when it arrives -- right in Katana reach;
 *  - a **heavy enemy** (a Terminator, the T-Rex, the Yeti, Patient Zero...):
 *    too heavy to pull, so Roger is zipped to it instead, stopping
 *    GRAPPLE.enemyStop metres short of its hitbox;
 *  - a **wall** (a building, the backdrop town, the dam, the volcano): he
 *    is zipped to it, stopping GRAPPLE.wallStop metres short.
 *
 * The hook does not catch the ships in the air, the nuclear plants, the
 * samurai or the tornadoes. With nothing to catch, or no safe line to zip
 * along (the chasm in the way, too short a pull), the press is refused with
 * a message and nothing is spent (the ability's canStart), like Teleport.
 *
 * Hurts nothing: it moves things. The zip itself is Roger's own movement
 * (heroMode zipRoger, hero/movement.js), so walls stop him as they stop his
 * run; a daze, a car or death let go of the rope.
 *
 * Runs on real time (a Time Slow does not slow the hook), held while the
 * game is paused. The cable and the hook are made once and reused; nothing
 * is allocated per frame.
 *
 * Seen from across the street (on request, 2026-10-04): the cable is a chain
 * (a link texture repeated along it) inside a faint orange glow, the hook a
 * steel kunai with barbs and a ring, a glowing spark on it and a warm light
 * while it is out -- all unlit materials, so it reads at night too.
 *
 * Heard: thrown at an enemy (an alien or a heavy one) Roger shouts
 * **GET OVER HERE!** (sound/grappleJet.js), and the line flashes up; the
 * chain rattles out and clanks where it bites. Not in the air (the jetpack,
 * hero/jetpack.js): there is nothing to brace against.
 */

export const GRAPPLE = {
  keys: ['KeyG'],
  cost: 1,              // segments (10%)
  cooldown: 2,          // seconds
  range: 45,            // metres
  aimSlack: 0.9,        // metres either side of the line an enemy may be off it
  minPull: 4,           // an alien nearer than this is not worth the hook
  minZip: 3,            // nor a zip shorter than this
  flySpeed: 110,        // m/s, the hook out
  backSpeed: 140,       // m/s, the hook reeled back
  pullSpeed: 28,        // m/s, an alien reeled in
  pullStop: 2.2,        // metres in front of Roger the alien stops
  stunSeconds: 0.9,     // the alien stays still this long once it arrives
  zipSpeed: 30,         // m/s, Roger along the rope
  wallStop: 0.9,        // metres short of the wall
  enemyStop: 2,         // metres short of a heavy enemy's hitbox
  maxSeconds: 3,        // the whole throw, at most
  wallHeight: 4,        // where the hook bites a wall, metres up
  // The look (all unlit): the chain's radius and its links a metre, the
  // glow round it, the kunai's size, and the spark on it.
  chainRadius: 0.045,
  linksPerMetre: 3,
  glowRadius: 0.12,
  hookLength: 0.6,
  hookRadius: 0.15,
  sparkSize: 1.1,
  colourChain: 0xd9dde2,
  colourHook: 0xeef3f8,
  colourGlow: 0xff8a2a
};

/** Registered kinds the hook leaves alone: in the air, buildings, allies. */
const UNHOOKABLE = new Set(['ufo', 'hunterShip', 'mothership', 'samuraiShip', 'nuclearPlant', 'samurai']);

/**
 * @param {Object} ctx
 * @returns {{
 *   initGrapple: () => void,
 *   updateGrapple: (rawDt: number) => void,
 *   busy: () => boolean,
 *   resetGrapple: () => void,
 *   disposeGrapple: () => void
 * }}
 */
export function createGrappleSystem(ctx) {
  const { Sim } = ctx;

  /**
   * What the hook is after: chosen when G is pressed (canStart), then
   * carried out by start. Reused, never reallocated.
   */
  const aim = {
    found: false,
    /** @type {'pull'|'zip'} */
    mode: 'zip',
    /** @type {any} the alien to reel in */
    alien: null,
    /** @type {any} a heavy enemy zipped to, and its kind */
    enemy: null,
    /** @type {any} */
    kind: null,
    // Where the hook bites (a wall's or an enemy's anchor) and where Roger
    // stops along the line.
    ax: 0, ay: 0, az: 0,
    stopX: 0, stopZ: 0
  };

  /**
   * The throw in progress.
   * 'idle' -> 'out' (the hook flying) -> 'pull' | 'zip' -> 'back' -> 'idle'
   */
  const throwState = {
    /** @type {'idle'|'out'|'pull'|'zip'|'back'} */
    phase: 'idle',
    /** @type {'pull'|'zip'} */
    mode: 'zip',
    /** @type {any} */
    alien: null,
    /** @type {any} */
    enemy: null,
    /** @type {any} */
    kind: null,
    tip: new THREE.Vector3(),
    anchor: new THREE.Vector3(),
    stopX: 0,
    stopZ: 0,
    clock: 0
  };

  /** @type {THREE.Group|null} the chain and its glow, scaled along the line */
  let cable = null;
  /** @type {THREE.Group|null} the kunai, its barbs, its ring and spark */
  let hook = null;
  /** @type {THREE.CanvasTexture|null} the chain's links */
  let links = null;
  /** @type {THREE.Sprite|null} */
  let spark = null;
  /** @type {THREE.BufferGeometry[]} */
  const geometries = [];
  /** @type {THREE.Material[]} */
  const materials = [];
  let glowClock = 0;
  const hand = new THREE.Vector3();
  const along = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  /**
   * @param {string} text
   * @returns {void}
   */
  function say(text) {
    ctx.events.emit('notice', { text });
  }

  /** @returns {any} */
  function hero() {
    return ctx.systems.heroMode;
  }

  /**
   * @param {any} alien
   * @returns {boolean} still on the ground and in play
   */
  function alienAlive(alien) {
    return !!alien && (alien.phase === 'patrol' || alien.phase === 'escort');
  }

  /**
   * Every metre from Roger to the stop is somewhere he could stand (no
   * chasm, no building): the zip would not drop him in.
   * @param {number} x
   * @param {number} z
   * @param {number} dx
   * @param {number} dz
   * @param {number} distance
   * @returns {boolean}
   */
  function clearLine(x, z, dx, dz, distance) {
    const h = hero();
    for (let d = 1; d <= distance; d += 1) {
      if (!h.standable(x + dx * d, z + dz * d)) return false;
    }
    return h.standable(x + dx * distance, z + dz * distance);
  }

  /**
   * The first thing along his line of sight the hook can take, into `aim`.
   * @returns {string} '' when found, else why not (for the message)
   */
  function pickTarget() {
    aim.found = false;
    aim.alien = aim.enemy = aim.kind = null;
    const h = hero();
    const from = h && h.rogerFacing();
    if (!from) return 'not now';
    if (h.rogerPhase() === 'dazed') return 'not while dazed';
    if (h.rogerAirborne && h.rogerAirborne()) return 'not in the air';
    const dx = Math.sin(from.heading);
    const dz = Math.cos(from.heading);
    // The nearest wall caps the line: nothing behind it can be hooked.
    const wall = h.solidAlong(from.x, from.z, dx, dz, GRAPPLE.range);
    let nearest = wall;
    /** @type {any} */
    let hit = null;
    /** @type {any} */
    let hitKind = null;
    let hitRadius = 0;
    for (const kind of ctx.systems.enemies.kinds()) {
      if (UNHOOKABLE.has(kind.kind)) continue;
      for (const e of kind.list()) {
        const p = kind.position(e);
        const ox = p.x - from.x;
        const oz = p.z - from.z;
        const t = ox * dx + oz * dz;
        if (t <= 0 || t >= nearest || t > GRAPPLE.range) continue;
        const radius = kind.hitbox ? kind.hitbox(e).radius : 0.5;
        if (Math.abs(ox * dz - oz * dx) > radius + GRAPPLE.aimSlack) continue;
        nearest = t;
        hit = e;
        hitKind = kind;
        hitRadius = radius;
      }
    }
    if (hit && hitKind.kind === 'alien') {
      if (nearest < GRAPPLE.minPull) return 'too close';
      aim.mode = 'pull';
      aim.alien = hit;
      aim.kind = hitKind;
      aim.found = true;
      return '';
    }
    if (hit) {
      const stop = nearest - hitRadius - GRAPPLE.enemyStop;
      if (stop < GRAPPLE.minZip) return 'too close';
      if (!clearLine(from.x, from.z, dx, dz, stop)) return 'no safe line';
      const p = hitKind.position(hit);
      aim.mode = 'zip';
      aim.enemy = hit;
      aim.kind = hitKind;
      aim.ax = p.x;
      aim.az = p.z;
      aim.ay = hookHeight(hitKind, hit);
      aim.stopX = from.x + dx * stop;
      aim.stopZ = from.z + dz * stop;
      aim.found = true;
      return '';
    }
    if (wall <= GRAPPLE.range) {
      const stop = wall - GRAPPLE.wallStop;
      if (stop < GRAPPLE.minZip) return 'too close';
      if (!clearLine(from.x, from.z, dx, dz, stop)) return 'no safe line';
      aim.mode = 'zip';
      aim.ax = from.x + dx * wall;
      aim.az = from.z + dz * wall;
      aim.ay = GRAPPLE.wallHeight;
      aim.stopX = from.x + dx * stop;
      aim.stopZ = from.z + dz * stop;
      aim.found = true;
      return '';
    }
    return `nothing to hook within ${GRAPPLE.range} m`;
  }

  /**
   * Where the hook bites a heavy enemy: a little over half its height.
   * @param {any} kind
   * @param {any} e
   * @returns {number}
   */
  function hookHeight(kind, e) {
    return kind.hitbox ? kind.hitbox(e).top * 0.6 : PERSON.height * 0.8;
  }

  /**
   * Roger's throwing hand, into `hand`.
   * @returns {boolean} whether there is a Roger to throw from
   */
  function placeHand() {
    const from = hero() && hero().rogerFacing();
    if (!from) return false;
    // Right of forward is (-cos h, sin h) with Hero Mode's heading convention.
    // On a roof (hero/jetpack.js), the hand is up there with him.
    const lift = hero().rogerHeight ? hero().rogerHeight() : 0;
    hand.set(from.x - Math.cos(from.heading) * 0.3, lift + PERSON.height * 0.72, from.z + Math.sin(from.heading) * 0.3);
    return true;
  }

  /**
   * The hook's current anchor, which follows a moving target.
   * @returns {void}
   */
  function trackAnchor() {
    const s = throwState;
    if (s.mode === 'pull' && s.alien) {
      const p = s.alien.root.position;
      s.anchor.set(p.x, PERSON.height * 0.55, p.z);
    } else if (s.enemy && s.kind) {
      const p = s.kind.position(s.enemy);
      s.anchor.set(p.x, hookHeight(s.kind, s.enemy), p.z);
    }
  }

  /** @returns {void} the throw, once canStart has found its target */
  function start() {
    if (!aim.found || !placeHand()) return;
    const s = throwState;
    s.phase = 'out';
    s.mode = aim.mode;
    s.alien = aim.alien;
    s.enemy = aim.enemy;
    s.kind = aim.kind;
    s.stopX = aim.stopX;
    s.stopZ = aim.stopZ;
    s.anchor.set(aim.ax, aim.ay, aim.az);
    trackAnchor();
    s.tip.copy(hand);
    s.clock = 0;
    const sfx = ctx.systems.grappleJetSound;
    if (sfx) sfx.playChain(hand.distanceTo(s.anchor) / GRAPPLE.flySpeed);
    // At an enemy, the war cry.
    if (s.alien || s.enemy) {
      if (sfx) sfx.playGetOverHere();
      say('🔗 GET OVER HERE!');
    }
  }

  /**
   * Everything let go: the cable and hook hidden, Roger's zip stopped.
   * @returns {void}
   */
  function letGo() {
    const s = throwState;
    if (s.phase === 'zip' && hero()) hero().stopZip();
    s.phase = 'idle';
    s.alien = s.enemy = s.kind = null;
    if (cable) cable.visible = false;
    if (hook) hook.visible = false;
  }

  /**
   * The cable from the hand to the tip, and the hook on the end of it.
   * @returns {void}
   */
  function drawCable() {
    if (!cable || !hook) return;
    along.subVectors(throwState.tip, hand);
    const length = along.length();
    if (length < 1e-3) {
      cable.visible = hook.visible = false;
      return;
    }
    along.multiplyScalar(1 / length);
    cable.position.copy(hand);
    cable.quaternion.setFromUnitVectors(up, along);
    cable.scale.set(1, length, 1);
    // The links stay a fixed size however long the chain is.
    if (links) links.repeat.set(1, length * GRAPPLE.linksPerMetre);
    hook.position.copy(throwState.tip);
    hook.quaternion.copy(cable.quaternion);
    cable.visible = hook.visible = true;
    // The spark pulses; a warm light while it is out (the shared pool decides).
    if (spark) {
      const pulse = 0.8 + 0.35 * Math.sin(glowClock * 22);
      spark.scale.set(GRAPPLE.sparkSize * pulse, GRAPPLE.sparkSize * pulse, 1);
    }
    const tip = throwState.tip;
    ctx.systems.lightPool.requestLight({ x: tip.x, y: tip.y, z: tip.z, colour: GRAPPLE.colourGlow, intensity: 2.5, distance: 10 });
  }

  /**
   * The chain's links, drawn once: a light oval link, then one seen edge-on,
   * down a dark strip; repeated along the cable.
   * @returns {THREE.CanvasTexture}
   */
  function makeLinks() {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 64;
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    g.fillStyle = '#2a2d31';
    g.fillRect(0, 0, 16, 64);
    g.strokeStyle = '#f2f4f7';
    g.lineWidth = 4;
    g.beginPath();
    g.ellipse(8, 16, 5, 13, 0, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#c4c9cf';
    g.fillRect(5, 34, 6, 28);
    g.fillStyle = '#ffffff';
    g.fillRect(6, 36, 2, 24);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  /**
   * A soft round glow for the spark.
   * @returns {THREE.CanvasTexture}
   */
  function makeSpark() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,230,1)');
    grad.addColorStop(0.25, 'rgba(255,190,90,0.85)');
    grad.addColorStop(1, 'rgba(255,120,30,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
  }

  /**
   * @template {THREE.BufferGeometry} G
   * @param {G} geo
   * @returns {G}
   */
  function keepGeo(geo) {
    geometries.push(geo);
    return geo;
  }

  /**
   * @template {THREE.Material} M
   * @param {M} mat
   * @returns {M}
   */
  function keepMat(mat) {
    materials.push(mat);
    return mat;
  }

  /**
   * The chain and the kunai, made once.
   * @returns {void}
   */
  function buildRope() {
    links = makeLinks();
    const chainGeo = keepGeo(new THREE.CylinderGeometry(GRAPPLE.chainRadius, GRAPPLE.chainRadius, 1, 8, 1, true));
    chainGeo.translate(0, 0.5, 0);
    const glowGeo = keepGeo(new THREE.CylinderGeometry(GRAPPLE.glowRadius, GRAPPLE.glowRadius, 1, 10, 1, true));
    glowGeo.translate(0, 0.5, 0);
    const chain = new THREE.Mesh(chainGeo, keepMat(new THREE.MeshBasicMaterial({ color: GRAPPLE.colourChain, map: links })));
    const glow = new THREE.Mesh(glowGeo, keepMat(new THREE.MeshBasicMaterial({
      color: GRAPPLE.colourGlow, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false
    })));
    cable = new THREE.Group();
    cable.add(chain, glow);

    const steel = keepMat(new THREE.MeshBasicMaterial({ color: GRAPPLE.colourHook }));
    const edge = keepMat(new THREE.MeshBasicMaterial({ color: 0x8c96a3 }));
    const L = GRAPPLE.hookLength;
    const R = GRAPPLE.hookRadius;
    // The kunai's blade, point first along +Y (the line), on the chain's end.
    const blade = new THREE.Mesh(keepGeo(new THREE.ConeGeometry(R, L, 4)), steel);
    blade.position.y = L / 2;
    blade.rotation.y = Math.PI / 4;
    // Two barbs swept back from the blade's shoulders.
    const barbGeo = keepGeo(new THREE.ConeGeometry(R * 0.35, L * 0.45, 4));
    const barbs = [-1, 1].map((side) => {
      const barb = new THREE.Mesh(barbGeo, edge);
      barb.position.set(side * R * 0.9, L * 0.12, 0);
      barb.rotation.z = side * 2.6;
      return barb;
    });
    // The ring the chain runs through.
    const ring = new THREE.Mesh(keepGeo(new THREE.TorusGeometry(R * 0.55, R * 0.16, 6, 14)), edge);
    ring.position.y = -R * 0.4;
    ring.rotation.y = Math.PI / 2;
    const sparkTexture = makeSpark();
    spark = new THREE.Sprite(keepMat(new THREE.SpriteMaterial({
      map: sparkTexture, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    })));
    spark.position.y = L * 0.4;
    spark.userData.texture = sparkTexture;
    hook = new THREE.Group();
    hook.add(blade, ...barbs, ring, spark);
  }

  /**
   * Moves `tip` towards `to` by `step`.
   * @param {THREE.Vector3} to
   * @param {number} step
   * @returns {boolean} whether it got there
   */
  function moveTip(to, step) {
    const tip = throwState.tip;
    along.subVectors(to, tip);
    const d = along.length();
    if (d <= step) {
      tip.copy(to);
      return true;
    }
    tip.addScaledVector(along, step / d);
    return false;
  }

  /**
   * The alien reeled in, a step this frame.
   * @param {number} dt
   * @returns {boolean} whether it has arrived
   */
  function reel(dt) {
    const s = throwState;
    const p = s.alien.root.position;
    const dx = hand.x - p.x;
    const dz = hand.z - p.z;
    const d = Math.hypot(dx, dz);
    // Held still while it comes (the shared frozen state, engine/enemies.js:
    // its own update stands down; no ice is drawn for it).
    ctx.systems.enemies.setState(s.alien, 'frozen', 0.2);
    s.alien.root.rotation.y = Math.atan2(dx, dz);
    const step = GRAPPLE.pullSpeed * dt;
    if (d - GRAPPLE.pullStop <= step) {
      p.x += (dx / d) * Math.max(0, d - GRAPPLE.pullStop);
      p.z += (dz / d) * Math.max(0, d - GRAPPLE.pullStop);
      return true;
    }
    p.x += (dx / d) * step;
    p.z += (dz / d) * step;
    return false;
  }

  /**
   * @param {number} rawDt
   * @returns {void}
   */
  function updateGrapple(rawDt) {
    const s = throwState;
    if (s.phase === 'idle') return;
    const dt = Sim.state.paused ? 0 : rawDt;
    const h = hero();
    const phase = h ? h.rogerPhase() : '';
    if (!placeHand() || (phase !== 'running' && phase !== 'aiming') || h.rogerFrozen()) {
      letGo();
      return;
    }
    s.clock += dt;
    if (s.clock > GRAPPLE.maxSeconds && s.phase !== 'back') {
      if (s.phase === 'zip') h.stopZip();
      s.phase = 'back';
    }
    if (s.mode === 'pull' && s.phase !== 'back' && !alienAlive(s.alien)) s.phase = 'back';
    if (s.phase !== 'back') trackAnchor();
    glowClock += rawDt;

    if (s.phase === 'out') {
      if (moveTip(s.anchor, GRAPPLE.flySpeed * dt)) {
        if (ctx.systems.grappleJetSound) ctx.systems.grappleJetSound.playClank();
        ctx.systems.gamefeel.addShake(0.15, 0.15);
        if (s.mode === 'pull') {
          s.phase = 'pull';
        } else if (h.zipRoger(s.stopX, s.stopZ, GRAPPLE.zipSpeed)) {
          s.phase = 'zip';
        } else {
          s.phase = 'back';
        }
      }
    } else if (s.phase === 'pull') {
      if (reel(dt)) {
        ctx.systems.enemies.setState(s.alien, 'frozen', GRAPPLE.stunSeconds);
        s.phase = 'back';
      }
      trackAnchor();
      s.tip.copy(s.anchor);
    } else if (s.phase === 'zip') {
      s.tip.copy(s.anchor);
      if (!h.rogerZipping()) s.phase = 'back';
    } else if (s.phase === 'back') {
      if (moveTip(hand, GRAPPLE.backSpeed * dt)) {
        if (ctx.systems.katanaSound) ctx.systems.katanaSound.playHolster();
        letGo();
        return;
      }
    }
    drawCable();
  }

  /** @returns {void} */
  function initGrapple() {
    buildRope();
    if (!cable || !hook) return;
    cable.name = 'grapple_cable';
    hook.name = 'grapple_hook';
    cable.visible = hook.visible = false;
    cable.traverse((o) => { o.frustumCulled = false; });
    hook.traverse((o) => { o.frustumCulled = false; });
    Sim.three.scene.add(cable, hook);
    ctx.systems.abilities.register({
      id: 'grapple', name: 'GRAPPLE', keys: GRAPPLE.keys, cost: GRAPPLE.cost, seconds: 0, cooldown: GRAPPLE.cooldown,
      canStart: () => {
        if (throwState.phase !== 'idle') {
          say('GRAPPLE · the hook is still out');
          return false;
        }
        const why = pickTarget();
        if (!why) return true;
        say(`GRAPPLE · ${why}`);
        return false;
      },
      start
    });
  }

  /** @returns {void} */
  function resetGrapple() {
    letGo();
  }

  /** @returns {void} */
  function disposeGrapple() {
    letGo();
    for (const group of [cable, hook]) if (group) Sim.three.scene.remove(group);
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    geometries.length = 0;
    materials.length = 0;
    if (links) links.dispose();
    if (spark) spark.userData.texture.dispose();
    cable = hook = spark = links = null;
  }

  return { initGrapple, updateGrapple, busy: () => throwState.phase !== 'idle', resetGrapple, disposeGrapple };
}
