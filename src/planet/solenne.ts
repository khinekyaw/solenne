import * as THREE from 'three';
import { PLANET_R, GM, LATITUDE } from '../config';
import { FACE_DATA, SPAWN_FACE } from './faces';

/* =========================================================================
   Cube-sphere faces. Face +Y holds the spawn region; its flat coordinates
   (X, h, Z) are exactly the prototype's world coordinates. Each face maps
   cube point n + eu·u + ev·v to the sphere by normalisation (gnomonic),
   with flat coordinates X = u·R, Z = v·R.
   ========================================================================= */
export type Face = { n: THREE.Vector3; eu: THREE.Vector3; ev: THREE.Vector3 };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const FACES: Face[] = FACE_DATA.map((f) => ({ n: V(f[0], f[1], f[2]), eu: V(f[3], f[4], f[5]), ev: V(f[6], f[7], f[8]) }));
export { SPAWN_FACE };

/** unit direction for flat face coordinates (doubles) */
export function faceDir(fi: number, X: number, Z: number, out = new THREE.Vector3()) {
  const f = FACES[fi];
  return out.copy(f.n).multiplyScalar(PLANET_R).addScaledVector(f.eu, X).addScaledVector(f.ev, Z).normalize();
}
/** planet-fixed position of flat coordinates on a face */
export function flatToPF(fi: number, X: number, h: number, Z: number, out = new THREE.Vector3()) {
  return faceDir(fi, X, Z, out).multiplyScalar(PLANET_R + h);
}
/** face index + flat coordinates of a planet-fixed point */
export function pfToFlat(p: THREE.Vector3, fi = faceOf(p)) {
  const f = FACES[fi], dn = p.dot(f.n);
  return { face: fi, X: PLANET_R * p.dot(f.eu) / dn, Z: PLANET_R * p.dot(f.ev) / dn, h: p.length() - PLANET_R };
}
export function faceOf(p: THREE.Vector3) {
  const ax = Math.abs(p.x), ay = Math.abs(p.y), az = Math.abs(p.z);
  if (ax >= ay && ax >= az) return p.x > 0 ? 0 : 1;
  if (ay >= az) return p.y > 0 ? 2 : 3;
  return p.z > 0 ? 4 : 5;
}
/** spawn-region flat coords → planet-fixed (face +Y) */
export const regionToPF = (x: number, h: number, z: number, out = new THREE.Vector3()) => flatToPF(SPAWN_FACE, x, h, z, out);
export const pfToRegion = (p: THREE.Vector3) => pfToFlat(p, SPAWN_FACE);
export const gravityAt = (r: number) => GM / (r * r);

/* =========================================================================
   Rotation axis. A is tilted so the spawn point sits at 48° N, with north
   toward -Z and east toward +X on the spawn face. The sun direction and the
   spin itself come from Solenne's orbit (space/system.ts).
   ========================================================================= */
export const AXIS = V(0, Math.sin(LATITUDE), -Math.cos(LATITUDE));
export const MERIDIAN = V(0, Math.cos(LATITUDE), Math.sin(LATITUDE));   // equator toward the spawn meridian
export const EAST0 = new THREE.Vector3().crossVectors(AXIS, MERIDIAN);    // = +X, east at spawn

/** hour angle (radians) at the spawn meridian for a time of day in hours */
export const hourAngle = (tod: number) => (tod / 24 - 0.5) * Math.PI * 2;

/** local frame at a planet-fixed point, east parallel-transported from `prevEast` */
export function localFrame(p: THREE.Vector3, prevEast: THREE.Vector3, up: THREE.Vector3, east: THREE.Vector3, north: THREE.Vector3) {
  up.copy(p).normalize();
  east.copy(prevEast).addScaledVector(up, -prevEast.dot(up));
  if (east.lengthSq() < 1e-8) east.set(1, 0, 0).addScaledVector(up, -up.x);
  east.normalize();
  north.crossVectors(east, up);
}
