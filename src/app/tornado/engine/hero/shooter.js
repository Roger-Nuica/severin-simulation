// @ts-check
/**
 * ===========================================================================
 * SECTION HS — The shooter (pure)
 * ===========================================================================
 * Who fired a shot, from where, and how the shot talks back to its owner.
 * The host's Roger and a co-op guest both resolve a shot through the same
 * weapon code (hero/plasma.js, heroWeapons.js); each passes a `Shooter` so
 * that code reads the shooter's eye, aim and feet instead of the camera and
 * Roger's mesh (DESIGN_coop_shared_shooter, Subtask C2).
 *
 * The host's own shooter is one reused object per weapon module, refilled at
 * the top of each shot with the camera's own vectors (no copy, no allocation),
 * so the single-player numbers and calls are exactly the ones they were.
 * Presentation (flash, shake, HUD, banners) belongs to the host's Roger only:
 * `tell` sends a message to the host's screen or, for a guest, to the guest's
 * notice. Scoring belongs to the shared scoring path; `credit` only echoes a
 * guest's points to the guest (and adds the points a guest has always had
 * that the shared path does not).
 *
 * No scene, no DOM: this file is testable on its own.
 */

/** What a guest is credited for bringing down an enemy of the shared register (the value net/system.js has always used). */
export const KILL_CREDIT = 20;

/**
 * @typedef {{x: number, y: number, z: number}} Vec3 A THREE.Vector3 on the host's side; any point in a test.
 */

/**
 * @typedef {Object} Shooter
 * @property {string} id the player id: '0' is the host's Roger
 * @property {boolean} isHost the host's Roger: the only shooter whose screen gets flash, shake, HUD and banners
 * @property {Vec3} eye where the ray starts (the camera on the host; the guest's eye, including its altitude)
 * @property {Vec3} dir unit vector the shooter aims along
 * @property {{x: number, z: number}} feet where the body stands (the railgun's minimum range, a hit's knock-back)
 * @property {number} alt height of the feet above the ground (0 for the host's Roger: `eye` already carries it)
 * @property {number} heading body yaw in radians (0 for the host's Roger)
 * @property {Vec3|null} muzzle where the shot is drawn from for other screens (null: the weapon's own)
 * @property {number} cd seconds of cooldown left (the guest's; the host's weapons keep their own timers)
 * @property {((text: string) => void)|null} notify a guest's message to that guest (null for the host: `flashMessage`)
 * @property {((points: number, counted: boolean) => void)|null} score a guest's credit (null for the host: nothing extra)
 */

/**
 * A shooter that has not aimed yet.
 * @param {string} id
 * @param {boolean} isHost
 * @returns {Shooter}
 */
export function createShooter(id, isHost) {
  return {
    id, isHost,
    eye: { x: 0, y: 0, z: 0 },
    dir: { x: 0, y: 0, z: 1 },
    feet: { x: 0, z: 0 },
    alt: 0, heading: 0, muzzle: null, cd: 0,
    notify: null, score: null
  };
}

/**
 * Points the shooter at a new shot. The vectors are kept by reference (the
 * host passes the camera's position and aim, nothing is copied).
 * @param {Shooter} shooter
 * @param {Vec3} eye
 * @param {Vec3} dir
 * @param {{x: number, z: number}} feet
 * @param {number} [alt]
 * @param {number} [heading]
 * @returns {Shooter} the same object
 */
export function aimShooter(shooter, eye, dir, feet, alt = 0, heading = 0) {
  shooter.eye = eye;
  shooter.dir = dir;
  shooter.feet = feet;
  shooter.alt = alt;
  shooter.heading = heading;
  return shooter;
}

/**
 * A message from a shot to its owner: the host's screen for the host's Roger
 * (`flash`, normally `flashMessage`), the guest's notice for a guest.
 * @param {Shooter} shooter
 * @param {string} text
 * @param {(text: string) => void} flash
 * @returns {void}
 */
export function tell(shooter, text, flash) {
  if (shooter.isHost) flash(text);
  else if (shooter.notify) shooter.notify(text);
}

/**
 * Credits points to a guest shooter (nothing for the host: its score is the
 * shared path's alone, so a host shot scores exactly as it always did).
 * @param {Shooter} shooter
 * @param {number} points
 * @param {boolean} counted the shared path already added the points to the score; only echo them
 * @returns {void}
 */
export function credit(shooter, points, counted) {
  if (shooter.score) shooter.score(points, counted);
}

/**
 * A point along the shooter's aim.
 * @param {Shooter} shooter
 * @param {number} t metres along `dir` from `eye`
 * @param {Vec3} out
 * @returns {Vec3} `out`
 */
export function pointAlong(shooter, t, out) {
  out.x = shooter.eye.x + shooter.dir.x * t;
  out.y = shooter.eye.y + shooter.dir.y * t;
  out.z = shooter.eye.z + shooter.dir.z * t;
  return out;
}

/**
 * The shooter's trace result held to the weapon's reach: a hit beyond it is no hit.
 * @param {{t: number, kind: string, obj: Object|null}} hit
 * @param {number} range metres
 * @returns {{t: number, kind: string, obj: Object|null}}
 */
export function withinRange(hit, range) {
  return hit.t > range ? { t: range, kind: 'sky', obj: null } : hit;
}

/**
 * Whether the railgun's point is too near the shooter's feet (the bolt would be its own).
 * @param {Shooter} shooter
 * @param {{x: number, z: number}} point
 * @param {number} minRange metres
 * @returns {boolean}
 */
export function tooClose(shooter, point, minRange) {
  return Math.hypot(point.x - shooter.feet.x, point.z - shooter.feet.z) < minRange;
}
