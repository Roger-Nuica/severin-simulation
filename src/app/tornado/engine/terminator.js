import * as THREE from 'three';
import { CHARACTERS } from './scale.js';
import { MINIGUN } from './heroWeapons.js';
import { bannerHost } from '../utils/banners.js';
import { T800 } from './terminator/config.js';
/** @typedef {import('./terminator/config.js').Unit} Unit */
import { createTerminatorModel } from './terminator/model.js';
import { createTerminatorMovement } from './terminator/movement.js';
import { createTerminatorHits } from './terminator/hits.js';

/**
 * ===========================================================================
 * SECTION AJ — The Terminator
 * ===========================================================================
 * A chrome endoskeleton that walks into town and hunts the people in it, and
 * that nothing in this simulation can stop except the Electric Tornado's EMP
 * discharge (engine/electricStorm.js).
 *
 * Its immunity is structural rather than a list of exceptions: it is never
 * put into Sim.objects, so the vortex's force field, physics, the damage
 * system, flying debris, fire, the flood, blasts and meteors -- every one of
 * which works by walking Sim.objects -- simply never see it. The funnel can
 * pass straight over it and it keeps walking. The chasm it walks round.
 *
 * An EMP-charged funnel (engine/empCharge.js) kills one that walks into it
 * the same way (see walk). The EMP is the one thing that looks for it: as the discharge's ring sweeps
 * outward, electricStorm.js calls empSweep(), and once the ring reaches it the
 * machine seizes -- sparks, eyes flickering out, a shudder -- and goes over
 * backwards, a wreck, for good. The panel button (btn-terminator) sends in a
 * squad of T800.squad from all round the edge of town; it is greyed until
 * every one of them has been destroyed, and the next press clears the wrecks.
 *
 * While one is walking it picks the nearest person still on their feet and
 * goes for them, and anyone it reaches is killed (people.js explodePerson,
 * so they count among the dead in the humans readout).
 *
 * With Hero Mode on (engine/heroMode.js) the squad comes for Roger instead
 * of the townspeople: straight at him, and reaching him is the end of him.
 * His plasma rifle knocks one back; a mega beam (the two-second charge)
 * takes it down for good, the same way the EMP does.
 *
 * The aliens (engine/aliens.js) are the other hunters in town, and the two
 * fight. A Terminator that sees one closer than its human target goes for
 * it instead; reaching it, it strikes (aliens.strikeAlien) -- which only kills
 * where there is fire at hand, and otherwise just throws the alien back. The
 * aliens, for their part, can take a Terminator up their ramp like anyone
 * else while the ship is there (takeUnit / finishTaken / releaseUnit, driven
 * from aliens.js), and shoot at it once it is gone, to no effect.
 *
 * Nobody pathfinds here, but nobody gets stuck either. A short probe ahead
 * tests the way it wants to go against every building footprint, the edge of
 * town and the chasm; when that is blocked it turns off to the nearest clear
 * heading, keeping to one side of the obstacle until it is round it (see
 * steer). A watchdog catches whatever that still misses: a machine that has
 * covered almost no ground for a couple of seconds strikes out on a clear
 * heading for a while and gives up on the person it could not reach.
 */

/*
 * Split by job across engine/terminator/ (moved as it was; the benchmark's
 * fingerprint is the same before and after):
 *   config.js    tunables
 *   model.js     the machine
 *   movement.js  finding a target and walking to it round the buildings
 *   hits.js      what kills it: EMP, plasma, bullets, rays; its death; being taken
 * and this file: set-up, the frame, reset and dispose, with the shared state S and the
 * modules' functions in `api`.
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initTerminator: () => void,
 *   updateTerminator: (dt: number) => void,
 *   spawnTerminator: () => void,
 *   empSweep: (x: number, z: number, radius: number) => void,
 *   positions: () => THREE.Vector3[],
 *   nearestWalking: (x: number, z: number, radius: number) => Object|null,
 *   takeUnit: (unit: Object) => THREE.Group,
 *   finishTaken: (unit: Object) => void,
 *   releaseUnit: (unit: Object) => void,
 *   rayHit: (unit: Object) => void,
 *   buildModel: () => Object,
 *   plasmaHit: (unit: Object, mega: boolean, from: THREE.Vector3) => void,
 *   bulletHit: (unit: Object, killAt: number) => number,
 *   walkingUnits: () => Object[],
 *   resetTerminator: () => void,
 *   disposeTerminator: () => void
 * }}
 */
export function createTerminatorSystem(ctx) {
  const { Sim, container } = ctx;
  // Everything this system's modules share (see the header): each of them
  // reads and writes it as S.
  const S = {
  
  
    /** @type {Unit[]} */
    units: [],
    /** @type {HTMLDivElement|null} */
    banner: null,

    bannerTimer: 0,
    /** @type {HTMLButtonElement|null} */
    button: null,

    scratch: new THREE.Vector3(),
  
    // ---------------------------------------------------------------------
    // The model
    // ---------------------------------------------------------------------
  
    /** @type {THREE.BufferGeometry[]} geometries of the unit being built */
    buildGeoms: []
  };

  // Every function of every module, by name, for the others to call.
  const api = {};
  Object.assign(api,
    createTerminatorModel(ctx, S, api),
    createTerminatorMovement(ctx, S, api),
    createTerminatorHits(ctx, S, api),
    { showBanner, aliveCount }
  );

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------

  /** @returns {void} */
  function initTerminator() {
    S.banner = document.createElement('div');
    S.banner.className = 'terminator-banner';
    S.banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
    bannerHost(container).appendChild(S.banner);
    S.button = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-terminator'));
    if (S.button) {
      S.button.addEventListener('click', () => {
        const before = S.units.length ? S.units[0] : null;
        spawnTerminator();
        // Called in from the panel: the camera glides over to the first of them.
        const first = S.units.length ? S.units[0] : null;
        if (first && first !== before) ctx.systems.camera.glideTo(() => (first.root.parent ? first.root.position : null), CHARACTERS.terminator.height);
      }, { signal: ctx.signal });
    }
    // In the shared register of enemies (engine/enemies.js): the plasma
    // rifle, the minigun, lightning and an EMP stop one.
    ctx.systems.enemies.registerKind({
      kind: 'terminator',
      list: api.walkingUnits,
      position: (unit) => unit.root.position,
      accepts: ['plasma', 'bullet', 'bolt', 'emp'],
      damage: (unit, hit) => {
        const p = unit.root.position;
        if (hit.type === 'plasma') api.plasmaHit(unit, !!hit.mega, hit.at || p);
        else if (hit.type === 'bullet') api.bulletHit(unit, MINIGUN.terminatorHits);
        else api.empSweep(p.x, p.z, 0.01);
        return unit.phase !== 'walking';
      },
      // The black hole: gone, with no shutdown of its own.
      consume: (unit) => {
        unit.phase = 'dead';
        unit.root.visible = false;
      }
    });
  }

  /**
   * @param {string} title
   * @param {string} sub
   * @returns {void}
   */
  function showBanner(title, sub) {
    if (!S.banner) return;
    S.banner.querySelector('.title').textContent = title;
    S.banner.querySelector('.sub').textContent = sub;
    S.banner.classList.add('visible');
    S.bannerTimer = T800.bannerSeconds;
  }

  /** @returns {void} */
  function removeUnits() {
    for (const unit of S.units) {
      Sim.three.scene.remove(unit.root);
      for (const g of unit.geometries) g.dispose();
      for (const m of unit.materials) m.dispose();
    }
    S.units = [];
  }

  /** @returns {number} how many are still a threat */
  function aliveCount() {
    let n = 0;
    for (const unit of S.units) if (unit.phase !== 'dead') n++;
    return n;
  }

  /**
   * Sends a squad in from all round the edge of town. The button is greyed
   * while any of them is still standing, and the wrecks left by the last
   * squad are cleared away.
   * @returns {void}
   */
  function spawnTerminator() {
    if (aliveCount() > 0) return;
    removeUnits();
    const base = Math.random() * Math.PI * 2;
    for (let i = 0; i < T800.squad; i++) {
      const unit = api.build();
      const a = base + (i / T800.squad) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const p = unit.root.position;
      p.set(Math.cos(a) * T800.spawnRadius, 0, Math.sin(a) * T800.spawnRadius);
      api.collideBuildings(p);
      // Facing the middle of town.
      unit.heading = Math.atan2(-p.x, -p.z);
      unit.root.rotation.y = unit.heading;
      unit.watchX = p.x;
      unit.watchZ = p.z;
      Sim.three.scene.add(unit.root);
      S.units.push(unit);
      // Booting up as it comes in (sound/creatures.js).
      ctx.systems.creatureSounds.play('boot', p, { size: 1.2, pitch: 0.9 + i * 0.05 });
    }
    showBanner('TERMINATORS ONLINE', `${T800.squad} of them · only an EMP from the Electric Tornado can stop them`);
    if (S.button) S.button.disabled = true;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateTerminator(dt) {
    if (S.bannerTimer > 0) {
      S.bannerTimer -= dt;
      if (S.bannerTimer <= 0 && S.banner) S.banner.classList.remove('visible');
    }
    if (dt <= 0) return;
    // Smooth Criminal (engine/smoothCriminal.js): they stand where they are.
    const peace = !!(ctx.systems.smoothCriminal && ctx.systems.smoothCriminal.peace());
    for (const unit of S.units) {
      // Frozen (engine/effects/freeze.js): stands in its block of ice.
      if (unit.phase === 'walking' && !peace && !ctx.systems.enemies.getState(unit, 'frozen')) api.walk(unit, dt);
      else if (unit.phase === 'dying') api.die(unit, dt);
    }
  }

  /** @returns {THREE.Vector3[]} where each one still standing is */
  function positions() {
    const out = [];
    for (const unit of S.units) if (unit.phase === 'walking' || unit.phase === 'dying') out.push(unit.root.position);
    return out;
  }

  /** @returns {void} */
  function resetTerminator() {
    removeUnits();
    S.bannerTimer = 0;
    if (S.banner) S.banner.classList.remove('visible');
    if (S.button) S.button.disabled = false;
  }

  /** @returns {void} */
  function disposeTerminator() {
    resetTerminator();
    if (S.banner && S.banner.parentNode) S.banner.parentNode.removeChild(S.banner);
    S.banner = null;
    S.button = null;
  }

  return {
    initTerminator, updateTerminator, spawnTerminator, empSweep: api.empSweep, positions,
    nearestWalking: api.nearestWalking, takeUnit: api.takeUnit, finishTaken: api.finishTaken, releaseUnit: api.releaseUnit, rayHit: api.rayHit, buildModel: api.buildModel, plasmaHit: api.plasmaHit, bulletHit: api.bulletHit, walkingUnits: api.walkingUnits,
    resetTerminator, disposeTerminator
  };
}
