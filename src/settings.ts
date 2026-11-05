import { QUALITY, isTouch } from './config';

export type WeatherMode = 'dynamic' | 'sunny' | 'cloudy' | 'rain' | 'storm' | 'fog';
export const settings = {
  v: 3,
  wind: 55, grassDensity: 20, grassHeight: 40, natureVol: 70, muted: false,
  weather: 'dynamic' as WeatherMode,
  clouds: 40,         // cloud amount: 0 clear, 50 the old default sky, 100 the prototype's towering cumulus
  quality: isTouch ? 'low' : 'medium',
  voice: true,        // Halden speaks his lines (browser speech synthesis)
  music: true,        // the showcase's quiet pad (off when you lay your own music over a recording)
  exportDetail: 'cinema',   // the showcase's video export: 'cinema' (supersampled, more detail, slower) or 'standard'
  voiceName: '',      // a chosen system voice, '' = pick the best available
  tod: 13.9,          // hours; written back periodically so a reload resumes the day
  day: 1,             // day of the game calendar (day 1 = spring equinox); persisted with the time
  timeScale: 10,
};
const STORE_KEY = 'solenne-settings-v1';
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  if (saved && typeof saved === 'object') {
    // v3 lowered the grass defaults to the sliders' minimum and the clouds to 40: older saves keep everything else
    if (saved.v !== 3) { delete saved.grassDensity; delete saved.grassHeight; delete saved.clouds; saved.v = 3; }
    const s = settings as Record<string, unknown>;
    for (const k of Object.keys(settings)) if (k in saved && typeof saved[k] === typeof s[k]) s[k] = saved[k];
  }
  if (!QUALITY[settings.quality] || settings.quality === 'cinema') settings.quality = settings.quality === 'cinema' ? 'high' : 'medium';   // (cinema is the export's own)
} catch { /* storage unavailable */ }

export function saveSettings() { try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch { /* ignore */ } }
