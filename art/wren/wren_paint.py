# =========================================================================
# Bake-source materials (Cycles, emission only: the bake writes exactly the
# colour, the game does the lighting) and the final glTF materials. Colours
# are the game's linear palette (wrenShaders.ts plating) so the baked atlas
# matches the code-built Wren's look.
# A value node named PASS switches every source between albedo (0) and
# (0, roughness, metallic) (1) for the ORM bake.
# =========================================================================
import bpy


def sock(node, name, kind=None, out=False):
    ss = node.outputs if out else node.inputs
    for s in ss:
        if s.name == name and (kind is None or s.type == kind):
            return s
    raise KeyError(name)


class NT:
    def __init__(self, mat):
        mat.use_nodes = True
        self.t = mat.node_tree
        self.t.nodes.clear()
        self.n = self.t.nodes
        self.l = self.t.links
        self.co = self.node('ShaderNodeTexCoord').outputs['Object']
        g = self.node('ShaderNodeNewGeometry')
        self.N = g.outputs['Normal']
        self.nz = self.sep(self.N)[2]

    def node(self, kind, **kw):
        nd = self.n.new(kind)
        for k, v in kw.items():
            setattr(nd, k, v)
        return nd

    def link(self, a, b):
        self.l.new(a, b)

    def inp(self, s, v):
        if hasattr(v, 'is_output'):
            self.link(v, s)
        else:
            s.default_value = v

    def sep(self, v):
        nd = self.node('ShaderNodeSeparateXYZ')
        self.link(v, nd.inputs[0])
        return nd.outputs[0], nd.outputs[1], nd.outputs[2]

    def noise(self, vec, scale, detail=4.0, rough=0.55):
        nd = self.node('ShaderNodeTexNoise')
        self.inp(nd.inputs['Vector'], vec)
        nd.inputs['Scale'].default_value = scale
        nd.inputs['Detail'].default_value = detail
        nd.inputs['Roughness'].default_value = rough
        return nd.outputs['Fac']

    def stretch(self, vec, sx, sy, sz):
        nd = self.node('ShaderNodeMapping')
        self.inp(nd.inputs['Vector'], vec)
        nd.inputs['Scale'].default_value = (sx, sy, sz)
        return nd.outputs['Vector']

    def mr(self, x, a, b, c=0.0, d=1.0, smooth=True):
        nd = self.node('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP' if smooth else 'LINEAR')
        self.inp(nd.inputs['Value'], x)
        for k, v in zip(('From Min', 'From Max', 'To Min', 'To Max'), (a, b, c, d)):
            nd.inputs[k].default_value = v
        return nd.outputs['Result']

    def math(self, op, a, b=0.0):
        nd = self.node('ShaderNodeMath', operation=op)
        self.inp(nd.inputs[0], a)
        self.inp(nd.inputs[1], b)
        return nd.outputs[0]

    def mix(self, fac, a, b):
        nd = self.node('ShaderNodeMix', data_type='RGBA')
        self.inp(sock(nd, 'Factor', 'VALUE'), fac)
        self.inp(sock(nd, 'A', 'RGBA'), a if hasattr(a, 'is_output') else (*a, 1.0))
        self.inp(sock(nd, 'B', 'RGBA'), b if hasattr(b, 'is_output') else (*b, 1.0))
        return sock(nd, 'Result', 'RGBA', out=True)

    def mul(self, a, b):
        nd = self.node('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY')
        sock(nd, 'Factor', 'VALUE').default_value = 1.0
        self.inp(sock(nd, 'A', 'RGBA'), a if hasattr(a, 'is_output') else (*a, 1.0))
        if hasattr(b, 'is_output') and b.type == 'VALUE':
            cmb = self.node('ShaderNodeCombineColor')
            for i in range(3):
                self.link(b, cmb.inputs[i])
            b = cmb.outputs[0]
        self.inp(sock(nd, 'B', 'RGBA'), b if hasattr(b, 'is_output') else (*b, 1.0))
        return sock(nd, 'Result', 'RGBA', out=True)

    def ao(self, dist, local=False):
        nd = self.node('ShaderNodeAmbientOcclusion', samples=8, only_local=local)
        nd.inputs['Distance'].default_value = dist
        return nd.outputs['AO']

    def edge(self, radius=0.008):
        """worn edges: where a bevelled normal leans away from the true one"""
        b = self.node('ShaderNodeBevel', samples=8)
        b.inputs['Radius'].default_value = radius
        d = self.node('ShaderNodeVectorMath', operation='DOT_PRODUCT')
        self.link(b.outputs['Normal'], d.inputs[0])
        self.link(self.N, d.inputs[1])
        return self.mr(self.math('SUBTRACT', 1.0, d.outputs['Value']), 0.004, 0.06)

    def finish(self, col, rough, metal):
        """emission output; PASS switches albedo / (0, rough, metal); an image node waits for the bake"""
        p = self.node('ShaderNodeValue')
        p.name = p.label = 'PASS'
        p.outputs[0].default_value = 0.0
        rm = self.node('ShaderNodeCombineColor')
        self.inp(rm.inputs[1], rough)
        self.inp(rm.inputs[2], metal)
        out_c = self.mix(p.outputs[0], col, rm.outputs[0])
        em = self.node('ShaderNodeEmission')
        self.link(out_c, em.inputs['Color'])
        o = self.node('ShaderNodeOutputMaterial')
        self.link(em.outputs[0], o.inputs['Surface'])
        img = self.node('ShaderNodeTexImage')
        img.name = 'BAKE'
        self.n.active = img


def weathering(T, c, top=True, belly=True, streaks=True):
    """the soft wear shared by painted metal: grime, rain streaks, darker belly, warm grime on top"""
    g = T.mr(T.noise(T.co, 0.35, 6, 0.6), 0.3, 0.7, 0.88, 1.06, smooth=False)
    c = T.mul(c, g)
    if streaks:
        st = T.noise(T.stretch(T.co, 2.6, 2.6, 0.12), 1.4, 5, 0.6)
        c = T.mul(c, T.mr(st, 0.35, 0.68, 0.8, 1.04, smooth=False))
        dirt = T.mr(T.noise(T.stretch(T.co, 5.0, 5.0, 0.25), 2.2, 6, 0.65), 0.55, 0.75, 0.0, 0.35)
        c = T.mix(dirt, c, T.mul(c, (0.62, 0.5, 0.38)))
    if belly:
        c = T.mul(c, T.mr(T.nz, -0.8, 0.4, 0.82, 1.0))
    if top:
        c = T.mix(T.math('MULTIPLY', T.mr(T.nz, 0.5, 1.0, 0.0, 0.5), T.mr(T.noise(T.co, 0.9, 3), 0.3, 0.7)), c,
                  T.mul(c, (0.84, 0.77, 0.64)))
    return c


def paint_mat(name, tint=1.0):
    """patchwork plating: panel colour from the 'pcol' attribute, weathered, moss in the up-facing seams"""
    m = bpy.data.materials.new(name)
    T = NT(m)
    a = T.node('ShaderNodeAttribute', attribute_name='pcol', attribute_type='GEOMETRY')
    c = T.mul(a.outputs['Color'], (tint, tint, tint))
    c = weathering(T, c)
    # rust: rare patches, a little more low down
    rn = T.math('ADD', T.noise(T.co, 1.1, 5, 0.6), T.math('MULTIPLY', T.math('SUBTRACT', 1.0, T.nz), 0.04))
    c = T.mix(T.mr(rn, 0.64, 0.72, 0.0, 0.4), c, (0.40, 0.18, 0.08))
    # cavities: seams and the foot of every rivet go dark, like the ink lines in the concept
    ao = T.ao(0.05)
    c = T.mul(c, T.mr(ao, 0.0, 1.0, 0.3, 1.0, smooth=False))
    # worn, lighter paint on plate edges
    c = T.mix(T.math('MULTIPLY', T.edge(0.008), 0.35), c, T.mul(c, (1.18, 1.15, 1.08)))
    # a little shading across each plate, like a painted hand-lit patch
    c = T.mul(c, T.mr(T.noise(T.co, 0.8, 2, 0.4), 0.3, 0.7, 0.9, 1.06, smooth=False))
    # moss: in seams and patches on what faces the sky
    mn = T.math('ADD', T.math('MULTIPLY', T.noise(T.co, 0.45, 5), 0.75), T.math('MULTIPLY', T.math('SUBTRACT', 1.0, ao), 0.55))
    mm = T.math('MULTIPLY', T.mr(mn, 0.55, 0.6), T.mr(T.nz, 0.5, 0.72))
    moss = T.mix(T.noise(T.co, 6.0, 3), (0.08, 0.15, 0.045), (0.24, 0.29, 0.08))
    c = T.mix(mm, c, moss)
    T.finish(c, T.math('ADD', 0.62, T.math('MULTIPLY', mm, 0.33)), 0.0)
    return m


def solid_mat(name, base, rough, metal, kind='plain'):
    m = bpy.data.materials.new(name)
    T = NT(m)
    c = base
    if kind == 'brass':
        c = T.mix(T.mr(T.noise(T.co, 2.2, 5), 0.45, 0.65), base, (0.30, 0.25, 0.12))      # tarnish
        c = T.mul(c, T.mr(T.ao(0.025), 0.0, 1.0, 0.68, 1.0, smooth=False))   # (a long reach turned small rivets into holes)
        c = T.mix(T.math('MULTIPLY', T.edge(0.006), 0.8), c, (0.86, 0.68, 0.38))           # rubbed edges
    elif kind == 'wood':
        a = T.node('ShaderNodeAttribute', attribute_name='pcol', attribute_type='GEOMETRY')
        w = T.node('ShaderNodeTexWave', wave_type='BANDS', bands_direction='Y')
        T.link(T.stretch(T.co, 1.0, 1.0, 1.0), w.inputs['Vector'])
        w.inputs['Scale'].default_value = 9.0
        w.inputs['Distortion'].default_value = 6.0
        w.inputs['Detail'].default_value = 3.0
        c = T.mul(T.mul(a.outputs['Color'], base), T.mr(w.outputs['Fac'], 0.0, 1.0, 0.72, 1.08, smooth=False))
        c = T.mul(c, T.mr(T.ao(0.04), 0.0, 1.0, 0.5, 1.0, smooth=False))
        c = weathering(T, c, streaks=False, belly=False)
    elif kind == 'moss':
        c = T.mix(T.noise(T.co, 9.0, 4), (0.07, 0.14, 0.04), (0.25, 0.30, 0.09))
        c = T.mul(c, T.mr(T.ao(0.05), 0.0, 1.0, 0.5, 1.0, smooth=False))
    elif kind == 'ink':
        c = T.mix(T.mr(T.noise(T.co, 5.0, 4), 0.55, 0.7), base, (0.62, 0.55, 0.42))        # chipped lettering
    else:
        c = weathering(T, base, streaks=(kind == 'enamel'))
        c = T.mul(c, T.mr(T.ao(0.03), 0.0, 1.0, 0.6, 1.0, smooth=False))
        c = T.mix(T.math('MULTIPLY', T.edge(0.006), 0.45), c, T.mul(c, (1.25, 1.22, 1.18)))
    T.finish(c, rough, metal)
    return m


def source_materials():
    """slot order matches wren_parts.SRC_NAMES"""
    return [
        solid_mat('src_brass', (0.55, 0.40, 0.18), 0.35, 1.0, 'brass'),
        solid_mat('src_pearl', (0.80, 0.77, 0.69), 0.5, 0.0, 'enamel'),
        solid_mat('src_dark', (0.15, 0.14, 0.13), 0.55, 0.6),
        solid_mat('src_bronze', (0.36, 0.27, 0.18), 0.45, 0.85),
        solid_mat('src_wood', (0.46, 0.31, 0.19), 0.8, 0.0, 'wood'),
        solid_mat('src_moss', (0.12, 0.2, 0.06), 0.95, 0.0, 'moss'),
        solid_mat('src_chrome', (0.62, 0.62, 0.6), 0.2, 1.0),
        solid_mat('src_ink', (0.075, 0.05, 0.035), 0.6, 0.0, 'ink'),
    ]


def seam_mat():
    m = bpy.data.materials.new('src_seam')
    T = NT(m)
    T.finish((0.055, 0.04, 0.03), 0.8, 0.0)
    return m


def target_mat():
    m = bpy.data.materials.new('bake_target')
    T = NT(m)
    T.finish((0.5, 0.5, 0.5), 0.5, 0.0)
    return m


# ---- final glTF materials ----
def gltf_output_group():
    g = bpy.data.node_groups.get('glTF Material Output')
    if g is None:
        g = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        g.interface.new_socket('Thickness', in_out='INPUT', socket_type='NodeSocketFloat')
    return g


def final_paint(col_img, nrm_img, orm_img):
    m = bpy.data.materials.new('wren_paint')
    m.use_nodes = True
    t = m.node_tree
    n = t.nodes
    bsdf = n['Principled BSDF']
    tc = n.new('ShaderNodeTexImage'); tc.image = col_img
    tn = n.new('ShaderNodeTexImage'); tn.image = nrm_img
    to = n.new('ShaderNodeTexImage'); to.image = orm_img
    nm = n.new('ShaderNodeNormalMap')
    sp = n.new('ShaderNodeSeparateColor')
    t.links.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
    t.links.new(tn.outputs['Color'], nm.inputs['Color'])
    t.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    t.links.new(to.outputs['Color'], sp.inputs['Color'])
    t.links.new(sp.outputs['Green'], bsdf.inputs['Roughness'])
    t.links.new(sp.outputs['Blue'], bsdf.inputs['Metallic'])
    go = n.new('ShaderNodeGroup'); go.node_tree = gltf_output_group()
    t.links.new(sp.outputs['Red'], go.inputs['Occlusion'])
    return m


def final_glass():
    m = bpy.data.materials.new('wren_glass')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.62, 0.78, 0.86, 1)
    b.inputs['Roughness'].default_value = 0.06
    b.inputs['Alpha'].default_value = 0.32
    m.surface_render_method = 'BLENDED'
    m.use_backface_culling = False
    return m


def final_glow(name, col, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*col, 1)
    b.inputs['Emission Color'].default_value = (*col, 1)
    b.inputs['Emission Strength'].default_value = strength
    return m
