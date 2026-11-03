import { DAY_SECONDS, YEAR_DAYS } from '../config';
import { settings, saveSettings } from '../settings';

/* Game clock: Solenne turns once per 24 game hours and circles its sun in 32 days (four seasons of
   eight; day 1 is the spring equinox). Time scale is a setting; the date and time persist. */
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
const SEASON_DAYS = YEAR_DAYS / 4;
export const clock = {
  t: (settings.day - 1) * DAY_SECONDS + settings.tod * 3600,   // game seconds since day 1, 00:00
  get tod() { return ((this.t % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS / 3600; },
  get day() { return Math.floor(this.t / DAY_SECONDS) + 1; },
  get season() { return Math.floor((((this.day - 1) % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS / SEASON_DAYS); },
};
let saveT = 0;
function save() { settings.tod = clock.tod; settings.day = clock.day; saveSettings(); }
export function updateClock(dt: number) {
  clock.t += dt * settings.timeScale;
  if ((saveT -= dt) <= 0) { saveT = 5; save(); }
}
export function setTimeOfDay(h: number) {
  clock.t = (clock.day - 1) * DAY_SECONDS + h * 3600;
  save();
}
/** jump to the first day of a season (0 spring … 3 winter) in the current year, same time of day */
export function setSeason(i: number) {
  const year = Math.floor((clock.day - 1) / YEAR_DAYS);
  clock.t = (year * YEAR_DAYS + i * SEASON_DAYS) * DAY_SECONDS + clock.tod * 3600;
  save();
}
export function setDay(d: number) { clock.t = (Math.max(1, Math.floor(d)) - 1) * DAY_SECONDS + clock.tod * 3600; save(); }
export function formatDate() {
  const doy = (((clock.day - 1) % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
  return `${SEASONS[clock.season]}, day ${doy % SEASON_DAYS + 1}`;
}
export function formatTod(h: number) {
  const m = Math.floor(h * 60) % (24 * 60);
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}
