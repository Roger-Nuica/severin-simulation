// @ts-check
/**
 * ===========================================================================
 * Where a Terminator squad comes in
 * ===========================================================================
 * Pure (tests/terminator-spawn.test.mjs): the squad's spawn points round a
 * centre, one per bearing spread evenly round the circle (with a little
 * jitter in angle and distance), kept inside the town. Without Hero Mode the
 * centre is the middle of town and the circle its edge; in Hero Mode it is
 * Roger, a block or two out (terminator.js spawnTerminator), so each machine
 * comes at him from a different side and is on him in seconds.
 */

/**
 * @param {number} cx
 * @param {number} cz
 * @param {number} count
 * @param {number} radius metres from the centre
 * @param {number} bound the town's half-width: no point beyond ±bound
 * @param {() => number} rnd 0..1
 * @param {number} [jitter] 0..1: how far the angle (share of a slice) and the distance (share of the radius) may wander
 * @returns {{x: number, z: number}[]}
 */
export function squadSpawnPoints(cx, cz, count, radius, bound, rnd, jitter = 0.35) {
  const base = rnd() * Math.PI * 2;
  const slice = (Math.PI * 2) / count;
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = base + i * slice + (rnd() - 0.5) * slice * jitter;
    const r = radius * (1 + (rnd() - 0.5) * jitter);
    out.push({
      x: Math.max(-bound, Math.min(bound, cx + Math.cos(a) * r)),
      z: Math.max(-bound, Math.min(bound, cz + Math.sin(a) * r))
    });
  }
  return out;
}
