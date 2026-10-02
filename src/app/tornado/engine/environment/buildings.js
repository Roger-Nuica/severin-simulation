import * as THREE from 'three';
import { mulberry32 } from './roadsDecor.js';
import { BUILDINGS, STOREY } from '../scale.js';
import { LIGHTING } from '../lightingTuning.js';

/**
 * ---------------------------------------------------------------------
 * Lit windows: small emissive-looking quads arranged in a grid across a
 * building's four walls, batched into a single InstancedMesh per building
 * so a whole building's window grid costs one extra draw call regardless
 * of size. Unlit via MeshBasicMaterial (ignores scene lighting) with
 * per-instance vertex colour doubling as each pane's lit/dark state, so
 * darkenBuildingWindows() can black panes out on damage by recolouring
 * existing instances -- no geometry, materials or draw calls are added or
 * removed at runtime.
 * ---------------------------------------------------------------------
 */
export const WINDOW_LIT_COLOUR = new THREE.Color(0xffcf7a);
// Real panes, one row per storey (engine/scale.js BUILDINGS.window).
const WINDOW_SIZE = { w: BUILDINGS.window.width, h: BUILDINGS.window.height };
const WINDOW_COL_GAP = BUILDINGS.window.bay;
const WINDOW_MARGIN = 0.9;
const WINDOW_FACE_OFFSET = 0.23; // half the wall thickness plus a hair of clearance, so panes sit just proud of the facade

// Grazing-angle rim highlight on window panes. Deliberately cool and
// slightly blue, so it reads as sky/storm light glancing off glass rather
// than as more of the warm interior glow the emissive colour already gives.
const WINDOW_FRESNEL_POWER = 3;
const WINDOW_FRESNEL_STRENGTH = 0.5;
const WINDOW_FRESNEL_COLOUR = new THREE.Color(0x9ec4e8);

// HDR gain on a lit pane's interior glow. The pane colour itself is
// WINDOW_LIT_COLOUR (luminance ~0.67 linear); this takes it to ~1.6, over
// the bloom threshold in post.js, and the composite's highlight shoulder
// maps it back to the same amber on screen -- so the pane looks the colour
// it always did, but now carries a halo. Blacked-out panes scale to ~0.02,
// nowhere near the threshold.
const WINDOW_GLOW_GAIN = 2.4 * LIGHTING.buildingEmissiveScale;

/**
 * @typedef {'house'|'townhouse'|'apartment'|'shop'} BuildingVariantName
 */

/**
 * Silhouette variants, picked per building from its seed so the town layout
 * is stable across reloads. Sizes in metres, from engine/scale.js BUILDINGS
 * (footprints that fit the ~22 m building-spot grid in generateEnvironment,
 * heights in whole storeys of STOREY); the look and the toughness here. `sturdiness` is added to the damage threshold, so the
 * big blocks shed pieces later than a small house under the same wind.
 * @type {Object<BuildingVariantName, {
 *   weight:number, width:number[], depth:number[], storeys:number[], storeyHeight?:number,
 *   hue:number[], saturation:number, lightness:number[],
 *   roofColours:number[], sturdiness:number
 * }>}
 */
const BUILDING_VARIANTS = {
  // Small detached house, gabled roof, pastel walls.
  house: {
    weight: 0.3, ...BUILDINGS.house,
    hue: [0.0, 1.0], saturation: 0.28, lightness: [0.5, 0.64],
    roofColours: [0x5a3a2e, 0x3e4a57, 0x6b3b30, 0x4a4540], sturdiness: 0
  },
  // The original mid-rise with a hipped pyramid roof.
  townhouse: {
    weight: 0.3, ...BUILDINGS.townhouse,
    hue: [0.08, 0.14], saturation: 0.25, lightness: [0.4, 0.6],
    roofColours: [0x5a3a2e, 0x4f3328], sturdiness: 0.5
  },
  // Tall flat-roofed apartment block, cool concrete greys.
  apartment: {
    weight: 0.2, ...BUILDINGS.apartment,
    hue: [0.55, 0.62], saturation: 0.07, lightness: [0.42, 0.58],
    roofColours: [0x3b3f45, 0x45484d], sturdiness: 1.5
  },
  // Wide, low shop with a flat roof and a coloured awning.
  shop: {
    weight: 0.2, ...BUILDINGS.shop,
    hue: [0.05, 0.12], saturation: 0.18, lightness: [0.55, 0.68],
    roofColours: [0x3b3f45, 0x4a4540], sturdiness: 0.5
  }
};
const SHOP_AWNING_COLOURS = [0x9b2f2f, 0x2f6b4a, 0x2f4f8a, 0xb07a24];

/**
 * @param {number} r uniform random number in [0, 1)
 * @returns {BuildingVariantName}
 */
function pickVariant(r) {
  let acc = 0;
  for (const [name, def] of Object.entries(BUILDING_VARIANTS)) {
    acc += def.weight;
    if (r < acc) return /** @type {BuildingVariantName} */ (name);
  }
  return 'townhouse';
}

// Reused for every hide; an instance scaled to zero collapses to a point and
// rasterises nothing, which is cheaper and less fragile than moving panes
// off to some arbitrary "away" coordinate.
export const WINDOW_HIDDEN_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Hides a building's window panes: those belonging to one wall, or all of
 * them when `wallName` is omitted.
 *
 * This exists because the panes are a single InstancedMesh covering all four
 * facades, while the walls themselves are four separate meshes that damage
 * removes one at a time. Without this, tearing a wall off left its whole
 * grid of panes hanging in the air exactly where the wall used to be --
 * the flat rectangles seen floating over the rubble. darkenBuildingWindows()
 * only ever recoloured them, so they stayed just as solid once dark.
 * @param {THREE.Group} root
 * @param {'N'|'S'|'E'|'W'} [wallName] omit to hide every remaining pane
 * @returns {void}
 */
export function hideBuildingWindows(root, wallName) {
  const windows = root.userData.windows;
  if (!windows) return;
  const faces = windows.mesh.userData.faces;
  let changed = false;
  for (let i = 0; i < windows.totalCount; i++) {
    if (wallName && faces[i] !== wallName) continue;
    windows.mesh.setMatrixAt(i, WINDOW_HIDDEN_MATRIX);
    changed = true;
  }
  if (changed) windows.mesh.instanceMatrix.needsUpdate = true;
}

/**
 * @param {Object} ctx
 * @returns {{
 *   createBuilding: (x: number, z: number, seed: number, room?: {hx: number, hz: number}) => Object,
 *   windowUniforms: {uGlowGain: {value: number}, uDaylight: {value: number}, uDayGlass: {value: THREE.Color}}
 * }}
 */
export function createBuildingsSystem(ctx) {
  const { nextObjectId } = ctx;

  /** @type {THREE.MeshBasicMaterial|null} */
  let windowMaterial = null;

  // Shared by reference with the window shader, so dayNight.js can dim the
  // interiors and swap in daylight glass without recompiling anything.
  const windowUniforms = {
    uGlowGain: { value: WINDOW_GLOW_GAIN },
    // 0 at night, 1 in Day Mode (see engine/dayNight.js).
    uDaylight: { value: 0 },
    // Daylight glass: sky reflected in a dark pane, the same for lit and
    // unlit windows -- nobody's lights show at noon.
    uDayGlass: { value: new THREE.Color(0x2f3c4f) }
  };

  /**
   * The single material shared by every building's window InstancedMesh.
   *
   * Shared rather than one per building because the fresnel below is injected
   * through onBeforeCompile, and a distinct material object per building would
   * mean the renderer tracking dozens of identical materials. Each building
   * still gets its own InstancedMesh (and so its own instanceColor buffer),
   * which is what darkenBuildingWindows() actually writes to -- the material
   * carries no per-building state.
   *
   * MeshBasicMaterial is kept rather than switching to MeshPhysicalMaterial's
   * built-in clearcoat/reflectivity: these panes are unlit by design (the
   * "glow" is their flat instance colour, not emission under scene lights), so
   * a lit material would need the whole lighting pipeline evaluated per pane
   * across every instance just to fake one rim term, and would visibly change
   * how the windows read at night. A hand-injected fresnel costs one dot
   * product and one pow per fragment instead.
   * @returns {THREE.MeshBasicMaterial}
   */
  function getWindowMaterial() {
    if (windowMaterial) return windowMaterial;
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uFresnelPower = { value: WINDOW_FRESNEL_POWER };
      shader.uniforms.uFresnelStrength = { value: WINDOW_FRESNEL_STRENGTH };
      shader.uniforms.uFresnelColour = { value: WINDOW_FRESNEL_COLOUR };
      shader.uniforms.uGlowGain = windowUniforms.uGlowGain;
      shader.uniforms.uDaylight = windowUniforms.uDaylight;
      shader.uniforms.uDayGlass = windowUniforms.uDayGlass;

      // MeshBasicMaterial computes no normal varying of its own (it has no
      // lighting to use one for), so the world normal and view vector are
      // built here. The USE_INSTANCING branch matters: without folding
      // instanceMatrix in, every pane on every wall would share the base
      // mesh's orientation and the highlight would ignore which way the
      // facade actually faces.
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
varying vec3 vWinNormal;
varying vec3 vWinView;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
mat4 winModel = modelMatrix;
#ifdef USE_INSTANCING
  winModel = modelMatrix * instanceMatrix;
#endif
vec4 winWorldPos = winModel * vec4( transformed, 1.0 );
vWinNormal = normalize( mat3( winModel ) * normal );
vWinView = normalize( cameraPosition - winWorldPos.xyz );`);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uFresnelPower;
uniform float uFresnelStrength;
uniform vec3 uFresnelColour;
uniform float uGlowGain;
uniform float uDaylight;
uniform vec3 uDayGlass;
varying vec3 vWinNormal;
varying vec3 vWinView;`)
        // Injected after <color_fragment>, which is where diffuseColor has
        // just been multiplied by the per-instance colour -- so diffuseColor
        // here IS the pane's lit/dark state and can gate the highlight
        // without needing a second varying.
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  float winNdotV = abs( dot( normalize( vWinNormal ), normalize( vWinView ) ) );
  float winFresnel = pow( 1.0 - clamp( winNdotV, 0.0, 1.0 ), uFresnelPower );
  float winLit = max( diffuseColor.r, max( diffuseColor.g, diffuseColor.b ) );
  // Blacked-out panes (WINDOW_DARK_COLOUR is ~0.007 in linear) fall below
  // this ramp and lose the reflection along with the glow; lit panes
  // (~1.0) keep it in full.
  float winLitMask = smoothstep( 0.02, 0.2, winLit );
  // Gain before the rim, so only the interior glow goes HDR: the rim is sky
  // reflected off glass and should not bloom.
  diffuseColor.rgb = mix( diffuseColor.rgb * uGlowGain, uDayGlass, uDaylight );
  diffuseColor.rgb += uFresnelColour * winFresnel * uFresnelStrength * max( winLitMask, uDaylight );
}`);
    };
    // Every window material is identical, so pinning one cache key lets the
    // renderer compile and reuse a single program for all of them.
    mat.customProgramCacheKey = () => 'tornado-window-fresnel';
    windowMaterial = mat;
    return mat;
  }

  /**
   * Fisher-Yates shuffle using a supplied RNG, so window darken order can be
   * randomised while staying reproducible for a given building seed.
   * @template T
   * @param {T[]} arr
   * @param {() => number} rand
   * @returns {T[]}
   */
  function shuffleWithRand(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * Builds the window-grid InstancedMesh for one building, in the building's
   * local space (added as a child of its root group), so it moves/deletes
   * along with the rest of the building for free.
   * @param {number} width
   * @param {number} depth
   * @param {number} storeys
   * @param {number} storeyHeight
   * @param {() => number} rand
   * @returns {THREE.InstancedMesh|null}
   */
  function createBuildingWindows(width, depth, storeys, storeyHeight, rand) {
    // `name` must stay in step with createBuilding's wallDefs (N, S, E, W in
    // this same order): it is what lets detachBuildingPiece find and hide the
    // panes belonging to a wall it has just torn off the building.
    const wallFaces = [
      { name: 'N', length: width, lx: 0, lz: -depth / 2, nx: 0, nz: -1, rotY: Math.PI, along: 'x' },
      { name: 'S', length: width, lx: 0, lz: depth / 2, nx: 0, nz: 1, rotY: 0, along: 'x' },
      { name: 'E', length: depth, lx: width / 2, lz: 0, nx: 1, nz: 0, rotY: Math.PI / 2, along: 'z' },
      { name: 'W', length: depth, lx: -width / 2, lz: 0, nx: -1, nz: 0, rotY: -Math.PI / 2, along: 'z' }
    ];

    const rows = storeys;
    const placements = [];
    for (const face of wallFaces) {
      const usable = face.length - WINDOW_MARGIN * 2;
      if (usable <= 0) continue;
      const cols = Math.max(1, Math.round(usable / WINDOW_COL_GAP));
      for (let r = 0; r < rows; r++) {
        // A row per storey, the pane's foot at sill height.
        const y = r * storeyHeight + BUILDINGS.window.sill + WINDOW_SIZE.h / 2;
        for (let c = 0; c < cols; c++) {
          const t = cols === 1 ? 0.5 : c / (cols - 1);
          const along = (t - 0.5) * usable;
          const x = face.lx + (face.along === 'x' ? along : 0) + face.nx * WINDOW_FACE_OFFSET;
          const z = face.lz + (face.along === 'z' ? along : 0) + face.nz * WINDOW_FACE_OFFSET;
          placements.push({ x, y, z, rotY: face.rotY, face: face.name });
        }
      }
    }
    if (!placements.length) return null;
    shuffleWithRand(placements, rand);

    const geo = new THREE.PlaneGeometry(WINDOW_SIZE.w, WINDOW_SIZE.h);
    // material.vertexColors requires a geometry 'color' attribute to multiply
    // against -- PlaneGeometry has none by default, and an unbound attribute
    // reads as (0,0,0) in WebGL, which would silently zero out every window
    // to black regardless of its instance colour. Filling it with white
    // makes that multiply a no-op, leaving the per-instance colour (set via
    // setColorAt below) as the only thing that determines each pane's tint.
    geo.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3)
    );
    const mesh = new THREE.InstancedMesh(geo, getWindowMaterial(), placements.length);
    mesh.name = 'buildingWindows';

    const dummy = new THREE.Object3D();
    placements.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.rotY, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, WINDOW_LIT_COLOUR);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    // Recorded after the shuffle, so index i here is the same instance index i
    // is in the InstancedMesh. hideBuildingWindows() uses it to hide exactly
    // the panes that belonged to a wall once that wall is gone.
    mesh.userData.faces = placements.map(pl => pl.face);
    return mesh;
  }

  /**
   * Builds the roof piece for a variant. Whatever shape it takes, it is a
   * single Object3D with pieceName 'roof' so damage.js can tear it off as
   * one piece exactly as before; its origin sits on top of the walls.
   * @param {BuildingVariantName} variant
   * @param {number} width
   * @param {number} depth
   * @param {THREE.Material} roofMat
   * @param {() => number} rand
   * @returns {THREE.Object3D}
   */
  function createRoof(variant, width, depth, roofMat, rand) {
    if (variant === 'house') {
      // Gabled: a triangular prism with its ridge running along the depth,
      // overhanging the walls a little on every side.
      const overhang = 0.35;
      const halfW = width / 2 + overhang;
      const ridge = 1.8 + rand() * 0.9;
      const shape = new THREE.Shape();
      shape.moveTo(-halfW, 0);
      shape.lineTo(halfW, 0);
      shape.lineTo(0, ridge);
      shape.closePath();
      const length = depth + overhang * 2;
      const geo = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
      geo.translate(0, 0, -length / 2);
      const roof = new THREE.Mesh(geo, roofMat);
      roof.castShadow = true;
      return roof;
    }

    if (variant === 'apartment' || variant === 'shop') {
      // Flat: a slab with a slight lip, plus rooftop plant on the apartment
      // blocks (a water tank and a plant-room box), which is what makes a
      // flat roof read as a roof rather than the top of a crate.
      const group = new THREE.Group();
      const slab = new THREE.Mesh(new THREE.BoxGeometry(width + 0.3, 0.35, depth + 0.3), roofMat);
      slab.position.y = 0.175;
      slab.castShadow = true;
      slab.receiveShadow = true;
      group.add(slab);
      if (variant === 'apartment') {
        const plantMat = new THREE.MeshStandardMaterial({ color: 0x5b5f66, roughness: 0.8 });
        const plant = new THREE.Mesh(new THREE.BoxGeometry(width * 0.35, 1.3, depth * 0.3), plantMat);
        plant.position.set((rand() - 0.5) * width * 0.3, 1.0, (rand() - 0.5) * depth * 0.3);
        // No shadow: too small to show in a 1024 shadow map, and every caster
        // is drawn a second time into it (performance pass).
        plant.castShadow = false;
        group.add(plant);
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.6, 10), plantMat);
        tank.position.set(-width * 0.28, 1.15, depth * 0.25);
        tank.castShadow = false;
        group.add(tank);
      }
      return group;
    }

    // Hipped: the original four-sided pyramid.
    const geo = new THREE.ConeGeometry(Math.max(width, depth) * 0.75, 3, 4);
    geo.translate(0, 1.5, 0);
    const roof = new THREE.Mesh(geo, roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    return roof;
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {number} seed
   * @param {{hx: number, hz: number}} [room] the most it may reach out from
   *   its centre along x and z without touching a neighbour
   * @returns {SimObject}
   */
  function createBuilding(x, z, seed, room) {
    const rand = mulberry32(seed + 1);
    const variant = pickVariant(rand());
    const def = BUILDING_VARIANTS[variant];
    let width = def.width[0] + rand() * (def.width[1] - def.width[0]);
    let depth = def.depth[0] + rand() * (def.depth[1] - def.depth[0]);
    // Whole storeys (engine/scale.js STOREY), and a parapet over the top.
    const storeyHeight = def.storeyHeight || STOREY;
    const storeys = def.storeys[0] + Math.floor(rand() * (def.storeys[1] - def.storeys[0] + 1));
    const wallHeight = storeys * storeyHeight + BUILDINGS.parapet;
    const colour = new THREE.Color().setHSL(
      def.hue[0] + rand() * (def.hue[1] - def.hue[0]),
      def.saturation,
      def.lightness[0] + rand() * (def.lightness[1] - def.lightness[0])
    );
    const roofColour = def.roofColours[Math.floor(rand() * def.roofColours.length)];

    const root = new THREE.Group();
    root.name = `building_${seed}`;
    root.position.set(x, 0, z);
    // A quarter-turn on half the buildings so gables and shop fronts face
    // different streets. Footprint width/depth are swapped to match, since
    // the chase collision boxes in drive.js are axis-aligned.
    const turned = rand() < 0.5;
    if (turned) root.rotation.y = Math.PI / 2;
    // No bigger than the room its spot has between its neighbours (found by
    // generateEnvironment), so the real-size buildings never overlap.
    if (room) {
      const maxX = room.hx * 2;
      const maxZ = room.hz * 2;
      if (turned) {
        depth = Math.min(depth, maxX);
        width = Math.min(width, maxZ);
      } else {
        width = Math.min(width, maxX);
        depth = Math.min(depth, maxZ);
      }
    }

    const wallMat = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: roofColour, roughness: 0.8 });

    // Four independently addressable wall sections (N, S, E, W) + a roof panel,
    // so damage can remove pieces individually.
    const wallThickness = 0.4;
    const wallDefs = [
      { name: 'N', w: width, d: wallThickness, x: 0, z: -depth / 2 },
      { name: 'S', w: width, d: wallThickness, x: 0, z: depth / 2 },
      { name: 'E', w: wallThickness, d: depth, x: width / 2, z: 0 },
      { name: 'W', w: wallThickness, d: depth, x: -width / 2, z: 0 }
    ];
    const wallMeshes = wallDefs.map(wd => {
      const geo = new THREE.BoxGeometry(wd.w, wallHeight, wd.d);
      const mesh = new THREE.Mesh(geo, wallMat);
      mesh.position.set(wd.x, wallHeight / 2, wd.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `${root.name}_wall_${wd.name}`;
      mesh.userData.pieceName = 'wall-' + wd.name;
      mesh.userData.lost = false;
      root.add(mesh);
      return mesh;
    });

    // Shop front: a coloured awning over the south wall. Parented to the
    // wall itself so it goes with the wall when damage tears that off.
    if (variant === 'shop') {
      const awningMat = new THREE.MeshStandardMaterial({
        color: SHOP_AWNING_COLOURS[Math.floor(rand() * SHOP_AWNING_COLOURS.length)], roughness: 0.7
      });
      const awning = new THREE.Mesh(new THREE.BoxGeometry(width * 0.8, 0.12, 1.5), awningMat);
      awning.name = `${root.name}_awning`;
      awning.position.set(0, storeyHeight * 0.68 - wallHeight / 2, 0.85);
      awning.rotation.x = 0.22;
      awning.castShadow = false;
      wallMeshes[1].add(awning);
    }

    const roof = createRoof(variant, width, depth, roofMat, rand);
    roof.position.y = wallHeight;
    roof.name = `${root.name}_roof`;
    roof.userData.pieceName = 'roof';
    roof.userData.lost = false;
    root.add(roof);

    const windowMesh = createBuildingWindows(width, depth, storeys, storeyHeight, rand);
    if (windowMesh) root.add(windowMesh);

    /** @type {SimObject} */
    const obj = {
      id: nextObjectId.value++,
      type: 'building',
      mesh: root,
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
      mass: 400 + width * depth * 8,
      drag: 0,
      rooted: true,
      damageState: 'intact',
      breakThreshold: 5.5 + def.sturdiness + rand() * 2.5,
      liftEligible: 0,
      pooled: false,
      poolIndex: -1,
      lifeTimer: 0,
      captureState: 'grounded'
    };
    root.userData.simObject = obj;
    root.userData.variant = variant;
    root.userData.pieces = { roof, walls: wallMeshes };
    root.userData.wallHeight = wallHeight;
    root.userData.footprint = turned ? { width: depth, depth: width } : { width, depth };
    root.userData.windows = windowMesh
      ? { mesh: windowMesh, totalCount: windowMesh.count, darkCount: 0 }
      : null;
    return obj;
  }

  return { createBuilding, windowUniforms };
}
