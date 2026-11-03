/// <reference lib="webworker" />
import { mulberry32 } from '../core/math';
import { perlin3P, worley3P, perlin2P, worley2P, normalizeToBytes } from '../core/noise';

/* =========================================================================
   Noise volumes (prototype): 64³ cloud shape, 32³ detail, 256² RGBA weather.
   The weather map is laid triplanar over the sphere in the shaders.
   ========================================================================= */
const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = () => {
  const rnd = mulberry32(1234);
  const SN = 64;
  const shapeRaw = new Float32Array(SN * SN * SN);
  {
    const per = [4, 8, 16].map((P) => perlin3P(P, rnd));
    const wor = [4, 8, 16].map((C) => worley3P(C, rnd));
    for (let z = 0; z < SN; z++) for (let y = 0; y < SN; y++) for (let x = 0; x < SN; x++) {
      const u = (x + 0.5) / SN, v = (y + 0.5) / SN, w = (z + 0.5) / SN;
      const pf = per[0](u * 4, v * 4, w * 4) + 0.5 * per[1](u * 8, v * 8, w * 8) + 0.25 * per[2](u * 16, v * 16, w * 16);
      const wf = 0.625 * (1 - wor[0](u * 4, v * 4, w * 4)) + 0.25 * (1 - wor[1](u * 8, v * 8, w * 8)) + 0.125 * (1 - wor[2](u * 16, v * 16, w * 16));
      shapeRaw[x + y * SN + z * SN * SN] = pf * 0.45 + wf;
    }
  }
  const shape = new Uint8Array(SN * SN * SN);
  normalizeToBytes(shapeRaw, shape);

  const DN = 32;
  const detailRaw = new Float32Array(DN * DN * DN);
  {
    const wor = [3, 6, 12].map((C) => worley3P(C, rnd));
    for (let z = 0; z < DN; z++) for (let y = 0; y < DN; y++) for (let x = 0; x < DN; x++) {
      const u = (x + 0.5) / DN, v = (y + 0.5) / DN, w = (z + 0.5) / DN;
      detailRaw[x + y * DN + z * DN * DN] = 0.625 * (1 - wor[0](u * 3, v * 3, w * 3)) + 0.25 * (1 - wor[1](u * 6, v * 6, w * 6)) + 0.125 * (1 - wor[2](u * 12, v * 12, w * 12));
    }
  }
  const detail = new Uint8Array(DN * DN * DN);
  normalizeToBytes(detailRaw, detail);

  // 2D weather / multipurpose noise (tileable)
  const WN = 256;
  const weather2D = new Uint8Array(WN * WN * 4);
  {
    const chans = [[4, 5], [8, 4], [16, 4]].map(([P, oct]) => {
      const fns: ((x: number, y: number) => number)[] = []; for (let o = 0; o < oct; o++) fns.push(perlin2P(P << o, rnd));
      const raw = new Float32Array(WN * WN);
      for (let y = 0; y < WN; y++) for (let x = 0; x < WN; x++) {
        const u = (x + 0.5) / WN, v = (y + 0.5) / WN; let s = 0, a = 1;
        for (let o = 0; o < oct; o++) { const f = P << o; s += a * fns[o](u * f, v * f); a *= 0.5; }
        raw[x + y * WN] = s;
      }
      return raw;
    });
    const wf = [8, 16, 32].map((C) => worley2P(C, rnd));
    const rawA = new Float32Array(WN * WN);
    for (let y = 0; y < WN; y++) for (let x = 0; x < WN; x++) {
      const u = (x + 0.5) / WN, v = (y + 0.5) / WN;
      rawA[x + y * WN] = 0.6 * (1 - wf[0](u * 8, v * 8)) + 0.3 * (1 - wf[1](u * 16, v * 16)) + 0.1 * (1 - wf[2](u * 32, v * 32));
    }
    chans.forEach((raw, c) => normalizeToBytes(raw, weather2D, 4, c));
    normalizeToBytes(rawA, weather2D, 4, 3);
  }

  ctx.postMessage({ shape, detail, weather2D }, [shape.buffer, detail.buffer, weather2D.buffer]);
};
