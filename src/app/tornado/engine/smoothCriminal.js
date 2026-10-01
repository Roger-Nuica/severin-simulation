// @ts-check
import * as THREE from 'three';
import { PERSON_BUILT_HEIGHT } from './environment/people.js';
import { CHARACTERS } from './scale.js';
import { bannerHost } from '../utils/banners.js';
import { dancePerson, stopDancing } from './dance.js';
import { filmAscent } from './smoothCriminal/ascentShot.js';

/**
 * ===========================================================================
 * SECTION AO — Smooth Criminal
 * ===========================================================================
 * A button beside Hero (btn-smooth), on request. Pressed:
 *
 *  - a tall stage rises out of the middle of town (SMOOTH.stage), its rim
 *    lit violet, spotlights on it, and the dancer standing on top -- the
 *    Smooth Criminal look: white pinstripe suit, blue shirt, white tie, a
 *    blue band on the left arm, white fedora with a black band, white socks
 *    and black shoes, long black curls (buildDancer);
 *  - public/sounds/smooth-criminal.mp3 starts, looped, through the master
 *    volume (the playlist goes quiet under it -- sound/cues.js asks
 *    songPlaying);
 *  - the camera frames the stage for a few seconds (not in Hero Mode, Chase
 *    Mode or Control Tornado, which own the camera);
 *  - SMOOTH.danceAfter seconds (two) after the press, everyone dances: every
 *    person in town (dance.js dancePerson), every alien (aliens.js), and the
 *    dancer himself, his own routine -- the moonwalk, a spin, the lean,
 *    up on his toes, kicks with a hand on the hat, the point (poseDancer).
 *    Nobody fights while it lasts (peace): the aliens take nobody and shoot
 *    nobody, the ships hold their fire and the mothership its beam, the
 *    Terminators and Roger's pursuers stand where they are, and the armed
 *    arrivals lower their guns. (The storm is not a fighter: a funnel still
 *    does what funnels do.)
 *
 * If Roger kills anyone while it lasts -- a person or an alien, with any
 * weapon (heroMode.js, heroWeapons.js call rogerKilled) -- it is over: the
 * dancing stops and the fighting comes back as before, the song fades, and
 * the dancer rises off the stage in a violet glow up to where the ships fly
 * (SMOOTH.ascendHeight) and explodes -- the nuclear plant's explosion
 * (explosions/megaBlast.js), in violet instead of green, with a violet flash
 * across the screen; no mutation. The stage goes with him.
 *
 * The camera, on request, watches it all from a medium distance
 * (smoothCriminal/ascentShot.js, through camera.js's glide): it glides out to SMOOTH.shot's
 * distance as he rises, keeping him in the middle of the frame and enough
 * sky round him for the explosion, then once he goes up it pulls back and
 * down so the blast, its ring and the mushroom over the town are all in
 * the frame -- and gives the camera back. In every camera mode, Hero Mode
 * included.
 *
 * Pressing the tile again while the show is on ends it quietly: the stage
 * sinks back into the ground, the song stops, and everyone goes back to
 * what they were doing. A Reset clears it all.
 */

const SMOOTH = {
  // The stage, in the middle of town.
  x: 0,
  z: 0,
  // A round stage for a life-size dancer (it was 12 m high for a 7.4 m one).
  stageRadius: 4.5,
  stageHeight: 6,
  // How bright the stage's own light is: the floor's glow, the neon rims and
  // strips, the spotlight beams. 0.8 on request (it washed the floor's
  // colours out in the bloom); nothing else of his is touched by it.
  stageLight: 0.8,
  riseSeconds: 1.5,
  danceAfter: 2,             // seconds from the press until everyone dances
  // The dancer, 1.9 m (engine/scale.js CHARACTERS).
  scale: CHARACTERS.smoothDancer.height / PERSON_BUILT_HEIGHT,
  routineSeconds: 18,        // one pass through his moves
  // The end.
  ascendSeconds: 4.5,
  ascendHeight: 90,          // where the ships fly
  cameraSeconds: 6,
  // The ascent seen from a medium distance (smoothCriminal/ascentShot.js): horizontal metres
  // out from the stage, from as he leaves it to the top, and then for the
  // blast; how long the blast is watched before the camera is given back.
  // (He is 1.9 m: much past 50 m out he is a speck.)
  // The blast's fireballs are spread 300 m across the town (VIOLET_BLAST):
  // the whole of it is only in frame from well outside it.
  shot: { near: 24, far: 50, blast: 260, blastHeight: 75, blastLook: 95, watch: 7 },
  song: '/sounds/smooth-criminal.mp3',   // public/sounds, where it was added
  songLevel: 0.95,
  songFade: 2,
  bannerSeconds: 4
};

/**
 * The nuclear plant's blast (nuclear.js NUCLEAR_BLAST) in violet.
 * @type {import('./explosions/megaBlast.js').MegaBlastConfig}
 */
const VIOLET_BLAST = {
  core: 60,
  ringCount: 16,
  ringRadius: 55,
  ringStrength: 48,
  satellites: 60,
  satelliteSpread: 300,
  satelliteInterval: 0.035,
  satelliteStrength: [26, 46],
  shockSpeed: 190,
  radius: 460,
  throwForce: 140,
  buildingShock: 13,
  fireRadius: 280,
  killRadius: 55,
  throwPeople: false,
  mushroom: {
    rise: 360, riseSeconds: 7, stem: 14, cap: 105, linger: 15, fade: 10,
    fire: new THREE.Color(1.9, 0.55, 2.8), smoke: 0x3a2b4f, skirt: 0x5b3c7e
  },
  ringColour: new THREE.Color(2.3, 0.9, 3.2),
  flash: { colour: '#c77dff', peak: 0.95, hold: 0.6, seconds: 3.6 },
  event: 'nuke',
  heroKill: { title: 'VAPORISED', sub: 'Roger was too close when it went up' }
};

/**
 * A pinstripe: thin grey lines down a white cloth.
 * @returns {THREE.CanvasTexture}
 */
function createPinstripeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 8;
  const g = canvas.getContext('2d');
  g.fillStyle = '#f4f3ef';
  g.fillRect(0, 0, 64, 8);
  g.fillStyle = '#a9adb5';
  for (let x = 4; x < 64; x += 8) g.fillRect(x, 0, 1, 8);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 6);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A dance floor: glowing squares.
 * @returns {THREE.CanvasTexture}
 */
function createFloorTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  const colours = ['#3b1a5e', '#8a3fd1', '#1f0f33', '#c77dff'];
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      g.fillStyle = colours[(i + j * 3 + ((i * j) % 3)) % colours.length];
      g.fillRect(i * 16, j * 16, 15, 15);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * @param {Object} ctx
 * @returns {{
 *   initSmoothCriminal: () => void,
 *   updateSmoothCriminal: (dt: number) => void,
 *   peace: () => boolean,
 *   songPlaying: () => boolean,
 *   rogerKilled: () => void,
 *   resetSmoothCriminal: () => void,
 *   disposeSmoothCriminal: () => void
 * }}
 */
export function createSmoothCriminalSystem(ctx) {
  const { Sim } = ctx;
  // Scratch, reused every frame rather than allocated (performance pass).
  const beamBase = new THREE.Vector3();
  const beamTip = new THREE.Vector3();
  const beamDir = new THREE.Vector3();
  const beamSpan = new THREE.Vector3();
  const UP_AXIS = new THREE.Vector3(0, 1, 0);

  const state = {
    /** @type {'idle'|'rising'|'dancing'|'ascending'|'sinking'} */
    phase: 'idle',
    timer: 0,
    danceTime: 0,
    bannerTimer: 0,
    songLevel: 0
  };
  /** @type {THREE.Group|null} */
  let stage = null;
  /** @type {Object|null} the dancer and his joints */
  let dancer = null;
  /** @type {THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[]} */
  let beams = [];
  /** @type {THREE.Material[]} */
  const materials = [];
  /** @type {THREE.BufferGeometry[]} */
  const geometries = [];
  /** @type {THREE.Texture[]} */
  const textures = [];
  /** @type {HTMLAudioElement|null} */
  let audio = null;
  /** @type {GainNode|null} the song's level, when it goes through Web Audio */
  let songGain = null;
  /** @type {HTMLButtonElement|null} */
  let button = null;
  /** @type {HTMLDivElement|null} */
  let banner = null;
  const onClick = () => toggle();

  /**
   * @template {THREE.Material} M
   * @param {M} material
   * @returns {M}
   */
  function keepMat(material) {
    materials.push(material);
    return material;
  }

  /**
   * @template {THREE.BufferGeometry} G
   * @param {G} geometry
   * @returns {G}
   */
  function keepGeo(geometry) {
    geometries.push(geometry);
    return geometry;
  }

  /** @returns {void} */
  function initSmoothCriminal() {
    // A killing by Roger (engine/events.js rogerKill) breaks the peace.
    ctx.events.on('rogerKill', rogerKilled);
    button = /** @type {HTMLButtonElement|null} */ (document.getElementById('btn-smooth'));
    if (button) button.addEventListener('click', onClick, { signal: ctx.signal });
    banner = document.createElement('div');
    banner.className = 'downburst-banner';
    banner.innerHTML = '<span class="title"></span><span class="sub"></span>';
    bannerHost(ctx.container).appendChild(banner);
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
    state.bannerTimer = SMOOTH.bannerSeconds;
  }

  // ---------------------------------------------------------------------
  // The models
  // ---------------------------------------------------------------------

  /**
   * The stage: a tall drum with violet-lit rims, a glowing dance floor on
   * top, and four spotlight beams from its edge up to the dancer.
   * @returns {THREE.Group}
   */
  function buildStage() {
    const group = new THREE.Group();
    group.name = 'smooth_stage';
    const R = SMOOTH.stageRadius;
    const H = SMOOTH.stageHeight;
    const body = new THREE.Mesh(keepGeo(new THREE.CylinderGeometry(R, R * 1.12, H, 40)),
      keepMat(new THREE.MeshStandardMaterial({ color: 0x17141d, roughness: 0.35, metalness: 0.6 })));
    body.position.y = H / 2;
    body.castShadow = body.receiveShadow = true;
    const floorTexture = createFloorTexture();
    textures.push(floorTexture);
    const floor = new THREE.Mesh(keepGeo(new THREE.CircleGeometry(R * 0.98, 40)),
      keepMat(new THREE.MeshStandardMaterial({ map: floorTexture, emissiveMap: floorTexture, emissive: 0xffffff, emissiveIntensity: 0.9 * SMOOTH.stageLight, roughness: 0.3 })));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = H + 0.02;
    const neon = keepMat(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.8, 3.2).multiplyScalar(SMOOTH.stageLight) }));
    const rimGeo = keepGeo(new THREE.TorusGeometry(R, 0.18, 8, 48));
    for (const y of [H, H * 0.55, 0.3]) {
      const rim = new THREE.Mesh(rimGeo, neon);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = y;
      rim.scale.setScalar(y < 1 ? 1.12 : y < H ? 1.06 : 1);
      group.add(rim);
    }
    // Stripes of light up the side.
    const stripGeo = keepGeo(new THREE.BoxGeometry(0.25, H * 0.9, 0.12));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const strip = new THREE.Mesh(stripGeo, neon);
      strip.position.set(Math.cos(a) * R * 1.07, H * 0.45, Math.sin(a) * R * 1.07);
      strip.rotation.y = -a;
      group.add(strip);
    }
    group.add(body, floor);
    // Spotlight beams: open cones from the stage's edge up to him.
    const coneGeo = keepGeo(new THREE.CylinderGeometry(0.4, 3.2, 1, 16, 1, true));
    coneGeo.translate(0, -0.5, 0);
    beams = [];
    const colours = [new THREE.Color(1.6, 1.4, 2.4), new THREE.Color(2.2, 0.7, 2.8), new THREE.Color(1.4, 1.4, 1.6), new THREE.Color(2.4, 0.9, 2)];
    colours.forEach((colour) => {
      const cone = new THREE.Mesh(coneGeo, keepMat(new THREE.MeshBasicMaterial({
        color: colour, transparent: true, opacity: 0.18 * SMOOTH.stageLight, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      })));
      cone.frustumCulled = false;
      group.add(cone);
      beams.push(cone);
    });
    group.position.set(SMOOTH.x, -H, SMOOTH.z);
    return group;
  }

  /**
   * The dancer, in the look of the photos on request: white pinstripe suit,
   * blue shirt, white tie, blue armband on the left arm, white fedora with a
   * black band, white socks, black shoes, long black curls. Built in the
   * town people's units (feet at 0, about 1.9 tall), jointed at the hips,
   * shoulders, waist and neck so poseDancer can move him; the root's origin
   * is at his feet, so the lean tips him from the ankles.
   * @returns {Object}
   */
  function buildDancer() {
    const stripes = createPinstripeTexture();
    textures.push(stripes);
    const suit = keepMat(new THREE.MeshStandardMaterial({ color: 0xffffff, map: stripes, roughness: 0.6 }));
    const shirt = keepMat(new THREE.MeshStandardMaterial({ color: 0x2f64b4, roughness: 0.55 }));
    const white = keepMat(new THREE.MeshStandardMaterial({ color: 0xf6f5f1, roughness: 0.5 }));
    const black = keepMat(new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.25, metalness: 0.4 }));
    const hair = keepMat(new THREE.MeshStandardMaterial({ color: 0x0c0b0c, roughness: 0.45 }));
    const skin = keepMat(new THREE.MeshStandardMaterial({ color: 0xc99a7a, roughness: 0.7 }));
    const band = keepMat(new THREE.MeshStandardMaterial({ color: 0x2f64b4, roughness: 0.5 }));
    /**
     * @param {THREE.Object3D} parent
     * @param {THREE.BufferGeometry} geometry
     * @param {THREE.Material} material
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {THREE.Mesh}
     */
    const add = (parent, geometry, material, x, y, z) => {
      const mesh = new THREE.Mesh(keepGeo(geometry), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const root = new THREE.Group();
    root.name = 'smooth_dancer';
    root.rotation.order = 'YXZ';
    // Legs, from the hip: trousers, white sock, black shoe.
    const legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.1, 0.84, 0);
      root.add(hip);
      add(hip, new THREE.CylinderGeometry(0.085, 0.07, 0.74, 10), suit, 0, -0.37, 0);
      add(hip, new THREE.CylinderGeometry(0.06, 0.06, 0.07, 10), white, 0, -0.77, 0);
      add(hip, new THREE.BoxGeometry(0.12, 0.07, 0.27), black, 0, -0.81, 0.05);
      legs.push(hip);
    }
    // The waist: everything above the belt leans and twists from here.
    const waist = new THREE.Group();
    waist.position.y = 0.86;
    root.add(waist);
    add(waist, new THREE.CylinderGeometry(0.2, 0.17, 0.62, 14), suit, 0, 0.3, 0).scale.set(1.08, 1, 0.75);
    // The jacket's skirt, over the hips.
    add(waist, new THREE.CylinderGeometry(0.18, 0.2, 0.2, 14), suit, 0, -0.04, 0).scale.set(1.08, 1, 0.78);
    // Shirt, tie, lapels, pocket square.
    add(waist, new THREE.BoxGeometry(0.13, 0.3, 0.02), shirt, 0, 0.44, 0.145);
    add(waist, new THREE.BoxGeometry(0.045, 0.34, 0.02), white, 0, 0.4, 0.16);
    for (const side of [-1, 1]) {
      const lapel = add(waist, new THREE.BoxGeometry(0.06, 0.28, 0.02), suit, side * 0.08, 0.45, 0.158);
      lapel.rotation.z = side * 0.3;
    }
    add(waist, new THREE.BoxGeometry(0.06, 0.03, 0.02), shirt, 0.12, 0.47, 0.15);
    // Arms, from the shoulder: sleeve, blue cuff, hand; the band on the left.
    const arms = [];
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.25, 0.56, 0);
      waist.add(shoulder);
      add(shoulder, new THREE.SphereGeometry(0.08, 10, 8), suit, 0, 0, 0);
      add(shoulder, new THREE.CylinderGeometry(0.065, 0.055, 0.56, 10), suit, 0, -0.28, 0);
      add(shoulder, new THREE.CylinderGeometry(0.058, 0.058, 0.05, 10), shirt, 0, -0.56, 0);
      add(shoulder, new THREE.SphereGeometry(0.05, 8, 6), skin, 0, -0.62, 0).scale.set(0.85, 1.2, 0.7);
      if (side < 0) add(shoulder, new THREE.CylinderGeometry(0.071, 0.071, 0.08, 10), band, 0, -0.14, 0);
      shoulder.rotation.z = side * 0.12;
      arms.push(shoulder);
    }
    // The head, with the curls and the fedora.
    const neck = new THREE.Group();
    neck.position.y = 0.66;
    waist.add(neck);
    add(neck, new THREE.CylinderGeometry(0.05, 0.055, 0.1, 8), skin, 0, 0.04, 0);
    add(neck, new THREE.SphereGeometry(0.13, 14, 12), skin, 0, 0.2, 0.01).scale.set(0.9, 1.1, 0.95);
    // Hair: a cap at the back and curls hanging to the jaw, bangs at the front.
    add(neck, new THREE.SphereGeometry(0.14, 14, 10), hair, 0, 0.24, -0.03).scale.set(1, 0.95, 1);
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * 0.35 + (i / 8) * Math.PI * 1.3;
      const curl = add(neck, new THREE.CylinderGeometry(0.02, 0.012, 0.22, 5), hair, Math.cos(a) * 0.13, 0.1, Math.sin(a) * -0.12);
      curl.rotation.z = Math.cos(a) * 0.3;
    }
    for (const side of [-1, 1]) {
      const bang = add(neck, new THREE.CylinderGeometry(0.014, 0.008, 0.16, 5), hair, side * 0.05, 0.22, 0.12);
      bang.rotation.set(0.3, 0, side * 0.35);
    }
    // The fedora, tipped forward over the eyes.
    const hat = new THREE.Group();
    hat.position.set(0, 0.33, 0.01);
    hat.rotation.x = 0.16;
    neck.add(hat);
    add(hat, new THREE.CylinderGeometry(0.25, 0.25, 0.015, 24), white, 0, 0, 0);
    add(hat, new THREE.CylinderGeometry(0.12, 0.14, 0.14, 18), white, 0, 0.075, 0);
    add(hat, new THREE.CylinderGeometry(0.142, 0.142, 0.04, 18), black, 0, 0.025, 0);
    root.scale.setScalar(SMOOTH.scale);
    return { root, legL: legs[0], legR: legs[1], armL: arms[0], armR: arms[1], waist, neck, hat, glow: [suit, white] };
  }

  // ---------------------------------------------------------------------
  // His routine
  // ---------------------------------------------------------------------

  /**
   * One pass through his moves, a pure function of time (seconds into the
   * dance): the moonwalk, a spin, the lean, up on his toes, kicks with a
   * hand on the hat, and the point, round again every routineSeconds.
   * @param {number} t
   * @returns {void}
   */
  function poseDancer(t) {
    const d = dancer;
    const u = t % SMOOTH.routineSeconds;
    const beat = t * Math.PI * 2 * 1.9;
    const s = Math.sin(beat);
    const top = SMOOTH.stageHeight;
    // Standing: arms a little out, waist straight.
    d.root.position.set(SMOOTH.x, top, SMOOTH.z);
    d.root.rotation.set(0, d.facing, 0);
    d.waist.rotation.set(0, 0, 0);
    d.neck.rotation.set(0, 0, 0);
    d.legL.rotation.set(0, 0, 0);
    d.legR.rotation.set(0, 0, 0);
    d.armL.rotation.set(0, 0, -0.12);
    d.armR.rotation.set(0, 0, 0.12);
    const fx = Math.sin(d.facing);
    const fz = Math.cos(d.facing);
    if (u < 4) {
      // The moonwalk: gliding backwards while the feet seem to walk forwards.
      const glide = ((u / 4) * 2 - 1) * 2.4;
      d.root.position.x -= fx * glide;
      d.root.position.z -= fz * glide;
      const step = Math.sin(u * Math.PI * 2.5);
      d.legL.rotation.x = Math.max(0, step) * 0.45;
      d.legR.rotation.x = Math.max(0, -step) * 0.45;
      d.root.position.y += Math.abs(step) * 0.04;
      d.armL.rotation.set(-0.5 - 0.2 * step, 0, -0.2);
      d.armR.rotation.set(-0.5 + 0.2 * step, 0, 0.2);
      d.waist.rotation.x = 0.08;
    } else if (u < 6) {
      // The spin, a hand on the hat.
      const k = (u - 4) / 2;
      d.root.rotation.y = d.facing + k * Math.PI * 4;
      d.armR.rotation.set(-0.3, 0, 2.7);
      d.armL.rotation.set(0, 0, -0.5);
      d.legL.rotation.z = -0.05;
      d.root.position.y += 0.08;
    } else if (u < 9.5) {
      // The lean: stiff as a board, forward from the ankles.
      const k = Math.min(1, (u - 6) / 0.8) * Math.min(1, (9.5 - u) / 0.6);
      d.root.rotation.x = 0.78 * k;
      d.armL.rotation.set(0.1, 0, -0.08);
      d.armR.rotation.set(0.1, 0, 0.08);
    } else if (u < 11.5) {
      // Up on his toes, knees together, arms out and fingers spread.
      d.root.position.y += 0.18;
      d.legL.rotation.z = 0.06;
      d.legR.rotation.z = -0.06;
      d.armL.rotation.set(0, 0, -1.2 - 0.1 * s);
      d.armR.rotation.set(0, 0, 1.2 + 0.1 * s);
      d.neck.rotation.x = -0.25;
    } else if (u < 15) {
      // Kicks, a hand on the hat brim.
      const kick = Math.max(0, Math.sin((u - 11.5) * Math.PI * 2));
      const left = Math.floor((u - 11.5) * 2) % 2 === 0;
      (left ? d.legL : d.legR).rotation.x = -1.1 * kick;
      d.armR.rotation.set(-0.4, 0, 2.5);
      d.armL.rotation.set(-0.6, 0, -0.3 - 0.5 * kick);
      d.waist.rotation.x = -0.12 * kick;
      d.root.position.y += 0.05 * kick;
    } else {
      // The point: one arm to the sky on the beat, the head snapping after it.
      const snap = s > 0 ? 1 : 0;
      d.armR.rotation.set(-0.2, 0, 2.2 + 0.4 * snap);
      d.armL.rotation.set(0, 0, -0.35);
      d.neck.rotation.set(-0.3 * snap, 0.4 * snap, 0);
      d.waist.rotation.set(0, 0, 0.12 * snap);
      d.legR.rotation.z = 0.18;
    }
  }

  // ---------------------------------------------------------------------
  // The song
  // ---------------------------------------------------------------------

  /**
   * Starts the song, looped, through the master volume where Web Audio is
   * up (so the volume slider and Mute apply), otherwise on its own.
   * @returns {void}
   */
  function startSong() {
    if (!audio) {
      audio = new Audio(SMOOTH.song);
      audio.loop = true;
      audio.preload = 'auto';
      const SS = ctx.SoundSystem;
      // Only into a running context: a suspended one would swallow it.
      if (SS && SS.context && SS.context.state === 'running' && SS.masterGain) {
        try {
          const source = SS.context.createMediaElementSource(audio);
          songGain = SS.context.createGain();
          songGain.gain.value = 0;
          source.connect(songGain);
          songGain.connect(SS.masterGain);
        } catch {
          songGain = null;
        }
      }
    }
    audio.currentTime = 0;
    state.songLevel = 1;
    setSongLevel(SMOOTH.songLevel);
    const playing = audio.play();
    if (playing && playing.catch) {
      playing.catch(err => console.warn(`Smooth Criminal: could not play ${SMOOTH.song} -- is it in public/sounds?`, err));
    }
  }

  /**
   * @param {number} level
   * @returns {void}
   */
  function setSongLevel(level) {
    if (!audio) return;
    if (songGain) {
      songGain.gain.value = level;
      audio.volume = 1;
    } else {
      audio.volume = THREE.MathUtils.clamp(level, 0, 1);
    }
  }

  /** @returns {void} */
  function stopSongNow() {
    state.songLevel = 0;
    if (!audio) return;
    audio.pause();
    setSongLevel(0);
  }

  /**
   * Whether the song is up, for sound/cues.js to quieten the playlist.
   * @returns {boolean}
   */
  function songPlaying() {
    return !!audio && !audio.paused && state.songLevel > 0;
  }

  // ---------------------------------------------------------------------
  // The show
  // ---------------------------------------------------------------------

  /** @returns {void} */
  function toggle() {
    if (state.phase === 'idle') start();
    else if (state.phase === 'rising' || state.phase === 'dancing') endQuietly();
  }

  /** @returns {void} */
  function start() {
    clearModels();
    stage = buildStage();
    dancer = buildDancer();
    const cam = Sim.three.camera.position;
    dancer.facing = Math.atan2(cam.x - SMOOTH.x, cam.z - SMOOTH.z);
    Sim.three.scene.add(stage, dancer.root);
    poseDancer(0);
    dancer.root.position.y = -SMOOTH.stageHeight;
    Object.assign(state, { phase: 'rising', timer: 0, danceTime: 0 });
    startSong();
    if (button) {
      button.classList.add('active');
      button.setAttribute('aria-pressed', 'true');
    }
    showBanner('SMOOTH CRIMINAL', 'Everybody dance · no more fighting · kill anyone and it is over');
    // The stage in the middle of the screen, unless a mode owns the camera.
    const owned = (ctx.Hero && ctx.Hero.active) || (ctx.Chase && ctx.Chase.active) || (ctx.Possess && ctx.Possess.active);
    if (!owned && ctx.systems.camera) {
      ctx.systems.camera.playCameraBeat(SMOOTH.cameraSeconds, (position, target) => {
        position.set(SMOOTH.x + Math.sin(dancer ? dancer.facing : 0) * 14, SMOOTH.stageHeight + 3, SMOOTH.z + Math.cos(dancer ? dancer.facing : 0) * 14);
        target.set(SMOOTH.x, SMOOTH.stageHeight + 1.2, SMOOTH.z);
      }, { always: true });
    }
  }

  /**
   * Everyone back to what they were doing.
   * @returns {void}
   */
  function stopEveryone() {
    for (const person of ctx.Environment.people) if (person.dancing) stopDancing(person);
  }

  /**
   * The tile pressed again mid-show: the stage sinks, the song stops, no
   * explosion.
   * @returns {void}
   */
  function endQuietly() {
    stopEveryone();
    Object.assign(state, { phase: 'sinking', timer: 0 });
    stopSongNow();
    setButtonOff();
  }

  /** @returns {void} */
  function setButtonOff() {
    if (!button) return;
    button.classList.remove('active');
    button.setAttribute('aria-pressed', 'false');
  }

  /**
   * Roger has killed someone (heroMode.js, heroWeapons.js): only while the
   * dance is on does it matter.
   * @returns {void}
   */
  function rogerKilled() {
    if (state.phase !== 'dancing' && state.phase !== 'rising') return;
    stopEveryone();
    Object.assign(state, { phase: 'ascending', timer: 0 });
    filmAscent(ctx, SMOOTH, () => (dancer && state.phase === 'ascending' ? dancer.root.position : null));
    showBanner('YOU BROKE THE PEACE', 'The fighting is back · he is rising');
    ctx.events.emit('announce', { title: 'YOU BROKE THE PEACE', sub: 'The fighting is back' });
  }

  /**
   * At the top: the violet explosion, and the show is over.
   * @returns {void}
   */
  function explode() {
    const high = dancer.root.position.clone();
    const explosions = ctx.systems.explosions;
    explosions.spawnImpactBurst(high, 60);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      explosions.spawnImpactBurst(new THREE.Vector3(high.x + Math.cos(a) * 20, high.y + (Math.random() - 0.5) * 16, high.z + Math.sin(a) * 20), 30);
    }
    ctx.systems.megaBlast.detonate(new THREE.Vector3(SMOOTH.x, 2, SMOOTH.z), VIOLET_BLAST);
    ctx.systems.damage.addDamageScore(30000);
    showBanner('HE IS GONE', 'In a violet flash · +30000');
    clearModels();
    Object.assign(state, { phase: 'idle', timer: 0 });
    setButtonOff();
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  function updateSmoothCriminal(dt) {
    if (state.bannerTimer > 0) {
      state.bannerTimer -= dt;
      if (state.bannerTimer <= 0 && banner) banner.classList.remove('visible');
    }
    // The song fading out after the end (real seconds are close enough).
    if (state.phase === 'ascending' && audio && !audio.paused) {
      state.songLevel = Math.max(0, state.songLevel - dt / SMOOTH.songFade);
      setSongLevel(SMOOTH.songLevel * state.songLevel);
      if (state.songLevel <= 0) audio.pause();
    }
    if (state.phase === 'idle' || dt <= 0) return;
    state.timer += dt;
    const H = SMOOTH.stageHeight;

    if (state.phase === 'rising' || state.phase === 'dancing') {
      const u = Math.min(1, state.timer / SMOOTH.riseSeconds);
      const ease = 1 - (1 - u) ** 3;
      stage.position.y = -H + H * ease;
      if (state.phase === 'rising' && state.timer >= SMOOTH.danceAfter) {
        state.phase = 'dancing';
        showBanner('EVERYBODY DANCE', 'People and aliens alike · Roger, keep your finger off the trigger');
      }
      if (state.phase === 'dancing') {
        state.danceTime += dt;
        poseDancer(state.danceTime);
        // Everybody in town, on their feet, dances (dance.js).
        for (const person of ctx.Environment.people) {
          if (!person.mesh.parent || person.abducted || person.electrocuted || person.captureState !== 'grounded') continue;
          person.dancing = true;
          dancePerson(person, state.danceTime);
        }
      } else {
        poseDancer(0);
        dancer.root.position.y = stage.position.y + H;
      }
    } else if (state.phase === 'ascending') {
      const u = Math.min(1, state.timer / SMOOTH.ascendSeconds);
      const ease = u * u * (3 - 2 * u);
      poseDancer(state.danceTime);
      dancer.root.position.y = H + (SMOOTH.ascendHeight - H) * ease;
      dancer.root.rotation.set(0, dancer.facing + u * u * Math.PI * 8, 0);
      dancer.armL.rotation.set(0, 0, -2.4);
      dancer.armR.rotation.set(0, 0, 2.4);
      // Glowing violet, brighter as he goes.
      for (const mat of dancer.glow) {
        mat.emissive.setRGB(1.2 * u, 0.3 * u, 1.8 * u);
      }
      if (Math.random() < dt * 6 * u) {
        ctx.systems.lightning.flashScreen(dancer.root.position, 0.25 * u, '#b86bff');
      }
      // The stage going dark under him.
      stage.position.y = -H * ease * 0.9;
      if (u >= 1) explode();
      return;
    } else if (state.phase === 'sinking') {
      const u = Math.min(1, state.timer / SMOOTH.riseSeconds);
      stage.position.y = -H * u * u;
      dancer.root.position.y = stage.position.y + H;
      if (u >= 1) {
        clearModels();
        state.phase = 'idle';
      }
      return;
    }
    // The spotlights on him, sweeping a little.
    beams.forEach((cone, i) => {
      const a = (i / beams.length) * Math.PI * 2 + state.timer * 0.4;
      const base = beamBase.set(Math.cos(a) * SMOOTH.stageRadius * 2.4, 0, Math.sin(a) * SMOOTH.stageRadius * 2.4);
      const tip = beamTip.set(Math.sin(state.timer * 1.3 + i) * 1.2, H + 5, Math.cos(state.timer * 1.1 + i) * 1.2);
      const dir = beamSpan.copy(tip).sub(base);
      cone.position.copy(tip);
      cone.quaternion.setFromUnitVectors(UP_AXIS, beamDir.copy(dir).normalize().negate());
      cone.scale.set(1, dir.length(), 1);
      cone.material.opacity = (0.12 + 0.08 * Math.sin(state.timer * 5 + i)) * SMOOTH.stageLight;
    });
  }

  /**
   * Nobody fights while he dances (see the header).
   * @returns {boolean}
   */
  function peace() {
    return state.phase === 'dancing';
  }

  /** @returns {void} */
  function clearModels() {
    if (stage) Sim.three.scene.remove(stage);
    if (dancer) Sim.three.scene.remove(dancer.root);
    stage = null;
    dancer = null;
    beams = [];
    for (const m of materials) m.dispose();
    for (const g of geometries) g.dispose();
    for (const t of textures) t.dispose();
    materials.length = geometries.length = textures.length = 0;
  }

  /** @returns {void} */
  function resetSmoothCriminal() {
    stopEveryone();
    stopSongNow();
    clearModels();
    Object.assign(state, { phase: 'idle', timer: 0, danceTime: 0, bannerTimer: 0 });
    setButtonOff();
    if (banner) banner.classList.remove('visible');
  }

  /** @returns {void} */
  function disposeSmoothCriminal() {
    resetSmoothCriminal();
    if (button) button.removeEventListener('click', onClick);
    button = null;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    audio = null;
    if (songGain) {
      try { songGain.disconnect(); } catch { /* already */ }
    }
    songGain = null;
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }

  return {
    initSmoothCriminal, updateSmoothCriminal, peace, songPlaying, rogerKilled,
    resetSmoothCriminal, disposeSmoothCriminal
  };
}
