// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION AH — Toppling
 * ===========================================================================
 * Buildings fall over, not down.
 *
 * A collapse used to be the most common event in the simulation and the least
 * interesting-looking one: the damage system set a flag, darkened the
 * windows, and whatever pieces were still attached went on standing exactly
 * where they had always stood. A tower "coming down" changed nothing about
 * the skyline.
 *
 * Now it goes over, and the direction is the whole point. It falls away from
 * whatever knocked it -- the funnel's approach, the neighbour that fell on
 * it, the side the blast came from -- so the player's angle of attack decides
 * which way a block goes, and a chain reaction runs along a visible line
 * instead of spreading as a circle of flags.
 *
 * What lands matters as much as what falls. A toppled building sweeps a
 * rectangle the length of its own height, and anything standing in that
 * rectangle is hit **by geometry**: the terrace across the road is taken down
 * because the tower physically reached it, not because it was inside a radius.
 * What is left is a line of rubble (engine/rubble.js) lying where the
 * building lay, which is a wall across the street that the fire brigade then
 * has to find a way round.
 *
 * The mechanics are a rigid rotation about the base edge on the falling side,
 * applied to the building's root group:
 *
 *   world = pivot + R(theta) * (origin - pivot)
 *
 * which is exact, costs one quaternion and one vector per building per frame,
 * and needs no change to how a building is built. It composes with the
 * quarter-turn half of them already carry (environment/buildings.js), so a
 * turned building topples about the right edge rather than corkscrewing.
 *
 * Squat buildings do not topple. A bungalow that is wider than it is tall
 * does not fall *over*, it falls *in*, and rotating one ninety degrees looks
 * like a bad physics bug. Those keep the old behaviour.
 */

export const TOPPLE = {
  // How tall a building has to be, against the narrower side of its own
  // footprint, before it can go over rather than in.
  minAspect: 0.85,
  // How long the fall takes. A real building of this size is down in about
  // two seconds and the eye knows it; much faster reads as a glitch and much
  // slower as a lift.
  seconds: [1.15, 1.7],
  // Just short of flat. Landing exactly at ninety degrees leaves the lower
  // face co-planar with the road and z-fighting along its whole length.
  finalAngle: 1.5,
  // The fall accelerates: a building goes over slowly and lands hard. The
  // angle is the eased fraction raised to this power.
  gravityCurve: 2.1,
  // The fraction of the fall at which whatever is under it gets hit. Not 1:
  // the top of a tower reaches the far pavement well before the structure
  // finishes rotating, and waiting for the end puts the impact a beat after
  // the moment the eye reads as the impact.
  strikeAt: 0.82,
  // How far past its own footprint a fallen building reaches, as a fraction
  // of its height. Slightly under 1 because the top of it breaks up on the
  // way down rather than arriving intact.
  reach: 0.88,
  // Extra half-width on the swept rectangle, for the spray either side.
  spread: 2.5,
  // What it does to what it lands on. Far above any building's collapse
  // resistance: something the size of a building has landed on it.
  strikeShock: 9,
  crushLift: 13,
  crushThrow: 16,
  // Rubble dropped along the fallen length, one pile per this many units.
  rubbleEvery: 8,
  rubbleRadius: [3.4, 5.6],
  dustPuffs: 3,
  dustScale: 2.1,
  score: 140
};

/**
 * @typedef {Object} Fall
 * @property {SimObject} obj
 * @property {THREE.Group} root
 * @property {THREE.Vector3} dir unit, in the xz plane, the way it is going
 * @property {THREE.Vector3} axis the horizontal axis it rotates about
 * @property {THREE.Vector3} pivot the base edge it turns over, world space
 * @property {THREE.Vector3} origin where the root started
 * @property {THREE.Quaternion} baseQuat the yaw it was built with
 * @property {number} height
 * @property {number} halfWidth across the fall line
 * @property {number} t seconds elapsed
 * @property {number} duration
 * @property {boolean} struck whether it has already hit what it landed on
 * @property {number} depth chain depth, for what it takes down with it
 */

/**
 * How far a box of this footprint extends from its centre along a bearing.
 * The support function of a rectangle, which is what decides where the
 * pivot edge is and how wide the swept rectangle is.
 * @param {{width: number, depth: number}} fp footprint, already in world axes
 * @param {number} dx
 * @param {number} dz
 * @returns {number}
 */
export function extentAlong(fp, dx, dz) {
  return Math.abs(dx) * fp.width * 0.5 + Math.abs(dz) * fp.depth * 0.5;
}

/**
 * The solid boxes a fallen building lies as: along the fall line from the
 * pivot edge for its height (see `lie`). Pure; shared by the host and by the
 * co-op guest's render-only copy (net/bldMirror.js), so both lie the same way.
 * @param {{width: number, depth: number}} fp footprint, in world axes
 * @param {{x: number, z: number}} dir unit fall direction
 * @param {{x: number, z: number}} axis horizontal axis it turned about
 * @param {{x: number, z: number}} pivot base edge it turned over
 * @param {number} height
 * @param {number} halfWidth across the fall line, spread included
 * @returns {{x: number, z: number, hw: number, hd: number, top: number}[]}
 */
export function lyingBoxes(fp, dir, axis, pivot, height, halfWidth) {
  const across = Math.max(1, halfWidth - TOPPLE.spread);
  const thick = extentAlong(fp, dir.x, dir.z) * 2 * Math.sin(TOPPLE.finalAngle);
  const step = Math.max(3, Math.min(across * 2, 8));
  const boxes = [];
  for (let s = 0; s < height; s += step) {
    const len = Math.min(step, height - s);
    const mid = s + len / 2;
    boxes.push({
      x: pivot.x + dir.x * mid,
      z: pivot.z + dir.z * mid,
      hw: Math.abs(dir.x) * len / 2 + Math.abs(axis.x) * across,
      hd: Math.abs(dir.z) * len / 2 + Math.abs(axis.z) * across,
      top: thick
    });
  }
  return boxes;
}

/**
 * The fall angle at a fraction of the fall (the eased, accelerating curve).
 * @param {number} progress 0..1
 * @returns {number}
 */
export function toppleAngle(progress) {
  return TOPPLE.finalAngle * Math.pow(progress, TOPPLE.gravityCurve);
}

/**
 * @param {Object} ctx
 * @returns {{
 *   toppleBuilding: (obj: SimObject, from: THREE.Vector3|null, depth: number) => boolean,
 *   updateTopple: (dt: number) => void,
 *   fallingCount: () => number,
 *   resetTopple: () => void
 * }}
 */
export function createToppleSystem(ctx) {
  const { Sim } = ctx;

  /** @type {Fall[]} */
  const falling = [];
  const scratchDir = new THREE.Vector3();
  const scratchVec = new THREE.Vector3();
  const scratchQuat = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);

  /**
   * @param {number[]} range
   * @returns {number}
   */
  function between(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  /**
   * Starts a building falling. Returns false if it is too squat to go over,
   * in which case the caller leaves it to collapse where it stands.
   * @param {SimObject} obj
   * @param {THREE.Vector3|null} from what knocked it, or null for the funnel
   * @param {number} depth chain depth of the collapse that started this
   * @returns {boolean} whether it is going over
   */
  function toppleBuilding(obj, from, depth) {
    const root = obj.mesh;
    if (!root || !root.parent) return false;
    const fp = root.userData.footprint;
    const height = root.userData.wallHeight;
    if (!fp || !height) return false;
    if (height < Math.min(fp.width, fp.depth) * TOPPLE.minAspect) return false;
    // Already going over: a building caught by two things at once falls the
    // way the first one pushed it.
    if (falling.some(fall => fall.obj === obj)) return false;

    const base = root.position;
    if (from) {
      scratchDir.set(base.x - from.x, 0, base.z - from.z);
    } else {
      const centre = ctx.tornadoes.nearest(base.x, base.z).center;
      scratchDir.set(base.x - centre.x, 0, base.z - centre.z);
    }
    if (scratchDir.lengthSq() < 1e-6) {
      scratchDir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      if (scratchDir.lengthSq() < 1e-6) scratchDir.set(1, 0, 0);
    }
    scratchDir.normalize();

    const dir = scratchDir.clone();
    // The edge it turns over: the base edge on the side it is falling towards.
    const lever = extentAlong(fp, dir.x, dir.z);
    const pivot = new THREE.Vector3(base.x + dir.x * lever, 0, base.z + dir.z * lever);
    // Perpendicular to the fall, horizontal: rotating about this sends the
    // top of the building along +dir (see the note at the top of the file).
    const axis = new THREE.Vector3(dir.z, 0, -dir.x);

    root.userData.lying = null;
    // The bearing it goes over, whole degrees 0..359 (atan2(x, z)): what the co-op host tells the guest (net/bldFx.js).
    root.userData.toppleDir = (Math.round(Math.atan2(dir.x, dir.z) * 180 / Math.PI) + 360) % 360;
    falling.push({
      obj, root, dir, axis, pivot,
      origin: base.clone(),
      baseQuat: root.quaternion.clone(),
      height,
      // Across the fall line, which is the perpendicular extent.
      halfWidth: extentAlong(fp, dir.z, dir.x) + TOPPLE.spread,
      t: 0,
      duration: between(TOPPLE.seconds),
      struck: false,
      depth
    });
    return true;
  }

  /**
   * How far a point is from the rectangle a falling building sweeps: the
   * strip running from its base out along the fall line for `reach`, with
   * `halfWidth` either side.
   * @param {Fall} fall
   * @param {number} x
   * @param {number} z
   * @returns {{along: number, across: number}} distances in the fall's own frame
   */
  function inStrike(fall, x, z) {
    const dx = x - fall.origin.x;
    const dz = z - fall.origin.z;
    return {
      along: dx * fall.dir.x + dz * fall.dir.z,
      across: Math.abs(dx * fall.axis.x + dz * fall.axis.z)
    };
  }

  /**
   * What a building landing on the street does to the street. Everything here
   * is by *geometry* -- the rectangle the structure physically swept -- rather
   * than by a radius, which is the difference between a tower falling across
   * a road and a bomb going off in it.
   * @param {Fall} fall
   * @returns {void}
   */
  function strike(fall) {
    fall.struck = true;
    const reach = fall.height * TOPPLE.reach;
    const damage = ctx.systems.damage;

    // Buildings under it. A building the structure physically reached is not
    // shocked, it is hit by something its own size.
    if (ctx.Environment && damage.shockBuilding) {
      for (const other of ctx.Environment.buildings) {
        if (other === fall.obj || other.damageState === 'collapsed') continue;
        const p = other.mesh.position;
        const { along, across } = inStrike(fall, p.x, p.z);
        const fp = other.mesh.userData.footprint;
        const own = fp ? Math.max(fp.width, fp.depth) * 0.5 : 4;
        // The target's own extent counts at both ends. A terrace whose near
        // wall is under the falling tower has been hit by it, even though its
        // centre -- which is all `p` is -- stands a few units clear.
        if (along < -own || along > reach + own) continue;
        if (across > fall.halfWidth + own) continue;
        // Knocked on along the same line, so a row of terraces goes over like
        // dominoes rather than each falling away from its own neighbour, and
        // carrying this building's own chain depth so the run is counted as
        // one cascade rather than as a series of unrelated collapses.
        damage.shockBuilding(other, TOPPLE.strikeShock, fall.origin, fall.depth + 1);
      }
    }

    // Everything loose in the way.
    for (const obj of Sim.objects) {
      if (obj.type === 'building') continue;
      if (obj.captureState && obj.captureState !== 'grounded') continue;
      const pos = obj.pooled ? obj.position : (obj.mesh && obj.mesh.position);
      if (!pos) continue;
      const { along, across } = inStrike(fall, pos.x, pos.z);
      if (along < 0 || along > reach || across > fall.halfWidth) continue;
      obj.velocity.x += fall.dir.x * TOPPLE.crushThrow * (0.4 + Math.random() * 0.6);
      obj.velocity.z += fall.dir.z * TOPPLE.crushThrow * (0.4 + Math.random() * 0.6);
      obj.velocity.y += TOPPLE.crushLift * Math.random();
      obj.angularVelocity.set(
        (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12
      );
      if (obj.type === 'person' && obj.motion && obj.motion.active) {
        obj.motion.active = false;
        obj.motion.dropped = true;
        ctx.systems.speechBubbles.exclaim(obj);
      }
      if (obj.type === 'car' && obj.damageState === 'intact') {
        obj.damageState = 'tipped';
        obj.mesh.userData.parked = false;
      }
    }

    // Dust and rubble down the length of it. The rubble is the part that
    // outlives the moment: it is what makes the street impassable.
    const steps = Math.max(1, Math.round(reach / TOPPLE.rubbleEvery));
    for (let i = 0; i <= steps; i++) {
      const along = (i / steps) * reach;
      const x = fall.origin.x + fall.dir.x * along;
      const z = fall.origin.z + fall.dir.z * along;
      ctx.systems.rubble.addPile(x, z, between(TOPPLE.rubbleRadius));
      if (i % 2 === 0) {
        ctx.systems.earthquake.kickDust(x, z, TOPPLE.dustPuffs, TOPPLE.dustScale);
      }
    }

    scratchVec.set(
      fall.origin.x + fall.dir.x * reach * 0.6, 2, fall.origin.z + fall.dir.z * reach * 0.6
    );
    ctx.systems.explosions.spawnImpactBurst(scratchVec, 2.2);
    ctx.systems.gamefeel.event('chain', scratchVec);
    ctx.systems.damage.addDamageScore(TOPPLE.score);
    // A tower across a street takes the line with it for its whole length.
    ctx.systems.powerLines.faultAt(
      fall.origin.x + fall.dir.x * reach * 0.5,
      fall.origin.z + fall.dir.z * reach * 0.5,
      reach * 0.5
    );
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateTopple(dt) {
    for (let i = falling.length - 1; i >= 0; i--) {
      const fall = falling[i];
      // The town can be rebuilt out from under a building mid-fall.
      if (!fall.root.parent) {
        falling.splice(i, 1);
        continue;
      }
      fall.t += dt;
      const progress = Math.min(1, fall.t / fall.duration);
      const angle = toppleAngle(progress);

      scratchQuat.setFromAxisAngle(fall.axis, angle);
      // Rigid rotation about the pivot edge: the root is carried round with
      // everything parented to it, so no piece has to be touched.
      scratchVec.copy(fall.origin).sub(fall.pivot).applyQuaternion(scratchQuat);
      fall.root.position.copy(fall.pivot).add(scratchVec);
      // Composed with the yaw it was built with rather than replacing it.
      fall.root.quaternion.copy(scratchQuat).multiply(fall.baseQuat);

      if (!fall.struck && progress >= TOPPLE.strikeAt) strike(fall);
      if (progress >= 1) {
        lie(fall);
        falling.splice(i, 1);
      }
    }
  }

  /**
   * The building down: where it lies, as solid boxes on the ground that Roger
   * and the ground enemies stop against and Roger can stand on
   * (hero/movement.js someSolid), in root.userData.lying. It lies along the
   * fall line from the pivot edge for its height, as wide as it was across
   * the fall and as tall as it was deep along it. A diagonal fall is covered
   * by a row of axis-aligned boxes, each a little larger than the strip.
   * @param {Fall} fall
   * @returns {void}
   */
  function lie(fall) {
    const fp = fall.root.userData.footprint;
    if (!fp) return;
    const boxes = lyingBoxes(fp, fall.dir, fall.axis, fall.pivot, fall.height, fall.halfWidth);
    fall.root.userData.lying = boxes;
  }

  /** @returns {number} */
  function fallingCount() {
    return falling.length;
  }

  /** @returns {void} */
  function resetTopple() {
    falling.length = 0;
  }

  return { toppleBuilding, updateTopple, fallingCount, resetTopple };
}
