#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
HARNESS_HOME=${HARNESS_HOME:-${HOME:?HOME is required}}
CODEX_HOME=${CODEX_HOME:-"$HARNESS_HOME/.codex"}
AGENTS_HOME=${AGENTS_HOME:-"$HARNESS_HOME/.agents"}
PI_HOME=${PI_HOME:-"$HARNESS_HOME/.pi"}
HARNESS_REF=${HARNESS_REF:-main}
HARNESS_ARCHIVE_URL=${HARNESS_ARCHIVE_URL:-"https://codeload.github.com/jwoo0122/engineering-harness-skills/tar.gz/$HARNESS_REF"}
MODE=install

usage() {
  printf '%s\n' "Usage: ./install.sh [--dry-run | --check]"
}

case ${1:-} in
  "") ;;
  --dry-run) MODE=dry-run ;;
  --check) MODE=check ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || { usage >&2; exit 2; }

SOURCE_AGENTS="$SCRIPT_DIR/resources/AGENTS.md"
SOURCE_SKILLS="$SCRIPT_DIR/.agents/skills"
SOURCE_SKILL="$SOURCE_SKILLS/engineering-lead"
SOURCE_PERSONAS="$SCRIPT_DIR/.codex/agents"
SOURCE_PI_AGENTS="$SCRIPT_DIR/.pi/agents"
TARGET_AGENTS="$CODEX_HOME/AGENTS.md"
TARGET_SKILLS="$AGENTS_HOME/skills"
TARGET_PERSONAS="$CODEX_HOME/agents"
TARGET_PI_AGENTS="$PI_HOME/agent/agents"
TARGET_PI_GUIDANCE="$PI_HOME/agent/AGENTS.md"
STATE_HOME="$CODEX_HOME/engineering-harness"
START_MARK='<!-- engineering-harness:start -->'
END_MARK='<!-- engineering-harness:end -->'
BACKUP_ROOT=

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

say() {
  printf '%s\n' "$*"
}

sources_available() {
  [ -f "$SOURCE_AGENTS" ] &&
    [ -d "$SOURCE_SKILLS" ] &&
    [ -f "$SOURCE_SKILL/SKILL.md" ] &&
    [ -d "$SOURCE_PERSONAS" ]
}

running_from_source_tree() {
  [ "$(basename "$0")" = install.sh ] && sources_available
}

require_sources() {
  [ -f "$SOURCE_AGENTS" ] || fail "missing source: $SOURCE_AGENTS"
  [ -d "$SOURCE_SKILLS" ] || fail "missing source: $SOURCE_SKILLS"
  [ -f "$SOURCE_SKILL/SKILL.md" ] || fail "missing source: $SOURCE_SKILL/SKILL.md"
  [ -d "$SOURCE_PERSONAS" ] || fail "missing source: $SOURCE_PERSONAS"
  [ -d "$SOURCE_PI_AGENTS" ] || fail "missing source: $SOURCE_PI_AGENTS"
}

bootstrap_sources() {
  command -v curl >/dev/null 2>&1 || fail "curl is required for remote installation"
  command -v tar >/dev/null 2>&1 || fail "tar is required for remote installation"

  bootstrap_root=$(mktemp -d "${TMPDIR:-/tmp}/engineering-harness-download.XXXXXX")
  trap 'rm -rf "$bootstrap_root"' EXIT
  trap 'exit 130' HUP INT TERM
  archive=$bootstrap_root/source.tar.gz
  extracted=$bootstrap_root/extracted
  mkdir -p "$extracted"

  say "Downloading Engineering Harness from $HARNESS_ARCHIVE_URL"
  curl -fsSL "$HARNESS_ARCHIVE_URL" -o "$archive" || fail "could not download the Engineering Harness source archive"
  tar -xzf "$archive" -C "$extracted" || fail "could not extract the Engineering Harness source archive"

  set -- "$extracted"/*
  [ "$#" -eq 1 ] && [ -d "$1" ] || fail "source archive must contain exactly one top-level directory"
  downloaded_root=$1
  [ -f "$downloaded_root/install.sh" ] || fail "source archive is missing install.sh"
  [ -f "$downloaded_root/resources/AGENTS.md" ] || fail "source archive is missing runtime AGENTS.md"
  [ -f "$downloaded_root/.agents/skills/engineering-lead/SKILL.md" ] || fail "source archive is missing the engineering-lead skill"
  [ -d "$downloaded_root/.codex/agents" ] || fail "source archive is missing Codex personas"
  [ -d "$downloaded_root/.pi/agents" ] || fail "source archive is missing Pi agents"

  bootstrap_status=0
  case $MODE in
    install) "$downloaded_root/install.sh" || bootstrap_status=$? ;;
    dry-run) "$downloaded_root/install.sh" --dry-run || bootstrap_status=$? ;;
    check) "$downloaded_root/install.sh" --check || bootstrap_status=$? ;;
  esac
  rm -rf "$bootstrap_root"
  trap - EXIT HUP INT TERM
  exit "$bootstrap_status"
}

ensure_backup_root() {
  if [ -z "$BACKUP_ROOT" ]; then
    BACKUP_ROOT="$STATE_HOME/backups/$(date '+%Y%m%d-%H%M%S')-$$"
    mkdir -p "$BACKUP_ROOT"
  fi
}

backup_path() {
  source_path=$1
  relative_path=$2
  [ -e "$source_path" ] || [ -L "$source_path" ] || return 0
  ensure_backup_root
  backup_path_dir=$BACKUP_ROOT/$(dirname "$relative_path")
  mkdir -p "$backup_path_dir"
  cp -R "$source_path" "$BACKUP_ROOT/$relative_path"
  say "Backed up $source_path"
}

validate_marker_structure() {
  target=$1
  awk -v start="$START_MARK" -v end="$END_MARK" '
    $0 == start { starts++; if (managed) invalid = 1; managed = 1; next }
    $0 == end { ends++; if (!managed) invalid = 1; managed = 0; next }
    END {
      if (invalid || managed || starts != ends || starts > 1) exit 1
    }
  ' "$target"
}

write_managed_agents() {
  target=$1
  backup_rel=$2
  target_dir=$(dirname "$target")
  mkdir -p "$target_dir"
  if [ -e "$target" ] && [ ! -f "$target" ]; then
    fail "$target exists but is not a regular file; it was not changed"
  fi
  if [ -f "$target" ]; then
    validate_marker_structure "$target" || fail "malformed engineering-harness markers in $target; file was not changed"
  fi
  temp_file=$(mktemp "$target_dir/.engineering-harness-agents.XXXXXX")
  {
    printf '%s\n' "$START_MARK"
    cat "$SOURCE_AGENTS"
    printf '%s\n' "$END_MARK"
    if [ -f "$target" ]; then
      awk -v start="$START_MARK" -v end="$END_MARK" '
        $0 == start { managed = 1; next }
        $0 == end { managed = 0; next }
        !managed { print }
      ' "$target" | awk 'BEGIN { blank = 1 } { if (blank && $0 == "") next; blank = 0; print }'
    fi
  } > "$temp_file"
  if [ -f "$target" ] && cmp -s "$temp_file" "$target"; then
    rm -f "$temp_file"
    say "Unchanged managed guidance in $target"
    return 0
  fi
  if [ -e "$target" ] || [ -L "$target" ]; then
    backup_path "$target" "$backup_rel"
  fi
  chmod 0644 "$temp_file"
  mv "$temp_file" "$target"
  say "Installed managed guidance in $target"
}

install_tree() {
  source_dir=$1
  target_dir=$2
  backup_rel=$3
  parent_dir=$(dirname "$target_dir")
  mkdir -p "$parent_dir"
  if [ -e "$target_dir" ] || [ -L "$target_dir" ]; then
    if diff -qr "$source_dir" "$target_dir" >/dev/null 2>&1; then
      say "Unchanged $target_dir"
      return 0
    fi
    backup_path "$target_dir" "$backup_rel"
    rm -rf "$target_dir"
  fi
  temp_dir=$(mktemp -d "$parent_dir/.engineering-harness-tree.XXXXXX")
  cp -R "$source_dir"/. "$temp_dir"/
  mv "$temp_dir" "$target_dir"
  say "Installed $target_dir"
}

install_skills() {
  mkdir -p "$TARGET_SKILLS"
  for source_skill in "$SOURCE_SKILLS"/*; do
    [ -d "$source_skill" ] || continue
    name=$(basename "$source_skill")
    install_tree "$source_skill" "$TARGET_SKILLS/$name" "skills/$name"
  done
}

install_personas() {
  mkdir -p "$TARGET_PERSONAS"
  for source_file in "$SOURCE_PERSONAS"/*.toml; do
    name=$(basename "$source_file")
    target_file=$TARGET_PERSONAS/$name
    if [ -f "$target_file" ] && cmp -s "$source_file" "$target_file"; then
      say "Unchanged $target_file"
      continue
    fi
    if [ -e "$target_file" ] || [ -L "$target_file" ]; then
      [ -f "$target_file" ] && [ ! -L "$target_file" ] || fail "$target_file exists but is not a regular file; it was not changed"
      backup_path "$target_file" "personas/$name"
      rm -rf "$target_file"
    fi
    temp_file=$(mktemp "$TARGET_PERSONAS/.engineering-harness-persona.XXXXXX")
    cp "$source_file" "$temp_file"
    chmod 0644 "$temp_file"
    mv "$temp_file" "$target_file"
    say "Installed $target_file"
  done
}

install_pi_agents() {
  mkdir -p "$TARGET_PI_AGENTS"
  for source_file in "$SOURCE_PI_AGENTS"/*.md; do
    name=$(basename "$source_file")
    target_file=$TARGET_PI_AGENTS/$name
    if [ -f "$target_file" ] && cmp -s "$source_file" "$target_file"; then
      say "Unchanged $target_file"
      continue
    fi
    if [ -e "$target_file" ] || [ -L "$target_file" ]; then
      [ -f "$target_file" ] && [ ! -L "$target_file" ] || fail "$target_file exists but is not a regular file; it was not changed"
      backup_path "$target_file" "pi-agents/$name"
      rm -rf "$target_file"
    fi
    temp_file=$(mktemp "$TARGET_PI_AGENTS/.engineering-harness-pi-agent.XXXXXX")
    cp "$source_file" "$temp_file"
    chmod 0644 "$temp_file"
    mv "$temp_file" "$target_file"
    say "Installed $target_file"
  done
}

extract_managed_agents() {
  target=$1
  awk -v start="$START_MARK" -v end="$END_MARK" '
    $0 == start { managed = 1; found = 1; next }
    $0 == end { managed = 0; complete = 1; next }
    managed { print }
    END { if (!found || !complete) exit 1 }
  ' "$target"
}

check_install() {
  [ -f "$TARGET_AGENTS" ] || fail "missing $TARGET_AGENTS"
  validate_marker_structure "$TARGET_AGENTS" || fail "managed AGENTS.md markers are malformed"
  check_temp_file=
  pi_check_temp_file=
  trap 'rm -f "$check_temp_file" "$pi_check_temp_file"' EXIT HUP INT TERM
  check_temp_file=$(mktemp "${TMPDIR:-/tmp}/engineering-harness-check.XXXXXX")
  extract_managed_agents "$TARGET_AGENTS" > "$check_temp_file" || fail "managed AGENTS.md block is missing or incomplete"
  cmp -s "$SOURCE_AGENTS" "$check_temp_file" || fail "managed AGENTS.md block is stale"
  for source_skill in "$SOURCE_SKILLS"/*; do
    [ -d "$source_skill" ] || continue
    skill_name=$(basename "$source_skill")
    diff -qr "$source_skill" "$TARGET_SKILLS/$skill_name" >/dev/null 2>&1 || fail "skill is missing or stale: $TARGET_SKILLS/$skill_name"
  done
  for source_file in "$SOURCE_PERSONAS"/*.toml; do
    target_file=$TARGET_PERSONAS/$(basename "$source_file")
    cmp -s "$source_file" "$target_file" || fail "persona is missing or stale: $target_file"
  done
  [ -f "$TARGET_PI_GUIDANCE" ] || fail "missing $TARGET_PI_GUIDANCE"
  validate_marker_structure "$TARGET_PI_GUIDANCE" || fail "managed Pi AGENTS.md markers are malformed"
  pi_check_temp_file=$(mktemp "${TMPDIR:-/tmp}/engineering-harness-pi-check.XXXXXX")
  extract_managed_agents "$TARGET_PI_GUIDANCE" > "$pi_check_temp_file" || fail "managed Pi AGENTS.md block is missing or incomplete"
  cmp -s "$SOURCE_AGENTS" "$pi_check_temp_file" || fail "managed Pi AGENTS.md block is stale"
  for source_file in "$SOURCE_PI_AGENTS"/*.md; do
    target_file=$TARGET_PI_AGENTS/$(basename "$source_file")
    cmp -s "$source_file" "$target_file" || fail "Pi agent is missing or stale: $target_file"
  done
  rm -f "$check_temp_file" "$pi_check_temp_file"
  trap - EXIT HUP INT TERM
  say "Engineering harness is installed and current."
}

dry_run() {
  say "Would manage guidance in $TARGET_AGENTS"
  say "Would install skills in $TARGET_SKILLS"
  say "Would install Codex personas in $TARGET_PERSONAS"
  say "Would manage Pi guidance in $TARGET_PI_GUIDANCE"
  say "Would install Pi agent roles in $TARGET_PI_AGENTS"
  say "Existing conflicting harness files would be backed up under $STATE_HOME/backups"
}

running_from_source_tree || bootstrap_sources
require_sources

case $MODE in
  check) check_install ;;
  dry-run) dry_run ;;
  install)
    write_managed_agents "$TARGET_AGENTS" "codex/AGENTS.md"
    install_skills
    install_personas
    write_managed_agents "$TARGET_PI_GUIDANCE" "pi/AGENTS.md"
    install_pi_agents
    check_install
    say "Codex: Use \$engineering-lead to lead and verify this work."
    say "Standalone CLI: npm install -g --ignore-scripts engineering-harness-skills, then run engineering-harness."
    say "The CLI bundles its Pi runtime and subagent extension; no separate pi installation is required."
    ;;
esac
