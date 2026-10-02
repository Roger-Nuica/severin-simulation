// @ts-check
import * as THREE from 'three';
import { setOffExplosivesAt } from '../explosives.js';

/**
 * ===========================================================================
 * SECTION O.2 — Mega blasts
 * ===========================================================================
 * The two explosions meant to dwarf everything else: the mothership coming
 * down on the town (mothership.js) and a nuclear power plant going up
 * (engine/nuclear.js). The fuel tanker and the chemical works are single
 * fireballs with a pressure wave; these are that and then some, all driven
 * from one config (see MOTHERSHIP_CRASH_BLAST and nuclear.js):
 *
 *  1. a white-out: a full-screen flash that holds and fades over seconds,
 *     not the lightning's tenth of a second;
 *  2. the fireball: the burst system's biggest burst at the centre, with a
 *     ring of big ones round it so it reads as a dome rather than a ball;
 *  3. the pressure wave, travelling outward at `shockSpeed` -- drawn as a
 *     glowing ring on the ground and a translucent dome -- which reaches
 *     things in order of distance: people inside `killRadius` blown apart,
 *     everything loose thrown, buildings shaken down, fires lit and every
 *     other explosive in reach set off (engine/explosives.js), the far town
 *     flattened, and the aliens and Roger caught inside `killRadius` killed;
 *  4. secondary blasts walking outward behind the wave;
 *  5. a mushroom cloud: a real mesh -- a stem and a lumpy cap with a skirt
 *     round it -- that climbs out of the fireball glowing from inside,
 *     cools to smoke, hangs over the town for `linger` seconds and fades.
 *
 * `onFront(previous, radius)` lets the caller add to what the wave does as it
 * passes (the nuclear plant's green EMP rides its own, slower ring).
 *
 * Nothing here allocates per frame beyond what a blast is made of when it
 * starts, and a blast owns its meshes: they are removed and disposed when it
 * is over, or on a Reset.
 */

// Seconds after the cloud has finished climbing for its stem to fade away
// (the cap and skirt stay for the config's linger).
const STEM_FADE_SECONDS = 5;

/**
 * @typedef {Object} MegaBlastConfig
 * @property {number} core strength of the centre burst (the burst system's scale, up to 60)
 * @property {number} ringCount bursts in a ring round the centre
 * @property {number} ringRadius
 * @property {number} ringStrength
 * @property {number} satellites secondary blasts behind the wave
 * @property {number} satelliteSpread
 * @property {number} satelliteInterval seconds between two
 * @property {number[]} satelliteStrength [min, max]
 * @property {number} shockSpeed world units/sec
 * @property {number} radius how far the wave goes
 * @property {number} throwForce
 * @property {number} buildingShock at the centre, falling off to the edge
 * @property {number} fireRadius buildings set alight, explosives set off
 * @property {number} killRadius people, aliens and Roger killed
 * @property {boolean} throwPeople whether people outside killRadius are thrown
 * @property {{rise: number, riseSeconds: number, stem: number, cap: number, linger: number, fade: number, fire: THREE.Color, smoke: number, skirt: number}} mushroom
 * @property {THREE.Color} ringColour
 * @property {{colour: string, peak: number, hold: number, seconds: number}} flash
 * @property {string} event gamefeel.js event name
 * @property {{title: string, sub: string, source?: string}} heroKill
 * @property {(previous: number, radius: number) => void} [onFront]
 */

/**
 * The mothership shot down and hitting the ground (mothership.js). Bigger
 * than the chemical works in every term (it is 40 at the core, 30
 * secondaries over 220, a column to 180, a wave to 300), on request.
 * @type {MegaBlastConfig}
 */
export const MOTHERSHIP_CRASH_BLAST = {
  core: 60,
  ringCount: 10,
  ringRadius: 42,
  ringStrength: 42,
  satellites: 46,
  satelliteSpread: 260,
  satelliteInterval: 0.045,
  satelliteStrength: [22, 40],
  shockSpeed: 210,
  radius: 360,
  throwForce: 120,
  buildingShock: 10,
  fireRadius: 220,
  killRadius: 110,
  throwPeople: true,
  mushroom: {
    rise: 250, riseSeconds: 5, stem: 9, cap: 62, linger: 18, fade: 8,
    fire: new THREE.Color(2.4, 1.0, 0.3), smoke: 0x3d3632, skirt: 0x4a403a
  },
  ringColour: new THREE.Color(2.2, 1.3, 0.5),
  flash: { colour: '#ffe7c0', peak: 0.8, hold: 0.25, seconds: 2.2 },
  event: 'mothershipCrash',
  heroKill: { title: 'CRUSHED', sub: 'The mothership came down on Roger', source: 'explosion' }
};

/**
 * Pushes a sphere's vertices in and out by a smooth function of where they
 * are, so the cap is lumpy rather than a ball -- the same bump on both sides
 * of the UV seam, since it depends on position alone.
 * @param {THREE.BufferGeometry} geo
 * @param {number} amount
 * @returns {THREE.BufferGeometry}
 */
function lumpy(geo, amount) {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 3.1 + v.y * 1.7) * Math.sin(v.z * 2.7 - v.y * 2.3) + 0.5 * Math.sin(v.x * 7.3 + v.z * 5.9);
    v.multiplyScalar(1 + amount * n);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * @param {Object} ctx
 * @returns {{
 *   initMegaBlasts: () => void,
 *   detonate: (at: THREE.Vector3, cfg: MegaBlastConfig) => void,
 *   updateMegaBlasts: (dt: number) => void,
 *   resetMegaBlasts: () => void,
 *   disposeMegaBlasts: () => void
 * }}
 */
export function createMegaBlastSystem(ctx) {
  const { Sim } = ctx;
  // Scratch, reused every frame rather than allocated (performance pass).
  const waveDir = new THREE.Vector3();

  /** @type {Object[]} */
  let blasts = [];
  /** @type {HTMLDivElement|null} the white-out */
  let overlay = null;
  // The white-out now: how bright, how long it holds, how long it fades.
  const flash = { level: 0, peak: 0, hold: 0, seconds: 1, timer: 0 };
  /** @type {Object<string, THREE.BufferGeometry>|null} shared by every blast */
  let geo = null;

  /** @returns {void} */
  function initMegaBlasts() {
    overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', opacity: '0', pointerEvents: 'none', mixBlendMode: 'screen', zIndex: '9997'
    });
    document.body.appendChild(overlay);
    const stem = new THREE.CylinderGeometry(0.55, 1, 1, 18, 8, true);
    stem.translate(0, 0.5, 0);
    const ground = new THREE.RingGeometry(0.97, 1, 120);
    ground.rotateX(-Math.PI / 2);
    geo = {
      stem: lumpy(stem, 0.08),
      cap: lumpy(new THREE.SphereGeometry(1, 28, 18), 0.13),
      skirt: lumpy(new THREE.TorusGeometry(1, 0.3, 12, 32), 0.1),
      ground,
      dome: new THREE.SphereGeometry(1, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2)
    };
  }

  /**
   * @param {{colour: string, peak: number, hold: number, seconds: number}} f
   * @returns {void}
   */
  function whiteOut(f) {
    if (!overlay || f.peak < flash.level) return;
    overlay.style.background = f.colour;
    Object.assign(flash, { level: f.peak, peak: f.peak, hold: f.hold, seconds: f.seconds, timer: 0 });
  }

  /**
   * @param {THREE.Color} fire
   * @param {number} smoke
   * @returns {THREE.MeshStandardMaterial}
   */
  function cloudMaterial(fire, smoke) {
    return new THREE.MeshStandardMaterial({
      color: smoke, emissive: fire.clone(), emissiveIntensity: 1, roughness: 1,
      transparent: true, opacity: 0.96, flatShading: true,
      // It fades: with depth writes on, the fading stem hid the cap behind it.
      depthWrite: false
    });
  }

  /**
   * @param {THREE.Color} colour
   * @returns {THREE.MeshBasicMaterial}
   */
  function glowMaterial(colour) {
    return new THREE.MeshBasicMaterial({
      color: colour, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide
    });
  }

  /**
   * Sets one off at `at` (on the ground).
   * @param {THREE.Vector3} at
   * @param {MegaBlastConfig} cfg
   * @returns {void}
   */
  function detonate(at, cfg) {
    if (!geo) return;
    const ground = new THREE.Vector3(at.x, 2, at.z);
    const explosions = ctx.systems.explosions;
    explosions.spawnImpactBurst(ground.clone().setY(8), cfg.core);
    for (let i = 0; i < cfg.ringCount; i++) {
      const a = (i / cfg.ringCount) * Math.PI * 2 + Math.random() * 0.3;
      explosions.spawnImpactBurst(new THREE.Vector3(
        at.x + Math.cos(a) * cfg.ringRadius, 4 + Math.random() * 18, at.z + Math.sin(a) * cfg.ringRadius
      ), cfg.ringStrength * (0.8 + Math.random() * 0.4));
    }
    whiteOut(cfg.flash);
    ctx.systems.lightning.flashScreen(ground, 1, cfg.flash.colour);
    ctx.systems.cues.playLargeExplosion({ priority: true, gain: 2 });
    if (ctx.systems.shockwaveSound) ctx.systems.shockwaveSound.playShockwave();
    ctx.systems.gamefeel.event(cfg.event, ground);
    if (ctx.systems.earthquake) ctx.systems.earthquake.kickDust(at.x, at.z, 24, 8);

    // The mushroom cloud.
    const m = cfg.mushroom;
    const group = new THREE.Group();
    group.name = 'mega_blast_cloud';
    group.position.set(at.x, 0, at.z);
    const stemMat = cloudMaterial(m.fire, m.smoke);
    const capMat = cloudMaterial(m.fire, m.smoke);
    const skirtMat = cloudMaterial(m.fire, m.skirt);
    const stem = new THREE.Mesh(geo.stem, stemMat);
    const cap = new THREE.Mesh(geo.cap, capMat);
    const skirt = new THREE.Mesh(geo.skirt, skirtMat);
    skirt.rotation.x = Math.PI / 2;
    group.add(stem, cap, skirt);
    group.scale.setScalar(0.001);
    Sim.three.scene.add(group);

    // The wave on the ground, and the dome over it.
    const ringMat = glowMaterial(cfg.ringColour);
    const domeMat = glowMaterial(cfg.ringColour);
    const ring = new THREE.Mesh(geo.ground, ringMat);
    ring.position.set(at.x, 0.8, at.z);
    ring.frustumCulled = false;
    const dome = new THREE.Mesh(geo.dome, domeMat);
    dome.position.set(at.x, 0, at.z);
    dome.frustumCulled = false;
    Sim.three.scene.add(ring, dome);

    blasts.push({
      at: ground, cfg, timer: 0, radius: 0, done: new Set(), satellites: 0, nextSatellite: 0, nextPuff: 0,
      group, stem, cap, skirt, ring, dome, materials: [stemMat, capMat, skirtMat, ringMat, domeMat], spin: (Math.random() - 0.5) * 0.08
    });
  }

  /**
   * The wave reaching what it has not reached yet, once each.
   * @param {Object} b
   * @param {number} previous
   * @returns {void}
   */
  function spreadWave(b, previous) {
    const { cfg, at } = b;
    const r = b.radius;
    const people = ctx.systems.people;
    const killed = [];
    for (const obj of Sim.objects) {
      if (obj.type === 'building' || obj.rooted || b.done.has(obj)) continue;
      const pos = obj.pooled ? obj.position : (obj.mesh && obj.mesh.position);
      if (!pos) continue;
      const d = Math.hypot(pos.x - at.x, pos.z - at.z);
      if (d > r) continue;
      b.done.add(obj);
      if (obj.type === 'person') {
        if (d < cfg.killRadius) {
          killed.push(obj);
          continue;
        }
        if (!cfg.throwPeople) continue;
      }
      const falloff = 1 - d / cfg.radius;
      const dir = waveDir.set(pos.x - at.x, 0, pos.z - at.z);
      if (dir.lengthSq() < 1e-6) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      dir.normalize().multiplyScalar(cfg.throwForce * falloff);
      obj.velocity.add(dir);
      obj.velocity.y += cfg.throwForce * falloff * 0.7;
      obj.angularVelocity.set((Math.random() - 0.5) * 11, (Math.random() - 0.5) * 11, (Math.random() - 0.5) * 11);
      if (obj.type === 'car' && obj.damageState === 'intact') obj.damageState = 'tipped';
    }
    // After the loop: a death splices Sim.objects.
    for (const person of killed) if (person.mesh && person.mesh.parent) people.explodePerson(person);

    const damage = ctx.systems.damage;
    for (const building of ctx.Environment.buildings) {
      if (b.done.has(building)) continue;
      const p = building.mesh.position;
      const d = Math.hypot(p.x - at.x, p.z - at.z);
      if (d > r) continue;
      b.done.add(building);
      damage.shockBuilding(building, cfg.buildingShock * (1 - d / cfg.radius) + 0.5, at);
    }
    if (ctx.systems.backdrop) ctx.systems.backdrop.damageAt(at.x, at.z, Math.min(r, cfg.radius * 0.8));
    if (previous < cfg.fireRadius) {
      const reach = Math.min(r, cfg.fireRadius);
      ctx.systems.buildingFire.igniteNear(at.x, at.z, reach);
      setOffExplosivesAt(ctx, at.x, at.z, reach);
    }
    if (previous < cfg.killRadius) {
      const reach = Math.min(r, cfg.killRadius);
      if (ctx.systems.aliens) ctx.systems.aliens.boltKill(at.x, at.z, reach);
      if (ctx.systems.heroMode) ctx.systems.heroMode.hitArea(at.x, at.z, reach, cfg.heroKill.title, cfg.heroKill.sub, cfg.heroKill.source);
    }
    if (cfg.onFront) cfg.onFront(previous, r);
  }

  /**
   * @param {Object} b
   * @param {number} dt
   * @returns {boolean} whether it is over
   */
  function updateBlast(b, dt) {
    const { cfg, at } = b;
    b.timer += dt;
    const previous = b.radius;
    b.radius = Math.min(cfg.radius, previous + cfg.shockSpeed * dt);
    if (b.radius > previous) spreadWave(b, previous);

    // The ring and the dome, fading as they go.
    const through = b.radius / cfg.radius;
    const fadeOut = (1 - through) * (1 - through);
    b.ring.scale.setScalar(Math.max(0.01, b.radius));
    b.materials[3].opacity = through < 1 ? 0.9 * fadeOut : 0;
    b.dome.scale.set(Math.max(0.01, b.radius), Math.max(0.01, b.radius * 0.42), Math.max(0.01, b.radius));
    b.materials[4].opacity = through < 1 ? 0.22 * fadeOut : 0;

    // Secondaries behind the wave.
    const explosions = ctx.systems.explosions;
    b.nextSatellite -= dt;
    while (b.satellites < cfg.satellites && b.nextSatellite <= 0) {
      const a = Math.random() * Math.PI * 2;
      const r = (0.15 + Math.random() * 0.85) * Math.min(b.radius + 20, cfg.satelliteSpread);
      const [lo, hi] = cfg.satelliteStrength;
      explosions.spawnImpactBurst(new THREE.Vector3(at.x + Math.cos(a) * r, 2 + Math.random() * 36, at.z + Math.sin(a) * r), lo + Math.random() * (hi - lo));
      b.satellites++;
      b.nextSatellite += cfg.satelliteInterval;
    }

    // The mushroom: it climbs over riseSeconds, the cap spreading as it goes,
    // glowing from inside and cooling to smoke; then it hangs and fades.
    const m = cfg.mushroom;
    const u = Math.min(1, b.timer / m.riseSeconds);
    const ease = 1 - (1 - u) ** 3;
    const height = 20 + m.rise * ease;
    const capW = m.cap * (0.3 + 0.7 * ease);
    b.group.scale.setScalar(1);
    b.stem.scale.set(m.stem * (0.6 + 0.4 * ease), height, m.stem * (0.6 + 0.4 * ease));
    b.cap.scale.set(capW, capW * 0.55, capW);
    b.cap.position.y = height;
    b.skirt.scale.setScalar(capW * 0.85);
    b.skirt.position.y = height - capW * 0.3;
    b.group.rotation.y += b.spin * dt;
    // Cooling: white-hot to smoke over a little longer than the climb, the
    // stem first (it read as a solid orange pillar when it stayed lit).
    const cool = Math.max(0, 1 - b.timer / (m.riseSeconds * 1.4));
    const flicker = 0.85 + 0.15 * Math.sin(b.timer * 17);
    b.materials[0].emissiveIntensity = (0.04 + 1.4 * cool * cool) * flicker;
    b.materials[1].emissiveIntensity = (0.1 + 1.8 * cool) * flicker;
    b.materials[2].emissiveIntensity = (0.06 + 1.2 * cool) * flicker;
    // Fire still pouring up the stem while it climbs.
    b.nextPuff -= dt;
    while (b.timer < m.riseSeconds && b.nextPuff <= 0) {
      explosions.spawnImpactBurst(new THREE.Vector3(
        at.x + (Math.random() - 0.5) * m.stem, 10 + ease * height * Math.random(), at.z + (Math.random() - 0.5) * m.stem
      ), 18 + 20 * (1 - u));
      b.nextPuff += 0.12;
    }
    const gone = b.timer - m.riseSeconds - m.linger;
    const alpha = gone > 0 ? Math.max(0, 1 - gone / m.fade) : 1;
    for (let i = 1; i < 3; i++) b.materials[i].opacity = 0.96 * alpha;
    // The stem thins away soon after the cloud has climbed, rather than
    // standing in the middle of town for the whole linger: seen from close
    // to, it was a huge flat wall (a violet one after Smooth Criminal's
    // blast) that read as some leftover structure.
    const stemFade = 1 - THREE.MathUtils.smoothstep(b.timer, m.riseSeconds, m.riseSeconds + STEM_FADE_SECONDS);
    b.materials[0].opacity = 0.96 * alpha * stemFade;
    b.stem.visible = stemFade > 0.01;
    return alpha <= 0 && b.radius >= cfg.radius;
  }

  /**
   * @param {Object} b
   * @returns {void}
   */
  function removeBlast(b) {
    Sim.three.scene.remove(b.group, b.ring, b.dome);
    for (const mat of b.materials) mat.dispose();
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateMegaBlasts(dt) {
    if (flash.level > 0 && overlay) {
      flash.timer += dt;
      const t = flash.timer - flash.hold;
      flash.level = t <= 0 ? flash.peak : flash.peak * Math.max(0, 1 - t / flash.seconds) ** 2;
      overlay.style.opacity = flash.level.toFixed(3);
    }
    if (dt <= 0) return;
    blasts = blasts.filter((b) => {
      if (!updateBlast(b, dt)) return true;
      removeBlast(b);
      return false;
    });
  }

  /** @returns {void} */
  function resetMegaBlasts() {
    for (const b of blasts) removeBlast(b);
    blasts = [];
    flash.level = 0;
    if (overlay) overlay.style.opacity = '0';
  }

  /** @returns {void} */
  function disposeMegaBlasts() {
    resetMegaBlasts();
    if (geo) for (const g of Object.values(geo)) g.dispose();
    geo = null;
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
  }

  return { initMegaBlasts, detonate, updateMegaBlasts, resetMegaBlasts, disposeMegaBlasts };
}
