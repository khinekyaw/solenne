import { COMMON, REGION_VS } from '../render/glsl';

/* Cottage shaders (prototype). Lighting runs in the region's flat space via
   uFlatM (house-local → flat); the mesh's model matrix places it on the sphere. */
export const HOUSE_VS = /* glsl */`
uniform mat4 uFlatM;
attribute vec3 aColor;
attribute vec4 aInfo;
varying vec3 vColor;
varying vec4 vInfo;
varying vec3 vLocal;
varying vec3 vLN;
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vWorld = (uFlatM * vec4(position, 1.0)).xyz; vLocal = position; vLN = normal;
  vN = normalize(mat3(uFlatM) * normal);
  vColor = aColor; vInfo = aInfo;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
export const HOUSE_FS = /* glsl */`
#define SUN uSunDir
${COMMON}
uniform sampler2D uTerrain;
uniform vec3 uFirePos;
uniform float uFireI;
uniform vec3 uLampPos;
uniform float uLampI;
varying vec3 vColor;
varying vec4 vInfo;
varying vec3 vLocal;
varying vec3 vLN;
varying vec3 vWorld;
varying vec3 vN;
float h1(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float kind = vInfo.x;
  vec3 alb = vColor, L = vLocal, an = abs(normalize(vLN));
  vec2 fp = (an.x > an.y && an.x > an.z) ? L.zy : (an.y > an.z ? L.xz : L.xy);
  if (kind < 0.5) {                                   // lime plaster
    alb *= 0.9 + 0.13 * texture(uWeather, fp * 0.11).b + 0.07 * (texture(uWeather, fp * 0.9 + 0.3).a - 0.5);
    alb *= mix(0.8, 1.0, smoothstep(-0.2, 0.8, L.y));
  } else if (kind < 2.5) {                            // wood: 1 = beams and furniture, 2 = planks
    float g = vInfo.y;
    float a = g < 0.5 ? L.x : (g < 1.5 ? L.y : L.z);
    float b = g < 0.5 ? L.y + L.z : (g < 1.5 ? L.x + L.z : L.x + L.y);
    float n1 = texture(uWeather, vec2(a * 0.15, b * 1.7)).r;
    alb *= 0.8 + 0.2 * (sin(b * 55.0 + n1 * 14.0) * 0.5 + 0.5) * (0.6 + 0.4 * n1);
    if (kind > 1.5) {
      float pi = floor(b / 0.19), f = fract(b / 0.19);
      alb *= (0.85 + 0.25 * h1(pi * 91.7)) * mix(0.5, 1.0, smoothstep(0.0, 0.05, f) * smoothstep(1.0, 0.95, f));
    }
  } else if (kind < 3.5) {                            // rubble stone
    float r = floor(fp.y / 0.26), off = h1(r * 12.9), bw = 0.4 + 0.22 * h1(r * 7.3);
    float cx = fp.x / bw + off, ci = floor(cx);
    vec2 f = vec2(fract(cx), fract(fp.y / 0.26));
    float mortar = smoothstep(0.0, 0.07, f.x) * smoothstep(1.0, 0.93, f.x) * smoothstep(0.0, 0.12, f.y) * smoothstep(1.0, 0.88, f.y);
    alb *= mix(0.5, 0.85 + 0.3 * h1(ci * 17.1 + r * 3.7), mortar) * (0.88 + 0.2 * texture(uWeather, fp * 0.6).a);
  } else if (kind < 4.5) {                            // clay roof tiles in staggered courses
    float r = floor(L.y / 0.16), fy = fract(L.y / 0.16);
    float cx = L.x / 0.24 + 0.5 * mod(r, 2.0), fx = fract(cx);
    alb *= (0.8 + 0.3 * h1(floor(cx) * 13.3 + r * 71.7)) * mix(0.55, 1.0, smoothstep(0.0, 0.3, fy)) * mix(0.8, 1.0, smoothstep(0.0, 0.07, fx) * smoothstep(1.0, 0.93, fx));
    float moss = smoothstep(0.72, 0.9, texture(uWeather, L.xz * 0.21 + 0.4).g * 0.75 + texture(uWeather, L.xz * 0.9).a * 0.25 + (1.0 - fy) * 0.06);
    alb = mix(alb, vec3(0.07, 0.12, 0.05), moss * 0.5);
  } else if (kind < 5.5) {                            // fabric: 1 = patchwork, 2 = striped rug
    float v = vInfo.y;
    if (v > 0.5 && v < 1.5) { vec2 q = floor(fp / 0.27); float h = h1(dot(q, vec2(12.9, 78.2))); alb *= 0.75 + 0.45 * h; alb = mix(alb, alb.gbr, step(0.72, h) * 0.6); }
    else if (v > 1.5) { alb *= mix(0.6, 1.1, step(0.5, fract(L.x * 1.7))); alb = mix(alb, vec3(0.75, 0.68, 0.52), step(0.82, fract(L.x * 1.7)) * 0.7); }
    alb *= 0.92 + 0.12 * texture(uWeather, fp * 2.3).a;
  }

  vec3 N = normalize(vN);
  vec3 toCam = uCamPos - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float indoor = vInfo.z, ao = vInfo.w;
  alb *= 1.0 - 0.2 * uWet * (1.0 - indoor);
  float hs = houseShadow(vWorld, N);
  float ts = mix(texture(uTerrain, terrainUV(vWorld.xz)).r, 1.0, indoor) * cloudShadow(vWorld);
  vec3 sun = uSunColor * GROUND_SUN * max(dot(N, SUN), 0.0) * hs * ts;
  vec3 outC = alb * (sun + skyAmbient(N) * ao);
  vec3 F = uFirePos - vWorld; float fd = length(F);
  vec3 fire = vec3(1.0, 0.48, 0.18) * uFireI * (0.35 + 0.65 * max(dot(N, F / fd), 0.0)) / (1.0 + fd * fd * 0.5);
  vec3 Lm = uLampPos - vWorld; float ld = length(Lm);
  vec3 lamp = vec3(1.0, 0.7, 0.38) * uLampI * (0.3 + 0.7 * max(dot(N, Lm / ld), 0.0)) / (1.0 + ld * ld * 0.7);
  vec3 inC = alb * (sun * 1.7 + skyAmbient(N) * 0.2 * ao + uSunColor * 0.02 * ao + fire + lamp);
  vec3 col = mix(outC, inC, indoor);
  if (kind > 6.5 && kind < 7.5) col += pow(max(dot(reflect(-V, N), SUN), 0.0), 40.0) * uSunColor * 0.15 * hs;
  col += (1.0 - indoor) * uWet * 0.06 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0) * hazeColor(reflect(-V, N));
  if (kind > 7.5) col = alb * 2.6;
  col = mix(col, hazeColor(-V), hazeAmount(dist));
  gl_FragColor = vec4(col, 1.0);
}
`;
export const GLASS_VS = /* glsl */`
uniform mat4 uFlatM;
varying vec3 vWorld;
varying vec3 vN;
void main() { vWorld = (uFlatM * vec4(position, 1.0)).xyz; vN = normalize(mat3(uFlatM) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
export const GLASS_FS = /* glsl */`
#define SUN uSunDir
${COMMON}
uniform float uLampI;
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec3 N = normalize(vN), V = normalize(uCamPos - vWorld);
  if (dot(N, V) < 0.0) N = -N;
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
  vec3 col = hazeColor(reflect(-V, N)) * (0.25 + 0.6 * fres) + vec3(1.0, 0.68, 0.35) * 0.06 * uLampI;
  gl_FragColor = vec4(col, 0.18 + 0.55 * fres);
}
`;
export const FLAME_VS = /* glsl */`
varying vec2 vUv;
varying float vSeed;
attribute float seed;
void main() { vUv = uv; vSeed = seed; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
export const FLAME_FS = /* glsl */`
uniform float uTime;
uniform sampler2D uWeather;
varying vec2 vUv;
varying float vSeed;
void main() {
  vec2 uv = vUv;
  float n = texture(uWeather, vec2(uv.x * 0.5 + vSeed, uv.y * 0.45 - uTime * 0.8)).r;
  float w = (1.0 - uv.y) * 0.42 + 0.04;
  float d = abs(uv.x - 0.5 + (n - 0.5) * 0.3 * uv.y);
  float a = smoothstep(w, w * 0.2, d) * smoothstep(1.0, 0.25, uv.y + (n - 0.5) * 0.45) * smoothstep(0.0, 0.1, uv.y);
  vec3 col = mix(vec3(1.0, 0.28, 0.04), vec3(1.0, 0.82, 0.42), a * a);
  gl_FragColor = vec4(col * a * 2.4, 1.0);
}
`;
export const SMOKE_VS = /* glsl */`
#define SUN uSunDir
${COMMON}
${REGION_VS}
uniform vec3 uTop;
uniform vec2 uWindDir;
uniform float uWindStr;
attribute vec2 seed;
varying float vA;
varying vec3 vCol;
varying vec2 vUv;
void main() {
  float age = fract(uTime * 0.07 + seed.x);
  vec3 p = uTop + vec3(0.0, age * 7.0, 0.0)
         + vec3(uWindDir.x, 0.0, uWindDir.y) * age * age * (3.0 + 9.0 * uWindStr)
         + vec3(sin(uTime * 0.5 + seed.y * 6.3), 0.0, cos(uTime * 0.4 + seed.y * 4.1)) * age * 0.8;
  float size = mix(0.5, 3.6, age);
  vec4 mv = viewMatrix * vec4(uRegionToL * (curveRel(p) - uCamRel), 1.0);
  mv.xy += position.xy * size;
  vUv = position.xy + 0.5;
  vA = smoothstep(0.0, 0.08, age) * (1.0 - age) * 0.5;
  vCol = mix(skyAmbient(vec3(0.0, 1.0, 0.0)) * 0.9, uSunColor * 0.45 + skyAmbient(vec3(0.0, 1.0, 0.0)) * 0.6, 0.6);
  gl_Position = projectionMatrix * mv;
}
`;
export const SMOKE_FS = /* glsl */`
varying float vA;
varying vec3 vCol;
varying vec2 vUv;
void main() {
  vec2 c = vUv - 0.5;
  float a = smoothstep(0.5, 0.1, length(c)) * vA;
  gl_FragColor = vec4(vCol, a);
}
`;
