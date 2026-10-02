// @ts-check
import * as THREE from 'three';
import { PERSON } from '../scale.js';

/**
 * ===========================================================================
 * SECTION D.1 — Environment: people
 * ===========================================================================
 * Life-size (see PERSON_SCALE) low-poly bystanders scattered near
 * buildings/streets. Built from the same handful of primitive shapes the
 * rest of the low-poly cast uses (see createTree/createCar) rather than
 * anything detailed or rigged: a torso capsule, a head sphere, and four limb
 * cylinders, held in a fixed standing pose. They are not pooled and not
 * rooted, so -- exactly like the parked cars in cars.js -- they fall
 * straight into the generic capture state machine (grounded -> trembling ->
 * rising -> orbiting -> falling) the moment the vortex's force field reaches
 * them; no separate "damage" trigger is needed the way trees/cars/buildings
 * have one, since a person offers no structural resistance to be broken
 * through first.
 */

// A modest, varied wardrobe/skin palette so a crowd of dozens doesn't read as
// the same person copy-pasted -- picked for contrast against the muted
// building/car palette rather than for any other significance.
const CLOTHING_COLOURS = [0x8a3b3b, 0x3b5c8a, 0x3b8a55, 0x8a7a3b, 0x5a3b8a, 0x455063, 0x8a5a2f];
const SKIN_TONES = [0xd8a878, 0xc98a5c, 0x8a5a3c, 0xecc19c, 0x6b4530, 0xb37a4c];

// How tall createPerson builds a figure before its scale: legs 0.7, torso
// 0.8, head 0.32.
export const PERSON_BUILT_HEIGHT = 1.82;
// Life size (engine/scale.js PERSON.height, 1.8 m). It was 3.04 -- a 5.5 m
// bystander, "for visual impact" -- against which every life-size bicycle,
// house and Hank Granite looked like a toy (docs/SCALE.md). One uniform
// group scale, so every primitive keeps its proportions; everything
// measured against a figure derives from PERSON.height.
export const PERSON_SCALE = PERSON.height / PERSON_BUILT_HEIGHT;

/**
 * @param {Object} ctx
 * @returns {{
 *   createPerson: (x: number, z: number, index?: number) => Object,
 *   explodePerson: (person: Object) => void
 * }}
 */
export function createPeopleSystem(ctx) {
  const { Sim, nextObjectId } = ctx;

  /**
   * @param {number} x
   * @param {number} z
   * @param {number} [index] position in the environment's people list, used only
   *   to give this figure a unique scene-graph name
   * @returns {SimObject}
   */
  function createPerson(x, z, index = 0, rand = Math.random) {
    const clothing = CLOTHING_COLOURS[Math.floor(rand() * CLOTHING_COLOURS.length)];
    const skin = SKIN_TONES[Math.floor(rand() * SKIN_TONES.length)];
    const clothingMat = new THREE.MeshStandardMaterial({ color: clothing, roughness: 0.9 });
    const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 });

    const root = new THREE.Group();
    root.name = `person_${index}`;
    root.position.set(x, 0, z);
    root.rotation.y = rand() * Math.PI * 2;

    // Yaw first, then pitch in the figure's own frame, so the forward lean
    // peopleMotion.js gives a runner tilts along whichever way they face.
    root.rotation.order = 'YXZ';

    // Legs: two short tapered cylinders, feet at y=0. The geometry hangs
    // below its origin so each leg pivots at the hip for the walk cycle
    // (see peopleMotion.js) rather than about its own middle.
    const legHeight = 0.7;
    const legGeo = new THREE.CylinderGeometry(0.08, 0.06, legHeight, 6);
    legGeo.translate(0, -legHeight / 2, 0);
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, clothingMat);
      leg.name = `${root.name}_leg${side < 0 ? 'L' : 'R'}`;
      leg.position.set(side * 0.11, legHeight, 0);
      // No shadow: too small to show in a 1024 shadow map, and every caster
      // is drawn a second time into it (performance pass).
      leg.castShadow = false;
      root.add(leg);
    }

    // Torso: a capsule (three.js's capsule axis runs along Y already, so no
    // rotation is needed), sitting directly on top of the legs.
    const torsoLength = 0.4;
    const torsoRadius = 0.2;
    const torsoGeo = new THREE.CapsuleGeometry(torsoRadius, torsoLength, 4, 8);
    const torso = new THREE.Mesh(torsoGeo, clothingMat);
    torso.name = `${root.name}_torso`;
    torso.position.y = legHeight + torsoLength / 2 + torsoRadius;
    torso.castShadow = true;
    root.add(torso);
    const torsoTop = torso.position.y + torsoLength / 2 + torsoRadius;

    // Arms: two thin cylinders, angled a little away from the body at the
    // shoulder so the standing pose doesn't read as a plain pillar.
    const armLength = 0.5;
    // Hung below its origin, like the legs, so it swings from the shoulder.
    const armGeo = new THREE.CylinderGeometry(0.05, 0.04, armLength, 6);
    armGeo.translate(0, -armLength / 2, 0);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, clothingMat);
      arm.name = `${root.name}_arm${side < 0 ? 'L' : 'R'}`;
      arm.position.set(side * 0.29, torsoTop - 0.32 + armLength / 2, 0);
      arm.rotation.z = side * 0.3;
      arm.castShadow = false;
      root.add(arm);
    }

    // Head: a plain sphere, resting on the torso.
    const headRadius = 0.16;
    const headGeo = new THREE.SphereGeometry(headRadius, 8, 6);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.name = `${root.name}_head`;
    head.position.y = torsoTop + headRadius;
    // Only the torso casts: it is most of the figure's shadow.
    head.castShadow = false;
    root.add(head);

    root.scale.setScalar(PERSON_SCALE);

    /** @type {SimObject} */
    const obj = {
      id: nextObjectId.value++,
      type: 'person',
      mesh: root,
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
      // Lighter than every debris kind bar branch (see DEBRIS_KIND_DEFS) and
      // given a lift-eligibility close to branch's own 0.98 -- people are
      // meant to be among the very first things the vortex snatches up.
      mass: 0.35 + rand() * 0.45,
      // 0.6 rather than a heavier value deliberately: this is the same value
      // spawnDebris()/uprootTree() rely on for anything that actually needs
      // to cross into the lift radius under its own inward pull (a higher
      // drag was measured, in an earlier session, to leave uprooted trees
      // stranded at the edge of the force field for the same reason it would
      // strand people here).
      drag: 0.6,
      rooted: false,
      damageState: 'intact',
      breakThreshold: Infinity, // unused: damage.js has no per-type pass for 'person'
      liftEligible: 0.95,
      pooled: false,
      poolIndex: -1,
      lifeTimer: 0,
      captureState: 'grounded'
    };
    root.userData.simObject = obj;
    return obj;
  }

  /**
   * A person struck by lightning -- or hit square on by flying debris (see
   * engine/debrisImpacts.js) -- explodes and is removed outright, rather
   * than becoming debris the way a broken tree/building piece does -- the
   * explosion *is* their removal (Instrucțiunea W requirement 3). Reuses
   * the existing explosion system verbatim (fireball/particles/sound, and
   * its own existing 12-slot burst pool and 4-voice/0.07s-gap sound cap --
   * see explosions/index.js/playImpactSound), so the first ~10 scripted
   * strikes early in a run can't overwhelm either: at the normal ~1-2
   * strikes/sec cadence lightning runs at, they land spread over several
   * seconds, well inside both caps' turnover.
   * @param {SimObject} person
   * @returns {void}
   */
  function explodePerson(person) {
    const pos = person.mesh.position.clone();
    pos.y += 0.8; // roughly chest height, so the burst reads as centred on them, not underground
    ctx.systems.explosions.spawnImpactBurst(pos, 1.3);

    // removeFromParent() rather than Sim.three.scene.remove(): a person's
    // mesh is parented to the 'environment' group (see generateEnvironment),
    // not directly to the scene, so removing it from the scene would be a
    // silent no-op and leave the figure still rendered.
    person.mesh.removeFromParent();
    person.mesh.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });

    const objIdx = Sim.objects.indexOf(person);
    if (objIdx !== -1) Sim.objects.splice(objIdx, 1);
    const envIdx = ctx.Environment.people.indexOf(person);
    if (envIdx !== -1) ctx.Environment.people.splice(envIdx, 1);
  }

  // People are lightning's primary targets (strikeTargets.js): the scripted
  // opening strikes aim at them, and a random strike landing beside one
  // still hits them.
  ctx.systems.strikeTargets.registerStrikeProvider({
    name: 'people',
    priority: 'primary',
    candidates: () => ctx.Environment.people,
    // Roughly chest height: "bolt endpoint at their position" reads better
    // striking the figure itself than vanishing into the ground at their feet.
    strikeHeight: 1.2,
    onStruck: explodePerson
  });

  return { createPerson, explodePerson };
}
