# Surge LMP (from "Concept Sport Car" by KTKR, CC-BY-4.0) - mobile asset

Units: metres. glTF axes: +Y up, the car faces +Z (front), and the car's left side is +X. These match Vanta and Vector.
Origin: x=0 on the centreline, y=0 at the ground (tyre contact), z=0 at the midpoint between the axles.
Scale: uniform, chosen so the wheelbase equals the game's SURGE wheelbase (2.82 m, car-model.ts
frontAxleZ 1.32 / rearAxleZ -1.50). Source-to-metres factor 0.8894 (1.0786 x the earlier 4.50 m build).
Bounding box: x -1.220..1.220 (2.44 m including tyres), y 0..1.327 (roof), z -2.322 (rear) .. +2.532 (nose). Length is 4.85 m.
Wheelbase 2.820 m. Front track 2.021 m, rear track 2.045 m.
Tyre radius is 0.410 m front and 0.450 m rear (staggered, as in the source). Tyre width is 0.341 m front and 0.373 m rear.
The game's axle stations are at z +1.32 / -1.50. This model keeps the axle-midpoint origin (as Vanta and
Vector do), so its axles are at +/-1.41. To sit it on the game's stations, offset the model by z -0.09.
Race number: #51 (from `vehicle-def.ts`: `surge: "51"`).

## Node layout (all LODs)
SurgeLMP_LODn
  Body        4 primitives:
              PAINT  - metallic gold (metal 0.9, rough 0.27, clear coat 1.0)
              TRIM   - 8x1 palette (albedo + metal/rough): carbon, gloss black (roof), gunmetal,
                       interior, #51 white, #51 plate black, gold plate border, chrome
              GLASS  - dark tint, alpha BLEND 0.62, no transmission (cheap on mobile)
              LIGHT  - 2x1 emissive palette (white LED / red tail), emissive strength 12
  Wheel_FL/FR/RL/RR    tyre + source multi-spoke rim + procedural disc, hub and gold centre cap.
                       One WHEEL material (4x1 palette). The origin is the wheel centre. Spin about local X.
  Caliper_FL/FR/RL/RR  gold brake caliper (CALIPER material). The origin is the wheel centre.
                       It steers with the wheel and does not spin.
All materials are doubleSided, so no backfaces are culled and the body is never see-through.
Palette textures use NEAREST sampling with clamp, and the UVs sit on pixel centres.

Wheel centres (x, y, z). They are identical on the plain and meshopt GLBs:
  FL ( 1.0103, 0.4104,  1.4100)   FR (-1.0103, 0.4104,  1.4100)
  RL ( 1.0223, 0.4498, -1.4100)   RR (-1.0223, 0.4498, -1.4100)

## Files
surge_lod0.glb   60,064 tris, 12 draw calls, 2.0 MB  (body 44,287; wheels ~3.7-4.1k each)
surge_lod1.glb   25,790 tris, 12 draw calls, 1.0 MB  (body 19,167)
surge_lod2.glb    7,844 tris, 12 draw calls, 395 KB (body 5,665)
*_meshopt_ktx2.glb   378 / 209 / 89 KB. These have the same node graph, names, materials and transforms.
                 gltfpack -cc -vpf -kn -km -ke: EXT_meshopt_compression, float positions
                 (meshopt exponential filter), quantized normals and UVs (KHR_mesh_quantization and
                 KHR_texture_transform).
                 No node carries a dequantization scale. Wheel_* nodes have translation only and
                 scale 1, so the game can overwrite wheel transforms freely (this avoids the earlier
                 Vanta "wheels 3x too big" bug). scripts/post.mjs checks every mesh's world bounds
                 against the plain GLB (max difference 0.12 mm) and checks node scale and translation.
                 No KTX2 images: the only textures are 8x1 / 4x1 / 2x1 palettes (~1.3 KB in total).
                 three.js: GLTFLoader + setMeshoptDecoder(MeshoptDecoder).
previews/        Blender Cycles renders of the final GLBs (dark studio). four_car_side.jpg uses the
                 Aegis lod0 from /workspace/aegis/out (21:06 build).
scripts/         pipeline (Blender 4.2 headless + meshoptimizer 1.3 + gltfpack / gltf-transform 4.5)

All six GLBs pass gltf-validator with 0 errors and 0 warnings.

## Pipeline (scripts/)
1. `blender -b -P clean.py` imports the source, deletes junk, scales so the wheelbase is 2.82 m, sets the ground and
   axle midpoint, splits the wheels into FL/FR/RL/RR by island, lowers the front tyres 1 cm onto the
   ground, removes the hub/logo caps and lip bolts, and exports geometry-only parts.
2. `node simp.mjs parts/body.glb parts/body_42000.glb 42000 weights_body.json` and the same for 18000
   and 5000. For the wheels: `node simp.mjs parts/wheels.glb parts/wheels_12000.glb 12000` and the
   same for 4400 and 1200. This is error-driven meshoptimizer simplification: one absolute error
   (bisected to the triangle budget) for every part, multiplied per part by weights_body.json
   (interior, underfloor and arches are reduced harder; glass is kept tighter).
3. `blender -b -P build.py -- LOD0|LOD1|LOD2` builds the materials and palettes, the #51 plates,
   the discs, hubs, caps and calipers, smooths the shading (by angle plus weighted normals), joins
   everything into 12 draw calls and exports.
4. `node post.mjs` adds credit metadata, builds the meshopt variants and verifies them.
5. `render.py` / `compare.py` render the previews.

## Notes / known limits
- The author describes this as an early model. Some large panels (front fenders, side scoops) still
  show faint faceting, which smoothing reduces but cannot remove without remodelling. LOD1 and LOD2
  show more faceting.
- Only the wheelbase matches the game's Surge. Uniform scaling makes the body 2.44 m wide (the game's
  Surge is 2.20 m) and the track about 2.03 m. The tyres are r 0.41 / 0.45 (the game uses r 0.34).
  The physics axle values in vehicle-def.ts (axleFront 1.20 / axleRear 1.48) are separate from the
  2.82 m visual stations and were not used.
- The source is a road-going hypercar concept, not an LMP prototype. It fits Surge's "long, low"
  role, but it has no shark fin or longtail.
- Rims are the source multi-spoke design. They are simplified, so spoke edges are slightly faceted
  in close-ups, and LOD2 rims read as a few chunky spokes.
