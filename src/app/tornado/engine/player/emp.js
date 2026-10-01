// @ts-check
import * as THREE from 'three';

/**
 * ===========================================================================
 * SECTION PM — EMP beam (R)
 * ===========================================================================
 * A charged pulse: R starts EMP.chargeSeconds of charge-up (a blue glow
 * gathering round Roger, crackling), then it goes off -- a blue shock
 * ring and dome racing out to EMP.radius. Everything electronic in it is
 * knocked out, through the shared register of enemies (engine/enemies.js,
 * damage 'emp'): the Terminators and Roger's own pursuers die (this is the
 * EMP-Terminator case: it goes through the same empSweep the Electric
 * Tornado's rings use), the cyber T-Rex's implants go down and it stands
 * stunned, and the power lines in the inner part fault.
 *
 * Never Roger: the pulse is not the 'empPulse' event (which is the storm's
 * and does kill him outside a car); it goes to the enemies alone.
 *
 * 3 segments (30%), 5 s cooldown. If Roger dies or the run ends while it
 * is charging, it fizzles.
 */

export const EMP = {
  keys: ['KeyR'],        // R since 2026-10-01 (E is Teleport; R was the black hole)
  cost: 3,
  chargeSeconds: 0.8,
  cooldown: 5,
  radius: 36,
  lineRadius: 20,      // power lines faulted within this
  ringSeconds: 0.6,
  colour: new THREE.Color(0.5, 1.4, 3.2)
};

/**
 * @param {Object} ctx
 * @returns {{
 *   pulse: (x: number, z: number) => number,
 *   initEmp: () => void,
 *   updateEmp: (rawDt: number) => void,
 *   resetEmp: () => void,
 *   disposeEmp: () => void
 * }}
 */
export function createEmpSystem(ctx) {
  const { Sim } = ctx;
  /** @type {THREE.Mesh|null} the glow while charging */
  let glow = null;
  /** @type {THREE.Mesh|null} */
  let ring = null;
  /** @type {THREE.Mesh|null} */
  let dome = null;
  /** @type {THREE.BufferGeometry[]} */
  const geometries = [];
  let charge = -1;       // seconds into the charge; -1 idle
  let wave = 1;          // 0..1 through the ring; 1 idle
  let zap = 0;

  /**
   * The pulse at (x, z): every enemy that answers to an EMP in the radius.
   * @param {number} x
   * @param {number} z
   * @returns {number} how many were stopped
   */
  function pulse(x, z) {
    const stopped = ctx.systems.area.hitEnemiesInRadius({ x, z, radius: EMP.radius }, { type: 'emp', at: { x, z } });
    if (ctx.systems.powerLines) ctx.systems.powerLines.faultAt(x, z, EMP.lineRadius);
    const at = new THREE.Vector3(x, 2, z);
    ctx.systems.lightning.flashScreen(at, 0.55, '#8fd0ff');
    ctx.systems.gamefeel.event('gas', at);
    if (ctx.systems.shockwaveSound) ctx.systems.shockwaveSound.playShockwave();
    if (ctx.systems.powerArcSound) ctx.systems.powerArcSound.playZap(1);
    wave = 0;
    if (ring && dome) {
      ring.position.set(x, 0.3, z);
      dome.position.set(x, 0, z);
      ring.visible = dome.visible = true;
    }
    ctx.events.emit('notice', { text: stopped ? `⚡ EMP · ${stopped} knocked out` : '⚡ EMP' });
    return stopped;
  }

  /** @returns {void} */
  function initEmp() {
    const mat = (/** @type {number} */ opacity) => new THREE.MeshBasicMaterial({
      color: EMP.colour, transparent: true, opacity, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    const glowGeo = new THREE.SphereGeometry(1, 20, 14);
    const ringGeo = new THREE.RingGeometry(0.9, 1, 64, 1);
    ringGeo.rotateX(-Math.PI / 2);
    const domeGeo = new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    geometries.push(glowGeo, ringGeo, domeGeo);
    glow = new THREE.Mesh(glowGeo, mat(0));
    ring = new THREE.Mesh(ringGeo, mat(0));
    dome = new THREE.Mesh(domeGeo, mat(0));
    for (const [m, name] of /** @type {[THREE.Mesh, string][]} */ ([[glow, 'emp_glow'], [ring, 'emp_ring'], [dome, 'emp_dome']])) {
      m.name = name;
      m.visible = false;
      m.frustumCulled = false;
      Sim.three.scene.add(m);
    }
    ctx.systems.abilities.register({
      id: 'emp', name: 'EMP', keys: EMP.keys, cost: EMP.cost, seconds: EMP.chargeSeconds, cooldown: EMP.cooldown,
      start: () => {
        charge = 0;
        ctx.events.emit('notice', { text: '⚡ EMP CHARGING' });
      },
      stop: (cancelled) => {
        const was = cancelled ? -1 : charge;
        charge = -1;
        if (glow) glow.visible = false;
        // Fired at the end of the charge, only if he is still there.
        const roger = ctx.systems.heroMode && ctx.systems.heroMode.rogerTarget();
        if (roger && was >= 0) pulse(roger.x, roger.z);
      }
    });
  }

  /**
   * The charge glow round him and the ring going out, on real time.
   * @param {number} rawDt
   * @returns {void}
   */
  function updateEmp(rawDt) {
    if (charge >= 0 && glow) {
      charge += rawDt;
      const roger = ctx.systems.heroMode && ctx.systems.heroMode.rogerTarget();
      if (roger) {
        const t = Math.min(1, charge / EMP.chargeSeconds);
        glow.visible = true;
        glow.position.set(roger.x, 1.4, roger.z);
        glow.scale.setScalar(0.8 + t * 1.6 + Math.sin(charge * 40) * 0.08);
        /** @type {THREE.MeshBasicMaterial} */ (glow.material).opacity = 0.25 + t * 0.45;
        zap -= rawDt;
        if (zap <= 0 && ctx.systems.powerArcSound) {
          ctx.systems.powerArcSound.playZap(0.3 + t * 0.5);
          zap = 0.15;
        }
      }
    }
    if (wave < 1 && ring && dome) {
      wave = Math.min(1, wave + rawDt / EMP.ringSeconds);
      const r = EMP.radius * (1 - (1 - wave) * (1 - wave));
      ring.scale.setScalar(Math.max(0.1, r));
      dome.scale.set(Math.max(0.1, r), Math.max(0.1, r * 0.35), Math.max(0.1, r));
      /** @type {THREE.MeshBasicMaterial} */ (ring.material).opacity = 0.95 * (1 - wave);
      /** @type {THREE.MeshBasicMaterial} */ (dome.material).opacity = 0.35 * (1 - wave);
      if (wave >= 1) ring.visible = dome.visible = false;
    }
  }

  /** @returns {void} */
  function resetEmp() {
    charge = -1;
    wave = 1;
    for (const m of [glow, ring, dome]) if (m) m.visible = false;
  }

  /** @returns {void} */
  function disposeEmp() {
    for (const m of [glow, ring, dome]) {
      if (!m) continue;
      Sim.three.scene.remove(m);
      /** @type {THREE.Material} */ (m.material).dispose();
    }
    glow = ring = dome = null;
    for (const g of geometries) g.dispose();
    geometries.length = 0;
  }

  return { pulse, initEmp, updateEmp, resetEmp, disposeEmp };
}
