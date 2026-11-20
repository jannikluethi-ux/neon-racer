#!/usr/bin/env python3
"""Stage 1: import the Kralzfiller Trackday V10 source, delete junk / branding,
re-centre and scale to the Neon Racer frame, classify every mesh, and export
one GLB per category for meshoptimizer (gltfpack) simplification.

  blender -b -P clean.py
Blender frame after glTF import: Z up, car front = -Y, car left = +X
(same as Vanta / Vector).  Exported with +Y up => glTF front = +Z.
"""
import bpy, bmesh, json, os, re
from mathutils import Vector, Matrix

SRC = '/workspace/aegis/src/scene.gltf'
WORK = '/workspace/aegis/work'
PARTS = os.path.join(WORK, 'parts')
TARGET_LEN = 4.50
os.makedirs(PARTS, exist_ok=True)

DROP_MATS = {
    'Material.013',      # donut-textured nose badge
    'Material.001',      # glowing "TRACKDAY V10" wing text
    'material_0',        # "Text" mesh on the wing
    'CSR2_InteriorA',    # dash display plates from another game asset
    'material_33',       # 4-tri stray quad
    'wiper',             # wiper arms / rod across the canopy
    'd_glass',           # duplicate, fully transparent canopy shell (win_int kept)
}
DROP_OBJS = {'Object_143',               # 2-tri stray quad under the cockpit
             'Object_25', 'Object_27', 'Object_45', 'Object_47'}  # sidepod vanes covering the door number area

CAT = {
    'PAINT': ['body.004', 'paint.004', 'body.005', 'body.006', 'paint.005', 'paint.006'],
    'CARBON': ['carbon_ext_ao', 'black_shiny', 'body.007', 'CARBFBD', 'Aphong3SG1',
               'Aphong2SG1', 'black1', 'Material.002', 'Material.003', 'silver'],
    'MATTE': ['black_matt', 'Sm83t0031Mtl', 'r_glass'],
    'INTERIOR': ['steer_misc', 'steer_alca', 'steer_metal', 'carbon_steer', 'steer_plastic',
                 'carbon_int', 'interior', 'alca_int', 'mirror'],
    'METAL': ['COCKPIT_DAMAGE', 'material.003'],
    'GLASS': ['win_int'],
    'LIGHT_W': ['lights.003', 'lights.004'],
    'LIGHT_R': ['r_lights'],
    # wheel (spins)
    'TYRE': ['EXT_Tyre'], 'RIM': ['material_21'], 'CAP': ['rim_black'],
    'NUT': ['rim_silver'], 'BARREL': ['rim_int'], 'DISC': ['EXT_Disc'],
    # caliper / upright (steers, no spin)
    'CALIPER': ['EXT_Calipers'], 'UPRIGHT': ['EXT_Details_MULTIMAP', 'EXT_Mechanicals_METAL'],
}
WHEEL_CATS = {'TYRE', 'RIM', 'CAP', 'NUT', 'BARREL', 'DISC'}
CAL_CATS = {'CALIPER', 'UPRIGHT'}
UPRIGHT_OBJS = {'Object_801', 'Object_843'}   # black_shiny hub carriers inside the front wheels


def base(n):
    n = n or ''
    return re.sub(r'\.\d{3}$', '', n)


ALLN = DROP_MATS.union(*[set(v) for v in CAT.values()])


def matcat(mname):
    b = mname if mname in ALLN else base(mname)
    if b in DROP_MATS:
        return 'DROP'
    for c, lst in CAT.items():
        if b in lst:
            return c
    return None


def tris(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
bpy.context.view_layer.update()

# unparent keep world transforms, make single-user, apply
for o in list(bpy.data.objects):
    if o.type == 'MESH':
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
for o in list(bpy.data.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
for o in bpy.data.objects:
    if o.data.users > 1:
        o.data = o.data.copy()
    o.data.transform(o.matrix_world)
    o.matrix_world = Matrix.Identity(4)

removed = []
cats = {}
for o in list(bpy.data.objects):
    mats = [m.name if m else None for m in o.data.materials]
    c = matcat(mats[0]) if mats else None
    if o.name in DROP_OBJS or c == 'DROP':
        removed.append((o.name, mats[0], tris(o)))
        bpy.data.objects.remove(o, do_unlink=True)
        continue
    if o.name in UPRIGHT_OBJS:
        c = 'UPRIGHT'
    if c is None:
        raise SystemExit(f'unclassified {o.name} {mats}')
    o['cat'] = c

# wheel centres from tyre bounding boxes
tyres = [o for o in bpy.data.objects if o['cat'] == 'TYRE']
def bbox(objs):
    pts = [v.co for o in objs for v in o.data.vertices]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx
corners = {}
for t in tyres:
    mn, mx = bbox([t])
    c = (mn + mx) / 2
    key = ('L' if c.x > 0 else 'R')
    key = ('F' if c.y < 10 else 'R') + key
    corners[key] = dict(c=c, r=(mx.z - mn.z) / 2, w=mx.x - mn.x)
print('raw corners', {k: (tuple(round(x, 3) for x in v['c']), round(v['r'], 3)) for k, v in corners.items()})

allmn, allmx = bbox(list(bpy.data.objects))
length = allmx.y - allmn.y
s = TARGET_LEN / length
ground = min(v['c'].z - v['r'] for v in corners.values())
ground = min(ground, allmn.z)
ymid = (corners['FL']['c'].y + corners['RL']['c'].y) / 2
xmid = (allmn.x + allmx.x) / 2
M = Matrix.Scale(s, 4) @ Matrix.Translation(Vector((-xmid, -ymid, -ground)))
print(f'raw length {length:.3f} scale {s:.5f} ground {ground:.4f} ymid {ymid:.4f} xmid {xmid:.4f}')
for o in bpy.data.objects:
    o.data.transform(M)
for k, v in corners.items():
    v['c'] = M @ v['c']; v['r'] *= s; v['w'] *= s

def corner_of(o):
    mn, mx = bbox([o]); c = (mn + mx) / 2
    return min(corners, key=lambda k: (corners[k]['c'] - c).length)

groups = {}
for o in bpy.data.objects:
    c = o['cat']
    if c in WHEEL_CATS or c in CAL_CATS:
        key = f"{c}_{corner_of(o)}"
    else:
        key = c
    groups.setdefault(key, []).append(o)

def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
        # strip attributes so the join is clean; materials re-assigned later
        me = o.data
        while me.uv_layers:
            me.uv_layers.remove(me.uv_layers[0])
        for a in list(me.color_attributes):
            me.color_attributes.remove(a)
        me.materials.clear()
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name; ob.data.name = name
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    ob.data.materials.append(m)
    # merge coincident verts, drop loose geometry
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0003)
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(ob.data); bm.free()
    return ob

meta = dict(scale=s, ground=ground, ymid=ymid, xmid=xmid, removed=removed,
            corners={k: dict(c=list(v['c']), r=v['r'], w=v['w']) for k, v in corners.items()},
            groups={})
for key, objs in groups.items():
    ob = join(objs, key)
    t = tris(ob)
    meta['groups'][key] = t
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(PARTS, key + '.glb'), export_format='GLB',
                              use_selection=True, export_yup=True, export_apply=True,
                              export_normals=True, export_materials='PLACEHOLDER',
                              export_cameras=False, export_lights=False, export_animations=False)
    print(f'  {key:12s} {t:7d} tris')
allmn, allmx = bbox(list(bpy.data.objects))
meta['bbox'] = [list(allmn), list(allmx)]
print('final bbox', tuple(round(x, 3) for x in allmn), tuple(round(x, 3) for x in allmx))
json.dump(meta, open(os.path.join(WORK, 'clean_meta.json'), 'w'), indent=1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, 'aegis_clean.blend'))
print('removed', removed)
