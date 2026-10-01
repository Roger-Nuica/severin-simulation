// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION AO.1 — Smooth Criminal: the camera on his ascent
 * ===========================================================================
 * On request, the only change to him: when he rises (smoothCriminal.js
 * rogerKilled), the camera watches from a medium distance so the explosion
 * is in the frame too. From the side the camera is on, it glides out with
 * him (SMOOTH.shot near to far), a little below him and looking up past him,
 * him in the middle of the frame with sky round him. Once he is gone it
 * pulls back and down (shot.blast) so the whole violet blast -- its
 * fireballs are spread 300 m across the town -- the rings and the mushroom
 * are in frame, holds shot.watch seconds, and gives the camera back. In
 * every camera mode, Hero Mode included (camera.js glideWith, `always`).
 */

/**
 * @param {Object} ctx
 * @param {{x: number, z: number, stageHeight: number, ascendHeight: number, ascendSeconds: number,
 *   shot: {near: number, far: number, blast: number, blastHeight: number, blastLook: number, watch: number}}} smooth
 * @param {() => (THREE.Vector3|null)} where where he is, while he rises; null once he has gone up
 * @returns {void}
 */
export function filmAscent(ctx, smooth, where) {
  const camera = ctx.systems.camera;
  const start = where();
  if (!camera || !start) return;
  const cam = ctx.Sim.three.camera.position;
  const bearing = Math.atan2(cam.x - smooth.x, cam.z - smooth.z);
  const H = smooth.stageHeight;
  const shot = smooth.shot;
  const last = new THREE.Vector3().copy(start);
  let goneAt = -1;
  camera.glideWith((/** @type {THREE.Vector3} */ position, /** @type {THREE.Vector3} */ target, /** @type {number} */ elapsed) => {
    const now = where();
    if (now) last.copy(now);
    else if (goneAt < 0) goneAt = elapsed;
    const u = THREE.MathUtils.clamp((last.y - H) / (smooth.ascendHeight - H), 0, 1);
    // Rising: out with him, a little below him, looking up past him.
    let back = shot.near + (shot.far - shot.near) * u;
    let y = last.y * 0.85 + 4;
    let look = last.y + 2;
    if (goneAt >= 0) {
      // The blast: back and down, the ground and the sky over it in frame.
      const w = THREE.MathUtils.smoothstep(elapsed - goneAt, 0, 1.6);
      back += (shot.blast - back) * w;
      y += (shot.blastHeight - y) * w;
      look += (shot.blastLook - look) * w;
    }
    position.set(smooth.x + Math.sin(bearing) * back, y, smooth.z + Math.cos(bearing) * back);
    target.set(smooth.x, look, smooth.z);
  }, { hold: smooth.ascendSeconds - 1 + shot.watch, always: true });
}
