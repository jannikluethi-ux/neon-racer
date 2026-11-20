#!/usr/bin/env python3
"""Stage C: assemble one Surge LOD from the meshoptimizer parts.

  blender -b -P build.py -- LOD0|LOD1|LOD2
Body (PAINT / TRIM / GLASS / LIGHT) + Wheel_FL/FR/RL/RR + Caliper_FL/FR/RL/RR = 12 draw calls.
Blender axes: front -Y, left +X, up +Z  ->  glTF: front +Z, left +X, up +Y.
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector, Matrix

WORK = '/workspace/surge/work'
OUT = '/workspace/surge/out'
FONT = '/usr/share/fonts/truetype/sand-box/google/Barlow Condensed/BarlowCondensed-Bold.ttf'
RACE_NO = '51'
LOD = sys.argv[sys.argv.index('--') + 1]
CFG = {
    'LOD0': dict(body='body_42000', wheels='wheels_12000', seg=48, cseg=10, num_dec=1.0, angle=40),
    'LOD1': dict(body='body_18000', wheels='wheels_4400', seg=28, cseg=6, num_dec=0.5, angle=40),
    'LOD2': dict(body='body_5000', wheels='wheels_1200', seg=12, cseg=3, num_dec=0.3, angle=45),
}[LOD]
META = json.load(open(os.path.join(WORK, 'clean_meta.json')))
K = META.get('wb_factor', 1.0)   # door-plate stations were measured at the 4.50 m scale

# ---------------------------------------------------------------- palettes
# TRIM palette (albedo, roughness, metallic). glTF MR texture: G=rough, B=metal.
TRIM = [
    ('CARBON',   (0.010, 0.010, 0.012), 0.38, 0.0),
    ('GLOSS',    (0.006, 0.006, 0.007), 0.10, 0.0),
    ('GUNMETAL', (0.090, 0.088, 0.085), 0.30, 0.9),
    ('INTERIOR', (0.022, 0.020, 0.020), 0.75, 0.0),
    ('NUM_W',    (0.85, 0.85, 0.83),    0.40, 0.0),
    ('NUM_K',    (0.008, 0.008, 0.009), 0.45, 0.0),
    ('NUM_G',    (0.80, 0.50, 0.12),    0.30, 1.0),   # gold plate border
    ('CHROME',   (0.60, 0.60, 0.62),    0.14, 1.0),
]
WHEEL = [
    ('TYRE',   (0.016, 0.016, 0.018), 0.82, 0.0),
    ('RIM',    (0.030, 0.030, 0.032), 0.32, 0.7),
    ('DISC',   (0.20, 0.20, 0.21),    0.42, 0.9),
    ('GOLD',   (0.80, 0.50, 0.12),    0.28, 1.0),
]
LIGHTS = [('LIGHT_W', (1.0, 0.97, 0.92)), ('LIGHT_R', (1.0, 0.04, 0.02))]


def u_of(pal, name):
    i = [p[0] for p in pal].index(name)
    return (i + 0.5) / len(pal)


def _srgb(c):
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def _png(name, pixels):
    """Write an N x 1 RGB PNG (pixels are 0..1, already encoded) via Blender's float path."""
    path = os.path.join(WORK, f'{name}.png')
    im = bpy.data.images.new(name, len(pixels), 1, alpha=False, float_buffer=True)
    im.colorspace_settings.name = 'Non-Color'
    flat = []
    for c in pixels: flat += [c[0], c[1], c[2], 1.0]
    im.pixels = flat
    im.filepath_raw = path; im.file_format = 'PNG'; im.save()
    bpy.data.images.remove(im)
    return path


def palette_images(tag, pal):
    """Albedo palette stored sRGB-encoded; MR palette linear (G=roughness, B=metalness)."""
    pa = _png(f'surge_{tag}_albedo', [tuple(_srgb(x) for x in c) for _, c, r, m in pal])
    pm = _png(f'surge_{tag}_mr', [(0.0, r, m) for _, c, r, m in pal])
    alb = bpy.data.images.load(pa); alb.colorspace_settings.name = 'sRGB'; alb.pack()
    mr = bpy.data.images.load(pm); mr.colorspace_settings.name = 'Non-Color'; mr.pack()
    return alb, mr


def new_mat(name, color=(1, 1, 1), rough=0.4, metal=0.0, coat=0.0, coat_r=0.05,
            alpha=1.0, blend=False, double=True):
    m = bpy.data.materials.new(name); m.use_nodes = True
    bs = m.node_tree.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Roughness'].default_value = rough
    bs.inputs['Metallic'].default_value = metal
    bs.inputs['Coat Weight'].default_value = coat
    bs.inputs['Coat Roughness'].default_value = coat_r
    bs.inputs['Alpha'].default_value = alpha
    if blend:
        m.blend_method = 'BLEND'
    m.use_backface_culling = not double
    return m


def hook_palette(m, alb, mr):
    nt = m.node_tree; bs = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = alb; t.interpolation = 'Closest'; t.extension = 'EXTEND'
    nt.links.new(t.outputs['Color'], bs.inputs['Base Color'])
    if mr is not None:
        t2 = nt.nodes.new('ShaderNodeTexImage'); t2.image = mr; t2.interpolation = 'Closest'; t2.extension = 'EXTEND'
        sp = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(t2.outputs['Color'], sp.inputs['Color'])
        nt.links.new(sp.outputs['Green'], bs.inputs['Roughness'])
        nt.links.new(sp.outputs['Blue'], bs.inputs['Metallic'])


def make_materials():
    M = {}
    # metallic gold paint: deep warm gold, high metalness, glossy clear coat
    M['PAINT'] = new_mat('PAINT', (0.80, 0.50, 0.12), rough=0.27, metal=0.90, coat=1.0, coat_r=0.03)
    ta, tm = palette_images('trim', TRIM)
    M['TRIM'] = new_mat('TRIM', coat=0.25, coat_r=0.1); hook_palette(M['TRIM'], ta, tm)
    M['GLASS'] = new_mat('GLASS', (0.006, 0.008, 0.010), rough=0.04, metal=0.0, alpha=0.62, blend=True)
    la = bpy.data.images.load(_png('surge_light_palette', [tuple(_srgb(x) for x in c) for _, c in LIGHTS]))
    la.colorspace_settings.name = 'sRGB'; la.pack()
    L = new_mat('LIGHT', (0.5, 0.5, 0.5), rough=0.3)
    nt = L.node_tree; bs = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = la; t.interpolation = 'Closest'; t.extension = 'EXTEND'
    nt.links.new(t.outputs['Color'], bs.inputs['Emission Color'])
    nt.links.new(t.outputs['Color'], bs.inputs['Base Color'])
    bs.inputs['Emission Strength'].default_value = 12.0
    M['LIGHT'] = L
    wa, wm = palette_images('wheel', WHEEL)
    M['WHEEL'] = new_mat('WHEEL'); hook_palette(M['WHEEL'], wa, wm)
    M['CALIPER'] = new_mat('CALIPER', (0.80, 0.50, 0.12), rough=0.32, metal=1.0, coat=0.5)
    return M


# ---------------------------------------------------------------- helpers
def meshes():
    return [o for o in bpy.data.objects if o.type == 'MESH']


def tris(o):
    o.data.calc_loop_triangles(); return len(o.data.loop_triangles)


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    bpy.context.view_layer.update()
    for o in new:
        if o.type == 'MESH':
            mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
    for o in new:
        if o.type != 'MESH': bpy.data.objects.remove(o, do_unlink=True)
    out = [o for o in bpy.data.objects if o in set(new) or False]
    out = [o for o in meshes() if o not in before]
    for o in out:
        o.data.transform(o.matrix_world); o.matrix_world = Matrix.Identity(4)
        o.data.materials.clear()
    return out


def set_uv(o, u):
    me = o.data
    while me.uv_layers: me.uv_layers.remove(me.uv_layers[0])
    uv = me.uv_layers.new(name='UVMap')
    for l in uv.data: l.uv = (u, 0.5)


def assign(o, mat, u=None):
    o.data.materials.clear(); o.data.materials.append(mat)
    set_uv(o, 0.5 if u is None else u)


def shade(o, angle):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
    bpy.context.view_layer.objects.active = o
    for p in o.data.polygons: p.use_smooth = True
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle), keep_sharp_edges=False)
    m = o.modifiers.new('wn', 'WEIGHTED_NORMAL'); m.mode = 'FACE_AREA'; m.keep_sharp = True; m.weight = 50
    bpy.ops.object.modifier_apply(modifier='wn')


def join(objs, name):
    objs = [o for o in objs if o]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active; ob.name = name; ob.data.name = name
    return ob


def bm_obj(name, bm, mat, u):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    assign(o, mat, u); return o


def lathe(bm, prof, seg, c, side, closed=True):
    """prof: list of (x_off_outward, r); revolve about the X axis through c."""
    rings = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        ring = [bm.verts.new((c.x + side * x, c.y + r * math.cos(a), c.z + r * math.sin(a))) for x, r in prof]
        rings.append(ring)
    for i in range(seg):
        r0, r1 = rings[i], rings[(i + 1) % seg]
        for j in range(len(prof) - 1):
            f = [r0[j], r1[j], r1[j + 1], r0[j + 1]]
            if side < 0: f.reverse()
            bm.faces.new(f)
    return rings


# ---------------------------------------------------------------- wheels
def build_wheel_extras(key, mats, seg):
    """Brake disc + hat + clean hub / centre cap (replaces the source logo cap)."""
    c = Vector(META['centres'][key]); R = META['radius'][key]
    side = 1 if c.x > 0 else -1
    k = R / 0.3804  # rear wheels are bigger
    bm = bmesh.new()
    # disc (annulus with thickness) at x_out ~ +0.00..+0.032
    d0, d1, rin, rout = -0.005 * k, 0.027 * k, 0.095 * k, 0.200 * k
    lathe(bm, [(d0, rin), (d0, rout), (d1, rout), (d1, rin), (d0, rin)], seg, c, side)
    # hat from disc to hub face
    lathe(bm, [(d1, 0.092 * k), (0.045 * k, 0.088 * k), (0.045 * k, 0.0)], max(8, seg // 2), c, side)
    disc = bm_obj(f'disc_{key}', bm, mats['WHEEL'], u_of(WHEEL, 'DISC'))
    # hub (black) + domed gold centre cap
    bm = bmesh.new()
    lathe(bm, [(0.030 * k, 0.090 * k), (0.082 * k, 0.088 * k), (0.090 * k, 0.074 * k), (0.090 * k, 0.050 * k)], seg, c, side)
    hub = bm_obj(f'hub_{key}', bm, mats['WHEEL'], u_of(WHEEL, 'RIM'))
    bm = bmesh.new()
    lathe(bm, [(0.090 * k, 0.050 * k), (0.096 * k, 0.046 * k), (0.099 * k, 0.026 * k), (0.100 * k, 0.0)], max(8, seg // 2), c, side)
    cap = bm_obj(f'cap_{key}', bm, mats['WHEEL'], u_of(WHEEL, 'GOLD'))
    for o in (disc, hub, cap):
        bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bm2 = bmesh.new(); bm2.from_mesh(o.data)
        bmesh.ops.remove_doubles(bm2, verts=bm2.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm2, faces=bm2.faces)
        bm2.to_mesh(o.data); bm2.free()
        shade(o, 50)
    return [disc, hub, cap]


def build_caliper(key, mats, cseg):
    c = Vector(META['centres'][key]); R = META['radius'][key]
    side = 1 if c.x > 0 else -1
    k = R / 0.3804
    r0, r1 = 0.140 * k, 0.222 * k
    x0, x1 = -0.030 * k, 0.062 * k  # straddles the disc, stays inside the spokes
    a_mid = math.radians(25)        # trailing edge (towards the rear, +Y), slightly up
    span = math.radians(62)
    bm = bmesh.new()
    cols = []
    for i in range(cseg + 1):
        a = a_mid - span / 2 + span * i / cseg
        ca, sa = math.cos(a), math.sin(a)
        col = []
        for x, r in ((x0, r0), (x1, r0), (x1, r1), (x0, r1)):
            col.append(bm.verts.new((c.x + side * x, c.y + r * ca, c.z + r * sa)))
        cols.append(col)
    for i in range(cseg):
        for j in range(4):
            bm.faces.new([cols[i][j], cols[i + 1][j], cols[i + 1][(j + 1) % 4], cols[i][(j + 1) % 4]])
    bm.faces.new(cols[0][::-1]); bm.faces.new(cols[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = bm_obj(f'Caliper_{key}', bm, mats['CALIPER'], 0.5)
    shade(o, 35)
    return o


# ---------------------------------------------------------------- numbers
def text_mesh(text, height, extrude):
    font = bpy.data.fonts.load(FONT, check_existing=True)
    cu = bpy.data.curves.new('num', 'FONT'); cu.body = text; cu.font = font; cu.size = 1.0
    cu.extrude = extrude; cu.align_x = 'CENTER'; cu.align_y = 'CENTER'; cu.resolution_u = 4
    cu.space_character = 1.05
    ob = bpy.data.objects.new('txt', cu); bpy.context.scene.collection.objects.link(ob)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target='MESH')
    ob = bpy.context.view_layer.objects.active
    bb = [Vector(v) for v in ob.bound_box]
    h = max(p.y for p in bb) - min(p.y for p in bb)
    cy = (max(p.y for p in bb) + min(p.y for p in bb)) / 2
    cx = (max(p.x for p in bb) + min(p.x for p in bb)) / 2
    cz = (max(p.z for p in bb) + min(p.z for p in bb)) / 2
    s = height / h
    ob.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation((-cx, -cy, -cz)))
    return ob


def frame(n, up=Vector((0, 0, 1))):
    n = n.normalized(); t = (up - n * up.dot(n)).normalized(); b = t.cross(n)
    return Matrix(((b.x, t.x, n.x, 0), (b.y, t.y, n.y, 0), (b.z, t.z, n.z, 0), (0, 0, 0, 1)))


def box(name, w, h, d, mat, u):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((v.co.x * w, v.co.y * h, v.co.z * d))
    return bm_obj(name, bm, mat, u)


def fit_plane(body_objs, side, y0, y1, z0, z1):
    deps = bpy.context.evaluated_depsgraph_get()
    pts = []
    for i in range(7):
        for j in range(5):
            y = y0 + (y1 - y0) * i / 6; z = z0 + (z1 - z0) * j / 4
            ok, loc, n, *_ = bpy.context.scene.ray_cast(deps, Vector((side * 2.0, y, z)), Vector((-side, 0, 0)))
            if ok: pts.append(loc)
    c = sum(pts, Vector()) / len(pts)
    # least squares x = a*y + b*z + d
    import numpy as np
    A = np.array([[p.y, p.z, 1] for p in pts]); X = np.array([p.x for p in pts])
    a, b, d = np.linalg.lstsq(A, X, rcond=None)[0]
    n = Vector((side, -a * side, -b * side)).normalized()
    maxx = max((p - c).dot(n) for p in pts)   # most proud point
    return c, n, maxx, len(pts)


def add_numbers(mats, body_objs):
    made = []
    ext = 0.004
    # doors: plate 0.44 x 0.32, numerals 0.24 tall
    for side, tag in ((1, 'L'), (-1, 'R')):
        c, n, proud, npts = fit_plane(body_objs, side, -0.60 * K, -0.10 * K, 0.33 * K, 0.56 * K)
        n = Vector((n.x, n.y, 0)).normalized()  # keep plates vertical
        cen = Vector((c.x, -0.35 * K, 0.445 * K))
        # recompute centre x on the fitted plane at y=-0.35
        deps = bpy.context.evaluated_depsgraph_get()
        ok, loc, *_ = bpy.context.scene.ray_cast(deps, Vector((side * 2.0, -0.35 * K, 0.445 * K)), Vector((-side, 0, 0)))
        base = loc + n * max(proud, 0.0)
        print(f'  door {tag}: hit {tuple(round(x,3) for x in loc)} n {tuple(round(x,3) for x in n)} proud {proud:.4f} pts {npts}')
        F = frame(n)
        rim = box(f'plate_rim_{tag}', 0.46 * K, 0.34 * K, 0.006, mats['TRIM'], u_of(TRIM, 'NUM_G'))
        rim.matrix_world = Matrix.Translation(base + n * 0.006) @ F
        pl = box(f'plate_{tag}', 0.44 * K, 0.32 * K, 0.006, mats['TRIM'], u_of(TRIM, 'NUM_K'))
        pl.matrix_world = Matrix.Translation(base + n * 0.0085) @ F
        t = text_mesh(RACE_NO, 0.245 * K, ext)
        assign(t, mats['TRIM'], u_of(TRIM, 'NUM_W'))
        t.matrix_world = Matrix.Translation(base + n * (0.0115 + ext)) @ F
        made += [rim, pl, t]
    # rear: blank licence plate -> black plate + gold edge + white 51
    plate_src = [o for o in body_objs if META['cls'].get(o.name.split('.')[0]) == 'PLATE']
    if plate_src:
        ps = plate_src[0]
        ws = [v.co for v in ps.data.vertices]
        mn = Vector((min(p.x for p in ws), min(p.y for p in ws), min(p.z for p in ws)))
        mx = Vector((max(p.x for p in ws), max(p.y for p in ws), max(p.z for p in ws)))
        cen = (mn + mx) / 2; w = mx.x - mn.x; h = mx.z - mn.z
        n = Vector((0, 1, 0))
        F = frame(n)
        rim = box('plate_rim_rear', w + 0.012, h + 0.012, 0.004, mats['TRIM'], u_of(TRIM, 'NUM_G'))
        rim.matrix_world = Matrix.Translation(Vector((cen.x, mx.y + 0.002, cen.z))) @ F
        pl = box('plate_rear', w, h, 0.004, mats['TRIM'], u_of(TRIM, 'NUM_K'))
        pl.matrix_world = Matrix.Translation(Vector((cen.x, mx.y + 0.004, cen.z))) @ F
        t = text_mesh(RACE_NO, h * 0.78, 0.003)
        assign(t, mats['TRIM'], u_of(TRIM, 'NUM_W'))
        t.matrix_world = Matrix.Translation(Vector((cen.x, mx.y + 0.006 + 0.003, cen.z))) @ F
        bpy.data.objects.remove(ps, do_unlink=True)
        body_objs.remove(ps)
        print(f'  rear plate {w:.3f} x {h:.3f} at {tuple(round(x,3) for x in cen)}')
        made += [rim, pl, t]
    for o in made:
        o.data.transform(o.matrix_world); o.matrix_world = Matrix.Identity(4)
        if o.name.startswith('txt') or o.name.startswith('num') or 'plate' not in o.name:
            bm = bmesh.new(); bm.from_mesh(o.data)
            bmesh.ops.triangulate(bm, faces=bm.faces)
            bm.to_mesh(o.data); bm.free()
            if CFG['num_dec'] < 1.0:
                bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
                bpy.context.view_layer.objects.active = o
                m = o.modifiers.new('d', 'DECIMATE'); m.ratio = CFG['num_dec']
                bpy.ops.object.modifier_apply(modifier='d')
        for p in o.data.polygons: p.use_smooth = False
    return made


# ---------------------------------------------------------------- main
def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = make_materials()
    body = import_glb(os.path.join(WORK, 'parts', CFG['body'] + '.glb'))
    wheels = import_glb(os.path.join(WORK, 'parts', CFG['wheels'] + '.glb'))
    groups = {'PAINT': [], 'TRIM': [], 'GLASS': [], 'LIGHT': []}
    for o in list(body):
        cls = META['cls'].get(o.name.split('.')[0], 'CARBON')
        o['cls'] = cls
    numbers = add_numbers(mats, body)  # needs the raw body for ray casts
    for o in body:
        cls = o['cls']
        if cls == 'PAINT':
            assign(o, mats['PAINT']); groups['PAINT'].append(o)
        elif cls == 'GLASS':
            assign(o, mats['GLASS']); groups['GLASS'].append(o)
        elif cls in ('LIGHT_W', 'LIGHT_R'):
            assign(o, mats['LIGHT'], u_of([(n, c) for n, c in LIGHTS], cls)); groups['LIGHT'].append(o)
        else:
            assign(o, mats['TRIM'], u_of(TRIM, cls if cls in [t[0] for t in TRIM] else 'CARBON'))
            groups['TRIM'].append(o)
        shade(o, CFG['angle'] if cls in ('PAINT', 'GLASS') else 35)
    groups['TRIM'] += numbers
    parts = [join(v, f'Body_{k}') for k, v in groups.items() if v]
    bodyo = join(parts, 'Body')

    # wheels
    by_key = {k: [] for k in META['centres']}
    for o in wheels:
        nm = o.name.split('.')[0]
        key = nm.rsplit('_', 1)[1]
        part = nm.rsplit('_', 1)[0]
        is_tyre = part in ('Object_50', 'Object_52')
        assign(o, mats['WHEEL'], u_of(WHEEL, 'TYRE' if is_tyre else 'RIM'))
        shade(o, 50 if is_tyre else 40)
        by_key[key].append(o)
    roots = [bodyo]
    for key in ('FL', 'FR', 'RL', 'RR'):
        objs = by_key[key] + build_wheel_extras(key, mats, CFG['seg'])
        w = join(objs, f'Wheel_{key}')
        c = Vector(META['centres'][key])
        w.data.transform(Matrix.Translation(-c)); w.location = c
        cal = build_caliper(key, mats, CFG['cseg'])
        cal.data.transform(Matrix.Translation(-c)); cal.location = c
        roots += [w, cal]
    root = bpy.data.objects.new(f'SurgeLMP_{LOD}', None)
    bpy.context.scene.collection.objects.link(root)
    for o in roots: o.parent = root
    # stats
    stats = {o.name: tris(o) for o in roots}
    total = sum(stats.values())
    draws = sum(len(o.data.materials) for o in roots)
    print('STATS', LOD, json.dumps(dict(total=total, draws=draws, per=stats)))
    path = os.path.join(OUT, f'surge_{LOD.lower()}.glb')
    bpy.ops.object.select_all(action='DESELECT')
    for o in [root] + roots: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB', export_yup=True,
                              export_apply=True, export_normals=True, export_texcoords=True,
                              export_tangents=False, export_vertex_color='NONE',
                              export_image_format='AUTO', export_extras=False)
    json.dump(dict(total=total, draws=draws, per=stats,
                   centres={k: [round(META['centres'][k][0], 4), round(META['centres'][k][2], 4), round(-META['centres'][k][1], 4)] for k in META['centres']}),
              open(os.path.join(WORK, f'{LOD}_stats.json'), 'w'), indent=1)
    print('WROTE', path)


main()
