import * as THREE from 'three';
import { PLANET_R } from '../config';
import { localFrame } from '../planet/solenne';

/* =========================================================================
   Floating origin. The GPU only ever sees the local frame L: origin at the
   camera, y = local up, x = east parallel-transported from the last frame.
   All placement math happens here in float64 before the upload.
   ========================================================================= */
export const frame = {
  camPF: new THREE.Vector3(0, PLANET_R + 30, 0),
  up: new THREE.Vector3(0, 1, 0), east: new THREE.Vector3(1, 0, 0), north: new THREE.Vector3(0, 0, 1),
  LtoPF: new THREE.Matrix3(), PFtoL: new THREE.Matrix3(),
  PFtoL4: new THREE.Matrix4(),
  alt: 30,
  sunPF: new THREE.Vector3(0, 1, 0), sunL: new THREE.Vector3(0, 1, 0),
};

export const shared = {
  uSunDir: { value: frame.sunPF }, uSunDirL: { value: frame.sunL }, uSunDirF: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color() }, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
  uCamPos: { value: new THREE.Vector3() }, uCamPF: { value: new THREE.Vector3() }, uLtoPF: { value: frame.LtoPF },
  uCenterL: { value: new THREE.Vector3(0, -PLANET_R, 0) }, uCamAlt: { value: 0 },
  // active detail region (see planet/detail.ts): centre, face axes, camera relative to its centre
  uRegionC: { value: new THREE.Vector2() }, uFaceToPF: { value: new THREE.Matrix3() }, uHouseOn: { value: 1 },
  uCamRel: { value: new THREE.Vector3() }, uRegionToL: { value: new THREE.Matrix3() },
  uCamBox: { value: new THREE.Vector3() },   // camera motion integrated in the local frame (world-locked rain/mote boxes)
  uTime: { value: 0 },
  uCloudOff: { value: new THREE.Vector3() }, uCover: { value: 0 }, uClouds: { value: 0.5 }, uDark: { value: 0 }, uFog: { value: 0 }, uWet: { value: 0 }, uFlash: { value: 0 }, uNight: { value: 0 }, uMoonlit: { value: 0 },
  uWindPhase: { value: 0 }, uSwayPhase: { value: 0 },
  uWeather: { value: null as THREE.Texture | null }, uLand: { value: null as THREE.Texture | null }, uLandTop: { value: null as THREE.Texture | null },
  uWindDir: { value: new THREE.Vector2(0.86, 0.5).normalize() }, uWindStr: { value: 0.55 },
  uHShadow: { value: null as THREE.Texture | null }, uHShadowMat: { value: new THREE.Matrix4() },
  uHouseXf: { value: new THREE.Vector4(1e5, 1e5, 1, 0) }, uHouseRect: { value: new THREE.Vector4(0, 0, 0, 0) },
  uWell: { value: new THREE.Vector3(1e5, 1e5, 0) },   // the cottage well: flat x, z, radius (no grass inside)
  // the Wren: its own shadow map, and where it stands (flat x, z, cos, sin of its heading; ground height)
  uSShadow: { value: null as THREE.Texture | null }, uSShadowMat: { value: new THREE.Matrix4() },
  uShipXf: { value: new THREE.Vector4(1e5, 1e5, 1, 0) }, uShipY: { value: 0 },
  uWash: { value: new THREE.Vector4(1e5, 1e5, 0, 1) },   // her lift jets' downwash on the grass: flat x, z, strength, radius
  uCine: { value: 0 },   // 1 while the showcase is exported in cinema detail: fine shading the game leaves out
};

const tmp = new THREE.Vector3();
/** rebuild L at the camera's planet-fixed position */
export function updateFrame(camPF: THREE.Vector3) {
  frame.camPF.copy(camPF);
  localFrame(camPF, frame.east, frame.up, frame.east, frame.north);
  const e = frame.east, u = frame.up, n = frame.north;
  frame.LtoPF.set(e.x, u.x, n.x, e.y, u.y, n.y, e.z, u.z, n.z);
  frame.PFtoL.copy(frame.LtoPF).transpose();
  frame.PFtoL4.setFromMatrix3(frame.PFtoL);
  frame.alt = camPF.length() - PLANET_R;
  shared.uCamPF.value.copy(camPF);
  shared.uCenterL.value.set(0, -(PLANET_R + frame.alt), 0);
  shared.uCamAlt.value = frame.alt;
  frame.sunL.copy(frame.sunPF).applyMatrix3(frame.PFtoL);
}
/** model matrix for something placed at a planet-fixed point with planet-fixed axes */
export function pfMatrix(originPF: THREE.Vector3, out: THREE.Matrix4, basis?: THREE.Matrix4) {
  tmp.copy(originPF).sub(frame.camPF).applyMatrix3(frame.PFtoL);
  out.copy(frame.PFtoL4);
  if (basis) out.multiply(basis);
  out.setPosition(tmp);
  return out;
}
/** camera near/far from the height above ground: keeps 24-bit depth precise from grass blades to orbit */
export function depthRange(agl: number, alt: number) {
  const near = Math.min(Math.max(0.08, agl * 0.004), 200);
  const r = PLANET_R + Math.max(alt, -700), rMin = PLANET_R - 780, rMax = PLANET_R + 1700;
  const horizon = Math.sqrt(Math.max(r * r - rMin * rMin, 0)) + Math.sqrt(rMax * rMax - rMin * rMin);
  return { near, far: Math.max(6000, horizon * 1.05) };
}
