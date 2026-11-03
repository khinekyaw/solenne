import { clamp, smoothstep } from '../core/math';
import { N2a, N2b } from '../core/noise';

/* =========================================================================
   Soundscape: everything is synthesized live with Web Audio (no audio files)
   ========================================================================= */
export type SoundInfo = {
  windStr: number; gust: number; exposure: number; high: number; nearGround: number; grassH: number;
  moving: number; speed: number; onGround: boolean; fly: boolean; bob: number; windPan: number;
  indoor: number; wood: boolean; fireDist: number; rain: number;
  falls: number; shore: number;   // 0 … 1 closeness to a waterfall, to open water
};
export type Soundscape = ReturnType<typeof createSoundscape>;

export function createSoundscape(ctx: AudioContext) {
  const R = Math.random, rr = (a: number, b: number) => a + (b - a) * R();
  const sr = ctx.sampleRate;
  const now = () => ctx.currentTime;
  const set = (param: AudioParam, v: number, tc: number) => param.setTargetAtTime(v, now(), tc);
  const gain = (v: number) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const biquad = (type: BiquadFilterType, f: number, q: number) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };

  function buffer(seconds: number, fill: (d: Float32Array, len: number) => void) {
    const len = Math.floor(sr * seconds), buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      fill(d, len);
      // equal-power crossfade of the tail into the head so the loop has no seam
      const n = 4096;
      for (let i = 0; i < n; i++) { const k = i / n; d[len - n + i] = d[len - n + i] * Math.sqrt(1 - k) + d[i] * Math.sqrt(k); }
      let e = 0; for (let i = 0; i < len; i++) e += d[i] * d[i];
      const g = 0.2 / Math.sqrt(e / len + 1e-12);
      for (let i = 0; i < len; i++) d[i] *= g;
    }
    return buf;
  }
  const pink = buffer(7, (d, len) => {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = R() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
    }
  });
  const brown = buffer(8, (d, len) => { let l = 0; for (let i = 0; i < len; i++) { l = (l + 0.02 * (R() * 2 - 1)) / 1.02; d[i] = l; } });
  // crackle of blades brushing together: noise chopped into tiny random-level grains
  const rustleBuf = buffer(6, (d, len) => {
    let env = 0, tgt = 0, next = 0;
    for (let i = 0; i < len; i++) {
      if (i >= next) { tgt = 0.25 + 0.75 * Math.pow(R(), 1.5); next = i + Math.floor(sr * rr(0.03, 0.12)); }
      env += (tgt - env) * 0.0008;
      d[i] = (R() * 2 - 1) * env;
    }
  });
  // ---- buses ----
  const master = gain(0);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 8; comp.ratio.value = 6; comp.attack.value = 0.02; comp.release.value = 0.5;
  const trim = gain(0.8);
  master.connect(comp).connect(trim).connect(ctx.destination);
  const nature = gain(0);
  const duck = gain(1);   // dips the wind and grass while Halden speaks
  nature.connect(duck).connect(master);
  const loop = (buf: AudioBuffer, rate: number) => { const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = rate; src.start(0, R() * buf.duration); return src; };

  // ---- wind ----
  const windPan = ctx.createStereoPanner(); windPan.connect(nature);
  const roarF = biquad('lowpass', 200, 0.5), roarG = gain(0);
  loop(brown, 1).connect(roarF).connect(roarG).connect(windPan);
  const bodyF = biquad('bandpass', 480, 0.55), bodyG = gain(0);
  loop(pink, 0.97).connect(bodyF).connect(bodyG).connect(windPan);
  const whistles = [-0.55, 0.5].map((pan, i) => {
    const f = biquad('bandpass', 700 + i * 340, 14), g = gain(0), pn = ctx.createStereoPanner(); pn.pan.value = pan;
    loop(pink, 1.03 + i * 0.05).connect(f).connect(g).connect(pn).connect(nature);
    return { f, g, base: 620 + i * 380, ph: R() * 6 };
  });
  // ---- grass, fire, rain ----
  const crackleBuf = buffer(5, (d, len) => {
    let env = 0;
    for (let i = 0; i < len; i++) {
      if (R() < 9 / sr) env = rr(0.4, 1);
      else if (R() < 70 / sr) env = Math.max(env, rr(0.05, 0.25));
      env *= 0.9965;
      d[i] = (R() * 2 - 1) * env + (R() * 2 - 1) * 0.02;
    }
  });
  const crkF = biquad('bandpass', 2200, 0.5), crkG = gain(0);
  loop(crackleBuf, 1).connect(crkF).connect(crkG).connect(nature);
  const roomF = biquad('lowpass', 1800, 0.6), roomG = gain(0);
  loop(brown, 0.8).connect(roomF).connect(roomG).connect(nature);
  // rain: a soft hiss plus the patter of individual drops; indoors it becomes drumming on the roof
  const patterBuf = buffer(4, (d, len) => { let env = 0; for (let i = 0; i < len; i++) { if (R() < 2200 / sr) env = Math.max(env, rr(0.15, 1)); env *= 0.985; d[i] = (R() * 2 - 1) * env; } });
  const rainF1 = biquad('highpass', 800, 0.5), rainF2 = biquad('lowpass', 6500, 0.5), rainG = gain(0);
  loop(pink, 1.13).connect(rainF1).connect(rainF2).connect(rainG).connect(nature);
  const patF = biquad('bandpass', 3000, 0.7), patG = gain(0);
  loop(patterBuf, 1).connect(patF).connect(patG).connect(nature);
  const roofF = biquad('lowpass', 1000, 0.7), roofG = gain(0);
  loop(patterBuf, 0.55).connect(roofF).connect(roofG).connect(nature);
  function thunder(dist: number, indoor: boolean) {
    const t = now() + 0.02, near = clamp(1 - dist / 1800, 0, 1);
    const len = 2.5 + 4 * (1 - near) + R() * 2, A = 0.35 + 1.25 * near;
    const src = ctx.createBufferSource(); src.buffer = brown; src.loop = true; src.playbackRate.value = rr(0.5, 0.72);
    const lp = biquad('lowpass', (110 + 650 * near * near) * (indoor ? 0.55 : 1), 0.8), g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(A, t + 0.04 + 0.3 * (1 - near));
    for (let k = t + 0.35; k < t + len; k += rr(0.25, 0.7)) g.gain.setTargetAtTime(A * rr(0.25, 0.95), k, 0.15);
    g.gain.setTargetAtTime(0.0001, t + len, 0.7);
    src.connect(lp).connect(g).connect(nature); src.start(t, R() * 6); src.stop(t + len + 4);
    if (near > 0.55 && !indoor) {   // the sharp crack of a close strike
      const c = ctx.createBufferSource(); c.buffer = pink;
      const hp = biquad('highpass', 900, 0.6), cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t); cg.gain.exponentialRampToValueAtTime(0.9 * near, t + 0.01); cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      c.connect(hp).connect(cg).connect(nature); c.start(t, R() * 5, 0.6);
      setTimeout(() => cg.disconnect(), 1500);
    }
    setTimeout(() => g.disconnect(), (len + 5) * 1000);
  }
  // water: the deep roar of a fall (rumble + hiss) and slow lapping at the shore
  const fallLo = biquad('lowpass', 420, 0.6), fallLoG = gain(0);
  loop(brown, 0.9).connect(fallLo).connect(fallLoG).connect(nature);
  const fallHi = biquad('bandpass', 1500, 0.5), fallHiG = gain(0);
  loop(pink, 0.92).connect(fallHi).connect(fallHiG).connect(nature);
  const lapF = biquad('lowpass', 900, 0.7), lapG = gain(0);
  loop(pink, 0.6).connect(lapF).connect(lapG).connect(nature);
  const rustHP = biquad('highpass', 700, 0.5), rustLP = biquad('lowpass', 3200, 0.5), rustG = gain(0);
  loop(rustleBuf, 1).connect(rustHP).connect(rustLP).connect(rustG).connect(nature);

  function knock(strength: number) {
    const t = now() + 0.005;
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.setValueAtTime(rr(150, 190), t); o.frequency.exponentialRampToValueAtTime(90, t + 0.08);
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.5 * strength, t + 0.006); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(og).connect(nature); o.start(t); o.stop(t + 0.14);
    const b = ctx.createBufferSource(); b.buffer = brown;
    const f = biquad('bandpass', rr(500, 800), 1.2), g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9 * strength, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    b.connect(f).connect(g).connect(nature); b.start(t, R() * 7, 0.1);
    setTimeout(() => { og.disconnect(); g.disconnect(); }, 400);
  }
  function step(strength: number, wood: boolean) {
    if (wood) return knock(strength);
    const t = now() + 0.005;
    const a = ctx.createBufferSource(); a.buffer = rustleBuf; a.playbackRate.value = rr(0.75, 1.1);
    const f = biquad('bandpass', rr(900, 1600), 0.6), g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.55 * strength, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + rr(0.15, 0.22));
    a.connect(f).connect(g).connect(nature); a.start(t, R() * 5, 0.3);
    const b = ctx.createBufferSource(); b.buffer = brown;
    const lf = biquad('lowpass', 240, 0.7), tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, t); tg.gain.exponentialRampToValueAtTime(0.7 * strength, t + 0.012); tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    b.connect(lf).connect(tg).connect(nature); b.start(t, R() * 7, 0.15);
    setTimeout(() => { g.disconnect(); tg.disconnect(); }, 600);
  }

  // ---- control ----
  let levels = { nature: 0.7, muted: false };
  let acc = 0, lastPh = 0, air = 0, suspendT = 0;
  function setLevels(o: { natureVol: number; muted: boolean }) {
    levels = { nature: o.natureVol / 100, muted: o.muted };
    set(nature.gain, Math.pow(levels.nature, 1.6), 0.1);
    clearTimeout(suspendT);
    if (levels.muted) {
      set(master.gain, 0, 0.12);
      suspendT = window.setTimeout(() => { if (levels.muted && ctx.state === 'running') ctx.suspend(); }, 700);
    } else {
      if (ctx.state !== 'running') ctx.resume();
      set(master.gain, 1, 0.8);
    }
  }

  function update(dt: number, s: SoundInfo) {
    if (levels.muted || ctx.state !== 'running') return;
    // footsteps follow the head-bob cycle
    const ph = Math.floor(s.bob / Math.PI);
    if (ph !== lastPh) { lastPh = ph; if (s.onGround && !s.fly && s.speed > 0.6) step((0.5 + 0.5 * clamp(s.speed / 9.5, 0, 1)) * (s.wood ? 1 : 0.6 + 0.4 * s.grassH), s.wood); }
    if (!s.onGround && !s.fly) air += dt; else { if (air > 0.3) step(1.4, s.wood); air = 0; }

    acc += dt; if (acc < 0.07) return; acc = 0;
    const t = now();
    const ws = s.windStr, g = s.gust;
    const flutter = 1 + 0.2 * N2a(t * 0.3, 3.3) + 0.05 * N2b(t * 0.8, 7.7);
    const muff = 1 - 0.8 * s.indoor;
    const wind = (0.1 + 0.9 * ws) * (0.4 + 0.6 * g) * (0.8 + 0.6 * s.exposure) * flutter * muff;
    set(bodyG.gain, 0.6 * wind, 0.5); set(bodyF.frequency, 220 + 330 * wind, 0.6);
    set(roarG.gain, 0.7 * wind * (0.5 + 0.5 * ws), 0.35); set(roarF.frequency, 140 + 260 * wind, 0.35);
    const wh = smoothstep(0.25, 1, ws) * (0.25 + 0.75 * g) * (0.35 + 0.65 * s.exposure);
    for (const w of whistles) {
      set(w.g.gain, 1.5 * wh * (0.6 + 0.4 * Math.sin(t * 0.21 + w.ph)), 0.5);
      set(w.f.frequency, w.base * (1 + 0.12 * Math.sin(t * 0.13 + w.ph) + 0.18 * g * ws), 0.6);
    }
    const rustle = (Math.pow(ws, 0.8) * (0.15 + 0.85 * g) * (0.5 + 0.5 * s.grassH) * (1 - 0.9 * s.indoor) + (s.wood ? 0 : s.moving * 0.25)) * s.nearGround;
    set(rustG.gain, 0.32 * rustle, 0.5);
    set(windPan.pan, s.windPan * 0.35, 0.5);
    set(crkG.gain, 0.5 / (1 + s.fireDist * s.fireDist * 0.12), 0.3);
    set(roomG.gain, 0.05 / (1 + s.fireDist * s.fireDist * 0.3), 0.3);
    const rn = s.rain || 0;
    set(rainG.gain, 0.45 * rn * (1 - 0.85 * s.indoor), 0.6);
    set(patG.gain, 0.4 * rn * (1 - 0.8 * s.indoor), 0.6);
    set(roofG.gain, 0.85 * rn * s.indoor, 0.4);
    const fl = Math.pow(s.falls, 1.6) * (1 - 0.7 * s.indoor);
    set(fallLoG.gain, 0.9 * fl, 0.4); set(fallHiG.gain, 0.35 * fl, 0.4);
    set(lapG.gain, 0.35 * s.shore * (0.45 + 0.55 * Math.max(0, Math.sin(t * 0.7) * Math.sin(t * 0.31 + 1.3))), 0.25);
  }

  return { setLevels, update, duck: (on: boolean) => set(duck.gain, on ? 0.45 : 1, on ? 0.25 : 1.2), thunder: (d: number, i: boolean) => { if (!levels.muted && ctx.state === 'running') thunder(d, i); }, ctx };
}
