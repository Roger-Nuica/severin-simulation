// @ts-check
import * as THREE from 'three';
import { METEOR, ROCK_VERTEX, ROCK_FRAGMENT, createRockGeometry } from './config.js';
/** @typedef {import('./config.js').Meteor} Meteor */

/**
 * ===========================================================================
 * SECTION MT.1 — The rocks
 * ===========================================================================
 * Each rock and what it owns, a volley on demand, and the barrage armed
 * for the storm.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see meteors.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createMeteorRocks(ctx, S, api) {
  /**
   * @param {number} radius
   * @returns {THREE.ShaderMaterial}
   */
  function createRockMaterial(radius) {
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uLead: { value: new THREE.Vector3(0, -1, 0) },
          uHeat: { value: 0 },
          uScale: { value: radius }
        }
      ]),
      vertexShader: ROCK_VERTEX,
      fragmentShader: ROCK_FRAGMENT,
      fog: true
    });
    return mat;
  }

  /**
   * Builds one rock: where it lands, where it comes in from, and how big it
   * is. The aim point is random inside the impact ring: none is aimed at
   * the dam (the flood starts only from its own button, or Doomsday).
   * @param {number} index which rock of this group
   * @param {number} count how many are in it
   * @param {{from: {x: number, y: number, z: number}, to: {x: number, y: number, z: number}, radius: number, airburst: boolean, rand: () => number}} [view]
   *   co-op guest: the host's rock as announced (net/meteorFx.js), with a seeded
   *   generator for the shapes; the host passes none and keeps `Math.random`
   * @returns {Meteor}
   */
  function createMeteor(index, count, view) {
    const rnd = view ? view.rand : Math.random;
    /** @param {number[]} range @returns {number} */
    const btw = (range) => range[0] + rnd() * (range[1] - range[0]);
    // One rock of every group comes apart in the air instead of landing.
    const airburst = view ? view.airburst : count > METEOR.airburstIndex && index === METEOR.airburstIndex;
    /** @type {THREE.Vector3} */
    let to;
    /** @type {THREE.Vector3} */
    let from;
    if (view) {
      to = new THREE.Vector3(view.to.x, view.to.y, view.to.z);
      from = new THREE.Vector3(view.from.x, view.from.y, view.from.z);
    } else {
      const impactAngle = Math.random() * Math.PI * 2;
      const impactR = api.between(METEOR.impactRadius);
      to = new THREE.Vector3(Math.cos(impactAngle) * impactR, 0, Math.sin(impactAngle) * impactR);
      // Comes in on its own bearing, at a slant rather than straight down --
      // except for an airburst, which comes in steeply so that the altitude it
      // detonates at is over the town rather than short of it.
      const entryAngle = Math.random() * Math.PI * 2;
      const reach = airburst ? METEOR.burstEntryDistance : METEOR.entryDistance;
      from = new THREE.Vector3(
        to.x + Math.cos(entryAngle) * reach,
        METEOR.entryHeight,
        to.z + Math.sin(entryAngle) * reach
      );
    }

    const radius = view ? view.radius : api.between(METEOR.radius);
    const rock = new THREE.Group();
    rock.visible = false;
    S.group.add(rock);

    // Everything this one rock owns, so it can all be freed the moment it
    // lands (see disposeMeteor). A volley can be called as often as the
    // player likes, so nothing here may outlive the rock that made it.
    /** @type {THREE.Material[]} */
    const materials = [];

    const mat = createRockMaterial(radius);
    materials.push(mat);
    const mesh = new THREE.Mesh(createRockGeometry(radius), mat);
    rock.add(mesh);

    // The incandescent envelope: the air round the rock heated white-hot.
    // Two camera-facing glows -- a tight white-orange core and a wide amber
    // halo -- rather than the cone it used to be: a cone is a hard-edged
    // shape with a point, and from most angles it read as an arrowhead
    // leading the rock down. A glow has no shape to read.
    const shock = new THREE.Group();
    for (const [colour, size, base] of [
      [new THREE.Color(4.4, 2.3, 0.8), 3.0, 0.95],
      [new THREE.Color(2.4, 0.7, 0.14), 6.5, 0.55]
    ]) {
      const glowMat = new THREE.SpriteMaterial({
        map: S.glowTexture, color: colour, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false
      });
      materials.push(glowMat);
      const glow = new THREE.Sprite(glowMat);
      glow.scale.setScalar(radius * size);
      glow.userData.base = base;
      shock.add(glow);
    }
    rock.add(shock);

    // Pieces that break off partway down. Children of the same group, so they
    // ride the fall line and only their own lateral offset is integrated.
    const fragments = [];
    const pieces = Math.round(btw(METEOR.fragments));
    for (let f = 0; f < pieces; f++) {
      const fr = radius * btw(METEOR.fragmentRadius);
      const fragMat = createRockMaterial(fr);
      materials.push(fragMat);
      const frag = new THREE.Mesh(createRockGeometry(fr), fragMat);
      const angle = rnd() * Math.PI * 2;
      frag.visible = false;
      rock.add(frag);
      fragments.push({
        mesh: frag,
        radius: fr,
        // Where it ends up relative to the parent, by the time it lands.
        driftX: Math.cos(angle) * METEOR.fragmentSpread * (0.4 + rnd() * 0.6),
        driftZ: Math.sin(angle) * METEOR.fragmentSpread * (0.4 + rnd() * 0.6),
        spin: new THREE.Vector3(
          (rnd() - 0.5) * 8, (rnd() - 0.5) * 8, (rnd() - 0.5) * 8
        )
      });
    }

    return {
      mesh: rock, body: mesh, shock, fragments, materials, from, to, radius,
      airburst,
      // Where along its fall it comes apart: the height, as a fraction of the
      // drop. An airburst never reaches t = 1.
      burstAt: airburst
        ? 1 - METEOR.burstHeight / Math.max(1, METEOR.entryHeight)
        : 2,
      delay: view ? 0 : index * METEOR.stagger + Math.random() * METEOR.staggerJitter,
      t: 0, state: 'waiting'
    };
  }

  /**
   * Frees one rock: its group, the generated geometry of the rock, the shock
   * cone and every fragment, and the shader materials behind them.
   * @param {Meteor} meteor
   * @returns {void}
   */
  function disposeMeteor(meteor) {
    meteor.mesh.traverse((/** @type {any} */ child) => {
      // Sprites all share one quad owned by three.js itself; it is not ours
      // to free.
      if (child.geometry && !child.isSprite) child.geometry.dispose();
    });
    for (const mat of meteor.materials) mat.dispose();
    S.group.remove(meteor.mesh);
  }

  /**
   * A volley on demand, from the panel (or Doomsday). Repeatable and needs
   * no storm: each press adds a fresh group of rocks
   * already falling, each of which leaves its own crater where it lands.
   * @param {number} count
   * @returns {void}
   */
  function callVolley(count) {
    if (!S.group) return;
    // Co-op guest: the host's rocks are drawn from its `fx` rows (mirrorRock); none starts here.
    if (ctx.systems.net && ctx.systems.net.isPeerView()) return;
    for (let i = 0; i < count; i++) S.meteors.push(createMeteor(i, count));
    api.showBanner('METEOR STRIKE!', `${count} impacts inbound`);
  }

  return { createRockMaterial, createMeteor, disposeMeteor, callVolley };
}
