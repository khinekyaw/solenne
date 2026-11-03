/// <reference lib="webworker" />
import { PLANET_R, CHUNK_SEG, SEA_TOP, HALF, GRID, LAND_RES, WATER } from '../config';
import { smoothstep } from '../core/math';
import { faceDirRaw, FACE_DATA, SPAWN_FACE } from './faces';
import { computeRegionGrid, setRegionGrid, planetHeight, seaCover } from './heights';
import { regionMasks, bakeShadow, grassMask, regionHeights } from './regionBake';

/* =========================================================================
   Terrain worker: builds quadtree chunk meshes, the spawn region grid and
   masks, the land-mask atlas for the clouds, and re-bakes terrain shadow.
   ========================================================================= */
const ctx = self as unknown as DedicatedWorkerGlobalScope;
const S = CHUNK_SEG, N = S + 1, B = S + 3;          // B: grid with a 1-sample border for normals


function buildChunk(face: number, x0: number, z0: number, size: number) {
  const step = size / S;
  const P = new Float64Array(B * B * 3), Hh = new Float64Array(B * B), d = [0, 0, 0];
  for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
    const X = x0 + (i - 1) * step, Z = z0 + (j - 1) * step, k = j * B + i;
    const h = planetHeight(face, X, Z);
    faceDirRaw(face, X, Z, d);
    Hh[k] = h;
    P[k * 3] = d[0] * (PLANET_R + h); P[k * 3 + 1] = d[1] * (PLANET_R + h); P[k * 3 + 2] = d[2] * (PLANET_R + h);
  }
  // chunk centre on the sphere at the mean height
  let hSum = 0, hMin = 1e9, hMax = -1e9;
  for (let j = 1; j <= N; j++) for (let i = 1; i <= N; i++) { const h = Hh[j * B + i]; hSum += h; hMin = Math.min(hMin, h); hMax = Math.max(hMax, h); }
  const hMean = hSum / (N * N);
  faceDirRaw(face, x0 + size / 2, z0 + size / 2, d);
  const cx = d[0] * (PLANET_R + hMean), cy = d[1] * (PLANET_R + hMean), cz = d[2] * (PLANET_R + hMean);

  const skirt = Math.max(4, size * 0.05);
  const nv = N * N + 4 * N;
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), flat = new Float32Array(nv * 3), info = new Float32Array(nv * 4);
  const f = FACE_DATA[face];
  let radius = 0;
  const put = (v: number, k: number, drop: number) => {
    const X = x0 + ((k % B) - 1) * step, Z = z0 + (Math.floor(k / B) - 1) * step, h = Hh[k];
    // normal from neighbouring planet positions: cross(dP/dZ, dP/dX) points outward on every face
    const kx0 = k - 1, kx1 = k + 1, kz0 = k - B, kz1 = k + B;
    const ax = P[kz1 * 3] - P[kz0 * 3], ay = P[kz1 * 3 + 1] - P[kz0 * 3 + 1], az = P[kz1 * 3 + 2] - P[kz0 * 3 + 2];
    const bx = P[kx1 * 3] - P[kx0 * 3], by = P[kx1 * 3 + 1] - P[kx0 * 3 + 1], bz = P[kx1 * 3 + 2] - P[kx0 * 3 + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
    const r = PLANET_R + h, ux = P[k * 3] / r, uy = P[k * 3 + 1] / r, uz = P[k * 3 + 2] / r;
    const px = P[k * 3] - ux * drop - cx, py = P[k * 3 + 1] - uy * drop - cy, pz = P[k * 3 + 2] - uz * drop - cz;
    pos.set([px, py, pz], v * 3); nor.set([nx, ny, nz], v * 3); flat.set([X, h - drop, Z], v * 3);
    radius = Math.max(radius, Math.hypot(px, py, pz));
    // tangent-frame normal: east = eu projected on the tangent plane, north = east × up
    let ex = f[3] - ux * (f[3] * ux + f[4] * uy + f[5] * uz), ey = f[4] - uy * (f[3] * ux + f[4] * uy + f[5] * uz), ez = f[5] - uz * (f[3] * ux + f[4] * uy + f[5] * uz);
    const el = Math.hypot(ex, ey, ez); ex /= el; ey /= el; ez /= el;
    const qx = ey * uz - ez * uy, qy = ez * ux - ex * uz, qz = ex * uy - ey * ux;
    const tnx = nx * ex + ny * ey + nz * ez, tny = nx * ux + ny * uy + nz * uz, tnz = nx * qx + ny * qy + nz * qz;
    const slope = Math.sqrt(Math.max(1 - tny * tny, 0)) / Math.max(tny, 1e-3);
    const grass = grassMask(slope, h);
    const inRegion = face === SPAWN_FACE && Math.abs(X) < HALF - 3 && Math.abs(Z) < HALF - 3 ? 1 : 0;
    info.set([grass, inRegion, tnx, tnz], v * 4);
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) put(j * N + i, (j + 1) * B + i + 1, 0);
  // skirts: one copy of every edge vertex, dropped along the local up
  const edges: number[][] = [[], [], [], []];
  for (let i = 0; i < N; i++) { edges[0].push(i); edges[1].push(S * N + i); edges[2].push(i * N); edges[3].push(i * N + S); }
  let sv = N * N;
  const skirtOf: number[][] = edges.map((e) => e.map((gi) => { const i = gi % N, j = Math.floor(gi / N); put(sv, (j + 1) * B + i + 1, skirt); return sv++; }));

  const idx: number[] = [];
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const a = j * N + i, b = a + 1, c = a + N, e = c + 1;
    idx.push(a, c, b, b, c, e);   // same diagonal as the prototype heightfield
  }
  edges.forEach((e, ei) => {
    for (let k = 0; k < S; k++) {
      const a = e[k], b = e[k + 1], sa = skirtOf[ei][k], sb = skirtOf[ei][k + 1];
      idx.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);   // both windings
    }
  });
  return { pos, nor, flat, info, index: new Uint16Array(idx), center: [cx, cy, cz], radius, hMin, hMax, ...buildWater(face, x0, z0, step, Hh, cx, cy, cz, hMin) };
}

/* the water surface of a chunk: the same grid, flat at sea level, wherever the ground dips below it */
function buildWater(face: number, x0: number, z0: number, step: number, Hh: Float64Array, cx: number, cy: number, cz: number, hMin: number) {
  if (hMin > WATER + 0.3) return {};
  const nv = N * N + 4 * N, d = [0, 0, 0];
  const wpos = new Float32Array(nv * 3), wflat = new Float32Array(nv * 3), wdepth = new Float32Array(nv);
  const sag = Math.max(0.3, (step * step) / (4 * PLANET_R) * 2);
  const put = (v: number, i: number, j: number, drop: number) => {
    const X = x0 + i * step, Z = z0 + j * step, r = PLANET_R + WATER - drop;
    faceDirRaw(face, X, Z, d);
    wpos.set([d[0] * r - cx, d[1] * r - cy, d[2] * r - cz], v * 3);
    wflat.set([X, WATER, Z], v * 3);
    wdepth[v] = WATER - Hh[(j + 1) * B + i + 1];
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) put(j * N + i, i, j, 0);
  const edges: number[][] = [[], [], [], []];
  for (let i = 0; i < N; i++) { edges[0].push(i); edges[1].push(S * N + i); edges[2].push(i * N); edges[3].push(i * N + S); }
  let sv = N * N;
  const skirtOf = edges.map((e) => e.map((gi) => { put(sv, gi % N, Math.floor(gi / N), sag); return sv++; }));
  const wet = (gi: number) => wdepth[gi] > -0.3;
  const idx: number[] = [];
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const a = j * N + i, b = a + 1, c = a + N, e = c + 1;
    if (!(wet(a) || wet(b) || wet(c) || wet(e))) continue;
    idx.push(a, c, b, b, c, e);
  }
  edges.forEach((e, ei) => {
    for (let k = 0; k < S; k++) {
      const a = e[k], b = e[k + 1], sa = skirtOf[ei][k], sb = skirtOf[ei][k + 1];
      if (!(wet(a) || wet(b))) continue;
      idx.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
    }
  });
  if (!idx.length) return {};
  return { wpos, wflat, wdepth, windex: new Uint16Array(idx) };
}

/* atlas of six cube faces side by side, two channels: r = highland above the cloud sea, g = cloud-sea cover */
function landAtlas() {
  const R = LAND_RES, out = new Uint8Array(6 * R * R * 2), d = [0, 0, 0];
  for (let fi = 0; fi < 6; fi++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
    let m = -1e9;
    for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const u = ((x + ox) / R) * 2 - 1, v = ((y + oy) / R) * 2 - 1;
      m = Math.max(m, planetHeight(fi, u * PLANET_R, v * PLANET_R));
    }
    faceDirRaw(fi, ((x + 0.5) / R * 2 - 1) * PLANET_R, ((y + 0.5) / R * 2 - 1) * PLANET_R, d);
    const i = (y * 6 * R + fi * R + x) * 2;
    out[i] = Math.round(255 * smoothstep(SEA_TOP - 60, SEA_TOP + 10, m));
    out[i + 1] = Math.round(255 * seaCover(d[0], d[1], d[2]));
  }
  return out;
}

let shadowBuf: Uint8Array | null = null;
let detail: Float32Array | null = null;   // the last detail-region grid built here
ctx.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'init') {
    const H = computeRegionGrid();
    setRegionGrid(H);
    const tdata = regionMasks();
    shadowBuf = new Uint8Array(GRID * GRID);
    const land = landAtlas();
    const Hc = H.slice();
    ctx.postMessage({ type: 'region', H: Hc, tdata, land }, [Hc.buffer, tdata.buffer, land.buffer]);
  } else if (m.type === 'chunk') {
    const c = buildChunk(m.face, m.x0, m.z0, m.size);
    const tr: Transferable[] = [c.pos.buffer, c.nor.buffer, c.flat.buffer, c.info.buffer, c.index.buffer];
    if (c.wpos) tr.push(c.wpos.buffer, c.wflat!.buffer, c.wdepth!.buffer, c.windex!.buffer);
    ctx.postMessage({ type: 'chunk', id: m.id, ...c }, tr);
  } else if (m.type === 'detail') {
    // a detail region somewhere else on the planet: heights, grass mask and shadow on the 2.5 m grid
    detail = regionHeights(m.face, m.cx, m.cz);
    const tdata = regionMasks(detail, false), sh = new Uint8Array(GRID * GRID);
    bakeShadow(m.sun, sh, detail);
    for (let i = 0; i < GRID * GRID; i++) tdata[i * 4] = sh[i];
    const Hc = detail.slice();
    ctx.postMessage({ type: 'detail', seq: m.seq, face: m.face, cx: m.cx, cz: m.cz, H: Hc, tdata }, [Hc.buffer, tdata.buffer]);
  } else if (m.type === 'detailShadow' && detail) {
    const out = bakeShadow(m.sun, new Uint8Array(GRID * GRID), detail);
    ctx.postMessage({ type: 'detailShadow', seq: m.seq, data: out }, [out.buffer]);
  } else if (m.type === 'shadow' && shadowBuf) {
    bakeShadow(m.sun, shadowBuf);
    const out = shadowBuf.slice();
    ctx.postMessage({ type: 'shadow', seq: m.seq, data: out }, [out.buffer]);
  }
};
