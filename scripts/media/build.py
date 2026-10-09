#!/usr/bin/env python3
"""Rasterize the SVG frames from frames.ts, frame them with a caption bar, and
assemble looping GIFs (nearest-neighbour pixel scaling, one shared palette).

    python3 scripts/media/build.py WORK_DIR OUT_DIR [scene ...]

WORK_DIR holds frames/<scene>/NNNN.svg + captions.json (from frames.ts).
Writes OUT_DIR/<scene>.gif and WORK_DIR/png/<scene>/NNNN.png (full canvas),
which teaser.py reuses. Needs rsvg-convert and Pillow.
"""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageDraw, ImageFont, ImageEnhance

WIDTH = 800          # every canvas is 800 px wide
BORDER = "#1b2233"   # monitor frame around the office
BAR_H = 46           # caption strip height
PAD_TOP = 14
FONT_PATHS = ["/System/Library/Fonts/Menlo.ttc", "/System/Library/Fonts/Monaco.ttf"]

# per scene: keep every Nth tick (time-lapse) and play at FPS frames per second
SETTINGS = {
    "hire-day":    {"stride": 2, "fps": 16, "hold": 1.0},
    "hand-in":     {"stride": 2, "fps": 16, "hold": 1.0},
    "remote-crew": {"stride": 2, "fps": 11, "hold": 1.0},
    "break-room":  {"stride": 2, "fps": 18, "hold": 1.0},
    # README top banner: big phone-readable captions, title and end cards
    "explainer":   {"stride": 2, "fps": 16, "hold": 0.0, "bar_h": 70, "font": 27},
}

INK, RED, CREAM = (0x22, 0x30, 0x4a), (0xc0, 0x39, 0x2b), (0xf4, 0xf1, 0xe8)

# card text: (text, y, size, pixel step, fill, red plaque behind?)
CARDS = {
    "@title": [("OFFICE SPACE", 0.30, 88, 4, CREAM, False),
               ("your Claude Code subagents", 0.57, 30, 2, CREAM, True),
               ("as a 16-bit office", 0.77, 30, 2, CREAM, True)],
    "@end":   [("Zero context cost", 0.15, 52, 2, CREAM, False),
               ("just UI", 0.31, 28, 2, CREAM, False),
               ("/plugin install office-space", 0.51, 28, 2, CREAM, True),
               ("--marketplace rbrtcnkln1/office-space", 0.69, 28, 2, CREAM, True),
               ("/office-space to open", 0.88, 28, 2, CREAM, False)],
}


def font(size):
    for p in FONT_PATHS:
        try:
            return ImageFont.truetype(p, size, index=1 if p.endswith(".ttc") else 0)  # Menlo Bold
        except Exception:
            continue
    return ImageFont.load_default()


def rasterize(svg, png):
    subprocess.run(["rsvg-convert", svg, "-o", png], check=True)


def pixel_text(img, xy, text, size, fill, step):
    """Hard-edged text: drawn at 1/step size, thresholded, scaled up with nearest."""
    w, h = img.size
    f = ImageFont.truetype(FONT_PATHS[0], max(6, size // step), index=1)
    tmp = Image.new("L", (w // step, h // step), 0)
    ImageDraw.Draw(tmp).text((xy[0] // step, xy[1] // step), text, font=f, fill=255, anchor="mm")
    mask = tmp.point(lambda v: 255 if v > 110 else 0).resize((w, h), Image.NEAREST)
    sh = Image.new("L", (w, h), 0)
    sh.paste(mask, (step, step))
    img.paste(Image.new("RGB", (w, h), INK), (0, 0), sh)
    img.paste(Image.new("RGB", (w, h), fill), (0, 0), mask)


def compose_card(office_png, key, out_png, office_h, bar_h):
    img = Image.open(office_png).convert("RGB")
    canvas = Image.new("RGB", (WIDTH, office_h + PAD_TOP + bar_h), BORDER)
    canvas.paste(img, ((WIDTH - img.width) // 2, PAD_TOP))
    canvas = ImageEnhance.Brightness(canvas).enhance(0.3)
    d = ImageDraw.Draw(canvas)
    H = canvas.height
    for text, fy, size, step, fill, plaque in CARDS[key]:
        y = int(H * fy)
        if plaque:
            half = int(len(text) * size * 0.31) + 18
            d.rectangle([WIDTH // 2 - half, y - size // 2 - 6, WIDTH // 2 + half, y + size // 2 + 8], fill=RED, outline=INK, width=3)
        pixel_text(canvas, (WIDTH // 2, y), text, size, fill, step)
    canvas.save(out_png)


def compose(office_png, caption, out_png, office_h, bar_h=BAR_H, fsize=17):
    """Office on a dark frame, caption below. office_h is the tallest frame of
    the scene, so every frame of a GIF has the same size (the office can grow)."""
    img = Image.open(office_png).convert("RGB")
    canvas = Image.new("RGB", (WIDTH, office_h + PAD_TOP + bar_h), BORDER)
    canvas.paste(img, ((WIDTH - img.width) // 2, PAD_TOP))
    d = ImageDraw.Draw(canvas)
    f = font(fsize)
    text = caption
    while d.textlength(text, font=f) > WIDTH - 32 and len(text) > 4:
        text = text[:-2]
    d.text((WIDTH // 2, office_h + PAD_TOP + bar_h // 2 + 1), text, font=f, fill="#f2e9d0", anchor="mm")
    canvas.save(out_png)


def build_scene(work, out, name):
    cfg = SETTINGS[name]
    src = os.path.join(work, "frames", name)
    png_dir = os.path.join(work, "png", name)
    os.makedirs(png_dir, exist_ok=True)
    captions = json.load(open(os.path.join(src, "captions.json")))
    idx = list(range(0, len(captions), cfg["stride"]))

    def raster(i):
        o = os.path.join(png_dir, f"raw{i:04d}.png")
        rasterize(os.path.join(src, f"{i:04d}.svg"), o)
        return o

    def one(i, o, office_h):
        c = os.path.join(png_dir, f"{i:04d}.png")
        if captions[i] in CARDS:
            compose_card(o, captions[i], c, office_h, cfg.get("bar_h", BAR_H))
        else:
            compose(o, captions[i], c, office_h, cfg.get("bar_h", BAR_H), cfg.get("font", 17))
        os.remove(o)
        return c

    with ThreadPoolExecutor(8) as ex:
        raws = list(ex.map(raster, idx))
        office_h = max(Image.open(r).height for r in raws)
        paths = list(ex.map(lambda t: one(t[0], t[1], office_h), zip(idx, raws)))
    frames = [Image.open(p).convert("RGB") for p in paths]

    # one shared palette from a sample of frames keeps colours steady (no flicker)
    sample = frames[:: max(1, len(frames) // 12)]
    sheet = Image.new("RGB", (frames[0].width, sum(f.height for f in sample)))
    y = 0
    for f in sample:
        sheet.paste(f, (0, y)); y += f.height
    pal = sheet.quantize(colors=255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)

    q = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in frames]
    delay = round(1000 / cfg["fps"])
    durations, merged = [], []
    for f in q:
        if merged and f.tobytes() == merged[-1].tobytes():
            durations[-1] += delay
        else:
            merged.append(f); durations.append(delay)
    durations[-1] += int(cfg["hold"] * 1000)  # linger on the last frame before looping
    path = os.path.join(out, f"{name}.gif")
    merged[0].save(path, save_all=True, append_images=merged[1:], duration=durations, loop=0, optimize=True, disposal=1)
    kb = os.path.getsize(path) / 1024
    print(f"{name}: {len(frames)} frames -> {path} ({kb:.0f} KB, {sum(durations) / 1000:.1f} s)")


if __name__ == "__main__":
    work, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    names = sys.argv[3:] or list(SETTINGS)
    for n in names:
        build_scene(work, out, n)
