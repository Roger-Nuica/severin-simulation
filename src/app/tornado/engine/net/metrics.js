// @ts-check
/**
 * ===========================================================================
 * SECTION NM — Co-op network diagnostics (development only)
 * ===========================================================================
 * Pure, per-instance measuring helpers, shared by the net system (behind the
 * `?netdebug` page flag) and the relay (behind `RELAY_DEBUG=1`). Nothing here
 * touches the DOM, sockets or Sim, and nothing is created unless a flag asks
 * for it. All storage is preallocated typed arrays, so recording a sample
 * never allocates (R-048); only the once-a-second report builds strings.
 *
 * Times are in milliseconds from a caller-supplied clock. The two machines
 * share no clock, so only deltas taken on one machine are ever reported.
 */

/**
 * @typedef {{n: number, min: number, median: number, max: number}} Stats
 * @typedef {{push: (t: number, v: number) => void, stats: (now: number, windowMs: number, out: Stats) => Stats, clear: () => void}} WindowRing
 */

/** The page flag: `?netdebug` (or `?netdebug=1`); `?netdebug=0` and `=false` are off.
 * @param {string} search `location.search`, or an empty string outside a browser
 * @returns {boolean}
 */
export const isNetDebug = (search) => /(?:^|[?&])netdebug(?:=(?!0$|0&|false)[^&]*)?(?:&|$)/.test(String(search || ''));

/** @returns {Stats} */
export const newStats = () => ({ n: 0, min: 0, median: 0, max: 0 });

/**
 * A fixed-size ring of timestamped samples whose `stats` cover the last
 * `windowMs`. Oldest samples are overwritten once the ring is full.
 * @param {number} capacity
 * @returns {WindowRing}
 */
export function createWindowRing(capacity) {
  const times = new Float64Array(capacity);
  const values = new Float64Array(capacity);
  const scratch = new Float64Array(capacity);
  let head = 0;
  let count = 0;
  return {
    push(t, v) {
      times[head] = t;
      values[head] = v;
      head = (head + 1) % capacity;
      if (count < capacity) count++;
    },
    stats(now, windowMs, out) {
      let n = 0;
      for (let i = 0; i < count; i++) {
        if (now - times[i] <= windowMs) scratch[n++] = values[i];
      }
      out.n = n;
      if (n === 0) { out.min = out.median = out.max = 0; return out; }
      const view = scratch.subarray(0, n).sort();
      out.min = view[0];
      out.median = view[n >> 1];
      out.max = view[n - 1];
      return out;
    },
    clear() { head = 0; count = 0; }
  };
}

/**
 * Remembers when each input `seq` was sent, and measures the time until the
 * host's snapshot acknowledges it (the `ack` row). A seq is measured once;
 * a repeated or older ack is ignored.
 * @param {number} capacity must exceed the inputs in flight (30 Hz * RTT)
 * @returns {{sent: (seq: number, now: number) => void, acked: (seq: number, now: number) => number, clear: () => void}}
 */
export function createSendLog(capacity) {
  const seqs = new Float64Array(capacity).fill(-1);
  const times = new Float64Array(capacity);
  let lastAcked = -1;
  return {
    sent(seq, now) {
      const i = seq % capacity;
      seqs[i] = seq;
      times[i] = now;
    },
    /** @returns {number} the delay in ms, or -1 when unknown or already counted */
    acked(seq, now) {
      if (seq <= lastAcked) return -1;
      const i = seq % capacity;
      if (seqs[i] !== seq) return -1;
      lastAcked = seq;
      return now - times[i];
    },
    clear() { seqs.fill(-1); lastAcked = -1; }
  };
}

/**
 * Counts events by a small integer slot (no allocation per count).
 * @param {number} size
 * @returns {{add: (slot: number) => void, get: (slot: number) => number, clear: () => void}}
 */
export function createCounters(size) {
  const a = new Int32Array(size);
  return {
    add(slot) { if (slot >= 0 && slot < size) a[slot]++; },
    get: (slot) => (slot >= 0 && slot < size ? a[slot] : 0),
    clear() { a.fill(0); }
  };
}

/**
 * Counts events by a short string reason. Allocates only for a reason seen
 * for the first time.
 * @returns {{add: (reason: string) => void, last: () => string, entries: () => [string, number][], clear: () => void}}
 */
export function createReasonCounts() {
  /** @type {Map<string, number>} */
  const m = new Map();
  let last = '';
  return {
    add(reason) { m.set(reason, (m.get(reason) || 0) + 1); last = reason; },
    last: () => last,
    entries: () => [...m],
    clear() { m.clear(); last = ''; }
  };
}

/** @param {Stats} s @param {number} [digits] @returns {string} */
export const formatStats = (s, digits = 0) => (s.n === 0
  ? 'no samples'
  : `min ${s.min.toFixed(digits)} / med ${s.median.toFixed(digits)} / max ${s.max.toFixed(digits)} (n=${s.n})`);

/** Seconds the report windows cover. */
export const WINDOW_MS = 5000;

/**
 * Peer and host measurements for the overlay. One instance per net system.
 * @param {{weapons: number}} opts how many wheel weapons `guestFire` can see
 */
export function createNetMetrics(opts) {
  const W = opts.weapons;
  const rtt = createWindowRing(512);
  const sendLog = createSendLog(256);
  const snapGap = createWindowRing(256);
  const snapStale = createWindowRing(1024);
  const hostFrame = createWindowRing(1024);
  const snapSend = createWindowRing(256);
  const inputGap = createWindowRing(512);
  const relayRtt = createWindowRing(32);
  /** Per weapon: calls, cooldown skips, ray found a target, `enemies.hit` true. */
  const fire = createCounters(W * 4);
  /** Fire presses: [never reached `guestFire` (host not in Hero Mode), blocked by `players.controls` (down or driving), `guestFire` ran with the weapon not raised]. */
  const unfired = createCounters(3);
  const rejects = createReasonCounts();
  const tmp = newStats();
  let lastSnapAt = 0;
  let lastFrameAt = 0;
  let lastSendAt = 0;
  let lastInputAt = 0;
  let pingId = 0;
  let pingAt = 0;
  let pongs = 0;
  let acksSeen = 0;

  return {
    /** @param {number} seq @param {number} now */
    inputSent(seq, now) { sendLog.sent(seq, now); },
    /** A snapshot reached the peer. @param {number} now @param {number} ackSeq this peer's `ack` seq, or -1 */
    snapshotArrived(now, ackSeq) {
      if (lastSnapAt > 0) snapGap.push(now, now - lastSnapAt);
      lastSnapAt = now;
      if (ackSeq >= 0) {
        const d = sendLog.acked(ackSeq, now);
        if (d >= 0) { rtt.push(now, d); acksSeen++; }
      }
    },
    /** The peer drew a frame: how stale its newest snapshot was. @param {number} now */
    peerFrame(now) { if (lastSnapAt > 0) snapStale.push(now, now - lastSnapAt); },
    /** The host ran a frame (real time between frames, not the clamped delta). @param {number} now */
    hostFrameAt(now) {
      if (lastFrameAt > 0) hostFrame.push(now, now - lastFrameAt);
      lastFrameAt = now;
    },
    /** @param {number} now */
    snapshotSent(now) {
      if (lastSendAt > 0) snapSend.push(now, now - lastSendAt);
      lastSendAt = now;
    },
    /** An input passed the gate on the host. @param {number} now */
    inputAccepted(now) {
      if (lastInputAt > 0) inputGap.push(now, now - lastInputAt);
      lastInputAt = now;
    },
    /** @param {string} reason */
    reject(reason) { rejects.add(reason); },
    /** @param {number} weapon @param {0|1|2|3} slot 0 call, 1 cooldown skip, 2 target in ray, 3 hit accepted */
    fire(weapon, slot) { fire.add(weapon * 4 + slot); },
    /** @param {0|1|2} why 0 host not in Hero Mode, 1 controls blocked fire, 2 fired without `aim` */
    unfired(why) { unfired.add(why); },
    /**
     * The next relay ping id, or 0 when the relay has not answered the last
     * three (it is not running with `RELAY_DEBUG=1`), so the peer stops asking.
     * @param {number} now
     * @returns {number}
     */
    nextPing(now) {
      if (pingId - pongs >= 3) return 0;
      pingAt = now;
      return ++pingId;
    },
    /** @param {number} id @param {number} now */
    pong(id, now) {
      if (id !== pingId) return;
      pongs = pingId;
      relayRtt.push(now, now - pingAt);
    },
    /** @param {number} now @returns {string[]} one line each, for the overlay and the console */
    report(now) {
      const lines = [];
      lines.push(`ack delay (input to snapshot ack) ms: ${formatStats(rtt.stats(now, WINDOW_MS, tmp))}`);
      lines.push(`relay ping RTT ms: ${pingId - pongs >= 3 ? 'relay not answering (RELAY_DEBUG off?)' : formatStats(relayRtt.stats(now, WINDOW_MS, tmp))}`);
      lines.push(`snapshot interarrival ms: ${formatStats(snapGap.stats(now, WINDOW_MS, tmp))}`);
      lines.push(`newest snapshot age per frame ms: ${formatStats(snapStale.stats(now, WINDOW_MS, tmp))}`);
      lines.push(`host frame ms: ${formatStats(hostFrame.stats(now, WINDOW_MS, tmp))}`);
      lines.push(`snapshot send interval ms: ${formatStats(snapSend.stats(now, WINDOW_MS, tmp))}`);
      lines.push(`input interarrival at host ms: ${formatStats(inputGap.stats(now, WINDOW_MS, tmp))}`);
      lines.push(`acks matched ${acksSeen}; pings ${pingId}, pongs ${pongs}`);
      const rej = rejects.entries();
      lines.push(`gate rejects: ${rej.length ? rej.map(([k, v]) => `${k}=${v}`).join(' ') : 'none'} (last: ${rejects.last() || '-'})`);
      let f = '';
      for (let w = 0; w < W; w++) {
        if (fire.get(w * 4) + fire.get(w * 4 + 1) === 0) continue;
        f += ` [w${w}: call ${fire.get(w * 4)} cd ${fire.get(w * 4 + 1)} ray ${fire.get(w * 4 + 2)} hit ${fire.get(w * 4 + 3)}]`;
      }
      lines.push(`guestFire:${f || ' none'}; fire held but not run: no-hero ${unfired.get(0)}, blocked ${unfired.get(1)}; fired with weapon not raised ${unfired.get(2)}`);
      return lines;
    },
    /** A session ended: forget everything measured. */
    reset() {
      rtt.clear(); sendLog.clear(); snapGap.clear(); snapStale.clear(); hostFrame.clear();
      snapSend.clear(); inputGap.clear(); relayRtt.clear(); fire.clear(); unfired.clear(); rejects.clear();
      lastSnapAt = lastFrameAt = lastSendAt = lastInputAt = 0;
      pingId = pingAt = pongs = acksSeen = 0;
    }
  };
}
