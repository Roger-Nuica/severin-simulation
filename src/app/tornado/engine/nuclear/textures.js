// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION AM.3 — The nuclear plants' textures
 * ===========================================================================
 * Drawn on a canvas at start-up: the radiation sign and the turbine hall's
 * wall (moved out of nuclear.js unchanged, to keep it under ~800 lines).
 */

/**
 * A yellow radiation sign: the black trefoil on a yellow disc.
 * @returns {THREE.CanvasTexture}
 */
export function createTrefoilTexture() {
  const size = 128;
  const c = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = '#f4c512';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#111';
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
    g.beginPath();
    g.arc(c, c, 54, a - Math.PI / 6, a + Math.PI / 6);
    g.arc(c, c, 17, a + Math.PI / 6, a - Math.PI / 6, true);
    g.closePath();
    g.fill();
  }
  g.beginPath();
  g.arc(c, c, 11, 0, Math.PI * 2);
  g.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A vertical glow, bright at the foot and gone at the top, for the EMP's
 * wall.
 * @returns {THREE.CanvasTexture}
 */
export function createWallTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  const gradient = g.createLinearGradient(0, 128, 0, 0);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(canvas);
}
