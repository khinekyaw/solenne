import * as THREE from 'three';
import { clamp } from '../core/math';
import { PLANET_R } from '../config';
import { gravityAt } from '../planet/solenne';
import { keys } from '../player/player';
import { groundAlt, type Wren } from './wren';
import { BODIES, SOLENNE, STAR, type StarSystem } from '../space/system';
import { focusAt, nearestWell, cruiseLimit, parkRadius, CRUISE_ROOM, CRUISE_DROP } from '../space/nav';

/* =========================================================================
   Flying the Wren (M5). A Newtonian ship (planet-fixed position, velocity
   and orientation, real gravity GM/r²) under a flight computer:
   - assist on (default): velocity hold. The throttle sets a speed along the
     nose, Space/C a climb or sink rate; the computer thrusts toward that
     velocity like a damped spring and cancels gravity, so she hovers when
     you let go. Roll is kept level with the horizon (a little bank in turns).
   - assist off (Z): only the thrust you ask for, and gravity; above the air
     she coasts on a real orbit (≈ 800 m/s across the sky at 20 km).
   - landing (L): level her, kill the drift, sink slower the lower she is,
     legs down, and settle wherever she is.
   Speeds scale with height above the ground, so orbit is a short trip.
   Space (M7): above 150 km she flies in the inertial frame of whichever body
   rules there (patched conics: position and velocity relative to it, only its
   gravity), and hands back to the planet-fixed flight below 100 km. No horizon
   to level up there: Q/R roll. The cruise drive (J) carries her along her nose
   at a speed set by the room to the nearest surface; the autopilot (G) climbs
   out, turns to the target, cruises and drops into a parking orbit.
   ========================================================================= */
type FlightEvent = 'takeoff' | 'landing' | 'landed' | 'bump' | 'held' | 'assistOff' | 'steep'
  | 'cruise' | 'cruiseNo' | 'drop' | 'arrive' | 'noTarget' | 'autopilot' | 'warpNo' | 'leftHome' | 'noLand';
const SENS = 0.0016;   // mouse steering, radians per pixel
const SPACE_UP = 150000, SPACE_DOWN = 100000;   // above Solenne's datum: the inertial frame takes over / hands back
const WARPS = [1, 10, 100, 1000];

export class Flight {
  active = false;      // someone at the helm
  airborne = false;
  assist = true;
  landing = false;
  view: 'chase' | 'cockpit' = 'chase';
  throttle = 0;        // speed along the nose the assist holds (m/s)
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly q = new THREE.Quaternion();
  agl = 0;
  uneven = 0;          // how much the ground under nose, tail and wings differs (m): too much, and she will not set down
  onEvent: (e: FlightEvent) => void = () => {};
  /* ---- space (M7): state relative to the focus body, inertial axes; pos/vel/q above stay the planet-fixed pose ---- */
  inSpace = false;
  focus = SOLENNE;
  readonly rI = new THREE.Vector3();   // position relative to the focus body
  readonly vI = new THREE.Vector3();   // velocity relative to it (m per real second)
  readonly qI = new THREE.Quaternion();
  readonly pI = new THREE.Vector3();   // position relative to the sun
  cruise = false;
  cruiseSpeed = 0;
  cruiseK = 1;                         // the cruise throttle: a share of what the drive allows here
  target = -1;
  auto: 'off' | 'climb' | 'align' | 'cruise' = 'off';
  warp = 1;
  surface = Infinity;                  // to the nearest surface (m)
  well = STAR;                         // whose well limits the drive
  private camUp = new THREE.Vector3();
  private m4 = new THREE.Matrix4();
  private qPF = new THREE.Quaternion();   // planet-fixed axes → inertial
  private aim = new THREE.Vector3(); private w = new THREE.Vector3();
  private turn = { yaw: 0, pitch: 0 };            // mouse steering still to be applied
  private yawRate = 0;
  private camOff = new THREE.Vector3();          // the chase camera's offset (planet-fixed), eased
  private camInit = false;
  private R = new THREE.Matrix4();
  private nose = new THREE.Vector3(); private top = new THREE.Vector3(); private port = new THREE.Vector3();
  private up = new THREE.Vector3(); private a = new THREE.Vector3(); private v = new THREE.Vector3(); private t = new THREE.Vector3();
  private dq = new THREE.Quaternion();
  private X = new THREE.Vector3(1, 0, 0); private Z = new THREE.Vector3(0, 0, 1);

  constructor(private wren: Wren, private sys: StarSystem) {}

  /** take the helm: the ramp-door folds shut; she lifts off once it is sealed */
  take() {
    this.active = true;
    this.pos.copy(this.wren.pos);
    this.q.setFromRotationMatrix(this.wren.rot);
    this.vel.set(0, 0, 0);
    this.throttle = 0; this.turn.yaw = this.turn.pitch = 0; this.landing = false;
    this.camInit = false;
    this.wren.setDoor(false);
  }
  /** leave the helm: only on the ground (the ramp comes down again) */
  leave() {
    this.auto = 'off';
    if (this.airborne) { this.onEvent('held'); return false; }
    this.active = false;
    this.wren.setDoor(true);
    return true;
  }
  look(dx: number, dy: number) {
    if (!this.airborne) return;
    this.turn.yaw -= dx * SENS; this.turn.pitch -= dy * SENS;
    if (this.auto !== 'off' && Math.abs(dx) + Math.abs(dy) > 25) this.auto = 'off';   // a firm hand on the stick takes over
  }
  toggleAssist() { this.assist = !this.assist; if (!this.assist) this.onEvent('assistOff'); }
  land() {
    if (this.inSpace) { this.onEvent('noLand'); return; }
    if (this.airborne && !this.landing) { this.landing = true; this.auto = 'off'; this.onEvent('landing'); }
  }
  /** J: the cruise drive, on or off; it needs room from every surface and the air */
  toggleCruise() {
    if (this.cruise) { this.dropOut(false); return; }
    if (!this.airborne || this.landing) return;
    if (this.inSpace ? this.surface < CRUISE_ROOM : this.agl < CRUISE_ROOM) { this.onEvent('cruiseNo'); return; }
    if (!this.inSpace) this.toSpace();
    this.cruise = true; this.cruiseK = Math.max(this.cruiseK, 0.5); this.cruiseSpeed = this.vI.length(); this.warp = 1;
    this.onEvent('cruise');
  }
  /** T: the next body as the target (nearest first) */
  cycleTarget(dir = 1) {
    const order = BODIES.map((_, k) => k).filter((k) => k !== this.focusOrHome()).sort((a, b) => this.sys.bodies[a].pos.distanceTo(this.pI) - this.sys.bodies[b].pos.distanceTo(this.pI));
    const i = order.indexOf(this.target);
    this.target = order[((i < 0 ? (dir > 0 ? -1 : 0) : i) + dir + order.length) % order.length];
  }
  private focusOrHome() { return this.inSpace && this.surface > parkRadius(this.focus) - BODIES[this.focus].radius + 50000 ? -1 : this.focus; }
  /** G: fly to the target (climb out, turn, cruise, park); G again hands back */
  autopilot() {
    if (this.auto !== 'off') { this.auto = 'off'; return; }
    if (this.target < 0) { this.onEvent('noTarget'); return; }
    if (!this.airborne) return;
    this.landing = false; this.warp = 1;
    this.auto = this.inSpace && this.surface > CRUISE_ROOM ? 'align' : 'climb';
    this.onEvent('autopilot');
  }
  /** [ and ]: time warp, only coasting in free space */
  setWarp(dir: number) {
    const i = Math.max(0, WARPS.indexOf(this.warp)) + dir;
    if (dir > 0 && !this.canWarp()) { this.onEvent('warpNo'); return; }
    this.warp = WARPS[clamp(i, 0, WARPS.length - 1)];
  }
  private canWarp() { return this.inSpace && !this.cruise && this.auto === 'off' && this.surface > Math.max(200000, BODIES[this.focus].radius); }
  /** status for the helm's readout */
  get status() {
    const ready = this.airborne || this.wren.doorClosed;
    return { speed: this.inSpace ? this.vI.length() : this.vel.length(), agl: this.inSpace ? this.surface : this.agl, alt: this.pos.length() - PLANET_R, ready, gear: this.wren.gearDown };
  }

  update(dt: number) {
    if (!this.active) return;
    if (this.warp > 1 && !this.canWarp()) this.warp = 1;
    if (this.inSpace) { this.spaceUpdate(dt); return; }
    const W = keys.has('KeyW') ? 1 : 0, S = keys.has('KeyS') ? 1 : 0, A = keys.has('KeyA') ? 1 : 0, D = keys.has('KeyD') ? 1 : 0;
    const climb = (keys.has('Space') ? 1 : 0) - (keys.has('KeyC') || keys.has('ControlLeft') ? 1 : 0);
    const boost = keys.has('ShiftLeft') || keys.has('ShiftRight');
    this.agl = this.pos.length() - PLANET_R - groundAlt(this.pos);
    if (!this.airborne) {
      // on the ground: the door seals first, then Space (or W) lifts her
      if (!this.wren.doorClosed || (climb <= 0 && !W)) { this.wren.uThrust.value *= 0.9; return; }
      this.airborne = true; this.landing = false;
      this.vel.copy(this.up.copy(this.pos).normalize()).multiplyScalar(3);
      this.wren.setPose(this.pos, this.q);
      this.onEvent('takeoff');
    }
    const r = this.pos.length(), alt = r - PLANET_R, agl = this.agl;
    this.up.copy(this.pos).divideScalar(r);
    this.R.makeRotationFromQuaternion(this.q);
    this.nose.set(0, 0, 1).applyMatrix4(this.R); this.top.set(0, 1, 0).applyMatrix4(this.R); this.port.set(1, 0, 0).applyMatrix4(this.R);

    /* ---- turning: mouse steering eased in, A/D yaw, the horizon kept level (or the nose too, landing) ---- */
    const k = 1 - Math.exp(-dt * 12);
    const dYaw = this.turn.yaw * k + (A - D) * 0.8 * dt, dPitch = this.turn.pitch * k;
    this.turn.yaw -= this.turn.yaw * k; this.turn.pitch -= this.turn.pitch * k;
    this.yawRate += (dYaw / Math.max(dt, 1e-4) - this.yawRate) * (1 - Math.exp(-dt * 6));
    this.rotate(this.top, dYaw);                    // (about the ship's own axes, through the quaternion)
    this.rotate(this.X, -dPitch, true);
    const roll = (keys.has('KeyR') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
    if (roll && !this.assist) this.rotate(this.Z, roll * 1.2 * dt, true);
    if (this.auto === 'climb') {
      // the autopilot climbs out steeply (60°), heading kept, until the air and the ground are far enough below
      this.aim.copy(this.nose).addScaledVector(this.up, -this.nose.dot(this.up));
      if (this.aim.lengthSq() < 1e-4) this.aim.copy(this.port).cross(this.up);
      this.aim.normalize().multiplyScalar(0.5).addScaledVector(this.up, 0.866);
      this.slew(this.q, this.aim, 0.7, dt);
      this.rotate(this.Z, 0, true, true);
    }
    if (this.assist || this.landing) {
      const bank = Math.asin(clamp(this.port.dot(this.up), -1, 1));
      const want = this.landing ? 0 : clamp(-this.yawRate * 0.5, -0.45, 0.45);
      this.rotate(this.Z, (want - bank) * (1 - Math.exp(-dt * 3)), true);
      if (this.landing) this.rotate(this.X, Math.asin(clamp(this.nose.dot(this.up), -1, 1)) * (1 - Math.exp(-dt * 2)), true);
    }

    /* ---- thrust ---- */
    const vmax = clamp(35 + agl * 0.5, 35, 2600) * (boost ? 2.5 : 1);
    const aMax = Math.max(15, vmax * 0.25) * (boost ? 2.5 : 1);   // (fast up high: all-stop from orbital speed in seconds, not minutes)
    if (keys.has('KeyX') || this.landing) this.throttle *= Math.exp(-dt * 3);
    else this.throttle = clamp(this.throttle + (W - S) * Math.max(12, vmax * 0.6) * dt, -0.25 * vmax, vmax);
    if (this.landing) {
      // kill the drift, sink slower the lower she is
      this.v.copy(this.up).multiplyScalar(-clamp(agl * 0.3, 0.7, Math.max(30, vmax * 0.4)));
      this.thrustToward(this.v, aMax, dt);
    } else if (this.auto === 'climb') {
      this.thrustToward(this.v.copy(this.nose).multiplyScalar(Math.min(vmax, 3000)), aMax * 1.5, dt);
    } else if (this.assist) {
      this.v.copy(this.nose).multiplyScalar(this.throttle).addScaledVector(this.top, climb * clamp(8 + agl * 0.2, 8, 120) * (boost ? 2 : 1));
      this.thrustToward(this.v, aMax, dt);
    } else {
      this.a.copy(this.nose).multiplyScalar((W - S) * aMax).addScaledVector(this.top, climb * aMax).addScaledVector(this.up, -gravityAt(r));
      this.vel.addScaledVector(this.a, dt);
      this.vel.multiplyScalar(Math.exp(-dt * 0.04 * Math.exp(-Math.max(alt, 0) / 4000)));   // a little air drag low down
      this.wren.uThrust.value += (Math.min(1, (Math.abs(W - S) + Math.abs(climb)) * 0.6) - this.wren.uThrust.value) * (1 - Math.exp(-dt * 4));
    }
    this.pos.addScaledVector(this.vel, dt);

    /* ---- the ground: nothing passes through it (nose, middle, tail); a hard arrival bounces ---- */
    const need = this.clearance(), contact = need > -0.05;
    if (need > 0) {
      this.pos.addScaledVector(this.up, need);
      const vr = this.vel.dot(this.up);
      if (vr < 0) {
        const hard = -vr > 6 || this.vel.length() > 15;
        this.vel.addScaledVector(this.up, -vr * (hard ? 1.4 : 1));
        if (hard) { this.vel.multiplyScalar(0.5); this.onEvent('bump'); }
      }
    }
    this.agl = this.pos.length() - PLANET_R - groundAlt(this.pos);
    // touch down: resting on the ground (under the middle, or the nose or tail on a slope), slow, legs down;
    // too steep (a cliff's edge), and she hovers instead until you find flatter ground
    if (this.wren.gearDown && (this.agl < 0.4 || contact) && this.vel.length() < 2.5 && (this.landing || (climb <= 0 && Math.abs(this.throttle) < 1.5))) {
      if (this.uneven < 2.5) { this.touchdown(); return; }
      if (this.landing) { this.landing = false; this.onEvent('steep'); }
    }
    this.wren.setGear(this.landing || this.agl < 40);
    this.wren.setPose(this.pos, this.q);
    this.pI.copy(this.pos).applyMatrix3(this.sys.PFtoI).add(this.sys.bodies[SOLENNE].pos);
    this.surface = this.agl;
    // high enough: the inertial frame takes over (the autopilot hands over as soon as the drive has room)
    if (alt > SPACE_UP || (this.auto === 'climb' && this.agl > CRUISE_ROOM + 3000)) { this.toSpace(); if (this.auto === 'climb') this.auto = 'align'; }
  }

  /* ==== space ==== */
  private qPFtoI() { return this.qPF.setFromRotationMatrix(this.m4.setFromMatrix3(this.sys.PFtoI)); }
  /** from the planet-fixed flight near Solenne into the inertial frame (the planet's turning is not carried over) */
  private toSpace() {
    const q = this.qPFtoI();
    this.rI.copy(this.pos).applyMatrix3(this.sys.PFtoI);
    this.vI.copy(this.vel).applyMatrix3(this.sys.PFtoI);
    this.qI.copy(q).multiply(this.q);
    this.focus = SOLENNE; this.inSpace = true; this.landing = false;
    this.pI.copy(this.rI).add(this.sys.bodies[SOLENNE].pos);
    this.surface = nearestWell(this.sys, this.pI).surface;
  }
  private toPlanet() {
    const q = this.qPFtoI().invert();
    this.pos.copy(this.rI).applyMatrix3(this.sys.ItoPF);
    this.vel.copy(this.vI).applyMatrix3(this.sys.ItoPF);
    this.q.copy(q).multiply(this.qI);
    this.inSpace = false; this.cruise = false; this.warp = 1;
    this.throttle = this.assist ? this.vel.dot(this.nose.set(0, 0, 1).applyQuaternion(this.q)) : 0;
  }
  /** turn q's nose toward dir (unit) at up to rate rad/s; local: dir is in q's own frame (else in q's parent frame) */
  private slew(q: THREE.Quaternion, dir: THREE.Vector3, rate: number, dt: number) {
    const nose = this.w.set(0, 0, 1).applyQuaternion(q), ang = Math.acos(clamp(nose.dot(dir), -1, 1));
    if (ang < 1e-5) return 0;
    const axis = this.t.crossVectors(nose, dir);
    if (axis.lengthSq() < 1e-12) axis.set(0, 1, 0).applyQuaternion(q);
    axis.normalize();
    const step = Math.min(ang, rate * dt * clamp(ang / 0.3, 0.15, 1));   // ease in at the end
    q.premultiply(this.dq.setFromAxisAngle(axis, step)).normalize();
    return ang;
  }
  /** leave the cruise: back to normal speeds along the nose; on arrival, a circular parking orbit round the target */
  private dropOut(arrive: boolean) {
    this.cruise = false;
    const nose = this.w.set(0, 0, 1).applyQuaternion(this.qI);
    if (arrive && this.target >= 0) {
      const tb = this.sys.bodies[this.target];
      this.focus = this.target;
      this.rI.copy(this.pI).sub(tb.pos);
      const r = this.rI.length(), rh = this.v.copy(this.rI).divideScalar(r);
      const tang = this.a.copy(nose).addScaledVector(rh, -nose.dot(rh));
      if (tang.lengthSq() < 1e-6) tang.set(0, 0, 1).cross(rh);
      this.vI.copy(tang.normalize()).multiplyScalar(Math.sqrt((BODIES[this.target].GM ?? 0) / r));
      this.assist = false; this.throttle = 0; this.auto = 'off';
      this.onEvent('arrive');
    } else {
      const vmax = clamp(35 + this.surface * 0.5, 35, 2600);
      this.vI.copy(nose).multiplyScalar(Math.min(this.cruiseSpeed, vmax));
      this.throttle = Math.min(this.cruiseSpeed, vmax);
      this.onEvent('drop');
    }
    this.cruiseSpeed = 0;
  }
  /** the aim point toward the target, swinging wide of anything in the way */
  private aimAt(out: THREE.Vector3) {
    const tp = this.sys.bodies[this.target].pos;
    out.copy(tp).sub(this.pI);
    const L = out.length(), dir = this.v.copy(out).divideScalar(L);
    let best = Infinity;
    for (let k = 0; k < BODIES.length; k++) {
      if (k === this.target) continue;
      const bp = this.sys.bodies[k].pos, R = BODIES[k].radius * (k === STAR ? 3 : 1.6) + 50000;
      const along = this.a.copy(bp).sub(this.pI).dot(dir);
      if (along <= 0 || along >= L || along > best) continue;
      const side = this.w.copy(this.pI).addScaledVector(dir, along).sub(bp), miss = side.length();
      if (miss > R) continue;
      best = along;
      if (miss < 1) side.set(0, 0, 1).cross(dir);
      out.copy(bp).addScaledVector(side.normalize(), R * 1.4).sub(this.pI);
    }
    return out.normalize();
  }
  private spaceUpdate(dt: number) {
    const sys = this.sys, W = keys.has('KeyW') ? 1 : 0, S = keys.has('KeyS') ? 1 : 0, A = keys.has('KeyA') ? 1 : 0, D = keys.has('KeyD') ? 1 : 0;
    const climb = (keys.has('Space') ? 1 : 0) - (keys.has('KeyC') || keys.has('ControlLeft') ? 1 : 0);
    const roll = (keys.has('KeyR') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
    const boost = keys.has('ShiftLeft') || keys.has('ShiftRight');
    if (this.auto !== 'off' && (W || S || A || D || roll)) this.auto = 'off';
    this.pI.copy(this.rI).add(sys.bodies[this.focus].pos);
    const well = nearestWell(sys, this.pI);
    this.surface = well.surface; this.well = well.k;

    /* ---- turning about her own axes ---- */
    const k = 1 - Math.exp(-dt * 12), Q = this.qI;
    const dYaw = this.turn.yaw * k + (A - D) * 0.8 * dt, dPitch = this.turn.pitch * k;
    this.turn.yaw -= this.turn.yaw * k; this.turn.pitch -= this.turn.pitch * k;
    if (dYaw) Q.multiply(this.dq.setFromAxisAngle(this.w.set(0, 1, 0), dYaw));
    if (dPitch) Q.multiply(this.dq.setFromAxisAngle(this.w.set(1, 0, 0), -dPitch));
    if (roll) Q.multiply(this.dq.setFromAxisAngle(this.w.set(0, 0, 1), roll * 1.2 * dt));
    Q.normalize();
    let aimErr = 0;
    if (this.auto === 'align' || this.auto === 'cruise') aimErr = this.slew(Q, this.aimAt(this.aim), this.auto === 'align' ? 0.6 : 1.2, dt);
    const nose = this.nose.set(0, 0, 1).applyQuaternion(Q), top = this.top.set(0, 1, 0).applyQuaternion(Q);

    /* ---- the cruise drive, or ordinary thrust ---- */
    const vmax = clamp(35 + this.surface * 0.5, 35, 2600) * (boost ? 2.5 : 1), aMax = Math.max(15, vmax * 0.25) * (boost ? 2.5 : 1);
    if (this.auto === 'align') {
      this.thrustToward(this.v.set(0, 0, 0), aMax, dt, this.vI);
      if (aimErr < 0.05 && this.surface > CRUISE_ROOM) { this.cruise = true; this.cruiseK = 1; this.cruiseSpeed = this.vI.length(); this.auto = 'cruise'; this.onEvent('cruise'); }
    }
    if (this.cruise) {
      if (this.auto !== 'off') this.cruiseK = 1;
      else this.cruiseK = clamp(this.cruiseK + (W - S) * 0.5 * dt, 0.05, 1);
      const want = this.cruiseK * cruiseLimit(well.room);
      // quick to slow (the limit falls as a surface nears), slower to speed up
      this.cruiseSpeed += (want - this.cruiseSpeed) * (1 - Math.exp(-dt * (want > this.cruiseSpeed ? 0.7 : 5)));
      this.vI.copy(nose).multiplyScalar(this.cruiseSpeed);
      this.wren.uThrust.value += (1 - this.wren.uThrust.value) * (1 - Math.exp(-dt * 4));
    } else if (this.auto !== 'align') {
      if (keys.has('KeyX')) this.throttle *= Math.exp(-dt * 3);
      else this.throttle = clamp(this.throttle + (W - S) * Math.max(12, vmax * 0.6) * dt, -0.25 * vmax, vmax);
      const r = this.rI.length(), g = (BODIES[this.focus].GM ?? 0) / (r * r);
      if (this.assist) this.thrustToward(this.v.copy(nose).multiplyScalar(this.throttle).addScaledVector(top, climb * clamp(8 + this.surface * 0.2, 8, 400) * (boost ? 2 : 1)), aMax, dt, this.vI);
      else {
        this.a.copy(nose).multiplyScalar((W - S) * aMax).addScaledVector(top, climb * aMax).addScaledVector(this.rI, -g / r);
        this.vI.addScaledVector(this.a, dt);
        this.wren.uThrust.value += (Math.min(1, (Math.abs(W - S) + Math.abs(climb)) * 0.6) - this.wren.uThrust.value) * (1 - Math.exp(-dt * 4));
      }
    }
    this.rI.addScaledVector(this.vI, dt);
    this.pI.copy(this.rI).add(sys.bodies[this.focus].pos);

    // the focus body's surface: nothing passes through (Solenne's own ground is the planet-fixed flight's, below 100 km)
    const r = this.rI.length(), floor = BODIES[this.focus].radius + 2000;
    if (this.focus !== SOLENNE && r < floor) {
      this.rI.multiplyScalar(floor / r);
      const vr = this.vI.dot(this.rI) / floor;
      if (vr < 0) this.vI.addScaledVector(this.rI, -vr / floor);
    }
    // patched conics: whichever sphere of influence she is in now (position exact, relative velocity kept)
    const nf = focusAt(sys, this.pI, this.focus);
    if (nf !== this.focus) {
      if (this.focus === SOLENNE) this.onEvent('leftHome');
      this.focus = nf;
      this.rI.copy(this.pI).sub(sys.bodies[nf].pos);
    }
    if (this.cruise) {
      // the drive drops out by itself close to any surface; the autopilot drops into a parking orbit
      if (this.auto === 'cruise' && this.target >= 0 && this.pI.distanceTo(sys.bodies[this.target].pos) < parkRadius(this.target)) this.dropOut(true);
      else if (this.surface < CRUISE_DROP) { this.auto = 'off'; this.dropOut(false); }
    }
    if (this.focus === SOLENNE && !this.cruise && this.auto === 'off' && this.rI.length() - PLANET_R < SPACE_DOWN) { this.toPlanet(); this.wren.setPose(this.pos, this.q); return; }
    this.pose();
  }
  /** the planet-fixed pose (for drawing and the cameras) from the inertial state */
  private pose() {
    const sol = this.sys.bodies[SOLENNE].pos;
    this.pos.copy(this.rI).add(this.sys.bodies[this.focus].pos).sub(sol).applyMatrix3(this.sys.ItoPF);
    this.vel.copy(this.vI).applyMatrix3(this.sys.ItoPF);
    this.q.copy(this.qPFtoI()).invert().multiply(this.qI);
    this.wren.setGear(false);
    this.wren.setPose(this.pos, this.q);
  }
  /** how far she must rise so nothing (nose, middle, tail) is under the ground; legs folded, the belly is 1.3 m up */
  private clearance() {
    const clear = this.wren.gearDown ? 0.05 : -1.1;
    let need = -Infinity, lo = Infinity, hi = -Infinity;
    for (const [x, z] of [[0, -11], [0, 0], [0, 11], [8, 0], [-8, 0]]) {
      this.t.set(x, 0, z).applyMatrix4(this.R).add(this.pos);
      const g = groundAlt(this.t);
      if (x === 0) need = Math.max(need, g + clear - (this.t.length() - PLANET_R));
      lo = Math.min(lo, g); hi = Math.max(hi, g);
    }
    this.uneven = hi - lo;
    return need;
  }
  /** the assist: a damped spring toward the wanted velocity, gravity cancelled */
  private thrustToward(want: THREE.Vector3, aMax: number, dt: number, vel = this.vel) {
    this.a.copy(want).sub(vel).multiplyScalar(1.4);
    const l = this.a.length();
    if (l > aMax) this.a.multiplyScalar(aMax / l);
    vel.addScaledVector(this.a, dt);
    this.wren.uThrust.value += (Math.min(1, l / aMax) * 0.8 + 0.2 - this.wren.uThrust.value) * (1 - Math.exp(-dt * 4));
  }
  /** turn the ship about one of its own axes (local: x, y, z) or about a planet-fixed axis */
  private rotate(axis: THREE.Vector3, ang: number, local = false, refresh = false) {
    if (Math.abs(ang) < 1e-7 && !refresh) return;
    if (local) this.q.multiply(this.dq.setFromAxisAngle(axis, ang));
    else this.q.premultiply(this.dq.setFromAxisAngle(axis, ang));
    this.q.normalize();
    this.R.makeRotationFromQuaternion(this.q);
    this.nose.set(0, 0, 1).applyMatrix4(this.R); this.top.set(0, 1, 0).applyMatrix4(this.R); this.port.set(1, 0, 0).applyMatrix4(this.R);
  }
  /** upright on the ground, heading kept; the legs find the terrain */
  private touchdown() {
    this.up.copy(this.pos).normalize();
    this.nose.addScaledVector(this.up, -this.nose.dot(this.up));
    if (this.nose.lengthSq() < 1e-6) this.nose.copy(this.port).cross(this.up);
    this.nose.normalize();
    this.port.crossVectors(this.up, this.nose);
    this.q.setFromRotationMatrix(this.R.makeBasis(this.port, this.up, this.nose));
    // rest on the highest ground under her (on a slope the downhill pads hover a little, as hover pads may)
    this.pos.setLength(PLANET_R + groundAlt(this.pos));
    const need = this.clearance();
    if (need > 0) this.pos.addScaledVector(this.up, need);
    this.vel.set(0, 0, 0); this.throttle = 0;
    this.airborne = false; this.landing = false;
    this.wren.setPose(this.pos, this.q);
    this.wren.setGear(true);
    this.wren.settle();
    this.wren.uThrust.value = 0;
    this.onEvent('landed');
  }

  /** the camera: behind and above her (the horizon kept level), or the pilot's own eyes */
  camera(dt: number, eye: THREE.Vector3, look: THREE.Vector3, upv: THREE.Vector3) {
    this.R.makeRotationFromQuaternion(this.q);
    if (this.view === 'cockpit') {
      this.wren.pilotEye(eye);
      look.set(0, -0.12, 1).applyMatrix4(this.R).add(eye);
      upv.set(0, 1, 0).applyMatrix4(this.R);
      return;
    }
    const pos = this.wren.pos;
    this.t.set(0, 8, -34).applyMatrix4(this.R);
    if (!this.camInit) { this.camOff.copy(this.t); this.camUp.copy(pos).normalize(); this.camInit = true; }
    this.camOff.lerp(this.t, 1 - Math.exp(-dt * 3));
    eye.copy(pos).add(this.camOff);
    const h = eye.length() - PLANET_R;
    if (h < 30000) { const g = groundAlt(eye) + 2.0; if (h < g) eye.setLength(PLANET_R + g); }
    look.set(0, 4.5, 6).applyMatrix4(this.R).add(pos);
    // the horizon's up near home; her own up in space (eased, so the view does not snap at the handover)
    this.w.set(0, 1, 0).applyMatrix4(this.R);
    this.camUp.lerp(this.inSpace ? this.w : this.t.copy(eye).normalize(), 1 - Math.exp(-dt * 2)).normalize();
    upv.copy(this.camUp);
  }
}
