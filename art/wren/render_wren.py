# =========================================================================
# Turnaround renders of the exported GLB (what the game would load), on the
# concept sheet's cream paper, plus the concept's three-quarter view.
#
#   Blender -b --factory-startup --python art/wren/render_wren.py -- [glb] [outdir] [views] [cycles]
# views: comma list of front,side,back,top,three,stbd,low,flight,fold (default: all); 'cycles' renders with Cycles
# (flight: the ramp-door closed, the last frame of the GLB's DoorClose animation; fold: a video of it)
# =========================================================================
import bpy
import sys
import os
import math
from mathutils import Vector, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
POS = [a for a in ARGS if not a.startswith('--') and a != 'cycles']
GLB = POS[0] if len(POS) > 0 else os.path.join(HERE, 'out', 'wren.glb')
OUT = POS[1] if len(POS) > 1 else os.path.join(HERE, 'renders')
VIEWS = POS[2].split(',') if len(POS) > 2 and POS[2] != 'all' else ['three', 'side', 'front', 'back', 'top', 'stbd', 'low', 'flight', 'fold']
CYCLES = 'cycles' in ARGS   # (Blender itself grabs '--cycles…' options, even after '--')
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps = 30   # the GLB's animation runs at 30 fps: import it frame for frame
bpy.ops.import_scene.gltf(filepath=GLB)


def G(x, y, z):
    return Vector((x, -z, y))


# the GLB's DoorClose animation: frame 1 parked (ramp down), the last frame closed for flight
END = max([int(a.frame_range[1]) for a in bpy.data.actions] + [1])
sc.frame_set(1)

# light: a warm sun from the upper front-left, a soft sky
sun = bpy.data.lights.new('Sun', 'SUN')
sun.energy = 3.6
sun.color = (1.0, 0.88, 0.72)
sun.angle = math.radians(3)
so = bpy.data.objects.new('Sun', sun)
sc.collection.objects.link(so)
d = G(0.5, 0.55, 0.62).normalized()
so.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
w = bpy.data.worlds.new('Sky')
sc.world = w
w.use_nodes = True
bg = w.node_tree.nodes['Background']
nt = w.node_tree
tc = nt.nodes.new('ShaderNodeTexCoord')
sz = nt.nodes.new('ShaderNodeSeparateXYZ')
ramp = nt.nodes.new('ShaderNodeValToRGB')
nt.links.new(tc.outputs['Generated'], sz.inputs[0])
nt.links.new(sz.outputs[2], ramp.inputs[0])
ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = 0.5, (0.86, 0.8, 0.7, 1)
ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = 0.66, (0.34, 0.52, 0.82, 1)
nt.links.new(ramp.outputs[0], bg.inputs['Color'])
bg.inputs['Strength'].default_value = 0.7

# a meadow under the ship for shadows (hidden in the ortho sheet views)
bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, 0))
ground = bpy.context.object
gm = bpy.data.materials.new('meadow')
gm.use_nodes = True
gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.12, 0.22, 0.06, 1)
gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.95
ground.data.materials.append(gm)

if CYCLES:
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for dv in prefs.devices:
        dv.use = dv.type != 'CPU'
    sc.cycles.device = 'GPU'
    sc.cycles.samples = 96
    sc.cycles.use_denoising = True
else:
    sc.render.engine = 'BLENDER_EEVEE'
    try:
        sc.eevee.taa_render_samples = 64
        sc.eevee.use_shadows = True
        sc.eevee.use_raytracing = True
    except Exception:
        pass
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Medium High Contrast' if 'AgX - Medium High Contrast' in [i.identifier for i in sc.view_settings.bl_rna.properties['look'].enum_items] else 'None'

# no interior yet: a dark cabin shell inside the skin (renders only) and a warm lamp inside the door, as in the concept
sys.path.insert(0, HERE)
import wren_shape as WS  # noqa: E402
cab = bpy.data.meshes.new('Cabin')
NZ, NT = 90, 48
zs = [WS.HULL['zTail'] + 0.2 + (WS.HULL['zNose'] - 0.3 - WS.HULL['zTail'] - 0.2) * i / NZ for i in range(NZ + 1)]
verts = [tuple(G(*WS.hullPoint(z, 2 * math.pi * j / NT, 0.32))) for z in zs for j in range(NT)]
faces = [(i * NT + j, i * NT + (j + 1) % NT, (i + 1) * NT + (j + 1) % NT, (i + 1) * NT + j) for i in range(NZ) for j in range(NT)]
in_door = lambda f: (lambda c: c.x > 0 and -0.4 < -c.y < 2.0 and 2.2 < c.z < 5.3)(sum((Vector(verts[k]) for k in f), Vector()) / 4)
faces = [f for f in faces if not in_door(f)]   # open where the doorway is
cab.from_pydata(verts, [], faces)
cm = bpy.data.materials.new('cabin')
cm.use_nodes = True
cb = cm.node_tree.nodes['Principled BSDF']
cb.inputs['Base Color'].default_value = (0.09, 0.06, 0.04, 1)
cb.inputs['Emission Color'].default_value = (1.0, 0.62, 0.3, 1)
cb.inputs['Emission Strength'].default_value = 0.06
cab.materials.append(cm)
sc.collection.objects.link(bpy.data.objects.new('Cabin', cab))
lamp = bpy.data.lights.new('Cabin', 'POINT')
lamp.energy, lamp.color, lamp.shadow_soft_size = 260, (1.0, 0.66, 0.36), 0.6
lo = bpy.data.objects.new('Cabin', lamp)
sc.collection.objects.link(lo)
lo.location = G(2.6, 3.9, 0.8)

cam_d = bpy.data.cameras.new('Cam')
cam = bpy.data.objects.new('Cam', cam_d)
sc.collection.objects.link(cam)
sc.camera = cam

PAPER = (0.94, 0.91, 0.84)


def shoot(name, loc, target, ortho=None, lens=50, res=(1800, 1100), sheet=True, up=None):
    cam.location = loc
    dirv = (target - loc).normalized()
    cam.rotation_euler = dirv.to_track_quat('-Z', 'Y').to_euler()
    if up is not None:
        cam.rotation_euler = up
    if ortho:
        cam_d.type = 'ORTHO'
        cam_d.ortho_scale = ortho
    else:
        cam_d.type = 'PERSP'
        cam_d.lens = lens
    cam_d.clip_end = 1000
    sc.render.resolution_x, sc.render.resolution_y = res
    ground.hide_render = sheet
    sc.render.film_transparent = sheet
    path = os.path.join(OUT, f'wren-{name}.png')
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    if sheet:   # lay it on the concept sheet's paper
        im = bpy.data.images.load(path)
        px = list(im.pixels)
        for i in range(0, len(px), 4):
            a = px[i + 3]
            for k in range(3):
                px[i + k] = px[i + k] * a + PAPER[k] * (1 - a)
            px[i + 3] = 1.0
        im.pixels = px
        im.filepath_raw = path
        im.save()
    print('rendered', path, flush=True)


C = G(0, 6.2, -0.5)
for v in VIEWS:
    if v == 'side':
        shoot('side', C + Vector((80, 0, 0)), C, ortho=32)
    elif v == 'stbd':
        shoot('stbd', C + Vector((-80, 0, 0)), C, ortho=32)
    elif v == 'front':
        shoot('front', C + Vector((0, -80, 0)), C, ortho=26, res=(1400, 1100))
    elif v == 'back':
        shoot('back', C + Vector((0, 80, 0)), C, ortho=26, res=(1400, 1100))
    elif v == 'top':
        shoot('top', C + Vector((0, 0, 80)), C, ortho=32, up=Euler((0, 0, math.pi / 2)))
    elif v == 'three':
        shoot('three', G(23.5, 3.2, 17.0), G(0, 5.6, -0.8), lens=32, sheet=False)
    elif v == 'low':
        shoot('low', G(9.0, 1.7, 9.5), G(1.5, 4.5, -2.5), lens=22, sheet=False)
    elif v == 'flight':
        sc.frame_set(END)
        shoot('flight', G(23.5, 3.2, 17.0), G(0, 5.6, -0.8), lens=32, sheet=False)
        shoot('flight-door', G(10.5, 3.0, 6.0), G(2.5, 3.6, 0.6), lens=30, sheet=False)
        sc.frame_set(1)
    elif v == 'fold':
        # the ramp folding into the door, as a short video (EEVEE, quick)
        eng = sc.render.engine
        sc.render.engine = 'BLENDER_EEVEE'
        cam_d.type, cam_d.lens = 'PERSP', 26
        cam.location = G(11.5, 2.2, 7.0)
        cam.rotation_euler = (G(2.6, 3.4, 0.4) - cam.location).normalized().to_track_quat('-Z', 'Y').to_euler()
        sc.render.resolution_x, sc.render.resolution_y = 1280, 800
        ground.hide_render, sc.render.film_transparent = False, False
        sc.frame_start, sc.frame_end = 1, END + 15
        try:
            sc.render.image_settings.media_type = 'VIDEO'
        except Exception:
            pass
        sc.render.image_settings.file_format = 'FFMPEG'
        sc.render.ffmpeg.format, sc.render.ffmpeg.codec = 'MPEG4', 'H264'
        sc.render.ffmpeg.constant_rate_factor = 'HIGH'
        sc.render.filepath = os.path.join(OUT, 'wren-ramp-fold.mp4')
        bpy.ops.render.render(animation=True)
        # play it closing, then opening again (ffmpeg, when it is installed)
        import shutil
        import subprocess
        if shutil.which('ffmpeg'):
            fwd = sc.render.filepath
            both = fwd.replace('.mp4', '-tmp.mp4')
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', fwd, '-filter_complex', '[0]reverse[r];[0][r]concat=n=2:v=1',
                            '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', both], check=False)
            if os.path.exists(both):
                os.replace(both, fwd)
        print('rendered', sc.render.filepath, flush=True)
        sc.render.engine = eng


# =================== sheets: the turnaround in the concept's layout, and the three-quarter beside the concept ===================
def load(path, w=None, h=None):
    im = bpy.data.images.load(path)
    if w:
        im.scale(w, h)
    W, H = im.size
    import numpy as np
    a = np.empty(W * H * 4, np.float32)
    im.pixels.foreach_get(a)
    return a.reshape(H, W, 4)


def save(a, path):
    import numpy as np
    H, W = a.shape[:2]
    im = bpy.data.images.new(os.path.basename(path), W, H)
    im.pixels.foreach_set(np.ascontiguousarray(a).ravel())
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    print('sheet', path, flush=True)


import numpy as np  # noqa: E402
P = {v: os.path.join(OUT, f'wren-{v}.png') for v in ('front', 'side', 'back', 'top', 'three')}
if all(os.path.exists(P[v]) for v in ('front', 'side', 'back', 'top')):
    sheet = np.ones((2200, 3200, 4), np.float32)
    sheet[..., :3] = PAPER
    sheet[1100:, :1400] = load(P['front'])     # rows start at the bottom
    sheet[1100:, 1400:] = load(P['side'])
    sheet[:1100, :1400] = load(P['back'])
    sheet[:1100, 1400:] = load(P['top'])
    save(sheet, os.path.join(OUT, 'wren-turnaround.png'))
concept = os.path.join(HERE, '..', '..', 'docs', 'concepts', 'wren-chosen-sky-whale.jpg')
if os.path.exists(P['three']) and os.path.exists(concept):
    c = load(concept)
    H = c.shape[0]
    r = load(P['three'], int(1800 * H / 1100), H)
    save(np.concatenate([c, r], axis=1), os.path.join(OUT, 'wren-vs-concept.png'))
