// Compare plain vs _meshopt_ktx2 GLBs: node graph, TRS, per-node world bbox,
// triangles, draw calls, textures. usage: node verify.mjs aegis_lod0.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
function info(doc) {
  const out = {}; let tris = 0, draws = 0;
  for (const n of doc.getRoot().listNodes()) {
    const m = n.getMesh(); const W = n.getWorldMatrix();
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9], t = 0;
    if (m) for (const p of m.listPrimitives()) {
      draws++; const idx = p.getIndices(); t += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
      const pos = p.getAttribute('POSITION'); const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        const w = [0, 1, 2].map(k => W[k] * v[0] + W[4 + k] * v[1] + W[8 + k] * v[2] + W[12 + k]);
        for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], w[k]); mx[k] = Math.max(mx[k], w[k]); }
      }
    }
    tris += t;
    out[n.getName()] = { T: n.getTranslation().map(x => +x.toFixed(4)), S: n.getScale().map(x => +x.toFixed(4)),
      R: n.getRotation().map(x => +x.toFixed(4)), tris: t,
      bbox: m ? [mn.map(x => +x.toFixed(4)), mx.map(x => +x.toFixed(4))] : null };
  }
  const tex = doc.getRoot().listTextures().map(t => `${t.getName()}:${t.getMimeType()}`);
  return { nodes: out, tris, draws, mats: doc.getRoot().listMaterials().map(m => m.getName()), tex };
}
const src = process.argv[2];
const a = info(await io.read(src)), b = info(await io.read(src.replace('.glb', '_meshopt_ktx2.glb')));
let maxd = 0, ok = true;
for (const [k, v] of Object.entries(a.nodes)) {
  const w = b.nodes[k]; if (!w) { console.log('MISSING node in meshopt:', k); ok = false; continue; }
  for (const key of ['T', 'S', 'R']) if (v[key].some((x, i) => Math.abs(x - w[key][i]) > 1e-4)) { console.log('TRS DIFF', k, key, v[key], w[key]); ok = false; }
  if (v.bbox) for (let s = 0; s < 2; s++) for (let i = 0; i < 3; i++) maxd = Math.max(maxd, Math.abs(v.bbox[s][i] - w.bbox[s][i]));
}
console.log(src, 'plain tris', a.tris, 'draws', a.draws, '| meshopt tris', b.tris, 'draws', b.draws, '| max bbox diff', maxd.toFixed(5), ok ? 'TRS OK' : 'TRS MISMATCH');
console.log('materials', a.mats.join(','), '| tex plain', a.tex.join(','), '| tex meshopt', b.tex.join(','));
for (const [k, v] of Object.entries(a.nodes)) if (k.startsWith('Wheel') || k.startsWith('Caliper') || k === 'Body')
  console.log(' ', k.padEnd(11), 'T', JSON.stringify(v.T), 'S', JSON.stringify(b.nodes[k].S), 'tris', v.tris, 'bbox', JSON.stringify(v.bbox));
