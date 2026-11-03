import { voice } from './voice';

/* Halden, the Wren's AI: one subtitle line at a time, spoken aloud when a voice is available. */
const LINES = {
  arrival: 'Atmosphere nominal, gravity one g, population… none detected. Welcome home. The cottage appears to have waited for you.',
  night: 'Local night. I would offer a lamp, but you appear to own a cottage.',
  orbit: 'For the record, the cloud sea looks better from up here. It also looks exactly as empty.',
  under: 'Below the cloud sea. Visibility poor, sunlight none. Whoever lived down here had a great deal of patience.',
  moon: 'Lull. A million years, and it still shows us the same face. Loyal, or merely stubborn.',
  orrin: 'Orrin, rings and all. Some things in this system kept better than we did.',
  eclipse: 'Lull is crossing the sun. I would tell you not to stare, but you never listened to me before either.',
  scope: 'The old brass telescope. Still collimated, more or less. Scroll to bring things closer; it will follow whatever you centre.',
  sun: 'Solar filter engaged. I took the liberty.',
  wren: 'There she is. Hull integrity adequate, moss integrity excellent.',
  aboard: 'Welcome aboard. I kept the lamps lit. The cat kept your bunk warm.',
} as const;
export type HaldenLine = keyof typeof LINES;

export const SAMPLE = 'Halden here. Still here, I mean. Someone has to keep an eye on things.';
const said = new Set<HaldenLine>();
let hideT = 0;
function hideAfter(ms: number) {
  const box = document.getElementById('say')!;
  clearTimeout(hideT);
  hideT = window.setTimeout(() => { box.classList.add('fade'); hideT = window.setTimeout(() => { box.hidden = true; }, 1300); }, ms);
}
/** show (and speak) a line; the subtitle stays up while Halden is talking and a little after */
export function say(text: string) {
  const box = document.getElementById('say'), el = document.getElementById('sayLine');
  if (!box || !el) return;
  el.textContent = text;
  box.hidden = false; box.classList.remove('fade');
  const t0 = performance.now();
  if (voice.speak(text, () => hideAfter(Math.max(1800, 5000 - (performance.now() - t0))))) hideAfter(voice.estimate(text) + 4000);
  else hideAfter(7000);
}
/** `polite` lines (remarks on what you look at) wait until Halden has finished speaking */
export function halden(line: HaldenLine, once = true, polite = false) {
  if (once && said.has(line)) return;
  const box = document.getElementById('say'), text = document.getElementById('sayLine');
  if (!box || !text || (polite && !box.hidden)) return;
  said.add(line);
  say(LINES[line]);
}
