// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION F — Physics / force integration
 * ===========================================================================
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   CAPTURE_TUNE: Object,
 *   gravity: {scale: number},
 *   tornadoLiftCapacity: () => number,
 *   liftDifficulty: (obj: Object) => number,
 *   updateCaptureState: (obj: Object, pos: THREE.Vector3, dt: number) => boolean,
 *   integratePhysics: (dt: number) => void
 * }}
 */
// How much of a merged monster's extra size becomes extra lifting power (see
// tornadoLiftCapacity). Sub-linear on purpose: at the merge's sizeMul of 2.4
// this is a 1.9x capacity, enough to put cars and train wagons within reach
// without making every scrap of debris weightless.
const MONSTER_LIFT_GAIN = 0.65;

export function createPhysicsSystem(ctx) {
  const { Sim, computeVortexForce } = ctx;
  const { spawnImpactBurst } = ctx.systems.explosions;
  // The vortex/scream systems are registered well before this one, so this
  // is safe to destructure at construction rather than looking it up every frame.
  const { playScream } = ctx.systems.scream;
  // Last frame's counts, for the performance overlay (engine/perf/monitor.js):
  // objects the physics looked at, and how many of them were asleep.
  const PhysicsStats = { objects: 0, asleep: 0 };
  // Gravity's strength for whatever falls freely (the grounded/falling
  // branch of updateCaptureState): 1 always, but for the few seconds of moon
  // gravity after Hank Granite's scene (engine/actionHero.js AH.lowGravity).
  const gravity = { scale: 1 };

  /**
   * Tuning constants for the progressive capture state machine (see
   * updateCaptureState). Radii are expressed as factors of p.radius so they
   * scale with the "Tornado Radius" slider the same way computeVortexForce's
   * own capture/eye radii do.
   */
  // The per-object force in updateCaptureState, reused (performance pass).
  const forceScratch = new THREE.Vector3();

  const CAPTURE_TUNE = {
    edgeRadiusFactor: 1.8,   // outer edge: grounded -> trembling begins here (matches computeVortexForce's captureRadius)
    liftRadiusFactor: 0.85,  // inner radius: trembling -> rising may begin here
    riseHeight: 3.0,         // world-space y a rising object must clear to become airborne/orbiting
    riseMargin: 1.0,         // liftCapacity must exceed liftDifficulty * this to start rising
    sustainMargin: 0.6       // liftCapacity must exceed liftDifficulty * this to stay orbiting (lower = hysteresis, so a momentary dip doesn't instantly drop debris)
  };

  /**
   * How strongly the tornado can currently lift/sustain objects, combining
   * intensity, wind speed and rotation speed. Intensity is raised to a power
   * so weak tornadoes (low intensity) fall off much faster than mid/strong
   * ones — this is what keeps a weak tornado limited to ground-level pulling
   * (ineligible to ever satisfy CAPTURE_TUNE.riseMargin) while a mid-strength
   * (EF4-default) one clears it for every debris-pool kind, including rocks
   * and roof pieces, within a few seconds, and EF5 clears it almost
   * instantly. CAPACITY_BOOST (1.8x) was added because the un-boosted value
   * at EF4 defaults (~0.65) sat right at/below liftDifficulty() for rock and
   * roofPiece (~0.5-0.9), so they'd permanently fail canRise and sit
   * trembling on the ground forever instead of eventually lifting — heavier
   * debris (cars) still stays mass-gated out of reach until intensity is
   * much closer to EF5.
   * @returns {number}
   */
  function tornadoLiftCapacity(vortex) {
    const p = Sim.params;
    const CAPACITY_BOOST = 1.8;
    const windFactor = THREE.MathUtils.clamp(p.windSpeed / 220, 0.1, 1.6);
    const rotationFactor = THREE.MathUtils.clamp(p.rotationSpeed / 3.5, 0.15, 1.8);
    // A Fujiwhara-merged monster (engine/fujiwhara.js) lifts what nothing
    // else can. Without this the survivor was only *wider*: sizeMul already
    // scaled its capture radius here and in computeVortexForce, so it reached
    // further, but the lift gate it had to clear was identical to a plain
    // funnel's -- meaning the endgame tornado could not pick up a single
    // thing an ordinary one could not. Cars and train wagons sit just above
    // the EF4 gate, so this is what puts them in reach.
    const sizeMul = vortex ? vortex.sizeMul : 1;
    return Math.pow(p.intensity, 1.5) * windFactor * (0.6 + 0.4 * rotationFactor)
      * CAPACITY_BOOST * (1 + (sizeMul - 1) * MONSTER_LIFT_GAIN);
  }

  /**
   * How hard a given object is to lift/sustain: heavier and less
   * lift-eligible objects (rocks, cars) score much higher than light ones
   * (branches, boxes), so comparing this against tornadoLiftCapacity() is
   * what makes heavier kinds only get airborne once the tornado is strong
   * enough.
   * @param {SimObject} obj
   * @returns {number}
   */
  function liftDifficulty(obj) {
    return (obj.mass / Math.max(obj.liftEligible, 0.05)) / 10;
  }

  /**
   * Gives a newly-captured object its own place in the swirl: an orbit
   * radius, a vertical lane to settle into, the rate it seeks that lane, and
   * a noise phase/frequency pair driving its wobble.
   *
   * Everything here is randomised per object and biased by `heaviness`, so
   * the column ends up layered rather than uniform — trunks, rocks and roof
   * panels churning low and wide around the funnel's base while branches and
   * boxes stream high up the column — instead of every object climbing the
   * same spiral in lockstep. The bias uses liftDifficulty(), the same metric
   * the rise gate uses, so "heavy" means exactly one thing across the whole
   * capture machine.
   * @param {SimObject} obj
   * @param {number} entryAngle radians, where around the funnel it was caught
   * @param {number} entryRadius its distance from the axis at capture
   * @param {number} entryHeight its world-space y at capture
   * @returns {void}
   */
  function assignOrbit(obj, entryAngle, entryRadius, entryHeight) {
    const Vortex = obj.vortex;
    // ~0 for a branch, ~1 for a tree trunk, a rock or a car.
    const heaviness = THREE.MathUtils.clamp(liftDifficulty(obj) / 1.4, 0, 1);

    obj.orbitAngle = entryAngle;
    // Heavy objects are pushed outwards, riding the funnel wall rather than
    // the core; light debris keeps the full original spread and so can range
    // from the axis right out to the visible edge.
    obj.orbitRadiusFactor = 0.35 + Math.random() * 0.85 + heaviness * 0.45;
    // Lane centre as a fraction of funnel height: low for heavy, high for
    // light, with enough per-object spread that adjacent lanes overlap and
    // the layering never reads as discrete bands.
    const laneCentre = THREE.MathUtils.lerp(0.62, 0.2, heaviness);
    // Heavy objects are thrown clear well before they reach the top of the
    // column. Without this the tiers wash out within seconds: the lane drift
    // below carries everything upward, and because heavy objects linger they
    // end up spread over the whole column rather than staying low. Measured
    // before adding it — trunks were orbiting at y=48 while branches sat at
    // y=18, precisely inverting the intended layering.
    obj.orbitMaxHeight = Vortex.height
      * THREE.MathUtils.lerp(0.95, 0.4, heaviness)
      * (0.85 + Math.random() * 0.35);
    // Kept clear of the ceiling so an object always has room to actually
    // orbit in its lane before the drift lifts it out.
    obj.orbitLane = Math.min(
      Vortex.height * THREE.MathUtils.clamp(laneCentre + (Math.random() - 0.5) * 0.3, 0.08, 0.95),
      obj.orbitMaxHeight * 0.7
    );
    obj.orbitClimbRate = 0.6 + Math.random() * 0.9;
    // The lane itself creeps upward, and that creep is what eventually
    // carries the object past orbitMaxHeight and out of the column — so this
    // doubles as its orbit lifetime. Heavy objects drift more slowly and
    // therefore linger around the base, which is what makes the lower tier
    // look persistently populated rather than briefly visited.
    obj.orbitLaneDrift = THREE.MathUtils.lerp(2.8, 1.7, heaviness) * (0.6 + Math.random() * 0.8);
    // Seeded from the live position so the object eases out of wherever it
    // actually was rather than snapping onto the ideal path.
    obj.orbitR = entryRadius;
    obj.orbitY = entryHeight;
    obj.noisePhase = Math.random() * 97;
    obj.noiseFreq = 0.35 + Math.random() * 0.95;
  }

  /**
   * Advances one object's progressive-capture state machine
   * (grounded -> trembling -> rising -> orbiting -> falling -> grounded) and
   * fully integrates its velocity/position for this frame according to its
   * current state. Ground-contact clamping for the non-orbiting states is
   * still applied afterwards by the integratePhysics() caller.
   * @param {SimObject} obj
   * @param {THREE.Vector3} pos world-space position (mutated in place)
   * @param {number} dt
   * @returns {boolean} whether the tornado is actively influencing this object this frame (for stats)
   */
  function updateCaptureState(obj, pos, dt) {
    const p = Sim.params;
    // Which tornado has this object. Once one has it off the ground, it
    // keeps it (an Outbreak tornado passing nearby does not steal it); on
    // the ground, whichever is nearest. If its tornado is switched off
    // mid-flight (Outbreak ended), anything it was carrying is dropped.
    if (obj.vortex && !obj.vortex.active) {
      obj.vortex = null;
      if (obj.captureState === 'orbiting' || obj.captureState === 'rising') obj.captureState = 'falling';
    }
    if (!obj.vortex || obj.captureState === 'grounded') obj.vortex = ctx.tornadoes.nearest(pos.x, pos.z);
    const Vortex = obj.vortex;
    const dx = pos.x - Vortex.center.x;
    const dz = pos.z - Vortex.center.z;
    const r = Math.sqrt(dx * dx + dz * dz);
    // Scaled by birth as well (vortex.js BIRTH), so the reach grows with the
    // funnel as it touches down rather than arriving at full size with it.
    const edgeRadius = p.radius * CAPTURE_TUNE.edgeRadiusFactor * Vortex.sizeMul * Vortex.birth;
    const liftRadius = p.radius * CAPTURE_TUNE.liftRadiusFactor * Vortex.sizeMul * Vortex.birth;
    const capacity = tornadoLiftCapacity(Vortex);
    const difficulty = liftDifficulty(obj);
    const canRise = capacity > difficulty * CAPTURE_TUNE.riseMargin;
    const canSustain = capacity > difficulty * CAPTURE_TUNE.sustainMargin;

    const prevCaptureState = obj.captureState;

    switch (obj.captureState) {
      case 'trembling':
        if (r >= edgeRadius * 1.05) obj.captureState = 'grounded';
        else if (r < liftRadius && canRise) obj.captureState = 'rising';
        break;
      case 'rising':
        if (r >= edgeRadius) obj.captureState = 'grounded';
        else if (!canRise) obj.captureState = 'trembling';
        else if (pos.y > CAPTURE_TUNE.riseHeight) {
          obj.captureState = 'orbiting';
          assignOrbit(obj, Math.atan2(dz, dx), r, pos.y);
        }
        break;
      case 'orbiting':
        if (!canSustain || pos.y > obj.orbitMaxHeight) {
          // Flung/released: hand off to ballistic falling with an outward
          // kick so the debris visibly leaves the column instead of just
          // stopping in place.
          // The orbit is integrated kinematically, so obj.velocity currently
          // carries the full tangential orbit speed (angularSpeed * radius).
          // At EF5 with a 30m radius that is ~270 m/s — about four times the
          // fastest wind this simulation can produce — and handing it
          // straight to the ballistic falling branch launched debris
          // hundreds of metres clear of the funnel (710m measured), where it
          // settled permanently outside the capture radius and could never
          // be drawn back in. The pool then filled with stranded debris,
          // reconcileDebrisTarget() saw no free slots and stopped topping
          // up, and the swirl starved itself. Capping the inherited speed
          // keeps ejected debris landing in the surrounding streets, within
          // reach of the wandering funnel.
          const maxEject = 6 + p.windSpeed * 0.05;
          const horizontal = Math.hypot(obj.velocity.x, obj.velocity.z);
          if (horizontal > maxEject) {
            obj.velocity.x *= maxEject / horizontal;
            obj.velocity.z *= maxEject / horizontal;
          }
          const outDirX = r > 0.01 ? dx / r : Math.cos(obj.orbitAngle);
          const outDirZ = r > 0.01 ? dz / r : Math.sin(obj.orbitAngle);
          obj.velocity.x += outDirX * (4 + Math.random() * 4);
          obj.velocity.z += outDirZ * (4 + Math.random() * 4);
          obj.velocity.y = Math.max(obj.velocity.y * 0.3, 0.5);
          obj.captureState = 'falling';
        }
        break;
      case 'falling':
        // Against its own floor (integratePhysics): a car that came down on
        // its roof rests with its origin well above y = 0.
        if (pos.y <= (obj.groundFloor || 0) + 0.05 && obj.velocity.length() < 1.0) obj.captureState = 'grounded';
        break;
      case 'grounded':
      default:
        if (r < edgeRadius) obj.captureState = 'trembling';
        break;
    }

    // One-off "swept into the vortex" burst. A car fires the moment it leaves
    // the ground, since that transition IS the car being swept in; everything
    // else fires on first reaching the orbiting column. Both share one flag,
    // so a car that goes on to orbit doesn't burst a second time.
    //
    // The flag is never re-armed: an object flung out by the 'orbiting' ->
    // 'falling' branch above and later recaptured stays quiet, because this
    // marks the moment of destruction rather than every lap around the
    // funnel. Pooled debris re-arms naturally without any extra bookkeeping,
    // since spawnDebris() builds a fresh object literal for a recycled slot.
    if (!obj.captureBurstDone && obj.captureState !== prevCaptureState) {
      const sweptUp = obj.type === 'car' && obj.captureState === 'rising';
      // People are excluded from the general orbiting-burst path: the burst
      // is a fireball/shockring (see spawnImpactBurst), and a person
      // catching fire on capture would read as a violent injury rather than
      // "swept up by the wind" -- see the scream trigger just below for
      // their own, lighthearted capture cue instead.
      if (sweptUp || (obj.captureState === 'orbiting' && obj.type !== 'person')) {
        obj.captureBurstDone = true;
        // Kept small for debris: at high intensity a lot of objects reach the
        // column within a few seconds of each other, and this is the one
        // trigger that can fire in bulk.
        spawnImpactBurst(pos, obj.type === 'car' ? 1.4 : 0.7);
      }
    }

    // A person's "getting swept up" cue: a stylised scream (see scream.js),
    // fired the moment they enter 'rising'. Deliberately not gated behind
    // captureBurstDone above -- a person who is later dropped and caught
    // again should scream again, which is the fun outcome here rather than
    // something to guard against.
    if (obj.type === 'person' && obj.captureState === 'rising' && prevCaptureState !== 'rising') {
      playScream(pos, Sim.three.camera.position.distanceTo(pos));
    }

    let influenced = false;

    if (obj.captureState === 'orbiting') {
      // Kinematic spiral, in the same spirit as the visual particle swirl in
      // updateVortexVisuals: an explicit angle/radius/height advection reads
      // as a clean, stable "caught in the vortex" spiral, combining upward
      // climb with tangential rotation around the axis, rather than trying
      // to balance that shape purely out of accumulated forces.
      const heightFrac = THREE.MathUtils.clamp(pos.y / Vortex.height, 0, 1);
      const funnelRadiusAtHeight = THREE.MathUtils.lerp(Vortex.baseRadius, Vortex.topRadius, heightFrac);
      const targetR = funnelRadiusAtHeight * obj.orbitRadiusFactor * (p.radius / 14) * Vortex.sizeMul;
      const angularSpeed = 1.2 + p.rotationSpeed * 1.3;

      // Per-object wobble, sampled from the same SimplexNoise instance that
      // drives the funnel's own turbulence so debris and funnel share one
      // visual language. Three orthogonal samples give independent radial,
      // vertical and angular nudges — a single shared scalar would only make
      // the object pulse along one axis. Offsetting the sample by this
      // object's own phase and scaling time by its own frequency is what
      // stops the whole swirl bobbing in unison.
      const noise = Vortex.noise;
      let wobbleR = 0;
      let wobbleY = 0;
      let wobbleA = 0;
      if (noise) {
        const nt = ctx.now() * obj.noiseFreq + obj.noisePhase;
        const amp = 0.5 + p.intensity * 2.5;
        wobbleR = noise.noise3d(nt, obj.noisePhase, 0) * amp;
        wobbleY = noise.noise3d(0, nt, obj.noisePhase) * amp * 0.8;
        wobbleA = noise.noise3d(obj.noisePhase, 0, nt) * 0.3;
      }

      obj.orbitAngle += angularSpeed * dt;
      obj.orbitLane += obj.orbitLaneDrift * p.intensity * dt;

      // The smooth orbit radius and height are tracked on the object rather
      // than re-derived from the position each frame, because the position
      // already carries last frame's wobble — feeding that back in would let
      // the wobble compound into a drift away from the intended path instead
      // of staying a bounded offset from it.
      obj.orbitR = THREE.MathUtils.lerp(obj.orbitR, targetR, Math.min(1, dt * 1.5));
      obj.orbitY += (obj.orbitLane - obj.orbitY) * Math.min(1, dt * obj.orbitClimbRate);

      const newR = Math.max(0.5, obj.orbitR + wobbleR);
      const angle = obj.orbitAngle + wobbleA;
      const newX = Vortex.center.x + Math.cos(angle) * newR;
      const newZ = Vortex.center.z + Math.sin(angle) * newR;
      const newY = Math.max(0.2, obj.orbitY + wobbleY);

      obj.velocity.set((newX - pos.x) / dt, (newY - pos.y) / dt, (newZ - pos.z) / dt);
      pos.set(newX, newY, newZ);
      influenced = true;
    } else if (obj.captureState === 'trembling') {
      // Stage 1: sliding/trembling along the ground, pulled inward — no lift yet.
      const pullStrength = (1 - r / edgeRadius) * (2.5 + p.intensity * 3) * (p.windSpeed / 220);
      const rDir = r > 0.01 ? dx / r : 0;
      const zDir = r > 0.01 ? dz / r : 0;
      const jitterPhase = ctx.now() * 20 + obj.id;
      // Scratch vectors, not new ones: this runs for every trembling or
      // rising object every frame (performance pass).
      const force = forceScratch.set(
        -rDir * pullStrength * obj.mass + Math.cos(jitterPhase * 7) * 0.6 * obj.mass,
        -9.8 * obj.mass * 0.9,
        -zDir * pullStrength * obj.mass + Math.sin(jitterPhase * 9) * 0.6 * obj.mass
      );
      const accel = force.divideScalar(obj.mass);
      obj.velocity.add(accel.multiplyScalar(dt));
      obj.velocity.multiplyScalar(Math.max(0, 1 - obj.drag * dt * 2));
      pos.addScaledVector(obj.velocity, dt);
      influenced = true;
    } else if (obj.captureState === 'rising') {
      // Stage 2: full vortex force (inward + tangential + the fixed, floored
      // upward lift), steadily carrying the object off the ground.
      const force = computeVortexForce(pos, obj.mass, obj.liftEligible, Vortex, forceScratch);
      const accel = force.divideScalar(obj.mass);
      obj.velocity.add(accel.multiplyScalar(dt));
      obj.velocity.multiplyScalar(Math.max(0, 1 - obj.drag * dt));
      pos.addScaledVector(obj.velocity, dt);
      influenced = true;
    } else {
      // grounded / falling: plain ballistic gravity, no vortex influence.
      obj.velocity.y -= 9.8 * gravity.scale * dt;
      obj.velocity.multiplyScalar(Math.max(0, 1 - obj.drag * dt * 0.5));
      pos.addScaledVector(obj.velocity, dt);
    }

    return influenced;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  const groundBox = new THREE.Box3();
  const groundCorner = new THREE.Vector3();
  const identityQuat = new THREE.Quaternion();

  /**
   * The mesh's bounding box in its own frame, measured once and cached: what
   * the ground-contact test below turns into "how far below its origin does
   * it reach at its current tilt".
   * @param {THREE.Object3D} mesh
   * @returns {THREE.Box3}
   */
  function localBoxOf(mesh) {
    if (mesh.userData.localBox) return mesh.userData.localBox;
    const position = mesh.position.clone();
    const quaternion = mesh.quaternion.clone();
    const parent = mesh.parent;
    // Measured detached and untransformed, so neither the object's own pose
    // nor its parent's leaks into the box.
    if (parent) parent.remove(mesh);
    mesh.position.set(0, 0, 0);
    mesh.quaternion.copy(identityQuat);
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    mesh.position.copy(position);
    mesh.quaternion.copy(quaternion);
    if (parent) parent.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.userData.localBox = box;
    return box;
  }

  /**
   * How far the lowest corner of a tilted mesh reaches below its origin (a
   * negative number, or 0 when upright). A car on its roof has its origin at
   * the wheels, so clamping only the origin to y = 0 left the body buried in
   * the ground; this is the depth the clamp has to allow for instead.
   * @param {THREE.Object3D} mesh
   * @returns {number}
   */
  function lowestPointBelowOrigin(mesh) {
    // Upright (only turned about the vertical): the origin is the bottom.
    if (Math.abs(mesh.rotation.x) < 1e-3 && Math.abs(mesh.rotation.z) < 1e-3) return 0;
    const box = localBoxOf(mesh);
    if (box.isEmpty()) return 0;
    groundBox.copy(box);
    let lowest = Infinity;
    for (let i = 0; i < 8; i++) {
      groundCorner.set(
        i & 1 ? groundBox.max.x : groundBox.min.x,
        i & 2 ? groundBox.max.y : groundBox.min.y,
        i & 4 ? groundBox.max.z : groundBox.min.z
      ).multiply(mesh.scale).applyQuaternion(mesh.quaternion);
      if (groundCorner.y < lowest) lowest = groundCorner.y;
    }
    return Math.min(0, lowest);
  }

  function integratePhysics(dt) {
    const { syncDebrisInstances } = ctx.systems.debris;
    let affected = 0;
    let objects = 0;
    let sleeping = 0;
    // Where each funnel can reach this frame, for the sleep test below.
    const reaches = funnelReaches();
    const west = ctx.systems.flood ? ctx.systems.flood.westLimit() : -Infinity;

    for (const obj of Sim.objects) {
      if (obj.type === 'building') continue; // buildings handled per sub-piece in damage pass
      if (obj.rooted && obj.damageState === 'intact') continue;

      objects++;
      const pos = obj.pooled ? obj.position : obj.mesh.position;
      // Asleep: at rest on its own floor, not turning, and out of every
      // funnel's reach, so this frame would change nothing about it (the
      // state machine would keep it grounded, gravity would push it into
      // the floor and the clamp push it back). Skipped, then, apart from a
      // settled piece of debris's recycling clock. About half of a busy
      // town's objects are like this at any moment; they were half the
      // physics (measured, performance pass). Anything that touches one --
      // a blast, a funnel coming near, a push -- gives it velocity or a
      // funnel within reach, and it wakes the same frame.
      if (reaches && asleep(obj, pos, reaches)) {
        if (obj.pooled && obj.damageState === 'settled') obj.lifeTimer += dt;
        sleeping++;
        continue;
      }
      if (updateCaptureState(obj, pos, dt)) affected++;

      // Satellite sub-vortices tug at whatever passes close to them. Applied
      // after the state machine and only to non-orbiting objects: an orbiting
      // object's position is set kinematically from its own angle/radius/lane,
      // so a velocity nudge there would simply be overwritten next frame.
      if (obj.captureState !== 'orbiting') {
        for (const tornado of ctx.tornadoes.active) tornado.applySubVortexForce(pos, obj.velocity, dt);
      }

      // Cheap ground contact: clamp to y=0 with bounce+friction. Orbiting
      // objects are airborne by construction and manage their own height, so
      // they're exempt.
      //
      // The floor is where the object's lowest point touches, not its origin:
      // anything tipped, rolled or lying flat is held on top of the ground
      // rather than half sunk into it.
      const floor = obj.pooled ? 0 : -lowestPointBelowOrigin(obj.mesh);
      obj.groundFloor = floor;
      if (obj.captureState !== 'orbiting' && pos.y < floor) {
        pos.y = floor;
        obj.velocity.y *= -0.25;
        obj.velocity.x *= 0.85;
        obj.velocity.z *= 0.85;
      }
      // The dam is the west edge of the world (flood/dam.js westLimit):
      // whatever is thrown at it bounces back off, at any height, through
      // the breach or round the ends alike.
      if (pos.x < west) {
        pos.x = west;
        if (obj.velocity.x < 0) obj.velocity.x *= -0.3;
      }

      if (obj.pooled) {
        obj.rotation.x += obj.angularVelocity.x * dt;
        obj.rotation.y += obj.angularVelocity.y * dt;
        obj.rotation.z += obj.angularVelocity.z * dt;
        obj.angularVelocity.multiplyScalar(Math.max(0, 1 - 0.5 * dt));
        settleSpin(obj.angularVelocity);

        const settled = obj.captureState === 'grounded' && obj.velocity.length() < 0.15 && pos.y <= 0.01;
        if (settled) {
          obj.lifeTimer += dt;
          if (obj.damageState !== 'settled') obj.damageState = 'settled';
        } else {
          obj.lifeTimer = 0;
        }
      } else {
        // Ragdoll tumble for captured people: continuous small random kicks
        // to angularVelocity, rather than the single decaying impulse
        // uprootTree()/updateCarDamage() give a tree/car, so a person keeps
        // visibly tumbling for as long as they're airborne instead of the
        // spin damping itself out (see the multiplyScalar below, shared with
        // every other non-pooled object) within a couple of seconds while
        // they're still mid-flight. Scoped to type 'person' and gated off
        // once grounded again, so cars/trees are completely unaffected.
        if (obj.type === 'person' && obj.captureState !== 'grounded') {
          const kick = 9 * dt;
          obj.angularVelocity.x += (Math.random() - 0.5) * kick;
          obj.angularVelocity.y += (Math.random() - 0.5) * kick;
          obj.angularVelocity.z += (Math.random() - 0.5) * kick;
        }
        // Only when it is turning: every write to a rotation component
        // rebuilds the quaternion (three's Euler onChange), and most objects
        // are not turning at all (performance pass).
        const av = obj.angularVelocity;
        if (av.x !== 0 || av.y !== 0 || av.z !== 0) {
          obj.mesh.rotation.x += av.x * dt;
          // Only people get yaw (y-axis) rotation here: cars/trees rely on
          // rotation.y for heading/facing elsewhere (steering, wind-sway), so
          // spinning it here would fight that. A tumbling ragdoll has no such
          // constraint -- it should be free to spin on every axis at once.
          if (obj.type === 'person') obj.mesh.rotation.y += av.y * dt;
          obj.mesh.rotation.z += av.z * dt;
          av.multiplyScalar(Math.max(0, 1 - 0.5 * dt));
          settleSpin(av);
        }
      }
    }

    syncDebrisInstances();
    Sim.stats.objectsAffected = affected;
    PhysicsStats.objects = objects;
    PhysicsStats.asleep = sleeping;
  }

  // --- Sleeping objects (see integratePhysics) ------------------------------

  // A resting object still bounces by a hair every frame (gravity, then the
  // floor clamp's -0.25 restitution), so "at rest" allows a little vertical
  // speed; horizontal speed and spin must be all but gone.
  const SLEEP = { horizontal: 0.05, vertical: 0.6, floorSlack: 0.02, spin: 1e-6, margin: 1.1 };
  /** @type {{x: number, z: number, r: number}[]} reused each frame */
  const reachList = [];

  /**
   * Each active funnel's centre and capture edge this frame (with a margin),
   * or null when sleeping is off this frame (a satellite funnel is out: they
   * tug at grounded things).
   * @returns {{x: number, z: number, r: number}[]|null}
   */
  function funnelReaches() {
    const p = Sim.params;
    let n = 0;
    for (const tornado of ctx.tornadoes.active) {
      const V = tornado.Vortex;
      if (V.subVortices) for (const sub of V.subVortices) if (sub.active) return null;
      if (!reachList[n]) reachList[n] = { x: 0, z: 0, r: 0 };
      const e = reachList[n++];
      e.x = V.center.x;
      e.z = V.center.z;
      e.r = p.radius * CAPTURE_TUNE.edgeRadiusFactor * V.sizeMul * Math.max(V.birth, 0) * SLEEP.margin + 2;
    }
    reachList.length = n;
    return reachList;
  }

  /**
   * Whether an object can sit this frame out (see integratePhysics).
   * @param {SimObject} obj
   * @param {THREE.Vector3} pos
   * @param {{x: number, z: number, r: number}[]} reaches
   * @returns {boolean}
   */
  function asleep(obj, pos, reaches) {
    if (obj.captureState !== 'grounded') return false;
    const v = obj.velocity;
    if (Math.abs(v.x) > SLEEP.horizontal || Math.abs(v.z) > SLEEP.horizontal || Math.abs(v.y) > SLEEP.vertical) return false;
    const w = obj.angularVelocity;
    if (w && (w.x * w.x + w.y * w.y + w.z * w.z) > SLEEP.spin) return false;
    if (obj.groundFloor === undefined || pos.y > obj.groundFloor + SLEEP.floorSlack) return false;
    for (let i = 0; i < reaches.length; i++) {
      const e = reaches[i];
      const dx = pos.x - e.x;
      const dz = pos.z - e.z;
      if (dx * dx + dz * dz < e.r * e.r) return false;
    }
    return true;
  }

  /**
   * Spin decaying towards zero never reaches it: snapped once it is too small
   * to see, so the object can rest (and sleep).
   * @param {THREE.Vector3} av
   * @returns {void}
   */
  function settleSpin(av) {
    if (av.x * av.x + av.y * av.y + av.z * av.z < SLEEP.spin) av.set(0, 0, 0);
  }

  return { CAPTURE_TUNE, PhysicsStats, gravity, tornadoLiftCapacity, liftDifficulty, updateCaptureState, integratePhysics };
}
