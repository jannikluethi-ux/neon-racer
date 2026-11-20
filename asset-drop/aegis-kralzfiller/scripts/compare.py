"""Side-by-side profile (orthographic = identical scale) of Aegis, Vanta, Vector.
  blender -b -P compare.py -- aegis.glb vanta.glb vector.glb out.jpg"""
import bpy, sys, math, mathutils
a = sys.argv[sys.argv.index('--')+1:]
cars = [('AEGIS #88', a[0]), ('VANTA #04', a[1]), ('VECTOR', a[2])]
out = a[3]
FONT = '/usr/share/fonts/truetype/sand-box/google/Barlow Condensed/BarlowCondensed-Bold.ttf'
bpy.ops.wm.read_factory_settings(use_empty=True)
SP = 5.2
for i, (label, path) in enumerate(cars):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    dy = (i - 1) * SP           # Aegis at the front (-Y) => left of frame seen from +X
    for o in new:
        if o.parent is None:
            o.location.y += dy
    cu = bpy.data.curves.new('t', 'FONT'); cu.body = label; cu.font = bpy.data.fonts.load(FONT)
    cu.size = 0.42; cu.align_x = 'CENTER'
    t = bpy.data.objects.new('lbl', cu); bpy.context.scene.collection.objects.link(t)
    t.location = (1.4, dy, 1.75); t.rotation_euler = (math.radians(90), 0, math.radians(90))
    m = bpy.data.materials.new('lbl'); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Emission Color'].default_value = (0.75, 0.9, 1, 1)
    b.inputs['Emission Strength'].default_value = 3; b.inputs['Base Color'].default_value = (0, 0, 0, 1)
    cu.materials.append(m)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 48; sc.cycles.use_denoising = True
sc.render.resolution_x = 2000; sc.render.resolution_y = 540
sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 90
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.012, 0.014, 0.022, 1)
bpy.ops.mesh.primitive_plane_add(size=80)
pl = bpy.context.active_object; m = bpy.data.materials.new('f'); m.use_nodes = True
m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.01, 0.011, 0.014, 1)
m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.45
pl.data.materials.append(m)
for loc, e, s in (((0, 0, 7), 2600, 14), ((8, 0, 2.5), 1400, 12), ((-6, 0, 3), 500, 12)):
    bpy.ops.object.light_add(type='AREA', location=loc)
    L = bpy.context.active_object; L.data.energy = e; L.data.shape = 'RECTANGLE'; L.data.size = 3; L.data.size_y = s
    L.rotation_euler = (mathutils.Vector((0, 0, 0.5)) - L.location).to_track_quat('-Z', 'Y').to_euler()
cam = bpy.data.cameras.new('c'); cam.type = 'ORTHO'; cam.ortho_scale = 15.8
co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co); sc.camera = co
co.location = (20, 0, 1.05); co.rotation_euler = (math.radians(90), 0, math.radians(90))
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print('WROTE', out)
