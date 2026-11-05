import * as THREE from 'three';
import { smoothstep, lerp, clamp } from '../core/math';
import { groundH, heightAtDir } from '../planet/heights';
import { regionToPF } from '../planet/solenne';
import { HALF, PLANET_R } from '../config';
import { HOUSE } from '../house/cottage';
import { WREN_SITE, type Wren } from '../ship/wren';
import { BODIES, SOLENNE, ORRIN, type StarSystem } from '../space/system';

/* =========================================================================
   The showcase: a short film of Solenne in the game's own renderer. Slow
   camera moves through the home region (keyframed in its flat coordinates,
   or the cottage's own, heights above the ground under each key), each shot
   at its own day and hour (slow: each plays the calm middle of its move; the
   rim is locked off, only the wind and the clouds moving), a softer and more colourful grade with letterbox
   bars drawn into the picture (no UI on screen), clouds drifting faster than
   life, and a quiet pad (audio/music.ts). Between shots the picture dips to
   black for a beat, long enough for the new place's grass and shadows to be
   ready. The Wren lifts off in the fifth shot, climbs out past the camera
   high over the globe in the sixth, pulls away toward Orrin in the seventh
   (placed round that world in space: distance, angle from the sun, tilt over
   its rings), and is parked again for the way home: the ruins under the
   clouds, then the cottage at night. The end title rises over the
   last fade and holds on black.
   ========================================================================= */
type Key = { x: number; h: number; z: number; house?: boolean; abs?: boolean };   // h above the ground (or absolute)
type Shot = {
  name: string;
  dur: number;
  day: number; tod: number;       // when (the sun, Lull and the stars follow)
  fov: [number, number];          // vertical field of view on a 16:9 screen, start → end (degrees)
  eye: Key[];                     // the camera's path (through the keys, eased)
  look: Key[] | 'wren';           // where it looks
  drift: number;                  // cloud drift, times life
  warm?: number;                  // golden-hour grade: amber lights, violet shadows (0 … 1)
  ev?: number;                    // exposure trim
  wren?: 'liftoff';
  skip?: boolean;                 // kept, but not in the film for now
  span?: [number, number];        // play only this part of the move (slower, calmer); equal ends lock the camera off
  focus?: number;                 // focus distance (m); by default where it looks
  clouds?: [number, number];      // where the drifting clouds start (offset, m): the same sky every time it plays
  // out in space round a body: the camera dist radii away, sun degrees from the sunward side, tilt over the equator
  space?: { body: number; dist: number; sun: number; tilt: number };
  // leaving home: the camera alt metres over Solenne, sun degrees off the sunward vertical (the globe gibbous)
  leave?: { alt: number; sun: number };
};
const DEG = Math.PI / 180;
const W_NOSE = { x: Math.sin(WREN_SITE.rot), z: Math.cos(WREN_SITE.rot) };   // her heading on the home site (flat)
const WEST = { x: Math.sin(290 * DEG), z: -Math.cos(290 * DEG) };            // toward the sunset on day 8
const OUT = { x: Math.sin(262 * DEG), z: -Math.cos(262 * DEG) };             // out over the cloud sea, the sun off to the right

const ALL: Shot[] = [
  { name: 'home', dur: 15, day: 1, tod: 13.9, fov: [42, 36], drift: 3, span: [0.15, 0.85],
    // from the grass of the lower meadow, a slow rise and push up the slope toward the cottage on the crest
    // (camera 18 m left of the original line, still aimed at the cottage, so the lens holds it in focus; stays low in the grass)
    eye: [{ x: 112.8, h: 0.35, z: -276.1 }, { x: 100.8, h: 1.15, z: -297.1 }],
    look: [{ x: 72, h: 7, z: -394 }, { x: 70.5, h: 5, z: -397.5 }] },
  { name: 'island', dur: 13, day: 8, tod: 16.4, fov: [39, 35], drift: 4, warm: 0.25,
    // off the north tip, drifting back and up past the cottage: home an island in the sea of clouds, afternoon
    eye: [{ x: 160, h: 60, z: -610, abs: true }, { x: 95, h: 105, z: -735, abs: true }],
    look: [{ x: 72, h: 14, z: -398, abs: true }, { x: 60, h: 0, z: -330, abs: true }] },
  { name: 'cottage', dur: 12, day: 8, tod: 17.9, fov: [40, 38], drift: 2, warm: 0.35, span: [0.34, 0.6],   // (slow: the grass at the lens exaggerates any dolly)
    // late light: a slow sideways dolly past the front of the cottage, from the well to the telescope
    eye: [{ x: -13, h: 0.9, z: 25, house: true }, { x: 9, h: 1.2, z: 23, house: true }],
    look: [{ x: -2, h: 3.0, z: 0, house: true }, { x: 2, h: 2.8, z: 0, house: true }] },
  { name: 'edge', dur: 11, day: 8, tod: 18.62, fov: [46, 42], drift: 3, warm: 0.75, ev: 0.82, span: [0.75, 0.75],   // locked off (the user's pick)
    // walking out through the grass to the rim: the sea of clouds opens up ahead, the low sun warm from the right
    eye: [{ x: -292, h: 0.55, z: -196 }, { x: -312, h: 1.7, z: -209 }],
    look: [{ x: -292 + OUT.x * 400, h: -20, z: -196 + OUT.z * 400, abs: true }, { x: -312 + OUT.x * 400, h: -38, z: -209 + OUT.z * 400, abs: true }] },
  { name: 'departure', dur: 16, day: 8, tod: 18.95, fov: [38, 30], drift: 2, warm: 0.8, wren: 'liftoff',
    // the Wren seals her door, lifts, folds her legs and flies off into the afterglow
    eye: [{ x: 192, h: 1.4, z: -212 }, { x: 190, h: 1.6, z: -214 }],
    look: 'wren' },
  { name: 'leave', dur: 13, day: 8, tod: 19.2, fov: [38, 35], drift: 1, eye: [], look: 'wren',
    // leaving home: high over Solenne, the whole globe in sunlight with a soft terminator, the Wren climbing out of
    // it toward the camera from a speck against the clouds and passing close
    leave: { alt: 450000, sun: 60 } },
  { name: 'orrin', dur: 12, day: 9, tod: 12, fov: [40, 36], drift: 1, ev: 2.6, eye: [], look: 'wren',
    // out among the worlds: Orrin and its rings whole in the distance, the Wren flying on toward it, shrinking
    space: { body: ORRIN, dist: 9.5, sun: 48, tilt: 17 } },
  { name: 'under', dur: 11, day: 8, tod: 19.6, fov: [42, 40], drift: 1.5,
    // under the clouds at dusk: the Gate of the old civilisation at the foot of home, its seam of light breathing,
    // its loose arcs drifting, lantern blooms in the grass, the home plateau and its waterfall seen through the ring;
    // a slow push toward it
    eye: [{ x: 920 + 0.743 * 74, h: 1.3, z: 360 + 0.669 * 74 }, { x: 920 + 0.743 * 62, h: 1.9, z: 360 + 0.669 * 62 }],
    look: [{ x: 920, h: 10.5, z: 360 }, { x: 920, h: 11.5, z: 360 }] },
  { name: 'night', dur: 7, day: 37, tod: 23.5, fov: [52, 54], drift: 1.5, clouds: [-400, 0], span: [0.18, 0.82],   // (Lull stays clear of the clouds; the middle of the move keeps its pace)
    // night: from just off the north cliff, the cottage's windows warm against the sky where a full Lull stands
    // with Orrin and Vael a few degrees above it (day 37, 23:30); the view lifts slowly toward them
    eye: [{ x: 68.4, h: 11, z: -457.5, abs: true }, { x: 68.0, h: 12.5, z: -451, abs: true }],
    look: [{ x: 131, h: 100, z: -62.5, abs: true }, { x: 130.5, h: 112, z: -56, abs: true }] },
];
export const SHOTS = ALL.filter((s) => !s.skip);
const HOLD = 0.35, FADE_IN = 0.9, FADE_OUT = 0.6, FIRST_IN = 1.8, LAST_OUT = 3.0;
const TITLE_IN = 3.2, TAIL = 6.5;   // the end title rises over the last shot's fade, then holds on black

/* the end title, drawn once into a texture (the grade pass lays it over the picture): the game's name in
   the title card's display face, and under it one quiet line, both in white */
export async function titleCard() {
  await Promise.all(['italic 500 200px "Cormorant Garamond"', 'italic 500 60px "Cormorant Garamond"'].map((f) => document.fonts.load(f).catch(() => null)));
  const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 512;
  const g = cv.getContext('2d')!;
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.shadowColor = 'rgba(255, 255, 255, 0.28)'; g.shadowBlur = 28;
  g.fillStyle = '#f3f7fd'; g.font = 'italic 500 230px "Cormorant Garamond", Georgia, serif';
  g.fillText('Solenne', 1024, 290);
  g.shadowBlur = 12; g.fillStyle = '#f3f7fd'; g.font = 'italic 500 62px "Cormorant Garamond", Georgia, serif';
  g.fillText('A million years, and home kept a light on.', 1024, 405);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = 4;
  return tex;
}

const cs = Math.cos(HOUSE.rot), sn = Math.sin(HOUSE.rot);
const gp = new THREE.Vector3();
/** the ground as the walker has it: the home region's grid, the planet's own heights beyond it (the grid clamps) */
function ground(x: number, z: number) {
  if (Math.max(Math.abs(x), Math.abs(z)) < HALF - 25) return groundH(x, z);
  regionToPF(x, 0, z, gp).normalize();
  return heightAtDir(gp.x, gp.y, gp.z);
}
/** a key in the region's flat space: x, altitude, z */
function flat(k: Key, out: THREE.Vector3) {
  const x = k.house ? HOUSE.x + k.x * cs + k.z * sn : k.x, z = k.house ? HOUSE.z - k.x * sn + k.z * cs : k.z;
  return out.set(x, k.abs ? k.h : ground(x, z) + k.h, z);
}
/** through the keys (Catmull–Rom in flat space) at u in [0, 1], never closer to the ground than clear; planet-fixed out */
function path(keys: Key[], u: number, out: THREE.Vector3, v: THREE.Vector3[], clear = -Infinity) {
  const [a, b, c, d, f] = v, n = keys.length - 1;
  if (n === 0) flat(keys[0], f);
  else {
    const g = Math.min(u * n, n - 1e-6), i = Math.floor(g), t = g - i, t2 = t * t, t3 = t2 * t;
    flat(keys[Math.max(i - 1, 0)], a); flat(keys[i], b); flat(keys[i + 1], c); flat(keys[Math.min(i + 2, n)], d);
    f.set(0, 0, 0).addScaledVector(a, -0.5 * t3 + t2 - 0.5 * t).addScaledVector(b, 1.5 * t3 - 2.5 * t2 + 1)
      .addScaledVector(c, -1.5 * t3 + 2 * t2 + 0.5 * t).addScaledVector(d, 0.5 * t3 - 0.5 * t2);
  }
  f.y = Math.max(f.y, ground(f.x, f.z) + clear);   // the ground may rise between keys (a rim, a hump)
  return regionToPF(f.x, f.y, f.z, out);
}

export class Showcase {
  active = false;
  t = 0;
  /** what the frame needs while it plays */
  readonly eye = new THREE.Vector3();
  readonly look = new THREE.Vector3();
  readonly up = new THREE.Vector3();   // the picture's up (the local vertical; out in space the world's pole)
  fov = 40; day = 1; tod = 12; drift = 1; fade = 0; warm = 0; ev = 1; title = 0;
  focus = 100;                    // the lens's focus distance (m)
  clouds: [number, number] = [0, 0];
  lift = 1;                       // the grade's lifted blacks (space wants true black)
  close = false;                  // the Wren is metres away out in the high air (the near plane comes in)
  cut = false;                    // the first frame of a shot (snap the exposure, forget the clouds' history)
  shot = -1;
  private filmEnd = SHOTS.reduce((s, x) => s + x.dur, 0);
  readonly length = this.filmEnd + TAIL;
  readonly shots = SHOTS;
  private v = [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector3());
  private q = new THREE.Quaternion(); private m = new THREE.Matrix4();
  private wren: Wren | null = null;

  start() { this.active = true; this.t = 0; this.shot = -1; }
  /** stop (also when it ends): the Wren goes back to her site */
  stop() { this.active = false; this.wren?.parkAtHome(); this.wren = null; }
  /** advance; false once it has played to the end */
  update(dt: number, wren: Wren, sys: StarSystem) {
    if (!this.active) return false;
    this.t += dt;
    if (this.t >= this.length) { this.stop(); return false; }
    let t0 = 0, i = 0;
    while (i < SHOTS.length - 1 && this.t > t0 + SHOTS[i].dur) t0 += SHOTS[i++].dur;
    const s = SHOTS[i], first = i === 0, last = i === SHOTS.length - 1;
    this.cut = i !== this.shot;
    if (this.cut) { this.shot = i; this.wren?.parkAtHome(); this.wren = null; }
    // the move runs after the black beat; slow in and out, like a camera on a dolly
    const local = this.t - t0, hold = first ? 0 : HOLD, u = clamp((local - hold) / (s.dur - hold), 0, 1);
    const sp = s.span ?? [0, 1], e = lerp(sp[0], sp[1], smoothstep(0, 1, u)), el = lerp(sp[0], sp[1], smoothstep(0, 1, Math.min(1, u * 1.1)));
    if (s.space) { this.wren = wren; this.inSpace(wren, sys, s.space, u, e); }   // (camera, look and the ship placed round the body)
    else if (s.leave) { this.wren = wren; this.inLeave(wren, sys, s.leave, u, e); }
    else {
      path(s.eye, e, this.eye, this.v, 0.3);
      if (s.wren === 'liftoff') { this.wren = wren; this.liftoff(wren, local - hold, s.dur - hold); this.look.copy(wren.pos).addScaledVector(this.v[5].copy(wren.pos).normalize(), 4); }
      else if (s.look !== 'wren') path(s.look, el, this.look, this.v);
      this.up.copy(this.eye).normalize();
    }
    this.fov = lerp(s.fov[0], s.fov[1], e);
    this.clouds = s.clouds ?? [0, 0];
    this.close = !!s.leave;
    this.lift = s.leave || s.space ? 0.15 : 1;
    this.focus = s.focus ?? this.eye.distanceTo(this.look);
    this.day = s.day; this.tod = s.tod; this.drift = s.drift; this.warm = s.warm ?? 0; this.ev = s.ev ?? 1;
    // black beat, fade up; fade down at the end (longer at the very start and end)
    this.title = smoothstep(this.filmEnd - TITLE_IN, this.filmEnd - 0.4, this.t) * (1 - smoothstep(this.length - 1.8, this.length - 0.2, this.t));
    this.fade = local < hold ? 0 : Math.min(smoothstep(0, first ? FIRST_IN : FADE_IN, local - hold), smoothstep(0, last ? LAST_OUT : FADE_OUT, s.dur - local));
    return true;
  }

  /* leaving home: the camera high over Solenne (placed from the sun, so the globe is gibbous with the sun over the
     upper left), the Wren climbing out toward it from a speck against the globe: her distance shrinks at a steady
     rate, so she grows evenly in the frame instead of rushing at the end */
  private inLeave(w: Wren, sys: StarSystem, lv: NonNullable<Shot['leave']>, k: number, e: number) {
    const S = sys.sunPF, q = new THREE.Vector3(0, 1, 0).addScaledVector(S, -S.y).normalize();
    const d = S.clone().multiplyScalar(Math.cos(lv.sun * DEG)).addScaledVector(q, Math.sin(lv.sun * DEG)).normalize();
    this.eye.copy(d).multiplyScalar(PLANET_R + lv.alt);
    const f = d.clone().negate(), a = S.clone().addScaledVector(f, -S.dot(f)).normalize(), b = new THREE.Vector3().crossVectors(f, a);
    const u = a.clone().multiplyScalar(Math.SQRT1_2).addScaledVector(b, Math.SQRT1_2), r = new THREE.Vector3().crossVectors(f, u);
    this.up.copy(u);
    // the globe right of centre; the view drifts a little after her
    this.look.copy(this.eye).addScaledVector(f.clone().addScaledVector(r, lerp(-0.17, -0.25, e)).addScaledVector(u, lerp(-0.02, -0.05, e)).normalize(), 1000);
    // she sweeps out past the camera's left: yawed into her line and banked into it, so her face and flank show
    const at = (t: number, out: THREE.Vector3) => out.copy(f).addScaledVector(r, -0.05 - 0.57 * t * t).addScaledVector(u, lerp(-0.03, -0.15, t)).normalize()
      .multiplyScalar(1100 * Math.pow(30 / 1100, t)).add(this.eye);
    const p = at(k, this.v[4]), nose = at(Math.min(k + 0.01, 1), this.v[5]).sub(at(Math.max(k - 0.01, 0), this.v[3])).normalize().addScaledVector(r, -0.35).normalize();
    const port0 = new THREE.Vector3().crossVectors(u, nose).normalize(), up0 = new THREE.Vector3().crossVectors(nose, port0);
    const upB = up0.applyAxisAngle(nose, -0.28 * smoothstep(0.2, 1, k)), port = new THREE.Vector3().crossVectors(upB, nose);
    this.q.setFromRotationMatrix(this.m.makeBasis(port, upB, nose));
    w.stow();
    w.setPose(p, this.q);
    w.uThrust.value = 0.85;
  }

  /* out in space: the camera round a body (in its inertial frame), the Wren pulling away from it toward the world */
  private inSpace(w: Wren, sys: StarSystem, sp: NonNullable<Shot['space']>, k: number, e: number) {
    const B = sys.bodies[sp.body], R = BODIES[sp.body].radius, sol = sys.bodies[SOLENNE].pos;
    const S = new THREE.Vector3().copy(B.pos).negate().normalize(), P = B.pole;
    const e3 = P.clone().addScaledVector(S, -S.dot(P)).normalize(), e2 = new THREE.Vector3().crossVectors(e3, S);
    // on the sun's side of the rings (their lit face), the sun over the camera's right shoulder (on her flank)
    const ti = sp.tilt * DEG * Math.sign(S.dot(P) || 1), dir = new THREE.Vector3(), f = new THREE.Vector3(), u = new THREE.Vector3(), r = new THREE.Vector3();
    for (const side of [1, -1]) {
      const ph = sp.sun * DEG * side;
      dir.copy(S).multiplyScalar(Math.cos(ph)).addScaledVector(e2, Math.sin(ph)).multiplyScalar(Math.cos(ti)).addScaledVector(e3, Math.sin(ti));
      f.copy(dir).negate(); u.copy(e3).addScaledVector(f, -f.dot(e3)).normalize(); r.crossVectors(f, u).normalize();
      if (S.dot(r) > 0) break;
    }
    const base = B.pos.clone().addScaledVector(dir, sp.dist * R);
    const cam = base.clone().addScaledVector(r, lerp(-2, 2, e)).addScaledVector(u, lerp(0, 1.5, e));
    const toPF = (v: THREE.Vector3, out: THREE.Vector3) => out.copy(v).sub(sol).applyMatrix3(sys.ItoPF);
    toPF(cam, this.eye);
    // the world right of centre, the view easing a little after her
    toPF(cam.clone().addScaledVector(f.clone().addScaledVector(r, lerp(-0.2, -0.14, e)).addScaledVector(u, -0.03).normalize(), 1000), this.look);
    // she flies on at a steady pace (no easing: she never stops), from just ahead of the camera's left out toward the
    // world, her distance growing at a steady rate so she shrinks evenly into the picture
    const at = (t: number, out: THREE.Vector3) => out.copy(f).addScaledVector(r, lerp(-0.3, 0.1, t)).addScaledVector(u, lerp(-0.15, -0.035, t)).normalize()
      .multiplyScalar(32 * Math.pow(22, t)).add(cam);
    const ship = at(k, new THREE.Vector3()), vel = at(Math.min(k + 0.01, 1), new THREE.Vector3()).sub(at(Math.max(k - 0.01, 0), new THREE.Vector3())).normalize();
    // her pose: nose along her way, up along the pole
    this.up.copy(u).applyMatrix3(sys.ItoPF);
    const nose = vel.applyMatrix3(sys.ItoPF), port = new THREE.Vector3().crossVectors(this.up, nose).normalize(), up = new THREE.Vector3().crossVectors(nose, port);
    this.q.setFromRotationMatrix(this.m.makeBasis(port, up, nose));
    w.stow();
    w.setPose(toPF(ship, this.v[4]), this.q);
    w.uThrust.value = 0.7;
  }

  /* the Wren's departure: the ramp folds shut, she lifts, folds her legs and flies off toward the sunset, banking */
  private liftoff(w: Wren, s: number, dur: number) {
    if (s < 0) return;
    w.setDoor(false);
    const [a, b, c, d, p] = this.v;
    const g = groundH(WREN_SITE.x, WREN_SITE.z);
    // the jets spool up while the door closes (the grass starts to stir), then carry her
    w.uThrust.value = s < 3.4 ? 0.1 + 0.45 * smoothstep(1.6, 3.4, s) : w.uThrust.value + ((s < 7.4 ? 0.75 : 1) - w.uThrust.value) * 0.05;
    if (s < 3.4) return;          // (still parked: the door is closing)
    w.setGear(false);
    const nose0 = new THREE.Vector3(W_NOSE.x, 0, W_NOSE.z);
    // the flight path in flat space: up off the pad, then a widening curve to the west, climbing
    const B = [
      new THREE.Vector3(WREN_SITE.x, g + 22, WREN_SITE.z),
      new THREE.Vector3(WREN_SITE.x + nose0.x * 70, g + 34, WREN_SITE.z + nose0.z * 70),
      new THREE.Vector3(WREN_SITE.x + nose0.x * 120 + WEST.x * 220, g + 90, WREN_SITE.z + nose0.z * 120 + WEST.z * 220),
      new THREE.Vector3(WREN_SITE.x + WEST.x * 1300, g + 360, WREN_SITE.z + WEST.z * 1300),
    ];
    const bez = (t: number, out: THREE.Vector3) => { const m = 1 - t; return out.set(0, 0, 0).addScaledVector(B[0], m * m * m).addScaledVector(B[1], 3 * m * m * t).addScaledVector(B[2], 3 * m * t * t).addScaledVector(B[3], t * t * t); };
    const toPF = (v: THREE.Vector3, out: THREE.Vector3) => regionToPF(v.x, v.y, v.z, out);
    let noseF: THREE.Vector3, bank = 0;
    if (s < 7.4) {   // the rise: unstuck, a moment's hang, then up, level
      toPF(a.set(WREN_SITE.x, g + 0.6 * smoothstep(3.4, 4.1, s) + 21.4 * smoothstep(4.3, 7.4, s), WREN_SITE.z), p);
      noseF = nose0;
    } else {         // away, faster and faster
      const t = Math.pow(clamp((s - 7.4) / (dur - 7.4), 0, 1), 1.6);
      toPF(bez(t, a), p);
      const ahead = bez(Math.min(t + 0.01, 1), b).sub(bez(Math.max(t - 0.01, 0), c));
      noseF = ahead.normalize();
      const later = bez(Math.min(t + 0.04, 1), c).sub(bez(Math.min(t + 0.02, 1), d)).normalize();
      bank = clamp((noseF.x * later.z - noseF.z * later.x) * 14, -0.5, 0.5) * smoothstep(7.4, 9, s);   // into the turn
      noseF = noseF.clone().lerp(nose0, 1 - smoothstep(7.4, 9.5, s)).normalize();
    }
    // flat directions → planet-fixed at her position (east, up, north as in the region)
    const up0 = p.clone().normalize(), east = new THREE.Vector3(1, 0, 0).addScaledVector(up0, -up0.x).normalize(), north = new THREE.Vector3().crossVectors(east, up0);
    const nose = east.clone().multiplyScalar(noseF.x).addScaledVector(up0, noseF.y).addScaledVector(north, noseF.z).normalize();
    // she floats rather than rides rails: a faint wobble on the jets, the nose dipping as she starts forward
    const calm = 1 - 0.6 * smoothstep(9, 12, s), wob = smoothstep(3.4, 4.2, s) * calm;
    bank += 0.012 * Math.sin(s * 1.9) * wob;
    const pitch = 0.009 * Math.sin(s * 1.3 + 1) * wob - 0.07 * (smoothstep(7.0, 8.4, s) - smoothstep(8.8, 11.5, s));
    nose.applyAxisAngle(this.v[5].crossVectors(up0, nose).normalize(), -pitch);
    const upB = up0.clone().applyAxisAngle(this.v[5], -pitch).applyAxisAngle(nose, bank), port = new THREE.Vector3().crossVectors(upB, nose).normalize(), upO = new THREE.Vector3().crossVectors(nose, port);
    this.q.setFromRotationMatrix(this.m.makeBasis(port, upO, nose));
    w.setPose(p, this.q);
  }
}
