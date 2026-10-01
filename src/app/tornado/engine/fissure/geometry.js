import * as THREE from 'three';
import { FISSURE, RIFT, CALDERA, LAVA_VERTEX, LAVA_FRAGMENT, LAKE_FRAGMENT, between, lerpRange, walkFissure, cumulativeLengths, buildStripGeometry } from './config.js';

/**
 * ===========================================================================
 * SECTION FS.1 — Cracks and calderas
 * ===========================================================================
 * The glowing lava material, the calderas, the vents and the fissures
 * themselves, and taking a caldera down again.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see fissure.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createFissureGeometry(ctx, S, api) {
  /**
   * @param {FloatUniform} lava
   * @param {FloatUniform} reveal
   * @param {boolean} vent
   * @returns {THREE.ShaderMaterial}
   */
  function createLavaMaterial(lava, reveal, vent) {
    return new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: S.shared.uTime,
        uGlow: S.shared.uGlow,
        uOpacity: S.shared.uOpacity,
        uLava: lava,
        uReveal: reveal,
        uVent: { value: vent ? 1 : 0 }
      },
      vertexShader: LAVA_VERTEX,
      fragmentShader: LAVA_FRAGMENT,
      transparent: true,
      depthWrite: vent,
      side: THREE.DoubleSide,
      fog: true,
      // Flat strips sit a hair above the roads; this keeps them winning the
      // depth test at a distance too.
      polygonOffset: !vent,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
  }

  /**
   * The crater at the epicentre: a raised crusted rim with a lake of lava
   * boiling inside it.
   * @param {number} cx
   * @param {number} cz
   * @param {number} severity 0..1
   * @returns {Caldera}
   */
  function createCaldera(cx, cz, severity) {
    const radius = lerpRange(CALDERA.radius, severity);
    const rimHeight = lerpRange(CALDERA.rimHeight, severity);
    const lakeR = radius * CALDERA.lakeFraction;

    const root = new THREE.Group();
    root.position.set(cx, 0, cz);
    // Opens by growing out of the ground rather than appearing whole.
    root.scale.setScalar(0.001);
    S.group.add(root);

    // Its own glow, because it outlives the eruption that made it.
    const glow = { value: 0 };
    const opacity = { value: 1 };

    // The rim: a lathe turned from a profile that climbs from the lake out to
    // a crest and falls away outside, so it reads as ground heaved up rather
    // than a wall dropped on the map.
    const profile = [
      new THREE.Vector2(lakeR * 0.98, CALDERA.lakeY),
      new THREE.Vector2(lakeR * 1.05, rimHeight * 0.35),
      new THREE.Vector2(radius * 0.86, rimHeight),
      new THREE.Vector2(radius * 0.99, rimHeight * 0.45),
      new THREE.Vector2(radius * 1.14, 0.02)
    ];
    const rimMat = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: S.shared.uTime,
        uGlow: glow,
        uOpacity: opacity,
        uLava: { value: 1 },
        uReveal: { value: 1 },
        uVent: { value: 1 }
      },
      vertexShader: LAVA_VERTEX,
      fragmentShader: LAVA_FRAGMENT,
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      fog: true
    });
    const rim = new THREE.Mesh(new THREE.LatheGeometry(profile, CALDERA.segments), rimMat);
    rim.castShadow = true;
    root.add(rim);

    const lakeMat = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: S.shared.uTime,
        uGlow: glow,
        uOpacity: opacity
      },
      vertexShader: LAVA_VERTEX,
      fragmentShader: LAKE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true
    });
    const lake = new THREE.Mesh(new THREE.CircleGeometry(lakeR, CALDERA.segments), lakeMat);
    lake.rotation.x = -Math.PI / 2;
    lake.position.y = CALDERA.lakeY;
    root.add(lake);

    /** @type {Caldera} */
    const caldera = {
      root, rim, lake, glow, opacity, x: cx, z: cz, radius, lakeR,
      rise: 0, quenched: false,
      spot: { x: cx, z: cz, radius: lakeR, level: 0, vent: null, caldera: null }
    };
    caldera.spot.caldera = caldera;
    return caldera;
  }

  /**
   * @param {number} x
   * @param {number} z
   * @param {number} radius
   * @param {Fissure|null} fissure
   * @param {number} along
   * @param {FloatUniform} lava
   * @returns {Vent}
   */
  function createVent(x, z, radius, fissure, along, lava) {
    const mesh = new THREE.Mesh(S.ventGeometry, createLavaMaterial(lava, { value: 1 }, true));
    mesh.position.set(x, 0.02, z);
    mesh.scale.set(radius, 0.001, radius);
    mesh.visible = false;
    S.group.add(mesh);
    /** @type {Vent} */
    const vent = {
      mesh, fissure, along, x, z, radius,
      active: false, quenched: false, rise: 0, level: 0, seed: Math.random(), lava,
      spot: { x, z, radius, level: 0, vent: null, caldera: null }
    };
    // The entry it publishes to hotSpots() points back at it, so quench() can
    // put out whatever it was handed without asking which kind it is.
    vent.spot.vent = vent;
    return vent;
  }

  /**
   * @param {number} cx
   * @param {number} cz
   * @param {number} heading
   * @param {number} severity
   * @returns {Fissure}
   */
  function createFissure(cx, cz, heading, severity, rift = false) {
    const length = rift
      ? lerpRange(RIFT.armLength, severity)
      : lerpRange(FISSURE.length, severity) * (0.7 + Math.random() * 0.45);
    const width = rift
      ? lerpRange(RIFT.width, severity)
      : lerpRange(FISSURE.width, severity) * (0.8 + Math.random() * 0.35);
    const points = rift
      ? walkFissure(cx, cz, heading, length, RIFT.maxTurn, RIFT.straighten)
      : walkFissure(cx, cz, heading, length);
    const cumulative = cumulativeLengths(points);
    const reveal = { value: 0 };
    const lava = { value: 0 };
    const mesh = new THREE.Mesh(buildStripGeometry(points, cumulative, width), createLavaMaterial(lava, reveal, false));
    mesh.visible = false;
    S.group.add(mesh);
    return {
      points, cumulative, total: cumulative[cumulative.length - 1], width, rift,
      growthProgress: 0,
      growSeconds: between(rift ? RIFT.growSeconds : FISSURE.growSeconds),
      // The rift's two arms start together and immediately: they are one tear
      // opening, not two cracks that happen to line up.
      delay: rift ? 0 : Math.random() * FISSURE.stagger,
      opened: false, reveal, lava, mesh
    };
  }

  /**
   * @param {Caldera} caldera
   * @returns {void}
   */
  function disposeCaldera(caldera) {
    S.group.remove(caldera.root);
    caldera.rim.geometry.dispose();
    caldera.rim.material.dispose();
    caldera.lake.geometry.dispose();
    caldera.lake.material.dispose();
  }

  /**
   * Opens the newest crater and keeps its lake lit while the eruption lasts.
   * Older ones are left cold: they are scenery now.
   * @param {number} dt
   * @param {number} glow
   * @returns {void}
   */
  function updateCalderas(dt, glow) {
    for (let i = 0; i < S.calderas.length; i++) {
      const caldera = S.calderas[i];
      const newest = i === S.calderas.length - 1;
      if (caldera.rise < 1) {
        caldera.rise = Math.min(1, caldera.rise + dt / CALDERA.growSeconds);
        caldera.root.scale.setScalar(Math.max(0.001, THREE.MathUtils.smoothstep(caldera.rise, 0, 1)));
      }
      // Only the live eruption's crater is molten; the rest have set. One the
      // flood has reached is finished whatever the eruption is doing, or the
      // strength envelope would light the lake again behind the water.
      if (caldera.quenched) caldera.glow.value = 0;
      else if (newest && S.fissures.length) caldera.glow.value = glow * caldera.rise;
      else caldera.glow.value = Math.max(0, caldera.glow.value - dt / FISSURE.coolSeconds);
    }
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateGrowth(dt) {
    for (const fissure of S.fissures) {
      if (fissure.delay > 0) {
        fissure.delay -= dt;
        continue;
      }
      if (fissure.growthProgress < 1) {
        fissure.mesh.visible = true;
        fissure.growthProgress = Math.min(1, fissure.growthProgress + dt / fissure.growSeconds);
        // Eased out: the tear rips fast from the epicentre and slows as it runs out.
        fissure.reveal.value = 1 - Math.pow(1 - fissure.growthProgress, 3);
        if (fissure.growthProgress >= 1) api.onFissureOpened(fissure);
      } else {
        fissure.lava.value = Math.min(1, fissure.lava.value + dt / FISSURE.lavaSeconds);
      }
    }
  }

  return { createLavaMaterial, createCaldera, createVent, createFissure, disposeCaldera, updateCalderas, updateGrowth };
}
