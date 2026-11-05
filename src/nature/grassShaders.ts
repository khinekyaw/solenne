import { COMMON, REGION_VS, HEIGHT_FETCH, WIND_GLSL, MEADOW_GLSL } from '../render/glsl';

/* =========================================================================
   Grass blades and dandelions (prototype, unchanged maths in the spawn
   region's flat space); only the last step maps through the sphere.
   ========================================================================= */
export const GRASS_VS = /* glsl */`
#define SUN uSunDirF
${COMMON}
${REGION_VS}
${HEIGHT_FETCH}
${WIND_GLSL}
${MEADOW_GLSL}
uniform sampler2D uTerrain;
uniform vec2 uCamCell;
uniform float uSpacing;
uniform int uN;
uniform float uRadius;
uniform float uInner;
uniform float uWidthS;
uniform float uHeightS;
uniform vec3 uCamFwd;
uniform vec4 uWash;
varying float vT;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vTip;
varying vec3 vBase;
varying float vShadow;
varying float vGust;
varying float vDeck;

void main() {
  int id = gl_InstanceID;
  ivec2 cell = ivec2(uCamCell) + ivec2(id % uN - uN / 2, id / uN - uN / 2);
  vec3 r1 = rand3(cell, 1u), r2 = rand3(cell, 7u), r3 = rand3(cell, 13u);
  vec2 xz = (vec2(cell) + r1.xy) * uSpacing;
  // tufts: blades lean in toward the centre of their 0.7 m clump instead of an even scatter
  ivec2 tc = ivec2(floor(xz / 0.7));
  vec3 tr = rand3(tc, 53u);
  xz = mix(xz, (vec2(tc) + 0.2 + 0.6 * tr.xy) * 0.7, 0.16 + 0.34 * tr.z);
  vec2 rel = xz - uCamPos.xz;
  float dist = length(rel);
  float lush = meadowLush(xz);

  float keep = 1.0 - smoothstep(uRadius * 0.7, uRadius, dist);
  if (uInner > 0.0) keep *= smoothstep(uInner * 0.72, uInner, dist);
  vec4 td = textureLod(uTerrain, regionUV(xz), 0.0);
  vec4 patchN = textureLod(uWeather, xz / 260.0, 0.0);
  keep *= td.g * mix(0.72, 1.0, lush) * mix(0.82, 1.0, tr.x);   // short turf stays dense, just low
  if (abs(xz.x - uRegionC.x) > WORLD * 0.5 - 4.0 || abs(xz.y - uRegionC.y) > WORLD * 0.5 - 4.0) keep = 0.0;
  bool cull = r2.x > keep;
  // cheap frustum rejection
  vec2 fw = normalize(uCamFwd.xz + 1e-5);
  if (dist > 4.0 && dot(rel / dist, fw) < -0.25 && abs(uCamFwd.y) < 0.85) cull = true;
  if (inHouse(xz)) cull = true;
  if (cull) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }

  float patchy = smoothstep(0.2, 0.75, patchN.b);
  vec3 r4 = rand3(cell, 41u);
  float base = groundAt(xz) - 0.04;
  float deck = deckShade(base) * seaCovAt(normalize(flatToPF(vec3(xz.x, base, xz.y))));   // under a cloud bank: taller, softer shade grass
  float h = mix(0.30, 0.68, r2.y) * mix(0.48, 1.22, lush) * mix(0.78, 1.18, tr.y) * mix(0.88, 1.12, patchy) * uHeightS * mix(0.55, 1.0, td.g) * mix(1.0, 1.28, deck);
  float w = mix(0.035, 0.062, r2.z) * uWidthS;
  // now and then a thin seed stalk stands above the lush grass
  if (r4.z > 0.975 && lush > 0.45) { h *= 1.65; w *= 0.55; }
  float ang = r1.z * 6.2831853;
  vec3 side = vec3(cos(ang), 0.0, sin(ang));
  vec2 fwd = vec2(-side.z, side.x);
  // turn edge-on blades a little toward the viewer so the field stays full
  vec2 toCam = -rel / max(dist, 1e-3);
  float vd = dot(side.xz, toCam);
  side.xz = normalize(side.xz - toCam * vd * 0.55);

  float g = gustAt(xz);
  float bendW = windBend(xz, g, r3.z * 6.2831853);
  vec2 B = fwd * mix(0.08, 0.5, r3.x) + uWindDir * bendW;
  // the Wren's downwash: blades pressed out from under her, fluttering
  vec2 wd = xz - uWash.xy;
  float wl = length(wd), wk = uWash.z * smoothstep(uWash.w, uWash.w * 0.2, wl);
  B += wd / max(wl, 0.4) * wk * (1.0 + 0.3 * sin(uTime * 19.0 + r3.z * 6.2831853 - wl * 1.7));
  float bl = length(B);
  if (bl > 1.25) B *= 1.25 / bl;

  float t = position.y;
  float s = position.x;
  vec2 off = B * h * t * t * 0.75;
  float y = h * t * (1.0 - 0.22 * dot(B, B) * t * t);
  float wt = w * (1.0 - t * 0.82);
  vec3 wp = vec3(xz.x, base, xz.y) + vec3(off.x, y, off.y) + side * s * wt * 0.5;

  vec3 tang = normalize(vec3(B.x * h * 1.5 * t, h * (1.0 - 0.66 * dot(B, B) * t * t), B.y * h * 1.5 * t));
  vec3 nrm = normalize(cross(side, tang));
  nrm = normalize(nrm + side * s * 0.55);

  vT = t;
  vWorld = wp;
  vNormal = nrm;
  float cv = r3.y * 0.6 + patchN.a * 0.4;
  float bright = textureLod(uWeather, xz / 47.0 + 0.61, 0.0).b;
  // soft spring greens drifting toward straw and mint in patches
  vec3 tip = mix(vec3(0.066, 0.15, 0.066), vec3(0.11, 0.19, 0.07), cv * cv);
  tip = mix(tip, vec3(0.05, 0.135, 0.088), smoothstep(0.55, 0.9, patchN.r) * 0.45);
  // the same wind-aligned brush flecks as the ground, so blades and soil read as one painted surface
  vec2 sxB = vec2(dot(xz, uWindDir), dot(xz, vec2(-uWindDir.y, uWindDir.x)));
  float fleckB = smoothstep(0.66, 0.92, textureLod(uWeather, sxB * vec2(0.55, 1.6) / 3.0, 0.0).a);
  if (r4.x < 0.07 + 0.4 * fleckB) tip = mix(vec3(0.15, 0.23, 0.08), vec3(0.2, 0.25, 0.09), r4.y);   // lighter, sun-bleached blades
  else if (r4.x > 0.9) tip *= vec3(0.78, 0.85, 0.95);                                              // a few darker ones
  float hollowB = smoothstep(0.5, 0.78, textureLod(uWeather, xz / 64.0 + 0.23, 0.0).r * 0.7 + textureLod(uWeather, xz / 41.0, 0.0).b * 0.3);
  tip = mix(tip, vec3(0.045, 0.105, 0.08), hollowB * 0.35);
  tip = mix(tip, vec3(0.13, 0.18, 0.075), smoothstep(0.62, 0.86, textureLod(uWeather, xz / 90.0 + 0.81, 0.0).a) * 0.45);
  // short worn turf is lighter and warmer, lush meadow deeper and cooler; each tuft a touch different
  tip = mix(tip * vec3(1.14, 1.1, 0.8), tip * vec3(0.9, 0.97, 1.04), lush) * mix(0.92, 1.08, tr.z);
  tip = mix(tip, tip * vec3(0.7, 0.95, 1.02) + vec3(0.0, 0.012, 0.018), deck);   // blue-green in the shade
  vTip = tip * mix(0.88, 1.06, r2.y) * mix(0.86, 1.07, bright);
  vBase = mix(vec3(0.02, 0.045, 0.03), vec3(0.03, 0.06, 0.036), cv) * mix(1.25, 0.9, lush);
  vGust = g * waveShade();
  vShadow = td.r * cloudShadow(vec3(xz.x, base, xz.y)) * houseShadow(vec3(xz.x, base + h * t, xz.y), vec3(0.0, 1.0, 0.0)) * (1.0 - 0.96 * deck);
  vDeck = deck;
  gl_Position = regionToClip(wp);
}
`;
export const GRASS_FS = /* glsl */`
#define SUN uSunDirF
${COMMON}
varying float vT;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vTip;
varying vec3 vBase;
varying float vShadow;
varying float vGust;
varying float vDeck;
void main() {
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 toCam = uCamPos - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec3 L = SUN;
  float t = vT;
  vec3 alb = mix(vBase, vTip, smoothstep(0.0, 0.85, t)) * (1.0 - 0.22 * uWet);
  // bent blades show their bright faces: this is what makes the waves visible
  alb *= 1.0 + vGust * 0.45 * t;
  alb = mix(alb, alb * vec3(1.06, 1.04, 0.94), vGust * t);
  float ao = mix(0.5, 1.0, smoothstep(0.0, 0.75, t));
  float farK = smoothstep(14.0, 55.0, dist);
  alb = mix(alb, vTip * 1.05, farK * 0.75);
  ao = mix(ao, 1.0, farK);
  float ndl = dot(N, L);
  float diff = clamp(ndl * 0.5 + 0.5, 0.0, 1.0) * ao;
  float back = pow(clamp(dot(-V, L), 0.0, 1.0), 3.0);
  float trans = (back * 0.7 + clamp(-ndl, 0.0, 1.0) * 0.2) * (0.3 + 0.7 * t);
  vec3 Hh = normalize(L + V);
  float spec = pow(clamp(dot(N, Hh), 0.0, 1.0), 50.0) * (0.22 + 0.5 * uWet) * t;
  vec3 sun = uSunColor * GROUND_SUN * vShadow;
  vec3 deckL = deckLight(uHorizon, uZenith, uSunColor, uNight);
  vec3 amb = mix(skyAmbient(normalize(N + vec3(0.0, 1.3, 0.0))), deckL * 1.2, vDeck);
  vec3 col = alb * (sun * diff + amb * ao)
           + alb * vec3(0.9, 1.0, 0.65) * sun * trans
           + sun * spec * vec3(0.95, 1.0, 0.9) * (1.0 + vGust)
           + sun * vGust * t * 0.03 * vec3(0.95, 1.0, 0.85);
  col = mix(col, hazeColor(-V), hazeAmount(dist) * (1.0 - vDeck));
  col = mix(col, deckL * 0.9, murkAmount(vWorld.y, dist) * vDeck);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const FLOWER_VS = /* glsl */`
#define SUN uSunDirF
${COMMON}
${REGION_VS}
${HEIGHT_FETCH}
${WIND_GLSL}
${MEADOW_GLSL}
uniform sampler2D uTerrain;
uniform vec2 uCamCell;
uniform float uSpacing;
uniform int uN;
uniform float uRadius;
uniform float uGrassH;
varying vec2 vUv;
varying vec2 vSize;
varying float vShadow;
varying vec3 vWorld;
varying float vKind;
varying float vDeck;
void main() {
  int id = gl_InstanceID;
  ivec2 cell = ivec2(uCamCell) + ivec2(id % uN - uN / 2, id / uN - uN / 2);
  vec3 r1 = rand3(cell, 3u), r2 = rand3(cell, 19u), r3 = rand3(cell, 29u);
  vec2 xz = (vec2(cell) + r1.xy) * uSpacing;
  // flowers bunch around small clump centres
  ivec2 fc = ivec2(floor(xz / 2.4));
  vec3 fr = rand3(fc, 61u);
  xz = mix(xz, (vec2(fc) + 0.25 + 0.5 * fr.xy) * 2.4, 0.5 * fr.z);
  vec2 rel = xz - uCamPos.xz;
  float dist = length(rel);
  vec4 td = textureLod(uTerrain, regionUV(xz), 0.0);
  // mostly in drifts, a few strays between; tall lush grass hides more of them
  float drift = meadowDrift(xz), lush = meadowLush(xz);
  float keep = (0.025 + 0.85 * drift) * mix(1.0, 0.55, lush) * td.g * (1.0 - smoothstep(uRadius * 0.7, uRadius, dist));
  if (abs(xz.x - uRegionC.x) > WORLD * 0.5 - 4.0 || abs(xz.y - uRegionC.y) > WORLD * 0.5 - 4.0) keep = 0.0;
  if (r1.z > keep || inHouse(xz)) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }

  // 0 seed puff, 1 buttercup, 2 pale blue, 3 pink clover, 4 daisy. Each drift is mostly one kind
  float sp = textureLod(uWeather, xz / 170.0 + 0.7, 0.0).g * 0.75 + textureLod(uWeather, xz / 60.0 + 0.2, 0.0).b * 0.25;
  if (r3.y > 0.86) sp = r3.z;
  float kind = r3.x < 0.1 ? 0.0 : (sp < 0.36 ? 1.0 : sp < 0.48 ? 4.0 : sp < 0.6 ? 2.0 : sp < 0.7 ? 3.0 : 1.0);
  // under the clouds: bluebells and wood anemones, glowing lantern blooms (5) and toadstools (6)
  float base = groundAt(xz) - 0.03;
  float deck = deckShade(base) * seaCovAt(normalize(flatToPF(vec3(xz.x, base, xz.y))));
  if (deck > 0.5) kind = r3.x < 0.13 ? 5.0 : r3.x < 0.3 ? 6.0 : (sp < 0.52 ? 2.0 : 4.0);
  float stemH = (kind < 0.5 ? mix(0.42, 0.78, r2.x) : kind > 2.5 && kind < 3.5 ? mix(0.1, 0.2, r2.x)
              : kind > 5.5 ? mix(0.05, 0.13, r2.x) : kind > 4.5 ? mix(0.28, 0.5, r2.x) : mix(0.2, 0.4, r2.x)) * mix(1.0, uGrassH, 0.85);
  float headR = kind < 0.5 ? mix(0.034, 0.05, r2.y) : kind > 5.5 ? mix(0.045, 0.085, r2.y) : kind > 3.5 ? mix(0.03, 0.042, r2.y) : mix(0.024, 0.038, r2.y);
  vKind = kind;
  float width = headR * 2.6;
  float height = stemH + headR * 1.25;
  vec3 toC = normalize(vec3(uCamPos.x - xz.x, 0.0, uCamPos.z - xz.y));
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toC));
  float bend = windBend(xz, gustAt(xz), r2.z * 6.2831853) * 0.35;
  vec2 sway = uWindDir * bend * stemH * position.y * position.y;
  vec3 wp = vec3(xz.x, base, xz.y) + right * (position.x - 0.5) * width + vec3(sway.x, position.y * height, sway.y);
  vUv = position.xy;
  vSize = vec2(width, height);
  vShadow = td.r * cloudShadow(vec3(xz.x, base, xz.y)) * houseShadow(vec3(xz.x, base + 0.4, xz.y), vec3(0.0, 1.0, 0.0)) * (1.0 - 0.96 * deck);
  vDeck = deck;
  vWorld = wp;
  gl_Position = regionToClip(wp);
}
`;
export const FLOWER_FS = /* glsl */`
#define SUN uSunDirF
${COMMON}
varying vec2 vUv;
varying vec2 vSize;
varying float vShadow;
varying vec3 vWorld;
varying float vKind;
varying float vDeck;
void main() {
  bool puff = vKind < 0.5, daisy = vKind > 3.5 && vKind < 4.5, clover = vKind > 2.5 && vKind < 3.5;
  bool lantern = vKind > 4.5 && vKind < 5.5, toad = vKind > 5.5;
  float headR = vSize.x / 2.6;
  vec2 p = (vUv - vec2(0.5, 0.0)) * vSize;
  vec2 c = vec2(0.0, vSize.y - headR * 1.12);
  vec2 d = p - c;
  float r = length(d) / headR;
  float a = atan(d.y, d.x);
  float fuzz = puff ? 0.07 * sin(a * 23.0) + 0.05 * sin(a * 41.0 + 1.3)
             : daisy ? 0.3 * (1.0 - abs(sin(a * 6.5))) : clover ? 0.06 * sin(a * 17.0) : 0.0;
  float head = 1.0 - smoothstep(puff ? 0.82 : 0.6, 1.0, r + fuzz);
  float sw = puff ? 0.0045 : toad ? headR * 0.22 : 0.0025;
  float stem = (1.0 - smoothstep(sw * 0.6, sw, abs(p.x))) * step(p.y, c.y);
  // a toadstool: a domed cap over a thick stalk
  if (toad) head = (1.0 - smoothstep(0.85, 1.0, length(d / vec2(headR, headR * 0.62)))) * step(-0.12 * headR, d.y);
  float alpha = max(head, stem);
  if (alpha < 0.02) discard;

  vec3 toCam = uCamPos - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float back = pow(max(dot(-V, SUN), 0.0), 3.0);
  vec3 sun = uSunColor * GROUND_SUN * vShadow;
  vec3 deckL = deckLight(uHorizon, uZenith, uSunColor, uNight);
  vec3 amb = mix(skyAmbient(vec3(0.0, 1.0, 0.0)), deckL * 1.2, vDeck);
  vec3 petal = puff ? vec3(0.62, 0.64, 0.6) : vKind < 1.5 ? vec3(0.95, 0.6, 0.07)
             : vKind < 2.5 ? (vDeck > 0.5 ? vec3(0.45, 0.42, 0.95) : vec3(0.42, 0.62, 1.0))
             : clover ? vec3(0.86, 0.44, 0.62) : lantern ? vec3(0.55, 0.95, 0.85) : toad ? vec3(0.86, 0.66, 0.44)
             : (r < 0.36 ? vec3(0.98, 0.66, 0.1) : vec3(0.82, 0.82, 0.78));
  if (toad && fract(sin(dot(floor(d / (headR * 0.33)), vec2(12.9, 78.2))) * 4375.5) > 0.82) petal = vec3(0.95, 0.92, 0.84);   // pale flecks
  vec3 headCol = petal * (sun * (0.6 + 0.6 * back) + amb * 0.9) + (puff ? vec3(0.0) : petal * 0.24 * (1.0 - 0.8 * uNight) * (1.0 - vDeck));
  headCol *= mix(puff ? 0.7 : 0.85, 1.0, smoothstep(0.0, 0.7, r));
  // lantern blooms and toadstool gills give off their own soft light in the gloom
  if (lantern) headCol += vec3(0.32, 0.95, 0.78) * (0.5 + 0.5 * (1.0 - r)) * 0.55;
  if (toad) headCol += vec3(0.25, 0.7, 0.55) * 0.12 * smoothstep(0.2, -0.1, d.y / headR);
  vec3 stemCol = (toad ? vec3(0.6, 0.56, 0.48) : vec3(0.04, 0.1, 0.045)) * (sun * 0.6 + amb);
  vec3 col = head > 0.02 ? headCol : stemCol;
  col = mix(col, hazeColor(-V), hazeAmount(dist) * (1.0 - vDeck));
  col = mix(col, deckL * 0.9, murkAmount(vWorld.y, dist) * vDeck);
  gl_FragColor = vec4(col, alpha);
}
`;

/* Drifting seeds / pollen catching the light — a box around the camera in the local frame */
export const MOTE_VS = /* glsl */`
#define SUN uSunDirL
${COMMON}
uniform vec2 uWindDir;
uniform float uWindStr;
uniform float uWindPhase;
uniform float uPx;
uniform vec3 uCamBox;
attribute vec4 seed;
varying float vA;
varying float vGlow;
varying float vSpore;
void main() {
  vec3 box = vec3(56.0, 14.0, 56.0);
  vec3 drift = vec3(uWindDir.x, 0.0, uWindDir.y) * uWindPhase * 0.25 + vec3(0.0, sin(uTime * 0.4 + seed.w * 6.28) * 0.6, 0.0);
  vec3 p = seed.xyz * box + drift;
  p = mod(p - uCamBox + box * 0.5, box) - box * 0.5;
  p.y = -3.0 + mod(seed.y * box.y + uTime * 0.12 * (seed.w - 0.4), box.y);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  vec3 V = normalize(-p);
  float back = pow(max(dot(-V, SUN), 0.0), 4.0);
  // sunlit pollen by day; in the dark (night, or under the cloud deck) some motes glow instead:
  // fireflies over the meadow, slow pale-green spores below the clouds
  vSpore = (1.0 - smoothstep(SEA_TOP - 60.0, SEA_TOP - 10.0, uCamAlt)) * seaCovAt(normalize(uCamPF));
  vGlow = max(vSpore, smoothstep(0.45, 0.85, uNight)) * step(0.55, seed.w);
  float pulse = 0.55 + 0.45 * sin(uTime * (vSpore > 0.5 ? 0.9 : 2.6) + seed.x * 40.0);
  vA = mix(0.25 + 1.4 * back, pulse * 1.6, vGlow) * smoothstep(0.5, 3.0, d) * (1.0 - smoothstep(18.0, 28.0, d))
     * (1.0 - smoothstep(60.0, 200.0, uCamAlt - SEA_TOP)) * mix(1.0 - vSpore, 1.0, vGlow)
     * mix(1.0 - smoothstep(0.3, 0.7, uDark), 1.0, vSpore);   // pollen and fireflies shelter from rain and storms
  gl_PointSize = clamp(uPx * (0.035 + 0.025 * seed.w) / max(d, 0.1), 1.0, mix(9.0, 4.0, vGlow));
  gl_Position = projectionMatrix * mv;
}
`;
export const MOTE_FS = /* glsl */`
#define SUN uSunDirL
${COMMON}
varying float vA;
varying float vGlow;
varying float vSpore;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(c));
  vec3 glow = mix(vec3(0.75, 0.95, 0.32), vec3(0.3, 0.9, 0.7), vSpore) * 0.22;
  gl_FragColor = vec4(mix(uSunColor * 0.25, glow, vGlow) * a * vA, 1.0);
}
`;
