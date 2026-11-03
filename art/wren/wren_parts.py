# =========================================================================
# The Wren's exterior parts (game coordinates). Low meshes are what the game
# draws; plates, rivets and straps are bake sources laid on the same
# parametric surfaces. Positions follow src/ship/wrenGeometry.ts so the
# walkable interior, the collision and the glow halos still line up.
# =========================================================================
import math
import random
from mathutils import Vector
from wren_shape import (HULL, GLASS, DOOR, DOORWAY, DOME, DECK, RAMP, LEGS, POD, hullR, hullYc, hullPoint, halfWidthAt,
                        thetaAt, hullNormal, onHull, canopyZ, doorTop, arcOf, zOfArc, aroundTable, thOfAround,
                        aroundOfTh, smoothstep)
from wren_mesh import MB, Surf, plate, lathe, sweep, rrect_prof, circle_prof, rbox, cyl, dome_rivet, basis

# source material slots for parts baked from their own shading
M_BRASS, M_PEARL, M_DARK, M_BRONZE, M_WOOD, M_MOSS, M_CHROME, M_INK = range(8)   # 8: the plate paint (pcol)
SRC_NAMES = ['brass', 'pearl', 'dark', 'bronze', 'wood', 'moss', 'chrome', 'ink']
WHITE = (1.0, 1.0, 1.0, 1.0)

PAINT = {'cream': (0.70, 0.57, 0.38), 'terra': (0.42, 0.115, 0.06), 'teal': (0.135, 0.25, 0.235),
         'olive': (0.36, 0.29, 0.11), 'pale': (0.60, 0.55, 0.43), 'rust': (0.33, 0.12, 0.06)}
WEIGHTS = [('cream', 0.38), ('terra', 0.22), ('teal', 0.18), ('olive', 0.10), ('pale', 0.08), ('rust', 0.04)]
BRASS_PAINT = (0.52, 0.38, 0.17)
ZT, ZN = HULL['zTail'], HULL['zNose']
THG = GLASS['th']


def pick(rng, avoid=()):
    for _ in range(8):
        x, acc = rng.random(), 0.0
        for name, w in WEIGHTS:
            acc += w
            if x <= acc:
                break
        if name not in avoid:
            break
    j = rng.uniform(0.9, 1.07)
    c = PAINT[name]
    return name, (c[0] * j, c[1] * j, c[2] * j, 1.0)


def V(x, y, z):
    return Vector((x, y, z))


# =================== hull surface (with a rounded cap closing the tail) ===================
CAP_V, CAP_D = 0.7, 0.5


def skin(th, v):
    if v >= ZT:
        return hullPoint(min(v, ZN), th)
    k = min((ZT - v) / CAP_V, 1.0)
    a = k * math.pi / 2
    r, yc, c, s = hullR(ZT), hullYc(ZT), math.cos(th), math.sin(th)
    H = HULL['Hup'] if c > 0 else HULL['Hdn']
    sc = math.cos(a)
    return (HULL['W'] * r * s * sc, yc + H * r * c * sc, ZT - CAP_D * math.sin(a))


def skin_in(th, v):
    if v < ZT + 0.3:
        return (0, hullYc(ZT), ZT + 0.6)
    vc = min(v, ZN)
    return (0, hullYc(vc), min(vc, 9.0))


HULL_S = Surf(skin, skin_in)


def hull_inside(p):
    if p.z < ZT + 0.2:
        return (0, hullYc(ZT), ZT + 0.6)
    return (0, hullYc(min(p.z, ZN)), min(p.z, 9.0))


def hull_low():
    """outer skin (canopy faces removed) and the canopy glass from the same grid"""
    ths = [-math.pi + (math.pi - THG) * i / 24 for i in range(24)] + \
          [-THG + 2 * THG * i / 64 for i in range(64)] + \
          [THG + (math.pi - THG) * i / 24 for i in range(24)]
    NA, NB, NC = 84, 24, 5
    cols = []
    for th in ths:
        zb = canopyZ(th)
        vs = [ZT - CAP_V * (NC - k) / NC for k in range(1, NC)]
        aT, aB = arcOf(ZT), arcOf(zb)
        vs += [zOfArc(aT + (aB - aT) * j / NA) for j in range(NA + 1)]
        pb = math.asin(min((zb - 5) / (ZN - 5), 1.0))
        vs += [5 + (ZN - 5) * math.sin(pb + (math.pi / 2 - pb) * j / NB) for j in range(1, NB)]
        cols.append(vs)
    nr, nc = len(cols[0]), len(ths)
    rb = (NC - 1) + NA
    hull, glass = MB(), MB()
    grid = [[hull.vert(skin(ths[i], cols[i][j])) for i in range(nc)] for j in range(nr)]
    gmap = {}

    def gv(j, i):
        if (j, i) not in gmap:
            gmap[(j, i)] = glass.vert(hull.v[grid[j][i]])
        return gmap[(j, i)]

    tail = hull.vert(skin(0, ZT - CAP_V))
    nose = hull.vert(hullPoint(ZN, 0))
    gnose = glass.vert(hullPoint(ZN, 0))
    is_glass = lambda i: 24 <= i < 88
    for j in range(nr - 1):
        for i in range(nc):
            i1 = (i + 1) % nc
            q = (grid[j][i], grid[j + 1][i], grid[j + 1][i1], grid[j][i1])
            if j >= rb and is_glass(i):
                glass.face((gv(j, i), gv(j + 1, i), gv(j + 1, i1), gv(j, i1)))
            else:
                hull.face(q)
    for i in range(nc):
        i1 = (i + 1) % nc
        hull.face((tail, grid[0][i1], grid[0][i]))
        if is_glass(i):
            glass.face((gv(nr - 1, i), gnose, gv(nr - 1, i1)))
        else:
            hull.face((grid[nr - 1][i], nose, grid[nr - 1][i1]))
    return hull, glass


def cutters():
    """closed solids to cut the side door and the dome seat out of the skin"""
    door = MB()
    ol = door_outline(24)
    rows = [[V(x, y, z) for z, y in ol] for x in (2.2, 6.0)]
    ids = [[door.vert(p) for p in r] for r in rows]
    n = len(ol)
    for i in range(n):
        i1 = (i + 1) % n
        door.face((ids[0][i], ids[0][i1], ids[1][i1], ids[1][i]))
    door.face(ids[0][::-1])
    door.face(ids[1])
    dome = MB()
    lathe(dome, [(0, 9.0), (DOME['hole'], 9.0), (DOME['hole'], 12.5), (0, 12.5)], 48,
          basis(V(0, 0, DOME['z']), V(0, 1, 0), V(0, 0, 1)))
    return door, dome


def door_outline(nc=8):
    """(z, y) around the doorway, the concept's rounded rectangle: up the aft jamb, across the top, down the forward jamb"""
    D = DOORWAY
    r = D['r']
    ol = [(D['z0'], D['y0'])]
    for cz, a0 in ((D['z0'] + r, math.pi), (D['z1'] - r, math.pi / 2)):
        for k in range(nc + 1):
            a = a0 - k / nc * math.pi / 2
            ol.append((cz + r * math.cos(a), D['y1'] - r + r * math.sin(a)))
    ol.append((D['z1'], D['y0']))
    return ol


# =================== panel layout and plates on the hull ===================
NAME = dict(z0=6.95, z1=9.3, th=1.6)


def hull_panels(rng):
    a0, a1 = arcOf(ZT), arcOf(ZN)
    bounds, a = [ZT], a0
    while True:
        a += rng.uniform(1.9, 2.7)
        if a > a1 - 1.4:
            break
        z = zOfArc(a)
        if NAME['z0'] - 0.25 < z < NAME['z1'] + 0.25:   # keep the painted name on one panel
            z = NAME['z1'] + 0.3
            a = arcOf(z)
        bounds.append(z)
    bounds.append(ZN - 0.01)
    rings = [(ZT - CAP_V + 0.12, ZT)] + list(zip(bounds[:-1], bounds[1:]))
    panels, prev = [], []
    for k, (za, zb) in enumerate(rings):
        zm = min(max((za + zb) / 2, ZT), 12.2)
        tab = aroundTable(zm)
        s0 = aroundOfTh(tab, -math.pi)
        s1 = aroundOfTh(tab, math.pi)
        per = s1 - s0
        n = max(4, round(per / rng.uniform(1.8, 2.4)))
        off = rng.uniform(0, per / n)
        cuts = [s0 + off + per * (i + rng.uniform(-0.18, 0.18)) / n for i in range(n)]
        # no seam through the name
        if za <= NAME['z0'] and zb >= NAME['z1']:
            for side in (1, -1):
                lo, hi = sorted((aroundOfTh(tab, side * (NAME['th'] - 0.16)), aroundOfTh(tab, side * (NAME['th'] + 0.16))))
                cuts = [c if not (lo < c < hi) else (lo - 0.05 if c - lo < hi - c else hi + 0.05) for c in cuts]
        # seams where the canopy's side rims run, so no plate straddles the glass's edge
        if zb > canopyZ(THG):
            for side in (1, -1):
                c0 = aroundOfTh(tab, side * THG)
                cuts = [c for c in cuts if abs(c - c0) > 0.45] + [c0]
            n = len(cuts)
        cuts.sort()
        row = []
        for i in range(n):
            ca, cb = cuts[i], (cuts[i + 1] if i + 1 < n else cuts[0] + per)
            tha = thOfAround(tab, ((ca - s0) % per) + s0)
            thb = tha + (thOfAround(tab, ((cb - s0) % per) + s0) - tha) % (2 * math.pi)
            mid = (tha + thb) / 2
            below = [c for (t0, t1, c) in prev if t0 <= mid <= t1 or t0 <= mid + 2 * math.pi <= t1]
            left = [row[-1][2]] if row else []
            name, col = pick(rng, set(below + left))
            if za <= NAME['z0'] and zb >= NAME['z1'] and any(abs(math.remainder(mid - s * NAME['th'], 2 * math.pi)) < (thb - tha) / 2 for s in (1, -1)):
                name, col = 'cream', (0.8, 0.7, 0.52, 1.0)
            row.append((tha, thb, name))
            panels.append((tha, thb, za, zb, col))
        prev = row
    return panels


def straps():
    """raised brass rails over the plating: (th, z0, z1) along constant angles"""
    out = []
    for s in (1, -1):
        out.append((s * 0.98, -10.6, canopyZ(0.98) + 0.02))   # between the porthole rows
        out.append((s * 1.75, 3.15, canopyZ(THG) + 0.02))     # the canopy rim running aft, ending at the wing
        out.append((s * 0.32, -2.2, canopyZ(0.32) + 0.02))    # along the spine, from the dome forward
    return out


def strap(direct, th, z0, z1, w=0.12, h=0.075):
    """a half-round brass rail standing ~5 cm proud of the plates, riveted down its back"""
    pts, ups = [], []
    z = z0
    while z < z1:
        pts.append(onHull(z, th, -0.012))
        ups.append(hullNormal(z, th))
        z += 0.25
    if len(pts) < 2:
        return
    prof = [(px, py) for px, py in rrect_prof(w, h, 0.034, 2)]
    sweep(direct, pts, prof, ups, WHITE, M_BRASS)
    zz = z0 + 0.14
    while zz < z1 - 0.1:
        dome_rivet(direct, onHull(zz, th, h - 0.016), hullNormal(zz, th), 0.022, WHITE, M_BRASS, 6)
        zz += 0.24


def in_doorway(p, m=0.0):
    D = DOORWAY
    if p.x < 1.5 or not (D['z0'] - m < p.z < D['z1'] + m and D['y0'] - m < p.y < D['y1'] + m):
        return False
    cz, cy = min(max(p.z, D['z0'] + D['r']), D['z1'] - D['r']), D['y1'] - D['r']
    return p.y <= cy or math.hypot(p.z - cz, p.y - cy) < D['r'] + m


def in_dome(p):
    return p.y > 8.5 and p.x ** 2 + (p.z - DOME['z']) ** 2 < 2.62 ** 2


def hull_plates(rng):
    """real plates on the hull, kept off the canopy glass, the doorway and the dome's seat"""
    pl, rv = MB(), MB()
    hole = lambda p: in_doorway(p) or in_dome(p)

    def vlim(u):
        return (-1e9, canopyZ(u)) if abs(math.remainder(u, 2 * math.pi)) < THG - 1e-6 else (-1e9, 1e9)

    door_th = (thetaAt(DOORWAY['y1'], 0.8) - 0.1, thetaAt(DOORWAY['y0'], 0.8) + 0.1)
    for tha, thb, za, zb, col in hull_panels(rng):
        near_door = za < DOORWAY['z1'] + 0.3 and zb > DOORWAY['z0'] - 0.3 and \
            any(door_th[0] < math.remainder(t, 2 * math.pi) < door_th[1] for t in (tha, thb, (tha + thb) / 2)) or \
            (tha < door_th[0] and thb > door_th[1] and za < DOORWAY['z1'] + 0.3 and zb > DOORWAY['z0'] - 0.3)
        near_dome = za < DOME['z'] + 2.8 and zb > DOME['z'] - 2.8 and min(abs(math.remainder(t, 2 * math.pi)) for t in (tha, thb, (tha + thb) / 2)) < 0.75
        step = 0.1 if near_door or near_dome else (0.3 if za < 9 else 0.18)
        plate(pl, rv, HULL_S, tha, thb, za, zb, col, step=step, hole=hole, vlim=vlim)
    return pl, rv


# =================== wings ===================
def naca(x, t=1.0):
    x = min(max(x, 0.0), 1.0)
    return 5 * t * (0.2969 * math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4)


WING = dict(x0=4.45, span=6.1, y0=5.5, dy=0.55, le0=3.0, sweep=0.9, c0=6.4, dc=2.0, tr=0.13)


def wing_fn(s):
    def f(p, t):
        x = 0.5 * (1 + math.cos(2 * math.pi * p))
        tip = math.sqrt(max(1 - ((t - 0.78) / 0.22) ** 2, 0.0)) if t > 0.78 else 1.0
        c = WING['c0'] - WING['dc'] * t
        zmid = WING['le0'] - WING['sweep'] * t - c / 2
        chord = c * (0.2 + 0.8 * tip)
        half = WING['tr'] * c * (0.12 + 0.88 * tip) * (naca(x) + 0.03 * x)
        z = zmid + chord * (0.5 - x)
        y = WING['y0'] + WING['dy'] * t + 0.03 * c * math.sin(math.pi * x) * tip + (half if p < 0.5 else -half)
        return (s * (WING['x0'] + WING['span'] * t), y, z)

    def inside(p, t):
        c = WING['c0'] - WING['dc'] * t
        return (s * (WING['x0'] + WING['span'] * t), WING['y0'] + WING['dy'] * t, WING['le0'] - WING['sweep'] * t - c / 2)
    return Surf(f, inside)


def surf_low(S, nu, nv, ufn=lambda i, n: i / n, vfn=lambda j, n: j / n):
    """low mesh of a surface closed around u; the v = 1 end closes to a pole, v = 0 stays open (buried in the hull).
    Faces follow the surface normal; a UV seam runs along the first column"""
    mb = MB()
    ids = [[mb.vert(S.P(ufn(i, nu), vfn(j, nv))) for i in range(nu)] for j in range(nv)]
    pole = mb.vert(sum((S.P(ufn(i, nu), 1.0) for i in range(nu)), Vector()) / nu)

    def add(q, u, v):
        mb.face(q)
        n, _ = mb.normal(len(mb.f) - 1)
        if n.dot(S.N(u, v)) < 0:
            mb.f[-1] = mb.f[-1][::-1]

    for j in range(nv - 1):
        for i in range(nu):
            i1 = (i + 1) % nu
            add((ids[j][i], ids[j][i1], ids[j + 1][i1], ids[j + 1][i]), ufn(i + 0.5, nu), vfn(j + 0.5, nv))
        mb.seams.add((ids[j][0], ids[j + 1][0]))
    for i in range(nu):
        add((ids[-1][i], ids[-1][(i + 1) % nu], pole), ufn(i + 0.5, nu), (vfn(nv - 1, nv) + 1.0) / 2)
    mb.seams.add((ids[-1][0], pole))
    return mb


def wing_panels(rng):
    out = []
    ts = [0.0, rng.uniform(0.28, 0.36), rng.uniform(0.6, 0.68), 0.86, 0.985]
    xp = lambda xf: math.acos(2 * xf - 1) / (2 * math.pi)   # chord fraction -> perimeter (upper side)
    pa, pl = xp(0.72), xp(0.25)
    ps = [0.0, pa, pl, 1 - pl, 1 - pa, 1.0]
    for j in range(len(ts) - 1):
        last = None
        for i in range(len(ps) - 1):
            name, col = pick(rng, {last} if last else set())
            last = name
            out.append((ps[i], ps[i + 1], ts[j], ts[j + 1], col))
    return out


# =================== engine pods ===================
def pod_r(v):
    if v > 0.72:
        zf = (v - 0.72) / 0.28
        return math.sqrt(max(1 - zf * zf, 0.0))
    if v < 0.24:
        a = max(v, 0.0) / 0.24
        return 0.55 + 0.45 * math.sin(a * math.pi / 2)
    return 1.0


def pod_fn(s):
    px = s * POD['x']

    def f(th, v):
        r = POD['r'] * pod_r(v)
        return (px + r * math.sin(th), POD['y'] + r * math.cos(th), POD['z0'] + (POD['z1'] - POD['z0']) * v)

    def inside(th, v):
        return (px, POD['y'], POD['z0'] + (POD['z1'] - POD['z0']) * min(max(v, 0.15), 0.8))
    return Surf(f, inside)


def pod_panels(rng):
    out = []
    for v0, v1 in ((0.005, 0.2), (0.2, 0.46), (0.46, 0.72), (0.72, 0.993)):
        n = 4 if v1 < 0.9 else 6
        off = rng.uniform(0, 2 * math.pi / n)
        last = None
        for i in range(n):
            name, col = pick(rng, {last} if last else set())
            last = name
            out.append((off + 2 * math.pi * i / n, off + 2 * math.pi * (i + 1) / n, v0, v1, col))
    return out


# =================== tail fin and tail planes ===================
def hull_top(z):
    return hullYc(z) + HULL['Hup'] * hullR(z)


FIN = dict(le0=-7.2, le1=-12.35, te0=-12.15, te1=-13.75, top=13.35, tr=0.12)


def fin_fn():
    def sec(h):
        h = min(max(h, 0.0), 1.0)
        le = FIN['le0'] + (FIN['le1'] - FIN['le0']) * h ** 0.75
        te = FIN['te0'] + (FIN['te1'] - FIN['te0']) * h
        return le, te

    def f(p, h):
        x = 0.5 * (1 + math.cos(2 * math.pi * p))
        le, te = sec(h)
        c = le - te
        rnd = math.sqrt(max(1 - ((h - 0.72) / 0.28) ** 2, 0.0)) if h > 0.72 else 1.0
        mid = (le + te) / 2
        chord = c * (0.15 + 0.85 * rnd)
        z = mid + chord * (0.5 - x)
        half = FIN['tr'] * 4.6 * (1 - 0.55 * h) * (0.15 + 0.85 * rnd) * (naca(x) + 0.03 * x)
        y = (1 - h) * (hull_top(z) - 0.35) + h * FIN['top']
        return ((half if p < 0.5 else -half), y, z)

    def inside(p, h):
        le, te = sec(h)
        z = (le + te) / 2
        return (0, (1 - h) * (hull_top(z) - 0.35) + h * FIN['top'], z)
    return Surf(f, inside)


TP = dict(y=hullYc(-11.0) + 0.1, le0=-9.85, le1=-14.05, te0=-12.25, te1=-14.15, tip=3.95, tr=0.1)


def tailplane_fn(s):
    def f(p, t):
        t = min(max(t, 0.0), 1.0)
        x = 0.5 * (1 + math.cos(2 * math.pi * p))
        le = TP['le0'] + (TP['le1'] - TP['le0']) * t ** 1.15
        te = TP['te0'] + (TP['te1'] - TP['te0']) * t
        z = le + (te - le) * x
        c0 = TP['le0'] - TP['te0']
        half = TP['tr'] * c0 * (1 - 0.9 * t) * (naca(x) + 0.03 * x)
        root = halfWidthAt(TP['y'], z) - 0.3
        xx = root + (TP['tip'] - root) * t
        return (s * xx, TP['y'] + 0.25 * t + (half if p < 0.5 else -half), z)

    def inside(p, t):
        t = min(max(t, 0.0), 1.0)
        le = TP['le0'] + (TP['le1'] - TP['le0']) * t ** 1.15
        te = TP['te0'] + (TP['te1'] - TP['te0']) * t
        z = (le + te) / 2
        root = halfWidthAt(TP['y'], z) - 0.3
        return (s * (root + (TP['tip'] - root) * t), TP['y'] + 0.25 * t, z)
    return Surf(f, inside)


def fin_panels(rng, nh=(0.0, 0.34, 0.68, 0.97)):
    out = []
    xp = lambda xf: math.acos(2 * xf - 1) / (2 * math.pi)
    pl = xp(0.22)
    ps = [0.0, pl, 1 - pl, 1.0]
    for j in range(len(nh) - 1):
        last = None
        for i in range(3):
            name, col = pick(rng, {last} if last else set())
            last = name
            out.append((ps[i], ps[i + 1], nh[j], nh[j + 1], col))
    return out


# =================== trim, glass frames, portholes, lights ===================
def canopy_path(step=0.12):
    """the canopy's edge on the hull: up the starboard side line, along the parabola, down the port side line"""
    pts = []
    z = ZN - 0.03
    while z > canopyZ(THG):
        pts.append((z, -THG))
        z -= step
    n = 60
    for k in range(n + 1):
        th = -THG + 2 * THG * k / n
        pts.append((canopyZ(th), th))
    z = canopyZ(THG) + step
    while z < ZN - 0.03:
        pts.append((z, THG))
        z += step
    return pts


def canopy_trim(direct, rv):
    """the glass frame as in the art: a heavy rim, arches parallel to the canopy's edge that land on the rim,
    bars running forward that end on an arch, and a brass boss at the nose where the last ones meet"""
    path = canopy_path()
    pts = [onHull(z, th, -0.012) for z, th in path]
    ups = [hullNormal(z, th) for z, th in path]
    sweep(direct, pts, rrect_prof(0.26, 0.095, 0.035, 3), ups, WHITE, M_BRASS)
    for i in range(0, len(path), 2):
        z, th = path[i]
        dome_rivet(direct, onHull(z, th, 0.08), hullNormal(z, th), 0.022, WHITE, M_BRASS, 6)
    bar = rrect_prof(0.1, 0.075, 0.03, 2)
    zs = lambda s, th: canopyZ(th) + s * (ZN - canopyZ(th))       # s: 0 on the edge, 1 at the nose
    ARCH = (0.3, 0.55, 0.78)

    def run(samples):
        ps = [onHull(z, th, -0.008) for z, th in samples]
        us = [hullNormal(z, th) for z, th in samples]
        sweep(direct, ps, bar, us, WHITE, M_BRASS)

    for s in ARCH:   # arches: from the rim on one side, over the top, to the rim on the other
        run([(zs(s, th), th) for th in [-THG + 2 * THG * k / 60 for k in range(61)]])
    for th in (-1.2, -0.6, 0.0, 0.6, 1.2):   # bars from the edge forward to the last arch
        n = 24
        run([(zs(ARCH[-1] * k / n, th), th) for k in range(n + 1)])
    for th in (-0.9, 0.0, 0.9):              # three carry on to the nose
        n = 14
        run([(zs(ARCH[-1] + (0.985 - ARCH[-1]) * k / n, th), th) for k in range(n + 1)])
    tip = V(*hullPoint(ZN, 0))
    lathe(direct, [(0.3, -0.05), (0.31, 0.03), (0.25, 0.1), (0.12, 0.15), (0, 0.16)], 24,
          basis(tip - V(0, 0, 0.06), V(0, 0, 1)), WHITE, M_BRASS)
    # lip: from the skin down to the inner shell along the edge, so the opening has a thickness
    lip = MB()
    rows = [[V(*hullPoint(z, th)) for z, th in path], [V(*hullPoint(z, th, HULL['thick'])) for z, th in path]]
    lip.rows(rows)
    lip.orient(lambda c: V(0, 7.0, max(c.z + 1.5, 11.0)) - c)
    direct.extend(_recolor(lip, M_PEARL))


def _recolor(mb, mat):
    mb.fm = [mat] * len(mb.f)
    mb.fc = [WHITE] * len(mb.f)
    return mb


PORTS = [(z, 0.66, 0.36) for z in (3.4, 1.0, -1.4, -3.8, -6.2)] + [(z, 1.26, 0.42) for z in (5.6, 3.6, 1.6, -0.4, -2.4, -4.4, -6.6)]


def portholes(direct, warm):
    for s in (1, -1):
        for z, th, R in PORTS:
            ring(direct, warm, z, s * th, R)


def ring(direct, glow, z, th, R, deep=0.08, bolts=8, hood=False):
    p, n = V(*hullPoint(z, th)), hullNormal(z, th)
    M = basis(p, n, V(0, 0, 1))
    prof = [(R + 0.13, -0.04), (R + 0.13, 0.0), (R + 0.115, deep - 0.025), (R + 0.075, deep + 0.005),
            (R + 0.005, deep), (R - 0.015, deep - 0.03), (R - 0.015, -0.03)]
    lathe(direct, prof, 36, M, WHITE, M_BRASS)
    for k in range(bolts):
        a = 2 * math.pi * (k + 0.5) / bolts
        q = M @ V((R + 0.055) * math.cos(a), (R + 0.055) * math.sin(a), deep + 0.004)
        dome_rivet(direct, q, n, 0.022, WHITE, M_BRASS, 6)
    # glass, set back in the ring (above the raised plates)
    lathe(glow, [(R - 0.01, 0.034), (0, 0.034)], 36, M, WHITE, 0)
    if hood:
        lathe(direct, [(R + 0.12, 0.0), (R + 0.16, 0.12), (R + 0.1, 0.28), (R - 0.05, 0.3)], 24, M, WHITE, M_BRASS,
              a0=math.radians(20), a1=math.radians(160))


def lights(direct, cool):
    """light strips set into a bronze channel (lips proud of the plates), a flat glowing insert, capped ends"""
    chan = [(-0.08, -0.012), (0.08, -0.012), (0.08, 0.042), (0.06, 0.058), (0.036, 0.054), (0.033, 0.03),
            (-0.033, 0.03), (-0.036, 0.054), (-0.06, 0.058), (-0.08, 0.042)]
    insert = rrect_prof(0.064, 0.016, 0.006, 1)
    for s in (1, -1):
        segs, cur = [], []
        z = 11.4
        while z > -10.4:
            if s > 0 and -0.55 < z < 2.15:
                if cur:
                    segs.append(cur)
                cur = []
            else:
                cur.append((z, s * (1.95 + (z - 9) * 0.32 if z > 9 else 1.95)))
            z -= 0.2
        if cur:
            segs.append(cur)
        for seg in segs:
            if len(seg) < 2:
                continue
            ups = [hullNormal(z, th) for z, th in seg]
            sweep(direct, [onHull(z, th, 0.0) for z, th in seg], chan, ups, WHITE, M_BRONZE)
            ins = [onHull(z, th, 0.026) for z, th in seg[1:-1]]
            if len(ins) > 1:
                sweep(cool, ins, insert, ups[1:-1], WHITE, 0)
            for z, th in (seg[0], seg[-1]):   # round end caps
                p, n = onHull(z, th, 0.0), hullNormal(z, th)
                lathe(direct, [(0.085, -0.012), (0.085, 0.04), (0.06, 0.062), (0, 0.066)], 12, basis(p, n), WHITE, M_BRONZE)
        # the whisker: a pearl bar with a knob, on two little stand-offs
        w0, w1 = onHull(9.8, s * 1.83, 0.12), onHull(8.3, s * 1.83, 0.12)
        cyl(direct, w1, w0, 0.07, 0.08, 14, WHITE, M_PEARL, bevel=0.03)
        lathe(direct, [(0, -0.16), (0.11, -0.13), (0.16, 0.0), (0.11, 0.13), (0, 0.16)], 16,
              basis(w0, w0 - w1), WHITE, M_PEARL)
        for z in (8.6, 9.5):
            a, b = onHull(z, s * 1.83, -0.02), onHull(z, s * 1.83, 0.1)
            cyl(direct, a, b, 0.04, 0.035, 8, WHITE, M_DARK)


# =================== dome ===================
def dome(direct, glass):
    zc, R = DOME['z'], DOME['r']

    def hull_y(a, r):
        x, z = math.cos(a) * r, zc + math.sin(a) * r
        w = HULL['W'] * hullR(z)
        if abs(x) >= w:
            return 0.0
        return hullYc(z) + HULL['Hup'] * hullR(z) * math.sqrt(1 - (x / w) ** 2)

    n = 64
    tops = [max(hull_y(2 * math.pi * k / n, R + 0.2), DOME['base']) + 0.1 for k in range(n)]
    # collar: a short drum seated in the skin, its rim rising where the hull is higher (the front)
    rows = []
    for y_of, r in ((lambda k: 9.0, R + 0.1), (lambda k: tops[k] - 0.06, R + 0.1), (lambda k: tops[k] + 0.02, R + 0.16),
                    (lambda k: tops[k] + 0.08, R + 0.1), (lambda k: tops[k] + 0.08, R - 0.1)):
        rows.append([V(math.cos(2 * math.pi * k / n) * r, y_of(k), zc + math.sin(2 * math.pi * k / n) * r) for k in range(n)])
    direct.rows(rows, WHITE, M_BRONZE, wrap=True, flip=True)
    for k in range(0, n, 2):
        a = 2 * math.pi * (k + 0.5) / n
        p = V(math.cos(a) * (R + 0.11), tops[k] - 0.25, zc + math.sin(a) * (R + 0.11))
        dome_rivet(direct, p, V(math.cos(a), 0, math.sin(a)), 0.02, WHITE, M_BRONZE, 6)
    # glass: a hemisphere from the collar's height up
    base = DOME['base']
    gr = []
    for e in range(15):
        el = e / 14 * math.pi / 2
        gr.append([V(math.cos(2 * math.pi * k / n) * R * math.cos(el), base + math.sin(el) * R * DOME['hScale'],
                     zc + math.sin(2 * math.pi * k / n) * R * math.cos(el)) for k in range(n)])
    gid = glass.rows(gr[:-1], wrap=True, flip=True)
    gp = glass.vert(V(0, base + R * DOME['hScale'], zc))
    for k in range(n):
        glass.face((gid[-1][(k + 1) % n], gid[-1][k], gp))
    # frame: meridians, parallels, a brass crown and the finial
    prof = rrect_prof(0.07, 0.05, 0.02, 2)
    for k in range(12):
        a = 2 * math.pi * k / 12
        ps, us = [], []
        for e in range(1, 23):
            el = e / 22 * (math.pi / 2 - 0.12)
            d = V(math.cos(a) * math.cos(el), math.sin(el) * DOME['hScale'], math.sin(a) * math.cos(el)).normalized()
            ps.append(V(math.cos(a) * R * math.cos(el), base + math.sin(el) * R * DOME['hScale'], zc + math.sin(a) * R * math.cos(el)) - d * 0.01)
            us.append(d)
        sweep(direct, ps, prof, us, WHITE, M_BRASS)
    for el in (0.42, 0.85, 1.2):
        ps, us = [], []
        for k in range(48):
            a = 2 * math.pi * k / 48
            d = V(math.cos(a) * math.cos(el), math.sin(el) * DOME['hScale'], math.sin(a) * math.cos(el)).normalized()
            ps.append(V(math.cos(a) * R * math.cos(el), base + math.sin(el) * R * DOME['hScale'], zc + math.sin(a) * R * math.cos(el)) - d * 0.01)
            us.append(d)
        sweep(direct, ps, prof, us, WHITE, M_BRASS, closed=True)
    top = base + R * DOME['hScale']
    lathe(direct, [(0, top - 0.12), (0.42, top - 0.06), (0.4, top + 0.02), (0.22, top + 0.08), (0.12, top + 0.2),
                   (0.06, top + 0.55), (0.05, top + 0.85), (0.11, top + 0.9), (0.12, top + 1.0), (0.07, top + 1.08), (0, top + 1.1)],
          16, basis(V(0, 0, zc), V(0, 1, 0), V(0, 0, 1)), WHITE, M_BRASS)


# =================== door: frame, jamb, sill ===================
def door(direct):
    """riveted brass frame round the doorway and the hull's thickness (jamb); the ramp-door seals it"""
    ol = door_outline(8)
    D = DOORWAY
    cz, cy = (D['z0'] + D['z1']) / 2, (D['y0'] + D['y1']) / 2
    pts, ups = [], []
    for i, (z, y) in enumerate(ol):
        za, ya = ol[max(i - 1, 0)]
        zb, yb = ol[min(i + 1, len(ol) - 1)]
        tz, ty = zb - za, yb - ya
        nz, ny = -ty, tz
        if nz * (z - cz) + ny * (y - cy) < 0:
            nz, ny = -nz, -ny
        L = math.hypot(nz, ny) or 1.0
        z2, y2 = z + nz / L * 0.1, y + ny / L * 0.1
        th = thetaAt(y2, z2)
        pts.append(onHull(z2, th, -0.012))
        ups.append(hullNormal(z2, th))
    pts[0] = pts[0] - V(0, 0.06, 0)
    pts[-1] = pts[-1] - V(0, 0.06, 0)
    sweep(direct, pts, rrect_prof(0.22, 0.085, 0.03, 2), ups, WHITE, M_BRASS)
    for i in range(1, len(pts) - 1):
        dome_rivet(direct, pts[i] + ups[i] * 0.085, ups[i], 0.022, WHITE, M_BRASS, 6)
    jamb = MB()
    rows = [[V(halfWidthAt(y, z) + 0.01, y, z) for z, y in ol], [V(halfWidthAt(y, z, HULL['thick']) - 0.01, y, z) for z, y in ol]]
    jamb.rows(rows)
    jamb.orient(lambda c: V(0, cy - c.y, cz - c.z))
    direct.extend(_recolor(jamb, M_PEARL))


# =================== wings' fittings, pods, thruster ===================
def pod_fittings(direct, cool):
    for s in (1, -1):
        px, py, R = s * POD['x'], POD['y'], POD['r']
        z0, z1 = POD['z0'], POD['z1']
        zv = lambda v: z0 + (z1 - z0) * v
        ax = basis(V(px, py, 0), V(0, 0, 1), V(0, 1, 0))
        # brass bands at the panel breaks
        for v in (0.2, 0.72):
            r = R * pod_r(v)
            lathe(direct, [(r - 0.02, zv(v) - 0.11), (r + 0.035, zv(v) - 0.09), (r + 0.05, zv(v)), (r + 0.035, zv(v) + 0.09), (r - 0.02, zv(v) + 0.11)],
                  40, ax, WHITE, M_BRASS)
        # nozzle: a dark throat, a glowing ring, a bullet in the middle
        r0 = R * 0.55
        lathe(direct, [(0.35, z0 + 0.45), (r0 - 0.12, z0 + 0.35), (r0 - 0.04, z0 - 0.05), (r0 + 0.06, z0 - 0.02), (r0 + 0.02, z0 + 0.05)],
              36, ax, WHITE, M_DARK)
        lathe(cool, [(0.36, z0 + 0.4), (r0 - 0.1, z0 + 0.3)], 36, ax, WHITE, 0)
        lathe(direct, [(0, z0 - 0.25), (0.12, z0 - 0.2), (0.3, z0 + 0.05), (0.34, z0 + 0.45)], 20, ax, WHITE, M_PEARL)
        # a brass boss on the nose
        lathe(direct, [(0.3, z1 - 0.06), (0.26, z1 + 0.02), (0.14, z1 + 0.08), (0, z1 + 0.1)], 20, ax, WHITE, M_BRASS)
        # hover emitter underneath
        bm = basis(V(px, py - R + 0.02, (z0 + z1) / 2), V(0, -1, 0), V(0, 0, 1))
        lathe(direct, [(0.75, -0.03), (0.72, 0.04), (0.62, 0.06), (0.62, 0.02)], 32, bm, WHITE, M_BRASS)
        lathe(cool, [(0.6, 0.025), (0.3, 0.025)], 32, bm, WHITE, 0)
        lathe(direct, [(0.3, 0.02), (0.28, 0.0), (0, 0.0)], 32, bm, WHITE, M_DARK)
        # pylon up into the wing
        t = (POD['x'] - WING['x0']) / WING['span']
        yw = WING['y0'] + WING['dy'] * t
        foil = []
        for k in range(24):
            q = k / 24
            x = 0.5 * (1 + math.cos(2 * math.pi * q))
            foil.append(((1 if q < 0.5 else -1) * 0.5 * (naca(x, 0.17) + 0.02 * x) * 2.0, 2.0 * (0.5 - x)))
        y0, y1 = py + R * 0.6, yw + 0.05
        sweep(direct, [V(px, y0, -1.75), V(px, y1, -1.55)], foil, [V(0, 0, 1)] * 2, WHITE, M_DARK)
    # wing-root fairings where the wings meet the hull
    for s in (1, -1):
        pts, ups = [], []
        for k in range(25):
            p = k / 24
            q = V(*wing_fn(s).fn(p, 0.035))
            pts.append(q)
            ups.append(V(*wing_fn(s).fn(p, 0.035)) - V(*wing_fn(s).inside(p, 0.035)))
        sweep(direct, pts, rrect_prof(0.16, 0.05, 0.02, 1), ups, WHITE, M_BRASS, closed=True)


def thruster(direct, cool):
    yc, z = hullYc(ZT), ZT - CAP_D
    ax = basis(V(0, yc, 0), V(0, 0, -1), V(0, 1, 0))
    d = lambda zz: -zz   # local h along -z
    lathe(direct, [(1.22, d(z + 0.45)), (1.3, d(z + 0.1)), (1.38, d(z - 0.12)), (1.32, d(z - 0.3)), (1.18, d(z - 0.34)),
                   (1.1, d(z - 0.22))], 48, ax, WHITE, M_BRASS)
    lathe(direct, [(1.1, d(z - 0.22)), (1.02, d(z - 0.12)), (0.98, d(z - 0.2)), (0.86, d(z - 0.14)), (0.82, d(z + 0.05))],
          48, ax, WHITE, M_DARK)
    lathe(direct, [(0.84, d(z + 0.02)), (0.8, d(z - 0.06)), (0.74, d(z - 0.04))], 48, ax, WHITE, M_PEARL)
    lathe(cool, [(0.74, d(z - 0.03)), (0.0, d(z + 0.08))], 48, ax, WHITE, 0)
    for k in range(8):
        a = 2 * math.pi * k / 8
        p = ax @ V(1.22 * math.cos(a), 1.22 * math.sin(a), d(z - 0.3))
        dome_rivet(direct, p, V(0, 0, -1), 0.035, WHITE, M_BRASS, 6)


# =================== belly block, top hatch, moss ===================
def belly(direct):
    M = basis(V(0, 1.62, 2.6), V(0, 0, 1))
    rbox(direct, M, 1.6, 0.55, 2.4, 0.12, WHITE, M_DARK)
    for k in range(6):
        z = 1.75 + k * 0.32
        for s in (1, -1):
            rbox(direct, basis(V(s * 0.79, 1.6, z), V(0, 0, 1)), 0.04, 0.28, 0.12, 0.015, WHITE, M_DARK)
    lathe(direct, [(0.28, 0.0), (0.26, 0.05), (0.18, 0.07), (0, 0.07)], 20, basis(V(0, 1.34, 3.4), V(0, -1, 0)), WHITE, M_BRASS)


def hatch(direct):
    z, y = -1.1, hull_top(-1.1)
    M = basis(V(0, y - 0.03, z), V(0, 0, 1), V(0, 1, 0))
    rbox(direct, basis(V(0, y + 0.0, z), V(0, 0, 1)), 1.2, 0.1, 1.45, 0.04, WHITE, M_BRONZE)
    rbox(direct, basis(V(0, y + 0.07, z + 0.02), V(0, 0, 1)), 1.0, 0.07, 1.25, 0.03, WHITE, M_DARK)
    for s in (1, -1):
        cyl(direct, V(s * 0.25 - 0.12, y + 0.08, z - 0.66), V(s * 0.25 + 0.12, y + 0.08, z - 0.66), 0.05, 0.05, 10, WHITE, M_BRASS, bevel=0.01)
    hp = [V(-0.18, y + 0.1, z + 0.45), V(-0.15, y + 0.2, z + 0.48), V(0.15, y + 0.2, z + 0.48), V(0.18, y + 0.1, z + 0.45)]
    sweep(direct, hp, circle_prof(0.022, 6), [V(0, 0, 1)] * 4, WHITE, M_BRASS)
    del M


def moss(direct, rng):
    """tufts gathered along the up-facing seams and caught on the brass rails, as in the art"""
    def tuft(p, n, r, along):
        M = basis(p, n, along)
        rows = []
        for e in range(4):
            el = e / 3 * math.pi / 2
            row = []
            for i in range(7):
                a = 2 * math.pi * i / 7
                j = 1 + 0.2 * math.sin(a * 3 + p.x * 9 + p.z * 5)
                row.append(M @ V(r * j * math.cos(el) * math.cos(a), r * j * math.cos(el) * math.sin(a), r * 0.55 * math.sin(el) - r * 0.15))
            rows.append(row)
        direct.rows(rows, WHITE, M_MOSS, wrap=True, flip=True)

    def cluster(pt, nfn, length, k):
        for _ in range(k):
            t = rng.uniform(-0.5, 0.5) * length
            p, n, along = pt(t)
            side = n.cross(along).normalized()
            tuft(p + side * rng.gauss(0, 0.05) + n * 0.02, n, rng.uniform(0.035, 0.1), along)

    for _ in range(24):   # along ring seams on the top of the hull
        z, th0 = rng.uniform(-8.5, 6.3), rng.gauss(0, 0.38)
        if (DOME['z'] - 2.9 < z < DOME['z'] + 2.9 and abs(th0) < 0.7) or (-1.9 < z < -0.3 and abs(th0) < 0.2) or abs(th0) > 0.62:
            continue
        def pt(t, z=z, th0=th0):
            th = th0 + t / 4.4
            return V(*hullPoint(z, th)) + hullNormal(z, th) * 0.02, hullNormal(z, th), V(0, 0, 1)
        cluster(pt, None, rng.uniform(0.4, 1.1), rng.randint(5, 11))
    for s in (1, -1):     # caught along the top of the brass rails
        for _ in range(4):
            th, z0 = s * rng.choice((0.98, 0.32)), rng.uniform(-6.5, 5.5)
            if th * s < 0.5 and z0 < -2.0:
                continue
            def pt(t, th=th, z0=z0):
                z = z0 + t
                n = hullNormal(z, th)
                up = (n - n.dot(V(0, 0, 1)) * V(0, 0, 1)).normalized()
                return onHull(z, th, 0.07) + up.cross(V(0, 0, 1)).normalized() * 0.0, n, V(0, 0, 1)
            cluster(pt, None, rng.uniform(0.4, 0.9), rng.randint(5, 9))
    for s in (1, -1):     # a few on the wings' upper face near the root
        S = wing_fn(s)
        for _ in range(3):
            p0, t0 = rng.uniform(0.18, 0.4), rng.uniform(0.05, 0.4)
            def pt(t, S=S, p0=p0, t0=t0):
                pp = p0 + t * 0.03
                return V(*S.fn(pp, t0)) + S.N(pp, t0) * 0.02, S.N(pp, t0), V(1, 0, 0)
            cluster(pt, None, rng.uniform(0.5, 1.0), rng.randint(4, 8))


# =================== legs and ramp (their own nodes, pivots at the hip / hinge) ===================
def leg(fx, fz, cool):
    mb = MB()
    s = 1 if fx > 0 else -1
    hip = V(fx * 0.62, 2.2 + (0.25 if fz < 0 else 0.0), fz)
    knee = V(fx * 0.95, 1.35, fz + (0.5 if fz > 0 else -0.5))
    ank = V(fx, 0.95, fz)
    axis = (knee - hip).cross(ank - knee).normalized()
    rbox(mb, basis(hip + V(0, 0.28, 0), V(0, 0, 1)), 0.9, 0.62, 1.0, 0.1, WHITE, M_DARK)
    cyl(mb, hip - axis * 0.36, hip + axis * 0.36, 0.3, 0.3, 20, WHITE, M_DARK, bevel=0.05)
    cyl(mb, hip - axis * 0.4, hip + axis * 0.4, 0.12, 0.12, 12, WHITE, M_CHROME, bevel=0.02)
    for a, b, w in ((hip, knee, 0.44), (knee, ank, 0.36)):
        d = (b - a)
        rbox(mb, basis((a + b) / 2, d, axis), w, w * 0.9, d.length + w * 0.4, 0.09, WHITE, M_PEARL)
    cyl(mb, knee - axis * 0.32, knee + axis * 0.32, 0.27, 0.27, 20, WHITE, M_DARK, bevel=0.05)
    cyl(mb, knee - axis * 0.36, knee + axis * 0.36, 0.1, 0.1, 12, WHITE, M_CHROME, bevel=0.02)
    # hydraulic ram on the outboard side
    out = V(s, 0, 0)
    a = hip + (knee - hip) * 0.3 + out * 0.28
    b = knee + (ank - knee) * 0.55 + out * 0.24
    m = a + (b - a) * 0.55
    cyl(mb, a, m, 0.075, 0.075, 12, WHITE, M_DARK, bevel=0.02)
    cyl(mb, m - (b - a).normalized() * 0.05, b, 0.042, 0.042, 10, WHITE, M_CHROME)
    for p in (a, b):
        lathe(mb, [(0, -0.09), (0.07, -0.07), (0.09, 0), (0.07, 0.07), (0, 0.09)], 10, basis(p, axis), WHITE, M_DARK)
    # ankle and hover pad
    lathe(mb, [(0, -0.24), (0.15, -0.2), (0.22, 0), (0.15, 0.2), (0, 0.24)], 14, basis(ank, V(0, 1, 0)), WHITE, M_DARK)
    pad = basis(V(fx, 0, fz), V(0, 1, 0), V(0, 0, 1))
    lathe(mb, [(0.0, 0.2), (0.46, 0.2), (0.48, 0.24), (0.76, 0.24), (0.79, 0.2), (0.88, 0.21), (0.96, 0.3), (0.98, 0.42), (0.92, 0.5),
               (0.62, 0.56), (0.55, 0.66), (0.4, 0.74), (0.2, 0.8), (0.0, 0.81)], 32, pad, WHITE, M_BRONZE)
    for k in range(10):
        q = pad @ V(0.86 * math.cos(2 * math.pi * k / 10), 0.86 * math.sin(2 * math.pi * k / 10), 0.47)
        dome_rivet(mb, q, (q - pad @ V(0, 0, 0.3)).normalized(), 0.025, WHITE, M_BRASS, 6)
    glow = MB()
    lathe(glow, [(0.5, 0.215), (0.75, 0.215)], 32, pad, WHITE, 0)
    del cool
    return mb, glow, hip


RAMPDOOR = dict(LB=2.6, foot_w=1.5, slack=0.018)


def ramp_hinge():
    """the sill hinge sits on the inner shell; the door's walking face, closed, is the chord of the inner shell"""
    D = DOORWAY
    hz = (D['z0'] + D['z1']) / 2
    H = V(halfWidthAt(D['y0'], hz, HULL['thick']), D['y0'], hz)
    T = V(halfWidthAt(D['y1'] - 0.02, hz, HULL['thick']), D['y1'] - 0.02, hz)
    th_c = math.atan2(T.y - H.y, T.x - H.x)
    return H, th_c, (T - H).length


def ramp():
    """the boarding ramp is the door (a drawbridge, as in the films): section A is hinged on the sill and, closed,
    is exactly the patch of hull cut out for the doorway; the foot section B is hinged to A's end and folds back
    onto A's planks. Built flat (rest pose: A level, out of the door along +x); the animation tilts and folds it.
    Returns (A mesh, B mesh, sill hinge, knee hinge, closed angle, deployed angle)"""
    D = DOORWAY
    H, th_c, _ = ramp_hinge()
    sl = RAMPDOOR['slack']
    c, sn = math.cos(th_c), math.sin(th_c)
    dirv, nO = V(c, sn, 0), V(sn, -c, 0)
    up_c = V(-sn, c, 0)   # the walking face's normal when closed

    def rest(p):   # closed-pose point -> the flat rest frame
        d = p - H
        return H + V(d.dot(dirv), -d.dot(nO), d.z)

    def rvec(v):
        return V(v.dot(dirv), v.dot(up_c), v.z)

    def span(y):   # the doorway's width at height y (rounded top corners), less the slack
        r = D['r']
        dz = 0.0
        if y > D['y1'] - r:
            dy = min(y - (D['y1'] - r), r)
            dz = r - math.sqrt(max(r * r - dy * dy, 0.0))
        return D['z0'] + dz + sl, D['z1'] - dz - sl

    NY, NW = 26, 12
    ys = [D['y0'] + (D['y1'] - sl - D['y0']) * math.sin(k / NY * math.pi / 2) for k in range(NY + 1)]
    hull_pt = lambda y, z: V(halfWidthAt(y, z), y, z)
    outer = [[hull_pt(y, span(y)[0] + (span(y)[1] - span(y)[0]) * j / NW) for j in range(NW + 1)] for y in ys]
    A = MB()
    f0 = len(A.f)
    A.rows([[rest(p) for p in r] for r in outer], (*PAINT['teal'], 1.0), 8)
    A.orient(lambda q: V(0, -1, 0), f0)
    # walking face: the same grid projected onto the slab, the sill row brought back to the hinge
    deck = [[V(rest(p).x if k > 0 else H.x, H.y - 0.06, rest(p).z) for p in r] for k, r in enumerate(outer)]
    f0 = len(A.f)
    A.rows(deck, WHITE, M_DARK)
    A.orient(lambda q: V(0, 1, 0), f0)
    loop = lambda g: [r[0] for r in g] + g[-1][1:] + [r[-1] for r in g[::-1]][1:] + g[0][-2:0:-1]
    rim = MB()
    rim.rows([[rest(p) for p in loop(outer)], loop(deck)], WHITE, M_DARK, wrap=True)
    LA = max(rest(p).x for p in outer[-1]) - H.x
    rim.orient(lambda q: V(q.x - (H.x + LA / 2), 0, q.z - H.z))
    A.extend(rim)

    def width_at(s):   # deck half-width at distance s along the slab
        best = None
        for r in deck:
            if r[0].x - H.x >= s:
                best = r
                break
        best = best or deck[-1]
        return (best[-1].z - best[0].z) / 2
    s_, k = 0.14, 0
    while s_ < LA - 0.12:
        w = width_at(s_ + 0.09) - 0.06
        if w > 0.2:
            rbox(A, basis(H + V(s_ + 0.09, -0.03, 0), V(0, 0, 1)), 0.17, 0.06, 2 * w, 0.012, (1.0 - 0.08 * ((k * 37) % 3), 1, 1, 1), M_WOOD)
        s_ += 0.22
        k += 1
    # outer face (the hull, when closed): a brass edge band and two riveted bars
    for frac in (0.36, 0.7):
        y = D['y0'] + (D['y1'] - D['y0']) * frac
        z0, z1 = span(y)
        pts = [hull_pt(y, z0 + 0.05 + (z1 - z0 - 0.1) * j / 16) for j in range(17)]
        nrm = [hullNormal(p.z, thetaAt(p.y, p.z)) for p in pts]
        sweep(A, [rest(p - n * 0.01) for p, n in zip(pts, nrm)], rrect_prof(0.1, 0.05, 0.02, 2), [rvec(n) for n in nrm], WHITE, M_BRASS)
        for p, n in list(zip(pts, nrm))[1:-1:2]:
            dome_rivet(A, rest(p + n * 0.04), rvec(n), 0.022, WHITE, M_BRASS, 6)
    ol = [p for p in loop([[hull_pt(y, span(y)[0] + 0.05), hull_pt(y, span(y)[1] - 0.05)] for y in ys[:-1]])]
    eb = [(p, hullNormal(p.z, thetaAt(p.y, p.z))) for p in ol]
    sweep(A, [rest(p - n * 0.008) for p, n in eb], rrect_prof(0.08, 0.04, 0.015, 2), [rvec(n) for p, n in eb], WHITE, M_BRASS, closed=True)
    # hinge barrels: the sill and the knee
    hw0 = (D['z1'] - D['z0']) / 2 - sl
    cyl(A, H + V(0, -0.02, -hw0 + 0.05), H + V(0, -0.02, hw0 - 0.05), 0.08, 0.08, 16, WHITE, M_DARK, bevel=0.015)
    K = H + V(LA - 0.02, 0.06, 0)
    for z0, z1 in ((-0.72, -0.3), (0.3, 0.72)):
        cyl(A, K + V(0, 0, z0), K + V(0, 0, z1), 0.065, 0.065, 14, WHITE, M_DARK, bevel=0.012)

    # foot section B, hinged at K; planks flush with A's when deployed
    B = MB()
    LB, wb = RAMPDOOR['LB'], RAMPDOOR['foot_w'] / 2
    o = lambda x, y, z: K + V(x, y - 0.06, z)
    rbox(B, basis(o(LB / 2, -0.09, 0), V(0, 0, 1)), LB, 0.06, 2 * wb - 0.1, 0.02, WHITE, M_DARK)
    for sz in (-wb + 0.05, wb - 0.05):
        rbox(B, basis(o(LB / 2, -0.06, sz), V(1, 0, 0)), 0.1, 0.16, LB, 0.03, WHITE, M_PEARL)
    x, k = 0.16, 0
    while x < LB - 0.12:
        rbox(B, basis(o(x, -0.03, 0), V(0, 0, 1)), 0.17, 0.06, 2 * wb - 0.2, 0.012, (1.0 - 0.08 * ((k * 53) % 3), 1, 1, 1), M_WOOD)
        x += 0.22
        k += 1
    cyl(B, K + V(0, 0, -0.28), K + V(0, 0, 0.28), 0.065, 0.065, 14, WHITE, M_DARK, bevel=0.012)
    rbox(B, basis(o(LB + 0.06, -0.1, 0), V(0, 0, 1)), 0.2, 0.05, 2 * wb - 0.06, 0.02, WHITE, M_DARK)
    th_d = -math.asin(min(DECK['lower'] / (LA + LB), 0.95))
    return A, B, H, K, th_c, th_d
