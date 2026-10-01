// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION E — Debris pool
 * ===========================================================================
 */

/**
 * Per-kind debris definitions: geometry/material/mass range/lift-ease and
 * the pool capacity share each kind gets. `liftEligible` is tuned so
 * lighter kinds are unambiguously easier for the vortex to loft (it
 * multiplies the existing Fup ∝ liftEligible/mass lift term in
 * computeVortexForce — no force-formula change needed here). Capacities
 * sum to DEBRIS_CAP, the hard ceiling on simultaneously airborne/settled
 * pooled debris.
 * @type {Object<DebrisKind, {capacity:number, massMin:number, massMax:number, liftEligible:number, colour:number}>}
 */
export const DEBRIS_KIND_DEFS = {
  // Capacities were raised from a DEBRIS_CAP of 50 to 84 after measuring what
  // the old caps actually did at EF5. Wall and roof detaches go through
  // spawnDebris (see detachBuildingPiece), which returns null when a kind's
  // pool is full and nothing in it can be evicted -- and eviction only ever
  // considered *settled* debris, which at EF5 is none of it, because the
  // vortex keeps everything airborne. With roofPiece capped at 7 for the
  // whole town, buildings stopped being able to shed pieces within seconds of
  // a strong tornado forming: measured with breakThreshold forced to 0.05
  // (tissue paper), not one building collapsed over 8 sim-seconds. The storm
  // was quietly running out of destruction exactly when it should have been
  // at its worst.
  //
  // The cost of raising them is small: one InstancedMesh per kind regardless
  // of capacity, so no new draw calls, and the per-frame work is 34 more
  // objects in the physics loop against the ~100 people already in it.
  // spawnDebris also no longer gives up when nothing has settled (see
  // evictFurthestDebris), so a detach that matters is never silently dropped.
  branch: { capacity: 22, massMin: 0.15, massMax: 0.6, liftEligible: 0.98, colour: 0x6b4a2f },
  box: { capacity: 18, massMin: 0.3, massMax: 1.2, liftEligible: 0.85, colour: 0xb59a6b },
  roofPiece: { capacity: 16, massMin: 2.0, massMax: 5.0, liftEligible: 0.55, colour: 0x5a3a2e },
  rock: { capacity: 14, massMin: 1.5, massMax: 4.5, liftEligible: 0.35, colour: 0x767066 },
  // A whole uprooted trunk: heavier than a roofPiece (it's the entire tree,
  // not a panel) but still wood rather than stone, so liftEligible sits
  // just under roofPiece's -- liftable once intensity climbs, not among
  // the first things the vortex picks up. Capacity is generous relative to
  // roofPiece/rock since a real town has ~90 trees vs. ~72 buildings, so
  // uprooting is comparatively frequent once the tornado reaches a street
  // lined with them.
  treeTrunk: { capacity: 14, massMin: 3.0, massMax: 7.0, liftEligible: 0.5, colour: 0x5c4330 },
  // Shards of an ice statue shattering (engine/effects/freeze.js). Only ever
  // spawned by name, never by the weighted picks above, so the storm's own
  // debris is unchanged.
  ice: { capacity: 24, massMin: 0.1, massMax: 0.4, liftEligible: 0.95, colour: 0xcfe9ff }
};
/** @type {DebrisKind[]} */
export const DEBRIS_KIND_NAMES = /** @type {DebrisKind[]} */ (Object.keys(DEBRIS_KIND_DEFS));
export const DEBRIS_CAP = DEBRIS_KIND_NAMES.reduce((sum, k) => sum + DEBRIS_KIND_DEFS[k].capacity, 0);

/**
 * Weighted-random pick of a debris kind, e.g. {branch: 0.4, box: 0.6}.
 * @param {Object<string, number>} weights kind name -> relative weight
 * @returns {DebrisKind}
 */
export function pickDebrisKind(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [kind, w] of entries) {
    roll -= w;
    if (roll <= 0) return /** @type {DebrisKind} */ (kind);
  }
  return /** @type {DebrisKind} */ (entries[entries.length - 1][0]);
}

/**
 * @param {DebrisKind} kind
 * @returns {THREE.BufferGeometry}
 */
function createDebrisGeometry(kind) {
  switch (kind) {
    case 'branch': return new THREE.CylinderGeometry(0.05, 0.09, 1.3, 6);
    case 'box': return new THREE.BoxGeometry(0.55, 0.55, 0.55);
    case 'roofPiece': return new THREE.BoxGeometry(1.3, 0.14, 0.9);
    case 'rock': return new THREE.DodecahedronGeometry(0.5, 0);
    // A short, thick, flared-base cylinder -- a broken trunk-with-roots
    // silhouette -- reusing createTree's trunk proportions/colour but
    // shorter (a snapped-off length, not the full standing tree) and
    // coarser-faceted (6 vs. the standing trunk's 8) to read as debris
    // rather than a duplicate of the intact tree mesh.
    case 'treeTrunk': return new THREE.CylinderGeometry(0.22, 0.42, 2.4, 6);
    case 'ice': return new THREE.TetrahedronGeometry(0.35, 0);
    default: return new THREE.BoxGeometry(0.5, 0.5, 0.5);
  }
}

/**
 * @param {Object} ctx
 * @returns {{
 *   DebrisPool: Object,
 *   initDebrisPool: () => void,
 *   spawnDebris: (pos: THREE.Vector3, velocity: THREE.Vector3, mass: number, scale: number, kind: string) => Object|null,
 *   releaseDebris: (obj: Object) => void,
 *   syncDebrisInstances: () => void,
 *   spawnAmbientDebris: () => void,
 *   reconcileDebrisTarget: () => void
 * }}
 */
export function createDebrisSystem(ctx) {
  const { Sim, nextObjectId } = ctx;

  const DebrisPool = {
    meshes: /** @type {Object<DebrisKind, THREE.InstancedMesh>} */ ({}),
    freeLists: /** @type {Object<DebrisKind, number[]>} */ ({}),
    slots: /** @type {Object<DebrisKind, (SimObject|null)[]>} */ ({}),
    capacities: /** @type {Object<DebrisKind, number>} */ ({}),
    dummy: new THREE.Object3D()
  };

  /** @returns {void} */
  function initDebrisPool() {
    for (const kind of DEBRIS_KIND_NAMES) {
      const def = DEBRIS_KIND_DEFS[kind];
      const geo = createDebrisGeometry(kind);
      const mat = new THREE.MeshStandardMaterial({ color: def.colour, roughness: 1 });
      const mesh = new THREE.InstancedMesh(geo, mat, def.capacity);
      // One InstancedMesh per kind -> debris_branch, debris_box, debris_roofPiece,
      // debris_rock, debris_treeTrunk.
      mesh.name = `debris_${kind}`;
      mesh.castShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      Sim.three.scene.add(mesh);

      DebrisPool.meshes[kind] = mesh;
      DebrisPool.slots[kind] = new Array(def.capacity).fill(null);
      DebrisPool.freeLists[kind] = Array.from({ length: def.capacity }, (_, i) => i);
      DebrisPool.capacities[kind] = def.capacity;
    }
  }

  /**
   * @param {DebrisKind} kind
   * @returns {number|undefined} freed index, if any settled debris of this kind existed
   */
  function evictOldestSettledDebris(kind) {
    const slots = DebrisPool.slots[kind];
    let best = -1;
    let bestLife = -1;
    for (let i = 0; i < slots.length; i++) {
      const o = slots[i];
      if (o && o.damageState === 'settled' && o.lifeTimer > bestLife) {
        bestLife = o.lifeTimer;
        best = i;
      }
    }
    if (best === -1) return undefined;
    releaseDebris(slots[best]);
    return best;
  }

  /**
   * Last-resort eviction: the piece of this kind furthest from any active
   * tornado, whatever state it is in.
   *
   * evictOldestSettledDebris() above is the preferred recycler because
   * settled debris is, by definition, lying still and finished with. But at
   * high intensity nothing settles -- the vortex keeps the whole pool in the
   * air -- and giving up there meant a building could not shed a wall at the
   * exact moment the storm was strongest (see the note on DEBRIS_KIND_DEFS).
   * Distance from the funnel is the right tiebreak: the furthest piece is the
   * one least likely to be on screen, least likely to be doing anything
   * interesting, and the most likely to be stranded out of the vortex's reach
   * for good.
   * @param {DebrisKind} kind
   * @returns {number|undefined} freed index, if the pool held anything at all
   */
  function evictFurthestDebris(kind) {
    const slots = DebrisPool.slots[kind];
    let best = -1;
    let bestDist = -1;
    for (let i = 0; i < slots.length; i++) {
      const o = slots[i];
      if (!o) continue;
      const nearest = ctx.tornadoes.nearest(o.position.x, o.position.z);
      const d = Math.hypot(o.position.x - nearest.center.x, o.position.z - nearest.center.z);
      if (d > bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best === -1) return undefined;
    releaseDebris(slots[best]);
    return best;
  }

  /**
   * Acquires a pooled debris slot of the given kind, spawning it at `pos`
   * with `velocity`. Recycles that kind's oldest settled debris if its pool
   * is full, and failing that the piece furthest from any tornado.
   * @param {THREE.Vector3} pos
   * @param {THREE.Vector3} velocity
   * @param {number} mass
   * @param {number} scale
   * @param {DebrisKind} kind
   * @returns {SimObject|null}
   */
  function spawnDebris(pos, velocity, mass, scale, kind) {
    const def = DEBRIS_KIND_DEFS[kind];
    let index = DebrisPool.freeLists[kind].pop();
    if (index === undefined) index = evictOldestSettledDebris(kind);
    if (index === undefined) index = evictFurthestDebris(kind);
    // Only reachable for a kind whose capacity is zero.
    if (index === undefined) return null;

    /** @type {SimObject} */
    const obj = {
      id: nextObjectId.value++,
      type: 'debris',
      mesh: null, // debris uses the instanced mesh directly, no individual Object3D
      velocity: velocity.clone(),
      angularVelocity: new THREE.Vector3(
        (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6
      ),
      mass,
      drag: 0.6,
      rooted: false,
      damageState: 'intact',
      breakThreshold: Infinity,
      liftEligible: def.liftEligible,
      pooled: true,
      kind,
      poolIndex: index,
      lifeTimer: 0,
      captureState: 'grounded'
    };
    obj.position = pos.clone();
    obj.rotation = new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    obj.scale = scale;

    DebrisPool.slots[kind][index] = obj;
    Sim.objects.push(obj);
    Sim.stats.debrisDisplaced++;
    return obj;
  }

  /**
   * @param {SimObject} obj
   * @returns {void}
   */
  function releaseDebris(obj) {
    const idx = Sim.objects.indexOf(obj);
    if (idx !== -1) Sim.objects.splice(idx, 1);
    DebrisPool.slots[obj.kind][obj.poolIndex] = null;
    DebrisPool.freeLists[obj.kind].push(obj.poolIndex);
  }

  /** @returns {void} */
  function syncDebrisInstances() {
    for (const kind of DEBRIS_KIND_NAMES) {
      const slots = DebrisPool.slots[kind];
      const mesh = DebrisPool.meshes[kind];
      let maxUsed = 0;
      for (let i = 0; i < slots.length; i++) {
        const o = slots[i];
        if (!o) continue;
        maxUsed = i + 1;
        DebrisPool.dummy.position.copy(o.position);
        DebrisPool.dummy.rotation.copy(o.rotation);
        DebrisPool.dummy.scale.setScalar(o.scale);
        DebrisPool.dummy.updateMatrix();
        mesh.setMatrixAt(i, DebrisPool.dummy.matrix);
      }
      mesh.count = maxUsed;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Spawns one piece of ambient debris in a ring around a tornado (a random
   * one of those active, so an Outbreak's share it out), inside
   * the force field's capture radius (p.radius * 1.8, see computeVortexForce)
   * with margin, so it starts within reach of the vortex instead of
   * scattered outside it from spawn.
   * @returns {void}
   */
  function spawnAmbientDebris() {
    const angle = Math.random() * Math.PI * 2;
    const rad = Sim.params.radius * (0.4 + Math.random() * 1.2);
    const tornadoes = ctx.tornadoes.activeVortices;
    const Vortex = tornadoes[Math.floor(Math.random() * tornadoes.length)];
    const pos = new THREE.Vector3(
      Vortex.center.x + Math.cos(angle) * rad, 0.3, Vortex.center.z + Math.sin(angle) * rad
    );
    const vel = new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2);
    const kind = pickDebrisKind({ branch: 0.4, box: 0.35, rock: 0.15, roofPiece: 0.1 });
    const def = DEBRIS_KIND_DEFS[kind];
    const mass = def.massMin + Math.random() * (def.massMax - def.massMin);
    spawnDebris(pos, vel, mass, Sim.params.debrisSize * (0.6 + Math.random() * 0.8), kind);
  }

  /**
   * Tops up ambient debris toward Sim.params.debrisCount whenever the slider
   * is raised mid-run, in small batches per call rather than all at once.
   * @returns {void}
   */
  function reconcileDebrisTarget() {
    if (!Sim.state.running) return;
    const activeDebris = DEBRIS_KIND_NAMES.reduce(
      (sum, k) => sum + DebrisPool.slots[k].filter(Boolean).length, 0
    );
    const target = Math.min(Sim.params.debrisCount, DEBRIS_CAP);
    if (activeDebris < target) {
      const toSpawn = Math.min(target - activeDebris, 10);
      for (let i = 0; i < toSpawn; i++) spawnAmbientDebris();
    }
  }

  return {
    DebrisPool, initDebrisPool, spawnDebris, releaseDebris, syncDebrisInstances,
    spawnAmbientDebris, reconcileDebrisTarget
  };
}
