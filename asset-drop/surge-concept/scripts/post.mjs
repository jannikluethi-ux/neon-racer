// Tag the plain LODs with credit metadata, build the meshopt variants, verify them.
//   node post.mjs            (run from anywhere; paths are absolute)
// Meshopt variants: gltfpack -cc -vpf -kn -km -ke
//   -vpf keeps positions as float (meshopt exponential filter), so there is NO
//   dequantization scale/offset on any node: Wheel_* / Caliper_* keep exactly the
//   plain-GLB transforms (translation = wheel centre, no scale). This avoids the
//   earlier Vanta bug (wheels ~3x too big once the game reset a node's scale).
//   Normals / UVs are still quantized (UVs via KHR_texture_transform).
//   No KTX2 images: the only textures are 8x1 / 4x1 / 2x1 palettes (~1.3 KB total).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { execFileSync } from 'child_process';
import fs from 'fs';

const OUT = '/workspace/surge/out';
const GP = '/workspace/racecar01/tools/node_modules/gltfpack/cli.js';
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

function bounds(doc) {
  const out = {};
  for (const n of doc.getRoot().listNodes()) {
    const m = n.getMesh(); if (!m) continue;
    // name = nearest named ancestor (gltfpack -kn keeps names on the same node)
    let nn = n; while (nn && !nn.getName()) nn = nn.getParentNode();
    const W = n.getWorldMatrix();
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const p of m.listPrimitives()) {
      const a = p.getAttribute('POSITION'); const v = [0, 0, 0];
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, v);
        const w = [0, 1, 2].map(k => W[k] * v[0] + W[4 + k] * v[1] + W[8 + k] * v[2] + W[12 + k]);
        for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], w[k]); mx[k] = Math.max(mx[k], w[k]); }
      }
    }
    out[nn.getName()] = { mn, mx, t: n.getTranslation(), s: n.getScale(), mesh: true };
  }
  return out;
}

const report = {};
for (const lod of ['lod0', 'lod1', 'lod2']) {
  const plain = `${OUT}/surge_${lod}.glb`;
  const doc = await io.read(plain);
  doc.getRoot().getAsset().extras = {
    title: 'Surge LMP (based on "Concept Sport Car" by KTKR, CC-BY-4.0)',
    source: 'https://sketchfab.com/3d-models/concept-sport-car-566075bdb499404b908895a5f4dc6aa0',
    author: 'KTKR (https://sketchfab.com/KTKR)',
    license: 'CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
    modifications: 'see CREDITS.txt',
  };
  await io.write(plain, doc);
  const dst = `${OUT}/surge_${lod}_meshopt_ktx2.glb`;
  execFileSync('node', [GP, '-i', plain, '-o', dst, '-cc', '-vpf', '-kn', '-km', '-ke'], { stdio: 'pipe' });
  const a = bounds(await io.read(plain));
  const b = bounds(await io.read(dst));
  let maxd = 0; const bad = [];
  for (const k of Object.keys(a)) {
    if (!b[k]) { bad.push(`missing ${k}`); continue; }
    for (let i = 0; i < 3; i++) maxd = Math.max(maxd, Math.abs(a[k].mn[i] - b[k].mn[i]), Math.abs(a[k].mx[i] - b[k].mx[i]));
    const s = b[k].s; if (Math.abs(s[0] - 1) + Math.abs(s[1] - 1) + Math.abs(s[2] - 1) > 1e-6) bad.push(`${k} has node scale ${s}`);
    const ta = (await Promise.resolve(a[k].t)), tb = b[k].t;
    for (let i = 0; i < 3; i++) if (Math.abs(ta[i] - tb[i]) > 1e-5) bad.push(`${k} translation differs`);
  }
  const wl = b['Wheel_FL'];
  report[lod] = {
    plainKB: Math.round(fs.statSync(plain).size / 1024), meshoptKB: Math.round(fs.statSync(dst).size / 1024),
    maxBoundsDiff_m: +maxd.toFixed(5), problems: bad,
    wheelFL_diam_m: +((wl.mx[1] - wl.mn[1])).toFixed(4),
  };
  if (bad.length || maxd > 0.002) { console.error('VERIFY FAILED', lod, bad, maxd); process.exitCode = 1; }
}
console.log(JSON.stringify(report, null, 1));
