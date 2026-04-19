# Integration Guide

## Strategy: protocol on top, generic runtime underneath

```text
┌──────────────────────────────────────────────────────────────┐
│  @jwoo0122/harness                                           │
│  - /explore protocol                                          │
│  - /execute protocol                                          │
│  - harness_subagents generic subprocess runtime               │
│  - tool enforcement, registry plumbing, state, status UI      │
├──────────────────────────────────────────────────────────────┤
│  Project-specific skills / checks                             │
│  - /verify-native, /verify-web, custom smoke checks, etc.     │
│  - domain-specific acceptance criteria and verification logic  │
└──────────────────────────────────────────────────────────────┘
```

The package provides the **thinking / orchestration protocol**.
The host project provides the **domain-specific verification implementation**.

## Key mental model

- `harness_subagents` is the generic isolated subprocess primitive.
- `/explore` and `/execute` decide **which personas / roles** should be injected.
- The runtime itself should stay generic; the skill defines the worldview.
- Canonical prompt bodies for shipped personas and roles live in the flat `agents/` directory.

Examples:
- `/explore` → run `harness_subagents` with OPT / PRA / SKP / EMP in parallel
- `/execute` → run `harness_subagents` with PLN → IMP → VER sequentially

Compatibility aliases still exist for older flows:
- `harness_explore_subagents`
- `harness_execute_subagents`

New integrations should prefer `harness_subagents`.

## Installing into a project

### Option A — install as a pi package

```bash
cd /path/to/project
pi install /absolute/path/to/harness
```

Or when using git:

```bash
pi install git:github.com/jwoo0122/harness
```

### Option B — project-local package reference for active development

```bash
cd /path/to/project
mkdir -p .pi
cat > .pi/settings.json <<'JSON'
{
  "packages": ["../harness"]
}
JSON
```

Because local paths are read directly from disk, this is the fastest way to dogfood package changes while developing.
After editing the package, run:

```text
/reload
```

inside pi to reload extensions, skills, prompts, and themes.

### Option C — global install

```bash
pi install /absolute/path/to/harness
```

That writes to `~/.pi/agent/settings.json` and makes the package available everywhere.

## How host-project skills coexist

The package supplies:
- `explore`
- `execute`
- prompt templates like `/debate` and `/ac-check`

The host project can still add its own skills, for example:
- `/verify-native`
- `/verify-web`
- `/smoke-app`

As long as names differ, they coexist cleanly.

## How the execute protocol should integrate with project verification

The package does **not** encode project-specific verification commands.
Instead, the execute protocol should use project knowledge to decide which verification to run.

Typical pattern:
- generic harness handles increment planning / implementation / verification separation
- host project supplies the concrete commands and checks worth registering

Examples:
- renderer changes → visual verification skill or screenshot diff
- API changes → integration tests
- desktop app changes → native smoke flow

## Verification registry plumbing

The execute protocol maintains a cumulative verification registry at:

```text
.harness/verification-registry.json
```

Tools:
- `harness_verify_register`
- `harness_verify_list`

Expected smoke behavior:
1. baseline load succeeds even if the registry does not exist yet
2. VER registers a passing AC with `harness_verify_register`
3. regression checks read the full registry via `harness_verify_list`
4. every registered verification command is re-run during regression scanning

This package provides the registry mechanism.
The host project provides the concrete verification commands worth recording.

## Recommended integration shape for the execute protocol

When the harness extension is active for a `/execute` run:
- keep the parent `/execute` agent orchestration-only
- delegate role work to `harness_subagents`
- configure subagents roughly as:
  - PLN → read-only planning
  - IMP → implementation tools
  - VER → verification tools
- run them in **sequential** mode so each role can react to previous output

## Recommended integration shape for the explore protocol

When the harness extension is active for an `/explore` run:
- keep explore read-only
- delegate first-pass viewpoints to `harness_subagents`
- configure OPT / PRA / SKP / EMP with explicit persona prompts
- run them in **parallel** mode
- require structured web evidence before final synthesis

## Prompt templates

The package also ships prompt templates through `prompts/`:
- `debate.md`
- `ac-check.md`

If you install the full pi package, they are discovered automatically.

## Non-pi usage

If your environment supports only Markdown skills, copy the skills directly:

```bash
cp -r /path/to/harness/skills/* /project/.claude/skills/
```

That gives you the protocols without extension enforcement, live status UI, or persistent registry tooling.
