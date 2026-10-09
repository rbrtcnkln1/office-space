#!/usr/bin/env bash
# Run the test suite against the plugin without shipping the tests.
#
#   bash scripts/test.sh                  # uses `claude` on your PATH
#   CLAUDE_BIN=/path/to/claude bash scripts/test.sh
#
# `claude plugin test` only looks for tests inside the folder it is given, but
# installs copy everything under plugin/. So the tests live in tests/ at the
# repo root and are staged next to a copy of plugin/ in a scratch folder here.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
# The root stub is what copies older than 0.8.2 read for their update check.
v_plugin="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$root/plugin/.claude-plugin/plugin.json" | head -1)"
v_stub="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$root/.claude-plugin/plugin.json" | head -1)"
if [ "$v_plugin" != "$v_stub" ]; then
  echo "Version mismatch: plugin/.claude-plugin/plugin.json is $v_plugin but the root stub .claude-plugin/plugin.json is $v_stub. Bump both." >&2
  exit 1
fi
stage="$(mktemp -d "${TMPDIR:-/tmp}/office-space-test.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
cp -R "$root/plugin/." "$stage/"
cp -R "$root/tests" "$stage/tests"
"${CLAUDE_BIN:-claude}" plugin test "$stage"
