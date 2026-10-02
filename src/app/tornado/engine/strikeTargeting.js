// @ts-check
import * as THREE from 'three';
import { setOffExplosivesAt } from './explosives.js';
import { ALIENS } from './aliens/config.js';

/**
 * ===========================================================================
 * SECTION F.3 — Lightning strike targeting
 * ===========================================================================
 * The player calls the lightning down (btn-strike). With the tile on, the
 * pointer is a crosshair over the town and a ring on the ground shows where
 * a volley will land; clicking brings STRIKE.volley[0..1] bolts down in quick
 * succession, scattered inside the ring, and holding the button and dragging
 * "paints" the ground -- a new volley wherever the crosshair has moved on to,
 * and every STRIKE.paintEvery seconds while it is held still. Esc or the tile
 * again stands it down. The camera still zooms and pans; only its left-drag
 * orbit is held while painting, since that button is now the trigger.
 *
 * Each bolt is the storm's own (lightning.js strikeAt: the bolt, the flash
 * and the thunder, a sharp crack close by and a rumble further off), and
 * what it hits is this module's:
 *  - a building it lands on or beside catches fire (buildingFire.js) and
 *    loses a piece;
 *  - people inside STRIKE.killRadius are electrocuted where they stand --
 *    lit up, convulsing, charred and falling (electricStorm.js electrocute);
 *  - any of the aliens' crew it lands on or beside burns (aliens.js
 *    boltKill);
 *  - a hunter ship it lands under (inside its disc, seen from above) takes
 *    a bolt's worth of hull through the enemy register (hunterShip);
 *  - a Terminator it lands on shorts out as if an EMP had reached it
 *    (terminator.js / heroMode.js empSweep);
 *  - trees are blown out of the ground, cars flipped, power lines faulted,
 *    and a scorch mark is left on the ground.
 * Afterwards the air hums: an electrical buzz (sound/empHum.js, shared with
 * the EMP-charged funnel) that builds with each strike and dies away over a
 * few seconds.
 *
 * Works storm or no storm, but not in Hero Mode, whose mouse is Roger's.
 * Hero Mode has its own way in: Roger's railgun (engine/heroWeapons.js)
 * calls one bolt at a time down where its sights land, through boltAt.
 */

const STRIKE = {
  volley: [3, 5],          // bolts per click
  spacing: [0.08, 0.2],    // seconds between two bolts of a volley
  spread: 7,               // radius of the ring they land in
  paintEvery: 0.45,        // seconds between volleys while held still
  paintStep: 9,            // world units the crosshair moves for a new volley
  power: [0.8, 1],
  buildingReach: 2.5,      // beyond a footprint's edge, still a hit
  buildingEnergy: 1500,    // damage.js impact scale: a piece off
  killRadius: 4,
  treeRadius: 3,
  treeEnergy: 900,
  carRadius: 3,
  carEnergy: 400,
  empRadius: 5,            // a Terminator this close is shorted out
  alienRadius: 5,          // one of the aliens' crew this close burns
  faultRadius: 6,
  score: 40,
  // The hum after: added per strike, decayed per second, 0..1.
  humPerStrike: 0.35,
  humDecay: 0.22,
  scorchMax: 32,
  scorchSeconds: 40
};

/**
 * @param {Object} ctx
 * @returns {{
 *   initStrikeTargeting: () => void,
 *   updateStrikeTargeting: (dt: number) => void,
 *   humLevel: () => number,
 *   boltAt: (x: number, z: number) => void,
 *   resetStrikeTargeting: () => void,
 *   disposeStrikeTargeting: () => void
 * }}
 */
export function createStrikeTargetingSystem(ctx) {
  const { Sim, container } = ctx;

  const state = {
    on: false,
    painting: false,
    paintTimer: 0,
    hum: 0,
    hasPoint: false,
    // Where the last volley was called, for painting.
    lastX: 0,
    lastZ: 0
  };
  /** @type {{x: number, z: number, delay: number, roger?: boolean}[]} bolts queued by volleys, or by Roger's railgun (roger) */
  const queue = [];
  /** @type {{mesh: THREE.Mesh, age: number}[]} */
  const scorches = [];
  /** @type {THREE.Mesh|null} the ring on the ground under the crosshair */
  let reticle = null;
  /** @type {THREE.CircleGeometry|null} */
  let scorchGeo = null;
  /** @type {HTMLButtonElement|null} */
  let button = null;
  /** @type {any} the register's hunterShip kind, found on the first bolt */
  let hunterKind = null;
  const point = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  /** @type {Object<string, (e: Event) => void>} */
  const handlers = {};

  /** @returns {void} */
  function initStrikeTargeting() {
    const ringGeo = new THREE.RingGeometry(STRIKE.spread - 0.5, STRIKE.spread, 48);
    ringGeo.rotateX(-Math.PI / 2);
    reticle = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.9, 1.6, 3), transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
    }));
    reticle.name = 'strike_reticle';
    reticle.visible = false;
    reticle.renderOrder = 3;
    Sim.three.scene.add(reticle);
    scorchGeo = new THREE.CircleGeometry(1, 20);
    scorchGeo.rotateX(-Math.PI / 2);

    button = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-strike'));
    if (button) button.addEventListener('click', () => setTargeting(!state.on), { signal: ctx.signal });

    const canvas = Sim.three.renderer.domElement;
    handlers.pointermove = (/** @type {PointerEvent} */ e) => {
      if (state.on) aimAt(e.clientX, e.clientY);
    };
    handlers.pointerdown = (/** @type {PointerEvent} */ e) => {
      if (!state.on || e.button !== 0) return;
      aimAt(e.clientX, e.clientY);
      if (!state.hasPoint) return;
      state.painting = true;
      callVolley(point.x, point.z);
    };
    handlers.pointerup = () => { state.painting = false; };
    handlers.keydown = (/** @type {KeyboardEvent} */ e) => {
      if (state.on && e.code === 'Escape') setTargeting(false);
    };
    canvas.addEventListener('pointermove', handlers.pointermove, { signal: ctx.signal });
    canvas.addEventListener('pointerdown', handlers.pointerdown, { signal: ctx.signal });
    window.addEventListener('pointerup', handlers.pointerup, { signal: ctx.signal });
    window.addEventListener('keydown', handlers.keydown, { signal: ctx.signal });
  }

  /**
   * On or off: the crosshair cursor, the ring, the tile lit, and the
   * camera's left-drag orbit held while it is on.
   * @param {boolean} on
   * @returns {void}
   */
  function setTargeting(on) {
    if (on && ctx.Hero && ctx.Hero.active) return;
    state.on = on;
    state.painting = false;
    state.hasPoint = false;
    Sim.three.controls.enableRotate = !on;
    container.classList.toggle('strike-aim', on);
    if (reticle) reticle.visible = false;
    if (button) {
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  /**
   * The ground point under the pointer, into `point`.
   * @param {number} clientX
   * @param {number} clientY
   * @returns {void}
   */
  function aimAt(clientX, clientY) {
    const rect = Sim.three.renderer.domElement.getBoundingClientRect();
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, Sim.three.camera);
    state.hasPoint = !!raycaster.ray.intersectPlane(ground, point);
  }

  /**
   * Queues one volley: several bolts in quick succession inside the ring.
   * @param {number} x
   * @param {number} z
   * @returns {void}
   */
  function callVolley(x, z) {
    state.lastX = x;
    state.lastZ = z;
    state.paintTimer = STRIKE.paintEvery;
    const n = STRIKE.volley[0] + Math.floor(Math.random() * (STRIKE.volley[1] - STRIKE.volley[0] + 1));
    let delay = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * STRIKE.spread;
      queue.push({ x: x + Math.cos(a) * r, z: z + Math.sin(a) * r, delay });
      delay += STRIKE.spacing[0] + Math.random() * (STRIKE.spacing[1] - STRIKE.spacing[0]);
    }
  }

  /**
   * One bolt landing, and everything it does there.
   * @param {number} x
   * @param {number} z
   * @param {boolean} [roger] Roger's own bolt (the railgun): a hunter it stops is his kill
   * @returns {void}
   */
  function strike(x, z, roger = false) {
    const s = ctx.systems;
    const at = new THREE.Vector3(x, 0, z);
    const power = STRIKE.power[0] + Math.random() * (STRIKE.power[1] - STRIKE.power[0]);
    s.lightning.strikeAt(at, power);
    s.explosions.spawnImpactBurst(new THREE.Vector3(x, 0.8, z), 0.7);
    const { damageFromImpact, addDamageScore } = s.damage;

    // Buildings: on or right beside one, it catches.
    for (const building of ctx.Environment.buildings) {
      if (building.damageState === 'collapsed') continue;
      const p = building.mesh.position;
      const fp = building.mesh.userData.footprint;
      const hx = (fp ? fp.width / 2 : 3) + STRIKE.buildingReach;
      const hz = (fp ? fp.depth / 2 : 3) + STRIKE.buildingReach;
      if (Math.abs(x - p.x) > hx || Math.abs(z - p.z) > hz) continue;
      if (s.buildingFire) s.buildingFire.igniteBuilding(building);
      damageFromImpact(building, new THREE.Vector3(x, (building.mesh.userData.wallHeight || 6) * 0.8, z), STRIKE.buildingEnergy);
    }

    // People: electrocuted where they stand.
    if (s.electricStorm) {
      for (const person of ctx.Environment.people.slice()) {
        if (!person.mesh.parent || person.electrocuted || person.abducted || person.inChasm) continue;
        const q = person.mesh.position;
        if (Math.hypot(q.x - x, q.z - z) < STRIKE.killRadius && q.y < 4) s.electricStorm.electrocute(person);
      }
    }

    // Trees out of the ground, cars over. A copy: nothing here should
    // splice Sim.objects, but a hit that does must not skip the next one.
    for (const obj of Sim.objects.slice()) {
      if (obj.type !== 'tree' && obj.type !== 'car') continue;
      const q = obj.mesh && obj.mesh.position;
      if (!q) continue;
      const d = Math.hypot(q.x - x, q.z - z);
      if (obj.type === 'tree' && d < STRIKE.treeRadius) damageFromImpact(obj, q, STRIKE.treeEnergy);
      else if (obj.type === 'car' && d < STRIKE.carRadius) damageFromImpact(obj, at, STRIKE.carEnergy);
    }

    // The aliens: a bolt on one of the crew burns it (aliens.js boltKill) --
    // the Lightning tile's and Roger's railgun's alike.
    if (s.aliens) {
      const burnt = s.aliens.boltKill(x, z, STRIKE.alienRadius);
      if (burnt) addDamageScore(STRIKE.score * burnt);
    }

    // The hunter ships: a bolt lands on the ground, so a hunter overhead is
    // hit by its disc seen from above, not the crew's 5 m. One hit each.
    // (The T-Rex and Patient Zero accept 'bolt' but are never sent one here.)
    if (s.enemies) {
      if (!hunterKind) hunterKind = s.enemies.kinds().find((/** @type {{kind: string}} */ k) => k.kind === 'hunterShip') || null;
      if (hunterKind) {
        const reach = 15 * ALIENS.hunterScale;
        for (const h of hunterKind.list()) {
          const p = hunterKind.position(h);
          if (Math.hypot(p.x - x, p.z - z) < reach && s.enemies.hit(h, hunterKind, { type: 'bolt', at: { x, z } }) && roger) {
            // Only a hit that downs it: breaks Smooth Criminal's spell, as the minigun's does.
            ctx.events.emit('rogerKill');
          }
        }
      }
    }

    // The Terminators: a bolt on one is an EMP to it.
    if (s.terminator) s.terminator.empSweep(x, z, STRIKE.empRadius);
    ctx.events.emit('empPulse', { x, z, radius: STRIKE.empRadius });

    // Power lines, and a bolt on the tanker, the chemical works or a gas main
    // sets it off (engine/explosives.js).
    setOffExplosivesAt(ctx, x, z, STRIKE.faultRadius);
    addDamageScore(STRIKE.score);
    addScorch(x, z);
    state.hum = Math.min(1, state.hum + STRIKE.humPerStrike);
  }

  /**
   * A burnt patch where a bolt landed, fading over STRIKE.scorchSeconds;
   * the oldest is reused once there are STRIKE.scorchMax.
   * @param {number} x
   * @param {number} z
   * @returns {void}
   */
  function addScorch(x, z) {
    let entry = scorches.length >= STRIKE.scorchMax ? scorches.shift() : null;
    if (!entry) {
      const mesh = new THREE.Mesh(scorchGeo, new THREE.MeshBasicMaterial({
        color: 0x0a0806, transparent: true, opacity: 0.7, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
      }));
      mesh.name = 'strike_scorch';
      Sim.three.scene.add(mesh);
      entry = { mesh, age: 0 };
    }
    entry.age = 0;
    entry.mesh.position.set(x, 0.026, z);
    entry.mesh.scale.setScalar(1.2 + Math.random() * 1.3);
    entry.mesh.visible = true;
    scorches.push(entry);
  }

  /**
   * Per frame, not while paused: the queued bolts, painting, the ring, the
   * scorches fading and the hum dying away.
   * @param {number} dt
   * @returns {void}
   */
  function updateStrikeTargeting(dt) {
    if (state.on && ctx.Hero && ctx.Hero.active) setTargeting(false);

    for (let i = queue.length - 1; i >= 0; i--) {
      queue[i].delay -= dt;
      if (queue[i].delay > 0) continue;
      const { x, z, roger } = queue[i];
      queue.splice(i, 1);
      strike(x, z, roger === true);
    }

    if (state.on && reticle) {
      reticle.visible = state.hasPoint;
      if (state.hasPoint) {
        reticle.position.set(point.x, 0.06, point.z);
        reticle.material.opacity = 0.55 + 0.3 * Math.sin(performance.now() * 0.012);
      }
      if (state.painting && state.hasPoint) {
        state.paintTimer -= dt;
        const moved = Math.hypot(point.x - state.lastX, point.z - state.lastZ);
        if (moved >= STRIKE.paintStep || state.paintTimer <= 0) callVolley(point.x, point.z);
      }
    }

    for (const entry of scorches) {
      if (!entry.mesh.visible) continue;
      entry.age += dt;
      const u = entry.age / STRIKE.scorchSeconds;
      entry.mesh.material.opacity = 0.7 * Math.max(0, 1 - u);
      if (u >= 1) entry.mesh.visible = false;
    }

    state.hum = Math.max(0, state.hum - STRIKE.humDecay * dt);
  }

  /**
   * One bolt, straight down on (x, z) -- no volley, no scatter: Roger's
   * railgun (engine/heroWeapons.js), a bolt per pull of the trigger.
   * @param {number} x
   * @param {number} z
   * @returns {void}
   */
  function boltAt(x, z) {
    queue.push({ x, z, delay: 0, roger: true });
  }

  /**
   * The aftermath hum's level, 0..1, which empCharge.js mixes into the
   * shared electrical hum (sound/empHum.js).
   * @returns {number}
   */
  function humLevel() {
    return state.hum;
  }

  /** @returns {void} */
  function resetStrikeTargeting() {
    setTargeting(false);
    queue.length = 0;
    hunterKind = null;
    state.hum = 0;
    for (const entry of scorches) entry.mesh.visible = false;
  }

  /** @returns {void} */
  function disposeStrikeTargeting() {
    resetStrikeTargeting();
    const canvas = Sim.three.renderer && Sim.three.renderer.domElement;
    if (canvas) {
      if (handlers.pointermove) canvas.removeEventListener('pointermove', handlers.pointermove);
      if (handlers.pointerdown) canvas.removeEventListener('pointerdown', handlers.pointerdown);
    }
    if (handlers.pointerup) window.removeEventListener('pointerup', handlers.pointerup);
    if (handlers.keydown) window.removeEventListener('keydown', handlers.keydown);
    for (const entry of scorches) {
      Sim.three.scene.remove(entry.mesh);
      entry.mesh.material.dispose();
    }
    scorches.length = 0;
    if (reticle) {
      Sim.three.scene.remove(reticle);
      reticle.geometry.dispose();
      reticle.material.dispose();
    }
    if (scorchGeo) scorchGeo.dispose();
    reticle = null;
    scorchGeo = null;
    button = null;
  }

  return { initStrikeTargeting, updateStrikeTargeting, humLevel, boltAt, resetStrikeTargeting, disposeStrikeTargeting };
}
