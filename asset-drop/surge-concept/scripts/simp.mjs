// Error-driven meshoptimizer simplification to a triangle budget.
// usage: node simp.mjs src.glb dst.glb TARGET_TRIS [weights.json] [lockBorder 0|1]
// weights.json: { "<node name prefix>": errorMultiplier }  (bigger = simplify more,
// "drop" = remove node). Bisects one absolute error (metres) so the whole file
// lands on TARGET_TRIS; every part gets the same geometric error x multiplier.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, compactPrimitive, prune } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'fs';

const [,, src, dst, tgtArg, wArg, lbArg] = process.argv;
const TARGET = Number(tgtArg);
const W = wArg && wArg !== '-' ? JSON.parse(fs.readFileSync(wArg, 'utf8')) : {};
const LOCK = lbArg === '1';
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
await doc.transform(weld());
const mult = (name) => {
  let best = null, bl = -1;
  for (const k of Object.keys(W)) if (name.startsWith(k) && k.length > bl) { best = W[k]; bl = k.length; }
  return best === null ? 1 : best;
};
const items = [];
for (const n of doc.getRoot().listNodes()) {
  const m = n.getMesh(); if (!m) continue;
  const k = mult(n.getName());
  if (k === 'drop') { n.dispose(); continue; }
  for (const p of m.listPrimitives()) {
    const pos = p.getAttribute('POSITION');
    const idx = p.getIndices() ? Uint32Array.from(p.getIndices().getArray()) : Uint32Array.from({ length: pos.getCount() }, (_, i) => i);
    items.push({ n, p, k, pos: Float32Array.from(pos.getArray()), idx, name: n.getName() });
  }
}
const flags = ['ErrorAbsolute', 'Prune'];
if (LOCK) flags.push('LockBorder');
function run(e) {
  let tot = 0; const res = [];
  for (const it of items) {
    const err = e * it.k;
    let out = it.idx;
    if (err > 0) [out] = MeshoptSimplifier.simplify(it.idx, it.pos, 3, 0, err, flags);
    res.push(out); tot += out.length / 3;
  }
  return { tot, res };
}
const full = items.reduce((s, it) => s + it.idx.length / 3, 0);
let lo = 0, hi = 0.05, best = null;
if (full <= TARGET) best = { e: 0, ...run(0) };
else {
  while (run(hi).tot > TARGET) hi *= 2;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2; const r = run(mid);
    if (r.tot > TARGET) lo = mid; else { hi = mid; best = { e: mid, ...r }; }
  }
}
const per = {};
items.forEach((it, i) => {
  const acc = doc.createAccessor().setType('SCALAR').setArray(best.res[i]).setBuffer(doc.getRoot().listBuffers()[0]);
  it.p.setIndices(acc);
  per[it.name] = (per[it.name] || 0) + best.res[i].length / 3;
});
for (const it of items) {
  if (it.p.getIndices().getCount() === 0) { it.p.dispose(); continue; }
  compactPrimitive(it.p);
}
for (const n of doc.getRoot().listNodes()) {
  const m = n.getMesh(); if (m && m.listPrimitives().length === 0) n.dispose();
}
await doc.transform(prune());
await io.write(dst, doc);
console.log(JSON.stringify({ src, full, target: TARGET, tris: best.tot, error_m: +best.e.toFixed(5) }));
if (process.env.VERBOSE) console.log(JSON.stringify(per));
