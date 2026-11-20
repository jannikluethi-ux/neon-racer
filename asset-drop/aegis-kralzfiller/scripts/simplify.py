#!/usr/bin/env python3
"""Stage 2: meshoptimizer simplification (via gltfpack) of each category part
to per-LOD triangle budgets.  Writes work/simp/<PART>_<LOD>.glb (uncompressed,
unquantized).  Blender collapse-decimation is NOT used (it shredded Selva)."""
import json, os, subprocess, sys
WORK = '/workspace/aegis/work'
PARTS = f'{WORK}/parts'; SIMP = f'{WORK}/simp'
GP = '/workspace/racecar01/tools/node_modules/.bin/gltfpack'
os.makedirs(SIMP, exist_ok=True)
meta = json.load(open(f'{WORK}/clean_meta.json'))

BUDGET = {   # triangles per part (wheel / caliper parts: per corner)
    'LOD0': dict(PAINT=20000, CARBON=14500, MATTE=3000, INTERIOR=3500, METAL=1200, GLASS=1800,
                 LIGHT_W=500, LIGHT_R=700, TYRE=700, RIM=1700, CAP=120, NUT=80, BARREL=260,
                 DISC=160, CALIPER=200, UPRIGHT=120),
    'LOD1': dict(PAINT=8800, CARBON=6200, MATTE=1100, INTERIOR=1000, METAL=350, GLASS=700,
                 LIGHT_W=220, LIGHT_R=300, TYRE=380, RIM=650, CAP=48, NUT=0, BARREL=110,
                 DISC=64, CALIPER=80, UPRIGHT=0),
    'LOD2': dict(PAINT=3000, CARBON=2000, MATTE=300, INTERIOR=220, METAL=0, GLASS=260,
                 LIGHT_W=90, LIGHT_R=110, TYRE=150, RIM=230, CAP=0, NUT=0, BARREL=40,
                 DISC=24, CALIPER=32, UPRIGHT=0),
}
lods = sys.argv[1:] or ['LOD0', 'LOD1', 'LOD2']
for lod in lods:
    for part, t in meta['groups'].items():
        cat = part.split('_')[0] if part.split('_')[-1] in ('FL', 'FR', 'RL', 'RR') else part
        b = BUDGET[lod][cat]
        dst = f'{SIMP}/{part}_{lod}.glb'
        if os.path.exists(dst): os.remove(dst)
        if b <= 0:
            continue
        r = min(1.0, b / t)
        cmd = [GP, '-i', f'{PARTS}/{part}.glb', '-o', dst, '-noq', '-kn', '-km', '-sp']
        if r < 1.0:
            cmd += ['-si', f'{r:.5f}', '-sa']
            # small wheel / caliper parts stall at gltfpack's default 1 % error
            # limit on LOD1/2; let them reach the budget
            if lod != 'LOD0' and cat in ('TYRE', 'RIM', 'CAP', 'BARREL', 'DISC', 'CALIPER'):
                cmd += ['-se', '1']
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)
        print(f'{lod} {part:12s} {t:7d} -> target {b}')
