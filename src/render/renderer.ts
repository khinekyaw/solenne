import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { QUALITY } from '../config';
import { settings } from '../settings';

const GRADE = {
  uniforms: { tDiffuse: { value: null }, uExposure: { value: 0.84 }, uScope: { value: 0 }, uFilter: { value: 1 }, uSolar: { value: 0 }, uHa: { value: 0 }, uAspect: { value: 1 }, uCine: { value: 0 }, uFade: { value: 1 }, uBars: { value: 0 }, uWarm: { value: 0 }, uTitle: { value: null }, uTitleA: { value: 0 }, uLift: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uExposure; uniform float uScope; uniform float uFilter; uniform float uSolar; uniform float uHa; uniform float uAspect; uniform float uCine; uniform float uFade; uniform float uBars; uniform float uWarm; uniform sampler2D uTitle; uniform float uTitleA; uniform float uLift; varying vec2 vUv;
    vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    void main() {
      // uFilter: the eye adapting in the eyepiece; uSolar: the telescope's solar filter, warm white light or
      // the deep red of hydrogen-alpha (uHa; the far pass brightens the sun 3× through it, so the sky goes dark)
      vec3 c = texture2D(tDiffuse, vUv).rgb * uExposure * uFilter * mix(vec3(1.0), mix(vec3(0.0078, 0.0054, 0.003), vec3(0.006, 0.0014, 0.0004), uHa), uSolar);
      c = aces(c);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.04);
      // the showcase's film look: a little more colour, cool shadows and warm lights, the blacks lifted a touch
      if (uCine > 0.0) {
        // golden hour (per shot): lights toward amber, shadows toward violet, a little more colour
        c *= mix(vec3(1.0), mix(vec3(0.9, 0.9, 1.08), vec3(1.12, 0.98, 0.78), smoothstep(0.08, 0.7, l)), uWarm * uCine);
        c = mix(vec3(l), c, 1.0 + (0.16 + 0.12 * uWarm) * uCine);
        c *= mix(vec3(1.0), mix(vec3(0.94, 0.98, 1.07), vec3(1.04, 1.0, 0.95), smoothstep(0.12, 0.65, l)), uCine);
        c = mix(c, c * 0.96 + 0.018 * uLift, uCine);
      }
      vec2 d = vUv - 0.5;
      c *= 1.0 - dot(d, d) * 0.32;
      // through the telescope: a round field stop with a soft, slightly darkened edge
      if (uScope > 0.0) {
        float r = length(d * vec2(uAspect, 1.0));
        c *= mix(1.0, smoothstep(0.475, 0.462, r) * (1.0 - 0.45 * smoothstep(0.25, 0.47, r)), uScope);
      }
      c = toSRGB(clamp(c, 0.0, 1.0));
      c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
      // fades and letterbox bars belong to the picture (the showcase has no UI)
      c *= uFade * (1.0 - step(1e-4, uBars) * step(0.5 - uBars, abs(vUv.y - 0.5)));
      // and so does the end title (a card drawn once into a texture, 1.6 × 0.4 screen heights, centred)
      if (uTitleA > 0.0) {
        vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0) / (vec2(1.6, 0.4) * min(1.0, uAspect / 1.9)) + 0.5;
        vec4 t = texture2D(uTitle, clamp(q, 0.0, 1.0));
        c = mix(c, t.rgb, t.a * uTitleA * step(abs(q.x - 0.5), 0.5) * step(abs(q.y - 0.5), 0.5));
      }
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/* The showcase's lens: a soft depth of field from the scene's own depth (resolved from the multisampled target;
   re-rendering depth would miss the custom vertex shaders). One gather pass on a golden-angle spiral, after
   Dennis Gustafsson's single-pass bokeh: a sample farther than the centre may blur it only as much as the centre
   itself is blurred, so a sharp subject does not bleed over a soft foreground. Blur size in fractions of the
   picture's height, so it looks the same at every render scale. */
class FocusPass extends Pass {
  readonly uniforms = {
    tDiffuse: { value: null as THREE.Texture | null }, tDepth: { value: null as THREE.Texture | null },
    uNear: { value: 0.1 }, uFar: { value: 1000 }, uFocus: { value: 100 }, uAperture: { value: 0.018 }, uMaxR: { value: 0.0055 },
    uRes: { value: new THREE.Vector2(1, 1) },
  };
  private quad: FullScreenQuad;
  constructor() {
    super();
    this.enabled = false;
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform float uNear; uniform float uFar; uniform float uFocus;
        uniform float uAperture; uniform float uMaxR; uniform vec2 uRes; varying vec2 vUv;
        float dist(vec2 uv) { float z = texture2D(tDepth, uv).x * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        // circle of confusion in pixels (thin lens: grows with the difference of inverse distances)
        float coc(float d) { return min(uAperture * abs(1.0 / uFocus - 1.0 / d), uMaxR) * uRes.y; }
        void main() {
          float d0 = dist(vUv), c0 = coc(d0), maxPx = uMaxR * uRes.y;
          vec3 col = texture2D(tDiffuse, vUv).rgb;
          float tot = 1.0, r = 0.5;
          for (int i = 0; i < 48; i++) {
            if (r >= maxPx) break;
            float a = float(i) * 2.39996;
            vec2 uv = vUv + vec2(cos(a), sin(a)) * r / uRes;
            float d = dist(uv), c = coc(d);
            if (d > d0) c = min(c, c0 * 2.0);
            col += mix(col / tot, texture2D(tDiffuse, uv).rgb, smoothstep(r - 0.5, r + 0.5, c));
            tot += 1.0;
            r += 1.0 / r;
          }
          gl_FragColor = vec4(col / tot, 1.0);
        }`,
    }));
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    this.uniforms.uRes.value.set(readBuffer.width, readBuffer.height);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}

/* Renderer, post chain (bloom → ACES grade) and adaptive resolution (prototype).
   Resolution changes wait for the start of the next frame: resizing a canvas clears it, so a resize
   between drawing a frame and showing it made the whole screen blink. The adaptation has hysteresis
   so the render scale settles instead of flip-flopping every few seconds. */
export class Renderer {
  gl: THREE.WebGLRenderer;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  grade: ShaderPass;
  focus = new FocusPass();
  /** a ship close by, high over the planet: drawn after the scene in her own depth range (layer 1) */
  readonly shipCam = new THREE.PerspectiveCamera();
  private shipPass: RenderPass;
  dynScale = 1;
  private bloomK = 0.16;
  private cine = false;   // the showcase: at least 30 fps (resolution capped, quick to step down)
  private frames: number[] = []; private lastNow = 0;
  /** the showcase's second resort once the resolution is as low as it should go: 1, 2 lighten the scene */
  strain = 0;
  onStrain: (level: number) => void = () => {};
  private perfAcc = 0; private perfN = 0; private perfT = 0; private perfCooldown = 3;
  private pending = false; private low = 0; private high = 0; private lastUp = -1e9; private upBlockedUntil = 0;
  onResize: (W: number, H: number) => void = () => {};

  constructor(canvas: HTMLCanvasElement, scene: THREE.Scene, public camera: THREE.PerspectiveCamera) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
    if (!this.gl.capabilities.isWebGL2) throw new Error('WebGL2');
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.toneMapping = THREE.NoToneMapping;
    const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(16, 16, THREE.UnsignedIntType) });
    this.composer = new EffectComposer(this.gl, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    // the near plane a ship metres away needs would leave the planet hundreds of km off with depth steps of
    // kilometres (its lakes and shores z-fight): so she gets a pass of her own, depth cleared, after the scene
    this.shipPass = new RenderPass(scene, this.shipCam);
    this.shipPass.clear = false; this.shipPass.clearDepth = true; this.shipPass.enabled = false;
    this.shipCam.layers.set(1);
    this.composer.addPass(this.shipPass);
    this.composer.addPass(this.focus);   // (the showcase only)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.16, 0.6, 2.6);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GRADE);
    this.composer.addPass(this.grade);
    window.addEventListener('resize', () => this.requestApply());
  }
  get exposure() { return this.grade.uniforms.uExposure; }
  /** glare (bloom) as a share of the quality's: a solar filter in front of the objective takes most of it away */
  glare(k: number) { this.bloom.strength = this.bloomK * k; }
  resetAdaptive() { this.dynScale = 1; this.perfCooldown = 3; this.low = this.high = 0; this.upBlockedUntil = 0; }
  /** resize at the start of the next frame (see beginFrame) */
  requestApply() { this.pending = true; }
  /** call before anything of the frame is drawn */
  beginFrame() { if (this.pending) { this.pending = false; this.applyQuality(); } }
  applyQuality() {
    const q = QUALITY[settings.quality];
    const fx = this.fixed;   // a video export draws at its own size, whatever the window
    const pr = fx ? 1 : Math.max(0.5, Math.min(window.devicePixelRatio || 1, q.pr, this.cine ? 1.5 : 4) * this.dynScale);
    this.gl.setPixelRatio(pr);
    const w = fx ? fx.w : window.innerWidth, h = fx ? fx.h : window.innerHeight;
    this.gl.setSize(w, h, false);
    for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) if (t.samples !== q.msaa) { t.samples = q.msaa; t.dispose(); }
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloomK = 0.16 * q.bloom / 0.6;
    this.bloom.strength = this.bloomK;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.grade.uniforms.uAspect.value = w / h;
    this.onResize(Math.floor(w * pr), Math.floor(h * pr));
  }
  render(dt: number) { this.composer.render(dt); }
  /** a video export: draw at exactly w × h, full resolution, no governor (null: back to the window) */
  exportSize(size: { w: number; h: number } | null) {
    this.fixed = size;
    if (size) { this.dynScale = 1; if (this.strain) { this.strain = 0; this.onStrain(0); } this.queued = null; }
    this.requestApply();
  }
  private fixed: { w: number; h: number } | null = null;
  /** the ship's own depth pass on (her near and far) or off; the camera is copied, only the depth range differs */
  shipRange(r: { near: number; far: number } | null) {
    this.shipPass.enabled = r !== null;
    if (!r) return;
    const c = this.shipCam, m = this.camera;
    c.position.copy(m.position); c.quaternion.copy(m.quaternion);
    c.fov = m.fov; c.aspect = m.aspect; c.near = r.near; c.far = r.far;
    c.updateProjectionMatrix(); c.updateMatrixWorld();
  }
  /** the showcase's lens: focus distance (m), or off */
  lens(focus: number | null) {
    this.focus.enabled = focus !== null;
    if (focus === null) return;
    const u = this.focus.uniforms, c = this.shipPass.enabled ? this.shipCam : this.camera;   // (the depth left is the last pass's)
    u.uFocus.value = Math.max(focus, 0.5); u.uNear.value = c.near; u.uFar.value = c.far;
  }
  /** the showcase's frame-rate floor on or off (its own resolution cap and a faster, stricter governor) */
  cinema(on: boolean) {
    if (on === this.cine) return;
    this.cine = on;
    if (on) this.saved = this.dynScale; else this.dynScale = this.saved;
    if (this.strain) { this.strain = 0; this.onStrain(0); }
    this.low = this.high = 0; this.perfCooldown = 2; this.perfAcc = 0; this.perfN = 0; this.frames = []; this.queued = null;
    this.requestApply();
  }
  /** a cut in the showcase: the new place's first frames (bakes, chunks) say nothing about the pace */
  calm() { this.queued?.(); this.queued = null; this.perfCooldown = 3; this.frames = []; }
  private queued: (() => void) | null = null;
  private later(f: () => void, now: boolean) { if (now) { this.queued = null; f(); } else { this.queued = f; this.low = this.high = 0; } }
  private saved = 1;
  /** drop render scale when the frame rate sags, recover when there is headroom: down after 2 s under
      45 fps, up after 4 s over 57, and no new step up for 30 s when the last one had to be undone */
  adapt(now: number, dt: number) {
    if (this.fixed) return;
    const real = this.lastNow ? (now - this.lastNow) / 1000 : dt;
    this.lastNow = now;
    if (this.cine) {
      // the showcase holds 30 fps or more, judged by the median frame of each half second (a stall from a hidden
      // tab or a long task is not the GPU's pace). With vsync the rate snaps to 60, 30, 20…: a steady 30 is fine,
      // so it steps down only under 28 (for a second; at once under 22) and back up after three seconds over 50:
      // it settles at the sharpest picture that still holds 30
      if (real < 0.25) this.frames.push(real);
      if (now - this.perfT <= 500) return;
      this.perfT = now;
      const f = this.frames.sort((a, b) => a - b), med = f.length > 4 ? f[f.length >> 1] : 0;
      this.frames = [];
      if (!med || document.hidden || --this.perfCooldown > 0) return;
      const fps = 1 / med;
      this.low = fps < 28 ? this.low + 1 : 0;
      this.high = fps > 50 ? this.high + 1 : 0;
      // a change of sharpness mid-shot shows, so it waits for the next cut (the black beat) unless the pace is
      // really poor
      if (this.low >= 2 || fps < 22) {
        // first the resolution (down to 0.6), then lighter grass and clouds
        const step = fps < 22 ? 0.15 : 0.08;
        this.later(() => {
          if (this.dynScale > 0.6) { this.dynScale = Math.max(0.6, this.dynScale - step); this.scaleChanged(); }
          else if (this.strain < 2) { this.onStrain(++this.strain); this.low = 0; this.perfCooldown = 3; }
        }, fps < 22);
      } else if (this.high >= 6) {
        this.later(() => {
          if (this.strain > 0) { this.onStrain(--this.strain); this.high = 0; this.perfCooldown = 3; }
          else if (this.dynScale < 1) { this.dynScale = Math.min(1, this.dynScale + 0.05); this.scaleChanged(); }
        }, false);
      }
      return;
    }
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
