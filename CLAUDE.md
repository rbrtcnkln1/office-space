# Office Space — project instructions

Open-source (MIT) Claude Code mod: subagents drawn as 16-bit office workers. Public repo `rbrtcnkln1/office-space`; the repo root is the marketplace (`.claude-plugin/marketplace.json`, source `./plugin`) and `plugin/` is the plugin itself (`plugin/.claude-plugin/plugin.json`).

## Hard rules
- **Public and generic.** Nothing about any employer, client, machine name, private repo, board or personal workflow — in code, tests, fixtures, docs or commit messages. Scan before every push.
- **Zero context cost.** Hooks that draw UI only. Do not add skills, agents, MCP servers, `prompt.compose` sections or tool descriptions without an explicit decision; that is what keeps the mod free to run.
- **Install stays lean:** only runtime files live in `plugin/`; media/docs/tests/tools stay outside it. Everything under `plugin/` is downloaded by every user.
- **Never crash the host.** All reads (`$.agent`, `$.fs`, `$.store`) tolerate failure and malformed data.
- **Releases:** bump `version` in `plugin/.claude-plugin/plugin.json` (installed copies only update on a bump), add a CHANGELOG entry, tag `vX.Y.Z`.
- Load the `plugin-authoring` skill before editing hooks.

## Layout
- `plugin/hooks/register.tsx` — events, commands, polling, panel + band rendering
- `plugin/hooks/office.ts` — layout, worker/boss state machines, SVG renderer (pure, no `$`)
- `plugin/hooks/external.ts` — external-workers file contract (pure, no `$`)
- `plugin/hooks/sprites.ts` — pixel art, roles, palettes
- `plugin/hooks/update.ts` — update check and command logic (pure)
- `tests/*.test.tsx` — outside `plugin/` to keep installs small. `claude plugin test` only finds tests inside the folder it is given, so `bash scripts/test.sh` stages them beside a copy of `plugin/`
- `examples/`, `docs/`, `scripts/` — not shipped

## Verify
`claude plugin validate .` (marketplace), `claude plugin validate plugin` and `bash scripts/test.sh` must pass (`CLAUDE_BIN=...` picks a build). Use a Claude Code build >= the one that loads module hooks (2.1.29x); older CLIs reject `hooks.json` `modules`. The engine lays `plugin/.claude-plugin/types/` when it loads the mod (ignored by version control).
