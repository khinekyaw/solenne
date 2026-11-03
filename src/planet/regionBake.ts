import { GRID, DX, HALF, SEA_BASE, WATER } from '../config';
import { clamp, smoothstep } from '../core/math';
import { H, islandSD, planetHeight } from './heights';

/* =========================================================================
   Detail-region grids (1.4 km, 2.5 m): heights plus a mask texture,
   r = baked sun shadow, g = grass mask, b = island mask (spawn only).
   ========================================================================= */

/** grass on gentle ground anywhere, except inside the cloud-sea deck (cliff bands nobody sees) */
export function grassMask(slope: number, h: number) {
  const inDeck = smoothstep(SEA_BASE - 20, SEA_BASE + 20, h) * (1 - smoothstep(-40, -26, h));
  return (1 - smoothstep(0.42, 0.85, slope)) * (1 - inDeck) * smoothstep(WATER + 1.5, WATER + 3.5, h);   // and none on beaches or under water
}

/** triangle-interpolated ground of a grid (same split as the GPU fetch and the terrain mesh) */
export function gridGround(G: Float32Array, x: number, z: number) {
  const fx = clamp((x + HALF) / DX, 0, GRID - 1.001), fz = clamp((z + HALF) / DX, 0, GRID - 1.001);
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
  const i = iz * GRID + ix;
  const h00 = G[i], h10 = G[i + 1], h01 = G[i + GRID], h11 = G[i + GRID + 1];
  if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
  return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
}

/** heights of a region centred at (cx, cz) on a face, aligned with the 2.5 m terrain grid */
export function regionHeights(face: number, cx: number, cz: number) {
  const G = new Float32Array(GRID * GRID);
  for (let iz = 0; iz < GRID; iz++) for (let ix = 0; ix < GRID; ix++) G[iz * GRID + ix] = planetHeight(face, cx + ix * DX - HALF, cz + iz * DX - HALF);
  return G;
}

/** mask texture data for a grid; `island` adds the spawn plateau's island mask in b */
export function regionMasks(G: Float32Array = H, island = true) {
  const tdata = new Uint8Array(GRID * GRID * 4);
  for (let iz = 0; iz < GRID; iz++) for (let ix = 0; ix < GRID; ix++) {
    const i = iz * GRID + ix;
    const hl = G[iz * GRID + Math.max(ix - 1, 0)], hr = G[iz * GRID + Math.min(ix + 1, GRID - 1)];
    const hd = G[Math.max(iz - 1, 0) * GRID + ix], hu = G[Math.min(iz + 1, GRID - 1) * GRID + ix];
    const s = Math.hypot((hr - hl) / (2 * DX), (hu - hd) / (2 * DX));
    tdata[i * 4] = 255;
    tdata[i * 4 + 1] = Math.round(255 * grassMask(s, G[i]));
    tdata[i * 4 + 2] = island ? Math.round(255 * (1 - smoothstep(-30, -2, islandSD(ix * DX - HALF, iz * DX - HALF)))) : 0;
    tdata[i * 4 + 3] = 255;
  }
  return tdata;
}

/** terrain self-shadow toward the sun (direction in the grid's face axes), soft-edged (prototype) */
export function bakeShadow(sun: number[], out: Uint8Array, G: Float32Array = H) {
  const hl = Math.hypot(sun[0], sun[2]) || 1e-4;
  const dx = sun[0] / hl, dz = sun[2] / hl, slope = sun[1] / hl;
  const night = sun[1] < -0.02;
  for (let iz = 0; iz < GRID; iz++) for (let ix = 0; ix < GRID; ix++) {
    const i = iz * GRID + ix, h0 = G[i];
    let s = night ? 0 : 1;
    // nothing to bake inside or under the deck: the sun never gets there
    if (!night && h0 > SEA_BASE - 30) {
      const x0 = ix * DX - HALF, z0 = iz * DX - HALF;
      let d = 2.0;
      for (let k = 0; k < 46; k++) {
        const rh = h0 + 0.4 + slope * d;
        if (rh > h0 + 140) break;
        const diff = rh - gridGround(G, x0 + dx * d, z0 + dz * d);
        if (diff < 0) { s = 0; break; }
        s = Math.min(s, 22 * diff / d);
        d += Math.max(1.6, d * 0.09);
      }
    }
    out[i] = Math.round(smoothstep(0, 1, s) * 255);
  }
  return out;
}
