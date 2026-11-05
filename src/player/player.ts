import * as THREE from 'three';
import { PLANET_R, EYE, HALF, WATER } from '../config';
import { clamp, lerp } from '../core/math';
import { groundH, heightAtDir } from '../planet/heights';
import { regionToPF, gravityAt, localFrame } from '../planet/solenne';
import type { Cottage } from '../house/cottage';

/* =========================================================================
   First-person player on the sphere. Position is planet-fixed; movement is
   the prototype's controller in the player's local frame (east, up, north),
   with real gravity GM/r². In the spawn region, the cottage's collision and
   floors work in flat coordinates exactly like the prototype.
   ========================================================================= */
export const keys = new Set<string>();
export const touchMove = { x: 0, y: 0 };

export class Player {
  pos = new THREE.Vector3();          // eye, planet-fixed
  vel = new THREE.Vector3();          // local frame: x east, y up, z north
  yaw = 0; pitch = 0;
  onGround = true; fly = false; bob = 0; swimming = false;
  flat = new THREE.Vector3();         // eye in region flat coords (valid near spawn)
  up = new THREE.Vector3(0, 1, 0); east = new THREE.Vector3(1, 0, 0); north = new THREE.Vector3(0, 0, 1);
  agl = EYE;                          // eye height above the ground
  private probe = new THREE.Vector3();
  /** other solid things on the planet (ruins): push the player out, and floors to stand on */
  obstacles: { collide(p: THREE.Vector3): void; floorAt(p: THREE.Vector3): number }[] = [];

  constructor(private cottage: Cottage) {}

  get inRegion() { return this.pos.y > 0 && Math.max(Math.abs(this.flat.x), Math.abs(this.flat.z)) < HALF - 25; }

  /** ground under a planet-fixed point: region grid + cottage floors near spawn, global terrain elsewhere */
  groundAt(p: THREE.Vector3, floors = true) {
    let g: number;
    const X = PLANET_R * p.x / p.y, Z = PLANET_R * p.z / p.y;
    if (p.y > 0 && Math.max(Math.abs(X), Math.abs(Z)) < HALF - 25) g = floors ? Math.max(groundH(X, Z), this.cottage.floorAt(X, Z)) : groundH(X, Z);
    else { const l = p.length(); g = heightAtDir(p.x / l, p.y / l, p.z / l); }
    if (floors) for (const o of this.obstacles) g = Math.max(g, o.floorAt(p));
    return g;
  }
  /** open world: you can walk off any edge and fall; only climbing a too-steep slope is refused */
  private walkable(from: THREE.Vector3, to: THREE.Vector3) {
    const step = from.distanceTo(to);
    if (step < 1e-6) return true;
    const rise = this.groundAt(to, false) - this.groundAt(from, false);
    return rise <= 0 || rise / step < 1.05;
  }
  private syncFlat() {
    const p = this.pos;
    this.flat.set(PLANET_R * p.x / p.y, p.length() - PLANET_R, PLANET_R * p.z / p.y);
  }
  private frameAt() { localFrame(this.pos, this.east, this.up, this.east, this.north); }

  spawn() {
    // down the path from the cottage, looking up at its front door
    const [x, z] = this.cottage.toWorld(2.2, 16), [hx, hz] = this.cottage.toWorld(-1.2, 0);
    regionToPF(x, groundH(x, z) + EYE, z, this.pos);
    this.east.set(1, 0, 0); this.frameAt(); this.syncFlat();
    this.vel.set(0, 0, 0);
    this.yaw = Math.atan2(-(hx - x), -(hz - z)) + 0.12;
    this.pitch = THREE.MathUtils.degToRad(2);
    this.fly = false;
  }
  look(dx: number, dy: number, s = 0.0022) {
    this.yaw -= dx * s;
    this.pitch = clamp(this.pitch - dy * s, -1.52, 1.52);
  }
  toggleFly() {
    this.fly = !this.fly;
    if (!this.fly) { this.vel.set(0, 0, 0); this.onGround = false; }
  }
  /** move by a local-frame displacement, keeping the planet-fixed state consistent */
  private moveLocal(dx: number, dy: number, dz: number) {
    this.pos.addScaledVector(this.east, dx).addScaledVector(this.up, dy).addScaledVector(this.north, dz);
    this.frameAt(); this.syncFlat();
  }
  private setAltitude(h: number) { this.pos.setLength(PLANET_R + h); this.syncFlat(); }
  /** put the eye somewhere (the pilot's seat), keeping the frame and the flat coordinates in step */
  place(p: THREE.Vector3) {
    this.pos.copy(p); this.frameAt(); this.syncFlat(); this.vel.set(0, 0, 0);
    this.agl = this.pos.length() - PLANET_R - this.groundAt(this.pos, false);
  }

  update(dt: number) {
    const kx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + touchMove.x;
    const kz = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + touchMove.y;
    const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const ground = () => this.groundAt(this.pos);

    if (this.fly) {
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      const upIn = (keys.has('Space') ? 1 : 0) - (keys.has('KeyC') || keys.has('ControlLeft') ? 1 : 0);
      let wx = fx * cp * kz + rx * kx, wy = sp * kz + upIn, wz = fz * cp * kz + rz * kx;
      const wl = Math.hypot(wx, wy, wz); if (wl > 1) { wx /= wl; wy /= wl; wz /= wl; }
      // free flight until the Wren exists: speed grows with height so orbit is a short trip
      const agl = Math.max(this.pos.length() - PLANET_R - ground(), 1);
      const speed = Math.min((run ? 70 : 22) * Math.max(1, Math.pow(agl / 60, 0.9)), 6000);
      const k = 1 - Math.exp(-dt * 4);
      this.vel.x = lerp(this.vel.x, wx * speed, k); this.vel.y = lerp(this.vel.y, wy * speed, k); this.vel.z = lerp(this.vel.z, wz * speed, k);
      this.moveLocal(this.vel.x * dt, this.vel.y * dt, this.vel.z * dt);
      if (this.flat.y - EYE < this.cottage.wallTop && this.inRegion) { this.cottage.collide(this.flat); regionToPF(this.flat.x, this.flat.y, this.flat.z, this.pos); this.frameAt(); }
      if (this.agl < 10) { for (const o of this.obstacles) o.collide(this.pos); this.frameAt(); this.syncFlat(); }
      const floor = Math.max(ground() + EYE, WATER + 0.6);
      const h = this.pos.length() - PLANET_R;
      if (h < floor) { this.setAltitude(floor); this.vel.y = Math.max(this.vel.y, 0); }
      if (h > 4 * PLANET_R) this.setAltitude(4 * PLANET_R);
    } else {
      let wx = fx * kz + rx * kx, wz = fz * kz + rz * kx;
      const wl = Math.hypot(wx, wz); if (wl > 1) { wx /= wl; wz /= wl; }
      const speed = (run ? 9.5 : 4.2) * (this.swimming ? 0.45 : 1);
      // ground too steep to stand on (cliffs, the talus below the clouds): slide down it
      const e = 0.6, g0 = this.groundAt(this.pos, false);
      const sx = (this.groundAt(this.probe.copy(this.pos).addScaledVector(this.east, e), false) - g0) / e;
      const sz = (this.groundAt(this.probe.copy(this.pos).addScaledVector(this.north, e), false) - g0) / e;
      const steep = Math.hypot(sx, sz), sliding = this.onGround && steep > 1.05 && !this.swimming;
      const k = 1 - Math.exp(-dt * (this.onGround ? 10 : 2));
      this.vel.x = lerp(this.vel.x, wx * speed, k);
      this.vel.z = lerp(this.vel.z, wz * speed, k);
      // falling along the face: the downhill move keeps pace with the fall (a sheer cliff is nearly free fall)
      if (sliding) { const vh = Math.max(-this.vel.y, 0) / steep + 1.5; this.vel.x = -sx / steep * vh; this.vel.z = -sz / steep * vh; }
      // horizontal move with the prototype's sliding along unwalkable edges
      const base = this.pos.clone(), tryMove = (dx: number, dz: number) => {
        this.pos.copy(base).addScaledVector(this.east, dx).addScaledVector(this.north, dz);
        this.syncFlat();
        return this.walkable(base, this.pos);
      };
      const dx = this.vel.x * dt, dz = this.vel.z * dt;
      if (tryMove(dx, dz)) { /* moved */ }
      else if (tryMove(dx, 0)) this.vel.z *= 0.5;
      else if (tryMove(0, dz)) this.vel.x *= 0.5;
      else { tryMove(0, 0); this.vel.x = 0; this.vel.z = 0; }
      this.frameAt();
      if (this.inRegion) { this.cottage.collide(this.flat); regionToPF(this.flat.x, this.flat.y, this.flat.z, this.pos); this.frameAt(); this.syncFlat(); }
      for (const o of this.obstacles) o.collide(this.pos);
      this.frameAt(); this.syncFlat();

      if (this.onGround && !sliding && !this.swimming && keys.has('Space')) { this.vel.y = 4.2; this.onGround = false; }
      const r = this.pos.length();
      this.vel.y -= gravityAt(r) * dt;
      if (sliding) this.vel.y *= Math.exp(-dt * 0.25);   // a little rock friction
      let h = r - PLANET_R + this.vel.y * dt;
      // deep water: float with the head just above the surface
      const gr = ground();
      this.swimming = gr < WATER - 1.2;
      const g = Math.max(gr, WATER - 1.45) + EYE;
      const steepHere = steep > 1.05 && !this.swimming;
      if (h <= g || (this.onGround && h - g < 0.45 && this.vel.y <= 0)) { h = g; if (!steepHere) this.vel.y = 0; this.onGround = true; }
      else this.onGround = false;
      this.setAltitude(h);
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (this.onGround && !this.swimming && hs > 0.3) this.bob += dt * hs * 1.9; else this.bob *= 0.9;
    }
    this.agl = this.pos.length() - PLANET_R - ground();
  }
  /** camera eye with head bob */
  eye(out: THREE.Vector3) {
    const bobY = this.fly ? 0 : Math.sin(this.bob) * 0.035 * Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 4);
    return out.copy(this.pos).addScaledVector(this.up, bobY);
  }
}
