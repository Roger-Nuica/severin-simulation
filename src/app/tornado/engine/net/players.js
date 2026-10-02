// @ts-check
/**
 * ===========================================================================
 * SECTION NPL — Co-op players: state, targeting, revive, seats, friendly fire
 * ===========================================================================
 * Pure rules for the players of a co-op run, kept off Sim so they are
 * testable. The host's own Roger and every guest are entries here keyed by
 * the room's player id ('0' = host). Per-player state (weapon, energy,
 * down/revive) lives on the entry, never shared.
 *
 * Approved rules (PLAN_coop.md):
 *   - A player taken out is *down*, not dead: revivable by a teammate who
 *     stays within REVIVE.range and holds the revive input for REVIVE.hold s.
 *     Moving out of range, being downed, or releasing interrupts it.
 *   - A downed player bleeds out after REVIVE.bleedOut seconds (dead).
 *   - Terminators hunt the nearest *up* player.
 *   - Game over in co-op when no player is up (all down or dead).
 *   - Friendly fire is ON (decision D4, PLAN_health-bar.md): a partner's
 *     weapons, the black hole and explosions can hurt the other player.
 *   - Cars have a driver seat (0) and one passenger seat (1).
 */

export const REVIVE = { range: 3, hold: 5, bleedOut: 30, shield: 2 };
export const FRIENDLY_FIRE = true;

/**
 * @typedef {Object} Player
 * @property {string} id
 * @property {number} x
 * @property {number} z
 * @property {number} heading
 * @property {'up'|'down'|'dead'} state
 * @property {number} downFor seconds spent down
 * @property {number} reviveProgress seconds the current reviver has held
 * @property {string|null} reviver id of who is reviving this player
 * @property {number} weapon index into the weapon wheel
 * @property {number} energy 0..100, per player
 * @property {number} shield seconds of invulnerability left (after a revive)
 * @property {{vehicle: number, seat: 0|1}|null} seat
 * @property {Object|null} input last accepted input
 * @property {boolean} wantsRevive revive input currently held
 */

export function createPlayerRegistry() {
  /** @type {Map<string, Player>} */
  const players = new Map();
  /** @type {Map<number, [string|null, string|null]>} vehicle id -> [driver, passenger] */
  const seats = new Map();

  /** @param {string} id @param {number} [x] @param {number} [z] @returns {Player} */
  function add(id, x = 0, z = 0) {
    const existing = players.get(id);
    if (existing) return existing;
    /** @type {Player} */
    const p = {
      id, x, z, heading: 0, state: 'up', downFor: 0, reviveProgress: 0, reviver: null,
      weapon: 0, energy: 100, shield: 0, seat: null, input: null, wantsRevive: false
    };
    players.set(id, p);
    return p;
  }

  /** @param {string} id */
  function remove(id) {
    const p = players.get(id);
    if (!p) return;
    leaveSeat(id);
    for (const q of players.values()) if (q.reviver === id) { q.reviver = null; q.reviveProgress = 0; }
    players.delete(id);
  }

  const get = (/** @type {string} */ id) => players.get(id) || null;
  const list = () => [...players.values()];
  const up = () => list().filter((p) => p.state === 'up');

  /**
   * Nearest player who is up (and, optionally, within `maxDist`).
   * @param {number} x @param {number} z @param {number} [maxDist]
   * @returns {Player|null}
   */
  function nearestEligible(x, z, maxDist = Infinity) {
    let best = null;
    let bestD = maxDist;
    for (const p of players.values()) {
      if (p.state !== 'up') continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d <= bestD) { best = p; bestD = d; }
    }
    return best;
  }

  /** @param {string} id @returns {boolean} whether the player went down */
  function down(id) {
    const p = players.get(id);
    if (!p || p.state !== 'up' || p.shield > 0) return false;
    p.state = 'down';
    p.downFor = 0;
    p.reviveProgress = 0;
    p.reviver = null;
    p.wantsRevive = false;
    // Anyone they were reviving is interrupted.
    for (const q of players.values()) if (q.reviver === id) { q.reviver = null; q.reviveProgress = 0; }
    leaveSeat(id);
    return true;
  }

  /**
   * Revive logic, once a frame. A downed player is revived by the nearest
   * *up* teammate in range holding the revive input.
   * @param {number} dt
   * @returns {{revived: string[], died: string[]}}
   */
  function update(dt) {
    /** @type {string[]} */ const revived = [];
    /** @type {string[]} */ const died = [];
    for (const p of players.values()) {
      if (p.shield > 0) p.shield = Math.max(0, p.shield - dt);
      if (p.state !== 'down') continue;
      p.downFor += dt;
      // Who, if anyone, is reviving: the nearest up teammate in range holding.
      let helper = null;
      let bestD = REVIVE.range;
      for (const q of players.values()) {
        if (q === p || q.state !== 'up' || !q.wantsRevive) continue;
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d <= bestD) { helper = q; bestD = d; }
      }
      if (!helper) {
        p.reviver = null;
        p.reviveProgress = 0;
      } else {
        // A different helper restarts the hold.
        if (p.reviver !== helper.id) { p.reviver = helper.id; p.reviveProgress = 0; }
        p.reviveProgress += dt;
        if (p.reviveProgress >= REVIVE.hold) {
          p.state = 'up';
          p.shield = REVIVE.shield;
          p.reviver = null;
          p.reviveProgress = 0;
          p.downFor = 0;
          revived.push(p.id);
          continue;
        }
      }
      if (p.downFor >= REVIVE.bleedOut) {
        p.state = 'dead';
        p.reviver = null;
        p.reviveProgress = 0;
        died.push(p.id);
      }
    }
    return { revived, died };
  }

  /** @returns {boolean} co-op game over: someone is registered and none is up */
  function gameOver() {
    const all = list();
    return all.length > 0 && !all.some((p) => p.state === 'up');
  }

  /**
   * Friendly fire policy: a player's hit lands on another *player* only if
   * FRIENDLY_FIRE is on (it is, since D4). Hits on anything else are not this module's call.
   * @param {string} attackerId @param {string} targetId
   * @returns {boolean}
   */
  function canDamagePlayer(attackerId, targetId) {
    if (attackerId === targetId) return false;
    return FRIENDLY_FIRE;
  }

  // ---- seats -------------------------------------------------------------

  /**
   * @param {string} id
   * @param {number} vehicle
   * @param {0|1} [want] preferred seat; defaults to driver, then passenger
   * @returns {{ok: true, seat: 0|1} | {ok: false, error: string}}
   */
  function enterSeat(id, vehicle, want) {
    const p = players.get(id);
    if (!p || p.state !== 'up') return { ok: false, error: 'not-up' };
    if (p.seat) return { ok: false, error: 'already-seated' };
    let s = seats.get(vehicle);
    if (!s) { s = [null, null]; seats.set(vehicle, s); }
    const order = want === undefined ? [0, 1] : [want];
    for (const idx of order) {
      if (s[idx] === null) {
        s[idx] = id;
        p.seat = { vehicle, seat: /** @type {0|1} */ (idx) };
        return { ok: true, seat: /** @type {0|1} */ (idx) };
      }
    }
    return { ok: false, error: 'occupied' };
  }

  /**
   * Leaves the seat. If the driver leaves, the passenger takes the wheel.
   * @param {string} id
   * @returns {{vehicle: number, handoff: string|null}|null}
   */
  function leaveSeat(id) {
    const p = players.get(id);
    if (!p || !p.seat) return null;
    const { vehicle, seat } = p.seat;
    const s = seats.get(vehicle);
    p.seat = null;
    if (!s) return { vehicle, handoff: null };
    s[seat] = null;
    let handoff = null;
    if (seat === 0 && s[1]) {
      handoff = s[1];
      s[0] = s[1];
      s[1] = null;
      const q = players.get(handoff);
      if (q) q.seat = { vehicle, seat: 0 };
    }
    if (s[0] === null && s[1] === null) seats.delete(vehicle);
    return { vehicle, handoff };
  }

  /** @param {number} vehicle @returns {[string|null, string|null]} */
  const occupants = (vehicle) => seats.get(vehicle) || [null, null];

  /**
   * What a player's input may control: the driver steers; the passenger only
   * aims and fires; a player on foot does both of their own.
   * @param {string} id
   * @returns {{move: boolean, aim: boolean, steer: boolean}}
   */
  function controls(id) {
    const p = players.get(id);
    if (!p || p.state !== 'up') return { move: false, aim: false, steer: false };
    if (!p.seat) return { move: true, aim: true, steer: false };
    return p.seat.seat === 0 ? { move: false, aim: false, steer: true } : { move: false, aim: true, steer: false };
  }

  function clear() { players.clear(); seats.clear(); }

  return { add, remove, get, list, up, nearestEligible, down, update, gameOver, canDamagePlayer, enterSeat, leaveSeat, occupants, controls, clear };
}
