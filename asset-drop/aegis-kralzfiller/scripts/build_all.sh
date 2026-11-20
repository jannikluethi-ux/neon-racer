#!/bin/bash
# Full Aegis pipeline. Blender 4.2 + gltfpack 1.3 + gltf-transform 4.5 + KTX-Software 4.4
set -e
export PATH=/workspace/racecar01/tools/blender-4.2.3-linux-x64:/workspace/racecar01/tools/node_modules/.bin:$PATH
S=/workspace/aegis/out/scripts
cd /workspace/aegis/work
blender -b -P $S/clean.py            # junk / branding removal, scale, classify, export parts
python3 $S/make_atlas.py             # #88 decal + swatch atlas
python3 $S/simplify.py               # meshoptimizer (gltfpack) per-part budgets
for L in LOD0 LOD1 LOD2; do blender -b -P $S/assemble.py -- $L; done
cd /workspace/aegis/out
node $S/post.mjs aegis_lod0.glb 1024
node $S/post.mjs aegis_lod1.glb 512
node $S/post.mjs aegis_lod2.glb 256
for L in 0 1 2; do node $S/verify.mjs aegis_lod$L.glb; done
