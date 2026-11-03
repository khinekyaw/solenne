# =========================================================================
# The Wren's exterior, built in Blender from code and baked for the game.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
#       --python art/wren/build_wren.py -- [--quick] [--no-bake]
#
# Writes art/wren/out/wren.glb (+ wren.blend, textures/*.png). The GLB is in
# the game's ship-local frame (metres, x port, y up, z nose, origin on the
# ground under the hull), with:
#   Body                one mesh: hull, wings, pods, tail, trim, glass, lamps
#   Ramp                hinged at its sill (rotate about local z to lower it)
#   Leg*                pivot at the hip (for folding in flight)
# Materials: wren_paint (baked albedo / normal / ORM atlas), wren_glass,
# wren_glow_warm / _eye / _cool (emissive, driven by the game's shader).
# No interior: the game keeps its code-built rooms inside this skin.
# =========================================================================
import bpy
import bmesh
import sys
import os
import math
import random
import time
import json

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mathutils import Vector  # noqa: E402
import wren_shape as WS  # noqa: E402
import wren_mesh as WM  # noqa: E402
import wren_parts as P  # noqa: E402
import wren_paint as PT  # noqa: E402

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
QUICK = '--quick' in ARGS
BAKE = '--no-bake' not in ARGS
RES = 1024 if QUICK else 4096
MARGIN = max(4, RES // 256)
OUT = os.path.join(HERE, 'out')
TEX = os.path.join(OUT, 'textures')
os.makedirs(TEX, exist_ok=True)
T0 = time.time()


def log(*a):
    print(f'[wren {time.time() - T0:6.1f}s]', *a, flush=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.unit_settings.system = 'METRIC'


def coll(name):
    c = bpy.data.collections.new(name)
    sc.collection.children.link(c)
    return c


C_GAME, C_SRC, C_TMP = coll('Wren'), coll('BakeSources'), coll('Cutters')

SRC = PT.source_materials()
M_PLATE, M_RIVET, M_SEAM, M_TARGET = PT.paint_mat('src_plate'), PT.paint_mat('src_rivet', 0.8), PT.seam_mat(), PT.target_mat()
M_INK = SRC[P.M_INK]


def evaluate(ob):
    """apply all modifiers"""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)


def cleanup(ob, dist=1e-5):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=dist)
    bm.to_mesh(ob.data)
    bm.free()


def join(obs, name):
    obs = [o for o in obs if o is not None]
    with bpy.context.temp_override(active_object=obs[0], object=obs[0], selected_objects=obs, selected_editable_objects=obs):
        bpy.ops.object.join()
    obs[0].name = name
    obs[0].data.name = name
    return obs[0]


def pivoted(mb, name, mats, pivot, coll_, sharp=None):
    for i, p in enumerate(mb.v):
        mb.v[i] = p - pivot
    ob = mb.to_object(name, mats, coll_, sharp_angle=sharp)
    ob.location = WS.G(*pivot)
    return ob


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# =================== geometry ===================
rng = random.Random(11)
log('hull')
hull_mb, glass_mb = P.hull_low()
hull = hull_mb.to_object('Hull', [M_SEAM, M_PLATE], C_GAME)   # slot 0: the skin under the plates (seen in the seams)
WM.orient_faces(hull, P.hull_inside)
bm = bmesh.new()
bm.from_mesh(hull.data)
for e in bm.edges:   # UV seams along the keel and the spine
    if all(abs(v.co.x) < 1e-4 for v in e.verts):
        e.seam = True
bm.to_mesh(hull.data)
bm.free()
door_mb, dome_mb = P.cutters()
for mb_, nm in ((door_mb, 'CutDoor'), (dome_mb, 'CutDome')):
    c = mb_.to_object(nm, [], C_TMP, smooth=False)
    WM.recalc_normals(c)
    m = hull.modifiers.new(nm, 'BOOLEAN')
    m.operation, m.solver, m.object = 'DIFFERENCE', 'EXACT', c
    m.use_hole_tolerant = True
    evaluate(hull)
    c.hide_render = True
    c.hide_set(True)

log('panelled surfaces and plates')
plates, rivets = WM.MB(), WM.MB()
hp, hr = P.hull_plates(rng)
plates.extend(hp)
rivets.extend(hr)
panels = [hull]


def panelled(name, S, low, plist, step=0.25):
    ob = low.to_object(name, [M_SEAM, M_PLATE], C_GAME)
    for u0, u1, v0, v1, col in plist:
        WM.plate(plates, rivets, S, u0, u1, v0, v1, col, step=step)
    panels.append(ob)


sinv = lambda j, n: math.sin(j / n * math.pi / 2)
for s, side in ((1, 'Port'), (-1, 'Stbd')):
    S = P.wing_fn(s)
    panelled('Wing' + side, S, P.surf_low(S, 64, 36, vfn=sinv), P.wing_panels(rng))
    S = P.pod_fn(s)
    panelled('Pod' + side, S, P.surf_low(S, 40, 44, ufn=lambda i, n: math.pi + 2 * math.pi * i / n), P.pod_panels(rng), 0.17)
    S = P.tailplane_fn(s)
    panelled('TailPlane' + side, S, P.surf_low(S, 40, 24, vfn=sinv), P.fin_panels(rng, (0.0, 0.5, 0.95)), 0.15)
S = P.fin_fn()
panelled('Fin', S, P.surf_low(S, 48, 32, vfn=sinv), P.fin_panels(rng), 0.2)
# the plates are real geometry now (2 cm proud, chamfered): they join the skin; only the rivets are baked
pl = plates.to_object('Plates', [M_SEAM, M_PLATE], C_GAME, sharp_angle=40)
cleanup(pl)
low = join(panels + [pl], 'Skin')
# bake source: the same skin a hair further out, painted (plates from pcol, the skin under them dark)
src_skin = low.copy()
src_skin.data = low.data.copy()
src_skin.name = 'SkinPaint'
C_SRC.objects.link(src_skin)
bm = bmesh.new()
bm.from_mesh(src_skin.data)
for v in bm.verts:
    v.co += v.normal * 0.0006
bm.to_mesh(src_skin.data)
bm.free()
low.data.materials[0] = M_TARGET
low.data.materials[1] = M_TARGET
src_rivets = rivets.to_object('Rivets', [M_RIVET], C_SRC)

log('name')
cu = bpy.data.curves.new('NameText', 'FONT')
cu.body = 'THE WREN'
try:
    cu.font = bpy.data.fonts.load('/System/Library/Fonts/Supplemental/Georgia.ttf')
except Exception as e:  # any serif will do
    log('font', e)
cu.align_x, cu.align_y, cu.space_character, cu.resolution_u = 'CENTER', 'CENTER', 1.18, 5
tob = bpy.data.objects.new('NameText', cu)
sc.collection.objects.link(tob)
tme = bpy.data.meshes.new_from_object(tob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
bpy.data.objects.remove(tob)
bm = bmesh.new()   # small faces, so the letters hug the curved hull instead of sagging under the plates
bm.from_mesh(tme)
bmesh.ops.triangulate(bm, faces=bm.faces)
bmesh.ops.subdivide_edges(bm, edges=bm.edges, cuts=4, use_grid_fill=True)
bmesh.ops.triangulate(bm, faces=bm.faces)
bm.to_mesh(tme)
bm.free()
xs, ys = [v.co.x for v in tme.vertices], [v.co.y for v in tme.vertices]
k, cx, cy = 2.3 / (max(xs) - min(xs)), (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
nm_mb = WM.MB()
zc = (P.NAME['z0'] + P.NAME['z1']) / 2
for s in (1, -1):
    base = len(nm_mb.v)
    for v in tme.vertices:
        tx, ty = (v.co.x - cx) * k, (v.co.y - cy) * k
        z = zc - s * tx
        th0 = s * P.NAME['th']
        R = (Vector(WS.hullPoint(z, th0 + 1e-3)) - Vector(WS.hullPoint(z, th0 - 1e-3))).length / 2e-3
        nm_mb.vert(WS.onHull(z, s * (P.NAME['th'] - ty / R), 0.034))
    for f in tme.polygons:
        nm_mb.face([base + i for i in f.vertices])
nm_mb.orient(lambda c: c - Vector((0, WS.hullYc(c.z), c.z)))
src_name = nm_mb.to_object('Name', [M_INK], C_SRC, smooth=False)

log('fittings, glass, lamps')
direct, warm, eye, cool = WM.MB(), WM.MB(), WM.MB(), WM.MB()
P.canopy_trim(direct, None)
for th, z0, z1 in P.straps():
    P.strap(direct, th, z0, z1)
P.portholes(direct, warm)
P.ring(direct, eye, 10.6, 2.15, 0.5, deep=0.12, bolts=10, hood=True)
P.lights(direct, cool)
P.dome(direct, glass_mb)
P.door(direct)
P.pod_fittings(direct, cool)
P.thruster(direct, cool)
P.belly(direct)
P.hatch(direct)
P.moss(direct, rng)
SRCP = SRC + [M_PLATE]   # slot 8: hull paint on directly baked parts (the ramp-door's outer face)
fit = direct.to_object('Fittings', SRCP, C_GAME, sharp_angle=35)
cleanup(fit)
glass = glass_mb.to_object('Glass', [M_TARGET], C_GAME)
glows = [mb_.to_object(nm, [M_TARGET], C_GAME) for mb_, nm in ((warm, 'GlowWarm'), (eye, 'GlowEye'), (cool, 'GlowCool'))]
for g in [glass] + glows:
    cleanup(g)

log('legs and ramp')
legs, leg_glows = [], []
for fx, fz in WS.LEGS:
    mb_, gl, hip = P.leg(fx, fz, None)
    nm = 'Leg' + ('Front' if fz > 0 else 'Rear') + ('Port' if fx > 0 else 'Stbd')
    lo = pivoted(mb_, nm, SRCP, hip, C_GAME, sharp=35)
    cleanup(lo)
    legs.append(lo)
    leg_glows.append(pivoted(gl, nm + 'Glow', [M_TARGET], hip, C_GAME))
a_mb, b_mb, hinge, knee, TH_CLOSED, TH_DOWN = P.ramp()
ramp = pivoted(a_mb, 'Ramp', SRCP, hinge, C_GAME, sharp=35)
foot = pivoted(b_mb, 'RampFoot', SRCP, knee, C_GAME, sharp=35)
for o in (ramp, foot):
    cleanup(o)
    o.rotation_mode = 'XYZ'
foot.parent = ramp
foot.matrix_parent_inverse.identity()
foot.location = WS.G(*(knee - hinge))


def pose(down, folded):
    """ramp angle about the sill (game z; Blender -Y) and the foot's fold about the knee"""
    ramp.rotation_euler = (0.0, -down, 0.0)
    foot.rotation_euler = (0.0, -folded, 0.0)


pose(TH_DOWN, 0.0)   # parked: bake in the pose it is seen in most

# =================== UVs: one atlas for every painted part ===================
log('uv')
atlas = [low, fit, ramp, foot] + legs


def edit(obs, fn):
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    fn()
    bpy.ops.object.mode_set(mode='OBJECT')


edit([low], lambda: bpy.ops.uv.unwrap(method='ANGLE_BASED', margin=0.001))
edit([fit, ramp, foot] + legs, lambda: bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0))
edit([glass] + glows + leg_glows, lambda: bpy.ops.uv.smart_project(angle_limit=math.radians(60)))


edit(atlas, lambda: (bpy.ops.uv.select_all(action='SELECT'), bpy.ops.uv.average_islands_scale()))
import numpy as np  # noqa: E402
for o, k in [(fit, 0.5), (ramp, 0.8), (foot, 0.8)] + [(lg, 0.7) for lg in legs]:   # texel density relative to the plates
    uv = o.data.uv_layers.active.data
    a = np.empty(len(uv) * 2, np.float32)
    uv.foreach_get('uv', a)
    uv.foreach_set('uv', a * k)
# the skin under the plates only shows in the seams: a third of the density
me = low.data
uv = me.uv_layers.active.data
a = np.empty(len(uv) * 2, np.float32)
uv.foreach_get('uv', a)
a = a.reshape(-1, 2)
for poly in me.polygons:
    if poly.material_index == 0:
        a[poly.loop_start:poly.loop_start + poly.loop_total] *= 0.3
uv.foreach_set('uv', a.ravel())
edit(atlas, lambda: (bpy.ops.uv.select_all(action='SELECT'),
                     bpy.ops.uv.pack_islands(rotate=True, scale=True, margin=0.0025, shape_method='CONCAVE')))
# triangulate before baking, so the normal map's tangent frames are the ones the GLB carries
for o in atlas + [glass] + glows + leg_glows:
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.triangulate(bm, faces=bm.faces, quad_method='BEAUTY', ngon_method='BEAUTY')
    bm.to_mesh(o.data)
    bm.free()

# =================== bake ===================
for o in (src_skin, src_rivets, src_name):
    o.hide_render = False

if BAKE:
    log('bake setup', RES)
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type != 'CPU'
        sc.cycles.device = 'GPU'
    except Exception as e:
        log('gpu unavailable', e)
    sc.world = bpy.data.worlds.new('BakeWorld')
    sc.world.light_settings.distance = 1.4
    sc.render.bake.margin = MARGIN
    glass.hide_render = True

    def image(name, col, noncolor):
        im = bpy.data.images.new(name, RES, RES, alpha=False)
        im.generated_color = col
        if noncolor:
            im.colorspace_settings.name = 'Non-Color'
        return im

    I_COL = image('wren_albedo', (0.25, 0.2, 0.16, 1), False)
    I_NRM = image('wren_normal', (0.5, 0.5, 1, 1), True)
    I_AO = image('wren_ao', (1, 1, 1, 1), True)
    I_RM = image('wren_rm', (0, 0.6, 0, 1), True)
    bake_mats = SRC + [M_PLATE, M_RIVET, M_SEAM, M_TARGET]   # (M_PLATE is also slot 8 of the direct parts)

    def target(img, pass_=0.0):
        for m in bake_mats:
            n = m.node_tree.nodes
            n['BAKE'].image = img
            n.active = n['BAKE']
            n['PASS'].outputs[0].default_value = pass_

    def bake(kind, targets, sources=(), samples=4, clear=False):
        bpy.ops.object.select_all(action='DESELECT')
        for o in list(sources) + targets:
            o.select_set(True)
        bpy.context.view_layer.objects.active = targets[0]
        sc.cycles.samples = samples
        t = time.time()
        bpy.ops.object.bake(type=kind, use_selected_to_active=bool(sources), cage_extrusion=0.035, max_ray_distance=0.07,
                            margin=MARGIN, margin_type='EXTEND', use_clear=clear, normal_space='TANGENT', target='IMAGE_TEXTURES')
        log(f'  {kind:7s} {"from plates" if sources else "direct":11s} {time.time() - t:5.1f}s')

    direct_parts = [fit, ramp, foot] + legs
    hi = [src_skin, src_rivets]
    src_name.hide_render = False
    target(I_COL)
    bake('EMIT', [low], hi + [src_name], samples=4, clear=True)
    bake('EMIT', direct_parts, samples=4)
    src_name.hide_render = True
    target(I_RM, 1.0)
    bake('EMIT', [low], hi, samples=1, clear=True)
    bake('EMIT', direct_parts, samples=1)
    target(I_NRM)
    bake('NORMAL', [low], hi, samples=4, clear=True)
    bake('NORMAL', direct_parts, samples=1)
    target(I_AO)
    bake('AO', [low], hi, samples=48, clear=True)
    for o in hi:
        o.hide_render = True
    bake('AO', direct_parts, samples=48)

    import numpy as np

    def px(im):
        a = np.empty(RES * RES * 4, np.float32)
        im.pixels.foreach_get(a)
        return a.reshape(-1, 4)

    I_ORM = bpy.data.images.new('wren_orm', RES, RES, alpha=False)
    I_ORM.colorspace_settings.name = 'Non-Color'
    ao, rm = px(I_AO), px(I_RM)
    orm = np.ones_like(ao)
    orm[:, 0], orm[:, 1], orm[:, 2] = ao[:, 0], rm[:, 1], rm[:, 2]
    I_ORM.pixels.foreach_set(orm.ravel())
    for im in (I_COL, I_NRM, I_ORM, I_AO):
        im.filepath_raw = os.path.join(TEX, im.name + '.png')
        im.file_format = 'PNG'
        im.save()
    MP = PT.final_paint(I_COL, I_NRM, I_ORM)
    MP.use_backface_culling = True   # glTF doubleSided false: the game draws its own interior inside
else:
    MP = bpy.data.materials.new('wren_paint')
    MP.use_nodes = True
    MP.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.72, 0.62, 0.46, 1)

# =================== final materials, nodes, export ===================
log('assemble')
MG = PT.final_glass()
MW, ME, MC = (PT.final_glow('wren_glow_warm', (1.0, 0.6, 0.26), 2.4), PT.final_glow('wren_glow_eye', (1.0, 0.7, 0.36), 3.0),
              PT.final_glow('wren_glow_cool', (0.45, 0.78, 1.0), 2.2))


def only(ob, m):
    ob.data.materials.clear()
    ob.data.materials.append(m)
    ob.data.polygons.foreach_set('material_index', [0] * len(ob.data.polygons))
    if 'pcol' in ob.data.color_attributes:
        ob.data.color_attributes.remove(ob.data.color_attributes['pcol'])


for o in atlas:
    only(o, MP)
only(glass, MG)
for g, m in zip(glows, (MW, ME, MC)):
    only(g, m)
for g in leg_glows:
    only(g, MC)
body = join([low, fit, glass] + glows, 'Body')
legs = [join([lg, gl], lg.name) for lg, gl in zip(legs, leg_glows)]

# merge slots that hold the same material
for ob in [body] + legs:
    me = ob.data
    first = {}
    remap = []
    for i, m in enumerate(me.materials):
        first.setdefault(m.name, len(first))
        remap.append(first[m.name])
    idx = [0] * len(me.polygons)
    me.polygons.foreach_get('material_index', idx)
    uniq = list(dict.fromkeys(m.name for m in me.materials))
    mats = [bpy.data.materials[n] for n in uniq]
    me.materials.clear()
    for m in mats:
        me.materials.append(m)
    me.polygons.foreach_set('material_index', [remap[i] for i in idx])

root = bpy.data.objects.new('Wren', None)
C_GAME.objects.link(root)
root['frame'] = 'ship-local metres: x port, y up, z toward the nose; origin on the ground under the hull'
root['hull'] = json.dumps(WS.HULL)
root['glass'] = json.dumps(WS.GLASS)
root['door'] = json.dumps(WS.DOOR)
root['dome'] = json.dumps(WS.DOME)
root['source'] = 'art/wren/build_wren.py'
ramp['role'] = 'ramp-door, hinged on the sill: rotate about local z (0 level, negative lowers it, closed at %.4f rad)' % TH_CLOSED
foot['role'] = 'ramp foot, hinged at the end of the ramp: rotate about local z (pi folds it back onto the ramp)'
root['animations'] = 'DoorClose: frames 1-90 at 30 fps, the foot folds onto the ramp, then the ramp swings up and seals the doorway; play backwards to open'
# the fold, for the game to play (forward to close for flight, backward to open)
sc.render.fps = 30
sc.frame_start, sc.frame_end = 1, 90
for f, down, fold in ((1, TH_DOWN, 0.0), (14, TH_DOWN, 0.0), (40, TH_DOWN, math.pi), (48, TH_DOWN, math.pi), (90, TH_CLOSED, math.pi)):
    pose(down, fold)
    ramp.keyframe_insert('rotation_euler', index=1, frame=f)
    foot.keyframe_insert('rotation_euler', index=1, frame=f)
sc.frame_set(1)
sc.name = 'DoorClose'
for lg in legs:
    lg['role'] = 'leg: pivot at the hip'
for o in [body, ramp] + legs:
    o.parent = root

stats = {o.name: tris(o) for o in [body, ramp, foot] + legs}
log('triangles', stats, 'total', sum(stats.values()))
log('bake sources', {o.name: tris(o) for o in (src_skin, src_rivets, src_name)})

bpy.ops.object.select_all(action='DESELECT')
for o in [root, body, ramp, foot] + legs:
    o.select_set(True)
glb = os.path.join(OUT, 'wren.glb')
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                          export_tangents=True, export_extras=True, export_image_format='WEBP', export_image_quality=90,
                          export_cameras=False, export_lights=False, export_animations=True, export_animation_mode='SCENE',
                          export_frame_range=True, export_force_sampling=True)
log('exported', glb, f'{os.path.getsize(glb) / 1e6:.1f} MB')
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'wren.blend'))
try:
    bpy.ops.file.make_paths_relative()
    bpy.ops.wm.save_mainfile()
except Exception:
    pass
log('done')
