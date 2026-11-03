import { COMMON } from '../render/glsl';
import { GLASS, DOOR, DOME, HULL } from './wrenShape';

const f = (x: number) => x.toFixed(4);
/* =========================================================================
   The Wren's shaders. Same lighting as the cottage (gentle sun, strong
   skylight, the house/ship shadow maps, haze), in the spawn region's flat
   space via uFlatM. The hull skin is procedural: a seeded panel grid with
   aligned seams, darker grooves, rivets, per-panel paint and wear, brass
   strakes, moss on the up-facing seams and the painted name on the nose.
   Openings (glass canopy, door, dome) are cut with the same tests as the
   collision code in wrenShape.ts.
   ========================================================================= */
const REGIONS = /* glsl */`
// aSkin: (metres around, metres along, angle from the top); angle < -8 marks parts that are not hull skin
bool cutOut(vec3 L, vec3 sk) {
  if (sk.z < -8.0) return false;
  float th = abs(sk.z);
  if (th < ${f(GLASS.th)} && sk.y > ${f(GLASS.z0)} + ${f(GLASS.k)} * pow(th / ${f(GLASS.th)}, 2.0)) return true;   // nose canopy
  if (L.x > 0.0 && L.z > ${f(DOOR.z0)} && L.z < ${f(DOOR.z1)} && L.y > ${f(DOOR.y0 - 0.05)}
      && L.y < ${f(DOOR.yArc)} + sqrt(max(0.0, 0.81 - (L.z - 0.8) * (L.z - 0.8)))) return true;                // side door
  if (L.y > 9.0 && length(L.xz - vec2(0.0, ${f(DOME.z)})) < ${f(DOME.hole)}) return true;                     // under the dome
  return false;
}
`;
export const SHIP_VS = /* glsl */`
uniform mat4 uFlatM;
attribute vec3 aColor;
attribute vec4 aInfo;
attribute vec3 aSkin;
varying vec3 vColor;
varying vec4 vInfo;
varying vec3 vLocal;
varying vec3 vLN;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vSkin;
void main() {
  vWorld = (uFlatM * vec4(position, 1.0)).xyz; vLocal = position; vLN = normal; vSkin = aSkin;
  vN = normalize(mat3(uFlatM) * normal);
  vColor = aColor; vInfo = aInfo;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
export const SHIP_FS = /* glsl */`
#define SUN uSunDir
${COMMON}
${REGIONS}
uniform sampler2D uTerrain;
uniform sampler2D uName;
uniform vec4 uLampP[10];   // flat position, intensity (the last one spills out of the door onto the ramp)
uniform vec3 uLampC[10];
uniform float uEye;        // Halden's eye lamp and core: a slow, calm pulse
uniform float uCore;
varying vec3 vColor;
varying vec4 vInfo;
varying vec3 vLocal;
varying vec3 vLN;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vSkin;
float h1(float n) { return fract(sin(n) * 43758.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

/* patchwork hull plating: rows along the hull, staggered columns around it */
vec3 plating(vec3 sk, vec3 Nf, out float seamOut) {
  float RL = 2.3, CW = 1.75;                                     // panel size along and around the hull
  float zw = sk.y + 0.45 * sin(sk.y * 0.29 + 1.3);              // irregular row lengths
  float row = floor(zw / RL), fz = fract(zw / RL) * RL;
  float u = sk.x + h1(row * 7.31) * CW;
  float col = floor(u / CW), fu = fract(u / CW) * CW;
  float id = h2(vec2(row, col));
  vec3 cream = vec3(0.76, 0.65, 0.47), terra = vec3(0.50, 0.19, 0.11), teal = vec3(0.21, 0.32, 0.28), olive = vec3(0.42, 0.35, 0.16), pale = vec3(0.66, 0.62, 0.52);
  vec3 c = id < 0.44 ? cream : id < 0.64 ? terra : id < 0.82 ? teal : id < 0.91 ? olive : pale;
  c *= 0.9 + 0.16 * h2(vec2(col, row) + 3.7);
  // soft wear: faint streaks running down, the odd rust patch, slightly darker toward the belly
  float streak = texture(uWeather, vec2(sk.x * 0.21, sk.y * 0.03 + vLocal.y * 0.09)).r;
  c *= 0.95 + 0.08 * streak;
  float rust = smoothstep(0.9, 0.98, texture(uWeather, sk.xy * 0.11 + id).a + 0.06 * (1.0 - Nf.y));
  c = mix(c, vec3(0.42, 0.2, 0.09), rust * 0.3);
  c *= 0.86 + 0.14 * smoothstep(-0.8, 0.4, Nf.y);
  c *= mix(vec3(1.0), vec3(0.84, 0.78, 0.66), smoothstep(0.5, 1.0, Nf.y) * (0.6 + 0.4 * streak));   // warm grime on the top (else it shone like chrome under the blue sky)
  // seams with a dark groove and a lighter bevel; rivets along them
  float dz = min(fz, RL - fz), du = min(fu, CW - fu), d = min(dz, du);
  float seam = smoothstep(0.015, 0.04, d);
  c *= mix(0.42, 1.0, seam) * (1.0 + 0.1 * (1.0 - smoothstep(0.04, 0.09, d)));
  vec2 rz = vec2(fract(sk.x / 0.17) * 0.17 - 0.085, dz - 0.07), ru = vec2(fract(sk.y / 0.17) * 0.17 - 0.085, du - 0.07);
  float rivet = max(1.0 - smoothstep(0.012, 0.024, length(rz)), 1.0 - smoothstep(0.012, 0.024, length(ru)));
  c = mix(c, c * 1.35 + 0.03, rivet * 0.8);
  seamOut = 1.0 - smoothstep(0.02, 0.3, d);   // nearness to a seam: where moss takes hold
  return c;
}

void main() {
  if (cutOut(vLocal, vSkin)) discard;
  float kind = vInfo.x;
  vec3 alb = vColor, L = vLocal, an = abs(normalize(vLN));
  vec2 fp = (an.x > an.y && an.x > an.z) ? L.zy : (an.y > an.z ? L.xz : L.xy);
  vec3 Nf = normalize(vN);
  float seamK = 0.0;
  if (kind < 0.5) {                                      // patchwork hull skin
    alb = plating(vSkin, Nf, seamK);
    float th = abs(vSkin.z);
    if (vSkin.z > -8.0) {
      // brass strake between the porthole rows
      float sb = smoothstep(0.035, 0.02, abs(th - 0.98));
      alb = mix(alb, vec3(0.42, 0.30, 0.13) * (0.85 + 0.25 * texture(uWeather, vSkin.xy * 0.4).g), sb);
      // the ship's name on the port side of the nose
      if (vSkin.z > 0.0 && vSkin.y > 6.9 && vSkin.y < 9.4 && th > 1.5 && th < 1.75) {
        float m = texture(uName, vec2((9.4 - vSkin.y) / 2.5, 1.0 - (th - 1.5) / 0.25)).a;
        m *= 0.75 + 0.25 * smoothstep(0.3, 0.6, texture(uWeather, vSkin.xy * 0.8).b);   // weathered paint
        alb = mix(alb, vec3(0.08, 0.05, 0.035), m * 0.92);
      }
    }
    // moss gathers along the up-facing seams, with a few patches between (not a blanket: from above or
    // from the dome a heavy coat read as camouflage)
    float mn = texture(uWeather, vSkin.xy * 0.13 + 0.4).g * 0.7 + texture(uWeather, vSkin.xy * 0.6).a * 0.3;
    float moss = smoothstep(0.8, 0.84, mn + 0.25 * seamK) * smoothstep(0.6, 0.7, Nf.y);   // crisp edges: soft ones read as reflections
    alb = mix(alb, mix(vec3(0.09, 0.16, 0.05), vec3(0.22, 0.27, 0.08), texture(uWeather, vSkin.xy * 1.7).r), moss);
  } else if (kind < 2.5) {                               // wood: 1 = beams and furniture, 2 = planks
    float g = vInfo.y;
    float a = g < 0.5 ? L.x : (g < 1.5 ? L.y : L.z);
    float b = g < 0.5 ? L.y + L.z : (g < 1.5 ? L.x + L.z : L.x + L.y);
    float n1 = texture(uWeather, vec2(a * 0.15, b * 1.7)).r;
    alb *= 0.8 + 0.2 * (sin(b * 55.0 + n1 * 14.0) * 0.5 + 0.5) * (0.6 + 0.4 * n1);
    if (kind > 1.5) {
      float pi = floor(b / 0.19), fr = fract(b / 0.19);
      alb *= (0.85 + 0.25 * h1(pi * 91.7)) * mix(0.5, 1.0, smoothstep(0.0, 0.05, fr) * smoothstep(1.0, 0.95, fr));
    }
  } else if (kind < 4.5) {                               // inside of the hull: painted panels between wooden ribs
    float rib = smoothstep(0.07, 0.05, abs(fract(vSkin.y / 1.25) * 1.25 - 0.62));
    float pz = fract(vSkin.x / 0.9) * 0.9, pd = min(pz, 0.9 - pz);
    alb *= (0.9 + 0.12 * texture(uWeather, vSkin.xy * 0.3).b) * mix(0.75, 1.0, smoothstep(0.0, 0.025, pd));
    alb = mix(alb, vec3(0.30, 0.19, 0.11) * (0.8 + 0.3 * texture(uWeather, vec2(vSkin.x * 0.2, vSkin.y * 2.0)).r), rib);
  } else if (kind < 5.5) {                               // fabric: 1 = patchwork quilt, 2 = striped rug
    float v = vInfo.y;
    if (v > 0.5 && v < 1.5) { vec2 q = floor(fp / 0.27); float h = h1(dot(q, vec2(12.9, 78.2))); alb *= 0.75 + 0.45 * h; alb = mix(alb, alb.gbr, step(0.72, h) * 0.6); }
    else if (v > 1.5) { alb *= mix(0.6, 1.1, step(0.5, fract(L.x * 1.7))); alb = mix(alb, vec3(0.75, 0.68, 0.52), step(0.82, fract(L.x * 1.7)) * 0.7); }
    alb *= 0.92 + 0.12 * texture(uWeather, fp * 2.3).a;
  }

  vec3 N = Nf;
  vec3 toCam = uCamPos - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  if (dot(N, V) < 0.0 && kind > 0.5) N = -N;   // thin interior parts are seen from both sides
  float indoor = vInfo.z, ao = vInfo.w;
  alb *= 1.0 - 0.2 * uWet * (1.0 - indoor);
  float hs = houseShadow(vWorld, N);
  float ts = cloudShadow(vWorld);   // (not the meadow's baked shadow: the hull stands metres above it)
  vec3 sun = uSunColor * GROUND_SUN * max(dot(N, SUN), 0.0) * hs * ts;
  // warm lamps inside; only the last spills out of the door onto the ramp
  vec3 lamps = vec3(0.0);
  for (int i = 0; i < 10; i++) {
    vec3 Lm = uLampP[i].xyz - vWorld; float ld = length(Lm);
    float k = i == 9 ? 1.0 : indoor;
    lamps += uLampC[i] * uLampP[i].w * k * (0.3 + 0.7 * max(dot(N, Lm / ld), 0.0)) / (1.0 + ld * ld * 0.55);
  }
  vec3 outC = alb * (sun + skyAmbient(N) * ao + lamps);
  vec3 inC = alb * (sun * 1.7 + skyAmbient(N) * 0.12 * ao + uSunColor * 0.015 * ao + lamps);
  vec3 col = mix(outC, inC, step(0.5, indoor));
  if (kind < 0.5 || (kind > 6.5 && kind < 7.5)) col += pow(max(dot(reflect(-V, N), SUN), 0.0), kind < 0.5 ? 18.0 : 40.0) * uSunColor * (kind < 0.5 ? 0.05 : 0.15) * hs;
  col += (1.0 - indoor) * uWet * 0.06 * pow(1.0 - max(dot(N, V), 0.0), 4.0) * hazeColor(reflect(-V, N));
  // lights: warm (portholes, lamps; Halden's eye and core pulse), cool blue-white (seams, engines, instruments)
  if (kind > 7.5 && kind < 8.5) {
    float g = vInfo.y, pulse = g > 2.5 ? uCore : g > 1.5 ? uEye : 1.0;
    // (the core is a large surface seen up close: much less gain than a small lamp)
    col = alb * (g > 2.5 ? 1.25 : g > 0.5 && g < 1.5 ? 1.1 + 1.6 * uNight : 2.6) * pulse;
  }
  if (kind > 8.5 && kind < 9.5) {
    col = alb * (1.8 + 1.2 * uNight) * (vInfo.y > 0.5 ? 0.85 + 0.15 * sin(uTime * 1.7 + L.z * 0.6) : 1.0);
    // holographic instruments: dimmer, with drifting scan lines
    if (vInfo.y > 1.5) col = alb * (0.45 + 0.35 * uNight) * (0.65 + 0.35 * step(0.45, fract(L.y * 34.0 - uTime * 0.6)));
  }
  // a porthole seen from inside: the sky beyond the glass
  if (kind > 9.5) col = hazeColor(-V) * 1.05 + skyAmbient(-V) * 0.15;
  col = mix(col, hazeColor(-V), hazeAmount(dist));
  gl_FragColor = vec4(col, 1.0);
}
`;
/* the nose canopy and the dome: reflections, the warm cabin showing through */
export const SHIP_GLASS_FS = /* glsl */`
#define SUN uSunDir
${COMMON}
${REGIONS}
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vSkin;
varying vec3 vColor;
varying vec4 vInfo;
varying vec3 vLN;
void main() {
  // the canopy mesh covers a little more than the opening: keep only the glass part
  if (vSkin.z > -8.0 && !(abs(vSkin.z) < ${f(GLASS.th)} && vSkin.y > ${f(GLASS.z0)} + ${f(GLASS.k)} * pow(abs(vSkin.z) / ${f(GLASS.th)}, 2.0))) discard;
  vec3 N = normalize(vN), V = normalize(uCamPos - vWorld);
  if (dot(N, V) < 0.0) N = -N;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  // a soft sky-blue sheen that catches the sky (as in the concept), the warm cabin faintly behind
  vec3 R = reflect(-V, N);
  vec3 col = mix(hazeColor(R), skyAmbient(R) * 1.4, 0.4) * (0.55 + 0.45 * fres) + uSunColor * pow(max(dot(R, SUN), 0.0), 120.0) * 0.6
           + vec3(0.52, 0.66, 0.78) * 0.08;
  gl_FragColor = vec4(col, 0.34 + 0.5 * fres);
}
`;
/* soft additive glows: the hover pads on the grass, engine exhaust halos */
export const GLOW_VS = /* glsl */`
attribute vec3 aColor;
varying vec2 vUv;
varying vec3 vColor;
void main() { vUv = uv; vColor = aColor; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
export const GLOW_FS = /* glsl */`
uniform float uTime;
uniform float uNight;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = pow(max(1.0 - r, 0.0), 2.2) * (0.85 + 0.15 * sin(uTime * 2.1 + vColor.r * 9.0));
  gl_FragColor = vec4(vColor * a * (0.6 + 0.8 * uNight), 1.0);
}
`;
/* shadow pass: depth only, with the same openings so sunlight falls through the canopy and the dome */
export const SHIP_DEPTH_FS = /* glsl */`
${REGIONS}
varying vec3 vLocal;
varying vec3 vSkin;
varying vec3 vColor;
varying vec4 vInfo;
varying vec3 vLN;
varying vec3 vWorld;
varying vec3 vN;
void main() { if (cutOut(vLocal, vSkin)) discard; gl_FragColor = vec4(1.0); }
`;
export const HULL_THICK = HULL.thick;
