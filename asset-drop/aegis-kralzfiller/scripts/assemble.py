#!/usr/bin/env python3
"""Stage 3: assemble one Aegis LOD from the simplified parts.
  blender -b -P assemble.py -- LOD0|LOD1|LOD2
Materials (4): BODY (atlas, clearcoat), WHEEL (same atlas, no clearcoat),
GLASS (dark tint, alpha blend), LIGHT (2-px emissive palette).
Nodes: Aegis_LODn > Body, Wheel_FL/FR/RL/RR, Caliper_FL/FR/RL/RR  -> 11 draw calls.
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector, Matrix

WORK = '/workspace/aegis/work'; OUT = '/workspace/aegis/out'
SIMP = f'{WORK}/simp'
LOD = sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else 'LOD0'
meta = json.load(open(f'{WORK}/clean_meta.json'))
atlas = json.load(open(f'{WORK}/atlas.json'))
UV = atlas['uv']
CORNERS = {k: Vector(v['c']) for k, v in meta['corners'].items()}
BODY_CATS = ['PAINT', 'CARBON', 'MATTE', 'INTERIOR', 'METAL']
WHEEL_CATS = ['TYRE', 'RIM', 'CAP', 'NUT', 'BARREL', 'DISC']
CAL_CATS = ['CALIPER', 'UPRIGHT']

# Decal boxes (Blender frame: front -Y, left +X, Z up).  'plate' is where the
# plate sits on the tile; the whole tile maps to the padded box.
DECALS = [
    # name, axis, sign, (a0,a1) along u-axis coord, (b0,b1) along v-axis coord, tile
    # door plates sit on the flat cockpit-pod side behind the front wheel
    # (plate y -0.38..0.22, z 0.28..0.68 = central 70 % of the tile)
    dict(name='door_L', side=+1, y=(-0.509, 0.349), z=(0.194, 0.766), xmax=0.75, tile='door'),
    dict(name='door_R', side=-1, y=(-0.509, 0.349), z=(0.194, 0.766), xmax=0.75, tile='door'),
    # nose plate split by the carbon centre strip
    dict(name='nose', side=0, x=(-0.48, 0.48), y=(-2.12, -1.68), tile='nose'),
]


def tris(o):
    o.data.calc_loop_triangles(); return len(o.data.loop_triangles)


def load_img(path, noncolor=False):
    im = bpy.data.images.load(path)
    if noncolor:
        im.colorspace_settings.name = 'Non-Color'
    im.pack()
    return im


def mat_atlas(name, coat):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; bs = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = IMG; t.interpolation = 'Linear'; t.extension = 'EXTEND'
    nt.links.new(t.outputs['Color'], bs.inputs['Base Color'])
    t2 = nt.nodes.new('ShaderNodeTexImage'); t2.image = IMG_MR; t2.extension = 'EXTEND'
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(t2.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bs.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bs.inputs['Metallic'])
    bs.inputs['Coat Weight'].default_value = coat
    bs.inputs['Coat Roughness'].default_value = 0.06
    m.use_backface_culling = False
    return m


def make_mats():
    body = mat_atlas('BODY', 0.8)
    wheel = mat_atlas('WHEEL', 0.0)
    g = bpy.data.materials.new('GLASS'); g.use_nodes = True
    bs = g.node_tree.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = (0.004, 0.006, 0.010, 1)
    bs.inputs['Roughness'].default_value = 0.05
    bs.inputs['Alpha'].default_value = 0.90
    bs.inputs['Coat Weight'].default_value = 1.0
    bs.inputs['Coat Roughness'].default_value = 0.03
    g.blend_method = 'BLEND'; g.use_backface_culling = False
    l = bpy.data.materials.new('LIGHT'); l.use_nodes = True
    bs = l.node_tree.nodes['Principled BSDF']
    pal = bpy.data.images.new('aegis_light_palette', 2, 1)
    pal.pixels = [0.80, 0.92, 1.0, 1.0, 1.0, 0.04, 0.03, 1.0]; pal.pack()
    t = l.node_tree.nodes.new('ShaderNodeTexImage'); t.image = pal; t.interpolation = 'Closest'; t.extension = 'EXTEND'
    l.node_tree.links.new(t.outputs['Color'], bs.inputs['Emission Color'])
    l.node_tree.links.new(t.outputs['Color'], bs.inputs['Base Color'])
    bs.inputs['Emission Strength'].default_value = 8.0
    bs.inputs['Roughness'].default_value = 0.25
    l.use_backface_culling = False
    return dict(BODY=body, WHEEL=wheel, GLASS=g, LIGHT=l)


def import_part(part):
    p = f'{SIMP}/{part}_{LOD}.glb'
    if not os.path.exists(p):
        return None
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=p)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    bpy.context.view_layer.update()
    for o in meshes:
        mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
        o.data.transform(o.matrix_world); o.matrix_world = Matrix.Identity(4)
    for o in new:
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    if len(meshes) > 1:
        join(meshes, part)
    o = meshes[0]; o.name = part
    return o


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name; ob.data.name = name
    return ob


def prep(o, mat, u, v):
    me = o.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    uvl = me.uv_layers.new(name='UVMap')
    for d in uvl.data:
        d.uv = (u, v)
    me.materials.clear(); me.materials.append(mat)


def shade(o, angle):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
    bpy.context.view_layer.objects.active = o
    try:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    except Exception:
        pass
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    m = o.modifiers.new('wn', 'WEIGHTED_NORMAL'); m.mode = 'FACE_AREA'; m.keep_sharp = True; m.weight = 50
    bpy.ops.object.modifier_apply(modifier='wn')


def apply_decals(o):
    """Planar-project the #88 tiles onto paint faces inside each decal box.
    Faces are first cut exactly on the box edges (bmesh bisect), so every
    mapped face lies fully inside its box and no UV ever needs clamping."""
    me = o.data
    bm = bmesh.new(); bm.from_mesh(me)
    T = atlas['tiles']; N = 1024.0
    count = {}
    eps = 1e-5
    for dc in DECALS:
        if dc['side']:
            ax = [('y', 1, dc['y']), ('z', 2, dc['z'])]
        else:
            ax = [('x', 0, dc['x']), ('y', 1, dc['y'])]

        def ok_side(f):
            c = f.calc_center_median(); nr = f.normal
            if dc['side']:
                return (dc['side']*c.x >= 0.3 and dc['side']*c.x <= dc['xmax']
                        and dc['side']*nr.x >= 0.25)
            return nr.z >= 0.35

        def touches(f):
            for _, i, (a0, a1) in ax:
                vs = [v.co[i] for v in f.verts]
                if max(vs) < a0 or min(vs) > a1:
                    return False
            return True
        for _, i, (a0, a1) in ax:
            for a in (a0, a1):
                sub = [f for f in bm.faces if touches(f) and ok_side(f)]
                if not sub:
                    continue
                geom = list(set([e for f in sub for e in f.edges] + [v for f in sub for v in f.verts])) + sub
                no = Vector((0, 0, 0)); no[i] = 1.0
                co = Vector((0, 0, 0)); co[i] = a
                bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=co, plane_no=no)
        bm.faces.ensure_lookup_table()
        uvl = bm.loops.layers.uv.active
        x0, y0, x1, y1 = T[dc['tile']]
        u0, u1 = x0/N, x1/N
        v0, v1 = 1-y1/N, 1-y0/N
        n = 0
        for f in bm.faces:
            inside = all(a0-eps <= v.co[i] <= a1+eps for _, i, (a0, a1) in ax for v in f.verts)
            if not inside or not ok_side(f):
                continue
            n += 1
            for l in f.loops:
                p = l.vert.co
                if dc['side'] > 0:     # viewer at +X: front on the left
                    s_ = (p.y-dc['y'][0])/(dc['y'][1]-dc['y'][0]); t = (p.z-dc['z'][0])/(dc['z'][1]-dc['z'][0])
                elif dc['side'] < 0:   # viewer at -X: front on the right
                    s_ = (dc['y'][1]-p.y)/(dc['y'][1]-dc['y'][0]); t = (p.z-dc['z'][0])/(dc['z'][1]-dc['z'][0])
                else:                  # top view, read from behind (digit tops toward the nose)
                    s_ = (dc['x'][1]-p.x)/(dc['x'][1]-dc['x'][0]); t = (dc['y'][1]-p.y)/(dc['y'][1]-dc['y'][0])
                s_ = min(1, max(0, s_)); t = min(1, max(0, t))
                l[uvl].uv = (u0+s_*(u1-u0), v0+t*(v1-v0))
        count[dc['name']] = n
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(me); bm.free()
    print('decal faces', count)


bpy.ops.wm.read_factory_settings(use_empty=True)
IMG = load_img(f'{WORK}/aegis_atlas.png'); IMG.name = 'aegis_atlas'
IMG_MR = load_img(f'{WORK}/aegis_atlas_mr.png', True); IMG_MR.name = 'aegis_atlas_mr'
M = make_mats()

body_parts = []
for cat in BODY_CATS:
    o = import_part(cat)
    if o is None:
        continue
    prep(o, M['BODY'], *UV[cat])
    shade(o, 30 if cat in ('PAINT', 'CARBON') else 40)
    if cat == 'PAINT':
        apply_decals(o)
    body_parts.append(o)
for cat, u in (('GLASS', None), ('LIGHT_W', 0.25), ('LIGHT_R', 0.75)):
    o = import_part(cat)
    if o is None:
        continue
    prep(o, M['GLASS'] if cat == 'GLASS' else M['LIGHT'], u or 0.5, 0.5)
    shade(o, 40)
    body_parts.append(o)
body = join(body_parts, 'Body')

root = bpy.data.objects.new(f'Aegis_{LOD}', None)
bpy.context.scene.collection.objects.link(root)
for cn, c in CORNERS.items():
    for kind, cats in (('Wheel', WHEEL_CATS), ('Caliper', CAL_CATS)):
        parts = []
        for cat in cats:
            o = import_part(f'{cat}_{cn}')
            if o is None:
                continue
            prep(o, M['WHEEL'], *UV[cat])
            shade(o, 35)
            parts.append(o)
        if not parts:
            continue
        w = join(parts, f'{kind}_{cn}')
        w.data.transform(Matrix.Translation(-c))
        w.location = c
        w.parent = root
body.parent = root

bpy.context.view_layer.update()
per = {o.name: tris(o) for o in bpy.data.objects if o.type == 'MESH'}
total = sum(per.values())
pts = [o.matrix_world @ v.co for o in bpy.data.objects if o.type == 'MESH' for v in o.data.vertices]
mn = Vector([min(p[i] for p in pts) for i in range(3)]); mx = Vector([max(p[i] for p in pts) for i in range(3)])
g = lambda v: [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]
res = dict(lod=LOD, total=total, per=per,
           wheel_centres_gltf={k: g(v) for k, v in CORNERS.items()},
           tyre_radius={k: round(v['r'], 4) for k, v in meta['corners'].items()},
           bbox_gltf=[g(Vector((mn.x, mx.y, mn.z))), g(Vector((mx.x, mn.y, mx.z)))],
           length=round(mx.y-mn.y, 4), width=round(mx.x-mn.x, 4), height=round(mx.z-mn.z, 4),
           wheelbase=round(abs(CORNERS['FL'].y-CORNERS['RL'].y), 4),
           track_f=round(abs(CORNERS['FL'].x-CORNERS['FR'].x), 4),
           track_r=round(abs(CORNERS['RL'].x-CORNERS['RR'].x), 4))
print('RESULT', json.dumps(res))
json.dump(res, open(f'{WORK}/{LOD}_meta.json', 'w'), indent=1)
out = f'{OUT}/aegis_{LOD.lower()}.glb'
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_apply=False,
                          export_cameras=False, export_lights=False, export_animations=False,
                          export_extras=False, export_image_format='AUTO', export_materials='EXPORT')
bpy.ops.wm.save_as_mainfile(filepath=f'{WORK}/aegis_{LOD.lower()}.blend')
print('WROTE', out, total, os.path.getsize(out))
