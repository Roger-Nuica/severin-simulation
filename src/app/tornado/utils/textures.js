// @ts-check
import * as THREE from 'three';

/** @returns {THREE.CanvasTexture} */
export function createGroundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#4a5d3a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const r = 2 + Math.random() * 10;
    const isDirt = Math.random() < 0.35;
    ctx.fillStyle = isDirt
      ? `rgba(${90 + Math.random() * 30}, ${68 + Math.random() * 20}, ${42 + Math.random() * 16}, ${0.18 + Math.random() * 0.22})`
      : `rgba(${60 + Math.random() * 30}, ${90 + Math.random() * 30}, ${50 + Math.random() * 20}, ${0.15 + Math.random() * 0.2})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(40, 40);
  return texture;
}

/**
 * Renders a small horizontally-banded, faintly-streaked canvas texture used
 * as both the funnel's colour map and alpha map, giving the surface
 * condensation-like banding instead of a flat tint.
 * @returns {THREE.CanvasTexture}
 */
export function createFunnelBandTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    const v = y / canvas.height;
    for (let x = 0; x < canvas.width; x++) {
      const u = x / canvas.width;
      const idx = (y * canvas.width + x) * 4;
      const band = Math.sin(v * Math.PI * 26 + Math.sin(u * Math.PI * 4) * 2.2) * 0.5 + 0.5;
      const streak = Math.sin(u * Math.PI * 18 + v * 6) * 0.5 + 0.5;
      const n = band * 0.75 + streak * 0.25;
      const value = Math.round(165 + n * 90);
      image.data[idx] = value;
      image.data[idx + 1] = value;
      image.data[idx + 2] = value;
      image.data[idx + 3] = Math.round(90 + n * 140);
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 3);
  return texture;
}

/**
 * Renders a soft radial-gradient sprite used as the point sprite for both
 * the swirl and ground dust particle systems, replacing flat square dots.
 * @returns {THREE.CanvasTexture}
 */
export function createSoftDotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.65)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/**
 * A 2x2 atlas of soft, irregular cloud puffs for the cloud billboards in
 * clouds.js. Each 256px cell holds one puff built from a few dozen
 * overlapping radial blobs, heaped higher in the middle and flatter along
 * the bottom like a real cumulus, then multiplied by a radial mask that
 * reaches zero well inside the cell -- so no puff can ever show a hard,
 * clipped edge (the fault with the old single-sprite texture, whose blobs
 * ran off the canvas).
 *
 * Channels: alpha is coverage; red (copied to green/blue) is a baked light
 * term -- bright on top, dark underneath, with a highlight on the crown of
 * each blob -- which the cloud shader uses to mix its top and belly
 * colours. It is shading data, not a colour, so it stays in linear space.
 * @returns {THREE.CanvasTexture}
 */
export function createCloudPuffAtlas() {
  const cell = 256;
  const size = cell * 2;
  const cover = document.createElement('canvas');
  cover.width = size;
  cover.height = size;
  const light = document.createElement('canvas');
  light.width = size;
  light.height = size;
  const cg = cover.getContext('2d', { willReadFrequently: true });
  const lg = light.getContext('2d', { willReadFrequently: true });

  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * cell;
    const oy = Math.floor(v / 2) * cell;
    const blobs = 26 + Math.floor(Math.random() * 10);
    for (let i = 0; i < blobs; i++) {
      // Spread wide, piled towards the middle, with a flattish base.
      const u = Math.random() * 2 - 1;
      const x = ox + cell / 2 + u * cell * 0.3;
      const heap = 1 - Math.abs(u);
      const y = oy + cell * 0.62 - Math.random() * cell * 0.3 * (0.35 + heap);
      const r = cell * (0.07 + Math.random() * 0.1) * (0.7 + heap * 0.6);

      const g = cg.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.3)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      cg.fillStyle = g;
      cg.beginPath();
      cg.arc(x, y, r, 0, Math.PI * 2);
      cg.fill();

      // Crown highlight: offset up-left of the blob centre.
      const hx = x - r * 0.2;
      const hy = y - r * 0.35;
      const hg = lg.createRadialGradient(hx, hy, 0, hx, hy, r * 0.8);
      hg.addColorStop(0, 'rgba(255,255,255,0.35)');
      hg.addColorStop(1, 'rgba(255,255,255,0)');
      lg.fillStyle = hg;
      lg.beginPath();
      lg.arc(hx, hy, r * 0.8, 0, Math.PI * 2);
      lg.fill();
    }
  }

  const coverData = cg.getImageData(0, 0, size, size).data;
  const lightData = lg.getImageData(0, 0, size, size).data;
  const out = cg.createImageData(size, size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const i = (py * size + px) * 4;
      const lx = (px % cell) / cell - 0.5;
      const ly = (py % cell) / cell - 0.5;
      // Elliptical mask: 1 in the middle, 0 by 0.46 of the cell radius.
      const m = Math.hypot(lx / 1.0, ly / 0.8);
      const mask = Math.max(0, Math.min(1, (0.46 - m) / 0.12));
      const alpha = Math.min(1, (coverData[i + 3] / 255) * 1.6) * mask;
      // Vertical light: top of the cell bright, underside dark.
      const vertical = 0.2 + 0.8 * Math.max(0, Math.min(1, (0.3 - ly) / 0.6));
      const lit = Math.min(1, vertical * 0.8 + (lightData[i + 3] / 255) * 0.6);
      const val = Math.round(lit * 255);
      out.data[i] = val;
      out.data[i + 1] = val;
      out.data[i + 2] = val;
      out.data[i + 3] = Math.round(alpha * 255);
    }
  }
  cg.putImageData(out, 0, 0);
  return new THREE.CanvasTexture(cover);
}

/**
 * Radial fire gradient: white-hot at the centre through yellow and orange to
 * a deep red edge, all fading to fully transparent so particles blend into
 * each other instead of showing square sprite borders. Used by the fireball
 * core, the fire particles and the embers.
 * @returns {THREE.CanvasTexture}
 */
export function createFireTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,245,1)');
  gradient.addColorStop(0.18, 'rgba(255,238,170,0.95)');
  gradient.addColorStop(0.42, 'rgba(255,146,38,0.8)');
  gradient.addColorStop(0.72, 'rgba(196,48,10,0.32)');
  gradient.addColorStop(1, 'rgba(120,20,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/**
 * The cartoon ring of stars that spins over a dazed survivor's head (see
 * engine/environment/dazedStars.js). Four five-pointed stars spaced evenly
 * around the centre of the canvas, each with a soft halo behind it so they
 * still read at distance once the sprite is only a few pixels across, and
 * nothing at all in the middle -- the head shows through the ring rather than
 * being covered by a disc.
 * @returns {THREE.CanvasTexture}
 */
export function createSpinningStarsTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const centre = size / 2;
  const orbit = size * 0.33;
  const stars = 4;

  for (let i = 0; i < stars; i++) {
    const angle = (i / stars) * Math.PI * 2;
    const cx = centre + Math.cos(angle) * orbit;
    const cy = centre + Math.sin(angle) * orbit;
    // Alternating sizes, so the ring reads as tumbling rather than as a
    // mechanically even cog.
    const outer = size * (i % 2 === 0 ? 0.115 : 0.085);
    const inner = outer * 0.42;

    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, outer * 1.9);
    halo.addColorStop(0, 'rgba(255, 236, 150, 0.55)');
    halo.addColorStop(1, 'rgba(255, 210, 90, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, outer * 1.9, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    for (let p = 0; p < 10; p++) {
      const r = p % 2 === 0 ? outer : inner;
      // -PI/2 puts a point straight up, and the per-star spin keeps the four
      // from looking stamped from one die.
      const a = -Math.PI / 2 + (p / 10) * Math.PI * 2 + angle * 0.5;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (p === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 244, 196, 0.98)';
    ctx.fill();
    ctx.lineWidth = size * 0.012;
    ctx.strokeStyle = 'rgba(214, 152, 32, 0.9)';
    ctx.stroke();
  }

  return new THREE.CanvasTexture(canvas);
}

/**
 * The scorched, cracked earth the tornado leaves behind (see PathTrack in
 * engine/groundFx.js). Mapped with u across the width of the scar ribbon and
 * v running along its length, so the texture's two axes are not
 * interchangeable:
 *
 *  - **v (along the path)** tiles, and every mark drawn here is drawn again
 *    one canvas height up and down, so nothing is clipped at the seam and a
 *    scar of any length shows no repeating hard edge.
 *  - **u (across the width)** does not tile. Alpha is multiplied by a ragged
 *    edge mask that reaches zero at u=0 and u=1, which is what keeps the scar
 *    from reading as a ribbon with two straight sides: the mask's own wobble
 *    (seamless in v, being built from whole-period sines) eats irregular
 *    bites out of both edges.
 *
 * Three layers of marks: broad scorch patches (the burn), torn soil blotches
 * a shade lighter (ground churned up rather than charred), and thin dark
 * cracks fanning roughly along the direction of travel.
 * @returns {THREE.CanvasTexture}
 */
export function createGroundScarTexture() {
  const w = 256;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  /**
   * Draws one mark three times -- at y, y - h and y + h -- so a mark
   * overlapping the top or bottom edge reappears on the other side and the
   * texture stays seamless along v.
   * @param {number} y
   * @param {(offsetY: number) => void} draw
   * @returns {void}
   */
  function wrapped(y, draw) {
    draw(0);
    if (y < h * 0.25) draw(h);
    if (y > h * 0.75) draw(-h);
  }

  // Scorch patches: soft, wide and dark, clustered towards the middle of the
  // ribbon where the funnel's core actually ground along.
  for (let i = 0; i < 90; i++) {
    const cx = w * 0.5 + (Math.random() - 0.5) * w * 0.78;
    const cy = Math.random() * h;
    const r = 14 + Math.random() * 46;
    const dark = 0.5 + Math.random() * 0.45;
    wrapped(cy, (dy) => {
      const g = ctx.createRadialGradient(cx, cy + dy, 0, cx, cy + dy, r);
      g.addColorStop(0, `rgba(26, 19, 13, ${dark.toFixed(3)})`);
      g.addColorStop(0.55, `rgba(38, 28, 19, ${(dark * 0.6).toFixed(3)})`);
      g.addColorStop(1, 'rgba(44, 33, 22, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy + dy, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Torn soil: smaller, lighter blotches of exposed earth over the burn, so
  // the scar is not one flat black smear.
  for (let i = 0; i < 150; i++) {
    const cx = Math.random() * w;
    const cy = Math.random() * h;
    const r = 3 + Math.random() * 13;
    const a = 0.16 + Math.random() * 0.3;
    wrapped(cy, (dy) => {
      const g = ctx.createRadialGradient(cx, cy + dy, 0, cx, cy + dy, r);
      g.addColorStop(0, `rgba(${92 + Math.random() * 26 | 0}, ${66 + Math.random() * 18 | 0}, 42, ${a.toFixed(3)})`);
      g.addColorStop(1, 'rgba(90, 64, 40, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy + dy, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Cracks: jagged polylines walking mostly along v (the direction of
  // travel), with a couple of shorter branches off each one.
  ctx.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const startX = Math.random() * w;
    const startY = Math.random() * h;
    const length = 40 + Math.random() * 150;
    const drift = (Math.random() - 0.5) * 1.5;
    wrapped(startY, (dy) => {
      ctx.strokeStyle = `rgba(14, 10, 7, ${(0.35 + Math.random() * 0.4).toFixed(3)})`;
      ctx.lineWidth = 0.8 + Math.random() * 2.2;
      ctx.beginPath();
      let x = startX;
      let y = startY + dy;
      ctx.moveTo(x, y);
      const steps = 5 + Math.floor(Math.random() * 6);
      for (let s = 0; s < steps; s++) {
        x += drift * (length / steps) + (Math.random() - 0.5) * 9;
        y += length / steps;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
  }

  // Ragged edge mask across u. The wobble uses whole-period sines in v so the
  // mask itself repeats exactly with the texture.
  const image = ctx.getImageData(0, 0, w, h);
  for (let py = 0; py < h; py++) {
    const v = py / h;
    const wobbleL = 0.06 + 0.05 * (Math.sin(v * Math.PI * 6) * 0.5 + 0.5) + 0.04 * (Math.sin(v * Math.PI * 22 + 1.3) * 0.5 + 0.5);
    const wobbleR = 0.06 + 0.05 * (Math.sin(v * Math.PI * 8 + 2.1) * 0.5 + 0.5) + 0.04 * (Math.sin(v * Math.PI * 18 + 0.4) * 0.5 + 0.5);
    for (let px = 0; px < w; px++) {
      const u = px / w;
      const edge = Math.min(
        Math.max(0, Math.min(1, (u - wobbleL * 0.5) / Math.max(1e-3, wobbleL))),
        Math.max(0, Math.min(1, (1 - u - wobbleR * 0.5) / Math.max(1e-3, wobbleR)))
      );
      const i = (py * w + px) * 4;
      // Smoothstep on the edge ramp, so the fade-out is soft rather than linear.
      image.data[i + 3] = Math.round(image.data[i + 3] * edge * edge * (3 - 2 * edge));
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  // u is clamped (it spans the ribbon exactly once); v repeats along the path.
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * A bright thin annulus, transparent in the middle, for the shockwave: as it
 * scales up it reads as a ring racing outward from the blast rather than a
 * disc growing over it.
 * @returns {THREE.CanvasTexture}
 */
export function createShockRingTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,200,130,0)');
  gradient.addColorStop(0.62, 'rgba(255,190,120,0)');
  gradient.addColorStop(0.82, 'rgba(255,226,180,0.85)');
  gradient.addColorStop(0.93, 'rgba(255,170,90,0.35)');
  gradient.addColorStop(1, 'rgba(255,150,70,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}
