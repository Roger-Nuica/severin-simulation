import * as THREE from 'three';
import { SHELTER_ARRIVE_DISTANCE } from './shelters.js';
import { MUSTER_ARRIVE, MUSTER_RUN_BEYOND, PAUSE_MIN, PAUSE_MAX, ARRIVE_DISTANCE, WORLD_BOUND, AWARENESS_EDGE_MULTIPLIER, AWARENESS_MIN, CALM_MARGIN, FLEE_WEAVE_AMPLITUDE, FLEE_WEAVE_RATE, SHELTER_WEAVE_AMPLITUDE, SHELTER_FINAL_APPROACH, TURN_RATE_WALK, TURN_RATE_RUN, STRIDE_PHASE_PER_UNIT, LIMB_EASE_RATE, BLOCKED_REPICK_PAUSE, FLEE_PROBE_INTERVAL, FLEE_PROBE_DISTANCE, STUCK_SECONDS, STUCK_PROGRESS, PAIR_ARRIVE, PAIR_CATCHUP_GAIN, PAIR_CATCHUP_MAX, LIMB_FAR_DISTANCE, LIMB_FAR_STEP } from './peopleMotion/config.js';
/** @typedef {import('./peopleMotion/config.js').PersonMotion} PersonMotion */
/** @typedef {import('./peopleMotion/config.js').BuildingBox} BuildingBox */
import { createCrowdObstacles } from './peopleMotion/obstacles.js';
import { createCrowdBehaviour } from './peopleMotion/behaviour.js';

/**
 * ===========================================================================
 * SECTION D.2 — Environment: people's ambient movement
 * ===========================================================================
 * Gives every bystander a life before the storm reaches them: a slow wander
 * between nearby pavement points with pauses in between, a procedural walk
 * cycle, and -- once the storm is running and the funnel comes within
 * AWARENESS range -- a visible switch to running directly away from it,
 * or, when a storm shelter is nearer than the funnel and not in its
 * direction, running for the shelter's door instead (shelters.js). Anyone
 * who reaches a door goes inside and leaves the simulation.
 *
 * Ownership hand-off with physics.js. This only ever drives a person whose
 * capture state has never left 'grounded'. The moment the vortex's field
 * moves them to 'trembling' (see updateCaptureState), motion.active is
 * cleared and the capture state machine owns them from then on -- including
 * the ragdoll tumble.
 *
 * Disorientation. Once such a person has been dropped, landed and stopped
 * rolling, motion takes them back (see wakeDazed) in a transient 'dazed'
 * mode before they resume normal AI: they pick themselves up out of the
 * sprawl they landed in, stagger off with their arms out for balance, wander
 * in the wrong direction and in slow circles for a few seconds with stars
 * spinning over their head (environment/dazedStars.js) and their own woozy
 * lines (environment/speechBubbles.js), and are deliberately deaf to the
 * tornado for the whole of it -- a dazed person does not flee, however close
 * the funnel is, which is most of what makes the state read as disorientation
 * rather than as a fresh bystander. When the daze wears off they drop into a
 * normal pause and behave like anyone else from then on, including fleeing;
 * if the vortex takes them again first, the hand-off above runs again exactly
 * as it did the first time.
 *
 * Runs after integratePhysics() in the frame, so the position and yaw it
 * writes are what reach the renderer. While grounded, physics only applies
 * gravity (clamped straight back to y = 0), so the two never fight.
 *
 * Building collision. Nobody pathfinds; they just refuse to walk through
 * walls. A wander target is only accepted if the straight line to it clears
 * every nearby building's footprint (inflated by PERSON_CLEARANCE), tested
 * once when the target is picked. A fleeing runner re-probes a short way
 * ahead a few times a second and fans out to the nearest clear heading
 * away from the funnel. As a safety net for the few cases a straight-line
 * check cannot foresee (turning arcs, the weave, a runner hemmed in), each
 * step is also point-tested against the one grid cell the person stands in,
 * sliding along a wall where only one axis is blocked. And a watchdog
 * catches whatever all of that still misses: anyone who has been trying to
 * move and has hardly covered any ground for STUCK_SECONDS is pushed clear of
 * any building they are inside and sent off on the nearest clear heading for
 * a moment (see unstick), so nobody runs on the spot against a wall or the
 * edge of the map. All of it goes
 * through a coarse spatial grid of building boxes, rebuilt only when the
 * town is regenerated, so a test touches one or two buildings rather than
 * the whole town.
 *
 * Traits and presets (environment/crowd.js): how early each person notices
 * the funnel and how hard they run (panic), whether they go the way the
 * runners round them go (herd), whether they think of a shelter at all,
 * and whether they stand their ground ('defy', the brave), run anywhere
 * (cowards) or lead the others to a door (leaders). The Normal preset is
 * the behaviour described above, unchanged.
 *
 * Cost: per person per frame, one distance check against the funnel, a few
 * multiply-adds to step along a straight line, and -- only for the limb
 * animation -- four rotation writes and one sine. Limb animation for people
 * far from the camera is stepped at a lower rate (see LIMB_FAR_*), staggered
 * across the crowd so the saving is spread evenly over frames; their
 * positions still update every frame, so nobody visibly stutters.
 */

/*
 * Split by job across engine/environment/peopleMotion/ (moved as it was; the benchmark's
 * fingerprint is the same before and after):
 *   config.js     tunables
 *   obstacles.js  buildings and hazards in the way, getting unstuck
 *   behaviour.js  wandering, fleeing, following, being dazed, the walk
 * and this file: the frame for every person, with the shared state S and the
 * modules' functions in `api`.
 */

/**
 * @param {Object} ctx
 * @returns {{ updatePeopleMotion: (dt: number) => void }}
 */
export function createPeopleMotionSystem(ctx) {
  const { Sim } = ctx;
  // Everything this system's modules share (see the header): each of them
  // reads and writes it as S.
  const S = {
    frameCounter: 0,
  
    /** @type {Map<string, BuildingBox[]>} */
    grid: new Map(),
    /** @type {SimObject[]|null} the Environment.buildings array the grid was built from */
    gridSource: null,

    queryStamp: 0,
    /** @type {SimObject[]|null} the Environment.people array pairs were assigned for */
    pairSource: null
  };

  // Every function of every module, by name, for the others to call.
  const api = {};
  Object.assign(api,
    createCrowdObstacles(ctx, S, api),
    createCrowdBehaviour(ctx, S, api),
    {  }
  );

  /**
   * Per-frame driver. Called from animate() after integratePhysics(), every
   * frame the simulation is not paused (so the town is already alive before
   * Start is pressed).
   * @param {number} dt
   * @returns {void}
   */
  function updatePeopleMotion(dt) {
    const people = ctx.Environment.people;
    if (!people.length) return;
    S.frameCounter++;
    api.ensureGrid();
    if (people !== S.pairSource) {
      people.forEach((p, i) => api.getMotion(p, i));
      api.assignPairs(people);
    }

    const running = Sim.state.running;
    const edge = Sim.params.radius * 1.8;
    const awareness = Math.max(AWARENESS_MIN, edge * AWARENESS_EDGE_MULTIPLIER);
    const camPos = Sim.three.camera.position;
    const t = ctx.now();
    const shelters = ctx.systems.shelters;
    const hazards = ctx.systems.hazards;
    const crowd = ctx.systems.crowd;
    /** @type {SimObject[]} */
    const sheltered = [];

    for (let i = 0; i < people.length; i++) {
      const person = people[i];
      const m = api.getMotion(person, i);
      if (!m) continue;
      if (!m.active) {
        // Dropped by a vortex and now settled: pick them back up, dazed.
        if (m.dropped && api.readyToWake(person)) api.wakeDazed(person, m);
        if (!m.active) continue;
      }
      if (person.captureState !== 'grounded') {
        // Physics has them now; hand over with an upright, neutral body so
        // the ragdoll tumble starts from a clean pose. `dropped` is what gets
        // them back once physics has finished with them (see wakeDazed).
        m.active = false;
        m.dropped = true;
        m.dazedTimer = 0;
        m.standTimer = 0;
        m.shelter = null;
        person.mesh.rotation.x = 0;
        person.mesh.rotation.z = 0;
        // One last line as the wind takes them (see speechBubbles.js).
        ctx.systems.speechBubbles.exclaim(person);
        continue;
      }
      // Dancing (engine/dance.js): Smooth Criminal, or the new arrivals with
      // nobody left to run from. The dance poses them; the walk leaves them be.
      if (person.dancing) continue;

      const pos = person.mesh.position;
      // In an Outbreak, the tornado to run from is the nearest one.
      const Vortex = ctx.tornadoes.nearest(pos.x, pos.z);
      const dx = pos.x - Vortex.center.x;
      const dz = pos.z - Vortex.center.z;
      const distToFunnel = Math.hypot(dx, dz);
      // Their own traits (environment/crowd.js): how early they notice it.
      const trait = crowd.traitOf(person, m);
      const aware = awareness * trait.awareness;

      // A dazed person is exempt: they have no idea where they are, let alone
      // where the funnel is, until the daze wears off.
      // Somewhere they are standing that is about to be underneath something
      // (engine/hazards.js). Unlike the funnel this is not gated on the run
      // being under way: a span can be brought down by a meteor or a flood
      // with no storm anywhere near it.
      const hazard = hazards ? hazards.threatAt(pos.x, pos.z) : null;

      if (m.mode === 'dazed') {
        // Nothing to decide here -- updateDazed owns them.
      } else if (running && distToFunnel < aware) {
        // The tornado outranks everything. It is also the only threat here
        // that moves faster than a person can run -- unless they are brave
        // (crowd.js), and stand there facing it.
        const mode = trait.kind === 'brave' ? 'defy' : 'flee';
        if (m.mode !== mode) {
          m.fleeProbeTimer = 0;
          crowd.startFlee(person, trait);
        }
        m.hazard = null;
        m.shelter = mode === 'defy' ? null : m.shelter;
        m.mode = mode;
      } else if (hazard) {
        // Straight out from under it, and no detour via a shelter door: the
        // only thing that matters is not being here when it lands.
        if (m.hazard !== hazard) {
          m.fleeProbeTimer = 0;
          // One line as they look up, which is most of what makes this
          // readable to the player from a distance.
          if (m.mode !== 'flee') ctx.systems.speechBubbles.exclaim(person);
        }
        m.hazard = hazard;
        m.shelter = null;
        m.mode = 'flee';
      } else if (m.pickup && m.pickup.open) {
        // Being evacuated. Below the funnel and below a hazard in priority --
        // an orderly walk to the bus is not what you do with a tornado on top
        // of you -- but above anything else they might have been doing.
        if (m.mode !== 'muster') {
          m.fleeProbeTimer = 0;
          ctx.systems.speechBubbles.exclaim(person);
        }
        m.shelter = null;
        m.hazard = null;
        m.mode = 'muster';
      } else if (m.mode === 'muster') {
        // The point has closed, or the bus has gone without them.
        m.pickup = null;
        m.mode = 'pause';
        m.pauseTimer = api.randRange(PAUSE_MIN, PAUSE_MAX);
      } else if ((m.mode === 'flee' || m.mode === 'defy') && (!running || distToFunnel > aware + CALM_MARGIN)) {
        m.mode = 'pause';
        m.shelter = null;
        m.hazard = null;
        m.pauseTimer = api.randRange(PAUSE_MIN, PAUSE_MAX);
      }

      let speed = 0;
      let desiredHeading = m.heading;
      if (m.mode === 'dazed') {
        const dazed = api.updateDazed(m, dt, t);
        desiredHeading = dazed.heading;
        speed = dazed.speed;
      } else if (m.mode === 'flee' && m.hazard) {
        // Clearing a footprint on the ground, not outrunning a storm: the
        // shortest way out is straight out of it, and the probe only exists to
        // stop them running into a wall doing it. No shelter detour -- there is
        // no point reaching a door by way of the deck.
        m.fleeProbeTimer -= dt;
        if (m.fleeProbeTimer <= 0) {
          m.fleeHeading = api.probeFleeHeading(pos, api.hazardEscapeHeading(pos, m.hazard));
          m.fleeProbeTimer = FLEE_PROBE_INTERVAL;
        }
        // Weaves less than a storm runner: it is a short dash out of a
        // circle, and a wandering line out of it reads as not having
        // understood the problem.
        desiredHeading = m.fleeHeading
          + Math.sin(t * FLEE_WEAVE_RATE + m.weaveSeed) * FLEE_WEAVE_AMPLITUDE * 0.4;
        speed = m.runSpeed;
      } else if (m.mode === 'flee') {
        m.fleeProbeTimer -= dt;
        if (m.fleeProbeTimer <= 0) {
          // Re-decided at every probe: a door that was worth making for can
          // stop being so as the funnel moves. Which door, if any, and
          // which way without one, are the person's own (crowd.js).
          m.shelter = crowd.pickShelter(person, m, trait, pos, Vortex.center, distToFunnel, edge, people);
          if (m.shelter) {
            const doorDist = Math.hypot(m.shelter.x - pos.x, m.shelter.z - pos.z);
            m.fleeHeading = api.probeFleeHeading(pos, Math.atan2(m.shelter.x - pos.x, m.shelter.z - pos.z),
              Math.min(FLEE_PROBE_DISTANCE, doorDist));
          } else {
            m.fleeHeading = api.probeFleeHeading(pos, crowd.fleeDirection(person, m, trait, Math.atan2(dx, dz), people));
          }
          m.fleeProbeTimer = FLEE_PROBE_INTERVAL;
        }
        let weave = FLEE_WEAVE_AMPLITUDE * trait.weave;
        if (m.shelter) {
          const sx = m.shelter.x - pos.x;
          const sz = m.shelter.z - pos.z;
          const doorDist = Math.hypot(sx, sz);
          if (doorDist < SHELTER_ARRIVE_DISTANCE) {
            sheltered.push(person);
            continue;
          }
          weave = SHELTER_WEAVE_AMPLITUDE;
          if (doorDist < SHELTER_FINAL_APPROACH) {
            m.fleeHeading = Math.atan2(sx, sz);
            weave = 0;
          }
        }
        desiredHeading = m.fleeHeading + Math.sin(t * FLEE_WEAVE_RATE + m.weaveSeed) * weave;
        speed = m.runSpeed * trait.speed;
      } else if (m.mode === 'defy') {
        // Standing their ground: facing the funnel, not moving, until it
        // passes or the wind takes them.
        desiredHeading = Math.atan2(-dx, -dz);
        speed = 0;
      } else if (m.mode === 'muster') {
        // Walking in to the bus, then standing and waiting for it. They run
        // if they are a long way out and walk once they are close, which is
        // what turns a scattered crowd into a queue that visibly forms.
        const px = m.pickup.x - pos.x;
        const pz = m.pickup.z - pos.z;
        const gap = Math.hypot(px, pz);
        if (gap > MUSTER_ARRIVE) {
          m.fleeProbeTimer -= dt;
          if (m.fleeProbeTimer <= 0) {
            m.fleeHeading = api.probeFleeHeading(
              pos, Math.atan2(px, pz), Math.min(FLEE_PROBE_DISTANCE, gap)
            );
            m.fleeProbeTimer = FLEE_PROBE_INTERVAL;
          }
          desiredHeading = m.fleeHeading;
          speed = gap > MUSTER_RUN_BEYOND ? m.runSpeed : m.walkSpeed;
        } else {
          // Arrived: face the road and wait to be let on.
          desiredHeading = Math.atan2(px, pz);
          speed = 0;
        }
      } else if (m.leader && api.partnerAvailable(m.leader) && m.leader.motion.mode !== 'flee') {
        // Following: close on the slot beside the leader, matching their
        // pace once there; stand facing the way they face when they stop.
        m.mode = 'follow';
        const slot = api.followSlot(m.leader, m.pairSide);
        const fx = slot.x - pos.x;
        const fz = slot.z - pos.z;
        const gap = Math.hypot(fx, fz);
        if (gap > PAIR_ARRIVE) {
          desiredHeading = Math.atan2(fx, fz);
          speed = Math.min(gap * PAIR_CATCHUP_GAIN, m.leader.motion.walkSpeed * PAIR_CATCHUP_MAX);
        } else {
          desiredHeading = m.leader.motion.heading;
        }
      } else if (m.mode === 'follow') {
        // Leader gone (captured, struck) or bolting: carry on alone.
        if (m.leader && !api.partnerAvailable(m.leader)) { m.leader = null; m.partner = null; }
        m.mode = 'pause';
        m.pauseTimer = api.randRange(PAUSE_MIN, PAUSE_MAX);
      } else if (m.mode === 'pause') {
        m.pauseTimer -= dt;
        if (m.pauseTimer <= 0) api.pickWanderTarget(person, m);
      } else {
        const tx = m.targetX - pos.x;
        const tz = m.targetZ - pos.z;
        const dist = Math.hypot(tx, tz);
        if (dist < ARRIVE_DISTANCE) {
          m.mode = 'pause';
          m.pauseTimer = api.randRange(PAUSE_MIN, PAUSE_MAX);
        } else {
          desiredHeading = Math.atan2(tx, tz);
          speed = m.walkSpeed;
        }
      }

      // The watchdog's detour outranks whatever they were trying to do, bar
      // the daze (which has its own stagger and no destination to reach).
      if (m.unstickTimer > 0 && m.mode !== 'dazed') {
        m.unstickTimer -= dt;
        desiredHeading = m.unstickHeading;
        speed = m.mode === 'flee' ? m.runSpeed : m.walkSpeed;
        // A stroll whose destination it could not reach picks another.
        if (m.unstickTimer <= 0 && m.mode === 'walk') api.pickWanderTarget(person, m);
      }

      // Turn towards the desired heading before (and while) moving, so a
      // new destination behind someone reads as them turning round rather
      // than moonwalking there.
      const turnRate = m.mode === 'flee' ? TURN_RATE_RUN : TURN_RATE_WALK;
      const turn = api.angleDelta(m.heading, desiredHeading);
      m.heading += THREE.MathUtils.clamp(turn, -turnRate * dt, turnRate * dt);
      const facing = Math.max(0, Math.cos(turn));
      const step = speed * facing * dt;

      let moved = 0;
      if (step > 0) {
        // Already inside a footprint (dropped on one, or a building that
        // settled round them): every step from here would be refused, so
        // out first.
        if (api.boxAt(pos.x, pos.z)) api.pushOutOfBuildings(pos);
        const x0 = pos.x;
        const z0 = pos.z;
        const nx = THREE.MathUtils.clamp(pos.x + Math.sin(m.heading) * step, -WORLD_BOUND, WORLD_BOUND);
        const nz = THREE.MathUtils.clamp(pos.z + Math.cos(m.heading) * step, -WORLD_BOUND, WORLD_BOUND);
        // Safety net: never step into a building. Slide along the wall on
        // whichever axis is still free; if neither is, stop and re-plan.
        if (!api.boxAt(nx, nz)) {
          pos.x = nx;
          pos.z = nz;
        } else if (!api.boxAt(nx, pos.z)) {
          pos.x = nx;
        } else if (!api.boxAt(pos.x, nz)) {
          pos.z = nz;
        } else if (m.mode === 'flee') {
          m.fleeProbeTimer = 0;
        } else if (m.unstickTimer <= 0) {
          m.mode = 'pause';
          m.pauseTimer = BLOCKED_REPICK_PAUSE;
        }
        // What they actually covered: the clamp at the edge of the map can
        // eat a step whole without anything above noticing.
        moved = Math.hypot(pos.x - x0, pos.z - z0);
        m.phase += moved * STRIDE_PHASE_PER_UNIT;
      }
      // The watchdog. Only while they are trying to get somewhere: standing
      // in a queue or pausing is not being stuck.
      if (speed > 0 && m.mode !== 'dazed') {
        if (moved < speed * dt * STUCK_PROGRESS) m.stuckTime += dt;
        else m.stuckTime = Math.max(0, m.stuckTime - dt * 2);
        if (m.stuckTime > STUCK_SECONDS) api.unstick(person, m, desiredHeading);
      } else {
        m.stuckTime = 0;
      }
      person.mesh.rotation.y = m.heading;
      person.velocity.set(0, 0, 0);

      const targetGait = moved > 0 ? (m.mode === 'flee' ? 2 : 1) : 0;
      m.gait += (targetGait - m.gait) * Math.min(1, LIMB_EASE_RATE * dt);

      const far = camPos.distanceToSquared(pos) > LIMB_FAR_DISTANCE * LIMB_FAR_DISTANCE;
      // A dazed figure is never throttled: standing back up and the balancing
      // sway are one continuous few-second animation, and stepping it every
      // third frame is visible as a stutter in a way a walk cycle is not.
      if (!far || m.mode === 'dazed' || S.frameCounter % LIMB_FAR_STEP === m.limbSlot) {
        api.poseLimbs(person, m, t);
      }
    }

    // After the loop, which walks the people array by index.
    for (const person of sheltered) shelters.admitPerson(person);
  }

  // getMotion is exported alongside the per-frame driver for
  // engine/environment/reinforcements.js: people spawned mid-run (rather
  // than by a whole fresh Environment.people array from resetEnvironment())
  // need their motion state attached explicitly, since the lazy-init above
  // only runs when the *array itself* is a new reference (see the
  // `people !== pairSource` check).
  return { updatePeopleMotion, getMotion: api.getMotion };
}
