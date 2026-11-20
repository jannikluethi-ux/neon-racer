# Vanta GT4 (from "Selva Hypercar concept by Max Hordin 2019", CC-BY-4.0) - mobile asset

Units: metres. glTF axes: +Y up, car faces +Z (front), car's left side = +X.
Origin: x=0 centreline, y=0 ground (tyre contact), z=0 midpoint between the axles.
Bounding box: x -1.127..1.127 (2.25 m incl. tyres), y 0..1.254 (roof), z -2.197 (rear wing) .. +2.349 (nose) -> length 4.55 m.
Wheelbase 2.827 m; track front 1.756 m, rear 1.777 m; tyre radius 0.352 m front / 0.370 m rear.

## Node layout (all LODs)
VantaGT4_LODn
  Body        primitives: BODY (vertex colours for paint / trim / carbon / chrome / interior),
              GLASS (alpha BLEND), LIGHT (2-pixel emissive palette: white / red),
              NUMBER (vertex colours: white numerals, black plates)
  Wheel_FL/FR/RL/RR    procedural 21" 7-spoke rim + tyre + disc, one WHEEL material
                       (3-pixel albedo + metallic-roughness palette). Origin = wheel centre
                       (spin about local X).
  Caliper_FL/FR/RL/RR  brake caliper, origin = wheel centre (steer with the wheel, do not spin)

Wheel centres (x, y, z) — same on the uncompressed and meshopt GLBs:
  FL ( 0.8712, 0.3521,  1.4133)   FR (-0.8843, 0.3521,  1.4016)
  RL ( 0.8817, 0.3697, -1.4133)   RR (-0.8950, 0.3697, -1.4133)

Slight left/right and front/rear asymmetry is in the source and was kept.
Overall wheel diameters are unchanged from the source (physics).

## Files
vanta_lod0.glb           (59,048 tris, 12 draw calls, 3.30 MB; interior, #04 plates, GT4 wing)
vanta_lod1.glb           (27,809 tris, 12 draw calls, 1.54 MB; interior and #04 kept)
vanta_lod2.glb           ( 9,261 tris, 12 draw calls, 540 KB; no interior, more faceted glass)
*_meshopt_ktx2.glb       same geometry and node graph, EXT_meshopt_compression + KHR_mesh_quantization
                         (516 / 261 / 111 KB). Source had no textures (tiny 2×1 / 3×1 palettes
                         only), so there are no KTX2 images.
                         (three.js: GLTFLoader + setMeshoptDecoder(MeshoptDecoder))
previews/                Blender Cycles renders of the final GLBs
scripts/                 pipeline (Blender 4.2 headless + gltfpack / gltf-transform 4.5)

## Notes
The author described the source as an early, lower-skill model: surfaces are
already somewhat faceted. Weighted normals + shade-smooth were applied without
adding triangles; the silhouette is still faceted. It is a fictional concept
with a clear kinship to a modern mid-engine hypercar (Bugatti Chiron-like
proportions). Manufacturer marks and a Forza-style license-plate material were
removed. The windscreen hood-to-roof strut (and a stray 4 mm cabin rod) were
deleted.

Tyres and rims are procedural stand-ins: the source tread would not simplify
cleanly, and painting out the wheel-cap logos had chipped the original spokes.
Rims are a 21-inch look with thinner sidewalls; overall diameter and wheel
centres are unchanged. Wheelbase is long for a 4.55 m car (source proportions,
scaled). LOD2 glass is more open / faceted after aggressive simplification.
