// @ts-check
import * as THREE from 'three';
import { createRelayClient } from './client.js';
import { createInputGate } from './inputGate.js';
import { createSnapshotBuffer } from './interp.js';
import { createEventEmitter, createEventDeduper } from './events.js';
import { createPlayerRegistry, REVIVE } from './players.js';
import { PROTOCOL_VERSION, LIMITS, WEAPONS } from './protocol.js';
import { HERO } from '../hero/config.js';
import { HOLE } from '../player/blackHole.js';
import { ENERGY } from '../player/energy.js';
import { IMPACT_SCORE } from '../damage/config.js';

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
 */

const SNAP_INTERVAL = 1 / LIMITS.snapshotHz;
const INPUT_INTERVAL = 1 / 30;
/** Hitscan weapons: the damage type each answers with in the enemy registry. */
const GUEST_WEAPONS = {
  rifle: { type: /** @type {const} */ ('plasma'), cooldown: 0.45, range: 140 },
  minigun: { type: /** @type {const} */ ('bullet'), cooldown: 0.09, range: 100 },
  railgun: { type: /** @type {const} */ ('bolt'), cooldown: 1.6, range: 220 }
};
const KATANA = { cooldown: 0.5, reach: 3.6, halfAngle: 0.9 };
const HOLE_COOLDOWN = 0.6;
const HOLE_MIN_RANGE = 12;
const EYE = 1.4;
const KILL_SCORE = 20;
/** The car Roger drives is the one co-op vehicle (Hero Mode car flow). */
const CAR_ID = 9000;
const SEAT_REACH = 6;
const TELEPORT = { distance: 25, cooldown: 5 };
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
    /** @type {Map<string, {obj: any, cd: number, tpCd: number, lastAbil: number, lastUse: boolean, flame: {tick: number}}>} */
    avatars: new Map(),
    /** @type {WeakMap<object, number>} */
    ids: new WeakMap(),
    nextId: 1,
    lastMission: '',
    peerScore: 0,
    peerRow: /** @type {number[]|null} */ (null),
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
    weapon: 0,
    abil: 0,
    savedControls: true,
    /** @type {HTMLDivElement|null} */
    panel: null,
    /** @type {HTMLDivElement|null} */
    status: null,
    /** @type {HTMLDivElement|null} */
    hud: null,
    /** @type {HTMLDivElement|null} */
    toast: null,
    toastTimer: 0
  };
  /** @type {Record<string, HTMLElement|null>} */
  const ui = {};
  const hero = () => ctx.systems.heroMode;
  // Scratch for the guest's flame (per instance, never module state).
  const aimVec = new THREE.Vector3();
  const muzzleVec = new THREE.Vector3();

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
        : (S.pendingWelcome ? `Joined ${S.code} · waiting for the host…` : `Joined ${S.code} · you are Player ${S.myId}`);
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
    for (const id of [...S.avatars.keys()]) removeAvatar(id);
    players.clear();
    gate.clear();
    deduper.reset();
    emitter.reset();
    buffer.clear();
    S.tick = 0;
    S.peerScore = 0;
    S.peerRow = null;
    S.peerMission = null;
    clearProxies();
    if (wasPeer) restorePeerView();
    if (S.hud) S.hud.classList.remove('visible');
    setStatus();
  }

  /** @param {'host'|'peer'} role @param {string} [code] */
  function startSession(role, code) {
    if (S.client && S.client.state().status !== 'idle' && S.client.state().status !== 'closed') return;
    if (S.client) endSession();
    if (role === 'host' && hero() && ctx.Hero && ctx.Hero.active) {
      say('Leave Hero Mode before hosting a room.');
      return;
    }
    if (role === 'peer' && ctx.Hero && ctx.Hero.active) {
      say('Leave Hero Mode before joining a room.');
      return;
    }
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
      else if (st.error) say(`Co-op: ${st.error}`);
      endSession();
      return;
    }
    if (st.status === 'in-room' && st.error) say(`Co-op: ${st.error}`);
    setStatus();
  }

  S.peerReadyShown = false;

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
        say(msg.reason === 'dropped' ? 'A player lost connection.' : 'A player left.');
        setStatus();
        return;
      }
      case 'input': {
        const r = gate.accept(msg, (id) => id !== '0' && !!players.get(id));
        if (!r.ok) return;
        const p = players.get(r.id);
        if (p) {
          p.input = r.input;
          p.wantsRevive = r.input.use;
        }
        return;
      }
      default:
    }
  }

  /** @param {string} id @param {number} x @param {number} z */
  function spawnAvatar(id, x, z) {
    const obj = ctx.systems.people.createPerson(x, z, 95000 + Number(id));
    obj.mesh.name = `coop_player_${id}`;
    // A marker over the head so the guest reads as a player, not a bystander.
    const marker = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 8), new THREE.MeshBasicMaterial({ color: 0x35e0a1 }));
    marker.rotation.x = Math.PI;
    marker.position.y = 2.5;
    obj.mesh.add(marker);
    Sim.three.scene.add(obj.mesh);
    S.avatars.set(id, { obj, cd: 0, tpCd: 0, lastAbil: 0, lastUse: false, flame: { tick: 0 } });
  }

  /** @param {string} id */
  function removeAvatar(id) {
    const a = S.avatars.get(id);
    if (!a) return;
    Sim.three.scene.remove(a.obj.mesh);
    a.obj.mesh.traverse((/** @type {any} */ child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
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
   * heroMode.killRoger asks first. In co-op, while a teammate is still up,
   * Roger goes down instead of dying.
   * @param {string} [kind]
   * @returns {boolean} true: handled (do not die)
   */
  function interceptRogerDeath(kind = '') {
    if (S.bypass || !coopActive() || kind === 'fall') return false;
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
    const heroOn = !!pose;

    for (const p of players.list()) {
      if (p.id === '0') continue;
      let a = S.avatars.get(p.id);
      if (!heroOn) { if (a) removeAvatar(p.id); continue; }
      if (!a) {
        const nx = (pose.x) + (Number(p.id) % 2 ? 2 : -2);
        spawnAvatar(p.id, nx, pose.z + 2);
        p.x = nx; p.z = pose.z + 2;
        a = /** @type {NonNullable<typeof a>} */ (S.avatars.get(p.id));
      }
      const pos = a.obj.mesh.position;
      a.cd = Math.max(0, a.cd - dt);
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
        p.heading = input.yaw;
        p.weapon = input.weapon;
        if (ctl.move && dt > 0) moveGuest(p, input, dt);
        if (ctl.aim && input.fire) guestFire(p, a, input, dt);
        const edge = input.abil & ~a.lastAbil;
        a.lastAbil = input.abil;
        // Bit 2: Teleport. Bits 1 and 4 (Time Slow, EMP) are host-only.
        if ((edge & 2) && a.tpCd <= 0 && ctl.move) {
          a.tpCd = TELEPORT.cooldown;
          const tx = p.x + Math.sin(p.heading) * TELEPORT.distance;
          const tz = p.z + Math.cos(p.heading) * TELEPORT.distance;
          if (h.standable(tx, tz)) { p.x = tx; p.z = tz; }
        }
      }
      pos.set(p.x, 0, p.z);
      a.obj.mesh.rotation.y = p.heading;
      // Down: lying flat; revived: upright.
      a.obj.mesh.rotation.x = p.state === 'up' ? 0 : -Math.PI / 2 + 0.1;
      a.obj.mesh.visible = p.state !== 'dead' && !p.seat;
      // Hunters catching a guest: the same reach the pursuers have on Roger.
      if (p.state === 'up' && dt > 0 && caughtBy(p)) catchPlayer(p.id, 'DOWN', `Player ${p.id} was caught`);
    }

    const { revived, died } = players.update(dt);
    for (const id of revived) {
      if (id === '0') h.setCoopDown(false);
      sendEvent('playerRevived', { id: Number(id) });
      say(`Player ${id} revived.`);
    }
    for (const id of died) say(`Player ${id} bled out.`);
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

  /** @param {import('./players.js').Player} p @returns {boolean} */
  function caughtBy(p) {
    let caught = false;
    const reach = HERO.catchRadius;
    ctx.systems.enemies.each((/** @type {any} */ e, /** @type {any} */ kind) => {
      if (caught || (kind.kind !== 'terminator' && kind.kind !== 'pursuer')) return;
      if (e.p && e.p.stagger > 0) return;
      const q = kind.position(e);
      if (Math.hypot(q.x - p.x, q.z - p.z) < reach + 0.4) caught = true;
    });
    return caught;
  }

  /** @param {import('./players.js').Player} p @param {import('./protocol.js').PlayerInput} input @param {number} dt */
  function moveGuest(p, input, dt) {
    const h = hero();
    const speed = (input.aim ? HERO.aimWalkSpeed : HERO.runSpeed) * (input.mz < 0 ? HERO.backSpeed / HERO.runSpeed : 1);
    const mag = Math.hypot(input.mx, input.mz);
    if (mag < 1e-3) return;
    const k = Math.min(1, 1 / mag);
    const fx = Math.sin(input.yaw), fz = Math.cos(input.yaw);
    const rx = Math.cos(input.yaw), rz = -Math.sin(input.yaw);
    const dx = (fx * input.mz + rx * input.mx) * k * speed * dt;
    const dz = (fz * input.mz + rz * input.mx) * k * speed * dt;
    // Each axis on its own, so a wall slides rather than sticks.
    let nx = THREE.MathUtils.clamp(p.x + dx, -HERO.bound, HERO.bound);
    if (h.standable(nx, p.z)) p.x = nx;
    const nz = THREE.MathUtils.clamp(p.z + dz, -HERO.bound, HERO.bound);
    if (h.standable(p.x, nz)) p.z = nz;
    void nx;
  }

  /**
   * The nearest enemy a ray from the guest's eyes crosses (a standing
   * cylinder: the kind's hitbox, else a person-sized default).
   * @param {import('./players.js').Player} p
   * @param {import('./protocol.js').PlayerInput} input
   * @param {number} range
   * @returns {{e: any, kind: any, t: number}|null}
   */
  function scan(p, input, range) {
    const ox = p.x, oy = EYE, oz = p.z;
    const cp = Math.cos(input.pitch);
    const dx = Math.sin(input.yaw) * cp, dy = Math.sin(input.pitch), dz = Math.cos(input.yaw) * cp;
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
   * black-hole systems, and damage.addDamageScore. Nothing hits a player
   * (friendly fire is off).
   * @param {import('./players.js').Player} p
   * @param {{cd: number, flame: {tick: number}}} a
   * @param {import('./protocol.js').PlayerInput} input
   * @param {number} dt
   */
  function guestFire(p, a, input, dt) {
    const name = WEAPONS[input.weapon];
    const ox = p.x, oz = p.z;
    const cp = Math.cos(input.pitch);
    const dx = Math.sin(input.yaw) * cp, dy = Math.sin(input.pitch), dz = Math.cos(input.yaw) * cp;
    if (name === 'fire') {
      // Held: the same flame, sound and burning as Roger's, from the guest.
      aimVec.set(dx, dy, dz);
      muzzleVec.set(ox, EYE, oz);
      hero().guestFlame(a.flame, dt, muzzleVec, aimVec);
      return;
    }
    if (a.cd > 0) return;
    if (name === 'rifle' || name === 'minigun' || name === 'railgun') {
      const w = /** @type {NonNullable<typeof GUEST_WEAPONS[keyof typeof GUEST_WEAPONS]>} */ (GUEST_WEAPONS[name]);
      a.cd = w.cooldown;
      const hit = scan(p, input, w.range);
      if (hit && ctx.systems.enemies.hit(hit.e, hit.kind, { type: w.type, at: { x: ox + dx * hit.t, y: EYE + dy * hit.t, z: oz + dz * hit.t } })) credit(KILL_SCORE, p.id);
    } else if (name === 'katana') {
      a.cd = KATANA.cooldown;
      // A cut in front of the guest: the nearest enemy inside the arc takes a blade hit.
      let target = null;
      let bestD = KATANA.reach;
      ctx.systems.enemies.each((/** @type {any} */ e, /** @type {any} */ kind) => {
        if (!kind.accepts.includes('blade')) return;
        const q = kind.position(e);
        const d = Math.hypot(q.x - ox, q.z - oz);
        if (d > bestD) return;
        const off = Math.atan2(q.x - ox, q.z - oz) - input.yaw;
        if (Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) > KATANA.halfAngle) return;
        target = { e, kind, q };
        bestD = d;
      });
      if (target) {
        const t = /** @type {{e: any, kind: any, q: {x: number, z: number}}} */ (target);
        if (ctx.systems.enemies.hit(t.e, t.kind, { type: 'blade', amount: 1, at: { x: t.q.x, z: t.q.z } })) credit(KILL_SCORE, p.id);
      }
      // People are not in the registry: the nearest standing civilian in the
      // same arc is killed through the people owner (as the host's blade
      // does) and credited at the person-kill value. `blade` is sent to no kind.
      /** @type {any} */
      let person = null;
      let bestPerson = KATANA.reach;
      ctx.systems.people.eachCuttable((/** @type {any} */ c) => {
        const q = c.mesh.position;
        const d = Math.hypot(q.x - ox, q.z - oz);
        if (d > bestPerson) return;
        const off = Math.atan2(q.x - ox, q.z - oz) - input.yaw;
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
      const hit = scan(p, input, 200);
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

  /** @returns {import('./protocol.js').Snapshot} */
  function buildSnapshot() {
    const h = hero();
    const clamp = (/** @type {number} */ v) => THREE.MathUtils.clamp(v, -LIMITS.worldBound, LIMITS.worldBound);
    const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;
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
      score: Math.max(0, Math.round(Sim.stats.damageScore)), ...rows
    };
  }

  // ---------------------------------------------------------------------
  // Peer
  // ---------------------------------------------------------------------

  /** @param {any} msg */
  function peerMessage(msg) {
    if (msg.type === 'snapshot') {
      buffer.push(msg, performance.now() / 1000);
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
        enterPeerView();
        // The same town as the host's.
        if (Number.isFinite(d.seed)) applySeed(d.seed >>> 0);
        setStatus();
        break;
      case 'announce': say(`${String(d.title || '')} ${String(d.sub || '')}`.trim()); break;
      case 'notice': say(String(d.text || '')); break;
      case 'playerDown': say(Number(d.id) === Number(S.myId) ? 'You are down — your teammate can revive you.' : `Player ${d.id} is down.`); break;
      case 'playerRevived': say(Number(d.id) === Number(S.myId) ? 'You were revived.' : `Player ${d.id} revived.`); break;
      case 'gameOver': say('GAME OVER — everyone is down.'); break;
      case 'mission': S.peerMission = { id: String(d.id), value: Number(d.value), goal: Number(d.goal), left: Number(d.left) }; break;
      case 'score': if (Number(d.id) === Number(S.myId)) say(`+${Number(d.points) || 0}`); break;
      default:
    }
  }

  function enterPeerView() {
    S.savedControls = Sim.three.controls.enabled;
    Sim.three.controls.enabled = false;
    for (const id of ['btn-hero', 'btn-start']) {
      const el = /** @type {HTMLButtonElement|null} */ (document.getElementById(id));
      if (el) el.disabled = true;
    }
    if (!S.proxyRoot) { S.proxyRoot = new THREE.Group(); S.proxyRoot.name = 'coop_proxies'; Sim.three.scene.add(S.proxyRoot); }
    if (S.hud) S.hud.classList.add('visible');
  }

  function restorePeerView() {
    Sim.three.controls.enabled = S.savedControls;
    for (const id of ['btn-hero', 'btn-start']) {
      const el = /** @type {HTMLButtonElement|null} */ (document.getElementById(id));
      if (el) el.disabled = false;
    }
  }

  /** @returns {THREE.BufferGeometry} */
  const keepGeo = (/** @type {THREE.BufferGeometry} */ g) => { S.geos.push(g); return g; };
  /** @returns {THREE.Material} */
  const keepMat = (/** @type {THREE.Material} */ m) => { S.mats.push(m); return m; };

  /** @param {string} kind @param {boolean} [mine] @returns {THREE.Object3D} */
  function makeProxy(kind, mine = false) {
    const g = new THREE.Group();
    const mat = (/** @type {number} */ c, o = 1) => /** @type {THREE.Material} */ (keepMat(new THREE.MeshStandardMaterial({ color: c, transparent: o < 1, opacity: o, roughness: 0.7 })));
    if (kind === 'players') {
      const body = new THREE.Mesh(keepGeo(new THREE.CapsuleGeometry(0.28, 1.1, 4, 8)), mat(mine ? 0x35e0a1 : 0xffa24a));
      body.position.y = 0.9;
      g.add(body);
    } else if (kind === 'terminators') {
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

  function clearProxies() {
    if (S.proxyRoot) Sim.three.scene.remove(S.proxyRoot);
    S.proxyRoot = null;
    S.proxies.clear();
    for (const g of S.geos) g.dispose();
    for (const m of S.mats) m.dispose();
    S.geos = [];
    S.mats = [];
  }

  /** @param {number} dt */
  function updatePeer(dt) {
    if (!S.peerReadyShown || !S.proxyRoot || !S.client) return;
    // Input at ~30 Hz.
    S.inputAcc += dt;
    if (S.inputAcc >= INPUT_INTERVAL) {
      S.inputAcc = 0;
      const k = S.keys;
      S.client.send({
        type: 'input', v: PROTOCOL_VERSION, seq: ++S.seq,
        mx: (k.right ? 1 : 0) - (k.left ? 1 : 0), mz: (k.up ? 1 : 0) - (k.down ? 1 : 0),
        yaw: S.look.yaw, pitch: S.look.pitch,
        fire: S.buttons.fire, aim: S.buttons.aim, weapon: S.weapon, abil: S.abil, use: S.buttons.use
      });
    }
    const s = buffer.sample(performance.now() / 1000);
    if (!s) return;
    S.peerScore = s.score;
    for (const [kind, rows] of Object.entries(s.kinds)) {
      let map = S.proxies.get(kind);
      if (!map) { map = new Map(); S.proxies.set(kind, map); }
      for (const [id, obj] of [...map]) {
        if (!rows.has(id)) { S.proxyRoot.remove(obj); map.delete(id); }
      }
      for (const [id, row] of rows) {
        const mine = kind === 'players' && String(id) === S.myId;
        let obj = map.get(id);
        if (!obj) { obj = makeProxy(kind, mine); map.set(id, obj); S.proxyRoot.add(obj); }
        if (kind === 'tornadoes') {
          obj.position.set(row[1], 0, row[2]);
          obj.scale.set(row[3], 140, row[3]);
        } else if (kind === 'aliens' || kind === 'ships') {
          obj.position.set(row[1], row[2], row[3]);
          obj.rotation.y = row[4];
        } else {
          obj.position.set(row[1], 0, row[2]);
          obj.rotation.y = row[3];
          if (kind === 'players') obj.rotation.x = row[4] === 0 ? 0 : -Math.PI / 2 + 0.1;
          if (kind === 'terminators') obj.rotation.x = row[4] === 0 ? 0 : -Math.PI / 2 + 0.1;
        }
        if (mine) S.peerRow = row;
      }
    }
    // Follow the avatar: behind and above, looking over its shoulder.
    const me = s.kinds.players.get(Number(S.myId));
    if (me) {
      const cam = Sim.three.camera;
      const yaw = S.look.yaw;
      const back = 5.5;
      const tx = me[1] - Math.sin(yaw) * back, tz = me[2] - Math.cos(yaw) * back;
      cam.position.lerp(new THREE.Vector3(tx, 3.4 + S.look.pitch * 3, tz), Math.min(1, dt * 8));
      cam.lookAt(me[1] + Math.sin(yaw) * 6, 1.4 + S.look.pitch * 6, me[2] + Math.cos(yaw) * 6);
    }
    drawHud();
  }

  function drawHud() {
    if (!S.hud) return;
    const row = S.peerRow;
    const state = row ? (row[4] === 0 ? 'UP' : row[4] === 1 ? 'DOWN — wait for a revive' : 'DEAD') : '…';
    const ms = S.peerMission;
    S.hud.innerHTML = `<b>PLAYER ${S.myId}</b> · ${state}<br>WEAPON ${WEAPONS[S.weapon] || ''} · ENERGY ${row ? row[6] : 100}%<br>SCORE ${S.peerScore.toLocaleString()}${ms ? `<br>MISSION ${ms.id}: ${ms.value}/${ms.goal}` : ''}<br><small>WASD move · mouse look (click to lock) · click fire · wheel weapon · E teleport · F revive</small>`;
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

    // Peer input + host revive key; harmless when not in a session.
    const keyMap = /** @type {Record<string, 'up'|'down'|'left'|'right'>} */ ({ KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' });
    window.addEventListener('keydown', (e) => {
      if (S.role === 'peer' && S.peerReadyShown) {
        if (keyMap[e.code]) { S.keys[keyMap[e.code]] = true; e.preventDefault(); }
        if (e.code === 'KeyF') S.buttons.use = true;
        if (e.code === 'KeyQ') S.abil |= 1;
        if (e.code === 'KeyE') S.abil |= 2;
        if (e.code === 'KeyR') S.abil |= 4;
        if (e.code === 'Enter') S.buttons.fire = true;
      } else if (S.role === 'host' && e.code === 'KeyF') S.holdRevive = true;
    }, opts);
    window.addEventListener('keyup', (e) => {
      if (keyMap[e.code]) S.keys[keyMap[e.code]] = false;
      if (e.code === 'KeyF') { S.buttons.use = false; S.holdRevive = false; }
      if (e.code === 'KeyQ') S.abil &= ~1;
      if (e.code === 'KeyE') S.abil &= ~2;
      if (e.code === 'KeyR') S.abil &= ~4;
      if (e.code === 'Enter') S.buttons.fire = false;
    }, opts);
    window.addEventListener('blur', () => {
      S.keys.up = S.keys.down = S.keys.left = S.keys.right = false;
      S.buttons.fire = S.buttons.aim = S.buttons.use = false; S.abil = 0; S.holdRevive = false;
    }, opts);
    const canvas = Sim.three.renderer.domElement;
    canvas.addEventListener('mousedown', (e) => {
      if (S.role !== 'peer' || !S.peerReadyShown) return;
      if (document.pointerLockElement !== canvas) { try { canvas.requestPointerLock(); } catch { /* unavailable */ } return; }
      if (e.button === 0) S.buttons.fire = true;
      if (e.button === 2) S.buttons.aim = true;
    }, opts);
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) S.buttons.fire = false;
      if (e.button === 2) S.buttons.aim = false;
    }, opts);
    window.addEventListener('mousemove', (e) => {
      if (S.role !== 'peer' || document.pointerLockElement !== canvas) return;
      S.look.yaw -= e.movementX * HERO.lookSensitivity;
      S.look.pitch = THREE.MathUtils.clamp(S.look.pitch - e.movementY * HERO.lookSensitivity, -1, 1);
    }, opts);
    canvas.addEventListener('wheel', (e) => {
      if (S.role !== 'peer' || !S.peerReadyShown) return;
      S.weapon = (S.weapon + (e.deltaY > 0 ? 1 : -1) + WEAPONS.length) % WEAPONS.length;
    }, { signal: ctx.signal, passive: true });
    canvas.addEventListener('contextmenu', (e) => { if (S.role === 'peer') e.preventDefault(); }, opts);

    // Replicate the host's headline events (cosmetic ones stay local).
    ctx.events.on('announce', ({ title, sub }) => sendEvent('announce', { title: String(title).slice(0, 80), sub: String(sub).slice(0, 120) }));
    ctx.events.on('notice', ({ text }) => sendEvent('notice', { text: String(text).slice(0, 120) }));
    ctx.events.on('explosion', ({ x, z, size }) => sendEvent('explosion', { x: Math.round(x), z: Math.round(z), size: Math.round(size * 100) / 100 }));
    setStatus();
  }

  /** @param {number} rawDt */
  function updateNet(rawDt) {
    if (S.toastTimer > 0) {
      S.toastTimer -= rawDt;
      if (S.toastTimer <= 0 && S.toast) S.toast.classList.remove('visible');
    }
    if (!S.client) return;
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
  S.resetting = false;

  /** @returns {void} */
  function disposeNet() {
    endSession();
    if (S.panel && S.panel.parentNode) S.panel.parentNode.removeChild(S.panel);
    if (S.hud && S.hud.parentNode) S.hud.parentNode.removeChild(S.hud);
    if (S.toast && S.toast.parentNode) S.toast.parentNode.removeChild(S.toast);
    S.panel = S.hud = S.toast = S.status = null;
  }

  return {
    initNet, updateNet, resetNet, disposeNet,
    pickTarget, catchPlayer, interceptRogerDeath, coopActive,
    /** For tests and the HUD. */
    players, role: () => S.role, seed: () => S.seed
  };
}
