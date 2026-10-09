#!/usr/bin/env python3
"""Assemble the rough-cut teaser frames (1280x720) from the scene SVG frames
that frames.ts wrote, plus title/end cards, with captions burned in.

    python3 scripts/media/teaser.py WORK_DIR [fps=24]

Writes WORK_DIR/teaser/NNNNN.png. Encode with encode_mp4.swift. The shot list
below follows docs/promo/storyboard.md. Offices are drawn at 3 px per logical
pixel (an integer multiple, so the pixel art stays crisp).
"""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
BG = "#1b2233"
CREAM = "#f2e9d0"
RED = "#e0523f"
INSTALL = "/plugin install office-space --marketplace rbrtcnkln1/office-space"
MENLO = "/System/Library/Fonts/Menlo.ttc"  # 0 regular, 1 bold, 2 bold italic, 3 italic

# (kind, scene, seconds, caption, voiceover). Clips are time-lapsed to fit.
SHOTS = [
    ("title", "hire-day", 4, "OFFICE SPACE for Claude Code", "In a world of urgent assignments... someone ordered tiny desks."),
    ("clip", "hire-day", 8, "Orientation includes a commute.", "Three new hires. One briefing. The orientation is mostly walking."),
    ("clip", "hand-in", 7, "Promotions last until the next hand-in.", "Results go upstairs. Mistakes arrive in red. Employee of the Day is a rapidly changing position."),
    ("clip", "remote-crew", 6, "Even remote work has office drama.", "Remote staff get desks, too. Blocked. Awaiting your decision. Or... suspiciously transparent."),
    ("clip", "break-room", 8, "The Boss practices executive stillness.", "Coffee. Push-ups. Management whistles. All the office atmosphere. None of the context overhead."),
    ("end", "hire-day", 4, "OFFICE SPACE for Claude Code", "Office Space. Give your agents somewhere to sit."),
]


def font(size, idx=1):
    return ImageFont.truetype(MENLO, size, index=idx)


def wrap(d, text, f, width):
    lines, cur = [], ""
    for word in text.split():
        t = (cur + " " + word).strip()
        if d.textlength(t, font=f) <= width:
            cur = t
        else:
            lines.append(cur); cur = word
    return lines + [cur]


def text_block(img, caption, vo, y_bottom=H - 18):
    """Caption (bold) over the voiceover line (italic), bottom-aligned, on a dark band."""
    d = ImageDraw.Draw(img)
    fc, fv = font(36, 1), font(21, 3)
    vo_lines = wrap(d, f"VO: \"{vo}\"", fv, W - 120)
    band = 54 + 28 * len(vo_lines) + 18
    d.rectangle([0, H - band, W, H], fill=BG)
    y = H - band + 14
    d.text((W // 2, y), caption, font=fc, fill=CREAM, anchor="mt")
    y += 54
    for ln in vo_lines:
        d.text((W // 2, y), ln, font=fv, fill="#9aa7c4", anchor="mt")
        y += 28
    return band


def office_frame(svg_dir, tick, cache):
    png = os.path.join(cache, f"{tick:04d}.png")
    if not os.path.exists(png):
        subprocess.run(["rsvg-convert", "-z", "1.5", os.path.join(svg_dir, f"{tick:04d}.svg"), "-o", png], check=True)
    return png


def card_frame(base, line1, install, vo, dim=0.78):
    img = base.copy()
    over = Image.new("RGB", img.size, BG)
    img = Image.blend(img, over, dim)
    d = ImageDraw.Draw(img)
    d.text((W // 2, 250), "OFFICE SPACE", font=font(104, 1), fill=CREAM, anchor="mm")
    d.text((W // 2, 335), "for Claude Code", font=font(40, 0), fill=RED, anchor="mm")
    f = font(27, 1)
    t = install
    while d.textlength(t, font=f) > W - 80:
        f = font(f.size - 1, 1)
    d.rounded_rectangle([W // 2 - d.textlength(t, font=f) / 2 - 24, 408, W // 2 + d.textlength(t, font=f) / 2 + 24, 470], 10, fill="#0f1420", outline="#3b4766", width=2)
    d.text((W // 2, 439), t, font=f, fill="#8fe3a0", anchor="mm")
    fv = font(21, 3)
    for k, ln in enumerate(wrap(d, f"VO: \"{vo}\"", fv, W - 120)):
        d.text((W // 2, 640 + k * 28), ln, font=fv, fill="#9aa7c4", anchor="mt")
    return img


def main():
    work = sys.argv[1]
    fps = int(sys.argv[2]) if len(sys.argv) > 2 else 24
    out = os.path.join(work, "teaser")
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        os.remove(os.path.join(out, f))

    # plan every output frame: (shot index, local frame, total frames)
    plan = []
    for si, (kind, scene, secs, cap, vo) in enumerate(SHOTS):
        n = secs * fps
        plan += [(si, k, n) for k in range(n)]

    # rasterize the office ticks we need, in parallel
    needed = {}
    for si, k, n in plan:
        kind, scene = SHOTS[si][0], SHOTS[si][1]
        ticks = len(json.load(open(os.path.join(work, "frames", scene, "captions.json"))))
        t = 0 if kind == "title" else (ticks - 1 if kind == "end" else min(ticks - 1, int(k * ticks / n)))
        if kind == "title":
            t = 0
        needed[(si, k)] = t
    caches = {}
    jobs = set()
    for (si, k), t in needed.items():
        scene = SHOTS[si][1]
        caches[scene] = os.path.join(work, "png15", scene)
        os.makedirs(caches[scene], exist_ok=True)
        jobs.add((scene, t))
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(lambda j: office_frame(os.path.join(work, "frames", j[0]), j[1], caches[j[0]]), jobs))

    for idx, (si, k, n) in enumerate(plan):
        kind, scene, secs, cap, vo = SHOTS[si]
        t = needed[(si, k)]
        office = Image.open(office_frame(os.path.join(work, "frames", scene), t, caches[scene])).convert("RGB")
        base = Image.new("RGB", (W, H), BG)
        if kind == "clip":
            band = 54 + 28 * 2 + 18
            y = 46 + (H - band - 46 - office.height) // 2
            d = ImageDraw.Draw(base)
            d.text((24, 14), "OFFICE SPACE", font=font(20, 1), fill=RED)
            base.paste(office, ((W - office.width) // 2, max(40, y)))
            text_block(base, cap, vo)
        else:
            base.paste(office, ((W - office.width) // 2, 140))
            base = card_frame(base, cap, INSTALL, vo)
        # quick fade in on the first card and fade out on the last
        if si == 0 and k < fps // 2:
            base = Image.blend(Image.new("RGB", (W, H), "#000000"), base, k / (fps // 2))
        if si == len(SHOTS) - 1 and k >= n - fps // 2:
            base = Image.blend(base, Image.new("RGB", (W, H), "#000000"), (k - (n - fps // 2)) / (fps // 2))
        base.save(os.path.join(out, f"{idx:05d}.png"))
    print(f"{len(plan)} frames, {len(plan) / fps:.1f} s at {fps} fps -> {out}")


if __name__ == "__main__":
    main()
