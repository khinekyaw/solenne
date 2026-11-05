import * as THREE from 'three';
import { COMMON } from '../render/glsl';
import { shared, frame, pfMatrix } from '../render/frame';
import { groundH } from '../planet/heights';
import { regionToPF, pfToFlat } from '../planet/solenne';

/* =========================================================================
   Mossy stones: a handful of old boulders half sunk in the home meadow
   (solid to the walker), and the rocks round the waterfalls' cracks. Built
   once from squashed icosahedra; one shader, moss on what faces the sky.
   ========================================================================= */
const ROCK_VS = /* glsl */`
attribute vec3 aColor;
varying vec3 vRel;
varying vec3 vN;
varying vec3 vColor;
varying vec3 vLocal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vRel = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vColor = aColor; vLocal = position;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const ROCK_FS = /* glsl */`
#define SUN uSunDirL
${COMMON}
varying vec3 vRel;
varying vec3 vN;
varying vec3 vColor;
varying vec3 vLocal;
void main() {
  vec3 N = normalize(vN), up = normalize(vRel - uCenterL);
  float dist = length(vRel), h = length(vRel - uCenterL) - PLANET_R;
  vec3 V = -vRel / dist;
  float n = texture(uWeather, vLocal.xz * 0.21 + vLocal.y * 0.13).a, n2 = texture(uWeather, vLocal.xy * 0.6 + 0.3).b;
  vec3 alb = vColor * (0.78 + 0.35 * n) * (0.9 + 0.2 * n2);
  // moss on what faces the sky, thick and patchy (none in the dark of a crack)
  float moss = smoothstep(0.2, 0.65, dot(N, up) * 0.8 + n * 0.6 - 0.1) * step(0.12, vColor.r);
  alb = mix(alb, mix(vec3(0.07, 0.14, 0.05), vec3(0.15, 0.21, 0.08), n2), moss * 0.9);
  float deck = deckShade(h) * seaCovAt(normalize(uCamPF + uLtoPF * vRel));
  vec3 lit = mix(uSunColor * GROUND_SUN * max(dot(N, SUN), 0.0) + skyAmbientY(dot(N, up)) * 0.95, deckLight(uHorizon, uZenith, uSunColor, uNight) * (0.8 + 0.4 * (dot(N, up) * 0.5 + 0.5)), deck);
  vec3 col = alb * lit;
  col = mix(col, hazeColor(-V), hazeAmountAlt(dist, uCamAlt, h) * (1.0 - deck));
  gl_FragColor = vec4(col, 1.0);
}
`;
export const rockMaterial = () => new THREE.ShaderMaterial({ vertexShader: ROCK_VS, fragmentShader: ROCK_FS, uniforms: { ...shared } });

/** a builder of merged stones, in planet-fixed offsets from an anchor */
export function stoneKit(anchor: THREE.Vector3, seed: number) {
  const P: number[] = [], N: number[] = [], C: number[] = [];
  let k = 0;
  const rnd = () => { const x = Math.sin((k++) * 91.7 + seed * 13.1) * 43758.5453; return x - Math.floor(x); };
  /** a stone at a planet-fixed point: radius, squash (height / width), tone (grey) */
  function add(at: THREE.Vector3, r: number, squash = 0.6, tone = 0.45, stretch = 1) {
    const s = rnd(), geo = new THREE.IcosahedronGeometry(r, 2).toNonIndexed();
    // a little lumpy, so no two stones are the same
    const pa = geo.attributes.position;
    for (let i = 0; i < pa.count; i++) { const f = 1 + 0.12 * Math.sin(pa.getX(i) * 3.1 / r + s * 9) * Math.sin(pa.getZ(i) * 2.7 / r + s * 5); pa.setXYZ(i, pa.getX(i) * f, pa.getY(i) * f, pa.getZ(i) * f); }
    geo.computeVertexNormals();
    const up = at.clone().normalize(), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s * 6.28));
    geo.applyMatrix4(new THREE.Matrix4().compose(at.clone().sub(anchor), q, new THREE.Vector3(stretch, squash + 0.2 * s, 0.85 + 0.2 * rnd())));
    const p2 = geo.attributes.position, n2 = geo.attributes.normal, t = tone * (0.9 + 0.2 * rnd());
    for (let i = 0; i < p2.count; i++) { P.push(p2.getX(i), p2.getY(i), p2.getZ(i)); N.push(n2.getX(i), n2.getY(i), n2.getZ(i)); C.push(t * 1.02, t * 0.97, t * 0.86); }
  }
  function mesh(mat: THREE.Material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(C, 3));
    const m = new THREE.Mesh(g, mat);
    m.matrixAutoUpdate = false; m.frustumCulled = false;
    return m;
  }
  return { add, mesh, rnd };
}

// a few old boulders in the home meadow (flat x, z, radius), clear of the film's cameras and the paths people walk
const SPOTS: [number, number, number][] = [
  [-150, -70, 1.9], [-143, -76, 1.1], [-156, -62, 0.8],
  [235, 30, 2.2], [242, 22, 1.2],
  [-60, 175, 1.6], [-52, 182, 0.9],
  [250, -360, 1.7], [258, -352, 1.0],
  [-210, 60, 1.3],
];

export class Boulders {
  meshes: THREE.Mesh[] = [];
  private anchor: THREE.Vector3;
  private stones: { x: number; z: number; r: number }[] = [];
  constructor() {
    this.anchor = regionToPF(0, groundH(0, 0), 0);
    const kit = stoneKit(this.anchor, 7);
    for (const [x, z, r] of SPOTS) {
      const g = groundH(x, z);
      if (g < -6) continue;   // (only up on the meadow)
      kit.add(regionToPF(x, g - r * 0.25, z), r * 1.15, 0.78, 0.5);
      this.stones.push({ x, z, r: r * 0.95 });
    }
    this.meshes.push(kit.mesh(rockMaterial()));
  }
  update() {
    const near = this.anchor.distanceTo(frame.camPF) < 12000;
    for (const m of this.meshes) { m.visible = near; if (near) { pfMatrix(this.anchor, m.matrix); m.matrixWorldNeedsUpdate = true; } }
  }
  /** keep a planet-fixed position out of the boulders */
  collide(p: THREE.Vector3) {
    if (p.distanceTo(this.anchor) > 800) return;
    const f = pfToFlat(p);
    for (const s of this.stones) {
      const dx = f.X - s.x, dz = f.Z - s.z, d = Math.hypot(dx, dz), r = s.r + 0.3;
      if (d >= r || d < 1e-6 || f.h > groundH(s.x, s.z) + s.r * 1.2) continue;
      regionToPF(s.x + dx / d * r, f.h, s.z + dz / d * r, p);
      return;
    }
  }
  floorAt() { return -1e9; }
}
