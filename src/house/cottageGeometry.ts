import * as THREE from 'three';
import { lerp, mulberry32 } from '../core/math';

/* =========================================================================
   The cottage: half-timbered walls, steep tiled roof, stone chimney,
   furnished interior. Built from code in house-local metres (floor top =
   y 0, front door faces local +z), merged into one mesh (prototype, 1:1).
   ========================================================================= */
export const CW = 8, CD = 6, CH = 2.7, CT = 0.24, CPITCH = 0.88;
export const CTAN = Math.tan(CPITCH), CRIDGE = CH + (CD / 2) * CTAN;
export const DOOR_X = -0.6, DOOR_W = 1.0, DOOR_H = 2.25;
export const innerX = CW / 2 - CT, innerZ = CD / 2 - CT;
export const chZ = -1.0, fx = -innerX, chTop = CRIDGE + 1.1;
export const lampL: [number, number, number] = [-1.2, 2.05, 0.2];
export const FENCE = [[5.0, -0.6], [7.6, -0.6], [7.6, 3.4], [5.4, 3.4]];
const C = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);
const PAL = {
  plaster: C('#efe2c8', 0.82), timber: C('#4a3424'), wood: C('#9a6a43'), woodLight: C('#b88a5c'), woodDark: C('#5e3f29'),
  stone: C('#a49d90'), stoneDark: C('#6f6a62'), roof: C('#a4553f', 0.9), roofDark: C('#7e3b2c'), door: C('#3f6f62'),
  frame: C('#ece4d2'), soot: C('#2a2420'), iron: C('#33302d'), cream: C('#f1e7d2'), quilt: C('#c7714f'), rug: C('#9a4535'),
  leaf: C('#3d6b3a'), leafDark: C('#2c5232'), pink: C('#ec8fa6'), yellow: C('#f2c24a'), white: C('#f4f1ea'), blue: C('#7fa6dc'),
};
type O = { grain?: number; ao?: number; mode?: 'auto' | 'in' | 'out'; rx?: number; ry?: number; rz?: number; detail?: number; sx?: number; sy?: number; sz?: number };

/** gLocal: ground height relative to the floor at house-local x, z */
export function buildCottageGeometry(gLocal: (lx: number, lz: number) => number, plinthBot: number) {
  const R = mulberry32(7), rr = (a: number, b: number) => a + (b - a) * R();
  const P: number[] = [], NN: number[] = [], CC: number[] = [], II: number[] = [];
  const gP: number[] = [], gN: number[] = [];
  const m4 = new THREE.Matrix4(), nm = new THREE.Matrix3(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const v = new THREE.Vector3(), n = new THREE.Vector3(), ctr = new THREE.Vector3(), fn = new THREE.Vector3(), sc = new THREE.Vector3();
  const inRoom = (p: THREE.Vector3) => Math.abs(p.x) < innerX + 0.01 && Math.abs(p.z) < innerZ + 0.01 && p.y > -0.1 && p.y < CRIDGE - Math.abs(p.z) * CTAN + 0.01;
  const mtx = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => m4.clone().compose(v.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz, 'YXZ')), sc.set(sx, sy, sz));

  function add(geo: THREE.BufferGeometry, mat: THREE.Matrix4, color: THREE.Color, kind: number, o: O = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    const pa = g.attributes.position, na = g.attributes.normal;
    nm.getNormalMatrix(mat);
    const grain = o.grain ?? 0, ao = o.ao ?? 1, mode = o.mode ?? 'auto';
    const tri = new Float32Array(18);
    for (let i = 0; i + 2 < pa.count; i += 3) {
      ctr.set(0, 0, 0); fn.set(0, 0, 0);
      for (let k = 0; k < 3; k++) {
        v.fromBufferAttribute(pa, i + k).applyMatrix4(mat);
        n.fromBufferAttribute(na, i + k).applyMatrix3(nm).normalize();
        tri.set([v.x, v.y, v.z, n.x, n.y, n.z], k * 6);
        ctr.add(v); fn.add(n);
      }
      ctr.multiplyScalar(1 / 3); fn.normalize();
      const indoor = mode === 'in' ? 1 : mode === 'out' ? 0 : (inRoom(ctr.clone().addScaledVector(fn, 0.12)) ? 1 : 0);
      for (let k = 0; k < 3; k++) {
        P.push(tri[k * 6], tri[k * 6 + 1], tri[k * 6 + 2]); NN.push(tri[k * 6 + 3], tri[k * 6 + 4], tri[k * 6 + 5]);
        CC.push(color.r, color.g, color.b); II.push(kind, grain, indoor, ao);
      }
    }
  }
  const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.Color, kind: number, o: O = {}) => add(new THREE.BoxGeometry(sx, sy, sz), mtx(x, y, z, o.rx, o.ry, o.rz), color, kind, o);
  const cyl = (x: number, y: number, z: number, r0: number, r1: number, h: number, seg: number, color: THREE.Color, kind: number, o: O = {}) => add(new THREE.CylinderGeometry(r0, r1, h, seg), mtx(x, y, z, o.rx, o.ry, o.rz), color, kind, o);
  const blob = (x: number, y: number, z: number, r: number, color: THREE.Color, kind: number, o: O = {}) => add(new THREE.IcosahedronGeometry(r, o.detail ?? 0), mtx(x, y, z, o.rx, o.ry, o.rz, o.sx ?? 1, o.sy ?? 1, o.sz ?? 1), color, kind, o);
  function glassShape(shape: THREE.Shape, mat: THREE.Matrix4) {
    const g = new THREE.ShapeGeometry(shape, 12).toNonIndexed(); g.applyMatrix4(mat); g.computeVertexNormals();
    const pa = g.attributes.position, na = g.attributes.normal;
    for (let i = 0; i < pa.count; i++) { gP.push(pa.getX(i), pa.getY(i), pa.getZ(i)); gN.push(na.getX(i), na.getY(i), na.getZ(i)); }
  }

  // ---- wall frames: x along the wall, y up, z pointing outward from the house ----
  const WALLS: Record<string, THREE.Matrix4> = {
    front: m4.clone().makeTranslation(0, 0, CD / 2),
    back: new THREE.Matrix4().makeTranslation(0, 0, -CD / 2).multiply(new THREE.Matrix4().makeRotationY(Math.PI)),
    right: new THREE.Matrix4().makeTranslation(CW / 2, 0, 0).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)),
    left: new THREE.Matrix4().makeTranslation(-CW / 2, 0, 0).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2)),
  };
  const onWall = (w: string, x: number, y: number, z: number, rz = 0) => WALLS[w].clone().multiply(mtx(x, y, z, 0, 0, rz));
  const arch = <T extends THREE.Path>(path: T, cx: number, y0: number, w: number, h: number, hole: boolean) => {
    const r = w / 2, ay = y0 + h - r;
    if (hole) { path.moveTo(cx - r, y0); path.lineTo(cx + r, y0); path.lineTo(cx + r, ay); path.absarc(cx, ay, r, 0, Math.PI, false); path.lineTo(cx - r, y0); }
    return path;
  };
  function windowUnit(w: string, cx: number, sill: number, ww: number, wh: number, round: boolean) {
    // frame ring, mullions, sill and glass, sitting in the middle of the wall thickness
    const outer = new THREE.Shape(), inner = new THREE.Path();
    if (round) { outer.absarc(cx, sill, ww / 2 + 0.07, 0, Math.PI * 2, false); inner.absarc(cx, sill, ww / 2 - 0.03, 0, Math.PI * 2, true); }
    else {
      arch(outer, cx, sill - 0.07, ww + 0.14, wh + 0.14, true);
      const r = ww / 2, ay = sill + wh - r;
      const ri = r - 0.03, si = sill + 0.03;
      inner.moveTo(cx - ri, si); inner.lineTo(cx - ri, ay); inner.absarc(cx, ay, ri, Math.PI, 0, true); inner.lineTo(cx + ri, si); inner.lineTo(cx - ri, si);
    }
    outer.holes.push(inner);
    add(new THREE.ExtrudeGeometry(outer, { depth: 0.09, bevelEnabled: false, curveSegments: 14 }), onWall(w, 0, 0, -CT * 0.55), PAL.frame, 6, { mode: 'out' });
    const gs = new THREE.Shape();
    if (round) gs.absarc(cx, sill, ww / 2 - 0.03, 0, Math.PI * 2, false); else arch(gs, cx, sill + 0.03, ww - 0.06, wh - 0.06, true);
    glassShape(gs, onWall(w, 0, 0, -CT * 0.5));
    if (round) {
      add(new THREE.BoxGeometry(0.04, ww, 0.05), onWall(w, cx, sill, -CT * 0.5), PAL.frame, 6, { mode: 'out' });
      add(new THREE.BoxGeometry(ww, 0.04, 0.05), onWall(w, cx, sill, -CT * 0.5), PAL.frame, 6, { mode: 'out' });
      return;
    }
    add(new THREE.BoxGeometry(0.045, wh, 0.05), onWall(w, cx, sill + wh / 2, -CT * 0.5), PAL.frame, 6, { mode: 'out' });
    for (const fy of [0.36, 0.68]) add(new THREE.BoxGeometry(ww, 0.045, 0.05), onWall(w, cx, sill + (wh - ww / 2) * fy * 1.4, -CT * 0.5), PAL.frame, 6, { mode: 'out' });
    add(new THREE.BoxGeometry(ww + 0.3, 0.07, 0.36), onWall(w, cx, sill - 0.06, 0.02), PAL.stone, 3, { mode: 'out' });   // stone sill outside
    add(new THREE.BoxGeometry(ww + 0.1, 0.04, 0.2), onWall(w, cx, sill - 0.02, -CT - 0.06), PAL.wood, 1, { mode: 'in' }); // wooden sill inside
  }
  type Op = { x: number; w: number; h?: number; sill?: number; door?: boolean; blank?: boolean };
  function wall(w: string, len: number, top: number[][], openings: Op[], rounds: { x: number; y: number; r: number }[] = []) {
    const s = new THREE.Shape();
    const half = len / 2;
    const door = openings.find((o) => o.door);
    s.moveTo(-half, 0);
    if (door) {
      const r = door.w / 2, ay = door.h! - r;
      s.lineTo(door.x - r, 0); s.lineTo(door.x - r, ay); s.absarc(door.x, ay, r, Math.PI, 0, true); s.lineTo(door.x + r, 0);
    }
    s.lineTo(half, 0);
    for (const [px, py] of top) s.lineTo(px, py);
    s.lineTo(-half, 0);
    for (const o of openings) if (!o.door) s.holes.push(arch(new THREE.Path(), o.x, o.sill!, o.w, o.h!, true));
    for (const o of rounds) { const p = new THREE.Path(); p.absarc(o.x, o.y, o.r, 0, Math.PI * 2, true); s.holes.push(p); }
    add(new THREE.ExtrudeGeometry(s, { depth: CT, bevelEnabled: false, curveSegments: 14 }), onWall(w, 0, 0, -CT), PAL.plaster, 0);
    for (const o of openings) if (!o.door) windowUnit(w, o.x, o.sill!, o.w, o.h!, false);
    for (const o of rounds) windowUnit(w, o.x, o.y, o.r * 2, 0, true);
  }
  // timber framing on the outside face of a wall
  function frame(w: string, len: number, openings: Op[], gable: boolean) {
    const half = len / 2, tb = (x: number, y: number, sx: number, sy: number, rz = 0) => add(new THREE.BoxGeometry(sx, sy, 0.07), onWall(w, x, y, 0.025, rz), PAL.timber, 1, { grain: 1, mode: 'out' });
    const posts = [-half + 0.08, half - 0.08];
    for (const o of openings) posts.push(o.x - o.w / 2 - 0.1, o.x + o.w / 2 + 0.1);
    posts.sort((a, b) => a - b);
    for (const x of posts) tb(x, CH / 2, 0.15, CH, 0);
    const dr = openings.find((o) => o.door);
    if (dr) { const a = dr.x - dr.w / 2 - 0.1, b = dr.x + dr.w / 2 + 0.1; tb((-half + a) / 2, 0.08, a + half, 0.16); tb((b + half) / 2, 0.08, half - b, 0.16); }
    else tb(0, 0.08, len, 0.16);
    tb(0, CH - 0.08, len, 0.16);
    for (let i = 0; i < posts.length - 1; i++) {
      const a = posts[i], b = posts[i + 1], mid = (a + b) / 2, span = b - a;
      const op = openings.find((o) => o.x > a && o.x < b);
      if (op && op.blank) continue;
      if (op) {
        const topY = (op.door ? op.h! : op.sill! + op.h!) + 0.12;
        if (topY < CH - 0.25) tb(mid, topY, span, 0.13);
        if (!op.door) tb(mid, op.sill! - 0.16, span, 0.13);
      } else if (span > 0.45) {
        tb(mid, 0.95, span, 0.12);
        const dy = CH - 0.95 - 0.16, len2 = Math.hypot(span, dy), ang = Math.atan2(dy, span) * (i % 2 ? 1 : -1);
        tb(mid, 0.95 + dy / 2 + 0.04, len2, 0.12, ang);
      }
    }
    if (gable) {
      const rise = CRIDGE - CH;
      tb(0, CH + rise / 2 - 0.1, 0.15, rise - 0.2);
      for (const sgn of [-1, 1]) {
        const x0 = sgn * (CD / 2 - 0.4), y0 = CH + 0.1, x1 = sgn * 0.08, y1 = CH + rise * 0.62;
        tb((x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0), 0.12, Math.atan2(y1 - y0, x1 - x0));
      }
    }
  }

  // ---- foundation, floor ----
  box(0, plinthBot / 2 - 0.03, 0, CW + 0.32, -plinthBot - 0.06, CD + 0.32, PAL.stone, 3, { mode: 'out' });
  box(0, -0.04, 0, CW - 0.02, 0.08, CD - 0.02, PAL.wood, 2, { grain: 0 });
  for (const [dz, top] of [[0.42, -0.17], [0.92, -0.36]]) box(DOOR_X, (top + plinthBot) / 2, CD / 2 + dz, 1.5 + dz * 0.3, top - plinthBot, 0.5, PAL.stone, 3, { mode: 'out' });

  // ---- walls ----
  const gTop = [[CD / 2 - CT, CH + CT * CTAN], [0, CRIDGE], [-(CD / 2 - CT), CH + CT * CTAN]];
  const FRONT: Op[] = [{ x: DOOR_X, w: DOOR_W, h: DOOR_H, door: true }, { x: -2.6, sill: 0.85, w: 0.95, h: 1.35 }, { x: 1.9, sill: 0.85, w: 0.95, h: 1.35 }];
  const BACK: Op[] = [{ x: 1.6, sill: 1.0, w: 0.9, h: 1.2 }, { x: -2.0, sill: 1.05, w: 0.9, h: 1.15 }];
  const RIGHT: Op[] = [{ x: 0, sill: 0.9, w: 0.95, h: 1.35 }];
  wall('front', CW, [[CW / 2, CH], [-CW / 2, CH]], FRONT);
  wall('back', CW, [[CW / 2, CH], [-CW / 2, CH]], BACK);
  wall('right', CD - 2 * CT, gTop, RIGHT, [{ x: 0, y: 4.35, r: 0.3 }]);
  wall('left', CD - 2 * CT, gTop, [], [{ x: 0.9, y: 4.3, r: 0.26 }]);
  frame('front', CW, FRONT, false);
  frame('back', CW, BACK, false);
  frame('right', CD, RIGHT, true);
  frame('left', CD, [{ x: -1.0, w: 1.5, blank: true }], true);
  // ---- front door: plank leaf, swung open into the room ----
  {
    const s = arch(new THREE.Shape(), (DOOR_W - 0.1) / 2, 0.05, DOOR_W - 0.1, DOOR_H - 0.1, true);
    const hinge = mtx(DOOR_X - DOOR_W / 2 + 0.05, 0, CD / 2 - CT + 0.01, 0, 1.75, 0);
    add(new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: false, curveSegments: 12 }), hinge.clone().multiply(mtx(0, 0, -0.06)), PAL.door, 2, { grain: 1, mode: 'in' });
    for (const hy of [0.35, 1.6]) add(new THREE.BoxGeometry(0.55, 0.05, 0.08), hinge.clone().multiply(mtx(0.3, hy, -0.03)), PAL.iron, 7, { mode: 'in' });
    add(new THREE.IcosahedronGeometry(0.04, 1), hinge.clone().multiply(mtx(0.82, 1.0, 0.02)), PAL.iron, 7, { mode: 'in' });
    add(new THREE.IcosahedronGeometry(0.04, 1), hinge.clone().multiply(mtx(0.82, 1.0, -0.1)), PAL.iron, 7, { mode: 'in' });
    // arched door frame: one U-shaped piece that lines the opening and stands 3 cm proud of the reveal
    const Ro = DOOR_W / 2 + 0.09, Ri = DOOR_W / 2 - 0.03, ay = DOOR_H - DOOR_W / 2, fs = new THREE.Shape();
    fs.moveTo(DOOR_X - Ro, 0); fs.lineTo(DOOR_X - Ro, ay); fs.absarc(DOOR_X, ay, Ro, Math.PI, 0, true); fs.lineTo(DOOR_X + Ro, 0);
    fs.lineTo(DOOR_X + Ri, 0); fs.lineTo(DOOR_X + Ri, ay); fs.absarc(DOOR_X, ay, Ri, 0, Math.PI, false); fs.lineTo(DOOR_X - Ri, 0); fs.lineTo(DOOR_X - Ro, 0);
    add(new THREE.ExtrudeGeometry(fs, { depth: CT + 0.05, bevelEnabled: false, curveSegments: 16 }), onWall('front', 0, 0, -CT - 0.025), PAL.timber, 1, { grain: 1 });
    box(DOOR_X, 0.025, CD / 2 - CT / 2, DOOR_W - 0.07, 0.05, CT + 0.07, PAL.timber, 1, { mode: 'out' });
  }

  // ---- roof ----
  const OVER_X = 0.5, EAVE = 0.6, slopeLen = Math.hypot(CD / 2, CRIDGE - CH);
  for (const sgn of [1, -1]) {
    const dirZ = Math.cos(CPITCH) * sgn, dirY = -Math.sin(CPITCH), nZ = Math.sin(CPITCH) * sgn, nY = Math.cos(CPITCH);
    const t0 = -0.04, t1 = slopeLen + EAVE, tc = (t0 + t1) / 2, L = t1 - t0;
    const at = (off: number) => [0, CRIDGE + dirY * tc + nY * off, dirZ * tc + nZ * off];
    const rx = sgn > 0 ? CPITCH : -CPITCH;
    let [x, y, z] = at(0.03);
    box(x, y, z, CW + 2 * OVER_X, 0.06, L, PAL.wood, 2, { rx, grain: 0 });
    [x, y, z] = at(0.13);
    box(x, y, z, CW + 2 * OVER_X, 0.14, L + 0.04, PAL.roof, 4, { rx, mode: 'out' });
    // fascia board along the eave
    const ez = dirZ * t1 + nZ * 0.08, ey = CRIDGE + dirY * t1 + nY * 0.08;
    box(0, ey, ez, CW + 2 * OVER_X + 0.04, 0.2, 0.06, PAL.timber, 1, { rx, mode: 'out' });
    // rafters, visible from inside and under the eaves
    for (let xr = -CW / 2 + 0.3; xr <= CW / 2 - 0.29; xr += 0.86) {
      [x, y, z] = at(-0.08);
      box(xr, y, z, 0.09, 0.15, L - 0.1, PAL.woodDark, 1, { rx, grain: 2 });
    }
  }
  box(0, CRIDGE + 0.17, 0, CW + 2 * OVER_X + 0.1, 0.22, 0.22, PAL.roofDark, 4, { rx: Math.PI / 4, mode: 'out' });   // ridge cap
  box(0, CRIDGE - 0.12, 0, CW - 0.1, 0.2, 0.16, PAL.woodDark, 1, { grain: 0, mode: 'in' });                         // ridge beam
  for (const sx of [-1, 1]) for (const sgn of [1, -1]) {
    const L = slopeLen + EAVE, tc = L / 2;
    box(sx * (CW / 2 + OVER_X + 0.02), CRIDGE - Math.sin(CPITCH) * tc + 0.05, sgn * Math.cos(CPITCH) * tc, 0.05, 0.24, L, PAL.timber, 1, { rx: sgn > 0 ? CPITCH : -CPITCH, mode: 'out' });
  }
  // interior structure: wall plates, tie beams with collar ties
  for (const sgn of [1, -1]) box(0, CH + 0.08, sgn * (innerZ - 0.08), CW - 2 * CT, 0.16, 0.16, PAL.woodDark, 1, { mode: 'in' });
  for (const xb of [-1.2, 1.6]) {
    box(xb, CH + 0.05, 0, 0.16, 0.18, CD - 2 * CT, PAL.woodDark, 1, { grain: 2, mode: 'in' });
    const cy = 4.55, half = (CRIDGE - cy) / CTAN;
    box(xb, cy, 0, 0.12, 0.14, half * 2, PAL.woodDark, 1, { grain: 2, mode: 'in' });
    box(xb, (CH + cy) / 2 + 0.05, 0, 0.12, cy - CH - 0.1, 0.12, PAL.woodDark, 1, { grain: 1, mode: 'in' });
  }

  return { add, box, cyl, blob, mtx, WALLS, P, NN, CC, II, gP, gN, R, rr, PAL, C, gLocal, plinthBot, lerp };
}
export type CottageKit = ReturnType<typeof buildCottageGeometry>;
