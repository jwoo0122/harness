# Release from main with Conventional Commits and synchronize Homebrew

## Status

Accepted

## Context

The project had no release workflow, release tags, npm publication, or Homebrew formula. It now distributes a standalone npm CLI, so its package version, GitHub release, and Homebrew Formula must describe the same artifact.

The repository has no prior public npm version or Git tag. A fabricated baseline tag would misrepresent release history and can cause Semantic Release to calculate an incorrect next version.

## Decision

- Run Semantic Release only on pushes to `main`.
- Use Conventional Commits to calculate semantic versions and tags in the `v<version>` format. The first qualifying release starts at `1.0.0`; the development manifest uses `0.0.0-development` until Semantic Release writes the released version.
- Publish to npm, commit the generated `CHANGELOG.md`, `package.json`, and `package-lock.json`, create the GitHub release, then invoke the Homebrew synchronizer in that order.
- Synchronize only `jwoo0122/homebrew-tap`'s `Formula/engineering-harness.rb`. The synchronizer obtains the versioned npm tarball, computes its SHA-256, and updates only an expected Formula URL and checksum. It fails closed for unexpected Formula content.
- Keep release credentials in GitHub Actions secrets: `NPM_TOKEN` for npm and `HOMEBREW_TAP_TOKEN` limited to Contents read/write on the tap. The standalone synchronizer can skip before network access when the Homebrew token is absent, but the release workflow verifies that token before npm publication and fails when it is unavailable.
- Keep contributor policy in root `AGENTS.md` and `CONTRIBUTING.md`. Ship runtime agent guidance separately as `resources/AGENTS.md` so release and repository-maintenance instructions never enter installed agent prompts.

## Consequences

A correctly titled squash merge can trigger a release automatically; an invalid or non-releasable Conventional Commit does not. Contributors must not manually bump versions or create tags.

The synchronizer creates the Formula on the public tap's `main` branch when it is absent, including on a new empty tap. After npm publication, a configured tap synchronization failure makes the release workflow fail visibly. The npm package and GitHub release may already exist, so maintainers retry the formula synchronizer rather than republishing the version.
