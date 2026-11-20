// Stage 4: tag + texture-size the plain LOD in place, then build the
// _meshopt_ktx2 variant FROM the plain LOD:
//   gltfpack -cc -vpf -vtf  (EXT_meshopt_compression, float positions => no
//   dequantization transforms are folded into the Wheel_/Caliper_ nodes, so
//   pivots and wheel scale stay exactly as in the plain GLB)
//   + gltf-transform uastc  (KHR_texture_basisu for the atlas textures)
// usage: node post.mjs aegis_lod0.glb 1024
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup } from '@gltf-transform/functions';
import sharp from 'sharp';
import { execSync } from 'child_process';
import fs from 'fs';

const [,, src, sizeArg] = process.argv;
const SIZE = Number(sizeArg || 1024);
const TOOLS = '/workspace/racecar01/tools';
const KTX = `${TOOLS}/ktxraw/KTX-Software-4.4.2-Linux-x86_64`;
const env = { ...process.env, PATH: `${KTX}/bin:${process.env.PATH}`, LD_LIBRARY_PATH: `${KTX}/lib` };
const GT = `${TOOLS}/node_modules/.bin/gltf-transform`;
const GP = `${TOOLS}/node_modules/.bin/gltfpack`;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();
root.getAsset().extras = {
  title: 'Aegis #88 (based on "2026 Kralzfiller Trackday V10" by Dave Love SketchFab, CC-BY-4.0)',
  source: 'https://sketchfab.com/3d-models/2026-kralzfiller-trackday-v10-d486b2662d314db8b5afc71bd1488c3c',
  author: 'Dave Love SketchFab (https://sketchfab.com/Tyler_Dave)',
  license: 'CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
  modifications: 'see CREDITS.txt',
};
for (const t of root.listTextures()) {
  const meta = await sharp(Buffer.from(t.getImage())).metadata();
  let img = sharp(Buffer.from(t.getImage()));
  if (meta.width >= 64) {
    img = img.resize(SIZE, SIZE, { fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3' });
  } else {
    // tiny palettes: upscale (nearest) to 4-px blocks so block-compressed
    // KTX2 has WebGL-legal (multiple-of-4) dimensions
    img = img.resize(meta.width * 4, meta.height * 4, { kernel: 'nearest' });
  }
  const buf = await img.png({ compressionLevel: 9 }).toBuffer();
  t.setImage(buf); t.setMimeType('image/png');
  console.log('tex', t.getName(), (await sharp(buf).metadata()).width, (buf.length / 1024).toFixed(0) + 'KB');
}
await doc.transform(dedup(), prune());
await io.write(src, doc);

const dst = src.replace(/\.glb$/, '_meshopt_ktx2.glb');
const tmp = src.replace(/\.glb$/, '_tmp_ktx2.glb');
execSync(`${GT} uastc ${src} ${tmp} --level 2 --rdo 1 --zstd 18`, { stdio: 'inherit', env });
execSync(`${GP} -i ${tmp} -o ${dst} -cc -kn -km -vpf -vtf`, { stdio: 'inherit', env });
fs.unlinkSync(tmp);
console.log('WROTE', dst, (fs.statSync(dst).size / 1024).toFixed(0) + 'KB');
