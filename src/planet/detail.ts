import * as THREE from 'three';
import { GRID, HALF, PLANET_R } from '../config';
import { FACES, SPAWN_FACE, faceOf } from './solenne';
import { shared, frame } from '../render/frame';
import type { Region } from './region';

/* =========================================================================
   The detail region: the 1.4 km heightfield + masks that grass, flowers
   and rain need. It sits on the spawn plateau's grid when you are near
   home, and is rebuilt around you by a worker anywhere else (highlands,
   the lowland under the clouds). Centres snap to 250 m on the face's own
   flat coords, so blades keep their places when the region moves.
   ========================================================================= */
export class Detail {
  face = SPAWN_FACE; cx = 0; cz = 0;
  uHeight: { value: THREE.Texture };
  uTerrain: { value: THREE.Texture };
  camFlat = new THREE.Vector3();
  private heightTex: THREE.DataTexture;
  private terrainTex: THREE.DataTexture;
  private seq = 0;
  private pending = false;
  private shadowBusy = false;
  private lastSun = new THREE.Vector3(0, -2, 0);
  private basis = new THREE.Matrix3();
  private sunF = new THREE.Vector3();

  constructor(private spawn: Region, private worker: Worker) {
    this.uHeight = { value: spawn.heightTex };
    this.uTerrain = { value: spawn.terrainTex };
    this.heightTex = new THREE.DataTexture(new Float32Array(GRID * GRID), GRID, GRID, THREE.RedFormat, THREE.FloatType);
    this.heightTex.minFilter = this.heightTex.magFilter = THREE.NearestFilter;
    this.terrainTex = new THREE.DataTexture(new Uint8Array(GRID * GRID * 4), GRID, GRID, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.terrainTex.minFilter = this.terrainTex.magFilter = THREE.LinearFilter;
    worker.addEventListener('message', (e) => {
      const m = e.data;
      if (m.type === 'detail') {
        this.pending = false;
        if (m.seq !== this.seq) return;
        (this.heightTex.image.data as unknown as Float32Array).set(m.H);
        (this.terrainTex.image.data as unknown as Uint8Array).set(m.tdata);
        this.heightTex.needsUpdate = this.terrainTex.needsUpdate = true;
        this.use(m.face, m.cx, m.cz, this.heightTex, this.terrainTex);
      } else if (m.type === 'detailShadow') {
        this.shadowBusy = false;
        if (m.seq !== this.seq || this.isSpawn) return;
        const td = this.terrainTex.image.data as unknown as Uint8Array, sh = m.data as Uint8Array;
        for (let i = 0; i < GRID * GRID; i++) td[i * 4] = sh[i];
        this.terrainTex.needsUpdate = true;
      }
    });
  }
  /** a new region is being built by the worker */
  get busy() { return this.pending; }
  get isSpawn() { return this.face === SPAWN_FACE && this.cx === 0 && this.cz === 0; }
  /** the camera is inside the region's grid (with a margin) */
  get covers() { return Math.max(Math.abs(this.camFlat.x - this.cx), Math.abs(this.camFlat.z - this.cz)) < HALF - 120; }

  private use(face: number, cx: number, cz: number, h: THREE.Texture, t: THREE.Texture) {
    this.face = face; this.cx = cx; this.cz = cz;
    this.uHeight.value = h; this.uTerrain.value = t;
    this.lastSun.set(0, -2, 0);
  }
  private sunInFace(sunPF: THREE.Vector3) {
    const f = FACES[this.face];
    return this.sunF.set(sunPF.dot(f.eu), sunPF.dot(f.n), sunPF.dot(f.ev));
  }

  update(camPF: THREE.Vector3, sunPF: THREE.Vector3) {
    // where should the region be?
    const fi = faceOf(camPF), f = FACES[fi], dn = camPF.dot(f.n);
    const X = PLANET_R * camPF.dot(f.eu) / dn, Z = PLANET_R * camPF.dot(f.ev) / dn;
    const home = fi === SPAWN_FACE && Math.max(Math.abs(X), Math.abs(Z)) < 300;
    const tx = home ? 0 : Math.round(X / 250) * 250, tz = home ? 0 : Math.round(Z / 250) * 250;
    const away = fi !== this.face || Math.max(Math.abs(X - this.cx), Math.abs(Z - this.cz)) > 380;
    if (home && !this.isSpawn) { this.seq++; this.pending = false; this.use(SPAWN_FACE, 0, 0, this.spawn.heightTex, this.spawn.terrainTex); }
    else if (away && !home && !this.pending && (fi !== this.face || tx !== this.cx || tz !== this.cz)) {
      this.pending = true;
      const sf = FACES[fi];
      this.worker.postMessage({ type: 'detail', seq: ++this.seq, face: fi, cx: tx, cz: tz, sun: [sunPF.dot(sf.eu), sunPF.dot(sf.n), sunPF.dot(sf.ev)] });
    }
    // away from home the region bakes its own shadow as the sun moves
    if (!this.isSpawn && !this.pending && !this.shadowBusy && sunPF.angleTo(this.lastSun) > 0.008) {
      this.lastSun.copy(sunPF); this.shadowBusy = true;
      const s = this.sunInFace(sunPF);
      this.worker.postMessage({ type: 'detailShadow', seq: this.seq, sun: [s.x, s.y, s.z] });
    }

    // uniforms for the region shaders, all in the region face's axes
    const rf = FACES[this.face];
    this.basis.set(rf.eu.x, rf.n.x, rf.ev.x, rf.eu.y, rf.n.y, rf.ev.y, rf.eu.z, rf.n.z, rf.ev.z);
    shared.uFaceToPF.value.copy(this.basis);
    shared.uRegionToL.value.multiplyMatrices(frame.PFtoL, this.basis);
    shared.uRegionC.value.set(this.cx, this.cz);
    shared.uSunDirF.value.set(sunPF.dot(rf.eu), sunPF.dot(rf.n), sunPF.dot(rf.ev));
    shared.uHouseOn.value = this.face === SPAWN_FACE ? 1 : 0;
    const a = camPF.dot(rf.eu), b = camPF.dot(rf.n), c = camPF.dot(rf.ev);
    const l = Math.hypot(this.cx, PLANET_R, this.cz);
    shared.uCamRel.value.set(a - PLANET_R * this.cx / l, b - PLANET_R * PLANET_R / l, c - PLANET_R * this.cz / l);
    this.camFlat.set(PLANET_R * a / b, camPF.length() - PLANET_R, PLANET_R * c / b);
    shared.uCamPos.value.copy(this.camFlat);
  }
}
