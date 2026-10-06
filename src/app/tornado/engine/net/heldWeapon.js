// @ts-check
import { viewKeyAt } from './viewModel.js';

/**
 * ===========================================================================
 * SECTION NV.2 — The weapon in a Roger's hand, seen from outside (pure)
 * ===========================================================================
 * What each Roger proxy (the host's Roger on the guest, the guest's Roger on
 * the host) carries in third person: the held weapon only, no raised pose and
 * nothing new on the wire (the weapon index is the snapshot players row's
 * column 5, decided 2026-10-05). This file is the rules and the shapes as
 * data; hero/heldWeapons.js builds the meshes. No scene, so it is tested.
 */

/**
 * The key of the weapon a Roger shows in his hand, or null for none: it is
 * hidden while he is down or dead, or seated in a vehicle, and for an index
 * off the wheel (R-049: the order is the protocol's `WEAPONS`).
 * @param {number} weapon Wheel index.
 * @param {boolean} up The Roger is up (not down or dead).
 * @param {boolean} seated The Roger sits in a vehicle.
 * @returns {import('./viewModel.js').ViewKey|null}
 */
export const heldKey = (weapon, up, seated) => (up && !seated ? viewKeyAt(weapon) : null);

/**
 * @typedef {Object} HeldPart One small solid of a held weapon, along local +z (the arm's forward).
 * @property {'box'|'cyl'} shape A box (w, h, d) or a cylinder along z (radius, length).
 * @property {number[]} size `[w, h, d]` for a box, `[radius, length]` for a cylinder.
 * @property {number} z Centre along the weapon, metres in the figure's own units.
 * @property {number} colour Hex colour.
 * @property {number} [glow] Hex emissive colour, for a lit part.
 */

/** @type {Readonly<Record<string, ReadonlyArray<HeldPart>>>} The parts of every wheel weapon but the Katana (a blade, built by `fillKatana`). */
export const HELD_PARTS = Object.freeze({
  rifle: [
    { shape: 'box', size: [0.06, 0.09, 0.4], z: 0.15, colour: 0x2b3038 },
    { shape: 'cyl', size: [0.02, 0.3], z: 0.5, colour: 0x151a20 }
  ],
  minigun: [
    { shape: 'cyl', size: [0.065, 0.55], z: 0.25, colour: 0x3a3f47 },
    { shape: 'box', size: [0.08, 0.1, 0.16], z: 0, colour: 0x1b1d22 }
  ],
  railgun: [
    { shape: 'box', size: [0.07, 0.08, 0.7], z: 0.25, colour: 0x2a2e36 },
    { shape: 'box', size: [0.09, 0.03, 0.4], z: 0.35, colour: 0xe8b400, glow: 0xe8b400 }
  ],
  fire: [
    { shape: 'cyl', size: [0.05, 0.4], z: 0.2, colour: 0xc0392b },
    { shape: 'cyl', size: [0.025, 0.14], z: 0.47, colour: 0x6b1d16, glow: 0xff6a1a }
  ],
  blackhole: [
    { shape: 'cyl', size: [0.075, 0.4], z: 0.2, colour: 0x1a1030 },
    { shape: 'cyl', size: [0.09, 0.05], z: 0.45, colour: 0x7a3cff, glow: 0x7a3cff }
  ]
});
