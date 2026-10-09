# Changelog

Every release bumps `version` in `plugin/.claude-plugin/plugin.json`; that bump is what installed copies update to.

## Unreleased
- Fix: the first `/office-space` in a new chat no longer says "closed for the day" instead of opening. The toggle remembered the panel as open from the previous chat; it now asks the app which panels are actually showing in this session (`$.ui.panes()`), so the command opens a panel that is not there and closes one that is, including after the panel's close mark. The panel is no longer saved across sessions (the band setting still is).

## 0.9.0 — 2026-10-09
Per-project external workers, plus a remote annex, alerts and notes.
- New optional worker field `scope` (a folder path or an array of them, `~` allowed). A scoped worker shows only in sessions whose working folder is that folder or inside it; unscoped workers show everywhere as before. Paths are compared as real paths on a folder boundary. A malformed `scope` skips the worker, and if the session's working folder is unavailable, scoped workers are hidden. The answer is cached between folder refreshes so it stays cheap.
- External workers now sit in their own desk row, the remote annex, under a teal sign below the main floor. It appears only while an external worker is in the office (with none, the layout is unchanged), adds one spare desk, grows a row at a time, shrinks back after they leave and never moves a desk someone is sitting at.
- A toast when an external worker starts needing you (waiting or blocked): once per stint, never repeated while it holds, silent for workers already waiting at startup, and it works with the office closed. New setting `alertOnBlocked` (on by default) turns it off. Toast only, no sound.
- Press a waiting or blocked external worker (a button under the office in the panel and the band, on the desktop and in the terminal; number keys in the panel) to read its note and its optional `url`.
- New optional worker field `url`: only `http://` and `https://` addresses are kept, shown as text with a copy button and never opened.
- `examples/office-worker.sh` takes optional scope and url arguments, or `OFFICE_SPACE_SCOPE` and `OFFICE_SPACE_URL`.

## 0.8.2 — 2026-10-08
Smaller install.
- The install is about 120 KB instead of about 1.6 MB: the runtime now lives in `plugin/` and installs skip media, docs and tests.
- README animations (GIFs rendered from the real office), a promo script and storyboard, and a reproducible media generator in `scripts/media/`.
- GitHub issue forms now label submissions as idea/bug plus feedback.
- Copies older than 0.8.2 keep their update check working: a small version pointer stays at `.claude-plugin/plugin.json` in the repo root.

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
