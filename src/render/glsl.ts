import { SEA_TOP, SEA_BASE, WATER, WORLD, GRID, PLANET_R, ATMO_H, LAND_RES, LAND_TOP_RES, LAND_TOP } from '../config';
import { FACE_DATA } from '../planet/faces';

const f1 = (x: number) => x.toFixed(1);
const vec3s = (k: number) => FACE_DATA.map((f) => `vec3(${f[k].toFixed(1)}, ${f[k + 1].toFixed(1)}, ${f[k + 2].toFixed(1)})`).join(', ');

/* =========================================================================
   Shared GLSL. Two families of shaders use it:
   - region shaders (grass, flowers, cottage): prototype math in the spawn
     region's flat space; SUN = uSunDir, camera = uCamPos (flat coords).
   - local shaders (terrain, sky, rain, motes): camera-relative local frame;
     SUN = uSunDirL, camera at the origin.
   Each shader #defines SUN before including COMMON.
   ========================================================================= */
export const COMMON = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uSunDirL;
uniform vec3 uSunDirF;   // sun in the detail region's face axes
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uCamPos;
uniform vec3 uCamPF;
uniform mat3 uLtoPF;
uniform vec3 uCenterL;
uniform float uCamAlt;
uniform float uTime;
uniform vec3 uCloudOff;
uniform float uCover;
uniform float uDark;
uniform float uFog;
uniform float uWet;
uniform float uFlash;
uniform float uNight;
uniform float uMoonlit;   // Lull's light on the night sky (phase × height)
uniform sampler2D uWeather;
uniform sampler2D uLand;
uniform sampler2D uLandTop;
#define SEA_TOP ${f1(SEA_TOP)}
#define SEA_BASE ${f1(SEA_BASE)}
#define WATER ${f1(WATER)}
#define R0 760.0
#define NEAR_BASE 340.0
#define WORLD ${f1(WORLD)}
#define GRIDN ${f1(GRID)}
#define PLANET_R ${f1(PLANET_R)}
#define ATMO_H ${f1(ATMO_H)}
#define LAND_RES ${f1(LAND_RES)}
#define LAND_TOP_RES ${f1(LAND_TOP_RES)}
#define LAND_TOP ${f1(LAND_TOP)}

// ground lighting is deliberately soft: a gentle sun over a strong, cool skylight
#define GROUND_SUN 0.4
vec3 hazeColor(vec3 rd) {
  float mu = max(dot(rd, SUN), 0.0);
  return uHorizon * 0.95 + uSunColor * (0.035 * pow(mu, 5.0) + 0.05 * pow(mu, 32.0));
}
// mean air density along a straight segment between two altitudes (1 at the datum)
float airDensity(float h0, float h1) {
  float a = exp(-max(h0, 0.0) / ATMO_H), b = exp(-max(h1, 0.0) / ATMO_H);
  float dh = max(h1, 0.0) - max(h0, 0.0);
  return abs(dh) > 1.0 ? ATMO_H * (a - b) / dh : a;
}
float hazeAmount(float d) { return 1.0 - exp(-d * (0.00019 + 0.0075 * uFog)); }
// the same haze, thinned by altitude so it fades into a clear view from orbit
float hazeAmountAlt(float d, float h0, float h1) {
  float fogK = exp(-max(0.5 * (h0 + h1) - 60.0, 0.0) / 700.0);
  float hiK = mix(1.0, 0.3, smoothstep(3000.0, 30000.0, max(h0, h1)));   // keep the land readable from orbit
  return 1.0 - exp(-d * (0.00019 * airDensity(h0, h1) * hiK + 0.0075 * uFog * fogK));
}
vec3 skyAmbientY(float ny) {
  vec3 up = uHorizon * 0.82 + uZenith * 0.42;
  vec3 dn = vec3(0.08, 0.13, 0.09) * (0.5 + 0.15 * uSunColor.g) * (1.0 - 0.85 * uNight);
  float k = clamp(ny * 0.5 + 0.5, 0.0, 1.0);
  return mix(dn, up, k) + uFlash * vec3(0.85, 0.92, 1.15) * (0.35 + 0.65 * k) + vec3(0.004, 0.007, 0.014) * uNight;
}
vec3 skyAmbient(vec3 n) { return skyAmbientY(n.y); }

// the prototype's 2D weather map, laid triplanar over planet-fixed positions: on a cube-face centre
// (the spawn) it is exactly the prototype's xz lookup, and it blends seamlessly in between
vec4 wx2s(vec3 p, vec2 inv, vec2 o) {
  vec3 n = abs(normalize(p)); n *= n; n *= n; n *= n; n /= n.x + n.y + n.z;
  vec4 r = vec4(0.0);
  if (n.y > 0.002) r += n.y * textureLod(uWeather, p.xz * inv + o, 0.0);
  if (n.x > 0.002) r += n.x * textureLod(uWeather, p.zy * inv + o, 0.0);
  if (n.z > 0.002) r += n.z * textureLod(uWeather, p.xy * inv + o, 0.0);
  return r;
}
vec4 wx2(vec3 p, float s, vec2 o) { return wx2s(p, vec2(1.0 / s), o); }

// atlases of the six cube faces side by side (res texels per face). uLand: r = highland above the
// cloud sea, g = cloud-sea cover. uLandTop: highest ground nearby (conservative, so mountains never
// poke through what it clears)
const vec3 FN[6] = vec3[6](${vec3s(0)});
const vec3 FU[6] = vec3[6](${vec3s(3)});
const vec3 FV[6] = vec3[6](${vec3s(6)});
vec2 atlasUV(vec3 d, float res) {
  vec3 a = abs(d);
  int fi = a.x >= a.y && a.x >= a.z ? (d.x > 0.0 ? 0 : 1) : (a.y >= a.z ? (d.y > 0.0 ? 2 : 3) : (d.z > 0.0 ? 4 : 5));
  float dn = dot(d, FN[fi]);
  vec2 uv = clamp(vec2(dot(d, FU[fi]), dot(d, FV[fi])) / dn * 0.5 + 0.5, 0.5 / res, 1.0 - 0.5 / res);
  return vec2((float(fi) + uv.x) / 6.0, uv.y);
}
vec2 atlasAt(vec3 d) { return textureLod(uLand, atlasUV(d, LAND_RES), 0.0).rg; }
float groundTopAt(vec3 d) { return textureLod(uLandTop, atlasUV(d, LAND_TOP_RES), 0.0).r * LAND_TOP; }

// two weather layers drifting at different speeds and directions, so clouds grow, merge and fade
float nearCoverage(vec3 pPF) {
  vec3 d = normalize(pPF);
  pPF = d * PLANET_R;
  vec4 w = wx2(pPF + uCloudOff, 5600.0, vec2(0.37, 0.11));
  float w2 = wx2(pPF + vec3(-uCloudOff.z, 0.0, uCloudOff.x) * 0.6, 2600.0, vec2(0.71, 0.29)).g;
  float c = smoothstep(0.71 - 0.53 * uCover, 0.9 - 0.38 * uCover, (w.b * 0.7 + w.r * 0.3) * 0.78 + w2 * 0.22);
  // none where the ground reaches up toward the cloud base: the layer would cut through the mountain
  return c * smoothstep(NEAR_BASE - 100.0, NEAR_BASE - 220.0, groundTopAt(d));
}
// shadow of the cumulus layer at a planet-fixed point of altitude h
float cloudShadowPF(vec3 pPF, float h) {
  vec3 up = normalize(pPF);
  float e = dot(uSunDir, up);
  vec3 q = pPF + uSunDir * ((NEAR_BASE + 90.0 - h) / max(e, 0.1));
  return 1.0 - 0.8 * smoothstep(0.02, 0.45, nearCoverage(q)) * smoothstep(-0.05, 0.1, e);
}
// region shaders work in flat coords of one cube face (uFaceToPF: face axes → planet-fixed)
uniform mat3 uFaceToPF;
uniform vec2 uRegionC;     // centre of the active detail region, face flat coords
uniform float uHouseOn;    // the region is on the cottage's face
vec3 flatToPF(vec3 f) { return uFaceToPF * (normalize(vec3(f.x, PLANET_R, f.z)) * (PLANET_R + f.y)); }
float cloudShadow(vec3 f) { return cloudShadowPF(flatToPF(f), f.y); }

// under the cloud deck the sun never reaches: overcast grey from the palette, dim at night
float deckShade(float h) { return smoothstep(SEA_BASE + 90.0, SEA_BASE - 30.0, h); }
vec3 deckLight(vec3 hor, vec3 zen, vec3 sunC, float night) {
  return vec3(dot(hor * 0.6 + zen * 0.2, vec3(0.35, 0.45, 0.2)) + 0.02) * vec3(0.94, 1.0, 1.06)
       * (0.32 + 0.3 * clamp(sunC.g / 3.0, 0.0, 1.0)) * (1.0 - 0.85 * night) + vec3(0.003, 0.005, 0.01) * night;
}
// how much of the cloud-sea deck lies between the camera and a point at altitude h, distance L:
// from above it swallows everything below its top (prototype); from underneath the air stays clear
float seaMist(float h, float L) {
  float lo = SEA_BASE, hi = SEA_TOP - 4.0;
  float a = min(h, uCamAlt), b = max(h, uCamAlt);
  float inside = b - a > 0.5 ? L * max(min(b, hi) - max(a, lo), 0.0) / (b - a) : (h > lo && h < hi ? L : 0.0);
  float m = 1.0 - exp(-inside * 0.04);
  if (uCamAlt > hi) m = max(m, smoothstep(SEA_TOP + 6.0, SEA_TOP - 26.0, h));
  return m;
}
// grey murk in the still air under the clouds
float murkAmount(float h, float L) { return (1.0 - exp(-L * 0.00032)) * smoothstep(SEA_BASE + 40.0, SEA_BASE - 40.0, max(uCamAlt, h)); }
float landAt(vec3 d) { return atlasAt(d).r; }
float seaCovAt(vec3 d) { return atlasAt(d).g; }

// clouds standing in front of a point, from the cloud pass's half-resolution front distances: each
// texel judges with its own distance (never an interpolated one, which invents fronts) and the
// judgements blend bilinearly, so cloud edges over distant land stay smooth, not stair-stepped
float cloudFrontK(sampler2D bg, vec2 fragXY, vec2 res, float dist) {
  if (dist < 500.0) return 0.0;
  ivec2 sz = textureSize(bg, 0);
  vec2 tc = fragXY / res * vec2(sz) - 0.5;
  ivec2 i0 = clamp(ivec2(floor(tc)), ivec2(0), sz - 2);
  vec2 f = clamp(tc - vec2(i0), 0.0, 1.0);
  vec4 a = vec4(texelFetch(bg, i0, 0).a, texelFetch(bg, i0 + ivec2(1, 0), 0).a, texelFetch(bg, i0 + ivec2(0, 1), 0).a, texelFetch(bg, i0 + ivec2(1, 1), 0).a);
  vec4 o = vec4(greaterThan(a, vec4(0.0))) * smoothstep(a * 1.1, a * 1.35 + 80.0, vec4(dist));
  return mix(mix(o.x, o.y, f.x), mix(o.z, o.w, f.x), f.y) * smoothstep(500.0, 1000.0, dist);
}
// the orbital cloud shell over a point (alpha −2 … −3): premultiplied colour + opacity. Each texel is
// weighted by its own opacity, so the colour written where there is no cloud never reaches the ground
// (blending to a filtered colour turned every faint cumulus puff into a dark dot)
vec4 shellOver(sampler2D bg, vec2 fragXY, vec2 res) {
  ivec2 sz = textureSize(bg, 0);
  vec2 tc = fragXY / res * vec2(sz) - 0.5;
  ivec2 i0 = clamp(ivec2(floor(tc)), ivec2(0), sz - 2);
  vec2 f = clamp(tc - vec2(i0), 0.0, 1.0);
  vec4 t00 = texelFetch(bg, i0, 0), t10 = texelFetch(bg, i0 + ivec2(1, 0), 0);
  vec4 t01 = texelFetch(bg, i0 + ivec2(0, 1), 0), t11 = texelFetch(bg, i0 + ivec2(1, 1), 0);
  vec4 a = vec4(t00.a, t10.a, t01.a, t11.a);
  vec4 o = vec4(lessThan(a, vec4(-1.5))) * clamp(-a - 2.0, 0.0, 1.0);
  vec4 s00 = vec4(t00.rgb * o.x, o.x), s10 = vec4(t10.rgb * o.y, o.y), s01 = vec4(t01.rgb * o.z, o.z), s11 = vec4(t11.rgb * o.w, o.w);
  return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
}
vec3 sampleBg(sampler2D tex, vec2 uv) {
  vec2 px = 1.0 / vec2(textureSize(tex, 0));
  return 0.25 * (texture(tex, uv + vec2(px.x, px.y)).rgb + texture(tex, uv + vec2(-px.x, px.y)).rgb
               + texture(tex, uv + vec2(px.x, -px.y)).rgb + texture(tex, uv - px).rgb);
}
vec2 terrainUV(vec2 xz) { return ((xz + WORLD * 0.5) / (WORLD / (GRIDN - 1.0)) + 0.5) / GRIDN; }   // spawn region
vec2 regionUV(vec2 xz) { return terrainUV(xz - uRegionC); }                                            // active detail region
uniform highp sampler2D uHShadow;
uniform mat4 uHShadowMat;
uniform highp sampler2D uSShadow;
uniform mat4 uSShadowMat;
uniform vec4 uHouseXf;
uniform vec4 uHouseRect;
uniform vec4 uShipXf;
uniform float uShipY;
float shadowMapPCF(highp sampler2D map, mat4 m, vec3 p, vec3 n) {
  vec3 q = (m * vec4(p + n * 0.04, 1.0)).xyz * 0.5 + 0.5;
  if (q.x <= 0.002 || q.x >= 0.998 || q.y <= 0.002 || q.y >= 0.998) return 1.0;
  float s = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++)
    s += step(q.z - 0.0012, textureLod(map, q.xy + vec2(float(i), float(j)) * 0.0007, 0.0).r);
  return s / 9.0;
}
// the cottage's and the Wren's shadow maps (each only where its box covers the point)
float houseShadow(vec3 p, vec3 n) {
  if (uHouseOn < 0.5) return 1.0;
  return min(shadowMapPCF(uHShadow, uHShadowMat, p, n), shadowMapPCF(uSShadow, uSShadowMat, p, n));
}
// under or inside the Wren's hull (rain stops there)
bool inShip(vec3 f) {
  vec2 d = f.xz - uShipXf.xy;
  vec2 l = vec2(d.x * uShipXf.z - d.y * uShipXf.w, d.x * uShipXf.w + d.y * uShipXf.z) / vec2(4.8, 12.8);
  return uHouseOn > 0.5 && dot(l, l) < 1.0 && f.y > uShipY - 1.0 && f.y < uShipY + 11.0;
}
uniform vec3 uWell;
bool inHouse(vec2 xz) {
  if (uHouseOn < 0.5) return false;
  if (distance(xz, uWell.xy) < uWell.z) return true;
  vec2 d = xz - uHouseXf.xy;
  vec2 l = vec2(d.x * uHouseXf.z - d.y * uHouseXf.w, d.x * uHouseXf.w + d.y * uHouseXf.z);
  return l.x > uHouseRect.x && l.x < uHouseRect.y && l.y > uHouseRect.z && l.y < uHouseRect.w;
}
`;

/* face flat space → clip space through the exact sphere, relative to the region centre so it stays
   sub-mm precise anywhere on the planet: P(f) − P(C) = (R+h)(u − uC) + h·uC, with u − uC computed
   without cancellation from the small offset d = f − C */
export const REGION_VS = /* glsl */`
uniform vec3 uCamRel;      // camera minus the region centre's datum point, face axes (float64 on the CPU)
uniform mat3 uRegionToL;   // face axes → local render frame
vec3 curveRel(vec3 f) {
  vec3 vC = vec3(uRegionC.x, PLANET_R, uRegionC.y);
  vec3 d = vec3(f.x - uRegionC.x, 0.0, f.z - uRegionC.y);
  float lC = length(vC), lv = length(vC + d);
  float dl = -(2.0 * dot(vC, d) + dot(d, d)) / (lC + lv);   // lC − lv
  vec3 du = d / lv + vC * (dl / (lv * lC));
  return (PLANET_R + f.y) * du + f.y * (vC / lC);
}
vec4 regionToClip(vec3 f) { return projectionMatrix * viewMatrix * vec4(uRegionToL * (curveRel(f) - uCamRel), 1.0); }
`;

export const HEIGHT_FETCH = /* glsl */`
uniform highp sampler2D uHeight;
float groundAt(vec2 xz) {   // active detail region, face flat coords
  xz -= uRegionC;
  vec2 f = clamp((xz + WORLD * 0.5) / (WORLD / (GRIDN - 1.0)), vec2(0.0), vec2(GRIDN - 1.001));
  ivec2 i = ivec2(floor(f));
  vec2 t = f - vec2(i);
  float h00 = texelFetch(uHeight, i, 0).r;
  float h10 = texelFetch(uHeight, i + ivec2(1, 0), 0).r;
  float h01 = texelFetch(uHeight, i + ivec2(0, 1), 0).r;
  float h11 = texelFetch(uHeight, i + ivec2(1, 1), 0).r;
  if (t.x + t.y <= 1.0) return h00 + (h10 - h00) * t.x + (h01 - h00) * t.y;
  return h11 + (h01 - h11) * (1.0 - t.x) + (h10 - h11) * (1.0 - t.y);
}
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 rand3(ivec2 c, uint salt) {
  return vec3(pcg3d(uvec3(uvec2(c + 131072), salt))) * (1.0 / 4294967295.0);
}
`;

/* Wind field shared by grass, flowers and ground shading (prototype) */
export const WIND_GLSL = /* glsl */`
uniform vec2 uWindDir;
uniform float uWindStr;
uniform float uWindPhase;
uniform float uSwayPhase;
// gust fronts: noise stretched across the wind and scrolled along it, so they roll over the field as waves
float gustAt(vec2 xz) {
  vec2 d = uWindDir, pp = vec2(-d.y, d.x);
  float along = dot(xz, d), across = dot(xz, pp);
  float a = textureLod(uWeather, vec2((along - uWindPhase) / 230.0, across / 820.0), 0.0).r;
  float b = textureLod(uWeather, vec2((along - uWindPhase * 1.35) / 95.0, across / 280.0 + 0.37), 0.0).g;
  return smoothstep(0.36, 0.84, a * 0.65 + b * 0.35);
}
float windBend(vec2 xz, float g, float phase) {
  return uWindStr * (0.12 + 1.45 * g) + (0.03 + 0.06 * uWindStr) * sin(uSwayPhase + phase + dot(xz, uWindDir) * 0.6);
}
float waveShade() { return smoothstep(0.0, 0.3, uWindStr); }
`;

/* Meadow structure shared by blades, flowers and the ground under them, so patches read the same
   up close and far away. Domain-warped fbm gives winding swathes, the cellular channel hummocks. */
export const MEADOW_GLSL = /* glsl */`
// 0 = short, thin, worn turf … 1 = tall, thick meadow
float meadowLush(vec2 xz) {
  vec2 w = vec2(textureLod(uWeather, xz / 340.0 + vec2(0.13, 0.71), 0.0).g, textureLod(uWeather, xz / 340.0 + vec2(0.57, 0.29), 0.0).r) - 0.5;
  vec2 q = xz + w * 110.0;
  float a = textureLod(uWeather, q / 150.0 + vec2(0.41, 0.83), 0.0).b;
  float c = textureLod(uWeather, q / 38.0 + vec2(0.77, 0.19), 0.0).a;
  return smoothstep(0.28, 0.74, a * 0.68 + c * 0.32);
}
// flower drifts: elongated cellular clusters, warped differently so they cross the grass patches
float meadowDrift(vec2 xz) {
  vec2 w = vec2(textureLod(uWeather, xz / 210.0 + vec2(0.31, 0.47), 0.0).b, textureLod(uWeather, xz / 210.0 + vec2(0.89, 0.05), 0.0).g) - 0.5;
  vec2 q = xz + w * 70.0;
  float a = textureLod(uWeather, q / 95.0 + vec2(0.63, 0.37), 0.0).a;
  float b = textureLod(uWeather, q / 26.0 + vec2(0.11, 0.59), 0.0).r;
  return smoothstep(0.58, 0.86, a * 0.75 + b * 0.25);
}
`;

/* Palette as a function of local sun elevation: GLSL twin of atmosphere/palette.ts */
export const PALETTE_GLSL = /* glsl */`
void palette(float e, out vec3 sun, out vec3 zen, out vec3 hor) {
  float day = smoothstep(0.02, 0.55, e);
  float warm = 1.0 - smoothstep(0.05, 0.4, e);
  sun = vec3(1.0, mix(0.95, 0.66, warm), mix(0.88, 0.42, warm)) * mix(2.1, 3.0, day);
  float st = smoothstep(-0.02, 0.06, e);
  sun.g *= mix(0.78, 1.0, st); sun.b *= mix(0.6, 1.0, st);
  sun *= smoothstep(-0.045, 0.025, e);
  zen = vec3(mix(0.05, 0.028, day), mix(0.11, 0.145, day), mix(0.30, 0.64, day));
  hor = vec3(mix(0.72, 0.44, 1.0 - warm), mix(0.6, 0.62, 1.0 - warm), mix(0.56, 0.86, 1.0 - warm)) * mix(0.8, 1.05, day);
  float twi = smoothstep(-0.2, -0.02, e) * (1.0 - smoothstep(-0.02, 0.12, e));
  hor = mix(hor, vec3(0.47, 0.32, 0.3), twi * 0.55);
  zen = mix(zen, vec3(0.06, 0.07, 0.18), twi * 0.35);
  float night = smoothstep(0.04, -0.16, e);
  zen = mix(zen, vec3(0.006, 0.011, 0.03) + uMoonlit * vec3(0.01, 0.018, 0.04), night);
  hor = mix(hor, vec3(0.02, 0.03, 0.055) + uMoonlit * vec3(0.03, 0.04, 0.058), night);
  float dim = mix(1.0, 0.07 + 0.1 * uMoonlit * (1.0 - uDark), night);   // overcast nights are darker than clear ones
  sun *= 1.0 - 0.3 * uCover - 0.35 * uDark;
  zen = mix(zen, vec3(0.12, 0.135, 0.16) * (1.0 - 0.55 * uDark) * dim, uCover * 0.85);
  hor = mix(hor, vec3(0.4, 0.43, 0.47) * (1.0 - 0.62 * uDark) * dim, uCover * 0.8);
  hor = mix(hor, vec3(0.5, 0.53, 0.57) * (1.0 - 0.45 * uDark) * dim, uFog * 0.75);
  zen = mix(zen, hor, uFog * 0.55);
}
`;
