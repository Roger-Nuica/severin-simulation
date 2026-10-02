// @ts-check
import * as THREE from 'three';
import { KATANA_PIECES as CFG } from './config.js';
import { inReach } from './targets.js';

/**
 * ===========================================================================
 * SECTION KT.7 -- The slicing core: halves, cut faces, pieces
 * ===========================================================================
 * What a cut leaves behind. The aliens' owner hands the cut alien's root over
 * (crew.js sliceKill -> `takeOver`); this file turns it into two pieces:
 *
 *  - **One bake per alien.** The alien's twelve to fifteen meshes, in the
 *    pose they were cut in, are written into ONE geometry (world axes, origin
 *    at the alien's feet) with two material groups: the skin and the detail
 *    (guns, eyes, hat, which keep their own colours as vertex colours). Every
 *    piece of that alien shares it, and it is disposed when the last piece
 *    using it goes (`refs`). Two draws a piece, instead of twelve or more.
 *  - **Clipping, not cutting.** A piece is that geometry with its own cloned
 *    materials and up to three clipping planes (one per cut that made it:
 *    `local`, in the bake's own space; `world`, the same moved with the piece
 *    each frame, which is what the materials hold). Each half keeps one side
 *    of the plane. Every material always has exactly three planes, the unused
 *    ones pushed out of reach, so the whole feature is one shader variant.
 *    The renderer's `localClippingEnabled` is switched on here, idempotently.
 *  - **The cut face.** Worked out on the processor, once, at the cut: each
 *    part's cross-section with the plane (the part is convex, so the hull of
 *    the points where its edges meet the plane), clipped against the piece's
 *    other planes, and written as flat triangles. It therefore follows the
 *    silhouette exactly, on any cut, and costs one more draw a piece (no
 *    stencil). It glows in the alien's inner teal-green.
 *  - **Physics.** Presentation only: a pivot, a velocity, a spin, gravity, a
 *    ground bounce, friction, rest. It moves on the world clock, so slow
 *    motion and hit-stop apply. Pieces are not registered enemies and never
 *    enter Sim.objects. They do not cast shadows.
 *  - **Lifetime.** CFG.lifetime seconds, fading over the last CFG.fadeSeconds
 *    (the materials are transparent from the start, because switching it on
 *    later would build another shader). Then every material and cap geometry
 *    is disposed. Past CFG.maxPieces the oldest piece is recycled.
 *  - **Cutting again.** `cutPiece` splits a piece by a world plane into two
 *    more, up to CFG.maxDepth cuts deep, so an alien makes at most eight.
 *
 * All state lives in this closure, made per run by heroWeapons.js and
 * disposed with it (R-047). The update loop allocates nothing (R-048); the
 * cut itself allocates, once per cut, which is O(the alien's triangles) and
 * independent of how many aliens there are (R-044).
 */

/** How far above its pivot the cut plane is let miss a piece's height, metres. */
const REACH_HEIGHT = 2.0;
/** Half the width of a piece, for the forward-arc test, metres. */
const PIECE_RADIUS = 0.4;
/** A plane far enough away to clip nothing, for the unused slots. */
const NEVER = 1e6;

/**
 * @typedef {Object} Part one source mesh inside a bake
 * @property {number} start first index in the bake's index buffer
 * @property {number} count how many indices
 */

/**
 * @typedef {Object} Bake the alien's frozen pose as one geometry
 * @property {THREE.BufferGeometry} geometry shared by every piece of the alien
 * @property {Float32Array} positions the geometry's own positions, world axes, origin at the alien's feet
 * @property {Uint16Array|Uint32Array} index the geometry's own index
 * @property {Part[]} parts
 * @property {THREE.Vector3} origin where the alien stood, world metres
 * @property {THREE.MeshStandardMaterial} skin template cloned for each piece (owned here)
 * @property {THREE.MeshStandardMaterial} detail template cloned for each piece (owned here)
 * @property {number} refs pieces using it
 * @property {boolean} [human] a person's body (no alien skin was given): red blood and a red cut face
 */

/**
 * @typedef {Object} Piece
 * @property {Bake} bake
 * @property {THREE.Mesh} body the two draws; its position and quaternion are the pose
 * @property {THREE.Mesh|null} cap the cut faces, a child of body
 * @property {THREE.MeshStandardMaterial[]} materials skin and detail clones
 * @property {THREE.MeshBasicMaterial} capMaterial
 * @property {THREE.Plane[]} local keep-side planes, in the bake's space, one per cut
 * @property {THREE.Plane[]} world the three planes the materials hold, moved with the piece
 * @property {number} depth cuts that made it (local.length)
 * @property {THREE.Vector3} centre pivot in the bake's space
 * @property {THREE.Vector3} pos pivot in the world, metres
 * @property {THREE.Vector3} velocity metres per second
 * @property {THREE.Vector3} spinAxis unit
 * @property {number} spinRate radians per second
 * @property {number} age world seconds
 * @property {boolean} resting lying on the ground and still
 * @property {boolean} dead released
 */

/**
 * @typedef {Object} Reach the quick slash's query (targets.js Reach)
 * @property {number} x
 * @property {number} z
 * @property {number} dirX
 * @property {number} dirZ
 * @property {number} reach
 * @property {number} cosArc
 * @property {number} [y]
 */

/**
 * @typedef {import('./targets.js').CutPlaneLike} CutPlaneLike
 */

/**
 * @typedef {Object} KatanaPieces
 * @property {(root: THREE.Object3D, plane?: CutPlaneLike, skin?: THREE.Material) => void} takeOver
 *   the alien owner's hand-over (hit.cut.takeOver): the root becomes two pieces
 * @property {(piece: Piece, plane: CutPlaneLike) => boolean} cutPiece splits a piece by a world plane; false if it cannot
 * @property {(reach: Reach, plane: CutPlaneLike) => number} cutInReach cuts every piece in reach (the plane re-aimed at each); how many
 * @property {(visit: (piece: Piece) => void) => void} each visits the live pieces, allocation-free (`piece.pos` is its pivot)
 * @property {() => number} count live pieces
 * @property {() => void} prewarm builds the shader variants now instead of at the first cut
 * @property {() => void} clear every piece gone, everything disposed
 * @property {() => void} dispose
 * @property {(dt: number) => void} update
 */

/**
 * The material the alien's skin is made of, when the owner did not say.
 * @param {THREE.Object3D} root
 * @returns {THREE.Material|null}
 */
function firstMaterial(root) {
  /** @type {THREE.Material|null} */
  let found = null;
  root.traverse((o) => {
    const m = /** @type {any} */ (o);
    if (!found && m.isMesh && m.material && !Array.isArray(m.material)) found = m.material;
  });
  return found;
}

/**
 * The alien's meshes, in the pose they are in now, as one geometry with two
 * groups (the skin, then everything else with its colour in vertex colours).
 * Visibility is ignored on purpose: the instancer hides an alien's own parts
 * while it draws it as instances, and no part is hidden by design.
 * @param {THREE.Object3D} root
 * @param {THREE.Material|undefined} skin the alien's own skin material
 * @returns {Bake|null} null when there is nothing to bake
 */
function bakeAlien(root, skin) {
  root.updateMatrixWorld(true);
  const origin = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld);
  const own = skin || firstMaterial(root);
  /** @type {any[]} */
  const skinMeshes = [];
  /** @type {any[]} */
  const detailMeshes = [];
  root.traverse((o) => {
    const m = /** @type {any} */ (o);
    if (!m.isMesh || !m.geometry || !m.material || Array.isArray(m.material)) return;
    (m.material === own ? skinMeshes : detailMeshes).push(m);
  });
  const meshes = skinMeshes.concat(detailMeshes);
  if (!meshes.length || !own) return null;

  let vertexTotal = 0;
  let indexTotal = 0;
  let skinIndexTotal = 0;
  for (const m of meshes) {
    const g = m.geometry;
    const vertices = g.attributes.position.count;
    const indices = g.index ? g.index.count : vertices;
    vertexTotal += vertices;
    indexTotal += indices;
    if (m.material === own) skinIndexTotal += indices;
  }
  const positions = new Float32Array(vertexTotal * 3);
  const normals = new Float32Array(vertexTotal * 3);
  const colours = new Float32Array(vertexTotal * 3);
  const index = vertexTotal > 65535 ? new Uint32Array(indexTotal) : new Uint16Array(indexTotal);
  /** @type {Part[]} */
  const parts = [];
  const normalMatrix = new THREE.Matrix3();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  let v0 = 0;
  let i0 = 0;
  for (const m of meshes) {
    const g = m.geometry;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    normalMatrix.getNormalMatrix(m.matrixWorld);
    const tint = m.material === own || !m.material.color ? null : m.material.color;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).sub(origin);
      if (nor) n.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
      else n.set(0, 1, 0);
      const o = (v0 + i) * 3;
      positions[o] = p.x; positions[o + 1] = p.y; positions[o + 2] = p.z;
      normals[o] = n.x; normals[o + 1] = n.y; normals[o + 2] = n.z;
      colours[o] = tint ? tint.r : 1;
      colours[o + 1] = tint ? tint.g : 1;
      colours[o + 2] = tint ? tint.b : 1;
    }
    const indices = g.index ? g.index.count : pos.count;
    for (let k = 0; k < indices; k++) index[i0 + k] = v0 + (g.index ? g.index.getX(k) : k);
    parts.push({ start: i0, count: indices });
    v0 += pos.count;
    i0 += indices;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  if (skinIndexTotal > 0) geometry.addGroup(0, skinIndexTotal, 0);
  if (indexTotal > skinIndexTotal) geometry.addGroup(skinIndexTotal, indexTotal - skinIndexTotal, 1);
  geometry.computeBoundingSphere();

  // The templates are the bake's own (the alien's skin is disposed by the
  // aliens' reset, maybe while a piece is still fading, and a piece cut again
  // later needs to clone from something that is still alive).
  const skinTemplate = /** @type {THREE.MeshStandardMaterial} */ (/** @type {any} */ (own).clone());
  skinTemplate.vertexColors = true;
  skinTemplate.transparent = true;
  const detailTemplate = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.4, metalness: 0.5, emissive: CFG.detailEmissive, transparent: true
  });
  return { geometry, positions, index, parts, origin, skin: skinTemplate, detail: detailTemplate, refs: 0 };
}

/**
 * Frees a bake's geometry and templates.
 * @param {Bake} bake
 * @returns {void}
 */
function disposeBake(bake) {
  bake.geometry.dispose();
  bake.skin.dispose();
  bake.detail.dispose();
}

/**
 * The points where one part's triangle edges meet a plane.
 * @param {Bake} bake
 * @param {Part} part
 * @param {THREE.Plane} plane
 * @returns {THREE.Vector3[]}
 */
function planePoints(bake, part, plane) {
  const P = bake.positions;
  const index = bake.index;
  const n = plane.normal;
  const c = plane.constant;
  /** @type {THREE.Vector3[]} */
  const out = [];
  /** @type {(i: number) => number} */
  const dist = (i) => n.x * P[3 * i] + n.y * P[3 * i + 1] + n.z * P[3 * i + 2] + c;
  /** @type {(i: number) => THREE.Vector3} */
  const at = (i) => new THREE.Vector3(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
  for (let k = part.start; k < part.start + part.count; k += 3) {
    for (let e = 0; e < 3; e++) {
      const ia = index[k + e];
      const ib = index[k + ((e + 1) % 3)];
      const da = dist(ia);
      const db = dist(ib);
      if (da === 0) out.push(at(ia));
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) out.push(at(ia).lerp(at(ib), da / (da - db)));
    }
  }
  return out;
}

/**
 * The convex hull of points that lie on a plane, in order round it.
 * @param {THREE.Vector3[]} points
 * @param {THREE.Vector3} normal the plane's unit normal
 * @returns {THREE.Vector3[]} empty if there are fewer than three
 */
function convexHull(points, normal) {
  if (points.length < 3) return [];
  const helper = Math.abs(normal.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(normal, helper).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u);
  const o = points[0];
  const d = new THREE.Vector3();
  const flat = points.map((p) => {
    d.copy(p).sub(o);
    return { x: d.dot(u), y: d.dot(v), p };
  });
  flat.sort((a, b) => a.x - b.x || a.y - b.y);
  /** @type {(o: {x: number, y: number}, a: {x: number, y: number}, b: {x: number, y: number}) => number} */
  const cross = (q, a, b) => (a.x - q.x) * (b.y - q.y) - (a.y - q.y) * (b.x - q.x);
  /** @type {typeof flat} */
  const lower = [];
  for (const q of flat) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-12) lower.pop();
    lower.push(q);
  }
  /** @type {typeof flat} */
  const upper = [];
  for (let i = flat.length - 1; i >= 0; i--) {
    const q = flat[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-12) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper).map((q) => q.p);
}

/**
 * A convex polygon cut down to the side each plane keeps.
 * @param {THREE.Vector3[]} polygon
 * @param {THREE.Plane[]} planes
 * @returns {THREE.Vector3[]} empty if nothing is left
 */
function clipPolygon(polygon, planes) {
  let out = polygon;
  for (const plane of planes) {
    /** @type {THREE.Vector3[]} */
    const next = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      const b = out[(i + 1) % out.length];
      const da = plane.distanceToPoint(a);
      const db = plane.distanceToPoint(b);
      if (da >= 0) next.push(a);
      if ((da >= 0) !== (db >= 0)) next.push(a.clone().lerp(b, da / (da - db)));
    }
    out = next;
    if (out.length < 3) return [];
  }
  return out;
}

/**
 * The cut faces of a piece, as flat triangles in the bake's space: for each
 * of its planes, every part's cross-section, held inside the piece's other
 * planes, so the face stops exactly where the body does.
 * @param {Bake} bake
 * @param {THREE.Plane[]} planes the piece's keep-side planes
 * @returns {THREE.BufferGeometry|null} null when no plane meets the body
 */
function buildCap(bake, planes) {
  /** @type {number[]} */
  const out = [];
  planes.forEach((plane, k) => {
    const others = planes.filter((_, j) => j !== k);
    for (const part of bake.parts) {
      const polygon = clipPolygon(convexHull(planePoints(bake, part, plane), plane.normal), others);
      for (let i = 1; i + 1 < polygon.length; i++) {
        for (const q of [polygon[0], polygon[i], polygon[i + 1]]) out.push(q.x, q.y, q.z);
      }
    }
  });
  if (!out.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(out), 3));
  return geometry;
}

/**
 * The average of the bake's vertices on the kept side of every plane: the
 * piece's pivot.
 * @param {Bake} bake
 * @param {THREE.Plane[]} planes
 * @returns {THREE.Vector3|null} null when no vertex is left (the plane misses the piece)
 */
function centroidOf(bake, planes) {
  const P = bake.positions;
  const sum = new THREE.Vector3();
  const p = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < P.length; i += 3) {
    p.set(P[i], P[i + 1], P[i + 2]);
    if (planes.every((plane) => plane.distanceToPoint(p) >= 0)) {
      sum.add(p);
      n++;
    }
  }
  return n ? sum.multiplyScalar(1 / n) : null;
}

/**
 * @param {Object} ctx
 * @param {{onCut?: (from: THREE.Vector3, to: THREE.Vector3, normal: THREE.Vector3, human?: boolean) => void}} [hooks]
 *   `onCut`: told of each alien cut, with the two ends of the cut line (world metres) and the
 *   plane's unit normal, read at once (the alien blood, goo.js)
 * @returns {KatanaPieces}
 */
export function createKatanaPieces(ctx, hooks = {}) {
  const { Sim } = ctx;
  const scene = Sim.three.scene;
  // Clipping planes on a material are ignored unless this is on. Set here, on
  // its own (the black hole's dissolve sets it too, but may never have run).
  Sim.three.renderer.localClippingEnabled = true;

  /** @type {Piece[]} oldest first */
  const live = [];
  /** @type {(Piece|null)[]} scratch for cutInReach: a piece list never longer than the cap */
  const candidates = new Array(CFG.maxPieces).fill(null);
  let warmed = false;

  const one = new THREE.Vector3(1, 1, 1);
  const matrix = new THREE.Matrix4();
  const spinStep = new THREE.Quaternion();
  const lever = new THREE.Vector3();
  const toLocal = new THREE.Quaternion();

  /**
   * Moves a piece's body and its clipping planes to where its pivot and
   * rotation say it is. No allocation.
   * @param {Piece} p
   * @returns {void}
   */
  function pose(p) {
    const q = p.body.quaternion;
    lever.copy(p.centre).applyQuaternion(q);
    p.body.position.copy(p.pos).sub(lever);
    matrix.compose(p.body.position, q, one);
    for (let i = 0; i < p.depth; i++) p.world[i].copy(p.local[i]).applyMatrix4(matrix);
  }

  /**
   * Takes a piece out of play: out of the scene, every clone and cap
   * disposed, the bake's geometry too if this was its last user.
   * @param {Piece} p
   * @returns {void}
   */
  function release(p) {
    if (p.dead) return;
    p.dead = true;
    const i = live.indexOf(p);
    if (i >= 0) live.splice(i, 1);
    scene.remove(p.body);
    for (const m of p.materials) m.dispose();
    p.capMaterial.dispose();
    if (p.cap) p.cap.geometry.dispose();
    p.bake.refs--;
    if (p.bake.refs <= 0) disposeBake(p.bake);
  }

  /**
   * Makes room for `extra` more pieces by recycling the oldest.
   * @param {number} extra
   * @param {Piece|null} keep a piece that must not be the one recycled
   * @returns {void}
   */
  function makeRoom(extra, keep) {
    while (live.length + extra > CFG.maxPieces) {
      const oldest = live.find((p) => p !== keep);
      if (!oldest) return;
      release(oldest);
    }
  }

  /**
   * One piece, in the scene.
   * @param {Bake} bake
   * @param {THREE.Plane[]} local its keep-side planes (taken, not copied)
   * @param {THREE.Vector3} centre its pivot in the bake's space
   * @param {THREE.Vector3} pos its pivot in the world
   * @param {THREE.Quaternion} quat its rotation
   * @param {THREE.Vector3} velocity
   * @param {THREE.Vector3} spinAxis
   * @param {number} spinRate
   * @returns {Piece}
   */
  function spawn(bake, local, centre, pos, quat, velocity, spinAxis, spinRate) {
    bake.refs++;
    const world = [0, 1, 2].map(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), NEVER));
    const skin = bake.skin.clone();
    const detail = bake.detail.clone();
    // The same three planes on both: the pieces' own draws never cast
    // shadows, so clipShadows (for the shadow pass) is not needed.
    skin.clippingPlanes = world;
    detail.clippingPlanes = world;
    const body = new THREE.Mesh(bake.geometry, [skin, detail]);
    body.name = 'katana_piece';
    body.castShadow = false;
    body.receiveShadow = false;
    body.quaternion.copy(quat);
    const [r, g, b] = bake.human ? CFG.bloodCapColour : CFG.capColour;
    const capMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(r, g, b), side: THREE.DoubleSide, transparent: true
    });
    const capGeometry = buildCap(bake, local);
    /** @type {THREE.Mesh|null} */
    let cap = null;
    if (capGeometry) {
      cap = new THREE.Mesh(capGeometry, capMaterial);
      cap.name = 'katana_cut';
      cap.castShadow = false;
      body.add(cap);
    }
    /** @type {Piece} */
    const piece = {
      bake, body, cap, materials: [skin, detail], capMaterial, local, world, depth: local.length,
      centre, pos: pos.clone(), velocity: velocity.clone(), spinAxis: spinAxis.clone(), spinRate,
      age: 0, resting: false, dead: false
    };
    pose(piece);
    scene.add(body);
    live.push(piece);
    return piece;
  }

  /**
   * A random spin: an axis and a rate.
   * @param {THREE.Vector3} axis written in place
   * @returns {number} the rate, radians per second
   */
  function randomSpin(axis) {
    axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    if (axis.lengthSq() < 1e-6) axis.set(0, 0, 1);
    axis.normalize();
    return CFG.spin[0] + Math.random() * (CFG.spin[1] - CFG.spin[0]);
  }

  /**
   * The push of one half: along the cut's normal, away from the other half,
   * with a pop upward (a half pushed into the ground only gets the pop).
   * @param {THREE.Vector3} out written in place
   * @param {THREE.Vector3} normal world, unit
   * @param {number} sign +1 for the half the normal points into, -1 for the other
   * @param {number} scale how hard (re-cuts push less)
   * @returns {THREE.Vector3} out
   */
  function push(out, normal, sign, scale) {
    out.copy(normal).multiplyScalar(sign * CFG.pushSpeed * scale);
    if (out.y < 0) out.y *= 0.25;
    out.y += CFG.popSpeed * scale;
    return out;
  }

  const lineA = new THREE.Vector3();
  const lineB = new THREE.Vector3();

  /**
   * Tells `hooks.onCut` where the cut line lies: the longest stretch of the
   * body's cross-section with the plane (its two farthest points).
   * @param {Bake} bake
   * @param {THREE.Plane} plane the cut plane in the bake's space
   * @param {THREE.Vector3} normal the cut's unit normal
   * @returns {void}
   */
  function announceCut(bake, plane, normal) {
    /** @type {THREE.Vector3[]} */
    const points = [];
    for (const part of bake.parts) points.push(...planePoints(bake, part, plane));
    if (points.length === 0 || !hooks.onCut) return;
    /** @type {(from: THREE.Vector3) => THREE.Vector3} */
    const farthest = (from) => points.reduce((best, p) => (p.distanceToSquared(from) > best.distanceToSquared(from) ? p : best), from);
    const a = farthest(points[0]);
    const b = farthest(a);
    lineA.copy(a).add(bake.origin);
    lineB.copy(b).add(bake.origin);
    hooks.onCut(lineA, lineB, normal, bake.human === true);
  }

  /**
   * The alien owner's hand-over: the root is baked, taken out of the scene
   * (resetAliens' later scene.remove and skin.dispose are then harmless) and
   * becomes two pieces, flung apart along the cut's normal.
   * @param {THREE.Object3D} root
   * @param {CutPlaneLike} [plane] world space, read at once (the slash reuses it)
   * @param {THREE.Material} [skin] the alien's skin material
   * @returns {void}
   */
  function takeOver(root, plane, skin) {
    const bake = bakeAlien(root, skin);
    scene.remove(root);
    if (!bake) return;
    // A person is handed over without an alien skin: red blood, not green.
    bake.human = skin === undefined;
    const normal = plane ? plane.normal.clone().normalize() : new THREE.Vector3(1, 0, 0);
    const point = plane ? plane.point.clone().sub(bake.origin) : new THREE.Vector3(0, 0.7, 0);
    const keepA = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
    const keepB = keepA.clone().negate();
    const centreA = centroidOf(bake, [keepA]);
    const centreB = centroidOf(bake, [keepB]);
    if (!centreA || !centreB) {
      // The plane misses the body: nothing to show, and nothing to leak.
      disposeBake(bake);
      return;
    }
    if (hooks.onCut) announceCut(bake, keepA, normal);
    makeRoom(2, null);
    const identity = new THREE.Quaternion();
    const velocity = new THREE.Vector3();
    const axis = new THREE.Vector3();
    spawn(bake, [keepA], centreA, centreA.clone().add(bake.origin), identity, push(velocity, normal, 1, 1), axis, randomSpin(axis));
    spawn(bake, [keepB], centreB, centreB.clone().add(bake.origin), identity, push(velocity, normal, -1, 1), axis, randomSpin(axis));
  }

  /**
   * Splits a piece by a world plane into two more.
   * @param {Piece} piece
   * @param {CutPlaneLike} plane
   * @returns {boolean} false if it is gone, already as deep as it can be, or the plane misses it
   */
  function cutPiece(piece, plane) {
    if (piece.dead || piece.depth >= CFG.maxDepth) return false;
    const bake = piece.bake;
    // The plane in the bake's space: undo the piece's rotation about its pivot.
    toLocal.copy(piece.body.quaternion).invert();
    const nWorld = plane.normal.clone().normalize();
    const nLocal = nWorld.clone().applyQuaternion(toLocal);
    const pLocal = plane.point.clone().sub(piece.pos).applyQuaternion(toLocal).add(piece.centre);
    const keepA = new THREE.Plane().setFromNormalAndCoplanarPoint(nLocal, pLocal);
    const keepB = keepA.clone().negate();
    const planesA = piece.local.map((q) => q.clone()).concat(keepA);
    const planesB = piece.local.map((q) => q.clone()).concat(keepB);
    const centreA = centroidOf(bake, planesA);
    const centreB = centroidOf(bake, planesB);
    if (!centreA || !centreB) return false;
    makeRoom(1, piece);

    const q = piece.body.quaternion;
    const velocity = new THREE.Vector3();
    /** @type {[THREE.Plane[], THREE.Vector3, number][]} */
    const halves = [[planesA, centreA, 1], [planesB, centreB, -1]];
    for (const [planes, centre, sign] of halves) {
      // Where its pivot is now: the parent's pivot, moved by the difference of centres.
      const pos = centre.clone().sub(piece.centre).applyQuaternion(q).add(piece.pos);
      push(velocity, nWorld, sign, 0.6).add(piece.velocity);
      spawn(bake, planes, centre, pos, q, velocity, piece.spinAxis, piece.spinRate);
    }
    release(piece);
    return true;
  }

  /**
   * Cuts every piece in reach (the quick slash's), the plane re-aimed through
   * each piece's pivot. Pieces born from this very call are not cut again.
   * @param {Reach} reach
   * @param {CutPlaneLike} plane
   * @returns {number} pieces cut
   */
  function cutInReach(reach, plane) {
    let n = 0;
    for (let i = 0; i < live.length && n < candidates.length; i++) {
      const p = live[i];
      if (p.depth >= CFG.maxDepth) continue;
      if (reach.y !== undefined && Math.abs(p.pos.y - reach.y) > REACH_HEIGHT) continue;
      if (!inReach(reach, p.pos.x, p.pos.z, PIECE_RADIUS)) continue;
      candidates[n++] = p;
    }
    let cut = 0;
    for (let i = 0; i < n; i++) {
      const p = candidates[i];
      candidates[i] = null;
      if (!p || p.dead) continue;
      plane.point.copy(p.pos);
      if (cutPiece(p, plane)) cut++;
    }
    return cut;
  }

  /**
   * One piece's motion: gravity, the ground, the spin.
   * @param {Piece} p
   * @param {number} dt world seconds
   * @returns {void}
   */
  function move(p, dt) {
    const v = p.velocity;
    v.y -= CFG.gravity * dt;
    p.pos.addScaledVector(v, dt);
    spinStep.setFromAxisAngle(p.spinAxis, p.spinRate * dt);
    p.body.quaternion.premultiply(spinStep).normalize();
    if (p.pos.y <= CFG.restHeight) {
      p.pos.y = CFG.restHeight;
      if (v.y < -CFG.bounceMin) {
        v.y = -v.y * CFG.restitution;
        v.x *= CFG.bounceFriction;
        v.z *= CFG.bounceFriction;
        p.spinRate *= 0.6;
      } else {
        v.y = 0;
        const k = Math.exp(-CFG.groundDrag * dt);
        v.x *= k;
        v.z *= k;
        p.spinRate *= k;
        if (Math.hypot(v.x, v.z) < CFG.restSpeed) {
          v.set(0, 0, 0);
          p.spinRate = 0;
          p.resting = true;
        }
      }
    }
    pose(p);
  }

  /**
   * Per frame, on the world clock. Allocates nothing.
   * @param {number} dt world seconds
   * @returns {void}
   */
  function update(dt) {
    if (dt <= 0) return;
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.age += dt;
      if (p.age >= CFG.lifetime) {
        release(p);
        continue;
      }
      if (!p.resting) move(p, dt);
      const left = CFG.lifetime - p.age;
      if (left < CFG.fadeSeconds) {
        const alpha = left / CFG.fadeSeconds;
        p.materials[0].opacity = alpha;
        p.materials[1].opacity = alpha;
        p.capMaterial.opacity = alpha;
      }
    }
  }

  /**
   * @param {(piece: Piece) => void} visit
   * @returns {void}
   */
  function each(visit) {
    for (let i = 0; i < live.length; i++) visit(live[i]);
  }

  /**
   * Builds the shader variants the pieces use now, so the first cut does not
   * stall on compiling them: a throwaway pair of meshes with the same
   * materials (three clipping planes, vertex colours, transparent) is
   * compiled against the scene's own lights and fog, into the render target
   * the scene is drawn to. Harmless if it cannot.
   * @returns {void}
   */
  function prewarm() {
    if (warmed) return;
    warmed = true;
    const { renderer, camera } = Sim.three;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 0.01, 0, 0.01, 0, 0]), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9).fill(1), 3));
    const planes = [0, 1, 2].map(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), NEVER));
    const body = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true });
    body.clippingPlanes = planes;
    const face = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true });
    const probe = new THREE.Group();
    probe.add(new THREE.Mesh(geometry, body), new THREE.Mesh(geometry, face));
    const post = ctx.systems.post;
    const target = post && post.Post ? post.Post.sceneTarget : null;
    const previous = renderer.getRenderTarget();
    try {
      if (target) renderer.setRenderTarget(target);
      renderer.compile(probe, camera, scene);
    } catch {
      // A failed pre-warm only costs the first cut a hitch.
    } finally {
      renderer.setRenderTarget(previous);
      body.dispose();
      face.dispose();
      geometry.dispose();
    }
  }

  /** @returns {void} */
  function clear() {
    for (let i = live.length - 1; i >= 0; i--) release(live[i]);
  }

  /** @returns {void} */
  function dispose() {
    clear();
  }

  return { takeOver, cutPiece, cutInReach, each, count: () => live.length, prewarm, clear, dispose, update };
}
