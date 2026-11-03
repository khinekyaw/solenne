import * as THREE from 'three';
import { PLANET_R, MAX_LEVEL, SPLIT_K, WATER } from '../config';
import { flatToPF } from './solenne';
import { pfMatrix } from '../render/frame';

/* =========================================================================
   Cube-sphere quadtree. Six root nodes (one per face, flat coords ±R);
   a node splits when the camera is within SPLIT_K × its size. A node only
   hands over to its children once all four have meshes, so there are no
   holes while chunks stream in from the workers.
   ========================================================================= */
type ChunkMsg = { id: number; pos: Float32Array; nor: Float32Array; flat: Float32Array; info: Float32Array; index: Uint16Array; center: number[]; radius: number; hMin: number; hMax: number;
  wpos?: Float32Array; wflat?: Float32Array; wdepth?: Float32Array; windex?: Uint16Array };
class Node {
  children: Node[] | null = null;
  mesh: THREE.Mesh | null = null;
  water: THREE.Mesh | null = null;
  state: 'none' | 'pending' | 'ready' = 'none';
  center = new THREE.Vector3();
  radius: number;
  hMax = 1700;
  size3: number;
  used = 0;
  constructor(public id: number, public face: number, public level: number, public x0: number, public z0: number, public size: number) {
    flatToPF(face, x0 + size / 2, 0, z0 + size / 2, this.center);
    const a = flatToPF(face, x0, 0, z0), b = flatToPF(face, x0 + size, 0, z0 + size);
    this.size3 = a.distanceTo(b) / Math.SQRT2;
    this.radius = this.size3 * 0.75 + 1800;
  }
}

const R_MIN = PLANET_R - 780;   // below the deepest lowland
const horizonDist = (r: number) => Math.sqrt(Math.max(r * r - R_MIN * R_MIN, 0));

export class Quadtree {
  group = new THREE.Group();
  private roots: Node[] = [];
  private byId = new Map<number, Node>();
  private nextId = 1;
  private queue: Node[] = [];
  private inFlight = 0;
  private frameNo = 0;
  private drawn = new Set<Node>();
  private wi = 0;
  readonly maxInFlight: number;

  constructor(private material: THREE.Material, private waterMat: THREE.Material, private workers: Worker[]) {
    this.maxInFlight = workers.length * 3;
    for (let f = 0; f < 6; f++) this.roots.push(this.node(f, 0, -PLANET_R, -PLANET_R, 2 * PLANET_R));
    for (const w of workers) w.addEventListener('message', (e) => { if (e.data.type === 'chunk') this.onChunk(e.data); });
  }
  get pending() { return this.queue.length + this.inFlight; }
  get chunkCount() { return this.drawn.size; }

  private node(face: number, level: number, x0: number, z0: number, size: number) {
    const n = new Node(this.nextId++, face, level, x0, z0, size);
    this.byId.set(n.id, n);
    return n;
  }
  private onChunk(m: ChunkMsg) {
    this.inFlight--;
    const n = this.byId.get(m.id);
    if (!n || n.state !== 'pending') return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.nor, 3));
    g.setAttribute('aFlat', new THREE.BufferAttribute(m.flat, 3));
    g.setAttribute('aInfo', new THREE.BufferAttribute(m.info, 4));
    g.setIndex(new THREE.BufferAttribute(m.index, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), m.radius);
    const mesh = new THREE.Mesh(g, this.material);
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    this.group.add(mesh);
    n.mesh = mesh;
    if (m.wpos) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.BufferAttribute(m.wpos, 3));
      wg.setAttribute('aFlat', new THREE.BufferAttribute(m.wflat!, 3));
      wg.setAttribute('aDepth', new THREE.BufferAttribute(m.wdepth!, 1));
      wg.setIndex(new THREE.BufferAttribute(m.windex!, 1));
      wg.computeBoundingSphere();   // the surface can sit far above a deep seabed chunk's own bounds
      const wm = new THREE.Mesh(wg, this.waterMat);
      wm.matrixAutoUpdate = false; wm.visible = false; wm.renderOrder = 1;
      this.group.add(wm);
      n.water = wm;
    }
    n.center.set(m.center[0], m.center[1], m.center[2]);
    n.radius = m.radius; n.hMax = m.wpos ? Math.max(m.hMax, WATER) : m.hMax;   // water stands above a deep seabed
    n.state = 'ready';
  }
  private culled(n: Node, cam: THREE.Vector3, camHz: number) {
    const d = n.center.distanceTo(cam) - n.radius;
    return d > camHz + horizonDist(PLANET_R + n.hMax);
  }
  private wantSplit(n: Node, cam: THREE.Vector3) {
    if (n.level >= MAX_LEVEL) return false;
    return n.center.distanceTo(cam) - n.radius * 0.5 < SPLIT_K * n.size3;
  }
  private select(n: Node, cam: THREE.Vector3, camHz: number, out: Node[]): boolean {
    n.used = this.frameNo;
    if (this.culled(n, cam, camHz)) return true;
    if (this.wantSplit(n, cam)) {
      if (!n.children) {
        const h = n.size / 2;
        n.children = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([i, j]) => this.node(n.face, n.level + 1, n.x0 + i * h, n.z0 + j * h, h));
      }
      const sub: Node[] = [];
      let ok = true;
      for (const c of n.children) ok = this.select(c, cam, camHz, sub) && ok;
      if (ok) { for (const s of sub) out.push(s); return true; }
    }
    if (n.state === 'ready') { out.push(n); return true; }
    if (n.state === 'none') { n.state = 'pending'; this.queue.push(n); }
    return false;
  }
  update(cam: THREE.Vector3) {
    this.frameNo++;
    const camHz = horizonDist(cam.length());
    const out: Node[] = [];
    for (const r of this.roots) this.select(r, cam, camHz, out);
    const now = new Set(out);
    for (const n of this.drawn) if (!now.has(n)) { if (n.mesh) n.mesh.visible = false; if (n.water) n.water.visible = false; }
    for (const n of now) {
      n.mesh!.visible = true; pfMatrix(n.center, n.mesh!.matrix); n.mesh!.matrixWorldNeedsUpdate = true;
      if (n.water) { n.water.visible = true; n.water.matrix.copy(n.mesh!.matrix); n.water.matrixWorldNeedsUpdate = true; }
    }
    this.drawn = now;
    this.pump(cam);
    if (this.frameNo % 120 === 0) for (const r of this.roots) this.prune(r);
  }
  private pump(cam: THREE.Vector3) {
    if (!this.queue.length || this.inFlight >= this.maxInFlight) return;
    // drop requests nobody asked for this frame, then serve coarse and near first
    this.queue = this.queue.filter((n) => { if (n.used === this.frameNo) return true; n.state = 'none'; return false; });
    this.queue.sort((a, b) => (a.level - b.level) * 1e9 + a.center.distanceTo(cam) - b.center.distanceTo(cam));
    while (this.queue.length && this.inFlight < this.maxInFlight) {
      const n = this.queue.shift()!;
      this.workers[this.wi++ % this.workers.length].postMessage({ type: 'chunk', id: n.id, face: n.face, x0: n.x0, z0: n.z0, size: n.size });
      this.inFlight++;
    }
  }
  /** free subtrees that have not been visited for a few seconds */
  private prune(n: Node) {
    if (!n.children) return;
    if (this.frameNo - n.used > 240) { for (const c of n.children) this.dispose(c); n.children = null; return; }
    for (const c of n.children) this.prune(c);
  }
  private dispose(n: Node) {
    if (n.children) for (const c of n.children) this.dispose(c);
    if (n.mesh) { this.group.remove(n.mesh); n.mesh.geometry.dispose(); n.mesh = null; }
    if (n.water) { this.group.remove(n.water); n.water.geometry.dispose(); n.water = null; }
    this.drawn.delete(n);
    n.state = 'none';
    this.byId.delete(n.id);
  }
}
