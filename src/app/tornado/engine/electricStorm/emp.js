import * as THREE from 'three';
import { ELECTRIC } from './config.js';

/**
 * ===========================================================================
 * SECTION ES.3 — EMP waves and electrocution
 * ===========================================================================
 * The EMP ring the funnel sends out, and what it does to people caught in
 * it: the jolts, the corpses.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see electricStorm.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createElectricEmp(ctx, S, api) {
  const { Sim } = ctx;

  // ---------------------------------------------------------------------
  // The EMP
  // ---------------------------------------------------------------------

  /**
   * @param {Object} instance
   * @returns {void}
   */
  function fireEMP(instance) {
    const center = instance.Vortex.center;
    S.state.empActive = true;
    S.state.empRadius = 0;
    S.state.empKills = 0;
    S.state.empDone.clear();
    S.ring.visible = true;
    S.ring.position.set(center.x, 2, center.z);
    S.ring.scale.setScalar(0.01);
    S.ring.material.opacity = 0.9;
    S.state.charge = 1;
    ctx.systems.lightning.flashScreen(
      S.scratchA.set(center.x, 20, center.z), 0.55, ELECTRIC.flashTint
    );
    ctx.systems.gamefeel.event('emp', S.scratchA);
    ctx.systems.damage.addDamageScore(ELECTRIC.empScore);
    api.showBanner('EMP DISCHARGE!', 'The grid is going down');
    ctx.systems.shockwaveSound.playShockwave();
    // A pulse dumped into a flooded town carries much further than one into
    // dry ground, and there is a lot more of it than a single bolt.
    if (ctx.systems.collisions) {
      ctx.systems.collisions.groundDischarge(S.scratchA.set(center.x, 1, center.z), 1.8);
    }
  }

  /**
   * The ring travelling outward. Like the chemical works' pressure wave it
   * reaches things in order of distance, so the town goes dark in rings
   * rather than all at once.
   * @param {number} dt
   * @returns {void}
   */
  function updateEMP(dt) {
    const previous = S.state.empRadius;
    S.state.empRadius += ELECTRIC.empSpeed * dt;
    const through = S.state.empRadius / ELECTRIC.empRadius;
    S.ring.scale.setScalar(Math.max(0.01, S.state.empRadius));
    S.ring.material.opacity = 0.9 * (1 - through) * (1 - through);

    const cx = S.ring.position.x;
    const cz = S.ring.position.z;
    // Fault every line the ring has just crossed: a band rather than a disc,
    // so the crossing is what matters and not the area already behind it.
    const band = (previous + S.state.empRadius) / 2;
    ctx.systems.powerLines.faultAt(cx, cz, band + (S.state.empRadius - previous));

    if (ctx.Environment && ctx.systems.damage.shockBuilding) {
      for (const building of ctx.Environment.buildings) {
        if (S.state.empDone.has(building) || building.damageState === 'collapsed') continue;
        const p = building.mesh.position;
        const d = Math.hypot(p.x - cx, p.z - cz);
        if (d > S.state.empRadius) continue;
        S.state.empDone.add(building);
        ctx.systems.damage.shockBuilding(building, ELECTRIC.empShock, p);
        if (Math.random() < 0.3) ctx.systems.buildingFire.igniteNear(p.x, p.z, 10);
      }
    }

    // The one machine in town the pulse can kill (engine/terminator.js).
    if (ctx.systems.terminator) ctx.systems.terminator.empSweep(cx, cz, S.state.empRadius);
    // Hero Mode's pursuer is not one of the squad, and is asked on its own.
    ctx.events.emit('empPulse', { x: cx, z: cz, radius: S.state.empRadius });

    // People in the open that the ring has just passed over. Each is decided
    // once, as the ring reaches them.
    if (ctx.Environment) {
      for (const person of ctx.Environment.people) {
        if (S.state.empDone.has(person) || person.electrocuted || person.abducted || !person.mesh.parent) continue;
        const p = person.mesh.position;
        const d = Math.hypot(p.x - cx, p.z - cz);
        if (d > S.state.empRadius) continue;
        S.state.empDone.add(person);
        if (person.captureState !== 'grounded' || S.state.empKills >= ELECTRIC.electrocuteMax) continue;
        const odds = ELECTRIC.electrocuteChance * Math.max(0, 1 - d / ELECTRIC.electrocuteReach);
        if (Math.random() < odds) {
          S.state.empKills++;
          electrocute(person);
        }
      }
    }

    if (through >= 1) {
      S.state.empActive = false;
      S.ring.visible = false;
    }
  }

  /**
   * @returns {{x: number, z: number, radius: number, strength: number}|null}
   *   the travelling EMP ring, for the minimap, while there is one
   */
  function empRing() {
    if (!S.state.empActive || !S.ring) return null;
    return {
      x: S.ring.position.x,
      z: S.ring.position.z,
      radius: S.state.empRadius,
      strength: Math.max(0, 1 - S.state.empRadius / ELECTRIC.empRadius)
    };
  }

  // ---------------------------------------------------------------------
  // Electrocution
  // ---------------------------------------------------------------------

  /**
   * Takes a person out of everything else's hands and starts them
   * convulsing: out of Sim.objects (so the funnel, physics and damage no
   * longer see them) and out of their own motion, lit up from inside by the
   * current. They stay in Environment.people until they are gone, so the
   * humans readout counts them among the dead at the moment they fall.
   * @param {Object} person
   * @returns {void}
   */
  function electrocute(person) {
    person.electrocuted = true;
    if (person.motion) {
      person.motion.active = false;
      person.motion.dropped = false;
    }
    const at = Sim.objects.indexOf(person);
    if (at !== -1) Sim.objects.splice(at, 1);
    /** @type {THREE.MeshStandardMaterial[]} */
    const mats = [];
    person.mesh.traverse((/** @type {any} */ child) => {
      const m = child.material;
      if (m && m.emissive && !mats.includes(m)) mats.push(m);
    });
    const p = person.mesh.position;
    S.jolts.push({ person, timer: 0, materials: mats, x: p.x, z: p.z });
    if (S.sparks) api.spawnSparks(S.scratchB.set(p.x, 3, p.z));
    ctx.systems.damage.addDamageScore(ELECTRIC.electrocuteScore);
  }

  /**
   * @param {Object} person
   * @returns {void}
   */
  function removeCorpse(person) {
    person.mesh.removeFromParent();
    person.mesh.traverse((/** @type {any} */ child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    const envIdx = ctx.Environment.people.indexOf(person);
    if (envIdx !== -1) ctx.Environment.people.splice(envIdx, 1);
  }

  /**
   * The convulsion, then the fall. Runs whether or not the mode is still on,
   * so nobody is left frozen mid-jolt when it is switched off.
   * @param {number} dt
   * @returns {void}
   */
  function updateJolts(dt) {
    for (let i = S.jolts.length - 1; i >= 0; i--) {
      const j = S.jolts[i];
      const root = j.person.mesh;
      // Struck by something else meanwhile (lightning, a reset): already gone.
      if (!root.parent) {
        S.jolts.splice(i, 1);
        continue;
      }
      j.timer += dt;
      if (j.timer < ELECTRIC.joltSeconds) {
        // Lit from inside and flickering, every limb twitching.
        const on = Math.random() < 0.7 ? 1 : 0.1;
        for (const m of j.materials) {
          m.emissive.copy(ELECTRIC.joltColour).multiplyScalar(on);
        }
        root.position.set(j.x + (Math.random() - 0.5) * 0.35, Math.random() * 0.25, j.z + (Math.random() - 0.5) * 0.35);
        root.rotation.z = (Math.random() - 0.5) * 0.35;
        root.rotation.x = (Math.random() - 0.5) * 0.25;
        root.traverse((child) => {
          if (child !== root && child.name && /_arm|_leg/.test(child.name)) child.rotation.x = (Math.random() - 0.5) * 1.6;
        });
        if (Math.random() < dt * 10 && S.sparks) api.spawnSparks(S.scratchB.set(j.x, 2 + Math.random() * 3, j.z));
        continue;
      }
      // Burnt out: charred black, and over it goes.
      if (!j.charred) {
        j.charred = true;
        for (const m of j.materials) {
          m.emissive.setRGB(0, 0, 0);
          m.color.setRGB(0.05, 0.05, 0.05);
        }
        root.position.set(j.x, 0, j.z);
        root.rotation.z = 0;
      }
      const f = Math.min(1, (j.timer - ELECTRIC.joltSeconds) / 0.45);
      root.rotation.x = -f * f * (Math.PI / 2 - 0.1);
      if (j.timer >= ELECTRIC.joltSeconds + ELECTRIC.charSeconds) {
        removeCorpse(j.person);
        S.jolts.splice(i, 1);
      }
    }
  }

  return { fireEMP, updateEMP, empRing, electrocute, removeCorpse, updateJolts };
}
