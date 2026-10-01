// @ts-check
import * as THREE from 'three';
import { SCRIPTED_CAMERAS } from './camera.js';

/**
 * ===========================================================================
 * SECTION AF — Kill-cam
 * ===========================================================================
 * You are almost never looking at the right place when the good thing
 * happens. The funnel is here, the viaduct comes down over there, and by the
 * time the camera has swung round there is a pile of rubble and no memory of
 * how it got that way.
 *
 * So the simulation keeps the last few seconds of itself in a ring buffer,
 * and when something big enough happens it stops, rewinds, and plays the
 * moment back in slow motion from an angle that was chosen to frame it.
 *
 * How it works:
 *
 *  - Every 1/24s, the transform of everything that moves is written into a
 *    flat Float32Array -- one fixed slot per object, held for as long as that
 *    object exists. Buildings contribute a slot *per piece*, because a
 *    building coming down is the shot this whole feature exists for and the
 *    root never moves.
 *  - engine/gamefeel.js already classifies its events by weight, and the ones
 *    it marks `heavy` are exactly the ones worth watching twice. One of those
 *    arms a replay, which fires a beat later so the buffer catches the
 *    aftermath as well as the cause.
 *  - The replay pauses the simulation, winds the recorded transforms back on
 *    to the scene, and orbits the camera round the event. Frames are
 *    interpolated, so a 24Hz recording played at a third speed is smooth
 *    rather than a slide show.
 *
 * **What it cannot replay is particles.** Fire, smoke, explosions, debris
 * trails and the funnel's own swirl are pooled systems with thousands of
 * elements each, and buffering them would cost two orders of magnitude more
 * memory than the transforms do. They would otherwise hang frozen in the air
 * at the state they had reached when the replay started, over a scene wound
 * back to before the event -- a building standing up inside its own smoke
 * cloud. So every Points and LineSegments layer is hidden for the duration
 * and the replay is a clean geometric shot: structures folding, vehicles
 * tumbling, the funnel's shell. The cut in and out goes through black, which
 * is what sells it as a replay rather than as a rendering fault.
 */

const KILLCAM = {
  // Recording. 24Hz over four seconds, which is long enough to hold the
  // run-up to a collapse and its aftermath.
  rate: 24,
  seconds: 4,
  // Objects tracked at once. A town is roughly 240 building pieces, 400
  // pieces of debris and 90 vehicles, people and trees; the ceiling is set
  // above that so nothing ordinary is dropped, and the buffer is a single
  // allocation at start-up either way.
  slots: 1000,
  // Replay. `lead` is how long to keep recording after the event before
  // cutting, so the payoff is in the buffer and not just the trigger.
  lead: 1.4,
  rate_: 0.34,                 // replay speed, as a fraction of real time
  // How much of the buffer to show, ending at the moment the replay fires.
  // Below `seconds` so a slot that was only assigned partway through the
  // window is not asked for a frame that was never written. Halved from 3.4:
  // the replay (which pauses the simulation for its whole span, see `begin`)
  // was holding the screen for ~10 real seconds at `rate_` below, which read
  // as the run stalling rather than a highlight.
  window: 1.7,
  fade: 0.22,                  // seconds of black at each end of the cut
  cooldown: 22,                // seconds before another replay may fire
  // Only the heaviest events earn one. gamefeel's `heavy` events run from
  // 0.7 (a building down) to 2.1 (a steam explosion).
  minShake: 0.95,
  // Framing. The camera orbits this far out, at this height, sweeping this
  // far round over the replay.
  radius: [46, 96],
  height: 0.46,                // of the radius
  sweep: 0.55,                 // radians
  lookHeight: 7
};

// Per-slot floats: position, quaternion, and whether the object existed on
// that frame at all.
const STRIDE = 8;

/**
 * @typedef {Object} Slot
 * @property {Object|null} owner the SimObject or building piece it follows
 * @property {boolean} pooled whether the owner keeps its own position/rotation
 *   (debris) rather than a mesh
 * @property {number} seen the record tick it was last alive on
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initKillcam: () => void,
 *   updateKillcam: (rawDt: number) => void,
 *   notable: (kind: string, at: THREE.Vector3, shake: number) => void,
 *   isReplaying: () => boolean,
 *   resetKillcam: () => void,
 *   disposeKillcam: () => void
 * }}
 */
export function createKillcamSystem(ctx) {
  const { Sim } = ctx;

  const frames = Math.round(KILLCAM.rate * KILLCAM.seconds);
  /** @type {Float32Array|null} */
  let buffer = null;
  /** @type {Slot[]} */
  const slots = [];
  /** @type {number[]} */
  const free = [];
  let writeFrame = 0;          // the next frame index to write
  let written = 0;             // frames written since the last reset, capped
  let tick = 0;                // record ticks, for slot liveness
  let sinceRecord = 0;

  const state = {
    /** @type {'idle'|'armed'|'replaying'} */
    phase: 'idle',
    timer: 0,
    elapsed: 0,                // seconds into the replay
    cooldown: 0,
    bearing: 0,
    radius: 60,
    /** @type {THREE.Vector3} */
    at: new THREE.Vector3(),
    label: '',
    wasPaused: false
  };

  /** @type {HTMLDivElement|null} */
  let chrome = null;
  /** @type {HTMLDivElement|null} */
  let fader = null;
  /** @type {THREE.Object3D[]} */
  const hidden = [];
  const scratchPos = new THREE.Vector3();
  const scratchPosB = new THREE.Vector3();
  const scratchQuat = new THREE.Quaternion();
  const scratchQuatB = new THREE.Quaternion();
  const scratchEuler = new THREE.Euler();
  const lookAt = new THREE.Vector3();

  /** @returns {void} */
  function initKillcam() {
    buffer = new Float32Array(frames * KILLCAM.slots * STRIDE);
    for (let i = 0; i < KILLCAM.slots; i++) {
      slots.push({ owner: null, pooled: false, seen: -1 });
      free.push(i);
    }

    // Letterbox bars and a caption. Kept out of the banner stack: this is not
    // an announcement, it is the frame the replay is shown inside.
    chrome = document.createElement('div');
    chrome.className = 'killcam';
    chrome.innerHTML =
      '<div class="killcam-bar killcam-top"></div>'
      + '<div class="killcam-bar killcam-bottom"></div>'
      + '<div class="killcam-label"><span class="killcam-dot"></span><span class="killcam-text"></span></div>';
    ctx.container.appendChild(chrome);

    fader = document.createElement('div');
    fader.className = 'killcam-fade';
    ctx.container.appendChild(fader);
  }

  // ---------------------------------------------------------------------
  // Recording
  // ---------------------------------------------------------------------

  /**
   * @param {Object} owner
   * @param {boolean} pooled
   * @returns {number} its slot, or -1 when the buffer is full
   */
  function slotFor(owner, pooled) {
    if (owner.killcamSlot !== undefined && owner.killcamSlot >= 0) {
      const slot = slots[owner.killcamSlot];
      if (slot.owner === owner) return owner.killcamSlot;
    }
    if (!free.length) return -1;
    const index = free.pop();
    slots[index].owner = owner;
    slots[index].pooled = pooled;
    owner.killcamSlot = index;
    // A slot handed to a new owner must not show the old one's history, or a
    // replay would open with a car standing where a tree used to be.
    for (let f = 0; f < frames; f++) {
      buffer[(f * KILLCAM.slots + index) * STRIDE + 7] = 0;
    }
    return index;
  }

  /**
   * @param {number} index
   * @param {THREE.Vector3} position
   * @param {THREE.Quaternion} quaternion
   * @returns {void}
   */
  function write(index, position, quaternion) {
    const base = (writeFrame * KILLCAM.slots + index) * STRIDE;
    buffer[base] = position.x;
    buffer[base + 1] = position.y;
    buffer[base + 2] = position.z;
    buffer[base + 3] = quaternion.x;
    buffer[base + 4] = quaternion.y;
    buffer[base + 5] = quaternion.z;
    buffer[base + 6] = quaternion.w;
    buffer[base + 7] = 1;
    slots[index].seen = tick;
  }

  /** @returns {void} */
  function record() {
    tick++;
    // Everything in the world that moves.
    for (const obj of Sim.objects) {
      if (obj.type === 'building') {
        if (!obj.mesh) continue;
        // The root *and* every piece. The pieces carry a collapse that sheds
        // walls where it stands; the root carries one that goes over, since a
        // topple rotates the whole group and never touches a piece's own
        // transform (engine/topple.js). Recording only the pieces would replay
        // a tower standing perfectly still while the world fell over round it.
        const rootIndex = slotFor(obj.mesh, false);
        if (rootIndex >= 0) write(rootIndex, obj.mesh.position, obj.mesh.quaternion);
        for (const piece of obj.mesh.children) {
          const index = slotFor(piece, false);
          if (index < 0) continue;
          write(index, piece.position, piece.quaternion);
        }
        continue;
      }
      if (obj.pooled) {
        const index = slotFor(obj, true);
        if (index < 0) continue;
        scratchEuler.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);
        scratchQuat.setFromEuler(scratchEuler);
        write(index, obj.position, scratchQuat);
        continue;
      }
      if (!obj.mesh) continue;
      // The *mesh* owns the slot, not the SimObject around it: a slot's owner
      // is whatever the replay writes a transform back on to, and only a
      // pooled object keeps its own position and rotation.
      const index = slotFor(obj.mesh, false);
      if (index < 0) continue;
      write(index, obj.mesh.position, obj.mesh.quaternion);
    }

    // Slots whose owner has left the simulation (a person through a shelter
    // door, a piece of debris returned to the pool) go back on the free list
    // so the next thing to appear can have them.
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!slot.owner || slot.seen === tick) continue;
      if (slot.owner.killcamSlot === i) slot.owner.killcamSlot = -1;
      slot.owner = null;
      free.push(i);
    }

    writeFrame = (writeFrame + 1) % frames;
    written = Math.min(frames, written + 1);
  }

  // ---------------------------------------------------------------------
  // Replay
  // ---------------------------------------------------------------------

  /**
   * Called by engine/gamefeel.js for every event it classifies as heavy. Most
   * are ignored -- this picks the ones worth stopping for.
   * @param {string} kind
   * @param {THREE.Vector3} at
   * @param {number} shake how hard gamefeel thought it was
   * @returns {void}
   */
  function notable(kind, at, shake) {
    // Replays are scripted camera work too (see SCRIPTED_CAMERAS, camera.js).
    if (!SCRIPTED_CAMERAS) return;
    if (!buffer || state.phase !== 'idle' || state.cooldown > 0) return;
    if (shake < KILLCAM.minShake) return;
    // Nothing to show: the buffer has not been running long enough to hold
    // the run-up, so a replay would open on an empty scene.
    if (written < KILLCAM.rate * 1.5) return;
    state.phase = 'armed';
    state.timer = KILLCAM.lead;
    state.at.copy(at);
    state.label = LABELS[kind] || 'Destruction';
  }

  /** @returns {void} */
  function begin() {
    state.phase = 'replaying';
    state.elapsed = 0;
    state.wasPaused = Sim.state.paused;
    Sim.state.paused = true;

    // Frame it from wherever the camera is now, so the cut is a move round
    // the event rather than a jump to the far side of it.
    const camera = Sim.three.camera;
    state.bearing = Math.atan2(camera.position.x - state.at.x, camera.position.z - state.at.z)
      - KILLCAM.sweep / 2;
    state.radius = THREE.MathUtils.clamp(
      camera.position.distanceTo(state.at) * 0.75, KILLCAM.radius[0], KILLCAM.radius[1]
    );

    // Everything that cannot be replayed goes away for the duration.
    hidden.length = 0;
    Sim.three.scene.traverse((child) => {
      if (!child.visible) return;
      if (child.isPoints || child.isLineSegments) {
        child.visible = false;
        hidden.push(child);
      }
    });

    chrome.classList.add('visible');
    chrome.querySelector('.killcam-text').textContent = state.label;
  }

  /** @returns {void} */
  function end() {
    state.phase = 'idle';
    state.cooldown = KILLCAM.cooldown;
    Sim.state.paused = state.wasPaused;
    for (const child of hidden) child.visible = true;
    hidden.length = 0;
    chrome.classList.remove('visible');
    if (fader) fader.style.opacity = '0';
  }

  /**
   * Winds the scene back to a moment in the buffer, interpolating between the
   * two recorded frames either side of it.
   * @param {number} secondsAgo how far back from the newest frame
   * @returns {void}
   */
  function applyFrame(secondsAgo) {
    const newest = (writeFrame - 1 + frames) % frames;
    const back = secondsAgo * KILLCAM.rate;
    const whole = Math.floor(back);
    const blend = back - whole;
    if (whole + 1 >= written) return;

    const a = (newest - whole - 1 + frames * 2) % frames;
    const b = (newest - whole + frames * 2) % frames;

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!slot.owner) continue;
      const baseA = (a * KILLCAM.slots + i) * STRIDE;
      const baseB = (b * KILLCAM.slots + i) * STRIDE;
      // A slot that was not alive on both frames is left where it is rather
      // than snapped to a position it never held.
      if (buffer[baseA + 7] < 0.5 || buffer[baseB + 7] < 0.5) continue;

      scratchPos.set(buffer[baseA], buffer[baseA + 1], buffer[baseA + 2]);
      scratchPosB.set(buffer[baseB], buffer[baseB + 1], buffer[baseB + 2]);
      scratchPos.lerp(scratchPosB, blend);
      scratchQuat.set(buffer[baseA + 3], buffer[baseA + 4], buffer[baseA + 5], buffer[baseA + 6]);
      scratchQuatB.set(buffer[baseB + 3], buffer[baseB + 4], buffer[baseB + 5], buffer[baseB + 6]);
      scratchQuat.slerp(scratchQuatB, blend);

      if (slot.pooled) {
        slot.owner.position.copy(scratchPos);
        scratchEuler.setFromQuaternion(scratchQuat);
        slot.owner.rotation.x = scratchEuler.x;
        slot.owner.rotation.y = scratchEuler.y;
        slot.owner.rotation.z = scratchEuler.z;
      } else {
        slot.owner.position.copy(scratchPos);
        slot.owner.quaternion.copy(scratchQuat);
      }
    }

    // The debris is drawn from an instanced mesh that is normally refreshed
    // inside integratePhysics, which is not running while the replay is.
    ctx.systems.debris.syncDebrisInstances();
  }

  /**
   * @param {number} rawDt real seconds, not simulation seconds: a replay runs
   *   at its own rate and the simulation's clock is stopped
   * @returns {void}
   */
  function updateKillcam(rawDt) {
    if (!buffer) return;
    if (state.cooldown > 0) state.cooldown -= rawDt;

    if (state.phase === 'replaying') {
      state.elapsed += rawDt;
      const span = KILLCAM.window / KILLCAM.rate_;      // replay length, in real seconds
      const t = state.elapsed / span;
      if (t >= 1) {
        end();
        return;
      }

      applyFrame(KILLCAM.window * (1 - t));

      // The camera sweeps round the event while the replay runs, easing in
      // and out so the move settles rather than stopping dead.
      const eased = THREE.MathUtils.smoothstep(t, 0, 1);
      const bearing = state.bearing + eased * KILLCAM.sweep;
      const camera = Sim.three.camera;
      camera.position.set(
        state.at.x + Math.sin(bearing) * state.radius,
        state.at.y + state.radius * KILLCAM.height,
        state.at.z + Math.cos(bearing) * state.radius
      );
      lookAt.set(state.at.x, state.at.y + KILLCAM.lookHeight, state.at.z);
      camera.lookAt(lookAt);

      // Black at both ends of the cut.
      const fade = Math.max(
        1 - t * (span / KILLCAM.fade),
        (t - 1) * (span / KILLCAM.fade) + 1
      );
      if (fader) fader.style.opacity = String(THREE.MathUtils.clamp(fade, 0, 1));
      return;
    }

    if (state.phase === 'armed') {
      state.timer -= rawDt;
      // Keep recording through the lead-in: the aftermath is half the shot.
      recordTick(rawDt);
      if (state.timer <= 0) begin();
      return;
    }

    if (Sim.state.running && !Sim.state.paused) recordTick(rawDt);
  }

  /**
   * @param {number} rawDt
   * @returns {void}
   */
  function recordTick(rawDt) {
    sinceRecord += rawDt;
    const interval = 1 / KILLCAM.rate;
    // At most one catch-up frame: after a long stall the buffer should hold
    // the recent past, not spend the frame replaying a backlog into itself.
    if (sinceRecord < interval) return;
    sinceRecord = Math.min(sinceRecord - interval, interval);
    record();
  }

  /** @returns {boolean} */
  function isReplaying() {
    return state.phase === 'replaying';
  }

  /** @returns {void} */
  function resetKillcam() {
    if (state.phase === 'replaying') end();
    state.phase = 'idle';
    state.cooldown = 0;
    state.timer = 0;
    written = 0;
    writeFrame = 0;
    sinceRecord = 0;
    tick = 0;
    free.length = 0;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].owner && slots[i].owner.killcamSlot === i) slots[i].owner.killcamSlot = -1;
      slots[i].owner = null;
      slots[i].seen = -1;
      free.push(i);
    }
    if (buffer) buffer.fill(0);
  }

  /** @returns {void} */
  function disposeKillcam() {
    if (state.phase === 'replaying') end();
    if (chrome && chrome.parentNode) chrome.parentNode.removeChild(chrome);
    if (fader && fader.parentNode) fader.parentNode.removeChild(fader);
    chrome = null;
    fader = null;
    buffer = null;
    slots.length = 0;
    free.length = 0;
  }

  return { initKillcam, updateKillcam, notable, isReplaying, resetKillcam, disposeKillcam };
}

/** What the caption calls each kind of event. */
const LABELS = {
  collapse: 'Structural collapse',
  chain: 'Chain collapse',
  burnDown: 'Burned out',
  deck: 'Deck failure',
  pillar: 'Pillar down',
  derail: 'Derailment',
  train: 'Train wreck',
  merge: 'Fujiwhara merge',
  tanker: 'Tanker detonation',
  meteor: 'Meteor impact',
  flood: 'Dam breach',
  factory: 'Chemical works',
  emp: 'EMP discharge',
  steam: 'Steam explosion'
};
