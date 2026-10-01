import * as THREE from 'three';
import { bannerHost } from '../../utils/banners.js';
import { firstBlockAhead, roadBlockAt } from './blockers.js';
import { setOffExplosivesAt } from '../explosives.js';
import { BLAST_SIZE } from '../player/energy.js';

/**
 * ===========================================================================
 * SECTION D.9 — Fuel tanker
 * ===========================================================================
 * One petrol tanker on the ring road, and the single biggest explosion in the
 * simulation when it goes. The fuel station is a fixed building the storm
 * has to happen to reach; this is a rolling one that comes to the storm, and it detonates on a
 * fuse rather than on luck, so every run gets the moment.
 *
 * It goes up on TANKER.fuse seconds into the run, and only then. That is
 * deliberate rather than lazy: letting the storm take it early was tried and
 * measured, and at the EF5 preset the funnel reached it within four
 * sim-seconds every time, so the set piece fired before the player had
 * settled and the twenty-second beat never existed. Until the fuse the truck
 * is `rooted`, which is the same flag a standing tree uses to sit out the
 * physics pass -- so the vortex cannot pick it up or shove it early, and the
 * detonation lands when it is meant to.
 *
 * The detonation itself is deliberately out of scale with everything else:
 * a fireball at TANKER.blastStrength against a building collapse's 1.7,
 * (the burst system's ceiling was raised from 2 to 8 for exactly this), a
 * ring of buildings set alight, every nearby car and person thrown, and the
 * heaviest single screen shake the game-feel layer will produce.
 *
 * It drives like something solid (environment/blockers.js): it looks down
 * the ring road ahead of its bumper every frame and brakes to a stop in front
 * of a building, rubble, a landed ship or a vehicle in the road, and waits
 * there until the way clears -- several buildings stand on the ring, so in
 * practice it runs until the first of them and parks. It used to drive
 * straight through all of it, and sideways (its heading was the ring's
 * radius, not its tangent). It starts on a clear stretch. Stopped for a
 * vehicle, it gives way (userData.yielding): the train, which would
 * otherwise wait for it in turn, goes first.
 *
 * Roger can set it off from Hero Mode: any plasma shot on the tank
 * (heroMode.js traceAim, via tankerTarget). It is on the minimap as a
 * long orange truck.
 *
 * Four more, on request, stand parked out towards the four edges of town --
 * north, south, east and west, on the long streets (TANKER.parked) -- well
 * inside the map and well away from the ring road the first one drives.
 * They have no fuse: each goes up, with the same blast as the first, when a
 * funnel reaches it, when anything else violent enough happens next to it
 * (engine/explosives.js: a meteor, a ship coming down, a lightning bolt, a
 * mega beam, another tanker or the chemical works going up), or when Roger
 * shoots it. They are on the minimap as orange trucks too.
 */

const TANKER = {
  // Seconds into a run before it blows, if nothing has got to it first.
  fuse: 20,
  // Where it drives: the ring road, which passes through the built-up part of
  // town so the blast has something to catch.
  radius: 48.5,
  speed: 0.12,                 // radians/sec around the ring
  accel: 0.08,                 // radians/sec^2, speeding up and braking
  // Looking ahead of the bumper for something in the road (blockers.js):
  // over this stretch, sampled this finely, with this much room either side
  // of its own half-width; it stops `stopGap` short of what it finds.
  lookAhead: 14,
  lookStep: 1.5,
  sideRoom: 0.4,
  stopGap: 2,
  // Body.
  cabLength: 2.6,
  cabHeight: 2.2,
  cabWidth: 2.4,
  tankLength: 7.5,
  tankRadius: 1.35,
  wheelRadius: 0.55,
  cabColour: 0xb8322a,
  tankColour: 0xd8d5cf,
  trimColour: 0x1b1c1f,
  // The blast.
  // Six times the blast it started as (strength 7, radii 42/38) -- tripled,
  // then doubled again on request.
  blastStrength: 42,           // vs 1.7 for a building collapse
  satellites: 14,
  satelliteSpread: 84,
  fireRadius: 110,             // buildings set alight
  throwRadius: 170,            // cars and people thrown
  throwForce: 80,
  buildingShock: 7,            // at the centre, falling off to the edge
  score: 2500,
  bannerSeconds: 3.2,
  // The four parked ones: where each stands and which way it points (along
  // the street it is on -- 0 along +X, PI/2 along +Z). 118 out is inside
  // the town's edge (people wander to 128, the backdrop starts at 132) and
  // seventy units past the ring road the first one drives.
  parked: [
    { name: 'NORTH', x: 30, z: -118, yaw: Math.PI / 2 },
    { name: 'SOUTH', x: -30, z: 118, yaw: Math.PI / 2 },
    { name: 'EAST', x: 118, z: 8, yaw: 0 },
    { name: 'WEST', x: -118, z: -8, yaw: 0 }
  ],
  // A funnel this far past its capture edge sets a parked one off.
  parkedReach: 1
};

/**
 * @param {Object} ctx
 * @returns {{
 *   initTanker: () => void,
 *   updateTanker: (dt: number) => void,
 *   detonate: () => void,
 *   tankerPosition: () => THREE.Vector3|null,
 *   tankerMarker: () => {x: number, z: number, heading: number}|null,
 *   tankerTarget: () => {x: number, z: number, radius: number, top: number, detonate: () => void}[]|null,
 *   allTankers: () => {x: number, z: number, detonate: () => void}[],
 *   parkedMarkers: () => {x: number, z: number, heading: number}[],
 *   resetTanker: () => void,
 *   disposeTanker: () => void
 * }}
 */
export function createTankerSystem(ctx) {
  const { Sim, nextObjectId } = ctx;

  /** @type {THREE.Group|null} */
  let group = null;
  /** @type {SimObject|null} */
  let truck = null;
  let angle = 0;
  let blown = false;
  let bannerTimer = 0;
  /** @type {HTMLDivElement|null} */
  let banner = null;
  /** @type {THREE.Material[]} */
  const materials = [];
  // Radians/sec it is doing right now: TANKER.speed, or less while braking.
  let speed = 0;
  // The truck, back bumper to front, along its local +X (buildTruck): the
  // tank's rear at -tankLength/2, the cab's nose tankLength/2 + cabLength on.
  const rear = -TANKER.tankLength / 2;
  const front = TANKER.tankLength / 2 + TANKER.cabLength;
  const box = { cx: (front + rear) / 2, hl: (front - rear) / 2, hw: TANKER.cabWidth / 2 };
  /** @type {Set<Object>} */
  const self = new Set();
  /**
   * The four parked tankers (TANKER.parked).
   * @type {{def: Object, obj: SimObject, blown: boolean}[]}
   */
  let parked = [];

  /**
   * @param {string} title
   * @param {string} sub
   * @returns {void}
   */
  function showBanner(title, sub) {
    if (!banner) return;
    banner.querySelector('.title').textContent = title;
    banner.querySelector('.sub').textContent = sub;
    banner.classList.add('visible');
    bannerTimer = TANKER.bannerSeconds;
  }

  /**
   * Builds the truck: a cab, a cylindrical tank and six wheels, in the same
   * low-poly idiom as the cars (environment/cars.js) but unmistakably bigger,
   * so it reads as worth worrying about before it goes off.
   * @returns {THREE.Group}
   */
  function buildTruck() {
    const root = new THREE.Group();
    root.name = 'fuelTanker';

    const cabMat = new THREE.MeshStandardMaterial({ color: TANKER.cabColour, roughness: 0.55, metalness: 0.3 });
    const tankMat = new THREE.MeshStandardMaterial({ color: TANKER.tankColour, roughness: 0.35, metalness: 0.6 });
    const trimMat = new THREE.MeshStandardMaterial({ color: TANKER.trimColour, roughness: 0.9 });
    materials.push(cabMat, tankMat, trimMat);

    // The truck points along its local +X, matching the heading maths below.
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(TANKER.cabLength, TANKER.cabHeight, TANKER.cabWidth), cabMat
    );
    cab.position.set(TANKER.tankLength / 2 + TANKER.cabLength / 2, TANKER.cabHeight / 2 + TANKER.wheelRadius, 0);
    cab.castShadow = true;
    root.add(cab);

    const tank = new THREE.Mesh(
      new THREE.CylinderGeometry(TANKER.tankRadius, TANKER.tankRadius, TANKER.tankLength, 12), tankMat
    );
    tank.rotation.z = Math.PI / 2;
    tank.position.set(0, TANKER.tankRadius + TANKER.wheelRadius + 0.3, 0);
    tank.castShadow = true;
    root.add(tank);

    // Chassis rail under the tank, so it does not appear to float.
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(TANKER.tankLength + TANKER.cabLength, 0.3, TANKER.cabWidth * 0.7), trimMat
    );
    rail.position.set(TANKER.cabLength / 2, TANKER.wheelRadius + 0.15, 0);
    root.add(rail);

    const wheelGeo = new THREE.CylinderGeometry(TANKER.wheelRadius, TANKER.wheelRadius, 0.45, 10);
    wheelGeo.rotateX(Math.PI / 2);
    for (const wx of [-TANKER.tankLength / 2 + 0.6, 0.4, TANKER.tankLength / 2 + 1.2]) {
      for (const wz of [-TANKER.cabWidth / 2, TANKER.cabWidth / 2]) {
        const wheel = new THREE.Mesh(wheelGeo, trimMat);
        wheel.position.set(wx, TANKER.wheelRadius, wz);
        root.add(wheel);
      }
    }
    return root;
  }

  /**
   * The ground point `along` units down the ring from the angle `from`.
   * @param {number} from radians
   * @param {number} along world units
   * @returns {{x: number, z: number}}
   */
  function ringPoint(from, along) {
    const a = from + along / TANKER.radius;
    return { x: Math.cos(a) * TANKER.radius, z: Math.sin(a) * TANKER.radius };
  }

  /**
   * A stretch of the ring nothing stands on, the truck's own length and a
   * look-ahead's worth of room, so it does not start inside a building (a
   * random one on the ring road often did) or nose to nose with one.
   * @returns {number} radians
   */
  function clearStart() {
    let best = Math.random() * Math.PI * 2;
    for (let attempt = 0; attempt < 48; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const blocked = firstBlockAhead(ctx, (along) => ringPoint(a, along), rear - 1, front + TANKER.lookAhead, TANKER.lookStep,
        box.hw + TANKER.sideRoom, self);
      if (blocked === Infinity) return a;
      if (attempt === 0) best = a;
    }
    return best;
  }

  /**
   * Puts the truck at `angle` on the ring, pointing along it.
   * @param {number} radPerSec how fast it is going round, for `velocity`
   * @returns {void}
   */
  function place(radPerSec) {
    const x = Math.cos(angle) * TANKER.radius;
    const z = Math.sin(angle) * TANKER.radius;
    truck.mesh.position.set(x, 0, z);
    // Its nose (local +X) along the ring's tangent (-sin, cos): three.js yaw
    // takes +X to (cos y, -sin y), so y = -angle - PI/2. Just -angle pointed
    // it out along the radius, and it drove round the ring sideways.
    truck.mesh.rotation.y = -angle - Math.PI / 2;
    const v = radPerSec * TANKER.radius;
    truck.velocity.set(-Math.sin(angle) * v, 0, Math.cos(angle) * v);
  }

  /** @returns {void} */
  function initTanker() {
    group = new THREE.Group();
    group.name = 'tanker';
    Sim.three.scene.add(group);

    const mesh = buildTruck();
    group.add(mesh);

    /** @type {SimObject} */
    truck = {
      id: nextObjectId.value++,
      type: 'car',
      mesh,
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
      // Heavier than a car, so only a strong storm lifts it -- but when one
      // does, that is the detonation.
      mass: 9,
      drag: 0.5,
      // Sits out physics until the fuse (see the note above).
      rooted: true,
      damageState: 'intact',
      breakThreshold: Infinity,
      liftEligible: 0.45,
      pooled: false,
      poolIndex: -1,
      lifeTimer: 0,
      captureState: 'grounded'
    };
    mesh.userData.simObject = truck;
    mesh.userData.parked = false;
    // Its own shape for the others that stop in front of it (blockers.js).
    mesh.userData.blockBox = box;
    mesh.userData.yielding = false;
    self.clear();
    self.add(truck);
    // The parked four, before the first picks its clear start, so it does
    // not start inside one of them.
    parked = TANKER.parked.map((def) => {
      const body = buildTruck();
      group.add(body);
      body.position.set(def.x, 0, def.z);
      // Local +X along the street: yaw 0 is +X, and -PI/2 turns it to +Z.
      body.rotation.y = -def.yaw;
      /** @type {SimObject} */
      const obj = {
        id: nextObjectId.value++,
        type: 'car',
        mesh: body,
        velocity: new THREE.Vector3(),
        angularVelocity: new THREE.Vector3(),
        mass: 9,
        drag: 0.5,
        // Never moved by the physics: it is set off, not blown about.
        rooted: true,
        damageState: 'intact',
        breakThreshold: Infinity,
        liftEligible: 0.45,
        pooled: false,
        poolIndex: -1,
        lifeTimer: 0,
        captureState: 'grounded'
      };
      body.userData.simObject = obj;
      body.userData.parked = false;
      body.userData.blockBox = box;
      body.userData.yielding = false;
      Sim.objects.push(obj);
      return { def, obj, blown: false };
    });
    angle = clearStart();
    speed = 0;
    place(0);
    Sim.objects.push(truck);
    blown = false;

    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'tanker-banner';
      banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
      bannerHost(ctx.container).appendChild(banner);
    }
  }

  /**
   * Everything the blast does, in one place: the fireball, the fires it
   * starts, what it throws, and the fanfare.
   * @returns {void}
   */
  function detonate() {
    if (blown || !truck) return;
    blown = true;
    blast(truck, 'TANKER EXPLOSION!', `Fuel truck detonated · +${TANKER.score} bonus`);
  }

  /**
   * One of the parked four going up.
   * @param {{def: Object, obj: SimObject, blown: boolean}} entry
   * @returns {void}
   */
  function detonateParked(entry) {
    if (entry.blown) return;
    entry.blown = true;
    blast(entry.obj, `${entry.def.name} TANKER EXPLODES!`, `Parked fuel truck detonated · +${TANKER.score} bonus`);
  }

  /**
   * The blast, whichever truck it is.
   * @param {SimObject} body the truck going up
   * @param {string} title
   * @param {string} sub
   * @returns {void}
   */
  function blast(body, title, sub) {
    const at = body.mesh.position.clone();
    at.y += TANKER.tankRadius + TANKER.wheelRadius;

    // The fireball, plus a couple of offset secondaries so the blast reads as
    // wider than a single sphere.
    ctx.systems.explosions.spawnImpactBurst(at, TANKER.blastStrength);
    // public/sounds/large-explosion.wav, never skipped and a notch louder.
    ctx.systems.cues.playLargeExplosion({ priority: true, gain: 1.5 });
    ctx.systems.lightning.flashScreen(at, 1, '#ffd9a0');
    for (let i = 0; i < TANKER.satellites; i++) {
      const spread = new THREE.Vector3(
        at.x + (Math.random() - 0.5) * TANKER.satelliteSpread,
        at.y + Math.random() * 48,
        at.z + (Math.random() - 0.5) * TANKER.satelliteSpread
      );
      ctx.systems.explosions.spawnImpactBurst(spread, TANKER.blastStrength * (0.3 + Math.random() * 0.25));
    }

    // Sets the neighbourhood alight. Only a fireball, a shockwave, debris,
    // smoke and fires: it never lights the funnel directly (that drew a
    // free-standing flame tornado with no storm about). A funnel that then
    // passes through the fires it started catches them (firenado.js).
    ctx.systems.buildingFire.igniteNear(at.x, at.z, TANKER.fireRadius);
    // A tanker goes off in the street, which is exactly where the mains are
    // (engine/gasMains.js): the fire runs off down the road from here -- and
    // the chemical works goes too if it is in reach (engine/explosives.js).
    setOffExplosivesAt(ctx, at.x, at.z, TANKER.fireRadius * 0.6);

    // Throws everything loose nearby, away from the blast.
    for (const obj of Sim.objects) {
      if (obj === body || obj.type === 'building' || obj.rooted) continue;
      const pos = obj.pooled ? obj.position : (obj.mesh && obj.mesh.position);
      if (!pos) continue;
      const d = Math.hypot(pos.x - at.x, pos.z - at.z);
      if (d > TANKER.throwRadius) continue;
      const falloff = 1 - d / TANKER.throwRadius;
      const dir = new THREE.Vector3(pos.x - at.x, 0, pos.z - at.z);
      if (dir.lengthSq() < 1e-6) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      dir.normalize().multiplyScalar(TANKER.throwForce * falloff);
      obj.velocity.add(dir);
      obj.velocity.y += TANKER.throwForce * falloff * 0.6;
      obj.angularVelocity.set(
        (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9
      );
      if (obj.type === 'car' && obj.damageState === 'intact') obj.damageState = 'tipped';
    }

    // Brings down whatever was standing next to it, by the same rules a
    // neighbouring collapse uses.
    const { shockBuilding, addDamageScore } = ctx.systems.damage;
    if (shockBuilding && ctx.Environment) {
      for (const building of ctx.Environment.buildings) {
        const p = building.mesh.position;
        const d = Math.hypot(p.x - at.x, p.z - at.z);
        if (d > TANKER.throwRadius) continue;
        shockBuilding(building, TANKER.buildingShock * (1 - d / TANKER.throwRadius), at);
      }
    }

    ctx.systems.gamefeel.event('tanker', at);
    // Roger standing near it takes energy (engine/player/energy.js), and the
    // cars parked round it go up after it (engine/fuelFire.js).
    ctx.events.emit('explosion', { x: at.x, z: at.z, size: BLAST_SIZE.tanker, source: body });
    if (ctx.systems.fuelFire) ctx.systems.fuelFire.blowCarsNear(at.x, at.z, 1);
    if (ctx.systems.backdrop) ctx.systems.backdrop.damageAt(at.x, at.z, TANKER.throwRadius * 0.7);
    addDamageScore(TANKER.score);
    showBanner(title, sub);

    // The truck itself is gone.
    body.mesh.visible = false;
    const idx = Sim.objects.indexOf(body);
    if (idx !== -1) Sim.objects.splice(idx, 1);
  }

  /**
   * The parked four: a funnel reaching one sets it off.
   * @returns {void}
   */
  function updateParked() {
    if (!Sim.state.running) return;
    for (const entry of parked) {
      if (entry.blown) continue;
      const p = entry.obj.mesh.position;
      const v = ctx.tornadoes.nearest(p.x, p.z);
      if (!v || !(v.birth > 0.5) || v.neutralized) continue;
      const edge = Sim.params.radius * ctx.systems.physics.CAPTURE_TUNE.edgeRadiusFactor * (v.sizeMul || 1) * TANKER.parkedReach;
      if (Math.hypot(p.x - v.center.x, p.z - v.center.z) < edge) detonateParked(entry);
    }
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateTanker(dt) {
    if (!group) return;

    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }
    updateParked();
    if (blown || !truck) return;

    if (Sim.state.running && Sim.state.elapsed >= TANKER.fuse) { detonate(); return; }

    // Drives the ring road until then. Kinematic like the train and the
    // viaduct traffic, with `velocity` kept live so the vortex blends its
    // pull into real motion on the frame it takes hold -- braking for
    // whatever is in the road ahead (blockers.js) and waiting there.
    const ahead = firstBlockAhead(ctx, (along) => ringPoint(angle, front + along), 0, TANKER.lookAhead, TANKER.lookStep,
      box.hw + TANKER.sideRoom, self);
    let want = TANKER.speed;
    if (ahead !== Infinity) {
      want *= Math.min(1, Math.max(0, (ahead - TANKER.stopGap) / (TANKER.lookAhead - TANKER.stopGap)));
      if (ahead <= TANKER.stopGap) want = 0;
    }
    // Gives way when it is a vehicle it has stopped for (see the header).
    let yielding = false;
    if (want === 0) {
      const at = ringPoint(angle, front + ahead);
      yielding = roadBlockAt(ctx, at.x, at.z, box.hw + TANKER.sideRoom, self) === 'vehicle';
    }
    truck.mesh.userData.yielding = yielding;
    const step = TANKER.accel * dt;
    speed = want === 0 ? 0 : speed + Math.max(-step * 3, Math.min(step, want - speed));
    angle += speed * dt;
    place(speed);
  }

  /** @returns {void} */
  function resetTanker() {
    disposeTanker();
    initTanker();
  }

  /** @returns {void} */
  function disposeTanker() {
    if (!group) return;
    for (const obj of [truck, ...parked.map(e => e.obj)]) {
      if (!obj) continue;
      const idx = Sim.objects.indexOf(obj);
      if (idx !== -1) Sim.objects.splice(idx, 1);
    }
    parked = [];
    group.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
    });
    for (const mat of materials) mat.dispose();
    materials.length = 0;
    Sim.three.scene.remove(group);
    group = null;
    truck = null;
    blown = false;
  }

  /**
   * Also takes the banner element with it. Without this the dev-mode double
   * mount (React StrictMode) leaves the dead instance's banner in the
   * container, where it is a permanently empty duplicate of the live one.
   * @returns {void}
   */
  function removeBanner() {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }

  /** @returns {void} */
  function disposeTankerFully() {
    disposeTanker();
    removeBanner();
  }

  /**
   * Where the truck is, while it is still a truck. Read by the emergency
   * fleet (engine/emergency/vehicles.js), which brakes for it -- and which
   * sets it off if the truck runs into one of them. Null once it has gone up.
   * @returns {THREE.Vector3|null}
   */
  function tankerPosition() {
    return truck && truck.mesh && truck.mesh.parent && truck.damageState === 'intact'
      ? truck.mesh.position
      : null;
  }

  /**
   * For the minimap: where it is and which way it faces (the minimap's
   * convention, forward = (sin, cos) of the heading). Null once it has gone up.
   * @returns {{x: number, z: number, heading: number}|null}
   */
  function tankerMarker() {
    const p = tankerPosition();
    return p ? { x: p.x, z: p.z, heading: -angle } : null;
  }

  /**
   * For Roger's sights (heroMode.js): the tank and the cab, each an upright
   * cylinder standing on the road. Null once it has gone up.
   * @returns {{x: number, z: number, radius: number, top: number}[]|null}
   */
  function tankerTarget() {
    const out = [];
    const top = TANKER.tankRadius * 2 + TANKER.wheelRadius + 0.5;
    /**
     * @param {THREE.Object3D} mesh
     * @param {() => void} fire
     * @returns {void}
     */
    const parts = (mesh, fire) => {
      const p = mesh.position;
      const ry = mesh.rotation.y;
      // Local +X in the world.
      const fx = Math.cos(ry);
      const fz = -Math.sin(ry);
      for (const along of [-2, 1.5, front - TANKER.cabLength / 2]) {
        out.push({ x: p.x + fx * along, z: p.z + fz * along, radius: TANKER.tankRadius + 0.4, top, detonate: fire });
      }
    };
    if (tankerPosition() && !blown) parts(truck.mesh, detonate);
    for (const entry of parked) if (!entry.blown) parts(entry.obj.mesh, () => detonateParked(entry));
    return out.length ? out : null;
  }

  /**
   * Every tanker still to go up, the driving one and the parked four, for
   * whatever sets them off (engine/explosives.js).
   * @returns {{x: number, z: number, detonate: () => void}[]}
   */
  function allTankers() {
    const out = [];
    const p = tankerPosition();
    if (p && !blown) out.push({ x: p.x, z: p.z, detonate });
    for (const entry of parked) {
      if (entry.blown) continue;
      const q = entry.obj.mesh.position;
      out.push({ x: q.x, z: q.z, detonate: () => detonateParked(entry) });
    }
    return out;
  }

  /**
   * For the minimap: the parked four still standing.
   * @returns {{x: number, z: number, heading: number}[]}
   */
  function parkedMarkers() {
    return parked.filter(e => !e.blown).map(e => ({ x: e.def.x, z: e.def.z, heading: Math.PI / 2 - e.def.yaw }));
  }

  return {
    initTanker, updateTanker, detonate, tankerPosition, tankerMarker, tankerTarget, allTankers, parkedMarkers,
    resetTanker, disposeTanker: disposeTankerFully
  };
}
