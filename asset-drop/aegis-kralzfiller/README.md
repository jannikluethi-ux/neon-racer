# Aegis #88 (from "2026 Kralzfiller Trackday V10" by Dave Love SketchFab, CC-BY-4.0) - mobile asset

Units: metres. glTF axes: +Y up, car faces +Z (front), car's left side = +X (same as Vanta / Vector).
Origin: x=0 centreline, y=0 ground (tyre contact), z=0 midpoint between the axles.
Bounding box (LOD0): x -1.038..1.038 (2.08 m incl. tyres), y 0..1.177 (roof fin/antenna),
z -2.088 (rear diffuser/wing) .. +2.409 (front splitter) -> length 4.50 m.
Wheelbase 2.778 m; track front 1.724 m, rear 1.681 m; tyre radius 0.330 m front / 0.350 m rear.

## Node layout (all LODs)
Aegis_LODn
  Body        primitives: BODY (atlas: paint / carbon / matte / interior / metal swatches + #88 decals,
              clearcoat), GLASS (alpha BLEND, dark tint), LIGHT (2-colour emissive palette: ice-white / red)
  Wheel_FL/FR/RL/RR    tyre + rim + cap + centre nut + barrel + disc, one WHEEL material (same atlas,
                       no clearcoat). Origin = wheel centre (spin about local X).
  Caliper_FL/FR/RL/RR  caliper + upright, origin = wheel centre (steer with the wheel, do not spin)

Wheel centres (x, y, z) - identical on the plain and meshopt GLBs, node scale 1, no rotation:
  FL ( 0.8620, 0.3403,  1.3890)   FR (-0.8620, 0.3403,  1.3890)
  RL ( 0.8405, 0.3501, -1.3890)   RR (-0.8405, 0.3501, -1.3890)
The front tyres are slightly smaller than the rears in the source (the front tyre bottoms sit
1 cm above y=0); proportions were kept, not altered.

## Files
aegis_lod0.glb   (60,577 tris, 11 draw calls, 4 materials, atlas 1024 PNG, 2.72 MB)
aegis_lod1.glb   (24,453 tris, 11 draw calls, atlas 512, 1.34 MB)
aegis_lod2.glb   ( 7,834 tris, 11 draw calls, atlas 256, 0.53 MB)
*_meshopt_ktx2.glb  same node graph and geometry: EXT_meshopt_compression (gltfpack -cc) with
                 FLOAT positions/UVs (no dequantization transforms folded into the nodes, so wheel
                 pivots and scale stay exact) + KHR_mesh_quantization (normals only) + KHR_texture_basisu
                 (UASTC). 592 / 314 / 137 KB.
                 (three.js: GLTFLoader + setMeshoptDecoder(MeshoptDecoder) + setKTX2Loader(...))
textures/        aegis_atlas.png (base colour) and aegis_atlas_mr.png (G = roughness, B = metalness)
previews/        Blender Cycles renders of the final GLBs (dark studio)
scripts/         pipeline: build_all.sh -> clean.py (Blender 4.2) -> make_atlas.py -> simplify.py
                 (gltfpack/meshoptimizer) -> assemble.py (Blender) -> post.mjs (gltf-transform +
                 gltfpack + KTX-Software 4.4) -> verify.mjs (plain vs meshopt check);
                 render.py / compare.py for previews

## Notes
Source cleanup: donut nose badge, "TRACKDAY V10" text meshes, a branded mechanical texture
sheet (all source textures dropped), canopy wiper rod, duplicate transparent canopy shell,
two sidepod vanes over the number area and stray micro-quads were removed. #88 decals are
planar-projected texture tiles on the body mesh (the faces are cut exactly on the decal
borders), so they sit flush on the curved bodywork with no floating plates.
LOD2 body is visibly faceted at close range and its wheels are 12-sided; it is meant for distance only.
