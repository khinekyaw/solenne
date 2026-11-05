import { MAP_W, RING_W, LAND_RES } from '../config';
import { ATLAS_GLSL } from '../render/glsl';
import { FAR_MAX } from './system';
import { NAR, NPR } from './sun';

/* =========================================================================
   Far pass: planets and moons drawn in the full-resolution background as
   analytic spheres (no meshes, no depth), positioned in float64 on the CPU
   and handed over as directions + radius/distance. Each body is shaded from
   its baked surface map; the giants get limb haze and rings. Bodies smaller
   than a couple of pixels become soft dots that carry the disc's whole
   light, so they never flicker in and out. The result is seen through the
   air and the clouds (visibility from the cloud pass). The sun is one of
   them (kind 3): a sphere with its photosphere or, through the telescope's
   hydrogen-alpha filter, its chromosphere and the prominences off its limb.
   ========================================================================= */
export const FAR_GLSL = /* glsl */`
#define NB ${FAR_MAX}
#define MAP_W ${MAP_W.toFixed(1)}
#define RING_W ${RING_W.toFixed(1)}
#define LAND_RES ${LAND_RES.toFixed(1)}
uniform sampler2D uLand;   // Solenne's land atlas (highland, cloud-sea cover), for Solenne seen from afar
uniform mat3 uLtoPF;
${ATLAS_GLSL}
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
uniform float uDot;     // the point-like worlds' brightness (the showcase lifts them, like a long exposure)
uniform float uTime;
uniform vec4 uSunL;     // sun direction from the camera, fraction of its disc left uncovered
uniform vec4 uOccL;     // Lull: direction, angular radius
// the sun's active regions and prominences (space/sun.ts)
#define NAR ${NAR}
#define NPR ${NPR}
uniform int uNAR;
uniform vec4 uAR[NAR];    // centre, extent on the sun (radians)
uniform vec4 uAR2[NAR];   // bipole tilt, seed, leader and follower spot growth
uniform vec4 uAR3[NAR];   // flare brightness, flare age, plage
uniform int uNPR;
uniform vec4 uPR[NPR];    // foot centre, half-length (radians)
uniform vec4 uPR2[NPR];   // along the filament, height (sun radii)
uniform vec4 uPR3[NPR];   // kind (0 sheet, 1 loop arcade, 2 eruption), seed, thickness or eruption, strength

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
  col += uBA[i].rgb * uBT[i].w * pow(max(1.0 - mu, 0.0), 3.0) * smoothstep(-0.25, 0.35, mu0s) * light;   // (rounding puts mu a hair over 1: pow of a negative is NaN, and bloom spreads one NaN pixel over the whole frame)
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

/* ---- the sun ---- */
#define GRAN 420.0    // granules per sun radius
#define SUPER 26.0    // cells of the chromospheric network per sun radius
#define HA_GAIN 3.0   // the h-alpha filter passes the chromosphere's line and little of the sky (renderer.ts divides it back out)
uvec3 sPcg(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 sH3(vec3 c) { return vec3(sPcg(uvec3(ivec3(c) + 32768))) * (1.0 / 4294967295.0); }
float sNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sH3(i).x, sH3(i + vec3(1.0, 0.0, 0.0)).x, f.x), mix(sH3(i + vec3(0.0, 1.0, 0.0)).x, sH3(i + vec3(1.0, 1.0, 0.0)).x, f.x), f.y),
             mix(mix(sH3(i + vec3(0.0, 0.0, 1.0)).x, sH3(i + vec3(1.0, 0.0, 1.0)).x, f.x), mix(sH3(i + vec3(0.0, 1.0, 1.0)).x, sH3(i + 1.0).x, f.x), f.y), f.z);
}
// granulation: bright cells parted by dark lanes (Worley F2 − F1); the feature points wander, so the cells boil
vec2 granules(vec3 p) {
  vec3 c = floor(p), f = fract(p);
  float d1 = 9.0, d2 = 9.0, b = 0.5;
  for (int k = 0; k < 27; k++) {
    vec3 o = vec3(float(k % 3), float((k / 3) % 3), float(k / 9)) - 1.0, h = sH3(c + o);
    vec3 d = o + 0.5 + 0.38 * sin(6.2831853 * h + uTime * (0.03 + 0.03 * h.yzx)) - f;
    float dd = dot(d, d);
    if (dd < d1) { d2 = d1; d1 = dd; b = h.x; } else if (dd < d2) d2 = dd;
  }
  return vec2(sqrt(d2) - sqrt(d1), b);   // distance from the lanes, and the granule's own brightness
}
/* one spot of a group: x and c in units of the group's extent, ru its umbra radius, px a pixel in the same
   units; returns (white light, hydrogen-alpha) intensity */
vec2 spot(vec2 x, vec2 c, float ru, float pen, float px, float sd) {
  vec2 q = x - c;
  float r = length(q);
  if (ru <= 1e-4 || r > ru * 4.5) return vec2(1.0);
  vec2 dq = q / max(r, 1e-6);   // the angle around the spot, without a seam
  float re = r / (ru * (1.0 + 0.3 * (sNoise(vec3(dq * 2.2, sd)) - 0.5)));
  float w = px / ru + 0.1;
  float umb = 1.0 - smoothstep(1.0 - w, 1.0 + w, re);
  float rp = 2.3 * (1.0 + 0.3 * (sNoise(vec3(dq * 3.5, sd + 11.0)) - 0.5));
  float pn = pen * (1.0 - smoothstep(rp - w, rp + w, re));   // the penumbra ends sharply
  // radial filaments in the penumbra (gone once narrower than a pixel), fibrils fanning out in hydrogen-alpha
  float filK = smoothstep(1.0, 3.0, ru * 0.15 / px), fil = sNoise(vec3(dq * 30.0, sd + re * 0.7));
  float wl = mix(1.0, mix(mix(0.76, 0.6 + 0.3 * fil, filK), 0.2, umb), max(pn, umb));
  float hl = mix(1.0, mix(0.8, 0.42, umb), max(pn, umb)) * (1.0 - 0.14 * pen * filK * (1.0 - smoothstep(2.0, 4.5, re)) * smoothstep(rp * 0.9, rp * 1.2, re) * fil);
  return vec2(wl, hl);
}
/* the active regions at n: spot darkening (white light, h-alpha), faculae / plage, flare ribbons */
vec4 sunRegions(vec3 n, vec3 P, float pxR) {
  vec2 I = vec2(1.0);
  float fac = 0.0, fl = 0.0;
  for (int i = 0; i < NAR; i++) {
    if (i >= uNAR) break;
    vec4 A = uAR[i], B = uAR2[i], C = uAR3[i];
    float S = A.w, cd = dot(n, A.xyz);
    if (cd < cos(S * 2.2)) continue;
    vec3 e = normalize(cross(P, A.xyz)), nn = cross(A.xyz, e), ax = e * cos(B.x) + nn * sin(B.x), pe = cross(A.xyz, ax), d = n - A.xyz * cd;
    vec2 x = vec2(dot(d, ax), dot(d, pe)) / S;   // in units of the group's extent, leader ahead (+x)
    float sd = B.y, px = pxR / S;
    // faculae and plage: a patchy bright field around the group
    float pm = C.z * smoothstep(1.9, 0.6, length(x * vec2(0.75, 1.25)) + 0.6 * (sNoise(vec3(x * 2.6, sd)) - 0.5));
    if (pm > 0.0) fac = max(fac, pm * smoothstep(0.3, 0.7, 0.6 * sNoise(vec3(x * 8.0, sd + 7.0)) + 0.4 * sNoise(vec3(x * 21.0, sd + 3.0))));
    // the spots: a leader, a follower in two pieces, a scatter of pores; big umbrae grow a penumbra
    float kL = B.z, kF = B.w, penL = smoothstep(0.0025, 0.005, 0.17 * S * sqrt(kL)), penF = smoothstep(0.0025, 0.005, 0.12 * S * sqrt(kF));
    I = min(I, spot(x, vec2(0.42, 0.0), 0.17 * sqrt(kL), penL, px, sd));
    I = min(I, spot(x, vec2(-0.45, 0.08), 0.12 * sqrt(kF), penF, px, sd + 5.0));
    I = min(I, spot(x, vec2(-0.26, -0.13), 0.06 * sqrt(kF), penF * 0.6, px, sd + 9.0));
    for (int k = 0; k < 5; k++) {
      vec3 h = sH3(vec3(sd * 13.0, float(k), 3.0));
      I = min(I, spot(x, vec2(h.x * 1.5 - 0.75, h.y * 0.7 - 0.35), (0.025 + 0.03 * h.z) * sqrt(max(kL, kF)), 0.0, px, sd + float(k)));
    }
    // a flare: two bright ribbons either side of the polarity line, parting as it goes on, kernels at the start
    if (C.x > 0.01) {
      float sep = 0.05 + 0.32 * C.y, wr = max(0.035, px * 1.2), wig = 0.05 * sin(x.y * 9.0 + sd) + 0.03 * sin(x.y * 23.0 + sd * 2.0);
      float r1 = (x.x - sep - wig) / wr, r2 = (x.x + sep - 0.8 * wig) / wr;   // they bend together, never cross (squared by hand: pow of a negative is undefined)
      float rib = max(exp(-r1 * r1), exp(-r2 * r2)) * 0.035 / wr;
      rib *= smoothstep(0.8, 0.3, abs(x.y)) * (0.55 + 0.45 * sNoise(vec3(x * 14.0, sd + uTime * 0.1)));
      vec2 kq = x - vec2(0.08, 0.04);
      fl = max(fl, C.x * max(rib, (1.0 - C.y) * exp(-dot(kq, kq) / max(0.004, px * px))));
    }
  }
  return vec4(I, fac, fl);
}
/* keep the part of [ua, ub] where f0 + u·f1 <= 0 */
void clipRay(float f0, float f1, inout float ua, inout float ub) {
  if (abs(f1) < 1e-8) { if (f0 > 0.0) ub = ua - 1.0; return; }
  float r = -f0 / f1;
  if (f1 > 0.0) ub = min(ub, r); else ua = max(ua, r);
}
/* how much prominence material the ray X(u) = X0 + u·rd crosses for u in [u0, u1] (sun radii, the sun's
   centre at the origin): each is a thin sheet standing on a great-circle arc (its plane passes through the
   centre), an arcade of loops, or an erupting arch. The ray is clipped analytically to each one's slab,
   wedge of the arc and shell of heights, so a few samples inside find even a sheet seen face-on */
float promDepth(vec3 X0, vec3 rd, float u0, float u1, float pxR, float eruptK) {
  float tau = 0.0, r2 = dot(X0, X0);
  // threads at three scales, each fading in once it is wider than a pixel or two
  float th1 = smoothstep(1.0, 3.0, 1.0 / (120.0 * pxR)), th2 = smoothstep(1.0, 3.0, 1.0 / (380.0 * pxR)), th3 = smoothstep(1.0, 3.0, 1.0 / (1100.0 * pxR));
  for (int j = 0; j < NPR; j++) {
    if (j >= uNPR) break;
    vec3 m = uPR[j].xyz, a = uPR2[j].xyz, np = cross(m, a);
    float hh = uPR2[j].w, kind = uPR3[j].x, sd = uPR3[j].y, prm = uPR3[j].z, str = uPR3[j].w;
    float e = kind > 1.5 ? prm : 0.0, top = hh + 1.1 * pow(max(e, 0.0), 1.6), len = uPR[j].w * (1.0 + 0.6 * e);
    float w0 = kind > 1.5 ? 0.02 + 0.15 * e : prm, w = max(w0, 1.5 * pxR) * (kind < 0.5 ? 3.0 : 1.0);   // never thinner than a pixel and a half; a sheet wanders inside a slab three times its width
    float Rj = 1.0 + 1.1 * top + 0.01;
    if (r2 > Rj * Rj) continue;
    float hj = sqrt(Rj * Rj - r2), ua = max(u0, -hj), ub = min(u1, hj);
    // inside the slab |X·np| <= w/2
    float k = dot(rd, np), p0 = dot(X0, np);
    clipRay(p0 - 0.5 * w, k, ua, ub);
    clipRay(-p0 - 0.5 * w, -k, ua, ub);
    // within the arc's wedge: |X·a| <= tan(len)·(X·m)
    float T = tan(min(len, 1.4)), c0 = dot(X0, m), c1 = dot(rd, m), s0 = dot(X0, a), s1 = dot(rd, a);
    clipRay(s0 - T * c0, s1 - T * c1, ua, ub);
    clipRay(-s0 - T * c0, -s1 - T * c1, ua, ub);
    if (ub <= ua) continue;
    float dens = 0.0;
    for (int q = 0; q < 4; q++) {
      vec3 X = X0 + rd * mix(ua, ub, (float(q) + 0.5) / 4.0);
      float z = length(X) - 1.0, sg = atan(dot(X, a), dot(X, m)), off = dot(X, np) / w;
      if (z < 0.0) continue;
      if (kind < 0.5) {
        // a hedgerow: a ragged top, vertical threads, touching down at a few feet; from above, a filament that
        // wanders and swells and thins along its length
        float s = sg / len, taper = sqrt(max(1.0 - s * s, 0.0));
        float tp = hh * (0.35 + 0.45 * sNoise(vec3(s * 4.0, sd, uTime * 0.004)) + 0.2 * sNoise(vec3(s * 23.0, sd + 1.0, uTime * 0.01))) * taper + 1e-5;
        float feet = mix(smoothstep(0.4, 0.75, sNoise(vec3(s * 7.0, sd + 3.0, 0.5))), 1.0, smoothstep(0.15 * tp, 0.5 * tp, z));
        float wig = 0.55 * (sNoise(vec3(s * 5.0, sd + 4.0, 0.0)) - 0.5) + 0.15 * (sNoise(vec3(s * 17.0, sd + 7.0, 0.0)) - 0.5);
        float hw = (0.07 + 0.13 * sNoise(vec3(s * 9.0, sd + 5.0, 0.0))) * (0.4 + 0.6 * taper);
        float sheet = smoothstep(hw, hw * 0.4, abs(off - wig)) * (0.5 + 0.5 * sNoise(vec3(s * 14.0, sd + 6.0, 0.0)));
        float thr = 1.0 + th1 * 1.2 * (sNoise(vec3(sg * 120.0, z * 9.0, sd + off)) - 0.5) + th2 * 1.3 * (sNoise(vec3(sg * 380.0, z * 25.0 + uTime * 0.005, sd)) - 0.5)
                  + th3 * 1.2 * (sNoise(vec3(sg * 1100.0, z * 60.0 + uTime * 0.01, sd + 2.0)) - 0.5);
        dens += smoothstep(tp, tp * 0.6, z) * feet * sheet * max(thr, 0.0) * 3.0;
      } else if (kind < 1.5) {
        // post-flare loops: nested arches along the polarity line
        float s = sg / len, dz = 1e9;
        for (int l = 0; l < 3; l++) {
          float lk = 0.6 + 0.2 * float(l);
          if (abs(s) < lk) dz = min(dz, abs(z - hh * lk * pow(max(cos(1.5708 * s / lk), 0.0), 0.7)));
        }
        float tb = max(0.003 + 0.06 * hh, pxR);
        dens += exp(-dz * dz / (tb * tb)) * (0.6 + 0.4 * sNoise(vec3(off * 9.0, sd, 0.0)));
      } else {
        // an eruption: a twisted arch whose top lifts off while its feet stay put, thinning as it expands
        float s = sg / len, zl = top * pow(max(cos(1.5708 * clamp(s, -1.0, 1.0)), 0.0), 0.6), tb = 0.01 + 0.08 * e, dz = (z - zl) / tb;
        // strands running along the arch (across the tube they change fast, along it slowly), knotted and twisting
        float st = sNoise(vec3(dz * 2.6 + s * 3.0 + off * 2.0, s * 7.0, sd + uTime * 0.02)), kn = sNoise(vec3(s * 26.0 + uTime * 0.05, dz, sd + 4.0));
        dens += exp(-dz * dz) * smoothstep(0.25, 0.8, st) * (0.4 + 0.9 * kn) * 1.6 * pow(max(1.0 - e, 0.0), 1.5);
      }
    }
    tau += str * (kind > 1.5 ? eruptK : 1.0) * 70.0 * w0 / w * dens / 4.0 * (ub - ua);   // thin enough to see the threads through
  }
  return tau;
}
/* sun-fixed coordinates (pole P, rotating meridian M) */
vec3 sunFixed(vec3 n, vec3 P, vec3 M) { return vec3(dot(n, M), dot(n, cross(P, M)), dot(n, P)); }
/* the disc at n (unit normal toward the camera); ha: 0 white light … 1 hydrogen-alpha */
vec3 shadeSun(int i, vec3 n, vec3 rd, float pxR, float ha, vec3 X0, float sq) {
  vec3 P = uBP[i].xyz, M = uBM[i].xyz, q = sunFixed(n, P, M);
  float mu = max(dot(n, -rd), 0.0), pxS = pxR / sqrt(max(mu, 0.05));   // a pixel on the surface, foreshortened toward the limb
  vec4 ar = sunRegions(n, P, pxS);
  vec3 wl = vec3(0.0);
  float hl = 0.0;
  if (ha < 0.999) {
    // photosphere: limb darkening, redder toward the limb; granulation once it is resolved; faculae near the limb
    float x = 1.0 - mu, gK = smoothstep(1.2, 3.0, 1.0 / (GRAN * pxS)) * (0.35 + 0.65 * mu);
    wl = 1.0 - vec3(0.6, 0.7, 0.82) * x - vec3(0.1, 0.1, 0.04) * x * x;
    if (gK > 0.0) { vec2 g = granules(q * GRAN); wl *= 1.0 + 0.22 * gK * (smoothstep(0.0, 0.5, g.x) * (0.65 + 0.35 * g.y) - 0.55); }
    wl *= ar.x * (1.0 + ar.z * 0.5 * pow(max(x, 0.0), 1.5));
    wl += 0.3 * ar.w;   // only the biggest flares show in white light
  }
  if (ha > 0.001) {
    // chromosphere: mild limb darkening, the bright network and dark mottles, plage, dark filaments, flare ribbons
    float nK = smoothstep(1.0, 3.0, 1.0 / (SUPER * pxS)), mK = smoothstep(1.0, 3.0, 1.0 / (SUPER * 6.0 * pxS));
    // the network: ridges of noise, broken up so it reads as bright patches rather than wiring
    float a1 = 1.0 - abs(2.0 * sNoise(q * SUPER) - 1.0), a2 = 1.0 - abs(2.0 * sNoise(q * SUPER * 2.3 + 5.0) - 1.0);
    float patchy = smoothstep(0.25, 0.75, sNoise(q * SUPER * 1.7 + 2.0));
    float net = nK * ((0.24 * pow(max(a1, 0.0), 3.0) + 0.14 * pow(max(a2, 0.0), 5.0)) * (0.35 + 0.65 * patchy) - 0.06) - mK * 0.22 * (sNoise(q * SUPER * 6.0 + 9.0) - 0.5);
    hl = (0.62 + 0.38 * sqrt(mu)) * (1.0 + net) * ar.y * (1.0 + 0.6 * ar.z);
    float tau = promDepth(X0, rd, -sqrt(max(5.3 - dot(X0, X0), 0.0)), -sq, pxR, 0.3);   // an erupting filament greys the disc a little
    hl = mix(hl, 0.4, 1.0 - exp(-tau)) + 2.6 * ar.w;   // filaments: prominences seen from above, dark on the disc
  }
  return uBT[i].rgb * mix(wl, vec3(hl * HA_GAIN), ha);
}
/* just off the limb: spicules and small prominences all round, the big ones from the list; seen in
   hydrogen-alpha, or bare (pink) at totality */
vec3 sunHalo(int i, vec3 X0, vec3 rd, float rho, float pxR, float ha, float tot) {
  float z = rho - 1.0, L = sqrt(max(5.3 - rho * rho, 0.0));   // out to 2.3 radii
  vec3 q = sunFixed(X0 / rho, uBP[i].xyz, uBM[i].xyz);
  // spicules: a thin glowing layer combed into hairs of uneven height (fine ones only once resolved)
  float hK = smoothstep(1.0, 3.0, 1.0 / (1500.0 * pxR));
  float hs = 0.005 + 0.004 * sNoise(q * 140.0) + hK * 0.006 * pow(max(sNoise(q * 1500.0 + uTime * 0.03), 0.0), 3.0);
  float hp = 0.035 * smoothstep(0.62, 0.92, sNoise(q * 8.0 + 3.0)) * (0.6 + 0.4 * sNoise(q * 60.0)) + 1e-5;   // (never 0: smoothstep(0, 0, z) is undefined)
  float rim = 0.45 * exp(-z / 0.003) + 0.35 * smoothstep(hs, hs * 0.4, z) * (0.6 + 0.4 * sNoise(q * 700.0))
            + 0.3 * smoothstep(hp, hp * 0.5, z) * (0.4 + 0.6 * sNoise(q * 260.0 + vec3(0.0, 0.0, z * 60.0)));
  float E = 0.7 * (1.0 - exp(-promDepth(X0, rd, -L, L, pxR, 1.0))) + rim;
  return uBT[i].rgb * E * (ha * HA_GAIN + (1.0 - ha) * tot * 0.07 * vec3(1.0, 0.32, 0.45));
}

/* ---- Solenne from afar (kind 4): its sea of clouds, the highlands standing out of it, open lowland and water in the
   gaps, the blue of its air over the day side and thickest at the limb ---- */
vec3 shadeSolenne(int i, vec3 n, vec3 rd) {
  vec3 d = uLtoPF * n, l = uBL[i].xyz, light = uBT[i].rgb;
  vec2 at = textureLod(uLand, atlasUV(d, LAND_RES), 0.0).rg;
  float mu = max(dot(n, -rd), 0.0), mu0 = dot(n, l);
  float water = smoothstep(0.45, 0.6, 0.7 * sNoise(d * 9.0) + 0.3 * sNoise(d * 23.0));
  vec3 low = mix(vec3(0.15, 0.22, 0.11), vec3(0.04, 0.08, 0.15), water);
  vec3 high = mix(vec3(0.21, 0.29, 0.13), vec3(0.4, 0.38, 0.32), smoothstep(0.6, 1.0, at.r));
  float cloud = smoothstep(0.3, 0.7, at.g) * (1.0 - 0.85 * smoothstep(0.2, 0.6, at.r));
  vec3 alb = mix(mix(low, high, smoothstep(0.1, 0.5, at.r)), vec3(0.84, 0.86, 0.9), cloud);
  vec3 col = alb * light * max(mu0 + 0.05, 0.0) / 1.05;
  return col + uBA[i].rgb * uBT[i].w * (0.12 + 0.9 * pow(max(1.0 - mu, 0.0), 3.0)) * smoothstep(-0.2, 0.3, mu0) * light;
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
    if (abs(uBL[i].w - 3.0) < 0.5) {
      // the sun: a sphere with a crisp limb (softened a little by the seeing), shaded in sun radii
      float ha = uBT[i].w, tot = 1.0 - smoothstep(0.0, 0.1, uSunL.w), emit = max(ha, tot);
      float fs = max(uPxAng, see * 0.3), pxR = fs / s, rho = sn / s;
      if (rho > 1.0 + 1.4 * emit + 2.0 * pxR) continue;
      float edge = clamp((s - sn) / fs + 0.5, 0.0, 1.0);
      vec3 X0 = (b * rd - c) / s, sc = vec3(0.0);   // the ray's closest point to the sun's centre
      if (edge > 0.0) sc = shadeSun(i, normalize(X0 - sqrt(max(1.0 - rho * rho, 0.0)) * rd), rd, pxR, ha, X0, sqrt(max(1.0 - rho * rho, 0.0))) * edge;
      if (edge < 1.0 && emit > 0.0) sc += sunHalo(i, X0, rd, max(rho, 1.0), pxR, ha, tot) * (1.0 - edge);
      acc += sc * T;
      T *= 1.0 - edge;
      continue;
    }
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
        col += avg * k * w * dotW * uDot;
        cov = min(k * uDot, 1.0) * w * dotW;
      }
    }
    if (dotW < 1.0) {
      float edge = clamp((s - sn) / fp + 0.5, 0.0, 1.0);   // anti-aliased limb, softened by the seeing
      float tP = 1e9;
      vec3 dcol = vec3(0.0);
      if (edge > 0.0) {
        float sq = sqrt(max(s * s - sn * sn, 0.0));
        tP = b - sq;
        vec3 nb = normalize((b * rd - c) - sq * rd);
        dcol = (uBL[i].w > 3.5 ? shadeSolenne(i, nb, rd) : shadeBody(i, nb, rd, s, fp)) * edge;
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
