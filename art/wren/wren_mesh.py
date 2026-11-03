# =========================================================================
# Mesh building in game coordinates (x port, y up, z nose): a small
# accumulator, primitives (lathe, sweep, rounded box), and the panel
# generator that lays riveted plates on any parametric surface. Plates and
# rivets are bake sources only; the game mesh stays smooth and low.
# =========================================================================
import bpy
import bmesh
import math
from mathutils import Vector, Matrix
from wren_shape import G


class MB:
    """mesh accumulator in game space; per-face colour (bake attribute 'pcol') and material slot"""

    def __init__(self):
        self.v, self.f, self.fc, self.fm = [], [], [], []
        self.seams = set()

    def vert(self, p):
        self.v.append(Vector(p))
        return len(self.v) - 1

    def face(self, idx, col=(0.8, 0.8, 0.8, 1.0), mat=0):
        self.f.append(tuple(idx))
        self.fc.append(col)
        self.fm.append(mat)

    def rows(self, rows, col=(0.8, 0.8, 0.8, 1.0), mat=0, wrap=False, flip=False, keep=None):
        """faces between consecutive rows of points (all rows the same length); returns vertex index rows"""
        ids = [[self.vert(p) for p in r] for r in rows]
        n = len(rows[0])
        for j in range(len(rows) - 1):
            for i in range(n if wrap else n - 1):
                i1 = (i + 1) % n
                if keep and not keep(i, j):
                    continue
                q = (ids[j][i], ids[j][i1], ids[j + 1][i1], ids[j + 1][i])
                self.face(q[::-1] if flip else q, col, mat)
        return ids

    def normal(self, k):
        """Newell normal and centre of face k"""
        f = self.f[k]
        n, c = Vector((0, 0, 0)), Vector((0, 0, 0))
        for a, b in zip(f, f[1:] + f[:1]):
            p, q = self.v[a], self.v[b]
            n += Vector(((p.y - q.y) * (p.z + q.z), (p.z - q.z) * (p.x + q.x), (p.x - q.x) * (p.y + q.y)))
            c += p
        return n, c / len(f)

    def orient(self, want, start=0):
        """flip faces (from index start) whose normal disagrees with want(centre) -> direction"""
        for k in range(start, len(self.f)):
            n, c = self.normal(k)
            if n.dot(Vector(want(c))) < 0:
                self.f[k] = self.f[k][::-1]

    def extend(self, other, M=None):
        off = len(self.v)
        for p in other.v:
            self.v.append(M @ p if M is not None else p.copy())
        for f, c, m in zip(other.f, other.fc, other.fm):
            self.face([i + off for i in f], c, m)
        self.seams |= {(a + off, b + off) for a, b in other.seams}

    def to_object(self, name, mats=(), coll=None, smooth=True, sharp_angle=None):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(G(*p)) for p in self.v], [], self.f)
        for m in mats:
            me.materials.append(m)
        if self.fm:
            me.polygons.foreach_set('material_index', self.fm)
        ca = me.color_attributes.new('pcol', 'FLOAT_COLOR', 'CORNER')
        flat = []
        for poly, c in zip(me.polygons, self.fc):
            flat.extend(c * poly.loop_total)
        ca.data.foreach_set('color', flat)
        if self.seams:
            ek = {e.key: e for e in me.edges}
            for a, b in self.seams:
                e = ek.get((min(a, b), max(a, b)))
                if e:
                    e.use_seam = True
        me.validate(clean_customdata=False)
        if smooth:
            me.shade_smooth()
            if sharp_angle is not None:
                me.set_sharp_from_angle(angle=math.radians(sharp_angle))
        ob = bpy.data.objects.new(name, me)
        (coll or bpy.context.scene.collection).objects.link(ob)
        return ob


def frame_from(n, hint=Vector((0, 1, 0))):
    """orthonormal (t, b, n) with n the given axis"""
    n = Vector(n).normalized()
    h = Vector(hint)
    if abs(n.dot(h)) > 0.95:
        h = Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 0, 1))
    t = h.cross(n).normalized()
    b = n.cross(t)
    return t, b, n


def basis(origin, axis, hint=Vector((0, 1, 0))):
    """4x4 local -> game: local z along axis"""
    t, b, n = frame_from(axis, hint)
    M = Matrix((
        (t.x, b.x, n.x, origin[0]),
        (t.y, b.y, n.y, origin[1]),
        (t.z, b.z, n.z, origin[2]),
        (0, 0, 0, 1)))
    return M


def lathe(mb, prof, seg, M, col=(0.8, 0.8, 0.8, 1.0), mat=0, a0=0.0, a1=2 * math.pi, close_center=True):
    """revolve (r, h) around local z. The visible side is on the right of the walking direction in (r, h):
    walk up the outside, inward across the top, down the inside. r = 0 ends become poles"""
    full = abs(a1 - a0 - 2 * math.pi) < 1e-6
    n = seg if full else seg + 1
    rows = []
    for r, h in prof:
        row = []
        for i in range(n):
            a = a0 + (a1 - a0) * i / seg
            row.append(M @ Vector((r * math.cos(a), r * math.sin(a), h)))
        rows.append(row)
    ids = [[mb.vert(p) for p in r] for r in rows]
    for j in range(len(rows) - 1):
        for i in range(n if full else n - 1):
            i1 = (i + 1) % n
            q = (ids[j][i], ids[j][i1], ids[j + 1][i1], ids[j + 1][i])
            if prof[j][0] < 1e-6 and prof[j + 1][0] < 1e-6:
                continue
            mb.face(q, col, mat)
    return ids


def sweep(mb, pts, prof, ups, col=(0.8, 0.8, 0.8, 1.0), mat=0, closed=False, caps=True):
    """sweep a closed 2D profile (x across, y along 'up') along a polyline; ups[i] orients the profile"""
    m = len(pts)
    rows = []
    for i in range(m):
        a = pts[(i - 1) % m] if closed or i > 0 else pts[i]
        b = pts[(i + 1) % m] if closed or i < m - 1 else pts[i]
        tng = (Vector(b) - Vector(a)).normalized()
        up = Vector(ups[i])
        up = (up - tng * up.dot(tng)).normalized()
        side = tng.cross(up)
        rows.append([Vector(pts[i]) + side * px + up * py for px, py in prof])
    k = len(prof)
    ids = [[mb.vert(p) for p in r] for r in rows]
    for j in range(m if closed else m - 1):
        j1 = (j + 1) % m
        for i in range(k):
            i1 = (i + 1) % k
            mb.face((ids[j][i], ids[j1][i], ids[j1][i1], ids[j][i1]), col, mat)
    if caps and not closed:
        mb.face(ids[0], col, mat)
        mb.face(ids[-1][::-1], col, mat)
    return ids


def circle_prof(r, n=8):
    return [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def rrect_prof(w, h, r, n=3):
    """rounded rectangle, w across, h tall, centred on its base line (y from 0 to h)"""
    pts = []
    cs = [(w / 2 - r, h - r, 0), (-w / 2 + r, h - r, 90), (-w / 2 + r, r, 180), (w / 2 - r, r, 270)]
    for cx, cy, a0 in cs:
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def rbox(mb, M, sx, sy, sz, r=0.03, col=(0.8, 0.8, 0.8, 1.0), mat=0, n=2):
    """rounded box centred at M's origin (a lathe-free superellipse would be overkill: a profile sweep)"""
    prof = [(p[0], p[1] - sy / 2) for p in rrect_prof(sx, sy, min(r, sx / 2 - 1e-3, sy / 2 - 1e-3), n)]
    # sweep along local z with rounded ends: shrink the profile in the last steps
    rows = []
    zs = []
    for i in range(n + 1):
        a = math.pi / 2 * (1 - i / n)
        zs.append((-sz / 2 + r * (1 - math.cos(a)), math.sin(a)))
    for i in range(n, -1, -1):
        a = math.pi / 2 * (1 - i / n)
        zs.append((sz / 2 - r * (1 - math.cos(a)), math.sin(a)))
    for z, k in zs:
        s = 1 - k * min(r, sx / 2, sy / 2) / max(min(sx, sy) / 2, 1e-4)
        rows.append([M @ Vector((px * s, py * s, z)) for px, py in prof])
    ids = [[mb.vert(p) for p in r_] for r_ in rows]
    kk = len(prof)
    for j in range(len(rows) - 1):
        for i in range(kk):
            i1 = (i + 1) % kk
            mb.face((ids[j][i], ids[j][i1], ids[j + 1][i1], ids[j + 1][i]), col, mat)
    mb.face(ids[0][::-1], col, mat)
    mb.face(ids[-1], col, mat)


def cyl(mb, a, b, r0, r1=None, seg=16, col=(0.8, 0.8, 0.8, 1.0), mat=0, bevel=0.0, hint=Vector((0, 1, 0))):
    """capped cylinder from a to b, optional rounded rims"""
    r1 = r0 if r1 is None else r1
    a, b = Vector(a), Vector(b)
    L = (b - a).length
    M = basis(a, b - a, hint)
    e = min(bevel, L / 3, r0 / 2, r1 / 2)
    if e > 0:
        prof = [(0, 0), (r0 - e, 0), (r0 - e * 0.3, e * 0.3), (r0, e), (r1, L - e), (r1 - e * 0.3, L - e * 0.3), (r1 - e, L), (0, L)]
    else:
        prof = [(0, 0), (r0, 0), (r0, L), (r1, L), (0, L)]
    lathe(mb, prof, seg, M, col, mat)


def dome_rivet(mb, p, n, r, col, mat=0, seg=8):
    t, b, nn = frame_from(n)
    top = mb.vert(p + nn * r * 0.75)
    ring1 = [mb.vert(p + (t * math.cos(a) + b * math.sin(a)) * r * 0.62 + nn * r * 0.55) for a in [2 * math.pi * i / seg for i in range(seg)]]
    ring0 = [mb.vert(p + (t * math.cos(a) + b * math.sin(a)) * r - nn * r * 0.2) for a in [2 * math.pi * i / seg for i in range(seg)]]
    for i in range(seg):
        i1 = (i + 1) % seg
        mb.face((top, ring1[i], ring1[i1]), col, mat)
        mb.face((ring1[i], ring0[i], ring0[i1], ring1[i1]), col, mat)


# ---- plates on a parametric surface ----
class Surf:
    """surface(u, v) -> game point; inside(u, v) -> a point inside the solid (to orient normals)"""

    def __init__(self, fn, inside):
        self.fn, self.inside = fn, inside

    def P(self, u, v):
        return Vector(self.fn(u, v))

    def d(self, u, v, eu=1e-3, ev=1e-3):
        pu = (self.P(u + eu, v) - self.P(u - eu, v)) / (2 * eu)
        pv = (self.P(u, v + ev) - self.P(u, v - ev)) / (2 * ev)
        return pu, pv

    def N(self, u, v):
        pu, pv = self.d(u, v)
        n = pu.cross(pv)
        if n.length < 1e-9:
            n = self.P(u, v) - Vector(self.inside(u, v))
        n.normalize()
        if n.dot(self.P(u, v) - Vector(self.inside(u, v))) < 0:
            n = -n
        return n


def plate(mb, rv, S, u0, u1, v0, v1, col, step=0.33, gap=0.016, bev=0.02, h=0.022, hole=None,
          rivets='edges', rstep=0.19, rr=0.024, rin=0.055, vlim=None, mat=1):
    """one riveted plate covering [u0,u1]x[v0,v1] minus a seam; vlim(u) -> (vmin, vmax) clips per column"""
    def mu(u, v):
        return max(S.d(u, v)[0].length, 1e-5)

    def mv(u, v):
        return max(S.d(u, v)[1].length, 1e-5)

    um, vm = (u0 + u1) / 2, (v0 + v1) / 2

    def arc(fn, n=24):   # length along a param line (speed alone fails where it vanishes, e.g. round a leading edge)
        pts = [fn(k / n) for k in range(n + 1)]
        return sum((pts[k + 1] - pts[k]).length for k in range(n))

    nu = max(2, int(math.ceil(arc(lambda t: S.P(u0 + (u1 - u0) * t, vm)) / step)))
    nv = max(2, int(math.ceil(arc(lambda t: S.P(um, v0 + (v1 - v0) * t)) / step)))

    eu, ev = 0.12 * (u1 - u0), 0.12 * (v1 - v0)

    def vb(u, D):
        a, b = v0, v1
        if vlim:
            lo, hi = vlim(u)
            a, b = max(a, lo), min(b, hi)
            if b <= a:
                return a, a
        e = 0.12 * (b - a)
        return a + D / mv(u, a + e), b - D / mv(u, b - e)

    def ub(v, D):
        return u0 + D / mu(u0 + eu, v), u1 - D / mu(u1 - eu, v)

    def grid(D, off):
        live = sum(1 for i in range(nu + 1) if (lambda r: r[1] > r[0])(vb(u0 + (u1 - u0) * i / nu, D)))
        if live < 2:
            return None
        rows = []
        for j in range(nv + 1):
            row = []
            for i in range(nu + 1):
                u = u0 + (u1 - u0) * i / nu
                va, vb_ = vb(u, D)
                if vb_ <= va:   # this column is clipped away (e.g. under the canopy): it closes to the edge
                    va = vb_ = min(va, vb_)
                v = va + (vb_ - va) * j / nv
                ua, ub_ = ub(v, D)
                if ub_ <= ua:   # narrower than the seam (towards a pole): the plate closes to a point
                    ua = ub_ = (ua + ub_) / 2
                uu = ua + (ub_ - ua) * i / nu
                row.append((uu, v))
            rows.append(row)
        return [[(S.P(u, v) + S.N(u, v) * off, (u, v)) for u, v in r] for r in rows]

    top = grid(gap + bev, h)
    base = grid(gap, -0.004)
    if top is None or base is None:
        return False
    # drop the plate where it would lie over an opening
    def bad(p):
        return hole is not None and hole(p)

    f0 = len(mb.f)
    tid = [[mb.vert(p) for p, _ in r] for r in top]
    for j in range(nv):
        for i in range(nu):
            if bad(top[j][i][0]) or bad(top[j + 1][i + 1][0]) or bad(top[j][i + 1][0]) or bad(top[j + 1][i][0]):
                continue
            mb.face((tid[j][i], tid[j][i + 1], tid[j + 1][i + 1], tid[j + 1][i]), col, mat)
    # bevelled skirt down to the hull around the border
    ring_t, ring_b = [], []
    for i in range(nu):
        ring_t.append((0, i)); ring_b.append((0, i))
    for j in range(nv):
        ring_t.append((j, nu)); ring_b.append((j, nu))
    for i in range(nu, 0, -1):
        ring_t.append((nv, i)); ring_b.append((nv, i))
    for j in range(nv, 0, -1):
        ring_t.append((j, 0)); ring_b.append((j, 0))
    bid = {}
    for (j, i) in ring_b:
        if (j, i) not in bid:
            bid[(j, i)] = mb.vert(base[j][i][0])
    m = len(ring_t)
    for k in range(m):
        a, b = ring_t[k], ring_t[(k + 1) % m]
        pa, pb = top[a[0]][a[1]][0], top[b[0]][b[1]][0]
        if bad(pa) or bad(pb):
            continue
        mb.face((tid[a[0]][a[1]], bid[a], bid[b], tid[b[0]][b[1]]), col, mat)
    # orientation: the plate's faces share a winding; flip them all if the first points inward
    if len(mb.f) > f0:
        n, _ = mb.normal(f0)
        if n.dot(S.N(um, vm)) < 0:
            for k in range(f0, len(mb.f)):
                mb.f[k] = mb.f[k][::-1]
    if rv is None or rivets is None:
        return True
    D = gap + bev + rin

    def rivet_at(u, v):
        p = S.P(u, v)
        if bad(p):
            return
        n = S.N(u, v)
        dome_rivet(rv, p + n * (h - 0.002), n, rr, col)

    if rivets == 'edges' or rivets == 'ends':
        for v_edge, sgn in ((0, 1), (1, -1)):
            row = [(t_, (v0 if v_edge == 0 else v1)) for t_ in [0]]
            # walk along u at the inset v of this edge
            L = mu(um, vm) * (u1 - u0)
            k = max(1, int(L / rstep))
            for i in range(k + 1):
                u = u0 + (u1 - u0) * (0.5 + (i - k / 2) * (1 - 2 * D / max(L, 1e-3)) / max(k, 1))
                va, vb_ = vb(u, D)
                if vb_ <= va:
                    continue
                rivet_at(u, va if v_edge == 0 else vb_)
    if rivets == 'edges':
        for u_edge in (0, 1):
            L = mv(um, vm) * (v1 - v0)
            k = max(1, int(L / rstep))
            for j in range(1, k):
                v = v0 + (v1 - v0) * j / k
                if vlim:
                    lo, hi = vlim(u0 if u_edge == 0 else u1)
                    if v < lo + D / mv(um, v) or v > hi - D / mv(um, v):
                        continue
                ua, ub_ = ub(v, D)
                if ub_ <= ua:
                    continue
                rivet_at(ua if u_edge == 0 else ub_, v)
    if rivets == 'center':
        L = mv(um, vm) * (v1 - v0)
        k = max(1, int(L / rstep))
        for j in range(1, k):
            v = v0 + (v1 - v0) * j / k
            if vlim:
                lo, hi = vlim(um)
                if v < lo + 0.05 or v > hi - 0.05:
                    continue
            rivet_at(um, v)
    return True


def orient_faces(ob, inside_fn):
    """flip faces whose normal points toward inside_fn(center) (game-space reference point)"""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    flip = []
    for f in bm.faces:
        c = f.calc_center_median()
        cg = Vector((c.x, c.z, -c.y))   # Blender -> game
        ref = Vector(inside_fn(cg))
        rb = Vector((ref.x, -ref.z, ref.y))
        if f.normal.dot(c - rb) < 0:
            flip.append(f)
    if flip:
        bmesh.ops.reverse_faces(bm, faces=flip)
    bm.to_mesh(me)
    bm.free()


def recalc_normals(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
