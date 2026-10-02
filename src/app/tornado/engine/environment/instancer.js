// @ts-check
import * as THREE from 'three';
import { updateWorldMatrices } from '../matrices.js';
import { ALIEN_SKIN_GLOW } from '../aliens.js';

/**
 * ===========================================================================
 * SECTION D.10 — Instanced drawing of the crowd and the trees
 * ===========================================================================
 * The town's people were six meshes each (two legs, a torso, two arms, a
 * head) and its trees two (trunk, canopy): with 165 people and a hundred
 * trees that was some 1,200 draw calls a frame -- half of everything drawn,
 * and the largest CPU cost of a frame on a weak laptop. They are drawn
 * here instead, as one InstancedMesh per kind of part: six draw calls for
 * all of them.
 *
 * Nothing about how people and trees work has changed, which is the point
 * of doing it this way. Each still has its own hierarchy (environment/
 * people.js createPerson, environment/trees.js createTree): the walk, the
 * dance, the funnel, the chasm and everything else move those parts
 * exactly as before, and whatever tints, glows, scales or disposes them
 * still does so on their own materials and geometries. Once a frame
 * (updateInstancer, just before the render) each ordinary one's parts are
 * hidden and their world matrices and colours copied into the instances.
 *
 * Anything out of the ordinary is simply left to draw itself, as it always
 * did, rather than taught to the instancer: a part with anything attached
 * to it (Roger's hair and rifle, an armed arrival's pistol), a material
 * glowing (the abduction beam, electrocution, a mutation), anyone taken,
 * turning or electrocuted, and anything hidden or out of the scene.
 * Checked afresh every frame, so a person drops back to their own meshes
 * the moment one of those starts and rejoins the crowd when it ends.
 *
 * The instanced geometry is the same as each person's own (people.js builds
 * them all alike); a tree's trunk height and canopy radius vary, so its
 * instance is scaled from the part's own geometry parameters.
 *
 * The parked cars (environment/cars.js) go the same way, nine meshes each:
 * every part but the paint shares its geometry and material with every
 * other car, and the body and cabin share geometry and differ only in the
 * paint colour. Their groups are made on first sight, from the car's own
 * geometry and a copy of its material (the paint's with the colour taken
 * per instance). A car drawn by anyone else's rules -- Roger or Chase Mode
 * driving it, a part's material swapped (lit lamps, a burnt shell) --
 * draws itself.
 *
 * The aliens (engine/aliens.js) likewise, fourteen to seventeen meshes each
 * -- limbs, head, eyes, the ray gun, a sombrero -- which after a nuclear
 * mutation was some nine hundred draws on its own (measured, `?bench=1`).
 * Every part shares its geometry and material with every other alien but
 * the skin, which is each alien's own and drawn with its colour per
 * instance (placeAlien). One whose skin glows anything but the ordinary
 * green (burning, mutating, flashing), or with a part hidden, taken off or
 * re-materialled, draws itself.
 *
 * And the town's plain boxes and cylinders -- building walls and flat roofs,
 * rooftop plant, the viaduct's deck slabs, rails and pillars, the filling
 * stations' kiosks, canopies, pumps and pillars, the nuclear plants' turbine
 * halls (updateShapes). Each is instanced from a unit box or cylinder scaled
 * to its own geometry's dimensions, coloured by its own material, grouped by
 * everything else about the material (roughness, metalness, shadows). Only
 * a leaf mesh with an untextured, opaque, unglowing standard material and an
 * untranslated geometry qualifies, looked at once; and every frame it must
 * still be in the scene, visible all the way up and wearing the same
 * material, not glowing (a building on fire) and not faded (a building
 * sinking), or it draws itself. A wall torn off a building leaves the
 * scene (damage.js detachBuildingPiece), so it simply stops being drawn
 * here.
 *
 * Hidden only for the render: updateInstancer hides the parts it draws, and
 * restoreInstancer, straight after the render, shows them again. Every
 * system therefore sees the real visibility of everything while it updates,
 * and something the game hides on purpose stays hidden -- the instancer only
 * ever draws what would have been drawn.
 *
 * World matrices: updateInstancer brings the whole scene's up to date once
 * (engine/matrices.js, rebuilding only what moved), and the render is told
 * not to do it again (tornadoEngine.js animate), so
 * copying them costs no second pass over the scene.
 */

const INSTANCER = {
  // Instances per kind of part: the people's live cap is 420 (environment/
  // reinforcements.js LIVE_CAP), two legs and two arms each.
  people: 480,
  trees: 600,
  cars: 96,
  // Per kind of alien part: up to every person mutated (420, see people
  // above) and the landing party, two legs, two arms and two eyes each.
  aliens: 1024,
  shapes: 1200            // per kind of box or cylinder
};

/**
 * @param {Object} ctx
 * @returns {{
 *   initInstancer: () => void,
 *   updateInstancer: () => void,
 *   restoreInstancer: () => void,
 *   instancedCount: () => {people: number, trees: number, cars: number, shapes: number, aliens: number},
 *   resetInstancer: () => void,
 *   disposeInstancer: () => void
 * }}
 */
export function createInstancerSystem(ctx) {
  const { Sim } = ctx;

  /**
   * @typedef {Object} PartGroup
   * @property {THREE.InstancedMesh} mesh
   * @property {number} n instances written this frame
   * @property {'none'|'height'|'radius'} scaleBy which geometry parameter scales it
   * @property {number} unit that parameter's value in the shared geometry
   * @property {boolean} [paint] colour per instance from the part's own material
   *   (a car's paint, an alien's skin)
   * @property {boolean} [ownGeometry]
   */
  /** @type {Object<string, PartGroup>} */
  let groups = {};
  const counts = { people: 0, trees: 0, cars: 0, shapes: 0, aliens: 0 };
  /** @type {Map<string, PartGroup>} the cars' groups, by geometry and material */
  const carGroups = new Map();
  /** @type {Map<string, PartGroup>} the aliens' groups, by geometry and material */
  const alienGroups = new Map();
  const skinGlow = new THREE.Color(ALIEN_SKIN_GLOW);
  const WHITE = new THREE.Color(0xffffff);
  const matrix = new THREE.Matrix4();
  const scaleMatrix = new THREE.Matrix4();
  /** @type {THREE.Object3D[]} parts hidden for this render, shown again after it */
  const hidden = [];
  /** @type {Map<string, Object>} the shapes' groups (updateShapes) */
  const shapeGroups = new Map();
  /** @type {WeakMap<THREE.Object3D, Object[]>} each shape source's candidate meshes, found once */
  const shapeCandidates = new WeakMap();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  /** @type {Map<string, THREE.CylinderGeometry>} unit cylinders by taper and segments */
  const unitCylinders = new Map();

  /**
   * @param {string} name
   * @param {THREE.BufferGeometry} geometry
   * @param {number} roughness
   * @param {number} capacity
   * @param {boolean} castShadow
   * @param {'none'|'height'|'radius'} scaleBy
   * @param {number} unit
   * @returns {PartGroup}
   */
  function group(name, geometry, roughness, capacity, castShadow, scaleBy = 'none', unit = 1) {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness });
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = `instanced_${name}`;
    mesh.count = 0;
    // Instances are all over the map: culling them by the geometry's own
    // bounds at the origin would drop them all.
    mesh.frustumCulled = false;
    mesh.castShadow = castShadow;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color());
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    Sim.three.scene.add(mesh);
    return { mesh, n: 0, scaleBy, unit };
  }

  /** @returns {void} */
  function initInstancer() {
    // The people's parts, built exactly as people.js builds them.
    const legHeight = 0.7;
    const legGeo = new THREE.CylinderGeometry(0.08, 0.06, legHeight, 6);
    legGeo.translate(0, -legHeight / 2, 0);
    const armLength = 0.5;
    const armGeo = new THREE.CylinderGeometry(0.05, 0.04, armLength, 6);
    armGeo.translate(0, -armLength / 2, 0);
    // A tree's trunk at unit height and its canopy at unit radius, scaled
    // per tree (see scaleFor).
    groups = {
      leg: group('person_legs', legGeo, 0.9, INSTANCER.people * 2, false),
      // Only the torso casts, as for people drawing themselves (people.js).
      torso: group('person_torsos', new THREE.CapsuleGeometry(0.2, 0.4, 4, 8), 0.9, INSTANCER.people, true),
      arm: group('person_arms', armGeo, 0.9, INSTANCER.people * 2, false),
      head: group('person_heads', new THREE.SphereGeometry(0.16, 8, 6), 0.8, INSTANCER.people, false),
      trunk: group('tree_trunks', new THREE.CylinderGeometry(0.25, 0.35, 1, 8), 1, INSTANCER.trees, false, 'height', 1),
      canopy: group('tree_canopies', new THREE.SphereGeometry(1, 8, 6), 1, INSTANCER.trees, true, 'radius', 1)
    };
  }

  /**
   * The parts of a person or tree, found once by name (people.js and
   * trees.js name them after the root) and kept on it.
   * @param {Object} owner a person or tree SimObject
   * @param {string[][]} spec [suffix, group key] pairs
   * @returns {{mesh: THREE.Mesh, group: PartGroup}[]|null}
   */
  function partsOf(owner, spec) {
    if (owner.instanceParts !== undefined) return owner.instanceParts;
    const root = owner.mesh;
    const parts = [];
    for (const [suffix, key] of spec) {
      const mesh = root.children.find(c => c.isMesh && c.name.endsWith(suffix));
      if (!mesh) {
        owner.instanceParts = null;
        return null;
      }
      parts.push({ mesh, group: groups[key] });
    }
    owner.instanceParts = parts;
    return parts;
  }

  /**
   * Whether these parts can go into the instances this frame: nothing
   * attached to them, none of them glowing, none scaled or re-materialled
   * out of the ordinary. Otherwise they draw themselves.
   * @param {{mesh: THREE.Mesh, group: PartGroup}[]} parts
   * @returns {boolean}
   */
  function plain(parts) {
    for (const { mesh } of parts) {
      if (mesh.children.length) return false;
      const m = mesh.material;
      if (!m || !m.color || Array.isArray(m)) return false;
      if (m.emissive && (m.emissive.r > 0 || m.emissive.g > 0 || m.emissive.b > 0)) return false;
      if (m.transparent || m.opacity < 1 || m.map) return false;
      if (mesh.scale.x !== 1 || mesh.scale.y !== 1 || mesh.scale.z !== 1) return false;
    }
    return true;
  }

  /**
   * @param {{mesh: THREE.Mesh, group: PartGroup}[]} parts
   * @param {boolean} show whether the parts draw themselves
   * @returns {void}
   */
  function setOwnVisible(parts, show) {
    if (show) return;
    for (const part of parts) {
      part.mesh.visible = false;
      hidden.push(part.mesh);
    }
  }

  /**
   * A car's parts, found once: each mesh with the group it draws into (made
   * on first sight) and the material it had then, so a swapped one shows.
   * @param {Object} car
   * @returns {{mesh: THREE.Mesh, group: PartGroup, material: THREE.Material}[]|null}
   */
  function carPartsOf(car) {
    if (car.instanceParts !== undefined) return car.instanceParts;
    const parts = [];
    let ok = true;
    car.mesh.traverse((/** @type {any} */ mesh) => {
      if (!mesh.isMesh || !ok) return;
      const material = mesh.material;
      if (!material || Array.isArray(material) || !material.color) {
        ok = false;
        return;
      }
      // The paint is the one material made per car: the body's and cabin's.
      const paint = /_(body|cabin)$/.test(mesh.name);
      const key = `${mesh.geometry.uuid}|${paint ? 'paint' : material.uuid}`;
      let g = carGroups.get(key);
      if (!g) {
        const copy = material.clone();
        if (paint) copy.color.setHex(0xffffff);
        const instanced = new THREE.InstancedMesh(mesh.geometry, copy, INSTANCER.cars);
        instanced.name = `instanced_car_${mesh.name.replace(/^.*_/, '')}`;
        instanced.count = 0;
        instanced.frustumCulled = false;
        instanced.castShadow = mesh.castShadow;
        instanced.receiveShadow = mesh.receiveShadow;
        instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        instanced.setColorAt(0, WHITE);
        instanced.instanceColor.setUsage(THREE.DynamicDrawUsage);
        Sim.three.scene.add(instanced);
        g = { mesh: instanced, n: 0, scaleBy: 'none', unit: 1, paint, ownGeometry: false };
        carGroups.set(key, g);
      }
      parts.push({ mesh, group: g, material });
    });
    car.instanceParts = ok && parts.length ? parts : null;
    return car.instanceParts;
  }

  /**
   * One parked car: into the instances, or left to draw itself.
   * @param {Object} car
   * @returns {boolean}
   */
  function placeCar(car) {
    const root = car.mesh;
    if (!root) return false;
    const parts = carPartsOf(car);
    if (!parts) return false;
    const chase = ctx.Chase && ctx.Chase.car === car;
    let special = chase || !!root.userData.heroDriving || !root.parent || !root.visible;
    if (!special) {
      for (const part of parts) {
        const m = part.mesh.material;
        if (m !== part.material || (m.emissive && (m.emissive.r > 0 || m.emissive.g > 0 || m.emissive.b > 0) && part.group.paint)) {
          special = true;
          break;
        }
      }
    }
    if (special) return false;
    for (const part of parts) if (!part.mesh.visible) return false;
    setOwnVisible(parts, false);
    for (const part of parts) {
      const g = part.group;
      if (g.n >= g.mesh.instanceMatrix.count) continue;
      g.mesh.setMatrixAt(g.n, part.mesh.matrixWorld);
      g.mesh.setColorAt(g.n, g.paint ? part.material.color : WHITE);
      g.n++;
    }
    return true;
  }

  /**
   * An alien's parts, found once: every mesh under it with the group it
   * draws into (made on first sight) and the material it had then. The skin
   * is the one material each alien has to itself: its group's material is a
   * white copy, and the colour goes per instance.
   * @param {Object} alien
   * @returns {{mesh: THREE.Mesh, group: PartGroup, material: THREE.Material}[]|null}
   */
  function alienPartsOf(alien) {
    if (alien.instanceParts !== undefined) return alien.instanceParts;
    const parts = [];
    let ok = true;
    alien.root.traverse((/** @type {any} */ mesh) => {
      if (!mesh.isMesh || !ok) return;
      const material = mesh.material;
      if (!material || Array.isArray(material) || !material.color || material.transparent || material.map) {
        ok = false;
        return;
      }
      const skin = material === alien.skin;
      const key = `${mesh.geometry.uuid}|${skin ? 'skin' : material.uuid}|${mesh.castShadow}`;
      let g = alienGroups.get(key);
      if (!g) {
        const copy = material.clone();
        if (skin) {
          copy.color.setHex(0xffffff);
          copy.emissive.copy(skinGlow);
        }
        const instanced = new THREE.InstancedMesh(mesh.geometry, copy, INSTANCER.aliens);
        instanced.name = `instanced_alien_${skin ? 'skin' : 'part'}`;
        instanced.count = 0;
        instanced.frustumCulled = false;
        instanced.castShadow = mesh.castShadow;
        instanced.receiveShadow = mesh.receiveShadow;
        instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        instanced.setColorAt(0, WHITE);
        instanced.instanceColor.setUsage(THREE.DynamicDrawUsage);
        Sim.three.scene.add(instanced);
        g = { mesh: instanced, n: 0, scaleBy: 'none', unit: 1, paint: skin, ownGeometry: false };
        alienGroups.set(key, g);
      }
      parts.push({ mesh, group: g, material });
    });
    alien.instanceParts = ok && parts.length ? parts : null;
    return alien.instanceParts;
  }

  /**
   * One alien: into the instances, or left to draw itself.
   * @param {Object} alien
   * @returns {boolean}
   */
  function placeAlien(alien) {
    const root = alien.root;
    if (!root || !drawn(root)) return false;
    const skin = alien.skin;
    if (!skin || !skin.emissive.equals(skinGlow) || skin.transparent || skin.opacity < 1) return false;
    const parts = alienPartsOf(alien);
    if (!parts) return false;
    for (const part of parts) {
      const mesh = part.mesh;
      if (!mesh.visible || mesh.material !== part.material || !mesh.parent) return false;
      // Anything between the part and the root hidden or taken off (the
      // ray gun rides on the right arm).
      for (let o = mesh.parent; o !== root; o = o.parent) if (!o || !o.visible) return false;
      // Room for all of it (at most a pair of any one part), or none of it:
      // an alien half in the instances would be missing the rest.
      if (part.group.n + 2 > part.group.mesh.instanceMatrix.count) return false;
    }
    setOwnVisible(parts, false);
    for (const part of parts) {
      const g = part.group;
      if (g.n >= g.mesh.instanceMatrix.count) continue;
      g.mesh.setMatrixAt(g.n, part.mesh.matrixWorld);
      g.mesh.setColorAt(g.n, g.paint ? skin.color : WHITE);
      g.n++;
    }
    return true;
  }

  /**
   * One part into its instances.
   * @param {THREE.Mesh} mesh
   * @param {PartGroup} g
   * @returns {void}
   */
  function emit(mesh, g) {
    if (g.n >= g.mesh.instanceMatrix.count) return;
    matrix.copy(mesh.matrixWorld);
    if (g.scaleBy !== 'none') {
      const params = mesh.geometry.parameters || {};
      const value = g.scaleBy === 'height' ? params.height : params.radius;
      const k = (value || g.unit) / g.unit;
      if (g.scaleBy === 'height') scaleMatrix.makeScale(1, k, 1);
      else scaleMatrix.makeScale(k, k, k);
      matrix.multiply(scaleMatrix);
    }
    g.mesh.setMatrixAt(g.n, matrix);
    g.mesh.setColorAt(g.n, mesh.material.color);
    g.n++;
  }

  /**
   * One person or tree: into the instances, or left to draw itself.
   * @param {Object} owner
   * @param {string[][]} spec
   * @param {boolean} special whether its own state rules it out
   * @returns {boolean} whether it went into the instances
   */
  function place(owner, spec, special) {
    const root = owner.mesh;
    if (!root) return false;
    const parts = partsOf(owner, spec);
    if (!parts) return false;
    if (special || !root.parent || !root.visible || !plain(parts)) return false;
    for (const part of parts) if (!part.mesh.visible) return false;
    setOwnVisible(parts, false);
    for (const part of parts) emit(part.mesh, part.group);
    return true;
  }

  const PERSON_PARTS = [['_legL', 'leg'], ['_legR', 'leg'], ['_torso', 'torso'], ['_armL', 'arm'], ['_armR', 'arm'], ['_head', 'head']];
  const TREE_PARTS = [['_trunk', 'trunk'], ['_canopy', 'canopy']];

  /**
   * Once a frame, right before the render.
   * @returns {void}
   */
  function updateInstancer() {
    if (!groups.leg || !ctx.Environment) return;
    // Every world matrix up to date, once, for the whole scene (the render
    // is told not to repeat it -- see the header).
    updateWorldMatrices(Sim.three.scene);
    for (const key in groups) groups[key].n = 0;
    counts.people = 0;
    counts.trees = 0;
    for (const person of ctx.Environment.people) {
      const special = !!(person.heroName || person.abducted || person.electrocuted || person.mutating || person.armed);
      if (place(person, PERSON_PARTS, special)) counts.people++;
    }
    for (const tree of ctx.Environment.trees) {
      if (place(tree, TREE_PARTS, false)) counts.trees++;
    }
    for (const g of carGroups.values()) g.n = 0;
    counts.cars = 0;
    for (const car of ctx.Environment.cars) {
      if (placeCar(car)) counts.cars++;
    }
    for (const g of alienGroups.values()) g.n = 0;
    counts.aliens = 0;
    const aliens = ctx.systems.aliens;
    if (aliens) {
      for (const alien of aliens.instanceSources()) {
        if (placeAlien(alien)) counts.aliens++;
      }
    }
    updateShapes();
    for (const key in groups) flushGroup(groups[key]);
    for (const g of carGroups.values()) flushGroup(g);
    for (const g of alienGroups.values()) flushGroup(g);
    for (const g of shapeGroups.values()) flushGroup(g);
  }

  /**
   * Straight after the render: everything hidden for it is shown again.
   * @returns {void}
   */
  function restoreInstancer() {
    for (let i = 0; i < hidden.length; i++) hidden[i].visible = true;
    hidden.length = 0;
  }

  // ---------------------------------------------------------------------
  // Plain boxes and cylinders (see the header)
  // ---------------------------------------------------------------------

  /**
   * The unit geometry and scale for a mesh's own geometry, if it is a box or
   * a cylinder built at its centre; null otherwise.
   * @param {THREE.BufferGeometry} geo
   * @returns {{kind: string, unit: THREE.BufferGeometry, sx: number, sy: number, sz: number}|null}
   */
  function shapeOf(geo) {
    const p = geo.parameters;
    if (!p) return null;
    let kind = null;
    let unit = null;
    let sx = 1;
    let sy = 1;
    let sz = 1;
    if (geo.type === 'BoxGeometry') {
      kind = 'box';
      unit = unitBox;
      sx = p.width;
      sy = p.height;
      sz = p.depth;
    } else if (geo.type === 'CylinderGeometry' && !p.openEnded && p.thetaLength >= Math.PI * 2 - 1e-6
      && p.radiusBottom > 0 && p.heightSegments === 1) {
      const taper = Math.round((p.radiusTop / p.radiusBottom) * 1000) / 1000;
      kind = `cyl${taper}x${p.radialSegments}`;
      unit = unitCylinders.get(kind);
      if (!unit) {
        unit = new THREE.CylinderGeometry(taper, 1, 1, p.radialSegments, 1);
        unitCylinders.set(kind, unit);
      }
      sx = p.radiusBottom;
      sy = p.height;
      sz = p.radiusBottom;
    } else {
      return null;
    }
    // Built at its centre: a translated geometry (a leg hung from its hip, a
    // cone lifted onto a roof) would land in the wrong place.
    if (!geo.boundingBox) geo.computeBoundingBox();
    const c = geo.boundingBox.getCenter(new THREE.Vector3());
    if (Math.abs(c.x) > 1e-3 || Math.abs(c.y) > 1e-3 || Math.abs(c.z) > 1e-3) return null;
    return { kind, unit, sx, sy, sz };
  }

  /**
   * Whether a material can be drawn by a shared instanced one: standard,
   * untextured, opaque, single-sided, no vertex colours.
   * @param {THREE.Material} m
   * @returns {boolean}
   */
  function plainMaterial(m) {
    return !!m && !Array.isArray(m) && m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial
      && !m.map && !m.emissiveMap && !m.alphaMap && !m.normalMap && !m.envMap && !m.vertexColors
      && !m.transparent && m.opacity === 1 && m.side === THREE.FrontSide
      // A material with its own shader patch would lose it.
      && m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile;
  }

  /**
   * A source's meshes that can be instanced, found once.
   * @param {THREE.Object3D} root
   * @returns {Object[]}
   */
  function candidatesOf(root) {
    let list = shapeCandidates.get(root);
    if (list) return list;
    list = [];
    root.traverse((/** @type {any} */ mesh) => {
      if (!mesh.isMesh || mesh.isInstancedMesh || mesh.children.length) return;
      if (!plainMaterial(mesh.material)) return;
      const shape = shapeOf(mesh.geometry);
      if (!shape) return;
      const m = mesh.material;
      const key = `${shape.kind}|${m.roughness}|${m.metalness}|${m.flatShading}|${mesh.castShadow}|${mesh.receiveShadow}`;
      let g = shapeGroups.get(key);
      if (!g) {
        const material = new THREE.MeshStandardMaterial({
          color: 0xffffff, roughness: m.roughness, metalness: m.metalness, flatShading: m.flatShading
        });
        const instanced = new THREE.InstancedMesh(shape.unit, material, INSTANCER.shapes);
        instanced.name = `instanced_shape_${shape.kind}`;
        instanced.count = 0;
        instanced.frustumCulled = false;
        instanced.castShadow = mesh.castShadow;
        instanced.receiveShadow = mesh.receiveShadow;
        instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        instanced.setColorAt(0, WHITE);
        instanced.instanceColor.setUsage(THREE.DynamicDrawUsage);
        Sim.three.scene.add(instanced);
        g = { mesh: instanced, n: 0 };
        shapeGroups.set(key, g);
      }
      list.push({ mesh, group: g, material: m, sx: shape.sx, sy: shape.sy, sz: shape.sz });
    });
    shapeCandidates.set(root, list);
    return list;
  }

  /**
   * Whether a mesh would be drawn this frame: in the scene, and it and every
   * parent visible.
   * @param {THREE.Object3D} mesh
   * @returns {boolean}
   */
  function drawn(mesh) {
    const scene = Sim.three.scene;
    for (let o = mesh; o; o = o.parent) {
      if (!o.visible) return false;
      if (o === scene) return true;
    }
    return false;
  }

  /**
   * The sources of plain shapes: every building (and filling station), the
   * viaduct and the nuclear plants.
   * @param {(root: THREE.Object3D) => void} visit
   * @returns {void}
   */
  function eachShapeSource(visit) {
    for (const building of ctx.Environment.buildings) if (building.mesh) visit(building.mesh);
    for (const child of Sim.three.scene.children) {
      if (child.name === 'viaduct' || child.name === 'nuclear_plant') visit(child);
    }
  }

  /**
   * Per frame: every plain box and cylinder still drawn as it was found goes
   * into the instances.
   * @returns {void}
   */
  function updateShapes() {
    for (const g of shapeGroups.values()) g.n = 0;
    counts.shapes = 0;
    eachShapeSource((root) => {
      const list = candidatesOf(root);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const mesh = c.mesh;
        const m = mesh.material;
        if (m !== c.material || m.transparent || m.opacity !== 1) continue;
        if (m.emissive && (m.emissive.r > 0 || m.emissive.g > 0 || m.emissive.b > 0)) continue;
        if (!drawn(mesh)) continue;
        const g = c.group;
        if (g.n >= g.mesh.instanceMatrix.count) continue;
        scaleMatrix.makeScale(c.sx, c.sy, c.sz);
        matrix.multiplyMatrices(mesh.matrixWorld, scaleMatrix);
        g.mesh.setMatrixAt(g.n, matrix);
        g.mesh.setColorAt(g.n, m.color);
        g.n++;
        mesh.visible = false;
        hidden.push(mesh);
        counts.shapes++;
      }
    });
  }

  /**
   * @param {PartGroup} g
   * @returns {void}
   */
  function flushGroup(g) {
    g.mesh.count = g.n;
    g.mesh.instanceMatrix.needsUpdate = true;
    g.mesh.instanceColor.needsUpdate = true;
  }

  /** @returns {{people: number, trees: number, cars: number, shapes: number, aliens: number}} how many were drawn instanced last frame */
  function instancedCount() {
    return { people: counts.people, trees: counts.trees, cars: counts.cars, shapes: counts.shapes, aliens: counts.aliens };
  }

  /** @returns {void} the people and trees are rebuilt by the Reset; the instances refill next frame */
  function resetInstancer() {
    for (const key in groups) groups[key].mesh.count = 0;
    for (const g of carGroups.values()) g.mesh.count = 0;
    for (const g of alienGroups.values()) g.mesh.count = 0;
    for (const g of shapeGroups.values()) g.mesh.count = 0;
    restoreInstancer();
  }

  /** @returns {void} */
  function disposeInstancer() {
    for (const key in groups) {
      const { mesh } = groups[key];
      Sim.three.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    }
    groups = {};
    // The cars' groups borrow the cars' own (shared) geometry: only their
    // copied materials are theirs to dispose.
    for (const g of carGroups.values()) {
      Sim.three.scene.remove(g.mesh);
      g.mesh.material.dispose();
      g.mesh.dispose();
    }
    carGroups.clear();
    for (const g of alienGroups.values()) {
      Sim.three.scene.remove(g.mesh);
      g.mesh.material.dispose();
      g.mesh.dispose();
    }
    alienGroups.clear();
    for (const g of shapeGroups.values()) {
      Sim.three.scene.remove(g.mesh);
      g.mesh.material.dispose();
      g.mesh.dispose();
    }
    shapeGroups.clear();
    unitBox.dispose();
    for (const geo of unitCylinders.values()) geo.dispose();
    unitCylinders.clear();
  }

  return { initInstancer, updateInstancer, restoreInstancer, instancedCount, resetInstancer, disposeInstancer };
}
