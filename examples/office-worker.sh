#!/usr/bin/env bash
# Report one worker to Office Space.
# usage: office-worker.sh <id> <working|waiting|blocked|done|failed> "<task>" ["<note>"] ["<scope>"] ["<url>"]
# url (optional): an http(s) address shown, as text, when the waiting/blocked worker is pressed (OFFICE_SPACE_URL sets it for every call).
# scope (optional): an absolute folder; the worker then shows only in sessions working inside it.
# Set OFFICE_SPACE_SCOPE instead to apply one scope to every call (the argument wins).
# Set OFFICE_SPACE_WORKERS_DIR to use a different folder.
set -eu
[ "$#" -ge 2 ] || { echo "usage: $0 <id> <status> \"<task>\" [\"<note>\"] [\"<scope>\"] [\"<url>\"]" >&2; exit 2; }

id="$1"; status="$2"; task="${3:-}"; note="${4:-}"; scope="${5:-${OFFICE_SPACE_SCOPE:-}}"; url="${6:-${OFFICE_SPACE_URL:-}}"
case $url in
  ""|http://*|https://*) ;;
  *) echo "office-worker: url must start with http:// or https://" >&2; exit 2;;
esac
case $scope in
  ""|/*|"~"|"~/"*) ;;
  *) echo "office-worker: scope must be an absolute folder (or start with ~/)" >&2; exit 2;;
esac
case $id in
  ''|.*|*[!A-Za-z0-9._-]*) echo "office-worker: id must be letters, digits, . _ - (no leading dot)" >&2; exit 2;;
esac
case $status in
  working|waiting|blocked|done|failed) ;;
  *) echo "office-worker: status must be working, waiting, blocked, done or failed" >&2; exit 2;;
esac
dir="${OFFICE_SPACE_WORKERS_DIR:-$HOME/.claude/office-space/workers}"
mkdir -p "$dir"
if [ -L "$dir/$id.json" ]; then echo "office-worker: $dir/$id.json is a symlink; refusing" >&2; exit 2; fi
source_label="$(hostname -s)"
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Write to a private hidden temp file, then rename, so the mod never reads half a file.
tmp="$(mktemp "$dir/.office-worker.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
if command -v jq >/dev/null 2>&1; then
  jq -n --arg id "$id" --arg status "$status" --arg task "$task" --arg note "$note" \
        --arg source "$source_label" --arg updated "$now" \
     '{id:$id, status:$status, task:$task, note:$note, source:$source, updated:$updated}' > "$tmp"
  if [ -n "$scope" ]; then
    jq --arg scope "$scope" '. + {scope:$scope}' "$tmp" > "$tmp.s" && mv -f "$tmp.s" "$tmp"
  fi
  if [ -n "$url" ]; then
    jq --arg url "$url" '. + {url:$url}' "$tmp" > "$tmp.s" && mv -f "$tmp.s" "$tmp"
  fi
else
  # No jq: drop control characters, escape backslashes and quotes, flatten newlines and tabs.
  esc() { printf '%s' "$1" | tr -d '\000-\010\013\014\016-\037' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n\r\t' '   '; }
  printf '{"id":"%s","status":"%s","task":"%s","note":"%s","source":"%s","updated":"%s"}\n' \
    "$(esc "$id")" "$(esc "$status")" "$(esc "$task")" "$(esc "$note")" "$(esc "$source_label")" "$now" > "$tmp"
  if [ -n "$scope" ]; then
    sed -e "s|}\$|,\"scope\":\"$(esc "$scope" | sed -e 's/[\\|&]/\\&/g')\"}|" "$tmp" > "$tmp.s" && mv -f "$tmp.s" "$tmp"
  fi
  if [ -n "$url" ]; then
    sed -e "s|}\$|,\"url\":\"$(esc "$url" | sed -e 's/[|&]/\\&/g')\"}|" "$tmp" > "$tmp.s" && mv -f "$tmp.s" "$tmp"
  fi
fi
mv -f "$tmp" "$dir/$id.json"
