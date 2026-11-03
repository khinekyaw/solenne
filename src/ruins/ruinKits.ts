import * as THREE from 'three';
import { mulberry32, smoothstep } from '../core/math';

/* =========================================================================
   Ruins softened by a million years, built from code like the cottage:
   stacked, slightly slumped blocks, broken tops, fallen stones, ivy. Kit
   coords: metres, y up, origin at ground level; foundations reach below 0.
   aInfo: x = kind (0 dressed stone, 1 rough stone, 2 leaves), y = tint seed.
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

function builder(seed: number) {
  const R = mulberry32(seed), rr = (a: number, b: number) => a + (b - a) * R();
  const P: number[] = [], N: number[] = [], CC: number[] = [], I: number[] = [];
  const m4 = new THREE.Matrix4(), nm = new THREE.Matrix3(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const v = new THREE.Vector3(), n = new THREE.Vector3(), sc = new THREE.Vector3();
  const mtx = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1) => m4.clone().compose(v.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz, 'YXZ')), sc.set(s, s, s));
  function add(geo: THREE.BufferGeometry, mat: THREE.Matrix4, color: THREE.Color, kind: number) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pa = g.attributes.position, na = g.attributes.normal;
    nm.getNormalMatrix(mat);
    const tint = R();
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(mat); n.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
      P.push(v.x, v.y, v.z); N.push(n.x, n.y, n.z); CC.push(color.r, color.g, color.b); I.push(kind, tint, 0, 0);
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
    g.computeBoundingSphere();
    return g;
  }
  return { R, rr, box, cyl, leaf, fallen, stone, finish };
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

export const buildKits = (): Kit[] => [archWall(), colonnade(), towerStump(), plinth()];
