// @ts-check
/**
 * ===========================================================================
 * SECTION D.2b — How the crowd behaves (traits and presets)
 * ===========================================================================
 * Every townsperson has three traits, read by their movement
 * (peopleMotion.js) when the funnel comes near:
 *   panic    how early they notice the funnel and how hard they run
 *            (0.5: as before; 1: notice it from half as far again and run
 *            15% faster; 0: only when it is close);
 *   herd     how much a runner goes the way the runners round them go
 *            (0: their own way, as before);
 *   shelter  how likely they are to think of a storm shelter at all
 *            (1: everyone, as before).
 * The panel's three sliders (👥 Crowd) set the town's level of each; each
 * person gets their own, spread round it by the preset's `jitter`.
 *
 * And a kind:
 *   normal    as described above;
 *   brave     "aggressive": stands its ground facing the funnel, shouting
 *             at it, until the wind takes it (dark red clothes);
 *   coward    runs off in a random direction (never towards the funnel),
 *             weaving wildly, and forgets the shelters;
 *   leader    always makes for a shelter, shouting "Follow me!" (a
 *             high-visibility orange vest); anyone running near a leader
 *             (CROWD.leaderReach) follows them to the same door, or their
 *             way when they have none.
 *
 * The presets (CROWD.presets) mix these for different styles of play. The
 * default, Normal, is the crowd exactly as it was before this existed
 * (same awareness, speed, shelters, no herding, nobody brave, cowardly or
 * leading), so the benchmark's fingerprint does not move.
 *
 * Each person's traits come from their own motion seed (weaveSeed) through
 * a hash, not from the game's random numbers, so choosing a preset never
 * shifts anything else in the run; a change of preset or slider re-derives
 * everyone's at once (version).
 *
 * Cost: a trait lookup per person per frame (cached), and for herding and
 * leaders one scan of the crowd per runner per flee probe (4 a second).
 */

export const CROWD = {
  presets: {
    normal:     { label: 'Normal',     panic: 0.5, herd: 0,   shelter: 1,   brave: 0,    coward: 0,    leaders: 0,    jitter: 0 },
    aggressive: { label: 'Aggressive', panic: 0.3, herd: 0.2, shelter: 0.5, brave: 0.6,  coward: 0,    leaders: 0,    jitter: 0.25 },
    coward:     { label: 'Coward',     panic: 1,   herd: 0,   shelter: 0.2, brave: 0,    coward: 0.85, leaders: 0,    jitter: 0.2 },
    leader:     { label: 'Leader',     panic: 0.6, herd: 0.8, shelter: 0.9, brave: 0,    coward: 0,    leaders: 0.08, jitter: 0.2 },
    mixed:      { label: 'Mixed',      panic: 0.6, herd: 0.5, shelter: 0.7, brave: 0.2,  coward: 0.25, leaders: 0.06, jitter: 0.3 }
  },
  leaderReach: 28,       // metres: a runner this near a running leader follows
  herdReach: 12,         // metres: the runners whose heading a herder takes up
  cowardTurn: 1.1,       // radians either side of straight at the funnel a coward will not run
  cowardWeave: 2.2,      // x the usual weave
  colours: { brave: 0x8e1016, leader: 0xff7a00 },
  shouts: { brave: ['Come on then!', 'Not today!', 'I\'m not moving!'], leader: ['Follow me!', 'This way!', 'To the shelter!'] }
};

/** @typedef {keyof typeof CROWD.presets} PresetName */
/** @typedef {'panic'|'herd'|'shelter'} TraitName */

/**
 * @typedef {Object} Trait
 * @property {number} version
 * @property {'normal'|'brave'|'coward'|'leader'} kind
 * @property {number} panic 0..1
 * @property {number} herd 0..1
 * @property {boolean} useShelter
 * @property {number} awareness x the usual awareness range
 * @property {number} speed x the person's run speed
 * @property {number} weave x the usual flee weave
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   traitOf: (person: SimObject, m: Object) => Trait,
 *   pickShelter: (person: SimObject, m: Object, trait: Trait, pos: {x: number, z: number}, funnel: {x: number, z: number}, distToFunnel: number, edge: number, people: SimObject[]) => Object|null,
 *   fleeDirection: (person: SimObject, m: Object, trait: Trait, away: number, people: SimObject[]) => number,
 *   startFlee: (person: SimObject, trait: Trait) => void,
 *   setPreset: (name: PresetName) => void,
 *   preset: () => PresetName,
 *   initCrowd: () => void,
 *   resetCrowd: () => void
 * }}
 */
export function createCrowdSystem(ctx) {
  /** @type {PresetName} */
  let current = 'normal';
  const levels = { panic: 0.5, herd: 0, shelter: 1 };
  let version = 1;

  /**
   * A number in [0, 1) from a person's seed and a salt: theirs, always the
   * same, and not drawn from the game's random numbers.
   * @param {number} seed
   * @param {number} salt
   * @returns {number}
   */
  function hash(seed, salt) {
    const s = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }

  /**
   * @param {number} v
   * @returns {number}
   */
  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  /**
   * Clothes back to their own colour, then the kind's, if it has one.
   * @param {SimObject} person
   * @param {Trait} trait
   * @returns {void}
   */
  function dress(person, trait) {
    const torso = person.mesh.getObjectByName(`${person.mesh.name}_torso`);
    const mat = torso && /** @type {any} */ (torso).material;
    if (!mat || !mat.color) return;
    const ud = person.mesh.userData;
    if (ud.ownClothes === undefined) ud.ownClothes = mat.color.getHex();
    const colour = trait.kind === 'brave' ? CROWD.colours.brave : trait.kind === 'leader' ? CROWD.colours.leader : ud.ownClothes;
    mat.color.setHex(colour);
  }

  /**
   * A person's traits under the current preset and sliders (cached until
   * either changes).
   * @param {SimObject} person
   * @param {any} m their motion state (peopleMotion/config.js PersonMotion)
   * @returns {Trait}
   */
  function traitOf(person, m) {
    if (m.trait && m.trait.version === version) return m.trait;
    const p = CROWD.presets[current];
    const seed = m.weaveSeed;
    const spread = (/** @type {number} */ salt) => (hash(seed, salt) - 0.5) * 2 * p.jitter;
    const roll = hash(seed, 1);
    /** @type {Trait['kind']} */
    let kind = 'normal';
    if (roll < p.leaders) kind = 'leader';
    else if (roll < p.leaders + p.brave) kind = 'brave';
    else if (roll < p.leaders + p.brave + p.coward) kind = 'coward';
    const panic = clamp01(levels.panic + spread(2));
    const herd = clamp01(levels.herd + spread(3));
    const shelter = clamp01(levels.shelter + spread(4));
    /** @type {Trait} */
    const trait = {
      version, kind, panic, herd,
      useShelter: kind === 'leader' || (kind !== 'coward' && hash(seed, 5) < shelter),
      awareness: 0.5 + panic,
      speed: 0.85 + 0.3 * panic,
      weave: kind === 'coward' ? CROWD.cowardWeave : 1
    };
    const hadKind = m.trait ? m.trait.kind : 'normal';
    m.trait = trait;
    if (kind !== hadKind || kind !== 'normal') dress(person, trait);
    return trait;
  }

  /**
   * @param {SimObject} person
   * @param {SimObject[]} people
   * @returns {any} the nearest running leader in reach, or null
   */
  function leaderNear(person, people) {
    const p = person.mesh.position;
    let best = null;
    let bestD = CROWD.leaderReach;
    for (const other of people) {
      const om = other.motion;
      if (other === person || !om || !om.trait || om.trait.kind !== 'leader' || om.mode !== 'flee') continue;
      const d = Math.hypot(other.mesh.position.x - p.x, other.mesh.position.z - p.z);
      if (d < bestD) { bestD = d; best = other; }
    }
    return best;
  }

  /**
   * The door a runner makes for, or null. Normal: as before. A coward
   * never thinks of one; someone who does not think of shelters takes a
   * leader's door when one runs by.
   * @param {SimObject} person
   * @param {any} m
   * @param {Trait} trait
   * @param {{x: number, z: number}} pos
   * @param {{x: number, z: number}} funnel
   * @param {number} distToFunnel
   * @param {number} edge
   * @param {SimObject[]} people
   * @returns {Object|null}
   */
  function pickShelter(person, m, trait, pos, funnel, distToFunnel, edge, people) {
    if (trait.kind === 'coward') return null;
    const shelters = ctx.systems.shelters;
    const own = trait.useShelter ? shelters.pickShelterEntrance(pos.x, pos.z, funnel.x, funnel.z, distToFunnel, edge) : null;
    if (own || trait.kind === 'leader' || !CROWD.presets[current].leaders) return own;
    const leader = leaderNear(person, people);
    return leader && leader.motion.shelter ? leader.motion.shelter : null;
  }

  /**
   * Which way a runner with no door goes. Normal: straight away from the
   * funnel, as before.
   * @param {SimObject} person
   * @param {any} m
   * @param {Trait} trait
   * @param {number} away heading straight away from the funnel
   * @param {SimObject[]} people
   * @returns {number} a heading
   */
  function fleeDirection(person, m, trait, away, people) {
    if (trait.kind === 'coward') {
      // Anywhere but at it (away + PI is straight at the funnel).
      const spanOk = Math.PI - CROWD.cowardTurn;
      return away + (Math.random() * 2 - 1) * spanOk;
    }
    let heading = away;
    const leader = trait.kind === 'leader' || !CROWD.presets[current].leaders ? null : leaderNear(person, people);
    if (leader) {
      // Their way: towards the leader first, then where the leader is going.
      const lp = leader.mesh.position;
      const p = person.mesh.position;
      const gap = Math.hypot(lp.x - p.x, lp.z - p.z);
      heading = gap > 4 ? Math.atan2(lp.x - p.x, lp.z - p.z) : leader.motion.fleeHeading;
    }
    if (trait.herd > 0.01) {
      let sx = 0;
      let sz = 0;
      const p = person.mesh.position;
      for (const other of people) {
        const om = other.motion;
        if (other === person || !om || om.mode !== 'flee') continue;
        const q = other.mesh.position;
        if (Math.abs(q.x - p.x) > CROWD.herdReach || Math.abs(q.z - p.z) > CROWD.herdReach) continue;
        sx += Math.sin(om.fleeHeading);
        sz += Math.cos(om.fleeHeading);
      }
      if (sx !== 0 || sz !== 0) {
        const hx = Math.sin(heading) * (1 - trait.herd) + (sx / Math.hypot(sx, sz)) * trait.herd;
        const hz = Math.cos(heading) * (1 - trait.herd) + (sz / Math.hypot(sx, sz)) * trait.herd;
        heading = Math.atan2(hx, hz);
      }
    }
    return heading;
  }

  /**
   * The moment the funnel is noticed: brave and leaders say so.
   * @param {SimObject} person
   * @param {Trait} trait
   * @returns {boolean} whether they shouted (instead of the usual line)
   */
  function startFlee(person, trait) {
    const lines = trait.kind === 'brave' ? CROWD.shouts.brave : trait.kind === 'leader' ? CROWD.shouts.leader : null;
    if (!lines) return false;
    ctx.systems.speechBubbles.shout(person, lines[Math.floor(hash(person.motion.weaveSeed, 9) * lines.length)]);
    return true;
  }

  /**
   * @returns {void} the panel's pills and sliders show the current state
   */
  function syncPanel() {
    for (const name of /** @type {PresetName[]} */ (Object.keys(CROWD.presets))) {
      const b = document.getElementById(`crowd-${name}`);
      if (!b) continue;
      b.classList.toggle('active', name === current);
      b.setAttribute('aria-pressed', String(name === current));
    }
    for (const key of /** @type {TraitName[]} */ (['panic', 'herd', 'shelter'])) {
      const input = /** @type {HTMLInputElement|null} */ (document.getElementById(`crowd-${key}`));
      if (input) input.value = String(Math.round(levels[key] * 100));
      const out = document.getElementById(`crowd-${key}-value`);
      if (out) out.textContent = `${Math.round(levels[key] * 100)}%`;
    }
  }

  /**
   * A preset: its kinds, and the sliders moved to its levels.
   * @param {PresetName} name
   * @returns {void}
   */
  function setPreset(name) {
    const p = CROWD.presets[name];
    if (!p) return;
    current = name;
    levels.panic = p.panic;
    levels.herd = p.herd;
    levels.shelter = p.shelter;
    version++;
    syncPanel();
  }

  /** @returns {void} */
  function initCrowd() {
    for (const name of /** @type {PresetName[]} */ (Object.keys(CROWD.presets))) {
      const b = document.getElementById(`crowd-${name}`);
      if (b) b.addEventListener('click', () => setPreset(name), { signal: ctx.signal });
    }
    for (const key of /** @type {TraitName[]} */ (['panic', 'herd', 'shelter'])) {
      const input = /** @type {HTMLInputElement|null} */ (document.getElementById(`crowd-${key}`));
      if (!input) continue;
      input.addEventListener('input', () => {
        levels[key] = Number(input.value) / 100;
        version++;
        syncPanel();
      }, { signal: ctx.signal });
    }
    // The panel's test: the next preset, and the storm on if it is not.
    const test = document.getElementById('btn-test-crowd');
    if (test) {
      test.addEventListener('click', () => {
        const names = /** @type {PresetName[]} */ (Object.keys(CROWD.presets));
        setPreset(names[(names.indexOf(current) + 1) % names.length]);
        if (!ctx.Sim.state.running) {
          const start = document.getElementById('btn-start');
          if (start) start.click();
        }
        ctx.events.emit('announce', { title: `CROWD: ${CROWD.presets[current].label.toUpperCase()}`, sub: 'Watch how the town runs from the funnel' });
      }, { signal: ctx.signal });
    }
    syncPanel();
  }

  /**
   * A Reset keeps the chosen preset and sliders (they are the player's
   * settings); the new town's people take them on as they are made.
   * @returns {void}
   */
  function resetCrowd() {
    version++;
  }

  return { traitOf, pickShelter, fleeDirection, startFlee, setPreset, preset: () => current, initCrowd, resetCrowd };
}
