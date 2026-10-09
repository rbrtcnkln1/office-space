#!/usr/bin/env bash
# Report one worker to Office Space.
# usage: office-worker.sh <id> <working|waiting|blocked|done|failed> "<task>" ["<note>"]
# Set OFFICE_SPACE_WORKERS_DIR to use a different folder.
set -eu
[ "$#" -ge 2 ] || { echo "usage: $0 <id> <status> \"<task>\" [\"<note>\"]" >&2; exit 2; }

id="$1"; status="$2"; task="${3:-}"; note="${4:-}"
dir="${OFFICE_SPACE_WORKERS_DIR:-$HOME/.claude/office-space/workers}"
mkdir -p "$dir"
source_label="$(hostname -s)"
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Write to a hidden temp name, then rename, so the mod never reads half a file.
tmp="$dir/.$id.tmp"
if command -v jq >/dev/null 2>&1; then
  jq -n --arg id "$id" --arg status "$status" --arg task "$task" --arg note "$note" \
        --arg source "$source_label" --arg updated "$now" \
     '{id:$id, status:$status, task:$task, note:$note, source:$source, updated:$updated}' > "$tmp"
else
  # No jq: escape backslashes and quotes, and flatten newlines and tabs.
  esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n\r\t' '   '; }
  printf '{"id":"%s","status":"%s","task":"%s","note":"%s","source":"%s","updated":"%s"}\n' \
    "$(esc "$id")" "$(esc "$status")" "$(esc "$task")" "$(esc "$note")" "$(esc "$source_label")" "$now" > "$tmp"
fi
mv "$tmp" "$dir/$id.json"
