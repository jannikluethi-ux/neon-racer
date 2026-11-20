import bpy, sys, math, mathutils, os, json

argv = sys.argv[sys.argv.index('--')+1:]
glb = argv[0]
prefix = argv[1]
views = argv[2].split(',')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = int(os.environ.get('SAMPLES','48'))
sc.cycles.use_denoising = True
sc.render.resolution_x = 1280
sc.render.resolution_y = 720
sc.view_settings.view_transform = 'AgX'
sc.render.image_settings.file_format = 'JPEG'
sc.render.image_settings.quality = 90

w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
bg = w.node_tree.nodes['Background']
bg.inputs[0].default_value = (0.02, 0.022, 0.03, 1)
bg.inputs[1].default_value = 1.0

bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, 0))
pl = bpy.context.active_object
m = bpy.data.materials.new('g'); m.use_nodes = True
m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.004, 0.004, 0.005, 1)
m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.75
m.node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value = 0.15
pl.data.materials.append(m)

bpy.ops.object.light_add(type='SUN', rotation=(math.radians(50), 0, math.radians(30)))
bpy.context.active_object.data.energy = 3.5
bpy.ops.object.light_add(type='AREA', location=(0, 0, 6))
L = bpy.context.active_object; L.data.energy = 800; L.data.size = 6

for loc,en,sz,col in [((6,-4,3),600,4,(0.8,0.88,1.0)),((-6,4,3),450,4,(1.0,0.75,0.95)),((-5,-6,2.5),300,3,(1,1,1))]:
    bpy.ops.object.light_add(type='AREA', location=loc)
    Lr=bpy.context.active_object; Lr.data.energy=en; Lr.data.size=sz; Lr.data.color=col
    d=mathutils.Vector((0,0,0.5))-Lr.location; Lr.rotation_euler=d.to_track_quat('-Z','Y').to_euler()
cam = bpy.data.cameras.new('c'); cam.lens = 50
co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co); sc.camera = co

# blender after glTF import: front is -Y, left is +X, Z up (same as Vector)
tgt = mathutils.Vector((0, 0.05, 0.60))
V = {
    'front34': (5.2, -6.2, 2.0),
    'side': (8.5, 0.1, 1.2),
    'rear34': (-5.2, 6.4, 2.2),
    'top': (0.01, 0.2, 11),
    'front': (0.0, -9, 1.0),
    'rear': (0, 9.5, 1.4),
    'low34': (4.0, -5.0, 0.5),
    'wheel': (2.6, -2.6, 0.6),
}
# wheel target: front-left wheel roughly
# we'll refine from objects named Wheel_FL if present
wheel_t = mathutils.Vector((0.85, -1.35, 0.36))
for o in bpy.data.objects:
    if o.name.startswith('Wheel_FL') or o.name == 'Wheel_FL':
        wheel_t = o.matrix_world.translation.copy()
        break

os.makedirs(os.path.dirname(prefix) or '.', exist_ok=True)
for v in views:
    if v == 'wheel':
        cam.lens = 70
        co.location = V[v]
        t = wheel_t
    elif v == 'top':
        cam.lens = 50
        co.location = V[v]
        t = tgt
    else:
        cam.lens = 50
        co.location = V[v]
        t = tgt
    d = t - co.location
    co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = prefix + v + '.jpg'
    bpy.ops.render.render(write_still=True)
    print('WROTE', sc.render.filepath)
