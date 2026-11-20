#!/usr/bin/env python3
"""Stage A: clean + normalise the KTKR "Concept Sport Car" source for Surge.

  blender -b -P clean.py
Writes work/clean.blend and work/clean_meta.json (wheel centres etc.).
Blender axes here: front = -Y, left = +X, up = +Z (exports to glTF +Z front, +Y up).
"""
import bpy, bmesh, json, math, os
from mathutils import Vector, Matrix

SRC = '/workspace/surge/src/scene.gltf'
WORK = '/workspace/surge/work'
TARGET_LEN = 4.50          # first pass; then rescaled so the wheelbase matches the game
TARGET_WB = 2.82           # game's SURGE wheelbase (car-model.ts frontAxleZ 1.32 - rearAxleZ -1.50)

# junk / helpers: zero-volume line at the cowl (48 degenerate faces)
JUNK = {'Object_56'}
WHEEL_SRC = {'Object_4', 'Object_5', 'Object_7', 'Object_8', 'Object_50', 'Object_52'}
TYRES = {'Object_50', 'Object_52'}

# per-object class overrides (else by source material)
OBJ_CLASS = {
    'Object_16': 'INTERIOR',   # cockpit tub
    'Object_60': 'CARBON',     # vented hood panel in front of the screen
    'Object_88': 'GLOSS', 'Object_90': 'GLOSS', 'Object_92': 'GLOSS',  # roof (was copper)
    'Object_74': 'GUNMETAL',   # front intake surrounds (was copper)
    'Object_40': 'PLATE',      # blank rear licence plate -> race-number plate
}
MAT_CLASS = {
    'Material.008': 'PAINT',
    'Material.002': 'CARBON',
    'Material.007': 'GUNMETAL',
    'Material.004': 'GUNMETAL',
    'Material.005': 'LIGHT_W',
    'Material.006': 'LIGHT_R',
    'Material.003': 'GLASS',
    'Material.001': 'GUNMETAL',
    'Material.009': 'TYRE',
    'FENDER': 'RIM',
}


def meshes():
    return [o for o in bpy.data.objects if o.type == 'MESH']


def tris(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
    bpy.context.view_layer.update()
    # unparent, single user, apply transforms
    for o in meshes():
        if o.data.users > 1:
            o.data = o.data.copy()
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    for o in list(bpy.data.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    for o in meshes():
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
    for n in JUNK:
        if n in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[n], do_unlink=True)

    # tag class per face via a custom int attribute; keep source mat name
    for o in meshes():
        src = o.data.materials[0].name if o.data.materials else ''
        o['cls'] = OBJ_CLASS.get(o.name, MAT_CLASS.get(src, 'CARBON'))
        o['src_mat'] = src

    # weld + clean degenerate geometry per object
    for o in meshes():
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
        bm.to_mesh(o.data); bm.free()

    # ----- normalise: scale to TARGET_LEN, ground at z=0, axle midpoint at y=0
    mn = Vector((1e9,) * 3); mx = -mn
    for o in meshes():
        for v in o.data.vertices:
            mn = Vector(map(min, mn, v.co)); mx = Vector(map(max, mx, v.co))
    s = TARGET_LEN / (mx.y - mn.y)
    S = Matrix.Scale(s, 4)
    for o in meshes():
        o.data.transform(S)
    # wheel centres from tyre islands
    def islands(o):
        bm = bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table()
        seen = set(); out = []
        for v in bm.verts:
            if v.index in seen: continue
            stack = [v]; comp = []
            seen.add(v.index)
            while stack:
                a = stack.pop(); comp.append(a.index)
                for e in a.link_edges:
                    b = e.other_vert(a)
                    if b.index not in seen:
                        seen.add(b.index); stack.append(b)
            out.append(comp)
        bm.free(); return out
    centres = {}
    radius = {}
    for tn in TYRES:
        o = bpy.data.objects[tn]
        for comp in islands(o):
            pts = [o.data.vertices[i].co for i in comp]
            a = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
            b = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
            if len(pts) < 50: continue
            c = (a + b) / 2
            side = 'L' if c.x > 0 else 'R'
            axle = 'F' if c.y < 0.3 else 'R'  # front is -Y; source front axle y~0
            key = axle + side
            centres[key] = c
            radius[key] = (b.z - a.z) / 2
            print('tyre', tn, key, tuple(round(x, 4) for x in c), 'r', round(radius[key], 4), 'w', round(b.x - a.x, 4))
    # uniform rescale so the wheelbase equals the game's Surge wheelbase
    wb = abs(centres['RL'].y - centres['FL'].y)
    f = TARGET_WB / wb
    F = Matrix.Scale(f, 4)
    for o in meshes():
        o.data.transform(F)
    for k in centres:
        centres[k] = centres[k] * f; radius[k] *= f
    s *= f
    print('wheelbase rescale', round(wb, 4), '->', TARGET_WB, 'factor', round(f, 5), 'total scale', round(s, 5))
    ground = min(centres[k].z - radius[k] for k in centres)
    mid_y = (centres['FL'].y + centres['RL'].y + centres['FR'].y + centres['RR'].y) / 4
    T = Matrix.Translation((0, -mid_y, -ground))
    for o in meshes():
        o.data.transform(T)
    for k in centres:
        centres[k] = T @ centres[k]

    # ----- split wheel objects into per-wheel objects by island centroid
    per_wheel = {k: [] for k in centres}
    for wn in WHEEL_SRC:
        o = bpy.data.objects[wn]
        comps = islands(o)
        assign = {}
        for ci, comp in enumerate(comps):
            c = sum((o.data.vertices[i].co for i in comp), Vector()) / len(comp)
            key = min(centres, key=lambda k: (centres[k] - c).length)
            for i in comp: assign[i] = key
        for key in centres:
            bpy.ops.object.select_all(action='DESELECT')
            dup = o.copy(); dup.data = o.data.copy(); bpy.context.scene.collection.objects.link(dup)
            bm = bmesh.new(); bm.from_mesh(dup.data); bm.verts.ensure_lookup_table()
            kill = [v for v in bm.verts if assign.get(v.index) != key]
            bmesh.ops.delete(bm, geom=kill, context='VERTS')
            bm.to_mesh(dup.data); bm.free()
            if len(dup.data.polygons) == 0:
                bpy.data.objects.remove(dup, do_unlink=True); continue
            dup.name = f'{wn}_{key}'
            dup['wheel'] = key
            per_wheel[key].append(dup.name)
        bpy.data.objects.remove(o, do_unlink=True)

    # source front tyres float ~1 cm above the ground plane: drop them onto it
    for key in per_wheel:
        lift = centres[key].z - radius[key]
        if lift > 1e-4:
            for name in per_wheel[key]:
                bpy.data.objects[name].data.transform(Matrix.Translation((0, 0, -lift)))
            centres[key] = centres[key] - Vector((0, 0, lift))
            print('lowered wheel', key, round(lift, 4))

    # remove hub + centre-cap logo islands (replaced by a clean procedural cap)
    removed = 0
    for key, names in per_wheel.items():
        c0 = centres[key]; lim = 0.24 * radius[key]
        for name in names:
            if name.startswith(tuple(TYRES)): continue
            o = bpy.data.objects[name]
            bm = bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table()
            kill = []
            for comp in islands(o):
                rr = max(math.hypot(o.data.vertices[i].co.y - c0.y, o.data.vertices[i].co.z - c0.z) for i in comp)
                pts = [o.data.vertices[i].co for i in comp]
                diag = (Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))) -
                        Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))).length
                # hub + logo cap, and the 20 small lip bolts (turn into spikes when simplified)
                if rr < lim or (diag < 0.07 and len(comp) < 200):
                    kill.extend(bm.verts[i] for i in comp)
            removed += len(kill)
            bmesh.ops.delete(bm, geom=kill, context='VERTS')
            bm.to_mesh(o.data); bm.free()
    print('hub/logo verts removed', removed)
    for key in list(per_wheel):
        keep = []
        for name in per_wheel[key]:
            o = bpy.data.objects[name]
            if len(o.data.polygons) == 0: bpy.data.objects.remove(o, do_unlink=True)
            else: keep.append(name)
        per_wheel[key] = keep

    # island diagnostics for one wheel (rim parts / centre caps / brakes)
    diag = []
    for name in per_wheel['FL']:
        o = bpy.data.objects[name]
        c0 = centres['FL']
        for comp in islands(o):
            pts = [o.data.vertices[i].co for i in comp]
            rr = [math.hypot(p.y - c0.y, p.z - c0.z) for p in pts]
            xs = [p.x - c0.x for p in pts]
            diag.append((name, len(comp), round(min(rr), 3), round(max(rr), 3), round(min(xs), 3), round(max(xs), 3)))
    diag.sort(key=lambda d: (d[0], -d[1]))
    for d in diag[:12]:
        print('FLisl', d)

    meta = dict(scale=s, wb_factor=f, centres={k: list(v) for k, v in centres.items()},
                radius=radius, per_wheel=per_wheel)
    json.dump(meta, open(os.path.join(WORK, 'clean_meta.json'), 'w'), indent=1)
    tot = 0
    for o in sorted(meshes(), key=lambda o: o.name):
        t = tris(o); tot += t
    print('TOTAL tris', tot)
    mn = Vector((1e9,) * 3); mx = -mn
    for o in meshes():
        for v in o.data.vertices:
            mn = Vector(map(min, mn, v.co)); mx = Vector(map(max, mx, v.co))
    print('BBOX', tuple(round(x, 4) for x in mn), tuple(round(x, 4) for x in mx))
    cls = {o.name: o.get('cls', 'WHEEL') for o in meshes()}
    meta['cls'] = cls
    json.dump(meta, open(os.path.join(WORK, 'clean_meta.json'), 'w'), indent=1)
    # export geometry-only parts for meshoptimizer
    def export(objs, path):
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs: o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB',
                                  export_normals=False, export_texcoords=False,
                                  export_materials='NONE', export_yup=True, export_apply=True)
    wheel_names = {n for v in per_wheel.values() for n in v}
    export([o for o in meshes() if o.name not in wheel_names], os.path.join(WORK, 'parts', 'body.glb'))
    export([o for o in meshes() if o.name in wheel_names], os.path.join(WORK, 'parts', 'wheels.glb'))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, 'clean.blend'))


main()
