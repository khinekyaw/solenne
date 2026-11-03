import * as THREE from 'three';
import { lerp, smoothstep } from '../core/math';

/* =========================================================================
   Sky palette from the local sun elevation e = sin(elevation), greyed by
   weather. Day values are the prototype's updateSunPalette; below the
   horizon it adds a rosy dusk band and fades to a deep blue night, lifted
   by moonlight when Lull is up.
   Mirrors `palette()` in render/glsl.ts — keep the two in sync.
   ========================================================================= */
export type Wx = { cover: number; dark: number; fog: number; moon: number };
const tmp = new THREE.Color();
export function palette(e: number, w: Wx, sun: THREE.Color, zen: THREE.Color, hor: THREE.Color) {
  const day = smoothstep(0.02, 0.55, e);
  const warm = 1 - smoothstep(0.05, 0.4, e);
  sun.setRGB(1.0, lerp(0.95, 0.66, warm), lerp(0.88, 0.42, warm)).multiplyScalar(lerp(2.1, 3.0, day));
  const set = smoothstep(-0.02, 0.06, e);
  sun.g *= lerp(0.78, 1, set); sun.b *= lerp(0.6, 1, set);
  sun.multiplyScalar(smoothstep(-0.045, 0.025, e));
  zen.setRGB(lerp(0.05, 0.028, day), lerp(0.11, 0.145, day), lerp(0.30, 0.64, day));
  hor.setRGB(lerp(0.72, 0.44, 1 - warm), lerp(0.6, 0.62, 1 - warm), lerp(0.56, 0.86, 1 - warm)).multiplyScalar(lerp(0.8, 1.05, day));
  const twi = smoothstep(-0.2, -0.02, e) * (1 - smoothstep(-0.02, 0.12, e));
  hor.lerp(tmp.setRGB(0.47, 0.32, 0.3), twi * 0.55);
  zen.lerp(tmp.setRGB(0.06, 0.07, 0.18), twi * 0.35);
  const night = smoothstep(0.04, -0.16, e);
  zen.lerp(tmp.setRGB(0.006 + 0.01 * w.moon, 0.011 + 0.018 * w.moon, 0.03 + 0.04 * w.moon), night);
  hor.lerp(tmp.setRGB(0.02 + 0.03 * w.moon, 0.03 + 0.04 * w.moon, 0.055 + 0.058 * w.moon), night);
  // clouds, rain and fog grey the sky and soften the sun; at night an overcast is darker than a clear sky
  // (it hides the stars and the sky's glow), lifted a little when Lull shines through thin cloud
  const dim = lerp(1, 0.07 + 0.1 * w.moon * (1 - w.dark), night);
  sun.multiplyScalar(1 - 0.3 * w.cover - 0.35 * w.dark);
  zen.lerp(tmp.setRGB(0.12, 0.135, 0.16).multiplyScalar((1 - 0.55 * w.dark) * dim), w.cover * 0.85);
  hor.lerp(tmp.setRGB(0.4, 0.43, 0.47).multiplyScalar((1 - 0.62 * w.dark) * dim), w.cover * 0.8);
  hor.lerp(tmp.setRGB(0.5, 0.53, 0.57).multiplyScalar((1 - 0.45 * w.dark) * dim), w.fog * 0.75);
  zen.lerp(hor, w.fog * 0.55);
}
/** how dark it is for the eye (0 day … 1 deep night), used for exposure */
export const nightAmount = (e: number) => smoothstep(0.06, -0.2, e);
