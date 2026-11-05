import * as THREE from 'three';
import { DAY_SECONDS, YEAR_DAYS } from '../config';
import { clamp, smoothstep } from '../core/math';

/* =========================================================================
   Seren's surface (M6). The sun turns on a pole tilted 7° from the
   ecliptic's, faster at its equator than near the poles, and its activity
   is a pure function of game time like the orbits: active regions (sunspot
   groups with their faculae and plage) are born in two belts that creep
   toward the equator over an 11-year cycle, grow, flare now and then and
   decay; filaments lie along them and at higher latitudes and stand off the
   limb as prominences; a big flare can lift its filament off the sun and
   leave an arcade of loops behind. The far pass shades the photosphere and
   the chromosphere from these lists (farShaders.ts); only the ones on the
   side facing the camera go to the GPU.
   ========================================================================= */
const D = DAY_SECONDS, H = 3600, DEG = Math.PI / 180, TAU = Math.PI * 2;
export const NAR = 12, NPR = 10;            // active regions and prominences drawn
const ROT_EQ = 9 * D;                       // sidereal rotation at the equator (the real sun: 25 days)
const CYCLE = 11 * YEAR_DAYS * D;           // the activity cycle: eleven game years
const SLOT = 0.25 * D, LIFE_MAX = 14 * D;   // a chance of a new active region every six hours
const FIL_SLOT = 0.5 * D, FIL_LIFE = 24 * D;
const FLARE_BACK = 3 * H;                   // a flare is over three hours after it starts
const ERUPT_T = 50 * 60;                    // an eruptive prominence takes this long to leave the frame

const POLE = new THREE.Vector3(Math.sin(7.25 * DEG) * Math.cos(75 * DEG), Math.sin(7.25 * DEG) * Math.sin(75 * DEG), Math.cos(7.25 * DEG));
const M0 = new THREE.Vector3(0, 0, 1).cross(POLE).normalize();
const E0 = new THREE.Vector3().crossVectors(POLE, M0);
const W_EQ = TAU / ROT_EQ;
/** differential rotation (rad/s) at latitude φ (the sun's own law, scaled to the game's rotation) */
const omega = (lat: number) => { const s2 = Math.sin(lat) ** 2; return W_EQ * (1 - 0.16 * s2 - 0.12 * s2 * s2); };

/** integer hash → [0, 1) */
function rnd(a: number, b: number, c: number) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x3c6ef372, 0x165667b1) ^ Math.imul((c | 0) + 0x5bd1e995, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** activity (0.25 … 1) and the mean latitude of new regions: the butterfly diagram */
export function solarCycle(t: number) {
  const p = ((t / CYCLE + 0.4) % 1 + 1) % 1;   // day 1 falls a little after maximum
  return { level: 0.25 + 0.75 * Math.sin(Math.PI * p) ** 2, lat: (30 - 22 * p) * DEG };
}

type Flare = { f: number; age: number; erupt: number; arcade: number };
type Region = {
  id: number; tb: number; life: number; lat: number; lon0: number; S: number; tilt: number; seed: number;
  n: THREE.Vector3; kL: number; kF: number; plage: number; fl: Flare;
};
type Prom = { m: THREE.Vector3; a: THREE.Vector3; len: number; h: number; kind: number; seed: number; p: number; k: number; mu: number };

const v = () => new THREE.Vector3();
const tA = v(), tB = v(), tC = v();

export class SunActivity {
  level = 1;
  mer = v(); east = v();          // the sun's rotating (Carrington) meridian and east, inertial frame
  readonly pole = POLE.clone();
  regions: Region[] = [];
  proms: Prom[] = [];
  /** a flare started by hand (the flare() dev hook) */
  forced: { id: number; t0: number } | null = null;
  uniforms = {
    uNAR: { value: 0 },
    uAR: { value: Array.from({ length: NAR }, () => new THREE.Vector4()) },    // centre (L), extent on the sun (radians)
    uAR2: { value: Array.from({ length: NAR }, () => new THREE.Vector4()) },   // bipole tilt, seed, leader and follower spot growth
    uAR3: { value: Array.from({ length: NAR }, () => new THREE.Vector4()) },   // flare brightness, flare age (ribbons part), plage
    uNPR: { value: 0 },
    uPR: { value: Array.from({ length: NPR }, () => new THREE.Vector4()) },    // foot centre (L), half-length (radians)
    uPR2: { value: Array.from({ length: NPR }, () => new THREE.Vector4()) },   // along the filament (L), height (sun radii)
    uPR3: { value: Array.from({ length: NPR }, () => new THREE.Vector4()) },   // kind (0 sheet, 1 loop arcade, 2 eruption), seed, thickness or eruption, strength
  };

  /** where a point of the sun at latitude lat, Carrington longitude lon lies now (inertial frame) */
  private onSun(lat: number, lon: number, out: THREE.Vector3) {
    const c = Math.cos(lat);
    return out.copy(this.mer).multiplyScalar(c * Math.cos(lon)).addScaledVector(this.east, c * Math.sin(lon)).addScaledVector(POLE, Math.sin(lat));
  }
  /** a direction in the sun's surface at n, at angle α from east toward north */
  private along(n: THREE.Vector3, alpha: number, out: THREE.Vector3) {
    const e = tA.crossVectors(POLE, n).normalize(), nn = tB.crossVectors(n, e);
    return out.copy(e).multiplyScalar(Math.cos(alpha)).addScaledVector(nn, Math.sin(alpha));
  }

  private flareOf(r: Region, t: number): Flare {
    const out: Flare = { f: 0, age: 0, erupt: -1, arcade: 0 };
    const take = (t0: number, tr: number, td: number, m: number, eruptive: boolean) => {
      const tau = t - t0;
      if (tau < 0 || tau > FLARE_BACK) return;
      const f = m * (tau < tr ? smoothstep(0, tr, tau) : Math.exp(-(tau - tr) / td));
      if (f <= out.f) return;
      out.f = f; out.age = clamp(tau / (tr + 2.5 * td), 0, 1);
      out.erupt = eruptive ? clamp((tau - 0.4 * tr) / ERUPT_T, 0, 1) : -1;
      out.arcade = eruptive ? smoothstep(tr, tr + 600, tau) * Math.exp(-Math.max(tau - tr, 0) / (2.5 * td)) : 0;
    };
    // the bigger the group, the more often it flares (a few an hour from a monster, one a day from a pore)
    const p = (0.04 + 0.5 * (r.S / 0.06) ** 2) * r.kL;
    for (let h = Math.floor((t - FLARE_BACK) / H); h <= Math.floor(t / H); h++) {
      if (h * H < r.tb || rnd(r.id, h, 7) > p) continue;
      take((h + rnd(r.id, h, 8)) * H, 120 + 360 * rnd(r.id, h, 9), 900 + 2400 * rnd(r.id, h, 10), 0.3 + 0.7 * rnd(r.id, h, 11) ** 2, rnd(r.id, h, 12) < 0.4);
    }
    if (this.forced?.id === r.id) take(this.forced.t0, 240, 1800, 1, true);
    return out;
  }

  /** everything on the sun at game time t */
  update(t: number) {
    const w = W_EQ * t;
    this.mer.copy(M0).multiplyScalar(Math.cos(w)).addScaledVector(E0, Math.sin(w));
    this.east.crossVectors(POLE, this.mer);
    const cyc = solarCycle(t);
    this.level = cyc.level;
    // active regions: two chances per slot, each lives 2–14 days; big ones are rare and live longest
    this.regions.length = 0;
    for (let i = Math.floor((t - LIFE_MAX) / SLOT); i <= Math.floor(t / SLOT); i++) {
      const c = solarCycle(i * SLOT);
      for (let j = 0; j < 2; j++) {
        if (rnd(i, j, 1) > 0.55 * c.level) continue;
        const id = i * 2 + j, tb = (i + rnd(i, j, 2)) * SLOT, big = rnd(i, j, 3) ** 3;
        const life = (2 + 12 * Math.pow(big, 0.6)) * D;
        if (t < tb || t > tb + life) continue;
        const lat = (rnd(i, j, 4) < 0.5 ? -1 : 1) * Math.max(c.lat + 7 * DEG * (rnd(i, j, 5) + rnd(i, j, 6) - 1), 3 * DEG);
        const fr = (t - tb) / life;
        const r: Region = {
          id, tb, life, lat, lon0: TAU * rnd(i, j, 7), S: 0.014 + 0.05 * big,
          tilt: -0.5 * lat + 0.25 * (rnd(i, j, 8) - 0.5), seed: rnd(i, j, 9) * 97,   // Joy's law: the leader sits nearer the equator
          n: v(), kL: smoothstep(0, 0.12, fr) * (1 - smoothstep(0.55, 1, fr)), kF: smoothstep(0.02, 0.15, fr) * (1 - smoothstep(0.3, 0.7, fr)),
          plage: smoothstep(0, 0.1, fr) * (1 - smoothstep(0.8, 1, fr)), fl: { f: 0, age: 0, erupt: -1, arcade: 0 },
        };
        // it drifts against the Carrington frame by the differential rotation at its latitude
        this.onSun(lat, r.lon0 + (omega(lat) - W_EQ) * (t - tb), r.n);
        r.fl = this.flareOf(r, t);
        this.regions.push(r);
      }
    }
    // prominences: quiescent hedgerows at mid latitudes, low filaments along the bigger groups, eruptions and their loops
    this.proms.length = 0;
    for (let i = Math.floor((t - FIL_LIFE) / FIL_SLOT); i <= Math.floor(t / FIL_SLOT); i++) {
      if (rnd(i, 0, 21) > 0.4 + 0.4 * cyc.level) continue;
      const tb = (i + rnd(i, 0, 22)) * FIL_SLOT, life = (5 + 19 * rnd(i, 0, 23)) * D;
      if (t < tb || t > tb + life) continue;
      const lat = (rnd(i, 0, 24) < 0.5 ? -1 : 1) * (22 + 36 * rnd(i, 0, 25)) * DEG;
      const m = this.onSun(lat, TAU * rnd(i, 0, 26) + (omega(lat) - W_EQ) * (t - tb), v());
      const k = smoothstep(tb, tb + D, t) * (1 - smoothstep(tb + life - D, tb + life, t));
      this.proms.push({ m, a: this.along(m, (rnd(i, 0, 27) - 0.5) * 70 * DEG * Math.sign(lat), v()), len: 0.07 + 0.22 * rnd(i, 0, 28),
        h: 0.03 + 0.07 * rnd(i, 0, 29), kind: 0, seed: rnd(i, 0, 30) * 97, p: 0.012 + 0.012 * rnd(i, 0, 31), k, mu: 0 });
    }
    for (const r of this.regions) {
      if (r.S < 0.02 || r.plage < 0.3) continue;
      const pil = this.along(r.n, r.tilt + Math.PI / 2, v()), e = r.fl.erupt;
      // the filament along the polarity line, gone once it has erupted
      const len = Math.max(1.2 * r.S, 0.04), h = 0.01 + 0.25 * r.S;
      if (e < 0) this.proms.push({ m: r.n.clone(), a: pil, len, h, kind: 0, seed: r.seed, p: 0.01, k: r.plage, mu: 0 });
      else if (e < 1) this.proms.push({ m: r.n.clone(), a: pil, len, h, kind: 2, seed: r.seed, p: e, k: 1, mu: 0 });
      // post-flare loops straddle the polarity line, an arcade as long as the filament was
      if (r.fl.arcade > 0.02) this.proms.push({ m: r.n.clone(), a: this.along(r.n, r.tilt, v()), len: (0.12 + 0.3 * r.fl.age) * r.S,
        h: (0.1 + 0.25 * r.fl.age) * r.S, kind: 1, seed: r.seed, p: 0.9 * r.S, k: r.fl.arcade, mu: 0 });
    }
  }

  /** fill the GPU lists from the camera: toCam is the unit direction from the sun to the camera (inertial) */
  view(ItoL: THREE.Matrix3, toCam: THREE.Vector3) {
    const U = this.uniforms;
    // regions on the near side, biggest first (their prominences have their own list)
    const regs = this.regions.filter((r) => r.n.dot(toCam) > -0.05).sort((a, b) => b.S * (b.kL + b.plage) - a.S * (a.kL + a.plage)).slice(0, NAR);
    regs.forEach((r, i) => {
      const n = tC.copy(r.n).applyMatrix3(ItoL);
      U.uAR.value[i].set(n.x, n.y, n.z, r.S);
      U.uAR2.value[i].set(r.tilt, r.seed, r.kL, r.kF);
      U.uAR3.value[i].set(r.fl.f, r.fl.age, r.plage, 0);
    });
    U.uNAR.value = regs.length;
    // prominences: eruptions and loops first, then half the rest standing off the limb, half as filaments across the disc
    for (const p of this.proms) p.mu = p.m.dot(toCam);
    const size = (p: Prom) => p.k * p.len * p.h;
    const flares = this.proms.filter((p) => p.kind > 0 && p.mu > -0.4);
    const limb = this.proms.filter((p) => p.kind === 0 && Math.abs(p.mu) < 0.4).sort((a, b) => size(b) * (1.3 - Math.abs(b.mu)) - size(a) * (1.3 - Math.abs(a.mu)));
    const disc = this.proms.filter((p) => p.kind === 0 && p.mu >= 0.4).sort((a, b) => size(b) - size(a));
    const nLimb = Math.min(limb.length, Math.max(NPR - flares.length - disc.length, Math.ceil((NPR - flares.length) / 2)));
    const proms = [...flares, ...limb.slice(0, nLimb), ...disc].slice(0, NPR);
    proms.forEach((p, i) => {
      const m = tC.copy(p.m).applyMatrix3(ItoL);
      U.uPR.value[i].set(m.x, m.y, m.z, p.len);
      const a = tC.copy(p.a).applyMatrix3(ItoL);
      U.uPR2.value[i].set(a.x, a.y, a.z, p.h);
      U.uPR3.value[i].set(p.kind, p.seed, p.p, p.k);
    });
    U.uNPR.value = proms.length;
  }

  /** the strongest flare on the side facing toCam, and whether something is erupting off the limb there */
  flareSeen(toCam: THREE.Vector3) {
    let f = 0, limb = false;
    for (const r of this.regions) {
      const mu = r.n.dot(toCam);
      if (mu > 0.02) f = Math.max(f, r.fl.f);
      if (r.fl.erupt > 0 && r.fl.erupt < 1 && Math.abs(mu) < 0.4) limb = true;
    }
    return { f, limb };
  }
  /** start a big eruptive flare now in the largest group facing toCam (or the one nearest the limb, to see it lift off) */
  flareNow(t: number, toCam: THREE.Vector3, limb = false) {
    const cand = this.regions.filter((r) => r.S >= 0.02 && r.plage > 0.3 && r.n.dot(toCam) > (limb ? 0.02 : 0.3) && (!limb || r.n.dot(toCam) < 0.45));
    cand.sort((a, b) => limb ? a.n.dot(toCam) - b.n.dot(toCam) : b.S - a.S);
    const r = cand[0];
    if (!r) return null;
    this.forced = { id: r.id, t0: t };
    return { mu: +r.n.dot(toCam).toFixed(2), size: +r.S.toFixed(3) };
  }
}
