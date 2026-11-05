/* =========================================================================
   A quiet pad for the showcase, synthesized like the rest of the sound: four
   slow chords in D major (soft detuned triangles through a low-pass), a few
   sparse bell notes from the pentatonic scale, all in a long generated
   reverb. Start and stop fade over seconds; nothing is loaded.
   ========================================================================= */
const CHORDS = [
  [50, 57, 61, 64, 66],   // Dmaj9
  [47, 54, 57, 62, 64],   // Bm11
  [43, 50, 54, 57, 59],   // Gmaj9
  [45, 52, 54, 59, 62],   // A6sus
];
const BELLS = [74, 76, 78, 81, 83, 86];   // D major pentatonic, high
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export function createPad(ctx: AudioContext) {
  const out = ctx.createGain(); out.gain.value = 0;
  // the room: a generated stereo tail, 4.5 s
  const verb = ctx.createConvolver(), len = Math.floor(ctx.sampleRate * 4.5), ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
  verb.buffer = ir;
  const wet = ctx.createGain(); wet.gain.value = 0.7;
  const dry = ctx.createGain(); dry.gain.value = 0.35;
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 1300; tone.Q.value = 0.4;
  tone.connect(dry); tone.connect(verb); verb.connect(wet); dry.connect(out); wet.connect(out); out.connect(ctx.destination);
  // the low-pass breathes slowly
  const lfo = ctx.createOscillator(), lfoG = ctx.createGain(); lfo.frequency.value = 0.07; lfoG.gain.value = 350;
  lfo.connect(lfoG); lfoG.connect(tone.frequency); lfo.start();

  let timer = 0, bellT = 0, chord = 0, running = false;
  function voice(m: number, t0: number, dur: number, level: number) {
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(level, t0 + 3); g.gain.setValueAtTime(level, t0 + dur - 3.5); g.gain.linearRampToValueAtTime(0, t0 + dur + 0.5);
    g.connect(tone);
    for (const det of [-5, 5]) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz(m); o.detune.value = det;
      o.connect(g); o.start(t0); o.stop(t0 + dur + 0.6);
    }
  }
  function bell(t0: number) {
    const m = BELLS[Math.floor(Math.random() * BELLS.length)], g = ctx.createGain();
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.05, t0 + 0.006); g.gain.exponentialRampToValueAtTime(0.0005, t0 + 3.2);
    g.connect(verb); g.connect(out);
    for (const [k, a] of [[1, 1], [2.01, 0.25]] as const) {
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.value = hz(m) * k; og.gain.value = a;
      o.connect(og); og.connect(g); o.start(t0); o.stop(t0 + 3.3);
    }
  }
  // schedule a little ahead on a timer: one chord every 7 s (overlapping), a bell now and then
  function tick() {
    const t = ctx.currentTime;
    while (timer < t + 1.5) { for (const m of CHORDS[chord % CHORDS.length]) voice(m, timer, 9, m < 48 ? 0.05 : 0.032); chord++; timer += 7; }
    while (bellT < t + 1.5) { if (Math.random() < 0.7) bell(bellT); bellT += 1.6 + Math.random() * 2.6; }
  }
  let iv = 0;
  return {
    start(level = 0.55) {
      if (running) return;
      running = true;
      const t = ctx.currentTime;
      timer = t + 0.1; bellT = t + 4; chord = 0;
      out.gain.cancelScheduledValues(t); out.gain.setTargetAtTime(level, t, 1.2);
      tick(); iv = window.setInterval(tick, 400);
    },
    stop() {
      if (!running) return;
      running = false;
      window.clearInterval(iv);
      out.gain.cancelScheduledValues(ctx.currentTime); out.gain.setTargetAtTime(0, ctx.currentTime, 1.0);
    },
  };
}
export type Pad = ReturnType<typeof createPad>;
