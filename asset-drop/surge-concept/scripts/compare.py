"""Side-by-side profile of several cars at the same scale (orthographic camera).
  blender -b -P compare.py -- out.jpg label1=car1.glb label2=car2.glb ...
Cars are lined up nose-to-tail along the length axis, all facing the same way."""
import bpy, sys, math, mathutils
args = sys.argv[sys.argv.index('--') + 1:]
out = args[0]; cars = [a.split('=', 1) for a in args[1:]]
FONT = '/usr/share/fonts/truetype/sand-box/google/Barlow Condensed/BarlowCondensed-Bold.ttf'
bpy.ops.wm.read_factory_settings(use_empty=True)
GAP = 5.4
n = len(cars)
for i, (label, path) in enumerate(cars):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    off = (i - (n - 1) / 2) * GAP
    for o in new:
        if o.parent is None:
            o.location.y += off
    cu = bpy.data.curves.new('t', 'FONT'); cu.body = label; cu.size = 0.36; cu.align_x = 'CENTER'
    cu.font = bpy.data.fonts.load(FONT, check_existing=True)
    t = bpy.data.objects.new('lbl', cu); bpy.context.scene.collection.objects.link(t)
    t.location = (1.6, off, -0.55); t.rotation_euler = (math.radians(90), 0, math.radians(90))
    m = bpy.data.materials.new('lm'); m.use_nodes = True
    bs = m.node_tree.nodes['Principled BSDF']; bs.inputs['Emission Color'].default_value = (0.8, 0.85, 0.9, 1); bs.inputs['Emission Strength'].default_value = 2
    cu.materials.append(m)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 48; sc.cycles.use_denoising = True
sc.render.resolution_x = 2000; sc.render.resolution_y = int(2000 * 0.21)
sc.view_settings.view_transform = 'AgX'
sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 90
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.02, 0.022, 0.03, 1)
bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, 0))
pl = bpy.context.active_object; m = bpy.data.materials.new('g'); m.use_nodes = True
m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.004, 0.004, 0.005, 1)
m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.75
m.node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value = 0.15
pl.data.materials.append(m)
bpy.ops.object.light_add(type='SUN', rotation=(math.radians(50), 0, math.radians(30))); bpy.context.active_object.data.energy = 3.5
for x, y, e in ((6, 0, 2500), (0, 0, 0)):
    pass
bpy.ops.object.light_add(type='AREA', location=(5, 0, 6)); L = bpy.context.active_object
L.data.shape = 'RECTANGLE'; L.data.size = 4; L.data.size_y = 18; L.data.energy = 3000
L.rotation_euler = (0, math.radians(35), 0)
bpy.ops.object.light_add(type='AREA', location=(0, 0, 7)); L = bpy.context.active_object
L.data.shape = 'RECTANGLE'; L.data.size = 3; L.data.size_y = 18; L.data.energy = 1500
cam = bpy.data.cameras.new('c'); cam.type = 'ORTHO'; cam.ortho_scale = GAP * n + 0.6
co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co); sc.camera = co
co.location = (20, 0, 0.55); co.rotation_euler = (math.radians(90), 0, math.radians(90))
cam.shift_y = 0.02
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print('WROTE', out)
