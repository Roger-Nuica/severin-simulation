// @ts-check
/**
 * ===========================================================================
 * SECTION X.2 — Setting things off
 * ===========================================================================
 * The town's explosives go off by themselves on their own fuses (the tanker
 * at 20 s, the chemical works at 40 s) or when a funnel reaches them, and
 * the gas mains open wherever something tears a street. Before this, the
 * other catastrophes passed them by: the mothership's beam carved straight
 * through the ring road and the chemical works' yard and nothing went off.
 * On request, everything that blows up can now be set off by anything
 * violent enough, storm or no storm.
 *
 * One entry point, setOffExplosivesAt, for "something that hot or that
 * heavy has just happened here". It is called by the mothership's beam and
 * its crash (mothership.js), a crashing alien ship (aliens.js), a meteor
 * (meteors.js), a lightning bolt (strikeTargeting.js, the Lightning tile and
 * Roger's railgun), a mega beam (heroMode.js), and the tanker and the
 * chemical works themselves, so one sets the other off when the blast
 * reaches it. It sets off:
 *  - the fuel tankers (environment/tanker.js: the one driving the ring and
 *    the four parked out towards the edges), any inside;
 *  - the chemical works' chain (environment/factory.js ignite), if its site
 *    is;
 *  - the gas mains under the streets (gasMains.js ruptureAt, lit);
 *  - the power lines (powerLines.js faultAt);
 *  - the fuel stations (fuelFire.js igniteAt): alight at once, and up a
 *    moment later.
 * Each of those does nothing a second time, so it is safe to call every
 * frame a beam is burning.
 *
 * hitRogerAt is the other half: whoever blows up with a fireball of its own
 * (tanker, fuel station, gas main, chemical works) kills Roger inside the
 * radius that owner already uses for its fireball, through the one health
 * path (heroMode.hitArea -> health.damagePlayer, instant kill, R-035).
 *
 * A pure function of ctx: no state of its own.
 */

/**
 * @param {Object} ctx
 * @param {number} x
 * @param {number} z
 * @param {number} radius how far out from (x, z) things go off
 * @returns {void}
 */
export function setOffExplosivesAt(ctx, x, z, radius) {
  const s = ctx.systems;
  if (s.tanker) {
    for (const tanker of s.tanker.allTankers()) {
      if (Math.hypot(tanker.x - x, tanker.z - z) < radius + 5) tanker.detonate();
    }
  }
  const works = s.factory && s.factory.site ? s.factory.site() : null;
  if (works && Math.hypot(works.x - x, works.z - z) < radius + works.radius) s.factory.ignite();
  if (s.gasMains) s.gasMains.ruptureAt(x, z, radius, { ignite: true });
  if (s.powerLines) s.powerLines.faultAt(x, z, radius);
  if (s.fuelFire) s.fuelFire.igniteAt(x, z, radius);
}

/**
 * Roger caught inside a fireball: an instant kill through the health API
 * with the "Caught in the blast" card. A no-op outside Hero Mode, and while
 * he is already dying, so a blast and its secondaries cost him one death.
 * @param {Object} ctx
 * @param {number} x
 * @param {number} z
 * @param {number} radius the owner's own fireball radius
 * @returns {void}
 */
export function hitRogerAt(ctx, x, z, radius) {
  const hero = ctx.systems.heroMode;
  if (hero) hero.hitArea(x, z, radius, 'BLOWN UP', 'Caught in the blast', 'explosion');
}
