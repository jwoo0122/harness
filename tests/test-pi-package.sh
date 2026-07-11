#!/bin/sh
set -eu

ROOT=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
command -v npm >/dev/null 2>&1 || { printf '%s\n' 'npm is required for the Pi package test' >&2; exit 1; }
command -v pi >/dev/null 2>&1 || { printf '%s\n' 'pi is required for the Pi package smoke test' >&2; exit 1; }

TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/engineering-harness-pi-package.XXXXXX")
trap 'rm -rf "$TEST_ROOT"' EXIT HUP INT TERM

PACKAGE_ROOT="$TEST_ROOT/package"
INSTALL_ROOT="$TEST_ROOT/install"
PROJECT_ROOT="$TEST_ROOT/project"
PI_HOME="$TEST_ROOT/pi-home"
mkdir -p "$PACKAGE_ROOT" "$INSTALL_ROOT" "$PROJECT_ROOT" "$PI_HOME"

cp "$ROOT/package.json" "$ROOT/package-lock.json" "$ROOT/README.md" "$ROOT/LICENSE" "$ROOT/THIRD-PARTY-NOTICES.md" "$PACKAGE_ROOT/"
cp -R "$ROOT/.agents" "$PACKAGE_ROOT/.agents"

(
  cd "$PACKAGE_ROOT"
  npm ci --omit=dev --omit=peer --ignore-scripts --no-audit --no-fund >/dev/null
  PACK_JSON=$(npm pack --dry-run --json --ignore-scripts)
  printf '%s\n' "$PACK_JSON" | grep -F '"bundled": [' >/dev/null
  printf '%s\n' "$PACK_JSON" | grep -F 'node_modules/pi-sub-agent/extensions/index.ts' >/dev/null
  printf '%s\n' "$PACK_JSON" | grep -F '.agents/skills/grill-with-docs/SKILL.md' >/dev/null
  printf '%s\n' "$PACK_JSON" | grep -F '.agents/skills/domain-modeling/references/ADR-FORMAT.md' >/dev/null
  npm pack --ignore-scripts --pack-destination "$TEST_ROOT" >/dev/null
)

TARBALL="$TEST_ROOT/engineering-harness-skills-0.1.0.tgz"
[ -f "$TARBALL" ]

npm install --prefix "$INSTALL_ROOT" --ignore-scripts --no-audit --no-fund "$TARBALL" >/dev/null
PACKAGE_INSTALL="$INSTALL_ROOT/node_modules/engineering-harness-skills"
[ -f "$PACKAGE_INSTALL/package.json" ]
[ -f "$PACKAGE_INSTALL/node_modules/pi-sub-agent/extensions/index.ts" ]
[ -f "$PACKAGE_INSTALL/.agents/skills/grill-with-docs/SKILL.md" ]
[ -f "$PACKAGE_INSTALL/.agents/skills/domain-modeling/references/CONTEXT-FORMAT.md" ]

(
  cd "$PROJECT_ROOT"
  PI_CODING_AGENT_DIR="$PI_HOME" pi install "$PACKAGE_INSTALL" -l >/dev/null
  [ -f .pi/settings.json ]
  grep -F 'engineering-harness-skills' .pi/settings.json >/dev/null
  printf '%s\n' '{"id":"commands","type":"get_commands"}' |
    PI_CODING_AGENT_DIR="$PI_HOME" PI_OFFLINE=1 pi --mode rpc --no-session --approve > "$TEST_ROOT/rpc-output.jsonl"
)

grep -F '"command":"get_commands"' "$TEST_ROOT/rpc-output.jsonl" >/dev/null
grep -F 'skill:grill-with-docs' "$TEST_ROOT/rpc-output.jsonl" >/dev/null
grep -F 'skill:domain-modeling' "$TEST_ROOT/rpc-output.jsonl" >/dev/null
grep -F 'sub-agent-settings' "$TEST_ROOT/rpc-output.jsonl" >/dev/null

printf '%s\n' 'Pi package acceptance test passed.'
