import * as THREE from 'three';
import { GRID, LAND_RES, LAND_TOP_RES } from '../config';
import { setRegionGrid } from './heights';

/* =========================================================================
   Spawn-region textures from the terrain worker: heightfield (grass, rain),
   masks + baked terrain shadow, and the land-mask and highest-ground atlases
   for the clouds. The shadow is re-baked in the worker whenever the sun has
   moved a little.
   ========================================================================= */
export type RegionData = { H: Float32Array; tdata: Uint8Array; land: Uint8Array; top: Uint8Array };

export class Region {
  heightTex: THREE.DataTexture;
  terrainTex: THREE.DataTexture;
  landTex: THREE.DataTexture;
  topTex: THREE.DataTexture;
  private lastSun = new THREE.Vector3(0, -2, 0);
  private seq = 0;
  private busy = false;

  constructor(d: RegionData, private worker: Worker) {
    setRegionGrid(d.H);
    this.heightTex = new THREE.DataTexture(d.H, GRID, GRID, THREE.RedFormat, THREE.FloatType);
    this.heightTex.minFilter = this.heightTex.magFilter = THREE.NearestFilter;
    this.heightTex.needsUpdate = true;
    this.terrainTex = new THREE.DataTexture(d.tdata, GRID, GRID, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.terrainTex.minFilter = this.terrainTex.magFilter = THREE.LinearFilter;
    this.terrainTex.needsUpdate = true;
    this.landTex = new THREE.DataTexture(d.land, LAND_RES * 6, LAND_RES, THREE.RGFormat, THREE.UnsignedByteType);   // r land, g cloud-sea cover
    this.landTex.minFilter = this.landTex.magFilter = THREE.LinearFilter;
    this.landTex.needsUpdate = true;
    this.topTex = new THREE.DataTexture(d.top, LAND_TOP_RES * 6, LAND_TOP_RES, THREE.RedFormat, THREE.UnsignedByteType);   // highest ground nearby
    this.topTex.minFilter = this.topTex.magFilter = THREE.LinearFilter;
    this.topTex.needsUpdate = true;
    worker.addEventListener('message', (e) => {
      if (e.data.type !== 'shadow') return;
      this.busy = false;
      const td = this.terrainTex.image.data as unknown as Uint8Array, s = e.data.data as Uint8Array;
      for (let i = 0; i < GRID * GRID; i++) td[i * 4] = s[i];
      this.terrainTex.needsUpdate = true;
    });
  }
  /** sun in the region frame (= planet-fixed axes at spawn) */
  updateSun(sun: THREE.Vector3, force = false) {
    if (this.busy) return;
    if (!force && sun.angleTo(this.lastSun) < 0.006) return;
    this.lastSun.copy(sun);
    this.busy = true;
    this.worker.postMessage({ type: 'shadow', seq: ++this.seq, sun: [sun.x, sun.y, sun.z] });
  }
}
