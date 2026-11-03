import * as THREE from 'three';
import { CW, CD, CH, CRIDGE, DOOR_X, innerX, innerZ, chZ, fx, chTop, lampL, FENCE, type CottageKit } from './cottageGeometry';

/* Chimney, fireplace, furniture and the garden (prototype, same order so the seeded details match). */
export function furnishCottage(k: CottageKit) {
  const { add, box, cyl, blob, mtx, WALLS, R, rr, PAL, C, gLocal, plinthBot, lerp } = k;
  // ---- chimney (outside the left gable) and fireplace ----
  box(-CW / 2 - 0.42, (plinthBot + CH) / 2, chZ, 0.84, CH - plinthBot, 1.5, PAL.stone, 3, { mode: 'out' });
  box(-CW / 2 - 0.36, (CH + 2 * CH + 0.4) / 2 - 0.2, chZ, 0.72, 0.6, 1.2, PAL.stone, 3, { mode: 'out' });
  box(-CW / 2 - 0.3, (CH + 0.3 + chTop) / 2, chZ, 0.6, chTop - CH - 0.3, 0.95, PAL.stone, 3, { mode: 'out', rz: 0.015 });
  box(-CW / 2 - 0.3, chTop + 0.05, chZ, 0.74, 0.1, 1.08, PAL.stoneDark, 3, { mode: 'out' });
  cyl(-CW / 2 - 0.3, chTop + 0.28, chZ - 0.15, 0.13, 0.16, 0.36, 10, PAL.roof, 6, { mode: 'out' });
  box(fx + 0.28, 0.06, chZ, 0.56, 1.3 - 1.18, 1.7, PAL.stone, 3, { mode: 'in' });
  for (const s of [-1, 1]) box(fx + 0.27, 0.62, chZ + s * 0.66, 0.54, 1.1, 0.36, PAL.stone, 3, { mode: 'in' });
  box(fx + 0.02, 0.6, chZ, 0.04, 1.0, 1.0, PAL.soot, 6, { mode: 'in' });
  box(fx + 0.32, 1.25, chZ, 0.66, 0.2, 1.9, PAL.timber, 1, { grain: 2, mode: 'in' });                 // oak mantel
  box(fx + 0.2, (1.35 + 5.0) / 2, chZ, 0.4, 5.0 - 1.35, 1.2, PAL.stone, 3, { mode: 'in' });           // chimney breast
  box(fx + 0.55, 0.015, chZ, 0.6, 0.03, 1.7, PAL.stoneDark, 3, { mode: 'in' });                       // hearth stone
  for (let i = 0; i < 3; i++) cyl(fx + 0.3, 0.1 + i * 0.06, chZ - 0.15 + i * 0.12, 0.06, 0.06, 0.65, 7, PAL.woodDark, 1, { rx: Math.PI / 2, ry: 0.3 - i * 0.4, mode: 'in' });
  for (let i = 0; i < 9; i++) box(fx + 0.3 + rr(-0.12, 0.12), 0.06, chZ + rr(-0.3, 0.3), rr(0.04, 0.08), 0.03, rr(0.04, 0.08), C('#ff7a2a'), 8, { ry: rr(0, 3), mode: 'in' });
  // kettle on a hook
  cyl(fx + 0.32, 0.92, chZ, 0.01, 0.01, 0.6, 4, PAL.iron, 7, { mode: 'in' });
  blob(fx + 0.32, 0.6, chZ, 0.13, PAL.iron, 7, { detail: 1, sy: 0.8, mode: 'in' });
  cyl(fx + 0.47, 0.64, chZ, 0.02, 0.035, 0.16, 6, PAL.iron, 7, { rz: -0.9, mode: 'in' });
  for (let i = 0; i < 4; i++) cyl(fx + 0.38, 1.4, chZ - 0.6 + i * 0.36, 0.05, 0.05, rr(0.1, 0.22), 8, [PAL.blue, PAL.cream, PAL.roof, PAL.leaf][i], 7, { mode: 'in' });
  // log basket
  cyl(fx + 0.4, 0.2, 0.25, 0.26, 0.22, 0.4, 12, PAL.woodLight, 1, { mode: 'in' });
  for (let i = 0; i < 5; i++) cyl(fx + 0.4 + rr(-0.1, 0.1), 0.42, 0.25 + rr(-0.12, 0.12), 0.05, 0.05, 0.55, 6, PAL.woodDark, 1, { rx: Math.PI / 2, ry: rr(-0.4, 0.4), mode: 'in' });

  // ---- furniture ----
  const leg = (x: number, z: number, h: number, t = 0.05, c = PAL.wood) => box(x, h / 2, z, t, h, t, c, 1, { grain: 1, mode: 'in' });
  box(-1.2, 0.005, 0.2, 2.5, 0.01, 1.8, PAL.rug, 5, { grain: 2, mode: 'in' });
  box(-1.2, 0.76, 0.2, 1.45, 0.05, 0.88, PAL.woodLight, 2, { grain: 0, mode: 'in' });
  for (const sx of [-0.62, 0.62]) for (const sz of [-0.36, 0.36]) leg(-1.2 + sx, 0.2 + sz, 0.74, 0.06);
  for (const [cz, ry] of [[-0.62, 0], [1.02, Math.PI]]) {
    box(-1.2, 0.45, cz, 0.44, 0.04, 0.42, PAL.wood, 1, { mode: 'in', ry });
    for (const sx of [-0.18, 0.18]) for (const sz of [-0.17, 0.17]) leg(-1.2 + sx, cz + sz, 0.44, 0.04);
    const bz = cz + (ry ? 0.2 : -0.2);
    for (const sx of [-0.18, 0.18]) box(-1.2 + sx, 0.72, bz, 0.04, 0.55, 0.04, PAL.wood, 1, { grain: 1, mode: 'in' });
    for (const hy of [0.7, 0.92]) box(-1.2, hy, bz, 0.38, 0.06, 0.03, PAL.wood, 1, { mode: 'in' });
  }
  // on the table: bread, bowl, mugs, a jug of flowers, a candle
  blob(-1.5, 0.84, 0.15, 0.1, C('#c98d4a'), 6, { detail: 1, sx: 1.7, sy: 0.7, mode: 'in' });
  cyl(-0.95, 0.82, 0.35, 0.13, 0.08, 0.08, 12, PAL.cream, 7, { mode: 'in' });
  for (let i = 0; i < 4; i++) blob(-0.95 + rr(-0.06, 0.06), 0.86, 0.35 + rr(-0.06, 0.06), 0.045, [C('#d6452f'), C('#e8b23a'), C('#d6452f'), C('#9bbf4a')][i], 6, { mode: 'in' });
  cyl(-1.65, 0.83, 0.42, 0.04, 0.035, 0.09, 8, PAL.blue, 7, { mode: 'in' });
  cyl(-0.75, 0.83, 0.05, 0.04, 0.035, 0.09, 8, PAL.cream, 7, { mode: 'in' });
  cyl(-1.2, 0.88, -0.05, 0.06, 0.08, 0.2, 10, C('#6f8fb8'), 7, { mode: 'in' });
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * 6.28;
    cyl(-1.2 + Math.cos(a) * 0.04, 1.03, -0.05 + Math.sin(a) * 0.04, 0.005, 0.005, 0.18, 3, PAL.leafDark, 6, { rx: Math.sin(a) * 0.3, rz: -Math.cos(a) * 0.3, mode: 'in' });
    blob(-1.2 + Math.cos(a) * 0.08, 1.12 + rr(0, 0.04), -0.05 + Math.sin(a) * 0.08, 0.035, [PAL.yellow, PAL.white, PAL.pink][i % 3], 6, { mode: 'in' });
  }
  cyl(-1.45, 0.84, -0.12, 0.05, 0.06, 0.03, 10, PAL.iron, 7, { mode: 'in' });
  cyl(-1.45, 0.91, -0.12, 0.018, 0.018, 0.12, 8, PAL.cream, 6, { mode: 'in' });
  // armchair by the fire
  {
    const M = mtx(-2.55, 0, 1.05, 0, -0.9, 0);
    const part = (x: number, y: number, z: number, sx: number, sy: number, sz: number, c: THREE.Color, kk: number, g = 0) => add(new THREE.BoxGeometry(sx, sy, sz), M.clone().multiply(mtx(x, y, z)), c, kk, { grain: g, mode: 'in' });
    part(0, 0.22, 0, 0.8, 0.3, 0.75, PAL.wood, 1);
    part(0, 0.45, 0.02, 0.62, 0.14, 0.62, C('#7d8f5a'), 5);
    part(0, 0.75, -0.32, 0.78, 0.75, 0.14, C('#7d8f5a'), 5);
    for (const s of [-1, 1]) part(s * 0.36, 0.55, 0, 0.12, 0.36, 0.75, C('#7d8f5a'), 5);
    part(0.05, 0.62, -0.18, 0.4, 0.3, 0.12, PAL.quilt, 5, 1);
  }
  // bed tucked against the back wall
  {
    const bx0 = 1.45, bx1 = innerX - 0.02, bz0 = -innerZ, bz1 = -innerZ + 1.1, bxc = (bx0 + bx1) / 2, bzc = (bz0 + bz1) / 2;
    box(bxc, 0.28, bzc, bx1 - bx0, 0.14, bz1 - bz0, PAL.wood, 1, { mode: 'in' });
    for (const x of [bx0 + 0.05, bx1 - 0.05]) for (const z of [bz0 + 0.05, bz1 - 0.05]) leg(x, z, 0.34, 0.08);
    box(bx1 - 0.04, 0.6, bzc, 0.08, 1.0, bz1 - bz0, PAL.wood, 2, { grain: 1, mode: 'in' });
    box(bx0 + 0.04, 0.45, bzc, 0.08, 0.6, bz1 - bz0, PAL.wood, 2, { grain: 1, mode: 'in' });
    box(bxc, 0.43, bzc, bx1 - bx0 - 0.12, 0.16, bz1 - bz0 - 0.08, PAL.cream, 5, { mode: 'in' });
    box(bxc - 0.2, 0.53, bzc + 0.02, bx1 - bx0 - 0.55, 0.06, bz1 - bz0 - 0.02, PAL.quilt, 5, { grain: 1, mode: 'in' });
    blob(bx1 - 0.35, 0.58, bzc, 0.22, PAL.white, 5, { detail: 1, sx: 0.8, sy: 0.38, sz: 1.6, mode: 'in' });
    box(bx0 - 0.3, 0.25, bz0 + 0.3, 0.45, 0.5, 0.4, PAL.woodLight, 2, { grain: 0, mode: 'in' });
    box(bx0 - 0.3, 0.53, bz0 + 0.3, 0.2, 0.05, 0.26, C('#5a6e8f'), 6, { ry: 0.3, mode: 'in' });
  }
  // bookshelf between the door and the right front window
  {
    const sx0 = 0.12, sx1 = 1.22, sz = innerZ - 0.18, h = 1.95;
    for (const x of [sx0, sx1]) box(x, h / 2, sz, 0.04, h, 0.34, PAL.wood, 1, { grain: 1, mode: 'in' });
    box((sx0 + sx1) / 2, h / 2, sz + 0.16, sx1 - sx0, h, 0.02, PAL.woodDark, 2, { grain: 1, mode: 'in' });
    for (let i = 0; i < 5; i++) {
      const y = 0.06 + i * 0.47;
      box((sx0 + sx1) / 2, y, sz, sx1 - sx0, 0.035, 0.34, PAL.wood, 1, { mode: 'in' });
      if (i === 4) break;
      let x = sx0 + 0.05;
      while (x < sx1 - 0.08) {
        if (R() < 0.3 && i > 1) {   // a jar
          const r = rr(0.05, 0.08), hh = rr(0.12, 0.22);
          cyl(x + r, y + hh / 2 + 0.02, sz, r, r, hh, 10, [C('#8fb5a2'), C('#d9a441'), C('#c7714f'), C('#a8c4d8')][Math.floor(R() * 4)], 7, { mode: 'in' });
          x += r * 2 + 0.03;
        } else {
          const t = rr(0.03, 0.06), hh = rr(0.22, 0.36);
          box(x + t / 2, y + hh / 2 + 0.02, sz + 0.02, t, hh, rr(0.18, 0.24), [C('#7a3b2e'), C('#3e5a7a'), C('#6a7a3c'), C('#b08a4a'), C('#5a3e5e'), C('#2f4f4a')][Math.floor(R() * 6)], 6, { rz: R() < 0.12 ? 0.25 : 0, mode: 'in' });
          x += t + 0.005;
        }
      }
    }
  }
  // kitchen dresser under the back window, plates and hanging pots
  {
    const kx = -2.55, kz = -innerZ + 0.3;
    box(kx, 0.42, kz, 1.15, 0.84, 0.56, PAL.wood, 2, { grain: 1, mode: 'in' });
    box(kx, 0.86, kz, 1.25, 0.05, 0.62, PAL.woodLight, 2, { grain: 0, mode: 'in' });
    for (const s of [-0.28, 0.28]) box(kx + s, 0.45, kz + 0.285, 0.5, 0.68, 0.02, PAL.door, 2, { grain: 1, mode: 'in' });
    for (let i = 0; i < 3; i++) cyl(kx - 0.35 + i * 0.12, 0.9, kz, 0.12, 0.11, 0.02, 14, PAL.cream, 7, { mode: 'in' });
    cyl(kx + 0.35, 0.95, kz, 0.1, 0.09, 0.15, 12, C('#b06d3c'), 7, { mode: 'in' });
    for (const [px, py, r] of [[kx - 0.3, 1.45, 0.12], [kx + 0.1, 1.5, 0.09]]) {
      cyl(px, py + r + 0.1, -innerZ + 0.12, 0.006, 0.006, 0.2, 3, PAL.iron, 7, { mode: 'in' });
      cyl(px, py, -innerZ + 0.12 + r, r, r * 0.85, r * 0.9, 12, PAL.iron, 7, { mode: 'in' });
    }
    for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) blob(-1.2 + rr(-0.06, 0.06), 2.45 - j * 0.05, -1.6 + i * 0.25 + rr(-0.04, 0.04), 0.05, R() < 0.5 ? PAL.leaf : C('#8a8f4a'), 6, { mode: 'in' });
  }
  // wardrobe by the right gable
  box(innerX - 0.3, 1.0, 1.75, 0.56, 2.0, 1.2, PAL.wood, 2, { grain: 1, mode: 'in' });
  box(innerX - 0.3, 2.04, 1.75, 0.64, 0.08, 1.28, PAL.woodDark, 1, { mode: 'in' });
  for (const s of [-0.29, 0.29]) box(innerX - 0.585, 1.05, 1.75 + s, 0.02, 1.7, 0.55, PAL.door, 2, { grain: 1, mode: 'in' });
  // coat pegs by the door with a hat and a scarf
  box(DOOR_X - 1.0, 1.7, innerZ - 0.03, 0.6, 0.08, 0.04, PAL.wood, 1, { mode: 'in' });
  cyl(DOOR_X - 1.15, 1.65, innerZ - 0.12, 0.17, 0.2, 0.03, 14, C('#c9a46a'), 5, { mode: 'in' });
  cyl(DOOR_X - 1.15, 1.72, innerZ - 0.12, 0.09, 0.1, 0.12, 12, C('#c9a46a'), 5, { mode: 'in' });
  box(DOOR_X - 0.82, 1.35, innerZ - 0.07, 0.12, 0.65, 0.03, C('#b84a3a'), 5, { grain: 1, mode: 'in' });
  for (const [x, z] of [[-2.6, innerZ - 0.12], [innerX - 0.12, 0]]) {
    cyl(x, 0.95, z, 0.08, 0.06, 0.13, 10, C('#b5643c'), 6, { mode: 'in' });
    for (let i = 0; i < 6; i++) blob(x + rr(-0.08, 0.08), 1.08 + rr(0, 0.1), z + rr(-0.06, 0.06), 0.06, PAL.leaf, 6, { mode: 'in' });
  }
  // hanging lantern over the table
  cyl(lampL[0], 2.5, lampL[2], 0.008, 0.008, 0.62, 3, PAL.iron, 7, { mode: 'in' });
  box(lampL[0], lampL[1], lampL[2], 0.13, 0.17, 0.13, C('#ffd9a0'), 8, { mode: 'in' });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(lampL[0] + sx * 0.075, lampL[1], lampL[2] + sz * 0.075, 0.02, 0.22, 0.02, PAL.iron, 7, { mode: 'in' });
  cyl(lampL[0], lampL[1] + 0.14, lampL[2], 0.02, 0.11, 0.08, 4, PAL.iron, 7, { ry: Math.PI / 4, mode: 'in' });

  // ---- outside ----
  for (const wxp of [-2.6, 1.9]) {
    box(wxp, 0.72, CD / 2 + 0.2, 1.05, 0.2, 0.26, PAL.door, 1, { mode: 'out' });
    for (let i = 0; i < 16; i++) {
      const x = wxp + rr(-0.45, 0.45), z = CD / 2 + 0.2 + rr(-0.08, 0.08);
      blob(x, 0.86 + rr(0, 0.06), z, 0.07, R() < 0.5 ? PAL.leaf : PAL.leafDark, 6, { mode: 'out' });
      if (R() < 0.75) blob(x, 0.94 + rr(0, 0.08), z + 0.02, rr(0.035, 0.05), [PAL.pink, PAL.white, PAL.yellow, C('#d84f5f')][Math.floor(R() * 4)], 6, { mode: 'out' });
    }
  }
  box(DOOR_X + 0.78, 2.15, CD / 2 + 0.14, 0.04, 0.04, 0.22, PAL.iron, 7, { mode: 'out' });
  box(DOOR_X + 0.78, 1.98, CD / 2 + 0.24, 0.1, 0.15, 0.1, C('#ffd9a0'), 8, { mode: 'out' });
  cyl(DOOR_X + 0.78, 2.1, CD / 2 + 0.24, 0.02, 0.09, 0.07, 4, PAL.iron, 7, { ry: Math.PI / 4, mode: 'out' });
  {
    const bx = 0.75, bz = CD / 2 + 0.42, gy = Math.max(gLocal(bx, bz), -0.6);
    box(bx, gy + 0.45, bz, 1.25, 0.06, 0.36, PAL.woodLight, 2, { grain: 0, mode: 'out' });
    for (const s of [-0.5, 0.5]) box(bx + s, gy + 0.21, bz, 0.08, 0.45, 0.32, PAL.wood, 1, { mode: 'out' });
  }
  for (let r = 0; r < 5; r++) for (let i = 0; i < 9 - r; i++) {
    const z = -2.45 + i * 0.19 + r * 0.095, x = CW / 2 + 0.38, gy = gLocal(x, z);
    cyl(x, gy + 0.09 + r * 0.16, z, 0.085, 0.085, 0.6, 7, i % 3 ? PAL.woodLight : PAL.wood, 1, { rz: Math.PI / 2, mode: 'out' });
  }
  box(CW / 2 + 0.4, gLocal(CW / 2 + 0.4, -1.65) + 1.0, -1.65, 0.85, 0.05, 1.95, PAL.timber, 2, { rz: -0.2, mode: 'out' });
  const ivy = (w: string, u0: number, u1: number, yMax: number, count: number) => {
    for (let kk = 0; kk < count; kk++) {
      const t = Math.pow(R(), 0.7), u = lerp(u0, u1, R()) + Math.sin(t * 9 + kk) * 0.25 * t, y = t * yMax;
      const M = WALLS[w].clone().multiply(mtx(u, y, 0.05)).multiply(new THREE.Matrix4().makeScale(1, 1, 0.45)).multiply(mtx(0, 0, 0, rr(0, 3), rr(0, 3), rr(0, 3)));
      add(new THREE.IcosahedronGeometry(rr(0.05, 0.09), 0), M, R() < 0.6 ? PAL.leafDark : PAL.leaf, 6, { mode: 'out' });
    }
  };
  ivy('front', 3.0, 3.98, 2.6, 300);
  ivy('right', 1.9, 2.95, 2.3, 160);
  for (let kk = 0; kk < 200; kk++) {
    const t = Math.pow(R(), 0.8), y = plinthBot + 0.4 + t * (CRIDGE - plinthBot - 0.5), z = chZ + rr(-0.75, 0.75) * (1 - t * 0.4);
    const x = -CW / 2 - (y < CH ? 0.86 : 0.62) - 0.03;
    blob(x, y, z, rr(0.05, 0.09), R() < 0.6 ? PAL.leafDark : PAL.leaf, 6, { sx: 0.45, rx: rr(0, 3), mode: 'out' });
  }
  for (let i = 0; i < 12; i++) {
    const lz = CD / 2 + 1.5 + i * 0.85, lx = DOOR_X + Math.sin(i * 0.55) * 0.7 + rr(-0.15, 0.15);
    cyl(lx, gLocal(lx, lz) + 0.02, lz, rr(0.22, 0.32), rr(0.24, 0.34), 0.08, 9, PAL.stone, 3, { ry: rr(0, 3), mode: 'out' });
  }
  const fenceCol: number[][] = [];
  for (let s = 0; s < FENCE.length - 1; s++) {
    const [ax, az] = FENCE[s], [bx, bz] = FENCE[s + 1], len = Math.hypot(bx - ax, bz - az), ang = Math.atan2(bz - az, bx - ax);
    const steps = Math.round(len / 0.16);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, x = lerp(ax, bx, t), z = lerp(az, bz, t), gy = gLocal(x, z);
      const post = i % 8 === 0 || i === steps;
      box(x, gy + (post ? 0.45 : 0.36), z, post ? 0.09 : 0.06, post ? 0.9 : 0.72, post ? 0.09 : 0.025, PAL.cream, 1, { grain: 1, ry: -ang, mode: 'out' });
    }
    for (const hy of [0.25, 0.55]) {
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      box(mx, gLocal(mx, mz) + hy, mz, len, 0.05, 0.03, PAL.cream, 1, { ry: -ang, mode: 'out' });
    }
    fenceCol.push([Math.min(ax, bx) - 0.08, Math.min(az, bz) - 0.08, Math.max(ax, bx) + 0.08, Math.max(az, bz) + 0.08]);
  }
  for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) {
    const x = 5.6 + r * 0.7, z = -0.1 + i * 0.55, gy = gLocal(x, z);
    blob(x, gy + 0.12, z, 0.17, r === 1 ? C('#6f9a45') : C('#4f7f45'), 6, { detail: 1, sy: 0.7, mode: 'out' });
  }
  // ---- the well: spring water from under the meadow, drawn up in a wooden bucket ----
  const wlx = -5.9, wlz = 4.4, wg = gLocal(wlx, wlz);
  for (let r = 0; r < 3; r++) for (let k = 0; k < 12; k++) {
    const a = (k + (r % 2) * 0.5) / 12 * Math.PI * 2;
    box(wlx + Math.cos(a) * 0.72, wg + 0.13 + r * 0.26, wlz + Math.sin(a) * 0.72, 0.42, 0.25, 0.3, PAL.stone, 3, { ry: -a + rr(-0.05, 0.05), mode: 'out' });
  }
  cyl(wlx, wg + 0.42, wlz, 0.56, 0.56, 0.03, 18, C('#1b3540'), 7, { mode: 'out' });
  for (const sx of [-1, 1]) box(wlx + sx * 0.8, wg + 1.15, wlz, 0.12, 1.9, 0.12, PAL.timber, 1, { grain: 1, mode: 'out' });
  for (const sz of [-1, 1]) box(wlx, wg + 2.2, wlz + sz * 0.32, 1.95, 0.06, 0.8, PAL.roof, 4, { rx: sz * 0.62, mode: 'out' });
  box(wlx, wg + 2.44, wlz, 2.0, 0.1, 0.1, PAL.roofDark, 4, { mode: 'out' });
  cyl(wlx, wg + 1.62, wlz, 0.07, 0.07, 1.5, 8, PAL.wood, 1, { rz: Math.PI / 2, mode: 'out' });
  box(wlx + 0.95, wg + 1.5, wlz, 0.04, 0.26, 0.04, PAL.iron, 7, { mode: 'out' });
  cyl(wlx + 0.12, wg + 1.12, wlz, 0.008, 0.008, 0.95, 3, C('#b9a57a'), 5, { mode: 'out' });
  cyl(wlx + 0.12, wg + 0.6, wlz, 0.12, 0.1, 0.2, 10, PAL.woodLight, 1, { grain: 1, mode: 'out' });
  cyl(wlx + 0.62, wg + 0.9, wlz + 0.35, 0.13, 0.11, 0.22, 10, PAL.wood, 1, { grain: 1, mode: 'out' });
  return { fenceCol, wellCol: [wlx - 0.95, wlz - 0.95, wlx + 0.95, wlz + 0.95] };
}
