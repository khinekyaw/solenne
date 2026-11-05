import * as THREE from 'three';
import { HULL, hullR, hullYc, hullPoint, halfWidthAt, thetaAt, DOME, DECK, LOWER_Z, UPPER_Z, STAIRS, HOLE, LADDER, WALLS, POD, THRUSTER_Z, floorHalf } from './wrenShape';

/* =========================================================================
   The Wren's inside, built from code (ship-local metres, see wrenShape.ts);
   the outside is the Blender model (art/wren). Same construction style as
   the cottage: primitives and parametric surfaces merged into one mesh with
   per-vertex colour, material kind (aInfo) and hull coordinates (aSkin).
   ========================================================================= */
const C = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);
export const PAL = {
  brass: C('#a17c46'), brassDark: C('#6e5430'), pearl: C('#e6e1d4'), joint: C('#3a3530'), bronze: C('#5a4632'),
  wood: C('#94683f'), woodLight: C('#b08a62'), woodDark: C('#5e3f29'), timber: C('#4a3424'), plank: C('#6f4e33'),
  cream: C('#efe2c8', 0.8), wall: C('#d9c6a0', 0.82), leather: C('#7a4a2e'), quilt: C('#c7714f'), rug: C('#9a4535'),
  leaf: C('#3d6b3a'), leafDark: C('#2c5232'), glassDark: C('#14232c'), warm: C('#ffc879'), cool: C('#a9e4ff'), holo: C('#7fd8ff'),
  iron: C('#33302d'), sack: C('#b39b74'), red: C('#a4553f'), teal: C('#3f6f62'), blue: C('#7fa6dc'), yellow: C('#f2c24a'),
  paint: C('#d3c7a6', 0.82), paintLow: C('#a9b39a', 0.8),
};
// material kinds (SHIP_FS): 0 hull skin, 1 wood, 2 planks, 4 inner shell, 5 fabric, 6 plain, 7 metal, 8 warm light, 9 cool light, 10 window from inside
type O = { grain?: number; indoor?: number; ao?: number; rx?: number; ry?: number; rz?: number; sx?: number; sy?: number; sz?: number; detail?: number };
const NO_SKIN = -9;

export class Kit {
  P: number[] = []; N: number[] = []; C: number[] = []; I: number[] = []; S: number[] = [];
  private v = new THREE.Vector3(); private n = new THREE.Vector3(); private nm = new THREE.Matrix3();
  private q = new THREE.Quaternion(); private e = new THREE.Euler(); private sc = new THREE.Vector3();
  mtx(x: number, y: number, z: number, o: O = {}) {
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), this.q.setFromEuler(this.e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'YXZ')), this.sc.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1));
  }
  /** append a geometry; a 'skin' attribute (hull coordinates) is carried through when present */
  add(geo: THREE.BufferGeometry, m: THREE.Matrix4 | null, color: THREE.Color, kind: number, o: O = {}, flip = false) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    const pa = g.attributes.position, na = g.attributes.normal, sa = g.attributes.skin;
    if (m) this.nm.getNormalMatrix(m);
    const info = [kind, o.grain ?? 0, o.indoor ?? 0, o.ao ?? 1];
    for (let i = 0; i < pa.count; i += 3) for (let k = 0; k < 3; k++) {
      const j = i + (flip ? 2 - k : k);
      this.v.fromBufferAttribute(pa, j); this.n.fromBufferAttribute(na, j);
      if (m) { this.v.applyMatrix4(m); this.n.applyMatrix3(this.nm).normalize(); }
      if (flip) this.n.negate();
      this.P.push(this.v.x, this.v.y, this.v.z); this.N.push(this.n.x, this.n.y, this.n.z);
      this.C.push(color.r, color.g, color.b); this.I.push(...info);
      if (sa) this.S.push(sa.getX(j), sa.getY(j), sa.getZ(j)); else this.S.push(0, 0, NO_SKIN);
    }
  }
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.Color, kind: number, o: O = {}) { this.add(new THREE.BoxGeometry(sx, sy, sz), this.mtx(x, y, z, o), color, kind, o); }
  cyl(x: number, y: number, z: number, r0: number, r1: number, h: number, seg: number, color: THREE.Color, kind: number, o: O = {}) { this.add(new THREE.CylinderGeometry(r1, r0, h, seg), this.mtx(x, y, z, o), color, kind, o); }
  blob(x: number, y: number, z: number, r: number, color: THREE.Color, kind: number, o: O = {}) { this.add(new THREE.IcosahedronGeometry(r, o.detail ?? 1), this.mtx(x, y, z, o), color, kind, o); }
  torus(x: number, y: number, z: number, R: number, r: number, color: THREE.Color, kind: number, normal: THREE.Vector3, o: O = {}) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize()), new THREE.Vector3(1, 1, 1));
    this.add(new THREE.TorusGeometry(R, r, 8, 28), m, color, kind, o);
  }
  disc(c: THREE.Vector3, normal: THREE.Vector3, r: number, color: THREE.Color, kind: number, o: O = {}) {
    const m = new THREE.Matrix4().compose(c, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize()), new THREE.Vector3(1, 1, 1));
    this.add(new THREE.CircleGeometry(r, 24), m, color, kind, o);
  }
  /** a box stretched between two points */
  strut(a: THREE.Vector3, b: THREE.Vector3, w: number, d: number, color: THREE.Color, kind: number, o: O = {}) {
    const dir = b.clone().sub(a), len = dir.length();
    const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()), new THREE.Vector3(1, 1, 1));
    this.add(new THREE.BoxGeometry(w, len, d), m, color, kind, o);
  }
  /** a tube along a smooth path */
  tube(pts: THREE.Vector3[], r: number, color: THREE.Color, kind: number, o: O = {}, closed = false) {
    if (pts.length < 2) return;
    this.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), Math.max(8, pts.length * 3), r, 6, closed), null, color, kind, o);
  }
  /** a parametric surface grid; skin(i, j) gives the hull coordinates of each vertex */
  surface(nu: number, nv: number, pt: (u: number, v: number, out: THREE.Vector3) => THREE.Vector3, skin: (u: number, v: number) => [number, number, number] | null,
          color: THREE.Color, kind: number, o: O = {}, flip = false, keep?: (u0: number, v0: number, u1: number, v1: number) => boolean) {
    const pos: number[] = [], sk: number[] = [], idx: number[] = [], p = new THREE.Vector3();
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      pt(i / nu, j / nv, p); pos.push(p.x, p.y, p.z);
      const s = skin(i / nu, j / nv); sk.push(...(s ?? [0, 0, NO_SKIN]));
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      if (keep && !keep(i / nu, j / nv, (i + 1) / nu, (j + 1) / nv)) continue;
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('skin', new THREE.Float32BufferAttribute(sk, 3));
    g.setIndex(idx); g.computeVertexNormals();
    this.add(g, null, color, kind, o, flip);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.I, 4));
    g.setAttribute('aSkin', new THREE.Float32BufferAttribute(this.S, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/* ---- hull helpers ---- */
const zAt = (s: number) => HULL.zTail + (HULL.zNose - HULL.zTail) * (0.5 - 0.5 * Math.cos(Math.PI * s));   // denser at nose and tail
const thAt = (u: number) => (u - 0.5) * Math.PI * 2;
const skinOf = (z: number, th: number): [number, number, number] => [th * 4.7 * Math.max(hullR(z), 0.3), z, th];
export function hullNormal(z: number, th: number, out = new THREE.Vector3()) {
  const a = hullPoint(z, th + 0.002), b = hullPoint(z, th - 0.002), c = hullPoint(z + 0.01, th), d = hullPoint(z - 0.01, th);
  const tz = c.sub(d), tt = a.sub(b);
  out.crossVectors(tt, tz).normalize();
  // outward: away from the hull axis
  const p = hullPoint(z, th), ax = new THREE.Vector3(0, hullYc(z), z);
  if (out.dot(p.sub(ax)) < 0) out.negate();
  return out;
}

export type Lamp = { p: [number, number, number]; c: THREE.Color; i: number };
export type Glow = { c: THREE.Vector3; n: THREE.Vector3; r: number; col: THREE.Color };   // a soft additive halo, ship-local
export type Box = { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number };   // ship-local collision, between heights y0..y1

export function buildWren() {
  const K = new Kit(), boxes: Box[] = [], lamps: Lamp[] = [];
  const glows: Glow[] = [];
  const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const NU = 112, NV = 150;

  /* ===== the outside is the Blender model (art/wren → public/models/wren.glb, drawn by wren.ts); the code builds
     what is inside its skin: the inner shell (openings cut in the shader with the collision's tests) ===== */
  K.surface(NU, NV, (u, v, o) => hullPoint(zAt(v), thAt(u), HULL.thick, o), (u, v) => skinOf(zAt(v), thAt(u)), PAL.wall, 4, { indoor: 1 });

  /* ===== portholes from inside: brass rings, the sky beyond (the model has them outside at the same places) ===== */
  const porthole = (z: number, th: number, R: number) => {
    const pi = hullPoint(z, th, HULL.thick), ni = hullNormal(z, th).negate();
    K.torus(pi.x + ni.x * 0.03, pi.y + ni.y * 0.03, pi.z + ni.z * 0.03, R, 0.06, PAL.brass, 7, ni, { indoor: 1 });
    K.disc(pi.clone().addScaledVector(ni, 0.02), ni, R - 0.02, PAL.cool, 10, { indoor: 1 });
  };
  for (const s of [1, -1]) {
    for (const z of [3.4, 1.0, -1.4, -3.8, -6.2]) porthole(z, s * 0.66, 0.36);                            // upper row, high in the vault
    for (const z of [5.6, 3.6, 1.6, -0.4, -2.4, -4.4, -6.6]) porthole(z, s * 1.26, 0.42);                 // at the eyes of the upper deck
  }
  // the dome's collar, seen from the stargazing seat
  K.add(new THREE.CylinderGeometry(DOME.r + 0.06, DOME.r + 0.12, 1.25, 44, 1, true), K.mtx(0, DOME.base - 0.62, DOME.z), PAL.bronze, 7, { indoor: 1 }, true);

  /* ===== soft glows outside: engine halos, the tail thruster (the hover pads' depend on the ground: wren.ts) ===== */
  for (const s of [1, -1]) {
    const px = s * POD.x;
    glows.push({ c: v3(px, POD.y, POD.z0 - 0.6), n: v3(0, 0, -1), r: 1.5, col: new THREE.Color(0.25, 0.55, 0.8) });
    glows.push({ c: v3(px, POD.y - POD.r - 0.3, (POD.z0 + POD.z1) / 2), n: v3(0, -1, 0), r: 1.4, col: new THREE.Color(0.2, 0.45, 0.7) });
  }
  glows.push({ c: v3(0, hullYc(HULL.zTail), THRUSTER_Z - 0.5), n: v3(0, 0, -1), r: 2.2, col: new THREE.Color(0.3, 0.6, 0.85) });

  /* ===== inside: floors, partitions, stairs, ladder ===== */
  buildInterior(K, boxes, lamps);

  return { geo: K.geometry(), glows, boxes, lamps };
}

/* ---- the two decks (see the cutaway): rooms, furniture, lamps ---- */
function buildInterior(K: Kit, boxes: Box[], lamps: Lamp[]) {
  const IN = { indoor: 1 };
  const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const deckBox = (x0: number, z0: number, x1: number, z1: number, floor: number, h = 2.4) => boxes.push({ x0, z0, x1, z1, y0: floor - 0.3, y1: floor + h });
  // a floor slab following the inner shell, with an optional hole (the stairwell)
  const slab = (y: number, z0: number, z1: number, hole?: { x0: number; x1: number; z0: number; z1: number }) => {
    const sh = new THREE.Shape(), right: [number, number][] = [];
    const steps = 48;
    for (let k = 0; k <= steps; k++) { const z = z0 + (z1 - z0) * k / steps, w = Math.max(floorHalf(y, z) - 0.02, 0.05); right.push([w, z]); }
    sh.moveTo(right[0][0], -right[0][1]);
    for (const [w, z] of right) sh.lineTo(w, -z);
    for (let k = right.length - 1; k >= 0; k--) sh.lineTo(-right[k][0], -right[k][1]);
    if (hole) { const h = new THREE.Path(); h.moveTo(hole.x0, -hole.z0); h.lineTo(hole.x0, -hole.z1); h.lineTo(hole.x1, -hole.z1); h.lineTo(hole.x1, -hole.z0); h.lineTo(hole.x0, -hole.z0); sh.holes.push(h); }
    const g = new THREE.ExtrudeGeometry(sh, { depth: DECK.slab, bevelEnabled: false, curveSegments: 4 });
    K.add(g, new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(0, y - DECK.slab, 0), PAL.plank, 2, { indoor: 1, grain: 0 });
  };
  slab(DECK.lower, LOWER_Z[0], LOWER_Z[1]);
  slab(DECK.upper, UPPER_Z[0], UPPER_Z[1], HOLE);
  // partitions: fitted to the inner shell, an arched doorway where there is one
  for (const w of WALLS) {
    const y0 = w.deck === 'lower' ? DECK.lower : DECK.upper, y1 = w.deck === 'lower' ? DECK.upper - DECK.slab : DECK.wallTop;
    const sh = new THREE.Shape(), side: [number, number][] = [];
    for (let k = 0; k <= 16; k++) { const y = y0 + (y1 - y0) * k / 16; side.push([Math.max(halfWidthAt(y, w.z, HULL.thick) - 0.01, 0.05), y]); }
    sh.moveTo(-side[0][0], side[0][1]);
    for (const [x, y] of side) sh.lineTo(x, y);
    for (let k = side.length - 1; k >= 0; k--) sh.lineTo(-side[k][0], side[k][1]);
    if (w.door) {
      const [d0, d1] = w.door, r = (d1 - d0) / 2, cx = (d0 + d1) / 2, top = y0 + Math.min(2.25, y1 - y0 - 0.15);
      const h = new THREE.Path(); h.moveTo(d0, y0 + 0.001); h.lineTo(d0, top - r); h.absarc(cx, top - r, r, Math.PI, 0, true); h.lineTo(d1, y0 + 0.001); h.lineTo(d0, y0 + 0.001);
      sh.holes.push(h);
      for (const x of [d0, d1]) boxes.push({ x0: x === d0 ? -9 : d1, z0: w.z - 0.12, x1: x === d0 ? d0 : 9, z1: w.z + 0.12, y0: y0 - 0.3, y1: y0 + 2.3 });
    } else boxes.push({ x0: -9, z0: w.z - 0.12, x1: 9, z1: w.z + 0.12, y0: y0 - 0.3, y1: y0 + 2.3 });
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: false, curveSegments: 10 });
    K.add(g, new THREE.Matrix4().setPosition(0, 0, w.z - 0.06), w.deck === 'lower' ? PAL.paintLow : PAL.paint, 6, { indoor: 1 });
    if (w.door) { const [d0, d1] = w.door, top = y0 + Math.min(2.25, y1 - y0 - 0.15), r = (d1 - d0) / 2, pts: THREE.Vector3[] = [];
      pts.push(v3(d0, y0, w.z)); for (let k = 0; k <= 12; k++) { const a = Math.PI - k / 12 * Math.PI; pts.push(v3((d0 + d1) / 2 + r * Math.cos(a), top - r + r * Math.sin(a), w.z)); } pts.push(v3(d1, y0, w.z));
      K.tube(pts, 0.07, PAL.timber, 1, IN); }
  }
  // stairs up from the cargo hold, rising toward the tail
  { const n = 17, rise = (DECK.upper - DECK.lower) / n, run = (STAIRS.zBot - STAIRS.zTop) / n, cx = (STAIRS.x0 + STAIRS.x1) / 2, w = STAIRS.x1 - STAIRS.x0;
    for (let k = 0; k < n; k++) { const z = STAIRS.zBot - (k + 0.5) * run, y = DECK.lower + (k + 1) * rise; K.box(cx, y - 0.04, z, w, 0.08, run + 0.04, PAL.plank, 2, { indoor: 1, grain: 0 }); }
    for (const x of [STAIRS.x0 + 0.03, STAIRS.x1 - 0.03]) K.strut(v3(x, DECK.lower - 0.05, STAIRS.zBot), v3(x, DECK.upper - 0.1, STAIRS.zTop), 0.06, 0.24, PAL.timber, 1, { indoor: 1 });
    const rail = [v3(STAIRS.x1 + 0.04, DECK.lower + 0.95, STAIRS.zBot), v3(STAIRS.x1 + 0.04, DECK.upper + 0.95, STAIRS.zTop)];
    K.tube(rail, 0.035, PAL.brass, 7, IN);
    for (const p of rail) K.cyl(p.x, p.y - 0.47, p.z, 0.03, 0.03, 0.95, 6, PAL.brass, 7, IN);
    boxes.push({ x0: STAIRS.x1 + 0.0, z0: STAIRS.zTop + 0.2, x1: STAIRS.x1 + 0.12, z1: STAIRS.zBot + 0.05, y0: DECK.lower - 0.3, y1: DECK.upper + 1.0 });
    // railings around the stairwell on the upper deck
    const r1 = [v3(HOLE.x1, DECK.upper + 0.95, HOLE.z0 + 0.3), v3(HOLE.x1, DECK.upper + 0.95, HOLE.z1), v3(HOLE.x0, DECK.upper + 0.95, HOLE.z1)];
    K.tube(r1, 0.035, PAL.brass, 7, IN);
    for (const p of [...r1, v3(-1.75, DECK.upper + 0.95, HOLE.z1), v3(HOLE.x1, DECK.upper + 0.95, 1.5)]) K.cyl(p.x, p.y - 0.47, p.z, 0.03, 0.03, 0.95, 6, PAL.brass, 7, IN);
    boxes.push({ x0: HOLE.x0 - 0.1, z0: HOLE.z1 - 0.06, x1: HOLE.x1, z1: HOLE.z1 + 0.08, y0: DECK.upper - 0.3, y1: DECK.upper + 1.2 }); }
  // the ship's ladder in the bunk room, up into the dome
  { const len = Math.hypot(LADDER.zBot - LADDER.zTop, DOME.floor - DECK.upper);
    for (const x of [LADDER.x0, LADDER.x1]) K.strut(v3(x, DECK.upper, LADDER.zBot), v3(x, DOME.floor + 0.9, LADDER.zTop - 0.55), 0.07, 0.1, PAL.woodDark, 1, { indoor: 1 });
    for (let d = 0.28; d < len; d += 0.3) { const t = d / len, y = DECK.upper + (DOME.floor - DECK.upper) * t, z = LADDER.zBot + (LADDER.zTop - LADDER.zBot) * t; K.box(0, y, z, LADDER.x1 - LADDER.x0, 0.05, 0.16, PAL.plank, 2, { indoor: 1 }); } }
  // the dome: a half-moon platform behind the ladder, a cushion, a blanket, a little brass spyglass
  { const sh = new THREE.Shape(); sh.moveTo(-2.3, 0); for (let k = 0; k <= 24; k++) { const a = Math.PI + k / 24 * Math.PI; sh.lineTo(2.3 * Math.cos(a), 2.3 * Math.sin(a)); } sh.lineTo(-2.3, 0);
    // shape (x, s) → ship (x, y, DOME.z - 0.25 + s): the half toward the tail
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: false });
    K.add(g, new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, DOME.floor, 0, 1, 0, DOME.z - 0.25, 0, 0, 0, 1), PAL.plank, 2, { indoor: 1 });
    K.blob(-0.6, DOME.floor + 0.18, DOME.z - 1.4, 0.55, PAL.quilt, 5, { indoor: 1, sy: 0.35, sx: 1.6, grain: 1 });
    K.blob(0.9, DOME.floor + 0.2, DOME.z - 1.2, 0.35, PAL.cream, 5, { indoor: 1, sy: 0.6 });
    K.cyl(1.4, DOME.floor + 0.5, DOME.z - 0.9, 0.04, 0.06, 1.0, 6, PAL.timber, 1, IN);
    K.cyl(1.4, DOME.floor + 1.08, DOME.z - 0.9, 0.05, 0.07, 0.6, 10, PAL.brass, 7, { indoor: 1, rx: -0.9 });
    const rail = [v3(-2.2, DOME.floor + 0.9, DOME.z - 0.25), v3(LADDER.x0 - 0.05, DOME.floor + 0.9, DOME.z - 0.25)], rail2 = [v3(LADDER.x1 + 0.05, DOME.floor + 0.9, DOME.z - 0.25), v3(2.2, DOME.floor + 0.9, DOME.z - 0.25)];
    K.tube(rail, 0.03, PAL.brass, 7, IN); K.tube(rail2, 0.03, PAL.brass, 7, IN);
    for (const [x0, x1] of [[-2.4, LADDER.x0 - 0.05], [LADDER.x1 + 0.05, 2.4]]) boxes.push({ x0, z0: DOME.z - 0.32, x1, z1: DOME.z - 0.18, y0: DOME.floor - 0.4, y1: DOME.floor + 2 });
    lamps.push({ p: [0, DOME.floor + 1.0, DOME.z - 1.2], c: PAL.warm, i: 0.25 }); }

  const U = DECK.upper, Lo = DECK.lower;
  /* --- cockpit: two worn seats, the curved console, holographic instruments --- */
  // seat backs: a rounded, bevelled slab (seen from the galley door, a plain box read as a crate)
  const back = new THREE.Shape(), bw = 0.33, bh = 0.95, br = 0.28;
  back.moveTo(-bw, 0); back.lineTo(bw, 0); back.lineTo(bw, bh - br); back.absarc(bw - br, bh - br, br, 0, Math.PI / 2, false);
  back.lineTo(-bw + br, bh); back.absarc(-bw + br, bh - br, br, Math.PI / 2, Math.PI, false); back.lineTo(-bw, 0);
  const backGeo = new THREE.ExtrudeGeometry(back, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 8 });
  for (const x of [-0.9, 0.9]) {
    K.box(x, U + 0.45, 9.3, 0.7, 0.18, 0.7, PAL.leather, 6, IN);
    K.add(backGeo, K.mtx(x, U + 0.5, 8.86, { rx: -0.12 }), PAL.leather.clone().multiplyScalar(0.8), 6, IN);
    K.blob(x, U + 0.6, 9.3, 0.34, PAL.leather, 6, { indoor: 1, sy: 0.32, sz: 1.0 });
    K.blob(x, U + 1.05, 9.02, 0.34, PAL.leather, 6, { indoor: 1, sz: 0.35, sy: 1.25, rx: -0.12 });
    K.cyl(x, U + 0.2, 9.3, 0.07, 0.12, 0.4, 8, PAL.joint, 7, IN);
    deckBox(x - 0.4, 8.85, x + 0.4, 9.7, U);
  }
  K.box(0, U + 0.5, 10.55, 3.0, 1.0, 0.7, PAL.woodDark, 1, { indoor: 1, grain: 0 });
  K.box(0, U + 1.03, 10.4, 3.0, 0.06, 0.9, PAL.brassDark, 7, { indoor: 1, rx: 0.25 });
  // (low and tilted back, so the pilot sees the sky over them)
  for (const [x, a] of [[-1.0, 0.3], [0, 0], [1.0, -0.3]]) K.box(x, U + 1.3, 10.75, 0.8, 0.42, 0.03, PAL.holo, 9, { indoor: 1, ry: a, rx: -0.55, grain: 2 });
  K.cyl(0, U + 1.15, 10.05, 0.05, 0.05, 0.4, 8, PAL.iron, 7, { indoor: 1, rx: 0.6 });
  deckBox(-1.6, 10.1, 1.6, 11.0, U);
  lamps.push({ p: [0, U + 1.6, 10.2], c: PAL.holo, i: 0.35 });
  /* --- galley and table --- */
  K.cyl(1.0, U + 0.74, 5.2, 0.75, 0.75, 0.06, 24, PAL.woodLight, 1, { indoor: 1, grain: 0 });
  K.cyl(1.0, U + 0.37, 5.2, 0.08, 0.2, 0.72, 10, PAL.woodDark, 1, IN);
  for (const a of [0.4, 2.3, 4.2]) {
    const x = 1.0 + Math.cos(a) * 1.05, z = 5.2 + Math.sin(a) * 1.05;
    K.box(x, U + 0.45, z, 0.42, 0.06, 0.42, PAL.wood, 1, { indoor: 1, ry: -a });
    K.box(x + Math.cos(a) * 0.2, U + 0.8, z + Math.sin(a) * 0.2, 0.42, 0.62, 0.05, PAL.wood, 1, { indoor: 1, ry: Math.PI / 2 - a });
    for (const [dx, dz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) K.cyl(x + dx, U + 0.21, z + dz, 0.025, 0.025, 0.42, 5, PAL.woodDark, 1, IN);
  }
  deckBox(0.2, 4.4, 1.8, 6.0, U);
  K.box(1.0, U + 0.01, 5.2, 2.6, 0.02, 2.4, PAL.rug, 5, { indoor: 1, grain: 2 });
  K.box(-3.0, U + 0.45, 5.15, 0.8, 0.9, 3.4, PAL.woodDark, 1, { indoor: 1, grain: 0 });
  K.box(-3.0, U + 0.92, 5.15, 0.86, 0.05, 3.5, PAL.woodLight, 2, IN);
  boxes.push({ x0: -4, z0: 3.4, x1: -2.55, z1: 6.9, y0: U - 0.3, y1: U + 2.4 });
  for (const y of [U + 1.75, U + 2.25]) {
    K.box(-3.05, y, 5.15, 0.4, 0.04, 3.2, PAL.wood, 1, IN);
    for (let k = 0; k < 9; k++) K.cyl(-3.05 + (k % 2) * 0.12, y + 0.12, 3.7 + k * 0.34, 0.06, 0.06, 0.2 + (k % 3) * 0.05, 8, [PAL.blue, PAL.cream, PAL.red, PAL.yellow, PAL.teal][k % 5], 7, IN);
  }
  for (let k = 0; k < 4; k++) { const z = 4.0 + k * 0.6; K.cyl(-2.4, U + 1.95, z, 0.13, 0.11, 0.16, 10, PAL.iron, 7, IN); K.cyl(-2.4, U + 2.25, z, 0.008, 0.008, 0.45, 3, PAL.iron, 7, IN); }
  K.blob(-2.9, U + 1.08, 6.7, 0.24, PAL.leaf, 6, IN); K.blob(-2.85, U + 1.15, 3.7, 0.2, PAL.leafDark, 6, IN);
  K.cyl(1.0, U + 2.05, 5.2, 0.12, 0.1, 0.28, 10, PAL.brass, 7, IN); K.blob(1.0, U + 1.92, 5.2, 0.1, PAL.warm, 8, IN);
  K.cyl(1.0, U + 2.6, 5.2, 0.01, 0.01, 0.9, 3, PAL.iron, 7, IN);
  lamps.push({ p: [1.0, U + 1.85, 5.2], c: PAL.warm, i: 0.95 });
  /* --- landing: a bench and a coat stand --- */
  K.box(2.6, U + 0.42, 1.0, 0.5, 0.08, 1.6, PAL.wood, 1, IN); for (const z of [0.35, 1.65]) K.box(2.6, U + 0.2, z, 0.45, 0.4, 0.06, PAL.woodDark, 1, IN);
  deckBox(2.3, 0.2, 3.5, 1.8, U, 0.6);
  K.cyl(-0.3, U + 0.9, -1.2, 0.04, 0.05, 1.8, 6, PAL.timber, 1, IN); K.blob(-0.3, U + 1.45, -1.1, 0.24, PAL.teal, 5, { indoor: 1, sy: 1.6 });
  lamps.push({ p: [1.2, U + 2.2, 0.9], c: PAL.warm, i: 0.5 });
  /* --- bunk room: bed, quilt, shelves of books, a chest, a bedside lamp --- */
  K.box(-2.55, U + 0.3, -3.45, 1.9, 0.36, 2.3, PAL.woodDark, 1, { indoor: 1, grain: 0 });
  K.box(-2.55, U + 0.55, -3.45, 1.8, 0.18, 2.2, PAL.cream, 6, IN);
  K.box(-2.5, U + 0.68, -3.6, 1.86, 0.08, 1.7, PAL.quilt, 5, { indoor: 1, grain: 1 });
  K.blob(-2.55, U + 0.75, -2.5, 0.28, PAL.cream, 5, { indoor: 1, sy: 0.45, sx: 1.6 });
  boxes.push({ x0: -4, z0: -4.65, x1: -1.55, z1: -2.25, y0: U - 0.3, y1: U + 0.7 });
  K.box(-1.2, U + 0.3, -4.5, 0.45, 0.6, 0.45, PAL.wood, 1, IN); K.cyl(-1.2, U + 0.75, -4.5, 0.08, 0.12, 0.3, 8, PAL.brass, 7, IN); K.blob(-1.2, U + 0.95, -4.5, 0.11, PAL.warm, 8, IN);
  lamps.push({ p: [-1.6, U + 1.2, -4.0], c: PAL.warm, i: 0.6 });
  K.box(2.75, U + 0.3, -2.8, 0.9, 0.6, 0.7, PAL.woodDark, 1, { indoor: 1, grain: 0 }); for (const z of [-3.05, -2.55]) K.box(2.75, U + 0.35, z, 0.92, 0.08, 0.04, PAL.brass, 7, IN);
  deckBox(2.25, -3.2, 3.3, -2.4, U, 0.7);
  for (const y of [U + 0.9, U + 1.4, U + 1.9]) {
    K.box(2.95, y, -4.15, 0.4, 0.04, 1.4, PAL.wood, 1, IN);
    for (let k = 0; k < 8; k++) K.box(2.95, y + 0.15, -4.75 + k * 0.17, 0.26, 0.28 + (k % 3) * 0.04, 0.12, [PAL.red, PAL.teal, PAL.leather, PAL.yellow, PAL.blue][k % 5], 6, IN);
  }
  K.box(0.0, U + 0.01, -3.3, 2.4, 0.02, 1.6, PAL.rug, 5, { indoor: 1, grain: 2 });
  /* --- Halden's core: a calm glowing sphere in a brass cradle --- */
  { const c = v3(0.2, U + 1.25, -7.4);
    K.cyl(c.x, U + 0.3, c.z, 0.55, 0.7, 0.6, 18, PAL.brassDark, 7, IN);
    K.cyl(c.x, U + 0.7, c.z, 0.12, 0.2, 0.4, 10, PAL.brass, 7, IN);
    for (const n of [v3(1, 0, 0), v3(0, 0.4, 1), v3(0.7, 0.7, -0.3)]) K.torus(c.x, c.y, c.z, 0.85, 0.045, PAL.brass, 7, n, IN);
    K.blob(c.x, c.y, c.z, 0.45, C('#ffdcaa'), 8, { indoor: 1, grain: 3, detail: 3 });
    deckBox(c.x - 0.95, c.z - 0.95, c.x + 0.95, c.z + 0.95, U);
    lamps.push({ p: [c.x, c.y, c.z], c: C('#ffe9c8'), i: 1.0 });
    for (const s of [1, -1]) { K.box(s * 2.5, U + 0.7, -7.6, 0.8, 1.4, 2.4, PAL.woodDark, 1, { indoor: 1, grain: 1 }); boxes.push({ x0: s > 0 ? 2.1 : -4, z0: -8.8, x1: s > 0 ? 4 : -2.1, z1: -6.4, y0: U - 0.3, y1: U + 1.5 });
      for (let k = 0; k < 3; k++) K.box(s * 2.08, U + 0.5 + k * 0.4, -7.6, 0.03, 0.08, 0.5, PAL.holo, 9, { indoor: 1, grain: 2 });
      K.tube([v3(c.x + s * 0.6, U + 0.4, c.z), v3(s * 1.4, U + 0.08, c.z + 0.2), v3(s * 2.1, U + 0.6, -7.0)], 0.04, PAL.iron, 7, IN); } }
  /* --- workshop: bench, tools on a board, stools, a vise --- */
  K.box(2.05, Lo + 0.85, 6.3, 0.9, 0.08, 2.8, PAL.woodLight, 2, { indoor: 1, grain: 0 });
  for (const z of [5.0, 7.6]) for (const x of [1.7, 2.4]) K.box(x, Lo + 0.42, z, 0.08, 0.84, 0.08, PAL.woodDark, 1, IN);
  boxes.push({ x0: 1.55, z0: 4.85, x1: 4, z1: 7.75, y0: Lo - 0.3, y1: Lo + 1.0 });
  K.box(2.6, Lo + 1.75, 6.3, 0.05, 1.1, 2.8, PAL.woodDark, 1, { indoor: 1, grain: 1 });
  for (let k = 0; k < 9; k++) K.box(2.55, Lo + 1.5 + (k % 3) * 0.32, 5.1 + k * 0.28, 0.05, 0.22 + (k % 2) * 0.1, 0.05, k % 3 ? PAL.iron : PAL.brass, 7, IN);
  K.box(2.0, Lo + 0.98, 7.2, 0.25, 0.2, 0.18, PAL.iron, 7, IN);
  for (const z of [5.6, 6.9]) { K.cyl(1.1, Lo + 0.55, z, 0.2, 0.2, 0.06, 12, PAL.wood, 1, IN); K.cyl(1.1, Lo + 0.27, z, 0.04, 0.12, 0.54, 6, PAL.woodDark, 1, IN); }
  for (const y of [Lo + 0.5, Lo + 1.1, Lo + 1.7]) { K.box(-2.1, y, 6.4, 0.5, 0.04, 2.6, PAL.wood, 1, IN); for (let k = 0; k < 6; k++) K.box(-2.1, y + 0.13, 5.4 + k * 0.4, 0.3, 0.22, 0.25, [PAL.teal, PAL.sack, PAL.red][k % 3], 6, IN); }
  boxes.push({ x0: -4, z0: 5.0, x1: -1.8, z1: 7.8, y0: Lo - 0.3, y1: Lo + 2.0 });
  // the front wall: a pinned plan of the Wren, a pressure gauge, a coil of hose on a peg
  const fw = WALLS.find(w => w.z === 8.6)!.z - 0.08;
  K.box(-0.5, Lo + 1.45, fw, 1.3, 0.85, 0.01, C('#c9d6d2'), 6, IN);
  for (let k = 0; k < 4; k++) K.box(-0.5, Lo + 1.2 + k * 0.17, fw - 0.01, 0.9 - (k % 2) * 0.3, 0.015, 0.01, C('#5d7a86'), 6, IN);
  K.disc(v3(0.75, Lo + 1.6, fw - 0.02), v3(0, 0, -1), 0.17, PAL.cream, 6, IN); K.torus(0.75, Lo + 1.6, fw - 0.03, 0.18, 0.025, PAL.brass, 7, v3(0, 0, 1), IN);
  K.box(0.75, Lo + 1.62, fw - 0.04, 0.015, 0.12, 0.01, PAL.iron, 6, IN);
  K.tube([v3(0.75, Lo + 1.42, fw - 0.03), v3(0.75, Lo + 0.9, fw - 0.03), v3(0.4, Lo + 0.4, fw - 0.1)], 0.03, PAL.iron, 7, IN);
  K.torus(-1.45, Lo + 1.1, fw - 0.06, 0.25, 0.045, PAL.leather, 6, v3(0, 0.15, 1), IN); K.box(-1.45, Lo + 1.36, fw - 0.05, 0.04, 0.04, 0.1, PAL.brass, 7, IN);
  K.blob(-0.3, Lo + 2.55, 6.4, 0.12, PAL.warm, 8, IN); K.cyl(-0.3, Lo + 2.75, 6.4, 0.15, 0.06, 0.18, 10, PAL.brass, 7, IN);
  lamps.push({ p: [-0.3, Lo + 2.4, 6.4], c: PAL.warm, i: 0.85 });
  /* --- cargo hold: crates under the stairs, trunks, sacks, a shelf of jars --- */
  for (const [x, z, y, s] of [[-1.75, 0.6, 0, 0.9], [-1.75, 1.6, 0, 0.8], [-1.75, 0.6, 0.9, 0.7], [-1.7, -1.1, 0, 0.9], [-0.8, -1.2, 0, 0.7]] as const) {
    K.box(x, Lo + y + s / 2, z, s, s, s, PAL.wood, 1, { indoor: 1, grain: 1 });
    K.box(x, Lo + y + s / 2, z, s + 0.02, 0.06, s + 0.02, PAL.woodDark, 1, IN);
  }
  // (only at deck level: whoever is on the stairs above them walks on)
  boxes.push({ x0: -2.6, z0: -1.6, x1: -1.25, z1: 2.1, y0: Lo - 0.3, y1: Lo + 0.35 }); boxes.push({ x0: -1.2, z0: -1.6, x1: -0.4, z1: -0.8, y0: Lo - 0.3, y1: Lo + 0.8 });
  for (const [z, c] of [[-1.3, PAL.teal], [-0.65, PAL.red]] as const) { K.box(2.0, Lo + 0.3, z, 0.9, 0.6, 0.55, c, 6, IN); K.box(2.0, Lo + 0.62, z, 0.92, 0.06, 0.57, PAL.brass, 7, IN); }
  boxes.push({ x0: 1.5, z0: -1.65, x1: 4, z1: -0.35, y0: Lo - 0.3, y1: Lo + 0.7 });
  for (const [x, z] of [[-0.25, -1.3], [-0.1, -0.75]]) K.blob(x, Lo + 0.3, z, 0.33, PAL.sack, 5, { indoor: 1, sy: 0.9 });
  boxes.push({ x0: -0.6, z0: -1.65, x1: 0.15, z1: -0.45, y0: Lo - 0.3, y1: Lo + 0.6 });
  for (const y of [Lo + 0.9, Lo + 1.5]) { K.box(2.45, y, 3.3, 0.4, 0.04, 1.6, PAL.wood, 1, IN); for (let k = 0; k < 5; k++) K.cyl(2.45, y + 0.12, 2.65 + k * 0.32, 0.08, 0.08, 0.22, 8, [PAL.yellow, PAL.teal, PAL.cream][k % 3], 7, IN); }
  K.blob(0.6, Lo + 2.55, 1.0, 0.12, PAL.warm, 8, IN);
  lamps.push({ p: [0.6, Lo + 2.4, 1.0], c: PAL.warm, i: 0.85 });
  /* --- engine room: two pearl-white cores with blue-white rings, pipes, a panel --- */
  for (const s of [1, -1]) {
    const x = s * 1.15, y = Lo + 0.95;
    K.cyl(x, y, -3.7, 0.62, 0.62, 2.8, 24, PAL.pearl.clone().multiplyScalar(0.62), 7, { indoor: 1, rx: Math.PI / 2 });
    for (const z of [-4.6, -3.7, -2.8]) K.torus(x, y, z, 0.66, 0.05, PAL.cool, 9, v3(0, 0, 1), { indoor: 1, grain: 1 });
    K.cyl(x, y, -2.25, 0.4, 0.55, 0.3, 18, PAL.brass, 7, { indoor: 1, rx: Math.PI / 2 });
    K.tube([v3(x, y + 0.6, -4.8), v3(x * 0.5, Lo + 2.4, -4.2), v3(0, Lo + 2.6, -3.0), v3(-x * 0.4, Lo + 2.3, -2.2)], 0.06, PAL.brass, 7, IN);
    boxes.push({ x0: s > 0 ? 0.45 : -4, z0: -5.3, x1: s > 0 ? 4 : -0.45, z1: -2.05, y0: Lo - 0.3, y1: Lo + 2.0 });
  }
  K.box(0, Lo + 1.0, -5.35, 1.0, 0.8, 0.2, PAL.joint, 7, IN);
  for (let k = 0; k < 3; k++) K.box(-0.3 + k * 0.3, Lo + 1.15, -5.24, 0.2, 0.25, 0.02, PAL.holo, 9, { indoor: 1, grain: 2 });
  lamps.push({ p: [0, Lo + 2.0, -3.7], c: PAL.cool, i: 0.55 });
}
export { DOME as DOME_SHAPE, thetaAt };
