import * as THREE from 'three';
import { CHASM, LAVA_VERTEX, LAVA_FRAGMENT, WALL_ORDER, LID_ORDER, LID_Y, SOIL_TOP, SOIL_MID, ROCK_DEEP, RIM_OUTER, RIM_LIP } from './chasm/config.js';

/**
 * ===========================================================================
 * SECTION AI — The chasm
 * ===========================================================================
 * What a big earthquake does to the town: the ground splits open along a
 * ragged line right across it, the two sides pull apart, and what was
 * standing on the line goes down into the gap. Opened by engine/earthquake.js
 * a beat into the shaking.
 *
 * The ground is one flat plane, so there is nothing to actually tear. The
 * hole is made with the depth buffer instead:
 *  1. the chasm's walls and floor are drawn first (renderOrder WALL_ORDER),
 *     well below y = 0 where they would normally be hidden by the ground;
 *  2. then an invisible lid over the opening, at just above ground level,
 *     that writes depth but no colour (renderOrder LID_ORDER);
 *  3. then everything else as usual. The ground, the roads and every decal
 *     on them lie below the lid, so inside the opening they fail the depth
 *     test and are simply not drawn -- and what shows through is the walls.
 * Anything taller than the lid (a building, a person, a car) still draws
 * normally over the gap, which is exactly what a chasm should look like
 * until they fall in.
 *
 * The crack unzips outward from the middle over CHASM.openSeconds, widening
 * as it goes; broken, uplifted lips of ground line both edges. Once open it
 * is permanent for the run and a hazard the crowd steers round
 * (engine/hazards.js). People, cars and trees caught on the line fall in and
 * are gone; buildings over it collapse and those beside it are shaken; a
 * chase car driven into it is the end of the chase.
 */

/**
 * @typedef {Object} Chasm
 * @property {{x: number, z: number, nx: number, nz: number, s: number, half: number, jagL: number, jagR: number}[]} path
 *   centre line; (nx, nz) the unit normal; s in -1..1 along the length; half
 *   the full-open half-width there
 * @property {number} dirX
 * @property {number} dirZ
 * @property {number} cx
 * @property {number} cz
 * @property {number} timer
 * @property {number} open 0..1 overall
 * @property {Float32Array} openAt per point, 0..1
 * @property {THREE.Mesh} walls
 * @property {THREE.Mesh} lid
 * @property {THREE.Mesh} rims
 * @property {THREE.Mesh} lava
 * @property {number} lavaFill 0..1 how far the lava has risen
 * @property {Object[]} hazards
 * @property {Set<Object>} shocked buildings already hit
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initChasms: () => void,
 *   openChasm: () => void,
 *   updateChasms: (dt: number) => void,
 *   gapAt: (x: number, z: number) => number,
 *   resetChasms: () => void,
 *   disposeChasms: () => void
 * }}
 */
export function createChasmSystem(ctx) {
  const { Sim } = ctx;

  /** @type {THREE.Group|null} */
  let group = null;
  /** @type {Chasm[]} */
  let chasms = [];
  let frozen = false;
  /** @type {{obj: Object, mesh: THREE.Object3D, vy: number, spin: THREE.Vector3, person: boolean}[]} */
  let falling = [];
  let checkTimer = 0;
  /** @type {THREE.Material[]} */
  let materials = [];
  let chaseCarFalling = null;
  /** @type {THREE.ShaderMaterial|null} */
  let lavaMaterial = null;
  // Shared by every chasm's walls: the fullest lava of any of them.
  const lavaUniform = { value: 0 };
  let time = 0;

  /** @returns {void} */
  function initChasms() {
    group = new THREE.Group();
    group.name = 'chasms';
    Sim.three.scene.add(group);
    // Lit, so the walls sit in the scene's own light (dim at night, darker
    // still as they face away from it) rather than glowing like a decal.
    const wallMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    // The rock just above the lava glows with its heat: a per-vertex weight
    // (aGlow, 1 at the bottom row) times how full the lava is (uLava), added
    // to Lambert's own emissive term.
    wallMat.onBeforeCompile = (shader) => {
      shader.uniforms.uLava = lavaUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform float uLava;')
        .replace('#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3( 1.6, 0.36, 0.05 ) * vGlow * vGlow * uLava;');
    };
    const lidMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, side: THREE.DoubleSide });
    const rimMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    lavaMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uHeat: { value: 1 } },
      vertexShader: LAVA_VERTEX,
      fragmentShader: LAVA_FRAGMENT,
      side: THREE.DoubleSide
    });
    materials = [wallMat, lidMat, rimMat, lavaMaterial];
  }

  // ---------------------------------------------------------------------
  // Shape
  // ---------------------------------------------------------------------

  /**
   * A ragged path right across the map through somewhere near the middle of
   * town, on a random bearing.
   * @returns {Chasm['path']}
   */
  function makePath(cx, cz, heading) {
    const count = Math.round(CHASM.length / CHASM.step) + 1;
    const half = Math.floor(count / 2);
    const points = new Array(count);
    // Walked out from the middle in both directions, so the middle is where
    // it was aimed.
    for (const dir of [1, -1]) {
      let x = cx;
      let z = cz;
      let h = heading;
      for (let k = 0; k <= half; k++) {
        const i = half + dir * k;
        if (i < 0 || i >= count) break;
        if (k > 0) {
          h += (Math.random() - 0.5) * CHASM.wander;
          // Pulled back towards the overall bearing, so it wanders rather
          // than curling round on itself.
          h += (heading - h) * 0.15;
          x += Math.cos(h) * CHASM.step * dir;
          z += Math.sin(h) * CHASM.step * dir;
        }
        points[i] = { x, z, nx: 0, nz: 0, s: (i - half) / half, half: 0, jagL: 1, jagR: 1 };
      }
    }
    for (let i = 0; i < count; i++) {
      const a = points[Math.max(0, i - 1)];
      const b = points[Math.min(count - 1, i + 1)];
      const tx = b.x - a.x;
      const tz = b.z - a.z;
      const len = Math.hypot(tx, tz) || 1;
      const p = points[i];
      p.nx = -tz / len;
      p.nz = tx / len;
      const taper = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(p.s), 1.8)), 0.7);
      p.half = CHASM.endHalfWidth + (CHASM.halfWidth - CHASM.endHalfWidth) * taper;
      p.jagL = CHASM.jag[0] + Math.random() * (CHASM.jag[1] - CHASM.jag[0]);
      p.jagR = CHASM.jag[0] + Math.random() * (CHASM.jag[1] - CHASM.jag[0]);
    }
    return points;
  }

  /**
   * Builds the three meshes for a path, with index buffers fixed and the
   * positions filled in by poseChasm as it opens.
   * @param {Chasm['path']} path
   * @returns {{walls: THREE.Mesh, lid: THREE.Mesh, rims: THREE.Mesh}}
   */
  function buildMeshes(path) {
    const n = path.length;
    const rows = CHASM.wallRows + 1;

    // Walls: left wall rows, then right wall rows; the floor joins their
    // bottom rows.
    const wallCount = n * rows * 2;
    const wallGeo = new THREE.BufferGeometry();
    wallGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wallCount * 3), 3));
    const colours = new Float32Array(wallCount * 3);
    const c = new THREE.Color();
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i < n; i++) {
        for (let r = 0; r < rows; r++) {
          const u = r / (rows - 1);
          // Soil at the top, banded rock, black at the bottom.
          // A thin band of soil, then rock falling off quickly into black, so
          // the gap reads as deep rather than as a shallow ditch.
          if (u < 0.18) c.copy(SOIL_TOP).lerp(SOIL_MID, u / 0.18);
          else c.copy(SOIL_MID).lerp(ROCK_DEEP, Math.min(1, Math.pow((u - 0.18) / 0.5, 0.9)));
          // Strata: alternate rows lighter and darker, so the walls are
          // banded like the cut face of the ground.
          const grain = 0.8 + Math.random() * 0.3 + (r % 2 ? 0.16 : -0.1);
          const k = ((side * n + i) * rows + r) * 3;
          colours[k] = c.r * grain;
          colours[k + 1] = c.g * grain;
          colours[k + 2] = c.b * grain;
        }
      }
    }
    wallGeo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    const glow = new Float32Array(wallCount);
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i < n; i++) {
        for (let r = 0; r < rows; r++) {
          const u = r / (rows - 1);
          glow[(side * n + i) * rows + r] = THREE.MathUtils.smoothstep(u, CHASM.lavaGlowFrom, 1);
        }
      }
    }
    wallGeo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
    const wallIndex = [];
    const at = (side, i, r) => (side * n + i) * rows + r;
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i < n - 1; i++) {
        for (let r = 0; r < rows - 1; r++) {
          const a = at(side, i, r);
          const b = at(side, i + 1, r);
          const d = at(side, i, r + 1);
          const e = at(side, i + 1, r + 1);
          wallIndex.push(a, b, d, b, e, d);
        }
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = at(0, i, rows - 1);
      const b = at(0, i + 1, rows - 1);
      const d = at(1, i, rows - 1);
      const e = at(1, i + 1, rows - 1);
      wallIndex.push(a, b, d, b, e, d);
    }
    wallGeo.setIndex(wallIndex);
    const walls = new THREE.Mesh(wallGeo, materials[0]);
    walls.renderOrder = WALL_ORDER;
    walls.frustumCulled = false;
    walls.name = 'chasm_walls';

    // Lid: one strip over the opening.
    const lidGeo = new THREE.BufferGeometry();
    lidGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    const lidIndex = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      lidIndex.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
    }
    lidGeo.setIndex(lidIndex);
    const lid = new THREE.Mesh(lidGeo, materials[1]);
    lid.renderOrder = LID_ORDER;
    lid.frustumCulled = false;
    lid.name = 'chasm_lid';

    // Rims: per side, an outer vertex flush with the ground and the heaved-up
    // lip at the edge of the drop.
    const rimGeo = new THREE.BufferGeometry();
    rimGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3));
    const rimColours = new Float32Array(n * 4 * 3);
    for (let i = 0; i < n; i++) {
      for (let side = 0; side < 2; side++) {
        const base = (i * 4 + side * 2) * 3;
        const grain = 0.85 + Math.random() * 0.3;
        rimColours.set([RIM_OUTER.r, RIM_OUTER.g, RIM_OUTER.b], base);
        rimColours.set([RIM_LIP.r * grain, RIM_LIP.g * grain, RIM_LIP.b * grain], base + 3);
      }
    }
    rimGeo.setAttribute('color', new THREE.BufferAttribute(rimColours, 3));
    const rimIndex = [];
    for (let i = 0; i < n - 1; i++) {
      for (let side = 0; side < 2; side++) {
        const o0 = i * 4 + side * 2;
        const l0 = o0 + 1;
        const o1 = o0 + 4;
        const l1 = l0 + 4;
        rimIndex.push(o0, o1, l0, o1, l1, l0);
      }
    }
    rimGeo.setIndex(rimIndex);
    const rims = new THREE.Mesh(rimGeo, materials[2]);
    rims.frustumCulled = false;
    rims.receiveShadow = true;
    rims.name = 'chasm_rims';

    // The lava surface: one strip across the gap at the lava's level.
    const lavaGeo = new THREE.BufferGeometry();
    lavaGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    lavaGeo.setIndex(lidIndex.slice());
    const lava = new THREE.Mesh(lavaGeo, lavaMaterial);
    lava.renderOrder = WALL_ORDER;
    lava.frustumCulled = false;
    lava.visible = false;
    lava.name = 'chasm_lava';

    return { walls, lid, rims, lava };
  }

  /**
   * Writes every vertex for how far open each point of the chasm is.
   * @param {Chasm} chasm
   * @returns {void}
   */
  function poseChasm(chasm) {
    const { path, openAt } = chasm;
    const n = path.length;
    const rows = CHASM.wallRows + 1;
    const wallPos = chasm.walls.geometry.attributes.position.array;
    const lidPos = chasm.lid.geometry.attributes.position.array;
    const rimPos = chasm.rims.geometry.attributes.position.array;
    for (let i = 0; i < n; i++) {
      const p = path[i];
      const o = openAt[i];
      const halfL = p.half * p.jagL * o;
      const halfR = p.half * p.jagR * o;
      const depth = CHASM.depth * Math.min(1, o * 1.4);
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? 1 : -1;
        const half = side === 0 ? halfL : halfR;
        for (let r = 0; r < rows; r++) {
          const u = r / (rows - 1);
          // Walls lean in towards the bottom, and bulge a little row to row
          // so they read as broken rock rather than a smooth slot.
          const inset = half * (CHASM.wallLean * u) + (r > 0 && r < rows - 1 ? Math.sin(i * 1.7 + r * 2.3) * 0.5 * o : 0);
          const off = sign * Math.max(0.05, half - inset);
          const k = ((side * n + i) * rows + r) * 3;
          wallPos[k] = p.x + p.nx * off;
          wallPos[k + 1] = -depth * u;
          wallPos[k + 2] = p.z + p.nz * off;
        }
        const edge = sign * half;
        const lk = (i * 2 + side) * 3;
        lidPos[lk] = p.x + p.nx * edge;
        lidPos[lk + 1] = LID_Y;
        lidPos[lk + 2] = p.z + p.nz * edge;
        const outer = sign * (half + CHASM.rimWidth * o);
        const rk = (i * 4 + side * 2) * 3;
        rimPos[rk] = p.x + p.nx * outer;
        rimPos[rk + 1] = 0.02;
        rimPos[rk + 2] = p.z + p.nz * outer;
        rimPos[rk + 3] = p.x + p.nx * edge;
        rimPos[rk + 4] = 0.02 + CHASM.rimLift * o * (0.6 + 0.4 * Math.sin(i * 2.9 + side));
        rimPos[rk + 5] = p.z + p.nz * edge;
      }
    }
    chasm.walls.geometry.attributes.position.needsUpdate = true;
    chasm.walls.geometry.computeVertexNormals();
    chasm.lid.geometry.attributes.position.needsUpdate = true;
    chasm.rims.geometry.attributes.position.needsUpdate = true;
    chasm.rims.geometry.computeVertexNormals();
  }

  /**
   * Places the lava strip at its current level: between the two walls at
   * that depth, which lean in, so the strip is narrower the lower it sits.
   * @param {Chasm} chasm
   * @returns {void}
   */
  function poseLava(chasm) {
    const { path, openAt } = chasm;
    const pos = chasm.lava.geometry.attributes.position.array;
    // How far down the lava's surface is, as a fraction of the depth: from
    // the very bottom up to CHASM.lavaLevel.
    const u = 1 - (1 - CHASM.lavaLevel) * chasm.lavaFill;
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      const o = openAt[i];
      const depth = CHASM.depth * Math.min(1, o * 1.4);
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? 1 : -1;
        const half = p.half * (side === 0 ? p.jagL : p.jagR) * o;
        // A little past the wall, so the surface tucks in under the rock.
        const off = sign * (Math.max(0.05, half - half * CHASM.wallLean * u) + 0.3);
        const k = (i * 2 + side) * 3;
        pos[k] = p.x + p.nx * off;
        pos[k + 1] = -depth * u;
        pos[k + 2] = p.z + p.nz * off;
      }
    }
    chasm.lava.geometry.attributes.position.needsUpdate = true;
    chasm.lava.visible = chasm.lavaFill > 0.001;
  }

  /**
   * The lava's own glow, lighting the rim and the town beside the gap.
   * @param {Chasm} chasm
   * @returns {void}
   */
  function requestLavaLights(chasm) {
    const lightPool = ctx.systems.lightPool;
    // Frozen over by the Blizzard (engine/blizzard.js): no glow from under the ice.
    if (!lightPool || chasm.lavaFill <= 0.02 || frozen) return;
    const n = chasm.path.length;
    for (const f of [0.3, 0.5, 0.7]) {
      const p = chasm.path[Math.floor(f * (n - 1))];
      const flicker = 0.85 + 0.1 * Math.sin(time * 9 + f * 20) + 0.05 * Math.sin(time * 21 + f * 7);
      lightPool.requestLight({
        x: p.x, y: CHASM.lightHeight, z: p.z,
        colour: CHASM.lightColour,
        intensity: CHASM.lightPeak * chasm.lavaFill * flicker,
        distance: CHASM.lightDistance,
        priority: CHASM.lightPriority
      });
    }
  }

  // ---------------------------------------------------------------------
  // Opening
  // ---------------------------------------------------------------------

  /**
   * Splits the ground open. Called by the earthquake; safe to call again,
   * the oldest chasm making way past CHASM.maxChasms.
   * @returns {void}
   */
  function openChasm() {
    if (!group) return;
    if (chasms.length >= CHASM.maxChasms) disposeChasm(chasms.shift());
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * 30;
    const cx = Math.cos(angle) * r;
    const cz = Math.sin(angle) * r;
    const heading = Math.random() * Math.PI;
    const path = makePath(cx, cz, heading);
    const { walls, lid, rims, lava } = buildMeshes(path);
    group.add(walls, lid, rims, lava);
    const chasm = {
      path, dirX: Math.cos(heading), dirZ: Math.sin(heading), cx, cz,
      timer: 0, open: 0, openAt: new Float32Array(path.length),
      walls, lid, rims, lava, lavaFill: 0, hazards: [], shocked: new Set()
    };
    chasms.push(chasm);
    poseChasm(chasm);

    // Hazards along the line, for the crowd to steer round: circles every
    // other point, grown with the gap as it opens.
    const hazardsSystem = ctx.systems.hazards;
    if (hazardsSystem) {
      for (let i = 0; i < path.length; i += 2) {
        chasm.hazards.push(hazardsSystem.addHazard({
          x: path[i].x, z: path[i].z, radius: 1, kind: 'chasm', index: i
        }));
      }
    }

    const at = new THREE.Vector3(cx, 0, cz);
    ctx.systems.gamefeel.event('chasm', at);
    ctx.systems.damage.addDamageScore(CHASM.score);
    ctx.systems.earthquakeSound.playRupture(1);
    ctx.systems.lightning.flashScreen(at.clone().setY(10), 0.35, '#e8d2b0');
  }

  // ---------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------

  /**
   * How far inside a chasm a ground point is: positive inside (world units
   * from the nearest edge), negative outside (distance to the edge).
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  function gapAt(x, z) {
    let best = -Infinity;
    for (const chasm of chasms) {
      // Cheap reject: far off the chasm's overall line.
      const lateral = Math.abs((x - chasm.cx) * -chasm.dirZ + (z - chasm.cz) * chasm.dirX);
      if (lateral > 70) continue;
      const { path, openAt } = chasm;
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const abx = b.x - a.x;
        const abz = b.z - a.z;
        const len2 = abx * abx + abz * abz || 1;
        const t = THREE.MathUtils.clamp(((x - a.x) * abx + (z - a.z) * abz) / len2, 0, 1);
        const px = a.x + abx * t;
        const pz = a.z + abz * t;
        const dx = x - px;
        const dz = z - pz;
        const d = Math.hypot(dx, dz);
        if (d > 40) continue;
        // Which side of the line, for that side's own ragged width.
        const side = dx * a.nx + dz * a.nz >= 0;
        const jag = side ? a.jagL + (b.jagL - a.jagL) * t : a.jagR + (b.jagR - a.jagR) * t;
        const half = (a.half + (b.half - a.half) * t) * jag * (openAt[i] + (openAt[i + 1] - openAt[i]) * t);
        const inside = half - d;
        if (inside > best) best = inside;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------
  // What falls in
  // ---------------------------------------------------------------------

  /**
   * Takes an object off the ground and into the gap: out of the simulation
   * (so physics stops holding it at ground level) and into the local fall.
   * @param {Object} obj
   * @returns {void}
   */
  function dropIn(obj) {
    if (obj.inChasm) return;
    obj.inChasm = true;
    const mesh = obj.mesh;
    const person = obj.type === 'person';
    const idx = Sim.objects.indexOf(obj);
    if (idx !== -1) Sim.objects.splice(idx, 1);
    if (person) {
      if (obj.motion) obj.motion.active = false;
      if (ctx.systems.speechBubbles && ctx.systems.speechBubbles.exclaim) ctx.systems.speechBubbles.exclaim(obj);
      const envIdx = ctx.Environment.people.indexOf(obj);
      if (envIdx !== -1) ctx.Environment.people.splice(envIdx, 1);
    }
    falling.push({
      obj, mesh, vy: 0, person,
      spin: new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 4)
    });
    ctx.systems.damage.addDamageScore(CHASM.fallScore);
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateFalling(dt) {
    for (let i = falling.length - 1; i >= 0; i--) {
      const f = falling[i];
      f.vy -= CHASM.fallGravity * dt;
      f.mesh.position.y += f.vy * dt;
      f.mesh.rotation.x += f.spin.x * dt;
      f.mesh.rotation.z += f.spin.z * dt;
      if (f.mesh.position.y > -CHASM.depth * 0.8) continue;
      // Gone: a person for good, anything else left out of sight.
      if (f.person) {
        f.mesh.removeFromParent();
        f.mesh.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
      } else {
        f.mesh.visible = false;
      }
      falling.splice(i, 1);
    }
    if (chaseCarFalling) {
      chaseCarFalling.vy -= CHASM.fallGravity * dt;
      chaseCarFalling.mesh.position.y = Math.max(-CHASM.depth * 0.8, chaseCarFalling.mesh.position.y + chaseCarFalling.vy * dt);
      chaseCarFalling.mesh.rotation.x += 1.4 * dt;
    }
  }

  /**
   * Everything standing on the line goes in; buildings over it come down and
   * those beside it are shaken; the crowd is kept back from the edge.
   * @returns {void}
   */
  function checkGround() {
    // Copy: dropIn splices Sim.objects.
    for (const obj of Sim.objects.slice()) {
      if (obj.inChasm) continue;
      if (obj.type !== 'person' && obj.type !== 'car' && obj.type !== 'tree') continue;
      if (!obj.mesh || !obj.mesh.parent) continue;
      // Only what is on the ground: something the tornado is carrying over
      // the gap is not about to fall into it.
      if (obj.captureState && obj.captureState !== 'grounded' && obj.captureState !== 'trembling') continue;
      const p = obj.mesh.position;
      if (p.y > 3) continue;
      if (gapAt(p.x, p.z) > 0.4) dropIn(obj);
    }

    if (ctx.Environment) {
      const { shockBuilding, collapseBuilding } = ctx.systems.damage;
      for (const building of ctx.Environment.buildings) {
        if (building.damageState === 'collapsed') continue;
        const p = building.mesh.position;
        const inside = gapAt(p.x, p.z);
        for (const chasm of chasms) {
          if (chasm.shocked.has(building)) continue;
          if (inside > -4 && collapseBuilding) {
            chasm.shocked.add(building);
            collapseBuilding(building, 0);
          } else if (inside > -CHASM.buildingShockReach && shockBuilding) {
            chasm.shocked.add(building);
            shockBuilding(building, CHASM.buildingShock * (1 + inside / CHASM.buildingShockReach), p);
          }
          break;
        }
      }
    }

    // The chase car: driving into it ends the chase.
    const Chase = ctx.Chase;
    if (Chase && Chase.active && Chase.car && !Chase.gameOver && !chaseCarFalling) {
      const p = Chase.car.mesh.position;
      if (gapAt(p.x, p.z) > 0.8) {
        ctx.systems.chase.triggerChaseGameOver('chasm');
        chaseCarFalling = { mesh: Chase.car.mesh, vy: 0 };
      }
    }
    if (chaseCarFalling && !(Chase && Chase.active && Chase.gameOver)) chaseCarFalling = null;
  }

  // ---------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateChasms(dt) {
    if (!group || (!chasms.length && !falling.length)) return;
    time += dt;
    if (lavaMaterial) lavaMaterial.uniforms.uTime.value = time;
    let fullest = 0;
    for (const chasm of chasms) {
      // The lava wells up once the middle of the gap has opened.
      if (chasm.timer > CHASM.openSeconds * 0.5 && chasm.lavaFill < 1) {
        chasm.lavaFill = Math.min(1, chasm.lavaFill + dt / CHASM.lavaRiseSeconds);
        poseLava(chasm);
      } else if (chasm.open < 1 && chasm.lavaFill > 0) {
        poseLava(chasm);
      }
      if (chasm.lavaFill > fullest) fullest = chasm.lavaFill;
      requestLavaLights(chasm);
    }
    lavaUniform.value = fullest;
    for (const chasm of chasms) {
      if (chasm.open >= 1) {
        // Past opening, the clock only drives the lava's rise.
        chasm.timer += dt;
        continue;
      }
      chasm.timer += dt;
      const T = chasm.timer / CHASM.openSeconds;
      let all = 1;
      for (let i = 0; i < chasm.path.length; i++) {
        // Unzips outward from the middle: the centre is open before the
        // tips have started to go.
        const o = THREE.MathUtils.smoothstep(T * 1.7 - Math.abs(chasm.path[i].s) * 0.7, 0, 1);
        chasm.openAt[i] = o;
        if (o < all) all = o;
      }
      chasm.open = all;
      poseChasm(chasm);
      // Once it is fully open, anything of the far town standing on the line
      // (environment/backdrop.js) goes in too.
      if (all >= 1 && ctx.systems.backdrop) {
        for (let i = 0; i < chasm.path.length; i += 2) {
          const p = chasm.path[i];
          if (Math.max(Math.abs(p.x), Math.abs(p.z)) < 120) continue;
          ctx.systems.backdrop.damageAt(p.x, p.z, p.half + 3);
        }
      }
      for (const hazard of chasm.hazards) {
        const p = chasm.path[hazard.index];
        hazard.radius = Math.max(1, p.half * chasm.openAt[hazard.index] * 1.25 + CHASM.hazardClearance);
      }
      // Dust thrown up along both edges as they tear apart.
      const quake = ctx.systems.earthquake;
      if (quake && Math.random() < dt * 30) {
        const i = Math.floor(Math.random() * chasm.path.length);
        const p = chasm.path[i];
        const side = Math.random() < 0.5 ? 1 : -1;
        const edge = p.half * chasm.openAt[i] * side;
        quake.kickDust(p.x + p.nx * edge, p.z + p.nz * edge, 1, 1.4);
      }
    }

    checkTimer -= dt;
    if (checkTimer <= 0) {
      checkTimer = 1 / CHASM.checkRate;
      if (chasms.length) checkGround();
    }
    updateFalling(dt);
  }

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------

  /**
   * @param {Chasm} chasm
   * @returns {void}
   */
  function disposeChasm(chasm) {
    for (const mesh of [chasm.walls, chasm.lid, chasm.rims, chasm.lava]) {
      group.remove(mesh);
      mesh.geometry.dispose();
    }
    if (ctx.systems.hazards) {
      for (const hazard of chasm.hazards) ctx.systems.hazards.removeHazard(hazard);
    }
  }

  /** @returns {void} */
  function resetChasms() {
    for (const chasm of chasms) disposeChasm(chasm);
    chasms = [];
    // Whatever was mid-fall belongs to a town resetEnvironment() is about to
    // replace; people already removed are simply dropped.
    for (const f of falling) {
      if (f.person) f.mesh.removeFromParent();
    }
    falling = [];
    chaseCarFalling = null;
    checkTimer = 0;
    lavaUniform.value = 0;
  }

  /** @returns {void} */
  function disposeChasms() {
    if (!group) return;
    resetChasms();
    for (const mat of materials) mat.dispose();
    materials = [];
    Sim.three.scene.remove(group);
    group = null;
  }

  /**
   * The Blizzard freezing the lava over (engine/blizzard.js), or letting it go.
   * @param {boolean} on
   * @returns {{mesh: THREE.Mesh}[]} the lava strips, for their ice
   */
  function setFrozen(on) {
    frozen = on;
    return chasms.filter(c => c.lavaFill > 0.001).map(c => ({ mesh: c.lava }));
  }

  return { initChasms, openChasm, updateChasms, gapAt, setFrozen, resetChasms, disposeChasms };
}
