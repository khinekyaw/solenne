import * as THREE from 'three';
import { G0 } from '../config';
import { COMMON } from '../render/glsl';
import { shared, frame, pfMatrix } from '../render/frame';
import { groundH } from '../planet/heights';
import { regionToPF } from '../planet/solenne';

/* =========================================================================
   Waterfalls off the home plateau. The meadow drinks the fog of the cloud
   sea; the water gathers in springs that break out of the cliff a few
   metres under the rim and fall through the clouds to the talus below.
   Each fall is a ribbon that leaps clear on a ballistic arc and otherwise
   follows the face, built once from the region heightfield.
   ========================================================================= */
const FALL_VS = /* glsl */`
attribute vec2 aUv;
attribute float aAlt;
varying vec3 vRel;
varying vec2 vUv;
varying float vAlt;
varying float vSeed;
uniform float uSeed;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vRel = wp.xyz; vUv = aUv; vAlt = aAlt; vSeed = uSeed;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const FALL_FS = /* glsl */`
#define SUN uSunDirL
${COMMON}
uniform sampler2D uBg;
uniform vec2 uRes;
uniform float uLen;
varying vec3 vRel;
varying vec2 vUv;
varying float vAlt;
varying float vSeed;
void main() {
  float dist = length(vRel);
  vec3 pPF = uCamPF + uLtoPF * vRel;
  float cover = seaCovAt(normalize(pPF));
  float mist = seaMist(vAlt, dist) * smoothstep(0.55, 0.88, cover);
  if (mist > 0.995) discard;
  float t = uTime, u = vUv.x, v = vUv.y;
  // falling streaks: two layers sliding down at different speeds, ragged edges that wander
  float s1 = texture(uWeather, vec2(u * 1.4 + vSeed, v / 26.0 - t * 0.85)).r;
  float s2 = texture(uWeather, vec2(u * 3.1 + vSeed * 2.0, v / 9.0 - t * 1.7)).g;
  float wob = (texture(uWeather, vec2(v / 60.0 - t * 0.2, vSeed)).b - 0.5) * 0.35;
  float edge = smoothstep(0.0, 0.22, u + wob * 0.5) * smoothstep(1.0, 0.78, u + wob * 0.5);
  float a = edge * (0.25 + 0.75 * smoothstep(0.3, 0.75, s1 * 0.6 + s2 * 0.5));
  a *= smoothstep(0.0, 6.0, v) * (1.0 - smoothstep(uLen - 30.0, uLen, v) * 0.6);
  // spray thickens toward the bottom
  a = max(a, edge * smoothstep(uLen - 60.0, uLen, v) * 0.45 * (0.6 + 0.4 * s2));
  float deck = deckShade(vAlt) * cover;
  vec3 lit = mix(uSunColor * GROUND_SUN * 0.55 + skyAmbientY(1.0) * 1.25, deckLight(uHorizon, uZenith, uSunColor, uNight) * 1.4, deck);
  vec3 col = lit * mix(vec3(0.82, 0.9, 0.95), vec3(1.0), s2);
  vec3 V = -vRel / dist;
  col = mix(col, hazeColor(-V), hazeAmountAlt(dist, uCamAlt, vAlt) * (1.0 - deck));
  col = mix(col, deckLight(uHorizon, uZenith, uSunColor, uNight) * 0.9, murkAmount(vAlt, dist) * cover);
  a *= 1.0 - mist;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a * 0.9);
}
`;

// rim directions (degrees around the plateau centre, flat coords) where springs break out
const SITES = [-14, 142, 214];
type Fall = { mesh: THREE.Mesh; anchor: THREE.Vector3; path: THREE.Vector3[] };

export class Waterfalls {
  falls: Fall[] = [];
  meshes: THREE.Mesh[] = [];
  private mat: THREE.ShaderMaterial;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: FALL_VS, fragmentShader: FALL_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { ...shared, uBg: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uLen: { value: 300 }, uSeed: { value: 0 } },
    });
    SITES.forEach((deg, i) => { const f = this.build(deg * Math.PI / 180, i); if (f) { this.falls.push(f); this.meshes.push(f.mesh); } });
  }

  private build(ang: number, i: number): Fall | null {
    const dx = Math.cos(ang), dz = Math.sin(ang), at = (r: number) => groundH(dx * r, dz * r);
    // the rim: where the plateau top first drops away
    let rim = 0;
    for (let r = 60; r < 680; r += 1) if (at(r) < -12) { rim = r - 3; break; }
    if (!rim) return null;
    const top = at(rim) - 3.5, v0 = 2.8;   // the spring breaks out of the face just under the rim
    const pts: { r: number; y: number }[] = [];
    for (let y = top, k = 0; k < 140; k++, y -= 4) {
      // ballistic leap from the face, or hugging it where it bulges out further
      const tFall = Math.sqrt(2 * (top - y) / G0), rBall = rim + 1.5 + v0 * tFall;
      let rFace = rim;
      while (rFace < rim + 600 && at(rFace) > y - 1.2) rFace += 0.5;
      const r = Math.max(rBall, rFace + 1.2);
      pts.push({ r, y });
      if (at(r) > y - 2.5) break;   // it has reached the talus
    }
    if (pts.length < 4) return null;
    const P: number[] = [], UV: number[] = [], ALT: number[] = [], idx: number[] = [];
    const anchor = regionToPF(dx * pts[0].r, pts[0].y, dz * pts[0].r), tx = -dz, tz = dx, path: THREE.Vector3[] = [];
    let v = 0, prev: THREE.Vector3 | null = null;
    pts.forEach(({ r, y }, k) => {
      const w = 3.6 + 7.0 * Math.pow(k / pts.length, 0.8), c = regionToPF(dx * r, y, dz * r);
      if (prev) v += c.distanceTo(prev);
      prev = c; path.push(c);
      for (const s of [-1, 1]) {
        const p = regionToPF(dx * r + tx * w * s, y, dz * r + tz * w * s).sub(anchor);
        P.push(p.x, p.y, p.z); UV.push(s < 0 ? 0 : 1, v); ALT.push(y);
      }
      if (k) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(UV, 2));
    g.setAttribute('aAlt', new THREE.Float32BufferAttribute(ALT, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const mat = this.mat.clone();
    mat.uniforms = { ...this.mat.uniforms, uLen: { value: v }, uSeed: { value: i * 0.37 } };
    const mesh = new THREE.Mesh(g, mat);
    mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; mesh.renderOrder = 2;
    return { mesh, anchor, path };
  }

  update(bg: THREE.Texture, W: number, H: number) {
    this.mat.uniforms.uBg.value = bg; this.mat.uniforms.uRes.value.set(W, H);
    for (const f of this.falls) {
      const near = f.anchor.distanceTo(frame.camPF) < 15000;
      f.mesh.visible = near;
      if (near) { pfMatrix(f.anchor, f.mesh.matrix); f.mesh.matrixWorldNeedsUpdate = true; }
    }
  }
  /** 0 … 1: how close the camera is to falling water (for the sound) */
  proximity(cam: THREE.Vector3) {
    let d = 1e9;
    for (const f of this.falls) for (let k = 0; k < f.path.length; k += 3) d = Math.min(d, f.path[k].distanceTo(cam));
    return 1 - Math.min(1, Math.max(0, (d - 25) / 420));
  }
}
