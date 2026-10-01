// @ts-check
/**
 * ===========================================================================
 * SECTION AN — Dancing
 * ===========================================================================
 * The poses for everyone dancing: the town's people and the aliens, under
 * Smooth Criminal (engine/smoothCriminal.js), and the aliens by themselves
 * once there are no humans left for them to go after (aliens.js). Pure
 * functions of time over the figures' own jointed limbs -- the same ones the
 * walks move -- with a per-figure phase so a crowd does not move as one.
 *
 * People: peopleMotion.js skips anyone with `dancing` set, so the walk does
 * not fight the pose; stopDancing puts the limbs back where the walk
 * expects them.
 */

/**
 * The jointed parts of one of the town's people (environment/people.js
 * names them after the root), found once and kept on the person.
 * @param {Object} person
 * @returns {{legL: Object, legR: Object, armL: Object, armR: Object, splay: number}|null}
 */
function personLimbs(person) {
  if (person.danceLimbs) return person.danceLimbs;
  const find = (/** @type {string} */ suffix) => person.mesh.children.find(c => c.name.endsWith(suffix));
  const legL = find('_legL');
  const legR = find('_legR');
  const armL = find('_armL');
  const armR = find('_armR');
  if (!legL || !legR || !armL || !armR) return null;
  person.danceLimbs = { legL, legR, armL, armR, splay: Math.abs(armL.rotation.z) || 0.3 };
  return person.danceLimbs;
}

/**
 * One of a handful of party moves, picked per person and changed now and
 * then: the arms-up bounce, the disco point, the side-step clap and the
 * twist.
 * @param {Object} person
 * @param {number} t seconds of dancing
 * @returns {void}
 */
export function dancePerson(person, t) {
  const L = personLimbs(person);
  if (!L) return;
  if (person.danceSeed === undefined) {
    person.danceSeed = Math.random() * 100;
    person.danceFacing = person.mesh.rotation.y;
  }
  const seed = person.danceSeed;
  const beat = (t + seed) * Math.PI * 2 * 1.9;   // about 114 beats a minute, like the song
  const s = Math.sin(beat);
  const c = Math.cos(beat);
  const root = person.mesh;
  const move = Math.floor(seed + t / 4) % 4;
  root.position.y = Math.abs(s) * 0.35;
  root.rotation.x = 0;
  if (move === 0) {
    // Arms up, waving, bouncing.
    L.armL.rotation.set(0, 0, -2.5 - 0.35 * s);
    L.armR.rotation.set(0, 0, 2.5 - 0.35 * s);
    L.legL.rotation.set(0.25 * s, 0, -0.1);
    L.legR.rotation.set(-0.25 * s, 0, 0.1);
    root.rotation.z = 0.08 * s;
    root.rotation.y = person.danceFacing;
  } else if (move === 1) {
    // The disco point: one arm up to the corner, one on the hip.
    const up = s > 0;
    L.armR.rotation.set(-0.4, 0, up ? 2.6 : 0.9);
    L.armL.rotation.set(0, 0, -0.9);
    L.legL.rotation.set(0, 0, -0.18);
    L.legR.rotation.set(0.3 * Math.max(0, s), 0, 0.18);
    root.rotation.z = up ? -0.12 : 0.06;
    root.rotation.y = person.danceFacing;
  } else if (move === 2) {
    // Side-step and clap.
    const clap = Math.abs(c);
    L.armL.rotation.set(-1.3, 0, -0.2 - 0.5 * clap);
    L.armR.rotation.set(-1.3, 0, 0.2 + 0.5 * clap);
    L.legL.rotation.set(0, 0, -0.1 - 0.25 * Math.max(0, s));
    L.legR.rotation.set(0, 0, 0.1 + 0.25 * Math.max(0, -s));
    root.rotation.z = 0.1 * s;
    root.rotation.y = person.danceFacing;
  } else {
    // The twist.
    L.armL.rotation.set(-0.6, 0, -1.1);
    L.armR.rotation.set(-0.6, 0, 1.1);
    L.legL.rotation.set(0.2 * c, 0, -0.12);
    L.legR.rotation.set(-0.2 * c, 0, 0.12);
    root.rotation.z = 0;
    root.rotation.y = person.danceFacing + 0.6 * s;
  }
}

/**
 * Back to standing, the way the walk expects them.
 * @param {Object} person
 * @returns {void}
 */
export function stopDancing(person) {
  person.dancing = false;
  const L = person.danceLimbs;
  if (!L) return;
  L.legL.rotation.set(0, 0, 0);
  L.legR.rotation.set(0, 0, 0);
  L.armL.rotation.set(0, 0, -L.splay);
  L.armR.rotation.set(0, 0, L.splay);
  if (person.mesh) {
    person.mesh.position.y = 0;
    person.mesh.rotation.x = 0;
    person.mesh.rotation.z = 0;
  }
  person.danceSeed = undefined;
}

/**
 * An alien (aliens.js) dancing: the big head bobbing, the arms up and
 * swinging over it, hips going, stepping from foot to foot.
 * @param {{root: Object, limbs: {legL: Object, legR: Object, armL: Object, armR: Object}, heading: number, cycle: number}} alien
 * @param {number} t seconds
 * @returns {void}
 */
export function danceAlien(alien, t) {
  const L = alien.limbs;
  const beat = (t + alien.cycle) * Math.PI * 2 * 1.9;
  const s = Math.sin(beat);
  const c = Math.cos(beat);
  const move = Math.floor(alien.cycle + t / 3.5) % 3;
  alien.root.position.y = Math.abs(s) * 0.3;
  alien.root.rotation.x = 0;
  if (move === 0) {
    L.armL.rotation.set(0, 0, -2.6 - 0.3 * s);
    L.armR.rotation.set(0, 0, 2.6 - 0.3 * s);
    L.legL.rotation.x = 0.3 * s;
    L.legR.rotation.x = -0.3 * s;
    alien.root.rotation.z = 0.1 * s;
    alien.root.rotation.y = alien.heading;
  } else if (move === 1) {
    L.armL.rotation.set(-1.2 + 0.4 * c, 0, -0.5);
    L.armR.rotation.set(-1.2 - 0.4 * c, 0, 0.5);
    L.legL.rotation.x = 0.35 * Math.max(0, s);
    L.legR.rotation.x = 0.35 * Math.max(0, -s);
    alien.root.rotation.z = 0;
    alien.root.rotation.y = alien.heading + t * 2.2;
  } else {
    L.armL.rotation.set(0, 0, -1.4 - 0.6 * Math.abs(c));
    L.armR.rotation.set(0, 0, 1.4 + 0.6 * Math.abs(c));
    L.legL.rotation.x = 0.2 * c;
    L.legR.rotation.x = -0.2 * c;
    alien.root.rotation.z = 0.16 * s;
    alien.root.rotation.y = alien.heading + 0.5 * s;
  }
}
