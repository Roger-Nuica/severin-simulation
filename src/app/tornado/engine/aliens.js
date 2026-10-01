// @ts-check
import * as THREE from 'three';
import { bannerHost } from '../utils/banners.js';
import { ALIENS, RAY_COLOURS } from './aliens/config.js';
import { createAlienModels } from './aliens/models.js';
import { createAlienShip } from './aliens/ship.js';
import { createAlienAbduction } from './aliens/abduction.js';
import { createAlienCrew } from './aliens/crew.js';
import { createAlienWeapons } from './aliens/weapons.js';
import { createAlienWaves } from './aliens/waves.js';
export { ALIEN_SKIN_GLOW } from './aliens/config.js';

/**
 * ===========================================================================
 * SECTION AK — The aliens
 * ===========================================================================
 * From the moment the town is there -- before the Tornado button is
 * pressed, not waiting on the storm -- a saucer (the landing ship's own model,
 * spaceship.js buildSaucer) comes down over a clear patch of town and hangs
 * there, a hatch open in its belly and a long ramp run down from it to the
 * ground at ALIENS.rampAngle (45 degrees). The ramp is a conveyor belt: its
 * surface runs up towards the hatch, and the people taken ride it standing,
 * one at a time, at the belt's steady pace (ALIENS.climbSeconds), before
 * vanishing into the ship. Ten green aliens with big green heads walk down it and
 * keep watch round the ship, and for its first ALIENS.abductSeconds over the
 * town the ship takes one person every ALIENS.abductEvery seconds, and two
 * of the crew go and get them: they hurry out to the person, who is held
 * where they stand in a green glow, take them between them, and the three
 * go to the foot of the ramp together, the aliens either side. The belt
 * carries all three up side by side, and they go through the hatch together;
 * the two come back down the ramp a few seconds later. (A person used to be
 * drawn across the ground alone.) With no crew left, the glow draws them in
 * alone as before. Only one group is ever on the belt; anyone else brought
 * in meanwhile waits at the foot for their turn.
 *
 * What can be done about it:
 *  - the ship is only a ship: any tornado that reaches it tears it out of the
 *    sky -- lifted, spun up the funnel, and blown apart -- and the abductions
 *    stop;
 *  - the aliens are another matter. Like the Terminator they are never put
 *    into Sim.objects, so the wind, debris, blasts, water and the EMP all go
 *    straight past them. Only the Firenado (engine/firenado.js) kills them:
 *    one caught inside the burning funnel goes up in flames, blackens and
 *    falls.
 *
 * Destroying the ship does not end it. With nothing left to go home in, the
 * surviving aliens go on the rampage (see rampage): each walks at the nearest
 * person or standing building and shoots it with the ray gun in its hand --
 * the arm comes up, the gun's emitter flares, and a green ray runs from its
 * muzzle to the target; people are killed outright, buildings shaken and set
 * alight -- until the Firenado burns them. (The rays used to start at the
 * alien's head with the arm dropping again the same frame, so they looked
 * as if they came out of nothing.) Leaving the ship alone is worse: once it
 * has taken ALIENS.mothershipAfter people it calls in the mothership and its
 * super laser (engine/mothership.js).
 *
 * The Terminators (engine/terminator.js) and the aliens fight. A Terminator
 * goes for an alien near it and strikes it (strikeAlien): with fire at hand
 * -- the Firenado close by, or a burning building next to it -- the blow
 * kills; otherwise the alien is only thrown back. The aliens in turn take a
 * Terminator that comes near them up the ramp like a person, while the ship
 * is there to take it to, and shoot at it once it is gone, to no effect.
 *
 * Roger (engine/heroMode.js) is a target and a threat. Crew within
 * ALIENS.rogerSight of him on foot go after him: they close in to grab him
 * (within ALIENS.meleeReach it is over) and shoot at where he stood when the
 * gun came up -- moving dodges a ray, standing still does not. The ship, and
 * the hunters below, lock a tracking laser on him within ALIENS.laserRange:
 * its foot starts off to one side and crawls after him slower than he can
 * run, and it kills him, car or no car, if it catches him. His plasma rifle
 * kills any of the crew with one shot. Every shot holes a ship: a normal
 * shot takes one point off its hull, a mega beam (the rifle's three-second
 * charge) five (heroMode.js SHIP_DAMAGE), and ALIENS.shipHull / hunterHull
 * points bring one down -- it falls burning and blows up where it lands.
 * (Ships used to shrug off anything but a mega beam, which read as the
 * rifle not working on them at all.)
 *
 * ALIENS.huntersAt seconds after the ship first arrives, two red hunter
 * ships come down at opposite ends of town. They take nobody: each hunts the
 * nearest person, hangs over them and burns them where they stand, and turns
 * its laser on Roger when he is in range. They are on the minimap as red
 * rings.
 *
 * ALIENS.waveAt seconds (two minutes) after the first ship arrives, on
 * request, a second wave: a gold transport ship (updateWave) comes down
 * somewhere else, runs its ramp out, and ALIENS.waveCount more of the crew
 * walk down it -- each in a sombrero -- before it lifts away. They take
 * nobody: they go straight through town after people and Roger, the way
 * the first crew does once its ship is gone (rampage).
 *
 * The green EMP of a nuclear plant going up (engine/nuclear.js) turns
 * people into more of them (mutate): the ring reaches someone, a green bolt
 * comes down on them, and over ALIENS.mutateSeconds (two seconds) they
 * glow, stretch and shrink away while one of the crew -- in a sombrero --
 * grows up out of the same spot, then goes through town like the second
 * wave (rampage). Past ALIENS.mutantMax of them at once, the rest are simply
 * burnt up by the ray instead (the scene can only carry so many).
 *
 * They dance (engine/dance.js): all of them, while Smooth Criminal plays
 * (engine/smoothCriminal.js -- the ships hold their fire, nobody is taken,
 * nobody is shot), and any with no human left in town to go after (Roger
 * aside: near him, they still go for him).
 *
 * Lightning kills the crew too, on request -- the Lightning tile's bolts
 * and Roger's railgun, which are the same bolt (strikeTargeting.js calls
 * boltKill).
 *
 * Anyone abducted leaves Environment.people when they go through the hatch,
 * so the humans readout counts them among the lost (ui.js lists them in the
 * tooltip). Everything is cleared by a Reset and comes again with the next
 * run.
 */

/*
 * The code is split by job across engine/aliens/ (moved as it was, nothing
 * changed; the benchmark's fingerprint is the same before and after):
 *   config.js    every tunable (ALIENS, RAY_COLOURS)
 *   models.js    the ramp, the beam, the alien model
 *   ship.js      the landing ship: where, arrival, wreck, hits
 *   abduction.js who is taken, the escorts, the belt
 *   crew.js      each alien on the ground: walk, dance, targets, fights
 *   weapons.js   ray guns and tracking lasers
 *   waves.js     the second wave, the mutation, the hunter ships
 * and this file: set-up, the frame, reset and dispose. Their shared state is
 * the one object S made below; each module calls the others' functions
 * through `api`.
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initAliens: () => void,
 *   updateAliens: (dt: number) => void,
 *   abductedCount: () => number,
 *   markers: () => {ship: THREE.Vector3|null, aliens: THREE.Vector3[]},
 *   nearestAlien: (x: number, z: number, radius: number) => Object|null,
 *   strikeAlien: (alien: Object, from: THREE.Vector3) => void,
 *   targets: () => Object[],
 *   shipTargets: () => Object[],
 *   huntersPresent: () => boolean,
 *   plannedSpot: () => {x: number, z: number, dirX: number, dirZ: number},
 *   frameLanding: () => void,
 *   boltKill: (x: number, z: number, radius: number) => number,
 *   sendSecondWave: () => void,
 *   mutate: (person: Object) => boolean,
 *   mutatedCount: () => number,
 *   instanceSources: () => Alien[],
 *   plasmaKill: (alien: Object, at: THREE.Vector3) => void,
 *   resetAliens: () => void,
 *   disposeAliens: () => void
 * }}
 */
export function createAliensSystem(ctx) {
  const { Sim } = ctx;

  // Everything the aliens' modules share (see the header): each of them
  // reads and writes it as S.
  const S = {
    state: {
      /** @type {'idle'|'arriving'|'deploying'|'hovering'|'wrecked'|'gone'} */
      phase: 'idle',
      timer: 0,
      // Seconds of the abduction window used, and until the next one.
      abductClock: 0,
      nextAbduct: 0,
      exitTimer: 0,
      spawned: 0,
      abducted: 0,
      x: 0,
      z: 0,
      // Outward direction of the ramp, on the ground.
      dirX: 1,
      dirZ: 0,
      spin: 0,
      mothershipCalled: false,
      // Mega beams the ship can still take, and has taken (for its smoke).
      hull: 0,
      damage: 0,
      // Shot down rather than caught by a funnel: it falls rather than rising.
      crashing: false,
      // Seconds since the ship first arrived, for the hunters.
      clock: 0,
      huntersSent: false,
      // Seconds until the landing ship next shoots at a nuclear plant.
      plantTimer: 0,
      bannerTimer: 0
    },
    /**
     * The rays: a fixed pool of additive beams, reused.
     * @type {{mesh: THREE.Group, core: THREE.Mesh, glow: THREE.Mesh, flare: THREE.Mesh, splash: THREE.Mesh, life: number}[]}
     */
    rays: [],
    /** @type {THREE.BufferGeometry[]} shared by the pool */
    rayGeos: [],
    /** @type {{group: THREE.Group, glow: THREE.Material[], rim: THREE.Material, legs: THREE.Object3D[]}|null} */
    ship: null,
    /** @type {{x: number, z: number}|null} where the ship will come down (plannedSpot) */
    planned: null,
    /** @type {THREE.Group|null} */
    rampPivot: null,
    /** @type {THREE.Mesh|null} */
    beam: null,
    /** @type {THREE.Object3D|null} */
    light: null,
    /** @type {THREE.CanvasTexture|null} the belt's stripes, scrolled up the ramp */
    beltTexture: null,
    /** @type {Alien[]} */
    aliens: [],
    /** @type {Abductee[]} */
    abductees: [],
    /** @type {Object<string, THREE.BufferGeometry>|null} shared by every alien */
    alienGeo: null,
    /** @type {THREE.MeshStandardMaterial|null} */
    eyeMat: null,
    /** @type {THREE.MeshStandardMaterial|null} shared by every alien's gun */
    gunMat: null,
    /** @type {THREE.MeshBasicMaterial|null} */
    emitterMat: null,
  
    /** @type {Object[]} the hunter ships */
    hunters: [],
    /**
     * People turning into crew (mutate): the person, the alien growing out of
     * them, the green column over them, and how far through it they are.
     * @type {{person: Object, alien: Alien, halo: THREE.Mesh, materials: THREE.MeshStandardMaterial[], x: number, z: number, timer: number}[]}
     */
    mutants: [],

    mutated: 0,
    /** @type {THREE.BufferGeometry|null} the column, shared */
    haloGeo: null,
    // The second wave's transport ship (updateWave): where it comes down, its
    // ramp's two ends, and how far through unloading it is.
    wave: {
      sent: false,
      /** @type {'none'|'arriving'|'deploying'|'unloading'|'retracting'|'leaving'} */
      phase: 'none',
      timer: 0,
      spawned: 0,
      exitTimer: 0,
      heading: 0,
      /** @type {{group: THREE.Group, glow: THREE.Material[], legs: THREE.Object3D[]}|null} */
      ship: null,
      /** @type {THREE.Group|null} */
      ramp: null,
      top: new THREE.Vector3(),
      foot: new THREE.Vector3()
    },
    /** @type {{brim: THREE.BufferGeometry, crown: THREE.BufferGeometry, band: THREE.BufferGeometry, straw: THREE.Material, red: THREE.Material}|null} */
    sombrero: null,
    /** @type {Object|null} the ship's tracking laser */
    shipTracker: null,
    /** @type {Object[]} one per hunter */
    hunterTrackers: [],
    /** @type {THREE.BufferGeometry[]} */
    trackerGeos: [],
    /** @type {HTMLDivElement|null} */
    banner: null,
    // Worked out once a frame (updateAliens) for every alien: Smooth Criminal
    // on (engine/smoothCriminal.js), and whether any human is left.
    frame: { peace: false, noHumans: false },

    rampTop: new THREE.Vector3(),

    rampFoot: new THREE.Vector3(),
    // The tracking lasers' two ends, every frame for the ship and each hunter
    // (updateTracker): scratch rather than new vectors (performance pass).
    // Not `scratch`, which updateTracker uses for the laser's foot.
    trackerFrom: new THREE.Vector3(),

    trackerDir: new THREE.Vector3(),

    scratch: new THREE.Vector3()
  };

  // Every function of every module, by name, for the others to call.
  const api = {};
  Object.assign(api,
    createAlienModels(ctx, S, api),
    createAlienShip(ctx, S, api),
    createAlienAbduction(ctx, S, api),
    createAlienCrew(ctx, S, api),
    createAlienWeapons(ctx, S, api),
    createAlienWaves(ctx, S, api),
    { showBanner, between, heroTarget }
  );

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------

  /** @returns {void} */
  function initAliens() {
    // In the shared register of enemies (engine/enemies.js): the crew on the
    // ground, killed by the plasma rifle, lightning, the T-Rex's flames or a
    // samurai's sword (engine/spaceship/samurai.js).
    ctx.systems.enemies.registerKind({
      kind: 'alien',
      list: targets,
      position: (alien) => alien.root.position,
      accepts: ['plasma', 'bolt', 'fire', 'blade'],
      damage: (alien, hit) => {
        if (hit.type === 'blade') api.slashKill(alien);
        else api.plasmaKill(alien, hit.at || alien.root.position);
        return true;
      },
      // The black hole: gone, with no fire of its own.
      consume: (alien) => {
        for (const a of S.abductees) if (a.escorts) a.escorts = a.escorts.filter(e => e !== alien);
        alien.phase = 'dead';
        Sim.three.scene.remove(alien.root);
        alien.skin.dispose();
      }
    });
    // The ship and the hunter ships, for the black hole
    // (engine/effects/consumables.js): gone, with no crash of their own.
    ctx.systems.consumables.register({
      kind: 'ufo',
      list: () => (S.ship && S.state.phase !== 'idle' && S.state.phase !== 'wrecked' ? [S.ship] : []),
      position: (ship) => ship.group.position,
      object: (ship) => ship.group,
      big: true,
      consume: () => {
        // As wreck() but quiet: those it was taking are let go, the crew
        // aboard go with it, and there is no crash.
        api.stopTracker(S.shipTracker);
        for (const a of S.abductees) {
          if (a.machine) ctx.systems.terminator.releaseUnit(a.machine);
          api.releaseEscorts(a);
        }
        S.abductees = [];
        for (const alien of S.aliens) {
          if (alien.phase !== 'aboard') continue;
          alien.phase = 'dead';
          Sim.three.scene.remove(alien.root);
          alien.skin.dispose();
        }
        api.removeShip();
        S.state.phase = 'gone';
      }
    });
    ctx.systems.consumables.register({
      kind: 'hunterShip',
      list: () => S.hunters.filter(h => h.phase === 'arriving' || h.phase === 'hunting'),
      position: (h) => h.group.position,
      object: (h) => h.group,
      consume: (h) => api.removeHunter(h)
    });
    S.alienGeo = api.buildAlienGeometry();
    S.eyeMat = new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.08, metalness: 0.3 });
    S.gunMat = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.3, metalness: 0.8 });
    S.emitterMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 4, 1.2) });
    // The sombrero: a wide flat brim, a tall crown and a red band.
    S.sombrero = {
      brim: new THREE.CylinderGeometry(0.62, 0.66, 0.05, 20),
      crown: new THREE.CylinderGeometry(0.13, 0.26, 0.36, 14),
      band: new THREE.TorusGeometry(0.25, 0.035, 6, 18),
      straw: new THREE.MeshStandardMaterial({ color: ALIENS.sombreroStraw, roughness: 0.85 }),
      red: new THREE.MeshStandardMaterial({ color: ALIENS.sombreroBand, roughness: 0.7 })
    };
    S.haloGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
    S.haloGeo.translate(0, 0.5, 0);
    // Made now at zero and never removed: adding a light mid-run recompiles
    // every lit material in the scene.
    S.light = ctx.systems.lightPool.createLight(0x5cff7a, 0, 60, 1.6);
    S.light.name = 'alien_light';
    Sim.three.scene.add(S.light);

    // A unit-length beam along +y from its base, stretched and pointed per
    // shot: a white-green core inside a wider green glow, with a flare at
    // the muzzle and a splash where it lands.
    const coreGeo = new THREE.CylinderGeometry(0.09, 0.09, 1, 6, 1, true);
    coreGeo.translate(0, 0.5, 0);
    const glowGeo = new THREE.CylinderGeometry(0.4, 0.4, 1, 8, 1, true);
    glowGeo.translate(0, 0.5, 0);
    const flareGeo = new THREE.SphereGeometry(0.5, 10, 8);
    S.rayGeos = [coreGeo, glowGeo, flareGeo];
    /**
     * @param {THREE.BufferGeometry} geometry
     * @param {THREE.Color} colour
     * @returns {THREE.Mesh}
     */
    const glowMesh = (geometry, colour) => {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: colour, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      mesh.frustumCulled = false;
      return mesh;
    };
    for (let i = 0; i < ALIENS.rayMax; i++) {
      const mesh = new THREE.Group();
      mesh.name = 'alien_ray';
      mesh.visible = false;
      const core = glowMesh(coreGeo, new THREE.Color(2.5, 6, 3));
      const glow = glowMesh(glowGeo, new THREE.Color(0.3, 2.4, 0.6));
      mesh.add(core, glow);
      const flare = glowMesh(flareGeo, new THREE.Color(1.2, 5, 1.6));
      const splash = glowMesh(flareGeo, new THREE.Color(1, 4, 1.4));
      flare.visible = splash.visible = false;
      Sim.three.scene.add(mesh, flare, splash);
      S.rays.push({ mesh, core, glow, flare, splash, life: 0 });
    }

    // The tracking lasers, one for the ship and one per hunter: made now,
    // shown when they fire.
    const beamCore = new THREE.CylinderGeometry(0.35, 0.35, 1, 8, 1, true);
    beamCore.translate(0, 0.5, 0);
    const beamGlow = new THREE.CylinderGeometry(1.3, 1.3, 1, 10, 1, true);
    beamGlow.translate(0, 0.5, 0);
    const footGeo = new THREE.CircleGeometry(2.4, 20);
    footGeo.rotateX(-Math.PI / 2);
    S.trackerGeos = [beamCore, beamGlow, footGeo];
    /**
     * @param {'green'|'red'} colour
     * @returns {Object}
     */
    const tracker = (colour) => {
      const c = RAY_COLOURS[colour];
      const group = new THREE.Group();
      group.name = 'alien_laser';
      const core = glowMesh(beamCore, c.core);
      const glow = glowMesh(beamGlow, c.glow);
      group.add(core, glow);
      group.visible = false;
      const foot = glowMesh(footGeo, c.splash);
      foot.visible = false;
      Sim.three.scene.add(group, foot);
      return { group, core, glow, foot, active: false, timer: 0, cooldown: 2, fx: 0, fz: 0 };
    };
    S.shipTracker = tracker('green');
    S.hunterTrackers = [];
    for (let i = 0; i < ALIENS.hunterCount; i++) S.hunterTrackers.push(tracker('red'));

    S.banner = document.createElement('div');
    S.banner.className = 'downburst-banner alert';
    S.banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
    bannerHost(ctx.container).appendChild(S.banner);
  }

  /**
   * @param {string} title
   * @param {string} sub
   * @param {number} [seconds] how long it stays up
   * @returns {void}
   */
  function showBanner(title, sub, seconds = ALIENS.bannerSeconds) {
    if (!S.banner) return;
    S.banner.querySelector('.title').textContent = title;
    S.banner.querySelector('.sub').textContent = sub;
    S.banner.classList.add('visible');
    S.state.bannerTimer = seconds;
  }

  /**
   * @param {[number, number]} range
   * @returns {number}
   */
  function between(range) {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  /**
   * Roger, if Hero Mode is on and he can be got at (heroMode.js rogerTarget).
   * @returns {{x: number, z: number, onFoot: boolean}|null}
   */
  function heroTarget() {
    const hero = ctx.systems.heroMode;
    return hero ? hero.rogerTarget() : null;
  }

  // ---------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------

  /**
   * The crew's held sounds (sound/creatures.js): one small hover hum, at the
   * nearest of them to the camera and louder the more there are -- a crowd
   * shares one hum rather than one each -- and the abduction beam's while
   * it runs.
   * @returns {void}
   */
  function soundCrew() {
    const sounds = ctx.systems.creatureSounds;
    const cam = Sim.three.camera.position;
    let nearest = null;
    let best = Infinity;
    let count = 0;
    for (const alien of S.aliens) {
      if (alien.phase !== 'patrol' && alien.phase !== 'escort' && alien.phase !== 'exiting') continue;
      count++;
      const d = alien.root.position.distanceToSquared(cam);
      if (d < best) { best = d; nearest = alien; }
    }
    if (nearest) sounds.loop('alienHover', nearest.root.position, Math.min(1, 0.35 + count * 0.08));
    if (S.beam && S.beam.visible) sounds.loop('beam', S.beam.getWorldPosition(S.scratch), 0.9);
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateAliens(dt) {
    if (dt <= 0) return;
    // Not waiting for the storm: the ship comes as soon as there is a town.
    if (S.state.phase === 'idle') {
      if (!ctx.Environment || !ctx.Environment.people.length) return;
      api.arrive();
    }
    S.state.timer += dt;
    S.state.clock += dt;
    S.frame.peace = !!(ctx.systems.smoothCriminal && ctx.systems.smoothCriminal.peace());
    S.frame.noHumans = !ctx.Environment.people.some(person => person.mesh.parent && !person.abducted && !person.electrocuted);
    if (S.state.bannerTimer > 0) {
      S.state.bannerTimer -= dt;
      if (S.state.bannerTimer <= 0 && S.banner) S.banner.classList.remove('visible');
    }
    if (!S.state.huntersSent && S.state.clock >= ALIENS.huntersAt) api.sendHunters();
    for (const hunter of S.hunters) api.updateHunter(hunter, dt);
    S.hunters = S.hunters.filter(h => h.phase !== 'dead');
    if (!S.wave.sent && S.state.clock >= ALIENS.waveAt) api.sendWave();
    api.updateWave(dt);
    soundCrew();

    if (S.ship && S.state.phase !== 'wrecked') {
      const g = S.ship.group;
      if (S.state.damage > 0 && Math.random() < dt * 3 * S.state.damage) {
        ctx.systems.explosions.spawnImpactBurst(S.scratch.copy(g.position).add(new THREE.Vector3((Math.random() - 0.5) * 22, 3, (Math.random() - 0.5) * 22)), 0.9);
      }
      if (S.shipTracker) {
        api.updateTracker(S.shipTracker, S.trackerFrom.set(S.state.x, g.position.y + 0.6, S.state.z), S.state.phase === 'hovering' && !S.frame.peace, dt);
      }
      if (S.state.phase === 'arriving') {
        g.position.y = api.arrivalHeight(S.state.timer);
        if (S.state.timer >= ALIENS.arriveSeconds) {
          S.state.phase = 'deploying';
          S.state.timer = 0;
        }
      } else {
        // A slow bob and turn while it hangs there.
        g.position.y = ALIENS.hoverHeight + 0.35 * Math.sin(S.state.timer * 1.3);
      }
      const glow = 1.6 + 0.5 * Math.sin(S.state.timer * 4);
      for (const mat of S.ship.glow) mat.color.copy(ALIENS.glow).multiplyScalar(glow / 2);
      if (S.light) {
        S.light.position.set(S.state.x, g.position.y - 2, S.state.z);
        S.light.intensity = 120 * glow;
      }
      if (S.state.phase === 'deploying') {
        const u = Math.min(1, S.state.timer / ALIENS.rampSeconds);
        S.rampPivot.userData.tilt.scale.x = Math.max(0.001, u);
        if (u >= 1) {
          S.state.phase = 'hovering';
          S.state.timer = 0;
        }
      }
      if (S.state.phase === 'hovering') {
        // The belt runs up towards the hatch the whole time the ship is here.
        if (S.beltTexture) {
          const speed = api.rampLength() / ALIENS.climbSeconds;
          S.beltTexture.offset.x = (S.beltTexture.offset.x + (speed / ALIENS.beltStripe) * dt) % 1;
        }
        // The crew, down the ramp one at a time.
        if (S.state.spawned < ALIENS.count) {
          S.state.exitTimer -= dt;
          if (S.state.exitTimer <= 0) {
            S.state.exitTimer = ALIENS.exitEvery;
            const alien = api.buildAlien();
            alien.root.position.copy(S.rampTop);
            Sim.three.scene.add(alien.root);
            S.aliens.push(alien);
            S.state.spawned++;
          }
        }
        // One person every abductEvery seconds, for abductSeconds.
        if (S.state.abductClock < ALIENS.abductSeconds) {
          S.state.abductClock += dt;
          S.state.nextAbduct -= dt;
          // Not before any of the crew is free to go for them -- unless
          // there is no crew left at all, when the glow does it alone.
          const crewFree = S.aliens.some(alien => alien.phase === 'patrol');
          const crewLeft = S.state.spawned < ALIENS.count || S.aliens.some(alien => alien.phase !== 'dead' && alien.phase !== 'burning');
          if (S.state.nextAbduct <= 0 && (crewFree || !crewLeft) && !S.frame.peace) {
            S.state.nextAbduct = ALIENS.abductEvery;
            const victim = api.pickVictim();
            if (victim) api.abduct(victim);
          }
        }
        // Terminators near the crew are taken aboard too.
        if (!S.frame.peace) api.grabTerminators();
        // The nuclear plants (engine/nuclear.js): a shot at the nearest one
        // still standing, every so often.
        S.state.plantTimer += dt;
        const nuclear = ctx.systems.nuclear;
        if (nuclear && S.state.plantTimer >= ALIENS.shipPlantFirst && !S.frame.peace) {
          const plant = nuclear.nearestIntact(S.state.x, S.state.z);
          if (plant) {
            S.state.plantTimer = ALIENS.shipPlantFirst - ALIENS.shipPlantEvery;
            api.fireRay(new THREE.Vector3(S.state.x, g.position.y - 0.5, S.state.z), plant.aim.clone());
            nuclear.shipHit(plant, plant.aim);
          }
        }
        // Enough of the town taken and the ship still there: it calls in the
        // mothership and its super laser.
        if (S.state.abducted >= ALIENS.mothershipAfter && !S.state.mothershipCalled && ctx.systems.mothership) {
          S.state.mothershipCalled = true;
          ctx.systems.mothership.summon();
        }
        if (api.funnelAtShip()) api.wreck();
      }
    }
    if (S.state.phase === 'wrecked' && S.ship) api.updateWreck(dt);
    api.updateAbductees(dt);
    api.updateMutants(dt);
    for (const alien of S.aliens) api.updateAlien(alien, dt);
    api.updateRays(dt);
  }

  /** @returns {Alien[]} the crew still on their feet, for Roger's sights (heroMode.js) */
  function targets() {
    return S.aliens.filter(alien => alien.phase === 'patrol' || alien.phase === 'escort');
  }

  /** @returns {number} people taken through the hatch this run */
  function abductedCount() {
    return S.state.abducted;
  }

  /**
   * The aliens on the ground, for the instancer (environment/instancer.js
   * placePrefab), which draws the ordinary ones as instances: each has its
   * own skin material (ALIENS.skin, or a burning or mutating tint), and
   * shares every other geometry and material with the rest.
   * @returns {Alien[]} the live list; not to be changed
   */
  function instanceSources() {
    return S.aliens;
  }

  /**
   * For the minimap.
   * @returns {{ship: THREE.Vector3|null, aliens: THREE.Vector3[], hunters: THREE.Vector3[]}}
   */
  function markers() {
    const out = [];
    for (const alien of S.aliens) if (alien.phase !== 'dead' && alien.phase !== 'aboard') out.push(alien.root.position);
    return {
      ship: S.ship && S.state.phase !== 'wrecked' ? S.ship.group.position : (S.wave.ship ? S.wave.ship.group.position : null),
      aliens: out,
      hunters: S.hunters.filter(h => h.phase !== 'dead').map(h => h.group.position)
    };
  }

  /** @returns {void} */
  function resetAliens() {
    api.removeShip();
    api.removeWave();
    S.wave.sent = false;
    for (const alien of S.aliens) {
      Sim.three.scene.remove(alien.root);
      alien.skin.dispose();
    }
    S.aliens = [];
    // The people themselves belong to the town the reset is replacing.
    S.abductees = [];
    for (const ray of S.rays) {
      ray.life = 0;
      ray.mesh.visible = ray.flare.visible = ray.splash.visible = false;
    }
    for (const hunter of S.hunters) api.removeHunter(hunter);
    S.hunters = [];
    for (const m of S.mutants) {
      Sim.three.scene.remove(m.halo);
      m.halo.material.dispose();
    }
    S.mutants = [];
    S.mutated = 0;
    api.stopTracker(S.shipTracker);
    for (const tr of S.hunterTrackers) api.stopTracker(tr);
    S.state.phase = 'idle';
    S.planned = null;
    S.state.mothershipCalled = false;
    S.state.timer = 0;
    S.state.abducted = 0;
    S.state.spawned = 0;
    S.state.clock = 0;
    S.state.huntersSent = false;
    S.state.plantTimer = 0;
    S.state.crashing = false;
    S.state.damage = 0;
    S.state.bannerTimer = 0;
    if (S.banner) S.banner.classList.remove('visible');
  }

  /** @returns {void} */
  function disposeAliens() {
    resetAliens();
    if (S.alienGeo) for (const geo of Object.values(S.alienGeo)) geo.dispose();
    S.alienGeo = null;
    for (const mat of [S.eyeMat, S.gunMat, S.emitterMat]) if (mat) mat.dispose();
    S.eyeMat = S.gunMat = S.emitterMat = null;
    if (S.sombrero) {
      for (const item of Object.values(S.sombrero)) item.dispose();
      S.sombrero = null;
    }
    if (S.haloGeo) S.haloGeo.dispose();
    S.haloGeo = null;
    if (S.light) Sim.three.scene.remove(S.light);
    S.light = null;
    for (const geo of S.rayGeos) geo.dispose();
    S.rayGeos = [];
    for (const ray of S.rays) {
      Sim.three.scene.remove(ray.mesh, ray.flare, ray.splash);
      for (const mesh of [ray.core, ray.glow, ray.flare, ray.splash]) mesh.material.dispose();
    }
    S.rays.length = 0;
    for (const tr of [S.shipTracker, ...S.hunterTrackers]) {
      if (!tr) continue;
      Sim.three.scene.remove(tr.group, tr.foot);
      for (const mesh of [tr.core, tr.glow, tr.foot]) mesh.material.dispose();
    }
    S.shipTracker = null;
    S.hunterTrackers = [];
    for (const geo of S.trackerGeos) geo.dispose();
    S.trackerGeos = [];
    if (S.banner && S.banner.parentNode) S.banner.parentNode.removeChild(S.banner);
    S.banner = null;
  }

  return {
    initAliens, updateAliens, abductedCount, markers, nearestAlien: api.nearestAlien, strikeAlien: api.strikeAlien, targets,
    shipTargets: api.shipTargets, huntersPresent: api.huntersPresent, plannedSpot: api.plannedSpot, frameLanding: api.frameLanding, plasmaKill: api.plasmaKill, boltKill: api.boltKill,
    sendSecondWave: api.sendSecondWave, mutate: api.mutate, mutatedCount: api.mutatedCount, instanceSources,
    resetAliens, disposeAliens
  };
}
