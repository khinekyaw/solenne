import { PLANET_R } from '../config';

/* Cube faces as plain numbers (worker-safe): [n, eu, ev] with ev = eu × n.
   Face 2 (+Y) carries the spawn region; its flat coords are the prototype's world coords. */
export const FACE_DATA: number[][] = [
  [1, 0, 0, 0, 0, -1, 0, -1, 0],
  [-1, 0, 0, 0, 0, 1, 0, -1, 0],
  [0, 1, 0, 1, 0, 0, 0, 0, 1],
  [0, -1, 0, 1, 0, 0, 0, 0, -1],
  [0, 0, 1, 1, 0, 0, 0, -1, 0],
  [0, 0, -1, -1, 0, 0, 0, -1, 0],
];
export const SPAWN_FACE = 2;

/** unit direction of flat face coordinates, written into out[o..o+2] */
export function faceDirRaw(fi: number, X: number, Z: number, out: Float64Array | number[], o = 0) {
  const f = FACE_DATA[fi];
  const x = f[0] * PLANET_R + f[3] * X + f[6] * Z;
  const y = f[1] * PLANET_R + f[4] * X + f[7] * Z;
  const z = f[2] * PLANET_R + f[5] * X + f[8] * Z;
  const inv = 1 / Math.hypot(x, y, z);
  out[o] = x * inv; out[o + 1] = y * inv; out[o + 2] = z * inv;
}
