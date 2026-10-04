// @ts-check
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * ===========================================================================
 * SECTION PZ.1 — The Replicator's body
 * ===========================================================================
 * Patient Zero and its clones, redrawn (on request, 2026-10-04: "very, very
 * dangerous to look at"; after the self-assembling block machines of science
 * fiction, our own design): a gaunt, hunched thing of dark chrome blocks
 * about 2.1 m tall. A wasp waist under a ribcage of plates with acid-green
 * light in the gaps and a slit core; spikes down the spine and off the
 * shoulders; a long eyeless-looking head swept back into a crest, two
 * mandibles, and four small red eyes; arms down past its knees ending in
 * three claws of green light; back-bent, digitigrade legs on clawed toes.
 *
 * One material for all of it (glowMaterial): dark metal, plus a per-vertex
 * glow colour (`aGlow`) added as emissive, so the green veins and red eyes
 * are the same draw call as the metal. Its `uGlow` uniform (material
 * .userData.glow) pulses or flares them all at once; `uTint`
 * (material.userData.tint, a colour multiplying the glow) heats the green
 * towards a searing lime as the swarm nears the encirclement.
 *
 * Six parts, each one merged geometry posed from its pivot: body, head,
 * left / right arm, left / right leg. The original builds them as meshes in
 * a group; the clones draw each as one InstancedMesh (six draw calls for all
 * fifty). Local frame: feet at y = 0, +z ahead.
 */

export const REPLICATOR = {
  height: 2.1,
  metal: 0x262c34,
  green: new THREE.Color(0.12, 1.5, 0.3),
  greenHot: new THREE.Color(0.35, 2.4, 0.55),
  red: new THREE.Color(3, 0.12, 0.06),
  // Where each part hangs from, in the local frame.
  pivots: {
    head: new THREE.Vector3(0, 1.9, 0.1),
    armL: new THREE.Vector3(0.34, 1.72, -0.02),
    armR: new THREE.Vector3(-0.34, 1.72, -0.02),
    legL: new THREE.Vector3(0.12, 1.0, 0),
    legR: new THREE.Vector3(-0.12, 1.0, 0)
  }
};

/** @typedef {'body'|'head'|'armL'|'armR'|'legL'|'legR'} PartName */
export const PARTS = /** @type {PartName[]} */ (['body', 'head', 'armL', 'armR', 'legL', 'legR']);

/**
 * Dark metal with a per-vertex emissive glow (`aGlow`) scaled by `uGlow`.
 * @param {number} [glow] the starting strength
 * @returns {THREE.MeshStandardMaterial}
 */
export function glowMaterial(glow = 1) {
  const material = new THREE.MeshStandardMaterial({ color: REPLICATOR.metal, metalness: 0.85, roughness: 0.32 });
  const uniform = { value: glow };
  const tint = { value: new THREE.Color(1, 1, 1) };
  material.userData.glow = uniform;
  material.userData.tint = tint;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = uniform;
    shader.uniforms.uTint = tint;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aGlow;\nvarying vec3 vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGlow;\nuniform vec3 uTint;\nvarying vec3 vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow * uTint * uGlow;');
  };
  material.customProgramCacheKey = () => 'replicatorGlow';
  return material;
}

const Y = Object.freeze(new THREE.Vector3(0, 1, 0));

/**
 * A geometry ready to merge: posed by `matrix`, non-indexed, with its glow.
 * @param {THREE.BufferGeometry} geo
 * @param {THREE.Matrix4} matrix
 * @param {THREE.Color|null} glow
 * @returns {THREE.BufferGeometry}
 */
function part(geo, matrix, glow) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.applyMatrix4(matrix);
  const n = g.attributes.position.count;
  const colours = new Float32Array(n * 3);
  if (glow) {
    for (let i = 0; i < n; i++) {
      colours[i * 3] = glow.r;
      colours[i * 3 + 1] = glow.g;
      colours[i * 3 + 2] = glow.b;
    }
  }
  g.setAttribute('aGlow', new THREE.BufferAttribute(colours, 3));
  return g;
}

/**
 * A geometry lit all over in one colour (or not at all), for things made
 * outside the six parts (the original's orbiting blocks, the shards).
 * @param {THREE.BufferGeometry} geo
 * @param {THREE.Color|null} colour
 * @returns {THREE.BufferGeometry}
 */
export function withGlow(geo, colour) {
  return part(geo, new THREE.Matrix4(), colour);
}

/**
 * Collects the pieces of one part.
 */
class Kit {
  constructor() {
    /** @type {THREE.BufferGeometry[]} */
    this.pieces = [];
    // Scratch for placing pieces (per kit: no module-level state).
    this.q = new THREE.Quaternion();
    this.m = new THREE.Matrix4();
    this.s = new THREE.Vector3();
    this.d = new THREE.Vector3();
  }

  /**
   * A box centred at `at`, turned by the Euler angles.
   * @param {number} w @param {number} h @param {number} d
   * @param {THREE.Vector3} at
   * @param {THREE.Euler} [turn]
   * @param {THREE.Color|null} [glow]
   * @returns {this}
   */
  box(w, h, d, at, turn, glow = null) {
    this.q.setFromEuler(turn || new THREE.Euler());
    this.pieces.push(part(new THREE.BoxGeometry(w, h, d), this.m.compose(at, this.q, this.s.set(1, 1, 1)), glow));
    return this;
  }

  /**
   * A tapered rod from a to b (radius ra at a, rb at b).
   * @param {THREE.Vector3} a @param {THREE.Vector3} b
   * @param {number} ra @param {number} rb
   * @param {number} [sides]
   * @param {THREE.Color|null} [glow]
   * @returns {this}
   */
  rod(a, b, ra, rb, sides = 6, glow = null) {
    this.d.subVectors(b, a);
    const len = this.d.length();
    this.q.setFromUnitVectors(Y, this.d.normalize());
    const mid = a.clone().add(b).multiplyScalar(0.5);
    this.pieces.push(part(new THREE.CylinderGeometry(rb, ra, len, sides), this.m.compose(mid, this.q, this.s.set(1, 1, 1)), glow));
    return this;
  }

  /**
   * A spike: a cone with its base at `from`, pointing along `dir`.
   * @param {THREE.Vector3} from @param {THREE.Vector3} dir
   * @param {number} r @param {number} h
   * @param {THREE.Color|null} [glow]
   * @param {number} [sides]
   * @returns {this}
   */
  spike(from, dir, r, h, glow = null, sides = 4) {
    const geo = new THREE.ConeGeometry(r, h, sides);
    geo.translate(0, h / 2, 0);
    this.q.setFromUnitVectors(Y, this.d.copy(dir).normalize());
    this.pieces.push(part(geo, this.m.compose(from, this.q, this.s.set(1, 1, 1)), glow));
    return this;
  }

  /**
   * Any geometry, placed and scaled.
   * @param {THREE.BufferGeometry} geo
   * @param {THREE.Vector3} at @param {THREE.Euler} turn @param {THREE.Vector3} scale
   * @param {THREE.Color|null} [glow]
   * @returns {this}
   */
  shape(geo, at, turn, scale, glow = null) {
    this.q.setFromEuler(turn);
    this.pieces.push(part(geo, this.m.compose(at, this.q, scale), glow));
    return this;
  }

  /**
   * Small blocks stuck on the surface round `at` (the nanite look): a few
   * boxes of random size and turn, from a seeded sequence so every build is
   * the same.
   * @param {THREE.Vector3} at
   * @param {THREE.Vector3} spread half extents of where they go
   * @param {number} n
   * @param {number} seed
   * @returns {this}
   */
  blocks(at, spread, n, seed) {
    let state = seed * 9301 + 49297;
    const rand = () => {
      state = (state * 9301 + 49297) % 233280;
      return state / 233280;
    };
    for (let i = 0; i < n; i++) {
      const size = 0.03 + rand() * 0.05;
      const glow = rand() < 0.18 ? REPLICATOR.green : null;
      this.box(size, size * (0.6 + rand()), size, v(at.x + (rand() * 2 - 1) * spread.x, at.y + (rand() * 2 - 1) * spread.y, at.z + (rand() * 2 - 1) * spread.z),
        e(rand() * 3, rand() * 3, rand() * 3), glow);
    }
    return this;
  }

  /** @returns {THREE.BufferGeometry} */
  merge() {
    const merged = mergeGeometries(this.pieces);
    for (const g of this.pieces) g.dispose();
    this.pieces = [];
    merged.computeBoundingSphere();
    return /** @type {THREE.BufferGeometry} */ (merged);
  }
}

const v = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => new THREE.Vector3(x, y, z);
const e = (/** @type {number} */ x, /** @type {number} */ y = 0, /** @type {number} */ z = 0) => new THREE.Euler(x, y, z);

/** @returns {THREE.BufferGeometry} the torso, in the local frame */
function buildBody() {
  const G = REPLICATOR.green;
  const k = new Kit();
  // Pelvis and the wasp waist.
  k.box(0.3, 0.14, 0.2, v(0, 1.0, 0));
  k.rod(v(0, 1.04, 0), v(0, 1.3, -0.02), 0.06, 0.05, 6);
  k.rod(v(0, 1.1, 0.05), v(0, 1.26, 0.05), 0.02, 0.02, 4, G);
  // The ribcage, hunched forward, and its plates with light between them.
  k.shape(new THREE.CylinderGeometry(0.25, 0.13, 0.5, 6), v(0, 1.5, 0.02), e(0.3), v(1, 1, 0.72));
  for (let i = 0; i < 4; i++) {
    const y = 1.36 + i * 0.075;
    k.box(0.3 - i * 0.02 + 0.06 * (i % 2), 0.018, 0.03, v(0, y, 0.15 + i * 0.022), e(0.3), G);
    k.box(0.36 - i * 0.03, 0.045, 0.05, v(0, y + 0.035, 0.13 + i * 0.022), e(0.3));
  }
  // The core: a slit of hot light.
  k.box(0.05, 0.2, 0.03, v(0, 1.55, 0.21), e(0.3), REPLICATOR.greenHot);
  // Collar and shoulders, with spikes.
  k.box(0.46, 0.08, 0.2, v(0, 1.72, -0.03), e(0.2));
  for (const s of [-1, 1]) {
    k.box(0.17, 0.13, 0.2, v(s * 0.29, 1.73, -0.02), e(0.1, 0, s * -0.2));
    k.spike(v(s * 0.31, 1.78, -0.05), v(s * 0.55, 1, -0.4), 0.05, 0.36);
    k.spike(v(s * 0.24, 1.76, -0.1), v(s * 0.25, 1, -0.7), 0.035, 0.24);
  }
  // Spikes down the spine, and a line of light under them.
  for (let i = 0; i < 6; i++) {
    const y = 1.22 + i * 0.11;
    k.spike(v(0, y, -0.15 - i * 0.012), v(0, 0.55, -1), 0.03, 0.14 + i * 0.03);
  }
  k.box(0.022, 0.62, 0.02, v(0, 1.5, -0.16), e(-0.1), G);
  // Neck to the head's pivot.
  k.rod(v(0, 1.74, 0), REPLICATOR.pivots.head, 0.045, 0.04, 6);
  // Its blocks, crusted on the back, the shoulders and the hips.
  k.blocks(v(0, 1.52, -0.12), v(0.2, 0.22, 0.05), 16, 1);
  for (const s of [-1, 1]) k.blocks(v(s * 0.3, 1.74, -0.02), v(0.07, 0.07, 0.09), 6, s > 0 ? 2 : 3);
  k.blocks(v(0, 0.98, 0), v(0.16, 0.06, 0.1), 8, 4);
  return k.merge();
}

/** @returns {THREE.BufferGeometry} the head, from its pivot */
function buildHead() {
  const R = REPLICATOR.red;
  const k = new Kit();
  // A long skull, swept back into a crest.
  k.box(0.17, 0.16, 0.3, v(0, 0.07, 0.05), e(-0.12));
  k.spike(v(0, 0.12, -0.04), v(0, 0.45, -1), 0.085, 0.46);
  k.spike(v(0, 0.02, -0.06), v(0, -0.1, -1), 0.05, 0.22);
  for (const s of [-1, 1]) {
    k.spike(v(s * 0.08, 0.1, -0.02), v(s * 0.8, 0.5, -1), 0.03, 0.2);
    // Mandibles.
    k.spike(v(s * 0.055, -0.01, 0.16), v(s * 0.25, -1, 0.55), 0.025, 0.17);
  }
  // A face plate and four small red eyes, two rows, angled.
  k.box(0.15, 0.09, 0.02, v(0, 0.06, 0.205), e(-0.12));
  for (const s of [-1, 1]) {
    k.box(0.04, 0.016, 0.02, v(s * 0.038, 0.088, 0.219), e(-0.12, 0, s * 0.35), R);
    k.box(0.028, 0.013, 0.02, v(s * 0.05, 0.048, 0.214), e(-0.12, 0, s * 0.35), R);
  }
  return k.merge();
}

/**
 * @param {number} s +1 left, -1 right
 * @returns {THREE.BufferGeometry} an arm, from its shoulder
 */
function buildArm(s) {
  const G = REPLICATOR.green;
  const k = new Kit();
  const elbow = v(s * 0.04, -0.5, -0.04);
  const wrist = v(s * 0.03, -0.94, 0.22);
  k.box(0.11, 0.11, 0.11, v(0, 0, 0));
  k.rod(v(0, 0, 0), elbow, 0.05, 0.035, 5);
  k.spike(v(s * 0.04, -0.5, -0.07), v(0, 0.25, -1), 0.03, 0.2);
  k.rod(elbow, wrist, 0.045, 0.028, 4);
  // A blade along the forearm, lit on its edge.
  k.rod(v(s * 0.075, -0.55, 0.0), v(s * 0.06, -0.9, 0.2), 0.012, 0.006, 4, G);
  k.box(0.07, 0.07, 0.07, wrist);
  k.blocks(v(s * 0.02, -0.25, -0.02), v(0.04, 0.2, 0.04), 7, s > 0 ? 5 : 6);
  // Three claws of light.
  for (const spread of [-1, 0, 1]) {
    k.spike(wrist, v(s * 0.12 + spread * 0.18, -1, 0.55 - Math.abs(spread) * 0.1), 0.022, 0.4, G, 3);
  }
  return k.merge();
}

/**
 * @param {number} s +1 left, -1 right
 * @returns {THREE.BufferGeometry} a leg, from its hip
 */
function buildLeg(s) {
  const G = REPLICATOR.green;
  const k = new Kit();
  const knee = v(s * 0.03, -0.42, 0.2);
  const ankle = v(s * 0.03, -0.8, -0.08);
  const ball = v(s * 0.03, -0.98, 0.08);
  k.rod(v(0, 0, 0), knee, 0.075, 0.05, 5);
  k.spike(knee, v(0, 0.6, 1), 0.035, 0.18);
  k.rod(knee, ankle, 0.05, 0.03, 4);
  k.rod(v(s * 0.06, -0.45, 0.15), v(s * 0.055, -0.76, -0.06), 0.01, 0.01, 4, G);
  k.rod(ankle, ball, 0.032, 0.026, 4);
  k.spike(ankle, v(0, 0.3, -1), 0.025, 0.16);
  for (const spread of [-1, 1]) k.spike(ball, v(spread * 0.35, -0.12, 1), 0.024, 0.2);
  k.blocks(v(s * 0.015, -0.2, 0.1), v(0.06, 0.18, 0.05), 7, s > 0 ? 7 : 8);
  return k.merge();
}

/**
 * The evolved original's back scythe (patientZero.js evolution): a jointed
 * limb rising from behind the shoulder, up and back, then a long curved blade
 * of dark metal sweeping forward and down over it, lit along its edge, with
 * barbs. From its pivot (on the upper back).
 * @param {number} s +1 left, -1 right
 * @returns {THREE.BufferGeometry}
 */
function buildScythe(s) {
  const G = REPLICATOR.greenHot;
  const k = new Kit();
  const knee = v(s * 0.12, 0.62, -0.28);
  k.box(0.1, 0.1, 0.1, v(0, 0, 0));
  k.rod(v(0, 0, 0), knee, 0.055, 0.04, 5);
  k.spike(knee, v(s * 0.2, 0.5, -1), 0.04, 0.28);
  k.box(0.09, 0.09, 0.09, knee);
  // The blade: three flattened segments curving forward and down.
  const points = [knee, v(s * 0.16, 0.78, 0.15), v(s * 0.18, 0.62, 0.62), v(s * 0.17, 0.25, 0.95)];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const width = 0.11 - i * 0.03;
    // A flat rod: a four-sided cylinder squashed sideways.
    const len = a.distanceTo(b);
    const geo = new THREE.CylinderGeometry(width * 0.6, width, len, 4);
    geo.scale(0.25, 1, 1);
    k.d.subVectors(b, a).normalize();
    k.q.setFromUnitVectors(Y, k.d);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    k.pieces.push(part(geo, k.m.compose(mid, k.q, k.s.set(1, 1, 1)), null));
    // The lit edge, along its underside.
    k.rod(v(a.x, a.y - width * 0.45, a.z + 0.02), v(b.x, b.y - width * 0.45 + 0.02, b.z + 0.02), 0.012, 0.008, 4, G);
    k.spike(mid, v(0, 0.6, -0.4), 0.02, 0.12);
  }
  k.spike(points[3], v(0, -1, 0.4), 0.03, 0.3, G, 3);
  return k.merge();
}

/**
 * The evolution's extra geometry, built once.
 * @returns {{scytheL: THREE.BufferGeometry, scytheR: THREE.BufferGeometry}}
 */
export function buildEvolvedGeometry() {
  return { scytheL: buildScythe(1), scytheR: buildScythe(-1) };
}

/**
 * Every part's geometry, built once.
 * @returns {Record<PartName, THREE.BufferGeometry>}
 */
export function buildReplicatorGeometry() {
  return {
    body: buildBody(),
    head: buildHead(),
    armL: buildArm(1),
    armR: buildArm(-1),
    legL: buildLeg(1),
    legR: buildLeg(-1)
  };
}

/**
 * The pose of one figure, written by poseReplicator and read into the
 * meshes or the instances. Angles in radians.
 * @typedef {Object} Pose
 * @property {number} lift body up from the ground (the step's spring)
 * @property {number} lean forward tilt of the whole figure
 * @property {number} roll side to side
 * @property {number} legL @property {number} legR swing about x
 * @property {number} armL @property {number} armR swing about x
 * @property {number} armSpread how far the arms open out (z)
 * @property {number} headYaw @property {number} headPitch @property {number} headRoll
 */

/** @returns {Pose} */
export function makePose() {
  return { lift: 0, lean: 0, roll: 0, legL: 0, legR: 0, armL: 0, armR: 0, armSpread: 0, headYaw: 0, headPitch: 0, headRoll: 0 };
}

/**
 * A figure's pose this frame: its stride (`cycle`, radians), how fast it is
 * going (0..1+), how far its arms are raised to strike or to throw (0..1),
 * and the head's twitch.
 * @param {Pose} out
 * @param {number} cycle
 * @param {number} pace
 * @param {number} attack
 * @param {{yaw: number, pitch: number, roll: number}} twitch
 * @returns {Pose}
 */
export function poseReplicator(out, cycle, pace, attack, twitch) {
  const s = Math.sin(cycle);
  const amp = Math.min(1.2, pace) * 0.7;
  out.legL = s * amp;
  out.legR = -s * amp;
  out.lift = Math.abs(Math.cos(cycle)) * 0.06 * Math.min(1, pace);
  // Hunched, and further over at a sprint; arms swinging loose, or up and
  // open, claws forward, as it closes.
  out.lean = 0.12 + 0.18 * Math.min(1, pace) + attack * 0.1;
  out.roll = Math.sin(cycle * 0.5) * 0.04;
  const swing = -s * amp * 0.8 * (1 - attack);
  out.armL = swing - attack * 1.25;
  out.armR = -swing - attack * 1.25;
  out.armSpread = 0.12 + attack * 0.5;
  out.headYaw = twitch.yaw;
  out.headPitch = twitch.pitch - out.lean * 0.6;
  out.headRoll = twitch.roll;
  return out;
}

/**
 * A part's rotation in the pose.
 * @param {PartName} name
 * @param {Pose} pose
 * @param {THREE.Euler} out
 * @returns {THREE.Euler}
 */
export function partTurn(name, pose, out) {
  switch (name) {
    case 'head': return out.set(pose.headPitch, pose.headYaw, pose.headRoll, 'YXZ');
    case 'armL': return out.set(pose.armL, 0, pose.armSpread, 'XYZ');
    case 'armR': return out.set(pose.armR, 0, -pose.armSpread, 'XYZ');
    case 'legL': return out.set(pose.legL, 0, 0.04, 'XYZ');
    case 'legR': return out.set(pose.legR, 0, -0.04, 'XYZ');
    default: return out.set(0, 0, 0);
  }
}
