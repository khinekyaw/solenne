import * as THREE from 'three';
import './ui/style.css';
import { QUALITY, EYE, SEA_TOP, SEA_BASE, PLANET_R, WATER } from './config';
import { smoothstep, lerp, clamp } from './core/math';
import { N2a, N2b } from './core/noise';
import { settings } from './settings';
import { clock, updateClock, setTimeOfDay, setSeason, setDay } from './time/clock';
import { regionToPF, AXIS } from './planet/solenne';
import { Region, type RegionData } from './planet/region';
import { Quadtree } from './planet/quadtree';
import { Detail } from './planet/detail';
import { Ruins } from './ruins/ruins';
import { Waterfalls } from './nature/waterfalls';
import { makeTerrainMaterial } from './planet/terrainMaterial';
import { makeWaterMaterial } from './planet/waterMaterial';
import { islandSD, seaCover } from './planet/heights';
import { frame, shared, updateFrame, depthRange } from './render/frame';
import { Renderer } from './render/renderer';
import { palette, nightAmount } from './atmosphere/palette';
import { Sky } from './atmosphere/sky';
import { Nature } from './nature/nature';
import { Cottage } from './house/cottage';
import { Weather, wx } from './weather/weather';
import { Player, keys } from './player/player';
import { createSoundscape, type Soundscape } from './audio/soundscape';
import { initUI } from './ui/ui';
import { halden } from './story/halden';
import { voice } from './story/voice';
import { StarSystem, LULL, ORRIN, VERRAN, VAEL, CINDER, PIP, WICK, STAR, BODIES, bodyIndex } from './space/system';
import { Telescope } from './props/telescope';
import { Wren } from './ship/wren';
import { SUN_ANG } from './config';
import { bakeBodyMaps } from './space/maps';

/* =========================================================================
   Boot: workers build the region, terrain chunks and noise volumes while
   the main thread sets up the renderer; then the frame loop runs.
   ========================================================================= */
type Volumes = { shape: Uint8Array; detail: Uint8Array; weather2D: Uint8Array };
const tick = () => new Promise((r) => setTimeout(r, 16));
const terrainWorker = () => new Worker(new URL('./planet/terrain.worker.ts', import.meta.url), { type: 'module' });
const make3D = (data: Uint8Array, n: number) => {
  const t = new THREE.Data3DTexture(data, n, n, n);
  t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.unpackAlignment = 1; t.needsUpdate = true;
  return t;
};

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.08, 6000);
camera.rotation.order = 'YXZ';
const scene = new THREE.Scene();
let sound: Soundscape | null = null;
let player: Player, weather: Weather, nature: Nature;
const space = new StarSystem();
let telescope: Telescope | null = null;
let devFov = 62;   // field of view when not at the telescope (the fov() dev hook)
function enterScope() { if (!telescope || telescope.active) return; telescope.enter(); ui.scope(true); halden('scope'); }
function leaveScope() { if (!telescope?.active) return; telescope.leave(); ui.scope(false); ui.scopeInfo(1, null); }
// planet view: an orbit camera around Solenne while the walker waits where you left it
const view = { on: false, dir: new THREE.Vector3(0, 1, 0), dist: 260000 };

const ui = initUI({
  look: (dx, dy, s) => telescope?.active ? telescope.look(dx, dy, s) : player?.look(dx, dy, s),
  toggleFly: () => { player.toggleFly(); return player.fly; },
  setWeather: (m) => weather.setMode(m),
  weatherLabel: () => weather.label,
  setTod: (h) => { setTimeOfDay(h); },
  setSeason: (i) => { setSeason(i); },
  applyGrass: () => nature ? nature.applyGrass() : 0,
  applyQuality: () => { renderer.resetAdaptive(); renderer.requestApply(); },
  onStart: () => { startSound(); setTimeout(() => halden('arrival'), 2500); },
  onSound: () => startSound(),
  onLevels: () => sound?.setLevels(settings),
  planetView: (on) => { if (on) leaveScope(); view.on = on; if (on) { view.dir.copy(player.pos).normalize(); view.dist = 260000; } },
  orbit: (dx, dy) => {
    const k = 0.0035 * clamp((view.dist - PLANET_R) / (2 * PLANET_R), 0.12, 1);
    view.dir.addScaledVector(frame.east, -dx * k).addScaledVector(frame.north, -dy * k).normalize();
  },
  zoom: (k) => { view.dist = clamp(view.dist * k, PLANET_R + 12000, 6 * PLANET_R); },
  interact: () => { if (!telescope || view.on) return; if (telescope.active) leaveScope(); else if (scopeInReach) enterScope(); },
  scopeZoom: (k) => { if (!telescope?.active) return false; telescope.zoom(k); return true; },
  scopeGoto: (n) => {
    if (!telescope?.active) return false;
    const k = guideKeys[n - 1];
    if (k !== undefined) { const d = k === STAR ? space.uniforms.uSunL.value : space.dirL[k]; telescope.goto(new THREE.Vector3(d.x, d.y, d.z)); lockBody = k; }
    return true;
  },
  onPause: () => leaveScope(),
});
let scopeInReach = false;
let guideKeys: number[] = [];   // body index behind each number key in the telescope's sky guide
let lockBody = -1;              // the body the clock drive follows (-1: it holds the sky instead)

let renderer: Renderer;
try { renderer = new Renderer(document.getElementById('gl') as HTMLCanvasElement, scene, camera); }
catch (e) { ui.fail('This scene needs WebGL 2, which this browser or device does not provide. Try a recent desktop Chrome, Edge, Firefox or Safari.'); throw e; }

voice.onSpeaking = (on) => sound?.duck(on);   // the wind and grass dip under Halden's voice
function startSound() {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (sound || !AC) return;
  try { sound = createSoundscape(new AC({ latencyHint: 'playback' })); sound.setLevels(settings); }
  catch (e) { console.warn('Sound unavailable', e); sound = null; }
}
document.addEventListener('visibilitychange', () => {
  if (!sound) return;
  if (document.hidden) sound.ctx.suspend(); else if (!settings.muted) sound.ctx.resume();
});

async function boot() {
  ui.status('Waking Solenne…');
  const workers = [terrainWorker(), terrainWorker()];
  const regionP = new Promise<RegionData>((res) => workers[0].addEventListener('message', (e) => { if (e.data.type === 'region') res(e.data); }));
  for (const w of workers) w.postMessage({ type: 'init' });
  const volW = new Worker(new URL('./atmosphere/volumes.worker.ts', import.meta.url), { type: 'module' });
  const volP = new Promise<Volumes>((res) => { volW.onmessage = (e) => { res(e.data); volW.terminate(); }; });
  volW.postMessage('go');
  const mapsP = bakeBodyMaps();

  const rd = await regionP;
  ui.status('Brewing clouds…');
  const region = new Region(rd, workers[0]);
  const vol = await volP;
  const shapeTex = make3D(vol.shape, 64), detailTex = make3D(vol.detail, 32);
  const weatherTex = new THREE.DataTexture(vol.weather2D, 256, 256, THREE.RGBAFormat, THREE.UnsignedByteType);
  weatherTex.wrapS = weatherTex.wrapT = THREE.RepeatWrapping;
  weatherTex.magFilter = THREE.LinearFilter; weatherTex.minFilter = THREE.LinearMipmapLinearFilter;
  weatherTex.generateMipmaps = true; weatherTex.needsUpdate = true;
  shared.uWeather.value = weatherTex; shared.uLand.value = region.landTex; shared.uLandTop.value = region.topTex;

  ui.status('Lighting the planets…');
  const maps = await mapsP;
  ui.status('Growing grass…'); await tick();
  const sky = new Sky({ shape: shapeTex, detail: detailTex, terrain: region.terrainTex }, { ...maps, uniforms: space.uniforms });
  const terrainMat = makeTerrainMaterial(region.terrainTex);
  const waterMat = makeWaterMaterial();
  const planet = new Quadtree(terrainMat, waterMat, workers);
  const detail = new Detail(region, workers[1]);
  nature = new Nature(detail.uHeight, detail.uTerrain);
  const cottage = new Cottage(region.terrainTex);
  const wren = new Wren(cottage, region.terrainTex);
  weather = new Weather(detail.uHeight);
  const ruins = new Ruins();
  const falls = new Waterfalls();
  player = new Player(cottage);
  telescope = new Telescope(cottage, cottage.scopePivot);
  const scope = telescope;
  player.obstacles.push(ruins, wren);
  scene.add(sky.bg, planet.group, scope.mesh, ...nature.meshes, ...cottage.meshes, ...wren.meshes, ...ruins.meshes, ...falls.meshes, weather.rain, weather.bolt);
  weather.onLabel = () => ui.weatherChanged();
  weather.onThunder = (d) => sound?.thunder(d, cottage.inside(player.flat));
  ui.weatherChanged();

  const res = new THREE.Vector2(1, 1);
  renderer.onResize = (W, H) => {
    res.set(W, H);
    const q = QUALITY[settings.quality];
    sky.applyQuality(q, W, H);
    terrainMat.uniforms.uRes.value.set(W, H); terrainMat.uniforms.uNearR.value = q.near[0];
    waterMat.uniforms.uRes.value.set(W, H);
    nature.applyQuality(H, camera.fov);
    ui.showGrass();
  };
  renderer.applyQuality();
  player.spawn();

  /* ---- per-frame ---- */
  const eye = new THREE.Vector3(), prevEye = new THREE.Vector3(), camFwd = new THREE.Vector3(), move = new THREE.Vector3();
  let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsT = 0, expoT = 0, expoCache = 1, camCover = 1, fallsNear = 0, shore = 0;
  const probe = new THREE.Vector3(), youRel = new THREE.Vector3(), scopeFwd = new THREE.Vector3();
  const FAR_BODIES = BODIES.map((_, k) => k).filter((k) => BODIES[k].look);
  let centred = -1, eyeAdapt = 1;
  let skyHold: THREE.Vector3 | null = null;   // the clock drive's fixed point among the stars (inertial frame)
  const holdL = new THREE.Vector3();
  // setting circles: altitude above the horizon and azimuth from true north (the planet's axis), in degrees
  const altAzUp = new THREE.Vector3(), altAzN = new THREE.Vector3(), altAzE = new THREE.Vector3(), altAzF = new THREE.Vector3();
  const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  function altAz(dL: { x: number; y: number; z: number }) {
    altAzUp.copy(frame.camPF).normalize();
    altAzN.copy(AXIS).addScaledVector(altAzUp, -AXIS.dot(altAzUp)).normalize();
    altAzE.crossVectors(altAzN, altAzUp);
    altAzF.set(dL.x, dL.y, dL.z).applyMatrix3(frame.LtoPF);
    const alt = THREE.MathUtils.radToDeg(Math.asin(clamp(altAzF.dot(altAzUp), -1, 1)));
    const az = (THREE.MathUtils.radToDeg(Math.atan2(altAzF.dot(altAzE), altAzF.dot(altAzN))) + 360) % 360;
    return { alt, az, dir: COMPASS[Math.round(az / 45) % 8] };
  }
  const GUIDE = [LULL, ORRIN, VERRAN, VAEL, CINDER, PIP, WICK, STAR];
  let guideT = 0;
  const fmtDist = (m: number) => m < 2e7 ? Math.round(m / 1000).toLocaleString('en') + ' km' : (m / 1e9).toFixed(m < 1e10 ? 1 : 0) + ' million km';
  function step(dt: number) {
    shared.uTime.value += dt;
    updateClock(dt);
    space.update(clock.t);   // Solenne's orbit and spin give the sun; the planets and moons move on their rails
    frame.sunPF.copy(space.sunPF);
    if (view.on) eye.copy(view.dir).multiplyScalar(view.dist);
    else if (scope.active) { eye.copy(scope.pivotPF); frame.east.copy(player.east); }   // at the eyepiece; the walker stands still
    else { player.update(dt); player.eye(eye); frame.east.copy(player.east); }
    move.copy(eye).sub(prevEye).applyMatrix3(frame.PFtoL); prevEye.copy(eye);
    if (move.lengthSq() < 400) shared.uCamBox.value.add(move);
    updateFrame(eye);
    space.view(frame.camPF, frame.PFtoL, frame.alt);
    // the telescope: what sits in the middle of the eyepiece gets a label; the clock drive holds either a
    // locked body (GoTo, or one you centre closely) or, failing that, the patch of sky you left it on
    centred = -1;
    if (scope.active) {
      if (scope.handsOn) { lockBody = -1; skyHold = null; }   // touching the controls lets go
      const cp = Math.cos(scope.pitch), fovR = THREE.MathUtils.degToRad(scope.fov);
      scopeFwd.set(-Math.sin(scope.yaw) * cp, Math.sin(scope.pitch), -Math.cos(scope.yaw) * cp);
      let best = Infinity, lockNew = -1, lockBest = Infinity;
      for (const k of [STAR, ...FAR_BODIES]) {
        const d = k === STAR ? space.uniforms.uSunL.value as unknown as THREE.Vector3 : space.dirL[k];
        const a = Math.acos(clamp(scopeFwd.x * d.x + scopeFwd.y * d.y + scopeFwd.z * d.z, -1, 1)), r = k === STAR ? SUN_ANG : space.angL[k];
        if (d.y < -0.03) continue;
        if (a < Math.max(0.25 * fovR, r * 1.3) && a - r < best) { best = a - r; centred = k; }
        // a held lock survives over half the field; a new one needs the body centred closely
        if (a < (k === lockBody ? 0.5 * fovR : Math.max(0.06 * fovR, 0.5 * r)) && a < lockBest) { lockBest = a; lockNew = k; }
      }
      lockBody = scope.slewing ? lockBody : lockNew;
      // slow-motion knobs: arrow keys (or WASD), Shift for faster
      const kx = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
      const ky = (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0) - (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0);
      scope.nudge(kx, ky, dt, keys.has('ShiftLeft') || keys.has('ShiftRight'));
      let t: THREE.Vector3 | null = null;
      if (lockBody >= 0) { const d = lockBody === STAR ? space.uniforms.uSunL.value : space.dirL[lockBody]; t = holdL.set(d.x, d.y, d.z); skyHold = null; }
      else if (!scope.handsOn && !scope.slewing) {
        if (!skyHold) skyHold = scopeFwd.clone().applyMatrix3(frame.LtoPF).applyMatrix3(space.PFtoI);
        t = holdL.copy(skyHold).applyMatrix3(space.ItoPF).applyMatrix3(frame.PFtoL);
      }
      scope.update(dt, t);
    }
    detail.update(frame.camPF, frame.sunPF);

    const inRegion = player.inRegion && !view.on;
    const rainNow = weather.update(dt, { inRegion: detail.covers, groundRel: -player.agl, houseTop: cottage.roofTop });
    const e = frame.sunPF.dot(frame.up);
    shared.uMoonlit.value = space.moonlit;
    palette(e, { cover: shared.uCover.value, dark: shared.uDark.value, fog: shared.uFog.value, moon: space.moonlit }, shared.uSunColor.value, shared.uZenith.value, shared.uHorizon.value);
    const night = nightAmount(e);
    shared.uNight.value = night;
    // an eclipse: Lull's shadow dims the sun and the sky around you (not the distant land, outside the umbra);
    // the sky only really darkens close to totality
    const ecl = lerp(space.eclipse, 1, smoothstep(3000, 9000, frame.alt)), eclSky = Math.sqrt(ecl);
    if (ecl < 1) { shared.uSunColor.value.multiplyScalar(ecl); shared.uZenith.value.multiplyScalar(lerp(0.03, 1, eclSky)); shared.uHorizon.value.multiplyScalar(lerp(0.12, 1, eclSky)); }
    region.updateSun(frame.sunPF);
    cottage.updateShadow(renderer.gl, frame.sunPF);
    wren.updateShadow(renderer.gl, frame.sunPF);

    camera.position.set(0, 0, 0);
    if (view.on) camera.rotation.set(-Math.PI / 2 + 1e-4, 0, 0);
    else if (scope.active) camera.rotation.set(scope.pitch, scope.yaw, 0);
    else camera.rotation.set(player.pitch, player.yaw, 0);
    const fov = scope.active ? scope.fov : devFov;
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    const dr = depthRange(view.on ? frame.alt : player.agl, frame.alt);
    if (Math.abs(dr.near - camera.near) > camera.near * 0.05 || Math.abs(dr.far - camera.far) > camera.far * 0.05) { camera.near = dr.near; camera.far = dr.far; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    camera.getWorldDirection(camFwd);
    // the walker's pin on the globe: shown only on the hemisphere that faces the camera
    if (view.on) {
      youRel.copy(player.pos).sub(eye);
      const facing = player.pos.dot(youRel) < 0;
      youRel.applyMatrix3(frame.PFtoL).project(camera);
      ui.marker((youRel.x * 0.5 + 0.5) * window.innerWidth, (0.5 - youRel.y * 0.5) * window.innerHeight, facing && youRel.z < 1);
    } else ui.marker(0, 0, false);

    planet.update(frame.camPF);
    cottage.update();
    wren.update(shared.uTime.value);
    scope.place();
    scope.mesh.visible = !scope.active && frame.camPF.distanceTo(scope.pivotPF) < 12000;
    // the eyepiece: field stop fading in, the label, and a solar filter that drops in front of the sun
    const g = renderer.grade.uniforms;
    g.uScope.value += ((scope.active ? 1 : 0) - g.uScope.value) * (1 - Math.exp(-dt * 10));
    let solar = 0, adapt = 1;
    if (scope.active) {
      const sd = space.uniforms.uSunL.value, sunA = Math.acos(clamp(camFwd.x * sd.x + camFwd.y * sd.y + camFwd.z * sd.z, -1, 1));
      const fovR = THREE.MathUtils.degToRad(scope.fov) * camera.aspect;
      solar = smoothstep(fovR * 0.75 + SUN_ANG, fovR * 0.3, sunA) * (sd.y > -0.02 ? 1 : 0);
      if (solar > 0.5) halden('sun');
      // the eye adapts to a bright disc filling the eyepiece (night exposure would bleach it)
      if (centred > 0) { const fill = Math.min(1, (space.angL[centred] / (THREE.MathUtils.degToRad(scope.fov) / 2)) ** 2); adapt = 1 / (1 + 2.6 * fill * night); }
      if ((guideT -= dt) <= 0) {
        guideT = 0.25;
        const here = altAz(camFwd);
        const rows: [number, string, string, boolean][] = [];
        guideKeys = [];
        for (const k of GUIDE) {
          const d = k === STAR ? space.uniforms.uSunL.value : space.dirL[k], p = altAz(d);
          if (p.alt < 1 || (k === STAR && night > 0.5)) continue;
          guideKeys.push(k);
          rows.push([guideKeys.length, BODIES[k].name, `${Math.round(p.alt)}° ${p.dir}`, k === centred]);
        }
        ui.scopeSky(`Alt ${here.alt.toFixed(1)}°  ·  Az ${here.az.toFixed(1)}° ${here.dir}`, rows);
      }
      if (centred >= 0) {
        const inf = space.info(centred), pct = Math.round(inf.lit * 100) + ' % lit';
        const meta = centred === STAR ? 'Our sun · solar filter on' : centred === LULL ? `${inf.phase} · ${pct} · ${fmtDist(inf.dist)}` : `${fmtDist(inf.dist)} away · ${pct}`;
        ui.scopeInfo(scope.magnification, inf.name, inf.about, meta);
      } else ui.scopeInfo(scope.magnification, null);
    }
    eyeAdapt += (adapt - eyeAdapt) * (1 - Math.exp(-dt * 3));
    g.uFilter.value = eyeAdapt;
    g.uSolar.value = solar;
    scopeInReach = !view.on && !scope.active && !player.fly && player.inRegion && scope.near(player.flat, camFwd.x, camFwd.z);
    ui.prompt(ui.started && scopeInReach);
    nature.update(detail.camFlat, camFwd, !view.on && detail.covers && player.agl < 400);
    terrainMat.uniforms.uBg.value = waterMat.uniforms.uBg.value = sky.render(renderer.gl, camera, dt, space.PFtoI);
    ruins.update(dt, terrainMat.uniforms.uBg.value, res.x, res.y);
    falls.update(terrainMat.uniforms.uBg.value, res.x, res.y);

    // exposure: indoors, weather and night adaptation
    const aboard = inRegion && wren.inside(player.pos);
    const inside = inRegion && (cottage.inside(player.flat) || aboard);
    // an overcast day opens the eye; at night it is already wide open, so storms stay dark
    const wxBoost = 1 + (0.3 * shared.uCover.value + 0.05 * shared.uDark.value + 0.1 * shared.uFog.value) * (1 - 0.5 * night);
    camCover = seaCover(frame.up.x, frame.up.y, frame.up.z);
    const underDeck = smoothstep(SEA_BASE + 60, SEA_BASE - 40, frame.alt) * camCover;   // eyes adjust to the grey light below a cloud bank
    const dark = Math.max(night, 0.8 * (1 - eclSky));   // the eye opens up a little in an eclipse too
    const target = (inside ? 1.75 * lerp(1, 1.3, dark) : 0.84 * lerp(1, 4.2, dark) * lerp(1, 2.1, underDeck)) * wxBoost;
    const ex = renderer.exposure;
    ex.value += (target - ex.value) * (1 - Math.exp(-dt * (inside ? 1.6 : 2.4)));
    const tt = shared.uTime.value;
    cottage.mat.uniforms.uFireI.value = 1.25 * (1 + 0.16 * N2a(tt * 3.1, 1.7) + 0.08 * N2b(tt * 9.0, 4.2));
    // ambient remarks wait until Halden has finished whatever he is saying
    if (night > 0.7 && ui.started) halden('night', true, true);
    if (frame.alt > 20000 && !view.on) halden('orbit', true, true);
    if (underDeck > 0.9) halden('under', true, true);
    if (ui.started && !view.on && underDeck < 0.5) {
      // Halden remarks on Lull and Orrin the first time you look straight at them
      const lull = space.dirL[LULL], orrin = space.dirL[ORRIN];
      if (lull.y > 0.03 && camFwd.dot(lull) > Math.cos(0.09) && shared.uCover.value < 0.5) halden('moon', true, true);
      if (orrin.y > 0.05 && night > 0.6 && camFwd.dot(orrin) > Math.cos(0.04) && shared.uCover.value < 0.5) halden('orrin', true, true);
      if (ecl < 0.6) halden('eclipse');
      // the Wren: a word when you first see her up close, and when you step aboard
      const toShip = probe.copy(wren.anchor).sub(player.pos), dShip = toShip.length();
      if (dShip < 70 && !aboard && camFwd.dot(toShip.applyMatrix3(frame.PFtoL).divideScalar(dShip)) > 0.85) halden('wren', true, true);
      if (aboard) halden('aboard', true, true);
    }

    if (sound && !view.on) {
      const above = player.agl - EYE, high = smoothstep(4, 70, above);
      if ((expoT -= dt) <= 0) {
        expoT = 0.15; expoCache = inRegion ? smoothstep(-70, 5, islandSD(player.flat.x, player.flat.z)) : 1;
        fallsNear = falls.proximity(eye);
        // open water close by: probe the ground around the walker
        let wet = 0;
        for (const [ox, oz] of [[0, 0], [30, 0], [-30, 0], [0, 30], [0, -30]]) { probe.copy(player.pos).addScaledVector(player.east, ox).addScaledVector(player.north, oz); if (player.groundAt(probe, false) < WATER) wet++; }
        shore = (wet / 5) * (1 - smoothstep(2, 45, frame.alt - WATER));
      }
      const hs = Math.hypot(player.vel.x, player.vel.z), wd = shared.uWindDir.value;
      const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
      sound.update(dt, {
        windStr: shared.uWindStr.value * (1 - smoothstep(3000, 15000, frame.alt)), gust: gustAtCPU(weatherTex, player.flat.x, player.flat.z), exposure: Math.max(high, expoCache), high,
        nearGround: 1 - smoothstep(1.5, 14, above), grassH: settings.grassHeight / 100,
        moving: !player.fly && player.onGround ? clamp(hs / 9.5, 0, 1) : 0,
        speed: hs, onGround: player.onGround, fly: player.fly, bob: player.bob,
        windPan: -(rx * wd.x + rz * wd.y), indoor: inside ? 1 : 0,
        wood: inRegion && above > 0.05 && (cottage.floorAt(player.flat.x, player.flat.z) > -1e8 || wren.onBoard(player.pos)),
        fireDist: inRegion ? player.flat.distanceTo(cottage.firePos) : 99, rain: rainNow, falls: fallsNear, shore,
      });
    }
  }
  function frameLoop(now: number) {
    requestAnimationFrame(frameLoop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    renderer.beginFrame();   // a pending resolution change lands before drawing, never between drawing and display
    step(dt);
    renderer.render(dt);
    renderer.adapt(now, dt);
    fpsAcc += dt; fpsN++;
    if (now - fpsT > 500) {
      const above = frame.alt - SEA_TOP;
      const alt = frame.alt > 3000 ? (frame.alt / 1000).toFixed(1) + ' km up'
        : frame.alt < SEA_BASE ? (camCover > 0.5 ? Math.round(SEA_BASE - frame.alt) + ' m below the clouds' : 'Lowlands, open sky')
        : above < 0 ? 'in the clouds' : Math.round(above) + ' m above the clouds';
      ui.hud(fpsN / fpsAcc, alt, clock.tod);
      fpsAcc = 0; fpsN = 0; fpsT = now;
    }
  }
  prevEye.copy(player.eye(eye));
  step(0);
  // let the first rings of terrain stream in before the walk begins
  for (let i = 0; i < 400 && planet.pending > 0; i++) { ui.status('Shaping the plateau…'); step(0); await tick(); }
  region.updateSun(frame.sunPF, true);
  cottage.updateShadow(renderer.gl, frame.sunPF, true);
  wren.updateShadow(renderer.gl, frame.sunPF, true);
  requestAnimationFrame(frameLoop);
  ui.ready();

  // dev hooks for testing from the console
  Object.assign(window, {
    solenne: {
      teleport(x: number, z: number, yawDeg = 0, pitchDeg = 0, h?: number) {
        regionToPF(x, h ?? 0, z, player.pos); player.east.set(1, 0, 0);
        if (h === undefined) player.pos.setLength(PLANET_R + player.groundAt(player.pos) + EYE); else player.fly = true;
        player.yaw = THREE.MathUtils.degToRad(yawDeg); player.pitch = THREE.MathUtils.degToRad(pitchDeg); sky.historyValid = false;
      },
      altitude(h: number) { player.fly = true; player.pos.setLength(PLANET_R + h); sky.historyValid = false; },
      /** advance the simulation without rendering (tests run even while the page is hidden) */
      simulate(seconds: number, dt = 1 / 60) { for (let t = 0; t < seconds; t += dt) step(dt); },
      render() { renderer.beginFrame(); step(1 / 60); renderer.render(1 / 60); },
      setTod: setTimeOfDay, setDay, setSeason, player, planet, wx, sky, shared, frame, detail, ruins, view, seaCover, falls, space, camera, renderer,
      /** turn the walker's view toward a body by name ('Lull', 'Orrin', …) */
      look(name: string) {
        const d = space.dirL[bodyIndex(name)];
        if (!d) return 'unknown body';
        player.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)); player.yaw = Math.atan2(-d.x, -d.z); sky.historyValid = false;
        return { elevationDeg: +(player.pitch * 180 / Math.PI).toFixed(1) };
      },
      /** narrow the field of view (degrees) to inspect a body; 62 is normal */
      fov(deg = 62) { devFov = deg; sky.historyValid = false; },
      /** stand at the telescope and look through it, optionally at a body ('Orrin', 'Lull', …) */
      scope(name?: string, fovDeg?: number) {
        const [x, z] = cottage.toWorld(scope.pivotLocal.x, scope.pivotLocal.z + 1.2);
        regionToPF(x, 0, z, player.pos); player.pos.setLength(PLANET_R + player.groundAt(player.pos) + EYE); player.fly = false;
        step(0); enterScope();
        if (fovDeg) scope.fov = fovDeg;
        if (name) { const d = space.dirL[bodyIndex(name)]; if (d) scope.point(d); }
        return { magnification: Math.round(scope.magnification) };
      },
      leaveScope, telescope: scope, wren,
      /** stand at the foot of the Wren's ramp, facing up it; or view her from the concept's three-quarter angle */
      board() { const l = new THREE.Vector3(8.6, 0, 0.8), [x, z] = wren.toWorld(l.x, l.z); regionToPF(x, 0, z, player.pos); player.pos.setLength(PLANET_R + player.groundAt(player.pos) + EYE); player.fly = false;
        step(0); const d = probe.copy(wren.anchor).sub(player.pos).applyMatrix3(frame.PFtoL); player.yaw = Math.atan2(-d.x, -d.z); player.pitch = -0.05; },
      wrenView(dist = 34, side = 1) { const [x, z] = wren.toWorld(side * dist * 0.62, dist * 0.78); regionToPF(x, 0, z, player.pos); player.pos.setLength(PLANET_R + player.groundAt(player.pos) + EYE); player.fly = false;
        step(0); const d = probe.copy(wren.anchor).sub(player.pos).applyMatrix3(frame.PFtoL); d.y += 5; player.yaw = Math.atan2(-d.x, -d.z); player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); },
      /** jump to the next eclipse seen from where you stand (sun up) that covers at least `min` of the sun */
      nextEclipse(min = 0.5, days = 96) {
        const at = player.eye(new THREE.Vector3()), up = at.clone().normalize();
        let best = 0, bt = -1;
        for (let t = clock.t + 1800; t < clock.t + days * 86400; t += 300) {
          const c = space.update(t).sunPF.dot(up) > 0.08 ? space.eclipseAt(at) : 0;
          if (c > best && c >= min) { best = c; bt = t; } else if (bt > 0 && c < best * 0.5) break;
        }
        if (bt < 0) { space.update(clock.t); return 'none found'; }
        for (let t = bt - 600; t < bt + 600; t += 10) { const c = space.update(t).eclipseAt(at); if (c > best) { best = c; bt = t; } }
        clock.t = bt; space.update(bt); sky.historyValid = false;
        return { day: clock.day, tod: +clock.tod.toFixed(2), covered: +best.toFixed(3) };
      },
    },
  });
}

/* CPU copy of the GPU gust field, so the wind you hear matches the waves you see */
function gustAtCPU(tex: THREE.DataTexture, x: number, z: number) {
  const d = tex.image.data as unknown as Uint8Array, N = 256;
  const sample = (u: number, v: number, c: number) => {
    const xx = u * N - 0.5, yy = v * N - 0.5, x0 = Math.floor(xx), y0 = Math.floor(yy), tx = xx - x0, ty = yy - y0;
    const at = (a: number, b: number) => d[((((b % N) + N) % N) * N + (((a % N) + N) % N)) * 4 + c];
    return lerp(lerp(at(x0, y0), at(x0 + 1, y0), tx), lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), tx), ty) / 255;
  };
  const wd = shared.uWindDir.value, ph = shared.uWindPhase.value;
  const along = x * wd.x + z * wd.y, across = -x * wd.y + z * wd.x;
  const a = sample((along - ph) / 230, across / 820, 0);
  const b = sample((along - ph * 1.35) / 95, across / 280 + 0.37, 1);
  return smoothstep(0.36, 0.84, a * 0.65 + b * 0.35);
}

boot().catch((e) => { console.error(e); ui.fail('Solenne could not start on this device. ' + (e && e.message ? e.message : '')); });
