# Office Space — project instructions

Open-source (MIT) Claude Code mod: subagents drawn as 16-bit office workers. Public repo `rbrtcnkln1/office-space`; the repo root is both the plugin and its marketplace (`.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`, source `./`).

## Hard rules
- **Public and generic.** Nothing about any employer, client, machine name, private repo, board or personal workflow — in code, tests, fixtures, docs or commit messages. Scan before every push.
- **Zero context cost.** Hooks that draw UI only. Do not add skills, agents, MCP servers, `prompt.compose` sections or tool descriptions without an explicit decision; that is what keeps the mod free to run.
- **Never crash the host.** All reads (`$.agent`, `$.fs`, `$.store`) tolerate failure and malformed data.
- **Releases:** bump `version` in `plugin.json` (installed copies only update on a bump), add a CHANGELOG entry, tag `vX.Y.Z`.
- Load the `plugin-authoring` skill before editing hooks.

## Layout
- `hooks/register.tsx` — events, commands, polling, panel + band rendering
- `hooks/office.ts` — layout, worker/boss state machines, SVG renderer (pure, no `$`)
- `hooks/external.ts` — external-workers file contract (pure, no `$`)
- `hooks/sprites.ts` — pixel art, roles, palettes
- `tests/*.test.tsx` — `claude plugin test .`

## Verify
`claude plugin validate .` and `claude plugin test .` must pass. Use a Claude Code build ≥ the one that loads module hooks (2.1.29x); older CLIs reject `hooks.json` `modules`.
