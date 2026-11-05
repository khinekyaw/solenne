import * as THREE from 'three';
import { clamp } from '../core/math';
import type { CottageKit } from '../house/cottageGeometry';
import type { Cottage } from '../house/cottage';
import { HOUSE_VS, HOUSE_FS } from '../house/cottageShaders';
import { regionToPF } from '../planet/solenne';
import { frame } from '../render/frame';

/* =========================================================================
   The brass telescope on its wooden tripod in front of the cottage (M3).
   The tripod is part of the cottage's merged mesh (same shading, shadow
   map and collision); the tube is its own small mesh with the cottage's
   material, turned to wherever it was last pointed. Looking through it
   (E) narrows the field of view: look speed scales with the zoom, a clock
   drive follows whatever is centred, and a label names it.
   ========================================================================= */
export const SCOPE = { x: 3.4, z: 8.4, head: 1.18 };   // house-local tripod position, head height above ground
const FOV_MIN = 0.22, FOV_MAX = 10, FOV_START = 3.5, NAKED = 62;
const brassC = (k = 1) => new THREE.Color('#a17c46').multiplyScalar(k);   // aged brass, not new gold

/** tripod, head and accessory tray, added to the cottage kit (house-local metres) */
export function buildTripod(k: CottageKit) {
  const { add, box, cyl, PAL, gLocal } = k;
  const gy = gLocal(SCOPE.x, SCOPE.z), head = new THREE.Vector3(SCOPE.x, gy + SCOPE.head, SCOPE.z);
  const up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), m = new THREE.Matrix4();
  const strut = (a: THREE.Vector3, b: THREE.Vector3, w: number, d: number, color: THREE.Color, kind: number, grain = 1) => {
    const dir = b.clone().sub(a), len = dir.length();
    q.setFromUnitVectors(up, dir.normalize());
    add(new THREE.BoxGeometry(w, len, d), m.clone().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)), color, kind, { grain, mode: 'out' });
  };
  const feet: THREE.Vector3[] = [], knees: THREE.Vector3[] = [], legC = new THREE.Color('#7a5536');
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2 + 0.4, fx = SCOPE.x + Math.cos(a) * 0.62, fz = SCOPE.z + Math.sin(a) * 0.62;
    const foot = new THREE.Vector3(fx, gLocal(fx, fz), fz), top = head.clone().add(new THREE.Vector3(Math.cos(a) * 0.07, -0.04, Math.sin(a) * 0.07));
    strut(top, foot, 0.055, 0.036, legC, 1);
    cyl(foot.x, foot.y + 0.04, foot.z, 0.022, 0.03, 0.08, 6, brassC(0.8), 7, { mode: 'out' });   // brass ferrule
    feet.push(foot); knees.push(top.clone().lerp(foot, 0.55));
  }
  // a little triangular tray between the legs, with the eyepiece box on it
  for (let i = 0; i < 3; i++) strut(knees[i], knees[(i + 1) % 3], 0.03, 0.02, PAL.woodDark, 1);
  const tc = knees[0].clone().add(knees[1]).add(knees[2]).multiplyScalar(1 / 3);
  cyl(tc.x, tc.y + 0.01, tc.z, 0.2, 0.2, 0.02, 3, PAL.woodLight, 1, { grain: 2, mode: 'out', ry: 0.4 });
  box(tc.x + 0.03, tc.y + 0.06, tc.z, 0.16, 0.08, 0.1, PAL.woodDark, 1, { grain: 1, mode: 'out', ry: 0.7 });
  // brass head and the post the tube turns on
  cyl(head.x, head.y, head.z, 0.1, 0.11, 0.07, 14, brassC(), 7, { mode: 'out' });
  cyl(head.x, head.y + 0.08, head.z, 0.032, 0.04, 0.12, 10, brassC(0.85), 7, { mode: 'out' });
  return { pivot: head.clone().add(new THREE.Vector3(0, 0.2, 0)), col: [SCOPE.x - 0.5, SCOPE.z - 0.5, SCOPE.x + 0.5, SCOPE.z + 0.5] };
}

/** the moving tube, built along +z around the pivot (house-local metres, cottage vertex format) */
function buildTube() {
  const P: number[] = [], N: number[] = [], C: number[] = [], I: number[] = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3(), m = new THREE.Matrix4();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Matrix4, col: THREE.Color, kind: number, grain = 0) => {
    const g = geo.index ? geo.toNonIndexed() : geo, pa = g.attributes.position, na = g.attributes.normal;
    nm.getNormalMatrix(mat);
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(mat); n.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
      P.push(v.x, v.y, v.z); N.push(n.x, n.y, n.z); C.push(col.r, col.g, col.b); I.push(kind, grain, 0, 1);
    }
  };
  const along = (z: number, y = 0) => m.clone().makeRotationX(Math.PI / 2).setPosition(0, y, z);
  const tube = (z0: number, z1: number, r0: number, r1: number, col: THREE.Color, kind: number, y = 0, seg = 20) =>
    add(new THREE.CylinderGeometry(r1, r0, z1 - z0, seg, 1, false), along((z0 + z1) / 2, y), col, kind);
  const brass = brassC(), dark = new THREE.Color('#3a2a1e'), glass = new THREE.Color('#14232c');
  tube(-0.42, 0.78, 0.062, 0.066, brass, 7);                        // main tube, tapering a little toward the eyepiece
  // dew shield: a hollow hood (outer wall, rim, inner wall) with the objective recessed inside it;
  // no two surfaces share a plane, so nothing z-fights at the front of the tube
  add(new THREE.LatheGeometry([new THREE.Vector2(0.084, 0), new THREE.Vector2(0.084, 0.3), new THREE.Vector2(0.077, 0.3), new THREE.Vector2(0.077, 0.012)], 24),
    along(0.72), brassC(0.9), 7);
  tube(0.785, 0.8, 0.0765, 0.0765, glass, 7);                       // objective lens, deep in the hood
  for (const z of [-0.2, 0.25, 0.6]) tube(z, z + 0.035, 0.071, 0.071, dark, 1);   // dark-wood bands
  tube(-0.08, 0.08, 0.075, 0.075, brassC(0.75), 7);                 // collar on the trunnion
  tube(-0.62, -0.4, 0.034, 0.038, brassC(0.85), 7, 0, 12);          // focuser draw tube (its front end sits inside the tube)
  tube(-0.74, -0.6, 0.022, 0.026, dark, 1, 0, 10);                  // eyepiece (pushed into the focuser)
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12), m.clone().makeRotationZ(Math.PI / 2).setPosition(0.045, 0, -0.5), brassC(0.7), 7);   // focus knob
  // finder scope on two little brackets
  tube(-0.2, 0.22, 0.018, 0.02, brassC(0.9), 7, 0.115, 10);
  for (const z of [-0.12, 0.14]) add(new THREE.BoxGeometry(0.014, 0.05, 0.014), m.clone().makeTranslation(0, 0.088, z), brassC(0.8), 7);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(C, 3));
  geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(I, 4));
  geo.computeBoundingSphere();
  return geo;
}

export class Telescope {
  active = false;
  fov = FOV_START;
  yaw = 0; pitch = 0.4;              // view angles in the local frame while looking through it
  mesh: THREE.Mesh;
  /** where the tube points (planet-fixed) */
  aimPF = new THREE.Vector3();
  pivotPF = new THREE.Vector3();
  private pivotFlat = new THREE.Vector3();
  private local = new THREE.Matrix4();
  private flatM = new THREE.Matrix4();
  private tYaw = 0; private tPitch = 0.4;   // where the mouse wants the tube; the brass follows with a little weight
  private idle = 0;
  private aimed = false;
  slewing = false;           // a GoTo swing in progress: slower, smoother follow

  constructor(private cottage: Cottage, readonly pivotLocal: THREE.Vector3) {
    const geo = buildTube();
    const mat = new THREE.ShaderMaterial({ vertexShader: HOUSE_VS, fragmentShader: HOUSE_FS, uniforms: { ...cottage.mat.uniforms, uFlatM: { value: this.flatM }, uHouseOn: { value: 0 } } });   // casts into the cottage's shadow map, but its 1.3 cm texels are too coarse for the tube to receive
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.matrixAutoUpdate = false;
    this.pivotFlat.copy(pivotLocal).applyMatrix4(cottage.L2W);
    regionToPF(this.pivotFlat.x, this.pivotFlat.y, this.pivotFlat.z, this.pivotPF);
    cottage.addShadowCaster(geo, this.flatM);
    // parked pointing up over the cloud sea, away from the house
    this.aimLocal(new THREE.Vector3(0.35, 0.6, 1).normalize());
  }
  /** the mouse or the knobs moved it just now (the drive waits) */
  get handsOn() { return this.idle <= 0.3; }
  get magnification() { return Math.tan(THREE.MathUtils.degToRad(NAKED / 2)) / Math.tan(THREE.MathUtils.degToRad(this.fov / 2)); }
  /** in reach: within a couple of metres of the tripod and roughly facing it */
  near(flat: THREE.Vector3, fwdFlatX: number, fwdFlatZ: number) {
    const dx = this.pivotFlat.x - flat.x, dz = this.pivotFlat.z - flat.z, d = Math.hypot(dx, dz);
    return d < 2.4 && (d < 0.8 || (dx * fwdFlatX + dz * fwdFlatZ) / d > 0.35);
  }
  /** step up to the eyepiece: the view starts where the tube points */
  enter() {
    this.active = true; this.mesh.visible = false; this.idle = 1;   // hands are off the mouse until it moves
    this.point(this.aimL(new THREE.Vector3()));
  }
  /** swing straight to a direction in the local frame (like a hand on the tube: the drive lets go, then holds the new spot) */
  point(d: THREE.Vector3) { this.yaw = this.tYaw = Math.atan2(-d.x, -d.z); this.pitch = this.tPitch = Math.asin(clamp(d.y, -1, 1)); this.idle = 0; }
  leave() { this.active = false; this.mesh.visible = true; this.cottage.shadowDirty = true; }
  look(dx: number, dy: number, s = 0.0022) {
    const k = s / this.magnification;   // the same hand movement crosses the same share of the view at any zoom
    this.tYaw -= dx * k; this.tPitch = clamp(this.tPitch - dy * k, -0.15, 1.55);
    this.idle = 0; this.slewing = false;
  }
  zoom(f: number) { this.fov = clamp(this.fov * f, FOV_MIN, FOV_MAX); }
  /** slow-motion knobs (arrow keys): a third of the field per second, three times that with Shift */
  nudge(dx: number, dy: number, dt: number, fast: boolean) {
    if (!dx && !dy) return;
    const r = THREE.MathUtils.degToRad(this.fov) * 0.35 * (fast ? 3 : 1) * dt;
    this.tYaw -= dx * r; this.tPitch = clamp(this.tPitch + dy * r, -0.15, 1.55);
    this.idle = 0; this.slewing = false;
  }
  /** GoTo: swing the mount to a direction (local frame); the clock drive takes over when it arrives */
  goto(d: THREE.Vector3) {
    this.tYaw = Math.atan2(-d.x, -d.z); this.tPitch = clamp(Math.asin(clamp(d.y, -1, 1)), -0.15, 1.55);
    this.slewing = true; this.idle = 1;
  }
  /** follow the mouse with a little inertia; the clock drive keeps a centred body in view */
  update(dt: number, track: THREE.Vector3 | null) {
    if (!this.active) return;
    this.idle += dt;
    if (track && this.idle > 0.3 && !this.slewing) {   // hands off the mouse: the drive takes over (fast enough for a 600× sky)
      const dyaw = Math.atan2(-track.x, -track.z), dpitch = Math.asin(clamp(track.y, -1, 1)), k = 1 - Math.exp(-dt * 8);
      this.tYaw += Math.atan2(Math.sin(dyaw - this.tYaw), Math.cos(dyaw - this.tYaw)) * k;
      this.tPitch += (dpitch - this.tPitch) * k;
    }
    const k = 1 - Math.exp(-dt * (this.slewing ? 3.5 : 14));
    if (this.slewing && Math.hypot(Math.atan2(Math.sin(this.tYaw - this.yaw), Math.cos(this.tYaw - this.yaw)) * Math.cos(this.pitch), this.tPitch - this.pitch) < THREE.MathUtils.degToRad(this.fov) * 0.03) this.slewing = false;
    this.yaw += Math.atan2(Math.sin(this.tYaw - this.yaw), Math.cos(this.tYaw - this.yaw)) * k;
    this.pitch += (this.tPitch - this.pitch) * k;
    // the tube follows the view (planet-fixed), for when you step back
    const cp = Math.cos(this.pitch);
    const dL = new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    this.aimPF.copy(dL).applyMatrix3(frame.LtoPF).normalize();
    this.aimed = false;
  }
  /** camera-relative placement of the tube, every frame */
  place() {
    if (!this.aimed) { this.aimLocal(this.cottage.pfToLocalDir(this.aimPF, new THREE.Vector3())); }
    this.cottage.placeLocal(this.mesh, this.local);
  }
  private aimLocal(dir: THREE.Vector3) {
    this.local.lookAt(dir, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)).setPosition(this.pivotLocal);
    this.flatM.multiplyMatrices(this.cottage.L2W, this.local);
    this.cottage.localDirToPF(dir, this.aimPF);
    this.aimed = true;
  }
  private aimL(out: THREE.Vector3) { return out.copy(this.aimPF).applyMatrix3(frame.PFtoL); }
}
