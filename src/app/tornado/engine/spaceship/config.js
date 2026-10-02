// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION SS.0 — Landing Support: tunables, and the saucer
 * ===========================================================================
 * Every number Landing Support is tuned by (T: the Samurai Support call-in
 * and the Rocket Strike, engine/spaceship.js), and the saucer's model
 * (buildSaucer, used by the aliens' ships and the mothership too).
 */

// The two options' shared rules: easy to tweak, on request.
export const SUPPORT = {
  cooldown: 60,            // seconds before an option can be used again (each its own)
  stay: 120,               // seconds the samurai stay at most, from the last one down the ramp
  clearGrace: 6,           // seconds with no hostile in the ring after which the squad stands down early
  coverage: 100,           // metres: the samurai's guard radius round the drop point (ring A)
  markerBound: 280,        // how far from the centre the marker may go
  watchHold: 7             // seconds the camera holds on the drop zone after its 1 s glide
};

export const SHIP = {
  duration: 6,             // seconds from the call to the ship hanging over the spot
  brakeAt: 4,              // seconds into the drop the ease-out takes over
  // Of the drop's first phase: this much of its motion is linear, the rest
  // a gentle acceleration, so the fall has some weight to it.
  linearShare: 0.6,
  // Start height as a multiple of the tallest building in town, clamped.
  startMultiple: 12,
  startHeight: [220, 500],
  // The run-in: the ship starts this far back from its spot and closes it
  // as it falls.
  drift: 55,
  radius: 15,              // hull
  // What its arrival does: nothing is hurt (it is ours), but the ground
  // knows about it -- dust, two shock rings, a shake.
  arrivalShake: 0.6,
  bannerSeconds: 3,
  lightPeak: 300,
  lightDistance: 110,
  // Leaving: up and away once the ramp is empty.
  leaveSeconds: 4.5,
  leaveHeight: 420,
  // The colours: black lacquer and gold, a crimson glow underneath.
  hull: 0x1c1416,
  glow: new THREE.Color(2.4, 0.5, 0.25),
  rim: new THREE.Color(1.6, 1.15, 0.4)
};

export const THRUST = {
  max: 1400,
  rate: [30, 900],         // particles/sec, cruising to full retro burn
  life: [0.22, 0.5],
  speed: [34, 58],
  size: 2.6,
  nozzles: 6,
  nozzleRadius: 0.45,      // of the hull radius
  hot: new THREE.Color(1.6, 1.9, 2.4),
  cool: new THREE.Color(0.1, 0.55, 1.2)
};

// The shadow-only layer the hull lives on while the camera is inside it.
export const SHIP_LAYER = 1;
export const HULL_COLOUR = 0x8b929c;
export const GLOW_COLOUR = new THREE.Color(0x5fd4ff);

/**
 * A greybox saucer: a low-poly lathed hull, a glass dome, a glowing ring
 * and disc underneath, running lights round the rim and four landing legs
 * that drop out during the braking burn. No asset pipeline exists in the
 * project for imported models -- everything in the scene is built from
 * primitives -- so this is too. Exported for the alien ship
 * (engine/aliens.js), which is the same saucer.
 * @returns {{group: THREE.Group, glow: THREE.Material[], rim: THREE.Material, legs: THREE.Object3D[]}}
 */
export function buildSaucer() {
  const R = SHIP.radius;
  const shipGroup = new THREE.Group();
  shipGroup.name = 'spaceship';

  // Profile from the belly up to the top of the dome seat, lathed round the
  // vertical axis. Few segments and flat shading: it should read as a
  // greybox, not as an attempt at a finished model.
  const profile = [
    new THREE.Vector2(0, 1.2),
    new THREE.Vector2(R * 0.55, 1.35),
    new THREE.Vector2(R * 0.9, 2.5),
    new THREE.Vector2(R, 3.1),
    new THREE.Vector2(R * 0.9, 3.8),
    new THREE.Vector2(R * 0.5, 4.9),
    new THREE.Vector2(0, 5.1)
  ];
  const hullMat = new THREE.MeshStandardMaterial({
    color: HULL_COLOUR, metalness: 0.65, roughness: 0.38, flatShading: true
  });
  const hull = new THREE.Mesh(new THREE.LatheGeometry(profile, 16), hullMat);
  hull.name = 'spaceship_hull';
  hull.castShadow = true;
  hull.receiveShadow = true;
  shipGroup.add(hull);

  const domeMat = new THREE.MeshStandardMaterial({
    color: 0x1d3a4a, emissive: 0x2a8fbf, emissiveIntensity: 0.45,
    metalness: 0.2, roughness: 0.15, transparent: true, opacity: 0.88, flatShading: true
  });
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(R * 0.33, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), domeMat
  );
  dome.name = 'spaceship_dome';
  dome.position.y = 4.85;
  dome.castShadow = true;
  shipGroup.add(dome);

  // The underside glow. Basic materials, so the colour written is the
  // colour seen, and scaled per frame for the burn.
  const ringMat = new THREE.MeshBasicMaterial({ color: GLOW_COLOUR.clone() });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.55, 0.55, 6, 28), ringMat);
  ring.name = 'spaceship_glow_ring';
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 1.3;
  shipGroup.add(ring);
  const discMat = new THREE.MeshBasicMaterial({
    color: GLOW_COLOUR.clone(), transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R * 0.42, 20), discMat);
  disc.name = 'spaceship_glow_disc';
  disc.rotation.x = Math.PI / 2;
  disc.position.y = 1.18;
  shipGroup.add(disc);

  const rimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd27a) });
  const rimGeo = new THREE.BoxGeometry(0.7, 0.35, 0.7);
  const lights = 10;
  for (let i = 0; i < lights; i++) {
    const a = (i / lights) * Math.PI * 2;
    const lamp = new THREE.Mesh(rimGeo, rimMat);
    lamp.position.set(Math.cos(a) * R * 1.0, 3.1, Math.sin(a) * R * 1.0);
    lamp.name = 'spaceship_rim_light';
    shipGroup.add(lamp);
  }

  const legMat = new THREE.MeshStandardMaterial({ color: 0x5a6068, metalness: 0.5, roughness: 0.5 });
  const legGeo = new THREE.CylinderGeometry(0.35, 0.5, 2.2, 6);
  const padGeo = new THREE.CylinderGeometry(1.1, 1.3, 0.3, 8);
  const legs = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.Group();
    leg.name = 'spaceship_leg';
    const strut = new THREE.Mesh(legGeo, legMat);
    strut.castShadow = true;
    const pad = new THREE.Mesh(padGeo, legMat);
    pad.position.y = -1.05;
    pad.castShadow = true;
    leg.add(strut, pad);
    leg.position.set(Math.cos(a) * R * 0.62, 2.3, Math.sin(a) * R * 0.62);
    shipGroup.add(leg);
    legs.push(leg);
  }

  return { group: shipGroup, glow: [ringMat, discMat], rim: rimMat, legs };
}

// Shared types (JSDoc), imported by the files that use them.
/** @typedef {{group: THREE.Group, glow: THREE.Material[], rim: THREE.Material, legs: THREE.Object3D[]}} Ship */
