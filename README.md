# Engineering Harness for Codex and Pi

An installable engineering-lead workflow for Codex, Pi, and Agent Skills-compatible tools.

It helps an agent turn ambiguous software requests into bounded work, delegate safely, implement the smallest coherent change, and prove completion with evidence.

## What it installs

The harness has three layers:

| Layer | Purpose | Installed location |
| --- | --- | --- |
| Global guidance | Durable lead-engineer rules that apply to every task | `~/.codex/AGENTS.md` |
| Agent Skill | Detailed work-contract, delegation, persona, and verification workflows | `~/.agents/skills/engineering-lead` |
| Codex personas | Native specialist roles for bounded subagent work | `~/.codex/agents/*.toml` |
| Pi guidance | Durable lead-engineer rules Pi loads for every task | `~/.pi/agent/AGENTS.md` |
| Pi roles | Specialist definitions for Pi's subagent extension | `~/.pi/agent/agents/*.md` |

The global guidance stays concise. Detailed procedures are loaded only when the `engineering-lead` Skill is selected, reducing the permanent context cost.

## Quick start

Requirements:

- Codex CLI or desktop app
- macOS or another POSIX-compatible environment
- `curl`, `tar`, and standard POSIX shell tools such as `sh`, `awk`, `diff`, and `mktemp`

Install with one command; cloning the repository is not required:

```sh
curl -fsSL https://raw.githubusercontent.com/jwoo0122/engineering-harness-skills/main/install.sh | sh
```

The bootstrap downloads a temporary source archive from GitHub, runs the same repository installer, and removes the archive afterward.

Start a new Codex task after installation. The Skill can trigger automatically for non-trivial engineering work, or you can invoke it explicitly:

```text
Use $engineering-lead to implement this request and prove every acceptance criterion.
```

For Pi, install the pinned subagent runtime once after running the installer:

```sh
pi install npm:pi-sub-agent@0.1.5
```

Then start Pi in a trusted project and ask it to use the `engineering-lead` Skill. The extension exposes a `subagent` tool, so Pi can delegate bounded work to the installed roles. Pi intentionally keeps subagents out of its core; this explicit runtime keeps the harness install reproducible and makes the executable dependency visible.

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

The same six roles are installed for Pi as Markdown agent definitions. With `pi-sub-agent`, use the exact role names through the `subagent` tool. The extension runs each role in an isolated Pi process, removes recursive delegation, and defaults to user-level agent definitions. Do not enable project-local agent definitions unless that repository is trusted and those prompts have been reviewed.

The portable Skill also contains equivalent persona contracts for tools that support `.agents/skills` but not Codex custom-agent TOML files.

## Safe installation behavior

`./install.sh` is idempotent and does not edit `~/.codex/config.toml`.

It:

- Adds a clearly marked managed block to `~/.codex/AGENTS.md`.
- Preserves guidance outside that block.
- Installs the portable Skill under the standard `$HOME/.agents/skills` path.
- Installs only the six harness-owned Codex persona files.
- Installs only the six harness-owned Pi role files and preserves unrelated Pi roles.
- Preserves unrelated custom personas.
- Backs up conflicting managed files under `~/.codex/engineering-harness/backups`.
- Refuses malformed managed markers and unsafe path collisions without changing the affected file.

Preview or verify an installation:

```sh
curl -fsSL https://raw.githubusercontent.com/jwoo0122/engineering-harness-skills/main/install.sh | sh -s -- --dry-run
curl -fsSL https://raw.githubusercontent.com/jwoo0122/engineering-harness-skills/main/install.sh | sh -s -- --check
```

Use alternate roots in tests or managed environments:

```sh
# From a cloned checkout:
HARNESS_HOME=/tmp/harness-home ./install.sh
CODEX_HOME=/custom/codex AGENTS_HOME=/custom/agents PI_HOME=/custom/pi ./install.sh

# One-command installation:
curl -fsSL https://raw.githubusercontent.com/jwoo0122/engineering-harness-skills/main/install.sh | HARNESS_HOME=/tmp/harness-home sh
curl -fsSL https://raw.githubusercontent.com/jwoo0122/engineering-harness-skills/main/install.sh | CODEX_HOME=/custom/codex AGENTS_HOME=/custom/agents PI_HOME=/custom/pi sh
```

## Update

Run the same one-command installer again:

```sh
curl -fsSL https://raw.githubusercontent.com/jwoo0122/engineering-harness-skills/main/install.sh | sh
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
├── .pi/
│   └── agents/
└── tests/
    └── test-install.sh
```

## Compatibility notes

- Codex and Pi discover personal Skills from `$HOME/.agents/skills` and repository Skills from `.agents/skills`.
- Codex discovers personal custom agents from `~/.codex/agents` and project custom agents from `.codex/agents`.
- Pi loads `AGENTS.md` from `~/.pi/agent/AGENTS.md` and discovers the installed Markdown roles through `pi-sub-agent`.
- Custom-agent TOML is Codex-specific; Pi role Markdown is specific to the documented `pi-sub-agent` runtime; the Skill itself follows the portable Agent Skills directory structure.

See the official Codex documentation for [Skill locations](https://learn.chatgpt.com/docs/build-skills#where-to-save-skills), [custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agents), and [`AGENTS.md` guidance](https://learn.chatgpt.com/docs/customization/overview#agents-guidance). For Pi, see [context files](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md#context-files), [skills](https://pi.dev/docs/latest/skills), and [extensions](https://pi.dev/docs/latest/extensions).

## License

Released under the [MIT License](LICENSE).
