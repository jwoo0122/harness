# Engineering Harness

A standalone engineering-agent CLI for requirements refinement, ADR-centered design, bounded delegation, and evidence-based delivery.

`engineering-harness` is an external harness, like Gajae-Code: it runs beside the repository you choose instead of installing itself as a Pi package or modifying another agent's runtime. The npm package installs its pinned Pi runtime and `pi-sub-agent` dependency automatically, so users do **not** install `pi` or `pi-sub-agent` separately.

## Install

### Requirements

- Node.js **22.19.0 or newer**
- npm (normally included with Node.js)

The CLI validates the active Node.js version before it loads the runtime. An unsupported version prints the detected executable and the required version, then exits without starting the harness.

```sh
npm install -g --ignore-scripts engineering-harness-skills
engineering-harness
```

Use an API-key environment variable supported by Pi, or authenticate interactively:

```sh
export ANTHROPIC_API_KEY=sk-ant-...
engineering-harness

# Or start the harness, then run:
/login
```

The underlying Pi command-line flags remain available. For example:

```sh
engineering-harness "Inspect this repository and define acceptance criteria."
engineering-harness -p "Summarize the current architecture."
engineering-harness --model anthropic/claude-sonnet-4-5
engineering-harness --pi-help
```

## What the CLI owns

The command launches the bundled `@earendil-works/pi-coding-agent@0.80.6` directly, with absolute paths to the bundled Harness skills, runtime guidance (`resources/AGENTS.md`), and `pi-sub-agent` extension. Its subagents re-execute the same wrapper, so they use the bundled runtime rather than searching `PATH` for a global `pi` executable.

Harness state is isolated from Pi's normal state:

| State | Location |
| --- | --- |
| Authentication, settings, trust decisions, and sessions | `~/.engineering-harness/agent/` |
| Harness-owned subagent roles | `~/.engineering-harness/agent/agents/` |
| Bundled skills and global Harness guidance | Loaded from the installed package |

Set `ENGINEERING_HARNESS_AGENT_DIR` to use a different state directory. The launcher deliberately ignores an inherited `PI_CODING_AGENT_DIR`, so a globally installed Pi cannot accidentally supply credentials, extensions, sessions, or settings to the Harness. Existing Pi credentials are not copied; use `/login` in `engineering-harness` or provider API-key environment variables.

On first launch, the Harness installs its six role definitions into its own state directory. It preserves customized role files during normal launches. Inspect or deliberately refresh them with:

```sh
engineering-harness setup --check
engineering-harness setup --force
```

## Project trust and safety

Pi's project-trust behavior remains intact for project-local `.pi` resources; review them before approving. The Harness disables automatic Skill discovery so an ambient `~/.agents/skills` entry cannot override its bundled workflow. Add an extra reviewed Skill explicitly with Pi's `--skill <path>` flag. For a one-off non-interactive run, pass Pi's `--approve` or `--no-approve` flag deliberately.

The Harness runs with your user permissions. Bundled skills, project instructions, extensions, and delegated tasks can direct the agent to execute commands or edit files. Use only in repositories you trust, review model output, and avoid providing credentials with more scope than the task requires.

## Included workflow

The lead agent:

1. Inspects relevant source, callers, tests, CI, documentation, and working-tree state.
2. Defines the goal, current state, gap, constraints, non-goals, acceptance criteria, evidence, assumptions, and risks.
3. Refines material ambiguity before mutation.
4. Records durable terms in `CONTEXT.md` and hard-to-reverse decisions as ADRs when warranted.
5. Delegates only bounded, independently verifiable work.
6. Implements the smallest coherent change, verifies focused and integration behavior, and reviews the final diff.

Bundled skills:

- `engineering-lead`
- `grill-with-docs`
- `grilling`
- `domain-modeling`

Bundled Harness roles:

- `requirements-analyst`
- `explorer`
- `architect`
- `implementer`
- `verifier`
- `reviewer`

Use `/skill:engineering-lead` in an interactive session when the task needs the full workflow. The `subagent` tool is available immediately and launches isolated child Harness processes.

## Update and migration

Update the CLI and its bundled runtime together:

```sh
npm install -g --ignore-scripts engineering-harness-skills
```

Do not run `pi update` for this installation.

The legacy distribution was installed as a Pi package with `pi install npm:engineering-harness-skills`. Migrate by removing that entry, then installing the standalone CLI:

```sh
pi remove npm:engineering-harness-skills
npm install -g --ignore-scripts engineering-harness-skills
```

The legacy Pi-package path required a separately installed `pi` executable and is not supported for new installations.

## Homebrew

After a release is synchronized to the public tap, install the CLI with:

```sh
brew tap jwoo0122/tap
brew install engineering-harness
```

The Formula depends on Homebrew's Node package and installs the published npm package and its runtime dependencies automatically. Formula versions and checksums are maintained by the release workflow; do not edit them manually.

## Optional legacy installer

`install.sh` remains for existing Codex and Agent Skills users who intentionally manage those resources in their tool-specific directories. It installs the packaged runtime guidance from `resources/AGENTS.md`, not this repository's contributor instructions. It is not required for the standalone CLI and does not install the CLI.

## Verify the project

```sh
npm ci --ignore-scripts
npm test
```

`tests/test-install.sh` covers the legacy resource installer. `tests/test-standalone-cli.sh` packs the npm artifact, installs it into a disposable prefix, removes any global `pi` from `PATH`, verifies the standalone binary and resource provenance, checks state isolation from `~/.pi`, and uses a local mock model to prove a delegated child re-enters the bundled wrapper. `tests/test-release-automation.sh` validates Conventional Commit release configuration and the token-gated Homebrew Formula synchronizer without external network calls.

## Repository layout

```text
.
├── AGENTS.md                   # contributor guidance
├── CONTRIBUTING.md              # Conventional Commit and release policy
├── resources/AGENTS.md         # runtime guidance packaged for Harness agents
├── bin/engineering-harness.js  # npm CLI entry point
├── lib/launcher.js             # Node guard, state bootstrap, bundled Pi launcher
├── .agents/skills/             # bundled workflow skills
├── .pi/agents/                 # bundled Harness subagent roles
├── .github/workflows/release.yml
├── scripts/sync-homebrew-formula.mjs
├── docs/adr/                   # durable architecture decisions
├── install.sh                  # optional legacy resource installer
└── tests/
```

## Compatibility

- The bundled Pi runtime requires Node.js **22.19.0 or newer**.
- macOS, Linux, and Windows are supported wherever that Node.js version and npm are supported.
- A model credential is still required: `/login` stores it in Harness-owned state, while provider API-key environment variables work without persistent credentials.

Released under the [MIT License](LICENSE).
