#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
HARNESS_HOME=${HARNESS_HOME:-${HOME:?HOME is required}}
CODEX_HOME=${CODEX_HOME:-"$HARNESS_HOME/.codex"}
AGENTS_HOME=${AGENTS_HOME:-"$HARNESS_HOME/.agents"}
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

SOURCE_AGENTS="$SCRIPT_DIR/AGENTS.md"
SOURCE_SKILL="$SCRIPT_DIR/.agents/skills/engineering-lead"
SOURCE_PERSONAS="$SCRIPT_DIR/.codex/agents"
TARGET_AGENTS="$CODEX_HOME/AGENTS.md"
TARGET_SKILL="$AGENTS_HOME/skills/engineering-lead"
TARGET_PERSONAS="$CODEX_HOME/agents"
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

require_sources() {
  [ -f "$SOURCE_AGENTS" ] || fail "missing source: $SOURCE_AGENTS"
  [ -f "$SOURCE_SKILL/SKILL.md" ] || fail "missing source: $SOURCE_SKILL/SKILL.md"
  [ -d "$SOURCE_PERSONAS" ] || fail "missing source: $SOURCE_PERSONAS"
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
    backup_path "$target" "AGENTS.md"
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
  temp_file=$(mktemp "${TMPDIR:-/tmp}/engineering-harness-check.XXXXXX")
  trap 'rm -f "$temp_file"' EXIT HUP INT TERM
  extract_managed_agents "$TARGET_AGENTS" > "$temp_file" || fail "managed AGENTS.md block is missing or incomplete"
  cmp -s "$SOURCE_AGENTS" "$temp_file" || fail "managed AGENTS.md block is stale"
  diff -qr "$SOURCE_SKILL" "$TARGET_SKILL" >/dev/null 2>&1 || fail "engineering-lead skill is missing or stale"
  for source_file in "$SOURCE_PERSONAS"/*.toml; do
    target_file=$TARGET_PERSONAS/$(basename "$source_file")
    cmp -s "$source_file" "$target_file" || fail "persona is missing or stale: $target_file"
  done
  say "Engineering harness is installed and current."
}

dry_run() {
  say "Would manage guidance in $TARGET_AGENTS"
  say "Would install skill in $TARGET_SKILL"
  say "Would install Codex personas in $TARGET_PERSONAS"
  say "Existing conflicting harness files would be backed up under $STATE_HOME/backups"
}

require_sources

case $MODE in
  check) check_install ;;
  dry-run) dry_run ;;
  install)
    write_managed_agents "$TARGET_AGENTS"
    install_tree "$SOURCE_SKILL" "$TARGET_SKILL" "skill/engineering-lead"
    install_personas
    check_install
    say "Start a new Codex task. Invoke explicitly with: Use \$engineering-lead to lead and verify this work."
    ;;
esac
