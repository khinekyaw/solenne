import * as THREE from 'three';
import { PLANET_R, GM, DAY_SECONDS, ORBIT_A, YEAR_DAYS, OBLIQUITY, SUN_ANG, ATMO_H, ATMO_TOP } from '../config';
import { smoothstep } from '../core/math';
import { AXIS, MERIDIAN, EAST0, hourAngle } from '../planet/solenne';
import { type Elements, orbitPos, orbitNormal, meanMotion, gmFor, meanFromTrue } from './kepler';

/* =========================================================================
   The Seren system: a sun, five planets and three moons on Keplerian rails.
   Inertial frame I is the ecliptic (z = ecliptic north, x = Solenne's spring
   equinox direction). Distances and sizes are compressed for the sky, not
   for realism: what matters is how big things look and how fast they move.
   Solenne's spin is set so that the clock is local solar time at home; its
   orbit and 16° tilt then give the sun's height and the seasons.
   ========================================================================= */
const D = DAY_SECONDS, DEG = Math.PI / 180, AU = ORBIT_A;
export const YEAR = YEAR_DAYS * D;
export const GM_STAR = gmFor(AU, YEAR);
export const STAR_R = AU * Math.tan(SUN_ANG);
const R_ORRIN = 3.84e7;
const GM_ORRIN = gmFor(5 * R_ORRIN, 1.3 * D);
// sunlight above the air (the sky shader's orbital sun) × the same soft 0.4 the ground gets (GROUND_SUN)
const SUN_SPACE: [number, number, number] = [3.0 * 0.4, 2.85 * 0.4, 2.64 * 0.4];

type OrbitDef = { a: number; e: number; i: number; node: number; peri: number; L: number; nodeRate?: number; equatorial?: boolean };
export type Look = {
  kind: 0 | 1 | 2;                       // 0 airless rock, 1 gas giant, 2 rock with a thin atmosphere
  layer: number;                         // surface map in the baked texture array
  tint: [number, number, number];        // albedo multiplier
  haze?: [number, number, number, number];   // limb haze colour + strength
  ring?: [number, number, number, number];   // inner, outer (planet radii), ring texture row, opacity
  relief?: number;                       // height-map shading near the terminator
  shine?: number;                        // light from the parent on the night side (Solenne-shine on Lull)
};
export type BodyDef = {
  name: string; about: string; parent: number; radius: number; GM?: number;
  orbit?: OrbitDef;
  spin?: { period: number; tilt: number; az: number };   // pole tilted from the orbit normal toward ecliptic longitude az
  tidal?: boolean;                                       // keeps one face to its parent
  look?: Look;
};

export const STAR = 0, CINDER = 1, SOLENNE = 2, LULL = 3, VERRAN = 4, ORRIN = 5, PIP = 6, WICK = 7, VAEL = 8;
export const BODIES: BodyDef[] = [
  { name: 'Seren', about: 'The sun', parent: -1, radius: STAR_R, GM: GM_STAR },
  { name: 'Cinder', about: 'A scorched little world close to the sun, an evening and morning star', parent: STAR, radius: 2.0e6,
    orbit: { a: 0.42 * AU, e: 0.12, i: 3.1 * DEG, node: 0.8, peri: 0.9, L: 100 * DEG },
    spin: { period: 21 * D, tilt: 0.02, az: 0 },
    look: { kind: 0, layer: 1, tint: [0.62, 0.55, 0.5], relief: 0.8 } },
  { name: 'Solenne', about: 'Home', parent: STAR, radius: PLANET_R, GM,
    orbit: { a: AU, e: 0.017, i: 0, node: 0, peri: 1.2, L: 180 * DEG } },
  { name: 'Lull', about: "Solenne's moon; it has always shown home the same face", parent: SOLENNE, radius: 1.62e5,
    orbit: { a: 6.0e6, e: 0.05, i: 5.2 * DEG, node: 2.1, peri: 0.6, L: 61.5 * DEG, nodeRate: -2 * Math.PI / (96 * D) },
    tidal: true,
    look: { kind: 0, layer: 0, tint: [0.5, 0.49, 0.475], relief: 1, shine: 0.05 } },
  { name: 'Verran', about: 'A cold red desert with thin pink skies and white poles', parent: STAR, radius: 3.46e6,
    orbit: { a: 1.55 * AU, e: 0.09, i: 1.8 * DEG, node: 0.4, peri: 4.6, L: 230 * DEG },
    spin: { period: 1.05 * D, tilt: 0.42, az: 2.0 },
    look: { kind: 2, layer: 2, tint: [0.62, 0.6, 0.6], haze: [0.95, 0.62, 0.5, 0.5], relief: 0.6 } },
  { name: 'Orrin', about: 'The great ringed giant, banded amber and cream', parent: STAR, radius: R_ORRIN, GM: GM_ORRIN,
    orbit: { a: 3.2 * AU, e: 0.05, i: 1.3 * DEG, node: 1.7, peri: 0.3, L: 165 * DEG },
    spin: { period: 0.42 * D, tilt: 22 * DEG, az: 175 * DEG },
    look: { kind: 1, layer: 3, tint: [0.8, 0.8, 0.8], haze: [0.78, 0.72, 0.6, 0.45], ring: [1.3, 2.3, 0, 1] } },
  { name: 'Pip', about: 'An icy moon of Orrin', parent: ORRIN, radius: 1.4e6,
    orbit: { a: 5 * R_ORRIN, e: 0.01, i: 0, node: 0, peri: 0, L: 40 * DEG, equatorial: true }, tidal: true,
    look: { kind: 0, layer: 1, tint: [1.05, 1.08, 1.12] } },
  { name: 'Wick', about: 'A dark moon of Orrin', parent: ORRIN, radius: 1.9e6,
    orbit: { a: 9.5 * R_ORRIN, e: 0.02, i: 0, node: 0, peri: 1, L: 250 * DEG, equatorial: true }, tidal: true,
    look: { kind: 0, layer: 1, tint: [0.42, 0.36, 0.32] } },
  { name: 'Vael', about: 'A pale sea-green ice giant at the edge of the system', parent: STAR, radius: 2.15e7,
    orbit: { a: 5.4 * AU, e: 0.04, i: 2.4 * DEG, node: 0.2, peri: 2.6, L: 200 * DEG },
    spin: { period: 0.7 * D, tilt: 0.9, az: 40 * DEG },
    look: { kind: 1, layer: 4, tint: [0.78, 0.8, 0.82], haze: [0.62, 0.86, 0.9, 0.55], ring: [1.65, 2.0, 1, 0.45] } },
];
export const FAR_MAX = 8;
/** bodies drawn by the far pass (sorted nearest first each frame, so a nearer disc covers the ones behind) */
const FAR_LIST = [LULL, CINDER, VERRAN, ORRIN, PIP, WICK, VAEL];
/** mean albedo of each baked surface map, for bodies smaller than a pixel */
export const MAP_ALBEDO = [0.55, 0.5, 0.6, 0.72, 0.7];   // replaced by the measured means once the maps are baked
export const MAP_RANGE = [0, 0, 0, 0, 0];                 // height range of each map (body radii), for the relief shading

type Body = { def: BodyDef; el: Elements | null; pos: THREE.Vector3; rel: THREE.Vector3; pole: THREE.Vector3; mer: THREE.Vector3; m0: THREE.Vector3 };

const v = () => new THREE.Vector3();
const tmp = v(), tmp2 = v(), tmp3 = v(), sunL = v();
const SPIN_P = new THREE.Vector3(0, Math.sin(OBLIQUITY), Math.cos(OBLIQUITY));   // Solenne's north pole in I
const EQ1 = new THREE.Vector3(1, 0, 0), EQ2 = new THREE.Vector3().crossVectors(SPIN_P, EQ1);   // equatorial basis in I

/** fraction of disc 1 covered by disc 2 (angular radii r1, r2, centres d apart; small angles) */
export function discOverlap(r1: number, r2: number, d: number) {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return r2 >= r1 ? 1 : (r2 * r2) / (r1 * r1);
  const a = r1 * r1, b = r2 * r2, x = (d * d + a - b) / (2 * d);
  const area = a * Math.acos(Math.min(1, x / r1)) + b * Math.acos(Math.min(1, (d - x) / r2)) - d * Math.sqrt(Math.max(a - x * x, 0));
  return area / (Math.PI * a);
}

/** optical depth (zenith from the datum = 1) along a ray from altitude alt; up = the ray's local-up component */
const EXT = [0.05, 0.095, 0.2];
function airColumn(alt: number, up: number) {
  const r0 = PLANET_R + Math.max(alt, -700), top = PLANET_R + ATMO_TOP, b = r0 * up;
  const disc = b * b - (r0 * r0 - top * top);
  if (disc <= 0) return 0;
  const tOut = -b + Math.sqrt(disc);
  if (tOut <= 0) return 0;
  const tIn = r0 > top ? Math.max(-b - Math.sqrt(disc), 0) : 0;
  let col = 0, t0 = tIn;
  for (let k = 1; k <= 24; k++) {
    const t1 = tIn + (tOut - tIn) * (k / 24) ** 2, tm = 0.5 * (t0 + t1);
    const h = Math.sqrt(r0 * r0 + 2 * b * tm + tm * tm) - PLANET_R;
    col += Math.exp(-Math.max(h, 0) / ATMO_H) * (t1 - t0);
    t0 = t1;
  }
  return col / ATMO_H;
}

export class StarSystem {
  bodies: Body[];
  t = 0;
  PFtoI = new THREE.Matrix3();
  ItoPF = new THREE.Matrix3();
  sunPF = v();
  /** camera view, refreshed by view(): */
  camI = v();
  eclipse = 1;            // fraction of the sun's disc left uncovered by Lull, seen from the camera
  moonlit = 0;            // how much Lull lights the night (phase × height in the sky)
  dirL = BODIES.map(() => new THREE.Vector3());   // each far body's direction from the camera (L)
  angL = BODIES.map(() => 0);                      // and its angular radius
  private order = FAR_LIST.slice();
  private dist = new Float64Array(BODIES.length);
  private byDist = (a: number, b: number) => this.dist[a] - this.dist[b];
  uniforms = {
    uBN: { value: 0 },
    uBC: { value: Array.from({ length: FAR_MAX }, () => new THREE.Vector4()) },   // direction from the camera (L), radius / distance
    uBL: { value: Array.from({ length: FAR_MAX }, () => new THREE.Vector4()) },   // direction to the sun from the body (L), shading kind
    uBP: { value: Array.from({ length: FAR_MAX }, () => new THREE.Vector4()) },   // spin pole (L), texture layer
    uBM: { value: Array.from({ length: FAR_MAX }, () => new THREE.Vector4()) },   // prime meridian (L), parent-shine
    uBT: { value: Array.from({ length: FAR_MAX }, () => new THREE.Vector4()) },   // sunlight × air transmission (rgb), haze strength
    uBA: { value: Array.from({ length: FAR_MAX }, () => new THREE.Vector4()) },   // haze colour, ring row (−1 none)
    uBR: { value: Array.from({ length: FAR_MAX }, () => new THREE.Vector4()) },   // ring inner, outer, opacity, relief
    uBK: { value: Array.from({ length: FAR_MAX }, () => new THREE.Vector4()) },   // albedo tint, mean albedo of the map
    uSunL: { value: new THREE.Vector4(0, 1, 0, 1) },   // sun direction from the camera (L), uncovered fraction
    uOccL: { value: new THREE.Vector4(0, -1, 0, 0) },  // Lull: direction (L), angular radius — masks the sun's disc
  };
  private ItoL = new THREE.Matrix3();

  constructor() {
    this.bodies = BODIES.map((def) => ({ def, el: null, pos: v(), rel: v(), pole: v(), mer: v(), m0: v() }));
    for (const b of this.bodies) {
      const o = b.def.orbit;
      if (!o) continue;
      const parent = this.bodies[b.def.parent];
      if (o.equatorial) {   // moons of the giants circle in their parent's equator, like the rings
        const p = this.poleOf(parent);
        o.i = Math.acos(p.z); o.node = Math.atan2(p.x, -p.y);
      }
      const nu = o.L - o.node - o.peri;
      b.el = { a: o.a, e: o.e, i: o.i, node: o.node, peri: o.peri, M0: meanFromTrue(nu, o.e), n: meanMotion(parent.def.GM!, o.a), nodeRate: o.nodeRate };
      if (b.def.spin) { b.pole.copy(this.poleOf(b)); b.m0.set(0, 0, 1).cross(b.pole).normalize(); if (b.m0.lengthSq() < 0.5) b.m0.set(1, 0, 0); }
    }
    this.update(0);
  }
  private poleOf(b: Body) {
    const s = b.def.spin, o = b.def.orbit;
    if (!s || !o) return new THREE.Vector3(0, 0, 1);
    const n = new THREE.Vector3(Math.sin(o.i) * Math.sin(o.node), -Math.sin(o.i) * Math.cos(o.node), Math.cos(o.i));
    return n.multiplyScalar(Math.cos(s.tilt)).add(new THREE.Vector3(Math.cos(s.az), Math.sin(s.az), 0).multiplyScalar(Math.sin(s.tilt))).normalize();
  }

  /** positions, spins and Solenne's orientation at game time t (seconds since day 1, 00:00 at home) */
  update(t: number) {
    this.t = t;
    for (const b of this.bodies) {
      if (!b.el) continue;
      orbitPos(b.el, t, b.rel);
      b.pos.copy(this.bodies[b.def.parent].pos).add(b.rel);
      if (b.def.tidal) {
        orbitPos(b.el, t, b.mer, true).normalize().negate();   // the face that looks home turns at the mean rate: libration
        orbitNormal(b.el, t, b.pole);
      } else if (b.def.spin) {
        const ph = 2 * Math.PI * (t / b.def.spin.period % 1);
        b.mer.copy(b.m0).multiplyScalar(Math.cos(ph)).add(tmp.crossVectors(b.pole, b.m0).multiplyScalar(Math.sin(ph)));
      }
    }
    // Solenne's spin: the home meridian turns past the sun once per clock day (apparent solar time)
    const s = tmp.copy(this.bodies[SOLENNE].pos).negate().normalize();
    const tod = ((t % D) + D) % D / 3600;
    const lam = Math.atan2(s.dot(EQ2), s.dot(EQ1)) + hourAngle(tod);
    const m = tmp2.copy(EQ1).multiplyScalar(Math.cos(lam)).addScaledVector(EQ2, Math.sin(lam));
    const e = tmp3.crossVectors(SPIN_P, m);
    // PF → I maps (AXIS, MERIDIAN, EAST0) onto (pole, meridian now, east now)
    const A = [SPIN_P, m, e], B = [AXIS, MERIDIAN, EAST0], r: number[] = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      let x = 0;
      for (let k = 0; k < 3; k++) x += A[k].getComponent(i) * B[k].getComponent(j);
      r.push(x);
    }
    this.PFtoI.set(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]);
    this.ItoPF.copy(this.PFtoI).transpose();
    this.sunPF.copy(s).applyMatrix3(this.ItoPF);
    return this;
  }

  /** where a body is seen from a planet-fixed point: unit direction in planet-fixed axes, distance */
  dirPF(k: number, fromPF: THREE.Vector3, out = new THREE.Vector3()) {
    const camI = tmp.copy(fromPF).applyMatrix3(this.PFtoI).add(this.bodies[SOLENNE].pos);
    out.copy(this.bodies[k].pos).sub(camI);
    const dist = out.length();
    out.divideScalar(dist).applyMatrix3(this.ItoPF);
    return dist;
  }
  /** fraction of the sun hidden by Lull, seen from a planet-fixed point */
  eclipseAt(fromPF: THREE.Vector3) {
    const dm = this.dirPF(LULL, fromPF, tmp2);
    const rm = Math.asin(this.bodies[LULL].def.radius / dm);
    const sep = Math.acos(Math.min(1, tmp2.dot(this.sunPF)));
    return discOverlap(SUN_ANG, rm, sep);
  }

  /** what the telescope's label says about body k, seen from the camera (call after view()) */
  info(k: number) {
    const b = this.bodies[k], rel = tmp.copy(b.pos).sub(this.camI), dist = rel.length();
    let lit = 1, phase = '';
    if (k !== STAR) {
      const toSun = tmp2.copy(b.pos).negate().normalize();
      lit = 0.5 * (1 - toSun.dot(rel) / dist);
      if (k === LULL) {
        // waxing while Lull stands east of the sun (counter-clockwise about ecliptic north)
        const sol = this.bodies[SOLENNE].pos, waxing = tmp3.copy(sol).negate().cross(tmp2.copy(b.pos).sub(sol)).z > 0;
        phase = lit < 0.03 ? 'New' : lit > 0.97 ? 'Full' : Math.abs(lit - 0.5) < 0.07 ? (waxing ? 'First quarter' : 'Last quarter')
          : `${waxing ? 'Waxing' : 'Waning'} ${lit < 0.5 ? 'crescent' : 'gibbous'}`;
      }
    }
    return { name: b.def.name, about: b.def.about, dist, lit, phase };
  }

  /** refresh the far-pass uniforms for the camera: planet-fixed position, PF → L, altitude */
  view(camPF: THREE.Vector3, PFtoL: THREE.Matrix3, alt: number) {
    const ItoL = this.ItoL.multiplyMatrices(PFtoL, this.ItoPF);
    const sol = this.bodies[SOLENNE];
    this.camI.copy(camPF).applyMatrix3(this.PFtoI).add(sol.pos);
    const U = this.uniforms;
    sunL.copy(this.camI).negate().normalize().applyMatrix3(ItoL);
    U.uSunL.value.set(sunL.x, sunL.y, sunL.z, 1);
    for (const k of FAR_LIST) this.dist[k] = this.bodies[k].pos.distanceTo(this.camI);
    this.order.sort(this.byDist);
    let n = 0;
    for (const k of this.order) {
      const b = this.bodies[k], L = b.def.look!;
      const rel = tmp.copy(b.pos).sub(this.camI), dist = rel.length();
      rel.divideScalar(dist).applyMatrix3(ItoL);
      this.dirL[k].copy(rel);
      const s = b.def.radius / dist;
      this.angL[k] = Math.asin(Math.min(s, 1));
      U.uBC.value[n].set(rel.x, rel.y, rel.z, s);
      // sunlight at the body (softened inverse square), dimmed when its parent eclipses it
      const toSun = tmp2.copy(b.pos).negate(), rs = toSun.length();
      let light = Math.pow(AU / rs, 1.2);
      const par = this.bodies[b.def.parent];
      if (b.def.parent !== STAR) {
        const pd = tmp3.copy(par.pos).sub(b.pos), pl = pd.length();
        const sep = Math.acos(Math.min(1, pd.dot(toSun) / (pl * rs)));
        light *= 1 - discOverlap(Math.asin(STAR_R / rs), Math.asin(par.def.radius / pl), sep);
      }
      toSun.divideScalar(rs).applyMatrix3(ItoL);
      U.uBL.value[n].set(toSun.x, toSun.y, toSun.z, L.kind);
      const pole = tmp2.copy(b.pole).applyMatrix3(ItoL), mer = tmp3.copy(b.mer).applyMatrix3(ItoL);
      U.uBP.value[n].set(pole.x, pole.y, pole.z, L.layer);
      U.uBM.value[n].set(mer.x, mer.y, mer.z, L.shine ?? 0);
      // through Solenne's air: reddened and dimmed toward the horizon
      const col = airColumn(alt, rel.y);
      U.uBT.value[n].set(SUN_SPACE[0] * light * Math.exp(-EXT[0] * col), SUN_SPACE[1] * light * Math.exp(-EXT[1] * col), SUN_SPACE[2] * light * Math.exp(-EXT[2] * col), L.haze?.[3] ?? 0);
      U.uBA.value[n].set(L.haze?.[0] ?? 0, L.haze?.[1] ?? 0, L.haze?.[2] ?? 0, L.ring ? L.ring[2] : -1);
      U.uBR.value[n].set(L.ring?.[0] ?? 0, L.ring?.[1] ?? 0, L.ring?.[3] ?? 0, (L.relief ?? 0) * MAP_RANGE[L.layer]);
      U.uBK.value[n].set(L.tint[0], L.tint[1], L.tint[2], MAP_ALBEDO[L.layer]);
      if (k === LULL) {
        const ang = Math.asin(s);
        U.uOccL.value.set(rel.x, rel.y, rel.z, ang);
        // eclipse: Lull over the sun's disc
        const sep = Math.acos(Math.min(1, rel.x * sunL.x + rel.y * sunL.y + rel.z * sunL.z));
        this.eclipse = 1 - discOverlap(SUN_ANG, ang, sep);
        U.uSunL.value.w = this.eclipse;
        // moonlight: lit fraction toward us, height in the sky, air in the way
        const lit = 0.5 * (1 - (toSun.x * rel.x + toSun.y * rel.y + toSun.z * rel.z));
        this.moonlit = lit * light * smoothstep(-0.03, 0.2, rel.y) * Math.exp(-EXT[1] * col);
      }
      n++;
    }
    U.uBN.value = n;
  }
}
export const bodyIndex = (name: string) => BODIES.findIndex((b) => b.name.toLowerCase() === name.toLowerCase());
