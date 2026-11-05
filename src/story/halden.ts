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
  sun: 'Solar filter engaged. I took the liberty. H swaps in the hydrogen-alpha one, if you want to see the weather up there.',
  halpha: 'Hydrogen-alpha. The sun in its own red light: the fine net, the dark filaments, and those flames off the edge are prominences. Each one would swallow Solenne whole.',
  flare: 'There. A flare, in that group of spots. Its light left the sun seven seconds ago; what it threw out will take a day or two to get here.',
  wren: 'There she is. Hull integrity adequate, moss integrity excellent.',
  aboard: 'Welcome aboard. I kept the lamps lit. The cat kept your bunk warm.',
  helm: 'Your chair. Sealing the door, mind your fingers. Space lifts her once it is shut; L puts her down again.',
  takeoff: 'And we are flying. She remembers how, which is more than I can say for the hinges.',
  landing: 'Bringing her down. Level, slow, legs out. Try to look as if this was the plan.',
  landed: 'Down, and in one piece. Leave the chair with E and I will lower the ramp.',
  held: 'Not while we are in the air. Press L and I will set her down first.',
  bump: 'That was a landing in the loosest sense of the word.',
  steep: 'Too steep to set her down here. Find flatter ground and press L again.',
  assistOff: 'Flight assist off. She will coast now, so gravity gets a vote. Z gives you the hold back.',
  cruise: 'Cruise drive. She goes as fast as the space around her allows: quick in the open, slow near anything heavy. J drops us out.',
  cruiseNo: 'Not this close to the ground. The drive wants thirty kilometres of room from any surface.',
  drop: 'Out of the cruise. Normal speeds again.',
  arrive: 'Parking orbit. She will circle on her own; Z puts the hold back on if you would rather sit still.',
  noTarget: 'Fly where, exactly? T picks a target, or open the map with M.',
  autopilot: 'Autopilot. I will climb out, turn, cruise and park. Touch the controls and she is yours again.',
  warpNo: 'Not here. Time only hurries in open space, coasting, with the drive off.',
  leftHome: "That is Solenne's pull behind us. From here on the sun has the final word.",
  noLand: 'Land on what? Bring her below a hundred kilometres over Solenne first, then L.',
  map: 'The system, as it stands. Click a world to set a course; G and I will take us there.',
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
/** while the showcase plays Halden keeps quiet (and saves what he would have said for later) */
export const story = { quiet: false };
export function halden(line: HaldenLine, once = true, polite = false) {
  if (story.quiet || (once && said.has(line))) return;
  const box = document.getElementById('say'), text = document.getElementById('sayLine');
  if (!box || !text || (polite && !box.hidden)) return;
  said.add(line);
  say(LINES[line]);
}
