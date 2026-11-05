import * as THREE from 'three';
import { PLANET_R, SEA_TOP, SEA_BASE } from '../config';
import { clamp, mulberry32 } from '../core/math';
import { COMMON } from '../render/glsl';
import { shared, frame, pfMatrix } from '../render/frame';
import { FACES, SPAWN_FACE, faceOf, flatToPF } from '../planet/solenne';
import { planetHeight } from '../planet/heights';
import { buildKits, RANDOM_KITS, type Kit } from './ruinKits';

/* =========================================================================
   Ruins scattered over Solenne, most of them in the lowland under the
   cloud sea, a few on the highlands. Sites come from a hash grid on each
   cube face (900 m cells), so they are the same every visit; nothing is
   placed on the home plateau. Drawn instanced, camera-relative.
   ========================================================================= */
const RUIN_VS = /* glsl */`
attribute vec3 aColor;
attribute vec4 aInfo;
attribute vec3 aPivot;
uniform float uTime;
varying vec3 vRel;
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vLN;
varying vec3 vColor;
varying vec4 vInfo;
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
  m = m * instanceMatrix;
  #endif
  vec3 pos = position, nrm = normal;
  if (aInfo.z > 0.0) {
    // a floating piece of the old world: it rocks a little about its centre and bobs, as if gravity forgot it
    float ph = aInfo.z * 6.2831853, a = 0.07 * sin(uTime * 0.17 + ph), c = cos(a), s = sin(a);
    vec3 d = pos - aPivot;
    d.xy = mat2(c, s, -s, c) * d.xy; nrm.xy = mat2(c, s, -s, c) * nrm.xy;
    pos = aPivot + d + vec3(0.12 * sin(uTime * 0.23 + ph), 0.4 * sin(uTime * 0.29 + ph * 1.7), 0.15 * sin(uTime * 0.19 + ph * 0.6));
  }
  vec4 wp = m * vec4(pos, 1.0);
  vRel = wp.xyz; vN = normalize(mat3(m) * nrm);
  vLocal = pos; vLN = nrm; vColor = aColor; vInfo = aInfo;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const RUIN_FS = /* glsl */`
#define SUN uSunDirL
${COMMON}
uniform sampler2D uBg;
uniform vec2 uRes;
varying vec3 vRel;
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vLN;
varying vec3 vColor;
varying vec4 vInfo;
void main() {
  vec3 N = normalize(vN);
  float dist = length(vRel);
  vec3 V = -vRel / dist;
  vec3 up = normalize(vRel - uCenterL);
  float h = length(vRel - uCenterL) - PLANET_R;
  vec3 pPF = uCamPF + uLtoPF * vRel;
  float cover = seaCovAt(normalize(pPF));
  float mist = seaMist(h, dist) * cover;
  vec3 bg = sampleBg(uBg, gl_FragCoord.xy / uRes);
  if (mist > 0.997) { gl_FragColor = vec4(bg, 1.0); return; }

  // weathered stone: per-block tint, pitted faces, darker damp foot
  vec3 an = abs(normalize(vLN));
  vec2 fp = (an.x > an.y && an.x > an.z) ? vLocal.zy : (an.y > an.z ? vLocal.xz : vLocal.xy);
  vec3 alb = vColor * (0.86 + 0.24 * vInfo.y);
  float pit = texture(uWeather, fp * 0.45 + vInfo.y).a, grain = texture(uWeather, fp * 1.7 + 0.3).b;
  alb *= 0.82 + 0.22 * pit + 0.08 * (grain - 0.5);
  alb *= mix(0.72, 1.0, smoothstep(-0.2, 1.4, vLocal.y));
  float deck = deckShade(h) * cover;
  // moss creeps over the tops and up from the ground, thicker in the damp under the clouds
  float mossN = texture(uWeather, fp * 0.21 + 0.4).g * 0.7 + texture(uWeather, fp * 0.9).a * 0.3;
  float streak = texture(uWeather, vec2(fp.x * 0.35, fp.y * 0.08) + vInfo.y).r;   // damp streaks running down the faces
  alb *= 0.8 + 0.2 * smoothstep(0.3, 0.7, streak);
  float moss = smoothstep(0.5, 0.85, dot(N, up) * 0.55 + mossN * 0.55 + streak * 0.25 + deck * 0.3 + (1.0 - smoothstep(0.0, 1.8, vLocal.y)) * 0.3);
  vec3 mossC = mix(vec3(0.07, 0.13, 0.055), vec3(0.12, 0.17, 0.07), mossN);
  float kind = vInfo.x, spec = 0.0;
  if (kind < 1.5) alb = mix(alb, mossC, moss * 0.85);
  else if (kind < 2.5) alb = vColor * (0.8 + 0.4 * vInfo.y);
  else if (kind < 3.5) {
    // the old ceramic: smooth and pale, flaked off in places down to dark stone, moss only low down
    alb = vColor * (0.82 + 0.1 * grain + 0.05 * vInfo.y);
    float flake = smoothstep(0.66, 0.7, texture(uWeather, fp * 0.016 + vInfo.y * 0.3).a * 0.75 + texture(uWeather, fp * 0.07).a * 0.25 + 0.3 * (1.0 - smoothstep(0.0, 12.0, vLocal.y)) - 0.06);
    alb = mix(alb, vec3(0.28, 0.29, 0.3) * (0.85 + 0.3 * pit), flake);
    alb *= 0.9 + 0.1 * smoothstep(0.3, 0.7, streak);
    alb = mix(alb, mossC, moss * 0.8 * (1.0 - smoothstep(2.0, 7.0, vLocal.y)));
    spec = 0.12 * (1.0 - flake);
  } else if (kind < 4.5) {
    // brass, gone dull and a little green
    alb = mix(vColor, vec3(0.3, 0.46, 0.38), smoothstep(0.6, 0.9, texture(uWeather, fp * 0.08 + 0.2).a) * 0.4);
    spec = 0.35;
  }

  float ndl = max(dot(N, SUN), 0.0);
  vec3 sun = uSunColor * GROUND_SUN * ndl * cloudShadowPF(pPF, h) * (1.0 - 0.96 * deck);
  vec3 deckL = deckLight(uHorizon, uZenith, uSunColor, uNight);
  vec3 amb = mix(skyAmbientY(dot(N, up)), deckL * (0.8 + 0.4 * (dot(N, up) * 0.5 + 0.5)), deck);
  float ao = mix(0.62, 1.0, smoothstep(-0.3, 1.6, vLocal.y));
  vec3 col = alb * (sun + amb * ao);
  // a soft sheen on the glaze and the metal, from the sky and the sun
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  col += spec * (uSunColor * GROUND_SUN * (1.0 - 0.96 * deck) * pow(max(dot(reflect(-V, N), SUN), 0.0), 24.0) + amb * fres * 0.6);
  // the Gate's seam: it breathes slowly, and its light falls on the band, the brass and the ivy close by
  float breath = 0.82 + 0.18 * sin(uTime * 0.55) + 0.06 * sin(uTime * 1.7 + 1.0);
  vec3 seam = vec3(0.56, 0.94, 0.85);
  col += alb * seam * vInfo.w * 0.5 * breath;
  if (kind > 4.5) col = seam * (1.25 + 0.55 * smoothstep(0.75, 1.0, breath)) * breath * (0.85 + 0.15 * grain);
  col = mix(col, hazeColor(-V), hazeAmountAlt(dist, uCamAlt, h) * (1.0 - deck));
  col = mix(col, deckL * 0.9, murkAmount(h, dist) * cover * (kind > 4.5 ? 0.6 : 1.0));
  col = mix(col, bg, mist);
  gl_FragColor = vec4(col, 1.0);
}
`;

// basis: rotation + scale (for camera-relative drawing); xf / inv: full kit ↔ planet-fixed transforms (collision)
type Site = { kit: number; face: number; anchor: THREE.Vector3; alt: number; basis: THREE.Matrix4; xf: THREE.Matrix4; inv: THREE.Matrix4; scale: number };
const CELL = 900, VIEW = 5500, MAX_PER_KIT = 48;
// a few sites placed by hand near home, so the first walk off the cliff finds something
// (the first is the Gate, facing the showcase's camera so the home plateau shows through it)
const HOME_SITES: [number, number, number, number][] = [[920, 360, 4, 0.84], [-860, -520, 2, 2.1], [260, 980, 1, 4.0], [-420, 900, 3, 1.2]];

export class Ruins {
  kits: Kit[];
  meshes: THREE.InstancedMesh[];
  mat: THREE.ShaderMaterial;
  private cells = new Map<string, Site | null>();
  private near: Site[] = [];
  private scanT = 0;
  private m = new THREE.Matrix4();
  private v = new THREE.Vector3();
  private e = new THREE.Vector3();
  private n = new THREE.Vector3();

  constructor() {
    this.kits = buildKits();
    this.mat = new THREE.ShaderMaterial({ vertexShader: RUIN_VS, fragmentShader: RUIN_FS, uniforms: { ...shared, uBg: { value: null }, uRes: { value: new THREE.Vector2(1, 1) } } });
    this.meshes = this.kits.map((k) => {
      const im = new THREE.InstancedMesh(k.geo, this.mat, MAX_PER_KIT);
      im.frustumCulled = false; im.count = 0;
      return im;
    });
    for (const [x, z, kit, rot] of HOME_SITES) this.cells.set(`home:${x}:${z}`, this.makeSite(SPAWN_FACE, x, z, kit, rot, 1.05));
  }

  private makeSite(face: number, X: number, Z: number, kit: number, rot: number, scale: number): Site | null {
    const h = planetHeight(face, X, Z);
    // needs fairly level ground
    let lo = h, hi = h;
    for (const [dx, dz] of [[7, 0], [-7, 0], [0, 7], [0, -7]]) { const g = planetHeight(face, X + dx, Z + dz); lo = Math.min(lo, g); hi = Math.max(hi, g); }
    if (hi - lo > 4.5) return null;
    const anchor = flatToPF(face, X, lo - 0.25, Z);
    const up = this.v.copy(anchor).normalize(), f = FACES[face];
    this.e.copy(f.eu).addScaledVector(up, -f.eu.dot(up)).normalize();
    this.n.crossVectors(this.e, up);
    const basis = new THREE.Matrix4().makeBasis(this.e, up, this.n).multiply(new THREE.Matrix4().makeRotationY(rot)).multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
    const xf = basis.clone().setPosition(anchor);
    return { kit, face, anchor, alt: lo - 0.25, basis, xf, inv: xf.clone().invert(), scale };
  }
  private cell(face: number, i: number, j: number) {
    const key = `${face}:${i}:${j}`;
    if (this.cells.has(key)) return this.cells.get(key)!;
    const R = mulberry32((face * 73856093) ^ (i * 19349663) ^ (j * 83492791));
    const X = (i + 0.5) * CELL + (R() - 0.5) * CELL * 0.6, Z = (j + 0.5) * CELL + (R() - 0.5) * CELL * 0.6;
    let site: Site | null = null;
    const home = face === SPAWN_FACE && Math.max(Math.abs(X), Math.abs(Z)) < 1100;
    if (!home && Math.max(Math.abs(X), Math.abs(Z)) < PLANET_R - 200) {
      const h = planetHeight(face, X, Z), roll = R();
      // most under the clouds, a few up on the highlands
      if ((h < SEA_BASE - 70 && roll < 0.5) || (h > SEA_TOP + 15 && roll < 0.14))
        site = this.makeSite(face, X, Z, Math.floor(R() * RANDOM_KITS), R() * Math.PI * 2, 0.85 + R() * 0.4);
    }
    this.cells.set(key, site);
    return site;
  }
  private scan(cam: THREE.Vector3) {
    const fi = faceOf(cam), f = FACES[fi], dn = cam.dot(f.n);
    const X = PLANET_R * cam.dot(f.eu) / dn, Z = PLANET_R * cam.dot(f.ev) / dn;
    const ci = Math.floor(X / CELL), cj = Math.floor(Z / CELL), r = Math.ceil(VIEW / CELL);
    this.near = [];
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      const s = this.cell(fi, i, j);
      if (s) this.near.push(s);
    }
    for (const [x, z] of HOME_SITES) { const s = this.cells.get(`home:${x}:${z}`); if (s) this.near.push(s); }
  }

  update(dt: number, bg: THREE.Texture, W: number, H: number) {
    const cam = frame.camPF;
    if ((this.scanT -= dt) <= 0 || !this.near.length) { this.scanT = 0.5; this.scan(cam); }
    this.mat.uniforms.uBg.value = bg;
    this.mat.uniforms.uRes.value.set(W, H);
    const counts = this.meshes.map(() => 0);
    for (const s of this.near) {
      if (s.anchor.distanceTo(cam) > VIEW || counts[s.kit] >= MAX_PER_KIT) continue;
      pfMatrix(s.anchor, this.m, s.basis);
      this.meshes[s.kit].setMatrixAt(counts[s.kit]++, this.m);
    }
    this.meshes.forEach((im, k) => { im.count = counts[k]; im.instanceMatrix.needsUpdate = true; });
  }

  /** push a planet-fixed position out of nearby walls and columns */
  collide(p: THREE.Vector3, radius = 0.3) {
    for (const s of this.near) {
      if (s.anchor.distanceTo(p) > 40) continue;
      const k = this.kits[s.kit], l = this.v.copy(p).applyMatrix4(s.inv), r = radius / s.scale;
      let moved = false;
      for (const [x0, z0, x1, z1] of k.boxes) {
        const cx = clamp(l.x, x0, x1), cz = clamp(l.z, z0, z1), dx = l.x - cx, dz = l.z - cz, d2 = dx * dx + dz * dz;
        if (d2 >= r * r || l.y > 8) continue;
        if (d2 > 1e-8) { const d = Math.sqrt(d2), f = (r - d) / d; l.x += dx * f; l.z += dz * f; }
        else { const pen = [l.x - x0, x1 - l.x, l.z - z0, z1 - l.z], i = pen.indexOf(Math.min(...pen)); if (i === 0) l.x = x0 - r; else if (i === 1) l.x = x1 + r; else if (i === 2) l.z = z0 - r; else l.z = z1 + r; }
        moved = true;
      }
      for (const [x, z, cr] of k.circles) {
        const dx = l.x - x, dz = l.z - z, d = Math.hypot(dx, dz), rr = cr + r;
        if (d >= rr || d < 1e-6 || l.y > 8) continue;
        l.x = x + dx / d * rr; l.z = z + dz / d * rr; moved = true;
      }
      if (moved) p.copy(l.applyMatrix4(s.xf));
    }
  }
  /** altitude of a walkable ruin surface under a planet-fixed point, or -1e9 */
  floorAt(p: THREE.Vector3) {
    let best = -1e9;
    for (const s of this.near) {
      const k = this.kits[s.kit];
      if (!k.floor || s.anchor.distanceTo(p) > 30) continue;
      const l = this.v.copy(p).applyMatrix4(s.inv), y = k.floor(l.x, l.z);
      if (y > -1e8) best = Math.max(best, s.alt + y * s.scale);
    }
    return best;
  }
}
