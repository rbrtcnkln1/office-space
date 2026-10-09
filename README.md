# Office Space

A Claude Code mod that draws your session as a tiny 16-bit office. The main chat is **The Boss**. Each subagent walks in, picks up its assignment, sits at a desk and works. When it finishes, it walks back to hand in the result and leaves.

```
/office-space        open or close the Office Space panel
/office-space band   show or hide the small version above the prompt
```

## External workers

Work running **outside** the session can show up in the office too: a job on another machine, another CLI, a cron job. Any script can join by writing a small JSON file. The mod only ever reads these files.

### The contract

Put one JSON file per worker in the workers folder:

- Default folder: `~/.claude/office-space/workers/`
- To change it, set the `OFFICE_SPACE_WORKERS_DIR` environment variable, or the plugin's **External workers folder** setting. The environment variable wins.

```json
{
  "id": "nightly-backup",
  "name": "Backup bot",
  "status": "blocked",
  "task": "Copying photos to the NAS",
  "updated": "2026-10-08T14:03:00Z",
  "source": "cron",
  "note": "Disk is full, free some space"
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `status` | yes | `working`, `waiting`, `blocked`, `done` or `failed` |
| `id` | no | Unique per worker. Defaults to the file name without `.json` |
| `name` | no | Display name. Defaults to `id` |
| `task` | no | What it's doing. Shown under the desk |
| `updated` | no | ISO 8601 time or epoch milliseconds. Defaults to the file's modified time |
| `source` | no | A short label for the desk badge, such as `remote`, `cron` or `laptop`. Defaults to `remote` |
| `note` | no | What a human needs to do. Shown instead of the task while the worker is waiting or blocked |

### How workers appear

- **working**: walks in and goes straight to a desk with no briefing from the Boss, since it already has its work. A teal badge on the desk shows its `source`.
- **waiting**: a white **?** bubble stays over the worker's head, because a person is needed.
- **blocked**: a red **!** bubble stays over the worker's head. The summary line counts these as "N needs you".
- **done** or **failed**: hands the result to the Boss (a failed result is red) and walks out.
- **Stale**: after 15 minutes without an update, the worker fades and its desk shows `stale Nm`. After 4× that time (1 hour by default), it walks out. Change the time limit with the **Stale after (minutes)** setting.
- **File deleted**: the worker quietly walks out.

The folder is checked every 5 seconds. Only files that changed since the last check are re-read. The mod skips a file without crashing if it is malformed, unreadable, bigger than 64 KB, hidden (starts with `.`), or not `.json`. It shows at most 40 external workers.

### Example writer

To avoid half-written reads, write each file to a hidden temp name, then rename it:

```bash
#!/usr/bin/env bash
# usage: office-worker.sh <id> <working|waiting|blocked|done|failed> "<task>" ["<note>"]
dir="${OFFICE_SPACE_WORKERS_DIR:-$HOME/.claude/office-space/workers}"; mkdir -p "$dir"
printf '{"id":"%s","status":"%s","task":"%s","note":"%s","source":"%s","updated":"%s"}\n' \
  "$1" "$2" "$3" "${4:-}" "$(hostname -s)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$dir/.$1.tmp"
mv "$dir/.$1.tmp" "$dir/$1.json"
```

This script doesn't escape its arguments, so a task containing `"` writes an invalid file, which the mod skips. For arbitrary text, build the JSON with `jq -n --arg ...` instead. To report from another machine, sync or mount its status folder into the workers folder (for example with `rsync` or a shared drive).

## Development

```bash
claude plugin validate .
claude plugin test .
```
