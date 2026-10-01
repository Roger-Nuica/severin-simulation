import * as THREE from 'three';
import { ROAD_COLOUR } from '../roadsDecor.js';
import { VIADUCT_Z, DECK_Y, DECK, PILLAR, STRUCTURE, SHADOW, SCORE } from './config.js';
/** @typedef {import('./config.js').Pillar} Pillar */
/** @typedef {import('./config.js').Segment} Segment */

/**
 * ===========================================================================
 * SECTION VD.1 — The structure
 * ===========================================================================
 * Pillars and deck spans, what can hit them, a pillar breaking, a span
 * sagging, dropping and landing.
 */

/**
 * @param {Object} ctx
 * @param {Object} S the shared state (see viaduct.js)
 * @param {Object} api every module's functions, by name
 * @returns {Object}
 */
export function createViaductStructure(ctx, S, api) {
  const { Sim, nextObjectId } = ctx;

  /**
   * @param {number} x
   * @param {number} [height] ground to the slab's centre: the deck's, or a
   *   ramp's half-way pillar
   * @returns {Pillar}
   */
  function createPillar(x, height = DECK_Y) {
    const geo = new THREE.CylinderGeometry(PILLAR.radiusTop, PILLAR.radiusBase, height, 8);
    geo.translate(0, height / 2, 0);
    const mat = new THREE.MeshStandardMaterial({ color: PILLAR.colour, roughness: 0.95 });
    S.materials.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0, VIADUCT_Z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `viaduct_pillar_${x.toFixed(0)}`;
    S.group.add(mesh);
    return { mesh, x, height, integrity: 1, down: false };
  }

  /**
   * Where a ramp meets the ground: a support that never fails (nothing to
   * break), so a ramp whose upper pillar goes hinges on it.
   * @param {number} x
   * @returns {Pillar}
   */
  function createAbutment(x) {
    return { mesh: null, x, height: 0, integrity: Infinity, down: false };
  }

  /**
   * One span plus its two guard rails, as a group so the rails go wherever
   * the slab goes: a level stretch of deck, or a ramp sloping from (x0, y0)
   * to (x1, y1) (the slab's centre line).
   * @param {number} index along the road, west to east
   * @param {number} x0
   * @param {number} y0
   * @param {number} x1
   * @param {number} y1
   * @param {Pillar} left
   * @param {Pillar} right
   * @returns {Segment}
   */
  function createSegment(index, x0, y0, x1, y1, left, right) {
    const centreX = (x0 + x1) / 2;
    const span = x1 - x0;
    const baseY = (y0 + y1) / 2;
    const tilt = Math.atan2(y1 - y0, span);
    // Along the slope, so a ramp's slab reaches both of its ends.
    const length = Math.hypot(span, y1 - y0);
    const slabMat = new THREE.MeshStandardMaterial({ color: ROAD_COLOUR, roughness: 1 });
    const railMat = new THREE.MeshStandardMaterial({ color: PILLAR.colour, roughness: 0.9 });
    S.materials.push(slabMat, railMat);

    const deckGroup = new THREE.Group();
    deckGroup.name = `viaduct_segment_${index}`;
    deckGroup.position.set(centreX, baseY, VIADUCT_Z);
    deckGroup.rotation.z = tilt;

    // Butted end to end with no gap, so the separate spans read as one road.
    const slab = new THREE.Mesh(new THREE.BoxGeometry(length, DECK.thickness, DECK.width), slabMat);
    slab.castShadow = true;
    slab.receiveShadow = true;
    deckGroup.add(slab);

    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(length, DECK.railHeight, DECK.railThickness), railMat
      );
      rail.position.set(0, DECK.thickness / 2 + DECK.railHeight / 2, side * (DECK.width / 2 - DECK.railThickness / 2));
      rail.castShadow = true;
      deckGroup.add(rail);
    }

    S.group.add(deckGroup);
    return {
      group: deckGroup, index, centreX, span, tilt, baseY, length, left, right,
      integrity: 1, state: 'intact', sagTimer: 0, shudder: 0, hinge: 0, body: null,
      hazard: null, landed: false, fallTimer: 0
    };
  }

  /**
   * The structure's pieces, in the shape engine/debrisImpacts.js expects of a
   * swept-sphere target: something with a `.mesh.position`. Standing pieces
   * only -- a snapped pillar or a fallen span is already debris.
   * @returns {Object[]}
   */
  function impactTargets() {
    /** @type {Object[]} */
    const out = [];
    for (const pillar of S.pillars) {
      // A pillar occupies the whole column from the ground to the deck, so
      // anything below the deck can strike it.
      if (!pillar.down) {
        out.push({ type: 'viaduct', viaductPart: pillar, mesh: pillar.mesh, hitY: [0, pillar.height] });
      }
    }
    for (const segment of S.segments) {
      // The deck is a thin slab: only debris at road height hits it, which is
      // what stops a piece thrown over the top from registering.
      if (segment.state !== 'fallen') {
        // A ramp's slab spans its whole rise.
        const rise = Math.abs(Math.tan(segment.tilt)) * segment.span / 2;
        out.push({
          type: 'viaduct', viaductPart: segment, mesh: segment.group,
          hitY: [segment.baseY - rise - 1.5, segment.baseY + rise + DECK.railHeight + 1.5]
        });
      }
    }
    return out;
  }

  /**
   * Applies a debris hit to a pillar or a deck span, called from damage.js's
   * damageFromImpact so structure hits go through the same route as every
   * other impact in the simulation.
   * @param {Object} target an entry from impactTargets()
   * @param {number} energy
   * @returns {boolean} whether the debris should be stopped
   */
  function damageStructure(target, energy) {
    const part = target.viaductPart;
    if (!part) return false;
    const loss = Math.min(STRUCTURE.impactMax, energy / STRUCTURE.impactReference);
    part.integrity -= loss;
    ctx.systems.explosions.spawnImpactBurst(target.mesh.position.clone(), 0.9);
    return true;
  }

  /**
   * A fissure opening under a pillar takes its footing away outright -- there
   * is nothing for it to stand on any more. Under a ramp's foot it takes the
   * ramp's footing too.
   * @param {number} x
   * @param {number} z
   * @param {number} radius
   * @returns {boolean} whether a pillar was undermined
   */
  function fissureUnder(x, z, radius) {
    let hit = false;
    for (const pillar of S.pillars) {
      if (pillar.down) continue;
      if (Math.hypot(pillar.x - x, VIADUCT_Z - z) > radius + PILLAR.radiusBase) continue;
      pillar.integrity = 0;
      hit = true;
    }
    for (const segment of S.segments) {
      if (segment.state !== 'intact' || segment.tilt === 0) continue;
      if (Math.abs(segment.centreX - x) > segment.span / 2 + radius || Math.abs(VIADUCT_Z - z) > radius + DECK.width / 2) continue;
      segment.integrity = 0;
      hit = true;
    }
    return hit;
  }

  /**
   * Snaps a pillar: the stump stays standing, the top half becomes a free
   * physical object and topples away.
   * @param {Pillar} pillar
   * @returns {void}
   */
  function breakPillar(pillar) {
    pillar.down = true;
    const snap = PILLAR.snapAt[0] + Math.random() * (PILLAR.snapAt[1] - PILLAR.snapAt[0]);
    const stumpHeight = pillar.height * snap;
    // The standing mesh is scaled down to the stump rather than rebuilt: the
    // geometry is a cylinder from y=0 up, so scaling Y is exactly a shorter
    // pillar.
    pillar.mesh.scale.y = snap;

    const topHeight = pillar.height - stumpHeight;
    const geo = new THREE.CylinderGeometry(PILLAR.radiusTop, PILLAR.radiusTop * 1.2, topHeight, 8);
    const mat = new THREE.MeshStandardMaterial({ color: PILLAR.colour, roughness: 0.95 });
    S.materials.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pillar.x, stumpHeight + topHeight / 2, VIADUCT_Z);
    mesh.castShadow = true;
    S.group.add(mesh);

    const away = Math.random() < 0.5 ? 1 : -1;
    /** @type {SimObject} */
    const obj = {
      id: nextObjectId.value++,
      type: 'viaductDebris',
      mesh,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 3, 0, away * (2 + Math.random() * 3)),
      angularVelocity: new THREE.Vector3(away * (1 + Math.random()), 0, (Math.random() - 0.5) * 2),
      mass: 40,
      drag: 0.5,
      rooted: false,
      damageState: 'intact',
      breakThreshold: Infinity,
      // Heavy and unaerodynamic: the storm can shove it about but only a
      // monster is lifting it.
      liftEligible: 0.12,
      pooled: false,
      poolIndex: -1,
      lifeTimer: 0,
      captureState: 'grounded'
    };
    Sim.objects.push(obj);

    ctx.systems.gamefeel.event('pillar', mesh.position);
    ctx.systems.damage.addDamageScore(SCORE.pillar);
    ctx.systems.explosions.spawnImpactBurst(mesh.position.clone(), 1.3);

    // The spans either side lose a support, and take a knock for it.
    for (const segment of S.segments) {
      if (segment.state === 'fallen') continue;
      if (segment.left !== pillar && segment.right !== pillar) continue;
      segment.integrity -= STRUCTURE.pillarLossToDeck;
    }
  }

  /**
   * Starts a span sagging. It hinges on whichever end still has a pillar; if
   * both supports are gone it simply drops.
   * @param {Segment} segment
   * @returns {void}
   */
  function beginSag(segment) {
    segment.state = 'sagging';
    segment.sagTimer = 0;
    const leftUp = !segment.left.down;
    const rightUp = !segment.right.down;
    segment.hinge = leftUp && !rightUp ? -1 : (!leftUp && rightUp ? 1 : 0);
    // Neighbours feel it go.
    for (const other of S.segments) {
      if (other === segment || other.state !== 'intact') continue;
      if (Math.abs(other.index - segment.index) === 1) other.shudder = DECK.shudderSeconds;
    }
    // The ground underneath becomes somewhere not to be, and anyone standing
    // there gets the length of the sag to clear it (engine/hazards.js).
    segment.hazard = ctx.systems.hazards.addHazard({
      x: segment.centreX,
      z: VIADUCT_Z,
      // The span's own footprint plus a margin, and not a circle: the slab is
      // 37 long and 9 wide, so a circle round it would have people forty
      // units away in open ground running from a deck that was never going
      // to reach them.
      radius: segment.span * 0.5 + SHADOW.margin,
      radiusZ: DECK.width * 0.5 + SHADOW.margin,
      kind: 'viaductShadow'
    });
  }

  /**
   * The span lets go: it stops being scenery this module poses and becomes a
   * falling object physics owns, which can land on whatever is underneath.
   * @param {Segment} segment
   * @returns {void}
   */
  function dropSegment(segment) {
    segment.state = 'fallen';
    /** @type {SimObject} */
    const obj = {
      id: nextObjectId.value++,
      type: 'viaductDebris',
      mesh: segment.group,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 2, -1, (Math.random() - 0.5) * 2),
      angularVelocity: new THREE.Vector3(
        (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.4, segment.hinge * 0.6
      ),
      mass: 120,
      drag: 0.4,
      rooted: false,
      damageState: 'intact',
      breakThreshold: Infinity,
      liftEligible: 0.08,
      pooled: false,
      poolIndex: -1,
      lifeTimer: 0,
      captureState: 'grounded'
    };
    segment.body = obj;
    segment.landed = false;
    segment.fallTimer = 0;
    Sim.objects.push(obj);

    ctx.systems.gamefeel.event('deck', segment.group.position);
    ctx.systems.damage.addDamageScore(SCORE.deck);
    ctx.systems.explosions.spawnImpactBurst(segment.group.position.clone(), 1.8);
  }

  /**
   * The span hits the ground. Split out of dropSegment because the two are
   * seconds apart: a hundred-odd tonnes of deck letting go is one beat and it
   * arriving is another, and everything that is about *weight* -- the dust,
   * the shock into the buildings around it -- belongs to the second one.
   * @param {Segment} segment
   * @returns {void}
   */
  function landSegment(segment) {
    segment.landed = true;
    const at = segment.group.position;

    // Dust, from the earthquake's pool (engine/earthquake.js). Reused rather
    // than grown here: a slab landing throws up exactly the same cloud the
    // quake does, and two pools that looked subtly different would be worse
    // than one that looks right twice.
    ctx.systems.earthquake.kickDust(at.x, at.z, 7, 2.4);
    ctx.systems.explosions.spawnImpactBurst(new THREE.Vector3(at.x, 1, at.z), 1.4);
    ctx.systems.gamefeel.event('deck', at);

    // Whatever is under it takes the span's weight. Reuses the chain-collapse
    // shock so a building below is brought down by the same rules a
    // neighbouring collapse would use.
    const { shockBuilding } = ctx.systems.damage;
    if (shockBuilding && ctx.Environment) {
      for (const building of ctx.Environment.buildings) {
        const p = building.mesh.position;
        if (Math.hypot(p.x - at.x, p.z - at.z) > segment.span * 0.6) continue;
        shockBuilding(building, 1.6, new THREE.Vector3(at.x, 0, at.z));
      }
    }

    // The shadow zone outlives the landing by a moment, so the crowd finishes
    // clearing the rubble rather than turning straight back into it.
    if (segment.hazard) {
      segment.hazard.x = at.x;
      segment.hazard.z = at.z;
    }
    // Restarted from the landing, which is what SHADOW.lingerSeconds is
    // measured from -- not from the moment it let go.
    segment.fallTimer = 0;
  }

  /**
   * Which span, if any, a point along the deck sits on.
   * @param {number} x
   * @returns {Segment|null}
   */
  function segmentAt(x) {
    return S.segments.find(s => Math.abs(x - s.centreX) <= s.span / 2) || null;
  }

  /**
   * The road surface's height over x on whatever span is there, as it
   * stands now: level, sloping, sagging or shuddering (its slab rotates
   * about its centre).
   * @param {Segment} segment
   * @param {number} x
   * @returns {number}
   */
  function surfaceAt(segment, x) {
    const g = segment.group;
    return g.position.y + Math.tan(g.rotation.z) * (x - g.position.x) + DECK.thickness / 2;
  }

  /**
   * A sagging span, turned through `angle` about the end that still has a
   * support (the free end swinging down), or dropping level with both gone
   * -- never through the ground: a ramp's lower span, already near it, only
   * comes down until its free end touches.
   * @param {Segment} segment
   * @param {number} angle radians, signed as the hinge (see beginSag)
   * @returns {void}
   */
  function poseSag(segment, angle) {
    const g = segment.group;
    const half = segment.length / 2;
    const floor = 0.2;
    if (!segment.hinge) {
      const rise = Math.abs(Math.sin(segment.tilt + angle)) * half;
      g.rotation.z = segment.tilt + angle;
      g.position.y = Math.max(floor + rise, segment.baseY - Math.abs(Math.sin(angle)) * segment.span * 0.5);
      return;
    }
    // The hinge: the span's end on its surviving support.
    const side = segment.hinge;            // -1: the west end holds; 1: the east end
    const hx = segment.centreX + side * Math.cos(segment.tilt) * half;
    const hy = segment.baseY + side * Math.sin(segment.tilt) * half;
    let phi = segment.tilt + angle;
    // The free end, 2 * half from the hinge the other way: kept above ground.
    const freeY = (/** @type {number} */ a) => hy - side * Math.sin(a) * segment.length;
    if (freeY(phi) < floor) {
      const lim = Math.asin(THREE.MathUtils.clamp((hy - floor) / segment.length, -1, 1));
      phi = side < 0 ? -lim : lim;
    }
    g.rotation.z = phi;
    g.position.x = hx - side * Math.cos(phi) * half;
    g.position.y = hy - side * Math.sin(phi) * half;
  }

  /**
   * Drains integrity on anything a tornado is currently standing over, and
   * breaks whatever has run out.
   * @param {number} dt
   * @returns {void}
   */
  function updateStructure(dt) {
    const p = Sim.params;
    const drain = STRUCTURE.tornadoDrain * (0.4 + p.intensity) * dt;

    for (const pillar of S.pillars) {
      if (pillar.down) continue;
      const vortex = ctx.tornadoes.nearest(pillar.x, VIADUCT_Z);
      // Scaled by birth (vortex.js BIRTH) like the capture radii in
      // physics.js: before Start there is no funnel, only where it will come
      // down, and this now runs before Start (tornadoEngine.js) -- without
      // it the span the unborn funnel was parked beside wore away and fell
      // with nothing in sight.
      const edge = p.radius * ctx.systems.physics.CAPTURE_TUNE.edgeRadiusFactor * vortex.sizeMul * vortex.birth;
      if (Math.hypot(pillar.x - vortex.center.x, VIADUCT_Z - vortex.center.z) < edge) {
        pillar.integrity -= drain;
      }
      if (pillar.integrity <= 0) breakPillar(pillar);
    }

    for (const segment of S.segments) {
      if (segment.state === 'fallen') {
        segment.fallTimer += dt;
        // Landed when physics has brought it down to about ground level, or
        // when enough time has passed that it must have -- a span that has
        // been caught by a tornado on the way down may never touch at all,
        // and the dust should not be waiting on it for the rest of the run.
        if (!segment.landed
          && (segment.group.position.y <= DECK.thickness * 2 || segment.fallTimer > 3.5)) {
          landSegment(segment);
        }
        if (segment.hazard && segment.landed && segment.fallTimer > SHADOW.lingerSeconds) {
          ctx.systems.hazards.removeHazard(segment.hazard);
          segment.hazard = null;
        }
        continue;
      }
      if (segment.state === 'intact') {
        const vortex = ctx.tornadoes.nearest(segment.centreX, VIADUCT_Z);
        const edge = p.radius * ctx.systems.physics.CAPTURE_TUNE.edgeRadiusFactor * vortex.sizeMul * vortex.birth;
        if (Math.hypot(segment.centreX - vortex.center.x, VIADUCT_Z - vortex.center.z) < edge) {
          segment.integrity -= drain;
        }
        // Either losing a support or running out of integrity starts it down.
        if (segment.integrity <= 0 || segment.left.down || segment.right.down) beginSag(segment);
      }

      if (segment.state === 'sagging') {
        segment.sagTimer += dt;
        const t = Math.min(1, segment.sagTimer / DECK.sagSeconds);
        // Hinged on the surviving end: the free end swings down, so the slab
        // rotates about Z and drops by half the span's sine.
        poseSag(segment, DECK.sagAngle * t * t * (segment.hinge || 1));
        if (t >= 1) dropSegment(segment);
      }

      // Only a span still standing shudders: one that has begun to sag is
      // posed by the sag, and the shudder writing its height over that had
      // a span let go from where it stood rather than from where it sagged.
      if (segment.shudder > 0 && segment.state === 'intact') {
        segment.shudder = Math.max(0, segment.shudder - dt);
        const decay = segment.shudder / DECK.shudderSeconds;
        segment.group.position.y = segment.baseY
          + Math.sin(segment.shudder * DECK.shudderRate) * DECK.shudderAmplitude * decay;
      }
    }
  }

  return { createPillar, createAbutment, surfaceAt, createSegment, impactTargets, damageStructure, fissureUnder, breakPillar, beginSag, dropSegment, landSegment, segmentAt, updateStructure };
}
