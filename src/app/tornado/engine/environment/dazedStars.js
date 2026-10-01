// @ts-check
import * as THREE from 'three';
import { createSpinningStarsTexture } from '../../utils/textures.js';
import { PERSON } from '../scale.js';

/**
 * ===========================================================================
 * SECTION D.6 — Environment: spinning stars over dazed survivors
 * ===========================================================================
 * The cartoon "seeing stars" cue for someone a vortex has just put back down
 * (see the 'dazed' mode in peopleMotion.js). One sprite per dazed person,
 * holding a ring of four stars (createSpinningStarsTexture) spun by the
 * sprite material's own `rotation` — so the spin costs one float per frame
 * rather than any transform of the ring's geometry.
 *
 * Cheap by construction, in the same spirit as the speech-bubble pool it sits
 * alongside: a fixed pool of MAX_STARS sprites is built once and recycled, so
 * at most that many draw calls are ever added however many people are reeling
 * at once. The rest — who is dazed, how long for — is read straight off
 * PersonMotion; nothing is duplicated here.
 *
 * This system owns no state a reset needs to clear: every frame it re-derives
 * its assignments from the current crowd, so resetEnvironment() replacing the
 * people array simply frees every sprite on the next update.
 */

// Sprites in the pool. At 100 bystanders a strong tornado can drop a handful
// at a time, and past about this many overhead rings the screen is noise
// anyway; the nearest dazed people win the sprites (see updateDazedStars).
const MAX_STARS = 10;
// World height of the ring above a person's feet: clears the head with a
// little daylight (engine/scale.js PERSON).
const STARS_HEIGHT = PERSON.height * 1.15;
// World size of the ring, and how much bigger it is while they are still
// picking themselves up (the knock reads hardest right after landing).
const STARS_SIZE = PERSON.height * 0.45;
const STARS_SIZE_KICK = 1.35;
// Radians per second the ring turns.
const STARS_SPIN_RATE = 2.6;
// Bob, so the ring floats rather than sitting rigidly above the head.
const STARS_BOB = PERSON.height * 0.04;
const STARS_BOB_RATE = 2.2;
// Fade the last of the daze out, so stars never vanish mid-spin.
const STARS_FADE_TIME = 0.6;
// Beyond this from the camera the ring is a couple of unreadable pixels, and
// a dozen of them across the town read as fireflies; the pool is better spent
// on whoever is close enough to see.
const MAX_STARS_DISTANCE = 190;

/**
 * @param {Object} ctx
 * @returns {{
 *   initDazedStars: () => void,
 *   updateDazedStars: (dt: number) => void,
 *   disposeDazedStars: () => void
 * }}
 */
export function createDazedStarsSystem(ctx) {
  const { Sim } = ctx;

  /** @type {THREE.Sprite[]} */
  const pool = [];
  /** @type {THREE.Texture|null} */
  let texture = null;
  let spin = 0;

  /** @returns {void} */
  function initDazedStars() {
    texture = createSpinningStarsTexture();
    for (let i = 0; i < MAX_STARS; i++) {
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        // Over the figure but not over the depth buffer: the ring should be
        // hidden by a building it is behind, and never occlude anything.
        depthWrite: false,
        // Unaffected by the scene's storm lighting/tone mapping -- this is a
        // cartoon overlay, not something standing in the rain.
        toneMapped: false
      });
      const sprite = new THREE.Sprite(material);
      sprite.name = `dazedStars_${i}`;
      sprite.visible = false;
      // Sprites have no meaningful bounding sphere for the frustum test at
      // this size and get culled at the screen edge mid-spin otherwise.
      sprite.frustumCulled = false;
      Sim.three.scene.add(sprite);
      pool.push(sprite);
    }
  }

  /**
   * Per frame: finds who is dazed, hands the nearest of them a sprite each,
   * and spins/positions the ones in use.
   * @param {number} dt
   * @returns {void}
   */
  function updateDazedStars(dt) {
    if (!pool.length) return;
    spin += STARS_SPIN_RATE * dt;
    const camPos = Sim.three.camera.position;

    // Collected fresh each frame rather than tracked: the set is tiny, and
    // re-deriving it means nothing here can hold a stale reference to a person
    // who has since been struck by lightning or replaced by a reset.
    /** @type {{person: SimObject, distance: number}[]} */
    const dazed = [];
    for (const person of ctx.Environment.people) {
      const m = person.motion;
      if (!m || !m.active || m.mode !== 'dazed' || !person.mesh.parent) continue;
      const distance = camPos.distanceTo(person.mesh.position);
      if (distance > MAX_STARS_DISTANCE) continue;
      dazed.push({ person, distance });
    }
    // Nearest first, so when more people are reeling than there are sprites,
    // the ones the player can actually see get them.
    if (dazed.length > pool.length) {
      dazed.sort((a, b) => a.distance - b.distance);
    }

    const shown = Math.min(dazed.length, pool.length);
    const t = ctx.now();
    for (let i = 0; i < shown; i++) {
      const { person } = dazed[i];
      const m = person.motion;
      const sprite = pool[i];
      const pos = person.mesh.position;

      // Bigger while they are still on the floor getting up, easing down to
      // its resting size as they stand.
      const kick = m.standTimer > 0 ? STARS_SIZE_KICK : 1;
      const scale = STARS_SIZE * kick;
      sprite.scale.set(scale, scale, 1);
      sprite.position.set(
        pos.x,
        STARS_HEIGHT + Math.sin(t * STARS_BOB_RATE + m.weaveSeed) * STARS_BOB,
        pos.z
      );
      sprite.material.rotation = spin + m.weaveSeed;
      sprite.material.opacity = Math.min(1, m.dazedTimer / STARS_FADE_TIME);
      sprite.visible = true;
    }
    for (let i = shown; i < pool.length; i++) {
      if (pool[i].visible) pool[i].visible = false;
    }
  }

  /** @returns {void} */
  function disposeDazedStars() {
    for (const sprite of pool) {
      Sim.three.scene.remove(sprite);
      sprite.material.dispose();
    }
    pool.length = 0;
    // One texture shared by the whole pool, so it is disposed once, after.
    if (texture) {
      texture.dispose();
      texture = null;
    }
  }

  return { initDazedStars, updateDazedStars, disposeDazedStars };
}
