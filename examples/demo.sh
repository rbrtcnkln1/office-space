#!/usr/bin/env bash
# A 60-second Office Space demo: four fake workers walk through
# working -> waiting/blocked -> done/failed, then the demo cleans up.
# Open the office first (/office-space in Claude Code), then run:  bash examples/demo.sh
# It only touches files named demo-*.json in the workers folder.
dir="${OFFICE_SPACE_WORKERS_DIR:-$HOME/.claude/office-space/workers}"
mkdir -p "$dir"

cleanup() { rm -f "$dir"/demo-*.json "$dir"/.demo-*.tmp; }
trap cleanup EXIT
trap 'exit 130' INT TERM

# put <id> <name> <status> <task> <source> [note]
put() {
  local now tmp="$dir/.$1.tmp"
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"id":"%s","name":"%s","status":"%s","task":"%s","source":"%s","note":"%s","updated":"%s"}\n' \
    "$1" "$2" "$3" "$4" "$5" "${6:-}" "$now" > "$tmp"
  mv "$tmp" "$dir/$1.json"
}

echo "Office Space demo writing to: $dir"
echo "Watch the office. The mod checks the folder every 5 seconds. Ctrl-C to stop early."

echo "[0s] everyone starts work"
put demo-build  "Build bot"  working "Nightly build"    ci
put demo-backup "Backup bot" working "Copy photos"      cron
put demo-report "Report bot" working "Weekly report"    laptop
put demo-deploy "Deploy bot" working "Ship the release" ci
sleep 15

echo "[15s] backup is blocked, report needs a decision"
put demo-backup "Backup bot" blocked "Copy photos"   cron   "Disk is full, free some space"
put demo-report "Report bot" waiting "Weekly report" laptop "Approve the draft"
sleep 15

echo "[30s] build finishes, backup is unblocked"
put demo-build  "Build bot"  done    "Nightly build" ci
put demo-backup "Backup bot" working "Copy photos"   cron
sleep 15

echo "[45s] deploy fails, backup and report finish"
put demo-deploy "Deploy bot" failed "Ship the release" ci     "Tests failed"
put demo-backup "Backup bot" done   "Copy photos"      cron
put demo-report "Report bot" done   "Weekly report"    laptop
sleep 12

echo "[57s] cleaning up"
