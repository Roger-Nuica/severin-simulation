import * as THREE from 'three';
import { createSoftDotTexture } from '../../utils/textures.js';
import { pointScaleFor, markPoolDirty } from '../particlePool.js';
import { ELECTRIC, SHELL_VERTEX, SHELL_FRAGMENT } from './config.js';

/**
 * ===========================================================================
 * SECTION ES.2 — The charge you can see
 * ===========================================================================
 * The orbs and motes round the funnel, its shells, the sparks, and the arcs'
 * geometry written each frame.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see electricStorm.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createElectricGlow(ctx, S, api) {
  const { Sim } = ctx;

  // ---------------------------------------------------------------------
  // Ball lightning
  // ---------------------------------------------------------------------

  /** @returns {void} */
  function buildOrbs() {
    S.orbTexture = createSoftDotTexture();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ELECTRIC.orbCount * 3), 3));
    const mat = new THREE.PointsMaterial({
      size: ELECTRIC.orbSize,
      map: S.orbTexture,
      color: ELECTRIC.coreColour,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    S.materials.push(mat);
    S.orbs = new THREE.Points(geo, mat);
    S.orbs.name = 'electric_orbs';
    S.orbs.frustumCulled = false;
    S.orbs.visible = false;
    S.group.add(S.orbs);

    S.orbData = [];
    for (let i = 0; i < ELECTRIC.orbCount; i++) {
      S.orbData.push({
        angle: Math.random() * Math.PI * 2,
        spin: api.between(ELECTRIC.orbSpin) * (Math.random() < 0.5 ? -1 : 1),
        heightT: Math.random(),
        rise: api.between(ELECTRIC.orbRise),
        offset: 1.25 + Math.random() * 0.8,
        discharge: api.between(ELECTRIC.orbDischarge)
      });
    }
  }

  /**
   * @param {number} dt
   * @param {Object} instance the funnel the orbs are in orbit around
   * @returns {void}
   */
  function updateOrbs(dt, instance) {
    const shape = api.funnelShape(instance);
    const positions = S.orbs.geometry.attributes.position.array;
    for (let i = 0; i < S.orbData.length; i++) {
      const orb = S.orbData[i];
      orb.angle += orb.spin * dt;
      orb.heightT += (orb.rise / Math.max(1, shape.height)) * dt;
      if (orb.heightT > 1) orb.heightT -= 1;
      const y = orb.heightT * shape.height;
      const r = shape.radiusAt(y) * orb.offset;
      const x = shape.center.x + Math.cos(orb.angle) * r;
      const z = shape.center.z + Math.sin(orb.angle) * r;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      // Every so often an orb lets go into the ground under it.
      orb.discharge -= dt;
      if (orb.discharge <= 0) {
        orb.discharge = api.between(ELECTRIC.orbDischarge);
        S.scratchA.set(x, y, z);
        S.scratchB.set(x + (Math.random() - 0.5) * 14, 0.4, z + (Math.random() - 0.5) * 14);
        const landed = S.scratchB.clone();
        api.addArc(api.boltPath(S.scratchA, S.scratchB, 12, 2.4), ELECTRIC.strikeLife, 1.2, true);
        spawnSparks(landed);
        ctx.systems.powerLines.faultAt(landed.x, landed.z, 12);
        ctx.systems.buildingFire.igniteNear(landed.x, landed.z, 8);
        S.state.charge = Math.min(1, S.state.charge + 0.2);
      }
    }
    S.orbs.geometry.attributes.position.needsUpdate = true;
  }

  // ---------------------------------------------------------------------
  // The charged column
  // ---------------------------------------------------------------------

  /**
   * One mote of charge, born somewhere in the funnel's interior and carried
   * up and around. Stored with its own orbit rather than a straight velocity,
   * so the column spirals the way the funnel does.
   * @param {Object} instance
   * @returns {void}
   */
  function spawnMote(instance) {
    const shape = api.funnelShape(instance);
    const p = S.motes;
    const i = p.next;
    p.next = (p.next + 1) % ELECTRIC.moteMax;
    // Low in the column, and denser toward the wall than the axis -- a hollow
    // column reads as a column; a solid one reads as a cone.
    const h = Math.random() * shape.height * 0.35;
    const frac = 0.25 + Math.sqrt(Math.random()) * 0.7;
    const angle = Math.random() * Math.PI * 2;
    p.positions[i * 3] = shape.center.x;
    p.positions[i * 3 + 1] = h;
    p.positions[i * 3 + 2] = shape.center.z;
    // velocities holds the orbit, not a direction: angle, radius fraction,
    // and the rate it climbs.
    p.velocities[i * 3] = angle;
    p.velocities[i * 3 + 1] = frac;
    p.velocities[i * 3 + 2] = api.between(ELECTRIC.moteRise);
    p.life[i] = p.maxLife[i] = api.between(ELECTRIC.moteLife);
    p.seed[i] = Math.random();
  }

  /**
   * @param {number} dt
   * @param {Object} instance the funnel the column belongs to
   * @returns {void}
   */
  function updateMotes(dt, instance) {
    const shape = api.funnelShape(instance);
    const p = S.motes;
    let alive = 0;
    for (let i = 0; i < ELECTRIC.moteMax; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      if (p.life[i] <= 0) {
        p.colours[i * 4 + 3] = 0;
        p.sizes[i] = 0;
        continue;
      }
      alive++;
      const spin = ELECTRIC.moteSpin[0]
        + p.seed[i] * (ELECTRIC.moteSpin[1] - ELECTRIC.moteSpin[0]);
      p.velocities[i * 3] += spin * dt;
      const y = Math.min(shape.height, p.positions[i * 3 + 1] + p.velocities[i * 3 + 2] * dt);
      const r = shape.radiusAt(y) * p.velocities[i * 3 + 1];
      p.positions[i * 3] = shape.center.x + Math.cos(p.velocities[i * 3]) * r;
      p.positions[i * 3 + 1] = y;
      p.positions[i * 3 + 2] = shape.center.z + Math.sin(p.velocities[i * 3]) * r;

      const u = 1 - p.life[i] / p.maxLife[i];
      // Each mote flickers on its own beat, so the column is grainy rather
      // than a smooth cloud.
      const flicker = 0.35 + 0.65 * Math.abs(Math.sin(u * 22 + p.seed[i] * 9));
      S.scratchColour.copy(ELECTRIC.arcColour).lerp(ELECTRIC.hotColour, p.seed[i] * 0.22);
      p.colours[i * 4] = S.scratchColour.r * flicker;
      p.colours[i * 4 + 1] = S.scratchColour.g * flicker;
      p.colours[i * 4 + 2] = S.scratchColour.b * flicker;
      p.colours[i * 4 + 3] = Math.min(1, u * 5) * (1 - u) * flicker * 0.55;
      p.sizes[i] = THREE.MathUtils.lerp(ELECTRIC.moteSize[0], ELECTRIC.moteSize[1], p.seed[i]);
    }
    if (alive) {
      markPoolDirty(p);
      p.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    }
  }

  /**
   * The plasma shells: cones at different radii inside the funnel, each
   * showing only a web of thin veins of current that writhe and climb (see
   * SHELL_FRAGMENT). They replace torn patches of glow on a 2D noise grid,
   * which rendered as bright rectangles stuck to the column.
   * @returns {void}
   */
  function buildShells() {
    S.shells = [];
    for (let i = 0; i < ELECTRIC.shellCount; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: Math.random() * 40 },
          uCharge: { value: 0 },
          uSeed: { value: Math.random() * 10 },
          uColour: { value: new THREE.Color(ELECTRIC.coreColour) }
        },
        vertexShader: SHELL_VERTEX,
        fragmentShader: SHELL_FRAGMENT,
        // fwidth(), for the veins' constant on-screen width (WebGL1 needs
        // the extension asked for; WebGL2 has it built in).
        extensions: { derivatives: true }
      });
      S.materials.push(mat);
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 0.22, 1, 64, 24, true), mat
      );
      mesh.visible = false;
      S.group.add(mesh);
      S.shells.push({
        mesh,
        frac: THREE.MathUtils.lerp(
          ELECTRIC.shellRadius[0], ELECTRIC.shellRadius[1], i / Math.max(1, ELECTRIC.shellCount - 1)
        ),
        spin: api.between(ELECTRIC.shellSpin),
        angle: Math.random() * Math.PI * 2
      });
    }
  }

  /**
   * Rebuilds the shared line buffer from whatever is still alive. Arcs are
   * short -- a fifth of a second -- so this is a handful of hundreds of
   * segments in a normal frame, and it is the only place any of them touch
   * the GPU.
   * @param {number} dt
   * @returns {void}
   */
  function writeArcs(dt) {
    let vertex = 0;
    let glowAt = 0;
    const limit = ELECTRIC.maxSegments * 6;
    const g = S.glow;
    const eye = Sim.three.camera.position;

    /**
     * @param {THREE.Vector3} point
     * @param {THREE.Vector3} side
     * @param {number} sign +1 or -1: which edge of the ribbon
     * @returns {void}
     */
    const emit = (point, side, sign) => {
      S.arcPositions[vertex * 3] = point.x + side.x * sign;
      S.arcPositions[vertex * 3 + 1] = point.y + side.y * sign;
      S.arcPositions[vertex * 3 + 2] = point.z + side.z * sign;
      S.arcColours[vertex * 3] = S.scratchColour.r;
      S.arcColours[vertex * 3 + 1] = S.scratchColour.g;
      S.arcColours[vertex * 3 + 2] = S.scratchColour.b;
      S.arcEdges[vertex] = sign;
      vertex++;
    };
    for (let i = S.arcs.length - 1; i >= 0; i--) {
      const arc = S.arcs[i];
      arc.life -= dt;
      arc.age += dt;
      if (arc.life <= 0) {
        S.arcs.splice(i, 1);
        continue;
      }
      // Brightest the instant it strikes, cooling from white through blue as
      // it dies.
      const t = arc.life / arc.maxLife;
      S.scratchColour.copy(ELECTRIC.arcColour).lerp(ELECTRIC.hotColour, t * t * arc.hot);
      S.scratchColour.multiplyScalar(arc.gain * (0.25 + 0.75 * t));

      // The writhe: displace every point along its own bearing, tapered to
      // nothing at both ends so the arc stays anchored to what it struck.
      const last = arc.points.length - 1;
      // A single-point arc has no segments to draw, and p / last below would
      // be 0 / 0 -- NaN vertex positions.
      if (last < 1) continue;
      for (let p = 0; p <= last; p++) {
        const taper = Math.sin((p / last) * Math.PI);
        const swing = Math.sin(arc.age * ELECTRIC.writheRate + arc.phase + p * 0.7);
        arc.points[p].copy(arc.base[p]).addScaledVector(arc.offsets[p], arc.amp * swing * taper);
      }

      // Ribbon half-widths, one per point: across the local run of the
      // channel and across the line of sight, so the strip always faces the
      // camera, and shared by the two segments meeting at each point so the
      // ribbon has no gaps at its corners. Thickest where it leaves, thinning
      // towards where it lands, and thinning overall as the arc dies.
      const width = arc.width * (0.4 + 0.6 * t) * 0.5;
      while (S.sides.length <= last) S.sides.push(new THREE.Vector3());
      for (let p = 0; p <= last; p++) {
        const ahead = arc.points[Math.min(last, p + 1)];
        const behind = arc.points[Math.max(0, p - 1)];
        S.scratchA.subVectors(ahead, behind);
        S.scratchB.subVectors(eye, arc.points[p]);
        S.sides[p].crossVectors(S.scratchA, S.scratchB).normalize()
          .multiplyScalar(width * (1 - 0.55 * (p / last)));
      }
      for (let p = 0; p < last; p++) {
        if (vertex + 6 > limit) break;
        const a = arc.points[p];
        const b = arc.points[p + 1];
        emit(a, S.sides[p], 1);
        emit(a, S.sides[p], -1);
        emit(b, S.sides[p + 1], 1);
        emit(b, S.sides[p + 1], 1);
        emit(a, S.sides[p], -1);
        emit(b, S.sides[p + 1], -1);
      }

      // The halo. Sampled from the same points, at a fraction of the
      // channel's brightness and a good deal wider. Hero bolts only.
      if (!arc.halo) continue;
      for (let p = 0; p <= last; p += ELECTRIC.glowStride) {
        if (glowAt >= ELECTRIC.glowMax) break;
        const point = arc.points[p];
        g.positions[glowAt * 3] = point.x;
        g.positions[glowAt * 3 + 1] = point.y;
        g.positions[glowAt * 3 + 2] = point.z;
        g.colours[glowAt * 4] = S.scratchColour.r * ELECTRIC.glowGain;
        g.colours[glowAt * 4 + 1] = S.scratchColour.g * ELECTRIC.glowGain;
        g.colours[glowAt * 4 + 2] = S.scratchColour.b * ELECTRIC.glowGain;
        g.colours[glowAt * 4 + 3] = 0.5 + 0.5 * t;
        g.sizes[glowAt] = ELECTRIC.glowSize * (0.6 + 0.6 * t);
        glowAt++;
      }
    }

    // Anything left over from a busier frame is parked at zero size rather
    // than left lit where its arc used to be.
    for (let i = glowAt; i < ELECTRIC.glowMax; i++) {
      if (g.sizes[i] === 0) break;
      g.sizes[i] = 0;
      g.colours[i * 4 + 3] = 0;
    }
    markPoolDirty(g);
    g.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);

    S.arcMesh.geometry.setDrawRange(0, vertex);
    S.arcMesh.geometry.attributes.position.needsUpdate = true;
    S.arcMesh.geometry.attributes.aColour.needsUpdate = true;
    S.arcMesh.geometry.attributes.aEdge.needsUpdate = true;
  }

  /**
   * Sparks thrown off where an arc lands: they arc away under gravity and
   * burn out, which is the small detail that stops a strike point being a
   * flash and nothing else.
   * @param {THREE.Vector3} at
   * @returns {void}
   */
  function spawnSparks(at) {
    const p = S.sparks;
    const count = Math.round(api.between(ELECTRIC.sparkPerStrike));
    for (let n = 0; n < count; n++) {
      const i = p.next;
      p.next = (p.next + 1) % ELECTRIC.sparkMax;
      const angle = Math.random() * Math.PI * 2;
      const speed = api.between(ELECTRIC.sparkSpeed);
      p.positions[i * 3] = at.x;
      p.positions[i * 3 + 1] = at.y + 0.4;
      p.positions[i * 3 + 2] = at.z;
      p.velocities[i * 3] = Math.cos(angle) * speed * 0.7;
      p.velocities[i * 3 + 1] = speed * (0.5 + Math.random() * 0.8);
      p.velocities[i * 3 + 2] = Math.sin(angle) * speed * 0.7;
      p.life[i] = p.maxLife[i] = api.between(ELECTRIC.sparkLife);
      p.seed[i] = Math.random();
    }
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateSparks(dt) {
    const p = S.sparks;
    let alive = 0;
    for (let i = 0; i < ELECTRIC.sparkMax; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      if (p.life[i] <= 0) {
        p.colours[i * 4 + 3] = 0;
        p.sizes[i] = 0;
        continue;
      }
      alive++;
      p.velocities[i * 3 + 1] -= ELECTRIC.sparkGravity * dt;
      for (let k = 0; k < 3; k++) p.positions[i * 3 + k] += p.velocities[i * 3 + k] * dt;
      const u = 1 - p.life[i] / p.maxLife[i];
      S.scratchColour.copy(ELECTRIC.hotColour).lerp(ELECTRIC.arcColour, u);
      p.colours[i * 4] = S.scratchColour.r;
      p.colours[i * 4 + 1] = S.scratchColour.g;
      p.colours[i * 4 + 2] = S.scratchColour.b;
      p.colours[i * 4 + 3] = 1 - u;
      p.sizes[i] = ELECTRIC.sparkSize * (0.5 + p.seed[i]) * (1 - 0.5 * u);
    }
    if (alive) {
      markPoolDirty(p);
      p.points.material.uniforms.uScale.value = pointScaleFor(Sim.three.renderer, Sim.three.camera);
    }
  }

  return { buildOrbs, updateOrbs, spawnMote, updateMotes, buildShells, writeArcs, spawnSparks, updateSparks };
}
