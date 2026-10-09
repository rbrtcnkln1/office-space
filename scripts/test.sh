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
stage="$(mktemp -d "${TMPDIR:-/tmp}/office-space-test.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
cp -R "$root/plugin/." "$stage/"
cp -R "$root/tests" "$stage/tests"
"${CLAUDE_BIN:-claude}" plugin test "$stage"
