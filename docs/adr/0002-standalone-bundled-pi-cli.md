# Run Engineering Harness as a standalone CLI with a bundled Pi runtime

## Status

Accepted

## Context

The pre-standalone Engineering Harness distribution was a Pi package. Its `pi-sub-agent` extension was bundled, but the user still had to install and run a compatible global `pi` executable. The package did not expose an executable harness command or own its own authentication, session, trust, and role state.

The project needs an external harness command, comparable to Gajae-Code's `gjc`: users install one npm package, run one command, and do not separately install Pi or the subagent runtime. Node.js remains a documented prerequisite rather than a bundled runtime.

## Decision

Publish `engineering-harness` from the existing npm package and make it the supported distribution.

- Depend directly and exactly on `@earendil-works/pi-coding-agent@0.80.6` and `pi-sub-agent@0.1.5` so npm installs the complete runtime graph with the Harness package.
- Launch Pi's installed `dist/cli.js` from the wrapper process, injecting absolute paths to the packaged Harness skills, global guidance, and subagent extension.
- Keep the wrapper as `process.argv[1]`. `pi-sub-agent` then re-executes that wrapper for child agents instead of resolving an ambient `pi` executable from `PATH`.
- Require Node.js 22.19.0 or newer. Validate it before importing the runtime and print an actionable diagnostic for unsupported versions.
- Own state under `~/.engineering-harness/agent` by setting `PI_CODING_AGENT_DIR` internally. Ignore inherited `PI_CODING_AGENT_DIR`; permit an explicit Harness-specific `ENGINEERING_HARNESS_AGENT_DIR` override.
- Initialize Harness-owned role files in that state directory without overwriting customized files during normal launch. Provide `engineering-harness setup --check` and `--force` for inspection and intentional replacement.
- Preserve Pi's project-trust model for project-local resources. The independent Harness state prevents a separately installed Pi's global configuration from loading accidentally; it does not make an untrusted repository safe to execute.
- Remove the npm `pi` package manifest. A distribution that embeds the Pi runtime must not also be loaded inside a separately running Pi process with a potentially different core runtime identity.

## Consequences

Users install and update only `engineering-harness-skills`; no global `pi` or separate `pi-sub-agent` installation is needed. They authenticate within Harness-owned state or provide supported API-key environment variables.

This is a breaking distribution change for Pi-package users. Users migrate by removing the legacy Pi package entry before installing the CLI. The legacy source layout remains available in Git history for rollback; it is not a supported new installation.

The installed CLI footprint is larger and its direct Pi runtime dependency is now a release and security responsibility. The runtime and subagent versions are pinned, and the acceptance test verifies a packed, global-like install succeeds with no `pi` executable on `PATH`.
