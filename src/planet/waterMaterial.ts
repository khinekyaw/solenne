import * as THREE from 'three';
import { COMMON, PALETTE_GLSL } from '../render/glsl';
import { shared } from '../render/frame';

/* =========================================================================
   Water: Solenne's oceans, lakes and rivers, all at one sea level. The
   surface rides on the terrain chunks (camera-relative, same LOD). Swell
   and chop from the shared noise, sky reflection by Fresnel, a sun glint
   that vanishes under the cloud banks, clear shallows and lapping foam.
   ========================================================================= */
const WATER_VS = /* glsl */`
attribute vec3 aFlat;
attribute float aDepth;
varying vec3 vRel;
varying vec3 vFlat;
varying float vDepth;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vRel = wp.xyz; vFlat = aFlat; vDepth = aDepth;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const WATER_FS = /* glsl */`
#define SUN uSunDirL
${COMMON}
${PALETTE_GLSL}
uniform vec2 uWindDir;
uniform float uWindStr;
uniform sampler2D uBg;
uniform vec2 uRes;
varying vec3 vRel;
varying vec3 vFlat;
varying float vDepth;

// two swell trains rolling with the wind plus a fine chop, as one height field
float waveH(vec2 q, float t) {
  return texture(uWeather, (q + uWindDir * t * 1.3) / 23.0).b * 0.6
       + texture(uWeather, (q - uWindDir.yx * t * 0.8) / 8.5 + 0.31).g * 0.3
       + texture(uWeather, (q + vec2(t * 0.6, -t * 0.4)) / 3.1 + 0.67).r * 0.05;
}

void main() {
  float dist = length(vRel);
  vec3 V = -vRel / dist;
  vec3 up = normalize(vRel - uCenterL);
  vec3 pPF = uCamPF + uLtoPF * vRel;
  float cover = seaCovAt(normalize(pPF));
  float mist = seaMist(WATER, dist) * smoothstep(0.55, 0.88, cover);
  vec3 bg = sampleBg(uBg, gl_FragCoord.xy / uRes);
  if (mist > 0.997) { gl_FragColor = vec4(bg, 1.0); return; }

  vec3 sunC = uSunColor, zen = uZenith, hor = uHorizon;
  float farK = smoothstep(6000.0, 40000.0, dist), night = uNight;
  if (farK > 0.0) {
    vec3 s2, z2, h2;
    float eL = dot(SUN, up);
    palette(eL, s2, z2, h2);
    sunC = mix(sunC, s2, farK); zen = mix(zen, z2, farK); hor = mix(hor, h2, farK);
    night = mix(night, smoothstep(0.06, -0.2, eL), farK);
  }
  float deck = deckShade(WATER) * cover;   // under a cloud bank: still, grey, no sun
  vec3 deckL = deckLight(hor, zen, sunC, night);

  // surface normal from the wave field, calmer far away and under the clouds
  float t = uTime;
  vec2 q = vFlat.xz, e = vec2(0.5, 0.0);
  vec2 g = vec2(waveH(q + e.xy, t) - waveH(q - e.xy, t), waveH(q + e.yx, t) - waveH(q - e.yx, t)) / (2.0 * e.x);
  float amp = (0.18 + 0.55 * uWindStr) * (1.0 - smoothstep(120.0, 2000.0, dist)) * (1.0 - 0.7 * deck);
  vec3 east = normalize(cross(up, vec3(0.0, 0.0, 1.0))), north = cross(east, up);
  vec3 N = normalize(up - (east * g.x + north * g.y) * amp * 3.0);

  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  float ry = dot(R, up);
  vec3 sky = mix(hor, zen, pow(clamp(ry, 0.0, 1.0), 0.42));
  sky = mix(sky, deckL * 1.3, deck);
  float mu = max(dot(R, SUN), 0.0);
  vec3 glint = sunC * (pow(mu, 280.0) * 5.0 + pow(mu, 24.0) * 0.06) * (1.0 - deck) * smoothstep(-0.02, 0.05, dot(SUN, up));

  // the water body: clear and green in the shallows, deep teal further out
  vec3 body = mix(vec3(0.05, 0.14, 0.12), vec3(0.008, 0.035, 0.05), smoothstep(0.5, 22.0, vDepth));
  vec3 lit = mix(skyAmbientY(1.0) * 1.1 + sunC * GROUND_SUN * 0.3 * max(dot(up, SUN), 0.0), deckL * 1.2, deck);
  vec3 col = mix(body * lit * 1.6, sky, fres) + glint;

  // lapping foam along the shore
  float shore = 1.0 - smoothstep(0.05, 1.1, vDepth);
  float fn = texture(uWeather, q / 3.3 + vec2(t * 0.03, -t * 0.02)).a;
  float lap = 0.5 + 0.5 * sin(vDepth * 7.0 - t * 1.6 + fn * 4.0);
  float foam = smoothstep(0.55, 0.85, fn * 0.6 + lap * 0.5 * shore + shore * 0.25) * shore * (1.0 - smoothstep(400.0, 1500.0, dist));
  col = mix(col, lit * 1.1, foam);

  float alpha = max(mix(0.28, 0.97, smoothstep(0.0, 5.0, vDepth)), fres * 0.9);
  alpha = max(alpha, foam * 0.9);
  float mu2 = max(dot(-V, SUN), 0.0);
  vec3 haze = hor * 0.95 + sunC * (0.035 * pow(mu2, 5.0) + 0.05 * pow(mu2, 32.0));
  col = mix(col, haze, hazeAmountAlt(dist, uCamAlt, WATER) * (1.0 - deck));
  col = mix(col, deckL * 0.9, murkAmount(WATER, dist) * cover);
  col = mix(col, bg, mist); alpha = max(alpha, mist);
  // the same hand-overs from the cloud pass as the ground: towers in front, shells from orbit
  float kf = cloudFrontK(uBg, gl_FragCoord.xy, uRes, dist);
  col = mix(col, bg, kf); alpha = max(alpha, kf);
  vec4 so = shellOver(uBg, gl_FragCoord.xy, uRes);
  col = col * (1.0 - so.a) + so.rgb; alpha = max(alpha, so.a);
  gl_FragColor = vec4(col, alpha);
}
`;

export function makeWaterMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: WATER_VS, fragmentShader: WATER_FS, transparent: true, depthWrite: false,
    uniforms: { ...shared, uBg: { value: null }, uRes: { value: new THREE.Vector2(1, 1) } },
  });
}
