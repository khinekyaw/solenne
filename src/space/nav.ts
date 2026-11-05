import * as THREE from 'three';
import { BODIES, STAR, ORRIN, VAEL, type StarSystem } from './system';

/* =========================================================================
   Space navigation (M7). Patched conics: each body rules a sphere of
   influence (Laplace's a·(m/M)^0.4, capped for the heavy moons and giants of
   this compressed system), and a ship feels only the gravity of the deepest
   body whose sphere it is in. The cruise drive's speed is limited by the
   nearest gravity well (Elite's supercruise, at the scale of a quiet game):
   it grows with the distance to the nearest surface, so leaving and arriving
   both take a minute or so and nothing is ever overshot.
   ========================================================================= */
export const SOI: number[] = BODIES.map((b) => {
  if (b.parent < 0 || !b.orbit) return Infinity;
  const a = b.orbit.a;
  return Math.min(a * Math.pow((b.GM ?? 0) / (BODIES[b.parent].GM ?? 1), 0.4), 0.35 * a);
});
const CHILDREN = BODIES.map((_, k) => BODIES.map((b, c) => (b.parent === k ? c : -1)).filter((c) => c >= 0));

export const K_CRUISE = 0.12;        // cruise speed per metre of room to the nearest surface (1/s)
export const CRUISE_MAX = 6e7;       // m/s: Vael in about four minutes
export const CRUISE_ROOM = 30000;    // the drive needs this much room from any surface to start
export const CRUISE_DROP = 15000;    // and drops out below this
// stars and giants are deeper wells: they slow the drive from farther out
const WELL = BODIES.map((_, k) => (k === STAR ? 0.4 : k === ORRIN || k === VAEL ? 0.7 : 1));

const tmp = new THREE.Vector3();

/** the deepest body whose sphere of influence holds the inertial point p; the current focus is kept a little
    past its boundary so a ship sitting on it does not flicker between the two */
export function focusAt(sys: StarSystem, p: THREE.Vector3, current = -1) {
  let f = STAR;
  for (;;) {
    let best = -1, bestK = Infinity;
    for (const c of CHILDREN[f]) {
      const k = sys.bodies[c].pos.distanceTo(p) / (SOI[c] * (c === current ? 1.03 : 1));
      if (k < 1 && k < bestK) { bestK = k; best = c; }
    }
    if (best < 0) return f;
    f = best;
  }
}

/** room to the nearest surface, weighted by how deep its well is: what the cruise drive is limited by */
export function nearestWell(sys: StarSystem, p: THREE.Vector3) {
  let k = STAR, room = Infinity, surface = Infinity;
  for (let i = 0; i < BODIES.length; i++) {
    const d = sys.bodies[i].pos.distanceTo(p) - BODIES[i].radius, w = d * WELL[i];
    if (w < room) { room = w; k = i; }
    surface = Math.min(surface, d);
  }
  return { k, room: Math.max(room, 0), surface };
}
export const cruiseLimit = (room: number) => Math.min(K_CRUISE * room, CRUISE_MAX);

/** where to park on arrival: above the air and the rings, a little more than half a radius up */
export function parkRadius(k: number) {
  const b = BODIES[k], ring = b.look?.ring;
  return ring ? b.radius * ring[1] * 1.15 : b.radius + Math.max(60000, 0.5 * b.radius);
}

/** the conic a ship is on around a body of gravity mu: points relative to the body (ellipse closed, a hyperbola's
    outgoing and incoming arms cut at rMax) */
export function conicPoints(r: THREE.Vector3, v: THREE.Vector3, mu: number, rMax: number, n = 160) {
  const h = new THREE.Vector3().crossVectors(r, v), h2 = h.lengthSq();
  if (h2 < 1e-6) return [];
  const e = new THREE.Vector3().crossVectors(v, h).divideScalar(mu).sub(tmp.copy(r).normalize());
  const ecc = e.length(), p = h2 / mu;
  const P = ecc > 1e-6 ? e.clone().divideScalar(ecc) : r.clone().normalize(), W = h.clone().normalize(), Q = new THREE.Vector3().crossVectors(W, P);
  // an ellipse all the way round; otherwise only where it stays within rMax
  const lim = ecc < 1 ? Math.PI : Math.acos(Math.max(-1, Math.min(1, (p / rMax - 1) / ecc)));
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const th = -lim + (2 * lim * i) / n, rr = p / (1 + ecc * Math.cos(th));
    if (rr <= 0 || rr > rMax) continue;
    out.push(P.clone().multiplyScalar(rr * Math.cos(th)).addScaledVector(Q, rr * Math.sin(th)));
  }
  return out;
}

/** about how long the cruise to body k takes from p: the drive's law marched along the straight line */
export function cruiseEta(sys: StarSystem, p: THREE.Vector3, k: number) {
  const tp = sys.bodies[k].pos, L = p.distanceTo(tp) - parkRadius(k);
  if (L <= 0) return 0;
  const dir = new THREE.Vector3().subVectors(tp, p).normalize(), at = new THREE.Vector3();
  let t = 0, x = 0;
  for (let i = 0; i < 400 && x < L; i++) {
    const room = nearestWell(sys, at.copy(p).addScaledVector(dir, x)).room;
    const dx = Math.min(Math.max(0.15 * room, 2000), L - x);
    t += dx / Math.max(cruiseLimit(room), 1000);
    x += dx;
  }
  return t + 4;   // and a few seconds to turn and spool up
}
