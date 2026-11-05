import * as THREE from 'three';
import { BODIES, STAR, type StarSystem } from '../space/system';
import { conicPoints } from '../space/nav';
import { orbitPos } from '../space/kepler';

/* =========================================================================
   The system map (M at the helm): an orrery seen from ecliptic north. The
   sun, the worlds on their orbits, the moons round their planets once you
   zoom in, the Wren with the conic she is on, and the target. Click a world
   to make it the target; scroll to zoom toward the cursor; double-click to
   follow a world (the view moves with it).
   ========================================================================= */
const COLORS = ['#f2c76e', '#d9825b', '#86bfd0', '#c9c6bd', '#d07a5a', '#d9b77a', '#cfe3ee', '#8f7e70', '#9fd6c8'];
export type MapShip = { pI: THREE.Vector3; rI: THREE.Vector3; vI: THREE.Vector3; focus: number; nose: THREE.Vector3; coasting: boolean };

export class SystemMap {
  open = false;
  onPick: (k: number) => void = () => {};
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private follow = STAR;
  private off = new THREE.Vector3();     // view centre relative to the followed body (inertial, m)
  private scale = 1;                     // metres per css pixel
  private shown: { k: number; x: number; y: number }[] = [];
  private p = new THREE.Vector3(); private q = new THREE.Vector3();
  private ink = '#f3efe4'; private soft = 'rgba(243,239,228,0.55)'; private accent = '#f2c76e';
  private sys: StarSystem | null = null;

  constructor() {
    this.cv = document.createElement('canvas');
    this.cv.className = 'sysmap';
    this.cv.hidden = true;
    this.cv.setAttribute('aria-label', 'System map');
    document.body.appendChild(this.cv);
    this.ctx = this.cv.getContext('2d')!;
    const css = getComputedStyle(document.documentElement);
    this.ink = css.getPropertyValue('--ink').trim() || this.ink;
    this.accent = css.getPropertyValue('--sun').trim() || this.accent;
    this.soft = css.getPropertyValue('--ink-faint').trim() || this.soft;
    // the cursor in the canvas's own CSS pixels (offsetX is not reliable under page zoom or scaled viewports)
    const at = (e: MouseEvent): [number, number] => { const r = this.cv.getBoundingClientRect(); return [(e.clientX - r.left) * this.cv.clientWidth / r.width, (e.clientY - r.top) * this.cv.clientHeight / r.height]; };
    this.cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.sys) return;
      // zoom toward the point under the cursor
      const [x, y] = at(e), before = this.toWorld(x, y, this.p);
      this.scale = THREE.MathUtils.clamp(this.scale * Math.exp(e.deltaY * 0.0015), 2e4, 1e8);
      this.off.add(before.sub(this.toWorld(x, y, this.q)));
    }, { passive: false });
    this.cv.addEventListener('click', (e) => { const k = this.pick(...at(e)); if (k >= 0) this.onPick(k); });
    this.cv.addEventListener('dblclick', (e) => { const k = this.pick(...at(e)); if (k >= 0) { this.follow = k; this.off.set(0, 0, 0); } });
  }
  toggle(on = !this.open) {
    this.open = on;
    this.cv.hidden = !on;
    if (on) { this.follow = STAR; this.off.set(0, 0, 0); this.scale = 1.15e10 / (0.46 * Math.min(window.innerWidth, window.innerHeight)); }   // Vael's orbit fits
  }
  private centre(out: THREE.Vector3) { return out.copy(this.sys!.bodies[this.follow].pos).add(this.off); }
  private toWorld(x: number, y: number, out: THREE.Vector3) {
    const c = this.centre(out), W = this.cv.clientWidth, H = this.cv.clientHeight;
    return c.set(c.x + (x - W / 2) * this.scale, c.y - (y - H / 2) * this.scale, 0);
  }
  private pick(x: number, y: number) {
    let best = -1, bd = 18;
    for (const s of this.shown) { const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = s.k; } }
    return best;
  }

  /** draw the current state (call every frame while open) */
  draw(sys: StarSystem, ship: MapShip, target: number, info: string) {
    this.sys = sys;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), W = window.innerWidth, H = window.innerHeight;
    if (this.cv.width !== Math.round(W * dpr) || this.cv.height !== Math.round(H * dpr)) { this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr); }
    const g = this.ctx, c = this.centre(new THREE.Vector3()), s = this.scale;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(6, 14, 26, 0.93)';
    g.fillRect(0, 0, W, H);
    const X = (p: THREE.Vector3) => W / 2 + (p.x - c.x) / s, Y = (p: THREE.Vector3) => H / 2 - (p.y - c.y) / s;

    // orbits, each round its parent where it is now (only once it would be a few pixels across)
    g.lineWidth = 1;
    for (let k = 0; k < BODIES.length; k++) {
      const b = sys.bodies[k];
      if (!b.el || b.el.a / s < 4) continue;
      const par = sys.bodies[BODIES[k].parent].pos, T = 2 * Math.PI / b.el.n;
      g.strokeStyle = k === target ? 'rgba(242,199,110,0.55)' : 'rgba(243,239,228,0.16)';
      g.beginPath();
      for (let i = 0; i <= 128; i++) {
        orbitPos(b.el, sys.t + (T * i) / 128, this.p).add(par);
        if (i) g.lineTo(X(this.p), Y(this.p)); else g.moveTo(X(this.p), Y(this.p));
      }
      g.stroke();
    }
    // the conic she is on (coasting), round the body that rules her
    if (ship.coasting) {
      const mu = BODIES[ship.focus].GM ?? 0, fp = sys.bodies[ship.focus].pos;
      const pts = conicPoints(ship.rI, ship.vI, mu, Math.max(ship.rI.length() * 4, BODIES[ship.focus].radius * 20));
      if (pts.length > 1) {
        g.strokeStyle = 'rgba(134,191,208,0.75)'; g.setLineDash([4, 4]);
        g.beginPath();
        pts.forEach((pt, i) => { this.p.copy(pt).add(fp); if (i) g.lineTo(X(this.p), Y(this.p)); else g.moveTo(X(this.p), Y(this.p)); });
        g.stroke(); g.setLineDash([]);
      }
    }
    // the bodies: a dot at least a few pixels wide, a label unless it would sit on its parent's
    this.shown = [];
    g.font = '600 12px Manrope, system-ui, sans-serif'; g.textBaseline = 'middle';
    for (let k = 0; k < BODIES.length; k++) {
      const p = sys.bodies[k].pos, x = X(p), y = Y(p);
      if (x < -50 || y < -50 || x > W + 50 || y > H + 50) continue;
      const par = BODIES[k].parent, crowd = par >= 0 && par !== STAR && Math.hypot(x - X(sys.bodies[par].pos), y - Y(sys.bodies[par].pos)) < 14;
      if (crowd) continue;
      const r = Math.max(k === STAR ? 6 : 3.5, BODIES[k].radius / s);
      if (k === STAR) { const gr = g.createRadialGradient(x, y, 0, x, y, r * 4); gr.addColorStop(0, 'rgba(242,199,110,0.5)'); gr.addColorStop(1, 'rgba(242,199,110,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 4, 0, 7); g.fill(); }
      g.fillStyle = COLORS[k]; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      if (k === target) { g.strokeStyle = this.accent; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, r + 6, 0, 7); g.stroke(); g.lineWidth = 1; }
      g.fillStyle = k === target ? this.accent : this.ink;
      g.fillText(BODIES[k].name, x + r + 7, y);
      this.shown.push({ k, x, y });
    }
    // the Wren: a little arrowhead along her nose, a line to the target
    const sx = X(ship.pI), sy = Y(ship.pI);
    if (target >= 0) {
      g.strokeStyle = 'rgba(242,199,110,0.4)'; g.setLineDash([2, 5]);
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(X(sys.bodies[target].pos), Y(sys.bodies[target].pos)); g.stroke(); g.setLineDash([]);
    }
    const a = Math.atan2(-ship.nose.y, ship.nose.x);
    g.save(); g.translate(sx, sy); g.rotate(a);
    g.fillStyle = this.accent; g.strokeStyle = 'rgba(6,14,26,0.9)';
    g.beginPath(); g.moveTo(9, 0); g.lineTo(-6, 5.5); g.lineTo(-3, 0); g.lineTo(-6, -5.5); g.closePath(); g.fill(); g.stroke();
    g.restore();
    g.fillStyle = this.ink; g.fillText('The Wren', sx + 11, sy + 15);

    // title, what the target is, the keys
    g.font = 'italic 600 22px Cormorant Garamond, Georgia, serif'; g.fillStyle = this.accent; g.textBaseline = 'alphabetic';
    g.fillText('The Seren system', 24, 40);
    g.font = '500 13px Manrope, system-ui, sans-serif'; g.fillStyle = this.ink;
    info.split('\n').forEach((line, i) => g.fillText(line, 24, 66 + i * 19));
    g.fillStyle = this.soft;
    g.fillText('Click a world to set the target · G autopilot · scroll to zoom · double-click to follow · M to close', 24, H - 24);
    // a scale bar
    const nice = [1e5, 3e5, 1e6, 3e6, 1e7, 3e7, 1e8, 3e8, 1e9, 3e9, 1e10], m = nice.find((v) => v / s > 80) ?? 1e10, len = m / s;
    g.strokeStyle = this.soft; g.beginPath(); g.moveTo(W - 24 - len, H - 28); g.lineTo(W - 24, H - 28); g.stroke();
    g.textAlign = 'right'; g.fillText(m >= 1e9 ? `${m / 1e9} million km` : `${(m / 1000).toLocaleString('en')} km`, W - 24, H - 38); g.textAlign = 'left';
  }
}
