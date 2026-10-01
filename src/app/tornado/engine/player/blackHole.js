// @ts-check
import * as THREE from 'three';
import { createBlackHoleLook } from './blackHole/look.js';
import { createHoleMatter } from './blackHole/matter.js';
import { createDissolve } from './blackHole/dissolve.js';
import { createHoleWind, windAt } from './blackHole/wind.js';

/**
 * ===========================================================================
 * SECTION PB — The Black Hole Gun's black hole
 * ===========================================================================
 * Not an ability any more (R) but a weapon on Roger's wheel
 * (engine/heroWeapons.js): aimed like the railgun, and the hole opens where
 * the crosshair meets the town, for HOLE.seconds. It costs HOLE.cost energy
 * segments (half the bar). One at a time: firing while one is open makes it
 * collapse now, and the new one opens where you aimed as soon as it has
 * gone (fire). The look -- the black core in its purple spiral -- is
 * blackHole/look.js; it fades in as it opens and collapses at the end.
 *
 * The pull is a wind (blackHole/wind.js), the Downburst's turned inwards:
 * a radial inflow with a swirl on it, stronger the nearer it gets, out to
 * HOLE.influence (100 m). Loose things are dragged along it, people are
 * knocked off their feet and blown in, dust and streaks of it fly in on
 * the spiral. Two zones:
 *  - HOLE.escape (40 m) and in: no escape. Anything that crosses it is
 *    caught: taken out of its own control and drawn in along a tightening
 *    spiral, lifted, spun, faster the nearer, stretched towards the core and
 *    shrinking ("spaghettified"), until it reaches the horizon and is gone.
 *    The big things -- buildings, the giants, the ships, the plants -- are
 *    not drawn in whole: they dissolve where they stand, from the side
 *    facing the hole, into fragments that stream in (blackHole/dissolve.js).
 *  - Out to HOLE.influence: the wind, which you can still get out of.
 *
 * Everything can be swallowed, through engine/effects/consumables.js:
 * people, cars, trees, debris, the train, tankers, every enemy (aliens,
 * Terminators, the Yeti, the T-Rex, Patient Zero and his clones, Roger's
 * pursuers), the UFOs and the mothership, the nuclear plants, the landed
 * ships, buildings -- and tornadoes, which rope out and dissipate. What is
 * swallowed is gone quietly: no death explosion of its own. Never Roger, or
 * the car he is driving.
 *
 * Capped for 60 FPS: HOLE.maxCaught drawn in at once, DISSOLVE.maxAtOnce
 * dissolving; anything past either simply shrinks away (HOLE.fadeSeconds).
 */

export const HOLE = {
  cost: 5,                 // energy segments: half the bar
  seconds: 20,             // open this long
  height: 12,              // the centre, above the ground (the swirl sinks below it)
  escape: 40,              // the point of no return
  influence: 100,          // the wind reaches this far
  horizon: 3,              // swallowed here
  knockdown: 70,           // people nearer than this are blown off their feet
  drag: 1.8,               // per second: how fast loose things take the wind's speed, at the line
  lift: 4,                 // m/s² upward on loose things at the line
  enemyPull: 0.45,         // share of the wind's inflow an enemy is shoved in by
  caughtSpeed: [4, 14],    // m/s inward: when caught, and 3 s later
  plunge: 2.4,             // and up to this many times that near the core
  spiral: 1.6,             // radians a second round it at the line, faster inside
  stretch: 2.6,            // how long something is drawn out at the horizon (x its size)
  maxCaught: 60,
  fadeSeconds: 1.2,        // past the caps: shrunk away in this long
  buildingScore: 100,
  openSeconds: 1.5,
  closeSeconds: 1.8
};

/**
 * @typedef {import('../effects/consumables.js').Consumable} Consumable
 * @typedef {Object} Caught
 * @property {Consumable} entry
 * @property {THREE.Vector3|{x: number, y?: number, z: number}} pos
 * @property {number} time seconds caught
 * @property {number} angle round the hole
 * @property {number} radius from the hole, on the ground
 * @property {number} y0 its height when caught
 * @property {number} scale0 its scale when caught
 * @property {number} spin its own turn, radians a second
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   fire: (x: number, z: number) => 'opened'|'queued'|false,
 *   isOpen: () => boolean,
 *   caughtCount: () => number,
 *   initBlackHole: () => void,
 *   updateBlackHole: (dt: number) => void,
 *   resetBlackHole: () => void,
 *   disposeBlackHole: () => void
 * }}
 */
export function createBlackHoleSystem(ctx) {
  const { Sim } = ctx;
  /** @type {ReturnType<typeof createBlackHoleLook>|null} */
  let look = null;
  /** @type {ReturnType<typeof createHoleMatter>|null} */
  let matter = null;
  /** @type {ReturnType<typeof createDissolve>|null} */
  let dissolve = null;
  /** @type {ReturnType<typeof createHoleWind>|null} */
  let wind = null;
  /**
   * @type {{x: number, y: number, z: number, t: number, closing: number, size: number,
   *   escape: number, influence: number, horizon: number, hazard: Object|null}|null}
   */
  let hole = null;
  /** @type {{x: number, z: number}|null} the next shot, waiting for this one to go */
  let pending = null;
  /** @type {Caught[]} drawn in on the spiral */
  let caught = [];
  /** @type {{entry: Consumable, t: number, scale0: number}[]} shrinking away */
  let fading = [];
  /** @type {{entry: Consumable, pin: THREE.Vector3}[]} being dissolved where they stand */
  let cutting = [];
  /** @type {Set<any>} everything it has hold of */
  const held = new Set();
  const scratch = new THREE.Vector3();

  /**
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  function open(x, z) {
    if (hole || !look) return false;
    hole = {
      x, y: HOLE.height, z, t: 0, closing: -1, size: 0,
      escape: HOLE.escape, influence: HOLE.influence, horizon: HOLE.horizon,
      hazard: ctx.systems.hazards.addHazard({ x, z, radius: HOLE.influence, kind: 'blackHole' })
    };
    look.group.position.set(x, HOLE.height, z);
    look.group.visible = true;
    look.update(0, 0.01);
    ctx.systems.lightning.flashScreen(scratch.set(x, HOLE.height, z), 0.35, '#b38cff');
    if (ctx.systems.shockwaveSound) ctx.systems.shockwaveSound.playShockwave();
    return true;
  }

  /**
   * The gun's shot: opens one there, or -- with one already open -- makes
   * that one collapse now and queues this one behind it.
   * @param {number} x
   * @param {number} z
   * @returns {'opened'|'queued'|false}
   */
  function fire(x, z) {
    if (!look) return false;
    if (!hole) return open(x, z) ? 'opened' : false;
    pending = { x, z };
    close();
    return 'queued';
  }

  /**
   * Out of its owner's hands and into the hole's: drawn in, dissolved where
   * it stands, or -- with those full -- shrunk away.
   * @param {Consumable} entry
   * @returns {void}
   */
  function capture(entry) {
    if (!hole) return;
    held.add(entry.target);
    entry.take();
    if (entry.family === 'building') ctx.systems.damage.addDamageScore(HOLE.buildingScore);
    if (entry.big) {
      if (dissolve && dissolve.start(entry, hole)) {
        const p = entry.pos;
        cutting.push({ entry, pin: new THREE.Vector3(p.x, p.y || 0, p.z) });
        if (entry.family === 'building' && entry.object) {
          // Its glazing goes dark as it is torn open.
          const windows = entry.object.userData.windows;
          if (windows) windows.mesh.visible = false;
        }
      } else {
        fading.push({ entry, t: 0, scale0: entry.object ? entry.object.scale.x : 1 });
      }
      return;
    }
    if (caught.length >= HOLE.maxCaught) {
      fading.push({ entry, t: 0, scale0: entry.object ? entry.object.scale.x : 1 });
      return;
    }
    const p = entry.pos;
    const dx = p.x - hole.x;
    const dz = p.z - hole.z;
    caught.push({
      entry, pos: p, time: 0, angle: Math.atan2(dx, dz), radius: Math.hypot(dx, dz),
      y0: p.y || 0, scale0: entry.object ? entry.object.scale.x : 1,
      spin: (Math.random() - 0.5) * 6
    });
  }

  /**
   * Gone past the horizon (or the cut is through, or it has shrunk away).
   * @param {Consumable} entry
   * @param {boolean} [show] a last burst of matter where it went in
   * @returns {void}
   */
  function swallow(entry, show = true) {
    held.delete(entry.target);
    entry.consume();
    if (show && hole && matter) matter.shed(scratch.set(entry.pos.x, entry.pos.y || 0, entry.pos.z), hole, 10);
  }

  /**
   * Who and what crosses the line, and the wind beyond it.
   * @param {number} dt
   * @returns {void}
   */
  function reach(dt) {
    if (!hole) return;
    const { x, z } = hole;
    const strength = hole.size;
    ctx.systems.consumables.each(x, z, HOLE.influence, (target, d, make, family) => {
      if (held.has(target)) return;
      if (d <= HOLE.escape * strength) {
        const entry = make();
        if (entry) capture(entry);
        return;
      }
      // Enemies have no physics to drag: the wind shoves them bodily, so
      // even a giant walking away is drawn back towards the line.
      if (family === 'enemy') {
        const entry = make();
        if (!entry) return;
        const p = /** @type {any} */ (entry.pos);
        const w = windAt(d, HOLE.escape);
        const k = HOLE.enemyPull * w.inward * dt * strength / d;
        p.x += (x - p.x) * k;
        p.z += (z - p.z) * k;
        return;
      }
      // The wind: loose things dragged along it, people blown off their feet.
      const pos = target.pooled ? target.position : target.mesh && target.mesh.position;
      if (!pos || !target.velocity) return;
      if (target.type === 'person' && d < HOLE.knockdown && target.motion && target.motion.active) {
        target.motion.active = false;
        target.motion.dropped = true;
        if (ctx.systems.speechBubbles) ctx.systems.speechBubbles.exclaim(target);
      }
      if (target.rooted || (target.motion && target.motion.active)) return;
      const w = windAt(d, HOLE.escape);
      const inX = (x - pos.x) / d;
      const inZ = (z - pos.z) / d;
      const near = 1 - (d - HOLE.escape) / (HOLE.influence - HOLE.escape);
      const k = Math.min(1, HOLE.drag * (0.25 + 0.75 * near) * dt) * strength;
      // Inward plus round (the swirl turns the way the arms do).
      const wx = inX * w.inward + inZ * w.round;
      const wz = inZ * w.inward - inX * w.round;
      target.velocity.x += (wx - target.velocity.x) * k;
      target.velocity.z += (wz - target.velocity.z) * k;
      target.velocity.y += HOLE.lift * near * near * dt * strength;
    });
  }

  /**
   * Everything in its grip, one step further in: round the way the arms
   * turn, faster the nearer it is, lifted, spun, stretched towards the core
   * and shrinking as it goes.
   * @param {number} dt
   * @returns {void}
   */
  function drawIn(dt) {
    if (!hole) return;
    const [v0, v1] = HOLE.caughtSpeed;
    for (let i = caught.length - 1; i >= 0; i--) {
      const c = caught[i];
      c.time += dt;
      const near = 1 - Math.min(1, c.radius / HOLE.escape);
      const speed = (v0 + (v1 - v0) * Math.min(1, c.time / 3)) * (1 + (HOLE.plunge - 1) * near * near);
      c.radius = Math.max(0, c.radius - speed * dt);
      c.angle += HOLE.spiral * dt * Math.min(6, HOLE.escape / Math.max(4, c.radius));
      const through = 1 - Math.min(1, c.radius / HOLE.escape);
      const p = /** @type {any} */ (c.pos);
      p.x = hole.x + Math.sin(c.angle) * c.radius;
      p.z = hole.z + Math.cos(c.angle) * c.radius;
      // Up off the ground towards the core's height.
      p.y = c.y0 + (hole.y - 3 - c.y0) * through * through;
      const mesh = c.entry.object;
      if (mesh) {
        // Spaghettified: thinner, drawn out along the way in, shrinking,
        // and spun about itself on the way.
        const s = Math.max(0.03, c.scale0 * (1 - through * 0.88));
        const long = 1 + (HOLE.stretch - 1) * through * through;
        mesh.rotation.set(-through * 1.2 + Math.sin(c.time * 3) * 0.3 * (1 - through), c.angle + Math.PI + c.time * c.spin * (1 - through), 0);
        mesh.scale.set(s / Math.sqrt(long), s / Math.sqrt(long), s * long);
      }
      const t = /** @type {any} */ (c.entry.target);
      if (t.velocity) t.velocity.set(0, 0, 0);
      if (matter && Math.random() < dt * 8) matter.shed(scratch.set(p.x, p.y, p.z), hole, 2);
      if (c.radius <= HOLE.horizon) {
        caught.splice(i, 1);
        swallow(c.entry);
      }
    }
    for (let i = fading.length - 1; i >= 0; i--) {
      const f = fading[i];
      f.t += dt;
      const u = Math.min(1, f.t / HOLE.fadeSeconds);
      if (f.entry.object) f.entry.object.scale.setScalar(Math.max(0.01, f.scale0 * (1 - u)));
      if (u >= 1) {
        fading.splice(i, 1);
        swallow(f.entry, false);
      }
    }
    // The giants and the ships hold still while they are cut up.
    for (const c of cutting) {
      const p = /** @type {any} */ (c.entry.pos);
      p.x = c.pin.x;
      p.z = c.pin.z;
    }
  }

  /** @returns {void} the collapse starts now */
  function close() {
    if (!hole || hole.closing >= 0) return;
    hole.closing = 0;
  }

  /** @returns {void} gone: whatever it still held with it */
  function finish() {
    const at = hole ? scratch.set(hole.x, hole.y, hole.z).clone() : null;
    for (const c of caught) swallow(c.entry, false);
    for (const f of fading) swallow(f.entry, false);
    caught = [];
    fading = [];
    if (dissolve) for (const entry of dissolve.clear()) swallow(entry, false);
    cutting = [];
    held.clear();
    if (hole && hole.hazard) ctx.systems.hazards.removeHazard(hole.hazard);
    hole = null;
    if (look) look.group.visible = false;
    if (wind) wind.clear();
    // The last of it: a flash as it winks out.
    if (at) ctx.systems.lightning.flashScreen(at, 0.5, '#d9c2ff');
    if (pending) {
      const next = pending;
      pending = null;
      open(next.x, next.z);
    }
  }

  /** @returns {void} */
  function initBlackHole() {
    look = createBlackHoleLook(Sim.three.scene);
    matter = createHoleMatter(ctx, HOLE);
    dissolve = createDissolve(ctx);
    wind = createHoleWind(ctx);
    // The tornadoes are swallowed too: caught, a funnel ropes out and
    // dissipates (stormLife.js's rope-out for a neutralised one), quietly.
    ctx.systems.consumables.register({
      kind: 'tornado',
      list: () => ctx.tornadoes.activeVortices.filter((/** @type {any} */ v) => !v.neutralized && v.birth > 0.3),
      position: (/** @type {any} */ v) => v.center,
      size: () => 40,
      big: true,
      take: (/** @type {any} */ v) => { v.neutralized = true; },
      consume: () => {}
    });
  }

  /**
   * @param {number} dt simulation seconds (0 while paused)
   * @returns {void}
   */
  function updateBlackHole(dt) {
    if (dt <= 0) return;
    if (!hole || !look) {
      if (matter) matter.step(dt, null, 0);
      return;
    }
    hole.t += dt;
    if (hole.t >= HOLE.seconds) close();
    // Opening, then open, then collapsing.
    let size = Math.min(1, hole.t / HOLE.openSeconds);
    size = size * size * (3 - 2 * size);
    if (hole.closing >= 0) {
      hole.closing += dt;
      const u = Math.min(1, hole.closing / HOLE.closeSeconds);
      // Collapsing: a swell, then in on itself.
      size *= u < 0.25 ? 1 + 0.25 * (u / 0.25) : 1.25 * Math.pow(1 - (u - 0.25) / 0.75, 2);
      if (hole.closing >= HOLE.closeSeconds) {
        finish();
        return;
      }
    }
    hole.size = Math.min(1, size);
    look.group.position.set(hole.x, hole.y, hole.z);
    look.update(hole.t, size);
    if (matter) {
      if (hole.closing < 0) matter.ambient(dt, hole, hole.t);
      matter.step(dt, hole, hole.t);
    }
    if (wind) wind.step(dt, hole, hole.size);
    if (hole.closing < 0) reach(dt);
    drawIn(dt);
    if (dissolve) {
      for (const entry of dissolve.step(dt, hole)) {
        cutting = cutting.filter(c => c.entry !== entry);
        swallow(entry);
      }
    }
    ctx.systems.lightPool.requestLight({ x: hole.x, y: hole.y - 4, z: hole.z, colour: 0x8a5bff, intensity: 4 * size * (1 + 0.15 * Math.sin(hole.t * 1.9)), distance: 80, priority: 4 });
  }

  /** @returns {void} */
  function resetBlackHole() {
    caught = [];
    fading = [];
    cutting = [];
    held.clear();
    pending = null;
    if (hole && hole.hazard) ctx.systems.hazards.removeHazard(hole.hazard);
    hole = null;
    if (look) look.group.visible = false;
    if (matter) matter.clear();
    if (dissolve) dissolve.clear();
    if (wind) wind.clear();
  }

  /** @returns {void} */
  function disposeBlackHole() {
    resetBlackHole();
    if (look) look.dispose();
    look = null;
    if (matter) matter.dispose();
    matter = null;
    if (dissolve) dissolve.dispose();
    dissolve = null;
    if (wind) wind.dispose();
    wind = null;
  }

  return { fire, isOpen: () => !!hole, caughtCount: () => caught.length, initBlackHole, updateBlackHole, resetBlackHole, disposeBlackHole };
}
