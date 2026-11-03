import * as THREE from 'three';
import { clamp } from '../core/math';
import { PLANET_R } from '../config';
import { groundH } from '../planet/heights';
import { regionToPF } from '../planet/solenne';
import { shared, frame, pfMatrix } from '../render/frame';
import { CW, CD, CT, CH, CRIDGE, DOOR_X, DOOR_W, innerX, innerZ, chZ, fx, chTop, lampL, buildCottageGeometry } from './cottageGeometry';
import { furnishCottage } from './cottageFurnish';
import { HOUSE_VS, HOUSE_FS, GLASS_VS, GLASS_FS, FLAME_VS, FLAME_FS, SMOKE_VS, SMOKE_FS } from './cottageShaders';
import { buildTripod } from '../props/telescope';

/* =========================================================================
   The cottage on the plateau. It lives in the spawn region's flat space
   (prototype coords: collision, lights, shadow map) and is drawn rigidly at
   its spot on the sphere, upright to the local vertical.
   ========================================================================= */
export const HOUSE = { x: 70.5, z: -397.5, rot: -0.86 };

export class Cottage {
  floorY: number;
  firePos: THREE.Vector3;
  wallTop: number;
  roofTop: number;
  mat: THREE.ShaderMaterial;
  meshes: THREE.Object3D[];
  L2W = new THREE.Matrix4();                 // house-local → region flat space
  scopePivot: THREE.Vector3;                 // the telescope's tube pivot, house-local
  shadowDirty = false;                       // something movable (the telescope tube) changed: re-render the shadow map
  private cs = Math.cos(HOUSE.rot);
  private sn = Math.sin(HOUSE.rot);
  private cols: number[][];
  private anchorPF = new THREE.Vector3();
  private basis = new THREE.Matrix4();
  private shadowRT: THREE.WebGLRenderTarget;
  private shadowScene = new THREE.Scene();
  private shadowCam = new THREE.OrthographicCamera(-13, 13, 13, -13, 1, 90);
  private center: THREE.Vector3;
  private lastSun = new THREE.Vector3();
  // the cottage always lives in the spawn region's frame, wherever the detail region has moved
  private spawnU = {
    uCamPos: { value: new THREE.Vector3() }, uCamRel: { value: new THREE.Vector3() },
    uRegionC: { value: new THREE.Vector2() }, uFaceToPF: { value: new THREE.Matrix3() }, uHouseOn: { value: 1 },
    uRegionToL: { value: frame.PFtoL },
  };

  constructor(terrainTex: THREE.Texture) {
    // floor sits just above the highest ground under the footprint
    let gMax = -1e9, gMin = 1e9;
    for (let u = -CW / 2 - 1; u <= CW / 2 + 1; u += 0.5) for (let v = -CD / 2 - 1; v <= CD / 2 + 1.5; v += 0.5) {
      const [x, z] = this.toWorld(u, v), h = groundH(x, z); gMax = Math.max(gMax, h); gMin = Math.min(gMin, h);
    }
    const floorY = this.floorY = gMax + 0.32;
    const gLocal = (lx: number, lz: number) => { const [x, z] = this.toWorld(lx, lz); return groundH(x, z) - floorY; };
    const plinthBot = gMin - floorY - 0.4;
    const kit = buildCottageGeometry(gLocal, plinthBot);
    const { fenceCol, wellCol } = furnishCottage(kit);
    const tripod = buildTripod(kit);
    this.scopePivot = tripod.pivot;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(kit.P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(kit.NN, 3));
    geo.setAttribute('aColor', new THREE.Float32BufferAttribute(kit.CC, 3));
    geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(kit.II, 4));
    geo.computeBoundingSphere();
    // house-local → region flat space (prototype L2W)
    const L2W = this.L2W.compose(new THREE.Vector3(HOUSE.x, floorY, HOUSE.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, HOUSE.rot, 0)), new THREE.Vector3(1, 1, 1));
    const fireLocal = new THREE.Vector3(fx + 0.32, 0.32, chZ);
    this.firePos = fireLocal.clone().applyMatrix4(L2W);
    const lampPos = new THREE.Vector3(...lampL).applyMatrix4(L2W);
    const uFlatM = { value: L2W };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: HOUSE_VS, fragmentShader: HOUSE_FS,
      uniforms: { ...shared, ...this.spawnU, uFlatM, uTerrain: { value: terrainTex }, uFirePos: { value: this.firePos }, uFireI: { value: 1.2 }, uLampPos: { value: lampPos }, uLampI: { value: 0.9 } },
    });
    const mesh = new THREE.Mesh(geo, this.mat);

    const ggeo = new THREE.BufferGeometry();
    ggeo.setAttribute('position', new THREE.Float32BufferAttribute(kit.gP, 3));
    ggeo.setAttribute('normal', new THREE.Float32BufferAttribute(kit.gN, 3));
    const glass = new THREE.Mesh(ggeo, new THREE.ShaderMaterial({
      vertexShader: GLASS_VS, fragmentShader: GLASS_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { ...shared, ...this.spawnU, uFlatM, uLampI: this.mat.uniforms.uLampI },
    }));

    // fire: crossed flame cards
    const fpos: number[] = [], fuv: number[] = [], fseed: number[] = [], fidx: number[] = [];
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 4 + 0.2, w = k ? 0.32 : 0.42, hgt = k ? 0.45 : 0.6, ox = (k % 2 ? 0.06 : -0.04), oz = (k - 1.5) * 0.12, b = fpos.length / 3;
      for (const [u, vv] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        fpos.push(fireLocal.x + ox + Math.cos(a) * (u - 0.5) * w, 0.08 + vv * hgt, fireLocal.z + oz + Math.sin(a) * (u - 0.5) * w);
        fuv.push(u, vv); fseed.push(k * 0.27);
      }
      fidx.push(b, b + 1, b + 3, b, b + 3, b + 2);
    }
    const fgeo = new THREE.BufferGeometry();
    fgeo.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
    fgeo.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
    fgeo.setAttribute('seed', new THREE.Float32BufferAttribute(fseed, 1));
    fgeo.setIndex(fidx);
    const flames = new THREE.Mesh(fgeo, new THREE.ShaderMaterial({
      vertexShader: FLAME_VS, fragmentShader: FLAME_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: shared.uTime, uWeather: shared.uWeather },
    }));

    // chimney smoke (drawn in flat space through the sphere mapping)
    const SN = 26, sseed = new Float32Array(SN * 2);
    for (let i = 0; i < SN; i++) { sseed[i * 2] = i / SN; sseed[i * 2 + 1] = kit.R(); }
    const sgeo = new THREE.InstancedBufferGeometry();
    sgeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3));
    sgeo.setIndex([0, 1, 3, 0, 3, 2]);
    sgeo.setAttribute('seed', new THREE.InstancedBufferAttribute(sseed, 2));
    sgeo.instanceCount = SN;
    const smokeTop = new THREE.Vector3(-CW / 2 - 0.3, chTop + 0.45, chZ - 0.15).applyMatrix4(L2W);
    const smoke = new THREE.Mesh(sgeo, new THREE.ShaderMaterial({
      vertexShader: SMOKE_VS, fragmentShader: SMOKE_FS, transparent: true, depthWrite: false,
      uniforms: { ...shared, ...this.spawnU, uTop: { value: smokeTop } },
    }));
    smoke.frustumCulled = false;

    for (const m of [mesh, glass, flames]) m.matrixAutoUpdate = false;
    this.meshes = [mesh, glass, flames, smoke];

    // placement on the sphere: origin at the floor point, upright to the local vertical, turned by HOUSE.rot
    regionToPF(HOUSE.x, floorY, HOUSE.z, this.anchorPF);
    const up = this.anchorPF.clone().normalize();
    const east = new THREE.Vector3(1, 0, 0).addScaledVector(up, -up.x).normalize();
    const north = new THREE.Vector3().crossVectors(east, up);
    this.basis.makeBasis(east, up, north).multiply(new THREE.Matrix4().makeRotationY(HOUSE.rot));

    // shadow map of the cottage in flat space, re-rendered only when the sun moves
    this.shadowRT = new THREE.WebGLRenderTarget(2048, 2048);
    this.shadowRT.depthTexture = new THREE.DepthTexture(2048, 2048, THREE.UnsignedIntType);
    const shadowMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    shadowMesh.matrixAutoUpdate = false; shadowMesh.matrix.copy(L2W);
    this.shadowScene.add(shadowMesh);
    this.center = new THREE.Vector3(0, 3, 1).applyMatrix4(L2W);
    shared.uHShadow.value = this.shadowRT.depthTexture;
    shared.uHouseXf.value.set(HOUSE.x, HOUSE.z, this.cs, this.sn);
    shared.uHouseRect.value.set(-CW / 2 - 0.95, CW / 2 + 0.95, -CD / 2 - 0.45, CD / 2 + 1.3);
    { const [wx, wz] = this.toWorld((wellCol[0] + wellCol[2]) / 2, (wellCol[1] + wellCol[3]) / 2); shared.uWell.value.set(wx, wz, 1.0); }

    // ---- collision (house-local AABBs: x0, z0, x1, z1) ----
    const pl = 0.16;
    this.cols = [
      [-CW / 2, CD / 2 - CT, DOOR_X - DOOR_W / 2, CD / 2], [DOOR_X + DOOR_W / 2, CD / 2 - CT, CW / 2, CD / 2],
      [-CW / 2, -CD / 2, CW / 2, -CD / 2 + CT], [CW / 2 - CT, -CD / 2, CW / 2, CD / 2], [-CW / 2, -CD / 2, -CW / 2 + CT, CD / 2],
      [-CW / 2 - pl, CD / 2, DOOR_X - 0.75, CD / 2 + pl], [DOOR_X + 0.75, CD / 2, CW / 2 + pl, CD / 2 + pl],
      [-CW / 2 - pl, -CD / 2 - pl, CW / 2 + pl, -CD / 2], [CW / 2, -CD / 2 - pl, CW / 2 + pl, CD / 2 + pl], [-CW / 2 - pl, -CD / 2 - pl, -CW / 2, CD / 2 + pl],
      [-CW / 2 - 0.86, chZ - 0.76, -CW / 2, chZ + 0.76],
      [fx, chZ - 0.86, fx + 0.56, chZ + 0.86],
      [-1.95, -0.25, -0.45, 0.65], [-1.45, -0.86, -0.95, -0.4], [-1.45, 0.8, -0.95, 1.25],
      [1.35, -innerZ, innerX, -innerZ + 1.1], [1.0, -innerZ, 1.4, -innerZ + 0.52],
      [0.1, innerZ - 0.36, 1.24, innerZ], [-3.15, -innerZ, -1.95, -innerZ + 0.62], [innerX - 0.6, 1.12, innerX, 2.38],
      [-2.98, 0.62, -2.12, 1.48], [fx + 0.12, 0.0, fx + 0.68, 0.52],
      [DOOR_X - DOOR_W / 2 - 0.12, CD / 2 - CT - 1.02, DOOR_X - DOOR_W / 2 + 0.06, CD / 2 - CT],
      [0.1, CD / 2 + 0.22, 1.4, CD / 2 + 0.62], [CW / 2, -2.6, CW / 2 + 0.75, -0.7],
      ...fenceCol, wellCol, tripod.col,
    ];
    this.wallTop = floorY + CH;
    this.roofTop = floorY + CRIDGE + 0.6;
  }
  toWorld(lx: number, lz: number): [number, number] { return [HOUSE.x + lx * this.cs + lz * this.sn, HOUSE.z - lx * this.sn + lz * this.cs]; }
  private toLocal(x: number, z: number): [number, number] { const dx = x - HOUSE.x, dz = z - HOUSE.z; return [dx * this.cs - dz * this.sn, dx * this.sn + dz * this.cs]; }

  /** push a flat-space position out of walls and furniture */
  collide(p: THREE.Vector3) {
    let [lx, lz] = this.toLocal(p.x, p.z);
    if (Math.abs(lx) > 10 || Math.abs(lz) > 10) return;
    const RAD = 0.3;
    for (let it = 0; it < 2; it++) for (const [x0, z0, x1, z1] of this.cols) {
      const cx = clamp(lx, x0, x1), cz = clamp(lz, z0, z1), dx = lx - cx, dz = lz - cz, d2 = dx * dx + dz * dz;
      if (d2 >= RAD * RAD) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (RAD - d) / d; lx += dx * k; lz += dz * k; }
      else {   // centre inside the box: push out along the shallowest side
        const pen = [lx - x0, x1 - lx, lz - z0, z1 - lz], m = Math.min(...pen), i = pen.indexOf(m);
        if (i === 0) lx = x0 - RAD; else if (i === 1) lx = x1 + RAD; else if (i === 2) lz = z0 - RAD; else lz = z1 + RAD;
      }
    }
    const dx = lx * this.cs + lz * this.sn, dz = -lx * this.sn + lz * this.cs;
    p.x = HOUSE.x + dx; p.z = HOUSE.z + dz;
  }
  floorAt(x: number, z: number) {
    const [lx, lz] = this.toLocal(x, z), f = this.floorY;
    if (Math.abs(lx) < innerX + 0.02 && Math.abs(lz) < innerZ + 0.02) return f;
    if (Math.abs(lx - DOOR_X) < DOOR_W / 2 + 0.05 && lz >= innerZ && lz <= CD / 2 + 0.02) return f;
    if (Math.abs(lx - DOOR_X) < 0.95 && lz > CD / 2 && lz < CD / 2 + 0.68) return f - 0.17;
    if (Math.abs(lx - DOOR_X) < 1.1 && lz >= CD / 2 + 0.68 && lz < CD / 2 + 1.18) return f - 0.36;
    return -1e9;
  }
  inside(p: THREE.Vector3) { const [lx, lz] = this.toLocal(p.x, p.z); return Math.abs(lx) < innerX && Math.abs(lz) < innerZ && p.y < this.floorY + CRIDGE; }

  /** another code-built piece that casts into the cottage's shadow map (its flat-space matrix is kept by reference) */
  addShadowCaster(geo: THREE.BufferGeometry, flatM: THREE.Matrix4) {
    const m = new THREE.Mesh(geo, this.shadowScene.children[0] instanceof THREE.Mesh ? this.shadowScene.children[0].material : undefined);
    m.matrixAutoUpdate = false; m.matrix = flatM;
    this.shadowScene.add(m);
  }
  /** model matrix for a mesh in house-local coordinates (local: its own placement in the house frame) */
  placeLocal(m: THREE.Object3D, local?: THREE.Matrix4) {
    pfMatrix(this.anchorPF, m.matrix, local ? this.tmpM.multiplyMatrices(this.basis, local) : this.basis);
    if (local) {   // pfMatrix puts the house origin at the anchor: add the piece's own offset in the house frame
      this.tmpV.setFromMatrixPosition(local).applyMatrix3(this.tmp3.setFromMatrix4(this.basis)).applyMatrix3(frame.PFtoL);
      const e = m.matrix.elements; e[12] += this.tmpV.x; e[13] += this.tmpV.y; e[14] += this.tmpV.z;
    }
    m.matrixWorldNeedsUpdate = true;
  }
  localDirToPF(d: THREE.Vector3, out: THREE.Vector3) { return out.copy(d).transformDirection(this.basis); }
  pfToLocalDir(d: THREE.Vector3, out: THREE.Vector3) { return out.copy(d).transformDirection(this.tmpM.copy(this.basis).transpose()); }
  private tmpM = new THREE.Matrix4();
  private tmpV = new THREE.Vector3();
  private tmp3 = new THREE.Matrix3();

  updateShadow(renderer: THREE.WebGLRenderer, sunFlat: THREE.Vector3, force = false) {
    if (!force && !this.shadowDirty && sunFlat.angleTo(this.lastSun) < 0.0015) return;
    this.lastSun.copy(sunFlat);
    this.shadowDirty = false;
    for (const c of this.shadowScene.children) c.matrixWorldNeedsUpdate = true;
    this.shadowCam.position.copy(this.center).addScaledVector(sunFlat, 45);
    this.shadowCam.lookAt(this.center);
    this.shadowCam.updateMatrixWorld();
    shared.uHShadowMat.value.multiplyMatrices(this.shadowCam.projectionMatrix, this.shadowCam.matrixWorldInverse);
    renderer.setRenderTarget(this.shadowRT);
    renderer.clear();
    renderer.render(this.shadowScene, this.shadowCam);
    renderer.setRenderTarget(null);
  }
  /** camera-relative placement every frame */
  update() {
    const near = frame.camPF.distanceTo(this.anchorPF) < 12000;
    for (const m of this.meshes) m.visible = near;
    if (!near) return;
    const c = frame.camPF;
    this.spawnU.uCamPos.value.set(PLANET_R * c.x / c.y, c.length() - PLANET_R, PLANET_R * c.z / c.y);
    this.spawnU.uCamRel.value.set(c.x, c.y - PLANET_R, c.z);
    for (const m of this.meshes.slice(0, 3)) { pfMatrix(this.anchorPF, m.matrix, this.basis); m.matrixWorldNeedsUpdate = true; }
  }
}
