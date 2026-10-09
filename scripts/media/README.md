# Media generator

Builds the README GIFs and the teaser rough cut from the **real renderer**. Nothing is screen-recorded: the scenes drive the `Office` class from `plugin/hooks/office.ts` tick by tick, dump one SVG per frame, rasterize and assemble.

```bash
bash scripts/media/build.sh          # GIFs -> docs/media/, teaser -> docs/promo/office-space-teaser.mp4
bash scripts/media/build.sh gifs     # GIFs only
```

Needs `bun`, `rsvg-convert`, Python 3 with Pillow, and (for the MP4, macOS only) `swiftc`. No ffmpeg or gifski is used. Intermediate frames go to `scripts/media/.work/` (git-ignored); set `MEDIA_WORK` to put them elsewhere.

## How it works

| Step | File | What it does |
| --- | --- | --- |
| 1 | `frames.ts` | Scripted scenes (`explainer`, `hire-day`, `hand-in`, `remote-crew`, `break-room`; `explainer` is the README banner, with `@title`/`@end` cards drawn by `build.py`). `Math.random` is replaced by a seeded generator before each scene, so the output is byte-for-byte reproducible. One SVG per tick (100 ms) plus a caption list. |
| 2 | `build.py` | `rsvg-convert` at 2x, then each frame is framed on an 800 px canvas with a caption bar. Keeps every second tick (a time-lapse), uses one shared 255-colour palette (no flicker), merges identical frames and loops forever. |
| 3 | `teaser.py` | Re-rasterizes the same frames at 3 px per logical pixel (still an integer multiple, so the art stays crisp), cuts the shot list from `docs/promo/storyboard.md` to 1280x720 and burns in the captions. |
| 4 | `encode_mp4.swift` | Encodes the teaser PNGs to a silent H.264 MP4 with AVFoundation. |

To change a scene, edit `frames.ts` (the story and the captions) or the per-scene speed in `SETTINGS` in `build.py`. Break activities that are random in the live mod (coffee, push-ups) are triggered explicitly in the scene so they always happen.

The README's promo thumbnail (`docs/media/teaser-thumbnail.png`) is made by `thumbnail.py`: `python3 scripts/media/thumbnail.py WORK_DIR` takes one `remote-crew` frame from `frames.ts` output, scales it 2x with nearest-neighbour, darkens it and adds the pixel-style title, play button and duration badge. It is not part of `build.sh`.
