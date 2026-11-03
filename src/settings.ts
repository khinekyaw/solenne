import { QUALITY, isTouch } from './config';

export type WeatherMode = 'dynamic' | 'sunny' | 'cloudy' | 'rain' | 'storm' | 'fog';
export const settings = {
  v: 2,
  wind: 55, grassDensity: 70, grassHeight: 80, natureVol: 70, muted: false,
  weather: 'dynamic' as WeatherMode,
  quality: isTouch ? 'low' : 'medium',
  voice: true,        // Halden speaks his lines (browser speech synthesis)
  voiceName: '',      // a chosen system voice, '' = pick the best available
  tod: 13.9,          // hours; written back periodically so a reload resumes the day
  day: 1,             // day of the game calendar (day 1 = spring equinox); persisted with the time
  timeScale: 10,
};
const STORE_KEY = 'solenne-settings-v1';
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  if (saved && typeof saved === 'object') {
    // v2 lowered the grass defaults: older saves keep everything else
    if (saved.v !== 2) { delete saved.grassDensity; delete saved.grassHeight; saved.v = 2; }
    const s = settings as Record<string, unknown>;
    for (const k of Object.keys(settings)) if (k in saved && typeof saved[k] === typeof s[k]) s[k] = saved[k];
  }
  if (!QUALITY[settings.quality]) settings.quality = 'medium';
} catch { /* storage unavailable */ }

export function saveSettings() { try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch { /* ignore */ } }
