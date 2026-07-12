# Harness

A standalone engineering-agent CLI for requirements refinement, ADR-centered design, bounded delegation, and evidence-based delivery.

Harness is an external harness, like Gajae-Code: it runs beside the repository you choose instead of installing itself as a Pi package or modifying another agent's runtime. The npm package installs its pinned Pi runtime and `pi-sub-agent` dependency automatically, so users do **not** install `pi` or `pi-sub-agent` separately.

## Install

### Requirements

- Node.js **22.19.0 or newer**
- npm (normally included with Node.js)

The CLI validates the active Node.js version before it loads the runtime. An unsupported version prints the detected executable and the required version, then exits without starting the harness.

```sh
npm install -g --ignore-scripts @jwoo0122/harness
hrn
```

Use an API-key environment variable supported by Pi, or authenticate interactively:

```sh
export ANTHROPIC_API_KEY=sk-ant-...
hrn

# Or start Harness, then run:
/login
```

The underlying Pi command-line flags remain available. For example:

```sh
hrn "Inspect this repository and define acceptance criteria."
hrn --model anthropic/claude-sonnet-4-5
hrn --pi-help
```

## What the CLI owns

The command launches the bundled `@earendil-works/pi-coding-agent@0.80.6` directly, with a trusted Harness guardian extension, runtime guidance (`resources/AGENTS.md`), and `pi-sub-agent` extension. Its subagents re-execute the same wrapper, so they use the bundled runtime rather than searching `PATH` for a global `pi` executable.

Harness state is isolated from Pi's normal state:

| State | Location |
| --- | --- |
| Authentication, settings, trust decisions, and sessions | `~/.engineering-harness/agent/` |
| Harness-owned subagent roles | `~/.engineering-harness/agent/agents/` |
| Guardian extension and global Harness guidance | Loaded from the installed package |
| Shared workflow manifests, run state, and verification receipts | `.engineering-harness/workflows/` in the current project directory |

Set `ENGINEERING_HARNESS_AGENT_DIR` to use a different state directory. The launcher deliberately ignores an inherited `PI_CODING_AGENT_DIR`, so a globally installed Pi cannot accidentally supply credentials, extensions, sessions, or settings to Harness. Existing Pi credentials are not copied; use `/login` in `hrn` or provider API-key environment variables. Harness sets and enforces `quietStartup: true` in this isolated state, so the Pi startup header and its Context, Skills, and Extensions lists stay hidden even when trusted project settings set it to `false`; pass `--verbose` only when diagnosing the bundled runtime.

On normal launch, the Harness installs missing bundled role definitions into its own state directory and preserves customized role files. There is no separate Harness setup command.

Workflow records are project artifacts, not ignored runtime state. Every launch discovers valid workflow artifacts from the current project directory, supplies their data-only summary to parent and child agents, and asks the user to select a non-terminal workflow or propose a new one. It never resumes a workflow automatically. Workflow progress is independent of Git: artifacts need not be committed, and Harness works outside a Git repository.

### Shared workflow protocol

A workflow uses JSON artifacts under `.engineering-harness/workflows/<workflow-id>/`:

```text
manifest/<version>.json  # immutable goal, criteria, work-unit DAG, blockers, relationships
state.json               # revisioned approval and lifecycle state
receipts/<receipt-id>.json # append-only verification evidence
```

A manifest version is approved as a whole. Natural-language approval is accepted only for the unique manifest version the agent has just presented; material changes produce a new approval-pending version. State progresses through `draft`, `awaiting_approval`, `approved`, `in_progress`, `verification_pending`, and `completed`, with `blocked`, `failed`, and `cancelled` as exceptional states. A passing receipt for the manifest version is required for `completed`.

Agents use revision-based optimistic concurrency for `state.json`, and declare an unsafe merge as a blocker rather than overwriting it. Before proposing a workflow they assess existing workflows for extension, derivation, or dependency, recording a relationship on both sides. Structurally invalid workflow artifacts are silently excluded from the injected context and cannot support completion.

## Project trust and safety

The guardian loads before the bundled subagent extension. Harness disables automatic Skill and extension discovery, rejects caller-supplied Skill and extension paths, and supports only the interactive TUI; print, JSON, and RPC workflow runs are rejected. Project-local Pi resources therefore cannot replace the guarded workflow path.

The Harness runs with your user permissions. Bundled skills, project instructions, extensions, and delegated tasks can direct the agent to execute commands or edit files. Use only in repositories you trust, review model output, and avoid providing credentials with more scope than the task requires.

## Enforced workflow

The guardian enforces this lifecycle in the interactive TUI:

1. **Intake** records the requested goal.
2. **Refinement** asks and records one ordered question at a time, separating facts from decisions.
3. **Domain modeling** records resolved terms in `CONTEXT.md` and user-confirmed ADRs.
4. **Planning** validates a work contract and every work unit's purpose, scope, dependencies, blockers, criteria, verification, and stop conditions.
5. **Approval** requires a confirmation for the exact manifest version.
6. **Execution** permits one dependency-ready work unit and requires independent verifier or reviewer evidence before it completes.
7. **Verification** records an evidence-backed receipt.

Every delegation first creates a structured reservation. Roles are phase-limited: analysis roles are read-only during refinement and planning; implementers work only after approval; verifiers and reviewers provide independent evidence. The `harness_git` tool lets the parent agent control Git in the current project when useful; this intentional exception includes configured Git aliases, hooks, and helpers. Neither commits nor Git state are workflow prerequisites. v1 workflow artifacts remain visible as legacy read-only context; create or migrate to v2 before progressing them.

The editor shows the current workflow phase below the input and a prioritized work list of at most five lines above it. When space is limited, remaining work is shown before completed work; completed work is dimmed and struck through, and the active work unit displays a spinner.

## Update and migration

Update the CLI and its bundled runtime together:

```sh
npm install -g --ignore-scripts @jwoo0122/harness
```

Run `hrn` after updating. Do not run `pi update` for this installation.

The legacy distribution was installed as a Pi package with `pi install npm:engineering-harness-skills`. Migrate by removing that entry, then installing the standalone CLI:

```sh
pi remove npm:engineering-harness-skills
npm install -g --ignore-scripts @jwoo0122/harness
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

## Test a local package build

Use this POSIX-shell workflow (macOS/Linux) to package the current checkout and install that exact artifact into a disposable global npm prefix. It does not replace an existing global Harness installation or use its state. `npm pack` is the package build step for this CLI.

```sh
npm ci --ignore-scripts

TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/engineering-harness-local.XXXXXX")
trap 'rm -rf "$TEST_ROOT"' EXIT HUP INT TERM
npm pack --ignore-scripts --pack-destination "$TEST_ROOT"
TARBALL=$(find "$TEST_ROOT" -maxdepth 1 -name '*.tgz' -print -quit)
test -n "$TARBALL"

npm install --global --prefix "$TEST_ROOT/prefix" --ignore-scripts --no-audit --no-fund "$TARBALL"
HOME="$TEST_ROOT/home" ENGINEERING_HARNESS_AGENT_DIR="$TEST_ROOT/agent" \
  "$TEST_ROOT/prefix/bin/hrn" --pi-help
```

The final command proves the packed global CLI can locate its bundled runtime without contacting a model provider. To run the locally packaged Harness interactively, replace `--pi-help` with your prompt or no argument and authenticate with `/login` or a supported API-key environment variable. Run the commands in a shell with `trap` support; on Windows, use an equivalent temporary directory, `npm pack`, `npm install --global --prefix`, and the generated `hrn` command.

## Verify the project

```sh
npm ci --ignore-scripts
npm test
```

`tests/test-install.sh` covers the legacy resource installer. `tests/test-standalone-cli.sh` packs the npm artifact, installs it into a disposable prefix, verifies the guardian and protocol resources, rejects non-interactive and caller-supplied workflow paths, and validates v1 and v2 workflow-context discovery plus Git-independent Guardian transitions. `tests/test-release-automation.sh` validates Conventional Commit release configuration and the token-gated Homebrew Formula synchronizer without external network calls.

## Repository layout

```text
.
├── AGENTS.md                   # contributor guidance
├── CONTRIBUTING.md              # Conventional Commit and release policy
├── resources/AGENTS.md         # runtime guidance packaged for Harness agents
├── bin/hrn.js                  # npm CLI entry point
├── lib/launcher.js             # Node guard, state bootstrap, bundled Pi launcher
├── .agents/skills/             # bundled workflow skills
├── .pi/agents/                 # bundled Harness subagent roles
├── .github/workflows/release.yml
├── scripts/sync-homebrew-formula.mjs
├── docs/adr/                   # durable architecture decisions
├── .engineering-harness/       # workflow state in consumer projects
├── install.sh                  # optional legacy resource installer
└── tests/
```

## Compatibility

- The bundled Pi runtime requires Node.js **22.19.0 or newer**.
- macOS, Linux, and Windows are supported wherever that Node.js version and npm are supported.
- A model credential is still required: `/login` stores it in Harness-owned state, while provider API-key environment variables work without persistent credentials.

Released under the [MIT License](LICENSE).
