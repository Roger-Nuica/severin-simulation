// @ts-check
import * as THREE from 'three';
import { SUPPORT } from './config.js';

/**
 * ===========================================================================
 * SECTION SS.6 — The Rocket Strike
 * ===========================================================================
 * Landing Support's second option (T again in targeting mode): a rocket
 * falls from altitude onto the marker and goes off. It does not land.
 *
 *  - **The fall**, ROCKET.fallSeconds, accelerating, seen from the rocket's
 *    nose looking down -- the old landing's cockpit view, now a nose
 *    camera: the dark frame round a round window, the altitude and the
 *    distance to the impact point on the HUD, wind and flame streaks
 *    rushing past, the shake and the rumble (sound/rocket.js) climbing all
 *    the way down. W A S D nudge the impact point (up on the screen is the
 *    way the rocket is heading), within ROCKET.steerRadius of the marker;
 *    the last ROCKET.lockSeconds are locked. Roger stands where he was and
 *    keeps none of the keys while it falls.
 *  - **The impact**: the tanker's explosion at twice its reach -- the
 *    fireball, the secondaries out to twice the tanker's spread -- and then
 *    a fire EMP: a ring of fire and plasma (explosions/megaBlast.js, the
 *    pressure wave, with a wall of flame riding it) sweeping out across
 *    ROCKET.blastRadius. Everything inside goes as it passes: every building
 *    brought down, cars wrecked, trees flattened, the townspeople, every
 *    enemy through its own rules (a mega plasma hit, an EMP, fire -- the
 *    Cyber Yeti answers only to the fire, and shrugs it off), the aliens on
 *    the ground and in the air (the ship and the hunters shot down), the
 *    samurai, Roger. The mothership takes ROCKET.mothershipDamage of its
 *    15 hull points -- heavy, not a kill on its own. Screen shake, a white
 *    flash, dust, a crater, a column of smoke climbing into a cap.
 *  - **After**: in Hero Mode the camera glides back to Roger; otherwise
 *    it circles the crater for ROCKET.orbitSeconds and glides back to
 *    wherever it was.
 * SUPPORT.cooldown seconds before the next one.
 */

export const ROCKET = {
  fallSeconds: 6,
  startHeight: 560,
  drift: 70,                 // the run-in: it starts this far back along its heading
  lockSeconds: 1,            // the last of the fall, no steering
  steerRadius: 28,           // metres the impact point may be moved from the marker
  steerSpeed: 24,            // metres a second it moves at
  blastRadius: 80,           // everything inside goes (ring B); the tanker's fireball reaches ~40
  craterRadius: 34,
  score: 6000,
  mothershipDamage: 8,       // of its 15 hull points
  shipDamage: 99,            // an alien ship or hunter in reach: down
  streaks: 110,
  orbitSeconds: 3,
  orbitDistance: 150,
  orbitHeight: 75
};

/**
 * The blast (explosions/megaBlast.js): a fireball in the tanker's style
 * (its strength 42, here 46), secondaries over twice its spread (84), and
 * the wave as a fire EMP ring out to the blast radius -- slow enough to be
 * watched sweeping out -- and on as a pressure wave past it.
 * @type {import('../explosions/megaBlast.js').MegaBlastConfig}
 */
const ROCKET_BLAST = {
  core: 46,
  ringCount: 8,
  ringRadius: 26,
  ringStrength: 26,
  satellites: 20,
  satelliteSpread: 168,
  satelliteInterval: 0.05,
  satelliteStrength: [12, 24],
  shockSpeed: 70,
  radius: ROCKET.blastRadius * 1.6,
  throwForce: 85,
  buildingShock: 5,
  fireRadius: ROCKET.blastRadius * 1.1,
  killRadius: ROCKET.blastRadius,
  throwPeople: true,
  mushroom: {
    rise: 150, riseSeconds: 4, stem: 7, cap: 30, linger: 10, fade: 6,
    fire: new THREE.Color(2.6, 1.1, 0.35), smoke: 0x3a3230, skirt: 0x463c36
  },
  ringColour: new THREE.Color(3.2, 1.0, 1.4),
  flash: { colour: '#ffd8a8', peak: 0.6, hold: 0.15, seconds: 1.6 },
  event: 'tanker',
  heroKill: { title: 'ROCKET STRIKE', sub: 'Roger was inside the blast' }
};

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see spaceship.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createRocketStrike(ctx, S, api) {
  const { Sim } = ctx;
  const R = {
    /** @type {'idle'|'falling'|'orbit'} */
    phase: 'idle',
    t: 0,
    marker: new THREE.Vector3(),
    aim: new THREE.Vector3(),
    pos: new THREE.Vector3(),
    heading: new THREE.Vector3(0, 0, -1),
    keys: { up: false, down: false, left: false, right: false },
    savedPos: new THREE.Vector3(),
    savedTarget: new THREE.Vector3(),
    lastY: 0,
    // The blast's own wall of flame, riding its front.
    wallAge: -1,
    wallRadius: 0,
    /** @type {Set<any>} what the fire EMP has already reached */
    done: new Set()
  };
  const look = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  /** @type {THREE.InstancedMesh|null} */
  let streaks = null;
  /** @type {{x: number, y: number, z: number, len: number}[]} */
  const streakAt = [];
  /** @type {THREE.Mesh|null} the impact point, a red ring that follows the steering */
  let aimRing = null;
  /** @type {THREE.Mesh|null} how far it may be steered */
  let limitRing = null;
  /** @type {THREE.Mesh|null} */
  let wall = null;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  /** @type {AbortController|null} the keys while it falls */
  let keyListeners = null;

  /** @returns {void} */
  function initRocket() {
    const streakGeo = new THREE.BoxGeometry(0.07, 1, 0.07);
    streaks = new THREE.InstancedMesh(streakGeo, new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false
    }), ROCKET.streaks);
    streaks.name = 'rocket_streaks';
    streaks.frustumCulled = false;
    streaks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const wind = new THREE.Color(0.75, 0.82, 0.95);
    const flame = new THREE.Color(2.4, 0.9, 0.25);
    for (let i = 0; i < ROCKET.streaks; i++) {
      streaks.setColorAt(i, i % 4 === 0 ? flame : wind);
      streakAt.push({ x: 0, y: -1e5, z: 0, len: 1 });
    }
    streaks.visible = false;
    Sim.three.scene.add(streaks);

    const ring = (/** @type {number} */ inner, /** @type {number} */ outer, /** @type {THREE.Color} */ colour) => {
      const geo = new THREE.RingGeometry(inner, outer, 72);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: colour, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
      }));
      mesh.visible = false;
      mesh.renderOrder = 3;
      Sim.three.scene.add(mesh);
      return mesh;
    };
    aimRing = ring(ROCKET.blastRadius - 1.6, ROCKET.blastRadius, new THREE.Color(3, 0.35, 0.25));
    aimRing.name = 'rocket_aim_ring';
    limitRing = ring(ROCKET.steerRadius - 0.4, ROCKET.steerRadius, new THREE.Color(1.4, 1.4, 1.4));
    limitRing.name = 'rocket_steer_limit';

    // The fire EMP's wall: an open cylinder, hot at the ground and gone at
    // the top, scaled out with the blast's front.
    const wallGeo = new THREE.CylinderGeometry(1, 1, 1, 64, 4, true);
    wallGeo.translate(0, 0.5, 0);
    const colours = new Float32Array(wallGeo.attributes.position.count * 3);
    for (let i = 0; i < wallGeo.attributes.position.count; i++) {
      const y = wallGeo.attributes.position.getY(i);
      const k = Math.pow(1 - y, 1.6);
      colours[i * 3] = 2.6 * k;
      colours[i * 3 + 1] = 0.75 * k;
      colours[i * 3 + 2] = 1.3 * k;
    }
    wallGeo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    wall = new THREE.Mesh(wallGeo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide
    }));
    wall.name = 'rocket_fire_wall';
    wall.frustumCulled = false;
    wall.visible = false;
    Sim.three.scene.add(wall);
  }

  /** @returns {boolean} whether the rocket has the camera */
  function rocketActive() {
    return R.phase !== 'idle';
  }

  /**
   * T again in targeting mode: the rocket on its way to (x, z).
   * @param {number} x
   * @param {number} z
   * @returns {boolean} whether it was fired
   */
  function fireRocket(x, z) {
    if (R.phase !== 'idle' || S.cooldown.rocket > 0) return false;
    const camera = Sim.three.camera;
    R.marker.set(x, 0, z);
    R.aim.copy(R.marker);
    R.heading.set(x - camera.position.x, 0, z - camera.position.z);
    if (R.heading.lengthSq() < 1) R.heading.set(0, 0, -1);
    R.heading.normalize();
    R.savedPos.copy(camera.position);
    R.savedTarget.copy(Sim.three.controls.target);
    R.phase = 'falling';
    R.t = 0;
    R.lastY = ROCKET.startHeight;
    // A glide still going (the samurai ship's) would fight the nose camera.
    ctx.systems.camera.resetCamera();
    Sim.three.controls.enabled = false;
    document.body.classList.add('ship-cutscene');
    if (S.cockpit) S.cockpit.classList.add('visible');
    if (S.fader) {
      // Cut in through black.
      S.fader.style.transition = 'none';
      S.fader.style.opacity = '1';
      void S.fader.offsetWidth;
      S.fader.style.transition = 'opacity 0.45s ease';
      S.fader.style.opacity = '0';
    }
    attachKeys();
    // Roger stops where he is: the keys are the rocket's now.
    const held = ctx.systems.playerInput && ctx.systems.playerInput.held;
    if (held) held.up = held.down = held.left = held.right = false;
    for (const s of streakAt) s.y = -1e5;
    if (streaks) streaks.visible = true;
    if (limitRing) {
      limitRing.position.set(x, 0.07, z);
      limitRing.visible = true;
    }
    return true;
  }

  // ---------------------------------------------------------------------
  // The keys while it falls
  // ---------------------------------------------------------------------

  /** @returns {void} */
  function attachKeys() {
    detachKeys();
    keyListeners = new AbortController();
    const signal = AbortSignal.any ? AbortSignal.any([keyListeners.signal, ctx.signal]) : keyListeners.signal;
    /**
     * @param {KeyboardEvent} e
     * @param {boolean} down
     * @returns {void}
     */
    const handle = (e, down) => {
      const key = { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' }[e.code];
      if (!key) return;
      R.keys[/** @type {keyof typeof R.keys} */ (key)] = down;
      // Before Hero Mode's own listener: Roger does not run while it falls.
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', (e) => handle(e, true), { signal, capture: true });
    window.addEventListener('keyup', (e) => handle(e, false), { signal, capture: true });
  }

  /** @returns {void} */
  function detachKeys() {
    if (keyListeners) keyListeners.abort();
    keyListeners = null;
    R.keys.up = R.keys.down = R.keys.left = R.keys.right = false;
  }

  // ---------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------

  /**
   * @param {number} u 0..1 through the fall
   * @returns {number} its height
   */
  function heightAt(u) {
    return ROCKET.startHeight * (1 - Math.pow(u, 1.7));
  }

  /**
   * Real time, held while paused (spaceship.js).
   * @param {number} dt
   * @returns {void}
   */
  function updateRocket(dt) {
    updateWall(dt);
    if (R.phase === 'falling') updateFall(dt);
    else if (R.phase === 'orbit') {
      R.t += dt;
      if (R.t >= ROCKET.orbitSeconds) endOrbit();
    }
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateFall(dt) {
    R.t = Math.min(ROCKET.fallSeconds, R.t + dt);
    const u = R.t / ROCKET.fallSeconds;
    const locked = R.t > ROCKET.fallSeconds - ROCKET.lockSeconds;
    if (!locked && dt > 0) {
      const along = (R.keys.up ? 1 : 0) - (R.keys.down ? 1 : 0);
      const across = (R.keys.right ? 1 : 0) - (R.keys.left ? 1 : 0);
      if (along || across) {
        // Up the screen is the heading; right of it, the heading turned a
        // quarter about up.
        let dx = R.heading.x * along - R.heading.z * across;
        let dz = R.heading.z * along + R.heading.x * across;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;
        R.aim.x += dx * ROCKET.steerSpeed * dt;
        R.aim.z += dz * ROCKET.steerSpeed * dt;
        const ox = R.aim.x - R.marker.x;
        const oz = R.aim.z - R.marker.z;
        const off = Math.hypot(ox, oz);
        if (off > ROCKET.steerRadius) {
          R.aim.x = R.marker.x + (ox / off) * ROCKET.steerRadius;
          R.aim.z = R.marker.z + (oz / off) * ROCKET.steerRadius;
        }
      }
    }
    const y = heightAt(u);
    const run = ROCKET.drift * (y / ROCKET.startHeight);
    R.pos.set(R.aim.x - R.heading.x * run, Math.max(1.5, y), R.aim.z - R.heading.z * run);
    const speed = dt > 0 ? (R.lastY - y) / dt : 0;
    R.lastY = y;
    if (aimRing) {
      aimRing.position.set(R.aim.x, 0.08, R.aim.z);
      aimRing.visible = true;
      aimRing.material.opacity = 0.55 + 0.35 * Math.sin(R.t * (locked ? 22 : 8));
    }
    if (dt > 0) ctx.systems.gamefeel.addShake(0.04 + 0.55 * u * u, 0.12);
    if (ctx.systems.rocketSound) ctx.systems.rocketSound.updateRocketSound(1, u);
    updateStreaks(speed);
    if (S.cockpit) {
      const dist = Math.hypot(R.pos.x - R.aim.x, R.pos.y, R.pos.z - R.aim.z);
      S.cockpit.querySelector('.ship-hud-alt').textContent = `ALT ${Math.round(y)} m`;
      S.cockpit.querySelector('.ship-hud-dist').textContent = `DIST ${Math.round(dist)} m`;
      S.cockpit.querySelector('.ship-hud-state').textContent = locked
        ? 'LOCKED'
        : `STEER W A S D · ${(ROCKET.fallSeconds - ROCKET.lockSeconds - R.t).toFixed(1)} s`;
      S.cockpit.classList.toggle('braking', locked);
    }
    if (R.t >= ROCKET.fallSeconds) impact();
  }

  /**
   * The streaks: still in the air (world space), long and thin, placed
   * round the rocket's path below it and passed as it falls -- radial lines
   * rushing out of the middle of the view. Re-placed below once passed.
   * @param {number} speed metres a second it is falling at
   * @returns {void}
   */
  function updateStreaks(speed) {
    if (!streaks) return;
    const len = THREE.MathUtils.clamp(speed * 0.07, 2, 16);
    for (let i = 0; i < ROCKET.streaks; i++) {
      const s = streakAt[i];
      if (s.y > R.pos.y + 4 || s.y < R.pos.y - 160) {
        const a = Math.random() * Math.PI * 2;
        const flame = i % 4 === 0;
        const r = flame ? 1.5 + Math.random() * 3 : 5 + Math.random() * 30;
        s.x = R.pos.x + Math.cos(a) * r;
        s.z = R.pos.z + Math.sin(a) * r;
        s.y = R.pos.y - (flame ? 2 + Math.random() * 20 : 10 + Math.random() * 140);
        if (s.y < 1) s.y = -1e5;
      }
      s.len = len * (i % 4 === 0 ? 0.6 : 1);
      sc.set(1, s.len, 1);
      m4.compose(scratch.set(s.x, s.y, s.z), q.identity(), sc);
      streaks.setMatrixAt(i, m4);
    }
    streaks.instanceMatrix.needsUpdate = true;
  }

  /**
   * The nose camera while it falls; the orbit round the crater after. After
   * every other camera writer (spaceship.js placeCamera).
   * @returns {void}
   */
  function placeRocketCamera() {
    const camera = Sim.three.camera;
    if (R.phase === 'falling') {
      camera.position.copy(R.pos);
      // Down at the impact point and a little ahead of it, so the view is
      // never straight down (no roll to settle) and the town is a place.
      const ahead = THREE.MathUtils.lerp(4, 30, R.t / ROCKET.fallSeconds);
      look.set(R.aim.x + R.heading.x * ahead, 0, R.aim.z + R.heading.z * ahead);
      camera.lookAt(look);
      Sim.three.controls.enabled = false;
      // Thin the fog for the height, as the cockpit did: the scene's fog is
      // tuned for a camera a hundred metres from the town.
      const fog = Sim.three.scene.fog;
      const range = camera.position.distanceTo(look);
      if (fog && fog.density) fog.density = Math.min(fog.density, 0.75 / Math.max(range, 1));
    } else if (R.phase === 'orbit') {
      const a = Math.atan2(-R.heading.x, -R.heading.z) + (R.t / ROCKET.orbitSeconds) * 1.4;
      camera.position.set(R.aim.x + Math.sin(a) * ROCKET.orbitDistance, ROCKET.orbitHeight, R.aim.z + Math.cos(a) * ROCKET.orbitDistance);
      look.set(R.aim.x, 18, R.aim.z);
      camera.lookAt(look);
      Sim.three.controls.target.copy(look);
      Sim.three.controls.enabled = false;
    }
  }

  // ---------------------------------------------------------------------
  // The impact
  // ---------------------------------------------------------------------

  /** @returns {void} */
  function impact() {
    detachKeys();
    const at = R.aim.clone();
    if (streaks) streaks.visible = false;
    if (aimRing) aimRing.visible = false;
    if (limitRing) limitRing.visible = false;
    if (S.cockpit) S.cockpit.classList.remove('visible', 'braking');
    if (ctx.systems.rocketSound) ctx.systems.rocketSound.playRocketBoom();
    R.done = new Set();
    ctx.systems.megaBlast.detonate(at, { ...ROCKET_BLAST, onFront: (previous, r) => sweep(at, previous, r) });
    ctx.systems.lightning.flashScreen(at.clone().setY(8), 1, '#ffd0a0');
    if (ctx.systems.earthquake) {
      const quake = ctx.systems.earthquake;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        quake.kickDust(at.x + Math.cos(a) * 18, at.z + Math.sin(a) * 18, 2, 3.2);
      }
    }
    api.addCrater(at, ROCKET.craterRadius);
    api.spawnShockRing(at, 6, ROCKET.blastRadius * 2.2, 0.8, 2.4, new THREE.Color(1, 0.55, 0.3));
    ctx.events.emit('explosion', { x: at.x, z: at.z, size: 3, source: null });
    ctx.systems.damage.addDamageScore(ROCKET.score);
    api.showBanner('ROCKET STRIKE', `Direct hit · +${ROCKET.score}`);
    R.wallAge = 0;
    R.wallRadius = 0;
    if (wall) {
      wall.position.set(at.x, 0, at.z);
      wall.visible = true;
    }
    S.cooldown.rocket = SUPPORT.cooldown;

    // The camera: back to Roger in Hero Mode, else a turn round the crater.
    if (ctx.Hero && ctx.Hero.active) {
      finish();
    } else {
      R.phase = 'orbit';
      R.t = 0;
    }
  }

  /**
   * The fire EMP passing from `previous` to `r` out of `at`: everything it
   * reaches inside the blast radius goes, once.
   * @param {THREE.Vector3} at
   * @param {number} previous
   * @param {number} r
   * @returns {void}
   */
  function sweep(at, previous, r) {
    R.wallRadius = r;
    const reach = Math.min(r, ROCKET.blastRadius);
    if (previous >= ROCKET.blastRadius) return;
    const s = ctx.systems;
    const damage = s.damage;
    // Every building: down.
    for (const building of ctx.Environment.buildings) {
      if (building.damageState === 'collapsed' || R.done.has(building)) continue;
      const p = building.mesh.position;
      if (Math.hypot(p.x - at.x, p.z - at.z) > reach) continue;
      R.done.add(building);
      damage.collapseBuilding(building, 0, at);
    }
    // Cars wrecked, trees flattened (megaBlast throws what is loose).
    for (const obj of Sim.objects.slice()) {
      if ((obj.type !== 'car' && obj.type !== 'tree') || R.done.has(obj)) continue;
      const pos = obj.pooled ? obj.position : (obj.mesh && obj.mesh.position);
      if (!pos) continue;
      const dx = pos.x - at.x;
      const dz = pos.z - at.z;
      const d = Math.hypot(dx, dz);
      if (d > reach) continue;
      R.done.add(obj);
      if (obj.type === 'tree') damage.flattenTree(obj, dx / (d || 1), dz / (d || 1));
      else damage.damageFromImpact(obj, scratch.set(pos.x, pos.y + 0.5, pos.z), 9000);
    }
    // Every enemy, through its own rules: the hardest hit it answers to,
    // then the EMP and the fire.
    /** @type {{e: any, kind: any}[]} */
    const reached = [];
    s.enemies.each((e, kind) => {
      // The hunter ships are hit once, by the shipTargets loop below
      // (ROCKET.shipDamage), as before they joined the register.
      if (kind.kind === 'hunterShip') return;
      if (R.done.has(e)) return;
      const p = kind.position(e);
      if (Math.hypot(p.x - at.x, p.z - at.z) > reach) return;
      R.done.add(e);
      reached.push({ e, kind });
    });
    for (const { e, kind } of reached) {
      const where = kind.position(e);
      const hitAt = { x: where.x, z: where.z };
      if (kind.accepts.includes('plasma') && s.enemies.hit(e, kind, { type: 'plasma', mega: true, at: hitAt })) continue;
      if (kind.accepts.includes('emp')) s.enemies.hit(e, kind, { type: 'emp', at: hitAt });
      if (kind.accepts.includes('fire') && kind.list().includes(e)) s.enemies.hit(e, kind, { type: 'fire', at: hitAt });
    }
    // The samurai: Roger called it in, so it is his weapon.
    api.hitSamuraiArea(at.x, at.z, reach, 'blast');
    // The ships in the air over it, once, as the front leaves the middle.
    if (previous === 0) {
      if (s.aliens) {
        for (const ship of s.aliens.shipTargets()) {
          if (Math.hypot(ship.x - at.x, ship.z - at.z) < ROCKET.blastRadius + ship.radius) {
            ship.hit(ROCKET.shipDamage, scratch.set(ship.x, ship.bottom, ship.z).clone());
          }
        }
      }
      const mother = s.mothership && s.mothership.shipTarget();
      if (mother && Math.hypot(mother.x - at.x, mother.z - at.z) < ROCKET.blastRadius + mother.radius) {
        const left = mother.hit(ROCKET.mothershipDamage, scratch.set(mother.x, mother.bottom, mother.z).clone());
        if (left > 0) ctx.events.emit('notice', { text: `🛸 MOTHERSHIP HIT · HULL ${Math.round(left * 100)}%` });
      }
      if (s.powerLines) s.powerLines.faultAt(at.x, at.z, ROCKET.blastRadius);
    }
    // Fire along the front as it goes.
    if (r <= ROCKET.blastRadius * 1.05) {
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2;
        s.explosions.spawnImpactBurst(scratch.set(at.x + Math.cos(a) * r, 1.5 + Math.random() * 3, at.z + Math.sin(a) * r), 2.5 + Math.random() * 2.5);
      }
    }
  }

  /**
   * The wall of flame riding the front, fading as it reaches the edge.
   * @param {number} dt
   * @returns {void}
   */
  function updateWall(dt) {
    if (!wall || R.wallAge < 0) return;
    R.wallAge += dt;
    const r = Math.max(1, R.wallRadius);
    const u = Math.min(1, r / ROCKET.blastRadius);
    wall.scale.set(r, 10 * (1 - 0.5 * u) + 2, r);
    const fade = R.wallRadius >= ROCKET.blastRadius ? Math.max(0, 1 - (R.wallAge - ROCKET.blastRadius / ROCKET_BLAST.shockSpeed) / 0.6) : 1;
    wall.material.opacity = 0.9 * fade;
    if (fade <= 0 || R.wallAge > 6) {
      wall.visible = false;
      R.wallAge = -1;
    }
  }

  /** @returns {void} the orbit over: back to where the camera was */
  function endOrbit() {
    // From here, over a glide, into whatever drives the camera now (the
    // cinematic orbit, or the free camera put back where it was).
    ctx.systems.camera.easeIntoMode();
    if (!(ctx.Cinematic && ctx.Cinematic.active)) {
      Sim.three.camera.position.copy(R.savedPos);
      Sim.three.controls.target.copy(R.savedTarget);
      Sim.three.camera.lookAt(R.savedTarget);
    }
    finish();
  }

  /** @returns {void} the camera handed back */
  function finish() {
    if (R.phase === 'falling' || (ctx.Hero && ctx.Hero.active)) ctx.systems.camera.easeIntoMode();
    R.phase = 'idle';
    detachKeys();
    if (!(ctx.Hero && ctx.Hero.active)) Sim.three.controls.enabled = true;
    document.body.classList.remove('ship-cutscene');
    if (ctx.systems.rocketSound) ctx.systems.rocketSound.updateRocketSound(0, 0);
  }

  /** @returns {void} */
  function resetRocket() {
    if (R.phase !== 'idle') {
      Sim.three.controls.enabled = true;
      document.body.classList.remove('ship-cutscene');
    }
    R.phase = 'idle';
    R.wallAge = -1;
    detachKeys();
    for (const mesh of [streaks, aimRing, limitRing, wall]) if (mesh) mesh.visible = false;
    if (ctx.systems.rocketSound) ctx.systems.rocketSound.updateRocketSound(0, 0);
  }

  /** @returns {void} */
  function disposeRocket() {
    resetRocket();
    for (const mesh of [streaks, aimRing, limitRing, wall]) {
      if (!mesh) continue;
      Sim.three.scene.remove(mesh);
      mesh.geometry.dispose();
      /** @type {THREE.Material} */ (mesh.material).dispose();
    }
    if (streaks) streaks.dispose();
    streaks = aimRing = limitRing = wall = null;
  }

  return { initRocket, rocketActive, fireRocket, updateRocket, placeRocketCamera, resetRocket, disposeRocket };
}
