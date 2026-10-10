// @ts-check
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHASE_TUNE } from '../chase/car.js';

/**
 * ---------------------------------------------------------------------
 * Off-road vehicle model (shared by the parked environment cars and the
 * Chase Mode car, since both come from createCar).
 *
 * Silhouette, front to back: an aggressive steel bumper with a winch, wings
 * and a skid plate; a grille set into a squared nose; a hood that falls
 * away towards the nose; a raked cabin with tinted glass; and a short rear
 * tub. The lower body is one extruded side profile with the wheel arches
 * cut into it, so the wheels sit in real openings under flared arches
 * rather than beside a plain box. Mirrors, a roof rack with a light bar,
 * rock sliders and a tailgate spare finish it.
 *
 * Materials are split by what they are, not merged into one colour block:
 *  - body paint: matte, slightly rough, one material per car (its colour);
 *  - glass: dark, glossy, faintly transparent, with a reflection map;
 *  - steel/trim: bumpers, rack, flares, mirrors -- metallic, vertex-coloured
 *    so bright steel and black plastic trim share one draw call;
 *  - rubber: tyres (and the spare), rough and nearly black;
 *  - lenses: unlit, so the chase car's lamps can be driven into HDR and
 *    glow through post.js's bloom while parked cars' stay dark.
 * The metal and glass get a small storm-sky reflection map (see
 * getCarEnvMap); without one, metalness only ever reads as black.
 *
 * Cockpit contract. buildCockpitFixtures (chase/car.js) lays the whole
 * first-person view out from the bounding boxes of the parts tagged
 * carPart 'body' and 'cabin'. The profiles below keep those boxes exactly
 * where the old boxes were -- hood top 1.3, roof 1.9, cabin front wall at
 * z = 0.7 -- so the cockpit framing is unchanged. Every part uses
 * FrontSide rendering, so from the eye point inside the cabin the cabin's
 * own walls and glass are back-faces and are not drawn (see
 * updateCockpitCamera).
 * ---------------------------------------------------------------------
 */

// Muted and practical: utility equipment, not a show car.
const CAR_BODY_COLOURS = [0x6b6f5a, 0x7a6a52, 0x4a5259, 0x5a5f55, 0x6d5b4a, 0x7d5a3c];
const CAR_STEEL_COLOUR = 0x8a9099;
const CAR_TRIM_COLOUR = 0x1c1e22;
const CAR_TYRE_COLOUR = 0x151618;
const CAR_HUB_COLOUR = 0x6a6f78;
const CAR_HEADLAMP_COLOUR = 0xfff1d0;
const CAR_TAILLAMP_COLOUR = 0xd02a1c;
const CAR_LIGHTBAR_COLOUR = 0xfff4dc;
// Unlit lens brightness: parked cars' lamps are off (a dim pale lens); the
// chase car's are on, pushed past the bloom threshold in post.js.
export const CAR_LENS_OFF = 0.45;
// 2.2 rather than higher: the red taillamps' red channel then sits just
// over 1.0, where post.js's highlight shoulder keeps its hue; much higher
// and the shoulder drifts them towards pinkish white.
export const CAR_LENS_ON = 2.2;

// Deliberately oversized against the 1.8 x 1.1 x 3.8 body: the wheels
// standing proud of the bodywork are most of what separates an off-roader
// from a saloon at a glance. The body's underside sits at y=0.2, so a 0.46
// radius also leaves visible ground clearance beneath it.
const CAR_WHEEL_RADIUS = 0.46;
const CAR_WHEEL_WIDTH = 0.34;
export const CAR_WHEEL_X = 0.98;
export const CAR_WHEEL_Z = 1.25;
const CAR_MAX_STEER = 0.42; // radians; purely cosmetic, the physics yaw is untouched

/**
 * Bakes a flat colour into a geometry's vertex-colour attribute so it can be
 * merged with differently coloured pieces under a single material.
 * @param {THREE.BufferGeometry} geo
 * @param {THREE.Color} colour
 * @returns {THREE.BufferGeometry}
 */
function tintGeometry(geo, colour) {
  const count = geo.attributes.position.count;
  const colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colours[i * 3] = colour.r;
    colours[i * 3 + 1] = colour.g;
    colours[i * 3 + 2] = colour.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return geo;
}

/**
 * Marks a geometry or material as shared between cars, so disposeCarMesh()
 * leaves it alone -- disposing the chase car must not pull the geometry out
 * from under the 34 parked ones still using it.
 * @template {{userData: Object}} T
 * @param {T} resource
 * @returns {T}
 */
function markShared(resource) {
  resource.userData.shared = true;
  return resource;
}

/**
 * @param {Object} ctx
 * @returns {{
 *   createCar: (x: number, z: number, namePrefix?: string) => Object,
 *   updateCarVisuals: (dt: number) => void,
 *   resetCarVisuals: () => void
 * }}
 */
export function createCarsSystem(ctx) {
  const { Chase, windForceMagnitudeAt, nextObjectId } = ctx;

  /**
   * Shared geometry/materials, built once and reused by every car. Merging
   * matters as much as sharing: each group below is one draw call per car
   * (doubled by the shadow pass), so bolt-on parts are merged per material
   * with their colours in a vertex attribute instead of as separate meshes.
   */
  /** @type {{
   *   envMap: THREE.Texture,
   *   wheelGeometry: THREE.BufferGeometry, wheelMaterial: THREE.MeshStandardMaterial,
   *   trimGeometry: THREE.BufferGeometry, trimMaterial: THREE.MeshStandardMaterial,
   *   lensGeometry: THREE.BufferGeometry, lensMaterial: THREE.MeshBasicMaterial,
   *   glassGeometry: THREE.BufferGeometry, glassMaterial: THREE.MeshStandardMaterial,
   *   tubGeometry: THREE.BufferGeometry, cabinGeometry: THREE.BufferGeometry
   * }|null} */
  let assets = null;

  /**
   * A small prefiltered reflection map of a storm sky -- dark zenith, grey
   * horizon glow, dark ground -- for the car's metal and glass only (the
   * scene itself has no environment lighting, and giving it one would
   * change every material in town).
   * @returns {THREE.Texture}
   */
  function getCarEnvMap() {
    const envScene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(10, 24, 12);
    const colours = [];
    const top = new THREE.Color(0x2a3444);
    const horizon = new THREE.Color(0x9aa4b0);
    const ground = new THREE.Color(0x1d1f1c);
    const c = new THREE.Color();
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 10;
      if (y >= 0) c.copy(horizon).lerp(top, Math.pow(y, 0.6));
      else c.copy(horizon).lerp(ground, Math.min(1, -y * 3));
      colours.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    envScene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const pmrem = new THREE.PMREMGenerator(ctx.Sim.three.renderer);
    const texture = pmrem.fromScene(envScene, 0.02).texture;
    pmrem.dispose();
    geo.dispose();
    return texture;
  }

  /**
   * Extrudes a side profile (drawn in car-local z/y) across the car's width,
   * centred on x = 0.
   * @param {THREE.Shape} shape profile with shape.x = car z, shape.y = car y
   * @param {number} width
   * @returns {THREE.BufferGeometry}
   */
  function extrudeProfile(shape, width) {
    const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 7 });
    // Extrusion runs along +z; turning -90 degrees about y sends shape.x to
    // car +z and the extrusion to car -x, then it is re-centred.
    geo.rotateY(-Math.PI / 2);
    geo.translate(width / 2, 0, 0);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Lower body side profile: squared nose, hood falling towards it, the
   * cabin's footing, the rear tub, and both wheel arches cut out of the
   * bottom edge. Its top (the hood, 1.3) is the cockpit's "hood top".
   * @returns {THREE.Shape}
   */
  function tubProfile() {
    const r = CAR_WHEEL_RADIUS + 0.14; // arch radius: wheel plus visible clearance
    const cy = CAR_WHEEL_RADIUS;
    const s = new THREE.Shape();
    s.moveTo(-1.95, 0.52);
    s.lineTo(-1.88, 0.42);
    s.lineTo(-CAR_WHEEL_Z - r, 0.42);
    s.absarc(-CAR_WHEEL_Z, cy, r, Math.PI, 0, true);
    s.lineTo(-CAR_WHEEL_Z + r, 0.4);
    s.lineTo(CAR_WHEEL_Z - r, 0.4);
    s.absarc(CAR_WHEEL_Z, cy, r, Math.PI, 0, true);
    s.lineTo(CAR_WHEEL_Z + r, 0.46);
    s.lineTo(1.97, 0.6);
    s.lineTo(1.97, 1.04);
    s.lineTo(1.86, 1.2);
    s.lineTo(0.74, 1.3);
    s.lineTo(0.62, 1.2);
    s.lineTo(-1.0, 1.2);
    s.lineTo(-1.04, 1.28);
    s.lineTo(-1.95, 1.28);
    s.closePath();
    return s;
  }

  /**
   * Cabin side profile: raked windshield, flat roof, near-upright rear
   * glass. Front-bottom corner at z = 0.7, roof at 1.9 (cockpit contract).
   * @returns {THREE.Shape}
   */
  function cabinProfile() {
    const s = new THREE.Shape();
    s.moveTo(-1.06, 1.2);
    s.lineTo(0.7, 1.2);
    s.lineTo(0.2, 1.9);
    s.lineTo(-0.94, 1.9);
    s.closePath();
    return s;
  }

  /**
   * Glass panels, just proud of the cabin's faces: windshield on the raked
   * front, one trapezoid per side, and the rear window. Plain planes facing
   * outward (FrontSide), so they never draw in the cockpit view.
   * @returns {THREE.BufferGeometry}
   */
  function glassGeometry() {
    const lift = 0.015;
    const parts = [];

    // Windshield. The raked face runs from (z 0.7, y 1.2) to (z 0.2, y 1.9);
    // its outward normal is (0, 0.581, 0.814) in (x, y, z).
    const slope = Math.hypot(0.5, 0.7);
    const tilt = Math.atan2(0.5, 0.7);
    const ws = new THREE.PlaneGeometry(1.36, slope * 0.84);
    ws.rotateX(-tilt);
    ws.translate(0, 1.55 + 0.581 * lift, 0.45 + 0.814 * lift);
    parts.push(ws);

    // Side windows, inset from the pillars.
    for (const side of [-1, 1]) {
      const zs = [-0.88, 0.55, 0.26, -0.84];
      const ys = [1.32, 1.32, 1.8, 1.8];
      const shape = new THREE.Shape();
      // For the +x side the rotation below mirrors shape.x into -z, so the
      // profile is drawn with z negated there.
      zs.forEach((z, i) => {
        const u = side > 0 ? -z : z;
        if (i === 0) shape.moveTo(u, ys[i]); else shape.lineTo(u, ys[i]);
      });
      shape.closePath();
      const g = new THREE.ShapeGeometry(shape);
      g.rotateY(side * Math.PI / 2);
      g.translate(side * (0.78 + lift), 0, 0);
      parts.push(g);
    }

    // Rear window, on the near-vertical back face.
    const rear = new THREE.PlaneGeometry(1.3, 0.5);
    rear.rotateY(Math.PI);
    rear.rotateX(-0.12);
    rear.translate(0, 1.6, -1.0 - lift - 0.02);
    parts.push(rear);

    return mergeGeometries(parts.map(g => (g.index ? g.toNonIndexed() : g)).map(g => {
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      return g;
    }));
  }

  /**
   * Steel and black trim, merged with baked colours: front bumper with
   * wings, winch and skid plate; grille; wheel-arch flares; rock sliders;
   * rear bumper; mirrors; roof rack and light-bar housing; spare-wheel
   * carrier and the spare itself.
   * @returns {THREE.BufferGeometry}
   */
  function trimGeometry() {
    const steel = new THREE.Color(CAR_STEEL_COLOUR);
    const trim = new THREE.Color(CAR_TRIM_COLOUR);
    const rubber = new THREE.Color(CAR_TYRE_COLOUR);
    /** @type {THREE.BufferGeometry[]} */
    const parts = [];
    /** @type {(g:THREE.BufferGeometry, c:THREE.Color) => void} */
    const add = (g, c) => {
      const flat = g.index ? g.toNonIndexed() : g;
      for (const name of Object.keys(flat.attributes)) if (!['position', 'normal', 'uv'].includes(name)) flat.deleteAttribute(name);
      parts.push(tintGeometry(flat, c));
    };
    /** @type {(w:number,h:number,d:number,x:number,y:number,z:number,c:THREE.Color,ry?:number,rx?:number) => void} */
    const box = (w, h, d, x, y, z, c, ry = 0, rx = 0) => {
      const g = new THREE.BoxGeometry(w, h, d);
      if (rx) g.rotateX(rx);
      if (ry) g.rotateY(ry);
      g.translate(x, y, z);
      add(g, c);
    };

    // Front bumper: a deep steel bar, swept-back wings, a winch drum and a
    // skid plate angled up under the nose.
    box(1.86, 0.28, 0.22, 0, 0.6, 2.06, steel);
    for (const sx of [-1, 1]) box(0.36, 0.24, 0.18, sx * 1.0, 0.6, 1.94, steel, sx * 0.55);
    box(0.5, 0.16, 0.16, 0, 0.62, 2.2, trim);
    box(1.2, 0.06, 0.55, 0, 0.36, 1.82, steel, 0, 0.45);
    // Bull-bar hoop rising from the bumper past the grille.
    for (const sx of [-1, 1]) box(0.09, 0.5, 0.09, sx * 0.55, 0.95, 2.08, steel);
    box(1.2, 0.09, 0.09, 0, 1.18, 2.08, steel);

    // Grille: black insert with three steel slats, set into the nose.
    box(1.24, 0.36, 0.04, 0, 0.84, 1.985, trim);
    for (const gy of [0.74, 0.84, 0.94]) box(1.1, 0.035, 0.03, 0, gy, 2.0, steel);

    // Flared arches: half-rings of black trim standing off each arch.
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const flare = new THREE.TorusGeometry(CAR_WHEEL_RADIUS + 0.17, 0.075, 4, 12, Math.PI);
      flare.scale(1, 1, 1.9);
      flare.rotateY(Math.PI / 2);
      flare.translate(sx * 0.9, CAR_WHEEL_RADIUS, sz * CAR_WHEEL_Z);
      add(flare, trim);
    }

    // Rock sliders and rear bumper.
    for (const sx of [-1, 1]) box(0.12, 0.11, 1.1, sx * 0.94, 0.4, 0, steel);
    box(1.86, 0.22, 0.18, 0, 0.52, -2.02, steel);

    // Mirrors: an arm off each A-pillar and a black housing.
    for (const sx of [-1, 1]) {
      box(0.2, 0.04, 0.05, sx * 0.87, 1.36, 0.55, trim);
      box(0.07, 0.17, 0.24, sx * 0.99, 1.42, 0.52, trim, sx * 0.25);
    }

    // Roof rack: side rails, cross bars and posts, plus the light-bar
    // housing across its front. Kept above and ahead of the cockpit eye
    // point so it stays outside the first-person view (see header).
    for (const sx of [-1, 1]) {
      box(0.05, 0.05, 1.5, sx * 0.66, 2.0, -0.3, steel);
      for (const pz of [-0.95, 0.35]) box(0.05, 0.1, 0.05, sx * 0.66, 1.94, pz, steel);
    }
    for (const cz of [-0.9, -0.3, 0.3]) box(1.36, 0.04, 0.05, 0, 2.02, cz, steel);
    box(1.3, 0.13, 0.13, 0, 2.08, 0.38, trim);

    // Spare wheel on a carrier off the rear bumper.
    box(0.1, 0.5, 0.08, 0, 0.85, -2.06, steel);
    const spare = new THREE.CylinderGeometry(0.4, 0.4, 0.22, 12);
    spare.rotateX(Math.PI / 2);
    spare.translate(0, 1.0, -2.2);
    add(spare, rubber);

    return mergeGeometries(parts);
  }

  /**
   * Lamp lenses with baked colours: headlamps and taillamps, and the four
   * light-bar lenses.
   * @returns {THREE.BufferGeometry}
   */
  function lensGeometry() {
    const head = new THREE.Color(CAR_HEADLAMP_COLOUR);
    const tail = new THREE.Color(CAR_TAILLAMP_COLOUR);
    const bar = new THREE.Color(CAR_LIGHTBAR_COLOUR);
    const parts = [];
    /** @type {(w:number,h:number,d:number,x:number,y:number,z:number,c:THREE.Color) => void} */
    const box = (w, h, d, x, y, z, c) => {
      const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
      g.translate(x, y, z);
      parts.push(tintGeometry(g, c));
    };
    for (const sx of [-1, 1]) {
      box(0.26, 0.17, 0.04, sx * 0.64, 0.97, 1.99, head);
      box(0.12, 0.22, 0.04, sx * 0.84, 1.0, -1.97, tail);
    }
    for (const lx of [-0.45, -0.15, 0.15, 0.45]) box(0.24, 0.09, 0.04, lx, 2.08, 0.46, bar);
    return mergeGeometries(parts);
  }

  /**
   * Builds (once) and returns every shared car asset.
   * @returns {NonNullable<typeof assets>}
   */
  function getCarAssets() {
    if (assets) return assets;
    const envMap = markShared(getCarEnvMap());

    // One wheel: chunky tyre with a raised tread band, plus a hub, merged,
    // with the axle along +X (car-local +Z forward, +X right).
    const tyre = new THREE.CylinderGeometry(CAR_WHEEL_RADIUS, CAR_WHEEL_RADIUS, CAR_WHEEL_WIDTH, 12).toNonIndexed();
    tyre.rotateZ(Math.PI / 2);
    const tread = new THREE.CylinderGeometry(CAR_WHEEL_RADIUS * 1.03, CAR_WHEEL_RADIUS * 1.03, CAR_WHEEL_WIDTH * 0.6, 12).toNonIndexed();
    tread.rotateZ(Math.PI / 2);
    const hub = new THREE.CylinderGeometry(CAR_WHEEL_RADIUS * 0.44, CAR_WHEEL_RADIUS * 0.44, CAR_WHEEL_WIDTH * 1.06, 8).toNonIndexed();
    hub.rotateZ(Math.PI / 2);
    const wheelGeometry = markShared(mergeGeometries([
      tintGeometry(tyre, new THREE.Color(CAR_TYRE_COLOUR)),
      tintGeometry(tread, new THREE.Color(CAR_TYRE_COLOUR)),
      tintGeometry(hub, new THREE.Color(CAR_HUB_COLOUR))
    ]));
    const wheelMaterial = markShared(new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.92, metalness: 0.1
    }));

    assets = {
      envMap,
      wheelGeometry,
      wheelMaterial,
      trimGeometry: markShared(trimGeometry()),
      trimMaterial: markShared(new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.38, metalness: 0.7, envMap, envMapIntensity: 0.8
      })),
      lensGeometry: markShared(lensGeometry()),
      lensMaterial: markShared(new THREE.MeshBasicMaterial({ vertexColors: true })),
      glassGeometry: markShared(glassGeometry()),
      glassMaterial: markShared(new THREE.MeshStandardMaterial({
        color: 0x0c1218, roughness: 0.08, metalness: 0.55, envMap, envMapIntensity: 1.1,
        transparent: true, opacity: 0.84
      })),
      tubGeometry: markShared(extrudeProfile(tubProfile(), 1.8)),
      cabinGeometry: markShared(extrudeProfile(cabinProfile(), 1.56))
    };
    assets.lensMaterial.color.setScalar(CAR_LENS_OFF);
    return assets;
  }

  /**
   * Builds the four road wheels and parents them to the car root (not the
   * chassis), so they stay level while the body leans.
   *
   * Each wheel is a two-level nest, because steering and rolling are rotations
   * about different axes and composing them on one object would make the roll
   * axis swing around with the steering angle:
   *   pivot (rotation.y = steering) -> spin (rotation.x = rolling) -> mesh.
   * @param {THREE.Group} root
   * @param {string} namePrefix the owning car's scene-graph name, used to prefix each wheel's
   * @returns {{pivot:THREE.Group, spin:THREE.Group, steers:boolean}[]}
   */
  function addCarWheels(root, namePrefix) {
    const { wheelGeometry, wheelMaterial } = getCarAssets();
    const wheels = [];
    for (const [ix, iz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      // Corner tag for the scene-graph names: iz > 0 is the front axle (the
      // steered one, per `steers` below), ix > 0 the right-hand side.
      const corner = `${iz > 0 ? 'f' : 'r'}${ix > 0 ? 'r' : 'l'}`;
      const pivot = new THREE.Group();
      pivot.name = `${namePrefix}_wheelPivot_${corner}`;
      pivot.position.set(ix * CAR_WHEEL_X, CAR_WHEEL_RADIUS, iz * CAR_WHEEL_Z);
      const spin = new THREE.Group();
      spin.name = `${namePrefix}_wheelSpin_${corner}`;
      pivot.add(spin);
      const mesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
      mesh.name = `${namePrefix}_wheel_${corner}`;
      // No shadow: too small to show in a 1024 shadow map, and every caster
      // is drawn a second time into it (performance pass).
      mesh.castShadow = false;
      spin.add(mesh);
      root.add(pivot);
      wheels.push({ pivot, spin, steers: iz > 0 });
    }
    return wheels;
  }

  // Suspension response. Kept small: these are the amounts that read as a
  // vehicle settling on its springs, not as a boat.
  const CAR_MAX_PITCH = 0.05;         // radians (~2.9deg) under hardest acceleration/braking
  const CAR_PITCH_PER_ACCEL = 0.006;  // radians per unit of acceleration, before clamping
  const CAR_MAX_ROLL = 0.06;          // radians (~3.4deg) in a full-speed corner
  // The wind term is allowed to be roughly twice the driving term, so a car
  // being worked over by the funnel visibly struggles in a way that ordinary
  // cornering never does.
  const CAR_BUFFET_TILT = 0.13;
  const CAR_BUFFET_REFERENCE = 5; // wind magnitude treated as "full" buffeting; cars break around 4-6
  const carWindScratch = new THREE.Vector3();

  /**
   * Per-frame cosmetic update for the Chase Mode car: rolling wheels, steered
   * front wheels, and chassis pitch/roll. Reads Chase.speed, Chase.wheelAngle
   * and the car's capture state, and writes nothing back -- physics, steering
   * and the capture state machine are all untouched.
   * @param {number} dt
   * @returns {void}
   */
  function updateCarVisuals(dt) {
    if (!Chase.car) return;
    const root = Chase.car.mesh;
    const wheels = root.userData.carWheels;
    const chassis = root.userData.carChassis;
    if (!wheels || !chassis) return;

    // Rolling without slip: omega = v / r. Positive rotation.x carries the top
    // of the wheel toward +Z, which is forward here, so a positive speed rolls
    // the wheels the right way round.
    Chase.wheelSpin += (Chase.speed / CAR_WHEEL_RADIUS) * dt;

    // Steering angle is derived from the eased value the cockpit steering
    // wheel already uses, rescaled from its full visual throw down to a
    // plausible road-wheel angle. Sharing one source means the hand wheel and
    // the road wheels can never disagree about which way the driver is
    // turning, and it inherits the existing easing for free.
    const steer = (Chase.wheelAngle / CHASE_TUNE.cockpitWheelMaxAngle) * CAR_MAX_STEER;
    for (const w of wheels) {
      w.spin.rotation.x = Chase.wheelSpin;
      if (w.steers) w.pivot.rotation.y = steer;
    }

    const accel = (Chase.speed - Chase.prevSpeed) / Math.max(dt, 1e-4);
    Chase.prevSpeed = Chase.speed;

    const speedFrac = THREE.MathUtils.clamp(Math.abs(Chase.speed) / CHASE_TUNE.maxSpeed, 0, 1);
    const turnInput = (Chase.keys.left ? 1 : 0) - (Chase.keys.right ? 1 : 0);

    // Accelerating squats the rear and lifts the nose. A positive rotation.x
    // pitches the nose *down* (it carries +Z toward -Y), so the sign is
    // inverted here: speeding up gives a negative angle, braking a positive one.
    const drivePitch = -THREE.MathUtils.clamp(
      accel * CAR_PITCH_PER_ACCEL, -CAR_MAX_PITCH, CAR_MAX_PITCH
    );
    // The body leans to the outside of a corner. Increasing heading swings the
    // car toward +X (its right), so the load shifts to the left and the right
    // side lifts -- which is a positive rotation.z.
    const driveRoll = turnInput * speedFrac * CAR_MAX_ROLL;

    // Wind buffeting, from the same force field the damage thresholds read.
    // Two incommensurate sine terms rather than one, so the wobble never
    // settles into an obvious repeating beat.
    carWindScratch.set(root.position.x, 1, root.position.z);
    const buffet = THREE.MathUtils.clamp(
      windForceMagnitudeAt(carWindScratch) / CAR_BUFFET_REFERENCE, 0, 1
    );
    const t = ctx.now();
    const buffetPitch = (Math.sin(t * 7.3) * 0.6 + Math.sin(t * 12.1) * 0.4) * buffet * CAR_BUFFET_TILT;
    const buffetRoll = (Math.sin(t * 5.9 + 1.7) * 0.6 + Math.sin(t * 10.3) * 0.4) * buffet * CAR_BUFFET_TILT;

    const smoothing = 1 - Math.pow(0.0008, dt); // frame-rate-independent exponential lerp
    Chase.bodyPitch = THREE.MathUtils.lerp(Chase.bodyPitch, drivePitch + buffetPitch, smoothing);
    Chase.bodyRoll = THREE.MathUtils.lerp(Chase.bodyRoll, driveRoll + buffetRoll, smoothing);
    chassis.rotation.x = Chase.bodyPitch;
    chassis.rotation.z = Chase.bodyRoll;
  }

  /**
   * Resets the car's cosmetic state (wheel spin, body lean, dust) back to
   * rest. Called on chase entry, restart and exit so none of it carries over
   * between runs.
   * @returns {void}
   */
  function resetCarVisuals() {
    Chase.wheelSpin = 0;
    Chase.prevSpeed = 0;
    Chase.bodyPitch = 0;
    Chase.bodyRoll = 0;
    ctx.systems.carDust.resetCarDust();
    ctx.systems.tireFire.resetTireFire();
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {string} [namePrefix] scene-graph name for the car root; every sub-part
   *   (chassis, body, cabin, wheels) is named from it, so 'chaseCar' yields
   *   'chaseCar_body', 'chaseCar_wheel_fl' and so on
   * @returns {SimObject}
   */
  function createCar(x, z, namePrefix = 'envCar', rand = Math.random) {
    const colourIndex = Math.floor(rand() * CAR_BODY_COLOURS.length);
    const colour = CAR_BODY_COLOURS[colourIndex];

    const root = new THREE.Group();
    root.name = namePrefix;
    root.position.set(x, 0, z);
    root.rotation.y = rand() * Math.PI * 2;

    // The chassis group carries everything that should lean on the vehicle's
    // suspension. The wheels are deliberately parented to the root instead, so
    // they stay planted while the body rolls and pitches above them -- which
    // is what actually reads as suspension rather than the whole car tilting.
    //
    // It is built at the origin with no transform of its own, so every child's
    // local position is still root-space: getCarPartBoundingBox and therefore
    // the whole cockpit layout in buildCockpitFixtures keep working unchanged.
    const chassis = new THREE.Group();
    chassis.name = `${namePrefix}_chassis`;
    root.add(chassis);
    root.userData.carChassis = chassis;

    const a = getCarAssets();
    // Matte, slightly rough paint; the only per-car material.
    const paint = new THREE.MeshStandardMaterial({
      color: colour, roughness: 0.68, metalness: 0.18, envMap: a.envMap, envMapIntensity: 0.3
    });

    const body = new THREE.Mesh(a.tubGeometry, paint);
    body.castShadow = true;
    body.receiveShadow = true;
    body.name = `${namePrefix}_body`;
    body.userData.carPart = 'body'; // lets buildCockpitFixtures read this part's real bounding box rather than hardcoding its dimensions
    chassis.add(body);

    const cabin = new THREE.Mesh(a.cabinGeometry, paint);
    cabin.castShadow = true;
    cabin.receiveShadow = true;
    cabin.name = `${namePrefix}_cabin`;
    cabin.userData.carPart = 'cabin'; // see body.userData.carPart above
    chassis.add(cabin);

    const glass = new THREE.Mesh(a.glassGeometry, a.glassMaterial);
    glass.name = `${namePrefix}_glass`;
    chassis.add(glass);

    const trim = new THREE.Mesh(a.trimGeometry, a.trimMaterial);
    trim.name = `${namePrefix}_trim`;
    trim.castShadow = false;
    chassis.add(trim);

    const lenses = new THREE.Mesh(a.lensGeometry, a.lensMaterial);
    lenses.name = `${namePrefix}_lenses`;
    chassis.add(lenses);
    root.userData.carLenses = lenses;

    root.userData.carWheels = addCarWheels(root, namePrefix);

    /** @type {SimObject} */
    const obj = {
      id: nextObjectId.value++,
      type: 'car',
      mesh: root,
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
      mass: 14 + rand() * 4,
      drag: 0.9,
      rooted: false,
      damageState: 'intact',
      breakThreshold: 4.0 + rand() * 2.0,
      liftEligible: 0.25,
      pooled: false,
      poolIndex: -1,
      lifeTimer: 0,
      captureState: 'grounded'
    };
    root.userData.simObject = obj;
    root.userData.parked = true;
    // Which body colour, for the co-op guest's copy (net/carPose.js `cars` rows).
    root.userData.carColour = colourIndex;
    return obj;
  }

  /**
   * One car of a body colour for the co-op guest to clone (net/system.js): the
   * real model, its shared assets left alone, no simulation object (nothing
   * is registered). Only the colour's own paint is for the caller to release.
   * @param {number} colour Index into the body colours (clamped).
   * @returns {{root: THREE.Object3D, geometries: THREE.BufferGeometry[], materials: THREE.Material[]}}
   */
  function buildGuestModel(colour) {
    const index = Math.min(CAR_BODY_COLOURS.length - 1, Math.max(0, Math.floor(colour) || 0));
    const obj = createCar(0, 0, 'guestCar', () => (index + 0.5) / CAR_BODY_COLOURS.length);
    const root = obj.mesh;
    root.rotation.set(0, 0, 0);
    const paint = new Set();
    root.traverse((/** @type {any} */ child) => {
      if (child.material && !child.material.userData?.shared) paint.add(child.material);
    });
    // Object3D.clone copies userData as JSON: drop the links to the simulation object and the wheels.
    root.userData = {};
    return { root, geometries: [], materials: [...paint] };
  }

  return { createCar, updateCarVisuals, resetCarVisuals, buildGuestModel, colourCount: CAR_BODY_COLOURS.length };
}
