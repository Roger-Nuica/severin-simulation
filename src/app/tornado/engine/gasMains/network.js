// @ts-check
import * as THREE from 'three';
import { GAS, SEAM_VERTEX, SEAM_FRAGMENT } from './config.js';
import { BLAST_SIZE } from '../player/energy.js';
import { hitRogerAt } from '../explosives.js';
/** @typedef {import('./config.js').Segment} Segment */
/** @typedef {import('./config.js').Main} Main */

/**
 * ===========================================================================
 * SECTION GM.1 — The network and its ruptures
 * ===========================================================================
 * The pipes under the streets and their seams, a rupture and its manhole
 * cover, and fire passing from one segment to the next.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see gasMains.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createGasNetwork(ctx, S, api) {
  const { Sim } = ctx;

  /**
   * @param {number[]} range
   * @returns {number}
   */
  function between(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  /**
   * Lays out the network: six mains of equal-length segments, then the
   * junction table that lets the flame turn a corner.
   * @returns {void}
   */
  function buildNetwork() {
    const count = Math.round((GAS.halfLength * 2) / GAS.segment);
    const centreOf = (i) => -GAS.halfLength + (i + 0.5) * GAS.segment;

    const specs = [
      ...GAS.zLines.map(line => ({ axis: /** @type {'x'} */ ('x'), line })),
      ...GAS.xLines.map(line => ({ axis: /** @type {'z'} */ ('z'), line }))
    ];
    for (const spec of specs) {
      /** @type {Main} */
      const main = { axis: spec.axis, line: spec.line, segments: [], crossings: [], hazard: null };
      for (let i = 0; i < count; i++) {
        const along = centreOf(i);
        /** @type {Segment} */
        const segment = {
          main,
          index: i,
          x: spec.axis === 'x' ? along : spec.line,
          z: spec.axis === 'x' ? spec.line : along,
          state: 'sealed',
          timer: 0,
          spread: 0,
          passed: false,
          // Covers spaced along the street, so the vertical columns of flame
          // are punctuation rather than a continuous wall.
          manhole: i % GAS.manholeEvery === 2,
          pressure: 0,
          heat: 0,
          scar: 0,
          burn: 0
        };
        main.segments.push(segment);
        S.segments.push(segment);
        main.crossings.push([]);
      }
      S.mains.push(main);
    }

    // Junctions. Every x-main crosses every z-main exactly once, at
    // (zMain.line is the x-main's z, xMain.line is the z-main's x), and both
    // sides get a pointer to the other so the flame can turn either way.
    for (const along of S.mains.filter(m => m.axis === 'x')) {
      for (const across of S.mains.filter(m => m.axis === 'z')) {
        const i = indexAt(along, across.line);
        const j = indexAt(across, along.line);
        if (i < 0 || j < 0) continue;
        along.crossings[i].push(across.segments[j]);
        across.crossings[j].push(along.segments[i]);
        // A crossroads always has a cover: it is where the fire visibly
        // makes a decision, so it should be the loudest point on the run.
        along.segments[i].manhole = true;
        across.segments[j].manhole = true;
      }
    }
  }

  /**
   * @param {Main} main
   * @param {number} along world coordinate on the main's own axis
   * @returns {number} segment index, or -1 if it is off the end
   */
  function indexAt(main, along) {
    const i = Math.floor((along + GAS.halfLength) / GAS.segment);
    return i >= 0 && i < main.segments.length ? i : -1;
  }

  /** @returns {void} */
  function buildSeams() {
    // A unit quad laid flat, so an instance only has to position, turn and
    // stretch it. Its uv survives the rotation, which is what the crack
    // shader reads.
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);

    const heat = new Float32Array(S.segments.length);
    const scar = new Float32Array(S.segments.length);
    const seed = new Float32Array(S.segments.length);
    for (let i = 0; i < S.segments.length; i++) seed[i] = Math.random();
    S.heatAttr = new THREE.InstancedBufferAttribute(heat, 1).setUsage(THREE.DynamicDrawUsage);
    S.scarAttr = new THREE.InstancedBufferAttribute(scar, 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aHeat', S.heatAttr);
    geometry.setAttribute('aScar', S.scarAttr);
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));

    S.seamMaterial = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: { value: 0 },
        uHot: { value: new THREE.Color(GAS.hot) },
        uChar: { value: new THREE.Color(0.055, 0.045, 0.04) }
      },
      vertexShader: SEAM_VERTEX,
      fragmentShader: SEAM_FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: true
    });

    S.seams = new THREE.InstancedMesh(geometry, S.seamMaterial, S.segments.length);
    S.seams.name = 'gas_seams';
    S.seams.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    // Flat on the ground and spread over the whole town, so three.js's own
    // bounds for the instanced mesh are useless and its culling would drop
    // the lot whenever the group's origin left the frustum.
    S.seams.frustumCulled = false;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    for (let i = 0; i < S.segments.length; i++) {
      const segment = S.segments[i];
      position.set(segment.x, GAS.y, segment.z);
      quaternion.setFromAxisAngle(
        new THREE.Vector3(0, 1, 0), segment.main.axis === 'x' ? 0 : Math.PI / 2
      );
      scale.set(GAS.segment, 1, GAS.seamWidth);
      S.seams.setMatrixAt(i, matrix.compose(position, quaternion, scale));
    }
    S.seams.instanceMatrix.needsUpdate = true;
    S.group.add(S.seams);
  }

  /** @returns {number} */
  function burningCount() {
    let n = 0;
    for (const segment of S.segments) if (segment.state === 'burning') n++;
    return n;
  }

  // ---------------------------------------------------------------------
  // Rupture and propagation
  // ---------------------------------------------------------------------

  /**
   * Puts a sealed segment into the state a rupture leaves it in: gas out and
   * a short fuse, or straight to fire if whatever opened it was already
   * burning (lava, a fireball, an arc).
   * @param {Segment} segment
   * @param {boolean} ignite
   * @returns {void}
   */
  function openSegment(segment, ignite) {
    if (segment.state !== 'sealed') return;
    // A fresh break is a fresh front, so it starts on full pressure however
    // far some other fire has already run.
    segment.pressure = GAS.pressure;
    if (ignite) {
      lightSegment(segment, GAS.pressure);
      return;
    }
    segment.state = 'venting';
    segment.timer = between(GAS.ventSeconds);
  }

  /**
   * Sets a segment alight and does everything that follows from a strip of
   * street becoming a trench of fire. Reuses the routes the rest of the
   * simulation already has, so nothing downstream needs to know the mains
   * exist.
   * @param {Segment} segment
   * @param {number} pressure how much run the front reaching it has left
   * @returns {void}
   */
  function lightSegment(segment, pressure) {
    if (segment.state === 'burning' || segment.state === 'spent') return;
    if (pressure <= 0) return;
    segment.pressure = pressure;
    segment.state = 'burning';
    segment.burn = between(GAS.burnSeconds);
    segment.timer = segment.burn;
    segment.spread = GAS.spreadInterval;
    segment.passed = false;

    const at = S.scratchVec.set(segment.x, 1, segment.z);
    ctx.systems.buildingFire.igniteNear(segment.x, segment.z, GAS.igniteRadius);
    ctx.systems.powerLines.faultAt(segment.x, segment.z, GAS.poleFaultRadius);
    ctx.systems.damage.addDamageScore(GAS.segmentScore);

    const { shockBuilding } = ctx.systems.damage;
    if (shockBuilding && ctx.Environment) {
      for (const building of ctx.Environment.buildings) {
        const p = building.mesh.position;
        if (Math.hypot(p.x - segment.x, p.z - segment.z) > GAS.igniteRadius) continue;
        shockBuilding(building, segment.manhole ? GAS.manholeShock : GAS.buildingShock, at);
      }
    }

    // Only the covers get the fireball, the shake and the kick. A segment
    // lighting is the front advancing; a cover going off is an event.
    if (segment.manhole) blowCover(segment);
  }

  /**
   * A manhole cover leaving the road: a fireball, a jolt, and anything loose
   * standing over it thrown into the air.
   * @param {Segment} segment
   * @returns {void}
   */
  function blowCover(segment) {
    const at = new THREE.Vector3(segment.x, 1.2, segment.z);
    ctx.systems.explosions.spawnImpactBurst(at, GAS.manholeBlast);
    ctx.systems.gamefeel.event('gas', at);
    ctx.events.emit('explosion', { x: at.x, z: at.z, size: BLAST_SIZE.manhole, source: segment });
    // The ground beside it is torn up too (the earthquake's dust pool).
    if (ctx.systems.earthquake) ctx.systems.earthquake.kickDust(segment.x, segment.z, 2, 1.8);
    const { damageFromImpact } = ctx.systems.damage;
    // A copy: a person killed here is spliced out of Sim.objects on the spot.
    for (const obj of Sim.objects.slice()) {
      if (obj.type === 'building' || obj.rooted) continue;
      if (obj.captureState && obj.captureState !== 'grounded') continue;
      const pos = obj.pooled ? obj.position : (obj.mesh && obj.mesh.position);
      if (!pos) continue;
      const d = Math.hypot(pos.x - segment.x, pos.z - segment.z);
      if (d > GAS.manholeRadius) continue;
      const falloff = 1 - d / GAS.manholeRadius;
      obj.velocity.y += GAS.manholeLift * falloff;
      obj.velocity.x += (pos.x - segment.x) * 0.9;
      obj.velocity.z += (pos.z - segment.z) * 0.9;
      obj.angularVelocity.x += (Math.random() - 0.5) * 8;
      obj.angularVelocity.z += (Math.random() - 0.5) * 8;
      // Right on top of it is not survivable.
      if (obj.type === 'person' && d < GAS.manholeKill && damageFromImpact) {
        damageFromImpact(obj, at, 5000);
        continue;
      }
      // Anyone else standing over it is no longer walking anywhere.
      if (obj.type === 'person' && obj.motion && obj.motion.active) {
        obj.motion.active = false;
        obj.motion.dropped = true;
        ctx.systems.speechBubbles.exclaim(obj);
      }
      if (obj.type === 'car' && obj.damageState === 'intact') {
        obj.damageState = 'tipped';
        obj.mesh.userData.parked = false;
      }
    }
  }

  /**
   * The entry point for everything that can open a main: a fissure tearing
   * across a street, a crater, a blast, an arc, the panel's button.
   * @param {number} x
   * @param {number} z
   * @param {number} radius
   * @param {{ignite?: boolean, announce?: boolean}} [options] `ignite` when
   *   whatever opened it was already on fire, so it skips the hiss
   * @returns {number} how many segments were opened
   */
  function ruptureAt(x, z, radius, options = {}) {
    if (!S.segments.length) return 0;
    // The co-op guest never opens a main of its own (R-053): the host's arrive as `fires` rows.
    if (ctx.systems.net && ctx.systems.net.isPeerView()) return 0;
    const ignite = options.ignite !== false;
    let opened = 0;
    for (const segment of S.segments) {
      if (segment.state !== 'sealed') continue;
      if (Math.hypot(segment.x - x, segment.z - z) > radius) continue;
      openSegment(segment, ignite);
      opened++;
    }
    if (opened) {
      ctx.systems.damage.addDamageScore(GAS.ruptureScore);
      if (options.announce) {
        api.showBanner('GAS MAIN EXPLOSION!', 'The street is on fire end to end');
      }
    }
    return opened;
  }

  /**
   * Opens a main somewhere along its length, from the panel. Deliberately
   * away from the ends, so the front has room to run both ways and to reach
   * a junction and turn.
   * @returns {void}
   */
  function ruptureRandom() {
    if (ctx.systems.net && ctx.systems.net.isPeerView()) return;
    // The middle two thirds of a main, still sealed.
    const middle = (main) => {
      const count = main.segments.length;
      const from = Math.floor(count / 6);
      return main.segments.slice(from, count - from).filter(s => s.state === 'sealed');
    };
    let candidates = S.mains.filter(main => middle(main).length > 0);
    // Every main already burnt out: the network is repressurised so the button
    // keeps working. The scorched seams stay -- a street can burn twice.
    if (!candidates.length) {
      for (const segment of S.segments) {
        if (segment.state === 'spent') segment.state = 'sealed';
      }
      candidates = S.mains.filter(main => middle(main).length > 0);
    }
    // Still nothing means every main is burning right now.
    if (!candidates.length) return;
    const main = candidates[Math.floor(Math.random() * candidates.length)];
    const sealed = middle(main);
    const segment = sealed[Math.floor(Math.random() * sealed.length)];
    ruptureAt(segment.x, segment.z, GAS.segment * 1.5, { ignite: true, announce: true });
    detonateRupture(segment);
  }

  /**
   * The panel's rupture is an explosion first and a fire second: the street
   * blows open under a fireball the size of the tanker's old one, everything
   * near it is shaken or thrown, and then the flame front runs off both ways.
   * @param {Segment} segment
   * @returns {void}
   */
  function detonateRupture(segment) {
    const at = new THREE.Vector3(segment.x, 1.5, segment.z);
    ctx.systems.explosions.spawnImpactBurst(at, GAS.ruptureBlast);
    for (let i = 0; i < 4; i++) {
      const along = (i - 1.5) * GAS.segment * 1.6;
      const offset = segment.main.axis === 'x'
        ? new THREE.Vector3(segment.x + along, 1.5, segment.z)
        : new THREE.Vector3(segment.x, 1.5, segment.z + along);
      ctx.systems.explosions.spawnImpactBurst(offset, GAS.ruptureBlast * 0.4);
    }
    ctx.systems.cues.playLargeExplosion({ priority: true });
    ctx.systems.lightning.flashScreen(at, 0.85, '#ffc98a');
    ctx.systems.gamefeel.event('tanker', at);
    ctx.events.emit('explosion', { x: at.x, z: at.z, size: BLAST_SIZE.gasMain, source: segment.main });
    if (ctx.systems.earthquake) ctx.systems.earthquake.kickDust(segment.x, segment.z, 6, 2.6);
    const { shockBuilding } = ctx.systems.damage;
    if (shockBuilding && ctx.Environment) {
      for (const building of ctx.Environment.buildings) {
        const p = building.mesh.position;
        const d = Math.hypot(p.x - segment.x, p.z - segment.z);
        if (d > GAS.ruptureRadius) continue;
        shockBuilding(building, 5.5 * (1 - d / GAS.ruptureRadius), at);
      }
    }
    ctx.systems.buildingFire.igniteNear(segment.x, segment.z, GAS.ruptureRadius * 0.7);
    // Roger inside the fireball (the same reach as the fires it starts).
    hitRogerAt(ctx, segment.x, segment.z, GAS.ruptureRadius * 0.7);
  }

  /**
   * Hands the flame on: along the main in both directions, and across at a
   * junction. This is the whole propagation model -- there is no front
   * object, only segments that pass it on once.
   * @param {Segment} segment
   * @returns {void}
   */
  function passFlame(segment) {
    segment.passed = true;
    const onward = segment.pressure - 1;
    if (onward <= 0) return;
    const row = segment.main.segments;
    for (const next of [row[segment.index - 1], row[segment.index + 1]]) {
      if (next) lightSegment(next, onward);
    }
    // Turning a corner costs most of what is left, so a crossing street gets a
    // short run rather than a second full one.
    const turned = Math.floor(onward * GAS.junctionLoss);
    for (const across of segment.main.crossings[segment.index]) lightSegment(across, turned);
  }

  return { between, buildNetwork, indexAt, buildSeams, burningCount, openSegment, lightSegment, blowCover, ruptureAt, ruptureRandom, detonateRupture, passFlame };
}
