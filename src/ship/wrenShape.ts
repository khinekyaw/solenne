import * as THREE from 'three';
import { smoothstep } from '../core/math';

/* =========================================================================
   The Wren's shape and layout (design A "Sky whale", docs/concepts).
   Ship-local metres: x = port, y = up from the ground under the ship,
   z = toward the nose. One analytic hull: every porthole, light line,
   deck and collision test is placed on (or measured against) it, so the
   look and the walking always agree.
   ========================================================================= */
export const HULL = { zNose: 12.6, zTail: -12.2, W: 4.6, Hup: 5.0, Hdn: 4.0, yc: 5.6, tailRise: 1.2, thick: 0.22 };

/** radius factor along the hull: an egg-shaped nose, a straight middle, a long taper to the tail */
export function hullR(z: number) {
  if (z > 5) { const t = Math.min((z - 5) / (HULL.zNose - 5), 1); return Math.sqrt(Math.max(1 - t * t, 0)); }
  if (z < -3) return 1 - 0.64 * Math.pow(smoothstep(-3, HULL.zTail, z), 1.3);
  return 1;
}
/** height of the hull's axis: the tail sweeps up, as in the side view */
export const hullYc = (z: number) => HULL.yc + HULL.tailRise * smoothstep(-3, HULL.zTail, z);

/** a point on the hull at station z, angle th from the top (positive toward port); inset > 0: the inner shell */
export function hullPoint(z: number, th: number, inset = 0, out = new THREE.Vector3()) {
  const r = hullR(z), c = Math.cos(th), s = Math.sin(th);
  const W = HULL.W - inset, H = (c > 0 ? HULL.Hup : HULL.Hdn) - inset;
  return out.set(W * r * s, hullYc(z) + H * r * c, z);
}
/** half-width of the hull (inset: of the inner shell) at height y, station z; 0 outside */
export function halfWidthAt(y: number, z: number, inset = 0) {
  const r = hullR(z), yc = hullYc(z), H = (y > yc ? HULL.Hup : HULL.Hdn) - inset, W = HULL.W - inset;
  if (r <= 1e-4) return 0;
  const c = (y - yc) / (H * r);
  return Math.abs(c) >= 1 ? 0 : W * r * Math.sqrt(1 - c * c);
}
/** angle from the top of the hull point at height y on the port side (for placing things by height) */
export function thetaAt(y: number, z: number, inset = 0) {
  const r = hullR(z), yc = hullYc(z), H = (y > yc ? HULL.Hup : HULL.Hdn) - inset;
  return Math.acos(Math.max(-1, Math.min(1, (y - yc) / (H * Math.max(r, 1e-4)))));
}
/** height of the hull's underside at (x, z), or +Infinity where there is no hull overhead */
export function bellyAt(x: number, z: number) {
  const r = hullR(z), w = HULL.W * r;
  if (r <= 1e-4 || Math.abs(x) >= w) return Infinity;
  return hullYc(z) - HULL.Hdn * r * Math.sqrt(1 - (x / w) ** 2);
}

/* ---- openings in the skin (the shaders cut them with the same tests) ---- */
export const GLASS = { z0: 6.6, k: 3.5, th: 1.75 };   // the many-paned nose canopy: upper front of the nose
export const glassAt = (z: number, th: number) => Math.abs(th) < GLASS.th && z > GLASS.z0 + GLASS.k * (Math.abs(th) / GLASS.th) ** 2;
export const DOOR = { z0: -0.1, z1: 1.7, y0: 2.5, y1: 4.9, r: 0.32 };   // side doorway, port, into the cargo hold: the concept's rounded rectangle
export const doorTop = (z: number) => { const dz = Math.max(Math.abs(z - 0.8) - (0.9 - DOOR.r), 0); return DOOR.y1 - DOOR.r + Math.sqrt(Math.max(0, DOOR.r * DOOR.r - dz * dz)); };
export const DOME = { z: -5.0, r: 2.6, base: 10.3, hScale: 0.85, hole: 2.45, floor: 10.0 };

/* ---- inside: two decks (ship-local heights) ---- */
export const DECK = { lower: 2.5, upper: 5.6, slab: 0.25, wallTop: 8.8 };
export const LOWER_Z: [number, number] = [-5.6, 8.6];    // engine room … workshop
export const UPPER_Z: [number, number] = [-9.6, 11.6];   // Halden's core … cockpit
// stairs along the starboard side of the cargo hold, rising toward the tail onto the upper landing
export const STAIRS = { x0: -2.4, x1: -1.1, zBot: 3.0, zTop: -0.8 };
export const HOLE = { x0: -2.5, x1: -1.0, z0: -0.8, z1: 2.0 };   // stairwell in the upper floor (head room on the stairs)
// a steep ship's ladder in the bunk room, up through the hull into the glass dome
export const LADDER = { x0: -0.45, x1: 0.45, zBot: -2.1, zTop: -4.8 };
// partitions: station, deck, doorway (x range); solid walls have none
export type Wall = { z: number; deck: 'lower' | 'upper'; door?: [number, number] };
export const WALLS: Wall[] = [
  { z: 7.3, deck: 'upper', door: [-1.3, 1.3] },    // cockpit | galley
  { z: 3.0, deck: 'upper', door: [-0.6, 1.8] },    // galley | landing
  { z: -1.6, deck: 'upper', door: [0.8, 2.0] },    // landing | bunk room
  { z: -5.0, deck: 'upper', door: [0.8, 2.0] },    // bunk room | Halden's core
  { z: -9.6, deck: 'upper' },                      // rear
  { z: 8.6, deck: 'lower' },                       // workshop front
  { z: 4.4, deck: 'lower', door: [0.2, 1.9] },     // workshop | cargo hold
  { z: -1.8, deck: 'lower', door: [0.3, 1.5] },    // cargo hold | engine room
  { z: -5.6, deck: 'lower' },                      // rear of the engine room
];
// the ramp is the door (art/wren): hinged on the sill at the inner shell, a foot section folds onto it and the two swing
// up to seal the doorway (closed: CLOSED rad above level about the hinge, z axis); x0, len: the walking surface
export const RAMP = { x0: 2.5063, len: 5.717, z0: 0.05, z1: 1.55, closed: 0.925 };
export const LEGS: [number, number][] = [[3.4, 5.6], [-3.4, 5.6], [3.6, -5.0], [-3.6, -5.0]];   // foot x, z
export const POD = { x: 7.2, y: 3.2, z0: -5.0, z1: -0.35, r: 1.25 };   // engine pods under the wings (the model's)
export const THRUSTER_Z = HULL.zTail - 0.5;                             // the tail thruster's glowing core
/** inner half-width of a deck floor (where it meets the inner shell) */
export const floorHalf = (y: number, z: number) => halfWidthAt(y, z, HULL.thick);
