#!/usr/bin/env node
/**
 * Generate simple PWA icons for the tornado app.
 */

import { Jimp } from 'jimp';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, 'public');

async function generateIcons() {
  console.log('Generating PWA icons...');

  try {
    // Create icons with different sizes
    await createIcon(192, false);
    await createIcon(512, false);
    await createIcon(192, true);
    await createIcon(512, true);

    // Create screenshots
    await createScreenshot(192);
    await createScreenshot(512);

    console.log('✓ All PWA icons generated successfully!');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

/**
 * Create a simple tornado icon.
 */
async function createIcon(size, maskable) {
  // Create dark background
  const image = new Jimp({ width: size, height: size, color: 0x1a1a2eff });

  const center = size / 2;
  const padding = maskable ? Math.floor(size * 0.1) : Math.floor(size * 0.15);
  const maxRadius = (size - padding * 2) / 2;

  // Draw concentric circles using Jimp's drawEllipse or basic circle approach
  // Outer circle (accent blue)
  drawCircleOutline(image, center, center, maxRadius * 0.9, 0x4a9effff, 3);

  // Middle circle (orange)
  drawCircleOutline(image, center, center, maxRadius * 0.6, 0xff6b35ff, 3);

  // Inner circle (dark)
  drawCircleOutline(image, center, center, maxRadius * 0.35, 0x1a1a2eff, 1);

  const path = maskable
    ? `${publicDir}/tornado-icon-maskable-${size}.png`
    : `${publicDir}/tornado-icon-${size}.png`;

  await image.write(path);
  console.log(`  ✓ Created tornado-icon-${maskable ? 'maskable-' : ''}${size}.png`);
}

/**
 * Create a screenshot preview.
 */
async function createScreenshot(size) {
  const image = new Jimp({ width: size, height: size, color: 0x1a1a2eff });

  // Add a simple gradient effect and shapes
  const centerY = Math.floor(size * 0.5);

  // Draw some gradient-like horizontal stripes for visual interest
  for (let y = 0; y < size; y++) {
    const intensity = Math.floor((y / size) * 100);
    for (let x = 0; x < size; x++) {
      // Skip if outside circle area
      const dx = x - size / 2;
      const dy = y - centerY;
      if (dx * dx + dy * dy < (size * 0.4) * (size * 0.4)) {
        // Only colour pixels inside the tornado area
        if (y % 8 < 4) {
          image.setPixelColor(0x4a9effff, x, y);
        }
      }
    }
  }

  // Draw tornado cone
  drawCircleOutline(image, size / 2, centerY, size * 0.35, 0xff6b35ff, 2);
  drawCircleOutline(image, size / 2, centerY, size * 0.2, 0xff6b35ff, 2);

  const path = `${publicDir}/tornado-screenshot-${size}.png`;
  await image.write(path);
  console.log(`  ✓ Created tornado-screenshot-${size}.png`);
}

/**
 * Draw a circle outline.
 */
function drawCircleOutline(image, cx, cy, radius, colour, thickness = 1) {
  const width = image.bitmap.width;
  const height = image.bitmap.height;

  // Use Bresenham's circle algorithm
  let x = Math.floor(radius);
  let y = 0;
  let decisionParameter = 3 - 2 * Math.floor(radius);

  while (x >= y) {
    // Draw 8 symmetrical points
    drawCirclePoints(image, cx, cy, x, y, colour, width, height, thickness);

    if (decisionParameter < 0) {
      decisionParameter = decisionParameter + 4 * y + 6;
    } else {
      decisionParameter = decisionParameter + 4 * (y - x) + 10;
      x--;
    }
    y++;
  }
}

/**
 * Draw circle points symmetrically.
 */
function drawCirclePoints(image, cx, cy, x, y, colour, width, height, thickness) {
  const points = [
    [cx + x, cy + y],
    [cx - x, cy + y],
    [cx + x, cy - y],
    [cx - x, cy - y],
    [cx + y, cy + x],
    [cx - y, cy + x],
    [cx + y, cy - x],
    [cx - y, cy - x],
  ];

  for (const [px, py] of points) {
    // Draw with thickness by drawing nearby pixels
    for (let dx = -thickness + 1; dx < thickness; dx++) {
      for (let dy = -thickness + 1; dy < thickness; dy++) {
        const x = Math.floor(px) + dx;
        const y = Math.floor(py) + dy;
        if (x >= 0 && x < width && y >= 0 && y < height) {
          image.setPixelColor(colour, x, y);
        }
      }
    }
  }
}

generateIcons();
