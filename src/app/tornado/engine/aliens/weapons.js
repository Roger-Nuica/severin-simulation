// @ts-check
import * as THREE from 'three';
import { ALIENS, RAY_COLOURS, SHOTS, UP } from './config.js';

/**
 * ===========================================================================
 * SECTION AK.5 — Ray guns and tracking lasers
 * ===========================================================================
 * The crew's green bolts, the ships' red lances (one fixed pool of shots),
 * and the ships' tracking lasers.
 *
 * Look (redone 2026-10-05, on request: flat additive cylinders read as
 * slabs, and a shot landing on Roger as a 2 m ball that whited him out when
 * several arrived together):
 *  - every beam is a soft tube: bright along its middle, fading to nothing
 *    at its edges (a view-angle falloff in the shader), so it has no hard
 *    outline at any distance;
 *  - a crew shot is a short bolt that flies from the gun to the target with
 *    a faint tracer behind it, so the eye follows it back to its alien; the
 *    hit lands (and hurts) when the bolt arrives;
 *  - a ship's shot is an instant, thicker lance that strobes, with its own
 *    heavier sound;
 *  - where a shot lands: a small spark and a ring running out, and impacts
 *    on Roger share one brightness, so ten at once are no brighter than two;
 *  - a ship's tracking laser first draws a thin aiming line with a closing
 *    reticle on the ground (harmless), then the beam burns.
 */

/** Metres from the camera over which a shot fades in (nothing closer than the first). */
const SHOT_FADE = [4, 22];
/** The same for a tracking laser, which is wider and often comes down past the camera. */
const LASER_FADE = [8, 40];

const SOFT_VERTEX = /* glsl */`
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
varying vec3 vPos;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

// A tube or ball lit from inside: bright where it faces the eye, nothing at
// its rim. uTail dims the tail end of a beam (uv.y 0) against its head (1);
// uPulse runs bright bands along it (uLen metres long, uTime seconds).
// Anything within a few metres of the camera fades out, so a beam passing
// right by the eye never washes the screen (view distance per fragment).
const SOFT_FRAGMENT = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSharp;
uniform float uTail;
uniform float uPulse;
uniform float uLen;
uniform float uTime;
uniform vec2 uNear;
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
varying vec3 vPos;
void main() {
  float f = abs(dot(normalize(vN), normalize(vV)));
  float a = pow(f, uSharp) * mix(uTail, 1.0, vUv.y);
  a *= smoothstep(uNear.x, uNear.y, length(vPos));
  a *= 1.0 - uPulse * (0.5 + 0.5 * sin(vUv.y * uLen * 1.3 - uTime * 34.0));
  gl_FragColor = vec4(uColor, a * uOpacity);
}`;

// A flat disc, bright in the middle and fading to its edge.
const DISC_FRAGMENT = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSharp;
varying vec2 vUv;
void main() {
  float r = distance(vUv, vec2(0.5)) * 2.0;
  gl_FragColor = vec4(uColor, pow(max(0.0, 1.0 - r), uSharp) * uOpacity);
}`;

/**
 * @param {Object} ctx
 * @param {Object} S the aliens' shared state (see aliens.js)
 * @param {Object} api every aliens module's functions, by name
 * @returns {Object}
 */
export function createAlienWeapons(ctx, S, api) {
  const { Sim } = ctx;
  /** @type {THREE.BufferGeometry[]} */
  let geos = [];

  /**
   * @param {string} fragmentShader
   * @param {THREE.Color} colour
   * @param {number} sharp how fast it fades to its rim (higher: thinner)
   * @param {number[]} [near] SHOT_FADE or LASER_FADE
   * @returns {THREE.ShaderMaterial}
   */
  function softMaterial(fragmentShader, colour, sharp, near = SHOT_FADE) {
    return new THREE.ShaderMaterial({
      vertexShader: SOFT_VERTEX,
      fragmentShader,
      uniforms: {
        uColor: { value: colour.clone() }, uOpacity: { value: 0 }, uSharp: { value: sharp },
        uTail: { value: 1 }, uPulse: { value: 0 }, uLen: { value: 1 }, uTime: { value: 0 },
        uNear: { value: new THREE.Vector2(near[0], near[1]) }
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
  }

  /**
   * @param {THREE.BufferGeometry} geometry
   * @param {THREE.Material} material
   * @returns {THREE.Mesh}
   */
  function mesh(geometry, material) {
    const m = new THREE.Mesh(geometry, material);
    m.frustumCulled = false;
    m.visible = false;
    m.renderOrder = 4;
    return m;
  }

  /**
   * The pool of shots and the trackers, made once (aliens.js initAliens).
   * @returns {void}
   */
  function initWeapons() {
    const scene = Sim.three.scene;
    // Unit tube along +y from its base, radius 1: scaled per shot.
    const tube = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    tube.translate(0, 0.5, 0);
    const ball = new THREE.SphereGeometry(1, 14, 10);
    const ring = new THREE.RingGeometry(0.82, 1, 40);
    const disc = new THREE.CircleGeometry(1, 28);
    disc.rotateX(-Math.PI / 2);
    const reticle = new THREE.RingGeometry(0.9, 1, 48);
    reticle.rotateX(-Math.PI / 2);
    geos = [tube, ball, ring, disc, reticle];

    const g = RAY_COLOURS.green;
    for (let i = 0; i < ALIENS.rayMax; i++) {
      const bolt = new THREE.Group();
      bolt.name = 'alien_ray';
      bolt.visible = false;
      const core = mesh(tube, softMaterial(SOFT_FRAGMENT, g.core, 1.2));
      const glow = mesh(tube, softMaterial(SOFT_FRAGMENT, g.glow, 2.6));
      core.visible = glow.visible = true;
      bolt.add(core, glow);
      const trail = mesh(tube, softMaterial(SOFT_FRAGMENT, g.glow, 1.6));
      const flare = mesh(ball, softMaterial(SOFT_FRAGMENT, g.flare, 1.8));
      const spark = mesh(ball, softMaterial(SOFT_FRAGMENT, g.splash, 1.6));
      const wave = mesh(ring, new THREE.MeshBasicMaterial({
        color: g.splash, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      }));
      scene.add(bolt, trail, flare, spark, wave);
      S.rays.push({
        bolt, core, glow, trail, flare, spark, wave,
        from: new THREE.Vector3(), to: new THREE.Vector3(), dir: new THREE.Vector3(),
        length: 0, travelled: 0, age: 0, hitAge: -1, style: 'crew', live: false,
        /** @type {Object|null} a damagePlayer request, sent when the bolt lands */
        hit: null, sizzle: false, bright: 1
      });
    }

    /**
     * @param {'green'|'red'} colour
     * @returns {Object}
     */
    const tracker = (colour) => {
      const c = RAY_COLOURS[colour];
      const group = new THREE.Group();
      group.name = 'alien_laser';
      const core = mesh(tube, softMaterial(SOFT_FRAGMENT, c.core, 1.1, LASER_FADE));
      const glow = mesh(tube, softMaterial(SOFT_FRAGMENT, c.glow, 2.4, LASER_FADE));
      core.visible = glow.visible = true;
      group.add(core, glow);
      group.visible = false;
      const foot = mesh(disc, softMaterial(DISC_FRAGMENT, c.splash, 2.2));
      const aim = mesh(reticle, new THREE.MeshBasicMaterial({
        color: c.flare, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
      }));
      scene.add(group, foot, aim);
      // `source` keys the health damage table; `struck` is the once-per-burst re-arm flag.
      return {
        group, core, glow, foot, aim, colour, active: false, timer: 0, cooldown: 2, fx: 0, fz: 0,
        source: colour === 'green' ? 'ufoTracker' : 'hunterTracker', struck: false
      };
    };
    S.shipTracker = tracker('green');
    S.hunterTrackers = [];
    for (let i = 0; i < ALIENS.hunterCount + ALIENS.extraHunters; i++) S.hunterTrackers.push(tracker('red'));
  }

  /**
   * @param {Object} ray
   * @returns {void}
   */
  function hideShot(ray) {
    ray.live = false;
    ray.hit = null;
    ray.bolt.visible = ray.trail.visible = ray.flare.visible = ray.spark.visible = ray.wave.visible = false;
  }

  /**
   * @param {THREE.Material} material
   * @param {THREE.Color} colour
   * @returns {void}
   */
  function tint(material, colour) {
    const m = /** @type {any} */ (material);
    if (m.uniforms) m.uniforms.uColor.value.copy(colour);
    else m.color.copy(colour);
  }

  /**
   * A shot from a point (a gun's muzzle, a ship's belly) to another. The
   * crew's is a bolt that flies there; a ship's an instant lance. `hit`, if
   * given, is a damagePlayer request sent when the shot lands.
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} to
   * @param {'green'|'red'} [colour]
   * @param {{style?: 'crew'|'ship', hit?: Object|null, sizzle?: boolean}} [options]
   *   sizzle: it lands on Roger (a hit sound even when he is shielded)
   * @returns {void}
   */
  function fireRay(from, to, colour = 'green', options = {}) {
    const style = options.style || (colour === 'red' ? 'ship' : 'crew');
    let ray = null;
    for (const r of S.rays) if (!r.live) { ray = r; break; }
    // All busy: the oldest makes way (its pending hit lands now).
    if (!ray) {
      ray = S.rays[0];
      for (const r of S.rays) if (r.age > ray.age) ray = r;
      land(ray);
      hideShot(ray);
    }
    const length = ray.dir.subVectors(to, from).length();
    if (length < 0.01) return;
    ray.dir.divideScalar(length);
    ray.from.copy(from);
    ray.to.copy(to);
    ray.length = length;
    ray.travelled = 0;
    ray.age = 0;
    ray.hitAge = -1;
    ray.style = style;
    ray.hit = options.hit || null;
    ray.sizzle = !!options.sizzle;
    ray.live = true;
    const c = RAY_COLOURS[colour];
    tint(ray.core.material, c.core);
    tint(ray.glow.material, c.glow);
    tint(ray.trail.material, c.glow);
    tint(ray.flare.material, c.flare);
    tint(ray.spark.material, c.splash);
    tint(ray.wave.material, c.splash);
    ray.bolt.quaternion.setFromUnitVectors(UP, ray.dir);
    ray.trail.quaternion.copy(ray.bolt.quaternion);
    ray.trail.position.copy(from);
    const look = SHOTS[style];
    ray.core.scale.set(look.core, 1, look.core);
    ray.glow.scale.set(look.glow, 1, look.glow);
    const coreU = ray.core.material.uniforms;
    const glowU = ray.glow.material.uniforms;
    // The bolt is brightest at its head; the lance even, with bands.
    coreU.uTail.value = glowU.uTail.value = style === 'crew' ? 0.15 : 1;
    coreU.uPulse.value = 0;
    glowU.uPulse.value = style === 'ship' ? 0.55 : 0;
    glowU.uLen.value = length;
    ray.flare.position.copy(from);
    ray.flare.scale.setScalar(style === 'ship' ? 0.9 : 0.35);
    ray.flare.visible = true;
    ray.bolt.visible = true;
    if (style === 'ship') {
      ray.bolt.position.copy(from);
      ray.bolt.scale.set(1, length, 1);
      ray.travelled = length;
      land(ray);
      ctx.systems.creatureSounds.play('shipBolt', from, { size: 6 });
    } else {
      ray.trail.visible = true;
      ray.trail.material.uniforms.uTail.value = 0;
    }
  }

  /**
   * Where a shot arrives: the spark, the ring, the hit and its sizzle.
   * @param {Object} ray
   * @returns {void}
   */
  function land(ray) {
    if (!ray.live || ray.hitAge >= 0) return;
    ray.hitAge = 0;
    // Impacts round Roger share one brightness: the more at once, the dimmer
    // each one, so a crossfire stays readable.
    let near = 0;
    const hero = api.heroTarget(ray.to.x, ray.to.z);
    if (hero && Math.hypot(hero.x - ray.to.x, hero.z - ray.to.z) < SHOTS.nearRoger) {
      for (const r of S.rays) {
        if (r !== ray && r.live && r.hitAge >= 0 && r.hitAge < 0.2 && Math.hypot(hero.x - r.to.x, hero.z - r.to.z) < SHOTS.nearRoger) near++;
      }
    }
    ray.bright = 1 / (1 + near);
    ray.spark.position.copy(ray.to);
    ray.wave.position.copy(ray.to);
    ray.spark.visible = ray.wave.visible = true;
    if (ray.hit) {
      const request = ray.hit;
      ray.hit = null;
      ctx.systems.health.damagePlayer(request);
    }
    if (ray.sizzle) ctx.systems.creatureSounds.play('rayImpact', ray.to, { size: 1.5 });
  }

  /**
   * Raises an alien's gun arm at a point and shoots it from the muzzle.
   * @param {Alien} alien
   * @param {THREE.Vector3} to
   * @param {{hit?: Object|null, sizzle?: boolean}} [options] see fireRay
   * @returns {void}
   */
  function shoot(alien, to, options) {
    const p = alien.root.position;
    alien.heading = Math.atan2(to.x - p.x, to.z - p.z);
    alien.root.rotation.y = alien.heading;
    raiseGun(alien, to);
    alien.aim = Math.max(alien.aim, ALIENS.aimHold);
    alien.root.updateMatrixWorld(true);
    const from = alien.muzzle.getWorldPosition(S.scratch);
    fireRay(from, to, 'green', { style: 'crew', hit: options?.hit, sizzle: options?.sizzle });
    ctx.systems.creatureSounds.play('alienZap', from, { pitch: ctx.systems.creatureSounds.pitchOf(alien), size: 3 });
  }

  /**
   * The gun arm straight out at a point: forward, and tipped up or down
   * with the height of what it is aimed at.
   * @param {Alien} alien
   * @param {THREE.Vector3|null} to
   * @returns {void}
   */
  function raiseGun(alien, to) {
    let tilt = 0;
    if (to) {
      const p = alien.root.position;
      const shoulder = 1.1 * ALIENS.scale;
      tilt = Math.atan2(to.y - shoulder, Math.hypot(to.x - p.x, to.z - p.z) || 1);
    }
    alien.limbs.armR.rotation.x = -Math.PI / 2 - THREE.MathUtils.clamp(tilt, -0.8, 0.8);
    alien.limbs.armR.rotation.z = 0.05;
  }

  /** @param {number} dt @returns {void} */
  function updateRays(dt) {
    const cam = Sim.three.camera;
    for (const ray of S.rays) {
      if (!ray.live) continue;
      ray.age += dt;
      const look = SHOTS[ray.style];
      // The muzzle flash: a quick pop.
      const fk = Math.max(0, 1 - ray.age / 0.12);
      ray.flare.material.uniforms.uOpacity.value = fk * (ray.style === 'ship' ? 1 : 0.8);
      ray.flare.visible = fk > 0;
      const coreU = ray.core.material.uniforms;
      const glowU = ray.glow.material.uniforms;
      if (ray.style === 'crew') {
        if (ray.hitAge < 0) {
          ray.travelled = Math.min(ray.length, ray.travelled + look.speed * dt);
          const tail = Math.max(0, ray.travelled - look.head);
          ray.bolt.position.copy(ray.from).addScaledVector(ray.dir, tail);
          ray.bolt.scale.set(1, Math.max(0.01, ray.travelled - tail), 1);
          // Over its last few metres the bolt dims into its own spark, so
          // a volley meeting on Roger never piles up into one white star.
          const into = Math.min(1, 0.2 + (ray.length - ray.travelled) / 6);
          coreU.uOpacity.value = into;
          glowU.uOpacity.value = 0.4 * into;
          if (ray.travelled >= ray.length) land(ray);
        } else {
          ray.bolt.visible = false;
        }
        // The tracer: from the gun to the bolt's tail, fading out behind it.
        const flight = ray.length / look.speed;
        const tk = Math.max(0, 1 - Math.max(0, ray.age - flight * 0.5) / (flight * 0.5 + look.trail));
        const reach = Math.max(0.01, Math.min(ray.travelled, ray.length));
        ray.trail.scale.set(look.core * 0.9, reach, look.core * 0.9);
        ray.trail.material.uniforms.uOpacity.value = 0.35 * tk;
        ray.trail.visible = tk > 0;
      } else {
        // The lance: it bursts in wide and narrows as it fades, strobing.
        const k = Math.max(0, 1 - ray.age / look.life);
        const strobe = 0.7 + 0.3 * Math.sin(ray.age * 70);
        const w = 0.5 + 0.9 * k;
        ray.core.scale.set(look.core * w, 1, look.core * w);
        ray.glow.scale.set(look.glow * w, 1, look.glow * w);
        coreU.uOpacity.value = k * strobe;
        glowU.uOpacity.value = 0.5 * k * strobe;
        glowU.uTime.value = ray.age;
        if (k <= 0) ray.bolt.visible = false;
      }
      // Where it landed: a small spark and a ring running out, facing the eye.
      if (ray.hitAge >= 0) {
        ray.hitAge += dt;
        const k = Math.max(0, 1 - ray.hitAge / look.impact);
        const size = SHOTS.impactSize * (ray.style === 'ship' ? 1.6 : 1);
        ray.spark.scale.setScalar(size * (0.6 + 0.8 * (1 - k)));
        ray.spark.material.uniforms.uOpacity.value = k * k * ray.bright;
        ray.wave.scale.setScalar(size * 0.6 + SHOTS.ringSize * (ray.style === 'ship' ? 1.5 : 1) * (1 - k));
        ray.wave.material.opacity = 0.4 * k * ray.bright;
        ray.wave.lookAt(cam.position);
        if (k <= 0 && !ray.bolt.visible && !ray.trail.visible) hideShot(ray);
        else if (k <= 0) ray.spark.visible = ray.wave.visible = false;
      }
      if (ray.age > 3) hideShot(ray);
    }
  }

  /**
   * A ship's tracking laser on Roger: it comes down off to one side of him
   * and crawls after him, slower than he runs, for ALIENS.laserSeconds. For
   * the first ALIENS.laserWarm it is only a thin aiming line and a reticle
   * closing on the ground; then it burns.
   * @param {Object} tr one of the trackers made in initWeapons
   * @param {THREE.Vector3} from where it leaves the ship
   * @param {boolean} armed whether this ship may start a new burst now
   * @param {number} dt
   * @returns {void}
   */
  function updateTracker(tr, from, armed, dt) {
    const hero = api.heroTarget(from.x, from.z);
    if (!tr.active) {
      tr.cooldown -= dt;
      const inRange = hero && Math.hypot(hero.x - from.x, hero.z - from.z) < ALIENS.laserRange;
      if (!armed || !inRange || tr.cooldown > 0) {
        tr.group.visible = tr.foot.visible = tr.aim.visible = false;
        return;
      }
      tr.active = true;
      tr.timer = 0;
      tr.struck = false; // re-armed: each burst may hurt Roger once
      const a = Math.random() * Math.PI * 2;
      tr.fx = hero.x + Math.cos(a) * ALIENS.laserStart;
      tr.fz = hero.z + Math.sin(a) * ALIENS.laserStart;
      ctx.systems.heroSound.playShipLaser(ALIENS.laserSeconds, ALIENS.laserWarm, tr.colour);
    }
    tr.timer += dt;
    const burning = tr.timer >= ALIENS.laserWarm;
    if (hero) {
      const dx = hero.x - tr.fx;
      const dz = hero.z - tr.fz;
      const d = Math.hypot(dx, dz);
      const step = Math.min(d, ALIENS.laserSpeed * dt);
      if (d > 0.01) {
        tr.fx += (dx / d) * step;
        tr.fz += (dz / d) * step;
      }
      // Discrete hit, once per 3.2 s burst: `struck` is cleared only when the
      // next burst starts, so the beam never ticks per frame. A hit the spawn
      // shield or hit window refuses does not use up the burst. The aiming
      // line never hurts.
      if (burning && !tr.struck && d - step < ALIENS.laserKill) {
        const res = ctx.systems.health.damagePlayer({
          source: tr.source, type: 'ray', title: 'VAPORISED', sub: 'An alien ship\'s laser caught Roger', targetId: hero.id ?? '0',
          position: { x: from.x, y: from.y, z: from.z }
        });
        if (res.applied) tr.struck = true;
      }
    }
    const to = S.scratch.set(tr.fx, 0.1, tr.fz);
    const dir = S.trackerDir.subVectors(to, from);
    const length = dir.length();
    tr.group.position.copy(from);
    tr.group.quaternion.setFromUnitVectors(UP, dir.divideScalar(length || 1));
    tr.group.scale.set(1, length, 1);
    const coreU = tr.core.material.uniforms;
    const glowU = tr.glow.material.uniforms;
    const footU = tr.foot.material.uniforms;
    tr.aim.position.set(tr.fx, 0.14, tr.fz);
    if (!burning) {
      // The warning: a thin flickering line and a reticle closing in.
      const w = tr.timer / ALIENS.laserWarm;
      tr.core.scale.set(SHOTS.laserCore * 0.3, 1, SHOTS.laserCore * 0.3);
      coreU.uOpacity.value = 0.45 * (0.6 + 0.4 * Math.sin(tr.timer * 60));
      glowU.uOpacity.value = 0;
      footU.uOpacity.value = 0;
      tr.aim.scale.setScalar(SHOTS.laserFoot * (2.6 - 1.6 * w));
      tr.aim.rotation.y = tr.timer * 3;
      tr.aim.material.opacity = 0.7 * w;
      tr.aim.visible = true;
    } else {
      // The beam: a hot core, a soft glow with bands running down it, a
      // glowing patch on the ground. It thins out over its last 0.25 s.
      const end = Math.min(1, (ALIENS.laserSeconds - tr.timer) / 0.25);
      const flicker = 0.85 + 0.15 * Math.sin(tr.timer * 47);
      const w = Math.max(0.05, end);
      tr.core.scale.set(SHOTS.laserCore * w * flicker, 1, SHOTS.laserCore * w * flicker);
      tr.glow.scale.set(SHOTS.laserGlow * w, 1, SHOTS.laserGlow * w);
      coreU.uOpacity.value = 0.9;
      glowU.uOpacity.value = 0.45 * flicker;
      glowU.uPulse.value = 0.45;
      glowU.uLen.value = length;
      glowU.uTime.value = tr.timer;
      tr.foot.position.set(tr.fx, 0.13, tr.fz);
      tr.foot.scale.setScalar(SHOTS.laserFoot * (0.9 + 0.15 * flicker));
      footU.uOpacity.value = 0.6 * w;
      tr.foot.visible = true;
      tr.aim.scale.setScalar(SHOTS.laserFoot * (1.1 + 0.1 * Math.sin(tr.timer * 9)));
      tr.aim.rotation.y = tr.timer * 3;
      tr.aim.material.opacity = 0.35 * w;
      if (Math.random() < dt * 10 && ctx.systems.earthquake) ctx.systems.earthquake.kickDust(tr.fx, tr.fz, 1, 0.8);
    }
    tr.group.visible = true;
    if (tr.timer >= ALIENS.laserSeconds || !hero) {
      tr.active = false;
      tr.cooldown = api.between(ALIENS.laserEvery);
      tr.group.visible = tr.foot.visible = tr.aim.visible = false;
    }
  }

  /**
   * @param {Object} tr
   * @returns {void}
   */
  function stopTracker(tr) {
    if (!tr) return;
    tr.active = false;
    tr.cooldown = api.between(ALIENS.laserEvery);
    tr.group.visible = tr.foot.visible = tr.aim.visible = false;
  }

  /**
   * Every shot gone, its pending hit with it (a reset replaces the run).
   * @returns {void}
   */
  function resetWeapons() {
    for (const ray of S.rays) hideShot(ray);
  }

  /** @returns {void} */
  function disposeWeapons() {
    const scene = Sim.three.scene;
    for (const ray of S.rays) {
      scene.remove(ray.bolt, ray.trail, ray.flare, ray.spark, ray.wave);
      for (const m of [ray.core, ray.glow, ray.trail, ray.flare, ray.spark, ray.wave]) m.material.dispose();
    }
    S.rays.length = 0;
    for (const tr of [S.shipTracker, ...S.hunterTrackers]) {
      if (!tr) continue;
      scene.remove(tr.group, tr.foot, tr.aim);
      for (const m of [tr.core, tr.glow, tr.foot, tr.aim]) m.material.dispose();
    }
    S.shipTracker = null;
    S.hunterTrackers = [];
    for (const geo of geos) geo.dispose();
    geos = [];
  }

  return { initWeapons, fireRay, shoot, raiseGun, updateRays, updateTracker, stopTracker, resetWeapons, disposeWeapons };
}
