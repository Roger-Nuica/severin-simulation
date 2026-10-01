// @ts-check
import { PARKS } from '../environment/parks.js';
import { VIADUCT_Z, HALF_LENGTH, DECK, ROUTE } from '../environment/viaduct/config.js';

/**
 * ===========================================================================
 * SECTION U.3 — Minimap (drawing helpers)
 * ===========================================================================
 * The minimap's constants, colours and pure 2D-canvas drawing functions,
 * moved out of ui/minimap.js unchanged: the town layer, the swirl, the
 * player's arrow, cars and survivors, and the world-to-map projection.
 */

// World units covered by the static layer (the playable town and a margin;
// the backdrop town beyond is left off to keep the map readable).
export const LAYER_HALF = 150;
export const LAYER_PX_PER_UNIT = 3;
// World radius visible inside the circle.
export const VIEW_RADIUS_TOWN = 118;
export const VIEW_RADIUS_CHASE = 88;
// Keep in step with roadsDecor.js's generateRoads().
export const ROAD_Z = [-20, -8, 8, 20];
export const ROAD_X = [-30, 30];
export const ROAD_WIDTH = 5;
export const RING_ROAD_RADIUS = 48.5;
// Redraws a second at most (performance pass): the whole map redrawn every
// frame was a millisecond of CPU a frame in a busy run (measured, `?bench=1`),
// and nothing on it moves fast enough for 60 redraws a second to show.
export const MINIMAP_HZ = 20;
// Trail segments sharing one stroke (and so one alpha and colour).
export const TRAIL_BATCH = 6;
export const RIM_INSET = 11;
// Once the town is down to this many people or fewer, they are worth
// tracking individually on the map -- useful for hunting down the last
// survivors, and few enough by then that dots do not clutter the view the
// way drawing the whole starting crowd would.
export const SURVIVOR_TRACK_THRESHOLD = 60;
export const COLOUR_SURVIVOR = 'rgba(140, 255, 170, 0.92)';
export const COLOUR_CROWD = 'rgba(140, 255, 170, 0.6)';

export const COLOUR_ROAD = 'rgba(168, 186, 214, 0.34)';
// The elevated highway (environment/viaduct.js), brighter than a street.
export const COLOUR_HIGHWAY = 'rgba(214, 222, 240, 0.6)';
export const COLOUR_PARK = 'rgba(92, 150, 98, 0.42)';
export const COLOUR_BUILDING = 'rgba(206, 216, 236, 0.62)';
export const COLOUR_BUILDING_DAMAGED = 'rgba(255, 176, 92, 0.7)';
export const COLOUR_BUILDING_COLLAPSED = 'rgba(255, 92, 72, 0.4)';
export const COLOUR_ACCENT = '#4fd1ff';
/**
 * Per-tornado colours, indexed like the tornadoes (engine/tornadoes.js):
 * the primary's orange-red, then magenta and amber for an Outbreak's
 * others. hot/cold are the trail's fresh and faded RGB.
 * @type {{hot: number[], cold: number[], marker: string, core: string}[]}
 */
export const TORNADO_PALETTE = [
  { hot: [255, 110, 50], cold: [150, 70, 40], marker: '#ff6a3d', core: '#ffd2a8' },
  { hot: [255, 84, 196], cold: [140, 52, 112], marker: '#ff4fc3', core: '#ffd0ef' },
  { hot: [255, 212, 64], cold: [150, 118, 40], marker: '#ffc933', core: '#fff1c2' }
];

/**
 * @typedef {Object} MapView
 * @property {number} cx world x at the centre of the map
 * @property {number} cz world z at the centre of the map
 * @property {number} dx unit world direction that points up on the map (x)
 * @property {number} dz unit world direction that points up on the map (z)
 * @property {number} scale CSS pixels per world unit
 * @property {number} radius map radius in CSS pixels
 */

/**
 * World position to map position, in CSS pixels from the map's top-left.
 * The map's up is the view direction (dx, dz) and its right is (-dz, dx),
 * the ground-plane right of a camera looking along it.
 * @param {MapView} view
 * @param {number} wx
 * @param {number} wz
 * @returns {{x: number, y: number}}
 */
export function toMap(view, wx, wz) {
  const rx = wx - view.cx;
  const rz = wz - view.cz;
  return {
    x: view.radius + (-view.dz * rx + view.dx * rz) * view.scale,
    y: view.radius - (view.dx * rx + view.dz * rz) * view.scale
  };
}

/**
 * Pulls a map position back inside the circle's rim when it falls outside.
 * @param {MapView} view
 * @param {{x: number, y: number}} p
 * @returns {{x: number, y: number, pinned: boolean}}
 */
export function pinToRim(view, p) {
  const ox = p.x - view.radius;
  const oy = p.y - view.radius;
  const len = Math.hypot(ox, oy);
  const max = view.radius - RIM_INSET;
  if (len <= max) return { x: p.x, y: p.y, pinned: false };
  return { x: view.radius + (ox / len) * max, y: view.radius + (oy / len) * max, pinned: true };
}

/**
 * Draws the town (roads, parks, buildings) into the static layer, in world
 * units with the layer's centre at the world origin.
 * @param {CanvasRenderingContext2D} g
 * @param {SimObject[]} buildings
 * @returns {void}
 */
export function drawTownLayer(g, buildings) {
  const size = LAYER_HALF * 2 * LAYER_PX_PER_UNIT;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, size, size);
  g.setTransform(LAYER_PX_PER_UNIT, 0, 0, LAYER_PX_PER_UNIT, LAYER_HALF * LAYER_PX_PER_UNIT, LAYER_HALF * LAYER_PX_PER_UNIT);

  g.fillStyle = COLOUR_PARK;
  for (const park of PARKS) {
    g.beginPath();
    g.ellipse(park.x, park.z, park.rx, park.rz, 0, 0, Math.PI * 2);
    g.fill();
  }

  g.strokeStyle = COLOUR_ROAD;
  g.lineWidth = ROAD_WIDTH;
  g.beginPath();
  for (const z of ROAD_Z) { g.moveTo(-LAYER_HALF, z); g.lineTo(LAYER_HALF, z); }
  for (const x of ROAD_X) { g.moveTo(x, -LAYER_HALF); g.lineTo(x, LAYER_HALF); }
  g.stroke();
  g.beginPath();
  g.arc(0, 0, RING_ROAD_RADIUS, 0, Math.PI * 2);
  g.stroke();
  // The highway's ground roads, from its ramps' feet round to the street.
  g.lineWidth = ROUTE.roadWidth;
  g.beginPath();
  for (const side of [-1, 1]) {
    g.moveTo(side * HALF_LENGTH, VIADUCT_Z);
    g.lineTo(side * ROUTE.connectorX, VIADUCT_Z);
    g.lineTo(side * ROUTE.connectorX, ROUTE.junctionZ);
  }
  g.stroke();
  // The highway itself, ramp to ramp.
  g.strokeStyle = COLOUR_HIGHWAY;
  g.lineWidth = DECK.width;
  g.beginPath();
  g.moveTo(-HALF_LENGTH, VIADUCT_Z);
  g.lineTo(HALF_LENGTH, VIADUCT_Z);
  g.stroke();

  for (const b of buildings) {
    const fp = b.mesh.userData.footprint;
    if (!fp) continue;
    const p = b.mesh.position;
    const state = b.damageState;
    g.fillStyle = state === 'collapsed' ? COLOUR_BUILDING_COLLAPSED
      : state === 'intact' ? COLOUR_BUILDING : COLOUR_BUILDING_DAMAGED;
    g.fillRect(p.x - fp.width / 2, p.z - fp.depth / 2, fp.width, fp.depth);
  }
}

/**
 * Draws the tornado's swirl icon: a pulsing ring and three spinning arms.
 * @param {CanvasRenderingContext2D} g
 * @param {number} x
 * @param {number} y
 * @param {number} t seconds, for the animation
 * @param {number} size icon scale (1 = full size)
 * @param {{hot: number[], marker: string, core: string}} colours
 * @returns {void}
 */
export function drawSwirl(g, x, y, t, size, colours) {
  const pulse = (t * 0.9) % 1;
  const [hr, hg, hb] = colours.hot;
  g.strokeStyle = `rgba(${hr}, ${hg}, ${hb}, ${(1 - pulse) * 0.8})`;
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(x, y, (7 + pulse * 9) * size, 0, Math.PI * 2);
  g.stroke();

  g.fillStyle = 'rgba(20, 8, 6, 0.75)';
  g.beginPath();
  g.arc(x, y, 8 * size, 0, Math.PI * 2);
  g.fill();

  g.strokeStyle = colours.marker;
  g.lineWidth = 2 * size;
  g.lineCap = 'round';
  const spin = -t * 5;
  for (let arm = 0; arm < 3; arm++) {
    const a = spin + (arm * Math.PI * 2) / 3;
    g.beginPath();
    g.arc(x, y, 5.2 * size, a, a + 1.6);
    g.stroke();
  }
  g.fillStyle = colours.core;
  g.beginPath();
  g.arc(x, y, 1.8 * size, 0, Math.PI * 2);
  g.fill();
}

/**
 * Draws the player's arrow pointing up the map (the view direction), with an
 * optional view cone in front of it.
 * @param {CanvasRenderingContext2D} g
 * @param {number} x
 * @param {number} y
 * @param {number} coneHalfAngle radians; 0 for no cone
 * @returns {void}
 */
export function drawPlayerArrow(g, x, y, coneHalfAngle) {
  if (coneHalfAngle > 0) {
    const reach = 46;
    g.fillStyle = 'rgba(79, 209, 255, 0.22)';
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - Math.tan(coneHalfAngle) * reach, y - reach);
    g.lineTo(x + Math.tan(coneHalfAngle) * reach, y - reach);
    g.closePath();
    g.fill();
  }
  g.fillStyle = '#ffffff';
  g.strokeStyle = COLOUR_ACCENT;
  g.lineWidth = 2;
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(x, y - 9);
  g.lineTo(x + 6.5, y + 7);
  g.lineTo(x, y + 3.5);
  g.lineTo(x - 6.5, y + 7);
  g.closePath();
  g.stroke();
  g.fill();
}

/**
 * A car icon, pointing the way it faces: a body, a windscreen and two
 * headlamps at the front.
 * @param {CanvasRenderingContext2D} g
 * @param {MapView} view
 * @param {{x: number, y: number}} at map point
 * @param {{x: number, z: number, heading: number}} car heading: forward is
 *   (sin, cos) of it
 * @param {number} size 1 for a parked car, larger for a driven one
 * @param {string} fill
 * @param {number} [stretch] how many car-lengths long (the tanker is two)
 * @returns {void}
 */
export function drawCarIcon(g, view, at, car, size, fill, stretch = 1) {
  const ahead = toMap(view, car.x + Math.sin(car.heading) * 10, car.z + Math.cos(car.heading) * 10);
  const half = 5 * stretch;
  g.save();
  g.translate(at.x, at.y);
  g.rotate(Math.atan2(ahead.y - at.y, ahead.x - at.x));
  g.scale(size, size);
  g.fillStyle = fill;
  g.strokeStyle = '#1c1400';
  g.lineWidth = 1.2 / size;
  g.fillRect(-half, -3, half * 2, 6);
  g.strokeRect(-half, -3, half * 2, 6);
  g.fillStyle = 'rgba(20, 30, 45, 0.85)';
  g.fillRect(half - 6.5, -2.2, 3, 4.4);
  g.fillStyle = '#fff4d0';
  g.fillRect(half - 1.8, -2.4, 1.6, 1.4);
  g.fillRect(half - 1.8, 1, 1.6, 1.4);
  g.restore();
}

/**
 * Draws a dot for every person still in play. While the crowd is large they
 * are small and dim and only drawn where the map is showing -- enough to see
 * where people are (a group let out by reinforcements.js included) without
 * a hundred and fifty dots swamping the view. Once it is down to
 * SURVIVOR_TRACK_THRESHOLD or fewer they grow and are rim-pinned like the
 * tornado marker and player arrow, since a survivor can be anywhere in town.
 * @param {CanvasRenderingContext2D} g
 * @param {MapView} view
 * @param {SimObject[]} people
 * @returns {void}
 */
export function drawSurvivors(g, view, people) {
  if (people.length > SURVIVOR_TRACK_THRESHOLD) {
    g.fillStyle = COLOUR_CROWD;
    for (const person of people) {
      if (!person.mesh.parent) continue;
      const p = pinToRim(view, toMap(view, person.mesh.position.x, person.mesh.position.z));
      if (p.pinned) continue;
      g.fillRect(p.x - 0.9, p.y - 0.9, 1.8, 1.8);
    }
    return;
  }
  g.fillStyle = COLOUR_SURVIVOR;
  for (const person of people) {
    if (!person.mesh.parent) continue;
    const p = pinToRim(view, toMap(view, person.mesh.position.x, person.mesh.position.z));
    g.beginPath();
    g.arc(p.x, p.y, p.pinned ? 2 : 2.6, 0, Math.PI * 2);
    g.fill();
  }
}
