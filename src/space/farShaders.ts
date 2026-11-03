import { MAP_W, RING_W } from '../config';
import { FAR_MAX } from './system';

/* =========================================================================
   Far pass: planets and moons drawn in the full-resolution background as
   analytic spheres (no meshes, no depth), positioned in float64 on the CPU
   and handed over as directions + radius/distance. Each body is shaded from
   its baked surface map; the giants get limb haze and rings. Bodies smaller
   than a couple of pixels become soft dots that carry the disc's whole
   light, so they never flicker in and out. The result is seen through the
   air and the clouds (visibility from the cloud pass).
   ========================================================================= */
export const FAR_GLSL = /* glsl */`
#define NB ${FAR_MAX}
#define MAP_W ${MAP_W.toFixed(1)}
#define RING_W ${RING_W.toFixed(1)}
uniform int uBN;
uniform vec4 uBC[NB];   // direction from the camera, radius / distance
uniform vec4 uBL[NB];   // direction to the sun from the body, shading kind
uniform vec4 uBP[NB];   // spin pole, map layer
uniform vec4 uBM[NB];   // prime meridian, light from its planet on the night side
uniform vec4 uBT[NB];   // sunlight × transmission through Solenne's air, limb haze strength
uniform vec4 uBA[NB];   // haze colour, ring layer (−1: none)
uniform vec4 uBR[NB];   // ring inner, outer (planet radii), ring opacity, relief
uniform vec4 uBK[NB];   // albedo tint, mean albedo of the map
uniform highp sampler2DArray uBodyTex;
uniform highp sampler2DArray uRingTex;
uniform float uPxAng;   // radians per pixel
uniform float uTime;
uniform vec4 uSunL;     // sun direction from the camera, fraction of its disc left uncovered
uniform vec4 uOccL;     // Lull: direction, angular radius

vec3 shadeBody(int i, vec3 n, vec3 rd, float s, float fp) {
  vec3 l = uBL[i].xyz, v = -rd, P = uBP[i].xyz, M = uBM[i].xyz, E = cross(P, M);
  float layer = uBP[i].w;
  float sl = clamp(dot(n, P), -1.0, 1.0);
  vec2 uv = vec2(atan(dot(n, E), dot(n, M)) * 0.15915494 + 0.5, asin(sl) * 0.31830989 + 0.5);
  float mu = max(dot(n, v), 0.0);
  // explicit mip level: map texels per pixel at the disc centre, more toward the limb (no seam at the date line)
  float lod = log2(max(MAP_W * 0.15915494 * fp / s, 1.0)) + 0.5 * log2(1.0 / max(mu, 0.2));
  vec4 tx = textureLod(uBodyTex, vec3(uv, layer), lod);
  vec3 alb = tx.rgb * uBK[i].rgb, nn = n;
  // relief from the height map: crater walls and ridges catch the light near the terminator
  float relief = uBR[i].w * (1.0 - smoothstep(2.5, 5.0, lod));
  if (relief > 0.0) {
    float st = exp2(max(lod, 0.0)) / MAP_W;
    float hx = textureLod(uBodyTex, vec3(uv + vec2(st, 0.0), layer), lod).a - textureLod(uBodyTex, vec3(uv - vec2(st, 0.0), layer), lod).a;
    float hy = textureLod(uBodyTex, vec3(uv + vec2(0.0, 2.0 * st), layer), lod).a - textureLod(uBodyTex, vec3(uv - vec2(0.0, 2.0 * st), layer), lod).a;
    vec3 eT = cross(P, n);
    float cl = length(eT);
    if (cl > 0.05) {
      eT /= cl;
      vec3 nT = cross(n, eT);
      float g = relief / (2.0 * 6.2831853 * st);
      nn = normalize(n - g * (hx / cl * eT + hy * nT));
    }
  }
  float mu0 = dot(nn, l), mu0s = dot(n, l), ph = dot(l, v);   // ph: cosine of the phase angle (1 = full)
  vec3 light = uBT[i].rgb, col;
  if (uBL[i].w > 0.5 && uBL[i].w < 1.5) {
    // gas giant: soft terminator, darker toward the limb
    col = alb * light * max(mu0s + 0.08, 0.0) / 1.08 * (0.62 + 0.38 * sqrt(mu));
  } else {
    // regolith: Lambert blended with Lommel–Seeliger (the flat, evenly bright full moon) and a small opposition surge
    float ls = mu0 > 0.0 ? 2.0 * mu0 / (mu0 + mu + 1e-3) : 0.0;
    float f = mix(max(mu0, 0.0), ls, uBL[i].w < 0.5 ? 0.6 : 0.25) * (1.0 + 0.3 * smoothstep(0.985, 1.0, ph));
    col = alb * light * f * smoothstep(-0.03, 0.05, mu0s);
  }
  // limb haze on the lit side
  col += uBA[i].rgb * uBT[i].w * pow(1.0 - mu, 3.0) * smoothstep(-0.25, 0.35, mu0s) * light;
  // the night side lit by its planet (Solenne-shine on Lull: strongest when Lull is new)
  col += alb * uBM[i].w * 0.5 * (1.0 - ph) * mu * light;
  // the rings' shadow across the planet
  if (uBA[i].w >= 0.0) {
    float lp = dot(l, P), tau = -sl / (abs(lp) > 1e-4 ? lp : 1e-4);
    float u = (length(n + tau * l) - uBR[i].x) / (uBR[i].y - uBR[i].x);
    if (tau > 0.0 && u > 0.0 && u < 1.0) {
      float d = textureLod(uRingTex, vec3(u, 0.5, uBA[i].w), 2.0).a * uBR[i].z;
      col *= 1.0 - 0.9 * (1.0 - exp(-d * 1.6 / max(abs(lp), 0.05)));
    }
  }
  return col;
}

/* light from the far bodies along rd (rgb) and how much of the sky behind them they cover (a);
   bodies come sorted nearest first, so a nearer disc hides the ones behind it */
vec4 farBodies(vec3 rd0) {
  vec3 acc = vec3(0.0);
  float T = 1.0;
  // grain on the bodies (eye and eyepiece), changing each frame
  float grain = fract(sin(dot(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  for (int i = 0; i < NB; i++) {
    if (i >= uBN || T < 0.01) break;
    vec3 c = uBC[i].xyz;
    if (dot(rd0, c) <= 0.0) continue;
    // seeing: Solenne's air makes each body shimmer and soften a little, more toward the horizon;
    // invisible to the naked eye, a gentle ripple through the telescope
    float see = 3.5e-5 * (1.0 + 3.0 * (1.0 - smoothstep(0.0, 0.6, c.y))), fp = max(uPxAng, see);
    vec3 e1 = normalize(cross(c, abs(c.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), e2 = cross(c, e1);
    float kx = dot(rd0, e1) / (see * 18.0), ky = dot(rd0, e2) / (see * 18.0);
    vec3 rd = normalize(rd0 + see * 0.35 * (e1 * (sin(ky * 1.3 + uTime * 5.3) + 0.6 * sin(kx * 2.1 - uTime * 7.9))
                                         + e2 * (sin(kx * 1.1 - uTime * 4.7) + 0.6 * sin(ky * 1.9 + uTime * 8.3))));
    float s = uBC[i].w, b = dot(rd, c);
    float sn = length(cross(rd, c)), rpx = s / fp;
    bool ringed = uBA[i].w >= 0.0;
    if (sn > s * (ringed ? uBR[i].y : 1.04) + 2.0 * fp) continue;
    vec3 l = uBL[i].xyz, col = vec3(0.0);
    float cov = 0.0;
    // smaller than a couple of pixels: a soft dot carrying the disc's total light (phase-integrated)
    float dotW = 1.0 - smoothstep(1.2, 2.4, rpx);
    if (dotW > 0.0) {
      float rf = 1.3 * fp, q = sn / rf;
      if (q < 1.0) {
        float a = acos(clamp(dot(l, -c), -1.0, 1.0));
        float phi = (sin(a) + (3.14159265 - a) * cos(a)) / 3.14159265;
        vec3 avg = uBK[i].rgb * uBK[i].w * uBT[i].rgb * 0.667 * phi * (1.0 + (ringed ? 0.6 * uBR[i].z : 0.0));
        float w = 1.0 - q * q, k = 3.0 * s * s / (rf * rf);
        w *= w;
        col += avg * k * w * dotW;
        cov = min(k, 1.0) * w * dotW;
      }
    }
    if (dotW < 1.0) {
      float edge = clamp((s - sn) / fp + 0.5, 0.0, 1.0);   // anti-aliased limb, softened by the seeing
      float tP = 1e9;
      vec3 dcol = vec3(0.0);
      if (edge > 0.0) {
        float sq = sqrt(max(s * s - sn * sn, 0.0));
        tP = b - sq;
        dcol = shadeBody(i, normalize((b * rd - c) - sq * rd), rd, s, fp) * edge;
      } else if (uBT[i].w > 0.0) {
        // a thin glow of air just outside the limb, on the lit side
        float x = (sn - s) / (0.035 * s);
        if (x < 1.0) dcol = uBA[i].rgb * uBT[i].w * uBT[i].rgb * 0.5 * (1.0 - x) * (1.0 - x) * smoothstep(-0.3, 0.5, dot(normalize(b * rd - c), l));
      }
      float dcov = edge;
      if (ringed) {
        vec3 P = uBP[i].xyz;
        float dn = dot(rd, P), tR = dot(c, P) / (abs(dn) > 1e-6 ? dn : 1e-6);
        vec3 q = (tR * rd - c) / s;   // ring-plane point in planet radii
        float u = (length(q) - uBR[i].x) / (uBR[i].y - uBR[i].x);
        if (tR > 0.0 && u > 0.0 && u < 1.0) {
          float lodR = log2(max(RING_W / (uBR[i].y - uBR[i].x) * fp / (s * sqrt(max(abs(dn), 0.02))), 1.0));
          vec4 rt = textureLod(uRingTex, vec3(u, 0.5, uBA[i].w), lodR);
          float dens = rt.a * uBR[i].z, alpha = min(1.0 - exp(-dens * 1.6 / max(abs(dn), 0.03)), 0.97);
          float lp = dot(l, P);
          // lit face: reflected light; unlit face: light that soaked through, strongest looking toward the sun
          float lit = (lp > 0.0) == (dn < 0.0) ? 0.25 + 0.75 * sqrt(abs(lp)) : 0.45 * (1.0 - exp(-dens * 1.5)) * (0.3 + 1.7 * pow(max(dot(rd, l), 0.0), 6.0));
          float bq = dot(q, l), cq = dot(q, q) - 1.0;
          if (bq < 0.0 && bq * bq > cq) lit *= 0.04;   // the planet's shadow across the rings
          vec3 rc = rt.rgb * uBK[i].rgb * uBT[i].rgb * lit;
          if (tR < tP) { dcol = rc * alpha + dcol * (1.0 - alpha); dcov = max(dcov, alpha); }
          else { dcol += rc * alpha * (1.0 - edge); dcov = max(dcov, alpha * (1.0 - edge)); }
        }
      }
      col += dcol * (1.0 - dotW);
      cov = max(cov, dcov * (1.0 - dotW));
    }
    acc += col * (1.0 + 0.24 * grain) * T;
    T *= 1.0 - cov;
  }
  return vec4(acc, 1.0 - T);
}

/* the sun's corona around Lull's disc near totality */
vec3 corona(vec3 rd) {
  float tot = 1.0 - smoothstep(0.0, 0.1, uSunL.w);
  vec3 sd = uSunL.xyz;
  if (tot <= 0.0 || dot(rd, sd) <= 0.0) return vec3(0.0);
  float rm = uOccL.w, ang = asin(min(length(cross(rd, sd)), 1.0)), dm = asin(min(length(cross(rd, uOccL.xyz)), 1.0));
  vec3 e1 = normalize(cross(sd, abs(sd.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), e2 = cross(sd, e1);
  float az = atan(dot(rd, e2), dot(rd, e1));
  float streak = 0.55 + 0.45 * sin(az * 5.0 + 1.3 * sin(az * 3.0 + 1.0)) * sin(az * 2.0 + 0.5);
  float x = max(ang - rm, 0.0) / rm;
  return vec3(1.0, 0.96, 0.9) * tot * (1.6 * exp(-x * 9.0) + 0.5 * streak * exp(-x * 2.6)) * smoothstep(rm * 0.99, rm * 1.03, dm);
}
`;
