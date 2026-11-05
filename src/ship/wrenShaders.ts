import { COMMON } from '../render/glsl';
import { GLASS, DOOR, DOME, HULL } from './wrenShape';

const f = (x: number) => x.toFixed(4);
/* =========================================================================
   The Wren's shaders. Same lighting as the cottage (gentle sun, strong
   skylight, shadow maps, haze), but local shaders: SUN = uSunDirL, camera at
   the origin, so the ship is lit right wherever it stands or flies, up to
   orbit. What belongs to the ship lives in ship-local metres (vLocal): its
   own shadow map, its lamps, the openings. SHIP_*: the code-built inside
   (wood, painted panels, lamps); the canopy, doorway and dome are cut from the
   inner shell with the collision code's tests (wrenShape.ts). MODEL_*: the
   Blender model's outside, lit from its baked atlas (albedo, normal,
   AO/roughness/metal) and named lamp materials.
   ========================================================================= */
const REGIONS = /* glsl */`
// aSkin: (metres around, metres along, angle from the top); angle < -8 marks parts that are not hull skin
bool cutOut(vec3 L, vec3 sk) {
  if (sk.z < -8.0) return false;
  float th = abs(sk.z);
  if (th < ${f(GLASS.th)} && sk.y > ${f(GLASS.z0)} + ${f(GLASS.k)} * pow(th / ${f(GLASS.th)}, 2.0)) return true;   // nose canopy
  float dz = max(abs(L.z - 0.8) - ${f(0.9 - DOOR.r)}, 0.0);                                                     // side doorway: a rounded rectangle
  if (L.x > 0.0 && L.z > ${f(DOOR.z0)} && L.z < ${f(DOOR.z1)} && L.y > ${f(DOOR.y0 - 0.05)}
      && L.y < ${f(DOOR.y1 - DOOR.r)} + sqrt(max(0.0, ${f(DOOR.r * DOOR.r)} - dz * dz))) return true;
  if (L.y > 9.0 && length(L.xz - vec2(0.0, ${f(DOME.z)})) < ${f(DOME.hole)}) return true;                     // under the dome
  return false;
}
`;
// the ship's own shadow map (ship-local), cloud shadows from the planet-fixed position of a local point
const SHIP_LIGHT = /* glsl */`
uniform mat4 uShipShadowL;   // ship-local -> the ship's shadow map
uniform vec3 uCamShip;       // the camera in ship-local metres
float shipShadow(vec3 L, vec3 n) { return shadowMapPCF(uSShadow, uShipShadowL, L, n); }
float cloudShadowL(vec3 w) { vec3 p = uCamPF + uLtoPF * w; return cloudShadowPF(p, length(p) - PLANET_R); }
`;
export const SHIP_VS = /* glsl */`
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
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz; vLocal = position; vLN = normal; vSkin = aSkin;
  vN = normalize(mat3(modelMatrix) * normal);
  vColor = aColor; vInfo = aInfo;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
export const SHIP_FS = /* glsl */`
#define SUN uSunDirL
${COMMON}
${REGIONS}
${SHIP_LIGHT}
uniform vec4 uLampP[10];   // ship-local position, intensity (the last one spills out of the door onto the ramp)
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

void main() {
  if (cutOut(vLocal, vSkin)) discard;
  float kind = vInfo.x;
  vec3 alb = vColor, L = vLocal, an = abs(normalize(vLN));
  vec2 fp = (an.x > an.y && an.x > an.z) ? L.zy : (an.y > an.z ? L.xz : L.xy);
  if (kind < 2.5) {                               // wood: 1 = beams and furniture, 2 = planks
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

  vec3 N = normalize(vN), NL = normalize(vLN);   // the same normal in the local frame and in the ship's
  float dist = length(vWorld);
  vec3 V = -vWorld / dist;
  if (dot(NL, uCamShip - vLocal) < 0.0) { N = -N; NL = -NL; }   // thin interior parts are seen from both sides
  float indoor = vInfo.z, ao = vInfo.w;
  alb *= 1.0 - 0.2 * uWet * (1.0 - indoor);
  float hs = shipShadow(vLocal, NL);
  float ts = cloudShadowL(vWorld);
  vec3 sun = uSunColor * GROUND_SUN * max(dot(N, SUN), 0.0) * hs * ts;
  // warm lamps inside; only the last spills out of the door onto the ramp
  vec3 lamps = vec3(0.0);
  for (int i = 0; i < 10; i++) {
    vec3 Lm = uLampP[i].xyz - vLocal; float ld = length(Lm);
    float k = i == 9 ? 1.0 : indoor;
    lamps += uLampC[i] * uLampP[i].w * k * (0.3 + 0.7 * max(dot(NL, Lm / ld), 0.0)) / (1.0 + ld * ld * 0.55);
  }
  vec3 outC = alb * (sun + skyAmbient(N) * ao + lamps);
  vec3 inC = alb * (sun * 1.7 + skyAmbient(N) * 0.12 * ao + uSunColor * 0.015 * ao + lamps);
  vec3 col = mix(outC, inC, step(0.5, indoor));
  if (kind > 6.5 && kind < 7.5) col += pow(max(dot(reflect(-V, N), SUN), 0.0), 40.0) * uSunColor * 0.15 * hs;
  col += (1.0 - indoor) * uWet * 0.06 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0) * hazeColor(reflect(-V, N));
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
/* the jets: soft plumes billboarded round their axes (ship-local), longer and brighter with the thrust; the
   lift jets under the pods only near the ground */
export const JET_VS = /* glsl */`
attribute vec3 aBase;
attribute vec4 aJet;   // axis (xyz), lift jet (w)
attribute vec2 aSize;  // length, width
uniform vec3 uCamShip;
uniform float uThrust;
uniform float uLift;
varying vec2 vUv;
varying float vK;
void main() {
  vK = aJet.w > 0.5 ? uLift : uThrust;
  vec3 ax = aJet.xyz, side = normalize(cross(ax, normalize(uCamShip - aBase)));
  vec3 p = aBase + ax * uv.y * aSize.x * (0.35 + 0.65 * vK) + side * (uv.x - 0.5) * aSize.y * mix(0.55, 1.5, uv.y);
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;
export const JET_FS = /* glsl */`
uniform float uTime;
varying vec2 vUv;
varying float vK;
void main() {
  float a = clamp(vUv.y, 0.0, 1.0), x = abs(vUv.x - 0.5) * 2.0;   // (clamped: pow of a negative base is NaN, and bloom spreads it)
  float body = exp(-x * x * 5.0) * pow(1.0 - a, 1.8) * smoothstep(0.0, 0.06, a);
  float core = exp(-x * x * 40.0) * pow(1.0 - a, 5.0);
  // a little turbulence running down the plume
  float flick = 0.8 + 0.2 * sin(uTime * 37.0 - a * 21.0) * sin(uTime * 23.0 + a * 13.0 + x * 4.0);
  vec3 col = vec3(0.32, 0.6, 0.95) * body * 0.55 + vec3(0.8, 0.92, 1.0) * core * 0.9;
  gl_FragColor = vec4(col * flick * vK, 1.0);
}
`;
/* shadow pass (rendered in ship-local metres): depth only, with the same openings so sunlight falls
   through the canopy and the dome */
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

/* ---- the Blender model (outside) ---- */
export const MODEL_VS = /* glsl */`
uniform mat4 uNodeM;   // the node's matrix in the model: its vertices in ship-local metres
attribute vec4 tangent;
varying vec3 vWorld;
varying vec3 vN;
varying vec4 vT;
varying vec2 vUv;
varying vec3 vLocal;
varying vec3 vLN;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vLocal = (uNodeM * vec4(position, 1.0)).xyz; vLN = normalize(mat3(uNodeM) * normal);
  vN = normalize(mat3(modelMatrix) * normal);
  vT = vec4(mat3(modelMatrix) * tangent.xyz, tangent.w);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const MODEL_VARYINGS = /* glsl */`
varying vec3 vWorld;
varying vec3 vN;
varying vec4 vT;
varying vec2 vUv;
varying vec3 vLocal;
varying vec3 vLN;
`;
/* the painted hull, brass, enamel, wood: albedo, normal map and AO from the bake, the game's light */
export const MODEL_FS = /* glsl */`
#define SUN uSunDirL
${COMMON}
${SHIP_LIGHT}
uniform sampler2D uAlb;
uniform sampler2D uNrm;
uniform sampler2D uOrm;
uniform vec4 uLampP[10];   // (the last spills out of the door onto the ramp)
uniform vec3 uLampC[10];
${MODEL_VARYINGS}
void main() {
  vec3 alb = texture(uAlb, vUv).rgb, orm = texture(uOrm, vUv).rgb, tn = texture(uNrm, vUv).xyz * 2.0 - 1.0;
  vec3 Ng = normalize(vN), T = normalize(vT.xyz - Ng * dot(vT.xyz, Ng)), B = cross(Ng, T) * (vT.w < 0.0 ? -1.0 : 1.0);
  vec3 N = normalize(T * tn.x + B * tn.y + Ng * tn.z);
  float dist = length(vWorld);
  vec3 V = -vWorld / dist;
  float ao = orm.r, rough = orm.g, metal = orm.b;
  alb *= 1.0 - 0.2 * uWet;
  float hs = shipShadow(vLocal, vLN), ts = cloudShadowL(vWorld);
  vec3 sun = uSunColor * GROUND_SUN * max(dot(N, SUN), 0.0) * hs * ts;
  vec3 Lm = uLampP[9].xyz - vLocal;
  float ld = length(Lm);
  vec3 lamp = uLampC[9] * uLampP[9].w * (0.3 + 0.7 * max(dot(vLN, Lm / ld), 0.0)) / (1.0 + ld * ld * 0.55);
  vec3 col = alb * (sun + skyAmbient(N) * ao + lamp);
  // brass and enamel catch the sun, the matt paint hardly
  vec3 R = reflect(-V, N);
  col += pow(max(dot(R, SUN), 0.0), mix(90.0, 12.0, rough)) * uSunColor * mix(0.03, 0.3, metal) * mix(vec3(1.0), alb * 1.6, metal) * hs * ts;
  col += uWet * 0.06 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0) * hazeColor(R);
  col = mix(col, hazeColor(-V), hazeAmount(dist));
  gl_FragColor = vec4(col, 1.0);
}
`;
/* the nose canopy and the dome: reflections, the cabin faintly behind */
export const MODEL_GLASS_FS = /* glsl */`
#define SUN uSunDirL
${COMMON}
${MODEL_VARYINGS}
void main() {
  vec3 N = normalize(vN), V = normalize(-vWorld);
  if (dot(N, V) < 0.0) N = -N;
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
  vec3 R = reflect(-V, N);
  vec3 col = mix(hazeColor(R), skyAmbient(R) * 1.4, 0.4) * (0.55 + 0.45 * fres) + uSunColor * pow(max(dot(R, SUN), 0.0), 120.0) * 0.6
           + vec3(0.52, 0.66, 0.78) * 0.08 * clamp(dot(uHorizon, vec3(0.3, 0.5, 0.2)) * 3.0, 0.1, 1.0);   // the glass's own tint, lit by the sky (little in space)
  gl_FragColor = vec4(col, 0.34 + 0.5 * fres);
}
`;
/* lamps: portholes (warm, brighter at night), Halden's eye (a slow pulse), the cool strips and emitters */
export const MODEL_GLOW_FS = /* glsl */`
#define SUN uSunDirL
${COMMON}
uniform vec3 uGlowC;
uniform float uGlowK;   // 0 porthole, 1 Halden's eye, 2 cool light
uniform float uEye;
uniform float uThrust;  // the engines brighten with the throttle
${MODEL_VARYINGS}
void main() {
  float dist = length(vWorld);
  vec3 col = uGlowK < 0.5 ? uGlowC * (1.1 + 1.6 * uNight)
           : uGlowK < 1.5 ? uGlowC * 2.6 * uEye
           : uGlowC * (1.8 + 1.2 * uNight + 2.5 * uThrust) * (0.85 + 0.15 * sin(uTime * 1.7 + vLocal.z * 0.6));
  col = mix(col, hazeColor(vWorld / dist), hazeAmount(dist));
  gl_FragColor = vec4(col, 1.0);
}
`;
export const MODEL_DEPTH_FS = /* glsl */`
void main() { gl_FragColor = vec4(1.0); }
`;
