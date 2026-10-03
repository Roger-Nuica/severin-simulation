// @ts-check
import * as THREE from 'three';
import { PERSON_SCALE } from '../../environment/people.js';

/**
 * ===========================================================================
 * SECTION HK.1 — The Katana's model, Roger's poses and the blade trail
 * ===========================================================================
 * The katana (blade with a thin glowing edge, guard, grip), the sheath on
 * Roger's back, the poses he takes with them -- draw, a two-handed low ready
 * stance with a slight breathing sway, run with the blade held back, six
 * slashes, holster -- and the swoosh the blade leaves during a slash.
 *
 * One rig is made per run (from buildRoger) and keeps all its state in its own
 * closure. Its meshes are made through heroMode.js's keepGeo/keepMat, so they
 * go with the rest of a run's resources, and they hang off Roger's root, so
 * they leave the scene with him. Nothing here decides when to slash or what a
 * slash touches: Subtask 6 calls `slash(kind)`; this file only animates it.
 *
 * The figure's arms are rigid sticks that hang along local -y from the
 * shoulder (hero/models.js, environment/people.js), so a hand is placed by
 * aiming the whole arm at it (`reachArm`): the right hand is always exactly on
 * the grip, and the left hand meets it when the pose is within its reach.
 * Local units are metres before the figure's own PERSON_SCALE.
 */

/** @typedef {'vertical'|'verticalUp'|'horizontal'|'horizontalBack'|'diagonalLeft'|'diagonalRight'} SlashKind */

/** The slash poses the animation knows, for the slash logic to pick from. */
export const SLASH_KINDS = /** @type {readonly SlashKind[]} */ (
  ['vertical', 'verticalUp', 'horizontal', 'horizontalBack', 'diagonalLeft', 'diagonalRight']
);

/**
 * @typedef {Object} KatanaRig
 * @property {(roger: Object) => void} attach hangs the sheath, katana and trail on Roger
 * @property {(dt: number, selected: boolean, drawn: boolean, run: number, interrupted: boolean) => boolean} step
 *   moves the animation on; true while the katana is in his hands (the arms are then the rig's)
 * @property {(armL: THREE.Object3D, armR: THREE.Object3D) => void} applyArms poses the arms on the grip
 * @property {(kind: SlashKind) => boolean} slash starts a slash; false unless the katana is drawn
 * @property {() => boolean} isSlashing
 * @property {(cam: THREE.Camera, active: boolean) => void} placeView puts the first-person blade in the
 *   camera's frame (hidden unless `active` and the katana is in his hands)
 * @property {() => void} disposeView takes the first-person blade out of the scene
 */

// (The grip points were fitted so both fists meet the grip with the figure's
// rigid 0.52 arms from shoulders at x = +/-0.36, y = 1.43.)
// A pose is six numbers: where the right (top) hand grips, in Roger's local
// space, and the blade's pitch, roll and yaw. Pitch is measured from straight
// up toward forward (+z), roll tips the blade sideways, yaw swings it about
// the vertical.
const HX = 0;
const HY = 1;
const HZ = 2;
const PITCH = 3;
const ROLL = 4;
const YAW = 5;

/** @type {Readonly<Record<string, ReadonlyArray<number>>>} */
export const POSES = {
  // Two hands low in front, the tip forward and a little above the hands.
  ready: [0.02, 1.17, 0.29, 1.0, 0, 0.12],
  // Run: the blade carried back and down along the right side, left arm free.
  run: [0.3, 1.0, 0.16, -2.3, 0.28, 0],
  // The draw's start and the holster's end: the hand over the right shoulder
  // on the hilt in the sheath on his back, the blade still along it.
  draw: [0.03, 1.78, -0.15, -0.85, 0.5, 0]
};

/** @type {Readonly<Record<SlashKind, {start: ReadonlyArray<number>, end: ReadonlyArray<number>}>>} */
export const SLASHES = {
  // Down from overhead, through the target.
  vertical: { start: [0.04, 1.76, 0.23, -0.3, 0, 0], end: [0.08, 1.11, 0.32, 2.4, 0, 0] },
  // Rising from low.
  verticalUp: { start: [0.08, 1.11, 0.32, 2.4, 0, 0], end: [0.04, 1.76, 0.23, -0.3, 0, 0] },
  // Across the chest, from the right shoulder's side to the left's.
  horizontal: { start: [0.16, 1.13, 0.31, 1.45, 0, 1.1], end: [-0.05, 1.3, 0.32, 1.45, 0, -1.0] },
  horizontalBack: { start: [-0.05, 1.3, 0.32, 1.45, 0, -1.0], end: [0.16, 1.13, 0.31, 1.45, 0, 1.1] },
  // High on one side to low on the other, and its mirror.
  diagonalLeft: { start: [0.16, 1.82, 0.21, -0.2, -0.7, 0], end: [-0.01, 1.17, 0.3, 2.2, 0.7, 0] },
  diagonalRight: { start: [-0.03, 1.7, 0.21, -0.2, 0.7, 0], end: [0.17, 1.11, 0.36, 2.2, -0.7, 0] }
};

const ARM_REACH = 0.52;          // shoulder to the fist, in the arm's own units
const LEFT_HAND_BELOW = 0.17;    // how far down the grip the pommel hand holds
const BLADE_LENGTH = 0.95;       // metres; R-024: about 0.9 to 1.0
const GRIP_LENGTH = 0.3;
const DRAW_SECONDS = 0.32;
const HOLSTER_SECONDS = 0.28;
const SLASH_SECONDS = 0.26;
const TRAIL_SAMPLES = 14;
const TRAIL_FADE_PER_SECOND = 6;
const TRAIL_FROM = 0.4;          // along the blade, from the guard (0 to 1)
// The slash: wind-up, strike, recovery, as fractions of its time.
const WIND_UP = 0.3;
const STRIKE_END = 0.62;
const BLADE_COLOUR = new THREE.Color(0.55, 2.0, 3.0);
// The first-person blade. Its pose is the third-person pose (so the swing
// shares the slash's timing and direction) moved to rest low on the right of
// the view: the grip point and angles are the idle values below plus how far
// the current pose is from the low ready, scaled to stay in frame. The frame
// is Roger's (forward +z, his left +x), measured from the eye, in metres.
// Raised and leaning forward (pitch 0.75) so the whole blade stands up in the
// frame, not edge-on along the line of sight as a near-level one would.
const VIEW_IDLE = [-0.26, -0.4, 0.5, 0.75, 0.12, -0.1];
const VIEW_HAND_SCALE = 1.0;
const VIEW_PITCH_SCALE = 0.85;
const VIEW_YAW_SCALE = 0.8;
const VIEW_MIN_FORWARD = 0.38;   // keeps the grip clear of the near plane (0.1)
const VIEW_SPIN = 0.9;           // turns the blade about its own axis to show its flat

/**
 * @param {number} t 0 to 1
 * @returns {number} a smooth ease in and out
 */
const ease = (t) => t * t * (3 - 2 * t);

/**
 * @param {Float64Array} out written in place
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 * @param {number} t 0 to 1
 * @returns {Float64Array} out
 */
function lerpPose(out, a, b, t) {
  for (let i = 0; i < 6; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}

/**
 * Turns an arm (which hangs along local -y and turns about x then z) so its
 * fist lies toward a point, in the same space as the arm's position.
 * @param {THREE.Object3D} arm
 * @param {number} tx
 * @param {number} ty
 * @param {number} tz
 * @param {Float64Array} out the x and z angles, written in place
 * @returns {Float64Array} out
 */
function armToward(arm, tx, ty, tz, out) {
  const dx = tx - arm.position.x;
  const dy = ty - arm.position.y;
  const dz = tz - arm.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  out[0] = Math.atan2(-dz / len, -dy / len);
  out[1] = Math.asin(THREE.MathUtils.clamp(dx / len, -1, 1));
  return out;
}

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see heroMode.js)
 * @param {{keepGeo: <G extends THREE.BufferGeometry>(g: G) => G, keepMat: <M extends THREE.Material>(m: M) => M}} kit
 * @returns {KatanaRig}
 */
export function createKatanaRig(ctx, S, kit) {
  const { keepGeo, keepMat } = kit;
  const unit = 1 / PERSON_SCALE;
  const bladeLength = BLADE_LENGTH * unit;
  const gripLength = GRIP_LENGTH * unit;
  const guardAt = 0.05;

  /** @type {THREE.Object3D|null} */
  let root = null;
  /** @type {THREE.Object3D|null} the arm that holds the grip */
  let armGrip = null;
  const katana = new THREE.Group();
  katana.name = 'hero_katana';
  katana.rotation.order = 'YXZ';
  katana.visible = false;
  const sheath = new THREE.Group();
  sheath.name = 'hero_katana_sheath';
  sheath.visible = false;
  /** @type {THREE.Mesh[]} the hilt and guard of the sword while it is in the sheath */
  const sheathedHilt = [];
  /** @type {THREE.Mesh|null} */
  let trailMesh = null;
  /** @type {THREE.Group|null} the first-person blade, in the scene (not on Roger) */
  let view = null;
  /** @type {THREE.Group|null} the first-person blade's hand, posed each frame */
  let holder = null;
  const viewFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

  // Animation state (all per rig, so per run).
  let clock = 0;
  let draw = 0;             // 0 sheathed .. 1 in the hands
  let drawing = false;
  let runBlend = 0;
  let slashT = 1;           // 1 = no slash in progress
  /** @type {SlashKind} */
  let slashKind = 'vertical';
  let trailFade = 0;
  let trailCount = 0;
  let driven = false;

  // Scratch, all reused every frame.
  const pose = new Float64Array(6);
  const base = new Float64Array(6);
  const mid = new Float64Array(6);
  const angleR = new Float64Array(2);
  const angleL = new Float64Array(2);
  const handL = new THREE.Vector3();
  const sample = new THREE.Vector3();
  const inverse = new THREE.Matrix4();
  const trailWorld = new Float64Array(TRAIL_SAMPLES * 6);
  let leftWeight = 0;

  // -------------------------------------------------------------------
  // Models
  // -------------------------------------------------------------------

  /**
   * @param {THREE.Group} group
   * @param {THREE.BufferGeometry} geometry
   * @param {THREE.Material} material
   * @param {number} y
   * @returns {THREE.Mesh}
   */
  const addPart = (group, geometry, material, y) => {
    const mesh = new THREE.Mesh(keepGeo(geometry), material);
    mesh.position.y = y;
    // Too thin to show in the shadow map, and every caster is drawn twice.
    mesh.castShadow = false;
    group.add(mesh);
    return mesh;
  };

  /**
   * The katana along local +y, the hand at the origin just under the guard and
   * the edge toward +z: steel blade, a thin glowing edge, a dark guard, a
   * wrapped grip.
   * @returns {void}
   */
  function buildKatana() {
    const steel = keepMat(new THREE.MeshStandardMaterial({ color: 0xc9d2de, metalness: 0.9, roughness: 0.2, emissive: 0x10161e }));
    const edge = keepMat(new THREE.MeshBasicMaterial({ color: BLADE_COLOUR }));
    const brass = keepMat(new THREE.MeshStandardMaterial({ color: 0x3a3226, metalness: 0.8, roughness: 0.35 }));
    const wrap = keepMat(new THREE.MeshStandardMaterial({ color: 0x14182a, roughness: 0.85 }));
    addPart(katana, new THREE.BoxGeometry(0.007, bladeLength, 0.034), steel, guardAt + bladeLength / 2);
    const glow = addPart(katana, new THREE.BoxGeometry(0.01, bladeLength, 0.007), edge, guardAt + bladeLength / 2);
    glow.position.z = 0.0185;
    addPart(katana, new THREE.CylinderGeometry(0.05, 0.05, 0.012, 10), brass, guardAt);
    addPart(katana, new THREE.BoxGeometry(0.03, gripLength, 0.032), wrap, guardAt - gripLength / 2);
  }

  /**
   * The first-person blade: meshes that share the katana's own geometry and
   * materials (nothing new to compile or dispose), the blade a little thicker
   * and turned to show its flat, hung in a group that follows the camera.
   * @returns {void}
   */
  function buildView() {
    view = new THREE.Group();
    view.name = 'hero_view_katana';
    view.visible = false;
    holder = new THREE.Group();
    holder.rotation.order = 'YXZ';
    holder.scale.setScalar(PERSON_SCALE);
    const spin = new THREE.Group();
    spin.rotation.y = VIEW_SPIN;
    // Wider and thicker than the third-person blade: seen from a hand's length away it must read at once.
  spin.scale.set(3, 1, 2.4);
    for (const part of katana.children) {
      const mesh = /** @type {THREE.Mesh} */ (part);
      const copy = new THREE.Mesh(mesh.geometry, mesh.material);
      copy.position.copy(mesh.position);
      copy.frustumCulled = false;
      copy.castShadow = false;
      spin.add(copy);
    }
    holder.add(spin);
    view.add(holder);
    ctx.Sim.three.scene.add(view);
  }

  /**
   * The sheath on his back, a diagonal from the hip up over the right
   * shoulder so it reads from the follow camera: the lacquered scabbard, and
   * the sword's guard and hilt standing out of it while it is holstered.
   * @returns {void}
   */
  function buildSheath() {
    const lacquer = keepMat(new THREE.MeshStandardMaterial({ color: 0x15131a, roughness: 0.3, metalness: 0.3 }));
    const brass = keepMat(new THREE.MeshStandardMaterial({ color: 0x3a3226, metalness: 0.8, roughness: 0.35 }));
    const wrap = keepMat(new THREE.MeshStandardMaterial({ color: 0x14182a, roughness: 0.85 }));
    const accent = keepMat(new THREE.MeshBasicMaterial({ color: BLADE_COLOUR }));
    const scabbardLength = (BLADE_LENGTH - 0.1) * unit;
    addPart(sheath, new THREE.BoxGeometry(0.052, scabbardLength, 0.062), lacquer, -scabbardLength / 2 + 0.26 * unit);
    // A thin glowing line down the scabbard's back edge.
    const line = addPart(sheath, new THREE.BoxGeometry(0.008, scabbardLength * 0.9, 0.008), accent, -scabbardLength / 2 + 0.26 * unit);
    line.position.z = -0.034;
    sheathedHilt.push(
      addPart(sheath, new THREE.CylinderGeometry(0.05, 0.05, 0.012, 10), brass, 0.26 * unit),
      addPart(sheath, new THREE.BoxGeometry(0.03, gripLength, 0.032), wrap, 0.26 * unit + gripLength / 2)
    );
    // Across the back, the top tipped over the right shoulder (-x), a little
    // clear of the jacket.
    sheath.rotation.set(-0.12, 0, 0.55);
    // Behind the Storm Core on his back (hero/rogerLook.js), clear of it.
    sheath.position.set(0.04, 1.22, -0.45);
  }

  /**
   * The swoosh: one ribbon of TRAIL_SAMPLES pairs of points, a fixed-size
   * geometry whose positions and colours are rewritten in place every frame.
   * @returns {THREE.Mesh}
   */
  function buildTrail() {
    const geometry = keepGeo(new THREE.BufferGeometry());
    const positions = new THREE.BufferAttribute(new Float32Array(TRAIL_SAMPLES * 6), 3);
    const colours = new THREE.BufferAttribute(new Float32Array(TRAIL_SAMPLES * 6), 3);
    positions.setUsage(THREE.DynamicDrawUsage);
    colours.setUsage(THREE.DynamicDrawUsage);
    const index = new Uint16Array((TRAIL_SAMPLES - 1) * 6);
    for (let i = 0; i < TRAIL_SAMPLES - 1; i++) {
      const a = i * 2;
      index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    geometry.setAttribute('position', positions);
    geometry.setAttribute('color', colours);
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    const mesh = new THREE.Mesh(geometry, keepMat(new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false
    })));
    mesh.name = 'hero_katana_trail';
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.visible = false;
    return mesh;
  }

  /**
   * @param {Object} roger the figure from buildRoger
   * @returns {void}
   */
  function attach(roger) {
    root = roger.mesh;
    armGrip = roger.limbs.armR;
    buildKatana();
    buildSheath();
    buildView();
    trailMesh = buildTrail();
    root.add(sheath, katana, trailMesh);
  }

  // -------------------------------------------------------------------
  // The pose
  // -------------------------------------------------------------------

  /**
   * Where the grip is for this frame, in `pose`: the draw or holster, the low
   * ready (swaying) blended toward the run carry, or the slash in progress.
   * @returns {void}
   */
  function solvePose() {
    const sway = Math.sin(clock * 1.9);
    const ready = POSES.ready;
    lerpPose(base, ready, POSES.run, runBlend);
    // Breathing: the hands rise and settle a touch, the tip nods.
    base[HY] += sway * 0.012 * (1 - runBlend);
    base[PITCH] += Math.sin(clock * 1.9 + 0.8) * 0.025 * (1 - runBlend);
    if (slashT < 1) {
      const s = SLASHES[slashKind];
      if (slashT < WIND_UP) lerpPose(pose, base, s.start, ease(slashT / WIND_UP));
      else if (slashT < STRIKE_END) lerpPose(pose, s.start, s.end, ease((slashT - WIND_UP) / (STRIKE_END - WIND_UP)));
      else lerpPose(pose, s.end, base, ease((slashT - STRIKE_END) / (1 - STRIKE_END)));
      return;
    }
    if (draw < 1) lerpPose(pose, POSES.draw, base, ease(draw));
    else pose.set(base);
  }

  /**
   * Puts the katana in the right hand, on the arm's own reach from the
   * shoulder: the hand is on the grip, at the arm's length along the line to
   * the pose's grip point.
   * @param {THREE.Object3D} armR
   * @returns {void}
   */
  function placeKatana(armR) {
    const ux = pose[HX] - armR.position.x;
    const uy = pose[HY] - armR.position.y;
    const uz = pose[HZ] - armR.position.z;
    const len = Math.hypot(ux, uy, uz) || 1;
    const k = ARM_REACH / len;
    katana.position.set(armR.position.x + ux * k, armR.position.y + uy * k, armR.position.z + uz * k);
    katana.rotation.set(pose[PITCH], pose[YAW], pose[ROLL]);
    katana.updateMatrix();
  }

  /**
   * @param {THREE.Object3D} armL
   * @param {THREE.Object3D} armR
   * @returns {void}
   */
  function applyArms(armL, armR) {
    if (!driven) return;
    // Right hand: always on the grip.
    armToward(armR, katana.position.x, katana.position.y, katana.position.z, angleR);
    armR.rotation.set(angleR[0], 0, angleR[1]);
    // Left hand: on the pommel end of the grip, as far as the run and the
    // draw let it; otherwise it keeps the walk's swing.
    handL.set(0, guardAt - LEFT_HAND_BELOW * unit, 0).applyMatrix4(katana.matrix);
    armToward(armL, handL.x, handL.y, handL.z, angleL);
    const w = leftWeight;
    armL.rotation.set(
      armL.rotation.x + (angleL[0] - armL.rotation.x) * w,
      0,
      armL.rotation.z + (angleL[1] - armL.rotation.z) * w
    );
  }

  // -------------------------------------------------------------------
  // The trail
  // -------------------------------------------------------------------

  /**
   * Adds this frame's blade (a point near the tip and one part-way along it) to
   * the swoosh, in world space so it stays where the blade was.
   * @returns {void}
   */
  function sampleTrail() {
    if (!root) return;
    root.updateMatrixWorld(true);
    trailWorld.copyWithin(6, 0, (TRAIL_SAMPLES - 1) * 6);
    const tip = guardAt + bladeLength;
    const from = guardAt + bladeLength * TRAIL_FROM;
    sample.set(0, tip, 0).applyMatrix4(katana.matrixWorld);
    trailWorld[0] = sample.x; trailWorld[1] = sample.y; trailWorld[2] = sample.z;
    sample.set(0, from, 0).applyMatrix4(katana.matrixWorld);
    trailWorld[3] = sample.x; trailWorld[4] = sample.y; trailWorld[5] = sample.z;
    trailCount = Math.min(TRAIL_SAMPLES, trailCount + 1);
  }

  /**
   * Writes the ribbon: the world samples into Roger's space (the mesh hangs off
   * his root), the newest bright and the oldest gone.
   * @returns {void}
   */
  function writeTrail() {
    if (!trailMesh || !root) return;
    if (trailFade <= 0 || trailCount < 2) {
      trailMesh.visible = false;
      return;
    }
    trailMesh.visible = true;
    inverse.copy(root.matrixWorld).invert();
    const positions = trailMesh.geometry.getAttribute('position');
    const colours = trailMesh.geometry.getAttribute('color');
    for (let i = 0; i < TRAIL_SAMPLES; i++) {
      // Past the samples there are, repeat the oldest: a flat, unseen sliver.
      const from = Math.min(i, trailCount - 1) * 6;
      const age = 1 - i / (TRAIL_SAMPLES - 1);
      const bright = age * age * trailFade;
      for (let v = 0; v < 2; v++) {
        sample.set(trailWorld[from + v * 3], trailWorld[from + v * 3 + 1], trailWorld[from + v * 3 + 2]).applyMatrix4(inverse);
        positions.setXYZ(i * 2 + v, sample.x, sample.y, sample.z);
        const k = bright * (v === 0 ? 1 : 0.35);
        colours.setXYZ(i * 2 + v, BLADE_COLOUR.r * 0.3 * k, BLADE_COLOUR.g * 0.3 * k, BLADE_COLOUR.b * 0.3 * k);
      }
    }
    positions.needsUpdate = true;
    colours.needsUpdate = true;
  }

  // -------------------------------------------------------------------
  // Per frame
  // -------------------------------------------------------------------

  /**
   * @param {number} dt seconds
   * @param {boolean} selected the Katana is the weapon in hand
   * @param {boolean} drawn it has been drawn (heroWeapons.js katanaState)
   * @param {number} run 0 standing to 1 at full run
   * @param {boolean} interrupted dazed or aiming: the sword goes back at once
   * @returns {boolean} whether the katana is in his hands
   */
  function step(dt, selected, drawn, run, interrupted) {
    clock += dt;
    // Roger's figure is on show: third person, so the first-person blade goes.
    if (view && root && root.visible) view.visible = false;
    sheath.visible = selected;
    if (!selected || interrupted) {
      draw = 0;
      drawing = false;
      slashT = 1;
    } else {
      drawing = drawn;
    }
    if (selected && !interrupted) {
      if (drawing) draw = Math.min(1, draw + dt / DRAW_SECONDS);
      else draw = Math.max(0, draw - dt / HOLSTER_SECONDS);
    }
    if (!drawing) slashT = 1;
    driven = draw > 0;
    katana.visible = driven;
    for (const mesh of sheathedHilt) mesh.visible = !driven;
    if (slashT < 1) slashT = Math.min(1, slashT + dt / SLASH_SECONDS);
    const striking = slashT < 1 && slashT > WIND_UP * 0.8 && slashT < STRIKE_END;
    const runTarget = slashT < 1 ? 0 : run;
    runBlend += (runTarget - runBlend) * Math.min(1, dt * 9);
    if (!driven) {
      trailFade = 0;
      trailCount = 0;
      writeTrail();
      return false;
    }
    // The left hand lets go for the run and the first half of the draw.
    leftWeight = ease(THREE.MathUtils.clamp((draw - 0.4) / 0.6, 0, 1)) * (1 - runBlend * 0.85);
    solvePose();
    if (armGrip) placeKatana(armGrip);
    if (striking) {
      sampleTrail();
      trailFade = 1;
    } else {
      trailFade = Math.max(0, trailFade - dt * TRAIL_FADE_PER_SECOND);
    }
    writeTrail();
    return true;
  }

  /**
   * @param {SlashKind} kind
   * @returns {boolean} false when the katana is not in his hands to swing
   */
  function slash(kind) {
    if (!driven || draw < 1 || !(kind in SLASHES)) return false;
    slashKind = kind;
    slashT = 0;
    trailCount = 0;
    return true;
  }

  /**
   * First person: the blade low on the right, swinging with the current pose.
   * The third-person rig is hidden with Roger's figure while he aims.
   * @param {THREE.Camera} cam
   * @param {boolean} active the katana is the weapon in hand and he is aiming
   * @returns {void}
   */
  function placeView(cam, active) {
    if (!view || !holder) return;
    const show = active && driven && draw > 0.02;
    view.visible = show;
    if (!show) return;
    const ready = POSES.ready;
    view.position.copy(cam.position);
    view.quaternion.copy(cam.quaternion).multiply(viewFlip);
    holder.position.set(
      VIEW_IDLE[HX] + (pose[HX] - ready[HX]) * VIEW_HAND_SCALE,
      VIEW_IDLE[HY] + (pose[HY] - ready[HY]) * VIEW_HAND_SCALE,
      Math.max(VIEW_MIN_FORWARD, VIEW_IDLE[HZ] + (pose[HZ] - ready[HZ]) * VIEW_HAND_SCALE)
    );
    holder.rotation.set(
      VIEW_IDLE[PITCH] + (pose[PITCH] - ready[PITCH]) * VIEW_PITCH_SCALE,
      VIEW_IDLE[YAW] + (pose[YAW] - ready[YAW]) * VIEW_YAW_SCALE,
      VIEW_IDLE[ROLL] + (pose[ROLL] - ready[ROLL])
    );
    view.updateMatrixWorld(true);
  }

  /** @returns {void} */
  function disposeView() {
    if (view) view.removeFromParent();
    view = null;
    holder = null;
  }

  return { attach, step, applyArms, slash, isSlashing: () => slashT < 1, placeView, disposeView };
}
