# @jwoo0122/harness

Two-mode cognitive harness for AI coding agents — structured thinking protocols that eliminate self-affirmation bias.

## What this is

A pi package that provides two complementary thinking modes:

| Mode | Skill | Personas/Roles | Purpose |
|------|-------|----------------|---------|
| **Explore** | `/explore` | 🔴 Optimist · 🟡 Pragmatist · 🟢 Skeptic | Divergent thinking — push boundaries, find options |
| **Execute** | `/execute` | 📋 Planner · 🔨 Implementer · ✅ Verifier | Convergent building — ship correct code, suppress regressions |

### Why sub-agents?

Single-agent systems suffer from **self-affirmation bias** — the same brain that writes code also evaluates whether that code is correct. The harness forces structured role separation:

- In **Explore**: three emotional lenses debate. In pi, these can run as **real isolated subagents** before synthesis. No unanimous agreement allowed in Round 1. Unsupported claims are struck from the record.
- In **Execute**: three professional roles check each other. In pi, PLN / IMP / VER can run as **real isolated subagents** and the parent execute agent becomes an orchestrator. The Implementer cannot mark their own acceptance criteria as passed — only the Verifier can. The Verifier cannot write code. The Planner cannot run tests.

## Installation

### In pi (full power — enforcement + TUI)

```bash
pi install git:github.com/jwoo0122/harness
```

This gives you:
- `/explore` and `/execute` commands with mode switching
- **Real explore subagents**: isolated OPT / PRA / SKP `pi` subprocesses before synthesis
- **Real execute subagents**: isolated PLN / IMP / VER `pi` subprocesses for planning, implementation, and verification
- **Tool enforcement**: write/edit/build blocked in explore mode, and main `/execute` runs as orchestration-only
- **External evidence gate**: structured web search/fetch required for ecosystem claims
- **TUI widgets**: mode indicator in footer, AC status dashboard
- **State persistence**: AC tracking survives session restarts
- **Keyboard shortcut**: `Ctrl+Shift+H` to cycle modes
- **Prompt templates**: `/debate <topic>`, `/ac-check <criteria>`

### In Claude Code / other harnesses (skills only)

Copy the `skills/` directory to your project's `.claude/skills/` (or equivalent):

```bash
cp -r skills/explore skills/execute /path/to/project/.claude/skills/
```

Or install via npm:
```bash
npm install @jwoo0122/harness
```

The skills work standalone as pure Markdown protocols — no extension needed. You lose tool enforcement, TUI feedback, and state persistence, but the core debate and verification protocols function in any LLM coding agent.

## Usage

### Explore mode

```
/explore "Should we use an ECS architecture for the scene graph?"
```

The agent will:
1. Gather project context (read-only)
2. Run isolated OPT / PRA / SKP subagents for first-pass positions
3. Research broadly across the ecosystem with explicit external citations
4. Run a 3-round debate with cross-examination
5. Produce a synthesis document at `target/explore/`

### Execute mode

```
/execute .iteration-4-criteria.md
```

The agent will:
1. Orchestrate isolated PLN / IMP / VER subagents instead of collapsing roles into one context
2. Run pre-flight baseline checks
3. Decompose criteria into micro-increments (≤3 files each)
4. For each increment: implement → gate check → verify → AC checkpoint → regression scan
5. Produce an execution report at `target/execute/`

### Quick templates

```
/debate "atlas vs per-texture GPU upload"     # One-off debate without full explore
/ac-check .iteration-4-criteria.md            # VER-only AC verification pass
```

### Keyboard shortcut

`Ctrl+Shift+H` cycles: off → explore → execute → off

## Package structure

```
harness/
├── package.json              # pi package manifest
├── extensions/
│   ├── index.ts              # Mode management, tool enforcement, TUI, state
│   └── subagents.ts          # Shared subprocess subagent runtime for explore + execute
├── skills/
│   ├── explore/SKILL.md      # 3-persona debate protocol (works standalone)
│   └── execute/SKILL.md      # 3-role verification protocol (works standalone)
└── prompts/
    ├── debate.md             # Quick single-topic debate
    └── ac-check.md           # VER-only AC check
```

## Design decisions

### Skills are self-contained
Each SKILL.md works without the extension. The extension adds enforcement — it doesn't change the protocol. This means the same skills can be used in Claude Code, Codex, or any agent that supports the [Agent Skills standard](https://agentskills.io).

### Extension adds five layers
1. **Tool gating** — explore mode blocks write/edit/build, and main execute mode blocks direct implementation commands in favor of role delegation
2. **Isolated subagents** — `/explore` and `/execute` can invoke real subprocess agents with role-specific tool policies
3. **Verification registry plumbing** — execute mode exposes `harness_verify_register` and `harness_verify_list`, persisting reproducible AC verification methods in `.harness/verification-registry.json`
4. **State tracking** — AC statuses persist in the session via `appendEntry`
5. **TUI feedback** — footer status + widget show current mode, AC progress

### Verification registry smoke path
For a smoke-level execute increment, VER should be able to:
1. run baseline checks,
2. load or create `.harness/verification-registry.json`,
3. register a passing AC with `harness_verify_register`, and
4. list cumulative entries with `harness_verify_list` before regression checks.

This package ships the registry plumbing and workflow guidance. Project-specific repos still provide the actual verification commands that VER records and re-runs.

### No project-specific assumptions
The skills reference generic concepts ("formatter check", "linter", "test suite") rather than specific tools. They adapt to any tech stack.

## License

MIT
