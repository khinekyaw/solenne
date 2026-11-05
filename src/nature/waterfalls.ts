import * as THREE from 'three';
import { G0 } from '../config';
import { COMMON } from '../render/glsl';
import { shared, frame, pfMatrix } from '../render/frame';
import { groundH } from '../planet/heights';
import { regionToPF } from '../planet/solenne';
import { stoneKit, rockMaterial } from './boulders';

/* =========================================================================
   Waterfalls off the home plateau. The meadow drinks the fog of the cloud
   sea; the water gathers in springs that break out of the cliff a few
   metres under the rim and fall through the clouds to the talus below.
   Each fall is a ribbon that leaps clear on a ballistic arc and otherwise
   follows the face, built once from the region heightfield.
   The look: at the lip a short ribbon, the water still glassy where it curls
   over with a line of light; then it breaks up, as tall falls do. Streamers
   of water leave the lip and fall under gravity with a little air drag, and
   shed spray: light droplets the wind carries almost at its own speed. Where
   the wind blows into the cliff it is turned upward and lifts the spray, as
   on windy sea cliffs. The spray puffs grow as they drift, shaded like small
   clouds (lit on the sun side, glowing when backlit), and hold a rainbow when
   they stand 42° from the point opposite the sun. Every particle's flight is
   a closed form of time (gravity plus linear drag toward the wind), so the
   GPU draws it with no simulation on the CPU.
   ========================================================================= */
const FALL_VS = /* glsl */`
attribute vec2 aUv;
attribute float aAlt;
attribute float aLayer;
varying vec3 vRel;
varying vec2 vUv;
varying float vAlt;
varying float vLayer;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vRel = wp.xyz; vUv = aUv; vAlt = aAlt; vLayer = aLayer;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const FALL_FS = /* glsl */`
#define SUN uSunDirL
${COMMON}
uniform float uLen;
uniform float uSeed;
varying vec3 vRel;
varying vec2 vUv;
varying float vAlt;
varying float vLayer;
void main() {
  float dist = length(vRel);
  vec3 pPF = uCamPF + uLtoPF * vRel;
  float cover = seaCovAt(normalize(pPF));
  float mist = seaMist(vAlt, dist) * smoothstep(0.55, 0.88, cover);
  if (mist > 0.995) discard;
  float t = uTime, v = vUv.y, k = clamp(v / max(uLen, 1.0), 0.0, 1.0), back = 1.0 - vLayer;
  // the column wanders a little and frays as it falls: the air strips its edges into strands
  float x = vUv.x + (texture(uWeather, vec2(v / 70.0 - t * 0.12, uSeed)).b - 0.5) * (0.08 + 0.3 * k);
  float ew = mix(0.07, 0.3, k), inner = min(x, 1.0 - x);
  float edge = smoothstep(0.0, ew, x) * smoothstep(1.0, 1.0 - ew, x);
  float strands = texture(uWeather, vec2(x * 6.0 + uSeed * 3.0, v / 14.0 - t * 1.1)).r;
  edge *= mix(1.0, smoothstep(0.34, 0.6, strands), (1.0 - smoothstep(0.0, 2.2 * ew, inner)) * smoothstep(0.1, 0.9, k));
  // streaks sliding down at two speeds, flattened into two tones (the painted look); all spray lower down
  // (broad enough to read from across the cloud sea, finer ones on top for close up)
  float s1 = texture(uWeather, vec2(x * 1.1 + uSeed, v / 46.0 - t * 0.7)).r;
  float s2 = texture(uWeather, vec2(x * 2.6 + uSeed * 2.0, v / 18.0 - t * 1.5)).g;
  float s3 = texture(uWeather, vec2(x * 6.0 + uSeed * 3.0, v / 7.0 - t * 2.6)).b;
  float s = s1 * 0.55 + s2 * 0.35 + s3 * 0.2;
  float foam = max(smoothstep(0.46, 0.5, s) * 0.5 + smoothstep(0.6, 0.63, s) * 0.5, smoothstep(0.45, 1.0, k) * 0.8);
  // the lip: still glassy where it curls over the edge, with a line of light along it
  float lip = 1.0 - smoothstep(2.0, 12.0, v), hl = exp(-pow((v - 1.2) / 0.7, 2.0)) * vLayer;
  foam *= 1.0 - 0.8 * lip;
  vec3 alb = mix(vec3(0.36, 0.56, 0.68), vec3(0.97, 0.99, 1.0), foam * (1.0 - 0.6 * back));
  // a round column: lit across its middle, its edges in blue shade
  float round = sqrt(max(1.0 - pow(2.0 * x - 1.0, 2.0), 0.0));
  alb *= mix(vec3(0.62, 0.7, 0.8), vec3(1.05), round);
  float deck = deckShade(vAlt) * cover;
  vec3 V = -vRel / dist;
  // spray glows when the sun is behind it
  float fwd = pow(max(dot(-V, SUN), 0.0), 6.0);
  vec3 lit = mix(uSunColor * GROUND_SUN * (0.6 + 0.9 * fwd * foam) + skyAmbientY(1.0) * 1.2, deckLight(uHorizon, uZenith, uSunColor, uNight) * 1.4, deck);
  vec3 col = alb * lit + uSunColor * GROUND_SUN * hl * 0.9 * (1.0 - deck);
  float a = edge * mix(mix(0.5, 0.93, foam), 0.3, back);
  a *= smoothstep(0.0, 2.0, v) * (1.0 - smoothstep(9.0, 24.0, v));   // the streamers take over below
  col = mix(col, hazeColor(-V), hazeAmountAlt(dist, uCamAlt, vAlt) * (1.0 - deck));
  col = mix(col, deckLight(uHorizon, uZenith, uSunColor, uNight) * 0.9, murkAmount(vAlt, dist) * cover);
  a *= 1.0 - mist;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}
`;
/* streamers and spray: one camera-facing quad per particle, its flight a closed form of time */
const SPRAY_VS = /* glsl */`
attribute vec2 aCorner;   // the quad's corner (±1, ±1)
attribute vec4 aSeed;     // three random numbers, and the kind (0 a streamer of water, 1 a puff of spray)
uniform float uTime;
uniform vec3 uOut;        // the face's outward direction, along the lip, and up (planet-fixed)
uniform vec3 uTan;
uniform vec3 uUp;
uniform vec3 uWind;       // the wind at the fall (planet-fixed, m/s), the cliff's updraft included
uniform float uLipW;      // half the lip's width (m)
uniform float uGust;
uniform vec3 uPath[80];   // the fall's line down the face (every 4 m of drop, from the lip; it leaps clear of bulges)
uniform float uPathN;
varying vec2 vC;
varying float vA;
varying float vKind;
varying vec3 vRel;
vec3 pathAt(float drop) {
  float f = clamp(drop / 4.0, 0.0, uPathN - 1.001);
  int i = int(f);
  return mix(uPath[i], uPath[i + 1], f - float(i));
}
// linear drag toward a terminal velocity W (the wind, plus gravity's share for the drag): a closed form
void fly(vec3 x0, vec3 v0, vec3 W, float k, float t, out vec3 x, out vec3 v) {
  float e = exp(-k * t);
  v = W + (v0 - W) * e;
  x = x0 + W * t + (v0 - W) * (1.0 - e) / k;
}
void main() {
  vec3 g = -uUp * 9.81;
  float r1 = aSeed.x, r2 = aSeed.y, r3 = aSeed.z, kind = aSeed.w;
  // a streamer leaves the lip somewhere along it, a little faster or slower
  vec3 x0 = uTan * (r1 * 2.0 - 1.0) * uLipW + uOut * 0.4;
  vec3 v0 = uOut * (2.0 + 1.6 * r2) + uTan * (r3 - 0.5) * 0.8 + uUp * 0.3;
  float ks = 0.14 + 0.1 * r3;
  vec3 Ws = uWind * 0.3 + g / ks;   // heavy water: the wind only leans on it
  vec3 pos, vel;
  float a, w, l;
  // a streamer: its drop and sideways drift from the flight, its distance from the face from the fall's line (so it
  // never falls into a bulge of the cliff); it spreads as it falls
  float side = (r1 * 2.0 - 1.0) * uLipW;
  if (kind < 0.5) {
    float L = 2.6 + 2.4 * r2, age = mod(uTime + r1 * 17.3 + r3 * 5.1, L);
    fly(x0, v0, Ws, ks, age, pos, vel);
    float drop = max(-dot(pos, uUp), 0.0);
    pos = pathAt(drop) + uTan * (dot(pos, uTan) + side * 0.04 * drop) + uOut * (r2 - 0.5) * 0.8;
    a = smoothstep(0.0, 0.2, age) * (1.0 - smoothstep(L * 0.5, L, age)) * 0.3;   // it frays as it falls
    w = 0.18 + 0.22 * age;
    l = 1.6 + length(vel) * 0.11;   // stretched along its motion
  } else {
    // spray stripped off a streamer after tau seconds: light, so the wind and the updraft carry it
    float tau = 0.3 + 3.0 * r2, L = 4.5 + 5.0 * r3, age = mod(uTime * (0.9 + 0.2 * r1) + r1 * 31.7, tau + L);
    vec3 xs, vs;
    fly(x0, v0, Ws, ks, min(age, tau), xs, vs);
    float drop = max(-dot(xs, uUp), 0.0);
    xs = pathAt(drop) + uTan * (dot(xs, uTan) + side * 0.04 * drop) + uOut * (0.5 + r3);
    float am = max(age - tau, 0.0), km = 2.5 + 3.0 * r1;
    fly(xs, vs * 0.5, uWind * (0.5 + 0.35 * uGust) + g / km * 0.25, km, am, pos, vel);
    // each puff wanders as it goes
    pos += vec3(sin(am * 0.7 + r1 * 20.0), sin(am * 0.5 + r2 * 20.0), sin(am * 0.6 + r3 * 20.0)) * am * 0.5;
    a = step(tau, age) * smoothstep(0.0, 1.0, am) * pow(max(1.0 - am / L, 0.0), 1.6) * 0.075;
    w = 1.0 + 1.1 * am + 0.8 * r3;
    l = w * (1.0 + 0.12 * length(vel));   // drawn out along the wind
  }
  vec4 c = modelMatrix * vec4(pos, 1.0);
  vec3 V = normalize(c.xyz);   // (the camera sits at the local frame's origin)
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  {   // streamers and puffs are drawn along their motion as seen from here
    vec3 vw = mat3(modelMatrix) * vel, along = vw - V * dot(vw, V);
    float n = length(along);
    if (n > 1e-4) { up = along / n; right = normalize(cross(V, up)); }
  }
  vec3 wp = c.xyz + right * aCorner.x * w + up * aCorner.y * l;
  vC = aCorner; vA = a; vKind = kind; vRel = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const SPRAY_FS = /* glsl */`
#define SUN uSunDirL
${COMMON}
varying vec2 vC;
varying float vA;
varying float vKind;
varying vec3 vRel;
void main() {
  if (vA < 0.004) discard;
  float r = length(vC);
  float dist = length(vRel), h = length(vRel - uCenterL) - PLANET_R;
  vec3 pPF = uCamPF + uLtoPF * vRel;
  float cover = seaCovAt(normalize(pPF)), deck = deckShade(h) * cover;
  vec3 V = -vRel / dist;
  vec3 deckL = deckLight(uHorizon, uZenith, uSunColor, uNight);
  float back = pow(max(dot(-V, SUN), 0.0), 5.0);   // light through the spray when the sun is behind it
  float a;
  vec3 col;
  if (vKind < 0.5) {
    // a streamer: a soft capsule of white water
    a = (1.0 - vC.x * vC.x) * smoothstep(1.0, 0.35, abs(vC.y));
    col = vec3(0.93, 0.97, 1.0) * mix(uSunColor * GROUND_SUN * (0.75 + 0.8 * back) + skyAmbientY(1.0) * 1.25, deckL * 1.4, deck);
  } else {
    if (r > 1.0) discard;
    // a puff, shaded like a small cloud: a round normal, lit on the sun side, glowing when backlit
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 n = normalize(right * vC.x + up * vC.y + V * sqrt(max(1.0 - r * r, 0.0)));
    float ndl = max(dot(n, SUN), 0.0) * 0.65 + 0.35;
    float wisp = texture(uWeather, vC * 0.3 + vRel.xz * 0.004 + uTime * 0.008).a;
    a = pow(max(1.0 - r * r, 0.0), 1.6) * (0.6 + 0.8 * wisp);
    col = vec3(0.95, 0.97, 1.0) * mix(uSunColor * GROUND_SUN * (ndl * 0.9 + 0.9 * back) + skyAmbientY(n.y) * 1.25, deckL * 1.4, deck);
    // a rainbow where the spray stands 42° from the point opposite the sun: red outside, violet inside
    float th = acos(clamp(dot(V, SUN), -1.0, 1.0)), hue = clamp((th - 0.711) / 0.032, 0.0, 1.0);
    float bow = exp(-pow((th - 0.727) / 0.02, 2.0)) * smoothstep(0.0, 0.12, SUN.y) * (1.0 - deck);
    col += clamp(abs(fract(0.78 * (1.0 - hue) + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0) * bow * uSunColor * GROUND_SUN;
  }
  col = mix(col, hazeColor(-V), hazeAmountAlt(dist, uCamAlt, h) * (1.0 - deck));
  col = mix(col, deckL * 0.9, murkAmount(h, dist) * cover);
  a *= vA * (1.0 - seaMist(h, dist) * smoothstep(0.55, 0.88, cover));
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}
`;

// where springs break out: a direction (degrees, flat coords) cast from a point inside the plateau to the first rim;
// the last is the face below the cottage that the showcase's island shot looks at
const SITES: [number, number, number][] = [[-14, 0, 0], [142, 0, 0], [214, 0, 0], [-80, 70, -397]];
const CRACK = 4.5;   // how far under the rim the water breaks out of the face (m)

/* the crack itself: a jagged fissure of dark wet rock laid on the face, ringed with moss */
const CRACK_VS = /* glsl */`
attribute vec2 aUv;
varying vec2 vUv;
varying vec3 vRel;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vRel = wp.xyz; vUv = aUv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const CRACK_FS = /* glsl */`
#define SUN uSunDirL
${COMMON}
uniform vec3 uOutL;   // the face's outward direction (local frame)
uniform float uSeed;
varying vec2 vUv;
varying vec3 vRel;
void main() {
  float n = texture(uWeather, vUv * vec2(0.35, 0.12) + uSeed).a, n2 = texture(uWeather, vUv * vec2(1.3, 0.5) + uSeed * 2.0).b;
  // a lens-shaped split, jagged along its edges, widest just above the outlet
  float w = max(1.0 - pow(vUv.y * 0.9 - 0.1, 2.0), 0.0) * (0.45 + 0.55 * n) * 0.5;
  float d = abs(vUv.x + (n2 - 0.5) * 0.25) / max(w, 0.03);
  float split = 1.0 - smoothstep(0.75, 1.05, d);
  float moss = (1.0 - smoothstep(1.2, 2.6 + 0.8 * n2, d)) * smoothstep(0.3, 0.6, n * 0.6 + n2 * 0.6);
  float dist = length(vRel), h = length(vRel - uCenterL) - PLANET_R;
  vec3 V = -vRel / dist, up = normalize(vRel - uCenterL), N = normalize(uOutL + up * 0.25);
  vec3 lit = uSunColor * GROUND_SUN * max(dot(N, SUN), 0.0) + skyAmbientY(0.3);
  vec3 col = mix(mix(vec3(0.08, 0.15, 0.05), vec3(0.15, 0.21, 0.08), n2) * lit, vec3(0.025, 0.03, 0.03) * (lit + 0.2), split);
  col += uSunColor * GROUND_SUN * pow(max(dot(reflect(-V, N), SUN), 0.0), 30.0) * 0.25 * split;   // it is wet
  col = mix(col, hazeColor(-V), hazeAmountAlt(dist, uCamAlt, h));
  float a = max(split, moss * 0.9);
  if (a < 0.02) discard;
  gl_FragColor = vec4(col, a);
}
`;

type Fall = {
  meshes: THREE.Mesh[]; anchor: THREE.Vector3; path: THREE.Vector3[];
  spray: { [k: string]: THREE.IUniform }; lip: [number, number]; out: [number, number];
};
const STREAMERS = 560, PUFFS = 420;
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

export class Waterfalls {
  falls: Fall[] = [];
  meshes: THREE.Mesh[] = [];
  private mat: THREE.ShaderMaterial;
  private sprayGeo: THREE.InstancedBufferGeometry;
  private rock!: THREE.ShaderMaterial;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: FALL_VS, fragmentShader: FALL_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { ...shared, uLen: { value: 300 }, uSeed: { value: 0 } },
    });
    // one quad per particle; the streamers first, then the puffs (each fall draws the same set)
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Array(12).fill(0), 3));
    g.setAttribute('aCorner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds: number[] = [], R = (n: number) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
    for (let k = 0; k < STREAMERS + PUFFS; k++) seeds.push(R(k * 3 + 1), R(k * 3 + 2), R(k * 3 + 3), k < STREAMERS ? 0 : 1);
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 4));
    g.instanceCount = STREAMERS + PUFFS;
    this.sprayGeo = g;
    this.rock = rockMaterial();
    SITES.forEach(([deg, ox, oz], i) => { const f = this.build(deg * Math.PI / 180, ox, oz, i); if (f) { this.falls.push(f); this.meshes.push(...f.meshes); } });
  }

  private build(ang: number, ox: number, oz: number, i: number): Fall | null {
    const dx = Math.cos(ang), dz = Math.sin(ang), at = (r: number) => groundH(ox + dx * r, oz + dz * r);
    // the rim: where the ground first falls away steeply (a gentle slope toward the edge is still meadow)
    let rim = 0;
    for (let r = ox || oz ? 5 : 60; r < 680; r += 0.5) if (at(r + 2) < at(r) - 3) { rim = r; break; }
    if (!rim) return null;
    // the water breaks out of a crack in the face a few metres under the rim and leaps clear
    const top = at(rim) - CRACK, v0 = 3.4;
    let face = rim;
    while (face < rim + 60 && at(face) > top) face += 0.25;
    const pts: { r: number; y: number }[] = [];
    for (let y = top, k = 0; k < 140; k++, y -= 4) {
      // ballistic leap from the face, or hugging it where it bulges out further
      const tFall = Math.sqrt(2 * (top - y) / G0), rBall = face + 0.2 + v0 * tFall;
      let rFace = rim;
      while (rFace < rim + 600 && at(rFace) > y - 1.2) rFace += 0.5;
      const r = Math.max(rBall, rFace + 1.2);
      pts.push({ r, y });
      if (at(r) > y - 2.5) break;   // it has reached the talus
    }
    if (pts.length < 4) return null;
    // the lip: two sheets, a wider, translucent one behind (toward the cliff) and the foam in front
    const P: number[] = [], UV: number[] = [], ALT: number[] = [], LAY: number[] = [], idx: number[] = [];
    const anchor = regionToPF(ox + dx * pts[0].r, pts[0].y, oz + dz * pts[0].r), tx = -dz, tz = dx, path: THREE.Vector3[] = [];
    let v = 0, prev: THREE.Vector3 | null = null;
    const vs: number[] = [];
    pts.forEach(({ r, y }) => { const c = regionToPF(ox + dx * r, y, oz + dz * r); if (prev) v += c.distanceTo(prev); prev = c; path.push(c); vs.push(v); });
    for (const layer of [0, 1]) {
      const base = P.length / 3, back = layer === 0 ? 0.9 : 0, wide = layer === 0 ? 1.18 : 1;
      pts.forEach(({ r, y }, k) => {
        const w = (0.8 + 0.05 * vs[k]) * wide;   // a narrow jet from the crack, flaring as it falls
        for (const s of [-1, 1]) {
          const p = regionToPF(ox + dx * (r - back) + tx * w * s, y, oz + dz * (r - back) + tz * w * s).sub(anchor);
          P.push(p.x, p.y, p.z); UV.push(s < 0 ? 0 : 1, vs[k]); ALT.push(y); LAY.push(layer);
        }
        if (k) { const a = base + (k - 1) * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
      });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(UV, 2));
    g.setAttribute('aAlt', new THREE.Float32BufferAttribute(ALT, 1));
    g.setAttribute('aLayer', new THREE.Float32BufferAttribute(LAY, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const mat = this.mat.clone();
    mat.uniforms = { ...this.mat.uniforms, uLen: { value: v }, uSeed: { value: i * 0.37 } };
    const body = new THREE.Mesh(g, mat);
    body.matrixAutoUpdate = false; body.frustumCulled = false; body.renderOrder = 2;
    // the streamers and the spray, in the face's own directions (planet-fixed)
    const lx = ox + dx * pts[0].r, lz = oz + dz * pts[0].r, ly = pts[0].y;
    const dir = (fx: number, fz: number) => regionToPF(lx + fx, ly, lz + fz, new THREE.Vector3()).sub(regionToPF(lx, ly, lz, tmpA)).normalize();
    const spray = {
      ...shared, uOut: { value: dir(dx, dz) }, uTan: { value: dir(tx, tz) }, uUp: { value: anchor.clone().normalize() },
      uWind: { value: new THREE.Vector3() }, uLipW: { value: 0.8 }, uGust: { value: 0.5 },
      uPath: { value: Array.from({ length: 80 }, (_, k) => path[Math.min(k, path.length - 1)].clone().sub(anchor)) }, uPathN: { value: Math.min(path.length, 80) },
    };
    const sm = new THREE.Mesh(this.sprayGeo, new THREE.ShaderMaterial({ vertexShader: SPRAY_VS, fragmentShader: SPRAY_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: spray }));
    sm.matrixAutoUpdate = false; sm.frustumCulled = false; sm.renderOrder = 3;
    return { meshes: [body, sm, ...this.crack(anchor, ox, oz, dx, dz, face, top, at(rim), rim, i)], anchor, path, spray, lip: [lx, lz], out: [dx, dz] };
  }

  /* the crack the water breaks out of: a dark wet fissure on the face ringed with moss, and a couple of mossy
     boulders on the rim above */
  private crack(anchor: THREE.Vector3, ox: number, oz: number, dx: number, dz: number, face: number, y: number, rimH: number, rim: number, i: number) {
    const tx = -dz, tz = dx;
    const at = (r: number, side: number, h: number) => regionToPF(ox + dx * r + tx * side, h, oz + dz * r + tz * side);
    // the fissure: a quad laid a hand's breadth in front of the face, 2.6 m wide, 5 m tall, the outlet near its foot
    const P: number[] = [], UV: number[] = [];
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = at(face + 0.12, u * 1.7, y + 0.9 + v * 2.8).sub(anchor);
      P.push(p.x, p.y, p.z); UV.push(u, v);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(UV, 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const outPF = at(face + 1, 0, y).sub(at(face, 0, y)).normalize();
    const crackMat = new THREE.ShaderMaterial({ vertexShader: CRACK_VS, fragmentShader: CRACK_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { ...shared, uOutL: { value: new THREE.Vector3() }, uSeed: { value: i * 0.31 } } });
    const fissure = new THREE.Mesh(g, crackMat);
    fissure.onBeforeRender = () => { (crackMat.uniforms.uOutL.value as THREE.Vector3).copy(outPF).applyMatrix3(frame.PFtoL); };
    fissure.matrixAutoUpdate = false; fissure.frustumCulled = false; fissure.renderOrder = 1;
    const kit = stoneKit(anchor, i * 3 + 1);
    for (const s of [-1, 1]) kit.add(at(rim - 1.5 - 1.5 * kit.rnd(), s * (2.2 + 1.5 * kit.rnd()), rimH - 0.3), 0.8 + 0.6 * kit.rnd(), 0.6, 0.45);
    return [fissure, kit.mesh(this.rock)];
  }

  update(_bg: THREE.Texture, _W: number, _H: number) {
    const t = shared.uTime.value, wd = shared.uWindDir.value, ws = shared.uWindStr.value;
    for (const [i, f] of this.falls.entries()) {
      const d = f.anchor.distanceTo(frame.camPF), near = d < 15000;
      for (const m of f.meshes) m.visible = near;
      f.meshes[1].visible = d < 6000;
      if (!near) continue;
      for (const m of f.meshes) { pfMatrix(f.anchor, m.matrix); m.matrixWorldNeedsUpdate = true; }
      // the wind at the lip (m/s, gusting); blowing into the cliff it is turned upward and lifts the spray
      const gust = 0.5 + 0.5 * Math.sin(t * 0.37 + i * 1.7) * Math.sin(t * 0.23 + i);
      const speed = (2 + 13 * ws) * (0.7 + 0.6 * gust), into = Math.max(0, -(wd.x * f.out[0] + wd.y * f.out[1]));
      const w = f.spray.uWind.value as THREE.Vector3;
      w.copy(regionToPF(f.lip[0] + wd.x, 0, f.lip[1] + wd.y, tmpA)).sub(regionToPF(f.lip[0], 0, f.lip[1], tmpB)).normalize().multiplyScalar(speed * (1 - 0.5 * into))
        .addScaledVector(f.spray.uUp.value as THREE.Vector3, speed * (0.15 + 0.8 * into));
      f.spray.uGust.value = gust;
    }
  }
  /** 0 … 1: how close the camera is to falling water (for the sound) */
  proximity(cam: THREE.Vector3) {
    let d = 1e9;
    for (const f of this.falls) for (let k = 0; k < f.path.length; k += 3) d = Math.min(d, f.path[k].distanceTo(cam));
    return 1 - Math.min(1, Math.max(0, (d - 25) / 420));
  }
}
