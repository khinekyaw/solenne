import * as THREE from 'three';
import { mulberry32, smoothstep } from '../core/math';

/* =========================================================================
   Ruins softened by a million years, built from code like the cottage:
   stacked, slightly slumped blocks, broken tops, fallen stones, ivy. Kit
   coords: metres, y up, origin at ground level; foundations reach below 0.
   aInfo: x = kind (0 dressed stone, 1 rough stone, 2 leaves, 3 ceramic,
   4 brass, 5 light), y = tint seed, z = drift phase of a floating piece (0:
   it stays put), w = light from the Gate's seam falling on it. aPivot: the
   floating piece's centre, which it turns about.
   ========================================================================= */
export type Kit = {
  geo: THREE.BufferGeometry;
  boxes: number[][];          // collision AABBs in kit xz: x0, z0, x1, z1
  circles: number[][];        // collision circles: x, z, r
  floor?: (x: number, z: number) => number;   // walkable top surface (kit y), or -1e9
};
const C = (hex: string) => new THREE.Color(hex);
const STONE = [C('#b8b0a1'), C('#a39c8f'), C('#958f84'), C('#aaa294')];
const DARK = C('#7c776d'), LEAF = C('#3d6b3a'), LEAF2 = C('#2c5232');
const CERAMIC = C('#e9e4d8'), BRASS = C('#a8874f'), SEAM = C('#8ff0d8'), ROOT = C('#4a3d30');

function builder(seed: number) {
  const R = mulberry32(seed), rr = (a: number, b: number) => a + (b - a) * R();
  const P: number[] = [], N: number[] = [], CC: number[] = [], I: number[] = [], PV: number[] = [];
  const m4 = new THREE.Matrix4(), nm = new THREE.Matrix3(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const v = new THREE.Vector3(), n = new THREE.Vector3(), sc = new THREE.Vector3();
  const mtx = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1) => m4.clone().compose(v.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz, 'YXZ')), sc.set(s, s, s));
  type Opt = { drift?: number; pivot?: THREE.Vector3; lit?: (p: THREE.Vector3) => number };
  function add(geo: THREE.BufferGeometry, mat: THREE.Matrix4, color: THREE.Color, kind: number, o: Opt = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pa = g.attributes.position, na = g.attributes.normal;
    nm.getNormalMatrix(mat);
    const tint = R(), pv = o.pivot;
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(mat); n.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
      P.push(v.x, v.y, v.z); N.push(n.x, n.y, n.z); CC.push(color.r, color.g, color.b); I.push(kind, tint, o.drift ?? 0, o.lit ? o.lit(v) : 0);
      PV.push(pv ? pv.x : 0, pv ? pv.y : 0, pv ? pv.z : 0);
    }
  }
  const stone = () => STONE[Math.floor(R() * STONE.length)];
  const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.Color, kind = 0, rx = 0, ry = 0, rz = 0) =>
    add(new THREE.BoxGeometry(sx, sy, sz), mtx(x, y, z, rx, ry, rz), color, kind);
  const cyl = (x: number, y: number, z: number, r0: number, r1: number, h: number, seg: number, color: THREE.Color, kind = 0, rx = 0, ry = 0, rz = 0) =>
    add(new THREE.CylinderGeometry(r0, r1, h, seg), mtx(x, y, z, rx, ry, rz), color, kind);
  const leaf = (x: number, y: number, z: number, r: number) =>
    add(new THREE.IcosahedronGeometry(r, 0), mtx(x, y, z, rr(0, 3), rr(0, 3), rr(0, 3)), R() < 0.6 ? LEAF2 : LEAF, 2);
  /** a fallen block lying on the ground, half sunk */
  const fallen = (x: number, z: number, s = 1) => box(x, rr(0.05, 0.2) * s, z, rr(0.5, 0.9) * s, rr(0.35, 0.5) * s, rr(0.4, 0.8) * s, stone(), 0, rr(-0.3, 0.3), rr(0, 3), rr(-0.25, 0.25));
  function finish(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(CC, 3));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(I, 4));
    g.setAttribute('aPivot', new THREE.Float32BufferAttribute(PV, 3));
    g.computeBoundingSphere();
    return g;
  }
  return { R, rr, add, mtx, box, cyl, leaf, fallen, stone, finish };
}

/** a broken wall with a round arch you can walk through */
function archWall(): Kit {
  const b = builder(11), L = 9, T = 0.85, course = 0.42, bl = 0.75, ar = 1.15, spring = 2.2;
  const top = (x: number) => 4.7 - 2.1 * Math.abs(Math.sin(x * 0.55 + 1.3)) - (Math.abs(x) > 3.4 ? 1.3 : 0) - 0.4 * smoothstep(2.5, 4.5, -x);
  b.box(0, -1.2, 0, L + 0.5, 2.5, T + 0.35, DARK, 1);
  for (let r = 0; r < 12; r++) {
    const y = r * course, off = (r % 2) * bl / 2;
    for (let x = -L / 2 - off; x < L / 2; x += bl) {
      const cx = Math.max(-L / 2 + bl / 2, Math.min(L / 2 - bl / 2, x + bl / 2));
      if (Math.abs(cx) < ar + 0.05 && (y < spring || Math.hypot(cx, y - spring) < ar + 0.05)) continue;
      if (y > top(cx) + b.rr(-0.2, 0.3)) continue;
      b.box(cx + b.rr(-0.03, 0.03), y + course / 2, b.rr(-0.04, 0.04), bl * 0.96, course * 0.94, T * b.rr(0.9, 1.02), b.stone(), 0, 0, b.rr(-0.04, 0.04), b.rr(-0.03, 0.03));
    }
  }
  // voussoirs round the arch
  for (let k = 0; k <= 8; k++) {
    const a = Math.PI * k / 8;
    b.box(Math.cos(a) * (ar + 0.22), spring + Math.sin(a) * (ar + 0.22), 0, 0.42, 0.38, T + 0.08, b.stone(), 0, 0, 0, a - Math.PI / 2);
  }
  for (let i = 0; i < 12; i++) b.fallen(b.rr(-5.5, 5.5), b.rr(0.8, 3.2) * (b.R() < 0.5 ? -1 : 1));
  for (let i = 0; i < 70; i++) { const x = b.rr(-L / 2, L / 2); b.leaf(x, Math.max(0.2, top(x) * b.rr(0.3, 1.0)), (T / 2 + 0.05) * (b.R() < 0.5 ? -1 : 1), b.rr(0.12, 0.22)); }
  return { geo: b.finish(), boxes: [[-L / 2, -T / 2, -ar - 0.05, T / 2], [ar + 0.05, -T / 2, L / 2, T / 2]], circles: [] };
}

/** columns on an arc, most of them broken, one lying in drums on the grass */
function colonnade(): Kit {
  const b = builder(23), circles: number[][] = [];
  const cols = 7, rad = 7, span = 1.9;
  const intact = [false, true, true, false, false, true, false];
  for (let i = 0; i < cols; i++) {
    const a = -span / 2 + span * i / (cols - 1), x = Math.sin(a) * rad, z = -Math.cos(a) * rad + rad;
    b.box(x, -0.5, z, 1.15, 1.2, 1.15, DARK, 1);
    b.box(x, 0.17, z, 1.05, 0.22, 1.05, b.stone(), 0, 0, b.rr(-0.1, 0.1));
    const h = intact[i] ? 4.3 : b.rr(0.7, 3.2);
    let y = 0.28;
    while (y < h) { const dh = Math.min(0.72, h - y); b.cyl(x + b.rr(-0.03, 0.03), y + dh / 2, z + b.rr(-0.03, 0.03), 0.34, 0.36, dh * 0.97, 14, b.stone(), 0, 0, b.rr(0, 3)); y += dh; }
    if (intact[i]) b.box(x, h + 0.16, z, 0.95, 0.3, 0.95, b.stone(), 0, 0, a);
    circles.push([x, z, 0.5]);
  }
  // an architrave still resting on two neighbours
  { const a1 = -span / 2 + span / 6, a2 = -span / 2 + span * 2 / 6, x = (Math.sin(a1) + Math.sin(a2)) * rad / 2, z = rad - (Math.cos(a1) + Math.cos(a2)) * rad / 2;
    b.box(x, 4.75, z, 2.5, 0.45, 0.62, b.stone(), 0, 0, -(a1 + a2) / 2); }
  // the fallen one
  for (let k = 0; k < 6; k++) b.cyl(-2.2 + k * 0.74 + b.rr(-0.05, 0.08), 0.22, 3.6 + k * 0.12, 0.34, 0.36, 0.7, 14, b.stone(), 0, b.rr(-0.1, 0.1), 0.15, Math.PI / 2 + b.rr(-0.08, 0.08));
  for (let i = 0; i < 9; i++) b.fallen(b.rr(-6, 6), b.rr(0.5, 7), 0.8);
  for (let i = 0; i < 40; i++) { const c = circles[Math.floor(b.R() * cols)]; b.leaf(c[0] + b.rr(-0.4, 0.4), b.rr(0.2, 1.6), c[1] + b.rr(-0.4, 0.4), b.rr(0.1, 0.2)); }
  return { geo: b.finish(), boxes: [], circles };
}

/** the stump of a round tower, tall on one side, with a doorway */
function towerStump(): Kit {
  const b = builder(37), rad = 3.2, T = 0.9, course = 0.45, circles: number[][] = [];
  const top = (a: number) => 1.4 + 5.6 * Math.pow(Math.max(Math.cos(a - 2.2), 0), 1.6) + 0.6 * Math.sin(a * 5.0);
  b.cyl(0, -1.2, 0, rad + 0.7, rad + 0.8, 2.5, 20, DARK, 1);
  for (let r = 0; r < 18; r++) {
    const y = r * course, step = 0.78 / rad, off = (r % 2) * step / 2;
    for (let a = off; a < Math.PI * 2 + off - 1e-3; a += step) {
      if (y < 2.4 && Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.24) continue;   // the doorway faces +x
      if (y > top(a) + b.rr(-0.25, 0.25)) continue;
      b.box(Math.cos(a) * rad, y + course / 2, Math.sin(a) * rad, T * b.rr(0.92, 1.02), course * 0.94, 0.78, b.stone(), 0, 0, -a + b.rr(-0.04, 0.04), b.rr(-0.03, 0.03));
    }
  }
  for (let a = 0.3; a < Math.PI * 2 - 0.3; a += 0.26) circles.push([Math.cos(a) * rad, Math.sin(a) * rad, 0.62]);
  for (let i = 0; i < 14; i++) { const a = b.rr(0, 6.28), d = b.rr(0, 2.2); b.fallen(Math.cos(a) * d, Math.sin(a) * d, 0.9); }
  for (let i = 0; i < 10; i++) { const a = b.rr(0, 6.28), d = b.rr(4.2, 6.5); b.fallen(Math.cos(a) * d, Math.sin(a) * d); }
  for (let i = 0; i < 90; i++) { const a = b.rr(0, 6.28); b.leaf(Math.cos(a) * (rad + 0.5), b.rr(0.2, top(a) * 0.9), Math.sin(a) * (rad + 0.5), b.rr(0.12, 0.24)); }
  return { geo: b.finish(), boxes: [], circles };
}

/** a stepped temple floor with missing slabs and a weathered figure */
function plinth(): Kit {
  const b = builder(53), steps = [[10, 7], [9.2, 6.2], [8.4, 5.4]], sh = 0.22, circles: number[][] = [];
  b.box(0, -1.0, 0, 10.4, 2.0, 7.4, DARK, 1);
  steps.forEach(([w, d], s) => {
    for (let x = -w / 2; x < w / 2 - 0.01; x += 1.4) for (let z = -d / 2; z < d / 2 - 0.01; z += 1.4) {
      if (s === 2 && b.R() < 0.14) continue;   // lost slabs on the top floor
      const sx = Math.min(1.4, w / 2 - x), sz = Math.min(1.4, d / 2 - z);
      b.box(x + sx / 2, s * sh + sh / 2 + b.rr(-0.02, 0.03), z + sz / 2, sx * 0.97, sh, sz * 0.97, b.stone(), 0, b.rr(-0.03, 0.03), 0, b.rr(-0.03, 0.03));
    }
  });
  for (const [x, z] of [[-3, -1.8], [3, -1.8], [-3, 1.8], [3, 1.8]]) {
    const h = b.rr(0.5, 2.6);
    b.cyl(x, 3 * sh + h / 2, z, 0.38, 0.4, h, 14, b.stone(), 0, 0, b.rr(0, 3));
    circles.push([x, z, 0.5]);
  }
  // a figure worn down to a soft shape: plinth, body, a head bowed toward the doorway
  b.box(0, 3 * sh + 0.5, -1.2, 1.2, 1.0, 1.2, b.stone());
  b.cyl(0, 3 * sh + 1.65, -1.2, 0.42, 0.55, 1.3, 12, b.stone());
  b.cyl(0.05, 3 * sh + 2.55, -1.12, 0.3, 0.3, 0.55, 10, b.stone(), 0, 0.35, 0, 0.1);
  circles.push([0, -1.2, 0.85]);
  for (let i = 0; i < 8; i++) b.fallen(b.rr(-6, 6), b.rr(3.8, 6) * (b.R() < 0.5 ? -1 : 1));
  for (let i = 0; i < 50; i++) b.leaf(b.rr(-4.5, 4.5), b.rr(0.5, 0.75), b.rr(-3, 3), b.rr(0.08, 0.18));
  const floor = (x: number, z: number) => {
    for (let s = 2; s >= 0; s--) { const [w, d] = steps[s]; if (Math.abs(x) < w / 2 && Math.abs(z) < d / 2) return (s + 1) * sh; }
    return -1e9;
  };
  return { geo: b.finish(), boxes: [], circles, floor };
}

/* ---- the Gate (docs/concepts/ruins-gate-sheet-*.jpg): a giant ring of the old civilisation, leaning back half
   sunk in a mound, pearl ceramic with brass inlay, its inner face one recessed channel of soft light; arcs of a
   second, larger ring and loose chips hang in the air around it and drift ---- */

/** a profile (r, y pairs) swept round the z axis from a0 to a1: a ring band in its own frame. The profile runs with
    the solid on its right, so (−dy, dr) points out; corners sharper than 50° stay crisp. Ends are capped if asked */
function sweep(prof: [number, number][], a0: number, a1: number, seg: number, closed = false, caps = false) {
  const pts = closed ? [...prof, prof[0]] : prof, ns = pts.length - 1;
  const sn: [number, number][] = [];
  for (let i = 0; i < ns; i++) { const dr = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], l = Math.hypot(dr, dy) || 1; sn.push([-dy / l, dr / l]); }
  const vn = (i: number, end: boolean): [number, number] => {   // the normal at a segment's start or end
    const j = end ? i + 1 : i - 1, k = closed ? (j + ns) % ns : j;
    if (k < 0 || k >= ns) return sn[i];
    const a = sn[i], b = sn[k];
    if (a[0] * b[0] + a[1] * b[1] < Math.cos(50 * Math.PI / 180)) return a;
    const x = a[0] + b[0], y = a[1] + b[1], l = Math.hypot(x, y);
    return [x / l, y / l];
  };
  const P: number[] = [], N: number[] = [];
  const at = (r: number, y: number, t: number) => [r * Math.cos(t), r * Math.sin(t), y];
  const nat = (n: [number, number], t: number) => [n[0] * Math.cos(t), n[0] * Math.sin(t), n[1]];
  const tri = (p: number[][], n: number[][]) => {
    // wind it facing its normals
    const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const s = c[0] * (n[0][0] + n[1][0] + n[2][0]) + c[1] * (n[0][1] + n[1][1] + n[2][1]) + c[2] * (n[0][2] + n[1][2] + n[2][2]);
    const o = s < 0 ? [0, 2, 1] : [0, 1, 2];
    for (const k of o) { P.push(...p[k]); N.push(...n[k]); }
  };
  for (let j = 0; j < seg; j++) {
    const t0 = a0 + (a1 - a0) * j / seg, t1 = a0 + (a1 - a0) * (j + 1) / seg;
    for (let i = 0; i < ns; i++) {
      const [ra, ya] = pts[i], [rb, yb] = pts[i + 1], na = vn(i, false), nb = vn(i, true);
      const p = [at(ra, ya, t0), at(rb, yb, t0), at(rb, yb, t1), at(ra, ya, t1)], n = [nat(na, t0), nat(nb, t0), nat(nb, t1), nat(na, t1)];
      tri([p[0], p[1], p[2]], [n[0], n[1], n[2]]); tri([p[0], p[2], p[3]], [n[0], n[2], n[3]]);
    }
  }
  if (caps) for (const [t, s] of [[a0, -1], [a1, 1]] as const) {   // broken ends: the profile filled in, facing along the arc
    const cr = prof.reduce((a, q) => a + q[0], 0) / prof.length, cy = prof.reduce((a, q) => a + q[1], 0) / prof.length;
    const nn = [-Math.sin(t) * s, Math.cos(t) * s, 0];
    for (let i = 0; i < ns; i++) tri([at(cr, cy, t), at(pts[i][0], pts[i][1], t), at(pts[i + 1][0], pts[i + 1][1], t)], [nn, nn, nn]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  return g;
}
/** a rounded rectangle in (r, y), solid on the right: r0…r1 by y0…y1, corner radius c */
function roundRect(r0: number, r1: number, y0: number, y1: number, c: number, steps = 4): [number, number][] {
  const out: [number, number][] = [];
  const corner = (cr: number, cy: number, from: number) => { for (let k = 0; k <= steps; k++) { const a = from - (Math.PI / 2) * k / steps; out.push([cr + c * Math.cos(a), cy + c * Math.sin(a)]); } };
  corner(r0 + c, y1 - c, Math.PI); corner(r1 - c, y1 - c, Math.PI / 2); corner(r1 - c, y0 + c, 0); corner(r0 + c, y0 + c, -Math.PI / 2);
  return out;
}

function gate(): Kit {
  const b = builder(71);
  const RI = 10.8, RO = 15.5, T = 4.2, CR = 0.9, HC = 1.25, DC = 0.7, CY = 11, TILT = -0.26;
  const ring = new THREE.Matrix4().makeTranslation(0, CY, 0).multiply(new THREE.Matrix4().makeRotationX(TILT)), inv = ring.clone().invert();
  const loc = new THREE.Vector3();
  // the seam's light on the ring itself and on what grows on it
  const lit = (p: THREE.Vector3) => { loc.copy(p).applyMatrix4(inv); const d = Math.hypot(Math.hypot(loc.x, loc.y) - RI - 0.3, loc.z); return Math.exp(-d / 1.3); };
  const S = 96;
  // the casing: the band's outside, open where the channel runs round its inner face
  const casing: [number, number][] = [[RI, HC], [RI, T / 2 - CR]];
  for (let k = 1; k <= 4; k++) { const a = Math.PI - (Math.PI / 2) * k / 4; casing.push([RI + CR + CR * Math.cos(a), T / 2 - CR + CR * Math.sin(a)]); }
  for (let k = 0; k <= 4; k++) { const a = Math.PI / 2 - (Math.PI / 2) * k / 4; casing.push([RO - CR + CR * Math.cos(a), T / 2 - CR + CR * Math.sin(a)]); }
  for (let k = 0; k <= 4; k++) { const a = -(Math.PI / 2) * k / 4; casing.push([RO - CR + CR * Math.cos(a), -T / 2 + CR + CR * Math.sin(a)]); }
  for (let k = 0; k <= 4; k++) { const a = -Math.PI / 2 - (Math.PI / 2) * k / 4; casing.push([RI + CR + CR * Math.cos(a), -T / 2 + CR + CR * Math.sin(a)]); }
  casing.push([RI, -HC]);
  b.add(sweep(casing, 0, Math.PI * 2, S), ring, CERAMIC, 3, { lit });
  // the channel: brass walls, and its floor of light
  b.add(sweep([[RI, -HC], [RI + DC, -HC]], 0, Math.PI * 2, S), ring, BRASS, 4, { lit });
  b.add(sweep([[RI + DC, HC], [RI, HC]], 0, Math.PI * 2, S), ring, BRASS, 4, { lit });
  b.add(sweep([[RI + DC, -HC], [RI + DC, HC]], 0, Math.PI * 2, S), ring, SEAM, 5);
  // brass lips round the channel's mouth
  for (const s of [1, -1]) b.add(sweep(s > 0 ? [[RI - 0.14, HC], [RI - 0.14, HC + 0.32], [RI + 0.1, HC + 0.32], [RI + 0.1, HC]] : [[RI - 0.14, -HC - 0.32], [RI - 0.14, -HC], [RI + 0.1, -HC], [RI + 0.1, -HC - 0.32]], 0, Math.PI * 2, S, true), ring, BRASS, 4, { lit });
  // a brass joint wrapped round the band every 45°
  const band = casing.map(([r, y]) => [r + Math.sign(r - (RI + RO) / 2) * 0.06 * (Math.abs(y) < T / 2 - CR ? 1 : 0.7), y + Math.sign(y) * 0.06 * (r > RI + 0.2 && r < RO - 0.2 ? 1 : 0.7)] as [number, number]);
  for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; b.add(sweep(band, a - 0.012, a + 0.012, 1), ring, BRASS, 4, { lit }); }
  // circle glyphs on the face
  for (const [a, z, rad] of [[1.05, 1, 1.15], [2.6, 1, 0.8], [0.35, -1, 1.0]] as const) {
    const rm = (RI + RO) / 2, m = ring.clone().multiply(new THREE.Matrix4().makeTranslation(rm * Math.cos(a), rm * Math.sin(a), z * (T / 2 + 0.02)));
    b.add(new THREE.TorusGeometry(rad, 0.08, 5, 28), m, BRASS, 4, { lit });
    b.add(new THREE.TorusGeometry(rad * 0.45, 0.06, 5, 20), m, BRASS, 4, { lit });
  }
  // the outer ring's arcs, each turned a little out of the plane, with chips loosened from their broken ends
  const R2 = 20.5, arcProf = roundRect(R2 - 1.15, R2 + 1.15, -1.25, 1.25, 0.55);
  for (const [a0, a1, tz, tw] of [[-0.42, 0.12, 1.6, 0.1], [0.5, 1.08, -1.2, -0.08], [1.66, 2.12, 2.2, 0.06], [2.6, 3.22, -0.6, -0.12]] as const) {
    const am = (a0 + a1) / 2;
    const m = ring.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, tz)).multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(Math.cos(am), Math.sin(am), 0), tw));
    const pivot = new THREE.Vector3(R2 * Math.cos(am), R2 * Math.sin(am), 0).applyMatrix4(m), drift = b.rr(0.1, 1);
    b.add(sweep(arcProf, a0, a1, 18, true, true), m, CERAMIC, 3, { drift, pivot });
    b.add(sweep([[R2 - 0.5, 1.27], [R2 - 0.5, 1.33], [R2 - 0.3, 1.33], [R2 - 0.3, 1.27]], a0 + 0.04, a1 - 0.04, 18, true), m, BRASS, 4, { drift, pivot });
    for (const ae of [a0, a1]) for (let k = 0; k < 3; k++) {
      const out = ae + (ae === a0 ? -1 : 1) * b.rr(0.03, 0.09), c = new THREE.Vector3((R2 + b.rr(-1.5, 1.5)) * Math.cos(out), (R2 + b.rr(-1.5, 1.5)) * Math.sin(out), b.rr(-1.5, 1.5)).applyMatrix4(m);
      const s = b.rr(0.25, 0.7);
      b.add(new THREE.BoxGeometry(s, s * b.rr(0.5, 1), s * b.rr(0.4, 0.9)), b.mtx(c.x, c.y, c.z, b.rr(0, 3), b.rr(0, 3), b.rr(0, 3)), b.R() < 0.75 ? CERAMIC : DARK, b.R() < 0.75 ? 3 : 1, { drift: b.rr(0.1, 1), pivot: c });
    }
  }
  // the mound it has sunk into, fallen blocks and boulders, roots
  b.add(new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), b.mtx(0, -1.6, 2.6, 0, 0, 0).multiply(new THREE.Matrix4().makeScale(14, 3.9, 8)), DARK, 1, { lit });
  for (let i = 0; i < 14; i++) {
    const s = b.rr(-1, 1), x = s * b.rr(6, 14), z = b.rr(-2, 8), r = b.rr(0.7, 2.0);
    b.add(new THREE.IcosahedronGeometry(r, 1), b.mtx(x, r * 0.3, z, b.rr(0, 3), b.rr(0, 3), b.rr(0, 3)).multiply(new THREE.Matrix4().makeScale(1, b.rr(0.55, 0.85), 1)), b.stone(), 1, { lit });
  }
  for (let i = 0; i < 6; i++) { const x = b.rr(-13, 13), z = b.rr(4, 11); b.box(x, 0.3, z, b.rr(1.2, 2.6), b.rr(0.6, 1.0), b.rr(1.0, 2.0), CERAMIC, 3, b.rr(-0.2, 0.2), b.rr(0, 3), b.rr(-0.2, 0.2)); }
  for (let i = 0; i < 9; i++) { const a = b.rr(0, Math.PI * 2), l = b.rr(3, 6); b.cyl(Math.cos(a) * 8 + Math.cos(a) * l / 2, 0.12, 2.5 + Math.sin(a) * 4 + Math.sin(a) * l / 2, 0.08, 0.2, l, 5, ROOT, 1, 0, -a, Math.PI / 2); }
  // ivy: clumps over the lower third, thinning upward, and strands hanging from them down the faces and the outside
  const lp = new THREE.Vector3(), ivy = (r: number, t: number, z: number, s: number) => {
    lp.set(r * Math.cos(t), r * Math.sin(t), z).applyMatrix4(ring);
    if (lp.y < 0.3) return;
    b.add(new THREE.IcosahedronGeometry(s, 0), b.mtx(lp.x, lp.y, lp.z, b.rr(0, 3), b.rr(0, 3), b.rr(0, 3)), b.R() < 0.5 ? LEAF2 : LEAF, 2, { lit });
  };
  for (let c = 0; c < 70; c++) {
    const t = -Math.PI / 2 + (b.R() < 0.5 ? -1 : 1) * b.rr(0.45, 1.75) * Math.pow(b.R(), 0.5), out = b.R() < 0.4;
    const r = out ? RO + 0.15 : b.rr(RI + 0.7, RO - 0.4), zs = b.R() < 0.65 ? 1 : -1, size = b.rr(0.8, 1.8);
    for (let k = 0; k < 34; k++) {
      const dt = b.rr(-1, 1) * size / r;
      ivy(out ? r : r + b.rr(-1, 1) * size, t + dt, out ? b.rr(-T / 2, T / 2) : zs * (T / 2 + 0.12), b.rr(0.16, 0.34));
    }
    // a strand trailing down from the clump
    if (b.R() < 0.6) { const n = Math.floor(b.rr(6, 16)); for (let k = 0; k < n; k++) ivy(out ? r : r - k * 0.0, t + (t < -Math.PI / 2 ? 1 : -1) * k * 0.022 * (1 + b.rr(-0.3, 0.3)), out ? b.rr(-0.6, 0.6) : zs * (T / 2 + 0.12), b.rr(0.14, 0.26)); }
  }
  // the band's foot is a wall to the walker (the opening starts above the mound)
  return { geo: b.finish(), boxes: [[-11, 0.4, 11, 5.4]], circles: [] };
}

export const buildKits = (): Kit[] => [archWall(), colonnade(), towerStump(), plinth(), gate()];
/** kits the scattered sites draw from (the Gate stands only where it was placed) */
export const RANDOM_KITS = 4;
