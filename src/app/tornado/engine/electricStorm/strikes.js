import * as THREE from 'three';
import { ELECTRIC } from './config.js';

/**
 * ===========================================================================
 * SECTION ES.1 — The funnel's lightning
 * ===========================================================================
 * The bolts' paths and forks, the four kinds of strike (sheath, filament,
 * crackle, crown), what they are aimed at and what a hit does.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see electricStorm.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createElectricStrikes(ctx, S, api) {
  /**
   * A jagged path between two points, by displacing the straight line and
   * tapering the displacement to nothing at both ends so the arc still starts
   * and finishes exactly where it was asked to.
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} to
   * @param {number} count
   * @param {number} jitter
   * @returns {THREE.Vector3[]}
   */
  function boltPath(from, to, count, jitter) {
    const points = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const p = new THREE.Vector3().lerpVectors(from, to, t);
      const taper = Math.sin(t * Math.PI);
      p.x += (Math.random() - 0.5) * jitter * taper;
      p.y += (Math.random() - 0.5) * jitter * taper;
      p.z += (Math.random() - 0.5) * jitter * taper;
      points.push(p);
    }
    return points;
  }

  /**
   * @param {THREE.Vector3[]} points
   * @param {number[]} lifeRange
   * @param {number} [gain]
   * @param {boolean} [fork] whether this arc may throw branches
   * @param {{halo?: boolean, hot?: number, width?: number}} [look]
   *   `halo`: whether this arc gets glow sprites along it. Only the hero
   *   bolts do. The halo exists to give a 1px line some thickness, and on the
   *   two dozen filaments inside the column it did the opposite -- a few
   *   hundred overlapping additive sprites in a volume that size stacked
   *   straight to white and turned the whole funnel into a blob.
   *   `hot`: 0..1, how far towards white-hot a fresh arc starts. A discharge
   *   is white; the current running inside the column is blue, and keeping
   *   that distinction is most of what makes the interior readable.
   *   `width`: ribbon width at the arc's origin (ELECTRIC.heroWidth if
   *   omitted).
   * @returns {void}
   */
  function addArc(points, lifeRange, gain = 1, fork = false, look = {}) {
    const width = look.width === undefined ? ELECTRIC.heroWidth : look.width;
    const life = api.between(lifeRange);
    // Each point gets one fixed random bearing at strike time; writeArcs()
    // slides it back and forth along that bearing for the arc's whole life.
    const offsets = points.map(() => new THREE.Vector3(
      Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5
    ).normalize());
    S.arcs.push({
      base: points,
      points: points.map(p => p.clone()),
      offsets,
      phase: Math.random() * Math.PI * 2,
      amp: ELECTRIC.writheAmp * (0.6 + Math.random() * 0.8),
      age: 0,
      life,
      maxLife: life,
      gain,
      halo: look.halo !== false,
      hot: look.hot === undefined ? 1 : look.hot,
      width
    });
    if (fork && Math.random() < ELECTRIC.forkChance) addForks(points, lifeRange, gain, width);
  }

  /**
   * Branches off a struck channel. Each leaves the parent somewhere along its
   * run, carries on roughly in the parent's direction with a wide deflection,
   * and is dimmer and shorter-lived than the channel it came off.
   * @param {THREE.Vector3[]} points the parent path
   * @param {number[]} lifeRange
   * @param {number} gain
   * @param {number} width the parent channel's width
   * @returns {void}
   */
  function addForks(points, lifeRange, gain, width) {
    const count = Math.round(api.between(ELECTRIC.forkCount));
    const spread = THREE.MathUtils.degToRad(ELECTRIC.forkSpread);
    for (let f = 0; f < count; f++) {
      const at = Math.floor(api.between(ELECTRIC.forkStart) * (points.length - 2));
      const from = points[at];
      // The parent's local heading at that point, deflected.
      S.scratchA.copy(points[Math.min(points.length - 1, at + 1)]).sub(from);
      const run = S.scratchA.length() * (points.length - 1 - at);
      if (run < 0.5) continue;
      S.scratchA.normalize();
      S.scratchB.set(
        S.scratchA.x + (Math.random() - 0.5) * spread * 2,
        S.scratchA.y + (Math.random() - 0.5) * spread,
        S.scratchA.z + (Math.random() - 0.5) * spread * 2
      ).normalize().multiplyScalar(run * api.between(ELECTRIC.forkLength));
      const to = from.clone().add(S.scratchB);
      // Forks die sooner than the channel, so the bolt reads as collapsing
      // back to its main path rather than fading as one lump.
      addArc(
        boltPath(from, to, ELECTRIC.forkPoints, ELECTRIC.forkJitter),
        [lifeRange[0] * 0.5, lifeRange[1] * 0.7],
        gain * ELECTRIC.forkGain,
        false,
        { width: width * ELECTRIC.forkWidth }
      );
    }
  }

  // ---------------------------------------------------------------------
  // The sheath
  // ---------------------------------------------------------------------

  /**
   * One arc crawling up the outside of a funnel, wound round it as a helix
   * whose radius at every step is the funnel's own radius at that height.
   * @param {Object} instance
   * @returns {void}
   */
  function strikeSheath(instance) {
    const shape = api.funnelShape(instance);
    const points = [];
    const turns = api.between(ELECTRIC.sheathTurns) * (Math.random() < 0.5 ? -1 : 1);
    const phase = Math.random() * Math.PI * 2;
    // Most sheath arcs run most of the column; some are short sparks over a
    // band of it, which is what stops the funnel looking like a barber pole.
    const from = Math.random() * 0.5;
    const to = Math.min(1, from + 0.5 + Math.random() * 0.5);
    for (let i = 0; i < ELECTRIC.sheathPoints; i++) {
      const t = i / (ELECTRIC.sheathPoints - 1);
      const h = THREE.MathUtils.lerp(from, to, t) * shape.height;
      const angle = phase + turns * Math.PI * 2 * t;
      const r = shape.radiusAt(h) * (1.02 + Math.random() * 0.06);
      points.push(new THREE.Vector3(
        shape.center.x + Math.cos(angle) * r + (Math.random() - 0.5) * ELECTRIC.sheathJitter,
        h + (Math.random() - 0.5) * ELECTRIC.sheathJitter,
        shape.center.z + Math.sin(angle) * r + (Math.random() - 0.5) * ELECTRIC.sheathJitter
      ));
    }
    addArc(points, ELECTRIC.sheathLife, 0.8, false, { halo: false, hot: 0.45, width: ELECTRIC.sheathWidth });
  }

  /**
   * A filament running up the *inside* of the funnel. Straighter and tighter
   * than the outer sheath, at a random fraction of the funnel's radius so
   * successive ones sit at different depths in the column.
   * @param {Object} instance
   * @returns {void}
   */
  function strikeFilament(instance) {
    const shape = api.funnelShape(instance);
    const points = [];
    const inset = api.between(ELECTRIC.filamentInset);
    const turns = api.between(ELECTRIC.filamentTurns) * (Math.random() < 0.5 ? -1 : 1);
    const phase = Math.random() * Math.PI * 2;
    const from = Math.random() * 0.35;
    const to = Math.min(1, from + 0.35 + Math.random() * 0.6);
    for (let i = 0; i < ELECTRIC.filamentPoints; i++) {
      const t = i / (ELECTRIC.filamentPoints - 1);
      const h = THREE.MathUtils.lerp(from, to, t) * shape.height;
      const angle = phase + turns * Math.PI * 2 * t;
      const r = shape.radiusAt(h) * inset;
      points.push(new THREE.Vector3(
        shape.center.x + Math.cos(angle) * r + (Math.random() - 0.5) * ELECTRIC.filamentJitter,
        h + (Math.random() - 0.5) * ELECTRIC.filamentJitter,
        shape.center.z + Math.sin(angle) * r + (Math.random() - 0.5) * ELECTRIC.filamentJitter
      ));
    }
    addArc(points, ELECTRIC.filamentLife, 0.95, false, { halo: false, hot: 0.2, width: ELECTRIC.filamentWidth });
  }

  /**
   * A short spark jumping between two nearby points on the funnel wall. These
   * are the small change of the effect: individually nothing, but forty a
   * second of them is what stops the column ever looking still.
   * @param {Object} instance
   * @returns {void}
   */
  function strikeCrackle(instance) {
    const shape = api.funnelShape(instance);
    const h = Math.random() * shape.height * 0.95;
    const angle = Math.random() * Math.PI * 2;
    const r = shape.radiusAt(h) * (0.6 + Math.random() * 0.5);
    S.scratchA.set(
      shape.center.x + Math.cos(angle) * r, h, shape.center.z + Math.sin(angle) * r
    );
    const span = api.between(ELECTRIC.crackleSpan);
    const a2 = angle + (Math.random() - 0.5) * 1.2;
    const h2 = THREE.MathUtils.clamp(h + (Math.random() - 0.5) * span, 0, shape.height);
    const r2 = shape.radiusAt(h2) * (0.6 + Math.random() * 0.5);
    S.scratchB.set(
      shape.center.x + Math.cos(a2) * r2, h2, shape.center.z + Math.sin(a2) * r2
    );
    addArc(boltPath(S.scratchA, S.scratchB, ELECTRIC.cracklePoints, 1.3), ELECTRIC.crackleLife, 1.1,
      false, { halo: false, hot: 0.35, width: ELECTRIC.crackleWidth });
  }

  /**
   * An arc off the top of the column into the cloud base above it.
   * @param {Object} instance
   * @returns {void}
   */
  function strikeCrown(instance) {
    const shape = api.funnelShape(instance);
    const angle = Math.random() * Math.PI * 2;
    const r = shape.radiusAt(shape.height);
    S.scratchA.set(
      shape.center.x + Math.cos(angle) * r, shape.height * (0.86 + Math.random() * 0.12),
      shape.center.z + Math.sin(angle) * r
    );
    const outAngle = angle + (Math.random() - 0.5) * 1.6;
    const reach = ELECTRIC.crownReach * (0.5 + Math.random());
    S.scratchB.set(
      S.scratchA.x + Math.cos(outAngle) * reach,
      shape.height + 6 + Math.random() * 22,
      S.scratchA.z + Math.sin(outAngle) * reach
    );
    addArc(boltPath(S.scratchA, S.scratchB, 12, 3.2), ELECTRIC.crownLife, 0.7, true);
  }

  // ---------------------------------------------------------------------
  // Ground strikes
  // ---------------------------------------------------------------------

  /**
   * Something worth hitting near a funnel. Returns the world point the arc
   * should land on and a closure applying the damage, so the strike code
   * below never branches on what it hit.
   * @param {THREE.Vector3} center
   * @returns {{point: THREE.Vector3, hit: () => void}|null}
   */
  function pickTarget(center) {
    const env = ctx.Environment;
    if (!env) return null;
    const range = ELECTRIC.strikeRange;
    const near = (p) => Math.hypot(p.x - center.x, p.z - center.z) < range;
    const roll = Math.random();

    if (roll < 0.55 && env.buildings) {
      const options = env.buildings.filter(
        b => b.damageState !== 'collapsed' && near(b.mesh.position)
      );
      const b = options[Math.floor(Math.random() * options.length)];
      if (b) {
        const top = (b.mesh.userData.wallHeight || 8) * 0.95;
        return {
          point: new THREE.Vector3(b.mesh.position.x, b.mesh.position.y + top, b.mesh.position.z),
          hit: () => hitBuilding(b, ELECTRIC.strikeShock, ELECTRIC.chainDepth)
        };
      }
    }

    // People, through the same provider registry the storm's own lightning
    // uses (strikeTargets.js), so a person killed by the electric tornado
    // dies exactly as one killed by a bolt does.
    if (roll < 0.78 && ctx.systems.strikeTargets) {
      for (const provider of ctx.systems.strikeTargets.providersByPriority('primary')) {
        const options = provider.candidates().filter(t => t.mesh && near(t.mesh.position));
        const target = options[Math.floor(Math.random() * options.length)];
        if (!target) continue;
        return {
          point: new THREE.Vector3(
            target.mesh.position.x, provider.strikeHeight, target.mesh.position.z
          ),
          hit: () => provider.onStruck(target)
        };
      }
    }

    if (roll < 0.92 && env.trees) {
      const options = env.trees.filter(t => t.damageState === 'intact' && near(t.mesh.position));
      const tree = options[Math.floor(Math.random() * options.length)];
      if (tree) {
        return {
          point: new THREE.Vector3(tree.mesh.position.x, tree.mesh.position.y + 7, tree.mesh.position.z),
          hit: () => {
            ctx.systems.buildingFire.igniteNear(tree.mesh.position.x, tree.mesh.position.z, 8);
            ctx.systems.explosions.spawnImpactBurst(tree.mesh.position.clone().setY(5), 0.8);
            ctx.systems.gamefeel.event('fire', tree.mesh.position);
          }
        };
      }
    }

    // Nothing in particular: bare ground, which still scorches and still
    // faults any line that happens to run over it.
    const a = Math.random() * Math.PI * 2;
    const d = 18 + Math.random() * (range - 18);
    const point = new THREE.Vector3(center.x + Math.cos(a) * d, 0.5, center.z + Math.sin(a) * d);
    return {
      point,
      hit: () => {
        ctx.systems.powerLines.faultAt(point.x, point.z, 14);
        ctx.systems.buildingFire.igniteNear(point.x, point.z, 9);
      }
    };
  }

  /**
   * A building taking a hit, and the current walking on from it: the nearest
   * standing neighbour is arced to and shocked in turn, down to `depth`. This
   * is the chain lightning -- deliberately the *nearest* neighbour each time
   * rather than all of them, so the current traces a path through the street
   * instead of flashing the whole grid at once.
   * @param {Object} building
   * @param {number} shock
   * @param {number} depth
   * @returns {void}
   */
  function hitBuilding(building, shock, depth) {
    const at = building.mesh.position;
    ctx.systems.damage.shockBuilding(building, shock, at);
    ctx.systems.buildingFire.igniteNear(at.x, at.z, ELECTRIC.strikeIgnite);
    ctx.systems.powerLines.faultAt(at.x, at.z, 16);
    if (depth <= 0 || Math.random() > ELECTRIC.chainChance) return;

    let best = null;
    let bestD = ELECTRIC.chainReach * ELECTRIC.chainReach;
    for (const other of ctx.Environment.buildings) {
      if (other === building || other.damageState === 'collapsed') continue;
      const d = other.mesh.position.distanceToSquared(at);
      if (d < bestD) { bestD = d; best = other; }
    }
    if (!best) return;

    const height = (building.mesh.userData.wallHeight || 8) * 0.9;
    const otherHeight = (best.mesh.userData.wallHeight || 8) * 0.9;
    S.scratchA.set(at.x, at.y + height, at.z);
    S.scratchB.set(best.mesh.position.x, best.mesh.position.y + otherHeight, best.mesh.position.z);
    // Before addArc: forking reuses the scratch vectors.
    ctx.systems.gamefeel.event('arc', S.scratchB);
    const landed = S.scratchB.clone();
    addArc(boltPath(S.scratchA, S.scratchB, 12, 2.6), ELECTRIC.strikeLife, 0.9, true);
    api.spawnSparks(landed);
    hitBuilding(best, shock * 0.8, depth - 1);
  }

  /**
   * One arc out of a funnel into the town.
   * @param {Object} instance
   * @returns {void}
   */
  function strikeGround(instance) {
    const shape = api.funnelShape(instance);
    const target = pickTarget(shape.center);
    if (!target) return;

    // Leaves the funnel wall on the bearing of the target, at a random
    // height, so the arc reads as coming *off* the column rather than out of
    // its middle.
    const bearing = Math.atan2(target.point.z - shape.center.z, target.point.x - shape.center.x);
    const h = shape.height * (0.15 + Math.random() * 0.6);
    S.scratchA.set(
      shape.center.x + Math.cos(bearing) * shape.radiusAt(h),
      h,
      shape.center.z + Math.sin(bearing) * shape.radiusAt(h)
    );
    addArc(boltPath(S.scratchA, target.point, ELECTRIC.strikePoints, ELECTRIC.strikeJitter),
      ELECTRIC.strikeLife, 1.5, true);
    api.spawnSparks(target.point);

    target.hit();
    ctx.systems.explosions.spawnImpactBurst(target.point.clone(), 0.9);
    // Only now and then, and softly: strikes land five times a second, and a
    // screen flash on every one held the whole view in a white-out.
    if (Math.random() < 0.2) ctx.systems.lightning.flashScreen(target.point, 0.18, ELECTRIC.flashTint);
    // Lights the funnel's own surface, through the flash the vortex already
    // owns for ordinary lightning.
    instance.onLightningStrike(target.point, 0.5);
    ctx.systems.gamefeel.event('arc', target.point);
    ctx.systems.damage.addDamageScore(ELECTRIC.strikeScore);
    S.state.charge = Math.min(1, S.state.charge + 0.35);
    // If that ground is under water, the flooded corridor is now the circuit
    // and the bolt's real effect is nowhere near where it landed
    // (engine/collisions.js).
    if (ctx.systems.collisions) ctx.systems.collisions.groundDischarge(target.point, 1);
  }

  /**
   * An arc laid flat across a surface rather than thrown at a target, for
   * engine/collisions.js to skitter current over standing water. Short-lived
   * and low-gain: there are several of them at once and they are meant to read
   * as the charge spreading, not as more strikes.
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} to
   * @returns {void}
   */
  function surfaceArc(from, to) {
    addArc(boltPath(from, to, 12, 1.6), ELECTRIC.strikeLife, 0.8, false, { width: ELECTRIC.sheathWidth });
  }

  return { boltPath, addArc, addForks, strikeSheath, strikeFilament, strikeCrackle, strikeCrown, pickTarget, hitBuilding, strikeGround, surfaceArc };
}
