"""Stack the drawn-parts stills (from parts-still.ts) into one small README image.

    python3 scripts/media/parts-sheet.py STILLS_DIR docs/media/drawn-parts.png

Needs Pillow and rsvg-convert. The portrait keeps whole pixels (nearest-neighbour, integer scale).
"""
import subprocess
import sys
from PIL import Image, ImageDraw, ImageFont

src, dest = sys.argv[1], sys.argv[2]
for name in ('portrait', 'office'):
    subprocess.run(['rsvg-convert', f'{src}/{name}.svg', '-o', f'{src}/{name}.png'], check=True)
BG = (30, 34, 46)
W = 760


def font():
    for f in ('/System/Library/Fonts/Menlo.ttc', '/System/Library/Fonts/Monaco.ttf'):
        try:
            return ImageFont.truetype(f, 14)
        except Exception:
            pass
    return ImageFont.load_default()


portrait = Image.open(f'{src}/portrait.png').convert('RGB')
office = Image.open(f'{src}/office.png').convert('RGB')
office = office.resize((W, round(office.height * W / office.width)), Image.LANCZOS)
f = font()
rows = [
    (portrait, ['Before -> after: /office-space-boss silver hair, white graphic tee,', 'blue jeans, headphones, white sneakers and a cowboy hat (hat, sneakers, print: drawn)']),
    (office, ['At office size: the Coder reuses "my cowboy hat", the Writer wears a drawn beard']),
]
pad = 8
line = 18
total = sum(im.height + len(cap) * line + pad * 2 for im, cap in rows) + pad
sheet = Image.new('RGB', (W, total), BG)
d = ImageDraw.Draw(sheet)
y = pad
for im, cap in rows:
    for c in cap:
        d.text((10, y), c, fill=(236, 238, 246), font=f)
        y += line
    y += pad // 2
    sheet.paste(im, ((W - im.width) // 2, y))
    y += im.height + pad
sheet.save(dest, optimize=True)
