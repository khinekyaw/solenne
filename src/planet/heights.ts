import { PLANET_R, GRID, DX, HALF, REGION_BLEND, LOWLAND, WATER } from '../config';
import { clamp, lerp, smoothstep } from '../core/math';
import { N2a, N2b, N2c, fbm, makeNoise3, fbm3, ridged3 } from '../core/noise';
import { faceDirRaw, SPAWN_FACE } from './faces';

/* =========================================================================
   Spawn plateau (prototype): one landmass of overlapping lobes with cliff
   walls, so the rim has bays and headlands. Flat coords on face +Y.
   ========================================================================= */
const LOBES = [
  { x: 0, z: 0, r: 190 }, { x: 150, z: -250, r: 105 }, { x: 300, z: -60, r: 95 }, { x: -230, z: -150, r: 120 },
  { x: -170, z: 210, r: 115 }, { x: 160, z: 200, r: 100 }, { x: 40, z: -390, r: 70 }, { x: 330, z: 105, r: 78 },
  { x: 205, z: -125, r: 85 }, { x: 240, z: 45, r: 80 },
];
function smin(a: number, b: number, k: number) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
export function islandSD(x: number, z: number) {
  const wx = x + 45 * fbm(N2a, x * 0.004 + 3.1, z * 0.004 - 7.4, 3), wz = z + 45 * fbm(N2a, x * 0.004 - 5.3, z * 0.004 + 1.7, 3);
  let d = 1e9;
  for (const l of LOBES) d = smin(d, Math.hypot(wx - l.x, wz - l.z) - l.r, 70);
  return d + 18 * fbm(N2b, x * 0.012, z * 0.012, 3) + 5 * N2c(x * 0.05, z * 0.05);
}
/** the land under the cloud sea (shared with the global terrain so the region blends in) */
export const lowlandAt = (x: number, z: number) => LOWLAND + 55 * fbm(N2c, x * 0.0031, z * 0.0031, 3);
export function heightFn(x: number, z: number) {
  const d = islandSD(x, z);
  const low = lowlandAt(x, z);
  if (d > 300) return low;
  const top = 12 + 17 * fbm(N2b, x * 0.0042 + 11.3, z * 0.0042 + 5.7, 4) + 3.5 * fbm(N2c, x * 0.021, z * 0.021, 2);
  const round = smoothstep(-55, -2, d);
  let h = top - 9 * round * round;
  const cliff = smoothstep(-4, 26, d);
  h -= 300 * Math.pow(cliff, 0.8);
  h += 6 * N2a(x * 0.034, z * 0.034) * cliff * (1 - cliff) * 4;
  // below the cloud sea the cliff keeps going: a steep talus down to the lowland floor
  // (only beyond the cliff foot, so everything the prototype showed above the sea is unchanged)
  return lerp(h, low, Math.pow(smoothstep(18, 290, d), 0.7));
}

/* region heightfield (filled once by computeRegionGrid or received from the worker) */
export let H = new Float32Array(GRID * GRID);
export function setRegionGrid(h: Float32Array) { H = h; }
export function computeRegionGrid() {
  const out = new Float32Array(GRID * GRID);
  for (let iz = 0; iz < GRID; iz++) for (let ix = 0; ix < GRID; ix++) out[iz * GRID + ix] = heightFn(ix * DX - HALF, iz * DX - HALF);
  return out;
}
/** triangle-interpolated ground of the region grid (same split as the GPU fetch and the terrain mesh) */
export function groundH(x: number, z: number) {
  const fx = clamp((x + HALF) / DX, 0, GRID - 1.001), fz = clamp((z + HALF) / DX, 0, GRID - 1.001);
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
  const i = iz * GRID + ix;
  const h00 = H[i], h10 = H[i + 1], h01 = H[i + GRID], h11 = H[i + GRID + 1];
  if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
  return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
}

/* =========================================================================
   Global terrain: lowlands hidden under the cloud sea, highland mesas with
   cliffs, uplands and ridged mountains on the larger ones. Input is a unit
   direction; highlands are kept away from the spawn plateau.
   ========================================================================= */
const NA = makeNoise3(101), NB = makeNoise3(202), NC = makeNoise3(303), ND = makeNoise3(404), NE = makeNoise3(505);
const NG = makeNoise3(707), NR = makeNoise3(808);
const HOME_LAKE: [number, number, number] = [1350, 1150, 520];   // a still lake under the clouds near the plateau's foot
// [x, z, radius, strength] in spawn-face flat metres (east +x, north −z)
const NEIGHBOURS = [
  [-3200, 3300, 1300, 0.55],    // a small mesa island to the south-west
  [4600, -3000, 1700, 0.6],     // a long plateau to the north-east
  [-6500, -4500, 2500, 0.75],   // broad uplands to the north-west
  [9500, 5500, 2600, 0.9],      // a mountain massif to the south-east
];
export function globalHeight(dx: number, dy: number, dz: number) {
  const x = dx * PLANET_R, y = dy * PLANET_R, z = dz * PLANET_R;
  // rolling lowland under the cloud sea, a few hundred metres of clear air below the deck
  let low = LOWLAND + 60 * fbm3(NA, x / 5200, y / 5200, z / 5200, 3) + 18 * fbm3(NE, x / 700, y / 700, z / 700, 2);
  const arc = PLANET_R * Math.acos(clamp(dy, -1, 1));
  const away = smoothstep(1200, 2600, arc);   // the ground right at the plateau's foot stays as it is
  // water: hollows that fill as lakes, rivers winding in wide valleys, ocean basins under the cloud banks
  low -= 75 * smoothstep(0.32, 0.6, fbm3(NG, x / 2600 + 5.1, y / 2600 - 3.7, z / 2600 + 1.9, 2));
  const rn = Math.abs(fbm3(NR, x / 3800 - 2.3, y / 3800 + 4.4, z / 3800 - 1.1, 3));
  low = lerp(low, Math.max(WATER + 1.5, low - 30), (1 - smoothstep(0.02, 0.075, rn)) * away);
  low = lerp(low, WATER - 3.5, (1 - smoothstep(0, 0.028, rn)) * away);
  const sf = seaField(dx, dy, dz);
  low = lerp(low, WATER - 30 - 190 * smoothstep(0.1, 0.32, sf) + 25 * NE(x / 2100, y / 2100, z / 2100), smoothstep(0.08, 0.16, sf) * away);
  if (dy > 0.9) {
    const [lx, lz, lr] = HOME_LAKE, X = PLANET_R * dx / dy, Z = PLANET_R * dz / dy;
    const q = ((X - lx) ** 2 + (Z - lz) ** 2) / (lr * lr);
    if (q < 4) low = lerp(low, WATER - 16, smoothstep(1.6, 0.4, q));
  }
  const s = 1 / 15000;
  const wx = fbm3(NB, x * s + 3.1, y * s - 1.7, z * s + 0.4, 2), wy = fbm3(NB, x * s - 6.3, y * s + 2.2, z * s - 4.1, 2), wz = fbm3(NB, x * s + 8.8, y * s + 5.5, z * s - 2.6, 2);
  const s2 = 1 / 17000;
  let m = fbm3(NC, x * s2 + wx * 0.7, y * s2 + wy * 0.7, z * s2 + wz * 0.7, 4) + 0.03 * NE(x / 900, y / 900, z / 900);
  // keep an open ring of cloud sea around the spawn plateau, then a few neighbouring highlands
  // placed so they rise above the sea horizon seen from home (~3 km away on this small planet)
  const ex = smoothstep(1500, 3000, arc);
  m = m * ex - 0.6 * (1 - ex);
  if (dy > 0.9) {
    const X = PLANET_R * dx / dy, Z = PLANET_R * dz / dy;
    for (const [nx, nz, r, a] of NEIGHBOURS) { const q = ((X - nx) ** 2 + (Z - nz) ** 2) / (r * r); if (q < 9) m += a * Math.exp(-q); }
  }
  if (m < 0.15) return low;
  const cliff = smoothstep(0.17, 0.215, m);
  const round = 1 - smoothstep(0.215, 0.27, m);
  const top = 20 + 60 * fbm3(ND, x / 6500, y / 6500, z / 6500, 3) + 240 * smoothstep(0.3, 0.62, m) - 10 * round * round;
  const r = ridged3(NA, x / 4300 + 7.7, y / 4300, z / 4300 - 3.3, 5);
  const mountains = 1150 * r * r * smoothstep(0.33, 0.62, m);
  let h = lerp(low, top + mountains, Math.pow(cliff, 0.8));
  h += 7 * NE(x / 30, y / 30, z / 30) * cliff * (1 - cliff) * 4;
  return h;
}

/* =========================================================================
   Where the cloud sea lies: great banks with wide clear gaps, about half of
   Solenne. The same low-frequency field is meant to carry the oceans later
   (cloud banks breathed up over warm water, clear skies inland). Home always
   stands in its sea of clouds, like the prototype.
   ========================================================================= */
const NF = makeNoise3(606);
export function seaField(dx: number, dy: number, dz: number) {
  const x = dx * PLANET_R, y = dy * PLANET_R, z = dz * PLANET_R;
  return fbm3(NF, x / 24000 + 1.3, y / 24000 - 2.1, z / 24000 + 0.7, 3) + 0.3 * fbm3(NF, x / 8000 - 4.2, y / 8000 + 3.3, z / 8000, 2);
}
export function seaCover(dx: number, dy: number, dz: number) {
  // banks over the coasts and inshore water; the hearts of the oceans and the inland plains lie open
  const f = seaField(dx, dy, dz);
  const c = smoothstep(-0.04, 0.1, f) * (1 - smoothstep(0.16, 0.25, f));
  const arc = PLANET_R * Math.acos(clamp(dy, -1, 1));
  return Math.max(c, 1 - smoothstep(3500, 7500, arc));
}

const _d = [0, 0, 0];
/** planet surface altitude at flat coords of a face (region grid blended in on the spawn face) */
export function planetHeight(fi: number, X: number, Z: number) {
  faceDirRaw(fi, X, Z, _d);
  let h = globalHeight(_d[0], _d[1], _d[2]);
  if (fi === SPAWN_FACE) {
    const m = Math.max(Math.abs(X), Math.abs(Z));
    if (m < REGION_BLEND[1]) h = lerp(groundH(X, Z), h, smoothstep(REGION_BLEND[0], REGION_BLEND[1], m));
  }
  return h;
}
/** altitude of the ground under a unit direction */
export function heightAtDir(dx: number, dy: number, dz: number) {
  if (dy > 0.99) {
    const X = PLANET_R * dx / dy, Z = PLANET_R * dz / dy;
    if (Math.max(Math.abs(X), Math.abs(Z)) < REGION_BLEND[1]) return planetHeight(SPAWN_FACE, X, Z);
  }
  return globalHeight(dx, dy, dz);
}
