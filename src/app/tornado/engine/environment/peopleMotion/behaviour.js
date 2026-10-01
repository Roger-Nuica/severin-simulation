import * as THREE from 'three';
import { WALK_SPEED_MIN, WALK_SPEED_MAX, RUN_SPEED_MIN, RUN_SPEED_MAX, WANDER_REACH, PAVEMENT_OFFSET_MIN, PAVEMENT_OFFSET_MAX, STREET_SNAP_DISTANCE, HOME_WANDER_RADIUS, PAUSE_MIN, PAUSE_MAX, WORLD_BOUND, STREET_Z_LINES, STREET_X_LINES, STREET_HALF_LENGTH, RING_RADIUS, LEG_SWING_WALK, LEG_SWING_RUN, ARM_SWING_WALK, ARM_SWING_RUN, BOB_WALK, BOB_RUN, RUN_LEAN, WANDER_TARGET_ATTEMPTS, BLOCKED_REPICK_PAUSE, FLEE_PROBE_INTERVAL, PAIR_FRACTION, PAIR_MAX_DISTANCE, PAIR_OFFSET, LIMB_FAR_STEP, DAZED_DURATION, DAZED_SETTLE_SPEED, DAZED_STAND_TIME, DAZED_SPEED_SCALE, DAZED_SPIN, DAZED_WEAVE_AMPLITUDE, DAZED_WEAVE_RATE, DAZED_SWAY, DAZED_SWAY_RATE, DAZED_ARM_SPLAY, DAZED_ARM_RAISE, DAZED_ARM_SWING, DAZED_BOB } from './config.js';
/** @typedef {import('./config.js').PersonMotion} PersonMotion */

/**
 * ===========================================================================
 * SECTION PM.2 — How people move
 * ===========================================================================
 * Where they wander to, pairs who walk together, being dazed and getting
 * up, and the walk itself.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see peopleMotion.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createCrowdBehaviour(ctx, S, api) {
  const { Sim } = ctx;

  /**
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  function randRange(min, max) {
    return min + Math.random() * (max - min);
  }

  /**
   * Shortest signed angle from `a` to `b`.
   * @param {number} a
   * @param {number} b
   * @returns {number}
   */
  function angleDelta(a, b) {
    return Math.atan2(Math.sin(b - a), Math.cos(b - a));
  }

  /**
   * Folds an angle into [-PI, PI]. The ragdoll tumble integrates rotation
   * without bound (see integratePhysics), so a person who spent a while
   * orbiting can land holding a pitch of tens of radians; rotating that back
   * to upright needs the equivalent small angle, not the raw total.
   * @param {number} a
   * @returns {number}
   */
  function wrapAngle(a) {
    return Math.atan2(Math.sin(a), Math.cos(a));
  }

  /**
   * Whether a person physics has finished with is ready to be picked back up:
   * back on the ground, no longer rolling, and still in the scene (lightning
   * removes people outright -- see explodePerson).
   * @param {SimObject} person
   * @returns {boolean}
   */
  function readyToWake(person) {
    return person.captureState === 'grounded'
      && !!person.mesh.parent
      && person.mesh.position.y <= 0.4
      && person.velocity.length() < DAZED_SETTLE_SPEED;
  }

  /**
   * Hands a dropped person back from physics to this system in the 'dazed'
   * state: on their feet (over DAZED_STAND_TIME), staggering, and oblivious to
   * the tornado until the daze runs out.
   * @param {SimObject} person
   * @param {PersonMotion} m
   * @returns {void}
   */
  function wakeDazed(person, m) {
    const root = person.mesh;
    m.active = true;
    m.dropped = false;
    m.mode = 'dazed';
    m.dazedTimer = randRange(DAZED_DURATION[0], DAZED_DURATION[1]);
    m.standTimer = DAZED_STAND_TIME;
    m.gait = 0;
    m.phase = Math.random() * Math.PI * 2;
    m.heading = root.rotation.y;
    // Deliberately *not* the way they were facing or the way they came from:
    // being set down pointing somewhere arbitrary is the whole point.
    m.dazedHeading = root.rotation.y + randRange(-Math.PI, Math.PI);
    m.dazedSpin = (Math.random() < 0.5 ? -1 : 1) * randRange(DAZED_SPIN[0], DAZED_SPIN[1]);
    m.landRotX = wrapAngle(root.rotation.x);
    m.landRotZ = wrapAngle(root.rotation.z);
    // They are somewhere else entirely now, so the spot they wander around
    // once the daze wears off is wherever they were put down.
    m.homeX = root.position.x;
    m.homeZ = root.position.z;
    m.shelter = null;
    m.hazard = null;

    // Whoever they were walking with is long gone -- severed from both sides,
    // so the partner does not carry on following someone who is reeling.
    if (m.partner && m.partner.motion) {
      if (m.partner.motion.partner === person) m.partner.motion.partner = null;
      if (m.partner.motion.leader === person) m.partner.motion.leader = null;
    }
    m.partner = null;
    m.leader = null;

    // Physics has been spinning them; motion owns their rotation from here.
    person.angularVelocity.set(0, 0, 0);
    person.velocity.set(0, 0, 0);
    // They may well have been dropped on a roof's worth of footprint.
    api.pushOutOfBuildings(root.position);
    Sim.stats.peopleDazed++;
  }

  /**
   * Advances the dazed state for one person, returning the heading they are
   * trying to stagger along and the pace they are doing it at.
   * @param {PersonMotion} m
   * @param {number} dt
   * @param {number} t seconds, for the weave
   * @returns {{heading: number, speed: number}}
   */
  function updateDazed(m, dt, t) {
    m.dazedTimer -= dt;
    if (m.standTimer > 0) m.standTimer = Math.max(0, m.standTimer - dt);
    if (m.dazedTimer <= 0) {
      // Straight into a normal pause: from here they are an ordinary
      // bystander again and will flee like one.
      m.mode = 'pause';
      m.pauseTimer = randRange(PAUSE_MIN, PAUSE_MAX);
      m.standTimer = 0;
      return { heading: m.heading, speed: 0 };
    }
    m.dazedHeading += m.dazedSpin * dt;
    return {
      heading: m.dazedHeading + Math.sin(t * DAZED_WEAVE_RATE + m.weaveSeed) * DAZED_WEAVE_AMPLITUDE,
      // Still getting up: on the spot until they are upright.
      speed: m.standTimer > 0 ? 0 : m.walkSpeed * DAZED_SPEED_SCALE
    };
  }

  /**
   * One candidate stroll destination: a pavement point along the nearest
   * street, a little way up or down it from where the person stands, or a
   * point around their home spot when no street is close.
   * @param {SimObject} person
   * @param {PersonMotion} m
   * @returns {{x:number, z:number}}
   */
  function candidateWanderTarget(person, m) {
    const { x, z } = person.mesh.position;
    const side = Math.random() < 0.5 ? -1 : 1;
    const offset = side * randRange(PAVEMENT_OFFSET_MIN, PAVEMENT_OFFSET_MAX);
    const along = randRange(-WANDER_REACH, WANDER_REACH);

    let best = Infinity;
    let tx = 0;
    let tz = 0;

    if (Math.abs(x) <= STREET_HALF_LENGTH) {
      for (const lineZ of STREET_Z_LINES) {
        const d = Math.abs(z - lineZ);
        if (d < best) { best = d; tx = x + along; tz = lineZ + offset; }
      }
    }
    if (Math.abs(z) <= STREET_HALF_LENGTH) {
      for (const lineX of STREET_X_LINES) {
        const d = Math.abs(x - lineX);
        if (d < best) { best = d; tx = lineX + offset; tz = z + along; }
      }
    }
    const r = Math.hypot(x, z);
    const ringDist = Math.abs(r - RING_RADIUS);
    if (ringDist < best && r > 0.01) {
      best = ringDist;
      const angle = Math.atan2(z, x) + along / RING_RADIUS;
      const ringR = RING_RADIUS + offset;
      tx = Math.cos(angle) * ringR;
      tz = Math.sin(angle) * ringR;
    }

    if (best > STREET_SNAP_DISTANCE) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * HOME_WANDER_RADIUS;
      tx = m.homeX + Math.cos(a) * d;
      tz = m.homeZ + Math.sin(a) * d;
    }

    return {
      x: THREE.MathUtils.clamp(tx, -WORLD_BOUND, WORLD_BOUND),
      z: THREE.MathUtils.clamp(tz, -WORLD_BOUND, WORLD_BOUND)
    };
  }

  /**
   * Picks the next stroll destination whose straight path clears every
   * building, trying a few candidates. If none is clear (someone boxed in
   * between buildings), they stay put briefly and try again.
   * @param {SimObject} person
   * @param {PersonMotion} m
   * @returns {void}
   */
  function pickWanderTarget(person, m) {
    const pos = person.mesh.position;
    for (let attempt = 0; attempt < WANDER_TARGET_ATTEMPTS; attempt++) {
      const target = candidateWanderTarget(person, m);
      if (api.boxAt(target.x, target.z)) continue;
      if (api.segmentBlocked(pos.x, pos.z, target.x, target.z)) continue;
      m.targetX = target.x;
      m.targetZ = target.z;
      m.mode = 'walk';
      return;
    }
    m.mode = 'pause';
    m.pauseTimer = BLOCKED_REPICK_PAUSE;
  }

  /**
   * Lazily attaches motion state to a person the first time it is seen, so
   * freshly regenerated people after a reset need no extra wiring.
   * @param {SimObject} person
   * @param {number} index
   * @returns {PersonMotion|null} null if the figure's limbs are missing
   */
  function getMotion(person, index) {
    if (person.motion) return person.motion;
    const root = person.mesh;
    const name = root.name;
    const legL = root.getObjectByName(`${name}_legL`);
    const legR = root.getObjectByName(`${name}_legR`);
    const armL = root.getObjectByName(`${name}_armL`);
    const armR = root.getObjectByName(`${name}_armR`);
    if (!legL || !legR || !armL || !armR) return null;

    /** @type {PersonMotion} */
    const m = {
      active: true,
      dropped: false,
      mode: 'pause',
      targetX: root.position.x,
      targetZ: root.position.z,
      homeX: root.position.x,
      homeZ: root.position.z,
      // Staggered so the crowd does not all set off on the same frame.
      pauseTimer: Math.random() * PAUSE_MAX,
      walkSpeed: randRange(WALK_SPEED_MIN, WALK_SPEED_MAX),
      runSpeed: randRange(RUN_SPEED_MIN, RUN_SPEED_MAX),
      heading: root.rotation.y,
      phase: Math.random() * Math.PI * 2,
      gait: 0,
      weaveSeed: Math.random() * 100,
      limbSlot: index % LIMB_FAR_STEP,
      limbs: { legL, legR, armL, armR },
      armSplay: Math.abs(armL.rotation.z),
      fleeHeading: root.rotation.y,
      fleeProbeTimer: Math.random() * FLEE_PROBE_INTERVAL,
      dazedTimer: 0,
      standTimer: 0,
      dazedHeading: root.rotation.y,
      dazedSpin: 0,
      landRotX: 0,
      landRotZ: 0,
      shelter: null,
      // The local ground hazard they are currently running out from under,
      // if any (engine/hazards.js). Takes priority over shelter-seeking:
      // there is no point reaching a door by way of a falling deck.
      hazard: null,
      // The muster point they are walking to, if the evacuation has called
      // them in (engine/evacuation.js). Set and cleared by that system, not
      // by this one: it owns whether a point is taking people.
      pickup: null,
      partner: null,
      leader: null,
      pairSide: 1,
      stuckTime: 0,
      unstickTimer: 0,
      unstickHeading: 0
    };
    api.pushOutOfBuildings(root.position);
    m.homeX = root.position.x;
    m.homeZ = root.position.z;
    person.motion = m;
    return m;
  }

  /**
   * Pairs up about PAIR_FRACTION of a freshly generated crowd with a nearby
   * companion. Runs once per crowd (resetEnvironment() makes a new people
   * array). The earlier-listed person leads; the other follows at their
   * side. The leader walks at the slower of the two paces so the pair can
   * keep together.
   * @param {SimObject[]} people
   * @returns {void}
   */
  function assignPairs(people) {
    S.pairSource = people;
    const order = people.map((p, i) => i).sort(() => Math.random() - 0.5);
    const paired = new Set();
    let pairsLeft = Math.round((people.length * PAIR_FRACTION) / 2);
    for (const i of order) {
      if (pairsLeft <= 0) break;
      if (paired.has(i)) continue;
      const a = people[i];
      let best = -1;
      let bestDist = PAIR_MAX_DISTANCE;
      for (let j = 0; j < people.length; j++) {
        if (j === i || paired.has(j)) continue;
        const d = a.mesh.position.distanceTo(people[j].mesh.position);
        if (d < bestDist) { bestDist = d; best = j; }
      }
      if (best < 0) continue;
      const b = people[best];
      const am = a.motion;
      const bm = b.motion;
      if (!am || !bm) continue;
      paired.add(i);
      paired.add(best);
      am.partner = b;
      bm.partner = a;
      bm.leader = a;
      bm.pairSide = Math.random() < 0.5 ? -1 : 1;
      am.walkSpeed = Math.min(am.walkSpeed, bm.walkSpeed);
      pairsLeft--;
    }
  }

  /**
   * @param {SimObject|null} other
   * @returns {boolean} whether a partner is still around and walking
   */
  function partnerAvailable(other) {
    return !!other && !!other.motion && other.motion.active && !!other.mesh.parent;
  }

  /**
   * Where a follower should stand: beside the leader on their side, or on
   * the other side / just behind if that spot is inside a building.
   * @param {SimObject} leader
   * @param {number} side
   * @returns {{x:number, z:number}}
   */
  function followSlot(leader, side) {
    const h = leader.motion.heading;
    const lp = leader.mesh.position;
    // Leader's right-hand side is (cos h, -sin h) given forward (sin h, cos h).
    for (const s of [side, -side]) {
      const x = lp.x + Math.cos(h) * PAIR_OFFSET * s;
      const z = lp.z - Math.sin(h) * PAIR_OFFSET * s;
      if (!api.boxAt(x, z)) return { x, z };
    }
    return { x: lp.x - Math.sin(h) * PAIR_OFFSET, z: lp.z - Math.cos(h) * PAIR_OFFSET };
  }

  /**
   * Poses the limbs and body for the current walk-cycle phase and gait.
   * gait blends standing (0) -> walking (1) -> running (2).
   *
   * Note this may be throttled to every LIMB_FAR_STEP frames for distant
   * figures, so every time-varying term here reads the shared clock `t` rather
   * than accumulating per call -- a throttled accumulation would run at a
   * third speed.
   * @param {SimObject} person
   * @param {PersonMotion} m
   * @param {number} t seconds
   * @returns {void}
   */
  function poseLimbs(person, m, t) {
    const walkW = Math.min(m.gait, 1);
    const runW = Math.max(m.gait - 1, 0);
    const legAmp = walkW * THREE.MathUtils.lerp(LEG_SWING_WALK, LEG_SWING_RUN, runW);
    const armAmp = walkW * THREE.MathUtils.lerp(ARM_SWING_WALK, ARM_SWING_RUN, runW);
    const swing = Math.sin(m.phase);

    m.limbs.legL.rotation.x = swing * legAmp;
    m.limbs.legR.rotation.x = -swing * legAmp;

    if (m.mode === 'dazed') {
      // Arms held wide and a little forward, feeling for balance rather than
      // swinging with the stride, and the whole body rolling side to side.
      m.limbs.armL.rotation.x = DAZED_ARM_RAISE - swing * DAZED_ARM_SWING;
      m.limbs.armR.rotation.x = DAZED_ARM_RAISE + swing * DAZED_ARM_SWING;
      m.limbs.armL.rotation.z = -DAZED_ARM_SPLAY;
      m.limbs.armR.rotation.z = DAZED_ARM_SPLAY;

      // Getting up: the sprawl they landed in rotates out over standTimer, and
      // the sway fades in as it does, so the two never fight.
      const upright = 1 - m.standTimer / DAZED_STAND_TIME;
      const sway = Math.sin(t * DAZED_SWAY_RATE + m.weaveSeed) * DAZED_SWAY * upright;
      person.mesh.rotation.x = m.landRotX * (1 - upright);
      person.mesh.rotation.z = m.landRotZ * (1 - upright) + sway;
      person.mesh.position.y = Math.abs(Math.cos(m.phase)) * walkW * DAZED_BOB * person.mesh.scale.y;
      return;
    }

    // Arms swing opposite to the leg on the same side, as in a real gait.
    m.limbs.armL.rotation.x = -swing * armAmp;
    m.limbs.armR.rotation.x = swing * armAmp;
    // Runners pump their arms in closer to the body.
    const splay = m.armSplay * (1 - runW * 0.6);
    m.limbs.armL.rotation.z = -splay;
    m.limbs.armR.rotation.z = splay;

    // Bob twice per stride (once per footfall), in local units scaled up by
    // the group's own scale (PERSON_SCALE).
    const bobAmp = walkW * THREE.MathUtils.lerp(BOB_WALK, BOB_RUN, runW);
    person.mesh.position.y = Math.abs(Math.cos(m.phase)) * bobAmp * person.mesh.scale.y;
    person.mesh.rotation.x = runW * RUN_LEAN;
    // Levels out any roll left over from a daze that has just worn off (and,
    // with it, any residual ragdoll roll physics left on them).
    person.mesh.rotation.z = 0;
  }

  return { randRange, angleDelta, wrapAngle, readyToWake, wakeDazed, updateDazed, candidateWanderTarget, pickWanderTarget, getMotion, assignPairs, partnerAvailable, followSlot, poseLimbs };
}
