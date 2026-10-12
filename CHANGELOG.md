# Changelog

Every release bumps `version` in `plugin/.claude-plugin/plugin.json`; that bump is what installed copies update to.

## 0.12.0 — 2026-10-11
Make the whole office yours: decorate the room, rename and restyle the team, and save it all as a theme.
- New `/office-space-office`: decorate the office. Pick from 9 wall colors, 8 floors, a vending machine, arcade cabinet, couch, potted fern, cactus, lava lamp, fish tank and 4 posters, in plain words or step by step with buttons in the Office Space panel. You see what will change and press Apply before anything is saved; the decor is kept between sessions. `remove <piece>`, `list` and `reset` need no AI call. Pieces only go where nobody walks, and the default office draws exactly as before. Closes [#6](https://github.com/rbrtcnkln1/office-space/issues/6).
- Workers now visit a vending machine on their breaks (when you add one) and carry back a soda, donut or cookie.
- New `/office-space-team`: rename roles ("call the Coder Mx. Bytes"), restyle them from the art catalog (hair, hair color, outfit, accessory) and set the starting desk count (5 to 15, in rows of five). Say it in words or pick step by step in the panel; you press Apply before anything is saved. `reset` restores everything, `reset coder` one role. Names are cleaned and drawn as plain text, and `/office-space-recap` and the Employee of the Day use your titles too. Closes [#4](https://github.com/rbrtcnkln1/office-space/issues/4).
- New `/office-space-theme`: `save <name>` writes your Boss, team and office decor to a small JSON file you can share, `load <name or path>` reads one back (strictly checked against the catalog, data only, with an Apply step), `list`, and `reset`. Three built-in presets, each with its own Boss, team and decorated room: 90s startup, cozy library, night shift. Closes [#7](https://github.com/rbrtcnkln1/office-space/issues/7).
- Words for the office and the team (or choosing Other) make one small side request to a model, like the Boss, which uses a little plan usage; the reply is checked against the catalog before it is shown. Buttons, `list`, `remove`, `reset` and themes use none. Nothing is added to your conversation.
- One step-by-step choice screen is shared by `/office-space-boss`, `/office-space-office`, `/office-space-team` and the theme's Apply step; only one is open at a time, and starting another replaces it.
- Fix: the task line under each desk now wraps to at most two lines (24 characters each, ending in an ellipsis when cut) so neighbouring desks' text no longer runs together.
- Fix: `/office-space-recap` missed background agents that started and finished between two 5-second looks, so busy days showed 0 hand-ins. Agents first seen already completed or failed now count (the first look after loading is only a baseline, so earlier work is not recounted). The recap also listens for the host's subagent-stop event, so an agent is counted even if the list drops it before the next look; each agent is counted once per finish.

## 0.11.0 — 2026-10-11
Make the Boss yours.
- New `/office-space-boss`: change the Boss's hair style, hair color, outfit and accessory. Type what you want in plain words, or pick step by step with buttons in the Office Space panel. You see what will change and press Apply before anything is saved. `reset` brings the default back, and your look is kept between sessions.
- Describing a look in words makes one small side request to a model, which uses a little plan usage. The step-by-step choice uses none. Nothing is added to your conversation.
- The catalog: 8 hair styles, 14 hair colors, 6 outfits (including an early-2000s track jacket) and 6 accessories. Anything a model suggests is checked against it before it is shown.

## 0.10.0 — 2026-10-11
Four commands that tell you what is happening in the office, and a usage board.
- New `/office-space-roster`: everyone at work (subagents and outside workers), their state, how long they have been at it, and a one-line summary of what each is doing. The summaries come from one batched small-model call per run, outside your chat, and the reply is validated before it is shown. When the call fails or there is no activity to read, each line falls back to the worker's own task text and says so. This is the only command that uses plan usage.
- New `/office-space-recap`: today's hand-ins, failures, outside workers that needed a person and the Employee of the Day, kept per day across sessions.
- New `/office-space-usage`: context fill, plan limit windows with reset times and cost, as text. Figures the host does not give are left out.
- New `/office-space-workers`: the watched folder, the workers read from it and each skipped file with a plain reason (invalid JSON, unknown status, missing status, bad scope, too big, too old, symlink, older copy, scoped to another folder). Closes [#13](https://github.com/rbrtcnkln1/office-space/issues/13).
- Usage in the office: an in-tray (context), a wall clock (session limit) and a wall calendar (weekly limit), refreshed when the numbers change. New setting `showUsage` (on by default) hides them. Closes [#16](https://github.com/rbrtcnkln1/office-space/issues/16).
- None of the commands add anything to the conversation's context.

## 0.9.1 — 2026-10-09
- Fix: `/office-space` now opens on the first try in a new chat; the panel's open state is no longer carried over between chats. The toggle asks the app which panels are actually showing in this session (`$.ui.panes()`), so it opens a panel that is not there and closes one that is, including after the panel's close mark. The band setting is still saved.

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
