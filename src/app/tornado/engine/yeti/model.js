// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION YT.1 — The cyber Yeti: the model
 * ===========================================================================
 * Half yeti, half machine, split down the body so both halves read from
 * any side (it used to be a furry robot: steel shoulders and a visor):
 *
 *  - The yeti half (its left, +x): white and blue-white fur with the hair
 *    showing -- shaggy tufts (one instanced mesh per moving part, a few
 *    hundred strands each, tinted from snow-white to ice-blue) hanging off
 *    the torso, the head, the left arm and the left leg; a blue-grey face,
 *    hand and foot; a dark natural eye under a heavy furred brow.
 *  - The cyborg half (its right, -x): the right arm and the right leg are
 *    metal -- plated segments, the joints bare (dark balls with cyan rings),
 *    pistons along them; a steel plate over the right of the face with a
 *    glowing cyan eye; plating over the right of the chest with the glowing
 *    core and cables running into the fur.
 *  - The cold gun, in the metal hand: a Mr. Freeze-style blaster -- a
 *    bulky body, a glass tank of glowing coolant, cooling rings down a long
 *    barrel, and the muzzle (`muzzle`) the frost beam leaves from.
 *
 * Built 5 m tall in its own units and scaled to YETI.height by the rig.
 * Facing +z. The geometries are made once for the system; the materials
 * and the fur's instanced meshes per Yeti (dispose() on the rig frees them).
 */

/**
 * @typedef {Object} YetiRig
 * @property {THREE.Group} root
 * @property {THREE.Object3D} armL the fur arm's shoulder pivot
 * @property {THREE.Object3D} armR the metal arm's, with the gun
 * @property {THREE.Object3D} legL
 * @property {THREE.Object3D} legR
 * @property {THREE.Object3D} muzzle where the beam leaves the gun
 * @property {THREE.MeshBasicMaterial} glowMat the cyan lights
 * @property {THREE.MeshBasicMaterial} coolantMat the gun's tank
 * @property {() => void} dispose its materials and instanced meshes
 */

const FUR_TINTS = [0xffffff, 0xf2f7fc, 0xe3eef8, 0xd2e3f3, 0xc4dbef];

/**
 * @param {{height: number, fur: number, metal: number, visor: THREE.Color}} look
 * @returns {{ build: () => YetiRig, dispose: () => void }}
 */
export function createYetiModel(look) {
  const geo = {
    ball: new THREE.SphereGeometry(1, 16, 12),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
    box: new THREE.BoxGeometry(1, 1, 1),
    ring: new THREE.TorusGeometry(1, 0.18, 6, 16),
    // A strand of hair: a thin cone, its wide root at the origin, its tip at +y.
    strand: new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0)
  };
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const colour = new THREE.Color();

  /** @returns {YetiRig} */
  function build() {
    const k = look.height / 5;
    const fur = new THREE.MeshStandardMaterial({ color: look.fur, roughness: 1 });
    const hair = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x8fa3b8, roughness: 0.8 });
    const metal = new THREE.MeshStandardMaterial({ color: look.metal, roughness: 0.28, metalness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23282f, roughness: 0.4, metalness: 0.8 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xbfe8ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.45 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0d1a2a, roughness: 0.2, emissive: 0x0a2a40 });
    const glowMat = new THREE.MeshBasicMaterial({ color: look.visor.clone() });
    const coolantMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.2, 3) });
    const materials = [fur, hair, skin, metal, dark, glass, eyeMat, glowMat, coolantMat];
    /** @type {THREE.InstancedMesh[]} */
    const furs = [];

    const root = new THREE.Group();
    root.name = 'cyber_yeti';
    const rig = new THREE.Group();
    rig.scale.setScalar(k);
    root.add(rig);

    /**
     * @param {THREE.BufferGeometry} g
     * @param {THREE.Material} m
     * @param {THREE.Object3D} parent
     * @param {number[]} p
     * @param {number[]} s
     * @param {number[]} [r]
     * @returns {THREE.Mesh}
     */
    const part = (g, m, parent, p, s, r = [0, 0, 0]) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(p[0], p[1], p[2]);
      mesh.scale.set(s[0], s[1], s[2]);
      mesh.rotation.set(r[0], r[1], r[2]);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    /**
     * Hair: strands rooted on a surface, hanging out and down.
     * @param {THREE.Object3D} parent
     * @param {number} count
     * @param {() => {at: THREE.Vector3, out: THREE.Vector3}|null} place a root and its outward normal, or null to skip
     * @param {number} length
     * @returns {void}
     */
    const shag = (parent, count, place, length) => {
      const mesh = new THREE.InstancedMesh(geo.strand, hair, count);
      mesh.castShadow = true;
      let n = 0;
      for (let tries = 0; n < count && tries < count * 6; tries++) {
        const spot = place();
        if (!spot) continue;
        // Out from the skin, weighed down: shaggy, not spiky.
        dir.copy(spot.out).multiplyScalar(0.55).add(up.set(0, -1, 0)).normalize();
        q.setFromUnitVectors(up.set(0, 1, 0), dir);
        const len = length * (0.6 + Math.random() * 0.7);
        const w = 0.035 + Math.random() * 0.035;
        m4.compose(pos.copy(spot.at), q, scl.set(w, len, w));
        mesh.setMatrixAt(n, m4);
        mesh.setColorAt(n, colour.setHex(FUR_TINTS[(Math.random() * FUR_TINTS.length) | 0]));
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      parent.add(mesh);
      furs.push(mesh);
    };

    /**
     * A point on an ellipsoid and its outward normal.
     * @param {number[]} c centre
     * @param {number[]} r radii
     * @returns {{at: THREE.Vector3, out: THREE.Vector3}}
     */
    const onBall = (c, r) => {
      const out = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      return { at: new THREE.Vector3(c[0] + out.x * r[0] * 0.97, c[1] + out.y * r[1] * 0.97, c[2] + out.z * r[2] * 0.97), out };
    };

    // ---- The torso: fur, with the right of the chest plated over.
    part(geo.ball, fur, rig, [0, 2.9, 0], [1.25, 1.5, 1]);
    // The plate over its right chest and shoulder, and the core in it.
    part(geo.ball, metal, rig, [-0.62, 3.25, 0.32], [0.72, 0.95, 0.75]);
    part(geo.box, dark, rig, [-0.5, 3.0, 0.98], [0.5, 0.42, 0.12]);
    part(geo.ball, glowMat, rig, [-0.5, 3.0, 1.05], [0.17, 0.17, 0.08]);
    part(geo.box, metal, rig, [-1.12, 3.95, 0], [0.75, 0.38, 1]);           // shoulder plate
    for (let i = 0; i < 3; i++) {
      // Cables from the core into the fur.
      part(geo.cyl, dark, rig, [-0.15 + i * 0.18, 2.55 - i * 0.12, 0.92], [0.05, 0.7, 0.05], [0.3, 0, -0.6 + i * 0.25]);
      // Glowing seams down the plating.
      part(geo.box, glowMat, rig, [-1.0 + i * 0.22, 3.55 - i * 0.28, 0.62 + i * 0.12], [0.18, 0.03, 0.03]);
    }
    shag(rig, 420, () => {
      const s = onBall([0, 2.9, 0], [1.25, 1.5, 1]);
      // Not over the plate.
      if (s.out.x < -0.15 && s.out.y > -0.35 && s.out.z > -0.55) return null;
      return s;
    }, 0.3);

    // ---- The head: fur on the left and the crown, metal over the right face.
    part(geo.ball, fur, rig, [0, 4.35, 0.2], [0.68, 0.62, 0.62]);
    part(geo.ball, skin, rig, [0.08, 4.18, 0.62], [0.42, 0.3, 0.28]);      // muzzle
    part(geo.box, dark, rig, [0.08, 4.02, 0.82], [0.4, 0.06, 0.06]);       // mouth
    part(geo.box, fur, rig, [0.25, 4.55, 0.62], [0.5, 0.13, 0.2], [0.2, 0, 0.1]); // brow
    part(geo.ball, eyeMat, rig, [0.27, 4.42, 0.74], [0.09, 0.08, 0.05]);  // its own eye
    part(geo.ball, metal, rig, [-0.3, 4.4, 0.32], [0.48, 0.55, 0.52]);    // the plate
    part(geo.box, glowMat, rig, [-0.3, 4.44, 0.82], [0.26, 0.09, 0.05]);  // the cyber eye
    part(geo.ring, dark, rig, [-0.62, 4.42, 0.28], [0.18, 0.18, 0.18], [0, Math.PI / 2, 0]); // ear socket
    shag(rig, 240, () => {
      const s = onBall([0, 4.35, 0.2], [0.68, 0.62, 0.62]);
      if (s.out.x < 0.1 && s.out.y < 0.75) return null;   // the metal side
      if (s.out.z > 0.55 && s.out.y < 0.4) return null;   // the face
      return s;
    }, 0.22);

    // ---- The fur arm, its left.
    const armL = new THREE.Group();
    armL.position.set(1.25, 3.8, 0);
    rig.add(armL);
    part(geo.cyl, fur, armL, [0, -1.2, 0], [0.34, 2.4, 0.34]);
    part(geo.ball, skin, armL, [0, -2.5, 0.1], [0.36, 0.3, 0.4]);         // hand
    shag(armL, 200, () => {
      const a = Math.random() * Math.PI * 2;
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      return { at: new THREE.Vector3(out.x * 0.33, -0.1 - Math.random() * 2.15, out.z * 0.33), out };
    }, 0.26);

    // ---- The metal arm, its right: segments, bare joints, pistons, the gun.
    const armR = new THREE.Group();
    armR.position.set(-1.3, 3.8, 0);
    rig.add(armR);
    part(geo.ball, dark, armR, [0, 0, 0], [0.42, 0.42, 0.42]);            // shoulder joint
    part(geo.ring, glowMat, armR, [0, 0, 0], [0.4, 0.4, 0.4], [0, Math.PI / 2, 0]);
    part(geo.cyl, metal, armR, [0, -0.62, 0], [0.27, 1.05, 0.27]);        // upper arm
    part(geo.ball, dark, armR, [0, -1.25, 0], [0.3, 0.3, 0.3]);           // elbow, bare
    part(geo.ring, glowMat, armR, [0, -1.25, 0], [0.3, 0.3, 0.3], [0, Math.PI / 2, 0]);
    part(geo.cyl, metal, armR, [0, -1.9, 0], [0.24, 1.1, 0.24]);          // forearm
    part(geo.cyl, dark, armR, [0.24, -1.2, 0.1], [0.05, 1.8, 0.05]);      // piston
    part(geo.cyl, dark, armR, [-0.22, -1.2, -0.1], [0.04, 1.6, 0.04]);
    part(geo.box, metal, armR, [0, -2.55, 0.05], [0.4, 0.3, 0.45]);       // the metal hand
    // The gun in it, along the arm's length (-y): out in front once the arm
    // is raised.
    const gun = new THREE.Group();
    gun.position.set(0, -2.6, 0.35);
    armR.add(gun);
    part(geo.box, dark, gun, [0, -0.2, 0.15], [0.55, 0.9, 0.62]);         // body
    part(geo.cyl, glass, gun, [0, -0.05, 0.62], [0.3, 0.75, 0.3]);         // the tank
    part(geo.cyl, coolantMat, gun, [0, -0.05, 0.62], [0.2, 0.62, 0.2]);    // its coolant
    part(geo.cyl, metal, gun, [0, -1.25, 0.1], [0.17, 1.5, 0.17]);         // barrel
    for (let i = 0; i < 4; i++) part(geo.ring, glowMat, gun, [0, -0.75 - i * 0.32, 0.1], [0.24, 0.24, 0.24], [Math.PI / 2, 0, 0]);
    part(geo.cyl, metal, gun, [0, -2.0, 0.1], [0.26, 0.2, 0.26]);         // the muzzle's flare
    part(geo.ring, coolantMat, gun, [0, -2.1, 0.1], [0.2, 0.2, 0.2], [Math.PI / 2, 0, 0]);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, -2.15, 0.1);
    gun.add(muzzle);

    // ---- The legs: fur on the left, metal on the right.
    const legL = new THREE.Group();
    legL.position.set(0.55, 1.6, 0);
    rig.add(legL);
    part(geo.cyl, fur, legL, [0, -0.8, 0], [0.42, 1.6, 0.42]);
    part(geo.box, skin, legL, [0, -1.55, 0.2], [0.55, 0.25, 0.8]);        // the foot
    shag(legL, 160, () => {
      const a = Math.random() * Math.PI * 2;
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      return { at: new THREE.Vector3(out.x * 0.41, -0.05 - Math.random() * 1.25, out.z * 0.41), out };
    }, 0.26);

    const legR = new THREE.Group();
    legR.position.set(-0.55, 1.6, 0);
    rig.add(legR);
    part(geo.ball, dark, legR, [0, 0, 0], [0.4, 0.4, 0.4]);               // hip joint
    part(geo.cyl, metal, legR, [0, -0.42, 0], [0.34, 0.75, 0.34]);         // thigh
    part(geo.ball, dark, legR, [0, -0.85, 0.05], [0.27, 0.27, 0.27]);      // knee, bare
    part(geo.ring, glowMat, legR, [0, -0.85, 0.05], [0.28, 0.28, 0.28], [0, Math.PI / 2, 0]);
    part(geo.cyl, metal, legR, [0, -1.2, 0], [0.28, 0.65, 0.28]);          // shin
    part(geo.cyl, dark, legR, [0.3, -0.75, 0.12], [0.045, 1.1, 0.045]);   // piston
    part(geo.box, metal, legR, [0, -1.55, 0.22], [0.6, 0.25, 0.85]);       // the steel foot
    part(geo.box, glowMat, legR, [0, -1.5, 0.66], [0.4, 0.05, 0.03]);

    return {
      root, armL, armR, legL, legR, muzzle, glowMat, coolantMat,
      dispose: () => {
        for (const m of materials) m.dispose();
        for (const f of furs) f.dispose();
      }
    };
  }

  /** @returns {void} */
  function dispose() {
    for (const g of Object.values(geo)) g.dispose();
  }

  return { build, dispose };
}
