// @ts-check
import * as THREE from 'three';
import { PERSON } from '../scale.js';

/**
 * ===========================================================================
 * SECTION D.5 — Environment: people's speech bubbles
 * ===========================================================================
 * Scattered chatter above the crowd. Bubbles are HTML elements in a
 * pointer-events-free overlay, positioned each frame by projecting the
 * speaker's head into screen space -- the same overlay approach the HUD and
 * the lightning flash already use, and it gives crisp text at any distance
 * for free, which a CanvasTexture sprite would not.
 *
 * Cheap by construction: a fixed pool of MAX_BUBBLES elements is created
 * once and recycled; at most that many are ever visible, whatever the crowd
 * size. Per frame the work is one random roll per idle, grounded person and
 * one projection + one style write per visible bubble.
 *
 * What people say follows what is happening to them: everyday chatter
 * before the storm, uneasy lines once it is running (more of them as
 * intensity rises), panic while fleeing (see peopleMotion.js), one last
 * exclamation at the moment the vortex takes them, and -- for anyone it puts
 * back down again -- woozy lines while they are dazed. Paired people (see
 * peopleMotion.js) converse: when one speaks, the partner answers a moment
 * later with a reply-style line.
 */

const MAX_BUBBLES = 8;
// Chance per second, per person, of starting to talk.
const CHATTER_RATE_CALM = 0.018;
const CHATTER_RATE_STORM = 0.035;
const CHATTER_RATE_PANIC = 0.12;
// Dazed people are the whole point of the moment they are in, and the state
// only lasts a few seconds, so they are the most talkative of the lot -- at
// this rate someone dazed for 4s says something rather than staggering about
// in silence.
const CHATTER_RATE_DAZED = 0.55;
const BUBBLE_DURATION = [2.1, 3.0];
const EXCLAIM_DURATION = 1.4;
const REPLY_DELAY = [1.1, 2.0];
// Beyond this distance from the camera, bubbles are not shown at all: at
// that range they would be unreadable specks cluttering the view.
const MAX_BUBBLE_DISTANCE = 150;
// World height of the bubble anchor: just over a person's head
// (engine/scale.js PERSON.height).
const BUBBLE_ANCHOR_HEIGHT = PERSON.height * 1.1;

const PHRASES_CALM = [
  'Nice weather...', 'Did you see the game?', 'Where\'s my umbrella?', 'Looks like rain.',
  'Coffee later?', 'Lovely evening.', 'Is it Tuesday?', 'I left the oven on...',
  'Windy, huh?', 'Those clouds, though.'
];
const PHRASES_UNEASY = [
  'Did you feel that?', 'Is that a tornado?!', 'That sky looks wrong.', 'Hear that roar?',
  'Should we go inside?', 'Call the kids!', 'Wait, what?!', 'It\'s getting closer...',
  'Where do we go?', 'Is this normal?'
];
const PHRASES_PANIC = [
  'RUN!', 'Let\'s get inside!', 'GO GO GO!', 'Not my car!', 'Help!', 'Get down!',
  'MOVE!', 'It\'s coming!', 'This way!', 'AAAH!'
];
const PHRASES_REPLY_CALM = ['Totally.', 'Ha, right?', 'Sure, why not.', 'Hmm, maybe.', 'Tell me about it.', 'Same here.'];
const PHRASES_REPLY_STORM = ['I don\'t like this.', 'Yeah... let\'s go.', 'Stay close!', 'Oh no.', 'What do we do?!', 'Keep walking!'];
const PHRASES_EXCLAIM = ['WHOA—', 'NOOO—', 'AAAH—', 'UH-OH—'];
const PHRASES_DAZED = [
  'Whoa... where am I?', 'Everything\'s spinning...', 'Which way is up?',
  'Did I fly?', 'My shoes...', 'Ow. Ow. Ow.', 'Is this my street?',
  'Two tornadoes? No, three...', 'I\'ll just sit down.', 'What day is it?'
];

/**
 * @typedef {Object} Bubble
 * @property {HTMLDivElement} el
 * @property {SimObject|null} speaker
 * @property {number} life seconds remaining
 * @property {boolean} visible last written visibility, to skip redundant style writes
 */

/**
 * @param {Object} ctx
 * @returns {{
 *   initSpeechBubbles: () => void,
 *   updateSpeechBubbles: (dt: number) => void,
 *   exclaim: (person: SimObject) => void,
 *   shout: (person: SimObject, text: string) => void,
 *   sayDazed: (person: SimObject) => void,
 *   clearSpeechBubbles: () => void,
 *   disposeSpeechBubbles: () => void
 * }}
 */
export function createSpeechBubbleSystem(ctx) {
  const { Sim, container } = ctx;

  /** @type {Bubble[]} */
  const pool = [];
  /** @type {HTMLDivElement|null} */
  let layer = null;
  /** @type {{person:SimObject, delay:number}[]} */
  const pendingReplies = [];
  // The container's size, cached by updateSpeechBubbles.
  let screenW = 0;
  let screenH = 0;
  let screenAge = 0;
  const projected = new THREE.Vector3();

  /**
   * @template T
   * @param {T[]} list
   * @returns {T}
   */
  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  /** @returns {void} */
  function initSpeechBubbles() {
    layer = document.createElement('div');
    layer.className = 'speech-layer';
    for (let i = 0; i < MAX_BUBBLES; i++) {
      const el = document.createElement('div');
      el.className = 'speech-bubble';
      layer.appendChild(el);
      pool.push({ el, speaker: null, life: 0, visible: false });
    }
    container.appendChild(layer);
  }

  /**
   * @param {SimObject} person
   * @returns {boolean} whether this person is already speaking
   */
  function isSpeaking(person) {
    return pool.some(b => b.speaker === person && b.life > 0);
  }

  /**
   * Shows a line above a person, if a pooled bubble is free (or, for
   * `force`, by taking over the one closest to finishing).
   * @param {SimObject} person
   * @param {string} text
   * @param {number} duration
   * @param {boolean} [force]
   * @returns {boolean} whether the bubble was shown
   */
  function say(person, text, duration, force = false) {
    let bubble = pool.find(b => b.speaker === person && b.life > 0) || pool.find(b => b.life <= 0);
    if (!bubble && force) bubble = pool.reduce((a, b) => (a.life < b.life ? a : b));
    if (!bubble) return false;
    bubble.speaker = person;
    bubble.life = duration;
    bubble.el.textContent = text;
    bubble.el.classList.toggle('panic', PHRASES_PANIC.includes(text) || PHRASES_EXCLAIM.includes(text));
    bubble.el.classList.toggle('dazed', PHRASES_DAZED.includes(text));
    return true;
  }

  /**
   * Picks a line suited to a person's situation.
   * @param {SimObject} person
   * @param {boolean} reply
   * @returns {string}
   */
  function chooseLine(person, reply) {
    // Before the fleeing/storm branches, and before `reply`: someone reeling
    // from a drop is not answering anybody, whatever the weather is doing.
    if (person.motion && person.motion.mode === 'dazed') return pick(PHRASES_DAZED);
    const fleeing = person.motion && person.motion.mode === 'flee';
    if (fleeing) return pick(PHRASES_PANIC);
    const storm = Sim.state.running && Math.random() < 0.35 + Sim.params.intensity * 0.6;
    if (reply) return pick(storm ? PHRASES_REPLY_STORM : PHRASES_REPLY_CALM);
    return pick(storm ? PHRASES_UNEASY : PHRASES_CALM);
  }

  /**
   * The one line allowed once the vortex has someone: called by
   * peopleMotion.js at the hand-off to physics. Forced, so it shows even
   * when the pool is full -- it is the most important line in the scene.
   * @param {SimObject} person
   * @returns {void}
   */
  function exclaim(person) {
    say(person, pick(PHRASES_EXCLAIM), EXCLAIM_DURATION, true);
  }

  /**
   * One of the dazed lines, over someone this module does not drive itself
   * (Hero Mode's Roger, engine/heroMode.js). Anything with a mesh and a
   * 'grounded' captureState will do.
   * @param {SimObject} person
   * @returns {void}
   */
  function sayDazed(person) {
    say(person, pick(PHRASES_DAZED), BUBBLE_DURATION[1], true);
  }

  /**
   * @param {SimObject} person
   * @returns {boolean} whether the person is still in a state to chat
   */
  function canChat(person) {
    return !!person.motion && person.motion.active && person.captureState === 'grounded' && !!person.mesh.parent;
  }

  /**
   * Per-frame: starts new chatter, fires queued replies, and positions and
   * fades every visible bubble.
   * @param {number} dt
   * @returns {void}
   */
  function updateSpeechBubbles(dt) {
    if (!layer) return;
    const people = ctx.Environment.people;
    const camera = Sim.three.camera;
    const running = Sim.state.running;

    // New chatter. Rolled only while a bubble is free, so a full pool costs
    // nothing here.
    if (pool.some(b => b.life <= 0)) {
      for (const person of people) {
        if (!canChat(person)) continue;
        const panic = person.motion.mode === 'flee';
        const dazed = person.motion.mode === 'dazed';
        const rate = dazed ? CHATTER_RATE_DAZED
          : panic ? CHATTER_RATE_PANIC
            : running ? CHATTER_RATE_STORM : CHATTER_RATE_CALM;
        // The roll first: it turns almost everyone away, and isSpeaking scans
        // the whole pool (performance pass).
        if (Math.random() >= rate * dt) continue;
        if (isSpeaking(person)) continue;
        if (camera.position.distanceTo(person.mesh.position) > MAX_BUBBLE_DISTANCE) continue;
        const duration = BUBBLE_DURATION[0] + Math.random() * (BUBBLE_DURATION[1] - BUBBLE_DURATION[0]);
        if (!say(person, chooseLine(person, false), duration)) break;
        const partner = person.motion.partner;
        // No reply while panicking, and none while dazed -- wakeDazed severs
        // the pairing anyway, so this is belt and braces.
        if (partner && !panic && !dazed) {
          pendingReplies.push({
            person: partner,
            delay: REPLY_DELAY[0] + Math.random() * (REPLY_DELAY[1] - REPLY_DELAY[0])
          });
        }
      }
    }

    for (let i = pendingReplies.length - 1; i >= 0; i--) {
      const reply = pendingReplies[i];
      reply.delay -= dt;
      if (reply.delay > 0) continue;
      pendingReplies.splice(i, 1);
      if (canChat(reply.person) && !isSpeaking(reply.person)) {
        const duration = BUBBLE_DURATION[0] + Math.random() * (BUBBLE_DURATION[1] - BUBBLE_DURATION[0]);
        say(reply.person, chooseLine(reply.person, true), duration);
      }
    }

    // The container's size, read at most twice a second: clientWidth can
    // force the browser to lay the page out on the spot (performance pass).
    screenAge -= dt;
    if (screenAge <= 0) {
      screenAge = 0.5;
      screenW = container.clientWidth || window.innerWidth;
      screenH = container.clientHeight || window.innerHeight;
    }
    const w = screenW;
    const h = screenH;
    for (const bubble of pool) {
      if (bubble.life > 0) bubble.life -= dt;
      const person = bubble.speaker;
      // The exclaim bubble (see exclaim() above) is deliberately not gated on
      // canChat()/captureState the way ordinary chatter is, since it fires at
      // the very moment a person leaves 'grounded' -- but left unguarded here
      // it kept following them straight through 'orbiting' and 'falling',
      // where position updates are the vortex's kinematic spiral or a
      // post-release ballistic eject rather than anything gradual. Reprojected
      // every frame, that read as the bubble glitching/teleporting around the
      // screen rather than as text pinned above a person's head. Expired
      // outright rather than merely hidden for the frame, so it cannot
      // reappear if the person is later dropped back to 'grounded' while it
      // still had life left.
      if (person && (person.captureState === 'orbiting' || person.captureState === 'falling')) {
        bubble.life = 0;
      }
      let show = bubble.life > 0 && !!person && !!person.mesh.parent;
      if (show) {
        projected.copy(person.mesh.position);
        projected.y += BUBBLE_ANCHOR_HEIGHT;
        projected.project(camera);
        // z > 1 means behind the camera.
        show = projected.z < 1 && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1;
      }
      if (show) {
        const x = (projected.x * 0.5 + 0.5) * w;
        const y = (-projected.y * 0.5 + 0.5) * h;
        const dist = camera.position.distanceTo(person.mesh.position);
        const scale = THREE.MathUtils.clamp(40 / dist, 0.55, 1.15);
        // Fade in over the first 0.2s is handled by CSS; fade out here.
        const alpha = Math.min(1, bubble.life / 0.35);
        bubble.el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(3)})`;
        bubble.el.style.opacity = alpha.toFixed(2);
      }
      if (show !== bubble.visible) {
        bubble.el.style.display = show ? 'block' : 'none';
        bubble.visible = show;
      }
      if (bubble.life <= 0) bubble.speaker = null;
    }
  }

  /**
   * Clears every bubble and queued reply (on reset, when the crowd is
   * regenerated).
   * @returns {void}
   */
  function clearSpeechBubbles() {
    pendingReplies.length = 0;
    for (const bubble of pool) {
      bubble.life = 0;
      bubble.speaker = null;
    }
  }

  /** @returns {void} */
  function disposeSpeechBubbles() {
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    layer = null;
  }

  /**
   * A line of the caller's own, shown like an exclamation (the crowd's
   * brave and leaders: environment/crowd.js).
   * @param {SimObject} person
   * @param {string} text
   * @returns {void}
   */
  function shout(person, text) {
    say(person, text, EXCLAIM_DURATION, true);
  }

  return { initSpeechBubbles, updateSpeechBubbles, exclaim, shout, sayDazed, clearSpeechBubbles, disposeSpeechBubbles };
}
