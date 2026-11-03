import * as THREE from 'three';
import { MAP_W, MAP_H, RING_W } from '../config';
import { MAP_ALBEDO, MAP_RANGE } from './system';

/* Surface maps and ring profiles of the far bodies, baked in a worker at boot (space/bodies.worker.ts). */
export type BodyMaps = { maps: THREE.DataArrayTexture; rings: THREE.DataArrayTexture };
type Baked = { maps: Uint8Array; rings: Uint8Array; means: number[]; ranges: number[] };

function arrayTex(data: Uint8Array, w: number, h: number, layers: number, wrapS: THREE.Wrapping) {
  const t = new THREE.DataArrayTexture(data, w, h, layers);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.wrapS = wrapS; t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true; t.unpackAlignment = 1; t.needsUpdate = true;
  return t;
}
export function bakeBodyMaps(): Promise<BodyMaps> {
  const w = new Worker(new URL('./bodies.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((res, rej) => {
    w.onerror = rej;
    w.onmessage = (e: MessageEvent<Baked>) => {
      w.terminate();
      const d = e.data;
      d.means.forEach((m, i) => { MAP_ALBEDO[i] = m; MAP_RANGE[i] = d.ranges[i]; });
      res({ maps: arrayTex(d.maps, MAP_W, MAP_H, d.means.length, THREE.RepeatWrapping), rings: arrayTex(d.rings, RING_W, 1, 2, THREE.ClampToEdgeWrapping) });
    };
    w.postMessage('go');
  });
}
