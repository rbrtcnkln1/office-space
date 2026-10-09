#!/usr/bin/env python3
"""Promo thumbnail for the teaser video (docs/media/teaser-thumbnail.png, 1280x720).

    python3 scripts/media/thumbnail.py WORK_DIR [scene=remote-crew] [tick=70]

Needs the scene SVGs from frames.ts (WORK_DIR/frames/<scene>/NNNN.svg) and rsvg-convert.
The office frame is scaled 2x (1472 px wide, centre-cropped) with nearest-neighbour, darkened, then pixel-style text
(drawn at 1/4 size, alpha-thresholded and scaled back up 4x) and a play button are added.
"""
import os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont, ImageEnhance

W, H, S = 1280, 720, 4
INK, RED, CREAM, FLOOR = (0x22, 0x30, 0x4a), (0xc0, 0x39, 0x2b), (0xf2, 0xe9, 0xd0), (0x8e, 0xa1, 0xba)
MENLO = "/System/Library/Fonts/Menlo.ttc"
work = sys.argv[1]
scene = sys.argv[2] if len(sys.argv) > 2 else "remote-crew"
tick = int(sys.argv[3]) if len(sys.argv) > 3 else 70
root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

png = os.path.join(work, f"thumb-{scene}-{tick}.png")
subprocess.run(["rsvg-convert", "-z", "1", os.path.join(work, "frames", scene, f"{tick:04d}.svg"), "-o", png], check=True)
office = Image.open(png).convert("RGB")
office = office.resize((office.width * 2, office.height * 2), Image.NEAREST)
img = Image.new("RGB", (W, H), INK)
img.paste(office, ((W - office.width) // 2, (H - office.height) // 2))
img = ImageEnhance.Brightness(img).enhance(0.5)
# vignette-ish dark bands behind the text areas
ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(ov)
d.rectangle([0, 0, W, 250], fill=(*INK, 150))
d.rectangle([0, 560, W, H], fill=(*INK, 170))
img = Image.alpha_composite(img.convert("RGBA"), ov).convert("RGB")


def pixel_text(img, xy, text, size, fill, anchor="mm", shadow=INK, step=S):
    """Text rendered at 1/step resolution, hard-edged, scaled up with nearest."""
    f = ImageFont.truetype(MENLO, size // step, index=1)
    tmp = Image.new("L", (W // step, H // step), 0)
    ImageDraw.Draw(tmp).text((xy[0] // step, xy[1] // step), text, font=f, fill=255, anchor=anchor)
    mask = tmp.point(lambda v: 255 if v > 110 else 0).resize((W, H), Image.NEAREST)
    sh = Image.new("L", (W, H), 0)
    sh.paste(mask, (step, step))
    img.paste(Image.new("RGB", (W, H), shadow), (0, 0), sh)
    img.paste(Image.new("RGB", (W, H), fill), (0, 0), mask)


pixel_text(img, (W // 2, 112), "OFFICE SPACE", 144, CREAM)
ImageDraw.Draw(img).rectangle([W // 2 - 232, 176, W // 2 + 232, 236], fill=RED, outline=INK, width=4)
pixel_text(img, (W // 2, 207), "for Claude Code", 48, CREAM)
pixel_text(img, (W // 2 - 120, 640), "Your subagents, clocking in.", 44, CREAM)

# play button: red disc with cream ring and triangle, hard pixel edges via 4x supersample-free mask
cx, cy, r = W // 2, 400, 104
m = Image.new("L", (W // S, H // S), 0)
md = ImageDraw.Draw(m)
md.ellipse([(cx - r) // S, (cy - r) // S, (cx + r) // S, (cy + r) // S], fill=255)
disc = m.resize((W, H), Image.NEAREST)
m2 = Image.new("L", (W // S, H // S), 0)
ImageDraw.Draw(m2).ellipse([(cx - r + 12) // S, (cy - r + 12) // S, (cx + r - 12) // S, (cy + r - 12) // S], fill=255)
inner = m2.resize((W, H), Image.NEAREST)
sh = Image.new("L", (W, H), 0); sh.paste(disc, (0, 2 * S))
img.paste(Image.new("RGB", (W, H), (0x10, 0x16, 0x24)), (0, 0), sh)
img.paste(Image.new("RGB", (W, H), CREAM), (0, 0), disc)
img.paste(Image.new("RGB", (W, H), RED), (0, 0), inner)
tri = Image.new("L", (W // S, H // S), 0)
ImageDraw.Draw(tri).polygon([((cx - 34) // S, (cy - 56) // S), ((cx - 34) // S, (cy + 56) // S), ((cx + 62) // S, cy // S)], fill=255)
img.paste(Image.new("RGB", (W, H), CREAM), (0, 0), tri.resize((W, H), Image.NEAREST))

# duration badge
bx0, by0, bx1, by1 = W - 232, H - 92, W - 36, H - 36
d = ImageDraw.Draw(img)
d.rectangle([bx0 + 4, by0 + 4, bx1 + 4, by1 + 4], fill=(0x10, 0x16, 0x24))
d.rectangle([bx0, by0, bx1, by1], fill=CREAM, outline=INK, width=4)
d.polygon([(bx0 + 22, by0 + 14), (bx0 + 22, by1 - 14), (bx0 + 50, (by0 + by1) // 2)], fill=RED)
d.text((bx0 + 70, (by0 + by1) // 2), "0:37", font=ImageFont.truetype(MENLO, 32, index=1), fill=INK, anchor="lm")

out = os.path.join(root, "docs", "media", "teaser-thumbnail.png")
img = img.quantize(48, method=Image.MEDIANCUT, dither=Image.NONE)
img.save(out, optimize=True)
print(out, os.path.getsize(out) // 1024, "KB")
