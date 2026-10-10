import * as THREE from 'three';
import { createSoftDotTexture } from '../utils/textures.js';
import { createParticlePool, disposeParticlePool } from './particlePool.js';
import { VIADUCT_Z } from './environment/viaduct.js';
import { bannerHost } from '../utils/banners.js';
import { FLOOD, createCrackTexture } from './flood/config.js';
import { createFloodWater } from './flood/water.js';
import { createFloodSpray } from './flood/spray.js';
import { createRippleTexture, createCrestGeometry, createWaterMaterial } from './flood/shader.js';
import { createFloodDam } from './flood/dam.js';
import { buildBasin } from './flood/basin.js';
import { PHASE_NAMES, soundScale, burstWanted, strainWanted } from './net/floodFx.js';

// The water frozen by the Blizzard (setFrozen).
const ICE_SHALLOW = new THREE.Color(0xe6f5ff);
const ICE_DEEP = new THREE.Color(0x9cc8e6);

/**
 * ===========================================================================
 * SECTION V — Dam break
 * ===========================================================================
 * A dam across the western edge of the map, and what happens when it goes: a
 * wave as tall as the buildings at the breach that crosses the whole town
 * from one side to the other, with a deep flood behind it, carrying off
 * everything loose and tearing down what is not.
 *
 * Deliberately a *scripted wave* rather than a fluid simulation, and rather
 * than a persistent flood. Two reasons, both about this scene specifically:
 * the ground here is dead flat, so there is no valley for water to pool in
 * and a rising water level would simply be a blue plane over everything; and
 * the drama is entirely in the front passing through, not in the aftermath.
 * So the water is one advancing body with a raised crest, and it drains once
 * it has crossed.
 *
 * Independent of the tornado in both directions: it is triggered by its own
 * button (or Doomsday) and nothing else -- no meteor, no waterspout, not the
 * storm starting -- it does not care where the funnel is, and the funnel does not care
 * about it. Any object can be caught by both -- a car swept along by the
 * surge and then picked up out of the water is exactly the kind of thing
 * worth having.
 *
 * The water is opaque, murky and lit (flood/shader.js): what is under it is
 * hidden, as in a real flood. What it does as it passes (flood/water.js):
 *  - **loose objects** (debris, cars, people, uprooted trees, train wagons,
 *    the pieces of whatever it has knocked down) are carried at the water's
 *    own speed, floating at its surface;
 *  - **cars and trees** the wave reaches are thrown and torn out first;
 *  - **people** are handed from their walking AI to physics the same way the
 *    vortex takes them, so they are swept rather than continuing to stroll
 *    through a wall of water, and the wave kills some;
 *  - **buildings** take damage in proportion to the flow's force (depth x
 *    speed squared) for as long as they stand in it, through damage.js, and
 *    come apart piece by piece until they collapse;
 *  - **power lines and viaduct pillars** are faulted and undermined.
 * Foam, spray and mud are flood/spray.js; the rushing water and the crash
 * of the wave, sound/flood.js.
 */

/*
 * Split by job across engine/flood/ (moved as it was; the benchmark's
 * fingerprint is the same before and after):
 *   config.js  tunables
 *   water.js   where the water is, posing it, what it carries off and breaks
 *   shader.js  its look: the opaque water material, the crest's shape
 *   spray.js   foam, spray and mud
 *   dam.js     the dam and its gate, the break and the chunks
 * and this file: set-up, the frame, reset and dispose, with the shared state S and the
 * modules' functions in `api`.
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initFlood: () => void,
 *   updateFlood: (dt: number) => void,
 *   breakDam: () => void,
 *   isRunning: () => boolean,
 *   resetFlood: () => void,
 *   disposeFlood: () => void,
 *   inWater: (x: number, z: number) => boolean,
 *   atCrest: (x: number, z: number) => boolean,
 *   spreadAt: (x: number) => number,
 *   surfaceAt: (x: number, z: number) => number,
 *   frontX: () => number,
 *   isSurging: () => boolean,
 *   isDamIntact: () => boolean,
 *   replicaState: () => ({phase: string, frontX: number, timer: number, strainLength: number, fade: number, frozen: boolean}|null),
 *   mirror: (rows: Map<number, number[]>) => void,
 *   damWall: () => {x: number, halfWidth: number},
 *   westLimit: () => number,
 *   damSolids: () => {x: number, z: number, hw: number, hd: number}[],
 *   setFrozen: (on: boolean) => void,
 *   frozen: () => boolean
 * }}
 */
export function createFloodSystem(ctx) {
  // Frozen over by the Blizzard (setFrozen).
  let frozen = false;
  // Co-op guest: the host's flood is drawn from the `flood` row (mirror), never started, swept, scored or sounded as a hazard here.
  const replica = { on: false, phase: /** @type {number|null} */ (null), strain: 0, frozen: false };
  const peerView = () => !!(ctx.systems.net && ctx.systems.net.isPeerView());
  const { Sim } = ctx;
  // Everything this system's modules share (see the header): each of them
  // reads and writes it as S.
  const S = {
  
    /** @type {THREE.Group|null} */
    group: null,
    /** @type {THREE.Mesh|null} */
    body: null,
    /** @type {THREE.Mesh|null} */
    crest: null,
    /** @type {THREE.Mesh|null} */
    gate: null,
    /** @type {THREE.Mesh|null} the crack pattern spreading over the gate */
    cracks: null,
    /** @type {THREE.Mesh|null} */
    reservoir: null,
    /** @type {{mesh: THREE.Mesh, vel: THREE.Vector3, spin: THREE.Vector3, half: number, resting: boolean}[]} */
    chunks: [],
    /** @type {THREE.BoxGeometry|null} */
    chunkGeometry: null,
    /** @type {THREE.Material|null} */
    chunkMaterial: null,
    /** @type {any} */
    foam: null,
    /** @type {any} spray off the top of the wave */
    mist: null,
    /** @type {any} mud riding the flood */
    mud: null,
    /** @type {THREE.Vector4[]} buildings in the water, for the shader's foam */
    obstacles: [],
    /** @type {THREE.Texture|null} */
    ripples: null,
    /** @type {THREE.Texture|null} the particles' soft dot */
    dot: null,
    /** @type {HTMLDivElement|null} */
    banner: null,
    /** @type {THREE.Material[]} */
    materials: [],

    state: {
      /** @type {'idle'|'strain'|'breaking'|'surge'|'drain'} */
      phase: 'idle',
      // Whether the gate has gone. Separate from `phase`, which is back to
      // 'idle' once the water has drained away: a dam that has already been
      // breached cannot be breached again, and nothing should aim at it.
      broken: false,
      frontX: FLOOD.damX,
      timer: 0,
      // How long this breach strains before it goes.
      strainLength: 0,
      // 1 while the water is out, falling to 0 as it drains.
      fade: 1,
      obstacleCount: 0,
      // Buildings this surge has brought down.
      collapsed: 0,
      // Advanced by dt rather than read from a clock, so the chop freezes with
      // the rest of the scene when the run is paused.
      waveTime: 0,
      bannerTimer: 0,
      /** @type {Set<Object>} buildings already shocked by this surge */
      hit: new Set(),
      /** @type {Set<Object>} what the crest has reached (people, cars, trees), each dealt with once */
      crestHit: new Set()
    }
  };

  // Every function of every module, by name, for the others to call.
  const api = {};
  Object.assign(api,
    createFloodWater(ctx, S, api),
    createFloodSpray(ctx, S, api),
    createFloodDam(ctx, S, api),
    { showBanner }
  );

  /**
   * @param {string} title
   * @param {string} sub
   * @returns {void}
   */
  function showBanner(title, sub) {
    if (!S.banner) return;
    S.banner.querySelector('.title').textContent = title;
    S.banner.querySelector('.sub').textContent = sub;
    S.banner.classList.add('visible');
    S.state.bannerTimer = FLOOD.bannerSeconds;
  }

  /** @returns {void} */
  function initFlood() {
    S.group = new THREE.Group();
    S.group.name = 'flood';
    Sim.three.scene.add(S.group);

    const damMat = new THREE.MeshStandardMaterial({ color: FLOOD.damColour, roughness: 1 });
    S.ripples = createRippleTexture();
    for (let i = 0; i < FLOOD.obstacles; i++) S.obstacles.push(new THREE.Vector4());
    const waterMat = createWaterMaterial('body', S.ripples, S.obstacles);
    const crestMat = createWaterMaterial('crest', S.ripples, S.obstacles);
    S.materials.push(damMat, waterMat, crestMat);

    // The wall, in two halves either side of the breach, plus the gate that
    // fills the gap until it goes.
    const wingWidth = FLOOD.damHalfWidth - FLOOD.breachHalfWidth;
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(
        new THREE.BoxGeometry(FLOOD.damThickness, FLOOD.damHeight, wingWidth), damMat
      );
      wing.position.set(
        FLOOD.damX, FLOOD.damHeight / 2, side * (FLOOD.breachHalfWidth + wingWidth / 2)
      );
      wing.castShadow = true;
      wing.receiveShadow = true;
      wing.name = `flood_dam_${side > 0 ? 'north' : 'south'}`;
      S.group.add(wing);
    }
    S.gate = new THREE.Mesh(
      new THREE.BoxGeometry(FLOOD.damThickness, FLOOD.damHeight, FLOOD.breachHalfWidth * 2), damMat
    );
    S.gate.position.set(FLOOD.damX, FLOOD.damHeight / 2, 0);
    S.gate.castShadow = true;
    S.gate.name = 'flood_dam_gate';
    S.group.add(S.gate);

    // The basin's side and far walls and the earth banked behind them
    // (flood/basin.js): a closed lake in a valley, not a sheet of water
    // lying open on the ground.
    S.materials.push(...buildBasin(S.group, damMat).materials);

    // Cracks on the gate's downstream face, invisible until it starts to go.
    // A child of the gate, so they shudder with it.
    const crackTexture = createCrackTexture();
    const crackMat = new THREE.MeshBasicMaterial({
      map: crackTexture, transparent: true, opacity: 0, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    });
    S.materials.push(crackMat);
    S.cracks = new THREE.Mesh(new THREE.PlaneGeometry(FLOOD.breachHalfWidth * 2, FLOOD.damHeight), crackMat);
    S.cracks.rotation.y = Math.PI / 2;
    S.cracks.position.x = FLOOD.damThickness / 2 + 0.05;
    S.cracks.name = 'flood_dam_cracks';
    S.cracks.userData.texture = crackTexture;
    S.gate.add(S.cracks);

    // What the dam is holding back. Without it the wall read as a grey slab
    // standing in a field, with nothing to break.
    // Opaque, like the flood it lets out.
    const reservoirMat = new THREE.MeshStandardMaterial({
      color: FLOOD.reservoirColour, roughness: 0.12, metalness: 0.25
    });
    S.materials.push(reservoirMat);
    const upstream = FLOOD.damX - FLOOD.damThickness / 2;
    const reservoirLength = upstream + 300;
    S.reservoir = new THREE.Mesh(
      new THREE.PlaneGeometry(reservoirLength, FLOOD.damHalfWidth * 2), reservoirMat
    );
    S.reservoir.rotation.x = -Math.PI / 2;
    S.reservoir.position.set(upstream - reservoirLength / 2, FLOOD.reservoirLevel, 0);
    S.reservoir.name = 'flood_reservoir';
    S.group.add(S.reservoir);

    S.chunkGeometry = new THREE.BoxGeometry(1, 1, 1);
    S.chunkMaterial = damMat;

    // The water: a body and a crest, both shaped in their vertex shaders
    // from the same uniforms (flood/shader.js), so the surge costs uniform
    // writes and no remeshing. Opaque and depth-writing: a car half under
    // shows only its roof. Drawn with the town, not after it.
    S.body = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1, FLOOD.surfaceSegmentsX, FLOOD.surfaceSegmentsZ), waterMat
    );
    S.body.name = 'flood_surface';
    S.body.visible = false;
    // Displaced in the vertex shader: three.js's bounds know nothing of it.
    S.body.frustumCulled = false;
    S.body.receiveShadow = false;
    S.group.add(S.body);

    S.crest = new THREE.Mesh(createCrestGeometry(), crestMat);
    S.crest.name = 'flood_front';
    S.crest.visible = false;
    S.crest.frustumCulled = false;
    S.group.add(S.crest);

    const dot = createSoftDotTexture();
    S.foam = createParticlePool(Sim.three.scene, FLOOD.foamMax, dot, THREE.NormalBlending, 'flood_foam');
    S.mist = createParticlePool(Sim.three.scene, FLOOD.mistMax, dot, THREE.NormalBlending, 'flood_mist');
    S.mud = createParticlePool(Sim.three.scene, FLOOD.mudMax, dot, THREE.NormalBlending, 'flood_mud');
    S.dot = dot;

    if (!S.banner) {
      S.banner = document.createElement('div');
      S.banner.className = 'flood-banner';
      S.banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
      bannerHost(ctx.container).appendChild(S.banner);
    }

    const button = document.getElementById('btn-flood');
    if (button) button.addEventListener('click', () => breakDam(), { signal: ctx.signal });
  }

  /** @returns {boolean} */
  function isRunning() {
    return !replica.on && S.state.phase !== 'idle';
  }

  /**
   * Triggers the disaster: its button, or Doomsday. Independent of the
   * storm: it can be set off with no tornado running at all.
   * @returns {void}
   */
  function breakDam() {
    // Co-op guest: only the host breaks the dam; the guest sees it through mirror().
    if (peerView()) return;
    if (S.state.phase !== 'idle') return;
    // A dam that went on an earlier press has been rebuilt by the time the
    // water has drained (see updateFlood), so this only guards a breach that
    // is somehow still standing open.
    if (S.state.broken) api.rebuildGate();
    S.state.phase = 'strain';
    S.state.broken = true;
    S.state.timer = 0;
    S.state.strainLength = FLOOD.strainSeconds;
    S.state.frontX = FLOOD.damX;
    S.state.fade = 1;
    S.state.collapsed = 0;
    S.state.hit.clear();
    S.state.crestHit.clear();
    api.resetWater();
    showBanner('THE DAM IS FAILING!', 'Cracks are spreading across the wall');

    // Take the camera to the water. The dam is at the far western edge of the
    // map, 148 units out and usually well behind the player, so without this
    // the whole first half of the disaster -- the gate dropping, the breach
    // opening, the front building -- happened off screen, and the flood
    // announced itself by a banner and then by arriving. The shot rides
    // alongside and ahead of the front as it crosses, so what you watch is
    // the wall coming at you rather than a blue line on the horizon.
    // Aimed slightly *upstream* of the front rather than at it, so the frame
    // holds the wall of water and the body piled up behind it rather than the
    // dry ground it is about to cover.
    //
    // While the gate strains, the shot holds on the dam itself, from the town
    // side, so the cracks and the jets are what fill the frame.
    const strain = S.state.strainLength;
    ctx.systems.camera.playCameraBeat(FLOOD.cameraBeat + strain, (position, target, elapsed) => {
      if (elapsed < strain + FLOOD.breakSeconds) {
        position.set(FLOOD.damX + 62, 20, 46);
        target.set(FLOOD.damX, 15, 0);
        return;
      }
      // Further out and higher than before: the wave is building height.
      position.set(S.state.frontX + 78, 30, 92);
      target.set(S.state.frontX - 22, 9, 0);
    }, { always: true });
    setButtonBusy(true);
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateFlood(dt) {
    if (!S.group) return;
    if (S.state.bannerTimer > 0) {
      S.state.bannerTimer -= dt;
      if (S.state.bannerTimer <= 0 && S.banner) S.banner.classList.remove('visible');
    }
    // Frozen by the Blizzard (engine/blizzard.js): the water stands still
    // where it is, the surge and the breaking wall with it, until it thaws.
    if (replica.on) { updateReplica(dt); return; }
    if (frozen) return;
    if (S.state.phase === 'idle') {
      api.updateChunks(dt);
      return;
    }

    S.state.timer += dt;
    S.state.waveTime += dt;

    api.updateChunks(dt);

    if (S.state.phase === 'strain') {
      const t = Math.min(1, S.state.timer / S.state.strainLength);
      strainVisuals(dt, t);
      strainSounds(dt, t, 1, false);
      api.updateFoam(dt);
      if (t >= 1) api.burstGate();
      return;
    }

    if (S.state.phase === 'breaking') {
      breakingJets(dt);
      if (S.state.timer >= FLOOD.breakSeconds) {
        S.state.phase = 'surge';
        S.state.timer = 0;
      }
      api.poseWater(1);
      api.updateFoam(dt);
      return;
    }

    if (S.state.phase === 'surge') {
      S.state.frontX += FLOOD.speed * dt;
      // The reservoir empties as the surge runs out of it.
      const run = THREE.MathUtils.clamp((S.state.frontX - FLOOD.damX) / (FLOOD.endX - FLOOD.damX), 0, 1);
      setReservoir(run);
      api.poseWater(1);
      api.sweepObjects(dt);
      api.hitBuildings();
      api.emitSpray(dt);
      // The far town either side of the corridor, where the water reaches it.
      if (ctx.systems.backdrop) ctx.systems.backdrop.damageAt(S.state.frontX, 0, api.spreadAt(S.state.frontX) * 0.9);
      ctx.systems.powerLines.faultAt(S.state.frontX, 0, api.spreadAt(S.state.frontX) * 0.5);
      // The elevated highway crosses the corridor, so the surge takes its
      // pillars out as it passes -- but only once the water has fanned out
      // far enough to actually reach that side of the map.
      if (api.spreadAt(S.state.frontX) >= Math.abs(VIADUCT_Z)) {
        ctx.systems.viaduct.fissureUnder(S.state.frontX, VIADUCT_Z, 12);
      }
      api.updateFoam(dt);
      sound(dt);
      if (S.state.frontX >= FLOOD.endX) {
        S.state.phase = 'drain';
        S.state.timer = 0;
      }
      return;
    }

    // Drain: the flood sinks away and the dam is left broken.
    const fade = Math.max(0, 1 - S.state.timer / FLOOD.drainSeconds);
    api.poseWater(fade);
    api.sweepObjects(dt * fade);
    api.emitSpray(dt);
    api.updateFoam(dt);
    sound(dt);
    if (fade <= 0) {
      S.state.phase = 'idle';
      S.body.visible = false;
      S.crest.visible = false;
      // Rebuilt and refilled once the water is gone, so the button can do
      // it all again.
      api.rebuildGate();
      setButtonBusy(false);
      sound(dt);
    }
  }

  /**
   * The cracks spreading in, the wall shuddering harder and harder, and
   * water forcing its way through faster as they open (shared with the guest).
   * @param {number} dt
   * @param {number} t 0..1 how far the gate has cracked
   * @returns {void}
   */
  function strainVisuals(dt, t) {
    S.cracks.material.opacity = THREE.MathUtils.smoothstep(t, 0, 0.75);
    const shake = 0.05 + 0.3 * t * t;
    S.gate.position.x = FLOOD.damX + (Math.random() - 0.5) * shake;
    S.gate.position.z = (Math.random() - 0.5) * shake;
    S.foam.accumulator += THREE.MathUtils.lerp(FLOOD.jetRate[0], FLOOD.jetRate[1], t) * dt;
    while (S.foam.accumulator >= 1) {
      S.foam.accumulator -= 1;
      api.spawnJet(t);
    }
  }

  /**
   * Concrete groaning and cracking, closer together as it goes. The guest
   * hears it at the host's level scaled by distance, and only raises dust
   * with particle room.
   * @param {number} dt
   * @param {number} t 0..1
   * @param {number} scale 0..1 loudness (1 on the host)
   * @param {boolean} guest
   * @returns {void}
   */
  function strainSounds(dt, t, scale, guest) {
    if (Math.random() < dt * (1.5 + 6 * t) && scale > 0.01) ctx.systems.earthquakeSound.playRupture((0.3 + 0.7 * t) * scale);
    if (Math.random() < dt * 4 * t && ctx.systems.earthquake) {
      const x = FLOOD.damX + 4;
      const z = (Math.random() - 0.5) * FLOOD.breachHalfWidth * 2;
      if (!guest || !ctx.systems.caps || ctx.systems.caps.particleRoom() > 0) ctx.systems.earthquake.kickDust(x, z, 1, 1.4);
    }
  }

  /**
   * The water pouring through the hole the gate left (shared with the guest).
   * @param {number} dt
   * @returns {void}
   */
  function breakingJets(dt) {
    S.foam.accumulator += FLOOD.jetRate[1] * 1.5 * dt;
    while (S.foam.accumulator >= 1) {
      S.foam.accumulator -= 1;
      api.spawnJet(1);
    }
  }

  /**
   * The reservoir emptying as the surge runs out of it.
   * @param {number} run 0..1 how far the front has crossed
   * @returns {void}
   */
  function setReservoir(run) {
    S.reservoir.position.y = THREE.MathUtils.lerp(FLOOD.reservoirLevel, FLOOD.reservoirLow, Math.sqrt(run));
  }

  /**
   * Co-op guest: the host's `flood` row (the sampled kind), called every
   * frame with an empty map when the host sends none. It only sets what is
   * drawn (phase, front, fade, the gate); the breach and the banner fire on
   * the phase edges. Nothing here sweeps, damages, scores or shakes.
   * @param {Map<number, number[]>} rows
   * @returns {void}
   */
  function mirror(rows) {
    const r = rows.get(0);
    if (!r) { if (replica.on) endReplica(); return; }
    if (!S.group) return;
    const next = r[1];
    const prev = replica.phase;
    replica.on = true;
    if (strainWanted(prev, next)) showBanner('THE DAM IS FAILING!', 'Cracks are spreading across the wall');
    if (burstWanted(prev, next)) api.mirrorBurst(soundScale(damDistance()));
    else if (prev === null && next >= 2) S.gate.visible = false;
    replica.phase = next;
    replica.strain = r[3];
    replica.frozen = r[5] === 1;
    S.state.phase = PHASE_NAMES[next];
    S.state.broken = true;
    S.state.frontX = r[2];
    S.state.fade = r[4];
  }

  /** @returns {number} metres from the listener's camera to the dam's face */
  function damDistance() {
    const cam = Sim.three.camera.position;
    return Math.hypot(cam.x - FLOOD.damX, cam.y - 12, cam.z);
  }

  /**
   * Co-op guest: one frame of the host's flood, drawn with the host's own
   * meshes, pools and sounds (the sweep, the buildings, the faults and the
   * score stay with the host).
   * @param {number} dt
   * @returns {void}
   */
  function updateReplica(dt) {
    if (replica.frozen) return;
    S.state.waveTime += dt;
    api.updateChunks(dt);
    const phase = S.state.phase;
    if (phase === 'strain') {
      strainVisuals(dt, replica.strain);
      strainSounds(dt, replica.strain, soundScale(damDistance()), true);
      api.updateFoam(dt);
      return;
    }
    if (phase === 'breaking') {
      breakingJets(dt);
      api.poseWater(1);
      api.updateFoam(dt);
      return;
    }
    setReservoir(THREE.MathUtils.clamp((S.state.frontX - FLOOD.damX) / (FLOOD.endX - FLOOD.damX), 0, 1));
    api.poseWater(phase === 'surge' ? 1 : S.state.fade);
    api.emitSpray(dt);
    api.updateFoam(dt);
    sound(dt);
  }

  /** @returns {void} the host's flood over (or the view left): the dam rebuilt, the water and spray gone */
  function endReplica() {
    resetFlood();
  }

  /**
   * The flood as plain numbers for a snapshot's `flood` row, read-only; null
   * when idle.
   * @returns {{phase: string, frontX: number, timer: number, strainLength: number, fade: number, frozen: boolean}|null}
   */
  function replicaState() {
    if (S.state.phase === 'idle') return null;
    const { phase, frontX, timer, strainLength, fade } = S.state;
    return { phase, frontX, timer, strainLength, fade, frozen };
  }

  /**
   * The rushing water's level: how much water there is, how near the
   * camera it is, and how near the wave itself.
   * @param {number} dt
   * @returns {void}
   */
  function sound(dt) {
    const fs = ctx.systems.floodSound;
    if (!fs) return;
    if (S.state.phase === 'idle') {
      fs.updateFloodSound(0, Infinity, 0, dt);
      return;
    }
    const cam = Sim.three.camera.position;
    const front = S.state.frontX;
    const x = THREE.MathUtils.clamp(cam.x, FLOOD.damX, front);
    const spread = api.spreadAt(x);
    const z = THREE.MathUtils.clamp(cam.z, -spread, spread);
    const distance = Math.hypot(cam.x - x, cam.z - z, Math.max(0, cam.y - FLOOD.depth));
    const toWave = Math.hypot(cam.x - front, cam.z - THREE.MathUtils.clamp(cam.z, -spread, spread));
    const wave = S.state.phase === 'surge' ? Math.max(0, 1 - toWave / 140) : 0;
    fs.updateFloodSound(S.state.fade, distance, wave, dt);
  }

  /**
   * Greys the panel button out while a flood is running, the same re-trigger
   * guard the Landing button uses.
   * @param {boolean} busy
   * @returns {void}
   */
  function setButtonBusy(busy) {
    const button = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-flood'));
    if (button) button.disabled = busy;
  }

  /** @returns {boolean} whether the front is currently crossing the map */
  function isSurging() {
    return !replica.on && S.state.phase === 'surge';
  }

  /** @returns {number} how far across the map the front has reached */
  function frontX() {
    return S.state.frontX;
  }

  /**
   * Rebuilds the dam and clears the water, from resetSim().
   * @returns {void}
   */
  function resetFlood() {
    replica.on = false;
    replica.phase = null;
    replica.strain = 0;
    replica.frozen = false;
    S.state.phase = 'idle';
    S.state.timer = 0;
    S.state.fade = 1;
    S.state.hit.clear();
    S.state.crestHit.clear();
    api.resetWater();
    api.rebuildGate();
    setButtonBusy(false);
    if (S.body) S.body.visible = false;
    if (S.crest) S.crest.visible = false;
    api.clearSpray();
    if (ctx.systems.floodSound) ctx.systems.floodSound.updateFloodSound(0, Infinity, 0, 0);
  }

  /** @returns {void} */
  function disposeFlood() {
    replica.on = false;
    replica.phase = null;
    if (!S.group) return;
    S.group.traverse((/** @type {any} */ child) => {
      if (child.geometry) child.geometry.dispose();
    });
    if (S.cracks && S.cracks.userData.texture) S.cracks.userData.texture.dispose();
    if (S.chunkGeometry) S.chunkGeometry.dispose();
    S.chunkGeometry = null;
    S.chunkMaterial = null;
    S.chunks = [];
    S.cracks = null;
    S.reservoir = null;
    for (const mat of S.materials) mat.dispose();
    S.materials.length = 0;
    for (const pool of [S.foam, S.mist, S.mud]) if (pool) disposeParticlePool(Sim.three.scene, pool);
    if (S.dot) S.dot.dispose();
    if (S.ripples) S.ripples.dispose();
    S.dot = null;
    S.ripples = null;
    S.mist = null;
    S.mud = null;
    S.obstacles = [];
    if (ctx.systems.floodSound) ctx.systems.floodSound.disposeFloodSound();
    if (S.banner && S.banner.parentNode) S.banner.parentNode.removeChild(S.banner);
    Sim.three.scene.remove(S.group);
    S.group = null;
    S.body = null;
    S.crest = null;
    S.gate = null;
    S.foam = null;
    S.banner = null;
  }

  /**
   * The Blizzard freezing the dam's water (the reservoir, and the flood if
   * it is out), or thawing it: ice-white, and still.
   * @param {boolean} on
   * @returns {void}
   */
  function setFrozen(on) {
    if (on === frozen) return;
    frozen = on;
    for (const m of S.materials) {
      const any = /** @type {any} */ (m);
      if (any.uniforms && any.uniforms.uShallow) {
        if (!any.userData.thawed) any.userData.thawed = [any.uniforms.uShallow.value.clone(), any.uniforms.uDeep.value.clone()];
        const [shallow, deep] = any.userData.thawed;
        any.uniforms.uShallow.value.copy(on ? ICE_SHALLOW : shallow);
        any.uniforms.uDeep.value.copy(on ? ICE_DEEP : deep);
      } else if (any.color && m === (S.reservoir && S.reservoir.material)) {
        if (any.userData.thawed === undefined) any.userData.thawed = any.color.getHex();
        any.color.setHex(on ? 0xdff2ff : any.userData.thawed);
      }
    }
  }

  return {
    setFrozen, frozen: () => frozen,
    initFlood, updateFlood, breakDam, isRunning, resetFlood, disposeFlood, damWall: api.damWall, westLimit: api.westLimit, damSolids: api.damSolids,
    // Read by engine/collisions.js and the train, which need to know where
    // the water is rather than merely that it is running. On a co-op guest
    // the host's flood is only drawn: these report no water (R-053).
    inWater: (/** @type {number} */ x, /** @type {number} */ z) => !replica.on && api.inWater(x, z),
    atCrest: (/** @type {number} */ x, /** @type {number} */ z) => !replica.on && api.atCrest(x, z),
    spreadAt: api.spreadAt,
    surfaceAt: (/** @type {number} */ x, /** @type {number} */ z) => (replica.on ? 0 : api.surfaceAt(x, z)),
    frontX, isSurging, isDamIntact: api.isDamIntact, replicaState, mirror
  };
}
