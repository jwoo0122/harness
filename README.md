# Engineering Harness for Codex

An installable engineering-lead workflow for Codex and Agent Skills-compatible tools.

It helps an agent turn ambiguous software requests into bounded work, delegate safely, implement the smallest coherent change, and prove completion with evidence.

## What it installs

The harness has three layers:

| Layer | Purpose | Installed location |
| --- | --- | --- |
| Global guidance | Durable lead-engineer rules that apply to every task | `~/.codex/AGENTS.md` |
| Agent Skill | Detailed work-contract, delegation, persona, and verification workflows | `~/.agents/skills/engineering-lead` |
| Codex personas | Native specialist roles for bounded subagent work | `~/.codex/agents/*.toml` |

The global guidance stays concise. Detailed procedures are loaded only when the `engineering-lead` Skill is selected, reducing the permanent context cost.

## Quick start

Requirements:

- Codex CLI or desktop app
- macOS or another POSIX-compatible environment
- Standard shell tools such as `sh`, `awk`, `diff`, and `mktemp`

Clone and install:

```sh
git clone https://github.com/jwoo0122/engineering-harness-skills.git
cd engineering-harness-skills
./install.sh
```

Start a new Codex task after installation. The Skill can trigger automatically for non-trivial engineering work, or you can invoke it explicitly:

```text
Use $engineering-lead to implement this request and prove every acceptance criterion.
```

## How the workflow behaves

The lead agent:

1. Inspects the repository, existing instructions, tests, and current behavior.
2. Defines the goal, current state, gap, constraints, non-goals, acceptance criteria, evidence, assumptions, and risks.
3. Resolves the highest-cost uncertainty before broad implementation.
4. Decomposes work into independently verifiable outcomes.
5. Delegates only bounded work with explicit ownership and stop conditions.
6. Implements the smallest coherent change that satisfies the requirement.
7. Runs focused and integration verification.
8. Reviews the integrated result against the original request.
9. Reports incomplete or blocked work honestly.

## Included personas

| Persona | Default access | Responsibility |
| --- | --- | --- |
| `requirements_analyst` | Read-only | Extract outcomes, constraints, non-goals, ambiguity, and acceptance criteria |
| `explorer` | Read-only | Trace current behavior, dependencies, tests, and repository conventions |
| `architect` | Read-only | Compare bounded designs, contracts, migration, rollback, and operational cost |
| `implementer` | Workspace write | Make one scoped code change and its focused tests |
| `verifier` | Read-only | Reproduce behavior and test acceptance, boundary, and negative scenarios |
| `reviewer` | Read-only | Seek correctness, security, data, concurrency, operational, and regression risks |

The portable Skill also contains equivalent persona contracts for tools that support `.agents/skills` but not Codex custom-agent TOML files.

## Safe installation behavior

`./install.sh` is idempotent and does not edit `~/.codex/config.toml`.

It:

- Adds a clearly marked managed block to `~/.codex/AGENTS.md`.
- Preserves guidance outside that block.
- Installs the portable Skill under the standard `$HOME/.agents/skills` path.
- Installs only the six harness-owned Codex persona files.
- Preserves unrelated custom personas.
- Backs up conflicting managed files under `~/.codex/engineering-harness/backups`.
- Refuses malformed managed markers and unsafe path collisions without changing the affected file.

Preview or verify an installation:

```sh
./install.sh --dry-run
./install.sh --check
```

Use alternate roots in tests or managed environments:

```sh
HARNESS_HOME=/tmp/harness-home ./install.sh
CODEX_HOME=/custom/codex AGENTS_HOME=/custom/agents ./install.sh
```

## Update

Pull the latest version and run the same installer again:

```sh
git pull --ff-only
./install.sh
```

Only changed harness files are replaced, and replaced versions are backed up.

## Verify the project

Run the isolated installer acceptance test:

```sh
./tests/test-install.sh
```

The test covers initial installation, preservation of existing guidance, idempotent reinstall, drift detection and repair, backup creation, malformed-marker rejection, and path-collision safety.

## Repository layout

```text
.
├── AGENTS.md
├── install.sh
├── .agents/
│   └── skills/engineering-lead/
│       ├── SKILL.md
│       ├── agents/openai.yaml
│       └── references/
├── .codex/
│   └── agents/
└── tests/
    └── test-install.sh
```

## Compatibility notes

- Codex discovers personal Skills from `$HOME/.agents/skills` and repository Skills from `.agents/skills`.
- Codex discovers personal custom agents from `~/.codex/agents` and project custom agents from `.codex/agents`.
- Custom-agent TOML is Codex-specific; the Skill itself follows the portable Agent Skills directory structure.

See the official Codex documentation for [Skill locations](https://learn.chatgpt.com/docs/build-skills#where-to-save-skills), [custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agents), and [`AGENTS.md` guidance](https://learn.chatgpt.com/docs/customization/overview#agents-guidance).

## License

Released under the [MIT License](LICENSE).
