// @ts-check
import * as THREE from 'three';
import { bannerHost } from '../utils/banners.js';

/**
 * ===========================================================================
 * SECTION AI — Sinkholes
 * ===========================================================================
 * The only thing here that destroys downward.
 *
 * Everything else in this simulation is lateral. A blast pushes outward, a
 * flood crosses, a funnel picks things up and puts them somewhere else, a
 * building falls over. All of it leaves wreckage you can still see. A
 * sinkhole is the opposite: slow, quiet, and permanent. What goes into one is
 * gone -- not thrown, not burning, not lying in the road. Gone.
 *
 * It opens under a quake, and where it opens is the interesting part. Given
 * the choice it opens **under an open evacuation point** (engine/evacuation.js),
 * because that is where the people are: twenty of them standing in one ring
 * waiting for a bus is the densest crowd that will ever exist in this town,
 * and the player made it by opening the point. Nothing else in the game
 * punishes you for the thing you did to save people.
 *
 * Mechanically it is a growing disc with a rim, a floor that falls away, and
 * a swallow test run every frame on everything standing over it. Buildings
 * caught by the edge are undermined and go in; anything loose slides toward
 * the middle and drops out of the world.
 */

const SINKHOLE = {
  radius: [17, 30],
  growSeconds: 5.5,
  // How deep it reads. Nothing is ever drawn down there -- the floor is a
  // black disc and the rim hides the join -- so this is only how far a thing
  // falls before it is taken out of the simulation.
  depth: 26,
  rimHeight: [1.1, 2.2],
  segments: 44,
  // Above the roads and the grid but below a meteor crater, so a crater that
  // overlaps one still draws on top -- the hole is a hole either way.
  y: 0.022,
  // How hard things are dragged towards the middle once the ground under
  // them has gone, and how fast they fall once they are over the edge.
  pull: 17,
  sink: 22,
  // A building whose footprint is this far inside the rim loses its ground.
  undermine: 0.82,
  buildingShock: 9,
  // Held to a handful: they never heal, and a map full of them is a map with
  // no ground left to fight over.
  maxKept: 3,
  colours: { floor: 0x07080a, rim: 0x4a423a, wall: 0x14120f },
  score: 2600,
  bannerSeconds: 3.4
};

/**
 * @typedef {Object} Hole
 * @property {THREE.Group} root
 * @property {THREE.Mesh} floor
 * @property {THREE.Mesh} rim
 * @property {number} x
 * @property {number} z
 * @property {number} radius
 * @property {number} grown 0..1
 * @property {Set<Object>} taken things already swallowed
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initSinkholes: () => void,
 *   openSinkhole: (x?: number, z?: number) => boolean,
 *   updateSinkholes: (dt: number) => void,
 *   swallowedCount: () => number,
 *   holeCount: () => number,
 *   resetSinkholes: () => void,
 *   disposeSinkholes: () => void
 * }}
 */
export function createSinkholeSystem(ctx) {
  const { Sim } = ctx;

  /** @type {Hole[]} */
  const holes = [];
  /** @type {THREE.Group|null} */
  let group = null;
  /** @type {HTMLDivElement|null} */
  let banner = null;
  let bannerTimer = 0;
  let swallowed = 0;

  /**
   * @param {number[]} range
   * @returns {number}
   */
  function between(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  /** @returns {void} */
  function initSinkholes() {
    group = new THREE.Group();
    group.name = 'sinkholes';
    Sim.three.scene.add(group);

    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'sinkhole-banner';
      banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
      bannerHost(ctx.container).appendChild(banner);
    }
  }

  /**
   * @param {string} title
   * @param {string} sub
   * @returns {void}
   */
  function showBanner(title, sub) {
    if (!banner) return;
    banner.querySelector('.title').textContent = title;
    banner.querySelector('.sub').textContent = sub;
    banner.classList.add('visible');
    bannerTimer = SINKHOLE.bannerSeconds;
  }

  /**
   * Where to open one when nobody has said. An evacuation point that is
   * currently taking people, if there is one -- see the note at the top of
   * the file -- and otherwise somewhere in the built-up part of town.
   * @returns {{x: number, z: number}}
   */
  function pickSite() {
    const evacuation = ctx.systems.evacuation;
    if (evacuation && evacuation.busiestPoint) {
      const point = evacuation.busiestPoint();
      if (point) return { x: point.x, z: point.z };
    }
    const angle = Math.random() * Math.PI * 2;
    const r = 20 + Math.random() * 60;
    return { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
  }

  /**
   * Opens a hole. With no coordinates it picks its own site.
   * @param {number} [x]
   * @param {number} [z]
   * @returns {boolean}
   */
  function openSinkhole(x, z) {
    if (!group) return false;
    const site = (x === undefined || z === undefined) ? pickSite() : { x, z };
    const radius = between(SINKHOLE.radius);

    // Not on top of one that is already there: two overlapping holes read as
    // one badly drawn hole.
    for (const hole of holes) {
      if (Math.hypot(hole.x - site.x, hole.z - site.z) < hole.radius + radius) return false;
    }
    if (holes.length >= SINKHOLE.maxKept) disposeHole(holes.shift());

    const root = new THREE.Group();
    root.position.set(site.x, 0, site.z);
    root.name = 'sinkhole';
    group.add(root);

    // The floor: a black disc well below the ground, so looking in gives
    // depth rather than a painted circle.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(1, SINKHOLE.segments),
      new THREE.MeshBasicMaterial({ color: SINKHOLE.colours.floor })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -SINKHOLE.depth;
    root.add(floor);

    // The shaft wall, open at both ends and lit from nothing, which is what
    // stops the floor reading as a disc floating in mid-air.
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 0.86, SINKHOLE.depth, SINKHOLE.segments, 1, true),
      new THREE.MeshStandardMaterial({
        color: SINKHOLE.colours.wall, roughness: 1, side: THREE.BackSide
      })
    );
    wall.position.y = -SINKHOLE.depth / 2;
    root.add(wall);

    // The rim: a ring of broken ground around the lip, slightly proud of the
    // road so the edge is not a clean cut.
    const rimHeight = between(SINKHOLE.rimHeight);
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(1.14, 1.0, rimHeight, SINKHOLE.segments, 1, true),
      new THREE.MeshStandardMaterial({
        color: SINKHOLE.colours.rim, roughness: 1, side: THREE.DoubleSide
      })
    );
    rim.position.y = SINKHOLE.y + rimHeight * 0.3;
    root.add(rim);

    /** @type {Hole} */
    const hole = { root, floor, rim, x: site.x, z: site.z, radius, grown: 0, taken: new Set() };
    root.scale.setScalar(0.001);
    holes.push(hole);

    ctx.systems.gamefeel.event('collapse', new THREE.Vector3(site.x, 0, site.z));
    ctx.systems.damage.addDamageScore(SINKHOLE.score);
    ctx.systems.earthquake.kickDust(site.x, site.z, 8, 2.6);
    showBanner('SINKHOLE', 'The ground is going');
    return true;
  }

  /**
   * @param {Hole} hole
   * @returns {void}
   */
  function disposeHole(hole) {
    hole.root.traverse((/** @type {any} */ child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    group.remove(hole.root);
  }

  /**
   * Takes something out of the world for good.
   * @param {SimObject} obj
   * @returns {void}
   */
  function swallow(obj) {
    swallowed++;
    if (obj.type === 'person' && ctx.systems.shelters) {
      // The same path a person leaves by when they reach a shelter door --
      // except this one is not a rescue, so nothing counts it as one.
      ctx.systems.shelters.removePerson(obj);
      return;
    }
    if (obj.mesh) obj.mesh.visible = false;
    const i = Sim.objects.indexOf(obj);
    if (i !== -1) Sim.objects.splice(i, 1);
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateSinkholes(dt) {
    if (!group) return;
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }
    if (!holes.length) return;

    for (const hole of holes) {
      if (hole.grown < 1) {
        hole.grown = Math.min(1, hole.grown + dt / SINKHOLE.growSeconds);
        const r = hole.radius * THREE.MathUtils.smoothstep(hole.grown, 0, 1);
        hole.root.scale.set(Math.max(0.001, r), 1, Math.max(0.001, r));
        // Kept round rather than scaled with the rest: a rim that grows in
        // height as the hole widens reads as the ground rising, not falling.
        hole.rim.scale.y = 1 / Math.max(0.001, r);
        hole.floor.scale.setScalar(1);

        // An evacuation point standing over it is not an evacuation point
        // any more.
        const evacuation = ctx.systems.evacuation;
        if (evacuation && evacuation.closePointAt) evacuation.closePointAt(hole.x, hole.z, r);
      }
      const live = hole.radius * THREE.MathUtils.smoothstep(hole.grown, 0, 1);
      if (live < 1) continue;

      // Buildings whose ground has gone. Shocked rather than swallowed: they
      // come down into the hole through the ordinary collapse path, which
      // means they topple inward (engine/topple.js) because the impulse is
      // coming from outside the rim.
      if (ctx.Environment && ctx.systems.damage.shockBuilding) {
        for (const building of ctx.Environment.buildings) {
          if (hole.taken.has(building) || building.damageState === 'collapsed') continue;
          const p = building.mesh.position;
          if (Math.hypot(p.x - hole.x, p.z - hole.z) > live * SINKHOLE.undermine) continue;
          hole.taken.add(building);
          // From the far side of the rim, so it goes over into the hole.
          const away = new THREE.Vector3(
            hole.x + (p.x - hole.x) * 3, 0, hole.z + (p.z - hole.z) * 3
          );
          ctx.systems.damage.shockBuilding(building, SINKHOLE.buildingShock, away);
        }
      }

      // Everything loose over it slides in and drops out of the world.
      for (let i = Sim.objects.length - 1; i >= 0; i--) {
        const obj = Sim.objects[i];
        if (obj.type === 'building') continue;
        if (obj.captureState && obj.captureState !== 'grounded') continue;
        const pos = obj.pooled ? obj.position : (obj.mesh && obj.mesh.position);
        if (!pos) continue;
        const dx = pos.x - hole.x;
        const dz = pos.z - hole.z;
        const d = Math.hypot(dx, dz);
        if (d > live) continue;

        // A person standing on ground that is going hands over to physics:
        // they stop walking anywhere and start sliding.
        if (obj.type === 'person' && obj.motion && obj.motion.active) {
          obj.motion.active = false;
          obj.motion.dropped = true;
          ctx.systems.speechBubbles.exclaim(obj);
        }
        if (obj.rooted) {
          obj.rooted = false;
          obj.damageState = 'uprooted';
        }
        // Dragged to the middle and down. The pull grows towards the centre,
        // so the last thing anything does is accelerate.
        const inward = 1 - d / live;
        obj.velocity.x -= (dx / (d || 1)) * SINKHOLE.pull * inward * dt;
        obj.velocity.z -= (dz / (d || 1)) * SINKHOLE.pull * inward * dt;
        obj.velocity.y -= SINKHOLE.sink * dt;
        if (pos.y < -SINKHOLE.depth * 0.35) swallow(obj);
      }
    }
  }

  /** @returns {number} */
  function swallowedCount() {
    return swallowed;
  }

  /** @returns {number} */
  function holeCount() {
    return holes.length;
  }

  /** @returns {void} */
  function resetSinkholes() {
    for (const hole of holes) disposeHole(hole);
    holes.length = 0;
    swallowed = 0;
    if (banner) banner.classList.remove('visible');
    bannerTimer = 0;
  }

  /** @returns {void} */
  function disposeSinkholes() {
    if (!group) return;
    for (const hole of holes) disposeHole(hole);
    holes.length = 0;
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    Sim.three.scene.remove(group);
    group = null;
    banner = null;
  }

  return {
    initSinkholes, openSinkhole, updateSinkholes, swallowedCount, holeCount,
    resetSinkholes, disposeSinkholes
  };
}
