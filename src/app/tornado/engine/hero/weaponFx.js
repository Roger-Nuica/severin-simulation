// @ts-check
/**
 * ===========================================================================
 * SECTION HF — Weapon announcements for the co-op guest
 * ===========================================================================
 * A weapon calls `announce` as the last statement of a shot, after its own
 * logic, so the host can show the shot to the guest (net/system.js turns the
 * `weaponFx` event into an `fx` row; R-061). Nothing is built or emitted
 * unless the net system says a guest is in the room, so a single-player shot
 * costs one property read and one call. The payload is one reused object per
 * emitter (a listener copies what it keeps), so a round allocates nothing here.
 */

/**
 * @param {any} ctx
 * @returns {{announce: (kind: string, from: {x: number, y: number, z: number}, to: {x: number, y: number, z: number}, hit: string, extra?: number) => void}}
 */
export function createWeaponFx(ctx) {
  const payload = { shooter: '0', kind: '', from: /** @type {any} */ (null), to: /** @type {any} */ (null), hit: '', extra: 0 };
  return {
    /**
     * Announces one shot of the host's own Roger.
     * @param {string} kind one of protocol.js FX_KINDS
     * @param {{x: number, y: number, z: number}} from where it started
     * @param {{x: number, y: number, z: number}} to where it ended
     * @param {string} hit the `traceAim` kind it ended on ('' when none)
     * @param {number} [extra] a small whole number for the kind
     * @returns {void}
     */
    announce(kind, from, to, hit, extra = 0) {
      const net = ctx.systems.net;
      if (!net || !net.fxLive()) return;
      payload.shooter = '0';
      payload.kind = kind;
      payload.from = from;
      payload.to = to;
      payload.hit = hit;
      payload.extra = extra;
      ctx.events.emit('weaponFx', payload);
    }
  };
}
