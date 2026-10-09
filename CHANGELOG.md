# Changelog

Every release bumps `version` in `plugin/.claude-plugin/plugin.json`; that bump is what installed copies update to.

## Unreleased
No version bump.
- Smaller install: only the files the mod needs are downloaded (~130 KB instead of ~1.6 MB). The plugin now lives in `plugin/`; the marketplace stays at the repo root.
- Update check reads `plugin/.claude-plugin/plugin.json`; local-clone detection looks one level up for `.git`.
- README animations (GIFs rendered from the real office).
- Promo script and storyboard.
- Reproducible media generator in `scripts/media/`.

## 0.8.1 — 2026-10-08
Updating and feedback.
- `/office-space-update` checks GitHub for a newer version and updates through `claude plugin update`; if that is not possible it prints the manual steps, and copies read from a local folder get a pull hint instead.
- New setting `checkForUpdates` (off by default): at most one toast per day when a newer version exists.
- README: an Updating section, including how to turn on marketplace auto-update.
- `/office-space-feedback` shows the issue link plus your Office Space and Claude Code versions to paste in. Nothing is sent anywhere.
- GitHub issue forms for bug reports and ideas.
- Clearer install steps for the terminal and the desktop app.

## 0.8.0 — 2026-10-08
Real slash commands.
- `/office-space-band` and `/office-space-help` now appear in the `/` menu with descriptions.
- `/office-space band` still works as before.
- Unknown arguments point to `/office-space-help`.

## 0.7.2 — 2026-10-08
Security hardening.
- Text from worker files and subagent descriptions is cleaned before drawing: control characters, invisible and right-to-left override characters, and invalid characters become spaces, so they can no longer stop the office from drawing or disguise a label.
- Symlinked worker files and files that grow past the size limit are ignored.
- A worker whose `updated` time is in the future now falls back to the file's modified time, so it leaves on schedule instead of staying forever.
- `examples/office-worker.sh` validates the id and status, writes through a private temp file, refuses to overwrite a symlink, and strips control characters when `jq` is missing.
- `examples/demo.sh` removes only its own four files.
- Stored Employee of the Day counts are validated when loaded.

## 0.7.1 — 2026-10-08
- README: screenshot, quick start, requirements, FAQ, and a copy-paste prompt to let Claude install the mod.
- `examples/office-worker.sh` (worker writer) and `examples/demo.sh` (60-second demo).
- Fix: switching between panel and band no longer resets the office.
- Reading the workers folder now happens in the background and is capped, so a big or slow folder cannot stall the UI.
- Control characters in a worker description are escaped and never reach the drawing.
- Faster redraws (cached wall seams); `.claude/` is now git-ignored.

## 0.7.0 — 2026-10-08
- External workers: work running outside the session appears in the office from a watched folder of JSON files (see README).
- Remote workers get a source badge, a persistent ? / ! bubble when waiting or blocked, fade when stale and leave when gone.
- Settings: `workersDir`, `staleMinutes`; env override `OFFICE_SPACE_WORKERS_DIR`.

## 0.6.0
- First public baseline: subagents as 16-bit office workers, The Boss, breaks, handoffs, Employee of the Day, panel and band views.
