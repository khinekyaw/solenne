import * as THREE from 'three';
import { QUALITY } from '../config';
import { mulberry32 } from '../core/math';
import { settings } from '../settings';
import { shared, frame } from '../render/frame';
import { GRASS_VS, GRASS_FS, FLOWER_VS, FLOWER_FS, MOTE_VS, MOTE_FS } from './grassShaders';

/* Grass rings, dandelions and pollen motes (prototype), with the camera's flat-space cell grid. */
function makeBladeGeo(segments: number) {
  const p: number[] = [];
  for (let k = 0; k < segments; k++) { const t = k / segments; p.push(-1, t, 0, 1, t, 0); }
  p.push(0, 1, 0);
  const ind: number[] = [];
  for (let k = 0; k < segments - 1; k++) { const a = k * 2; ind.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  const a = (segments - 1) * 2; ind.push(a, a + 1, a + 2);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(ind);
  return g;
}

export class Nature {
  grassNear: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  grassFar: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  flowers: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  motes: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private fwd = new THREE.Vector3();
  private toFace = new THREE.Matrix3();

  /** uHeight / uTerrain are the detail region's uniform slots, swapped when the region moves */
  constructor(uHeight: { value: THREE.Texture }, uTerrain: { value: THREE.Texture }) {
    const makeGrass = (segments: number, widthS: number, heightS: number) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: GRASS_VS, fragmentShader: GRASS_FS, side: THREE.DoubleSide,
        uniforms: {
          ...shared,
          uHeight, uTerrain,
          uCamCell: { value: new THREE.Vector2() }, uSpacing: { value: 0.1 }, uN: { value: 1 },
          uRadius: { value: 20 }, uInner: { value: 0 }, uWidthS: { value: widthS }, uHeightS: { value: heightS },
          uCamFwd: { value: new THREE.Vector3() },
        },
      });
      const m = new THREE.Mesh(makeBladeGeo(segments), mat);
      m.frustumCulled = false;
      return m;
    };
    this.grassNear = makeGrass(4, 1.0, 1.0);
    this.grassFar = makeGrass(2, 2.3, 1.15);

    const fgeo = new THREE.InstancedBufferGeometry();
    fgeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], 3));
    fgeo.setIndex([0, 1, 3, 0, 3, 2]);
    this.flowers = new THREE.Mesh(fgeo, new THREE.ShaderMaterial({
      vertexShader: FLOWER_VS, fragmentShader: FLOWER_FS, side: THREE.DoubleSide, alphaToCoverage: true,
      uniforms: { ...shared, uHeight, uTerrain, uCamCell: { value: new THREE.Vector2() }, uSpacing: { value: 0.8 }, uN: { value: 1 }, uRadius: { value: 40 }, uGrassH: { value: 1 } },
    }));
    this.flowers.frustumCulled = false;

    const MC = 520, seeds = new Float32Array(MC * 4), mr = mulberry32(99);
    for (let i = 0; i < MC * 4; i++) seeds[i] = mr();
    const mgeo = new THREE.BufferGeometry();
    mgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MC * 3), 3));
    mgeo.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
    this.motes = new THREE.Points(mgeo, new THREE.ShaderMaterial({
      vertexShader: MOTE_VS, fragmentShader: MOTE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...shared, uPx: { value: 600 } },
    }));
    this.motes.frustumCulled = false;
  }
  get meshes() { return [this.grassNear, this.grassFar, this.flowers, this.motes]; }

  applyQuality(Hpx: number, fov: number) {
    const q = QUALITY[settings.quality];
    this.applyGrass();
    const flS = 0.8, flN = Math.ceil((2 * q.flowersR) / flS) + 2, fu = this.flowers.material.uniforms;
    fu.uSpacing.value = flS; fu.uN.value = flN; fu.uRadius.value = q.flowersR;
    this.flowers.geometry.instanceCount = flN * flN;
    this.motes.material.uniforms.uPx.value = Hpx / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
  }
  /** returns a readout of the blade count */
  applyGrass() {
    const q = QUALITY[settings.quality];
    const k = 1 / Math.sqrt(settings.grassDensity / 100);
    const nr = q.near[0], fr = q.far[0], ns = q.near[1] * k, fs = q.far[1] * k;
    const nN = Math.min(1500, Math.ceil((2 * nr) / ns) + 2), fN = Math.min(1500, Math.ceil((2 * fr) / fs) + 2);
    const nu = this.grassNear.material.uniforms, fu = this.grassFar.material.uniforms;
    nu.uSpacing.value = ns; nu.uN.value = nN; nu.uRadius.value = nr; nu.uInner.value = 0;
    fu.uSpacing.value = fs; fu.uN.value = fN; fu.uRadius.value = fr; fu.uInner.value = nr;
    this.grassNear.geometry.instanceCount = nN * nN;
    this.grassFar.geometry.instanceCount = fN * fN;
    const hs = settings.grassHeight / 100;
    nu.uHeightS.value = hs; fu.uHeightS.value = 1.15 * hs;
    this.flowers.material.uniforms.uGrassH.value = hs;
    return Math.PI * nr * nr / (ns * ns) + Math.PI * (fr * fr - nr * nr) / (fs * fs);
  }
  /** camera flat coords on the region's face and its forward direction in the local frame */
  update(camFlat: THREE.Vector3, camFwdL: THREE.Vector3, on: boolean) {
    this.toFace.copy(shared.uFaceToPF.value).transpose();
    this.fwd.copy(camFwdL).applyMatrix3(frame.LtoPF).applyMatrix3(this.toFace);
    for (const g of [this.grassNear, this.grassFar, this.flowers]) {
      g.visible = on;
      const u = g.material.uniforms;
      u.uCamCell.value.set(Math.floor(camFlat.x / u.uSpacing.value), Math.floor(camFlat.z / u.uSpacing.value));
      if (u.uCamFwd) u.uCamFwd.value.copy(this.fwd);
    }
  }
}
