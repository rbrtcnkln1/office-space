# Changelog

Every release bumps `version` in `.claude-plugin/plugin.json`; that bump is what installed copies update to.

## Unreleased
- README: screenshot, quick start, requirements and FAQ.
- `examples/office-worker.sh` (worker writer) and `examples/demo.sh` (60-second demo).

## 0.7.0 — 2026-10-08
- External workers: work running outside the session appears in the office from a watched folder of JSON files (see README).
- Remote workers get a source badge, a persistent ? / ! bubble when waiting or blocked, fade when stale and leave when gone.
- Settings: `workersDir`, `staleMinutes`; env override `OFFICE_SPACE_WORKERS_DIR`.

## 0.6.0
- First public baseline: subagents as 16-bit office workers, The Boss, breaks, handoffs, Employee of the Day, panel and band views.
