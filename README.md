# Engineering Harness for Codex and Pi

An installable engineering-lead workflow for Codex, Pi, and Agent Skills-compatible tools.

It helps an agent turn ambiguous software requests into bounded work, delegate safely, implement the smallest coherent change, and prove completion with evidence.

## What it installs

The harness has four layers:

| Layer | Purpose | Installed location |
| --- | --- | --- |
| Global guidance | Durable lead-engineer rules that apply to every task | `~/.codex/AGENTS.md` |
| Agent Skills | Lead, requirements-refinement, glossary, and ADR workflows | `~/.agents/skills/*` |
| Codex personas | Native specialist roles for bounded subagent work | `~/.codex/agents/*.toml` |
| Pi resources | Guidance and specialist roles for Pi sessions | `~/.pi/agent/AGENTS.md`, `~/.pi/agent/agents/*.md` |

The same skills are also published as a Pi package. The package bundles the `pi-sub-agent` runtime, so Pi users do not need a second runtime installation.

## Quick start

### Codex and Agent Skills-compatible tools

Requirements:

- Codex CLI or desktop app
- macOS or another POSIX-compatible environment
- `curl`, `tar`, and standard POSIX shell tools such as `sh`, `awk`, `diff`, and `mktemp`

Install with one command; cloning the repository is not required:

```sh
curl -fsSL https://raw.githubusercontent.com/jwoo0122/engineering-harness-skills/main/install.sh | sh
```

The bootstrap downloads a temporary source archive, runs the repository installer, and removes the archive afterward. Start a new task and invoke the lead workflow explicitly when useful:

```text
Use $engineering-lead to implement this request and prove every acceptance criterion.
```

### Pi package

Install the package once. It exposes the engineering skills and bundles the `subagent` extension and its runtime:

```sh
pi install npm:engineering-harness-skills
```

For local development, run `pi install ./ -l` from this checkout. Then start Pi in a trusted project and use `/skill:engineering-lead`, `/skill:grill-with-docs`, or the `subagent` tool. Do **not** separately install `pi-sub-agent`; it is bundled by this package. The child process still requires the `pi` executable and credentials for the selected model.

## How the workflow behaves

The lead agent:

1. Inspects the repository, existing instructions, tests, and current behavior.
2. Defines the goal, current state, gap, constraints, non-goals, acceptance criteria, evidence, assumptions, and risks.
3. Uses `grill-with-docs` when requirements or design branches need refinement: facts are inspected, decisions are asked one at a time, and the user confirms the shared understanding before implementation.
4. Maintains a concise `CONTEXT.md` glossary as project terms become precise.
5. Records only hard-to-reverse, surprising, trade-off-driven decisions as sequential ADRs under `docs/adr/`.
6. Decomposes work into independently verifiable outcomes and delegates only bounded work.
7. Implements the smallest coherent change, runs focused and integration verification, and reviews the integrated result.
8. Reports incomplete or blocked work honestly.

## Included personas

| Persona | Default access | Responsibility |
| --- | --- | --- |
| `requirements_analyst` | Read-only | Extract outcomes, constraints, non-goals, ambiguity, and acceptance criteria |
| `explorer` | Read-only | Trace current behavior, dependencies, tests, and repository conventions |
| `architect` | Read-only | Compare bounded designs, contracts, migration, rollback, and operational cost |
| `implementer` | Workspace write | Make one scoped code change and its focused tests |
| `verifier` | Read-only | Reproduce behavior and test acceptance, boundary, and negative scenarios |
| `reviewer` | Read-only | Seek correctness, security, data, concurrency, operational, and regression risks |

The same six roles are installed for Pi as Markdown agent definitions by the shell installer. The Pi package bundles `pi-sub-agent`, whose built-in roles are available immediately through the `subagent` tool; the shell installer additionally provisions the harness-specific roles. The extension runs each delegation in an isolated Pi process, removes recursive delegation, and defaults to user-level agent definitions. Do not enable project-local agent definitions unless that repository is trusted and those prompts have been reviewed.

The portable Skills also contain equivalent persona contracts for tools that support `.agents/skills` but not Codex custom-agent TOML files.

## Safe installation behavior

`./install.sh` is idempotent and does not edit `~/.codex/config.toml`.

It:

- Adds a clearly marked managed block to `~/.codex/AGENTS.md`.
- Preserves guidance outside that block.
- Installs all harness-owned Skills under the standard `$HOME/.agents/skills` path, including `grill-with-docs`, `grilling`, and `domain-modeling`.
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

For the shell-installed resources, run the same one-command installer again:

```sh
curl -fsSL https://raw.githubusercontent.com/jwoo0122/engineering-harness-skills/main/install.sh | sh
```

For Pi package resources, use Pi's package updater:

```sh
pi update npm:engineering-harness-skills
```

Only changed shell-installer files are replaced, and replaced versions are backed up.

## Verify the project

Run the isolated installer acceptance test:

```sh
./tests/test-install.sh
```

The test covers initial installation, preservation of existing guidance, idempotent reinstall, drift detection and repair, backup creation, malformed-marker rejection, path-collision safety, and remote bootstrap. `./tests/test-pi-package.sh` verifies the npm manifest, bundled runtime, and packaged Skills.

## Repository layout

```text
.
├── AGENTS.md
├── install.sh
├── package.json              # Pi package manifest
├── package-lock.json
├── .agents/skills/
│   ├── engineering-lead/
│   ├── grill-with-docs/
│   ├── grilling/
│   └── domain-modeling/
├── .codex/agents/
├── .pi/agents/
├── docs/adr/                 # durable architecture decisions
├── tests/
│   ├── test-install.sh
│   └── test-pi-package.sh
└── THIRD-PARTY-NOTICES.md
```

## Compatibility notes

- Codex and Pi discover personal Skills from `$HOME/.agents/skills` and repository Skills from `.agents/skills`.
- Codex discovers personal custom agents from `~/.codex/agents` and project custom agents from `.codex/agents`.
- Pi loads `AGENTS.md` from `~/.pi/agent/AGENTS.md`, discovers package Skills through `package.json`, and loads the bundled `pi-sub-agent` extension from the package manifest.
- Custom-agent TOML is Codex-specific; Pi role Markdown is specific to `pi-sub-agent`; the Skills follow the portable Agent Skills directory structure.
- The package follows the current Pi 0.80 runtime floor: Node.js 22.19 or newer. The bundled `pi-sub-agent@0.1.5` also requires the `pi` executable for child processes.

See the official Codex documentation for [Skill locations](https://learn.chatgpt.com/docs/build-skills#where-to-save-skills), [custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agents), and [`AGENTS.md` guidance](https://learn.chatgpt.com/docs/customization/overview#agents-guidance). For Pi, see [packages](https://pi.dev/docs/latest/packages), [context files](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md#context-files), [skills](https://pi.dev/docs/latest/skills), and [extensions](https://pi.dev/docs/latest/extensions).

## License

Released under the [MIT License](LICENSE).
