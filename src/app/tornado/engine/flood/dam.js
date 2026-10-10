import * as THREE from 'three';
import { FLOOD, createCrackTexture } from './config.js';

/**
 * ===========================================================================
 * SECTION FL.2 — The dam
 * ===========================================================================
 * The gate, it bursting, the jets and chunks, and what the rest of the game
 * asks about the wall (for the funnels and the damage).
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see flood.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createFloodDam(ctx, S, api) {
  /**
   * Puts the gate back up, clears the rubble, refills the reservoir and marks
   * the dam as holding again.
   * @returns {void}
   */
  function rebuildGate() {
    S.state.broken = false;
    S.state.frontX = FLOOD.damX;
    if (S.gate) {
      S.gate.visible = true;
      S.gate.position.set(FLOOD.damX, FLOOD.damHeight / 2, 0);
      S.gate.rotation.set(0, 0, 0);
    }
    if (S.cracks) {
      S.cracks.material.opacity = 0;
      // A fresh pattern each time, so a second failure does not crack along
      // exactly the lines the first one did.
      const old = S.cracks.userData.texture;
      S.cracks.userData.texture = createCrackTexture();
      S.cracks.material.map = S.cracks.userData.texture;
      S.cracks.material.needsUpdate = true;
      if (old) old.dispose();
    }
    if (S.reservoir) S.reservoir.position.y = FLOOD.reservoirLevel;
    for (const chunk of S.chunks) S.group.remove(chunk.mesh);
    S.chunks = [];
  }

  /**
   * The breach itself, drawn: the gate gone, its blocks thrown downstream and
   * a wall of spray (shared by the host's burst and the guest's mirror).
   * @returns {void}
   */
  function spawnBreach() {
    S.gate.visible = false;
    const face = FLOOD.damX + FLOOD.damThickness / 2;
    for (let i = 0; i < FLOOD.chunkCount; i++) {
      const size = FLOOD.chunkSize[0] + Math.random() * (FLOOD.chunkSize[1] - FLOOD.chunkSize[0]);
      const mesh = new THREE.Mesh(S.chunkGeometry, S.chunkMaterial);
      mesh.scale.set(size * (0.6 + Math.random() * 0.5), size * (0.5 + Math.random() * 0.6), size);
      mesh.position.set(
        face,
        Math.random() * FLOOD.damHeight,
        (Math.random() * 2 - 1) * FLOOD.breachHalfWidth
      );
      // Debris: no shadow (performance pass).
      mesh.castShadow = false;
      mesh.name = 'flood_dam_chunk';
      S.group.add(mesh);
      const speed = FLOOD.chunkSpeed[0] + Math.random() * (FLOOD.chunkSpeed[1] - FLOOD.chunkSpeed[0]);
      S.chunks.push({
        mesh,
        vel: new THREE.Vector3(speed, 6 + Math.random() * 14, (Math.random() - 0.5) * speed * 0.5),
        spin: new THREE.Vector3((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5),
        half: mesh.scale.y / 2,
        resting: false
      });
    }
    for (let i = 0; i < 160; i++) spawnJet(1, true);
  }

  /**
   * The moment it goes: the gate bursts into blocks of concrete thrown
   * downstream, a wall of spray goes up, and the water is through.
   * @returns {void}
   */
  function burstGate() {
    spawnBreach();
    const face = FLOOD.damX + FLOOD.damThickness / 2;

    const at = new THREE.Vector3(FLOOD.damX, 12, 0);
    api.showBanner('DAM BREACH!', 'A wall of water is coming');
    ctx.systems.gamefeel.event('flood', at);
    ctx.systems.damage.addDamageScore(FLOOD.score);
    ctx.systems.cues.playLargeExplosion({ priority: true });
    ctx.systems.earthquakeSound.playRupture(1);
    // The water through: the first crash of the wave (sound/flood.js).
    if (ctx.systems.floodSound) ctx.systems.floodSound.playCrash(1);
    if (ctx.systems.earthquake) ctx.systems.earthquake.kickDust(face + 6, 0, 8, 3);

    S.state.phase = 'breaking';
    S.state.timer = 0;
  }

  /**
   * Co-op guest: the gate going, drawn and heard only (the host's
   * `burstGate` minus the camera shake, the score and the large explosion).
   * The sounds are the host's, scaled by how far the listener is.
   * @param {number} scale 0..1 loudness (net/floodFx.js soundScale)
   * @returns {void}
   */
  function mirrorBurst(scale) {
    spawnBreach();
    api.showBanner('DAM BREACH!', 'A wall of water is coming');
    if (scale > 0.01) {
      ctx.systems.earthquakeSound.playRupture(scale);
      if (ctx.systems.floodSound) ctx.systems.floodSound.playCrash(scale);
    }
    const caps = ctx.systems.caps;
    if (ctx.systems.earthquake && (!caps || caps.particleRoom() > 0)) {
      ctx.systems.earthquake.kickDust(FLOOD.damX + FLOOD.damThickness / 2 + 6, 0, 8, 3);
    }
  }

  /**
   * Water forced through the cracks in the gate (or, once it has gone,
   * pouring through the hole), shot downstream out of the wall's face.
   * @param {number} t 0..1 how far the failure has gone
   * @param {boolean} [burst] the spray when the gate goes, flung wider
   * @returns {void}
   */
  function spawnJet(t, burst = false) {
    const p = S.foam;
    if (ctx.systems.caps && ctx.systems.caps.particleRoom() <= 0) return;
    const i = p.next;
    p.next = (p.next + 1) % FLOOD.foamMax;
    p.positions[i * 3] = FLOOD.damX + FLOOD.damThickness / 2 + 0.5;
    p.positions[i * 3 + 1] = 2 + Math.random() * FLOOD.damHeight * (burst ? 0.95 : 0.75);
    p.positions[i * 3 + 2] = (Math.random() * 2 - 1) * FLOOD.breachHalfWidth * 0.9;
    const speed = (burst ? 30 : 8 + 22 * t) * (0.6 + Math.random() * 0.6);
    p.velocities[i * 3] = speed;
    p.velocities[i * 3 + 1] = (burst ? 6 : 1) + Math.random() * 5;
    p.velocities[i * 3 + 2] = (Math.random() - 0.5) * (burst ? 18 : 5);
    p.life[i] = p.maxLife[i] = FLOOD.foamLife[0] + Math.random() * (FLOOD.foamLife[1] - FLOOD.foamLife[0]);
    p.seed[i] = Math.random();
  }

  /**
   * The gate's blocks: thrown, tumbling, and coming to rest where they land.
   * They stay as rubble below the dam until it is rebuilt.
   * @param {number} dt
   * @returns {void}
   */
  function updateChunks(dt) {
    for (const chunk of S.chunks) {
      if (chunk.resting) continue;
      chunk.vel.y -= 26 * dt;
      chunk.mesh.position.addScaledVector(chunk.vel, dt);
      chunk.mesh.rotation.x += chunk.spin.x * dt;
      chunk.mesh.rotation.y += chunk.spin.y * dt;
      chunk.mesh.rotation.z += chunk.spin.z * dt;
      if (chunk.mesh.position.y < chunk.half) {
        chunk.mesh.position.y = chunk.half;
        chunk.vel.multiplyScalar(0.45);
        chunk.vel.y = Math.abs(chunk.vel.y) * 0.3;
        chunk.spin.multiplyScalar(0.5);
        if (chunk.vel.lengthSq() < 1) {
          chunk.resting = true;
          // Settled flat, not balanced on a corner.
          chunk.mesh.rotation.x = 0;
          chunk.mesh.rotation.z = 0;
        }
      }
    }
  }

  /**
   * The town-side face of the dam wall, for anything that must not cross it
   * (tornadoEngine.js keeps the funnels on this side).
   * @returns {{x: number, halfWidth: number}}
   */
  function damWall() {
    return { x: FLOOD.damX + FLOOD.damThickness / 2, halfWidth: FLOOD.damHalfWidth };
  }

  /**
   * The west edge of the world: the dam's town-side face (plus a margin).
   * Nothing goes past it -- not through the breach, not round the ends
   * (physics.js, hero/movement.js, chase/drive.js).
   * @returns {number}
   */
  function westLimit() {
    return FLOOD.damX + FLOOD.damThickness / 2 + FLOOD.westMargin;
  }

  /**
   * The dam wall as boxes on the ground, for Roger to stop against
   * (heroMode.js): the whole wall while it holds, the two wings either side
   * of the breach once it has gone.
   * @returns {{x: number, z: number, hw: number, hd: number}[]}
   */
  function damSolids() {
    const hw = FLOOD.damThickness / 2;
    if (!S.state.broken) return [{ x: FLOOD.damX, z: 0, hw, hd: FLOOD.damHalfWidth }];
    const wing = (FLOOD.damHalfWidth - FLOOD.breachHalfWidth) / 2;
    const mid = FLOOD.breachHalfWidth + wing;
    return [{ x: FLOOD.damX, z: -mid, hw, hd: wing }, { x: FLOOD.damX, z: mid, hw, hd: wing }];
  }

  /** @returns {boolean} whether the dam is still holding */
  function isDamIntact() {
    return !S.state.broken;
  }

  return { rebuildGate, burstGate, mirrorBurst, spawnJet, updateChunks, damWall, westLimit, damSolids, isDamIntact };
}
