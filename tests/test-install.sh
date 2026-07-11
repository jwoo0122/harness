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
[ -f "$TEST_HOME/.pi/agent/agents/implementer.md" ]
[ -f "$TEST_HOME/.pi/agent/AGENTS.md" ]
[ "$(grep -c '<!-- engineering-harness:start -->' "$TEST_HOME/.pi/agent/AGENTS.md")" -eq 1 ]
[ -d "$TEST_HOME/.codex/engineering-harness/backups" ]

for role in requirements-analyst explorer architect implementer verifier reviewer; do
  role_file="$TEST_HOME/.pi/agent/agents/$role.md"
  [ -f "$role_file" ]
  grep -Fx "name: $role" "$role_file" >/dev/null
  grep -E '^description: .+' "$role_file" >/dev/null
done
for role in requirements-analyst explorer architect reviewer; do
  grep -Fx 'tools: read, grep, find, ls' "$TEST_HOME/.pi/agent/agents/$role.md" >/dev/null
done
grep -Fx 'tools: read, grep, find, ls, bash' "$TEST_HOME/.pi/agent/agents/verifier.md" >/dev/null

printf '%s\n' '# Custom Pi role' > "$TEST_HOME/.pi/agent/agents/custom.md"
HARNESS_HOME="$TEST_HOME" "$ROOT/install.sh" >/dev/null
[ -f "$TEST_HOME/.pi/agent/agents/custom.md" ]

printf '%s\n' '# Existing Pi guidance' > "$TEST_HOME/.pi/agent/AGENTS.md"
HARNESS_HOME="$TEST_HOME" "$ROOT/install.sh" >/dev/null
grep -F '# Existing Pi guidance' "$TEST_HOME/.pi/agent/AGENTS.md" >/dev/null

printf '%s\n' '# stale' >> "$TEST_HOME/.pi/agent/agents/implementer.md"
if HARNESS_HOME="$TEST_HOME" "$ROOT/install.sh" --check >/dev/null 2>&1; then
  printf '%s\n' 'expected stale Pi agent check to fail' >&2
  exit 1
fi
HARNESS_HOME="$TEST_HOME" "$ROOT/install.sh" >/dev/null
HARNESS_HOME="$TEST_HOME" "$ROOT/install.sh" --check >/dev/null

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

PI_AGENT_COLLISION_HOME=$(mktemp -d "${TMPDIR:-/tmp}/engineering-harness-pi-agent-collision.XXXXXX")
mkdir -p "$PI_AGENT_COLLISION_HOME/.pi/agent/agents/implementer.md"
if HARNESS_HOME="$PI_AGENT_COLLISION_HOME" "$ROOT/install.sh" >/dev/null 2>&1; then
  printf '%s\n' 'expected Pi agent path collision to fail' >&2
  exit 1
fi
[ -d "$PI_AGENT_COLLISION_HOME/.pi/agent/agents/implementer.md" ]
rm -rf "$PI_AGENT_COLLISION_HOME"

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
