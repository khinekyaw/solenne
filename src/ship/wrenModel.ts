import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MODEL_VS, MODEL_FS, MODEL_GLASS_FS, MODEL_GLOW_FS, MODEL_DEPTH_FS } from './wrenShaders';

/* =========================================================================
   The Wren's outside: the Blender model (art/wren → public/models/wren.glb)
   in ship-local metres like the rest of the ship (x port, y up, z nose).
   Each primitive gets a game shader by its material's name; the nodes that
   move (the ramp-door, its foot, the legs) keep their transforms in the
   model's graph, and every mesh is drawn with its node's matrix (uNodeM:
   ship-local metres, for the ship's own shadow map and lamps), placed on the
   sphere like the rest of the ship.
   ========================================================================= */
export const WREN_GLB = '/models/wren.glb';
export const LEG_NODES = ['LegFrontPort', 'LegFrontStbd', 'LegRearPort', 'LegRearStbd'];   // in wrenShape.LEGS order

export type WrenPart = { mesh: THREE.Mesh; src: THREE.Object3D; local: { value: THREE.Matrix4 }; depth: THREE.Mesh | null };
export type WrenModel = { root: THREE.Object3D; parts: WrenPart[]; ramp: THREE.Object3D; foot: THREE.Object3D; legs: THREE.Object3D[] };

// lamp materials: kind (0 porthole, 1 Halden's eye, 2 cool light) and colour, as the code-built lamps had
const GLOW: Record<string, [number, string]> = { wren_glow_warm: [0, '#ffc879'], wren_glow_eye: [1, '#ffc879'], wren_glow_cool: [2, '#a9e4ff'] };

export async function loadWrenModel(common: Record<string, THREE.IUniform>, lamps: Record<string, THREE.IUniform>): Promise<WrenModel> {
  const gltf = await new GLTFLoader().loadAsync(WREN_GLB);
  const root = gltf.scene, srcs: THREE.Mesh[] = [], parts: WrenPart[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) srcs.push(o as THREE.Mesh); });
  for (const src of srcs) {
    const m = src.material as THREE.MeshStandardMaterial, local = { value: new THREE.Matrix4() };
    const uniforms = { ...common, uNodeM: local };
    let mat: THREE.ShaderMaterial, castsShadow = true;
    if (m.name === 'wren_glass') {
      mat = new THREE.ShaderMaterial({ vertexShader: MODEL_VS, fragmentShader: MODEL_GLASS_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms });
      castsShadow = false;   // sunlight falls through the canopy and the dome
    } else if (m.name in GLOW) {
      const [k, c] = GLOW[m.name];
      mat = new THREE.ShaderMaterial({ vertexShader: MODEL_VS, fragmentShader: MODEL_GLOW_FS, uniforms: { ...uniforms, uGlowK: { value: k }, uGlowC: { value: new THREE.Color(c) }, uEye: lamps.uEye, uThrust: lamps.uThrust } });
    } else {
      const orm = m.aoMap ?? m.roughnessMap;
      for (const t of [m.map, m.normalMap, orm]) if (t) t.anisotropy = 8;   // crisp plates and rivets at grazing angles
      mat = new THREE.ShaderMaterial({ vertexShader: MODEL_VS, fragmentShader: MODEL_FS, uniforms: { ...uniforms, uAlb: { value: m.map }, uNrm: { value: m.normalMap }, uOrm: { value: orm }, uLampP: lamps.uLampP, uLampC: lamps.uLampC } });
    }
    const mesh = new THREE.Mesh(src.geometry, mat);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    if (mat.transparent) mesh.renderOrder = 2;
    let depth: THREE.Mesh | null = null;
    if (castsShadow) {
      depth = new THREE.Mesh(src.geometry, new THREE.ShaderMaterial({ vertexShader: MODEL_VS, fragmentShader: MODEL_DEPTH_FS, uniforms: { uNodeM: local } }));
      depth.matrixAutoUpdate = false;
    }
    parts.push({ mesh, src, local, depth });
  }
  const node = (n: string) => { const o = root.getObjectByName(n); if (!o) throw new Error(`wren.glb: no node ${n}`); return o; };
  return { root, parts, ramp: node('Ramp'), foot: node('RampFoot'), legs: LEG_NODES.map(node) };
}
