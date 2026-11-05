import * as THREE from 'three';
import { COMMON, WIND_GLSL, PALETTE_GLSL, MEADOW_GLSL } from '../render/glsl';
import { shared } from '../render/frame';

/* =========================================================================
   Painterly ground (prototype TERRAIN_FS) on the sphere. Positions are in
   the local frame; noise uses the chunk's flat face coords (aFlat), slope
   and triplanar weights use the tangent-frame normal from the worker.
   ========================================================================= */
const TERRAIN_VS = /* glsl */`
#define SUN uSunDirL
${COMMON}
uniform mat3 uRegionToL;
attribute vec3 aFlat;
attribute vec4 aInfo;
varying vec3 vRel;
varying vec3 vFlat;
varying vec3 vN;
varying vec4 vInfo;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vRel = wp.xyz; vFlat = aFlat; vInfo = aInfo;
  vN = uRegionToL * normal;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const TERRAIN_FS = /* glsl */`
#define SUN uSunDirL
${COMMON}
${WIND_GLSL}
${PALETTE_GLSL}
${MEADOW_GLSL}
uniform sampler2D uTerrain;
uniform sampler2D uBg;
uniform vec2 uRes;
uniform float uNearR;
varying vec3 vRel;
varying vec3 vFlat;
varying vec3 vN;
varying vec4 vInfo;

// the film's cinema detail on one face of a cliff, seen flat: along the wall (x) and up it (y)
vec3 cliffFace(vec3 rock, vec2 p) {
  float ly = p.y / 5.5 + texture(uWeather, vec2(p.x / 90.0, 0.31)).r * 0.8;   // a ledge every few metres, gently tilted
  float f = fract(ly), id = floor(ly);
  rock *= 0.8 + 0.32 * smoothstep(0.0, 0.9, f);   // each bed rounded: lit along its top, darker at its foot
  rock *= 0.88 + 0.24 * texture(uWeather, vec2(p.y / 1.3, p.x / 40.0)).g;   // fine bedding inside the beds
  // vertical joints break the beds into blocks
  float j = texture(uWeather, vec2(p.x / 13.0 + id * 0.29, p.y / 140.0)).a;
  rock *= 1.0 - 0.5 * (1.0 - smoothstep(0.008, 0.035, abs(j - 0.5)));
  // the seam under each ledge in shadow, and moss holding on the ledge where it runs out far enough
  rock *= 1.0 - 0.55 * (1.0 - smoothstep(0.0, 0.07, f));
  float shelf = smoothstep(0.4, 0.62, texture(uWeather, vec2(p.x / 26.0, id * 0.137)).g);
  vec3 moss = vec3(0.07, 0.15, 0.06) * (0.8 + 0.4 * texture(uWeather, p / 3.0).b);
  rock = mix(rock, moss, smoothstep(0.88, 0.97, f) * shelf * 0.85);
  // dark rain stains running down from the rim, a little green
  float stain = smoothstep(0.5, 0.8, texture(uWeather, vec2(p.x / 7.0, p.y / 260.0)).b);
  rock = mix(rock, rock * vec3(0.55, 0.62, 0.52), stain * 0.7);
  // pale lichen
  return mix(rock, vec3(0.36, 0.36, 0.3), smoothstep(0.74, 0.92, texture(uWeather, p / 2.7 + 0.4).a) * 0.35);
}

void main() {
  vec3 N = normalize(vN);
  float dist = length(vRel);
  vec3 V = -vRel / dist;
  vec3 tn = vec3(vInfo.z, sqrt(max(1.0 - dot(vInfo.zw, vInfo.zw), 0.0)), vInfo.w);   // tangent-frame normal
  bool region = vInfo.y > 0.99;
  vec3 W = vFlat;
  // ground buried in the cloud sea is just the cloud colour: skip the shading
  vec3 pPF = uCamPF + uLtoPF * vRel;
  float cover = seaCovAt(normalize(pPF));   // is there a cloud bank over this spot at all?
  float mist = seaMist(W.y, dist) * smoothstep(0.55, 0.88, cover);   // only well inside a bank, where the deck is whole
  vec3 bg = sampleBg(uBg, gl_FragCoord.xy / uRes);
  if (mist > 0.997) { gl_FragColor = vec4(bg, 1.0); return; }
  vec4 td = vec4(region ? texture(uTerrain, terrainUV(W.xz)).r : 1.0, vInfo.x, 0.0, 1.0);

  // palette: the camera's near by, each point's own sun elevation far away (terminator seen from orbit)
  vec3 sunC = uSunColor, zen = uZenith, hor = uHorizon;
  float farK = smoothstep(6000.0, 40000.0, dist), night = uNight;
  if (farK > 0.0) {
    vec3 s2, z2, h2;
    float eL = dot(SUN, normalize(vRel - uCenterL));
    palette(eL, s2, z2, h2);
    sunC = mix(sunC, s2, farK); zen = mix(zen, z2, farK); hor = mix(hor, h2, farK);
    night = mix(night, smoothstep(0.06, -0.2, eL), farK);
  }
  vec4 n1 = texture(uWeather, W.xz / 230.0);
  vec4 n2 = texture(uWeather, W.xz / 41.0);

  // meadow: dark soil between blades close up, averaged blade colour further away
  vec3 avgGrass = mix(vec3(0.048, 0.118, 0.062), vec3(0.085, 0.152, 0.066), clamp(n1.b * 0.7 + n2.g * 0.5 - 0.15, 0.0, 1.0));
  avgGrass = mix(avgGrass, vec3(0.045, 0.12, 0.08), smoothstep(0.55, 0.9, n1.r) * 0.45);
  avgGrass *= mix(0.84, 1.07, texture(uWeather, W.xz / 47.0 + 0.61).b);
  // painterly meadow texture: damp blue-green hollows, sun-dried patches and light brush flecks
  float hollow = smoothstep(0.5, 0.78, texture(uWeather, W.xz / 64.0 + 0.23).r * 0.7 + n2.b * 0.3);
  avgGrass = mix(avgGrass, vec3(0.035, 0.085, 0.07), hollow * 0.55);
  float dry = smoothstep(0.62, 0.86, texture(uWeather, W.xz / 90.0 + 0.81).a);
  avgGrass = mix(avgGrass, vec3(0.115, 0.165, 0.07), dry * 0.45);
  vec2 wd = uWindDir, wp = vec2(-wd.y, wd.x);
  vec2 sx = vec2(dot(W.xz, wd), dot(W.xz, wp));
  float fl1 = texture(uWeather, sx * vec2(0.55, 1.6) / 3.0).a;
  float fl2 = texture(uWeather, sx * vec2(0.7, 1.9) / 1.3 + 0.5).a;
  float flecks = smoothstep(0.7, 0.93, fl1) * 0.6 + smoothstep(0.74, 0.95, fl2) * 0.5;
  float dark = smoothstep(0.62, 0.9, texture(uWeather, sx * vec2(0.6, 1.4) / 2.1 + 0.3).b);
  float fade = 1.0 - smoothstep(40.0 + 700.0 * uCine, 260.0 + 1500.0 * uCine, dist);   // the film resolves them much further out
  avgGrass *= 1.0 + (flecks * vec3(0.55, 0.6, 0.35) - dark * 0.22) * mix(0.35, 1.0, fade);
  if (uCine > 0.0) {
    // cinema detail: tussocks, and wildflowers dotted in drifts beyond the near flowers
    avgGrass *= 0.88 + 0.24 * texture(uWeather, W.xz / 6.0 + 0.17).r;
    float drift = smoothstep(0.58, 0.82, texture(uWeather, W.xz / 140.0 + 0.4).g) * smoothstep(60.0, 160.0, dist);
    float fd = smoothstep(0.8, 0.95, texture(uWeather, W.xz / 1.9 + 0.9).a) * drift;
    vec3 fc = mix(vec3(0.6, 0.58, 0.5), vec3(0.62, 0.5, 0.18), step(0.5, texture(uWeather, W.xz / 33.0).r));
    avgGrass = mix(avgGrass, fc * 0.5, fd * 0.5);
  }
  avgGrass *= 1.0 - 0.25 * uWet;
  // the same lush/short swathes as the blades: short turf reads lighter and warmer from afar
  float lush = meadowLush(W.xz);
  avgGrass *= mix(vec3(1.12, 1.08, 0.82), vec3(0.92, 0.98, 1.03), lush);
  // wide country: golden dry grassland, dark woodland greens and heather, so the planet is not one green.
  // It fades in with distance and leaves the home plateau as the prototype painted it
  vec4 bz = wx2(pPF, 21000.0, vec2(0.17, 0.43));
  vec3 biome = mix(vec3(1.0), vec3(1.3, 1.12, 0.62), smoothstep(0.56, 0.8, bz.r));
  biome = mix(biome, vec3(0.7, 0.88, 0.8), smoothstep(0.55, 0.78, bz.g));
  biome = mix(biome, vec3(1.1, 0.86, 0.95), smoothstep(0.62, 0.85, bz.b) * 0.7);
  avgGrass *= mix(vec3(1.0), biome, (0.15 + 0.85 * smoothstep(800.0, 6000.0, dist)) * (region ? 0.0 : 1.0));
  float gust = gustAt(W.xz) * waveShade() * (1.0 - smoothstep(1500.0, 6000.0, dist));
  avgGrass = mix(avgGrass, avgGrass * vec3(1.32, 1.28, 1.15), gust);
  vec3 under = mix(vec3(0.026, 0.058, 0.036), vec3(0.036, 0.072, 0.042), gust) * (1.0 + flecks * 0.5 - dark * 0.2);
  under = mix(under * vec3(1.55, 1.45, 1.1), under, lush);   // thin turf lets more lit ground through
  vec3 grass = mix(under, avgGrass, smoothstep(uNearR * 0.35, uNearR * 1.1, dist));
  grass = mix(grass, avgGrass * vec3(1.05, 0.97, 0.88), 1.0 - td.g);

  // cliff rock with horizontal strata
  float slope = 1.0 - tn.y;
  float rockK = smoothstep(0.30, 0.52, slope + (n2.r - 0.5) * 0.2);
  vec2 wN = abs(tn.xz) + 1e-3; wN /= wN.x + wN.y;
  float rx = texture(uWeather, vec2(W.z, W.y * 1.6) / 70.0).a, rz = texture(uWeather, vec2(W.x, W.y * 1.6) / 70.0).a;
  float blocks = rx * wN.x + rz * wN.y;
  float strata = texture(uWeather, vec2(W.y / 26.0, (W.x - W.z) / 1400.0)).g;
  float bands = texture(uWeather, vec2(W.y / 9.0, (W.x + W.z) / 2600.0)).r;
  vec3 rock = mix(vec3(0.11, 0.108, 0.105), vec3(0.27, 0.265, 0.26), clamp(blocks * 0.8 + strata * 0.4 - 0.1, 0.0, 1.0));
  rock *= 0.55 + 0.6 * smoothstep(0.2, 0.8, bands);
  rock *= mix(0.55, 1.0, smoothstep(SEA_TOP - 30.0, 10.0, W.y));
  if (uCine > 0.0 && rockK > 0.01) rock = cliffFace(rock, vec2(W.z, W.y)) * wN.x + cliffFace(rock, vec2(W.x, W.y)) * wN.y;
  vec3 alb = mix(grass, rock, rockK);
  // pale sand along the waterline, darkening to silt on the bed
  float beach = 1.0 - smoothstep(WATER + 1.2, WATER + 3.8, W.y);
  vec3 sand = vec3(0.32, 0.29, 0.21) * (0.85 + 0.3 * n2.a) * (1.0 - 0.3 * uWet);
  vec3 bed = mix(sand * 0.75, vec3(0.08, 0.1, 0.075), smoothstep(WATER - 1.0, WATER - 14.0, W.y));
  alb = mix(alb, W.y < WATER ? bed : sand, beach * (1.0 - 0.6 * rockK));

  // cumulus shadows average out with distance instead of aliasing into speckles
  float cs = mix(cloudShadowPF(pPF, W.y), 1.0 - 0.25 * (1.0 - night), smoothstep(8000.0, 30000.0, dist));
  float sh = td.r * cs * (region ? houseShadow(W, tn) : 1.0);
  float ndl = max(dot(N, SUN), 0.0);
  // light bounced up off the bright cloud sea onto walls and overhangs
  vec3 sunG = sunC * GROUND_SUN;
  vec3 bounce = (sunG * 0.25 + vec3(0.1) * (1.0 - night)) * clamp(0.55 - tn.y, 0.0, 1.0) * smoothstep(40.0, SEA_TOP - 10.0, W.y) * cover;
  vec3 ambUp = hor * 0.82 + zen * 0.42;
  vec3 ambDn = vec3(0.08, 0.13, 0.09) * (0.5 + 0.15 * sunC.g) * (1.0 - 0.85 * night);
  vec3 amb = mix(ambDn, ambUp, clamp(tn.y * 0.5 + 0.5, 0.0, 1.0)) + uFlash * vec3(0.85, 0.92, 1.15) + vec3(0.004, 0.007, 0.014) * night;
  // under the deck the sun never reaches the ground: soft grey daylight filtering through the clouds
  float shaded = deckShade(W.y) * cover;
  sunG *= 1.0 - 0.96 * shaded;
  bounce *= 1.0 - shaded;
  vec3 deckL = deckLight(hor, zen, sunC, night);
  amb = mix(amb, deckL, shaded);
  vec3 col = alb * (sunG * ndl * sh + amb * (0.86 + 0.14 * td.r) + bounce);
  // back-lit sheen of distant grass, and the lighter band of each passing gust
  float back = pow(max(dot(-V, SUN), 0.0), 4.0);
  col += avgGrass * vec3(1.0, 1.05, 0.72) * sunG * sh * (back * 0.35 + gust * 0.2) * (1.0 - rockK);

  float mu = max(dot(-V, SUN), 0.0);
  vec3 haze = hor * 0.95 + sunC * (0.035 * pow(mu, 5.0) + 0.05 * pow(mu, 32.0));
  col = mix(col, haze, hazeAmountAlt(dist, uCamAlt, W.y));
  // grey murk in the still air under the clouds, fading into the underside of the deck
  col = mix(col, deckL * 0.9, murkAmount(W.y, dist) * cover);
  col = mix(col, bg, mist);
  // towers standing in front of a distant highland cover it
  col = mix(col, bg, cloudFrontK(uBg, gl_FragCoord.xy, uRes, dist));
  // from high up the cloud pass hands over its opacity directly (alpha −2 … −3): blend softly
  vec4 so = shellOver(uBg, gl_FragCoord.xy, uRes);
  if (W.y < SEA_TOP + 15.0) col = col * (1.0 - so.a) + so.rgb;   // highlands above the sea stay on top
  gl_FragColor = vec4(col, 1.0);
}
`;

export function makeTerrainMaterial(terrainTex: THREE.Texture) {
  return new THREE.ShaderMaterial({
    vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS,
    uniforms: { ...shared, uTerrain: { value: terrainTex }, uBg: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uNearR: { value: 25 } },
  });
}
