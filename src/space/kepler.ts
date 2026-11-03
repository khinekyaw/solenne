import * as THREE from 'three';

/* =========================================================================
   Keplerian rails. Every body's position is a pure function of game time
   (no integration), so time scale, jumps in the clock and frame rate never
   make an orbit drift. All in float64: metres, seconds, radians.
   ========================================================================= */
export type Elements = {
  a: number;      // semi-major axis (m)
  e: number;      // eccentricity
  i: number;      // inclination to the ecliptic
  node: number;   // longitude of the ascending node at t = 0
  peri: number;   // argument of periapsis
  M0: number;     // mean anomaly at t = 0
  n: number;      // mean motion (rad/s), from the parent's GM
  nodeRate?: number;   // regression of the node (rad/s), for the moon
};
const TAU = Math.PI * 2;

export const meanMotion = (GM: number, a: number) => Math.sqrt(GM / (a * a * a));
export const periodOf = (GM: number, a: number) => TAU / meanMotion(GM, a);
/** GM that gives an orbit of semi-major axis a the period P */
export const gmFor = (a: number, P: number) => TAU * TAU * a * a * a / (P * P);

/** M = E − e·sin E by Newton–Raphson, starting from E ≈ M + e·sin M (converges in 3–5 steps for e < 0.3) */
export function eccentricAnomaly(M: number, e: number) {
  M = ((M % TAU) + TAU) % TAU;
  let E = M + e * Math.sin(M);
  for (let k = 0; k < 10; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return E;
}
/** mean anomaly that puts the body at true anomaly nu (used to place bodies at the epoch) */
export function meanFromTrue(nu: number, e: number) {
  const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
  return E - e * Math.sin(E);
}

/**
 * Position relative to the parent at time t in the ecliptic frame (z = ecliptic north).
 * `mean` returns the uniformly turning circular-orbit direction instead (a tidally locked body's
 * face follows it, so the true position wobbles around it: libration).
 */
export function orbitPos(el: Elements, t: number, out: THREE.Vector3, mean = false) {
  const M = el.M0 + el.n * t;
  let x: number, y: number;
  if (mean) { x = el.a * Math.cos(M); y = el.a * Math.sin(M); }
  else {
    const E = eccentricAnomaly(M, el.e);
    x = el.a * (Math.cos(E) - el.e);
    y = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  }
  const O = el.node + (el.nodeRate ?? 0) * t, w = el.peri;
  const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(el.i), si = Math.sin(el.i);
  return out.set(
    (cO * cw - sO * sw * ci) * x + (-cO * sw - sO * cw * ci) * y,
    (sO * cw + cO * sw * ci) * x + (-sO * sw + cO * cw * ci) * y,
    (sw * si) * x + (cw * si) * y,
  );
}
/** unit normal of the orbital plane at time t */
export function orbitNormal(el: Elements, t: number, out: THREE.Vector3) {
  const O = el.node + (el.nodeRate ?? 0) * t;
  return out.set(Math.sin(el.i) * Math.sin(O), -Math.sin(el.i) * Math.cos(O), Math.cos(el.i));
}
