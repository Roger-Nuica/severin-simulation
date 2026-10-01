// @ts-check
import { TRAIL_WINDOW } from './minimapTracker.js';
import {
  LAYER_HALF,
  LAYER_PX_PER_UNIT,
  VIEW_RADIUS_TOWN,
  VIEW_RADIUS_CHASE,
  MINIMAP_HZ,
  TRAIL_BATCH,
  RIM_INSET,
  COLOUR_ACCENT,
  TORNADO_PALETTE,
  toMap,
  pinToRim,
  drawTownLayer,
  drawSwirl,
  drawPlayerArrow,
  drawCarIcon,
  drawSurvivors
} from './minimapDraw.js';

/**
 * ===========================================================================
 * SECTION U.2 — Minimap (rendering)
 * ===========================================================================
 * A GTA-style circular minimap in the bottom-right corner: a stylised
 * top-down town (roads, parks, building footprints tinted by damage), the
 * tornado's fading trail (from minimapTracker.js), a swirl icon for the
 * tornado itself with its funnel radius, and an arrow for the player.
 *
 * Drawn with the 2D canvas API, not a second WebGL camera: the town layout
 * never moves, so it is drawn once into an offscreen "static layer" canvas
 * (redrawn only when a building's damage state changes) and each frame is a
 * single rotated drawImage of that layer plus a few hundred trail segments
 * batched into a couple of dozen strokes.
 *
 * Orientation follows GTA: up on the map is the way the player faces. In
 * Chase Mode the map is centred on the car and turns with its heading; in
 * sandbox and cinematic views it shows the whole town, turned to match the
 * camera's view direction, with the camera drawn as an arrow and a view cone.
 * Markers outside the circle are pinned to its rim. The fuel tanker is a
 * long orange truck, and the Chase Mode car, parked until it is driven, a
 * ringed cyan car.
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initMinimap: () => void,
 *   updateMinimap: () => void,
 *   disposeMinimap: () => void
 * }}
 */
/** @typedef {import('./minimapDraw.js').MapView} MapView */

export function createMinimapSystem(ctx) {
  const { Sim, container } = ctx;

  /** @type {HTMLDivElement|null} */
  let root = null;
  /** @type {HTMLCanvasElement|null} */
  let canvas = null;
  /** @type {CanvasRenderingContext2D|null} */
  let g = null;
  /** @type {HTMLCanvasElement|null} */
  let layer = null;
  /** @type {CanvasRenderingContext2D|null} */
  let layerG = null;
  /** @type {ResizeObserver|null} */
  let resizeObserver = null;
  let cssSize = 0;
  let dpr = 1;
  let visible = false;
  // When the map was last drawn (ctx.now seconds), for MINIMAP_HZ.
  let drawnAt = -Infinity;
  // What the static layer was last drawn from; it is redrawn when this changes.
  let layerKey = '';
  /** @type {SimObject[]|null} */
  let layerBuildings = null;
  // Last usable view direction, kept while the camera looks straight down.
  let upX = 0;
  let upZ = -1;

  /** @returns {void} */
  function sizeCanvas() {
    if (!root || !canvas) return;
    cssSize = root.clientWidth;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);
  }

  /** @returns {void} */
  function initMinimap() {
    root = document.createElement('div');
    root.className = 'minimap';
    canvas = document.createElement('canvas');
    root.appendChild(canvas);
    container.appendChild(root);
    g = canvas.getContext('2d');

    layer = document.createElement('canvas');
    layer.width = LAYER_HALF * 2 * LAYER_PX_PER_UNIT;
    layer.height = LAYER_HALF * 2 * LAYER_PX_PER_UNIT;
    layerG = layer.getContext('2d');

    resizeObserver = new ResizeObserver(sizeCanvas);
    resizeObserver.observe(root);
  }

  /**
   * Redraws the static layer if the town was regenerated or a building's
   * damage state moved on. Damage only ever progresses, so the counts of
   * damaged and collapsed buildings change whenever any state does.
   * @returns {void}
   */
  function refreshTownLayer() {
    const buildings = ctx.Environment.buildings;
    let damaged = 0;
    let collapsed = 0;
    for (const b of buildings) {
      if (b.damageState === 'collapsed') collapsed++;
      else if (b.damageState !== 'intact') damaged++;
    }
    const key = `${buildings.length}|${damaged}|${collapsed}`;
    if (key === layerKey && buildings === layerBuildings) return;
    layerKey = key;
    layerBuildings = buildings;
    drawTownLayer(layerG, buildings);
  }

  /**
   * Where the map is centred and which way is up, for the current mode.
   * @returns {MapView}
   */
  function currentView() {
    const Chase = ctx.Chase;
    const radius = cssSize / 2;
    if (Chase && Chase.active && Chase.car) {
      const p = Chase.car.mesh.position;
      return {
        cx: p.x, cz: p.z, dx: Math.sin(Chase.heading), dz: Math.cos(Chase.heading),
        scale: radius / VIEW_RADIUS_CHASE, radius
      };
    }
    const camera = Sim.three.camera;
    const e = camera.matrixWorld.elements;
    // The camera looks down its local -z axis.
    const fx = -e[8];
    const fz = -e[10];
    const len = Math.hypot(fx, fz);
    if (len > 0.05) { upX = fx / len; upZ = fz / len; }
    return { cx: 0, cz: 0, dx: upX, dz: upZ, scale: radius / VIEW_RADIUS_TOWN, radius };
  }

  /**
   * Draws one tornado's trail, oldest first, in world coordinates (the
   * world transform must already be set), fading with age.
   * @param {import('./minimapTracker.js').TornadoTrail} Trail
   * @param {{hot: number[], cold: number[]}} colours
   * @param {number} scale CSS pixels per world unit, to keep line widths in pixels
   * @returns {void}
   */
  function drawTrail(Trail, colours, scale) {
    const { samples, stride, capacity, count, time } = Trail;
    if (count < 2) return;
    const oldest = (Trail.head - count + capacity) % capacity;
    g.lineCap = 'round';
    g.lineJoin = 'round';

    let i = 0;
    while (i < count - 1) {
      const end = Math.min(i + TRAIL_BATCH, count - 1);
      const endOffset = ((oldest + end) % capacity) * stride;
      const age = time - samples[endOffset + 2];
      const fresh = 1 - Math.min(1, age / TRAIL_WINDOW);
      if (fresh > 0.01) {
        g.beginPath();
        const startOffset = ((oldest + i) % capacity) * stride;
        g.moveTo(samples[startOffset], samples[startOffset + 1]);
        for (let k = i + 1; k <= end; k++) {
          const o = ((oldest + k) % capacity) * stride;
          g.lineTo(samples[o], samples[o + 1]);
        }
        const alpha = Math.pow(fresh, 1.3);
        // Old trail cools from its hot colour to a dim, darker one.
        const r = Math.round(colours.cold[0] + (colours.hot[0] - colours.cold[0]) * fresh);
        const gr = Math.round(colours.cold[1] + (colours.hot[1] - colours.cold[1]) * fresh);
        const bl = Math.round(colours.cold[2] + (colours.hot[2] - colours.cold[2]) * fresh);
        g.strokeStyle = `rgba(${r}, ${gr}, ${bl}, ${(alpha * 0.28).toFixed(3)})`;
        g.lineWidth = 7 / scale;
        g.stroke();
        g.strokeStyle = `rgba(${r}, ${gr}, ${bl}, ${(alpha * 0.95).toFixed(3)})`;
        g.lineWidth = 2.4 / scale;
        g.stroke();
      }
      i = end;
    }
  }

  /**
   * Per frame: shows or hides the map, and redraws it while shown.
   * @returns {void}
   */
  function updateMinimap() {
    if (!root || !g) return;
    const Chase = ctx.Chase;
    // Hero Mode too: it no longer starts the storm, and Roger needs the map.
    const show = Sim.state.running || !!(Chase && Chase.active) || !!(ctx.Possess && ctx.Possess.active)
      || !!(ctx.Hero && ctx.Hero.active);
    let appeared = false;
    if (show !== visible) {
      root.classList.toggle('visible', show);
      visible = show;
      if (show) sizeCanvas();
      appeared = show;
    }
    if (!show || cssSize === 0) return;
    const now = ctx.now();
    if (!appeared && now - drawnAt < 1 / MINIMAP_HZ && now >= drawnAt) return;
    drawnAt = now;

    refreshTownLayer();
    const view = currentView();
    const R = view.radius;
    const t = performance.now() * 0.001;

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssSize, cssSize);
    g.save();
    g.beginPath();
    g.arc(R, R, R, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = 'rgba(6, 10, 18, 0.55)';
    g.fillRect(0, 0, cssSize, cssSize);

    // World -> map transform; see toMap() for the same mapping per point.
    const s = view.scale;
    const a = -view.dz * s;
    const b = -view.dx * s;
    const c = view.dx * s;
    const d = -view.dz * s;
    const e = R - (a * view.cx + c * view.cz);
    const f = R - (b * view.cx + d * view.cz);
    g.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
    g.drawImage(layer, -LAYER_HALF, -LAYER_HALF, LAYER_HALF * 2, LAYER_HALF * 2);
    const tornadoes = ctx.tornadoes.instances;
    const trails = ctx.systems.minimapTracker.Trails;
    tornadoes.forEach((_, i) => drawTrail(trails[i], TORNADO_PALETTE[i % TORNADO_PALETTE.length], s));
    // Each active funnel's footprint, to scale.
    // Only once it exists: before Start there is no tornado (vortex.js BIRTH).
    for (const { Vortex } of ctx.tornadoes.active) {
      if (Vortex.birth <= 0) continue;
      const [hr, hg, hb] = TORNADO_PALETTE[Vortex.index % TORNADO_PALETTE.length].hot;
      g.fillStyle = `rgba(${hr}, ${hg}, ${hb}, 0.2)`;
      g.beginPath();
      g.arc(Vortex.center.x, Vortex.center.z, Sim.params.radius * Vortex.sizeMul * Vortex.birth, 0, Math.PI * 2);
      g.fill();
    }

    // The Electric Tornado's EMP (engine/electricStorm.js), to scale as it
    // travels: a violet halo round an electric-cyan front with a flickering
    // white core, over a faint wash of the ground it has already crossed --
    // a colour nothing else on the map uses.
    // The Electric Tornado's ring, and any wave a charged funnel is
    // sending out (empCharge.js), drawn alike.
    const rings = [];
    const stormRing = ctx.systems.electricStorm && ctx.systems.electricStorm.empRing();
    if (stormRing) rings.push(stormRing);
    if (ctx.systems.empCharge) rings.push(...ctx.systems.empCharge.waveRings());
    for (const emp of rings) {
      if (emp.radius <= 1) continue;
      const a = 0.35 + 0.65 * emp.strength;
      const flicker = 0.75 + 0.25 * Math.sin(t * 60);
      g.fillStyle = `rgba(90, 220, 255, ${(0.08 * a).toFixed(3)})`;
      g.beginPath();
      g.arc(emp.x, emp.z, emp.radius, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 9 / s;
      g.strokeStyle = `rgba(190, 90, 255, ${(0.45 * a).toFixed(3)})`;
      g.stroke();
      g.lineWidth = 4 / s;
      g.strokeStyle = `rgba(80, 235, 255, ${(0.95 * a).toFixed(3)})`;
      g.stroke();
      g.lineWidth = 1.4 / s;
      g.strokeStyle = `rgba(240, 255, 255, ${(a * flicker).toFixed(3)})`;
      g.stroke();
    }

    // A nuclear plant's green EMP (engine/nuclear.js), going out across the
    // whole map.
    for (const ring of ctx.systems.nuclear ? ctx.systems.nuclear.markers().rings : []) {
      if (ring.radius <= 1) continue;
      g.fillStyle = 'rgba(70, 255, 110, 0.07)';
      g.beginPath();
      g.arc(ring.x, ring.z, ring.radius, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 7 / s;
      g.strokeStyle = 'rgba(60, 255, 100, 0.5)';
      g.stroke();
      g.lineWidth = 2 / s;
      g.strokeStyle = 'rgba(210, 255, 220, 0.95)';
      g.stroke();
    }

    // The downburst's square (engine/downburst.js): dashed while it is
    // still coming down, then filled and growing, with an arrow for the wind.
    const burst = ctx.systems.downburst && ctx.systems.downburst.downburstZone();
    if (burst && burst.half > 1) {
      g.save();
      g.translate(burst.x, burst.z);
      g.transform(burst.dirX, burst.dirZ, -burst.dirZ, burst.dirX, 0, 0);
      const h = burst.half;
      if (burst.warning) {
        g.setLineDash([8 / s, 6 / s]);
        g.lineWidth = 3 / s;
        g.strokeStyle = `rgba(255, 120, 60, ${(0.55 + 0.45 * Math.sin(t * 9)).toFixed(3)})`;
        g.strokeRect(-h, -h, h * 2, h * 2);
      } else {
        g.fillStyle = `rgba(190, 225, 245, ${(0.12 + 0.1 * burst.strength).toFixed(3)})`;
        g.fillRect(-h, -h, h * 2, h * 2);
        g.lineWidth = 3 / s;
        g.strokeStyle = `rgba(255, 170, 90, ${(0.4 + 0.5 * burst.strength).toFixed(3)})`;
        g.strokeRect(-h, -h, h * 2, h * 2);
        g.lineWidth = 4 / s;
        g.strokeStyle = 'rgba(235, 248, 255, 0.9)';
        g.beginPath();
        g.moveTo(-h * 0.45, 0);
        g.lineTo(h * 0.45, 0);
        g.moveTo(h * 0.25, -h * 0.18);
        g.lineTo(h * 0.45, 0);
        g.lineTo(h * 0.25, h * 0.18);
        g.stroke();
      }
      g.restore();
    }

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Soft inner shadow at the rim, so the edge reads as a lens.
    const rim = g.createRadialGradient(R, R, R * 0.72, R, R, R);
    rim.addColorStop(0, 'rgba(0, 0, 0, 0)');
    rim.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
    g.fillStyle = rim;
    g.fillRect(0, 0, cssSize, cssSize);

    for (const { Vortex } of ctx.tornadoes.active) {
      if (Vortex.birth <= 0) continue;
      const tornado = pinToRim(view, toMap(view, Vortex.center.x, Vortex.center.z));
      drawSwirl(g, tornado.x, tornado.y, t, tornado.pinned ? 0.75 : 1,
        TORNADO_PALETTE[Vortex.index % TORNADO_PALETTE.length]);
    }

    drawSurvivors(g, view, ctx.Environment.people);

    // The Terminators still standing (engine/terminator.js): red diamonds,
    // rim-pinned like the tornado, since they are the things to find.
    const machines = ctx.systems.terminator ? ctx.systems.terminator.positions() : [];
    for (const machine of machines) {
      const m = pinToRim(view, toMap(view, machine.x, machine.z));
      g.fillStyle = 'rgba(255, 60, 40, 0.95)';
      g.beginPath();
      g.moveTo(m.x, m.y - 5);
      g.lineTo(m.x + 4, m.y);
      g.lineTo(m.x, m.y + 5);
      g.lineTo(m.x - 4, m.y);
      g.closePath();
      g.fill();
    }

    // The alien ship and its crew (engine/aliens.js): a green ring and
    // green dots.
    const alienMarks = ctx.systems.aliens ? ctx.systems.aliens.markers() : null;
    if (alienMarks) {
      g.fillStyle = 'rgba(110, 255, 120, 0.95)';
      for (const a of alienMarks.aliens) {
        const m = pinToRim(view, toMap(view, a.x, a.z));
        g.beginPath();
        g.arc(m.x, m.y, 2.6, 0, Math.PI * 2);
        g.fill();
      }
      // The hunter ships: red rings, rim-pinned, since they are the ones
      // doing the killing.
      for (const h of alienMarks.hunters || []) {
        const m = pinToRim(view, toMap(view, h.x, h.z));
        g.strokeStyle = 'rgba(255, 70, 50, 1)';
        g.lineWidth = 2.2;
        g.beginPath();
        g.arc(m.x, m.y, 5.5, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = 'rgba(255, 70, 50, 0.4)';
        g.fill();
        g.fillStyle = 'rgba(110, 255, 120, 0.95)';
      }
      if (alienMarks.ship) {
        const m = pinToRim(view, toMap(view, alienMarks.ship.x, alienMarks.ship.z));
        g.strokeStyle = 'rgba(110, 255, 120, 0.95)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(m.x, m.y, 6.5, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = 'rgba(110, 255, 120, 0.35)';
        g.fill();
      }
    }

    // The fuel tanker (environment/tanker.js): a long orange truck,
    // rim-pinned, since it is something to go and find (or keep away from).
    const tanker = ctx.systems.tanker ? ctx.systems.tanker.tankerMarker() : null;
    if (tanker) {
      const m = pinToRim(view, toMap(view, tanker.x, tanker.z));
      drawCarIcon(g, view, m, tanker, 1, '#ff8a2a', 1.7);
    }
    // The nuclear plants (engine/nuclear.js): a radiation sign -- a yellow
    // disc with three black blades -- while standing, a green crater after.
    for (const plant of ctx.systems.nuclear ? ctx.systems.nuclear.markers().plants : []) {
      const m = pinToRim(view, toMap(view, plant.x, plant.z));
      g.save();
      g.translate(m.x, m.y);
      g.beginPath();
      g.arc(0, 0, 7.5, 0, Math.PI * 2);
      g.fillStyle = plant.standing ? '#f4c512' : 'rgba(60, 255, 100, 0.85)';
      g.fill();
      g.lineWidth = 1.2;
      g.strokeStyle = '#1c1400';
      g.stroke();
      if (plant.standing) {
        g.fillStyle = '#111';
        for (let i = 0; i < 3; i++) {
          const a0 = -Math.PI / 2 + (i * Math.PI * 2) / 3;
          g.beginPath();
          g.arc(0, 0, 6.2, a0 - Math.PI / 6, a0 + Math.PI / 6);
          g.arc(0, 0, 2, a0 + Math.PI / 6, a0 - Math.PI / 6, true);
          g.closePath();
          g.fill();
        }
      }
      g.restore();
    }
    // The four parked ones, out towards the edges: the same truck, not
    // rim-pinned (they do not move).
    for (const parkedTanker of ctx.systems.tanker ? ctx.systems.tanker.parkedMarkers() : []) {
      const m = pinToRim(view, toMap(view, parkedTanker.x, parkedTanker.z));
      if (m.pinned) continue;
      drawCarIcon(g, view, m, parkedTanker, 1, '#ff8a2a', 1.7);
    }
    // The Chase Mode car, parked where it waits to be driven
    // (chase/index.js parkChaseCar): a cyan car with a ring round it,
    // rim-pinned so it can always be found.
    // Not while Roger is driving it: then it is his own marker (below).
    const parked = Chase && !Chase.active && Chase.parked && !Chase.parked.mesh.userData.heroDriving ? Chase.parked : null;
    if (parked) {
      const p = parked.mesh.position;
      const m = pinToRim(view, toMap(view, p.x, p.z));
      g.strokeStyle = 'rgba(79, 209, 255, 0.9)';
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(m.x, m.y, 9.5, 0, Math.PI * 2);
      g.stroke();
      drawCarIcon(g, view, m, { x: p.x, z: p.z, heading: parked.mesh.rotation.y }, 1.2, COLOUR_ACCENT);
    }

    // Hero Mode (engine/heroMode.js): the bunker as a gold square -- nothing
    // else on the map is square or gold -- with an arrow on the rim pointing
    // to it when it is off the edge; Roger as a gold dot; each of his
    // pursuers as a red cross.
    const hero = ctx.systems.heroMode ? ctx.systems.heroMode.markers() : null;
    if (hero) {
      for (const pursuer of hero.pursuers) {
        const m = pinToRim(view, toMap(view, pursuer.x, pursuer.z));
        g.strokeStyle = 'rgba(255, 60, 40, 1)';
        g.lineWidth = 2.4;
        g.beginPath();
        g.moveTo(m.x - 4, m.y - 4);
        g.lineTo(m.x + 4, m.y + 4);
        g.moveTo(m.x + 4, m.y - 4);
        g.lineTo(m.x - 4, m.y + 4);
        g.stroke();
      }
      const carIcon = (at, car, size, fill) => drawCarIcon(g, view, at, car, size, fill);
      // The cars he could take: small white cars, the nearest one gold.
      (hero.cars || []).forEach((car, i) => {
        const m = toMap(view, car.x, car.z);
        if (Math.hypot(m.x - R, m.y - R) > R - 4) return;
        carIcon(m, car, i === 0 ? 1.1 : 0.85, i === 0 ? '#ffd35a' : 'rgba(235, 240, 250, 0.9)');
      });
      const r = pinToRim(view, toMap(view, hero.roger.x, hero.roger.z));
      g.fillStyle = '#ffd35a';
      if (hero.car) {
        // Driving: a big gold car with a glow, pointing the way it faces,
        // instead of the dot.
        g.fillStyle = 'rgba(255, 211, 90, 0.3)';
        g.beginPath();
        g.arc(r.x, r.y, 11, 0, Math.PI * 2);
        g.fill();
        carIcon(r, hero.car, 1.6, '#ffd35a');
      } else {
        g.beginPath();
        g.arc(r.x, r.y, 3.4, 0, Math.PI * 2);
        g.fill();
      }
      const b = pinToRim(view, toMap(view, hero.bunker.x, hero.bunker.z));
      g.fillStyle = '#ffb627';
      g.strokeStyle = '#fff4d0';
      g.lineWidth = 1.6;
      g.fillRect(b.x - 5, b.y - 5, 10, 10);
      g.strokeRect(b.x - 5, b.y - 5, 10, 10);
      if (b.pinned) {
        // Off the map: an arrowhead just inside the square, pointing out.
        const ang = Math.atan2(b.y - R, b.x - R);
        const tipX = b.x - Math.cos(ang) * 9;
        const tipY = b.y - Math.sin(ang) * 9;
        g.beginPath();
        g.moveTo(tipX + Math.cos(ang) * 5, tipY + Math.sin(ang) * 5);
        g.lineTo(tipX + Math.cos(ang + 2.4) * 5, tipY + Math.sin(ang + 2.4) * 5);
        g.lineTo(tipX + Math.cos(ang - 2.4) * 5, tipY + Math.sin(ang - 2.4) * 5);
        g.closePath();
        g.fill();
      }
    }

    if (Chase && Chase.active && Chase.car) {
      drawPlayerArrow(g, R, R, 0);
    } else {
      const camera = Sim.three.camera;
      const player = pinToRim(view, toMap(view, camera.position.x, camera.position.z));
      const halfFov = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
      drawPlayerArrow(g, player.x, player.y, player.pinned ? 0 : halfFov);
    }

    // North marker on the rim (world -z is north).
    const nx = R + -view.dx * (R - RIM_INSET);
    const ny = R + view.dz * (R - RIM_INSET);
    g.fillStyle = 'rgba(12, 16, 25, 0.85)';
    g.beginPath();
    g.arc(nx, ny, 7.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#eef2fa';
    g.font = '700 10px system-ui, -apple-system, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', nx, ny + 0.5);
    g.restore();
  }

  /** @returns {void} */
  function disposeMinimap() {
    if (resizeObserver) resizeObserver.disconnect();
    resizeObserver = null;
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    canvas = null;
    g = null;
    layer = null;
    layerG = null;
  }

  return { initMinimap, updateMinimap, disposeMinimap };
}
