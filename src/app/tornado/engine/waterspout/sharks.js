// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION WS.1 — Sharks (the waterspout's party trick)
 * ===========================================================================
 * The lake has sharks in it, apparently. Every SHARKS.every seconds while a
 * waterspout is up (engine/waterspout.js), one is sucked out of the water,
 * spun up the column, and flung over the dam into the town on a long arc. Where it
 * comes down: a splash of spray, anyone right beside it knocked flat (they
 * go down dazed, as the funnel's own drops do -- nobody is eaten), and the
 * shark lies there flopping for a few seconds, then is gone. The first one
 * of each waterspout gets its own headline.
 *
 * At most SHARKS.max at once, each a few meshes sharing their geometry and
 * two materials, made once and reused.
 */

export const SHARKS = {
  every: 3,          // seconds between two sharks
  max: 6,
  rise: 2,           // seconds up the column
  flight: [2.6, 3.6],
  town: 110,         // they land anywhere within this many metres of the town's middle
  arc: [35, 0.12],   // the arc's height: metres, plus this much per metre flown
  flop: 4,           // seconds on the ground before it is gone
  knock: 3,          // metres: people knocked over where it lands
  score: 200
};

/**
 * @param {Object} ctx
 * @returns {{
 *   init: () => void,
 *   update: (dt: number, spout: {x: number, z: number}|null, lakeY: number, splash: (x: number, y: number, z: number, n: number) => void) => void,
 *   clear: () => void,
 *   release: () => void,
 *   flung: () => number
 * }}
 */
export function createSharks(ctx) {
  const { Sim } = ctx;
  /**
   * @typedef {Object} Shark
   * @property {THREE.Group} mesh
   * @property {'idle'|'rising'|'flying'|'flopping'} state
   * @property {number} t
   * @property {THREE.Vector3} from
   * @property {THREE.Vector3} to
   * @property {number} seconds
   * @property {number} angle
   */
  /** @type {Shark[]} */
  let sharks = [];
  /** @type {THREE.BufferGeometry[]} */
  const geos = [];
  /** @type {THREE.Material[]} */
  const mats = [];
  let timer = 0;
  let count = 0;
  let headline = false;
  let spoutSeen = false;

  /** @returns {THREE.Group} */
  function build() {
    const [grey, belly] = mats;
    const [body, fin, tail] = geos;
    const g = new THREE.Group();
    g.name = 'shark';
    const b = new THREE.Mesh(body, grey);
    b.rotation.x = Math.PI / 2;
    const under = new THREE.Mesh(body, belly);
    under.rotation.x = Math.PI / 2;
    under.scale.set(0.8, 0.9, 0.55);
    under.position.y = -0.18;
    const dorsal = new THREE.Mesh(fin, grey);
    dorsal.position.set(0, 0.55, -0.2);
    const t = new THREE.Mesh(tail, grey);
    t.position.set(0, 0.1, -1.7);
    t.rotation.x = Math.PI / 2;
    g.add(b, under, dorsal, t);
    g.visible = false;
    return g;
  }

  /** @returns {void} */
  function init() {
    geos.push(
      new THREE.CapsuleGeometry(0.42, 2.2, 4, 10),
      new THREE.ConeGeometry(0.28, 0.8, 4),
      new THREE.ConeGeometry(0.45, 0.9, 4)
    );
    mats.push(
      new THREE.MeshStandardMaterial({ color: 0x6f7c86, roughness: 0.55 }),
      new THREE.MeshStandardMaterial({ color: 0xe3e6e4, roughness: 0.7 })
    );
    sharks = [];
    for (let i = 0; i < SHARKS.max; i++) {
      const mesh = build();
      Sim.three.scene.add(mesh);
      sharks.push({ mesh, state: 'idle', t: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), seconds: 3, angle: 0 });
    }
  }

  /**
   * Anyone beside a landing shark goes down, dazed.
   * @param {THREE.Vector3} at
   * @returns {void}
   */
  function knock(at) {
    ctx.systems.area.forEachInRadius({ x: at.x, z: at.z, radius: SHARKS.knock, targets: ['person'] }, (hit) => {
      const person = hit.target;
      if (person.captureState !== 'grounded') return;
      person.captureState = 'falling';
      person.velocity.set((hit.x - at.x) * 2, 5, (hit.z - at.z) * 2);
    });
  }

  /**
   * @param {number} dt
   * @param {{x: number, z: number}|null} spout
   * @param {number} lakeY
   * @param {(x: number, y: number, z: number, n: number) => void} splash
   * @returns {void}
   */
  function update(dt, spout, lakeY, splash) {
    if (dt <= 0) return;
    if (spout && !spoutSeen) {
      spoutSeen = true;
      headline = false;
      timer = 1.5;
    }
    if (!spout) spoutSeen = false;
    // A new one out of the water.
    if (spout) {
      timer -= dt;
      const free = sharks.find(s => s.state === 'idle');
      if (timer <= 0 && free) {
        timer = SHARKS.every;
        free.state = 'rising';
        free.t = 0;
        free.angle = Math.random() * Math.PI * 2;
        free.mesh.visible = true;
        free.mesh.scale.setScalar(1);
        if (!headline) {
          headline = true;
          ctx.events.emit('announce', { title: 'SHARKSPOUT!', sub: 'The waterspout is throwing sharks at the town' });
          ctx.events.emit('notice', { text: '🦈 SHARKS INCOMING' });
        }
      }
    }
    for (const s of sharks) {
      if (s.state === 'idle') continue;
      s.t += dt;
      const m = s.mesh;
      if (s.state === 'rising') {
        if (!spout) {
          s.state = 'idle';
          m.visible = false;
          continue;
        }
        s.angle += dt * 4;
        const r = 5 + s.t * 2;
        m.position.set(spout.x + Math.cos(s.angle) * r, lakeY + (s.t / SHARKS.rise) * 60, spout.z + Math.sin(s.angle) * r);
        m.rotation.set(s.t * 5, s.angle, s.t * 3);
        if (s.t >= SHARKS.rise) {
          // Flung over the dam into the town: the lake is a long way from
          // its middle, so it aims at the town itself rather than at a
          // distance from the spout (which left them on the lake shore).
          s.state = 'flying';
          s.t = 0;
          s.from.copy(m.position);
          s.to.set((Math.random() * 2 - 1) * SHARKS.town, 0.6, (Math.random() * 2 - 1) * SHARKS.town);
          s.seconds = SHARKS.flight[0] + Math.random() * (SHARKS.flight[1] - SHARKS.flight[0]);
        }
      } else if (s.state === 'flying') {
        const u = Math.min(1, s.t / s.seconds);
        m.position.lerpVectors(s.from, s.to, u);
        const flown = Math.hypot(s.to.x - s.from.x, s.to.z - s.from.z);
        m.position.y += Math.sin(u * Math.PI) * (SHARKS.arc[0] + flown * SHARKS.arc[1]);
        m.rotation.x += dt * 6;
        m.rotation.y += dt * 2;
        if (u >= 1) {
          s.state = 'flopping';
          s.t = 0;
          m.position.copy(s.to);
          m.rotation.set(0, Math.random() * Math.PI * 2, Math.PI / 2);
          splash(s.to.x, 0.5, s.to.z, 50);
          knock(s.to);
          ctx.systems.gamefeel.event('impact', s.to);
          ctx.systems.damage.addDamageScore(SHARKS.score);
          count++;
        }
      } else if (s.state === 'flopping') {
        // Flip, flop.
        m.rotation.z = Math.PI / 2 + Math.sin(s.t * 14) * 0.35 * Math.max(0, 1 - s.t / SHARKS.flop);
        m.position.y = 0.45 + Math.abs(Math.sin(s.t * 7)) * 0.3 * Math.max(0, 1 - s.t / SHARKS.flop);
        if (s.t > SHARKS.flop) m.scale.setScalar(Math.max(0.01, 1 - (s.t - SHARKS.flop) * 2));
        if (s.t > SHARKS.flop + 0.5) {
          s.state = 'idle';
          m.visible = false;
        }
      }
    }
  }

  /** @returns {void} */
  function clear() {
    for (const s of sharks) {
      s.state = 'idle';
      s.mesh.visible = false;
    }
    timer = 0;
    spoutSeen = false;
  }

  /** @returns {void} */
  function release() {
    for (const s of sharks) Sim.three.scene.remove(s.mesh);
    sharks = [];
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
    geos.length = 0;
    mats.length = 0;
  }

  return { init, update, clear, release, flung: () => count };
}
