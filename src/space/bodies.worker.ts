/// <reference lib="webworker" />
import { clamp, lerp, smoothstep, mulberry32, type Rng } from '../core/math';
import { makeNoise3, fbm3 } from '../core/noise';
import { MAP_W, MAP_H, RING_W } from '../config';

/* =========================================================================
   Surface maps for the far bodies, baked once (equirectangular, 1024×512,
   one array layer each): rgb = albedo (linear), a = height for the relief
   shading near the terminator. Longitude 0 is the body's prime meridian;
   for the tidally locked moons it is the face turned to their planet.
   Plus the ring profiles (512 texels from inner to outer edge).
   ========================================================================= */
const ctx = self as unknown as DedicatedWorkerGlobalScope;
const N = MAP_W * MAP_H;
type RGB = [number, number, number];

// unit direction of every texel: x = prime meridian, y = east, z = north pole
const DX = new Float32Array(N), DY = new Float32Array(N), DZ = new Float32Array(N), LAT = new Float32Array(N), LON = new Float32Array(N);
for (let y = 0; y < MAP_H; y++) {
  const lat = ((y + 0.5) / MAP_H - 0.5) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
  for (let x = 0; x < MAP_W; x++) {
    const lon = ((x + 0.5) / MAP_W - 0.5) * Math.PI * 2, i = y * MAP_W + x;
    DX[i] = cl * Math.cos(lon); DY[i] = cl * Math.sin(lon); DZ[i] = sl; LAT[i] = lat; LON[i] = lon;
  }
}
const mixC = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
function ramp(stops: [number, RGB][], t: number): RGB {
  if (t <= stops[0][0]) return stops[0][1];
  for (let k = 1; k < stops.length; k++) if (t <= stops[k][0]) return mixC(stops[k - 1][1], stops[k][1], (t - stops[k - 1][0]) / (stops[k][0] - stops[k - 1][0]));
  return stops[stops.length - 1][1];
}
const randDir = (rnd: Rng) => { const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z); return [r * Math.cos(a), r * Math.sin(a), z]; };

/* ---- craters, splatted onto the map: power-law sizes, bowl + rim + ejecta, rays on a few fresh ones ---- */
type CraterOpts = { seed: number; classes: number; count: number; rMax: number; rays: number; flood?: Float32Array };
function craters(alb: Float32Array, hgt: Float32Array, o: CraterOpts) {
  const rnd = mulberry32(o.seed);
  for (let k = 0; k < o.classes; k++) {
    const r = o.rMax * Math.pow(0.62, k), count = Math.round(o.count * Math.pow(1.85, k));
    for (let c = 0; c < count; c++) {
      const [cx, cy, cz] = randDir(rnd);
      const fresh = rnd() < 0.18 + 0.05 * k ? 0.4 + 0.6 * rnd() : 0;
      const rays = k >= 2 && k <= 4 && fresh > 0.6 && rnd() < o.rays;
      const depth = r * (0.22 + 0.1 * k / o.classes) * (0.7 + 0.5 * rnd()), rim = depth * 0.45;
      // tangent basis for ray azimuths
      const ax = Math.abs(cz) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      let e1 = [ax[1] * cz - ax[2] * cy, ax[2] * cx - ax[0] * cz, ax[0] * cy - ax[1] * cx];
      const l1 = Math.hypot(e1[0], e1[1], e1[2]); e1 = e1.map((q) => q / l1);
      const e2 = [cy * e1[2] - cz * e1[1], cz * e1[0] - cx * e1[2], cx * e1[1] - cy * e1[0]];
      const rayAz = Array.from({ length: 16 }, () => rnd() * Math.PI * 2);
      const ext = r * (rays ? 7 : 2.2);
      const clat = Math.asin(cz), clon = Math.atan2(cy, cx);
      const y0 = Math.max(0, Math.floor(((clat - ext) / Math.PI + 0.5) * MAP_H)), y1 = Math.min(MAP_H - 1, Math.ceil(((clat + ext) / Math.PI + 0.5) * MAP_H));
      for (let y = y0; y <= y1; y++) {
        const cl = Math.cos(LAT[y * MAP_W]);
        const span = cl > ext ? Math.asin(Math.min(1, ext / cl)) : Math.PI;
        const xs = Math.floor(((clon - span) / (Math.PI * 2) + 0.5) * MAP_W), xe = Math.ceil(((clon + span) / (Math.PI * 2) + 0.5) * MAP_W);
        for (let xx = xs; xx <= Math.min(xe, xs + MAP_W - 1); xx++) {
          const i = y * MAP_W + ((xx % MAP_W) + MAP_W) % MAP_W;
          const dot = DX[i] * cx + DY[i] * cy + DZ[i] * cz;
          const d = Math.acos(clamp(dot, -1, 1));
          if (d > ext) continue;
          const q = d / r;
          const flood = o.flood ? 1 - 0.75 * o.flood[i] * (k < 4 ? 1 : 0.4) : 1;   // old basins drowned under the maria
          let h = 0;
          if (q < 1) h += depth * (q * q - 1) * flood;
          h += rim * Math.exp(-(((q - 1) / 0.2) ** 2)) * flood;
          if (q > 1) h += rim * 0.35 * Math.exp(-(q - 1) * 2.5) * flood;
          hgt[i] += h;
          let b = 0;
          if (fresh > 0) b += fresh * 0.32 * Math.exp(-(((q - 1) / 0.55) ** 2)) + (q < 1 ? fresh * 0.08 : 0);
          if (rays && q > 1) {
            const px = DX[i] - cx * dot, py = DY[i] - cy * dot, pz = DZ[i] - cz * dot;
            const az = Math.atan2(px * e2[0] + py * e2[1] + pz * e2[2], px * e1[0] + py * e1[1] + pz * e1[2]);
            let ray = 0;
            for (const a of rayAz) { let da = Math.abs(az - a); da = Math.min(da, Math.PI * 2 - da); ray += Math.exp(-((da * q * 5) ** 2)); }
            b += 0.22 * Math.min(ray, 1.4) * Math.exp(-(q - 1) / 2.2);
          }
          if (b > 0) { alb[i * 3] *= 1 + b; alb[i * 3 + 1] *= 1 + b; alb[i * 3 + 2] *= 1 + b; }
        }
      }
    }
  }
}

/* ---- airless grey worlds: highlands, dark maria (old flooded basins), craters ---- */
function rocky(seed: number, maria: number, basins: number, out: { alb: Float32Array; hgt: Float32Array }) {
  const n1 = makeNoise3(seed), n2 = makeNoise3(seed + 1), n3 = makeNoise3(seed + 2), rnd = mulberry32(seed + 3);
  // great impact basins, most of them on the near face (+x), flooded with dark lava
  const B = Array.from({ length: basins }, (_, k) => {
    const lon = (rnd() - 0.5) * (k < basins - 1 ? 2.2 : 6), lat = (rnd() - 0.5) * 1.6, cl = Math.cos(lat);
    return [cl * Math.cos(lon), cl * Math.sin(lon), Math.sin(lat), 0.12 + 0.22 * rnd()];
  });
  const flood = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = DX[i], y = DY[i], z = DZ[i];
    const w = fbm3(n1, x * 1.2 + 3.1, y * 1.2, z * 1.2 - 1.7, 4), w2 = fbm3(n1, x * 3.5 - 2, y * 3.5 + 1, z * 3.5, 4);
    let m = w * 0.6 - 0.25 + maria;
    for (const [bx, by, bz, br] of B) {   // ragged, overlapping shores, not clean circles
      const d = Math.acos(clamp(x * bx + y * by + z * bz, -1, 1));
      m = Math.max(m, 1 - d / br + 0.5 * w + 0.85 * w2);
    }
    const f = smoothstep(0.0, 0.18, m);
    flood[i] = f;
    const g = fbm3(n2, x * 7, y * 7, z * 7, 4), fine = n3(x * 40, y * 40, z * 40);
    const hi: RGB = [0.69 * 1.03, 0.69, 0.69 * 0.96], lo: RGB = [0.31 * 0.95, 0.31 * 0.98, 0.31 * 1.05];
    const c = mixC(hi, lo, f), k = 0.9 + 0.16 * g + 0.04 * fine;
    out.alb[i * 3] = c[0] * k; out.alb[i * 3 + 1] = c[1] * k; out.alb[i * 3 + 2] = c[2] * k;
    out.hgt[i] = (1 - f) * 0.004 + 0.006 * g;
  }
  return flood;
}

/* ---- Verran: rust deserts, dark basalt plains, a great canyon, white poles ---- */
function desert(out: { alb: Float32Array; hgt: Float32Array }) {
  const n1 = makeNoise3(71), n2 = makeNoise3(72), n3 = makeNoise3(73);
  const cn = [0.3, 0.86, 0.41], cl = Math.hypot(cn[0], cn[1], cn[2]);   // the canyon follows a great circle
  const dust: RGB = [0.7, 0.4, 0.22], rust: RGB = [0.5, 0.23, 0.13], basalt: RGB = [0.25, 0.16, 0.13], pale: RGB = [0.82, 0.63, 0.45], ice: RGB = [0.93, 0.93, 0.96];
  for (let i = 0; i < N; i++) {
    const x = DX[i], y = DY[i], z = DZ[i];
    const r = fbm3(n1, x * 2.2, y * 2.2, z * 2.2, 6), m = fbm3(n2, x * 5 + 2, y * 5, z * 5, 4);
    let c = mixC(dust, rust, smoothstep(-0.2, 0.3, m));
    c = mixC(c, basalt, smoothstep(-0.12, -0.32, r) * 0.85);
    c = mixC(c, pale, smoothstep(0.22, 0.42, r) * 0.6);
    // canyon: a long trench on part of a great circle, wobbling
    const dc = (x * cn[0] + y * cn[1] + z * cn[2]) / cl + 0.012 * n3(x * 9, y * 9, z * 9);
    const along = smoothstep(-0.9, -0.2, Math.atan2(y, x)) * smoothstep(1.4, 0.6, Math.atan2(y, x));
    const canyon = Math.exp(-((dc / 0.012) ** 2)) * along;
    c = mixC(c, basalt, canyon * 0.6);
    const cap = smoothstep(1.16, 1.24, Math.abs(LAT[i]) + 0.05 * m + 0.04 * r);
    c = mixC(c, ice, cap);
    out.alb[i * 3] = c[0]; out.alb[i * 3 + 1] = c[1]; out.alb[i * 3 + 2] = c[2];
    out.hgt[i] = 0.01 * r - 0.012 * canyon;
  }
}

/* ---- gas and ice giants: warped latitude bands, filaments, storms ---- */
function giant(seed: number, ice: boolean, out: { alb: Float32Array; hgt: Float32Array }) {
  const n1 = makeNoise3(seed), n2 = makeNoise3(seed + 1), n3 = makeNoise3(seed + 2);
  const stops: [number, RGB][] = ice
    ? [[0, [0.3, 0.55, 0.64]], [0.5, [0.46, 0.72, 0.77]], [1, [0.66, 0.86, 0.88]]]
    : [[0, [0.4, 0.2, 0.1]], [0.28, [0.68, 0.42, 0.22]], [0.55, [0.88, 0.74, 0.54]], [0.8, [0.95, 0.88, 0.74]], [1, [0.97, 0.94, 0.86]]];
  const storm = ice ? { lat: 0.32, lon: -1.0, a: 0.14, b: 0.07 } : { lat: -0.42, lon: 1.2, a: 0.17, b: 0.075 };
  for (let i = 0; i < N; i++) {
    const x = DX[i], y = DY[i], z = DZ[i], lat = LAT[i], lon = LON[i];
    const w1 = fbm3(n1, x * 2, y * 2, z * 2, 4), w2 = fbm3(n2, x * 6 + 3.1, y * 6, z * 6, 3);
    const lw = lat + 0.06 * w1 + 0.022 * w2 * Math.cos(lat);
    const fine = fbm3(n3, x * 6, y * 6, lw * 45, 4);   // filaments stretched along the bands
    let t: number;
    if (ice) t = 0.5 + 0.13 * Math.sin(lw * 6.2 + 0.5) + 0.06 * Math.sin(lw * 15) + 0.08 * fine;
    else t = 0.52 + 0.3 * Math.sin(lw * 7.3 + 1.1) + 0.17 * Math.sin(lw * 17 + 0.4) + 0.08 * Math.sin(lw * 31) + 0.14 * fine;
    t += 0.12 * (1 - smoothstep(0.0, 0.25, Math.abs(lw)));   // a bright equatorial zone
    let c = ramp(stops, clamp(t, 0, 1));
    // the polar regions fade into a mottled grey-blue (giant) or brighten (ice)
    const pole = smoothstep(1.0, 1.3, Math.abs(lat) + 0.05 * w1);
    c = mixC(c, ice ? [0.74, 0.9, 0.9] : [0.58, 0.6, 0.6], pole * (0.7 + 0.3 * fine));
    // the great storm: an oval swirl
    let dl = lon - storm.lon; dl -= Math.round(dl / (Math.PI * 2)) * Math.PI * 2;
    const ex = dl * Math.cos(lat) / storm.a, ey = (lat - storm.lat) / storm.b, q = Math.hypot(ex, ey);
    if (q < 1.6) {
      const sw = Math.atan2(ey, ex) + (1 - Math.min(q, 1)) * 5;
      const swirl = 0.5 + 0.5 * Math.sin(q * 10 + sw * 2 + fine * 4);
      const sc: RGB = ice ? [0.26, 0.44, 0.58] : mixC([0.8, 0.42, 0.28], [0.92, 0.7, 0.55], swirl * (1 - q));
      c = mixC(c, sc, smoothstep(1.15, 0.75, q));
      c = mixC(c, ice ? [0.8, 0.94, 0.95] : [0.95, 0.9, 0.82], smoothstep(1.0, 1.1, q) * smoothstep(1.4, 1.1, q) * 0.5);   // pale collar
    }
    out.alb[i * 3] = c[0]; out.alb[i * 3 + 1] = c[1]; out.alb[i * 3 + 2] = c[2];
    out.hgt[i] = 0;
  }
}

/* ---- ring profiles: inner → outer edge ---- */
function rings() {
  const out = new Uint8Array(RING_W * 4 * 2), n = makeNoise3(91), rnd = mulberry32(92);
  for (let x = 0; x < RING_W; x++) {
    const u = (x + 0.5) / RING_W;
    // Orrin: faint inner ring, a dense broad ring, a dark division, an outer ring with a gap, a thin ringlet
    let d = u < 0.22 ? 0.16 + 0.1 * n(u * 40, 0.5, 0.5) : u < 0.58 ? 0.85 + 0.15 * n(u * 60, 1.5, 0.5) : u < 0.635 ? 0.04 : u < 0.93 ? 0.55 + 0.12 * n(u * 50, 2.5, 0.5) : 0;
    if (Math.abs(u - 0.845) < 0.008) d *= 0.15;
    if (Math.abs(u - 0.965) < 0.006) d = 0.42;
    d *= 0.82 + 0.18 * Math.sin(u * 900 + 6 * n(u * 30, 3.5, 0.5));   // ringlets
    d *= smoothstep(0, 0.02, u) * smoothstep(1, 0.985, u);
    const c = u < 0.22 ? [0.7, 0.68, 0.64] : u < 0.6 ? [0.88, 0.8, 0.67] : [0.8, 0.75, 0.67];
    const k = 0.92 + 0.08 * rnd();
    out.set([c[0] * k * 255, c[1] * k * 255, c[2] * k * 255, clamp(d, 0, 1) * 255].map(Math.round), x * 4);
    // Vael: three narrow ringlets
    let dv = 0;
    for (const [p, w, a] of [[0.18, 0.025, 0.45], [0.55, 0.035, 0.6], [0.9, 0.02, 0.5]]) dv += a * Math.exp(-(((u - p) / w) ** 2));
    out.set([0.7 * 255, 0.76 * 255, 0.8 * 255, clamp(dv, 0, 1) * 255].map(Math.round), (RING_W + x) * 4);
  }
  return out;
}

ctx.onmessage = () => {
  const LAYERS = 5, maps = new Uint8Array(N * 4 * LAYERS), means: number[] = [], ranges: number[] = [];
  const alb = new Float32Array(N * 3), hgt = new Float32Array(N), buf = { alb, hgt };
  const pack = (layer: number) => {
    let lo = Infinity, hi = -Infinity, sum = 0;
    for (let i = 0; i < N; i++) { lo = Math.min(lo, hgt[i]); hi = Math.max(hi, hgt[i]); }
    const hs = hi > lo ? 1 / (hi - lo) : 0, base = layer * N * 4;
    for (let i = 0; i < N; i++) {
      const r = clamp(alb[i * 3], 0, 1), g = clamp(alb[i * 3 + 1], 0, 1), b = clamp(alb[i * 3 + 2], 0, 1);
      sum += (r + g + b) / 3 * Math.cos(LAT[i]);
      maps[base + i * 4] = Math.round(r * 255); maps[base + i * 4 + 1] = Math.round(g * 255); maps[base + i * 4 + 2] = Math.round(b * 255);
      maps[base + i * 4 + 3] = Math.round((hgt[i] - lo) * hs * 255);
    }
    means[layer] = sum / (N * 2 / Math.PI);
    ranges[layer] = hi - lo;
  };
  // 0 Lull: maria crowd the face turned home
  const flood = rocky(31, 0, 10, buf);
  craters(alb, hgt, { seed: 32, classes: 9, count: 2, rMax: 0.2, rays: 0.5, flood });
  pack(0);
  // 1 Cinder (and the small moons of Orrin): battered, few smooth plains
  const flood1 = rocky(41, -0.12, 2, buf);
  craters(alb, hgt, { seed: 42, classes: 9, count: 3, rMax: 0.16, rays: 0.3, flood: flood1 });
  pack(1);
  // 2 Verran
  desert(buf);
  craters(alb, hgt, { seed: 52, classes: 6, count: 1, rMax: 0.08, rays: 0 });
  pack(2);
  // 3 Orrin, 4 Vael
  giant(61, false, buf); pack(3);
  giant(81, true, buf); pack(4);
  const ring = rings();
  ctx.postMessage({ maps, rings: ring, means, ranges }, [maps.buffer, ring.buffer]);
};
