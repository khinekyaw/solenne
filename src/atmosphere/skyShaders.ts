import { COMMON, PALETTE_GLSL } from '../render/glsl';
import { ATMO_TOP } from '../config';
import { FAR_GLSL } from '../space/farShaders';

/* =========================================================================
   Sky + volumetric clouds, rendered at reduced resolution in the local
   frame (camera at the origin, planet centre at uCenterL). The prototype's
   flat slabs become spherical shells: altitude = |p − centre| − R.
   ========================================================================= */
export const CLOUD_VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
export const CLOUD_FS = /* glsl */`
layout(location = 0) out highp vec4 pc_fragColor;
layout(location = 1) out highp vec4 pc_vis;   // how much of what lies beyond the sky shows through (for the far bodies)
#define gl_FragColor pc_fragColor
#define SUN uSunDirL
${COMMON}
${PALETTE_GLSL}
uniform highp sampler3D uShape;
uniform highp sampler3D uDetail;
uniform sampler2D uTerrain;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform int uSteps;
uniform float uStepK;
uniform sampler2D uHistory;
uniform sampler2D uHistoryVis;
uniform mat4 uPrevVP;
uniform float uBlend;
uniform float uFrame;
uniform vec3 uRegionL;
uniform vec3 uRegionUpL;
uniform float uShellK;
uniform float uFlatK;
uniform int uDbg;   // debug: bit 0 sea, bit 1 towers, bit 2 cumulus (all on = 7)
uniform vec4 uOccL;   // Lull: direction, angular radius (it can cover the sun)
varying vec2 vUv;

#define TOP 1500.0
#define BOTTOM (SEA_BASE - 45.0)
#define MAXD 11500.0
#define SIGMA 0.05
#define SUN_SCALE 0.5
#define ATMO_TOP ${ATMO_TOP.toFixed(1)}

float HG(float c, float g) { float g2 = g * g; return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5); }
float altL(vec3 p) { return length(p - uCenterL) - PLANET_R; }
// ray from the camera against the sphere at altitude hs; stable roots (no cancellation near the surface)
vec2 shell(vec3 rd, float hs) {
  float rc = PLANET_R + uCamAlt;
  float b = rc * rd.y;
  float c = (uCamAlt - hs) * (2.0 * PLANET_R + uCamAlt + hs);
  float h = b * b - c;
  if (h < 0.0) return vec2(-1.0);
  float q = -(b + (b >= 0.0 ? 1.0 : -1.0) * sqrt(h));
  float t1 = q, t2 = abs(q) > 1e-6 ? c / q : 0.0;
  return vec2(min(t1, t2), max(t1, t2));
}
vec3 toPF(vec3 p) { return uCamPF + uLtoPF * p; }
float regionDist(vec3 p) { vec3 d = p - uRegionL; return length(d - uRegionUpL * dot(d, uRegionUpL)); }
float regionLand(vec3 P) {
  if (P.y <= 0.0) return 0.0;
  vec2 xz = P.xz * (PLANET_R / P.y);
  if (abs(xz.x) > WORLD * 0.5 - 3.0 || abs(xz.y) > WORLD * 0.5 - 3.0) return 0.0;
  return textureLod(uTerrain, terrainUV(xz), 0.0).b;
}

/* ---- stylised atmosphere: the prototype palette, indexed by how much air the ray crosses ---- */
float opticalDepth(vec3 rd, float tMax) {
  float D = 0.0, t0 = 0.0;
  for (int i = 1; i <= 8; i++) {
    float t1 = tMax * pow(float(i) / 8.0, 2.0);
    float h = altL(rd * (0.5 * (t0 + t1)));
    D += exp(-max(h, 0.0) / ATMO_H) * (t1 - t0);
    t0 = t1;
  }
  return D / ATMO_H;
}
vec3 skyColor(vec3 rd, out float bright) {
  float rc = PLANET_R + max(uCamAlt, 0.0);
  float sinDip = sqrt(max(1.0 - (PLANET_R / rc) * (PLANET_R / rc), 0.0));
  float y = rd.y, yH = -sinDip;
  float gy = clamp((y - yH) / (1.0 - yH), 0.0, 1.0);
  float hiK = smoothstep(2000.0, 16000.0, uCamAlt);
  vec3 sunC = uSunColor, zen = uZenith, hor = uHorizon;
  float D = 1.0;
  bright = 1.0;
  if (hiK > 0.0) {
    // through the atmosphere shell, stopping at the ground
    vec2 sa = shell(rd, ATMO_TOP), sg = shell(rd, 0.0);
    float tMax = sg.x > 0.0 ? sg.x : sa.y;
    float tIn = uCamAlt > ATMO_TOP ? max(sa.x, 0.0) : 0.0;
    D = sa.y > 0.0 ? opticalDepth(rd, tMax) : 0.0;
    // palette at the ray's lowest point in the air (sunlit side, terminator or night side)
    float tc = clamp(-dot(-uCenterL, rd), tIn, tMax);
    vec3 s2, z2, h2;
    palette(dot(SUN, normalize(rd * tc - uCenterL)), s2, z2, h2);
    sunC = mix(sunC, s2, hiK); zen = mix(zen, z2, hiK); hor = mix(hor, h2, hiK);
    bright = mix(1.0, clamp((1.0 - exp(-1.3 * D)) / (1.0 - exp(-1.3)), 0.0, 1.0), hiK);
  }
  float param = mix(pow(gy, 0.42), pow(clamp(1.0 / max(D, 1e-3), 0.0, 1.0), 0.42), hiK);
  vec3 col = mix(hor, zen, param);
  col = mix(col, hor * 1.04, smoothstep(yH, yH - 0.08, y) * (1.0 - hiK));
  float mu = max(dot(rd, SUN), 0.0);
  col += sunC * (0.018 * pow(mu, 4.0) + 0.045 * pow(mu, 28.0) + 0.35 * pow(mu, 420.0));
  // dusk glow toward the set sun
  float e = SUN.y;
  float twi = smoothstep(-0.22, -0.03, e) * (1.0 - smoothstep(-0.03, 0.14, e));
  vec2 sh = normalize(SUN.xz + 1e-5), rh = normalize(rd.xz + 1e-5);
  col += vec3(0.5, 0.25, 0.13) * twi * pow(max(dot(sh, rh), 0.0), 3.0) * (1.0 - smoothstep(0.0, 0.35, gy)) * (1.0 - hiK);
  col *= bright;
  // the disc itself, unless the planet or Lull is in the way
  vec2 sg0 = shell(rd, SEA_TOP);
  float occ = dot(rd, uOccL.xyz) > 0.0 ? smoothstep(uOccL.w * 0.985, uOccL.w * 1.015, asin(min(length(cross(rd, uOccL.xyz)), 1.0))) : 1.0;
  // limb darkening, only noticeable through the telescope's solar filter
  float rs = clamp(acos(min(mu, 1.0)) / 0.0245, 0.0, 1.0), limb = 0.45 + 0.55 * sqrt(1.0 - rs * rs);
  if (!(sg0.x > 0.0)) col += mix(uSunColor, vec3(3.0, 2.85, 2.64), hiK) * 18.0 * smoothstep(0.99955, 0.99978, mu) * occ * limb;
  return col;
}

vec2 cloudField(vec3 p, bool hi) {
  float h = altL(p);
  vec3 P = toPF(p);
  vec3 Pc = normalize(P) * PLANET_R;   // coverage is per column (2D), like the prototype's weather map
  vec2 at = atlasAt(Pc / PLANET_R);    // x: highland, y: cloud-sea cover
  float dens = 0.0, amb = 1.0;

  // sea of clouds: a deck from its billowing top down to a lumpy underside
  if ((uDbg & 1) != 0 && at.y > 0.01 && h < SEA_TOP + 50.0 && h > BOTTOM) {
    vec3 q = P + uCloudOff * 0.5;
    vec4 wb = wx2(Pc + uCloudOff * 0.5, 3300.0, vec2(0.23, 0.71));
    float top = SEA_TOP - 26.0 + (wb.g - 0.5) * 24.0 + smoothstep(0.15, 1.0, wb.a) * 40.0;
    float land = max(regionLand(P), at.x);
    top = mix(top, min(top, SEA_TOP - 8.0), land);
    vec3 sp = (q + normalize(P) * (h * 0.35 - uTime * 2.2)) / 520.0;
    float s = textureLod(uShape, sp, 0.0).r;
    // towards the edge of a bank the deck thins and breaks into billows, then clear air
    float f = (top - h) / 11.0 + (s - 0.5) * 3.4 - (1.0 - at.y) * 6.0;
    if (hi && f > -0.8 && f < 1.4) {
      float de = textureLod(uDetail, sp * 4.7 + vec3(uTime * 0.006, uTime * 0.011, 0.0), 0.0).r;
      f += (de - 0.62) * 1.1 * (1.0 - clamp(f, 0.0, 1.0));
    }
    float base = SEA_BASE + (wb.r - 0.5) * 60.0 + (s - 0.5) * 40.0;
    float under = smoothstep(base - 25.0, base + 25.0, h);
    if (f > 0.0 && under > 0.0) { dens = smoothstep(0.0, 0.45, f) * 1.5 * under; amb = exp(-f * 0.4) * mix(0.55, 1.0, under); }
  }

  // towering cumulus rising out of the sea, away from the plateau and other highlands
  if ((uDbg & 2) != 0 && h < TOP && h > SEA_TOP - 40.0) {
    vec3 q = P + uCloudOff * 0.7, qc = Pc + uCloudOff * 0.7;
    vec4 w = wx2(qc, 16000.0, vec2(0.61, 0.19));
    w.r = w.r * 0.82 + wx2(qc - uCloudOff * 1.4, 7000.0, vec2(0.13, 0.57)).b * 0.18;
    // far sparser than the prototype's endless wall: from the air it buried the sea and the islands
    float c = smoothstep(0.73 - 0.4 * uCover, 0.82 - 0.34 * uCover, w.r) * smoothstep(R0, R0 + 700.0, regionDist(p));
    c *= 1.0 - at.x;
    if (c > 0.001) {
      float Hh = 220.0 + 680.0 * smoothstep(0.5, 0.9, w.r * 0.65 + w.g * 0.35);
      float hy = h - (SEA_TOP - 20.0);
      float colTop = Hh * pow(c, 0.45);
      vec3 sp = (q - normalize(P) * uTime * 3.6) / 1150.0;
      float s = textureLod(uShape, sp, 0.0).r;
      float f = (colTop - hy) / 85.0 + (s - 0.55) * 3.4;
      if (hi && f > -0.8 && f < 1.4) {
        float de = textureLod(uDetail, sp * 5.3 + vec3(0.0, uTime * 0.012, uTime * 0.005), 0.0).r;
        f -= (1.0 - de) * 0.55 * (1.0 - clamp(f, 0.0, 1.0));
      }
      if (f > 0.0) {
        float d2 = smoothstep(0.0, 0.5, f) * smoothstep(SEA_TOP - 40.0, SEA_TOP - 8.0, h);   // flat, soft bases over open land
        if (d2 > dens) { dens = d2; amb = exp(-f * 0.45) * mix(0.5, 1.0, clamp(hy / Hh, 0.0, 1.0)); }
      }
    }
  }

  // scattered fair-weather cumulus overhead
  h -= uFlatK * dot(p.xz, p.xz) / (2.0 * PLANET_R);
  if ((uDbg & 4) != 0 && h > NEAR_BASE - 20.0 && h < NEAR_BASE + 330.0 + 520.0 * uDark) {
    float c = nearCoverage(P);
    if (c > 0.001) {
      float hy = h - NEAR_BASE;
      float colTop = (240.0 + 560.0 * uDark) * pow(c, 0.6);
      vec3 sp = (P + uCloudOff - normalize(P) * uTime * 3.0) / 540.0 + 0.37;
      float s = textureLod(uShape, sp, 0.0).r;
      float f = min((colTop - hy) / 60.0, hy / 20.0 + 0.4) + (s - 0.55) * 3.0;
      if (hi && f > -0.8 && f < 1.4) {
        float de = textureLod(uDetail, sp * 4.1 + vec3(uTime * 0.008, uTime * 0.014, 0.0), 0.0).r;
        f -= (1.0 - de) * 0.5 * (1.0 - clamp(f, 0.0, 1.0));
      }
      if (f > 0.0) {
        float d3 = smoothstep(0.0, 0.5, f);
        if (d3 > dens) { dens = d3; amb = exp(-f * 0.45) * mix(0.55, 1.0, clamp(hy / max(colTop, 1.0), 0.0, 1.0)) * mix(1.0, 0.35 + 0.9 * s, uDark); }
      }
    }
  }
  return vec2(dens, amb);
}

const float LSEG[6] = float[6](10.0, 16.0, 28.0, 50.0, 90.0, 170.0);
float gFront = 1e9;   // distance at which the clouds along this ray become plainly visible

vec4 marchClouds(vec3 rd, float jitter) {
  float hc = uCamAlt;
  // first entry into any layer
  float seaHi = SEA_TOP + 50.0, nb = NEAR_BASE - 20.0, nt = NEAR_BASE + 330.0 + 520.0 * uDark;
  float tS = 1e9;
  if (hc < seaHi) tS = 0.0; else { vec2 s = shell(rd, seaHi); if (s.x > 0.0) tS = s.x; }
  if (hc > nb && hc < nt) tS = 0.0;
  else if (hc <= nb) { tS = min(tS, shell(rd, nb).y); if (uFlatK > 0.0 && rd.y > 0.0) tS = min(tS, (nb - hc) / rd.y); }
  else { vec2 s = shell(rd, nt); if (s.x > 0.0) tS = min(tS, s.x); if (uFlatK > 0.0 && rd.y < 0.0) tS = min(tS, (hc - nt) / -rd.y); }
  if (hc < TOP) {
    vec3 up = uRegionUpL, o = -uRegionL;
    vec3 op = o - up * dot(o, up), rp = rd - up * dot(rd, up);
    float c0 = dot(op, op) - R0 * R0;
    if (c0 > 0.0) tS = 0.0;
    else { float a = dot(rp, rp); if (a > 1e-6) { float b = dot(op, rp); tS = min(tS, (-b + sqrt(b * b - a * c0)) / a); } }
  } else { vec2 s = shell(rd, TOP); if (s.x > 0.0) tS = min(tS, s.x); }
  // from underneath the deck, nothing to march until the ray climbs to its underside
  if (hc < BOTTOM) tS = max(tS, shell(rd, BOTTOM).y);
  vec2 sTop = shell(rd, TOP), sBot = shell(rd, BOTTOM);
  float tE = sTop.y;
  if (sBot.x > 0.0) tE = min(tE, sBot.x);
  tE = min(tE, tS + MAXD);
  if (!(tS < tE) || sTop.y <= 0.0) return vec4(0.0, 0.0, 0.0, 1.0);

  float cosT = dot(rd, SUN);
  float fogD = 0.00012 + 0.0075 * uFog * (1.0 - smoothstep(0.04, 0.45, rd.y));   // fog hugs the ground
  float ph0 = mix(HG(cosT, 0.78), HG(cosT, -0.22), 0.32);
  float ph1 = mix(HG(cosT, 0.40), HG(cosT, -0.11), 0.32);
  float ph2 = mix(HG(cosT, 0.20), HG(cosT, -0.05), 0.32);
  vec3 hz = hazeColor(rd);
  vec3 ambTop = (uZenith * 0.62 + uHorizon * 0.36) * (1.0 - 0.55 * uDark);
  vec3 ambBot = ambTop * 0.22 + vec3(0.012, 0.02, 0.04) * (1.0 - 0.8 * uNight);
  // light that soaked down through the deck: the underside is a neutral overcast grey, not sky blue
  vec3 ambUnder = vec3(dot(ambTop, vec3(0.35, 0.45, 0.2))) * vec3(0.96, 1.0, 1.06) * 0.5;

  float T = 1.0;
  vec3 acc = vec3(0.0);
  float t = tS + max(3.5, tS * uStepK) * jitter;
  for (int i = 0; i < 160; i++) {
    if (i >= uSteps || t > tE || T < 0.02) break;
    float dt = clamp(t * uStepK, 3.5, 190.0);
    vec3 p = rd * t;
    vec2 cf = cloudField(p, true);
    if (cf.x > 0.003) {
      float tau = 0.0, ld = 0.0;
      int nL = t > 2600.0 ? 3 : (t > 900.0 ? 4 : 6);   // fewer light samples for far, small-on-screen cloud
      for (int j = 0; j < 6; j++) {
        if (j >= nL) break;
        float seg = LSEG[j];
        ld += seg * 0.5;
        tau += cloudField(p + SUN * ld, false).x * seg;
        ld += seg * 0.5;
      }
      tau *= SIGMA * (1.0 + 0.8 * uDark);
      float rangeK = 1.0 - smoothstep(MAXD * 0.55, MAXD, t - tS);   // thin out toward the end of the march instead of stopping dead
      float e = ph0 * exp(-tau) + 0.4 * ph1 * exp(-tau * 0.35) + 0.16 * ph2 * exp(-tau * 0.12);
      float h = altL(p);
      float sv = h < NEAR_BASE - 30.0 ? cloudShadowPF(toPF(p), h) : 1.0;   // the cumulus layer shades the cloud sea below it
      vec3 amb = mix(mix(ambBot, ambTop, cf.y), ambUnder * (0.75 + 0.5 * cf.y), smoothstep(SEA_BASE + 90.0, SEA_BASE + 10.0, h));
      vec3 Ls = uSunColor * e * SUN_SCALE * sv + amb + uFlash * vec3(1.3, 1.4, 1.75) * (0.4 + 0.6 * cf.y);
      float sig = cf.x * SIGMA * (1.0 + 0.8 * uDark) * rangeK;
      float Ts = exp(-sig * dt);
      float aer = exp(-t * fogD * airDensity(hc, h));
      acc += T * mix(hz, Ls, aer) * (1.0 - Ts);
      T *= Ts;
      if (T < 0.75 && gFront > 1e8) gFront = t;
    } else {
      // stride across empty air: geometric with distance, so towers kilometres away are still reached
      dt = max(dt * 1.5, max(8.0, t * 0.06));
    }
    t += dt;
  }
  return vec4(acc, T);
}

/* ---- cheap cloud shells for high-altitude and orbital views ---- */
vec4 shellClouds(vec3 rd) {
  vec2 s = shell(rd, SEA_TOP - 14.0);
  if (!(s.x > 0.0)) return vec4(0.0, 0.0, 0.0, 1.0);
  vec3 p = rd * s.x, P = toPF(p), n = normalize(p - uCenterL), up = normalize(P);
  vec3 sunC, zen, hor;
  float e = dot(SUN, n);
  palette(e, sunC, zen, hor);
  vec3 q = P + uCloudOff * 0.5;
  vec4 wb = wx2(q, 3300.0, vec2(0.23, 0.71));
  vec2 at = atlasAt(up);
  float land = max(regionLand(P), at.x);
  // towers and cumulus seen from above as bright puffs over the sea
  vec4 w = wx2(P + uCloudOff * 0.7, 16000.0, vec2(0.61, 0.19));
  float tw = smoothstep(0.73 - 0.4 * uCover, 0.82 - 0.34 * uCover, w.r) * (1.0 - land) * smoothstep(R0, R0 + 700.0, regionDist(p));
  float cu = nearCoverage(P);
  float lit = 0.35 + 0.65 * smoothstep(-0.1, 0.6, e);
  vec3 amb = (zen * 0.62 + hor * 0.36) * 0.9 + vec3(0.006, 0.01, 0.02) * uNight;
  vec3 sea = (sunC * 0.32 * lit + amb) * (0.82 + 0.3 * wb.a) * (1.0 - 0.35 * cu * smoothstep(0.0, 0.3, e));
  vec3 puff = (sunC * 0.48 * lit + amb * 1.1) * (0.9 + 0.25 * w.g);
  vec3 col = mix(sea, puff, max(tw * 0.85, cu * 0.75));
  // the deck where the banks lie (ragged edges), puffs anywhere else; land shows through the gaps
  float seaA = smoothstep(0.3, 0.7, at.y + (wb.a - 0.5) * 0.5);
  float a = max(seaA, max(smoothstep(0.2, 0.6, tw) * 0.9, smoothstep(0.3, 0.65, cu) * 0.85));
  float dist = s.x;
  float hz = 1.0 - exp(-dist * 0.00019 * airDensity(uCamAlt, SEA_TOP));
  col = mix(col, hor * 0.95, hz);
  return vec4(col * a, 1.0 - a);
}

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 v = uInvProj * vec4(ndc, 1.0, 1.0);
  vec3 rd = normalize((uCamWorld * vec4(normalize(v.xyz / v.w), 0.0)).xyz);

  float bright;
  vec3 sky = skyColor(rd, bright);
  // thin high cirrus veil
  float veil = 0.0;
  vec2 sc = shell(rd, 3200.0);
  if (uFlatK > 0.5) sc.y = rd.y > 0.0 ? (3200.0 - uCamAlt) / rd.y : -1.0;
  if (sc.y > 0.0 && uCamAlt < 3200.0) {
    vec3 cp = toPF(rd * sc.y) + uCloudOff * 2.0;
    float ci = wx2s(cp, vec2(1.0 / 21000.0, 1.0 / 7000.0), vec2(0.5)).a;
    float cj = wx2(cp, 9000.0, vec2(0.2)).g;
    float cov = smoothstep(0.5, 0.95, ci * 0.6 + cj * 0.4) * smoothstep(0.02, 0.2, rd.y) * (1.0 - uCover);
    vec3 cc = uSunColor * 0.32 * (0.5 + 0.5 * pow(max(dot(rd, SUN), 0.0), 3.0)) + uZenith * 0.6;
    sky = mix(sky, cc, cov * 0.45);
    veil = cov * 0.45;
  }
  sky += uFlash * vec3(0.45, 0.5, 0.65);
  vec4 cl = vec4(0.0, 0.0, 0.0, 1.0);
  if (uShellK < 0.999) cl = marchClouds(rd, ign(gl_FragCoord.xy + 5.588238 * mod(uFrame, 64.0)));
  if (uShellK > 0.001) {
    float fv = gFront;
    cl = mix(cl, shellClouds(rd), uShellK);
    gFront = uShellK > 0.5 ? 1e9 : fv;
  }
  vec3 col = sky * cl.a + cl.rgb;
  float fogK = uFog * (0.3 + 0.65 * (1.0 - smoothstep(-0.1, 0.45, rd.y)));
  col = mix(col, hazeColor(rd), fogK);
  // the weather's overcast (rain, storms) is not marched as a volume, but it still hides what lies beyond
  float overcast = smoothstep(0.55, 1.0, uCover);
  float vis = shell(rd, SEA_TOP).x > 0.0 ? 0.0 : cl.a * (1.0 - fogK) * (1.0 - veil) * (1.0 - 0.97 * overcast);
  // star visibility for the full-resolution background pass
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float starVis = cl.a * (1.0 - uFog) * (1.0 - overcast) * clamp(1.0 - lum * 9.0, 0.0, 1.0);
  if (shell(rd, SEA_TOP).x > 0.0) starVis = 0.0;
  // alpha carries either the cloud front distance (> 0) or the star visibility (≤ 0)
  float aOut = cl.a < 0.75 && gFront < 6e4 ? gFront : -starVis;
  // from high up: the shell's opacity over the ground, encoded below the star range (−2 … −3)
  if (uShellK > 0.5 && shell(rd, SEA_BASE - 520.0).x > 0.0) {   // only where the ray surely reaches the ground below
    aOut = -2.0 - (1.0 - cl.a);
    col = cl.a < 0.999 ? cl.rgb / (1.0 - cl.a) : vec3(0.0);   // the cloud's own colour; the ground below shows through (1 − a)
  }
  // blend with last frame, reprojected by view direction (clouds are far away)
  vec4 pc = uPrevVP * vec4(uLtoPF * rd, 1.0);
  if (uBlend < 1.0 && pc.w > 0.0) {
    vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
    if (puv.x > 0.0 && puv.x < 1.0 && puv.y > 0.0 && puv.y < 1.0) {
      vec4 h = textureLod(uHistory, puv, 0.0);
      if (all(lessThan(h.rgb, vec3(6e4)))) {
        col = mix(h.rgb, col, uBlend);
        vis = mix(textureLod(uHistoryVis, puv, 0.0).r, vis, uBlend);
        if ((h.a > 0.0) == (aOut > 0.0) && (h.a < -1.5) == (aOut < -1.5)) aOut = mix(h.a, aOut, max(uBlend, 0.3));
      }
    }
  }
  gl_FragColor = vec4(col, aOut);
  pc_vis = vec4(vis, 0.0, 0.0, 1.0);
}
`;

/* full-resolution background: the cloud texture plus crisp stars */
export const BG_VS = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }`;
export const BG_FS = /* glsl */`
uniform sampler2D uBg;
uniform vec2 uRes;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform mat3 uLtoStar;
uniform sampler2D uVis;
varying vec2 vUv;
${FAR_GLSL}
vec3 sampleBg(sampler2D tex, vec2 uv) {
  vec2 px = 1.0 / vec2(textureSize(tex, 0));
  return 0.25 * (texture(tex, uv + vec2(px.x, px.y)).rgb + texture(tex, uv + vec2(-px.x, px.y)).rgb
               + texture(tex, uv + vec2(px.x, -px.y)).rgb + texture(tex, uv - px).rgb);
}
uvec3 pcg(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
// one star per cell of a grid laid through the sky; the dot is measured in pixels, so stars stay points.
// Brightness follows a steep, magnitude-like law: a few bright stars, many more faint ones, most cells empty
float starDot(vec3 d, float N, int salt, float rich, out vec3 tint) {
  vec3 p = d * N, c = floor(p), f = fract(p);
  vec3 h = vec3(pcg(uvec3(ivec3(c) + 4096 + salt))) * (1.0 / 4294967295.0);
  float dpx = length(f - (0.2 + 0.6 * h)) / (N * uPxAng);
  tint = mix(vec3(1.0, 0.82, 0.62), vec3(0.72, 0.84, 1.0), h.z);
  float b = 5.0 * pow(h.x, mix(150.0, 70.0, rich)) + 0.45 * pow(h.y, 45.0) * step(h.z, 0.2 + 0.4 * rich);
  return b * exp(-dpx * dpx * 1.8);
}
vec3 stars(vec3 d) {
  // the galaxy: a soft, patchy band around a great circle where stars gather, with a faint glow of its own
  float lat = dot(d, vec3(0.3123, 0.7906, 0.4782));
  float rich = exp(-lat * lat / 0.04) * (0.55 + 0.45 * sin(dot(d, vec3(7.1, 3.3, -5.2))) * sin(dot(d, vec3(-2.7, 6.1, 4.4))));
  float mag = 2.0 * 0.6009 / (uPxAng * uRes.y);   // tan(31°): magnification against the naked eye
  float gain = 0.05 * clamp(sqrt(mag), 1.0, 6.0);  // a narrow field gathers more light
  vec3 t, col = vec3(0.0);
  col += starDot(d, 260.0, 0, rich, t) * t;
  for (int k = 1; k <= 2; k++) {
    float N = 260.0 * pow(3.0, float(k)), fade = smoothstep(5.0, 12.0, 1.0 / (N * uPxAng));
    if (fade > 0.0) col += starDot(d, N, k * 7919, rich, t) * t * fade * pow(0.55, float(k));
  }
  return col * gain + vec3(0.55, 0.6, 0.75) * 0.0035 * rich;
}
void main() {
  vec4 bg = texture(uBg, vUv);
  vec3 col = sampleBg(uBg, gl_FragCoord.xy / uRes);
  float starVis = bg.a > -1.5 ? max(-bg.a, 0.0) : 0.0;
  float vis = texture(uVis, vUv).r;
  if (starVis > 0.01 || vis > 0.003) {
    vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 rd = normalize((uCamWorld * vec4(normalize(v.xyz / v.w), 0.0)).xyz);
    // planets, moons and the corona sit behind the sky's own light, seen through the air and clouds
    vec4 far = vis > 0.003 ? farBodies(rd) : vec4(0.0);
    col += (far.rgb + corona(rd) * (1.0 - far.a)) * vis;
    if (starVis > 0.01) col += stars(normalize(uLtoStar * rd)) * starVis * (1.0 - far.a);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;
