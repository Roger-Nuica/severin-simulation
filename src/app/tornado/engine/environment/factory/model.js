// @ts-check
import * as THREE from 'three';
import { FACTORY } from './config.js';

/**
 * ===========================================================================
 * SECTION FA.1 — The works
 * ===========================================================================
 * The shed, the yard and its barrels, the scorch it leaves, and the
 * warning markers round it.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see factory.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createFactoryModel(ctx, S, api) {
  const { Sim } = ctx;

  /** @returns {void} */
  function buildShed() {
    S.shed = new THREE.Group();
    S.shed.name = 'factory_shed';
    S.shed.position.set(FACTORY.x, 0, FACTORY.z);

    const wallMat = new THREE.MeshStandardMaterial({ color: FACTORY.wallColour, roughness: 0.95 });
    const roofMat = new THREE.MeshStandardMaterial({ color: FACTORY.roofColour, roughness: 0.9 });
    const chimneyMat = new THREE.MeshStandardMaterial({ color: FACTORY.chimneyColour, roughness: 1 });
    const tankMat = new THREE.MeshStandardMaterial({ color: FACTORY.tankColour, roughness: 0.4, metalness: 0.55 });
    S.materials.push(wallMat, roofMat, chimneyMat, tankMat);

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(FACTORY.shedWidth, FACTORY.shedHeight, FACTORY.shedDepth), wallMat
    );
    body.position.y = FACTORY.shedHeight / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    S.shed.add(body);

    // A shallow pitched roof, as a flattened four-sided cone.
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(FACTORY.shedWidth, FACTORY.shedDepth) * 0.62, FACTORY.roofRise, 4), roofMat
    );
    roof.rotation.y = Math.PI / 4;
    roof.position.y = FACTORY.shedHeight + FACTORY.roofRise / 2;
    roof.scale.z = FACTORY.shedDepth / FACTORY.shedWidth;
    roof.castShadow = true;
    S.shed.add(roof);

    const chimney = new THREE.Mesh(
      new THREE.CylinderGeometry(FACTORY.chimneyRadius * 0.8, FACTORY.chimneyRadius, FACTORY.chimneyHeight, 10),
      chimneyMat
    );
    chimney.position.set(FACTORY.shedWidth * 0.34, FACTORY.chimneyHeight / 2, -FACTORY.shedDepth * 0.25);
    chimney.castShadow = true;
    S.shed.add(chimney);

    // The storage tanks -- what actually goes up at the end -- each wearing a
    // glowing hazard stripe, so the two things that matter about this
    // building are legible before anything happens to it.
    const hazardMat = new THREE.MeshStandardMaterial({
      color: FACTORY.hazardColour,
      emissive: new THREE.Color(FACTORY.hazardColour),
      emissiveIntensity: 0.9,
      roughness: 0.6
    });
    S.materials.push(hazardMat);
    for (const side of [-1, 1]) {
      const tank = new THREE.Mesh(
        new THREE.CylinderGeometry(FACTORY.tankRadius, FACTORY.tankRadius, FACTORY.tankHeight, 14), tankMat
      );
      tank.position.set(-FACTORY.shedWidth * 0.5 - FACTORY.tankRadius - 2, FACTORY.tankHeight / 2, side * 6);
      tank.castShadow = true;
      S.shed.add(tank);

      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(FACTORY.tankRadius * 1.04, FACTORY.tankRadius * 1.04, 0.7, 14, 1, true),
        hazardMat
      );
      band.position.set(tank.position.x, FACTORY.tankHeight * 0.62, tank.position.z);
      S.shed.add(band);
    }

    S.group.add(S.shed);
  }

  /**
   * Everything that says "works" at a glance, and nothing that says it at
   * close range only. All of it is parented to its own group so the whole
   * lot can be switched off on one line when the site goes up.
   * @returns {void}
   */
  function buildMarkers() {
    S.markers = new THREE.Group();
    S.markers.name = 'factory_markers';
    S.markers.position.set(FACTORY.x, 0, FACTORY.z);

    // The gas flare burning off the top of the chimney: the single clearest
    // "this is industry" cue there is at night.
    const flareMat = new THREE.MeshBasicMaterial({
      color: FACTORY.flareColour, transparent: true, opacity: 0.92, depthWrite: false
    });
    S.materials.push(flareMat);
    S.flare = new THREE.Mesh(new THREE.ConeGeometry(FACTORY.flareRadius, FACTORY.flareHeight, 8), flareMat);
    S.flare.position.set(
      FACTORY.shedWidth * 0.34, FACTORY.chimneyHeight + FACTORY.flareHeight * 0.45, -FACTORY.shedDepth * 0.25
    );
    S.markers.add(S.flare);

    // The aviation beacon on the chimney, blinking on its own period.
    const beaconMat = new THREE.MeshStandardMaterial({
      color: FACTORY.beaconColour,
      emissive: new THREE.Color(FACTORY.beaconColour),
      emissiveIntensity: 2,
      roughness: 0.5
    });
    S.materials.push(beaconMat);
    S.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.75, 10, 8), beaconMat);
    S.beacon.position.set(
      FACTORY.shedWidth * 0.34, FACTORY.chimneyHeight - 0.6, -FACTORY.shedDepth * 0.25
    );
    S.markers.add(S.beacon);

    // Floodlight masts around the yard: thin poles with lamp heads that are
    // emissive rather than lit, so four of them cost nothing.
    const mastMat = new THREE.MeshStandardMaterial({ color: 0x4a4f54, roughness: 1 });
    const lampMat = new THREE.MeshStandardMaterial({
      color: FACTORY.floodColour,
      emissive: new THREE.Color(FACTORY.floodColour),
      emissiveIntensity: 1.7,
      roughness: 0.4
    });
    S.materials.push(mastMat, lampMat);
    const yardZ = FACTORY.shedDepth / 2 + 4 + FACTORY.yardDepth / 2;
    for (let i = 0; i < FACTORY.mastCount; i++) {
      const sx = i % 2 === 0 ? -1 : 1;
      const sz = i < 2 ? -1 : 1;
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.36, FACTORY.mastHeight, 6), mastMat
      );
      const mx = sx * (FACTORY.yardWidth / 2 + 3);
      const mz = yardZ + sz * (FACTORY.yardDepth / 2 + 3);
      mast.position.set(mx, FACTORY.mastHeight / 2, mz);
      mast.castShadow = true;
      S.markers.add(mast);

      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 1.1), lampMat);
      lamp.position.set(mx, FACTORY.mastHeight, mz);
      lamp.rotation.y = Math.atan2(-mx, -(mz - yardZ));
      S.markers.add(lamp);
    }

    S.group.add(S.markers);

    // Two real lights, created once and never removed (three.js recompiles
    // every lit material when a scene's light count changes, so adding and
    // removing them per phase would be the expensive way to do this): the
    // flare's warm flicker, and a cold wash over the barrel yard.
    S.flareLight = ctx.systems.lightPool.createLight(
      FACTORY.flareLightColour, FACTORY.flareLight, FACTORY.flareDistance, 2
    );
    S.flareLight.name = 'factory_flare_light';
    S.flareLight.position.set(
      FACTORY.x + FACTORY.shedWidth * 0.34,
      FACTORY.chimneyHeight + FACTORY.flareHeight * 0.4,
      FACTORY.z - FACTORY.shedDepth * 0.25
    );
    Sim.three.scene.add(S.flareLight);

    S.floodLight = ctx.systems.lightPool.createLight(
      FACTORY.floodColour, FACTORY.floodLight, FACTORY.floodDistance, 2
    );
    S.floodLight.name = 'factory_flood_light';
    S.floodLight.position.set(FACTORY.x, FACTORY.mastHeight, FACTORY.z + yardZ);
    Sim.three.scene.add(S.floodLight);
  }

  /**
   * The flare's flicker and the beacon's blink. Cheap enough to run every
   * frame; stops dead once the works is gone.
   * @param {number} dt
   * @returns {void}
   */
  function updateMarkers(dt) {
    if (!S.markers || !S.markers.visible) return;
    S.state.markerPhase += dt;
    const t = S.state.markerPhase;
    // Two out-of-phase sines rather than random(): a flare gutters, it does
    // not strobe.
    const flicker = 0.78 + 0.14 * Math.sin(t * 7.3) + 0.08 * Math.sin(t * 17.1 + 1.3);
    S.flare.scale.set(0.85 + flicker * 0.3, flicker, 0.85 + flicker * 0.3);
    S.flare.material.opacity = 0.7 + flicker * 0.28;
    if (S.flareLight) S.flareLight.intensity = FACTORY.flareLight * flicker;

    const blink = (t % FACTORY.beaconPeriod) / FACTORY.beaconPeriod;
    S.beacon.material.emissiveIntensity = blink < 0.22 ? 3.4 : 0.35;
  }

  /**
   * A permanent burn over the site, in the manner of the meteor craters: once
   * written it is never faded or retired.
   * @returns {THREE.Texture}
   */
  function createScorchTexture() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const c2d = canvas.getContext('2d');
    const c = size / 2;
    const g = c2d.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(8, 7, 6, 0.95)');
    g.addColorStop(0.45, 'rgba(26, 20, 14, 0.78)');
    g.addColorStop(0.75, 'rgba(52, 40, 24, 0.4)');
    g.addColorStop(1, 'rgba(60, 48, 30, 0)');
    c2d.fillStyle = g;
    c2d.fillRect(0, 0, size, size);
    // Soot fingers reaching out of the centre, so the edge is not a circle.
    c2d.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const len = c * (0.5 + Math.random() * 0.5);
      c2d.strokeStyle = `rgba(10, 8, 6, ${(0.2 + Math.random() * 0.35).toFixed(2)})`;
      c2d.lineWidth = 2 + Math.random() * 6;
      c2d.beginPath();
      c2d.moveTo(c, c);
      c2d.lineTo(c + Math.cos(a) * len, c + Math.sin(a) * len);
      c2d.stroke();
    }
    return new THREE.CanvasTexture(canvas);
  }

  /**
   * Lays the yard out in rows behind the shed.
   * @returns {void}
   */
  function buildYard() {
    S.barrels = [];
    const geo = new THREE.CylinderGeometry(
      FACTORY.barrelRadius, FACTORY.barrelRadius, FACTORY.barrelHeight, 8
    );
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.2 });
    S.materials.push(mat);
    S.barrelMesh = new THREE.InstancedMesh(geo, mat, FACTORY.barrels);
    S.barrelMesh.name = 'factory_barrels';
    S.barrelMesh.castShadow = true;
    S.barrelMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const perRow = 10;
    const rows = Math.ceil(FACTORY.barrels / perRow);
    const colour = new THREE.Color();
    for (let i = 0; i < FACTORY.barrels; i++) {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      const x = FACTORY.x - FACTORY.yardWidth / 2 + (col / (perRow - 1)) * FACTORY.yardWidth
        + (Math.random() - 0.5) * 0.7;
      const z = FACTORY.z + FACTORY.shedDepth / 2 + 4 + (row / Math.max(1, rows - 1)) * FACTORY.yardDepth
        + (Math.random() - 0.5) * 0.7;
      const colourIndex = Math.floor(Math.random() * FACTORY.barrelColours.length);
      S.barrels.push({
        pos: new THREE.Vector3(x, FACTORY.barrelHeight / 2, z),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(0, Math.random() * Math.PI * 2, 0),
        spin: new THREE.Vector3(),
        state: 'stacked',
        colour: colourIndex
      });
      colour.setHex(FACTORY.barrelColours[colourIndex]);
      S.barrelMesh.setColorAt(i, colour);
    }
    S.barrelMesh.instanceColor.needsUpdate = true;
    S.group.add(S.barrelMesh);
    writeBarrels();
  }

  /** @returns {void} */
  function writeBarrels() {
    for (let i = 0; i < S.barrels.length; i++) {
      const b = S.barrels[i];
      if (b.state === 'gone') {
        S.dummy.scale.setScalar(0);
        S.dummy.position.set(0, -50, 0);
        S.dummy.rotation.set(0, 0, 0);
      } else {
        S.dummy.scale.setScalar(1);
        S.dummy.position.copy(b.pos);
        S.dummy.rotation.copy(b.rot);
      }
      S.dummy.updateMatrix();
      S.barrelMesh.setMatrixAt(i, S.dummy.matrix);
    }
    S.barrelMesh.instanceMatrix.needsUpdate = true;
  }

  /** @returns {void} */
  function disposeYard() {
    if (!S.barrelMesh) return;
    S.group.remove(S.barrelMesh);
    S.barrelMesh.geometry.dispose();
    S.barrelMesh = null;
  }

  return { buildShed, buildMarkers, updateMarkers, createScorchTexture, buildYard, writeBarrels, disposeYard };
}
