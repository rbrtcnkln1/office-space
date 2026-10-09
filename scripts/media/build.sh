#!/usr/bin/env bash
# Rebuild the README GIFs and the teaser rough cut from the real renderer.
#
#   bash scripts/media/build.sh            # GIFs -> docs/media/, teaser -> docs/promo/
#   bash scripts/media/build.sh gifs       # GIFs only
#
# Needs: bun, rsvg-convert, Python 3 with Pillow; swiftc (macOS) for the MP4.
# Intermediate frames go to scripts/media/.work (git-ignored).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
work="${MEDIA_WORK:-$here/.work}"

bun "$here/frames.ts" "$work/frames"
rm -rf "$work/png" "$work/png15"
python3 "$here/build.py" "$work" "$root/docs/media"

if [ "${1:-all}" != "gifs" ]; then
  python3 "$here/teaser.py" "$work" 24
  swiftc -O "$here/encode_mp4.swift" -o "$work/encode_mp4"
  "$work/encode_mp4" "$work/teaser" "$root/docs/promo/office-space-teaser.mp4" 24
fi
