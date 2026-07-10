#!/bin/sh
set -eu

ROOT=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
TEST_HOME=$(mktemp -d "${TMPDIR:-/tmp}/engineering-harness-test.XXXXXX")
trap 'rm -rf "$TEST_HOME"' EXIT HUP INT TERM

mkdir -p "$TEST_HOME/.codex"
printf '%s\n' '# Existing personal guidance' > "$TEST_HOME/.codex/AGENTS.md"

HARNESS_HOME="$TEST_HOME" "$ROOT/install.sh"
HARNESS_HOME="$TEST_HOME" "$ROOT/install.sh" --check
BACKUP_COUNT=$(find "$TEST_HOME/.codex/engineering-harness/backups" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
HARNESS_HOME="$TEST_HOME" "$ROOT/install.sh"
[ "$(find "$TEST_HOME/.codex/engineering-harness/backups" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')" -eq "$BACKUP_COUNT" ]

grep -F '<!-- engineering-harness:start -->' "$TEST_HOME/.codex/AGENTS.md" >/dev/null
grep -F '# Existing personal guidance' "$TEST_HOME/.codex/AGENTS.md" >/dev/null
[ "$(grep -c '<!-- engineering-harness:start -->' "$TEST_HOME/.codex/AGENTS.md")" -eq 1 ]
[ -f "$TEST_HOME/.agents/skills/engineering-lead/SKILL.md" ]
[ -f "$TEST_HOME/.codex/agents/implementer.toml" ]
[ -d "$TEST_HOME/.codex/engineering-harness/backups" ]

printf '%s\n' '# stale' >> "$TEST_HOME/.codex/agents/implementer.toml"
if HARNESS_HOME="$TEST_HOME" "$ROOT/install.sh" --check >/dev/null 2>&1; then
  printf '%s\n' 'expected stale persona check to fail' >&2
  exit 1
fi

HARNESS_HOME="$TEST_HOME" "$ROOT/install.sh" >/dev/null
HARNESS_HOME="$TEST_HOME" "$ROOT/install.sh" --check >/dev/null

BROKEN_HOME=$(mktemp -d "${TMPDIR:-/tmp}/engineering-harness-broken.XXXXXX")
mkdir -p "$BROKEN_HOME/.codex"
printf '%s\n' '<!-- engineering-harness:start -->' '# must survive' > "$BROKEN_HOME/.codex/AGENTS.md"
cp "$BROKEN_HOME/.codex/AGENTS.md" "$BROKEN_HOME/original"
if HARNESS_HOME="$BROKEN_HOME" "$ROOT/install.sh" >/dev/null 2>&1; then
  printf '%s\n' 'expected malformed marker install to fail' >&2
  exit 1
fi
cmp -s "$BROKEN_HOME/original" "$BROKEN_HOME/.codex/AGENTS.md"
rm -rf "$BROKEN_HOME"

COLLISION_HOME=$(mktemp -d "${TMPDIR:-/tmp}/engineering-harness-collision.XXXXXX")
mkdir -p "$COLLISION_HOME/.codex/AGENTS.md"
if HARNESS_HOME="$COLLISION_HOME" "$ROOT/install.sh" >/dev/null 2>&1; then
  printf '%s\n' 'expected AGENTS.md directory collision to fail' >&2
  exit 1
fi
[ -d "$COLLISION_HOME/.codex/AGENTS.md" ]
rm -rf "$COLLISION_HOME"

STRAY_HOME=$(mktemp -d "${TMPDIR:-/tmp}/engineering-harness-stray.XXXXXX")
HARNESS_HOME="$STRAY_HOME" "$ROOT/install.sh" >/dev/null
printf '%s\n' '<!-- engineering-harness:end -->' >> "$STRAY_HOME/.codex/AGENTS.md"
cp "$STRAY_HOME/.codex/AGENTS.md" "$STRAY_HOME/original"
if HARNESS_HOME="$STRAY_HOME" "$ROOT/install.sh" --check >/dev/null 2>&1; then
  printf '%s\n' 'expected stray marker check to fail' >&2
  exit 1
fi
if HARNESS_HOME="$STRAY_HOME" "$ROOT/install.sh" >/dev/null 2>&1; then
  printf '%s\n' 'expected stray marker install to fail' >&2
  exit 1
fi
cmp -s "$STRAY_HOME/original" "$STRAY_HOME/.codex/AGENTS.md"
rm -rf "$STRAY_HOME"

printf '%s\n' 'Installer acceptance test passed.'
