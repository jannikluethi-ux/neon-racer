#!/usr/bin/env python3
"""Build the 1024x1024 Aegis atlas: #88 decal tiles + flat colour swatches.
aegis_atlas.png    base colour (sRGB)
aegis_atlas_mr.png glTF metallic-roughness (G = roughness, B = metalness, linear)
Layout (pixel coords, origin top-left):
  door tile  x 0..767,  y 0..511   (aspect 1.5 : 1, blue paint background)
  nose tile  x 0..511,  y 512..767 (aspect 2 : 1, blue paint background)
  swatches   x 512..1023, y 512..1023, 64 px blocks, index = row*8 + col
"""
import json
from PIL import Image, ImageDraw, ImageFont, ImageFilter
OUT = '/workspace/aegis/work'
FONT = '/usr/share/fonts/truetype/sand-box/google/Barlow Condensed/BarlowCondensed-ExtraBold.ttf'
N = 1024
# name: (sRGB colour, roughness, metalness)
SW = {
    'PAINT':    ((12, 56, 196), 0.24, 0.35),   # deep electric blue
    'CARBON':   ((16, 17, 20), 0.30, 0.10),
    'MATTE':    ((18, 19, 21), 0.70, 0.00),
    'INTERIOR': ((30, 31, 34), 0.65, 0.00),
    'METAL':    ((70, 74, 82), 0.40, 0.80),
    'TYRE':     ((22, 22, 23), 0.88, 0.00),
    'RIM':      ((92, 98, 110), 0.24, 0.95),   # gunmetal satin
    'CAP':      ((14, 15, 17), 0.35, 0.40),
    'NUT':      ((170, 174, 180), 0.22, 1.00),
    'BARREL':   ((36, 38, 42), 0.50, 0.70),
    'DISC':     ((88, 88, 92), 0.48, 0.90),
    'CALIPER':  ((0, 190, 255), 0.32, 0.15),   # neon cyan accent
    'UPRIGHT':  ((40, 42, 46), 0.55, 0.60),
    'PLATE':    ((8, 9, 11), 0.40, 0.00),
    'NUMBER':   ((245, 247, 250), 0.40, 0.00),
}
ORDER = list(SW)
img = Image.new('RGB', (N, N), SW['PAINT'][0])
mr = Image.new('RGB', (N, N), (0, int(SW['PAINT'][1]*255), int(SW['PAINT'][2]*255)))
d = ImageDraw.Draw(img); dm = ImageDraw.Draw(mr)
uv = {}
for i, name in enumerate(ORDER):
    r, c = divmod(i, 8)
    x0, y0 = 512 + c*64, 512 + r*64
    col, ro, me = SW[name]
    d.rectangle([x0, y0, x0+63, y0+63], fill=col)
    dm.rectangle([x0, y0, x0+63, y0+63], fill=(0, int(ro*255), int(me*255)))
    uv[name] = [(x0+32)/N, 1 - (y0+32)/N]   # Blender UV (v up)

def plate(box, txt, gap_frac=0.0):
    """black rounded plate with a cyan keyline and white numerals."""
    x0, y0, x1, y1 = box
    w, h = x1-x0, y1-y0
    rad = int(h*0.16)
    d.rounded_rectangle(box, radius=rad, fill=SW['PLATE'][0])
    k = max(3, int(h*0.035))
    d.rounded_rectangle([x0+k*1.6, y0+k*1.6, x1-k*1.6, y1-k*1.6], radius=rad-k, outline=(0, 200, 255), width=k)
    dm.rounded_rectangle(box, radius=rad, fill=(0, int(SW['PLATE'][1]*255), 0))
    fs = int(h*1.02)
    f = ImageFont.truetype(FONT, fs)
    if gap_frac <= 0:
        bb = d.textbbox((0, 0), txt, font=f)
        tw, th = bb[2]-bb[0], bb[3]-bb[1]
        d.text((x0+(w-tw)/2-bb[0], y0+(h-th)/2-bb[1]), txt, font=f, fill=SW['NUMBER'][0])
    else:  # each digit centred in its half, leaving a gap on the centreline
        for j, ch in enumerate(txt):
            bb = d.textbbox((0, 0), ch, font=f)
            tw, th = bb[2]-bb[0], bb[3]-bb[1]
            cx = x0 + w*(0.25 + 0.5*j) + (-1 if j == 0 else 1)*w*gap_frac*0.25
            d.text((cx-tw/2-bb[0], y0+(h-th)/2-bb[1]), ch, font=f, fill=SW['NUMBER'][0])

# door tile 768x512: plate occupies the central 70 %
plate((115, 77, 653, 435), '88')
# nose tile 512x256 (plate split around the carbon centre strip)
plate((64, 512+32, 448, 512+224), '88', gap_frac=0.10)
img.save(f'{OUT}/aegis_atlas.png'); mr.save(f'{OUT}/aegis_atlas_mr.png')
tiles = dict(door=[0, 0, 768, 512], nose=[0, 512, 512, 768], door_plate=[115, 77, 653, 435],
             nose_plate=[64, 544, 448, 736])
json.dump(dict(uv=uv, tiles=tiles, sw={k: list(v[0]) for k, v in SW.items()}),
          open(f'{OUT}/atlas.json', 'w'), indent=1)
print('atlas ok')
