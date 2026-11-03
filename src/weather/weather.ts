import * as THREE from 'three';
import { QUALITY, SEA_TOP, PLANET_R } from '../config';
import { clamp, smoothstep, mulberry32, pickWeighted } from '../core/math';
import { settings, saveSettings, type WeatherMode } from '../settings';
import { shared, frame, pfMatrix } from '../render/frame';
import { COMMON, HEIGHT_FETCH } from '../render/glsl';
import { heightAtDir } from '../planet/heights';

/* =========================================================================
   Weather: eases toward the chosen preset; Dynamic wanders between them.
   It is local to the player and fades out with altitude.
   ========================================================================= */
type Preset = { label: string; cover: number; dark: number; rain: number; wind: number; fog: number; bolt: number; still: number };
export const WX: Record<Exclude<WeatherMode, 'dynamic'>, Preset> = {
  sunny:  { label: 'Sunny',        cover: 0.0,  dark: 0.0,  rain: 0.0,  wind: 0.0,  fog: 0.0,  bolt: 0, still: 0 },
  cloudy: { label: 'Cloudy',       cover: 0.62, dark: 0.2,  rain: 0.0,  wind: 0.45, fog: 0.05, bolt: 0, still: 0 },
  rain:   { label: 'Rain',         cover: 0.92, dark: 0.5,  rain: 0.65, wind: 0.62, fog: 0.22, bolt: 0, still: 0 },
  storm:  { label: 'Thunderstorm', cover: 1.0,  dark: 0.85, rain: 1.0,  wind: 0.92, fog: 0.3,  bolt: 1, still: 0 },
  fog:    { label: 'Fog',          cover: 0.4,  dark: 0.15, rain: 0.0,  wind: 0.0,  fog: 1.0,  bolt: 0, still: 1 },
};
type Kind = keyof typeof WX;
const WX_NEXT: Record<Kind, [Kind, number][]> = {
  sunny: [['sunny', 1.5], ['cloudy', 3], ['fog', 0.6]],
  cloudy: [['sunny', 2], ['cloudy', 1], ['rain', 2], ['fog', 0.6]],
  rain: [['cloudy', 2], ['storm', 1.6], ['rain', 1]],
  storm: [['rain', 3], ['storm', 0.6]],
  fog: [['sunny', 1.5], ['cloudy', 1.5]],
};
export const wx = { cover: 0, dark: 0, rain: 0, wind: 0, fog: 0, bolt: 0, still: 0, wet: 0, current: 'sunny' as Kind, timer: 100, nextBolt: 6, pulses: [] as { t0: number; amp: number; bolt: boolean }[], boltEnd: 0 };
if (settings.weather !== 'dynamic') { wx.current = settings.weather; Object.assign(wx, { ...WX[settings.weather], label: undefined }); }

const RAIN_VS = /* glsl */`
#define SUN uSunDirL
${COMMON}
${HEIGHT_FETCH}
uniform vec3 uRainOff;
uniform vec3 uRainVel;
uniform float uHouseTop;
uniform float uRainA;
uniform vec3 uCamBox;
uniform float uInRegion;
uniform float uGroundRel;
attribute vec4 seed;
varying float vA;
varying vec2 vUv;
varying vec3 vCol;
void main() {
  vec3 box = vec3(34.0, 22.0, 34.0);
  vec3 p = seed.xyz * box + uRainOff + vec3(0.0, -3.0 * seed.w * uTime, 0.0);
  p = mod(p - uCamBox + box * 0.5, box) - box * 0.5;
  vec3 f = uCamPos + p;
  bool hide = uInRegion > 0.5 ? (f.y < groundAt(f.xz) - 0.05 || (inHouse(f.xz) && f.y < uHouseTop) || inShip(f)) : p.y < uGroundRel;
  vec3 dir = normalize(uRainVel + vec3(0.0, -3.0 * seed.w, 0.0));
  float d = length(p);
  vec3 side = normalize(cross(dir, -p / d));
  vec3 wp = p + dir * position.y * (0.5 + 0.4 * seed.w) + side * position.x * (0.012 + d * 0.0012);
  vUv = vec2(position.x + 0.5, position.y);
  vA = uRainA * smoothstep(0.4, 2.0, d) * (1.0 - smoothstep(12.0, 17.0, d));
  vCol = skyAmbient(vec3(0.0, 1.0, 0.0)) * 1.15 + uSunColor * 0.04;
  gl_Position = hide ? vec4(0.0, 0.0, -2.0, 1.0) : projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const RAIN_FS = /* glsl */`
varying float vA;
varying vec2 vUv;
varying vec3 vCol;
void main() {
  float a = vA * smoothstep(0.5, 0.0, abs(vUv.x - 0.5)) * smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol, a);
}
`;
const BOLT_VS = /* glsl */`
attribute float edge;
varying float vE;
void main() { vE = edge; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const BOLT_FS = /* glsl */`
uniform float uI;
varying float vE;
void main() {
  float a = clamp(1.0 - abs(vE), 0.0, 1.0);
  gl_FragColor = vec4(vec3(0.72, 0.8, 1.0) * max(uI, 0.0) * (0.25 + 2.5 * a * a * a), 1.0);
}
`;

function boltGeometry(top: THREE.Vector3, bottom: THREE.Vector3, width: number) {
  const R = Math.random, rr = (a: number, b: number) => a + (b - a) * R();
  const jag = (a: THREE.Vector3, b: THREE.Vector3, levels: number, amp: number) => {
    let pts = [a, b];
    for (let l = 0; l < levels; l++) {
      const out = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1], len = p.distanceTo(q);
        out.push(new THREE.Vector3().lerpVectors(p, q, rr(0.4, 0.6)).add(new THREE.Vector3(rr(-1, 1) * len * amp, rr(-0.3, 0.3) * len * amp, rr(-1, 1) * len * amp)), q);
      }
      pts = out;
    }
    return pts;
  };
  const strands: [THREE.Vector3[], number][] = [[jag(top, bottom, 7, 0.3), width]];
  const main = strands[0][0];
  for (let k = 0; k < 2 + Math.floor(R() * 3); k++) {
    const s = main[Math.floor(rr(0.1, 0.6) * main.length)];
    const e = s.clone().add(new THREE.Vector3(rr(-1, 1) * 160, -rr(80, 240), rr(-1, 1) * 160));
    strands.push([jag(s, e, 5, 0.35), width * 0.45]);
  }
  const pos: number[] = [], edge: number[] = [], d = new THREE.Vector3(), t = new THREE.Vector3(), sd = new THREE.Vector3();
  for (const [pts, w] of strands) for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    d.subVectors(b, a); t.addVectors(a, b).multiplyScalar(0.5);   // the camera is at the origin
    sd.crossVectors(d, t).normalize().multiplyScalar(w * (1 - i / pts.length * 0.5));
    const v = [a.clone().sub(sd), a.clone().add(sd), b.clone().add(sd), b.clone().sub(sd)];
    for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(v[k].x, v[k].y, v[k].z); edge.push(k === 0 || k === 3 ? -1 : 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
  return g;
}

export class Weather {
  rain: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  bolt: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private boltAnchor = new THREE.Vector3();
  private boltBasis = new THREE.Matrix4();
  onLabel: () => void = () => {};
  onThunder: (dist: number) => void = () => {};

  constructor(uHeight: { value: THREE.Texture }) {
    const DMAX = QUALITY.high.drops, dseed = new Float32Array(DMAX * 4), dr = mulberry32(5);
    for (let i = 0; i < DMAX * 4; i++) dseed[i] = dr();
    const rgeo = new THREE.InstancedBufferGeometry();
    rgeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
    rgeo.setIndex([0, 1, 3, 0, 3, 2]);
    rgeo.setAttribute('seed', new THREE.InstancedBufferAttribute(dseed, 4));
    rgeo.instanceCount = 0;
    this.rain = new THREE.Mesh(rgeo, new THREE.ShaderMaterial({
      vertexShader: RAIN_VS, fragmentShader: RAIN_FS, transparent: true, depthWrite: false,
      uniforms: { ...shared, uHeight, uRainOff: { value: new THREE.Vector3() }, uRainVel: { value: new THREE.Vector3(0, -9, 0) }, uHouseTop: { value: -1e9 }, uRainA: { value: 0 }, uInRegion: { value: 1 }, uGroundRel: { value: -2 } },
    }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.bolt = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial({
      vertexShader: BOLT_VS, fragmentShader: BOLT_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uI: { value: 0 } },
    }));
    this.bolt.frustumCulled = false;
    this.bolt.visible = false;
    this.bolt.matrixAutoUpdate = false;
  }
  get label() { return WX[wx.current].label; }
  setMode(mode: WeatherMode) {
    settings.weather = mode;
    if (mode !== 'dynamic') wx.current = mode; else wx.timer = 60 + Math.random() * 60;
    saveSettings();
    this.onLabel();
  }
  private strike() {
    const R = Math.random, rr = (a: number, b: number) => a + (b - a) * R();
    const dist = rr(320, 1700), az = R() * Math.PI * 2;
    const x = Math.cos(az) * dist, z = Math.sin(az) * dist, drop = dist * dist / (2 * PLANET_R);
    const near = 1 - dist / 1700, t = shared.uTime.value;
    const amp = (0.25 + 0.75 * near) * (1 - 0.5 * wx.fog);
    const visible = R() > 0.35;
    const seq = R() < 0.5 ? [[0, 1], [0.09, 0.5], [0.24, 0.85]] : [[0, 1], [0.13, 0.6]];
    for (const [dt0, a] of seq) wx.pulses.push({ t0: t + dt0, amp: amp * a, bolt: visible });
    if (visible) {
      const pf = new THREE.Vector3(x, 0, z).applyMatrix3(frame.LtoPF).add(frame.camPF).normalize();
      const g = Math.max(heightAtDir(pf.x, pf.y, pf.z), SEA_TOP - 25);
      this.bolt.geometry.dispose();
      const top = new THREE.Vector3(x, 330 + rr(0, 80) - frame.alt - drop, z);
      const bottom = new THREE.Vector3(x + rr(-60, 60), g - frame.alt - drop, z + rr(-60, 60));
      this.bolt.geometry = boltGeometry(top, bottom, Math.max(1.0, dist * 0.0038));
      this.boltAnchor.copy(frame.camPF);
      this.boltBasis.setFromMatrix3(frame.LtoPF);
      this.bolt.visible = true;
      wx.boltEnd = t + 0.5;
    }
    setTimeout(() => this.onThunder(dist), Math.min(dist / 343, 5) * 1000);
  }
  /** returns the rain intensity at the player */
  update(dt: number, o: { inRegion: boolean; groundRel: number; houseTop: number }) {
    if (settings.weather === 'dynamic') {
      if ((wx.timer -= dt) <= 0) { wx.current = pickWeighted(WX_NEXT[wx.current]); wx.timer = 70 + Math.random() * 100; this.onLabel(); }
    } else wx.current = settings.weather;
    const tg = WX[wx.current], k = 1 - Math.exp(-dt / (settings.weather === 'dynamic' ? 14 : 4));
    for (const p of ['cover', 'dark', 'rain', 'wind', 'fog', 'bolt', 'still'] as const) wx[p] += (tg[p] - wx[p]) * k;
    // weather lives below the clouds: above them it thins out, and from orbit it is gone
    const hiK = 1 - smoothstep(1200, 5000, frame.alt);
    const lowK = 1 - smoothstep(500, 1300, frame.alt);
    const rainNow = wx.rain * smoothstep(0.6, 0.85, wx.cover) * lowK;
    wx.wet = clamp(wx.wet + (rainNow > 0.15 ? dt / 35 : -dt / 140), 0, 1);

    // wind: storms raise it, fog stills it, the slider sets the baseline
    const eff = Math.max((settings.wind / 100) * (1 - 0.75 * wx.still), wx.wind);
    shared.uWindStr.value = eff;
    shared.uWindPhase.value += dt * (2.5 + 8 * eff);
    shared.uSwayPhase.value += dt * (1.8 + 2 * eff);
    const wd = shared.uWindDir.value;
    shared.uCloudOff.value.addScaledVector(new THREE.Vector3(7.5, 0, 2.4).applyMatrix3(frame.LtoPF), dt * (0.7 + 1.6 * eff));
    shared.uCover.value = wx.cover * hiK; shared.uDark.value = wx.dark * hiK; shared.uFog.value = wx.fog * lowK; shared.uWet.value = wx.wet;

    const q = QUALITY[settings.quality], ru = this.rain.material.uniforms;
    this.rain.geometry.instanceCount = Math.floor(q.drops * Math.min(1, rainNow * 1.2));
    this.rain.visible = this.rain.geometry.instanceCount > 0;
    ru.uRainVel.value.set(wd.x * (0.5 + 6 * eff), -9, wd.y * (0.5 + 6 * eff));
    ru.uRainOff.value.addScaledVector(ru.uRainVel.value, dt);
    ru.uRainA.value = 0.34 * Math.min(1, 0.4 + rainNow);
    ru.uHouseTop.value = o.houseTop; ru.uInRegion.value = o.inRegion ? 1 : 0; ru.uGroundRel.value = o.groundRel;

    // lightning
    if (wx.bolt * lowK > 0.6 && (wx.nextBolt -= dt) <= 0) { this.strike(); wx.nextBolt = 4 + Math.random() * 14; }
    const t = shared.uTime.value;
    let flash = 0, bf = 0;
    wx.pulses = wx.pulses.filter((p) => t - p.t0 < 1.2);
    for (const p of wx.pulses) if (t >= p.t0) { const e = p.amp * Math.exp(-(t - p.t0) / 0.07); flash += e; if (p.bolt) bf += e; }
    shared.uFlash.value = flash;
    this.bolt.material.uniforms.uI.value = bf * 5;
    if (this.bolt.visible && t > wx.boltEnd) this.bolt.visible = false;
    if (this.bolt.visible) pfMatrix(this.boltAnchor, this.bolt.matrix, this.boltBasis), this.bolt.matrixWorldNeedsUpdate = true;
    return rainNow;
  }
}
