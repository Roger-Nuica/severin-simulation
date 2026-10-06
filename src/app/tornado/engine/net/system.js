// @ts-check
import * as THREE from 'three';
import { createRelayClient } from './client.js';
import { createInputGate } from './inputGate.js';
import { createSnapshotBuffer } from './interp.js';
import { createEventEmitter, createEventDeduper } from './events.js';
import { createPlayerRegistry, REVIVE, FRIENDLY_FIRE } from './players.js';
import { PROTOCOL_VERSION, LIMITS, WEAPONS } from './protocol.js';
import { GUEST_WEAPONS, KATANA_HALF_ANGLE, pickTrigger, notePending, resolveTrigger, coolDown, weaponAt } from './guestWeapons.js';
import { createBullets } from '../hero/bullets.js';
import { HERO } from '../hero/config.js';
import { JETPACK } from '../hero/jetpack.js';
import { stepAir } from './flight.js';
import { TELEPORT } from '../player/teleport.js';
import { newPrediction, viewPoint, predictFrame, recordSent, reconcile } from './prediction.js';
import { stepRun, aimDirection } from '../hero/walk.js';
import { HOLE } from '../player/blackHole.js';
import { ENERGY } from '../player/energy.js';
import { IMPACT_SCORE } from '../damage/config.js';
import { HEALTH } from '../health/config.js';
import { glowLevel } from '../health/state.js';
import { mayHurtPlayer, splashAmount, rayBodyDistance, inSector } from '../health/friendlyFire.js';
import { dressAsRoger, rogerLimbs, newOwned, disposeRoger } from '../hero/rogerLook.js';
import { rogerStyle, newRunCycle, stepRunCycle, swingLimbs, newCameraPose, followCamera, wheelHtml, wrapAngle, newFireLatch, fireLatchPress, fireLatchRelease, fireLatchSample } from './rogerView.js';
import { createNetMetrics, isNetDebug } from './metrics.js';
import { createWeaponModels } from '../hero/weaponModels.js';
import { attachHeld } from '../hero/heldWeapons.js';
import { heldKey } from './heldWeapon.js';
import { fillKatana, buildKatanaView, placeKatanaViewIdle } from '../hero/katana/model.js';
import { shownKey, swayOf, viewOffset } from './viewModel.js';
import { newFeedback, stepFeedback, flashOpacity, SHOT_LOOK, SWING, swingAmount } from './shotFeedback.js';
import { createTrexFlames } from '../trex/flames.js';
import { FIRE_GUN } from '../hero/fireGun.js';
import { createHeroRequests, heroRequestOutcome, mayRequestLock, HERO_FLAG_SECONDS } from './heroRequest.js';

/**
 * ===========================================================================
 * SECTION NS — Co-op session (host and peer)
 * ===========================================================================
 * One host browser runs the authoritative simulation; one peer browser sends
 * inputs and renders the host's snapshots. This system owns the relay
 * connection, the room UI, the guest avatar on the host, and the proxy
 * rendering on the peer. All of its state is per instance (on `S`), its
 * listeners are bound to ctx.signal, and dispose/reset release every socket,
 * timer, mesh and DOM node it made.
 *
 * Host: guest avatar on foot (movement validated by the input gate, walls by
 * heroMode.standable), guest fire through the shared enemy registry
 * (`accepts` rules intact) and damage.addDamageScore, revive/down rules from
 * players.js, Terminators and Roger's pursuers hunt the nearest player who is
 * up (see pickTarget, used by terminator/movement.js and hero/pursuers.js).
 *
 * Peer: the local simulation stays idle (so its own storm/enemies never
 * diverge from the host's); the host's tornadoes, players, Terminators,
 * aliens, ships and moving vehicles are drawn as proxies, interpolated.
 *
 * The guest carries the whole wheel (rifle, minigun, railgun, Fire Gun, Black
 * Hole Gun, Katana), each through the systems Roger's use. Not implemented
 * for the guest: EMP and Time Slow (time is host-authoritative).
 *
 * Both Rogers: every player is drawn as Roger (hero/rogerLook.js, the same
 * costume as the host's own), the host in the original look with a gold tag,
 * a guest with a teal tee and tag. The peer follows its own Roger with a
 * per-client camera (rogerView.js `followCamera`; first person while aiming)
 * and has the Roger HUD: own health large, partner small, energy, weapon wheel
 * and a crosshair on aim. Roger versus Roger goes through `health.damagePlayer`
 * only: `hurtRay`, `hurtSector`, `hurtArea` (weapons of both players),
 * `splashGuests` and `hitGuestsArea` (R-053), each honouring `mayHurt`.
 *
 * Hero Mode in a room: the host presses Hero as usual; the guest's Hero button
 * becomes a request (`hero` flag on its input, acted on once by the host). A
 * room survives Hero ending and a Restart. On a peer, the world-affecting
 * controls of the panel are disabled and blocked (the local sim is idle), and
 * the OrbitControls camera is switched off in favour of the follow camera.
 */

/** Panel controls a peer may still use: the panel fold, local audio and the Hero request. */
const PEER_UI_ALLOWED = (/** @type {Element} */ el) => el.id === 'btn-panel-toggle' || el.id === 'btn-mute' || el.id === 'p-volume' || el.id === 'btn-hero' || el.id.startsWith('set-');
const VERSION_TEXT = 'Version mismatch: refresh the page (Ctrl+Shift+R) so host and guest run the same build.';

const SNAP_INTERVAL = 1 / LIMITS.snapshotHz;
const INPUT_INTERVAL = 1 / 30;
/** The Katana's arc: reach and cooldown come from the guest weapon table. */
const KATANA = { cooldown: GUEST_WEAPONS.katana.cooldown, reach: GUEST_WEAPONS.katana.range, halfAngle: KATANA_HALF_ANGLE };
const HOLE_COOLDOWN = GUEST_WEAPONS.blackhole.cooldown;
const HOLE_MIN_RANGE = 12;
const EYE = 1.4;
/** The hero's own walking speeds, read from the protected values, for the shared movement step. @type {import('./movement.js').MoveSpeeds} */
const GUEST_SPEEDS = { run: HERO.runSpeed, aim: HERO.aimWalkSpeed, back: HERO.backSpeed };
const KILL_SCORE = 20;
/** The car Roger drives is the one co-op vehicle (Hero Mode car flow). */
const CAR_ID = 9000;
const SEAT_REACH = 6;
/** A guest flies as the host's Roger does (hero/jetpack.js): the same speeds, no fuel, no energy. */
const FLY_SPEEDS = { run: JETPACK.flySpeed, aim: JETPACK.flySpeed, back: JETPACK.flySpeed };
/** Input `abil` bit 16: Space held (the jetpack's climb); a level, not an edge. */
const JET_BIT = 16;
const RELAY_URL = (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_RELAY_URL) || 'ws://localhost:8787';

/**
 * @param {Object} ctx
 */
export function createNetSystem(ctx) {
  const { Sim, container } = ctx;
  const players = createPlayerRegistry();
  const gate = createInputGate();
  const emitter = createEventEmitter();
  const deduper = createEventDeduper();
  const buffer = createSnapshotBuffer();
  const heroRequests = createHeroRequests();
  /** Dev-only diagnostics: null (and every hook below skipped) unless the page has `?netdebug`. */
  const dbg = typeof location !== 'undefined' && isNetDebug(location.search) ? createNetMetrics({ weapons: WEAPONS.length }) : null;

  const S = {
    /** @type {ReturnType<typeof createRelayClient>|null} */
    client: null,
    /** @type {AbortController|null} */
    sessionAbort: null,
    /** @type {'host'|'peer'|null} */
    role: null,
    code: '',
    myId: '',
    seed: 0,
    t0: performance.now() / 1000,
    tick: 0,
    snapAcc: 0,
    inputAcc: 0,
    seq: 0,
    bypass: false,
    holdRevive: false,
    pendingWelcome: false,
    /** @type {Map<string, {obj: any, cd: number, pending: import('./guestWeapons.js').Trigger|null, tpCd: number, alt: number, vy: number, air: boolean, speed: number, lastUse: boolean, flame: {tick: number, shooter: string}, run: import('./rogerView.js').RunCycle, owned: import('../hero/rogerLook.js').Owned, limbs: any, held: import('../hero/heldWeapons.js').Held}>} */
    avatars: new Map(),
    /** @type {WeakMap<object, number>} */
    ids: new WeakMap(),
    nextId: 1,
    lastMission: '',
    peerScore: 0,
    /** Seconds the peer keeps sending `hero: true` after a Hero press. */
    heroFlag: 0,
    /** Last Hero run seen by the host (spots a Restart, which starts a new run). */
    lastRun: 0,
    /** When a pointer lock last ended or failed (performance.now() ms; 0 = never). */
    lockExitAt: 0,
    wasLocked: false,
    versionWarned: false,
    /** @type {HTMLPreElement|null} the `?netdebug` overlay */
    dbgEl: null,
    dbgAcc: 0,
    dbgPingAcc: 0,
    peerReadyShown: false,
    resetting: false,
    /** @type {{pos: THREE.Vector3, target: THREE.Vector3}|null} */
    savedCam: null,
    /** Panel controls disabled for the peer, with what to put back. */
    lockedUi: /** @type {Map<HTMLElement, {disabled: boolean, title: string}>} */ (new Map()),
    /** Panel parts hidden from the peer, with their own `hidden` to put back. */
    hiddenUi: /** @type {Map<HTMLElement, boolean>} */ (new Map()),
    peerRow: /** @type {number[]|null} */ (null),
    /** Client-side prediction of the guest's own avatar (prediction.js); immutable, replaced each step. */
    pred: newPrediction(),
    /** `?netdebug` only: reconciliation counts and the last / worst error (m). */
    predStats: { snaps: 0, blends: 0, last: 0, worst: 0 },
    /** Latest synced health per player id: value, seconds since last damage, receipt time (ms). */
    peerHp: /** @type {Map<number, {v: number, since: number, at: number}>} */ (new Map()),
    hudHtml: '',
    hurtFlip: false,
    peerMission: /** @type {{id: string, value: number, goal: number, left: number}|null} */ (null),
    /** @type {THREE.Group|null} */
    proxyRoot: null,
    /** @type {Map<string, Map<number, THREE.Object3D>>} */
    proxies: new Map(),
    /** @type {THREE.BufferGeometry[]} */
    geos: [],
    /** @type {THREE.Material[]} */
    mats: [],
    // Peer input state.
    keys: { up: false, down: false, left: false, right: false },
    look: { yaw: 0, pitch: 0 },
    buttons: { fire: false, aim: false, use: false },
    // Fire is latched so a click shorter than one input interval still reaches the host.
    fireLatch: newFireLatch(),
    weapon: 0,
    abil: 0,
    /** Heights of the players' feet (metres), newest snapshot and the eased value drawn, by player id (the jetpack). */
    altTarget: new Map(),
    altNow: new Map(),
    /** The own authoritative position in the last snapshot, and when E was last pressed (to show the warp). */
    lastAuth: null,
    tpAt: 0,
    /** The pointer lock was taken for the guest's first person (losing it lowers the weapon, as Roger's). */
    aimLocked: false,
    /** Ability bits pressed since the last input was sent: a tap shorter than the send interval still reaches the host. */
    abilLatch: 0,
    /** Each player's Invincible as last announced by the host (guest HUD). */
    peerInv: /** @type {Map<number, boolean>} */ (new Map()),
    savedControls: true,
    /** @type {HTMLDivElement|null} */
    panel: null,
    /** @type {HTMLDivElement|null} */
    status: null,
    /** @type {HTMLDivElement|null} */
    hud: null,
    /** @type {HTMLDivElement|null} */
    toast: null,
    /** @type {HTMLDivElement|null} */
    cross: null,
    toastTimer: 0
  };
  /** @type {Record<string, HTMLElement|null>} */
  const ui = {};
  const hero = () => ctx.systems.heroMode;
  // Scratch for the guest's flame (per instance, never module state).
  const aimVec = new THREE.Vector3();
  const muzzleVec = new THREE.Vector3();
  const tracerEnd = new THREE.Vector3();
  // Scratch for the guests' walk (host) and the revive countdown.
  const guestKeys = { up: false, down: false, left: false, right: false };
  const walkDir = { x: 0, z: 0 };
  const runState = { heading: 0, speed: 0 };
  /** @type {Map<string, number>} Seconds of revive last shown, per downed player. */
  const reviveShown = new Map();
  /** @type {Map<number, number[]>} The partners' latest snapshot rows (guest HUD). */
  const partnerRows = new Map();
  /** @type {Map<string, number>} Per guest: ability bits pressed since the host last acted on them, and the bits of the last message. */
  const abilEdges = new Map();
  const abilSeen = new Map();
  // Scratch for the peer camera.
  const camPose = newCameraPose();
  const camGoal = new THREE.Vector3();
  const FOLLOW = { back: HERO.followBack, height: HERO.followHeight, lookAhead: HERO.lookAhead, lookHeight: HERO.lookHeight, eye: EYE };

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------

  /** @param {object} o @returns {number} a stable small id for a game object */
  function idOf(o) {
    let id = S.ids.get(o);
    if (id === undefined) { id = S.nextId++; S.ids.set(o, id); }
    return id;
  }

  /** @param {string} text */
  function say(text) {
    if (!S.toast) return;
    S.toast.textContent = text;
    S.toast.classList.add('visible');
    S.toastTimer = 4;
  }

  function setStatus() {
    if (!S.status) return;
    const st = S.client ? S.client.state() : { status: 'idle', error: null };
    let text = 'Not connected';
    if (st.status === 'connecting') text = 'Connecting…';
    else if (st.status === 'reconnecting') text = 'Connection lost — reconnecting…';
    else if (st.status === 'in-room') {
      text = S.role === 'host'
        ? `Hosting · invite code ${S.code} · ${players.list().length > 1 ? 'guest connected' : 'waiting for a guest'}`
        : (S.pendingWelcome ? `Joined ${S.code} · waiting for the host…` : `Joined ${S.code} · you are ${rogerStyle(S.myId).label}`);
    } else if (st.status === 'closed') text = st.error ? `Disconnected (${st.error})` : 'Disconnected';
    S.status.textContent = text;
    const idle = !S.client || st.status === 'idle' || st.status === 'closed';
    if (ui.host) /** @type {HTMLButtonElement} */ (ui.host).disabled = !idle;
    if (ui.join) /** @type {HTMLButtonElement} */ (ui.join).disabled = !idle;
    if (ui.code) /** @type {HTMLInputElement} */ (ui.code).disabled = !idle;
    if (ui.leave) /** @type {HTMLButtonElement} */ (ui.leave).disabled = idle;
  }

  /** @param {string} kind @param {Object} data @param {string} [to] */
  function sendEvent(kind, data, to) {
    if (S.role !== 'host' || !S.client) return;
    const ev = emitter.make(kind, data);
    if (!ev) return;
    S.client.send(to === undefined ? ev : { ...ev, to });
  }

  // ---------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------

  /** Everything a session made, released; safe to call twice. */
  function endSession() {
    if (S.sessionAbort) S.sessionAbort.abort();
    S.sessionAbort = null;
    if (S.client) S.client.dispose();
    S.client = null;
    const wasPeer = S.role === 'peer';
    S.role = null;
    S.code = '';
    S.myId = '';
    S.pendingWelcome = false;
    S.peerReadyShown = false;
    S.versionWarned = false;
    S.heroFlag = 0;
    S.lastRun = 0;
    for (const id of [...S.avatars.keys()]) removeAvatar(id);
    players.clear();
    gate.clear();
    heroRequests.clear();
    deduper.reset();
    emitter.reset();
    buffer.clear();
    if (dbg) { dbg.reset(); S.dbgAcc = S.dbgPingAcc = 0; }
    S.tick = 0;
    S.peerScore = 0;
    S.peerRow = null;
    S.pred = newPrediction();
    S.altTarget.clear();
    S.altNow.clear();
    S.lastAuth = null;
    S.predStats = { snaps: 0, blends: 0, last: 0, worst: 0 };
    S.peerHp.clear();
    S.peerInv.clear();
    reviveShown.clear();
    partnerRows.clear();
    abilEdges.clear();
    abilSeen.clear();
    S.hudHtml = '';
    S.peerMission = null;
    clearProxies();
    if (wasPeer) restorePeerView();
    if (S.hud) S.hud.classList.remove('visible');
    if (S.cross) S.cross.classList.remove('visible');
    setStatus();
  }

  /** @param {'host'|'peer'} role @param {string} [code] */
  function startSession(role, code) {
    if (S.client && S.client.state().status !== 'idle' && S.client.state().status !== 'closed') return;
    if (S.client) endSession();
    // Hero Mode no longer blocks a room. Hosting rebuilds the town from a shared
    // seed (a reset), which ends a run in progress; joining ends the guest's own
    // local run first so its Hero keys, HUD and camera do not linger.
    if (role === 'host' && hero() && ctx.Hero && ctx.Hero.active) say('Hosting rebuilds the town: your Hero run ends.');
    if (role === 'peer' && hero() && ctx.Hero && ctx.Hero.active) hero().resetHero();
    S.sessionAbort = new AbortController();
    const signal = anySignal([ctx.signal, S.sessionAbort.signal]);
    S.role = role;
    S.client = createRelayClient({
      url: RELAY_URL,
      signal,
      onState: (st) => onClientState(st),
      onMessage: (msg) => onRelayMessage(msg)
    });
    if (role === 'host') S.client.host();
    else S.client.join(code || '');
    setStatus();
  }

  /** @param {AbortSignal[]} signals @returns {AbortSignal} */
  function anySignal(signals) {
    const ac = new AbortController();
    for (const s of signals) {
      if (s.aborted) { ac.abort(); break; }
      s.addEventListener('abort', () => ac.abort(), { once: true });
    }
    return ac.signal;
  }

  /** @param {string} code A relay or client error code. @returns {string} Text for the toast. */
  function errorText(code) {
    if (code === 'version' || code.startsWith('field:')) return VERSION_TEXT;
    return `Co-op: ${code}`;
  }

  /** @param {{status: string, role: string|null, code: string|null, id: string|null, error: string|null}} st */
  function onClientState(st) {
    if (st.code) S.code = st.code;
    if (st.id !== null) S.myId = st.id;
    if (st.status === 'in-room' && S.role === 'host' && !S.seed) {
      // A fresh town from a seed the guest will share.
      S.seed = (Math.random() * 0xffffffff) >>> 0;
      players.add('0');
      applySeed(S.seed);
    }
    if (st.status === 'in-room' && S.role === 'peer' && !S.peerReadyShown) {
      S.pendingWelcome = true;
    }
    if (st.status === 'closed') {
      if (st.error === 'host-left') say('The host closed the room.');
      else if (st.error === 'full') say('That room is full.');
      else if (st.error === 'no-room') say('No room with that code.');
      else if (st.error) say(errorText(st.error));
      endSession();
      return;
    }
    if (st.status === 'in-room' && st.error) say(errorText(st.error));
    setStatus();
  }

  /** @param {number} seed rebuilds the town from it (same seed, same town) */
  function applySeed(seed) {
    ctx.townSeed = seed;
    // The reset this triggers must not end the session that asked for it.
    S.resetting = true;
    try {
      if (typeof ctx.resetSim === 'function') ctx.resetSim();
    } finally {
      S.resetting = false;
    }
  }

  /** @param {any} msg */
  function onRelayMessage(msg) {
    if (!msg || typeof msg.type !== 'string') return;
    if (dbg && msg.type === 'pong') { dbg.pong(Number(msg.id), performance.now()); return; }
    if (S.role === 'host') hostMessage(msg);
    else peerMessage(msg);
  }

  // ---------------------------------------------------------------------
  // Host
  // ---------------------------------------------------------------------

  /** @param {any} msg */
  function hostMessage(msg) {
    switch (msg.type) {
      case 'peerJoined': {
        const id = String(msg.id);
        if (!players.get(id)) players.add(id);
        sendEvent('welcome', { seed: S.seed, id: Number(id) }, id);
        say(msg.rejoined ? 'Player rejoined.' : 'A player joined.');
        setStatus();
        return;
      }
      case 'peerLeft': {
        const id = String(msg.id);
        removeAvatar(id);
        players.remove(id);
        gate.forget(id);
        heroRequests.forget(id);
        abilEdges.delete(id);
        abilSeen.delete(id);
        say(msg.reason === 'dropped' ? 'A player lost connection.' : 'A player left.');
        setStatus();
        return;
      }
      case 'input': {
        const r = gate.accept(msg, (id) => id !== '0' && !!players.get(id));
        if (!r.ok) { if (dbg) dbg.reject('error' in r ? r.error : ''); return; }
        if (dbg) dbg.inputAccepted(performance.now());
        const p = players.get(r.id);
        if (p) {
          // Ability presses are found per message, not per frame: two inputs
          // arriving between two host frames must not swallow a tap.
          const last = abilSeen.get(r.id) || 0;
          abilEdges.set(r.id, (abilEdges.get(r.id) || 0) | (r.input.abil & ~last));
          abilSeen.set(r.id, r.input.abil);
          p.input = r.input;
          // A fire seen in this message survives a newer message in the same host frame.
          const av = S.avatars.get(r.id);
          if (av) av.pending = notePending(av.pending, r.input);
          p.wantsRevive = r.input.use;
          if (heroRequests.edge(r.id, r.input.hero)) onGuestHeroRequest(r.id);
        }
        return;
      }
      default:
    }
  }

  /**
   * A guest pressed Hero. In a run the guest's avatar is already (or is about
   * to be) on foot beside Roger; otherwise it waits and the host is told.
   * @param {string} id Guest player id.
   * @returns {void}
   */
  function onGuestHeroRequest(id) {
    const outcome = heroRequestOutcome(!!hero().rogerPose());
    sendEvent('notice', { text: outcome.text }, id);
    if (outcome.action === 'wait') say(`Player ${id} wants to play Hero Mode: press Hero.`);
  }

  /**
   * A guest's figure on the host: Roger's costume in the guest's colours
   * (hero/rogerLook.js), standing at (x, z). Not a town person: it is
   * not in the environment's lists, only in the scene.
   * @param {string} id Guest id.
   * @param {number} x
   * @param {number} z
   * @returns {void}
   */
  function spawnAvatar(id, x, z) {
    const obj = ctx.systems.people.createPerson(x, z, 95000 + Number(id));
    obj.mesh.name = `coop_player_${id}`;
    const owned = newOwned();
    const style = rogerStyle(id);
    dressAsRoger(obj.mesh, owned.keep, { tee: style.tee });
    Sim.three.scene.add(obj.mesh);
    const limbs = rogerLimbs(obj.mesh);
    S.avatars.set(id, { obj, cd: 0, pending: null, tpCd: 0, alt: 0, vy: 0, air: false, speed: 0, lastUse: false, flame: { tick: 0, shooter: id }, run: newRunCycle(), owned, limbs, held: attachHeld(limbs.armR, owned.keep) });
  }

  /** @param {string} id */
  function removeAvatar(id) {
    const a = S.avatars.get(id);
    if (!a) return;
    Sim.three.scene.remove(a.obj.mesh);
    disposeRoger(a.obj.mesh, a.owned);
    S.avatars.delete(id);
  }

  /** @returns {boolean} a guest is in the room */
  function coopActive() {
    return S.role === 'host' && players.list().length > 1;
  }

  /**
   * The player a hunter should go for: the nearest who is up, Roger
   * included. Null outside co-op, so single-player code is untouched.
   * @param {number} x @param {number} z
   * @returns {{x: number, z: number, onFoot: boolean, id: string}|null}
   */
  function pickTarget(x, z) {
    if (!coopActive()) return null;
    const p = players.nearestEligible(x, z);
    return p ? { x: p.x, z: p.z, onFoot: !p.seat, id: p.id } : null;
  }

  /**
   * A hunter reached a player. Roger goes through heroMode.killRoger (which
   * brings us back to interceptRogerDeath); a guest simply goes down.
   * @param {string} id @param {string} title @param {string} sub
   */
  function catchPlayer(id, title, sub) {
    if (id === '0') { hero().killRoger(title, sub); return; }
    if (players.down(id)) {
      removeSeatEffects(id);
      sendEvent('playerDown', { id: Number(id) });
      say(`Player ${id} is down — hold F next to them for ${REVIVE.hold} s to revive.`);
    }
  }

  /** @param {string} _id */
  function removeSeatEffects(_id) { void _id; }

  /**
   * Tells a guest it was hurt (host only): the discrete `playerDamage` event
   * the guest turns into its hit flash, arrow and sound through the same
   * `playerHurt` path Roger uses. Roger himself needs no event.
   * @param {string} id Guest id.
   * @param {string} source Key into `HEALTH.damage`.
   * @param {number} amount Points lost (a kill reports the full bar).
   * @param {{x: number, z: number}|null} [position] Where the hit came from.
   * @returns {void}
   */
  function notifyDamage(id, source, amount, position) {
    if (id === '0' || !coopActive()) return;
    /** @type {{id: number, source: string, amount: number, x?: number, z?: number}} */
    const data = { id: Number(id), source: String(source).slice(0, 24), amount: Math.round(amount) };
    if (position && Number.isFinite(position.x) && Number.isFinite(position.z)) {
      data.x = Math.round(position.x);
      data.z = Math.round(position.z);
    }
    sendEvent('playerDamage', data, id);
  }

  /**
   * Whether one player's weapon may hurt another in this run (D4).
   * @param {string} shooterId @param {string} targetId
   * @returns {boolean}
   */
  const mayHurt = (shooterId, targetId) => mayHurtPlayer(shooterId, targetId, { coop: coopActive(), friendlyFire: FRIENDLY_FIRE });

  /**
   * An area event (explosion, ship crash, black hole zone) reaching the
   * guests: every guest inside the radius takes the same request Roger would,
   * through the one health API (host only; the API ignores a downed guest).
   * @param {number} x @param {number} z @param {number} radius
   * @param {import('../health/system.js').DamageRequest} request
   * @returns {void}
   */
  function hitGuestsArea(x, z, radius, request) {
    if (!coopActive() || !ctx.systems.health) return;
    for (const p of players.list()) {
      if (p.id === '0' || Math.hypot(p.x - x, p.z - z) >= radius) continue;
      ctx.systems.health.damagePlayer({ ...request, targetId: p.id });
    }
  }

  /**
   * Roger's blast (plasma, mega) reaching a guest: falling away with
   * distance like his own self-hit, only when friendly fire allows it.
   * @param {{x: number, y: number, z: number}} at
   * @param {number} radius
   * @param {string} weapon A `HEALTH.damageToPlayer` key.
   * @returns {void}
   */
  function splashGuests(at, radius, weapon) {
    if (!coopActive() || !ctx.systems.health) return;
    for (const p of players.list()) {
      if (p.id === '0' || !mayHurt('0', p.id)) continue;
      const amount = splashAmount(weapon, Math.hypot(p.x - at.x, p.z - at.z), radius);
      if (amount <= 0) continue;
      ctx.systems.health.damagePlayer({ source: 'friendlyFire', amount, type: 'blast', position: at, targetId: p.id, title: 'FRIENDLY FIRE', sub: "Caught in Roger's blast" });
    }
  }

  /**
   * Who is attacking, for the victim's card.
   * @param {string} shooterId
   * @returns {string}
   */
  const attacker = (shooterId) => (shooterId === '0' ? 'Roger' : `Player ${shooterId}`);

  /**
   * One shot of a hitscan weapon (either player's) against the other players:
   * each one whose body the ray crosses past the muzzle guard and within
   * `maxT` (the enemy it struck, if nearer) takes the weapon's
   * `damageToPlayer` value once, through the one health API.
   * @param {string} shooterId `'0'` is Roger.
   * @param {number} ox Ray origin x.
   * @param {number} oy Ray origin height.
   * @param {number} oz Ray origin z.
   * @param {number} dx Unit direction.
   * @param {number} dy
   * @param {number} dz
   * @param {number} maxT Furthest distance that counts.
   * @param {string} weapon A `HEALTH.damageToPlayer` key.
   * @returns {void}
   */
  function hurtRay(shooterId, ox, oy, oz, dx, dy, dz, maxT, weapon) {
    if (!coopActive() || !ctx.systems.health) return;
    const amount = /** @type {Record<string, number>} */ (HEALTH.damageToPlayer)[weapon];
    if (!(amount > 0)) return;
    for (const p of players.list()) {
      if (p.id === shooterId || !mayHurt(shooterId, p.id)) continue;
      if (rayBodyDistance(ox, oy, oz, dx, dy, dz, maxT, p.x, p.z) < 0) continue;
      ctx.systems.health.damagePlayer({
        source: 'friendlyFire', amount, type: 'ray',
        position: { x: ox, y: 0, z: oz }, targetId: p.id, title: 'FRIENDLY FIRE', sub: `Shot by ${attacker(shooterId)}`
      });
    }
  }

  /**
   * A melee arc or the Fire Gun's cone (either player's): every other player
   * inside the sector takes the weapon's `damageToPlayer` value once.
   * @param {string} shooterId `'0'` is Roger.
   * @param {number} ox Attacker x.
   * @param {number} oz Attacker z.
   * @param {number} fx Facing (need not be unit).
   * @param {number} fz
   * @param {number} reach Metres.
   * @param {number} cosArc Cosine of the half-angle.
   * @param {number} near Distance inside which the angle is ignored.
   * @param {string} weapon A `HEALTH.damageToPlayer` key.
   * @param {string} type Damage kind (`melee`, `fire`).
   * @param {string} verb Card text before the attacker (`Cut down by`).
   * @returns {void}
   */
  function hurtSector(shooterId, ox, oz, fx, fz, reach, cosArc, near, weapon, type, verb) {
    if (!coopActive() || !ctx.systems.health) return;
    const amount = /** @type {Record<string, number>} */ (HEALTH.damageToPlayer)[weapon];
    if (!(amount > 0)) return;
    const len = Math.hypot(fx, fz) || 1;
    for (const p of players.list()) {
      if (p.id === shooterId || !mayHurt(shooterId, p.id)) continue;
      if (!inSector(ox, oz, fx / len, fz / len, p.x, p.z, reach, cosArc, near)) continue;
      ctx.systems.health.damagePlayer({
        source: 'friendlyFire', amount, type, position: { x: ox, y: 0, z: oz },
        targetId: p.id, title: 'FRIENDLY FIRE', sub: `${verb} ${attacker(shooterId)}`
      });
    }
  }

  /**
   * A flat-damage area (the railgun's bolt): every other player inside the
   * radius takes the weapon's `damageToPlayer` value once.
   * @param {string} shooterId `'0'` is Roger.
   * @param {number} x Centre x.
   * @param {number} z Centre z.
   * @param {number} radius Metres.
   * @param {string} weapon A `HEALTH.damageToPlayer` key.
   * @param {string} verb Card text before the attacker.
   * @returns {void}
   */
  function hurtArea(shooterId, x, z, radius, weapon, verb) {
    if (!coopActive() || !ctx.systems.health) return;
    const amount = /** @type {Record<string, number>} */ (HEALTH.damageToPlayer)[weapon];
    if (!(amount > 0)) return;
    for (const p of players.list()) {
      if (p.id === shooterId || !mayHurt(shooterId, p.id) || Math.hypot(p.x - x, p.z - z) >= radius) continue;
      ctx.systems.health.damagePlayer({
        source: 'friendlyFire', amount, type: 'ray', position: { x, y: 0, z },
        targetId: p.id, title: 'FRIENDLY FIRE', sub: `${verb} ${attacker(shooterId)}`
      });
    }
  }

  /**
   * heroMode.killRoger asks first. In co-op, while a teammate is still up,
   * Roger goes down instead of dying.
   * @param {string} [kind]
   * @returns {boolean} true: handled (do not die)
   */
  function interceptRogerDeath(kind = '') {
    if (S.bypass || !coopActive()) return false;
    const roger = players.get('0');
    if (!roger) return false;
    if (roger.state !== 'up') return true;
    const others = players.up().filter((p) => p.id !== '0');
    if (!others.length) return false;
    if (!players.down('0')) return false;
    hero().setCoopDown(true);
    sendEvent('playerDown', { id: 0 });
    say(`Roger is down — hold F next to him for ${REVIVE.hold} s to revive.`);
    return true;
  }

  /** Both down: the existing GAME OVER, once. */
  function gameOverNow() {
    if (S.bypass) return;
    S.bypass = true;
    try {
      hero().setCoopDown(false);
      hero().killRoger('GAME OVER', 'Everyone is down');
    } finally {
      S.bypass = false;
    }
    sendEvent('gameOver', {});
  }

  /** @param {number} dt */
  function updateGuests(dt) {
    const h = hero();
    const pose = h.rogerPose();
    const roger = players.get('0');
    if (roger && pose) {
      roger.x = pose.x; roger.z = pose.z; roger.heading = pose.heading;
      roger.weapon = Math.max(0, WEAPONS.indexOf(pose.weapon));
      roger.wantsRevive = S.holdRevive;
      // Roger at the wheel holds the driver seat of the one car in play.
      if (pose.driving && !roger.seat) players.enterSeat('0', CAR_ID, 0);
      else if (!pose.driving && roger.seat) ejectPassengers(players.leaveSeat('0'), pose);
    }
    // The run is on while Roger is in play, and also while he lies down
    // waiting for a revive (rogerPose is null then): the guest must still be
    // able to walk over and revive him, and a guest going down too must still
    // end the run.
    const heroOn = !!pose || (!!roger && roger.state !== 'up' && !!ctx.Hero && ctx.Hero.active);
    // A new run (first start or a Restart, even within one frame): everyone up
    // again, guests dropped back beside the new spawn. The room stays.
    if (pose && pose.run !== S.lastRun) {
      S.lastRun = pose.run;
      players.resetRun(HERO.spawnShieldSeconds);
      for (const id of [...S.avatars.keys()]) removeAvatar(id);
    }

    for (const p of players.list()) {
      if (p.id === '0') continue;
      let a = S.avatars.get(p.id);
      if (!heroOn) { if (dbg && p.input && p.input.fire) dbg.unfired(0); if (a) removeAvatar(p.id); continue; }
      if (!a) {
        const bx = pose ? pose.x : roger ? roger.x : 0;
        const bz = pose ? pose.z : roger ? roger.z : 0;
        const nx = bx + (Number(p.id) % 2 ? 2 : -2);
        spawnAvatar(p.id, nx, bz + 2);
        p.x = nx; p.z = bz + 2;
        // A guest dropping into a run in progress is as safe as Roger was at his start (R-035).
        p.shield = Math.max(p.shield, HERO.spawnShieldSeconds);
        a = /** @type {NonNullable<typeof a>} */ (S.avatars.get(p.id));
      }
      const pos = a.obj.mesh.position;
      a.cd = coolDown(a.cd, dt);
      a.tpCd = Math.max(0, a.tpCd - dt);
      const input = p.input;
      const ctl = players.controls(p.id);
      const car = h.drivingCar();
      // Use (F) at the car's door sits the guest in the passenger seat; again, or
      // the driver stopping, gets them out. Revive takes priority (see below).
      if (input) {
        const useEdge = input.use && !a.lastUse;
        a.lastUse = input.use;
        if (useEdge && p.state === 'up' && !teammateNeedsRevive(p)) {
          if (p.seat) exitSeat(p, car);
          else if (car && Math.hypot(car.mesh.position.x - p.x, car.mesh.position.z - p.z) < SEAT_REACH) {
            const r = players.enterSeat(p.id, CAR_ID, 1);
            if (!r.ok) sendEvent('notice', { text: 'The passenger seat is taken' }, p.id);
          }
        }
      }
      if (p.seat && car) { p.x = car.mesh.position.x; p.z = car.mesh.position.z; }
      else if (p.seat && !car) players.leaveSeat(p.id);
      if (input) {
        const edge = abilEdges.get(p.id) || 0;
        abilEdges.set(p.id, 0);
        // Bit 8: V, the guest's own Invincible, whenever they are in the run
        // (down included, as Roger's V works while he is down).
        if (edge & 8) setGuestInvincible(p, !p.invincible);
        // Everything below drives the guest's body: only while that body is
        // up. A downed or dead guest's input moves, turns and fires nothing.
        if (p.state !== 'up') { a.speed = 0; a.pending = null; }
        else {
          p.weapon = input.weapon;
          // Aiming (first person) the body faces where the guest looks; on
          // foot it turns with A and D (moveGuest), never with the mouse.
          if (input.aim && ctl.aim) p.heading = wrapAngle(input.yaw);
          if (ctl.move && dt > 0) moveGuest(p, a, input, dt);
          const trigger = pickTrigger(input, a.pending);
          a.pending = null;
          if (trigger && ctl.aim) guestFire(p, a, input, dt, trigger);
          else if (dbg && trigger) dbg.unfired(1);
        }
        // Bit 2: Teleport, as Roger's (player/teleport.js): the first place to
        // stand along the way they face, from the full distance back; free.
        // Bits 1 and 4 (Time Slow, EMP) are host-only.
        if ((edge & 2) && a.tpCd <= 0 && ctl.move) {
          const to = guestLanding(p, h);
          if (!to) sendEvent('notice', { text: 'TELEPORT · no room to land that way' }, p.id);
          else {
            a.tpCd = TELEPORT.cooldown;
            const tele = ctx.systems.teleport;
            tele.warpAt(p.x, p.z, true);
            p.x = to.x; p.z = to.z;
            tele.warpAt(to.x, to.z, false);
            if (ctx.systems.powerArcSound) ctx.systems.powerArcSound.playZap(1);
          }
        }
      }
      // The jetpack: Space held climbs, let go it sinks gently; down or seated, it lets go.
      stepGuestAir(p, a, ctl.move && p.state === 'up' && (input.abil & JET_BIT) !== 0, ctl.move, dt, h);
      pos.set(p.x, a.alt, p.z);
      a.obj.mesh.rotation.y = p.heading;
      // Down: lying flat; revived: upright.
      a.obj.mesh.rotation.x = p.state === 'up' ? 0 : -Math.PI / 2 + 0.1;
      // Blinks while a shield (spawn or revive) lasts, like Roger's own.
      a.obj.mesh.visible = p.state !== 'dead' && !p.seat && (p.shield <= 0 || Math.floor(p.shield * 10) % 2 === 0);
      swingLimbs(a.limbs, a.run.phase, p.state === 'up' ? stepRunCycle(a.run, p.x, p.z, dt, HERO.stride, HERO.runSpeed) : 0);
      // The guest's weapon in its hand, as the host sees the guest's Roger.
      a.held.show(heldKey(p.weapon, p.state === 'up', !!p.seat));
      // Hunters now hurt a guest through the health API (melee touches, rays),
      // which calls catchPlayer at 0 health; there is no instant catch here.
    }

    const { revived, died } = players.update(dt);
    for (const id of revived) {
      if (id === '0') h.setCoopDown(false);
      // Back up with full health (the registry gave the REVIVE.shield).
      if (ctx.systems.health) ctx.systems.health.revivePlayer(id);
      sendEvent('playerRevived', { id: Number(id) });
      say(`Player ${id} revived.`);
    }
    for (const id of died) say(`Player ${id} bled out.`);
    showReviveProgress();
    if (heroOn && players.list().length > 0 && players.gameOver()) gameOverNow();
  }


  /** @param {import('./players.js').Player} p @returns {boolean} a downed teammate in revive range, so F means revive */
  function teammateNeedsRevive(p) {
    return players.list().some((q) => q !== p && q.state === 'down' && Math.hypot(q.x - p.x, q.z - p.z) <= REVIVE.range);
  }

  /** @param {import('./players.js').Player} p @param {{mesh: THREE.Object3D}|null} car */
  function exitSeat(p, car) {
    players.leaveSeat(p.id);
    if (!car) return;
    const h = hero();
    const side = car.mesh.rotation.y + Math.PI / 2;
    for (const k of [3.2, -3.2, 5]) {
      const x = car.mesh.position.x + Math.sin(side) * k, z = car.mesh.position.z + Math.cos(side) * k;
      if (h.standable(x, z)) { p.x = x; p.z = z; return; }
    }
  }

  /**
   * The driver got out: nobody else can drive in co-op, so the passenger
   * steps out beside the car (the registry would hand the wheel over; the
   * host's car code has only one driver input).
   * @param {{vehicle: number, handoff: string|null}|null} left
   * @param {{x: number, z: number}} pose
   */
  function ejectPassengers(left, pose) {
    if (!left || !left.handoff) return;
    const q = players.get(left.handoff);
    if (!q) return;
    players.leaveSeat(left.handoff);
    q.x = pose.x + 2.5; q.z = pose.z;
  }

  /**
   * One frame of a guest's walk, by the same rules as Roger's own
   * (hero/walk.js): on foot A and D turn and W and S run with his
   * acceleration; aiming, W and S walk along the look and A and D strafe.
   * Walls by heroMode.standable, each axis on its own so a wall slides.
   * @param {import('./players.js').Player} p
   * @param {{speed: number, air: boolean, alt: number}} a The guest's avatar (keeps the run speed and height).
   * @param {import('./protocol.js').PlayerInput} input
   * @param {number} dt
   * @returns {void}
   */
  function moveGuest(p, a, input, dt) {
    const h = hero();
    guestKeys.up = input.mz > 0; guestKeys.down = input.mz < 0;
    guestKeys.left = input.mx < 0; guestKeys.right = input.mx > 0;
    let dx = 0, dz = 0;
    if (input.aim) {
      a.speed = 0;
      const dir = aimDirection(p.heading, Math.sign(input.mz), -Math.sign(input.mx), walkDir);
      const len = Math.hypot(dir.x, dir.z);
      if (len < 1e-3) return;
      const speed = a.air ? JETPACK.flySpeed : HERO.aimWalkSpeed;
      dx = (dir.x / len) * speed * dt;
      dz = (dir.z / len) * speed * dt;
    } else {
      runState.heading = p.heading;
      runState.speed = a.speed;
      stepRun(runState, guestKeys, dt);
      p.heading = wrapAngle(runState.heading);
      a.speed = runState.speed;
      const k = a.air ? JETPACK.flySpeed / HERO.runSpeed : 1;
      dx = Math.sin(p.heading) * a.speed * k * dt;
      dz = Math.cos(p.heading) * a.speed * k * dt;
    }
    // In the air only the buildings taller than the guest's feet stop them.
    const above = a.alt > 0.01 ? a.alt + JETPACK.stepUp : 0;
    const nx = THREE.MathUtils.clamp(p.x + dx, -HERO.bound, HERO.bound);
    if (h.standable(nx, p.z, above)) p.x = nx;
    else a.speed *= 0.5;
    const nz = THREE.MathUtils.clamp(p.z + dz, -HERO.bound, HERO.bound);
    if (h.standable(p.x, nz, above)) p.z = nz;
    else a.speed *= 0.5;
  }

  /**
   * The first place a guest could stand along the way they face, from the
   * teleport's full distance back (player/teleport.js `landingSpot`, for a guest).
   * @param {import('./players.js').Player} p
   * @param {any} h heroMode
   * @returns {{x: number, z: number}|null}
   */
  function guestLanding(p, h) {
    const sx = Math.sin(p.heading), sz = Math.cos(p.heading);
    for (let d = TELEPORT.distance; d >= TELEPORT.minDistance; d -= TELEPORT.step) {
      const x = p.x + sx * d, z = p.z + sz * d;
      if (h.standable(x, z)) return { x, z };
    }
    return null;
  }

  /**
   * One step of a guest's height, as Roger's (hero/jetpack.js stepAir): Space
   * lights the pack at once and climbs, let go it sinks slowly, no fuel; it
   * lands on a roof or the street. Out of the air it falls (down, seated).
   * @param {import('./players.js').Player} p
   * @param {{alt: number, vy: number, air: boolean}} a
   * @param {boolean} jet Space held by a guest who can fly.
   * @param {boolean} free The guest's body is theirs to move (not seated).
   * @param {number} dt
   * @param {any} h heroMode
   * @returns {void}
   */
  function stepGuestAir(p, a, jet, free, dt, h) {
    if (!free) { a.alt = 0; a.vy = 0; a.air = false; return; }
    const next = stepAir(a, { jet, up: p.state === 'up' }, dt, h.groundAt(p.x, p.z, a.alt), JETPACK);
    a.alt = next.alt; a.vy = next.vy; a.air = next.air;
  }

  /**
   * A guest's Invincible (V) on or off: the registry flag the health API
   * reads, told to everyone in the room.
   * @param {import('./players.js').Player} p
   * @param {boolean} on
   * @returns {void}
   */
  function setGuestInvincible(p, on) {
    p.invincible = on;
    sendEvent('invincible', { id: Number(p.id), on });
    say(on ? `${rogerStyle(p.id).label}: INVINCIBLE` : `${rogerStyle(p.id).label}: Invincible off`);
  }

  /**
   * A revive in progress, counted down for the two players involved (the
   * one holding F and the one on the ground), once a second: the host on
   * its toast, a guest by a notice.
   * @returns {void}
   */
  function showReviveProgress() {
    for (const p of players.list()) {
      const left = p.state === 'down' && p.reviver ? Math.ceil(REVIVE.hold - p.reviveProgress) : 0;
      const prev = reviveShown.get(p.id) || 0;
      if (left === prev) continue;
      reviveShown.set(p.id, left);
      if (!left) continue;
      const helper = /** @type {string} */ (p.reviver);
      const tell = (/** @type {string} */ id, /** @type {string} */ text) => {
        if (id === '0') say(text); else sendEvent('notice', { text }, id);
      };
      tell(helper, `Reviving ${rogerStyle(p.id).label}… keep holding F (${left} s)`);
      tell(p.id, `${rogerStyle(helper).label} is reviving you… ${left} s`);
    }
  }

  /**
   * The nearest enemy a ray from the guest's eyes crosses (a standing
   * cylinder: the kind's hitbox, else a person-sized default).
   * @param {import('./players.js').Player} p
   * @param {number} yaw Aim yaw, radians.
   * @param {number} pitch Aim pitch, radians.
   * @param {number} range
   * @returns {{e: any, kind: any, t: number}|null}
   */
  function scan(p, yaw, pitch, range) {
    const ox = p.x, oy = EYE, oz = p.z;
    const cp = Math.cos(pitch);
    const dx = Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = Math.cos(yaw) * cp;
    /** @type {{e: any, kind: any, t: number}|null} */
    let best = null;
    let bestT = range;
    const hx = Math.hypot(dx, dz) || 1e-6;
    ctx.systems.enemies.each((/** @type {any} */ e, /** @type {any} */ kind) => {
      const q = kind.position(e);
      const box = kind.hitbox ? kind.hitbox(e) : { x: q.x, z: q.z, radius: 1.2, top: 2.4 };
      // Closest approach of the ray to the cylinder axis, in the ground plane.
      const t = ((box.x - ox) * dx + (box.z - oz) * dz) / (hx * hx);
      if (t < 0 || t > bestT) return;
      const px = ox + dx * t, pz = oz + dz * t, py = oy + dy * t;
      if (Math.hypot(px - box.x, pz - box.z) > box.radius || py < 0 || py > box.top) return;
      best = { e, kind, t };
      bestT = t;
    });
    return best;
  }

  /** @param {number} points @param {string} id */
  function credit(points, id) {
    ctx.systems.damage.addDamageScore(points);
    sendEvent('score', { id: Number(id), points });
  }

  /**
   * One trigger pull from a guest, whatever is in their hand. Every weapon
   * resolves through the paths Roger's use: the enemy registry (so each
   * enemy's own `accepts` and damage handler decide), the building-fire and
   * black-hole systems, and damage.addDamageScore. The other players in the
   * line of fire, arc or cone are hurt through health.damagePlayer (friendly
   * fire is on, R-053).
   * @param {import('./players.js').Player} p
   * @param {{cd: number, flame: {tick: number}}} a
   * @param {import('./protocol.js').PlayerInput} input the latest input (aim direction)
   * @param {number} dt
   * @param {import('./guestWeapons.js').Trigger} trigger the pull being acted on (weapon and raised state when it was made)
   */
  function guestFire(p, a, input, dt, trigger) {
    const name = WEAPONS[trigger.weapon];
    const { verdict } = resolveTrigger(trigger, a.cd);
    if (dbg) { dbg.fire(trigger.weapon, 0); if (!trigger.aim) dbg.unfired(2); }
    // The weapon must be raised first (the Katana excepted): no shot, no cooldown spent.
    if (verdict === 'unraised' || verdict === 'none') return;
    const ox = p.x, oz = p.z;
    // Aiming, the shot goes where the guest looks; on foot (the Katana's
    // cut), straight ahead of the body.
    const yaw = input.aim ? input.yaw : p.heading;
    const pitch = input.aim ? input.pitch : 0;
    const cp = Math.cos(pitch);
    const dx = Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = Math.cos(yaw) * cp;
    if (verdict === 'flame') {
      // Held: the same flame, sound and burning as Roger's, from the guest.
      aimVec.set(dx, dy, dz);
      muzzleVec.set(ox, EYE, oz);
      hero().guestFlame(a.flame, dt, muzzleVec, aimVec);
      return;
    }
    if (verdict === 'cooldown') { if (dbg) dbg.fire(trigger.weapon, 1); return; }
    if (name === 'rifle' || name === 'minigun' || name === 'railgun') {
      const w = /** @type {typeof GUEST_WEAPONS.rifle} */ (GUEST_WEAPONS[name]);
      a.cd = w.cooldown;
      const hit = scan(p, yaw, pitch, w.range);
      if (dbg && hit) dbg.fire(trigger.weapon, 2);
      // What the host sees of the guest's shot: one tracer in the shared round
      // pool, from just ahead of the guest's eye to where the ray ends. Cosmetic
      // (no hit, no casing, no sound, no particles); the damage is the call below.
      const reach = hit ? hit.t : w.range;
      muzzleVec.set(ox + dx * 0.8, EYE - 0.2 + dy * 0.8, oz + dz * 0.8);
      tracerEnd.set(ox + dx * reach, EYE + dy * reach, oz + dz * reach);
      hero().guestTracer(muzzleVec, tracerEnd);
      if (hit && ctx.systems.enemies.hit(hit.e, hit.kind, { type: w.type, at: { x: ox + dx * hit.t, y: EYE + dy * hit.t, z: oz + dz * hit.t } })) { if (dbg) dbg.fire(trigger.weapon, 3); credit(KILL_SCORE, p.id); }
      // Friendly fire (D4): the partner in the line of fire, if nearer than the enemy hit.
      hurtRay(p.id, ox, EYE, oz, dx, dy, dz, hit ? hit.t : w.range, w.type);
    } else if (name === 'katana') {
      a.cd = KATANA.cooldown;
      // A cut in front of the guest: the nearest enemy inside the arc takes a blade hit.
      let target = null;
      let bestD = /** @type {number} */ (KATANA.reach);
      ctx.systems.enemies.each((/** @type {any} */ e, /** @type {any} */ kind) => {
        if (!kind.accepts.includes('blade')) return;
        const q = kind.position(e);
        const d = Math.hypot(q.x - ox, q.z - oz);
        if (d > bestD) return;
        const off = Math.atan2(q.x - ox, q.z - oz) - yaw;
        if (Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) > KATANA.halfAngle) return;
        target = { e, kind, q };
        bestD = d;
      });
      if (target) {
        const t = /** @type {{e: any, kind: any, q: {x: number, z: number}}} */ (target);
        if (dbg) dbg.fire(trigger.weapon, 2);
        if (ctx.systems.enemies.hit(t.e, t.kind, { type: 'blade', amount: 1, at: { x: t.q.x, z: t.q.z } })) { if (dbg) dbg.fire(trigger.weapon, 3); credit(KILL_SCORE, p.id); }
      }
      // Friendly fire (D4): the other player inside the same arc.
      hurtSector(p.id, ox, oz, Math.sin(yaw), Math.cos(yaw), KATANA.reach, Math.cos(KATANA.halfAngle), 0.05, 'blade', 'melee', 'Cut down by');
      // People are not in the registry: the nearest standing civilian in the
      // same arc is killed through the people owner (as the host's blade
      // does) and credited at the person-kill value. `blade` is sent to no kind.
      /** @type {any} */
      let person = null;
      let bestPerson = /** @type {number} */ (KATANA.reach);
      ctx.systems.people.eachCuttable((/** @type {any} */ c) => {
        const q = c.mesh.position;
        const d = Math.hypot(q.x - ox, q.z - oz);
        if (d > bestPerson) return;
        const off = Math.atan2(q.x - ox, q.z - oz) - yaw;
        if (Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) > KATANA.halfAngle) return;
        person = c;
        bestPerson = d;
      });
      if (person) {
        ctx.systems.people.explodePerson(person);
        credit(IMPACT_SCORE, p.id);
      }
    } else if (name === 'blackhole') {
      a.cd = HOLE_COOLDOWN;
      // Where the aim meets the ground, or the enemy it is on.
      let gx = 0, gz = 0, ok = false;
      const hit = scan(p, yaw, pitch, 200);
      if (hit) { const q = hit.kind.position(hit.e); gx = q.x; gz = q.z; ok = true; }
      else if (dy < -0.02) {
        const t = EYE / -dy;
        gx = ox + dx * t; gz = oz + dz * t; ok = true;
      }
      if (!ok) { sendEvent('notice', { text: 'BLACK HOLE GUN — aim at the ground or a target' }, p.id); return; }
      if (Math.hypot(gx - ox, gz - oz) < HOLE_MIN_RANGE) { sendEvent('notice', { text: 'TOO CLOSE — aim further out' }, p.id); return; }
      const cost = HOLE.cost * 10;
      if (!ENERGY.infinite && p.energy < cost) { sendEvent('notice', { text: `BLACK HOLE GUN — needs ${cost}% energy` }, p.id); return; }
      const result = ctx.systems.blackHole.fire(Math.max(-HERO.bound, Math.min(HERO.bound, gx)), Math.max(-HERO.bound, Math.min(HERO.bound, gz)));
      if (result && !ENERGY.infinite) p.energy -= cost;
    }
  }

  // ---------------------------------------------------------------------
  // Snapshots
  // ---------------------------------------------------------------------

  /**
   * The players off the ground: [id, feet height], the host's Roger (id 0) and the guests.
   * @param {any} h heroMode
   * @returns {number[][]}
   */
  function altRows(h) {
    /** @type {number[][]} */
    const rows = [];
    const own = h.rogerAlt();
    if (own > 0.05) rows.push([0, Math.round(own * 100) / 100]);
    for (const [id, a] of S.avatars) if (a.alt > 0.05) rows.push([Number(id), Math.round(a.alt * 100) / 100]);
    return rows.slice(0, LIMITS.maxPerKind);
  }

  /** @returns {import('./protocol.js').Snapshot} */
  function buildSnapshot() {
    const h = hero();
    const clamp = (/** @type {number} */ v) => THREE.MathUtils.clamp(v, -LIMITS.worldBound, LIMITS.worldBound);
    const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;
    const r1 = (/** @type {number} */ v) => Math.round(v * 10) / 10;
    const rows = {
      players: /** @type {number[][]} */ ([]),
      tornadoes: /** @type {number[][]} */ ([]),
      terminators: /** @type {number[][]} */ ([]),
      aliens: /** @type {number[][]} */ ([]),
      ships: /** @type {number[][]} */ ([]),
      vehicles: /** @type {number[][]} */ ([])
    };
    const cap = LIMITS.maxPerKind;
    for (const p of players.list()) {
      const seat = p.seat;
      rows.players.push([Number(p.id), r2(clamp(p.x)), r2(clamp(p.z)), r2(p.heading), p.state === 'up' ? 0 : p.state === 'down' ? 1 : 2, p.weapon, Math.round(p.energy), seat ? seat.vehicle : -1, seat ? seat.seat : -1]);
    }
    ctx.tornadoes.active.forEach((/** @type {any} */ t, /** @type {number} */ i) => {
      if (rows.tornadoes.length < cap) rows.tornadoes.push([i, r2(clamp(t.Vortex.center.x)), r2(clamp(t.Vortex.center.z)), r2(Sim.params.radius)]);
    });
    ctx.systems.enemies.each((/** @type {any} */ e, /** @type {any} */ kind) => {
      if (kind.kind !== 'terminator' && kind.kind !== 'pursuer') return;
      if (rows.terminators.length >= cap) return;
      const root = e.root;
      if (!root) return;
      rows.terminators.push([idOf(e), r2(clamp(root.position.x)), r2(clamp(root.position.z)), r2(root.rotation.y), e.p && e.p.state !== 'hunting' ? 1 : 0]);
    });
    const aliens = ctx.systems.aliens;
    if (aliens) {
      for (const al of aliens.instanceSources()) {
        if (rows.aliens.length >= cap) break;
        if (al.phase === 'dead' || al.phase === 'aboard' || !al.root) continue;
        rows.aliens.push([idOf(al), r2(clamp(al.root.position.x)), r2(al.root.position.y), r2(clamp(al.root.position.z)), r2(al.root.rotation.y)]);
      }
      const m = aliens.markers();
      const pushShip = (/** @type {THREE.Vector3|null} */ v) => {
        if (v && rows.ships.length < cap) rows.ships.push([idOf(v), r2(clamp(v.x)), r2(v.y), r2(clamp(v.z)), 0]);
      };
      pushShip(m.ship);
      for (const hv of m.hunters) { const v = hv; pushShip(v); }
    }
    const hp = /** @type {number[][]} */ ([]);
    const health = ctx.systems.health;
    if (health) {
      for (const p of players.list()) {
        const st = health.state(p.id);
        hp.push([Number(p.id), r1(st.value), r1(st.sinceLastDamage)]);
      }
    }
    const driving = h.drivingCar();
    if (driving && rows.vehicles.length < cap) {
      rows.vehicles.push([9000, r2(clamp(driving.mesh.position.x)), r2(clamp(driving.mesh.position.z)), r2(driving.mesh.rotation.y), r2(driving.speed)]);
    }
    for (const car of ctx.Environment.cars) {
      if (rows.vehicles.length >= cap) break;
      if (driving && car.mesh === driving.mesh) continue;
      const v = car.velocity;
      if (!v || v.lengthSq() < 0.04) continue;
      rows.vehicles.push([idOf(car), r2(clamp(car.mesh.position.x)), r2(clamp(car.mesh.position.z)), r2(car.mesh.rotation.y), r2(v.length())]);
    }
    return {
      type: 'snapshot', v: PROTOCOL_VERSION, room: S.code, tick: ++S.tick, t: Math.round((performance.now() / 1000 - S.t0) * 1000) / 1000,
      score: Math.max(0, Math.round(Sim.stats.damageScore)), ...rows, hp,
      alt: altRows(h),
      ack: gate.acks((id) => id !== '0' && !!players.get(id))
    };
  }

  // ---------------------------------------------------------------------
  // Peer
  // ---------------------------------------------------------------------

  /**
   * The peer's movement environment for prediction: the same step as the host
   * (`stepMove`) over the peer's own town, built from the host's seed. The host
   * has the final say, so a wall the peer does not know only costs a blend.
   * @type {import('./prediction.js').MoveEnv}
   */
  const predEnv = {
    standable: (x, z) => {
      const h = hero();
      if (!h || typeof h.standable !== 'function') return true;
      const alt = S.altNow.get(Number(S.myId)) || 0;
      try { return h.standable(x, z, alt > 0.01 ? alt + JETPACK.stepUp : 0); } catch { return true; }
    },
    bound: HERO.bound,
    /** In the air the guest flies at the jetpack's speed. */
    get speeds() { return (S.altNow.get(Number(S.myId)) || 0) > 0.01 ? FLY_SPEEDS : GUEST_SPEEDS; }
  };

  /**
   * A snapshot was accepted: reconcile the prediction with the host's row for
   * this player (newest snapshot, not the interpolated one) and its input ack.
   * Down, dead or seated means the host is not moving us: prediction is off.
   * @param {any} msg
   */
  function reconcileOwn(msg) {
    const id = Number(S.myId);
    const row = Array.isArray(msg.players) ? msg.players.find((/** @type {number[]} */ r) => r[0] === id) : null;
    if (!row) { S.pred = newPrediction(); return; }
    let ack = -1;
    if (Array.isArray(msg.ack)) for (const r of msg.ack) if (r[0] === id) ack = r[1];
    // A jump of the authoritative position just after E is the teleport: show both ends here too.
    const last = S.lastAuth;
    S.lastAuth = { x: row[1], z: row[2] };
    if (last && Math.hypot(row[1] - last.x, row[2] - last.z) > 8 && performance.now() - S.tpAt < 1500 && ctx.systems.teleport) {
      ctx.systems.teleport.warpAt(last.x, last.z, true);
      ctx.systems.teleport.warpAt(row[1], row[2], false);
      if (ctx.systems.powerArcSound) ctx.systems.powerArcSound.playZap(1);
      S.tpAt = 0;
    }
    const out = reconcile(S.pred, { x: row[1], z: row[2] }, ack, row[4] === 0 && row[7] < 0, predEnv);
    S.pred = out.state;
    if (dbg && S.pred.active) {
      if (out.snapped) S.predStats.snaps++; else S.predStats.blends++;
      S.predStats.last = out.error;
      S.predStats.worst = Math.max(S.predStats.worst, out.error);
    }
  }

  /** @param {any} msg */
  function peerMessage(msg) {
    if ((msg.type === 'snapshot' || msg.type === 'event') && msg.v !== PROTOCOL_VERSION) {
      if (!S.versionWarned) { S.versionWarned = true; say(VERSION_TEXT); }
      return;
    }
    if (msg.type === 'snapshot') {
      if (Array.isArray(msg.hp)) {
        const at = performance.now();
        for (const r of msg.hp) {
          const e = S.peerHp.get(r[0]);
          if (e) { e.v = r[1]; e.since = r[2]; e.at = at; } else S.peerHp.set(r[0], { v: r[1], since: r[2], at });
        }
      }
      if (dbg) {
        let mine = -1;
        if (Array.isArray(msg.ack)) for (const r of msg.ack) if (String(r[0]) === S.myId) mine = r[1];
        dbg.snapshotArrived(performance.now(), mine);
      }
      if (buffer.push(msg, performance.now() / 1000).ok) {
        S.altTarget.clear();
        if (Array.isArray(msg.alt)) for (const r of msg.alt) S.altTarget.set(r[0], r[1]);
        reconcileOwn(msg);
      }
      return;
    }
    if (msg.type !== 'event') return;
    if (!deduper.first(msg)) return;
    const d = msg.data || {};
    switch (msg.kind) {
      case 'welcome':
        S.myId = String(d.id);
        S.pendingWelcome = false;
        S.peerReadyShown = true;
        // The same town as the host's first: the reset it triggers puts the
        // panel and the camera back to defaults, which the peer view then locks.
        if (Number.isFinite(d.seed)) applySeed(d.seed >>> 0);
        S.pred = newPrediction();
        enterPeerView();
        say('You are ROGER 2: W S run, A D turn, right-click raises the weapon (then the mouse looks). Hero asks the host to bring you in.');
        setStatus();
        break;
      case 'announce': say(`${String(d.title || '')} ${String(d.sub || '')}`.trim()); break;
      case 'notice': say(String(d.text || '')); break;
      case 'playerDown': say(Number(d.id) === Number(S.myId) ? 'You are down — your teammate can revive you.' : `Player ${d.id} is down.`); break;
      case 'playerRevived': say(Number(d.id) === Number(S.myId) ? 'You were revived.' : `Player ${d.id} revived.`); break;
      case 'playerDamage':
        // The guest's own hit: the same flash, arrow and sound as Roger's.
        if (Number(d.id) !== Number(S.myId)) break;
        ctx.events.emit('playerHurt', { amount: Number(d.amount) || 0, position: Number.isFinite(d.x) && Number.isFinite(d.z) ? { x: d.x, y: 0, z: d.z } : null });
        if (S.hud) {
          S.hurtFlip = !S.hurtFlip;
          S.hud.classList.toggle('hurt-a', S.hurtFlip);
          S.hud.classList.toggle('hurt-b', !S.hurtFlip);
        }
        break;
      case 'gameOver': say('GAME OVER — everyone is down.'); break;
      case 'invincible':
        S.peerInv.set(Number(d.id), !!d.on);
        if (Number(d.id) === Number(S.myId)) say(d.on ? 'INVINCIBLE · nothing can hurt you' : 'Invincible off');
        break;
      case 'mission': S.peerMission = { id: String(d.id), value: Number(d.value), goal: Number(d.goal), left: Number(d.left) }; break;
      case 'score': if (Number(d.id) === Number(S.myId)) say(`+${Number(d.points) || 0}`); break;
      default:
    }
  }

  /**
   * Disables (or restores) the panel's world-affecting controls on a peer: its
   * local simulation is idle, so Tornado, disasters, presets, storm, Reset,
   * Pause and the rest must not act on it. The click blocker in initNet is the
   * backstop if another system re-enables one.
   *
   * Each player plays on their own computer, so the guest is not shown what
   * only the host can use: every part of the panel without a control the
   * guest may touch is hidden (Presets, Storm, Missions, Crowd, Camera,
   * Disasters, the mode buttons, Tornado / Pause / Reset, the town readouts),
   * leaving the fold button, Sounds (this computer's own audio) and the Hero
   * request.
   * @param {boolean} locked
   * @returns {void}
   */
  function setPeerUiLocked(locked) {
    if (locked) {
      const body = document.getElementById('panel-body');
      /** @param {Element} node @returns {boolean} it holds a control the guest may use */
      const keeps = (node) => [...node.querySelectorAll('button, input, select, textarea')].some(PEER_UI_ALLOWED);
      /** @param {Element} parent */
      const hideOthers = (parent) => {
        for (const child of [...parent.children]) {
          const el = /** @type {HTMLElement} */ (child);
          if (PEER_UI_ALLOWED(el)) continue;
          if (!keeps(el)) {
            if (!S.hiddenUi.has(el)) { S.hiddenUi.set(el, !!el.hidden); el.hidden = true; }
          } else if (el.tagName !== 'DETAILS') hideOthers(el);
        }
      };
      if (body) hideOthers(body);
      document.querySelectorAll('#ui-panel button, #ui-panel input, #ui-panel select, #ui-panel textarea').forEach((node) => {
        const el = /** @type {HTMLButtonElement} */ (node);
        if (PEER_UI_ALLOWED(el) || S.lockedUi.has(el)) return;
        S.lockedUi.set(el, { disabled: el.disabled, title: el.title });
        el.disabled = true;
        el.title = 'Controlled by the host in a co-op room';
      });
      return;
    }
    for (const [el, was] of S.lockedUi) {
      /** @type {HTMLButtonElement} */ (el).disabled = was.disabled;
      el.title = was.title;
    }
    S.lockedUi.clear();
    for (const [el, was] of S.hiddenUi) el.hidden = was;
    S.hiddenUi.clear();
  }

  /** @returns {void} */
  function enterPeerView() {
    const { controls, camera } = Sim.three;
    S.savedControls = controls.enabled;
    S.savedCam = { pos: camera.position.clone(), target: controls.target.clone() };
    controls.enabled = false;
    setPeerUiLocked(true);
    // The guest's keyboard and mouse: the very input pipeline Roger's own
    // controls use (engine/player/input.js), read once a frame by
    // readPeerInput. It is this client's only local input; nothing else in the
    // peer's (idle) simulation reads it.
    ctx.systems.playerInput.attachInput();
    if (!S.proxyRoot) { S.proxyRoot = new THREE.Group(); S.proxyRoot.name = 'coop_proxies'; Sim.three.scene.add(S.proxyRoot); }
    if (S.hud) S.hud.classList.add('visible');
  }

  /** Leave: single-player controls, panel and camera back as they were. */
  function restorePeerView() {
    const { controls, camera, renderer } = Sim.three;
    if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
    // Let go of the input pipeline, unless a local Hero run holds it (it cannot
    // while this is a peer, but leaving must never take Roger's keys away).
    if (!(ctx.Hero && ctx.Hero.active)) ctx.systems.playerInput.detachInput();
    S.keys.up = S.keys.down = S.keys.left = S.keys.right = false;
    S.buttons.fire = S.buttons.aim = S.buttons.use = false;
    S.fireLatch = newFireLatch();
    S.aimLocked = false;
    S.abil = 0;
    S.look.yaw = 0;
    S.look.pitch = 0;
    setPeerUiLocked(false);
    controls.enabled = S.savedControls;
    if (S.savedCam) {
      camera.position.copy(S.savedCam.pos);
      controls.target.copy(S.savedCam.target);
      camera.lookAt(S.savedCam.target);
      S.savedCam = null;
    }
  }

  /** @returns {THREE.BufferGeometry} */
  const keepGeo = (/** @type {THREE.BufferGeometry} */ g) => { S.geos.push(g); return g; };
  /** @returns {THREE.Material} */
  const keepMat = (/** @type {THREE.Material} */ m) => { S.mats.push(m); return m; };

  /**
   * A player as Roger on the peer: the town's person figure dressed in his
   * costume (hero/rogerLook.js), in the player's colours. It owns its
   * geometry and materials, released by `disposeProxy`.
   * @param {number} id Player id from the snapshot row.
   * @returns {THREE.Object3D} The figure's root, scaled like a person.
   */
  function makeRogerProxy(id) {
    const person = ctx.systems.people.createPerson(0, 0, 96000 + id);
    const root = person.mesh;
    root.name = `coop_roger_${id}`;
    const owned = newOwned();
    const style = rogerStyle(id);
    dressAsRoger(root, owned.keep, { tee: style.tee });
    root.userData.owned = owned;
    root.userData.run = newRunCycle();
    const limbs = rogerLimbs(root);
    root.userData.limbs = limbs;
    root.userData.held = attachHeld(limbs.armR, owned.keep);
    return root;
  }

  /**
   * Releases a proxy that owns its resources (a Roger); the shared kinds are
   * released together in `clearProxies`.
   * @param {THREE.Object3D} obj The proxy.
   * @returns {void}
   */
  function disposeProxy(obj) {
    if (obj.userData.owned) disposeRoger(obj, obj.userData.owned);
  }

  /** @param {string} kind @param {number} [id] Player id, for the players kind. @returns {THREE.Object3D} */
  function makeProxy(kind, id = 0) {
    if (kind === 'players') return makeRogerProxy(id);
    const g = new THREE.Group();
    const mat = (/** @type {number} */ c, o = 1) => /** @type {THREE.Material} */ (keepMat(new THREE.MeshStandardMaterial({ color: c, transparent: o < 1, opacity: o, roughness: 0.7 })));
    if (kind === 'terminators') {
      const body = new THREE.Mesh(keepGeo(new THREE.CapsuleGeometry(0.34, 1.4, 4, 8)), mat(0xc0392b));
      body.position.y = 1.05;
      g.add(body);
    } else if (kind === 'aliens') {
      const body = new THREE.Mesh(keepGeo(new THREE.SphereGeometry(0.6, 10, 8)), mat(0x7bff7b));
      body.position.y = 0.7;
      g.add(body);
    } else if (kind === 'ships') {
      const disc = new THREE.Mesh(keepGeo(new THREE.CylinderGeometry(14, 14, 3, 20)), mat(0x9aa4b2));
      g.add(disc);
    } else if (kind === 'vehicles') {
      const box = new THREE.Mesh(keepGeo(new THREE.BoxGeometry(2, 1.3, 4.5)), mat(0x4a90e2));
      box.position.y = 0.8;
      g.add(box);
    } else {
      const cone = new THREE.Mesh(keepGeo(new THREE.CylinderGeometry(1, 0.15, 1, 20, 1, true)), mat(0x8c96a3, 0.45));
      cone.position.y = 0.5;
      g.add(cone);
    }
    return g;
  }

  // The guest's weapon in hand (first person): the host's own close-up models,
  // made on first use through `keepGeo`/`keepMat` (released in `clearProxies`).
  /** @type {Map<string, THREE.Object3D>} */
  const viewGroups = new Map();
  /** @type {ReturnType<typeof createWeaponModels>|null} */
  let weaponModels = null;
  /** @type {Map<string, {flash: THREE.Mesh, barrels: THREE.Object3D|null}>} the parts shot feedback moves, by wheel key */
  const viewParts = new Map();
  /** The guest's own shot feedback (flash, recoil, barrel spin), predicted, cosmetic (shotFeedback.js). */
  let feedback = newFeedback();
  /** @type {ReturnType<typeof createBullets>|null} the guest's own round pool, for its tracers (made on the first shot) */
  let rounds = null;
  /** @type {ReturnType<typeof createTrexFlames>|null} the guest's own Fire Gun flames (cosmetic: no burning, made on first use) */
  let flames = null;
  /** Tracers alive at once in the guest's own pool (the minigun's 0.09 s shots at up to 220 m, 320 m/s: about 8). */
  const GUEST_TRACERS = 32;
  /** The wheel keys whose shot draws a tracer: the three guns, and the Black Hole Gun's bolt. */
  const TRACER_KEYS = new Set(['rifle', 'minigun', 'railgun', 'blackhole']);
  const noLanding = () => {};
  const viewAt = { x: 0, y: 0, z: 0 };
  const viewVec = new THREE.Vector3();
  /** @type {{view: THREE.Group, holder: THREE.Group}|null} the Katana's first-person blade */
  let katanaView = null;

  /**
   * The close-up model for a wheel key, made on first use (the rifle without
   * its charge readout, which belongs to the host's HUD state).
   * @param {string} key
   * @returns {THREE.Object3D}
   */
  function viewGroupFor(key) {
    const made = viewGroups.get(key);
    if (made) return made;
    const kit = { scene: Sim.three.scene, keepGeo: /** @type {any} */ (keepGeo), keepMat: /** @type {any} */ (keepMat) };
    /** @type {THREE.Object3D} */
    let group;
    if (key === 'katana') {
      const sword = new THREE.Group();
      fillKatana(sword, kit);
      katanaView = buildKatanaView(sword, Sim.three.scene);
      group = katanaView.view;
    } else {
      weaponModels = weaponModels || createWeaponModels(kit);
      const m = weaponModels;
      const built = /** @type {{group: THREE.Group, flash: THREE.Mesh, barrels?: THREE.Object3D}} */ (key === 'minigun' ? m.buildMinigun() : key === 'railgun' ? m.buildRailgun()
        : key === 'fire' ? m.buildFireGun() : key === 'blackhole' ? m.buildHoleGun() : m.buildRifle());
      group = built.group;
      viewParts.set(key, { flash: built.flash, barrels: built.barrels || null });
    }
    viewGroups.set(key, group);
    return group;
  }

  /**
   * Shows the model of the weapon in the guest's hand in the camera's frame,
   * or hides them all (`key` null).
   * @param {THREE.Camera} cam the guest's camera, already looking
   * @param {string|null} key wheel key to show
   * @param {boolean} moving the guest is walking (sway)
   * @param {number} dt real seconds (the barrels' turn)
   * @returns {void}
   */
  function placeViewmodel(cam, key, moving, dt) {
    const group = key ? viewGroupFor(key) : null;
    for (const [k, g] of viewGroups) g.visible = k === key;
    if (!group) return;
    if (key === 'katana' && katanaView) {
      placeKatanaViewIdle(katanaView.view, katanaView.holder, cam);
      // The cut: out and back across the view (predicted, cosmetic).
      const cut = swingAmount(feedback.swing);
      if (cut > 0) {
        katanaView.holder.rotation.x += SWING.pitch * cut;
        katanaView.holder.rotation.y += SWING.yaw * cut;
        katanaView.holder.position.x += SWING.sweep * cut;
        katanaView.view.updateMatrixWorld(true);
      }
      return;
    }
    const o = viewOffset(viewAt, swayOf(moving, performance.now() / 1000));
    // The kick of a shot, as the host's own viewmodel (heroWeapons.js placeView).
    group.position.set(o.x, o.y + feedback.recoil * 0.02, o.z + feedback.recoil * 0.1).applyQuaternion(cam.quaternion).add(cam.position);
    group.quaternion.copy(cam.quaternion);
    group.rotateX(feedback.recoil * 0.08);
    const parts = key ? viewParts.get(key) : null;
    if (parts) {
      const lit = feedback.flash > 0 && feedback.flashKey === key;
      parts.flash.visible = lit;
      if (lit) {
        /** @type {THREE.MeshBasicMaterial} */ (parts.flash.material).opacity = flashOpacity(feedback.flash);
        parts.flash.scale.setScalar(SHOT_LOOK[/** @type {keyof typeof SHOT_LOOK} */ (key)]?.scale || 1);
      }
      if (parts.barrels) parts.barrels.rotation.z += feedback.spin * dt;
    }
    group.updateMatrixWorld(true);
  }

  /**
   * The one audio cue of a shot, through the hero sound system the host's
   * weapons use (this computer's own audio, never sent).
   * @param {string} key wheel key that fired
   * @returns {void}
   */
  function playShotCue(key) {
    if (key === 'katana') { if (ctx.systems.katanaSound) ctx.systems.katanaSound.playSwing(); return; }
    const look = SHOT_LOOK[/** @type {keyof typeof SHOT_LOOK} */ (key)];
    if (!look) return;
    const snd = ctx.systems.heroSound;
    if (look.cue === 'bullet') snd.playBullet();
    else if (look.cue === 'zap') snd.playZap();
    else if (look.cue === 'plasma') snd.playPlasma(0.3);
  }

  /**
   * One tracer from just ahead of the guest's eye along its aim, in its own
   * round pool (hero/bullets.js, no hit, no casing: cosmetic; the host
   * resolves the shot). Predicted like the flash, so it shows even for a shot
   * the host refuses.
   * @param {THREE.Camera} cam the guest's camera, already looking
   * @param {{range: number}|null} w the weapon's table entry
   * @returns {void}
   */
  function drawTracer(cam, w) {
    if (!w) return;
    rounds = rounds || createBullets(ctx, { max: GUEST_TRACERS, casings: 0 });
    cam.getWorldDirection(viewVec);
    muzzleVec.copy(cam.position).addScaledVector(viewVec, 0.8);
    muzzleVec.y -= 0.2;
    tracerEnd.copy(cam.position).addScaledVector(viewVec, w.range);
    rounds.fire(muzzleVec, tracerEnd, null, null, null);
  }

  /**
   * The Fire Gun's flame from the guest's muzzle: the same particles and
   * roar as the host's, in the guest's own pool. Cosmetic: the burning is
   * the host's `guestFlame`.
   * @param {THREE.Camera} cam the guest's camera, already looking
   * @param {number} dt real seconds
   * @returns {void}
   */
  function breatheFlame(cam, dt) {
    if (!flames) { flames = createTrexFlames(ctx, { size: FIRE_GUN.flameSize, alpha: FIRE_GUN.flameAlpha, name: 'guest_fire_gun_flames' }); flames.init(); }
    cam.getWorldDirection(viewVec);
    muzzleVec.copy(cam.position).addScaledVector(viewVec, 0.8 + FIRE_GUN.ahead);
    muzzleVec.y -= 0.2;
    flames.emit(muzzleVec, viewVec, Math.round(FIRE_GUN.rate * dt + Math.random()));
    flames.update(dt);
    ctx.systems.creatureSounds.loop('fireGun', muzzleVec, 0.9);
  }

  /** Takes every viewmodel out of the scene (their geometry is released with `S.geos`). @returns {void} */
  function clearViewmodels() {
    if (flames) flames.release();
    flames = null;
    if (rounds) rounds.dispose();
    rounds = null;
    for (const g of viewGroups.values()) g.removeFromParent();
    viewGroups.clear();
    viewParts.clear();
    feedback = newFeedback();
    weaponModels = null;
    katanaView = null;
  }

  function clearProxies() {
    clearViewmodels();
    for (const map of S.proxies.values()) for (const obj of map.values()) disposeProxy(obj);
    if (S.proxyRoot) Sim.three.scene.remove(S.proxyRoot);
    S.proxyRoot = null;
    S.proxies.clear();
    for (const g of S.geos) g.dispose();
    for (const m of S.mats) m.dispose();
    S.geos = [];
    S.mats = [];
  }

  /**
   * Asks for the pointer lock (first person). The browser refuses a new lock
   * for a moment after the old one is released, so a request waits out the
   * cooldown and a rejection is handled instead of surfacing as an uncaught
   * promise error.
   * @returns {void}
   */
  function requestLock() {
    const canvas = Sim.three.renderer.domElement;
    if (!mayRequestLock(performance.now(), S.lockExitAt)) { say('Mouse look is cooling down: right-click again in a moment.'); return; }
    try {
      const request = /** @type {any} */ (canvas.requestPointerLock());
      if (request && typeof request.catch === 'function') request.catch(() => { S.lockExitAt = performance.now(); });
    } catch { /* unavailable (an embedding frame may forbid it): the mouse still looks */ }
  }

  /** @returns {boolean} the guest's own Roger is up (true until the first snapshot) */
  const peerUp = () => !S.peerRow || S.peerRow[4] === 0;

  /**
   * Into the guest's first person, as Roger's enterAim: the look starts where
   * the body faces, the crosshair shows and the pointer is locked.
   * @returns {void}
   */
  function enterPeerAim() {
    S.buttons.aim = true;
    S.look.yaw = S.peerRow ? wrapAngle(S.peerRow[3]) : S.look.yaw;
    S.look.pitch = 0.02;
    requestLock();
  }

  /** Back to the follow camera, the weapon lowered (Roger's leaveAim). @returns {void} */
  function leavePeerAim() {
    S.buttons.aim = false;
    releaseFire();
    S.aimLocked = false;
    for (const g of viewGroups.values()) g.visible = false;
    const canvas = Sim.three.renderer.domElement;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }

  /** The guest's fire input pressed: held, and owed to the next input message. */
  function pressFire() {
    S.buttons.fire = true;
    S.fireLatch = fireLatchPress(S.fireLatch);
  }

  /** The guest's fire input released (an unsent press stays owed). */
  function releaseFire() {
    S.buttons.fire = false;
    S.fireLatch = fireLatchRelease(S.fireLatch);
  }

  /**
   * The guest's keyboard and mouse for this frame, read from the shared input
   * pipeline with Roger's own bindings (hero/input.js consumeInput): W A S D
   * run (A and D turn on foot, strafe in first person), right-click raises and
   * lowers the weapon, the mouse looks only while it is raised, click or Enter
   * fires (the Katana cuts on foot too), the wheel switches weapon, E
   * teleports, F revives, V is Invincible. While the guest is down or dead
   * only V counts: the body is not theirs to move.
   * @returns {void}
   */
  function readPeerInput() {
    const input = ctx.systems.playerInput;
    const up = peerUp();
    const held = input.held;
    S.keys.up = up && held.up;
    S.keys.down = up && held.down;
    S.keys.left = up && held.left;
    S.keys.right = up && held.right;
    for (const e of input.drain()) {
      switch (e.type) {
        case 'keydown': {
          if (e.repeat) break;
          if (e.code === 'KeyV') { S.abil |= 8; S.abilLatch |= 8; break; }
          if (!up) break;
          if (e.code === 'Enter' || e.code === 'NumpadEnter') {
            if (S.buttons.aim) pressFire();
            else say('RIGHT-CLICK to raise the weapon · ENTER to fire');
          } else if (e.code === 'Escape' && S.buttons.aim) leavePeerAim();
          else if (e.code === 'KeyQ') { S.abil |= 1; S.abilLatch |= 1; }
          else if (e.code === 'KeyE') { S.abil |= 2; S.abilLatch |= 2; S.tpAt = performance.now(); }
          else if (e.code === 'KeyR') { S.abil |= 4; S.abilLatch |= 4; }
          else if (e.code === 'Space') S.abil |= JET_BIT;
          else if (e.code === 'KeyF') S.buttons.use = true;
          break;
        }
        case 'keyup':
          if (e.code === 'Enter' || e.code === 'NumpadEnter') releaseFire();
          else if (e.code === 'KeyQ') S.abil &= ~1;
          else if (e.code === 'KeyE') S.abil &= ~2;
          else if (e.code === 'KeyR') S.abil &= ~4;
          else if (e.code === 'KeyV') S.abil &= ~8;
          else if (e.code === 'Space') S.abil &= ~JET_BIT;
          else if (e.code === 'KeyF') S.buttons.use = false;
          break;
        case 'mousedown':
          if (!up || !(e.onCanvas || S.aimLocked)) break;
          if (e.button === 2) { if (S.buttons.aim) leavePeerAim(); else enterPeerAim(); }
          else if (e.button === 0 && (S.buttons.aim || WEAPONS[S.weapon] === 'katana')) pressFire();
          break;
        case 'mouseup':
          if (e.button === 0) releaseFire();
          break;
        case 'wheel': {
          if (!up) break;
          S.weapon = (S.weapon + e.dir + WEAPONS.length) % WEAPONS.length;
          // As Roger's: first person stays up across the wheel, the Katana included.
          releaseFire();
          break;
        }
        case 'blur':
          releaseFire();
          S.buttons.use = false;
          S.abil = 0;
          break;
        case 'pointerlock':
          // Esc under the lock goes to the browser, which drops it: the way out of first person.
          if (S.aimLocked && !e.locked && S.buttons.aim) leavePeerAim();
          S.aimLocked = e.locked && S.buttons.aim;
          break;
        default:
      }
    }
    const look = input.takeLook();
    input.takeTurn();
    if (!up) {
      // Down or dead: the weapon drops and nothing is held.
      if (S.buttons.aim) leavePeerAim();
      releaseFire();
      S.buttons.use = false;
      S.abil &= 8;
      return;
    }
    if (S.buttons.aim && (look.dx || look.dy)) {
      S.look.yaw = wrapAngle(S.look.yaw - look.dx * HERO.lookSensitivity);
      S.look.pitch = THREE.MathUtils.clamp(S.look.pitch - look.dy * HERO.lookSensitivity, HERO.pitchMin, HERO.pitchMax);
    }
  }

  /** @param {number} dt */
  function updatePeer(dt) {
    if (!S.peerReadyShown || !S.proxyRoot || !S.client) return;
    S.heroFlag = Math.max(0, S.heroFlag - dt);
    readPeerInput();
    // Input at ~30 Hz.
    S.inputAcc += dt;
    // Prediction: this frame's live keys move the avatar at once.
    const liveYaw = wrapAngle(S.look.yaw);
    const k0 = S.keys;
    // The host walks a guest on foot by turning (tank-style), which the shared step
    // does not model: prediction runs only while aiming (strafing, as the shared step).
    if (S.buttons.aim) S.pred = predictFrame(S.pred, { mx: (k0.right ? 1 : 0) - (k0.left ? 1 : 0), mz: (k0.up ? 1 : 0) - (k0.down ? 1 : 0), yaw: liveYaw, aim: S.buttons.aim }, dt, predEnv);
    else if (S.pred.active) S.pred = newPrediction();
    if (S.inputAcc >= INPUT_INTERVAL) {
      S.inputAcc = 0;
      const k = S.keys;
      const sampled = fireLatchSample(S.fireLatch);
      S.fireLatch = sampled.next;
      if (dbg) dbg.inputSent(S.seq + 1, performance.now());
      const mx = (k.right ? 1 : 0) - (k.left ? 1 : 0), mz = (k.up ? 1 : 0) - (k.down ? 1 : 0);
      S.pred = recordSent(S.pred, S.seq + 1, { mx, mz, yaw: liveYaw, aim: S.buttons.aim });
      S.client.send({
        type: 'input', v: PROTOCOL_VERSION, seq: ++S.seq,
        mx, mz, yaw: liveYaw, pitch: S.look.pitch,
        fire: sampled.fire, aim: S.buttons.aim, weapon: S.weapon, abil: S.abil | S.abilLatch, use: S.buttons.use, hero: S.heroFlag > 0
      });
      S.abilLatch = 0;
    }
    if (dbg) dbg.peerFrame(performance.now());
    const s = buffer.sample(performance.now() / 1000);
    if (!s) return;
    S.peerScore = s.score;
    // Own avatar from the prediction while it runs (else from the host's row).
    const pv = S.pred.active && S.buttons.aim ? viewPoint(S.pred) : null;
    // Heights ease towards the newest snapshot's (the jetpack), and settle to the ground.
    const ease = 1 - Math.exp(-12 * dt);
    for (const [id, now] of S.altNow) {
      const next = now + ((S.altTarget.get(id) || 0) - now) * ease;
      if (next < 0.01 && !S.altTarget.has(id)) S.altNow.delete(id); else S.altNow.set(id, next);
    }
    for (const [id, to] of S.altTarget) if (!S.altNow.has(id)) S.altNow.set(id, to);
    for (const [kind, rows] of Object.entries(s.kinds)) {
      let map = S.proxies.get(kind);
      if (!map) { map = new Map(); S.proxies.set(kind, map); }
      for (const [id, obj] of [...map]) {
        if (!rows.has(id)) { S.proxyRoot.remove(obj); disposeProxy(obj); map.delete(id); }
      }
      for (const [id, row] of rows) {
        const mine = kind === 'players' && String(id) === S.myId;
        let obj = map.get(id);
        if (!obj) { obj = makeProxy(kind, id); map.set(id, obj); S.proxyRoot.add(obj); }
        if (kind === 'tornadoes') {
          obj.position.set(row[1], 0, row[2]);
          obj.scale.set(row[3], 140, row[3]);
        } else if (kind === 'aliens' || kind === 'ships') {
          obj.position.set(row[1], row[2], row[3]);
          obj.rotation.y = row[4];
        } else {
          const px = mine && pv ? pv.x : row[1], pz = mine && pv ? pv.z : row[2];
          obj.position.set(px, kind === 'players' ? (S.altNow.get(id) || 0) : 0, pz);
          obj.rotation.y = mine && pv ? liveYaw : row[3];
          if (kind === 'players') {
            obj.rotation.x = row[4] === 0 ? 0 : -Math.PI / 2 + 0.1;
            swingLimbs(obj.userData.limbs, obj.userData.run.phase, row[4] === 0 ? stepRunCycle(obj.userData.run, px, pz, dt, HERO.stride, HERO.runSpeed) : 0);
            // The weapon in hand from the row's weapon column (5); hidden down or seated (vehicle column 7).
            obj.userData.held.show(heldKey(row[5], row[4] === 0, row[7] >= 0));
          }
          if (kind === 'terminators') obj.rotation.x = row[4] === 0 ? 0 : -Math.PI / 2 + 0.1;
        }
        if (mine) S.peerRow = row;
        else if (kind === 'players') partnerRows.set(id, row);
      }
    }
    // Follow the avatar: over Roger's shoulder at the host's follow distances,
    // or at his eyes while aiming (rogerView.js `followCamera`; scratch only).
    // On foot the camera sits behind the body's heading (host-authoritative,
    // turned by A and D), as Roger's follow camera; aiming, it is at the eyes
    // and turns with the guest's own mouse at once (no round trip).
    const me = s.kinds.players.get(Number(S.myId));
    if (me) {
      const cam = Sim.three.camera;
      const cx = pv ? pv.x : me[1], cz = pv ? pv.z : me[2];
      const myAlt = S.altNow.get(Number(S.myId)) || 0;
      if (S.buttons.aim) followCamera(camPose, cx, cz, S.look.yaw, S.look.pitch, true, FOLLOW, myAlt);
      else followCamera(camPose, cx, cz, me[3], 0, false, FOLLOW, myAlt);
      if (camPose.firstPerson) cam.position.set(camPose.px, camPose.py, camPose.pz);
      else cam.position.lerp(camGoal.set(camPose.px, camPose.py, camPose.pz), Math.min(1, dt * 5));
      cam.lookAt(camPose.lx, camPose.ly, camPose.lz);
      // The guest's own shot feedback at the press: flash, kick, barrel spin and one cue
      // per shot. Predicted from the host's cooldown table; a shot the host refuses
      // (not in Hero Mode, no energy, no target) still shows and sounds here.
      const step = stepFeedback(feedback, { fire: S.buttons.fire || S.fireLatch.pending, aim: S.buttons.aim, up: me[4] === 0, weapon: S.weapon }, dt);
      feedback = step.fb;
      if (step.shot) playShotCue(step.shot);
      if (step.shot && TRACER_KEYS.has(step.shot)) drawTracer(cam, weaponAt(S.weapon));
      if (rounds) rounds.update(dt, 1, noLanding);
      if (step.flame) breatheFlame(cam, dt);
      else if (flames) flames.update(dt);
      placeViewmodel(cam, shownKey(S.buttons.aim, me[4] === 0, S.weapon), k0.up || k0.down || k0.left || k0.right, dt);
      const mine = S.proxies.get('players');
      const own = mine && mine.get(Number(S.myId));
      if (own) own.visible = !camPose.firstPerson;
    }
    drawHud();
  }

  /**
   * One synced health bar for the guest HUD. The glow is derived here from
   * the synced `sinceLastDamage` plus the time since it arrived (glow itself
   * is never sent), in steps so the markup only changes when it must.
   * @param {number} id Player id.
   * @param {string} label Text before the bar.
   * @param {boolean} small True for the partner's bar.
   * @param {boolean} out True while the player is down or dead (bar shown empty).
   * @param {number} now performance.now() in ms.
   * @returns {string} The bar's markup ('' when no health has arrived yet).
   */
  function hpBar(id, label, small, out, now) {
    const e = S.peerHp.get(id);
    if (!e) return '';
    const since = e.since + (now - e.at) / 1000;
    const value = out ? 0 : e.v;
    const glow = out ? 0 : Math.round(glowLevel({ value, sinceLastDamage: since, refilling: value < HEALTH.max && since >= HEALTH.timers.regenDelay, invuln: 0, lastSource: null }, HEALTH) * 5) / 5;
    const hp = Math.ceil(value);
    const low = hp <= HEALTH.max * HEALTH.lowThreshold;
    return `<div class="coop-hp${small ? ' small' : ''}${low ? ' low' : ''}${glow > 0 ? ' glowing' : ''}" style="--glow:${glow.toFixed(1)}">${label}<span class="coop-hbar"><i style="width:${((hp / HEALTH.max) * 100).toFixed(0)}%"></i></span><span class="coop-hpct">${out ? 'DOWN' : `${hp}%`}</span></div>`;
  }

  function drawHud() {
    if (!S.hud) return;
    const row = S.peerRow;
    const state = row ? (row[4] === 0 ? 'UP' : row[4] === 1 ? 'DOWN — wait for a revive' : 'DEAD') : '…';
    const ms = S.peerMission;
    const me = Number(S.myId);
    const now = performance.now();
    const inv = (/** @type {number} */ id) => (S.peerInv.get(id) ? ' 🛡' : '');
    let bars = hpBar(me, `HEALTH${inv(me)} `, false, !!row && row[4] !== 0, now);
    for (const id of S.peerHp.keys()) {
      if (id === me) continue;
      // The partner's bar reads DOWN while they are down (their snapshot row).
      const prow = partnerRows.get(id);
      bars += hpBar(id, `${rogerStyle(id).label}${inv(id)} `, true, !!prow && prow[4] !== 0, now);
    }
    if (S.cross) S.cross.classList.toggle('visible', S.buttons.aim && S.peerReadyShown);
    const html = `<b style="color:${rogerStyle(S.myId).accent}">${rogerStyle(S.myId).label}</b> · ${state}${bars}${wheelHtml(S.weapon)}ENERGY ${row ? row[6] : 100}%<br>SCORE ${S.peerScore.toLocaleString()}${ms ? `<br>MISSION ${ms.id}: ${ms.value}/${ms.goal}` : ''}<br><small>W S run · A D turn · right-click raise weapon (the mouse looks) · click or Enter fire · wheel weapon · E teleport · F revive · V invincible</small>`;
    // Written only on change, so the bar's glow animation is not restarted every frame.
    if (html !== S.hudHtml) { S.hudHtml = html; S.hud.innerHTML = html; }
  }

  // ---------------------------------------------------------------------
  // Lifecycle hooks
  // ---------------------------------------------------------------------

  /** @returns {void} */
  function initNet() {
    const el = document.createElement('div');
    el.className = 'coop-panel';
    el.innerHTML = `
      <div class="coop-title">CO-OP</div>
      <div class="coop-row">
        <button type="button" class="coop-host">Host room</button>
        <input type="text" class="coop-code" maxlength="6" placeholder="CODE" autocomplete="off" spellcheck="false">
        <button type="button" class="coop-join">Join</button>
        <button type="button" class="coop-leave">Leave</button>
      </div>
      <div class="coop-status"></div>`;
    container.appendChild(el);
    S.panel = el;
    S.status = /** @type {HTMLDivElement} */ (el.querySelector('.coop-status'));
    ui.host = el.querySelector('.coop-host');
    ui.join = el.querySelector('.coop-join');
    ui.leave = el.querySelector('.coop-leave');
    ui.code = el.querySelector('.coop-code');
    const opts = { signal: ctx.signal };
    ui.host?.addEventListener('click', () => startSession('host'), opts);
    ui.join?.addEventListener('click', () => {
      const code = /** @type {HTMLInputElement} */ (ui.code).value.trim().toUpperCase();
      if (code.length !== 6) { say('Enter the 6-character invite code.'); return; }
      startSession('peer', code);
    }, opts);
    ui.leave?.addEventListener('click', () => { if (S.client) S.client.leave(); endSession(); }, opts);
    // Keys must not reach the game while typing a code.
    ui.code?.addEventListener('keydown', (e) => e.stopPropagation(), opts);
    ui.code?.addEventListener('keyup', (e) => e.stopPropagation(), opts);

    S.hud = document.createElement('div');
    S.hud.className = 'coop-hud';
    container.appendChild(S.hud);
    S.toast = document.createElement('div');
    S.toast.className = 'coop-toast';
    container.appendChild(S.toast);
    if (dbg) {
      S.dbgEl = document.createElement('pre');
      S.dbgEl.className = 'coop-netdebug';
      S.dbgEl.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;margin:0;padding:6px 8px;max-width:90vw;font:11px/1.35 monospace;color:#9f9;background:rgba(0,0,0,0.72);pointer-events:none;white-space:pre-wrap';
      container.appendChild(S.dbgEl);
    }
    // The aim crosshair, in the host's own style (tornado.css `.hero-crosshair`).
    S.cross = document.createElement('div');
    S.cross.className = 'hero-crosshair';
    S.cross.innerHTML = '<i class="n"></i><i class="s"></i><i class="w"></i><i class="e"></i><b></b>';
    container.appendChild(S.cross);

    // The host's revive key (F held next to a downed guest). The host's other
    // keys are Roger's (engine/player/input.js); a guest's are read from that
    // same pipeline by readPeerInput, so no player-control listener lives here.
    window.addEventListener('keydown', (e) => {
      if (S.role === 'host' && e.code === 'KeyF') S.holdRevive = true;
    }, opts);
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyF') S.holdRevive = false;
    }, opts);
    window.addEventListener('blur', () => { S.holdRevive = false; }, opts);
    const canvas = Sim.three.renderer.domElement;

    // When a pointer lock last ended or failed: a new request waits out the
    // browser's cooldown (requestLock).
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (S.wasLocked && !locked) S.lockExitAt = performance.now();
      S.wasLocked = locked;
    }, opts);
    document.addEventListener('pointerlockerror', () => { S.lockExitAt = performance.now(); }, opts);

    // Peer panel: the Hero button is a request to the host; every other
    // world-affecting control is blocked (capture phase, before its own handler).
    /** @param {Event} e */
    const guardPeerUi = (e) => {
      if (S.role !== 'peer') return;
      const t = e.target instanceof Element ? e.target : null;
      if (!t || !t.closest('#ui-panel')) return;
      const el = t.closest('button, input, select, textarea');
      if (!el) return;
      if (el.id === 'btn-hero') {
        e.stopPropagation();
        e.preventDefault();
        if (e.type !== 'click') return;
        if (!S.peerReadyShown) { say('Waiting for the host to be ready.'); return; }
        S.heroFlag = HERO_FLAG_SECONDS;
        say('Hero Mode requested from the host.');
        return;
      }
      if (PEER_UI_ALLOWED(el)) return;
      e.stopPropagation();
      e.preventDefault();
    };
    for (const type of ['click', 'input', 'change']) document.addEventListener(type, guardPeerUi, { capture: true, signal: ctx.signal });

    // Replicate the host's headline events (cosmetic ones stay local).
    ctx.events.on('announce', ({ title, sub }) => sendEvent('announce', { title: String(title).slice(0, 80), sub: String(sub).slice(0, 120) }));
    ctx.events.on('notice', ({ text }) => sendEvent('notice', { text: String(text).slice(0, 120) }));
    ctx.events.on('explosion', ({ x, z, size }) => sendEvent('explosion', { x: Math.round(x), z: Math.round(z), size: Math.round(size * 100) / 100 }));
    setStatus();
  }

  /**
   * `?netdebug` only: host frame cadence, the relay ping once a second and the
   * overlay refresh once a second. Never called when the flag is off.
   * @param {number} rawDt
   * @returns {void}
   */
  function debugTick(rawDt) {
    if (!dbg) return;
    const now = performance.now();
    if (S.role === 'host') dbg.hostFrameAt(now);
    S.dbgPingAcc += rawDt;
    if (S.dbgPingAcc >= 1 && S.client && S.client.state().status === 'in-room') {
      S.dbgPingAcc = 0;
      const id = dbg.nextPing(now);
      if (id > 0) S.client.send({ type: 'ping', v: PROTOCOL_VERSION, id });
    }
    S.dbgAcc += rawDt;
    if (S.dbgAcc >= 1) {
      S.dbgAcc = 0;
      if (S.dbgEl) S.dbgEl.textContent = `NETDEBUG ${S.role || ''} (5 s window)\n${dbg.report(now).join('\n')}${S.role === 'peer' ? `\nprediction: ${S.pred.active ? 'on' : 'off'} pending ${S.pred.pending.length} blends ${S.predStats.blends} snaps ${S.predStats.snaps} error last ${S.predStats.last.toFixed(2)} worst ${S.predStats.worst.toFixed(2)} m` : ''}`;
    }
  }

  /** @param {number} rawDt */
  function updateNet(rawDt) {
    if (S.toastTimer > 0) {
      S.toastTimer -= rawDt;
      if (S.toastTimer <= 0 && S.toast) S.toast.classList.remove('visible');
    }
    if (!S.client) return;
    if (dbg) debugTick(rawDt);
    const dt = Sim.state.paused ? 0 : rawDt;
    if (S.role === 'host' && S.client.state().status === 'in-room') {
      updateGuests(dt);
      // Shared mission state, when it changes (host-authoritative).
      const m = ctx.systems.missions && ctx.systems.missions.active();
      const key = m ? `${m.id}:${m.value}:${Math.ceil(m.left)}` : '';
      if (key !== S.lastMission) {
        S.lastMission = key;
        if (m) sendEvent('mission', { id: m.id, value: m.value, goal: m.goal, left: Math.ceil(m.left) });
      }
      S.snapAcc += rawDt;
      if (S.snapAcc >= SNAP_INTERVAL && players.list().length > 1) {
        S.snapAcc = 0;
        if (dbg) dbg.snapshotSent(performance.now());
        S.client.send(buildSnapshot());
      }
    } else if (S.role === 'peer') updatePeer(rawDt);
  }

  /** Reset: leaves the room (a Reset is a clean slate). */
  function resetNet() {
    // The seed-triggered reset (applySeed) must not end its own session.
    if (S.resetting) return;
    if (S.client) { S.client.leave(); endSession(); }
    S.seed = 0;
    ctx.townSeed = undefined;
  }

  /** @returns {void} */
  function disposeNet() {
    endSession();
    if (S.panel && S.panel.parentNode) S.panel.parentNode.removeChild(S.panel);
    if (S.hud && S.hud.parentNode) S.hud.parentNode.removeChild(S.hud);
    if (S.toast && S.toast.parentNode) S.toast.parentNode.removeChild(S.toast);
    if (S.cross && S.cross.parentNode) S.cross.parentNode.removeChild(S.cross);
    if (S.dbgEl && S.dbgEl.parentNode) S.dbgEl.parentNode.removeChild(S.dbgEl);
    S.dbgEl = null;
    S.panel = S.hud = S.toast = S.status = S.cross = null;
  }

  return {
    initNet, updateNet, resetNet, disposeNet,
    isPeerView: () => S.role === 'peer' && S.peerReadyShown,
    pickTarget, catchPlayer, interceptRogerDeath, coopActive,
    notifyDamage, hitGuestsArea, splashGuests, hurtRay, hurtSector, hurtArea,
    /** For tests and the HUD. */
    players, role: () => S.role, seed: () => S.seed
  };
}
