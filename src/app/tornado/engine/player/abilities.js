// @ts-check
/**
 * ===========================================================================
 * SECTION PA — Abilities
 * ===========================================================================
 * The hero's abilities: each has a slot (its key), a cost in energy
 * segments (engine/player/energy.js), a duration, a cooldown and a state
 * (ready, active, cooling down). A key press (engine/player/input.js,
 * handed over by heroMode.js) is refused while the ability is active or
 * cooling down, or when there is not the energy for it; otherwise the
 * energy is spent and it starts. Its clock is the player's (real time, held
 * while the game is paused), so slowing the world does not stretch it.
 *
 * The slots (GAME_DESIGN.md "Hero Mode"); exact values are in .claude/rules.md:
 *   Q  Time Slow            the world at 10% for 5 s, Roger at full speed.
 *                           20%, 3 s cooldown. With the minigun in hand it
 *                           is **Bullet Time** instead: the world at 3%,
 *                           the minigun's bullets hanging in the air
 *                           (hero/bullets.js), the picture drained and
 *                           vignetted, the sound muffled; Q again ends it
 *                           early, and every hanging bullet goes on.
 *   E  Teleport             a short jump the way he looks (player/teleport.js)
 *   R  EMP beam             (player/emp.js)
 *   G  Grappling hook       (player/grapple.js)
 *   C  Telekinesis          lift a car and throw it (player/telekinesis.js)
 * (Keys moved 2026-10-01, on request: W A S D walk now; the black hole that
 * was on R is the Black Hole Gun, a weapon.)
 *
 * Costs are whole segments.
 */

export const ABILITIES = {
  timeSlow: {
    name: 'TIME SLOW',
    keys: ['KeyQ'],
    cost: 2,               // segments (20%)
    seconds: 5,            // real seconds (7 until 2026-10-02, 3 until 2026-10-01)
    cooldown: 3,           // real seconds after it ends (6 until 2026-10-02)
    scale: 0.1,            // the world's time while it lasts (90% slower; 0.3 until 2026-10-02)
    bulletScale: 0.03      // Bullet Time's: almost a stop
  }
};

/**
 * @typedef {Object} AbilityDef
 * @property {string} id
 * @property {string} name shown in the HUD
 * @property {string[]} keys KeyboardEvent.code values
 * @property {number} cost segments
 * @property {number} seconds how long it lasts once started (0: instant)
 * @property {number} cooldown seconds after it ends before it can start again
 * @property {() => boolean} [canStart] checked before the energy is taken:
 *   false refuses the press (it says why itself), and nothing is spent
 * @property {() => void} start
 * @property {(cancelled?: boolean) => void} [stop] when it ends, or is
 *   cancelled (true: the run ended under it)
 * @property {(dt: number) => void} [update] every frame while active
 * @property {boolean} [again] pressing its key while it runs ends it early
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   register: (def: AbilityDef) => void,
 *   press: (code: string) => boolean,
 *   updateAbilities: (dt: number) => void,
 *   isActive: (id: string) => boolean,
 *   cancelAll: () => void,
 *   hudLine: () => string,
 *   buttonState: (code: string) => ({active: boolean, cooldown: number, affordable: boolean}|null),
 *   initAbilities: () => void,
 *   resetAbilities: () => void
 * }}
 */
export function createAbilitySystem(ctx) {
  /** @type {Map<string, {def: AbilityDef, active: number, cooldown: number}>} */
  const abilities = new Map();

  /**
   * @param {AbilityDef} def
   * @returns {void}
   */
  function register(def) {
    abilities.set(def.id, { def, active: 0, cooldown: 0 });
  }

  /**
   * @param {string} text
   * @returns {void}
   */
  function say(text) {
    ctx.events.emit('notice', { text });
  }

  /**
   * A key pressed while the player has the controls. Whether the hero may
   * use an ability at all right now (not dying, not in a car) is the
   * caller's to decide.
   * @param {string} code KeyboardEvent.code
   * @returns {boolean} whether the key belongs to an ability
   */
  function press(code) {
    for (const slot of abilities.values()) {
      const { def } = slot;
      if (!def.keys.includes(code)) continue;
      if (slot.active > 0) {
        if (def.again) {
          slot.active = 0;
          if (def.stop) def.stop();
          slot.cooldown = def.cooldown;
        }
        return true;
      }
      if (slot.cooldown > 0) {
        say(`${def.name} · ready in ${Math.ceil(slot.cooldown)} s`);
        return true;
      }
      const energy = ctx.systems.energy.hero;
      if (!energy.canSpend(def.cost)) {
        say(`${def.name} · needs ${def.cost * 10}% energy`);
        return true;
      }
      if (def.canStart && !def.canStart()) return true;
      if (!energy.spend(def.cost)) {
        say(`${def.name} · needs ${def.cost * 10}% energy`);
        return true;
      }
      slot.active = def.seconds > 0 ? def.seconds : 0;
      def.start();
      if (!(def.seconds > 0)) {
        if (def.stop) def.stop();
        slot.cooldown = def.cooldown;
      }
      return true;
    }
    return false;
  }

  /**
   * The abilities' clocks, on the player's time.
   * @param {number} dt seconds (0 while paused)
   * @returns {void}
   */
  function updateAbilities(dt) {
    for (const slot of abilities.values()) {
      if (slot.active > 0) {
        if (slot.def.update) slot.def.update(dt);
        slot.active -= dt;
        if (slot.active <= 0) {
          slot.active = 0;
          if (slot.def.stop) slot.def.stop();
          slot.cooldown = slot.def.cooldown;
        }
      } else if (slot.cooldown > 0) {
        slot.cooldown = Math.max(0, slot.cooldown - dt);
      }
    }
  }

  /**
   * @param {string} id
   * @returns {boolean}
   */
  function isActive(id) {
    const slot = abilities.get(id);
    return !!slot && slot.active > 0;
  }

  /**
   * Everything active stopped, every cooldown cleared (a run ending).
   * @returns {void}
   */
  function cancelAll() {
    for (const slot of abilities.values()) {
      if (slot.active > 0 && slot.def.stop) slot.def.stop(true);
      slot.active = 0;
      slot.cooldown = 0;
    }
  }

  /** @returns {string} the abilities as one HUD line: ready, active or cooling */
  function hudLine() {
    const parts = [];
    for (const { def, active, cooldown } of abilities.values()) {
      const key = def.keys[0].replace('Key', '');
      const cost = def.cost ? ` ${def.cost * 10}%` : '';
      const status = active > 0 ? ` ▶ ${active.toFixed(1)}s` : cooldown > 0 ? ` ⌛ ${Math.ceil(cooldown)}s` : '';
      parts.push(`${key} ${def.name}${cost}${status}`);
    }
    return parts.join(' · ');
  }

  /**
   * The abilities there are so far.
   * @returns {void}
   */
  function initAbilities() {
    const T = ABILITIES.timeSlow;
    let bullet = false;
    register({
      id: 'timeSlow', name: T.name, keys: T.keys, cost: T.cost, seconds: T.seconds, cooldown: T.cooldown,
      again: true,
      // The world slowed through its time group (engine/time.js); the hero's
      // own clock is untouched. With the minigun in hand, Bullet Time.
      start: () => {
        const hero = ctx.systems.heroMode;
        bullet = !!hero && hero.weapon() === 'minigun';
        ctx.systems.time.hold('timeSlow', 'world', bullet ? T.bulletScale : T.scale);
        if (bullet) {
          hero.bulletTime(true);
          ctx.systems.post.Post.bulletTime = 1;
          ctx.systems.sound.setMuffle(1);
          ctx.systems.heroSound.playTimeWarp();
          say(`🕶️ BULLET TIME · ${T.seconds} s · Q to release`);
        } else {
          ctx.systems.heroSound.playSlowmo();
          say(`⏱ SLOW MOTION · ${T.seconds} s`);
        }
      },
      stop: () => {
        ctx.systems.time.release('timeSlow');
        if (!bullet) return;
        bullet = false;
        const hero = ctx.systems.heroMode;
        if (hero) hero.bulletTime(false);
        ctx.systems.post.Post.bulletTime = 0;
        ctx.systems.sound.setMuffle(0);
        ctx.systems.heroSound.playRelease();
      }
    });
  }

  /** @returns {void} */
  function resetAbilities() {
    cancelAll();
  }

  /**
   * How an ability's button should look (hero/touch.js): running, cooling
   * down (seconds left), or short of energy. Null for a key no ability has.
   * @param {string} code
   * @returns {{active: boolean, cooldown: number, affordable: boolean}|null}
   */
  function buttonState(code) {
    for (const { def, active, cooldown } of abilities.values()) {
      if (!def.keys.includes(code)) continue;
      return { active: active > 0, cooldown, affordable: ctx.systems.energy.hero.canSpend(def.cost) };
    }
    return null;
  }

  return { register, press, updateAbilities, isActive, cancelAll, hudLine, buttonState, initAbilities, resetAbilities };
}
