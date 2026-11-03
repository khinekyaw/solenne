import * as THREE from 'three';
import { clamp } from '../core/math';
import { EYE } from '../config';
import { groundH } from '../planet/heights';
import { regionToPF, pfToRegion } from '../planet/solenne';
import { shared, frame, pfMatrix } from '../render/frame';
import type { Cottage } from '../house/cottage';
import { buildWren, type Box } from './wrenGeometry';
import { SHIP_VS, SHIP_FS, SHIP_GLASS_FS, GLOW_VS, GLOW_FS, SHIP_DEPTH_FS } from './wrenShaders';
import { HULL, halfWidthAt, bellyAt, DECK, LOWER_Z, UPPER_Z, STAIRS, HOLE, LADDER, DOME, DOOR, RAMP, floorHalf } from './wrenShape';

/* =========================================================================
   The Wren, parked on the meadow west of the cottage (M4). Drawn like the
   cottage: geometry in ship-local metres, lit in the spawn region's flat
   space (uFlatM), placed camera-relative on the sphere every frame. Walking
   aboard runs in ship-local coordinates (floors, stairs, ladder, ramp,
   collision boxes), so it can ride along when the ship flies (M5).
   ========================================================================= */
export const WREN_SITE = { x: 36.9, z: -397.6, rot: 17 * Math.PI / 180 };

export class Wren {
  meshes: THREE.Object3D[];
  mat: THREE.ShaderMaterial;
  L2W = new THREE.Matrix4();
  readonly groundY: number;
  private W2L = new THREE.Matrix4();
  private anchorPF = new THREE.Vector3();
  get anchor() { return this.anchorPF; }
  private basis = new THREE.Matrix4();
  private boxes: Box[];
  private rampY: (x: number) => number;
  private rampRun: number;
  private cs = Math.cos(WREN_SITE.rot); private sn = Math.sin(WREN_SITE.rot);
  private shadowRT: THREE.WebGLRenderTarget;
  private shadowScene = new THREE.Scene();
  private shadowCam = new THREE.OrthographicCamera(-22, 22, 22, -22, 1, 140);
  private center = new THREE.Vector3();
  private lastSun = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private loc = new THREE.Vector3();
  private flat = { x: 0, h: 0, z: 0 };

  constructor(cottage: Cottage, terrainTex: THREE.Texture) {
    const S = WREN_SITE;
    this.groundY = groundH(S.x, S.z);
    const gLocal = (lx: number, lz: number) => { const [x, z] = this.toWorld(lx, lz); return groundH(x, z) - this.groundY; };
    const b = buildWren(gLocal);
    this.boxes = b.boxes; this.rampY = b.rampY; this.rampRun = b.rampRun;
    this.L2W.compose(new THREE.Vector3(S.x, this.groundY, S.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, S.rot, 0)), new THREE.Vector3(1, 1, 1));
    this.W2L.copy(this.L2W).invert();

    // lamps in flat space (+ one spilling out of the door onto the ramp, last)
    const lampP = Array.from({ length: 10 }, () => new THREE.Vector4(0, -1e4, 0, 0)), lampC = Array.from({ length: 10 }, () => new THREE.Color(0, 0, 0));
    b.lamps.slice(0, 9).forEach((l, i) => { const p = new THREE.Vector3(...l.p).applyMatrix4(this.L2W); lampP[i].set(p.x, p.y, p.z, l.i); lampC[i].copy(l.c); });
    { const p = new THREE.Vector3(HULL.W + 0.4, DECK.lower + 1.7, (DOOR.z0 + DOOR.z1) / 2).applyMatrix4(this.L2W); lampP[9].set(p.x, p.y, p.z, 0.45); lampC[9].set(1.0, 0.72, 0.42); }

    const uFlatM = { value: this.L2W };
    const common = { ...cottage.mat.uniforms, uFlatM, uTerrain: { value: terrainTex } };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SHIP_VS, fragmentShader: SHIP_FS, side: THREE.DoubleSide,
      uniforms: { ...common, uName: { value: nameTexture() }, uLampP: { value: lampP }, uLampC: { value: lampC }, uEye: { value: 1 }, uCore: { value: 1 } },
    });
    const mesh = new THREE.Mesh(b.geo, this.mat);
    const glass = new THREE.Mesh(b.glass, new THREE.ShaderMaterial({
      vertexShader: SHIP_VS, fragmentShader: SHIP_GLASS_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: common,
    }));
    glass.renderOrder = 2;
    // soft glows: hover pads on the grass, engine halos
    const gpos: number[] = [], guv: number[] = [], gcol: number[] = [], gidx: number[] = [];
    for (const g of b.glows) {
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), g.n), base = gpos.length / 3;
      for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const p = new THREE.Vector3((u - 0.5) * 2 * g.r, (v - 0.5) * 2 * g.r, 0).applyQuaternion(q).add(g.c);
        gpos.push(p.x, p.y, p.z); guv.push(u, v); gcol.push(g.col.r, g.col.g, g.col.b);
      }
      gidx.push(base, base + 1, base + 3, base, base + 3, base + 2);
    }
    const ggeo = new THREE.BufferGeometry();
    ggeo.setAttribute('position', new THREE.Float32BufferAttribute(gpos, 3)); ggeo.setAttribute('uv', new THREE.Float32BufferAttribute(guv, 2));
    ggeo.setAttribute('aColor', new THREE.Float32BufferAttribute(gcol, 3)); ggeo.setIndex(gidx);
    const glow = new THREE.Mesh(ggeo, new THREE.ShaderMaterial({
      vertexShader: GLOW_VS, fragmentShader: GLOW_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: shared.uTime, uNight: shared.uNight },
    }));
    glow.renderOrder = 3;
    this.meshes = [mesh, glass, glow];
    for (const m of this.meshes) { m.matrixAutoUpdate = false; m.frustumCulled = false; }

    // placement on the sphere: origin at the ground point under the ship, upright, turned by the site heading
    regionToPF(S.x, this.groundY, S.z, this.anchorPF);
    const up = this.anchorPF.clone().normalize();
    const east = new THREE.Vector3(1, 0, 0).addScaledVector(up, -up.x).normalize();
    const north = new THREE.Vector3().crossVectors(east, up);
    this.basis.makeBasis(east, up, north).multiply(new THREE.Matrix4().makeRotationY(S.rot));

    // the ship's own shadow map (flat space), sampled with the cottage's by every region shader
    this.shadowRT = new THREE.WebGLRenderTarget(2048, 2048);
    this.shadowRT.depthTexture = new THREE.DepthTexture(2048, 2048, THREE.UnsignedIntType);
    const sm = new THREE.Mesh(b.geo, new THREE.ShaderMaterial({ vertexShader: SHIP_VS, fragmentShader: SHIP_DEPTH_FS, side: THREE.DoubleSide, uniforms: { uFlatM } }));
    sm.matrixAutoUpdate = false; sm.matrix.copy(this.L2W);
    this.shadowScene.add(sm);
    this.center.set(0, 5.5, -0.5).applyMatrix4(this.L2W);
    shared.uSShadow.value = this.shadowRT.depthTexture;
    shared.uShipXf.value.set(S.x, S.z, this.cs, this.sn);
    shared.uShipY.value = this.groundY;
  }
  toWorld(lx: number, lz: number): [number, number] { return [WREN_SITE.x + lx * this.cs + lz * this.sn, WREN_SITE.z - lx * this.sn + lz * this.cs]; }
  /** ship-local position of a planet-fixed point (via the spawn region's flat coordinates) */
  toLocal(p: THREE.Vector3, out = this.loc) {
    const f = pfToRegion(p);
    this.flat.x = f.X; this.flat.h = f.h; this.flat.z = f.Z;
    return out.set(f.X, f.h, f.Z).applyMatrix4(this.W2L);
  }
  private fromLocal(l: THREE.Vector3, p: THREE.Vector3) {
    const w = this.tmp.copy(l).applyMatrix4(this.L2W);
    regionToPF(w.x, this.flat.h, w.z, p);   // keep the altitude: only horizontal pushes
  }

  updateShadow(renderer: THREE.WebGLRenderer, sunFlat: THREE.Vector3, force = false) {
    if (!force && sunFlat.angleTo(this.lastSun) < 0.0015) return;
    this.lastSun.copy(sunFlat);
    this.shadowCam.position.copy(this.center).addScaledVector(sunFlat, 70);
    this.shadowCam.lookAt(this.center);
    this.shadowCam.updateMatrixWorld();
    shared.uSShadowMat.value.multiplyMatrices(this.shadowCam.projectionMatrix, this.shadowCam.matrixWorldInverse);
    renderer.setRenderTarget(this.shadowRT);
    renderer.clear();
    renderer.render(this.shadowScene, this.shadowCam);
    renderer.setRenderTarget(null);
  }
  update(t: number) {
    const near = frame.camPF.distanceTo(this.anchorPF) < 12000;
    for (const m of this.meshes) { m.visible = near; if (near) { pfMatrix(this.anchorPF, m.matrix, this.basis); m.matrixWorldNeedsUpdate = true; } }
    // Halden's eye breathes slowly; the core a little faster, never in step
    this.mat.uniforms.uEye.value = 0.8 + 0.25 * Math.sin(t * 0.9);
    this.mat.uniforms.uCore.value = 0.85 + 0.2 * Math.sin(t * 1.4 + 1.0) + 0.05 * Math.sin(t * 3.3);
  }

  /* ---- walking aboard (ship-local) ---- */
  /** the highest floor at (x, z) that someone with feet at height f can stand on (step up to 0.45 m) */
  private floorLocal(x: number, z: number, f: number) {
    let best = -Infinity;
    const take = (y: number) => { if (y <= f + 0.45 && y > best) best = y; };
    const doorZone = z > DOOR.z0 + 0.1 && z < DOOR.z1 - 0.1;
    if (x >= RAMP.x0 - 0.05 && x <= RAMP.x0 + this.rampRun && z > RAMP.z0 && z < RAMP.z1) take(this.rampY(x));
    if (z > LOWER_Z[0] && z < LOWER_Z[1] && (Math.abs(x) <= floorHalf(DECK.lower, z) || (doorZone && x > 0 && x < RAMP.x0 + 0.1))) take(DECK.lower);
    if (x > STAIRS.x0 && x < STAIRS.x1 && z > STAIRS.zTop && z < STAIRS.zBot) take(DECK.lower + (STAIRS.zBot - z) / (STAIRS.zBot - STAIRS.zTop) * (DECK.upper - DECK.lower));
    const inHole = x > HOLE.x0 && x < HOLE.x1 && z > HOLE.z0 && z < HOLE.z1;
    if (z > UPPER_Z[0] && z < UPPER_Z[1] && Math.abs(x) <= floorHalf(DECK.upper, z) && !inHole) take(DECK.upper);
    if (x > LADDER.x0 - 0.1 && x < LADDER.x1 + 0.1 && z < LADDER.zBot && z > DOME.z - 0.3) take(Math.min(DOME.floor, DECK.upper + (LADDER.zBot - z) / (LADDER.zBot - LADDER.zTop) * (DOME.floor - DECK.upper)));
    if (z <= DOME.z - 0.2 && x * x + (z - DOME.z) ** 2 < 2.3 * 2.3) take(DOME.floor);
    return best;
  }
  /** obstacle interface (player.ts): floor height (flat altitude) under a planet-fixed eye position */
  floorAt(p: THREE.Vector3) {
    const l = this.toLocal(p);
    if (Math.abs(l.x) > 14 || Math.abs(l.z) > 16) return -1e9;
    const y = this.floorLocal(l.x, l.z, l.y - EYE);
    return y === -Infinity ? -1e9 : y + this.groundY;
  }
  /** standing on the ship's boards (for wooden footsteps) */
  onBoard(p: THREE.Vector3) { const l = this.toLocal(p); return Math.abs(l.x) < 14 && this.floorLocal(l.x, l.z, l.y - EYE) > 0.3 && Math.abs(l.y - EYE - this.floorLocal(l.x, l.z, l.y - EYE)) < 0.2; }
  /** inside the hull (the eye adapts, sound goes indoor) */
  inside(p: THREE.Vector3) { const l = this.toLocal(p), f = l.y - EYE; return f > 2.0 && f < 11 && Math.abs(l.x) < halfWidthAt(f + 1.0, l.z) - 0.05; }
  /** obstacle interface: push a planet-fixed eye position out of the hull, legs, walls and furniture */
  collide(p: THREE.Vector3) {
    const l = this.toLocal(p);
    if (Math.abs(l.x) > 14 || Math.abs(l.z) > 16) return;
    const f = l.y - EYE, RAD = 0.3;
    let x = l.x, z = l.z;
    // under the hull: the belly comes down to head height near the middle
    if (f < 1.6) {
      const Y = f + 1.9, r = Math.max(halfWidthAt(Y, z), 0);
      if (bellyAt(x, z) < Y && r > 0) x = Math.sign(x || 1) * (r + RAD);
    }
    // aboard: stay inside the inner shell (wider at chest height than at the floor), on the right deck
    const inHull = f > 2.0 && Math.abs(x) < halfWidthAt(f + 1.0, z);
    if (inHull) {
      const doorZone = x > 0 && z > DOOR.z0 + 0.25 && z < DOOR.z1 - 0.25 && f < DECK.lower + 0.6;
      const w = Math.min(halfWidthAt(f + 1.0, z, HULL.thick), halfWidthAt(f + 0.05, z, HULL.thick)) - RAD;
      if (!doorZone) x = clamp(x, -Math.max(w, 0), Math.max(w, 0));
      if (f < 4.2) z = clamp(z, LOWER_Z[0] + RAD, LOWER_Z[1] - RAD);
      else z = clamp(z, UPPER_Z[0] + RAD, UPPER_Z[1] - RAD);
    }
    // up in the dome (above the hull top): the glass is the wall
    if (f > 9.3 && f < 12.5) {
      const dz = z - DOME.z, d = Math.hypot(x, dz), m = 2.15;
      if (d > m && d < DOME.r + 1.0) { x *= m / d; z = DOME.z + dz * m / d; }
    }
    // walls, furniture, legs, ramp rails: boxes that apply between their heights
    for (let it = 0; it < 2; it++) for (const b of this.boxes) {
      if (f < b.y0 || f >= b.y1) continue;
      const cx = clamp(x, b.x0, b.x1), cz = clamp(z, b.z0, b.z1), dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= RAD * RAD) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (RAD - d) / d; x += dx * k; z += dz * k; }
      else {
        const pen = [x - b.x0, b.x1 - x, z - b.z0, b.z1 - z], m = Math.min(...pen), i = pen.indexOf(m);
        if (i === 0) x = b.x0 - RAD; else if (i === 1) x = b.x1 + RAD; else if (i === 2) z = b.z0 - RAD; else z = b.z1 + RAD;
      }
    }
    if (x !== l.x || z !== l.z) { l.x = x; l.z = z; this.fromLocal(l, p); }
  }
}

/* "THE WREN", painted on the nose: a little canvas, read as alpha by the hull shader */
function nameTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const tex = new THREE.CanvasTexture(c);
  const draw = () => {
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 512, 128);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'italic 600 78px "Cormorant Garamond", Georgia, serif';
    (g as unknown as { letterSpacing: string }).letterSpacing = '6px';
    g.fillText('THE WREN', 256, 68);
    tex.needsUpdate = true;
  };
  draw();
  document.fonts?.load('italic 600 78px "Cormorant Garamond"').then(draw).catch(() => {});
  return tex;
}
