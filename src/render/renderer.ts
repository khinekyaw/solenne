import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { QUALITY } from '../config';
import { settings } from '../settings';

const GRADE = {
  uniforms: { tDiffuse: { value: null }, uExposure: { value: 0.84 }, uScope: { value: 0 }, uFilter: { value: 1 }, uSolar: { value: 0 }, uAspect: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uExposure; uniform float uScope; uniform float uFilter; uniform float uSolar; uniform float uAspect; varying vec2 vUv;
    vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    void main() {
      // uFilter: the eye adapting in the eyepiece; uSolar: the telescope's warm-tinted solar filter
      vec3 c = texture2D(tDiffuse, vUv).rgb * uExposure * uFilter * mix(vec3(1.0), vec3(0.009, 0.0062, 0.0034), uSolar);
      c = aces(c);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.04);
      vec2 d = vUv - 0.5;
      c *= 1.0 - dot(d, d) * 0.32;
      // through the telescope: a round field stop with a soft, slightly darkened edge
      if (uScope > 0.0) {
        float r = length(d * vec2(uAspect, 1.0));
        c *= mix(1.0, smoothstep(0.475, 0.462, r) * (1.0 - 0.45 * smoothstep(0.25, 0.47, r)), uScope);
      }
      c = toSRGB(clamp(c, 0.0, 1.0));
      c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/* Renderer, post chain (bloom → ACES grade) and adaptive resolution (prototype).
   Resolution changes wait for the start of the next frame: resizing a canvas clears it, so a resize
   between drawing a frame and showing it made the whole screen blink. The adaptation has hysteresis
   so the render scale settles instead of flip-flopping every few seconds. */
export class Renderer {
  gl: THREE.WebGLRenderer;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  grade: ShaderPass;
  dynScale = 1;
  private perfAcc = 0; private perfN = 0; private perfT = 0; private perfCooldown = 3;
  private pending = false; private low = 0; private high = 0; private lastUp = -1e9; private upBlockedUntil = 0;
  onResize: (W: number, H: number) => void = () => {};

  constructor(canvas: HTMLCanvasElement, scene: THREE.Scene, public camera: THREE.PerspectiveCamera) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
    if (!this.gl.capabilities.isWebGL2) throw new Error('WebGL2');
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.toneMapping = THREE.NoToneMapping;
    const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.gl, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.16, 0.6, 2.6);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GRADE);
    this.composer.addPass(this.grade);
    window.addEventListener('resize', () => this.requestApply());
  }
  get exposure() { return this.grade.uniforms.uExposure; }
  resetAdaptive() { this.dynScale = 1; this.perfCooldown = 3; this.low = this.high = 0; this.upBlockedUntil = 0; }
  /** resize at the start of the next frame (see beginFrame) */
  requestApply() { this.pending = true; }
  /** call before anything of the frame is drawn */
  beginFrame() { if (this.pending) { this.pending = false; this.applyQuality(); } }
  applyQuality() {
    const q = QUALITY[settings.quality];
    const pr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, q.pr) * this.dynScale);
    this.gl.setPixelRatio(pr);
    const w = window.innerWidth, h = window.innerHeight;
    this.gl.setSize(w, h, false);
    for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) if (t.samples !== q.msaa) { t.samples = q.msaa; t.dispose(); }
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.strength = 0.16 * q.bloom / 0.6;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.grade.uniforms.uAspect.value = w / h;
    this.onResize(Math.floor(w * pr), Math.floor(h * pr));
  }
  render(dt: number) { this.composer.render(dt); }
  /** drop render scale when the frame rate sags, recover when there is headroom: down after 2 s under
      45 fps, up after 4 s over 57, and no new step up for 30 s when the last one had to be undone */
  adapt(now: number, dt: number) {
    this.perfAcc += dt; this.perfN++;
    if (now - this.perfT <= 1000) return;
    const fps = this.perfN / this.perfAcc;
    this.perfAcc = 0; this.perfN = 0; this.perfT = now;
    if (document.hidden || --this.perfCooldown > 0) return;
    this.low = fps < 45 ? this.low + 1 : 0;
    this.high = fps > 57 ? this.high + 1 : 0;
    if (this.low >= 2 && this.dynScale > 0.6) {
      this.dynScale = Math.max(0.6, this.dynScale - 0.1);
      if (now - this.lastUp < 8000) this.upBlockedUntil = now + 30000;
      this.scaleChanged();
    } else if (this.high >= 4 && this.dynScale < 1 && now > this.upBlockedUntil) {
      this.dynScale = Math.min(1, this.dynScale + 0.05);
      this.lastUp = now;
      this.scaleChanged();
    }
  }
  private scaleChanged() { this.pending = true; this.low = this.high = 0; this.perfCooldown = 2; }
}
