// @ts-check
import * as THREE from 'three';
import { PERSON_SCALE } from '../environment/people.js';
import { ALIENS } from './config.js';

/**
 * ===========================================================================
 * SECTION AK.3 — Abductions
 * ===========================================================================
 * Who is taken, the escorts that bring them to the ramp, the ride up the
 * belt, and a Terminator taken the same way.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the aliens' shared state (see aliens.js)
 * @param {Object} api every aliens module's functions, by name
 * @returns {Object}
 */
export function createAlienAbduction(ctx, S, api) {
  const { Sim } = ctx;

  // ---------------------------------------------------------------------
  // Abductions
  // ---------------------------------------------------------------------

  /**
   * The person on their feet nearest the foot of the ramp.
   * @returns {Object|null}
   */
  function pickVictim() {
    let best = null;
    let bestD = Infinity;
    for (const person of ctx.Environment.people) {
      if (!person.mesh.parent || person.abducted || person.electrocuted || person.inChasm) continue;
      if (person.captureState !== 'grounded') continue;
      const p = person.mesh.position;
      const d = (p.x - S.rampFoot.x) ** 2 + (p.z - S.rampFoot.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = person;
      }
    }
    return best;
  }

  /**
   * Takes a person out of everyone else's hands -- the funnel, physics and
   * their own walking -- and starts drawing them in.
   * @param {Object} person
   * @returns {void}
   */
  function abduct(person) {
    person.abducted = true;
    if (person.motion) {
      person.motion.active = false;
      person.motion.dropped = false;
    }
    const at = Sim.objects.indexOf(person);
    if (at !== -1) Sim.objects.splice(at, 1);
    /** @type {THREE.MeshStandardMaterial[]} */
    const materials = [];
    person.mesh.traverse((/** @type {any} */ child) => {
      const m = child.material;
      if (m && m.emissive && !materials.includes(m)) materials.push(m);
    });
    for (const m of materials) m.emissive.setRGB(0.1, 0.9, 0.2);
    person.mesh.rotation.set(0, Math.atan2(S.rampFoot.x - person.mesh.position.x, S.rampFoot.z - person.mesh.position.z), 0);
    const escorts = pickEscorts(person.mesh.position);
    escorts.forEach((alien, i) => {
      alien.phase = 'escort';
      alien.side = i === 0 ? -1 : 1;
      alien.aim = 0;
      alien.knockTimer = 0;
      alien.root.rotation.x = 0;
    });
    S.abductees.push({
      person, machine: null, root: person.mesh, baseScale: PERSON_SCALE,
      phase: escorts.length ? 'fetch' : 'drawn', timer: 0, materials, escorts
    });
    if (ctx.systems.speechBubbles) ctx.systems.speechBubbles.exclaim(person);
  }

  /**
   * The (up to) two of the crew nearest a point who are free to go.
   * @param {THREE.Vector3} at
   * @returns {Alien[]}
   */
  function pickEscorts(at) {
    return S.aliens.filter(alien => alien.phase === 'patrol' && !alien.wave)
      .sort((a, b) => a.root.position.distanceToSquared(at) - b.root.position.distanceToSquared(at))
      .slice(0, ALIENS.escorts);
  }

  /**
   * Where an escort should be: beside the person, across the way they are
   * going.
   * @param {Abductee} a
   * @param {Alien} alien
   * @param {number} dirX the way the group is heading
   * @param {number} dirZ
   * @param {THREE.Vector3} out
   * @returns {THREE.Vector3}
   */
  function flankOf(a, alien, dirX, dirZ, out) {
    const p = a.root.position;
    // Left of heading (x, z) is (z, -x).
    return out.set(p.x + dirZ * alien.side * ALIENS.escortSide, 0, p.z - dirX * alien.side * ALIENS.escortSide);
  }

  /**
   * Walks an escort towards a point at `speed`, facing its way, legs going.
   * @param {Alien} alien
   * @param {THREE.Vector3} to
   * @param {number} speed
   * @param {number} dt
   * @returns {number} distance left
   */
  function stepEscort(alien, to, speed, dt) {
    const p = alien.root.position;
    const dx = to.x - p.x;
    const dz = to.z - p.z;
    const d = Math.hypot(dx, dz);
    const step = Math.min(d, speed * dt);
    if (d > 0.01) {
      p.x += (dx / d) * step;
      p.z += (dz / d) * step;
      alien.heading = Math.atan2(dx, dz);
      alien.root.rotation.y = alien.heading;
    }
    p.y = to.y || 0;
    alien.cycle += step * 3;
    api.poseWalk(alien, step > 0.001 ? 1 : 0);
    return d - step;
  }

  /**
   * An abductee's escorts, from here on without them: back to their patrol
   * (the ship wrecked, the person lost), or dead with the ship if aboard.
   * @param {Abductee} a
   * @returns {void}
   */
  function releaseEscorts(a) {
    for (const alien of a.escorts || []) {
      if (alien.phase !== 'escort') continue;
      alien.phase = 'patrol';
      alien.root.scale.setScalar(ALIENS.scale);
      alien.root.position.y = 0;
      api.pickPatrolTarget(alien);
    }
    a.escorts = [];
  }

  /**
   * Takes a Terminator in, like a person: its own motion stops
   * (terminator.js takeUnit) and the tractor carries it from here.
   * @param {Object} unit
   * @returns {void}
   */
  function abductMachine(unit) {
    const root = ctx.systems.terminator.takeUnit(unit);
    /** @type {THREE.MeshStandardMaterial[]} */
    const materials = [];
    root.traverse((/** @type {any} */ child) => {
      const m = child.material;
      if (m && m.emissive && !materials.includes(m)) materials.push(m);
    });
    S.abductees.push({ person: null, machine: unit, root, baseScale: root.scale.x, phase: 'drawn', timer: 0, materials, escorts: [] });
  }

  /**
   * @returns {boolean} whether someone is on the belt (or going through the
   *   hatch) right now
   */
  function beltBusy() {
    return S.abductees.some(a => a.phase === 'climb' || a.phase === 'vanish');
  }

  /**
   * Drawn in across the ground, onto the belt one at a time, carried up it
   * standing, and gone through the hatch.
   * @param {number} dt
   * @returns {void}
   */
  function updateAbductees(dt) {
    // Oldest first, so the first one drawn in is the first onto the belt.
    for (let i = 0; i < S.abductees.length; i++) {
      const a = S.abductees[i];
      const root = a.root;
      if (!root.parent) {
        releaseEscorts(a);
        S.abductees.splice(i--, 1);
        continue;
      }
      // An escort burnt on the way is simply one fewer.
      a.escorts = a.escorts.filter(alien => alien.phase === 'escort');
      a.timer += dt;
      const glow = 0.6 + 0.4 * Math.sin(a.timer * 14);
      for (const m of a.materials) m.emissive.setRGB(0.1 * glow, 0.9 * glow, 0.2 * glow);
      const p = root.position;
      // The way to the ramp's foot, for the escorts' flanks.
      let hx = S.rampFoot.x - p.x;
      let hz = S.rampFoot.z - p.z;
      const hl = Math.hypot(hx, hz) || 1;
      hx /= hl;
      hz /= hl;
      if (a.phase === 'fetch') {
        // Held where they stand, lifted a little, while the two come out.
        p.y = 0.3 + 0.1 * Math.sin(a.timer * 5);
        let all = true;
        for (const alien of a.escorts) {
          if (stepEscort(alien, flankOf(a, alien, hx, hz, S.scratch), ALIENS.fetchSpeed, dt) > 0.4) all = false;
        }
        if (!all && a.timer < ALIENS.fetchSeconds && a.escorts.length) continue;
        for (const alien of a.escorts) alien.root.position.copy(flankOf(a, alien, hx, hz, S.scratch));
        a.phase = 'drawn';
        a.timer = 0;
      }
      if (a.phase === 'drawn' || a.phase === 'waiting') {
        const d = Math.hypot(S.rampFoot.x - p.x, S.rampFoot.z - p.z);
        const escorted = a.escorts.length > 0;
        const step = (escorted ? ALIENS.escortSpeed : ALIENS.drawSpeed) * dt;
        // Feet just off the ground: carried, not walking.
        p.y = 0.4 + 0.15 * Math.sin(a.timer * 5);
        if (d > step) {
          p.x += hx * step;
          p.z += hz * step;
          root.rotation.set(0, Math.atan2(hx, hz), 0);
          // The two beside them, keeping step.
          for (const alien of a.escorts) stepEscort(alien, flankOf(a, alien, hx, hz, S.scratch), ALIENS.escortSpeed * 1.6, dt);
          continue;
        }
        p.x = S.rampFoot.x;
        p.z = S.rampFoot.z;
        // At the foot: onto the belt if it is free, else wait there.
        if (beltBusy()) {
          a.phase = 'waiting';
          for (const alien of a.escorts) api.poseWalk(alien, 0);
          continue;
        }
        a.phase = 'climb';
        a.timer = 0;
        // Standing, facing up the ramp.
        root.rotation.set(0, Math.atan2(-S.state.dirX, -S.state.dirZ), 0);
      }
      if (a.phase === 'climb') {
        // The belt's own speed: a straight line at constant pace, feet on
        // the surface -- the escorts either side, across the belt.
        const u = Math.min(1, a.timer / ALIENS.climbSeconds);
        p.lerpVectors(S.rampFoot, S.rampTop, u);
        p.y += 0.2;
        for (const alien of a.escorts) {
          const q = alien.root.position;
          q.set(p.x - S.state.dirZ * alien.side * ALIENS.escortSide, p.y, p.z + S.state.dirX * alien.side * ALIENS.escortSide);
          alien.heading = Math.atan2(-S.state.dirX, -S.state.dirZ);
          alien.root.rotation.y = alien.heading;
          api.poseWalk(alien, 0);
        }
        if (u >= 1) {
          a.phase = 'vanish';
          a.timer = 0;
        }
        continue;
      }
      if (a.phase === 'vanish') {
        const v = Math.min(1, a.timer / ALIENS.vanishSeconds);
        p.copy(S.rampTop);
        root.scale.setScalar(a.baseScale * Math.max(0.02, 1 - v));
        for (const alien of a.escorts) alien.root.scale.setScalar(ALIENS.scale * Math.max(0.02, 1 - v));
        if (v >= 1) {
          // The two inside with them, out again in a few seconds.
          for (const alien of a.escorts) {
            alien.phase = 'aboard';
            alien.timer = 0;
            alien.root.visible = false;
          }
          a.escorts = [];
          if (a.machine) {
            ctx.systems.terminator.finishTaken(a.machine);
          } else {
            disposePerson(a.person);
            S.state.abducted++;
            ctx.systems.damage.addDamageScore(50);
          }
          S.abductees.splice(i--, 1);
        }
      }
    }
    if (S.beam) {
      S.beam.visible = beltBusy();
      S.beam.material.opacity = 0.35 + 0.15 * Math.sin(S.state.timer * 9);
    }
  }

  /**
   * @param {Object} person
   * @returns {void}
   */
  function disposePerson(person) {
    person.mesh.removeFromParent();
    person.mesh.traverse((/** @type {any} */ child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    const at = ctx.Environment.people.indexOf(person);
    if (at !== -1) ctx.Environment.people.splice(at, 1);
  }

  return { pickVictim, abduct, pickEscorts, flankOf, stepEscort, releaseEscorts, abductMachine, beltBusy, updateAbductees, disposePerson };
}
