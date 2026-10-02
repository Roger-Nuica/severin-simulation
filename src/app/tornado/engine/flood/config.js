import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION FL.0 — The flood's tunables
 * ===========================================================================
 * Every number the dam break and the flood are tuned by.
 */

export const FLOOD = {
  // The dam sits here and the water travels in +X across the map.
  damX: -148,
  damHalfWidth: 130,           // spans z from -this to +this
  damHeight: 34,
  damThickness: 4,
  damColour: 0x6e6b66,
  // The basin behind it (flood/basin.js): the reservoir walled on its two
  // sides and at the far end, as high as the dam, with earth banked up
  // behind every wall out to past the ground's edge, so the lake is a
  // closed basin in a valley -- no edge of the world to see past it, and
  // nothing standing in the water.
  basinFarX: -300,             // the far wall's inner face
  basinWallThickness: 4,
  bermWidth: 72,               // how far the bank behind a wall runs out
  bermColour: 0x55703f,
  // Nothing in the game goes west of the dam's town-side face (physics,
  // Roger, the chase car): a wall in the world, not just on the map.
  westMargin: 0.6,
  // The breach in the middle of the wall that the water comes through.
  breachHalfWidth: 26,
  breakSeconds: 0.8,           // the gate crumbling before the water is through
  // Before it goes: the gate straining under the load -- cracks spreading
  // across its face, water forcing its way through them, the wall
  // shuddering -- so the break is something you watch coming.
  strainSeconds: 3.6,
  jetRate: [30, 260],          // water through the cracks, per second, as they widen
  // The gate coming apart into blocks of concrete thrown downstream.
  chunkCount: 22,
  chunkSize: [2.5, 7],
  chunkSpeed: [14, 42],
  // The reservoir behind the wall: full up to just under the crest, emptied
  // as the surge runs out, refilled when the dam is rebuilt.
  reservoirLevel: 29,
  reservoirLow: 3,
  reservoirColour: 0x2a4a48,
  // The surge.
  speed: 26,                   // world units/sec the front advances
  endX: 165,                   // it has left the map by here
  // A deep flood behind the front: the body's level, at the corridor's
  // middle (it shoals to nothing at the edges).
  depth: 9,
  // The wall of water at the front: building height at the breach, and
  // still twice the body's depth when it leaves the map. Its shape is
  // CREST_PROFILE below, scaled by this.
  crestHeight: 24,
  crestHeightEnd: 15,
  // The front bows forward in the middle (the jet out of the breach runs
  // ahead of the edges), by this many metres at the centreline.
  frontBow: 14,
  // Murky flood water, not a clean blue: silt brown in the shallows and
  // the churned front, a dark green-blue where it is deep. Opaque -- what is
  // under it is hidden, the way it is in a real flood.
  waterColour: 0x6b5a3e,
  deepColour: 0x2c3a34,
  foamColour: 0xe8ecdf,
  // The surface mesh: a displaced grid rather than the top of a box.
  surfaceSegmentsX: 96,
  surfaceSegmentsZ: 40,
  waveAmp: 0.9,                // chop on the open body
  // The scripted shot when the gate goes: long enough to watch the wall
  // arrive and pass, then the camera is handed back.
  cameraBeat: 7,
  // The water carries what it catches: things are dragged towards the
  // water's own speed (flowCrest at the front, flowBody in the flood behind
  // it) at these rates, and float up to its surface.
  flowCrest: 24,
  flowBody: 9,
  dragCrest: 2.6,
  dragBody: 1.1,
  buoyancy: 16,                // m/s² up per metre under the surface
  crestKillChance: 0.45,       // of a person the crest reaches being killed by it
  crestKillEnergy: 50000,      // damage.js impact energy: well past a person's
  // How far either side of the centreline the water actually reaches. The
  // breach is narrow, so the flood is a corridor rather than the full map.
  spreadAtDam: 34,
  spreadAtEnd: 125,            // it fans out as it travels
  // What the water does to buildings, through damage.js damageFromImpact,
  // every buildingTick seconds a building stands in it: energy
  //   buildingForce x depth there x (water speed)^2,
  // so the crest (deep and fast) takes pieces off and brings them down,
  // the flood behind it (slower) mostly scuffs, and a shelter's far higher
  // rating holds. At most buildingsPerTick buildings are hit in one frame.
  buildingForce: 0.16,
  buildingTick: 0.35,
  buildingsPerTick: 6,
  // Cars and trees the crest reaches, as one impact of this energy each:
  // cars thrown, trees torn out (damage.js), then carried.
  carEnergy: 1800,
  treeEnergy: 1400,
  // Foam at the crest, and round whatever stands in the water.
  foamMax: 900,
  foamRate: 260,
  foamLife: [0.6, 1.7],
  foamSize: 6,
  // Spray and mist thrown up off the lip of the wave.
  // Kept thin: thick and white, it hid the wave it came off and bloomed
  // into one glowing cloud.
  mistMax: 400,
  mistRate: 110,
  mistLife: [1.2, 2.6],
  mistSize: [4, 9],
  // Mud and bits of wreckage riding the flow.
  mudMax: 600,
  mudRate: 160,
  mudLife: [3, 6],
  mudSize: [0.8, 2.2],
  mudColour: 0x3a2d1e,
  // Buildings standing in the water the shader froths round (the nearest
  // to the front first): a fixed number of uniforms.
  obstacles: 16,
  score: 1400,
  drainSeconds: 6,
  bannerSeconds: 3.2
};

/**
 * Cracks for the dam's gate: dark branching fractures over a transparent
 * canvas, radiating from a few points of failure, with a pale wet sheen
 * along each one where the water is getting through.
 * @returns {THREE.CanvasTexture}
 */
export function createCrackTexture() {
  const w = 512;
  const h = 336;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  g.lineCap = 'round';
  g.lineJoin = 'round';
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} angle
   * @param {number} length
   * @param {number} width
   * @param {number} depth
   * @returns {void}
   */
  const branch = (x, y, angle, length, width, depth) => {
    const steps = 7;
    const points = [[x, y]];
    let a = angle;
    for (let s = 0; s < steps; s++) {
      a += (Math.random() - 0.5) * 0.7;
      x += Math.cos(a) * (length / steps);
      y += Math.sin(a) * (length / steps);
      points.push([x, y]);
      if (depth > 0 && Math.random() < 0.28) {
        branch(x, y, a + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.6),
          length * 0.5, width * 0.6, depth - 1);
      }
    }
    for (const [colour, extra] of /** @type {[string, number][]} */ ([['rgba(200, 225, 235, 0.35)', 2.2], ['rgba(12, 10, 9, 0.95)', 0]])) {
      g.strokeStyle = colour;
      g.lineWidth = width + extra;
      g.beginPath();
      g.moveTo(points[0][0], points[0][1]);
      for (const [px, py] of points.slice(1)) g.lineTo(px, py);
      g.stroke();
    }
  };
  const origins = 3 + Math.floor(Math.random() * 3);
  for (let o = 0; o < origins; o++) {
    const ox = w * (0.2 + Math.random() * 0.6);
    const oy = h * (0.3 + Math.random() * 0.6);
    const arms = 4 + Math.floor(Math.random() * 3);
    for (let k = 0; k < arms; k++) {
      branch(ox, oy, (k / arms) * Math.PI * 2 + Math.random() * 0.5, 90 + Math.random() * 140, 3.4, 2);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The wave's cross-section along the flow, toe first: [ahead of the toe,
 * height], both as fractions of the crest height. Up the face, which steepens
 * and then leans forward into a plunging lip, over the top, and down the
 * back onto the flood behind (the last point's height is replaced by the
 * body's depth). x is negative behind the toe.
 */
export const CREST_PROFILE = [
  [0.0, 0.0],
  [-0.05, 0.12],
  [-0.1, 0.3],
  [-0.13, 0.5],
  [-0.12, 0.68],
  [-0.07, 0.84],
  [0.02, 0.96],
  [0.1, 1.0],
  [0.12, 0.93],     // the lip, curled over the face
  [0.04, 1.04],
  [-0.12, 1.06],
  [-0.4, 0.98],
  [-0.75, 0.8],
  [-1.15, 0.6],
  [-1.6, 0.4]
];
/** How far behind the toe the crest's back reaches, of its height. */
export const CREST_BACK = 1.6;
