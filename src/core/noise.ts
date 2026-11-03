import { clamp, lerp, mulberry32, type Rng } from './math';

/* 2D gradient noise from the prototype (used by the spawn plateau and the sound flutter) */
export type Noise2 = (x: number, y: number) => number;
export function makeNoise2(seed: number): Noise2 {
  const rnd = mulberry32(seed);
  const p = new Uint8Array(256); for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint8Array(512); for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = new Float32Array(256), gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const a = rnd() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const a = perm[X + perm[Y]], b = perm[X + 1 + perm[Y]], c = perm[X + perm[Y + 1]], d = perm[X + 1 + perm[Y + 1]];
    const n00 = gx[a] * xf + gy[a] * yf, n10 = gx[b] * (xf - 1) + gy[b] * yf;
    const n01 = gx[c] * xf + gy[c] * (yf - 1), n11 = gx[d] * (xf - 1) + gy[d] * (yf - 1);
    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.414;
  };
}
export const N2a = makeNoise2(11), N2b = makeNoise2(23), N2c = makeNoise2(37);
export function fbm(n: Noise2, x: number, y: number, oct: number) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f); f *= 2.03; a *= 0.5; }
  return s;
}

/* 3D gradient noise for the global terrain (improved-Perlin style, roughly in [-1, 1]) */
export type Noise3 = (x: number, y: number, z: number) => number;
export function makeNoise3(seed: number): Noise3 {
  const rnd = mulberry32(seed);
  const p = new Uint8Array(256); for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint8Array(512); for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const G = new Float32Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    G[i * 3] = r * Math.cos(a); G[i * 3 + 1] = r * Math.sin(a); G[i * 3 + 2] = z;
  }
  const grad = (h: number, x: number, y: number, z: number) => { const k = h * 3; return G[k] * x + G[k + 1] * y + G[k + 2] * z; };
  return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const X = xi & 255, Y = yi & 255, Z = zi & 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10), w = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z, B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    const x0 = lerp(grad(perm[AA], xf, yf, zf), grad(perm[BA], xf - 1, yf, zf), u);
    const x1 = lerp(grad(perm[AB], xf, yf - 1, zf), grad(perm[BB], xf - 1, yf - 1, zf), u);
    const x2 = lerp(grad(perm[AA + 1], xf, yf, zf - 1), grad(perm[BA + 1], xf - 1, yf, zf - 1), u);
    const x3 = lerp(grad(perm[AB + 1], xf, yf - 1, zf - 1), grad(perm[BB + 1], xf - 1, yf - 1, zf - 1), u);
    return lerp(lerp(x0, x1, v), lerp(x2, x3, v), w) * 1.6;
  };
}
export function fbm3(n: Noise3, x: number, y: number, z: number, oct: number, lac = 2.03, gain = 0.5) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f, z * f); f *= lac; a *= gain; }
  return s;
}
export function ridged3(n: Noise3, x: number, y: number, z: number, oct: number) {
  let s = 0, a = 0.5, f = 1, w = 1;
  for (let i = 0; i < oct; i++) {
    let r = 1 - Math.abs(n(x * f, y * f, z * f));
    r *= r * w; w = clamp(r * 1.6, 0, 1);
    s += a * r; f *= 2.07; a *= 0.5;
  }
  return s;
}

/* Periodic (tileable) gradient noise + Worley, for the GPU noise volumes (prototype) */
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
export function perlin3P(P: number, rnd: Rng) {
  const g = new Float32Array(P * P * P * 3);
  for (let i = 0; i < P * P * P; i++) {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    g[i * 3] = r * Math.cos(a); g[i * 3 + 1] = r * Math.sin(a); g[i * 3 + 2] = z;
  }
  const w = (i: number) => ((i % P) + P) % P;
  return (x: number, y: number, z: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = fade(xf), v = fade(yf), s = fade(zf);
    let res = 0;
    for (let c = 0; c < 8; c++) {
      const ox = c & 1, oy = (c >> 1) & 1, oz = (c >> 2) & 1;
      const gi = (w(xi + ox) + w(yi + oy) * P + w(zi + oz) * P * P) * 3;
      const d = g[gi] * (xf - ox) + g[gi + 1] * (yf - oy) + g[gi + 2] * (zf - oz);
      res += d * (ox ? u : 1 - u) * (oy ? v : 1 - v) * (oz ? s : 1 - s);
    }
    return res;
  };
}
export function worley3P(C: number, rnd: Rng) {
  const pts = new Float32Array(C * C * C * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = rnd();
  const w = (i: number) => ((i % C) + C) % C;
  return (x: number, y: number, z: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let md = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy, cz = zi + dz;
      const pi = (w(cx) + w(cy) * C + w(cz) * C * C) * 3;
      const px = cx + pts[pi] - x, py = cy + pts[pi + 1] - y, pz = cz + pts[pi + 2] - z;
      const d = px * px + py * py + pz * pz;
      if (d < md) md = d;
    }
    return Math.sqrt(md);
  };
}
export function perlin2P(P: number, rnd: Rng) {
  const g = new Float32Array(P * P * 2);
  for (let i = 0; i < P * P; i++) { const a = rnd() * Math.PI * 2; g[i * 2] = Math.cos(a); g[i * 2 + 1] = Math.sin(a); }
  const w = (i: number) => ((i % P) + P) % P;
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = fade(xf), v = fade(yf);
    let r = 0;
    for (let c = 0; c < 4; c++) {
      const ox = c & 1, oy = c >> 1;
      const gi = (w(xi + ox) + w(yi + oy) * P) * 2;
      r += (g[gi] * (xf - ox) + g[gi + 1] * (yf - oy)) * (ox ? u : 1 - u) * (oy ? v : 1 - v);
    }
    return r;
  };
}
export function worley2P(C: number, rnd: Rng) {
  const pts = new Float32Array(C * C * 2); for (let i = 0; i < pts.length; i++) pts[i] = rnd();
  const w = (i: number) => ((i % C) + C) % C;
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y); let md = 9;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy, pi = (w(cx) + w(cy) * C) * 2;
      const px = cx + pts[pi] - x, py = cy + pts[pi + 1] - y, d = px * px + py * py;
      if (d < md) md = d;
    }
    return Math.sqrt(md);
  };
}
export function normalizeToBytes(src: Float32Array, out: Uint8Array, stride = 1, offset = 0, lo = 0.01, hi = 0.99) {
  const sorted = Float32Array.from(src).sort();
  const a = sorted[Math.floor(sorted.length * lo)], b = sorted[Math.floor(sorted.length * hi)];
  for (let i = 0; i < src.length; i++) out[i * stride + offset] = Math.round(clamp((src[i] - a) / (b - a), 0, 1) * 255);
}
