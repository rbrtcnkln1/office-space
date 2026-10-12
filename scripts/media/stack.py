"""Stack the team/theme stills into the two README images.

    python3 scripts/media/stack.py STILLS_DIR OUT_DIR

Needs Pillow and rsvg-convert (it rasterizes the SVGs first). Writes team-before-after.png (default over customized),
theme-presets.png (the three built-in presets) and make-it-yours.png (Boss, team, decor and wrapped labels at once),
each labelled and kept small.
"""
import glob
import subprocess
import sys
from PIL import Image, ImageDraw

src, out = sys.argv[1], sys.argv[2]
for svg in glob.glob(f'{src}/*.svg'):
    subprocess.run(['rsvg-convert', svg, '-o', svg[:-4] + '.png'], check=True)
BG = (30, 34, 46)
W = 760


def label_font():
    from PIL import ImageFont
    for f in ('/System/Library/Fonts/Menlo.ttc', '/System/Library/Fonts/Monaco.ttf'):
        try:
            return ImageFont.truetype(f, 15)
        except Exception:
            pass
    return ImageFont.load_default()


def stack(items, dest):
    font = label_font()
    tiles = []
    for name, caption in items:
        im = Image.open(f'{src}/{name}.png').convert('RGB')
        h = round(im.height * W / im.width)
        tiles.append((im.resize((W, h), Image.NEAREST), caption))
    pad = 28
    total = sum(t.height + pad for t, _ in tiles) + 8
    sheet = Image.new('RGB', (W, total), BG)
    d = ImageDraw.Draw(sheet)
    y = 4
    for t, caption in tiles:
        d.text((8, y + 5), caption, fill=(236, 238, 246), font=font)
        y += pad
        sheet.paste(t, (0, y))
        y += t.height
    sheet.save(f'{out}/{dest}', optimize=True)


stack([('default', 'Before: the built-in team'), ('custom', 'After: /office-space-team (renamed, restyled, 10 desks)')], 'team-before-after.png')
stack([
    ('preset-90s-startup', '/office-space-theme load 90s startup'),
    ('preset-cozy-library', '/office-space-theme load cozy library'),
    ('preset-night-shift', '/office-space-theme load night shift'),
], 'theme-presets.png')
stack([('combined', 'A custom Boss, a renamed team and a decorated office')], 'make-it-yours.png')
