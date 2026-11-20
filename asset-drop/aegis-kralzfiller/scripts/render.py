"""Cycles preview renders on a dark studio set.
  blender -b -P render.py -- model.glb out_prefix view1,view2 [samples]
Views: front34 side rear34 top wheel front rear low34
Blender after glTF import: front -Y, left +X, Z up."""
import bpy, sys, math, mathutils, os
argv = sys.argv[sys.argv.index('--')+1:]
glb, prefix, views = argv[0], argv[1], argv[2].split(',')
samples = int(argv[3]) if len(argv) > 3 else 64
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'
sc.cycles.samples = samples; sc.cycles.use_denoising = True
sc.cycles.max_bounces = 6; sc.cycles.transparent_max_bounces = 8
sc.render.resolution_x = 1280; sc.render.resolution_y = 720
sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 90
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.012, 0.014, 0.022, 1); bg.inputs[1].default_value = 1.0
# floor: dark glossy studio floor
bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
pl = bpy.context.active_object
m = bpy.data.materials.new('floor'); m.use_nodes = True
b = m.node_tree.nodes['Principled BSDF']
b.inputs['Base Color'].default_value = (0.008, 0.009, 0.012, 1); b.inputs['Roughness'].default_value = 0.45
pl.data.materials.append(m)
def area(loc, energy, size, color=(1, 1, 1)):
    bpy.ops.object.light_add(type='AREA', location=loc)
    L = bpy.context.active_object; L.data.energy = energy; L.data.size = size; L.data.color = color
    d = mathutils.Vector((0, 0, 0.5)) - L.location
    L.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
area((0, 0, 7), 950, 5)                       # big softbox overhead
area((7, -4, 2.5), 700, 4, (0.85, 0.92, 1.0))  # key left-front
area((-7, 3, 2.5), 500, 4, (0.85, 0.92, 1.0))  # fill right-rear
area((0, 8, 2), 500, 5, (0.3, 0.75, 1.0))      # cyan rim from behind
area((0, -8, 2), 350, 5)                       # front fill
cam = bpy.data.cameras.new('c'); co = bpy.data.objects.new('cam', cam)
sc.collection.objects.link(co); sc.camera = co
tgt = mathutils.Vector((0, 0.1, 0.52))
V = {'front34': (5.2, -6.2, 2.0), 'side': (8.6, 0.1, 1.0), 'rear34': (-5.2, 6.4, 2.2),
     'top': (0.01, 0.15, 11), 'front': (0, -9, 1.0), 'rear': (0, 9.5, 1.4),
     'low34': (4.0, -5.0, 0.5), 'wheel': (2.4, -3.0, 0.55), 'sideR': (-8.6, 0.1, 1.0),
     'door': (3.6, -0.6, 1.0), 'nose': (1.2, -4.2, 2.6)}
wheel_t = mathutils.Vector((0.86, -1.39, 0.34))
for o in bpy.data.objects:
    if o.name.startswith('Wheel_FL'):
        wheel_t = o.matrix_world.translation.copy() + mathutils.Vector((0.1, 0, 0))
os.makedirs(os.path.dirname(prefix) or '.', exist_ok=True)
for v in views:
    co.location = V[v]
    cam.lens = 70 if v == 'wheel' else (55 if v in ('door', 'nose') else 50)
    t = wheel_t if v == 'wheel' else tgt
    if v == 'door': t = mathutils.Vector((0.9, -0.2, 0.5))
    if v == 'nose': t = mathutils.Vector((0, -1.8, 0.5))
    co.rotation_euler = (t - co.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = prefix + v + '.jpg'
    bpy.ops.render.render(write_still=True)
    print('WROTE', sc.render.filepath)
