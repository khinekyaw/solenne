import * as THREE from 'three';
import { clamp, smoothstep } from '../core/math';
import { EYE, HALF, PLANET_R, WATER } from '../config';
import { groundH, heightAtDir } from '../planet/heights';
import { regionToPF, pfToRegion } from '../planet/solenne';
import { shared, frame, pfMatrix } from '../render/frame';
import type { Cottage } from '../house/cottage';
import { buildWren, type Box, type Glow } from './wrenGeometry';
import { SHIP_VS, SHIP_FS, GLOW_VS, GLOW_FS, JET_VS, JET_FS, SHIP_DEPTH_FS } from './wrenShaders';
import { HULL, halfWidthAt, bellyAt, DECK, LOWER_Z, UPPER_Z, STAIRS, HOLE, LADDER, DOME, DOOR, RAMP, LEGS, POD, THRUSTER_Z, hullYc, floorHalf } from './wrenShape';
import { loadWrenModel, type WrenModel } from './wrenModel';

/* =========================================================================
   The Wren. The outside is the Blender model (wrenModel.ts), the inside is
   code-built (wrenGeometry): both in ship-local metres (x port, y up, z
   nose). The ship has a pose (planet-fixed position of the ground point
   under its hull, and an orientation), so it can stand anywhere or fly
   (flight.ts); everything that belongs to it lives in its own frame: the
   shaders (local frame lighting), its shadow map, its lamps, walking aboard
   (floors, stairs, ladder, ramp, collision boxes). Parked in the lower meadow
   south-east of the cottage hill at the start, nose toward home. The ramp is the door: it folds and seals
   the doorway (setDoor); the legs fold for flight (setGear).
   ========================================================================= */
export const WREN_SITE = { x: 138, z: -238, rot: -157 * Math.PI / 180 };   // the lower meadow, south-east of the cottage hill, nose toward home
const PILOT = new THREE.Vector3(0.9, DECK.upper + 1.8, 9.45);   // the pilot's eye, port seat, sitting up to see over the instruments

/** ground altitude under a planet-fixed point: the home region's grid near the cottage, the planet elsewhere; water floats */
export function groundAlt(p: THREE.Vector3) {
  const X = PLANET_R * p.x / p.y, Z = PLANET_R * p.z / p.y;
  if (p.y > 0 && Math.max(Math.abs(X), Math.abs(Z)) < HALF - 25) return Math.max(groundH(X, Z), WATER);
  const l = p.length();
  return Math.max(heightAtDir(p.x / l, p.y / l, p.z / l), WATER);
}

export class Wren {
  meshes: THREE.Object3D[];
  mat: THREE.ShaderMaterial;
  readonly groundY: number;           // the home site's ground (flat altitude)
  /* pose: the ground point under the hull (planet-fixed) and the ship's axes in planet-fixed coordinates */
  readonly pos = new THREE.Vector3();
  readonly rot = new THREE.Matrix4();
  readonly home = { pos: new THREE.Vector3(), rot: new THREE.Matrix4() };
  parked = true;                      // standing on its legs (else flying)
  private rotInv = new THREE.Matrix4();
  get anchor() { return this.pos; }
  private boxes: Box[];
  private legBoxes: Box[] = [];
  private rampY = (x: number) => DECK.lower - (x - RAMP.x0) * Math.tan(this.rampAng);
  private rampRun = RAMP.len;
  private rampAng = 0.45;
  private legY = [0, 0, 0, 0];        // each foot's ground, relative to the ship's origin
  private legBase: number[] = [];     // the leg nodes' heights in the model
  private group = new THREE.Group();
  private model: WrenModel | null = null;
  private doorT = 0;                  // 0 parked (ramp down), 1 closed for flight
  private doorGoal = 0;
  private gearT = 1;                  // 1 legs down, 0 folded under the belly
  private gearGoal = 1;
  private lastT = -1;
  private shadowDirty = true;
  private shadowRT: THREE.WebGLRenderTarget;
  private shadowScene = new THREE.Scene();
  private shadowCam = new THREE.OrthographicCamera(-22, 22, 22, -22, 1, 140);
  private center = new THREE.Vector3(0, 5.5, -0.5);
  private sunShip = new THREE.Vector3();
  private lastSun = new THREE.Vector3();
  private uShipShadowL = { value: new THREE.Matrix4() };
  private uCamShip = { value: new THREE.Vector3() };
  readonly uThrust = { value: 0 };
  private uLift = { value: 0 };       // the lift jets under the pods: thrust, near the ground
  private padGlow: THREE.Mesh;
  private glowMat: THREE.ShaderMaterial;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private loc = new THREE.Vector3();
  private m3 = new THREE.Matrix4();

  constructor(cottage: Cottage) {
    const S = WREN_SITE;
    this.groundY = groundH(S.x, S.z);
    // the home pose: origin at the ground point under the ship, upright, turned by the site heading
    regionToPF(S.x, this.groundY, S.z, this.home.pos);
    const up = this.home.pos.clone().normalize();
    const east = new THREE.Vector3(1, 0, 0).addScaledVector(up, -up.x).normalize();
    const north = new THREE.Vector3().crossVectors(east, up);
    this.home.rot.makeBasis(east, up, north).multiply(new THREE.Matrix4().makeRotationY(S.rot));
    this.pos.copy(this.home.pos); this.rot.copy(this.home.rot); this.rotInv.copy(this.rot).transpose();

    const b = buildWren();
    this.boxes = b.boxes;
    // lamps in ship-local metres (+ one spilling out of the door onto the ramp, last)
    const lampP = Array.from({ length: 10 }, () => new THREE.Vector4(0, -1e4, 0, 0)), lampC = Array.from({ length: 10 }, () => new THREE.Color(0, 0, 0));
    b.lamps.slice(0, 9).forEach((l, i) => { lampP[i].set(l.p[0], l.p[1], l.p[2], l.i); lampC[i].copy(l.c); });
    lampP[9].set(HULL.W + 0.4, DECK.lower + 1.7, (DOOR.z0 + DOOR.z1) / 2, 0.45); lampC[9].set(1.0, 0.72, 0.42);

    const common = { ...cottage.mat.uniforms, uShipShadowL: this.uShipShadowL, uCamShip: this.uCamShip };
    const lamps = { uLampP: { value: lampP }, uLampC: { value: lampC }, uEye: { value: 1 }, uThrust: this.uThrust };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SHIP_VS, fragmentShader: SHIP_FS, side: THREE.DoubleSide,
      uniforms: { ...common, ...lamps, uCore: { value: 1 } },
    });
    const mesh = new THREE.Mesh(b.geo, this.mat);
    // soft glows: engine halos (always), hover pads on the ground (only when standing)
    this.glowMat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VS, fragmentShader: GLOW_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: shared.uTime, uNight: shared.uNight },
    });
    const glow = new THREE.Mesh(glowGeometry(b.glows), this.glowMat);
    this.padGlow = new THREE.Mesh(new THREE.BufferGeometry(), this.glowMat);
    // the jets' plumes: the lift jets down from the pods, the main ones aft
    const jets = new THREE.Mesh(jetGeometry(), new THREE.ShaderMaterial({
      vertexShader: JET_VS, fragmentShader: JET_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: shared.uTime, uCamShip: this.uCamShip, uThrust: this.uThrust, uLift: this.uLift },
    }));
    glow.renderOrder = this.padGlow.renderOrder = jets.renderOrder = 3;
    this.meshes = [mesh, glow, this.padGlow, jets, this.group];
    for (const m of this.meshes) { m.matrixAutoUpdate = false; m.frustumCulled = false; }
    // the outside arrives a moment later (a 16 MB model)
    loadWrenModel(common, lamps).then((m) => this.attach(m)).catch((e) => console.error('wren.glb:', e));

    // the ship's own shadow map, rendered in ship-local metres; the region's shaders get it through the flat frame
    this.shadowRT = new THREE.WebGLRenderTarget(2048, 2048);
    this.shadowRT.depthTexture = new THREE.DepthTexture(2048, 2048, THREE.UnsignedIntType);
    const sm = new THREE.Mesh(b.geo, new THREE.ShaderMaterial({ vertexShader: SHIP_VS, fragmentShader: SHIP_DEPTH_FS, side: THREE.DoubleSide }));
    sm.matrixAutoUpdate = false;
    this.shadowScene.add(sm);
    shared.uSShadow.value = this.shadowRT.depthTexture;
    this.settle();
  }

  /* ---- pose ---- */
  /** a planet-fixed point at ship-local (x, y, z) */
  pf(x: number, y: number, z: number, out = new THREE.Vector3()) { return out.set(x, y, z).applyMatrix4(this.rot).add(this.pos); }
  /** ship-local position of a planet-fixed point */
  toLocal(p: THREE.Vector3, out = this.loc) { return out.copy(p).sub(this.pos).applyMatrix4(this.rotInv); }
  /** back from ship-local to planet-fixed, keeping the distance from the planet's centre (only horizontal pushes) */
  private fromLocal(l: THREE.Vector3, p: THREE.Vector3) {
    const r = p.length();
    this.pf(l.x, l.y, l.z, p).setLength(r);
  }
  /** fly: move the ship (the flight model owns the pose while it is airborne) */
  /** which camera layer she is drawn on (1: her own depth pass, Renderer.shipRange) */
  setLayer(n: number) { if (n === this.layer) return; this.layer = n; for (const m of this.meshes) m.traverse((o) => o.layers.set(n)); }
  private layer = 0;
  setPose(p: THREE.Vector3, q: THREE.Quaternion) {
    this.pos.copy(p);
    this.rot.makeRotationFromQuaternion(q);
    this.rotInv.copy(this.rot).transpose();
    if (this.parked) { this.parked = false; this.padGlow.visible = false; this.legY.fill(0); this.pose(); }
  }
  /** the pilot's eye, planet-fixed */
  pilotEye(out: THREE.Vector3) { return this.pf(PILOT.x, PILOT.y, PILOT.z, out); }
  /** standing by the pilot's seat (for "E — take the helm") */
  nearHelm(p: THREE.Vector3) { const l = this.toLocal(p); return Math.hypot(l.x - PILOT.x, l.z - (PILOT.z - 0.3)) < 1.0 && Math.abs(l.y - DECK.upper - EYE) < 0.6; }
  /** stand on the ground where the ship is: legs on the terrain under each foot, the ramp to the ground, the pads' glow */
  settle() {
    this.parked = true;
    const gOrigin = this.pos.length() - PLANET_R;   // (she may rest above the ground under her middle, on a slope)
    const gLocal = (x: number, z: number) => groundAlt(this.pf(x, 0, z, this.tmp)) - gOrigin;
    this.legY = LEGS.map(([fx, fz]) => clamp(gLocal(fx, fz), -0.4, 0.4));
    const gEnd = gLocal(RAMP.x0 + RAMP.len * 0.9, 0.8), drop = DECK.lower - gEnd;
    this.rampAng = Math.asin(clamp(drop / RAMP.len, 0.05, 0.95));
    this.rampRun = RAMP.len * Math.cos(this.rampAng);
    this.legBoxes = LEGS.map(([fx, fz]) => ({ x0: fx - 0.95, z0: fz - 0.95, x1: fx + 0.95, z1: fz + 0.95, y0: -2, y1: 1.4 }));
    this.padGlow.geometry.dispose();
    this.padGlow.geometry = glowGeometry(LEGS.map(([fx, fz], i) => ({ c: new THREE.Vector3(fx, this.legY[i] + 0.03, fz), n: new THREE.Vector3(0, 1, 0), r: 1.5, col: new THREE.Color(0.22, 0.5, 0.75) })));
    this.padGlow.visible = true;
    this.pose();
  }

  private attach(m: WrenModel) {
    this.model = m;
    this.legBase = m.legs.map((l) => l.position.y);
    for (const p of m.parts) { this.group.add(p.mesh); p.mesh.layers.set(this.layer); if (p.depth) this.shadowScene.add(p.depth); }
    this.pose();
  }
  /** the moving parts: the ramp-door (the foot folds onto the ramp first, then the ramp swings up into the
      doorway), and the legs (drawn up into the belly with the feet tucked in, standing on the ground when parked) */
  private pose() {
    const m = this.model;
    if (!m) return;
    const t = this.doorT, Z = new THREE.Vector3(0, 0, 1);
    m.foot.quaternion.setFromAxisAngle(Z, Math.PI * smoothstep(0, 0.45, t));
    m.ramp.quaternion.setFromAxisAngle(Z, -this.rampAng + (this.rampAng + RAMP.closed) * smoothstep(0.5, 1, t));
    const fold = 1 - smoothstep(0, 1, this.gearT);
    m.legs.forEach((leg, i) => {
      leg.quaternion.setFromAxisAngle(Z, -Math.sign(LEGS[i][0]) * 0.44 * fold);   // the foot swings in under the hull
      leg.position.y = this.legBase[i] + (this.parked ? this.legY[i] : 0) + 2.1 * fold;   // and the leg draws up into it
    });
    m.root.updateMatrixWorld(true);
    for (const p of m.parts) {
      p.local.value.copy(p.src.matrixWorld);
      if (p.depth) p.depth.matrix.copy(p.local.value);
    }
    this.shadowDirty = true;
  }
  /** close the ramp-door (fold and seal, as for flight) or lower it again */
  /** back on her home site at once: ramp down, legs down, engines quiet (the showcase borrows her for a lift-off) */
  parkAtHome() {
    this.pos.copy(this.home.pos); this.rot.copy(this.home.rot); this.rotInv.copy(this.rot).transpose();
    this.doorT = this.doorGoal = 0; this.gearT = this.gearGoal = 1;
    this.uThrust.value = 0; this.shadowDirty = true;
    this.settle();
  }
  /** sealed and legs up at once, as in flight (the showcase's space shot) */
  stow() { this.doorT = this.doorGoal = 1; this.gearT = this.gearGoal = 0; this.pose(); }
  setDoor(open: boolean) { this.doorGoal = open ? 0 : 1; }
  get doorOpen() { return this.doorT < 0.02; }
  get doorClosed() { return this.doorT > 0.98; }
  /** lower or fold the legs */
  setGear(down: boolean) { this.gearGoal = down ? 1 : 0; }
  get gearDown() { return this.gearT > 0.98; }

  updateShadow(renderer: THREE.WebGLRenderer, sunPF: THREE.Vector3, force = false) {
    this.sunShip.copy(sunPF).applyMatrix4(this.rotInv);
    if (!force && !this.shadowDirty && this.sunShip.angleTo(this.lastSun) < 0.0015) return;
    this.shadowDirty = false;
    this.lastSun.copy(this.sunShip);
    const c = this.shadowCam;
    c.position.copy(this.center).addScaledVector(this.sunShip, 70);
    c.up.set(0, Math.abs(this.sunShip.y) > 0.99 ? 0 : 1, Math.abs(this.sunShip.y) > 0.99 ? 1 : 0);
    c.lookAt(this.center);
    c.updateMatrixWorld();
    this.uShipShadowL.value.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
    renderer.setRenderTarget(this.shadowRT);
    renderer.clear();
    renderer.render(this.shadowScene, c);
    renderer.setRenderTarget(null);
  }
  /** the home region's shaders (meadow, cottage, rain) see the ship through its flat coordinates: valid near home */
  private regionLink() {
    const f = pfToRegion(this.pos);
    if (this.pos.y <= 0 || Math.max(Math.abs(f.X), Math.abs(f.Z)) > HALF - 200) {
      shared.uSShadowMat.value.makeScale(0, 0, 0).setPosition(5, 5, 5);   // maps everything outside the map: no shadow
      shared.uShipXf.value.set(1e5, 1e5, 1, 0);
      shared.uWash.value.z = 0; this.uLift.value = 0;
      return;
    }
    // ship axes in the flat frame: (east, up, north) at the ship stand in for the flat axes, as for the home pose
    const up = this.tmp.copy(this.pos).normalize(), east = this.tmp2.set(1, 0, 0).addScaledVector(up, -up.x).normalize();
    const north = new THREE.Vector3().crossVectors(east, up);
    this.m3.makeBasis(east, up, north).transpose().multiply(this.rot).setPosition(f.X, f.h, f.Z);   // ship-local -> flat
    shared.uSShadowMat.value.copy(this.m3).invert().premultiply(this.uShipShadowL.value);
    const fwd = new THREE.Vector3(0, 0, 1).applyMatrix4(this.m3.setPosition(0, 0, 0)), h = Math.hypot(fwd.x, fwd.z) || 1;
    if (this.parked) shared.uShipXf.value.set(f.X, f.Z, fwd.z / h, fwd.x / h); else shared.uShipXf.value.set(1e5, 1e5, 1, 0);
    shared.uShipY.value = f.h;
    // the lift jets fade with height; their wash on the grass spreads and weakens
    const agl = Math.max(f.h - groundH(f.X, f.Z), 0);
    this.uLift.value = this.uThrust.value * (1 - smoothstep(40, 400, agl));
    shared.uWash.value.set(f.X, f.Z, this.uLift.value * 0.9 * (1 - smoothstep(4, 45, agl)), 7 + agl * 0.45);
  }
  update(t: number) {
    const dt = this.lastT < 0 ? 0 : clamp(t - this.lastT, 0, 0.1);
    this.lastT = t;
    let moved = false;
    if (this.doorT !== this.doorGoal) {   // three seconds, as the model's DoorClose clip
      this.doorT = this.doorGoal > this.doorT ? Math.min(this.doorT + dt / 3, 1) : Math.max(this.doorT - dt / 3, 0);
      moved = true;
    }
    if (this.gearT !== this.gearGoal) {
      this.gearT = this.gearGoal > this.gearT ? Math.min(this.gearT + dt / 2.5, 1) : Math.max(this.gearT - dt / 2.5, 0);
      moved = true;
    }
    if (moved) this.pose();
    this.regionLink();
    const near = frame.camPF.distanceTo(this.pos) < 30000;
    for (const m of this.meshes) { m.visible = near && (m !== this.padGlow || this.parked); if (near && m !== this.group) { pfMatrix(this.pos, m.matrix, this.rot); m.matrixWorldNeedsUpdate = true; } }
    // the model's meshes carry their own placement (their group stays at identity)
    if (near && this.model) for (const p of this.model.parts) { pfMatrix(this.pos, p.mesh.matrix, this.rot).multiply(p.local.value); p.mesh.matrixWorldNeedsUpdate = true; }
    this.toLocal(frame.camPF, this.uCamShip.value);
    // Halden's eye breathes slowly; the core a little faster, never in step
    this.mat.uniforms.uEye.value = 0.8 + 0.25 * Math.sin(t * 0.9);
    this.mat.uniforms.uCore.value = 0.85 + 0.2 * Math.sin(t * 1.4 + 1.0) + 0.05 * Math.sin(t * 3.3);
  }

  /* ---- walking aboard (ship-local) ---- */
  /** the highest floor at (x, z) that someone with feet at height f can stand on (step up to 0.45 m) */
  private floorLocal(x: number, z: number, f: number) {
    let best = -Infinity;
    const take = (y: number) => { if (y <= f + 0.45 && y > best) best = y; };
    const open = this.doorOpen && this.parked;
    const doorZone = open && z > DOOR.z0 + 0.1 && z < DOOR.z1 - 0.1;
    if (open && x >= RAMP.x0 - 0.05 && x <= RAMP.x0 + this.rampRun && z > RAMP.z0 && z < RAMP.z1) take(this.rampY(x));
    if (z > LOWER_Z[0] && z < LOWER_Z[1] && (Math.abs(x) <= floorHalf(DECK.lower, z) || (doorZone && x > 0 && x < RAMP.x0 + 0.1))) take(DECK.lower);
    if (x > STAIRS.x0 && x < STAIRS.x1 && z > STAIRS.zTop && z < STAIRS.zBot) take(DECK.lower + (STAIRS.zBot - z) / (STAIRS.zBot - STAIRS.zTop) * (DECK.upper - DECK.lower));
    const inHole = x > HOLE.x0 && x < HOLE.x1 && z > HOLE.z0 && z < HOLE.z1;
    if (z > UPPER_Z[0] && z < UPPER_Z[1] && Math.abs(x) <= floorHalf(DECK.upper, z) && !inHole) take(DECK.upper);
    if (x > LADDER.x0 - 0.1 && x < LADDER.x1 + 0.1 && z < LADDER.zBot && z > DOME.z - 0.3) take(Math.min(DOME.floor, DECK.upper + (LADDER.zBot - z) / (LADDER.zBot - LADDER.zTop) * (DOME.floor - DECK.upper)));
    if (z <= DOME.z - 0.2 && x * x + (z - DOME.z) ** 2 < 2.3 * 2.3) take(DOME.floor);
    return best;
  }
  /** obstacle interface (player.ts): altitude of the floor under a planet-fixed eye position */
  floorAt(p: THREE.Vector3) {
    const l = this.toLocal(p);
    if (Math.abs(l.x) > 14 || Math.abs(l.z) > 16) return -1e9;
    const y = this.floorLocal(l.x, l.z, l.y - EYE);
    return y === -Infinity ? -1e9 : this.pf(l.x, y, l.z, this.tmp).length() - PLANET_R;
  }
  /** standing on the ship's boards (for wooden footsteps) */
  onBoard(p: THREE.Vector3) { const l = this.toLocal(p); return Math.abs(l.x) < 14 && this.floorLocal(l.x, l.z, l.y - EYE) > 0.3 && Math.abs(l.y - EYE - this.floorLocal(l.x, l.z, l.y - EYE)) < 0.2; }
  /** inside the hull (the eye adapts, sound goes indoor) */
  inside(p: THREE.Vector3) { const l = this.toLocal(p), f = l.y - EYE; return f > 2.0 && f < 11 && Math.abs(l.x) < halfWidthAt(f + 1.0, l.z) - 0.05; }
  /** obstacle interface: push a planet-fixed eye position out of the hull, legs, walls and furniture */
  collide(p: THREE.Vector3) {
    const l = this.toLocal(p);
    if (Math.abs(l.x) > 14 || Math.abs(l.z) > 16) return;
    const f = l.y - EYE, RAD = 0.3;
    let x = l.x, z = l.z;
    // under the hull: the belly comes down to head height near the middle
    if (f < 1.6) {
      const Y = f + 1.9, r = Math.max(halfWidthAt(Y, z), 0);
      if (bellyAt(x, z) < Y && r > 0) x = Math.sign(x || 1) * (r + RAD);
    }
    // aboard: stay inside the inner shell (wider at chest height than at the floor), on the right deck
    const inHull = f > 2.0 && Math.abs(x) < halfWidthAt(f + 1.0, z);
    if (inHull) {
      const doorZone = this.doorOpen && this.parked && x > 0 && z > DOOR.z0 + 0.25 && z < DOOR.z1 - 0.25 && f < DECK.lower + 0.6;
      const w = Math.min(halfWidthAt(f + 1.0, z, HULL.thick), halfWidthAt(f + 0.05, z, HULL.thick)) - RAD;
      if (!doorZone) x = clamp(x, -Math.max(w, 0), Math.max(w, 0));
      if (f < 4.2) z = clamp(z, LOWER_Z[0] + RAD, LOWER_Z[1] - RAD);
      else z = clamp(z, UPPER_Z[0] + RAD, UPPER_Z[1] - RAD);
    }
    // up in the dome (above the hull top): the glass is the wall
    if (f > 9.3 && f < 12.5) {
      const dz = z - DOME.z, d = Math.hypot(x, dz), m = 2.15;
      if (d > m && d < DOME.r + 1.0) { x *= m / d; z = DOME.z + dz * m / d; }
    }
    // walls, furniture, legs: boxes that apply between their heights
    for (let it = 0; it < 2; it++) for (const b of this.parked ? [...this.boxes, ...this.legBoxes] : this.boxes) {
      if (f < b.y0 || f >= b.y1) continue;
      const cx = clamp(x, b.x0, b.x1), cz = clamp(z, b.z0, b.z1), dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= RAD * RAD) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (RAD - d) / d; x += dx * k; z += dz * k; }
      else {
        const pen = [x - b.x0, b.x1 - x, z - b.z0, b.z1 - z], m = Math.min(...pen), i = pen.indexOf(m);
        if (i === 0) x = b.x0 - RAD; else if (i === 1) x = b.x1 + RAD; else if (i === 2) z = b.z0 - RAD; else z = b.z1 + RAD;
      }
    }
    if (x !== l.x || z !== l.z) { l.x = x; l.z = z; this.fromLocal(l, p); }
  }
}

/* the halos: camera-facing-ish quads (fixed to the ship), one per glow */
function glowGeometry(glows: Glow[]) {
  const gpos: number[] = [], guv: number[] = [], gcol: number[] = [], gidx: number[] = [];
  for (const g of glows) {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), g.n), base = gpos.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const p = new THREE.Vector3((u - 0.5) * 2 * g.r, (v - 0.5) * 2 * g.r, 0).applyQuaternion(q).add(g.c);
      gpos.push(p.x, p.y, p.z); guv.push(u, v); gcol.push(g.col.r, g.col.g, g.col.b);
    }
    gidx.push(base, base + 1, base + 3, base, base + 3, base + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(gpos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(guv, 2));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(gcol, 3)); geo.setIndex(gidx);
  return geo;
}

/* one billboard quad per jet (see JET_VS): nozzle, axis, lift or main, length and width */
function jetGeometry() {
  const J: [number, number, number, number, number, number, number, number, number][] = [];
  for (const s of [1, -1]) {
    J.push([s * POD.x, POD.y - POD.r - 0.2, (POD.z0 + POD.z1) / 2, 0, -1, 0, 1, 7, 1.7]);   // lift, down
    J.push([s * POD.x, POD.y, POD.z0 - 0.4, 0, 0, -1, 0, 5, 1.3]);                         // pod engines, aft
  }
  J.push([0, hullYc(HULL.zTail), THRUSTER_Z - 0.7, 0, 0, -1, 0, 8, 2.0]);                   // the tail thruster
  const base: number[] = [], jet: number[] = [], size: number[] = [], uv: number[] = [], pos: number[] = [], idx: number[] = [];
  J.forEach(([x, y, z, ax, ay, az, lift, len, wid], i) => {
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { base.push(x, y, z); jet.push(ax, ay, az, lift); size.push(len, wid); uv.push(u, v); pos.push(x, y, z); }
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aBase', new THREE.Float32BufferAttribute(base, 3));
  g.setAttribute('aJet', new THREE.Float32BufferAttribute(jet, 4));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 2));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
