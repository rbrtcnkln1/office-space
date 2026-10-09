# Contributing

Issues and pull requests are welcome.

## Develop locally

1. Clone the repo, then in Claude Code add your clone as a marketplace and install from it:
   ```
   /plugin marketplace add /path/to/office-space
   /plugin install office-space@office-space
   ```
2. Edit, then run `/reload-plugins` to pick up changes. `/office-space` opens the office.
3. Before a PR:
   ```bash
   claude plugin validate .
   claude plugin test .
   ```

## Ground rules

- **UI only, zero context cost.** The mod draws; it never adds skills, agents, MCP tools or system-prompt text. Anything that would put tokens in the model's context needs an issue and a discussion first.
- **Generic.** No references to any company, product, machine, account or private workflow.
- **Never crash the session.** Every file, store or agent read tolerates missing and malformed data.
- **Tests with behaviour.** New behaviour gets a test in `tests/`.
- **Releases** bump `version` in `.claude-plugin/plugin.json` and add a `CHANGELOG.md` entry.
