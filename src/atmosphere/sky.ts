import * as THREE from 'three';
import { clamp, smoothstep } from '../core/math';
import { shared, frame } from '../render/frame';
import { CLOUD_VS, CLOUD_FS, BG_VS, BG_FS } from './skyShaders';
import { PLANET_R, type Quality } from '../config';

/* =========================================================================
   Sky + clouds pass: raymarched into a half-float target at reduced
   resolution, blended with the previous frame (reprojected by view
   direction in planet-fixed axes, since the local frame turns as you move).
   A second target carries how much of the sky's far side shows through
   clouds and fog, for the planets and moons drawn in the background pass.
   ========================================================================= */
type FarTex = { maps: THREE.Texture; rings: THREE.Texture; uniforms: Record<string, THREE.IUniform> };
export class Sky {
  rts: THREE.WebGLMultipleRenderTargets[];
  mat: THREE.ShaderMaterial;
  bgMat: THREE.ShaderMaterial;
  bg: THREE.Mesh;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private idx = 0;
  private frameNo = 0;
  historyValid = false;
  private prevVP = new THREE.Matrix4();
  private lastCam = new THREE.Vector3();
  private m4 = new THREE.Matrix4();

  constructor(tex: { shape: THREE.Texture; detail: THREE.Texture; terrain: THREE.Texture }, far: FarTex) {
    this.rts = [0, 1].map(() => {
      const t = new THREE.WebGLMultipleRenderTargets(64, 64, 2, { type: THREE.HalfFloatType, depthBuffer: false });
      for (const x of t.texture) x.minFilter = x.magFilter = THREE.LinearFilter;
      return t;
    });
    this.mat = new THREE.ShaderMaterial({
      vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS, depthTest: false, depthWrite: false, glslVersion: THREE.GLSL3,
      uniforms: {
        ...shared, uOccL: far.uniforms.uOccL, uHistoryVis: { value: null },
        uShape: { value: tex.shape }, uDetail: { value: tex.detail }, uTerrain: { value: tex.terrain },
        uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
        uSteps: { value: 96 }, uStepK: { value: 0.022 },
        uHistory: { value: null }, uPrevVP: { value: new THREE.Matrix4() }, uBlend: { value: 1 }, uFrame: { value: 0 },
        uRegionL: { value: new THREE.Vector3() }, uRegionUpL: { value: new THREE.Vector3(0, 1, 0) }, uShellK: { value: 0 }, uFlatK: { value: 1 }, uDbg: { value: 7 },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
    this.bgMat = new THREE.ShaderMaterial({
      vertexShader: BG_VS, fragmentShader: BG_FS, depthTest: false, depthWrite: false,
      uniforms: {
        ...far.uniforms, uBodyTex: { value: far.maps }, uRingTex: { value: far.rings }, uPxAng: { value: 0.001 }, uTime: shared.uTime,
        uBg: { value: this.rts[0].texture[0] }, uVis: { value: this.rts[0].texture[1] }, uRes: { value: new THREE.Vector2(1, 1) },
        uInvProj: this.mat.uniforms.uInvProj, uCamWorld: this.mat.uniforms.uCamWorld, uLtoStar: { value: new THREE.Matrix3() },
      },
    });
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bgMat);
    this.bg.frustumCulled = false;
    this.bg.renderOrder = -10;
  }
  get texture() { return this.rts[this.idx].texture[0]; }
  applyQuality(q: Quality, W: number, H: number) {
    for (const t of this.rts) t.setSize(Math.max(64, Math.floor(W * q.cloud)), Math.max(64, Math.floor(H * q.cloud)));
    this.historyValid = false;
    this.mat.uniforms.uSteps.value = q.steps;
    this.mat.uniforms.uStepK.value = q.stepK;
    this.bgMat.uniforms.uRes.value.set(W, H);
  }
  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, dt: number, skyRotPF: THREE.Matrix3) {
    const u = this.mat.uniforms;
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    // spawn plateau centre (flat 0,0 at the datum) for the prototype's tower exclusion
    u.uRegionL.value.set(-frame.camPF.x, PLANET_R - frame.camPF.y, -frame.camPF.z).applyMatrix3(frame.PFtoL);
    u.uRegionUpL.value.set(0, 1, 0).applyMatrix3(frame.PFtoL);
    u.uShellK.value = smoothstep(1800, 4500, frame.alt);
    u.uFlatK.value = 1 - smoothstep(600, 3000, frame.alt);
    this.bgMat.uniforms.uLtoStar.value.multiplyMatrices(skyRotPF, frame.LtoPF);
    this.bgMat.uniforms.uPxAng.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / this.bgMat.uniforms.uRes.value.y;

    const cur = this.rts[this.idx], prev = this.rts[1 - this.idx];
    const moved = frame.camPF.distanceTo(this.lastCam) / Math.max(dt, 1e-3);
    this.lastCam.copy(frame.camPF);
    u.uHistory.value = prev.texture[0]; u.uHistoryVis.value = prev.texture[1];
    u.uPrevVP.value.copy(this.prevVP);
    u.uBlend.value = this.historyValid ? clamp(0.12 + moved * 0.012 + shared.uFlash.value * 2.0, 0.12, 1) : 1;
    u.uFrame.value = this.frameNo++;
    renderer.setRenderTarget(cur);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(null);
    this.bgMat.uniforms.uBg.value = cur.texture[0]; this.bgMat.uniforms.uVis.value = cur.texture[1];
    // previous view-projection of planet-fixed directions: proj · viewRot · (PF → L)
    this.m4.copy(camera.matrixWorldInverse).setPosition(0, 0, 0).multiply(frame.PFtoL4);
    this.prevVP.multiplyMatrices(camera.projectionMatrix, this.m4);
    this.idx = 1 - this.idx;
    this.historyValid = true;
    return cur.texture[0];
  }
}
