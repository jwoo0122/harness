# @jwoo0122/harness

Protocol-driven cognitive harness for AI coding agents — divergent exploration, convergent execution, and a generic isolated-subagent runtime that powers both.

## What this is

`@jwoo0122/harness` is a pi package with two protocol-level skills:

| Protocol | Skill / Alias | Personas / Roles | Purpose |
|----------|---------------|------------------|---------|
| **Explore** | `/skill:explore` or `/explore` | 🔴 Optimist · 🟡 Pragmatist · 🟢 Skeptic · 🔵 Empiricist | Divergent thinking — expand the space, surface options, force debate |
| **Execute** | `/skill:execute` or `/execute` | 📋 Planner · 🔨 Implementer · ✅ Verifier | Convergent delivery — ship in increments, verify rigorously |

The important architectural change is this:

- **`/explore` and `/execute` are domain protocols**.
- **`harness_subagents` is the generic runtime primitive**.
- Personas like `OPT / PRA / SKP / EMP` or roles like `PLN / IMP / VER` are **injected at call time** through per-subagent prompts, tool policies, and sequencing.

That keeps the subprocess runtime generic while letting skills define the mental model.
Canonical prompt bodies for the shipped personas and roles live in the flat `agents/` directory.

## Why isolated subagents

Single-agent systems suffer from **self-affirmation bias** — the same context that proposes a plan also tends to approve it.

Harness counters that by separating:
- the **protocol** layer (`/explore`, `/execute`), and
- the **runtime** layer (`harness_subagents`).

Examples:
- In **Explore**, the extension can launch four real isolated subagents configured as OPT / PRA / SKP / EMP before synthesis.
- In **Execute**, the extension can launch real isolated subagents configured as PLN → IMP → VER so scope, implementation, and verification stay separated.

## Installation

### In pi

```bash
pi install git:github.com/jwoo0122/harness
```

Or for local development:

```bash
pi install /absolute/path/to/harness
```

This gives you:
- one-shot `/explore` and `/execute` aliases that expand to the corresponding skills without switching persistent agent state
- `harness_subagents` — generic isolated subprocess orchestration
- compatibility aliases: `harness_explore_subagents`, `harness_execute_subagents` (deprecated for new usage)
- run-scoped tool enforcement for active `/explore` and `/execute` turns
- structured web evidence tools for auditable external research
- pre-completion explore evidence gating via turn-end steering
- verification registry tools for cumulative AC verification
- footer status for the active protocol run and counters
- no separate live subagent widget; live subagent progress stays inside the tool call row
- compact text-first tool rows for built-ins + harness tools (minimal/no output when collapsed, no colored tool box background)
- state persistence across session restarts
- prompt templates: `/debate`, `/ac-check`

### In Claude Code / other harnesses

Copy the `skills/` directory into your project skill directory:

```bash
cp -r skills/explore skills/execute /path/to/project/.claude/skills/
```

If you publish the package to npm, the same skills can also be consumed that way:

```bash
npm install @jwoo0122/harness
```

The Markdown skills work standalone without the pi extension. You lose enforcement, live UI, and persistent state, but the debate / verification protocols still work.

## Usage

### Explore protocol

```text
/explore "Should we use an ECS architecture for the scene graph?"
```

Expected runtime shape inside pi:
1. gather read-only local context
2. ask targeted clarification questions first if ambiguity or contradiction would materially change the recommendation
3. call `harness_subagents` with **OPT / PRA / SKP / EMP** in **parallel**
4. research external evidence with `harness_web_search` / `harness_web_fetch`
5. run the 3-round debate
6. return or write a planning packet with synthesis, concrete work plan, and clarification questions

### Execute protocol

```text
/execute .iteration-4-criteria.md
```

Expected runtime shape inside pi:
1. parent `/execute` stays orchestration-only
2. call `harness_subagents` with **PLN → IMP → VER** in **sequential** mode
3. run gates and verification
4. update the verification registry
5. produce the execution report at `target/execute/`

### Generic subagent runtime

The extension-level primitive is `harness_subagents`.

Conceptually:

```ts
harness_subagents({
  subject: "decision or objective",
  mode: "parallel" | "sequential",
  context: "optional shared context",
  subagents: [
    {
      role: "OPT",
      label: "Optimist",
      icon: "🔴",
      system_prompt: "define the persona / role here",
      task: "optional explicit task override",
      active_tools: ["read", "grep", "find", "ls", "harness_web_search", "harness_web_fetch"],
      bash_policy: "read-only"
    }
  ]
})
```

Use:
- **parallel** for independent perspectives
- **sequential** when later subagents must react to earlier outputs

## Prompt templates

This package ships two prompt templates:

- `/debate <topic>` — focused explore-style debate prompt
- `/ac-check <criteria>` — VER-focused acceptance-criteria check prompt

## Package structure

```text
harness/
├── package.json
├── CHANGELOG.md
├── INTEGRATION.md
├── README.md
├── extensions/
│   ├── agent-prompts.ts         # prompt loading + explore/execute prompt builders
│   ├── bash-policy.ts           # explore/execute bash classification helpers
│   ├── explore-gate.ts          # pure explore evidence gate assessment helpers
│   ├── verification-registry.ts # registry storage model + file I/O
│   ├── index.ts                 # extension composition root, protocol routing, gating, tools, registry, status UI
│   └── subagents.ts             # generic isolated subprocess runtime
├── prompts/
│   ├── debate.md
│   └── ac-check.md
├── agents/
│   ├── OPT.md
│   ├── PRA.md
│   ├── SKP.md
│   ├── EMP.md
│   ├── PLN.md
│   ├── IMP.md
│   └── VER.md
└── skills/
    ├── explore/SKILL.md
    └── execute/SKILL.md
```

## Design notes

### 1. Skills are self-contained

Each `SKILL.md` works without the extension. The extension adds enforcement and orchestration; it does not redefine the underlying protocol.

### 2. The runtime is generic

`harness_subagents` does not hardcode “explore” or “execute”.
The meaning comes from the injected prompts, tool lists, and sequencing.

### 3. Compatibility aliases remain temporarily

For backward compatibility, the package still exposes:
- `harness_explore_subagents`
- `harness_execute_subagents`

New integrations should prefer `harness_subagents`.

### 4. TUI behavior is now simpler

- footer status appears only for the active protocol run
- there is no separate subagent widget; live progress is rendered inside the subagent tool call itself
- there is no always-on harness dashboard widget anymore

### 5. Verification registry stays cumulative

The execute protocol persists reproducible AC verification methods in:

```text
.harness/verification-registry.json
```

VER records:
- strategy
- exact command
- relevant files
- human-readable description

Then future regression scans can re-run the same checks.

## Verification registry smoke path

A smoke-level execute increment should be able to:
1. load or create `.harness/verification-registry.json`
2. register a passing AC via `harness_verify_register`
3. list cumulative entries with `harness_verify_list`
4. re-run registered verifications during regression scanning

## Development workflow

When installed from a **local path**, pi reads the package directly from disk. After editing the package, use `/reload` in pi to pick up changes immediately.

## License

MIT
