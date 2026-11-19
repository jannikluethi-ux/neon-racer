# Vector GT3 (from "Race Car 01" by toddeppe, CC-BY-4.0) - mobile asset

Units: metres. glTF axes: +Y up, car faces +Z (front), car's left side = +X.
Origin: x=0 centreline, y=0 ground (tyre contact), z=0 midpoint between the axles.
Bounding box: x -1.058..1.058 (2.12 m incl. mirrors), y 0..1.53 (1.27 m roof, 1.53 m antenna tip in the source), z -2.455 (rear wing/diffuser) .. +2.232 (splitter) -> length 4.69 m.
Wheelbase 2.524 m; track front 1.581 m, rear 1.525 m; tyre diameter 0.688 m (radius 0.344).

## Node layout (all LODs)
VectorGT3_LODn
  Body        primitives: BODY (alpha MASK), CHASSIS, GLASS (alpha BLEND), INTERIOR (LOD0 only, untextured)
  Wheel_FL/FR/RL/RR    tyre + rim + hub + nut + brake disc, origin = wheel centre (spin about local X)
  Caliper_FL/FR/RL/RR  brake caliper, origin = wheel centre (steer with the wheel, do not spin)

Wheel centres (x, y, z):
  FL ( 0.7904, 0.3438,  1.2622)   FR (-0.7904, 0.3438,  1.2622)
  RL ( 0.7623, 0.3438, -1.2622)   RR (-0.7623, 0.3438, -1.2622)

## Files
vector_gt3_lod0.glb  (59,843 tris, 16 draw calls, textures 2048 body / 1024 others, PNG+JPEG)
vector_gt3_lod1.glb  (25,004 tris, 15 draw calls, textures 1024 / 512)
vector_gt3_lod2.glb  ( 7,794 tris, 15 draw calls, textures 512 / 256)
*_meshopt_ktx2.glb   same geometry, EXT_meshopt_compression + KHR_mesh_quantization + KHR_texture_basisu
                     (three.js: GLTFLoader + setMeshoptDecoder(MeshoptDecoder) + setKTX2Loader(...))
textures/            cleaned source textures (2048): BODY_baseColor_clean_green.png (branding removed, original colours),
                     BODY_baseColor_cyan.png (suggested cyan livery, used in the GLBs), TIRE_*, GLASS_baseColor.png
previews/            Blender Cycles renders of the final GLBs
scripts/             pipeline (Blender 4.2 headless + gltf-transform 4.5)
