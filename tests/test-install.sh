#!/bin/sh
set -eu

ROOT=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
TEST_HOME=$(mktemp -d "${TMPDIR:-/tmp}/engineering-harness-test.XXXXXX")
BOOTSTRAP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/engineering-harness-bootstrap-test.XXXXXX")
trap 'rm -rf "$TEST_HOME" "$BOOTSTRAP_ROOT"' EXIT HUP INT TERM

mkdir -p "$TEST_HOME/.codex"
printf '%s\n' '# Existing personal guidance' > "$TEST_HOME/.codex/AGENTS.md"

HARNESS_HOME="$TEST_HOME" "$ROOT/install.sh"
HARNESS_HOME="$TEST_HOME" "$ROOT/install.sh" --check
BACKUP_COUNT=$(find "$TEST_HOME/.codex/engineering-harness/backups" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
HARNESS_HOME="$TEST_HOME" "$ROOT/install.sh"
[ "$(find "$TEST_HOME/.codex/engineering-harness/backups" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')" -eq "$BACKUP_COUNT" ]

grep -F '<!-- engineering-harness:start -->' "$TEST_HOME/.codex/AGENTS.md" >/dev/null
grep -F '# Existing personal guidance' "$TEST_HOME/.codex/AGENTS.md" >/dev/null
grep -F 'Act as the lead engineer responsible for delivering a working, verified result.' "$TEST_HOME/.codex/AGENTS.md" >/dev/null
if grep -F 'All commits intended for `main`' "$TEST_HOME/.codex/AGENTS.md" >/dev/null; then
  printf '%s\n' 'contributor instructions leaked into installed runtime guidance' >&2
  exit 1
fi
[ "$(grep -c '<!-- engineering-harness:start -->' "$TEST_HOME/.codex/AGENTS.md")" -eq 1 ]
[ -f "$TEST_HOME/.agents/skills/engineering-lead/SKILL.md" ]
for skill in grill-with-docs grilling domain-modeling; do
  [ -f "$TEST_HOME/.agents/skills/$skill/SKILL.md" ]
done
[ -f "$TEST_HOME/.agents/skills/domain-modeling/references/ADR-FORMAT.md" ]
[ -f "$TEST_HOME/.agents/skills/domain-modeling/references/CONTEXT-FORMAT.md" ]
grep -F 'Do not implement' "$TEST_HOME/.agents/skills/grill-with-docs/SKILL.md" >/dev/null
[ -f "$TEST_HOME/.codex/agents/implementer.toml" ]
[ -f "$TEST_HOME/.pi/agent/agents/implementer.md" ]
[ -f "$TEST_HOME/.pi/agent/AGENTS.md" ]
[ "$(grep -c '<!-- engineering-harness:start -->' "$TEST_HOME/.pi/agent/AGENTS.md")" -eq 1 ]
[ -d "$TEST_HOME/.codex/engineering-harness/backups" ]
grep -F 'engineering-harness-skills' "$TEST_HOME/.agents/skills/engineering-lead/SKILL.md" >/dev/null

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

FIXTURE_ROOT=$BOOTSTRAP_ROOT/archive/engineering-harness-fixture
mkdir -p "$FIXTURE_ROOT"
cp "$ROOT/install.sh" "$ROOT/AGENTS.md" "$FIXTURE_ROOT/"
cp -R "$ROOT/.agents" "$ROOT/.codex" "$ROOT/.pi" "$ROOT/resources" "$FIXTURE_ROOT/"
ARCHIVE=$BOOTSTRAP_ROOT/engineering-harness.tar.gz
tar -czf "$ARCHIVE" -C "$BOOTSTRAP_ROOT/archive" engineering-harness-fixture

REMOTE_HOME=$BOOTSTRAP_ROOT/home
REMOTE_WORK=$BOOTSTRAP_ROOT/work
REMOTE_TMP=$BOOTSTRAP_ROOT/tmp
mkdir -p "$REMOTE_WORK" "$REMOTE_TMP"
mkdir -p "$REMOTE_WORK/.agents/skills/engineering-lead" "$REMOTE_WORK/.codex/agents"
printf '%s\n' '# decoy guidance from the current directory' > "$REMOTE_WORK/AGENTS.md"
printf '%s\n' '# decoy skill from the current directory' > "$REMOTE_WORK/.agents/skills/engineering-lead/SKILL.md"
(
  cd "$REMOTE_WORK"
  curl -fsSL "file://$ROOT/install.sh" |
    HARNESS_HOME="$REMOTE_HOME" \
    HARNESS_ARCHIVE_URL="file://$ARCHIVE" \
    TMPDIR="$REMOTE_TMP" \
    sh
)
(
  cd "$REMOTE_WORK"
  curl -fsSL "file://$ROOT/install.sh" |
    HARNESS_HOME="$REMOTE_HOME" \
    HARNESS_ARCHIVE_URL="file://$ARCHIVE" \
    TMPDIR="$REMOTE_TMP" \
    sh -s -- --check >/dev/null
)
[ -f "$REMOTE_HOME/.agents/skills/engineering-lead/SKILL.md" ]
[ -f "$REMOTE_HOME/.agents/skills/grill-with-docs/SKILL.md" ]
[ -f "$REMOTE_HOME/.agents/skills/domain-modeling/references/ADR-FORMAT.md" ]
[ -f "$REMOTE_HOME/.codex/agents/implementer.toml" ]
[ -f "$REMOTE_HOME/.pi/agent/agents/implementer.md" ]
cmp -s "$ROOT/.agents/skills/engineering-lead/SKILL.md" "$REMOTE_HOME/.agents/skills/engineering-lead/SKILL.md"
cmp -s "$ROOT/.pi/agents/implementer.md" "$REMOTE_HOME/.pi/agent/agents/implementer.md"
REMOTE_GUIDANCE="$BOOTSTRAP_ROOT/runtime-agents.md"
awk '/<!-- engineering-harness:start -->/{inside=1;next} /<!-- engineering-harness:end -->/{inside=0} inside{print}' "$REMOTE_HOME/.codex/AGENTS.md" > "$REMOTE_GUIDANCE"
cmp -s "$ROOT/resources/AGENTS.md" "$REMOTE_GUIDANCE"
[ -z "$(find "$REMOTE_TMP" -mindepth 1 -maxdepth 1 -print -quit)" ]

INVALID_ROOT=$BOOTSTRAP_ROOT/invalid-archive/incomplete
INVALID_ARCHIVE=$BOOTSTRAP_ROOT/invalid.tar.gz
INVALID_HOME=$BOOTSTRAP_ROOT/invalid-home
INVALID_TMP=$BOOTSTRAP_ROOT/invalid-tmp
mkdir -p "$INVALID_ROOT" "$INVALID_TMP"
printf '%s\n' '# incomplete archive' > "$INVALID_ROOT/AGENTS.md"
tar -czf "$INVALID_ARCHIVE" -C "$BOOTSTRAP_ROOT/invalid-archive" incomplete
if (
  cd "$REMOTE_WORK"
  curl -fsSL "file://$ROOT/install.sh" |
    HARNESS_HOME="$INVALID_HOME" \
    HARNESS_ARCHIVE_URL="file://$INVALID_ARCHIVE" \
    TMPDIR="$INVALID_TMP" \
    sh >/dev/null 2>&1
); then
  printf '%s\n' 'expected incomplete bootstrap archive to fail' >&2
  exit 1
fi
[ ! -e "$INVALID_HOME/.codex" ]
[ -z "$(find "$INVALID_TMP" -mindepth 1 -maxdepth 1 -print -quit)" ]

if grep -R -F 'pi install npm:pi-sub-agent' "$ROOT/README.md" "$ROOT/install.sh" "$ROOT/.agents/skills" >/dev/null; then
  printf '%s\n' 'found a stale separate pi-sub-agent installation instruction' >&2
  exit 1
fi

printf '%s\n' 'Installer acceptance test passed.'
