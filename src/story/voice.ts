import { settings } from '../settings';

/* =========================================================================
   Halden's voice: the browser's own speech synthesis (Web Speech API), no
   audio files. Voices load asynchronously (voiceschanged); novelty voices
   are skipped and a calm British voice is preferred. Lines stay short:
   Chrome cuts utterances off after ~15 s and then never fires 'end', so the
   caller also gets a fallback by estimated length. Speech can't be routed
   through Web Audio, so the soundscape ducks under it instead.
   ========================================================================= */
const synth: SpeechSynthesis | null = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
const NOVELTY = /bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|fred|junior|ralph|kathy|grandma|grandpa|rocko|eddy|flo\b|sandy|shelley|reed/i;
// calm, dry voices first (macOS, Chrome's online voices, Windows, then anything English)
const PREFER = ['Daniel', 'Google UK English Male', 'Microsoft Ryan', 'Microsoft George', 'Arthur', 'Oliver', 'Jamie', 'Serena', 'Google UK English Female', 'Microsoft Sonia', 'Moira', 'Karen', 'Alex', 'Samantha', 'Google US English'];
let voices: SpeechSynthesisVoice[] = [];
let current: SpeechSynthesisUtterance | null = null;

function score(v: SpeechSynthesisVoice) {
  const i = PREFER.findIndex((p) => v.name.startsWith(p));
  let s = i >= 0 ? 100 - i * 4 : 0;
  if (/premium|enhanced|natural|neural/i.test(v.name)) s += 12;
  if (v.lang.startsWith('en-GB')) s += 6;
  if (v.localService) s += 2;   // no network round trip, no 15 s cutoff
  return s;
}
function load() {
  voices = (synth?.getVoices() ?? []).filter((v) => v.lang.toLowerCase().startsWith('en') && !NOVELTY.test(v.name))
    .sort((a, b) => score(b) - score(a));
  voice.onVoices();
}

export const voice = {
  available: !!synth,
  /** English voices worth offering, best first */
  get list() { return voices; },
  get chosen(): SpeechSynthesisVoice | null { return voices.find((v) => v.name === settings.voiceName) ?? voices[0] ?? null; },
  onVoices: () => {},
  onSpeaking: (_on: boolean) => {},
  get speaking() { return !!current; },
  /** speak a line (cancelling any line in progress); onEnd fires when it finishes. False if silent. */
  speak(text: string, onEnd?: () => void) {
    this.cancel();
    if (!synth || !settings.voice || settings.muted || settings.natureVol <= 0) return false;
    const u = new SpeechSynthesisUtterance(text), v = this.chosen;
    if (v) u.voice = v;
    u.lang = v?.lang ?? 'en-GB';
    u.rate = 0.94; u.pitch = 0.9;   // unhurried and a little low: the ship's AI, not an announcer
    u.volume = Math.min(1, settings.natureVol / 100 * 1.15);
    const done = () => { if (current !== u) return; current = null; this.onSpeaking(false); onEnd?.(); };
    u.onend = done; u.onerror = done;
    current = u;
    this.onSpeaking(true);
    synth.speak(u);
    return true;
  },
  cancel() {
    if (!synth) return;
    const was = current;
    current = null;
    if (was) { was.onend = was.onerror = null; this.onSpeaking(false); }
    synth.cancel();
  },
  /** rough length of a spoken line in ms (fallback when 'end' never comes) */
  estimate: (text: string) => 1500 + text.length * 75,
};
if (synth) { load(); synth.addEventListener?.('voiceschanged', load); }
document.addEventListener('visibilitychange', () => { if (document.hidden) voice.cancel(); });
