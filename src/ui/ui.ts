import { isTouch } from '../config';
import { settings, saveSettings, type WeatherMode } from '../settings';
import { keys, touchMove } from '../player/player';
import { formatTod, formatDate, clock } from '../time/clock';
import { voice } from '../story/voice';
import { say, SAMPLE } from '../story/halden';

/* DOM wiring for the intro card, settings panel, HUD, pointer lock and touch controls (prototype). */
export type UIDeps = {
  look: (dx: number, dy: number, s?: number) => void;
  toggleFly: () => boolean;
  setWeather: (m: WeatherMode) => void;
  weatherLabel: () => string;
  setTod: (h: number) => void;
  setSeason: (i: number) => void;
  applyGrass: () => number;
  applyQuality: () => void;
  onStart: () => void;
  onSound: () => void;
  onLevels: () => void;
  planetView: (on: boolean) => void;
  orbit: (dx: number, dy: number) => void;
  zoom: (k: number) => void;
  interact: () => void;
  /** keys that act at the Wren's helm or the telescope (toggles); true when one was used */
  actionKey: (code: string) => boolean;
  scopeZoom: (k: number) => boolean;   // true when the telescope took the scroll
  scopeGoto: (n: number) => boolean;   // number key n in the sky guide: true when the telescope took it
  onPause: () => void;
  /** the showcase film: start it (from the title card), or stop it early */
  showcase: (on: boolean) => void;
  exportFilm: () => void;
};
const $ = (id: string) => document.getElementById(id)!;
const inp = (id: string) => $(id) as HTMLInputElement;

export function initUI(d: UIDeps) {
  if (isTouch) document.documentElement.classList.add('is-touch');
  const canvas = $('gl') as HTMLCanvasElement, enterBtn = $('enter') as HTMLButtonElement;
  const intro = $('intro'), hint = $('hint'), panel = $('panel'), chip = $('chip'), dot = $('dot');
  let locked = false, dragLook = false, dragging = false, started = false, viewing = false, mapping = false, showing = false;

  function setPlaying(on: boolean) {
    intro.hidden = on; hint.hidden = !on; dot.hidden = !on || isTouch;
    if (on) { panel.hidden = true; chip.setAttribute('aria-expanded', 'false'); }
    if (isTouch) $('touchBtns').hidden = !on;
  }
  function requestLock() {
    setPlaying(true);
    if (isTouch || dragLook) { canvas.focus(); return; }
    try {
      const p = canvas.requestPointerLock && (canvas.requestPointerLock() as unknown as Promise<void> | undefined);
      if (p && typeof p.catch === 'function') p.catch(() => { dragLook = true; canvas.focus(); });
    } catch { dragLook = true; }
    canvas.focus();
  }
  const pause = () => { keys.clear(); d.onPause(); setPlaying(false); enterBtn.textContent = 'Continue walking'; };
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (!locked && started && !dragLook && !viewing && !mapping && !showing) pause();
  });
  // planet view: a free orbit camera around Solenne; the walker waits where you left it
  const viewbar = $('viewbar');
  function setView(on: boolean) {
    if (on === viewing) return;
    viewing = on;
    d.planetView(on);
    viewbar.hidden = !on;
    keys.clear();
    if (on) {
      intro.hidden = true; hint.hidden = true; dot.hidden = true; panel.hidden = true; chip.setAttribute('aria-expanded', 'false');
      if (isTouch) $('touchBtns').hidden = true;
      if (document.pointerLockElement) document.exitPointerLock();
    } else if (started) requestLock();
    else intro.hidden = false;
  }
  $('planetBtn').addEventListener('click', () => setView(true));
  $('backBtn').addEventListener('click', () => setView(false));
  document.addEventListener('pointerlockerror', () => { dragLook = true; });
  enterBtn.addEventListener('click', () => { started = true; d.onStart(); requestLock(); });
  $('showBtn').addEventListener('click', () => d.showcase(true));
  canvas.addEventListener('click', () => {
    if (showing) { d.showcase(false); return; }   // a click ends the showcase
    if (started && !locked && !dragLook && !isTouch && !viewing && !mapping) requestLock();
  });
  document.addEventListener('mousemove', (e) => {
    if (viewing) { if (dragging) d.orbit(e.movementX, e.movementY); }
    else if (locked) d.look(e.movementX, e.movementY);
    else if (dragLook && dragging) d.look(e.movementX, e.movementY, 0.004);
  });
  canvas.addEventListener('mousedown', () => { if (dragLook || viewing) dragging = true; });
  canvas.addEventListener('wheel', (e) => {
    if (viewing) { e.preventDefault(); d.zoom(Math.exp(e.deltaY * 0.0012)); }
    else if (started && d.scopeZoom(Math.exp(e.deltaY * 0.0015))) e.preventDefault();
  }, { passive: false });
  window.addEventListener('mouseup', () => { dragging = false; });

  const setFly = () => { const f = d.toggleFly(); $('modeLabel').textContent = f ? 'Flying' : 'Walking'; $('tFly').setAttribute('aria-pressed', String(f)); };
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (showing) { if (e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter') d.showcase(false); return; }
    if (e.code === 'KeyP' && !e.repeat && !(enterBtn as HTMLButtonElement).disabled) { setView(!viewing); return; }
    if (viewing) { if (e.code === 'Escape') setView(false); return; }
    if (!started) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (mapping && e.code === 'Escape') { d.actionKey('KeyM'); return; }   // Escape closes the map, not the game
    if (e.code === 'KeyE' && !e.repeat) { d.interact(); return; }
    if (!e.repeat && d.actionKey(e.code)) return;
    if (/^(Digit|Numpad)[1-9]$/.test(e.code) && !e.repeat && d.scopeGoto(+e.code.slice(-1))) return;
    if ((e.code === 'Equal' || e.code === 'NumpadAdd' || e.code === 'Minus' || e.code === 'NumpadSubtract') && d.scopeZoom(e.code.includes('Add') || e.code === 'Equal' ? 0.8 : 1.25)) return;
    if (e.code === 'KeyF' && !e.repeat) setFly();
    if (e.code === 'KeyM' && !e.repeat) toggleMute();
    if (e.code === 'Escape' && dragLook) pause();
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  // touch: left half = move stick, right half = look
  const joy = $('joy'), knob = $('joyKnob');
  const touches = new Map<number, { kind: string; x0: number; y0: number; x: number; y: number }>();
  let pinch = 0;
  canvas.addEventListener('touchstart', (e) => {
    if (viewing) {
      for (const t of Array.from(e.changedTouches)) touches.set(t.identifier, { kind: 'orbit', x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY });
      e.preventDefault(); return;
    }
    if (!started) return;
    for (const t of Array.from(e.changedTouches)) {
      const kind = t.clientX < window.innerWidth * 0.45 ? 'move' : 'look';
      touches.set(t.identifier, { kind, x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY });
      if (kind === 'move') { joy.hidden = false; joy.style.left = t.clientX + 'px'; joy.style.top = t.clientY + 'px'; knob.style.transform = ''; }
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    if (viewing) {
      const all = Array.from(e.touches);
      if (all.length >= 2) {
        const dd = Math.hypot(all[0].clientX - all[1].clientX, all[0].clientY - all[1].clientY);
        if (pinch > 0) d.zoom(pinch / dd);
        pinch = dd;
      } else {
        pinch = 0;
        for (const t of Array.from(e.changedTouches)) { const s = touches.get(t.identifier); if (s) { d.orbit(t.clientX - s.x, t.clientY - s.y); s.x = t.clientX; s.y = t.clientY; } }
      }
      e.preventDefault(); return;
    }
    for (const t of Array.from(e.changedTouches)) {
      const s = touches.get(t.identifier); if (!s) continue;
      if (s.kind === 'look') d.look(t.clientX - s.x, t.clientY - s.y, 0.005);
      else {
        let dx = t.clientX - s.x0, dy = t.clientY - s.y0; const l = Math.hypot(dx, dy), m = 46;
        if (l > m) { dx *= m / l; dy *= m / l; }
        touchMove.x = dx / m; touchMove.y = -dy / m;
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
      }
      s.x = t.clientX; s.y = t.clientY;
    }
    e.preventDefault();
  }, { passive: false });
  const endTouch = (e: TouchEvent) => {
    pinch = 0;
    for (const t of Array.from(e.changedTouches)) {
      const s = touches.get(t.identifier);
      if (s && s.kind === 'move') { touchMove.x = touchMove.y = 0; joy.hidden = true; }
      touches.delete(t.identifier);
    }
  };
  canvas.addEventListener('touchend', endTouch);
  canvas.addEventListener('touchcancel', endTouch);
  $('tJump').addEventListener('touchstart', (e) => { e.preventDefault(); keys.add('Space'); setTimeout(() => keys.delete('Space'), 160); }, { passive: false });
  $('tFly').addEventListener('click', setFly);

  // ---- settings panel ----
  chip.addEventListener('click', () => { const open = panel.hidden; panel.hidden = !open; chip.setAttribute('aria-expanded', String(open)); });
  const showWind = () => { const v = settings.wind; $('windVal').textContent = v < 8 ? 'Still' : v < 30 ? 'Light air' : v < 60 ? 'Breeze' : v < 85 ? 'Fresh' : 'Gale'; };
  const showGrass = () => {
    const blades = d.applyGrass();
    $('densityVal').textContent = blades >= 1e6 ? (blades / 1e6).toFixed(1) + 'M blades' : Math.round(blades / 1000) + 'k blades';
    $('heightVal').textContent = '≈ ' + Math.round(43 * settings.grassHeight / 100) + ' cm';
  };
  const showClouds = () => { const v = settings.clouds; $('cloudsVal').textContent = v < 8 ? 'Clear' : v < 35 ? 'Few' : v < 65 ? 'Scattered' : v < 90 ? 'Many' : 'Towering'; };
  for (const k of ['wind', 'clouds', 'grassDensity', 'grassHeight', 'natureVol'] as const) inp(k).value = String(settings[k]);
  inp('tod').value = String(settings.tod);
  showWind();
  showClouds();
  inp('clouds').addEventListener('input', (e) => { settings.clouds = +(e.target as HTMLInputElement).value; showClouds(); saveSettings(); });
  inp('wind').addEventListener('input', (e) => { settings.wind = +(e.target as HTMLInputElement).value; showWind(); saveSettings(); });
  inp('grassDensity').addEventListener('input', (e) => { settings.grassDensity = +(e.target as HTMLInputElement).value; showGrass(); saveSettings(); });
  inp('grassHeight').addEventListener('input', (e) => { settings.grassHeight = +(e.target as HTMLInputElement).value; showGrass(); saveSettings(); });
  inp('tod').addEventListener('input', (e) => { const h = +(e.target as HTMLInputElement).value; d.setTod(h); $('todVal').textContent = formatTod(h); });
  const segs = (id: string, attr: string, cur: () => string, pick: (v: string) => void) => {
    const sync = () => document.querySelectorAll(`#${id} button`).forEach((b) => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset[attr] === cur())));
    document.querySelectorAll(`#${id} button`).forEach((b) => b.addEventListener('click', () => { pick((b as HTMLElement).dataset[attr]!); sync(); }));
    sync();
    return sync;
  };
  const syncWx = segs('wxSeg', 'wx', () => settings.weather, (v) => d.setWeather(v as WeatherMode));
  segs('tsSeg', 'ts', () => String(settings.timeScale), (v) => { settings.timeScale = +v; saveSettings(); });
  const syncSeason = segs('seasonSeg', 'season', () => String(clock.season), (v) => { d.setSeason(+v); $('dayVal').textContent = formatDate(); });
  $('dayVal').textContent = formatDate();
  segs('qSeg', 'q', () => settings.quality, (v) => { settings.quality = v; saveSettings(); d.applyQuality(); });

  // ---- sound ----
  function updateSoundUI() {
    const off = settings.muted;
    $('icoOn').hidden = off; $('icoOff').hidden = !off;
    $('soundBtn').setAttribute('aria-label', off ? 'Turn sound on' : 'Mute sound');
    $('natureVal').textContent = settings.natureVol + '%';
  }
  function toggleMute() {
    settings.muted = !settings.muted;
    if (settings.muted) voice.cancel();
    if (!settings.muted && started) d.onSound();
    d.onLevels(); updateSoundUI(); saveSettings();
  }
  $('soundBtn').addEventListener('click', toggleMute);

  // ---- Halden's voice: on/off and which system voice (a sample line plays when you change it) ----
  const shortName = (n: string) => n.replace(/\s*\(.*\)\s*$/, '');
  const voiceSel = $('voiceSel') as HTMLSelectElement;
  function showVoice() {
    const v = voice.chosen;
    $('voiceVal').textContent = !settings.voice ? 'Off' : v ? shortName(v.name) : 'Browser default';
    voiceSel.disabled = !settings.voice;
  }
  function fillVoices() {
    voiceSel.replaceChildren(new Option(`Automatic${voice.list[0] ? ' (' + shortName(voice.list[0].name) + ')' : ''}`, ''),
      ...voice.list.map((v) => new Option(`${v.name} · ${v.lang}`, v.name)));
    voiceSel.value = voice.list.some((v) => v.name === settings.voiceName) ? settings.voiceName : '';
    showVoice();
  }
  $('voiceRow').hidden = !voice.available;
  voice.onVoices = fillVoices;
  fillVoices();
  const syncVoice = segs('voiceSeg', 'voice', () => settings.voice ? 'on' : 'off', (v) => {
    settings.voice = v === 'on'; saveSettings(); showVoice();
    if (settings.voice) say(SAMPLE); else voice.cancel();
  });
  voiceSel.addEventListener('change', () => { settings.voiceName = voiceSel.value; saveSettings(); showVoice(); say(SAMPLE); });
  syncVoice();
  // the showcase's pad: off when you lay your own music over a recording
  const syncMusic = segs('musicSeg', 'music', () => settings.music ? 'on' : 'off', (v) => {
    settings.music = v === 'on'; saveSettings(); $('musicVal').textContent = settings.music ? 'On' : 'Off';
  });
  syncMusic(); $('musicVal').textContent = settings.music ? 'On' : 'Off';
  segs('xdSeg', 'xd', () => settings.exportDetail, (v) => { settings.exportDetail = v; saveSettings(); });
  $('exportBtn').addEventListener('click', () => { panel.hidden = true; chip.setAttribute('aria-expanded', 'false'); d.exportFilm(); });
  inp('natureVol').addEventListener('input', (e) => { settings.natureVol = +(e.target as HTMLInputElement).value; updateSoundUI(); saveSettings(); d.onLevels(); });
  updateSoundUI();

  return {
    showGrass,
    weatherChanged() { syncWx(); $('wxNow').textContent = d.weatherLabel(); },
    ready() { enterBtn.disabled = false; enterBtn.textContent = isTouch ? 'Begin' : 'Click to begin'; ($('showBtn') as HTMLButtonElement).disabled = false; ($('exportBtn') as HTMLButtonElement).disabled = !('VideoEncoder' in window); },
    /** the showcase plays over everything (CSS hides all but the canvas); afterwards, back to the title card */
    showcase(on: boolean) {
      showing = on;
      document.body.classList.toggle('showcase', on);
      keys.clear();
      if (on) { if (document.pointerLockElement) document.exitPointerLock(); intro.hidden = true; }
      else { setPlaying(false); if (started) enterBtn.textContent = 'Continue walking'; }
    },
    get showing() { return showing; },
    /** a video export's progress (0 … 1), or null when it is over */
    exportProgress(f: number | null) {
      $('exportNote').hidden = f === null;
      if (f !== null) $('exportPct').textContent = Math.floor(f * 100) + '%';
    },
    status(s: string) { enterBtn.textContent = s; },
    fail(msg: string) {
      intro.hidden = true;
      const el = document.createElement('div'); el.className = 'fail'; el.textContent = msg; document.body.appendChild(el);
    },
    /** "E — look through the telescope" when you stand by it */
    prompt(show: boolean, what = 'Look through the telescope') {
      const p = $('prompt'), html = `<kbd>E</kbd> ${what}`;
      if (show && p.innerHTML !== html) p.innerHTML = html;
      if (p.hidden === show) p.hidden = !show;
    },
    /** at the Wren's helm: the readout and the keys instead of the walking hint */
    helm(on: boolean) { $('helm').hidden = !on; hint.hidden = on || !started; dot.hidden = on || !started || isTouch; },
    helmRead(html: string) { const r = $('helmRead'); if (r.innerHTML !== html) r.innerHTML = html; },
    /** the system map is open: the cursor is free (no pause), the walking hint and dot hide */
    mapMode(on: boolean) {
      if (on === mapping) return;
      mapping = on;
      dot.hidden = on || !started || isTouch;
      if (on) { if (document.pointerLockElement) document.exitPointerLock(); }
      else if (started) requestLock();
    },
    /** the target marker: on screen at (x, y), or pinned to the edge pointing toward it (angle in radians) */
    navMark(show: boolean, x = 0, y = 0, edge: number | null = null, html = '') {
      const m = $('navMark');
      if (m.hidden === show) m.hidden = !show;
      if (!show) return;
      m.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      m.classList.toggle('edge', edge !== null);
      ($('navArrow') as HTMLElement).style.transform = edge === null ? '' : `rotate(${edge.toFixed(3)}rad)`;
      const l = $('navLabel');
      if (l.innerHTML !== html) l.innerHTML = html;
    },
    /** the eyepiece view: its own status bar instead of the walking hint */
    scope(on: boolean) { $('scope').hidden = !on; hint.hidden = on || !started; dot.hidden = on || !started || isTouch; },
    /** setting circles and the sky guide (rows: key, name, alt/az text, centred) */
    scopeSky(circles: string, rows: [number, string, string, boolean][]) {
      $('scopeCircles').textContent = circles;
      const g = $('scopeGuide');
      const html = '<b>Sky guide</b>' + (rows.length ? rows.map(([k, n, p, on]) => `<div${on ? ' class="on"' : ''}><kbd>${k}</kbd><span>${n}</span><span>${p}</span></div>`).join('') : '<div><span></span><span>Nothing up just now</span></div>');
      if (g.innerHTML !== html) g.innerHTML = html;
    },
    scopeInfo(mag: number, name: string | null, about = '', meta = '') {
      $('scopeMag').textContent = '×' + Math.round(mag);
      const lab = $('scopeLabel');
      lab.hidden = !name;
      if (name && $('scopeName').textContent !== name) $('scopeName').textContent = name;
      if (name) { $('scopeAbout').textContent = about; $('scopeMeta').textContent = meta; }
    },
    /** pin the walker on the globe at screen (x, y), or hide it when it is round the far side */
    marker(x: number, y: number, show: boolean) {
      const m = $('youMark');
      m.hidden = !show;
      if (show) m.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    },
    hud(fps: number, alt: string, tod: number) {
      $('fps').textContent = Math.round(fps) + ' fps';
      $('alt').textContent = alt;
      const t = formatTod(tod);
      $('clock').textContent = t;
      if (document.activeElement !== $('tod')) { inp('tod').value = String(tod); $('todVal').textContent = t; }
      const date = formatDate();
      if ($('dayVal').textContent !== date) { $('dayVal').textContent = date; syncSeason(); }
    },
    get started() { return started; },
    get viewing() { return viewing; },
  };
}
