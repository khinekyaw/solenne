# =========================================================================
# The Wren's analytic shape, ported 1:1 from src/ship/wrenShape.ts so the
# Blender skin is exactly the surface the game walks, collides and cuts
# openings against. Keep the two in sync (the game checks the constants
# exported in the GLB's extras and warns when they differ).
# Game ship-local metres: x = port, y = up from the ground, z = toward the nose.
# =========================================================================
import math
from mathutils import Vector

HULL = dict(zNose=12.6, zTail=-12.2, W=4.6, Hup=5.0, Hdn=4.0, yc=5.6, tailRise=1.2, thick=0.22)
GLASS = dict(z0=6.6, k=3.5, th=1.75)
DOOR = dict(z0=-0.1, z1=1.7, y0=2.5, yArc=4.0)
DOME = dict(z=-5.0, r=2.6, base=10.3, hScale=0.85, hole=2.45, floor=10.0)
DECK = dict(lower=2.5, upper=5.6, slab=0.25, wallTop=8.8)
RAMP = dict(x0=2.95, len=5.4, z0=-0.05, z1=1.65)
# the Blender model's doorway is the concept's rounded rectangle, sealed by the folding ramp-door
# (the game's is a round arch: update doorTop() in wrenShape.ts when this model goes in)
DOORWAY = dict(z0=-0.1, z1=1.7, y0=2.5, y1=4.9, r=0.32)
LEGS = [(3.4, 5.6), (-3.4, 5.6), (3.6, -5.0), (-3.6, -5.0)]
# engine pods and the tail thruster: the game's glow halos sit on these
POD = dict(x=7.2, y=3.2, z0=-5.0, z1=-0.35, r=1.25)   # chunkier than the code-built pods (concept)


def clamp(x, a, b):
    return min(b, max(a, x))


def smoothstep(a, b, x):
    t = clamp((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def G(x, y, z):
    """game ship-local (x port, y up, z nose) -> Blender (z up, nose toward -y); glTF +Y-up export maps it back"""
    return Vector((x, -z, y))


def hullR(z):
    if z > 5:
        t = min((z - 5) / (HULL['zNose'] - 5), 1.0)
        return math.sqrt(max(1 - t * t, 0.0))
    if z < -3:
        return 1 - 0.64 * math.pow(smoothstep(-3, HULL['zTail'], z), 1.3)
    return 1.0


def hullYc(z):
    return HULL['yc'] + HULL['tailRise'] * smoothstep(-3, HULL['zTail'], z)


def hullPoint(z, th, inset=0.0):
    """game-space point on the hull at station z, angle th from the top (positive toward port)"""
    r, c, s = hullR(z), math.cos(th), math.sin(th)
    W = HULL['W'] - inset
    H = (HULL['Hup'] if c > 0 else HULL['Hdn']) - inset
    return (W * r * s, hullYc(z) + H * r * c, z)


def halfWidthAt(y, z, inset=0.0):
    r, yc = hullR(z), hullYc(z)
    H = (HULL['Hup'] if y > yc else HULL['Hdn']) - inset
    W = HULL['W'] - inset
    if r <= 1e-4:
        return 0.0
    c = (y - yc) / (H * r)
    return 0.0 if abs(c) >= 1 else W * r * math.sqrt(1 - c * c)


def thetaAt(y, z, inset=0.0):
    r, yc = hullR(z), hullYc(z)
    H = (HULL['Hup'] if y > yc else HULL['Hdn']) - inset
    return math.acos(clamp((y - yc) / (H * max(r, 1e-4)), -1, 1))


def hullNormal(z, th):
    """outward unit normal (game space)"""
    def P(z_, t_):
        return Vector(hullPoint(z_, t_))
    tt = P(z, th + 0.002) - P(z, th - 0.002)
    zc = min(z + 0.01, HULL['zNose'] - 1e-4)
    tz = P(zc, th) - P(z - 0.01, th)
    n = tt.cross(tz).normalized()
    p = P(z, th)
    if n.dot(p - Vector((0, hullYc(z), z))) < 0:
        n = -n
    return n


def onHull(z, th, lift=0.0):
    return Vector(hullPoint(z, th)) + hullNormal(z, th) * lift


def canopyZ(th):
    """front edge of the hull skin at angle th: the canopy boundary above, the chin seam below"""
    a = min(abs(th), GLASS['th'])
    return GLASS['z0'] + GLASS['k'] * (a / GLASS['th']) ** 2


def glassAt(z, th):
    return abs(th) < GLASS['th'] and z > canopyZ(th)


def doorTop(z):
    return DOOR['yArc'] + math.sqrt(max(0.0, 0.81 - (z - 0.8) ** 2))


# ---- arc length along a meridian (rows of the hull grid are spaced evenly in it) ----
_MER = None


def meridian():
    global _MER
    if _MER is None:
        zs, L = [], []
        n = 4000
        prev, acc = None, 0.0
        for i in range(n + 1):
            z = HULL['zTail'] + (HULL['zNose'] - HULL['zTail']) * i / n
            p = Vector(hullPoint(z, math.pi / 2))
            if prev is not None:
                acc += (p - prev).length
            zs.append(z)
            L.append(acc)
            prev = p
        _MER = (zs, L)
    return _MER


def arcOf(z):
    zs, L = meridian()
    t = (z - zs[0]) / (zs[-1] - zs[0]) * (len(zs) - 1)
    i = int(clamp(math.floor(t), 0, len(zs) - 2))
    f = t - i
    return L[i] * (1 - f) + L[i + 1] * f


def zOfArc(a):
    zs, L = meridian()
    lo, hi = 0, len(L) - 1
    a = clamp(a, L[0], L[-1])
    while hi - lo > 1:
        m = (lo + hi) // 2
        if L[m] < a:
            lo = m
        else:
            hi = m
    f = (a - L[lo]) / max(L[hi] - L[lo], 1e-9)
    return zs[lo] * (1 - f) + zs[hi] * f


# ---- arc length around a station (panel columns are laid out in metres around) ----
def aroundTable(z, n=720):
    """cumulative metres around the section at z, from th = 0 (top) toward +th (port) and -th; returns (ths, S)"""
    ths, S = [], []
    prev, acc = None, 0.0
    for i in range(n + 1):
        th = -math.pi + 2 * math.pi * i / n
        p = Vector(hullPoint(z, th))
        if prev is not None:
            acc += (p - prev).length
        ths.append(th)
        S.append(acc)
        prev = p
    # re-zero at the top
    i0 = n // 2
    s0 = S[i0]
    return ths, [s - s0 for s in S]


def thOfAround(table, s):
    ths, S = table
    lo, hi = 0, len(S) - 1
    s = clamp(s, S[0], S[-1])
    while hi - lo > 1:
        m = (lo + hi) // 2
        if S[m] < s:
            lo = m
        else:
            hi = m
    f = (s - S[lo]) / max(S[hi] - S[lo], 1e-9)
    return ths[lo] * (1 - f) + ths[hi] * f


def aroundOfTh(table, th):
    ths, S = table
    t = (th + math.pi) / (2 * math.pi) * (len(ths) - 1)
    i = int(clamp(math.floor(t), 0, len(ths) - 2))
    f = t - i
    return S[i] * (1 - f) + S[i + 1] * f
