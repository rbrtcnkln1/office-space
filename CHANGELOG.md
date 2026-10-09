# Changelog

Every release bumps `version` in `.claude-plugin/plugin.json`; that bump is what installed copies update to.

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
