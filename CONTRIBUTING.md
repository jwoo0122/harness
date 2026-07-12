# Contributing to Engineering Harness

## Setup and verification

```sh
npm ci --ignore-scripts
npm test
```

Do not run release commands, manually bump versions, publish packages, or create tags. The `main` release workflow owns those operations.

## Conventional Commits

Every commit delivered to `main` and every pull-request title must follow:

```text
<type>(optional-scope): imperative summary
```

Examples:

```text
feat(cli): add a session export command
fix(launcher): isolate the Homebrew state directory
docs: explain npm authentication
```

Use `feat` for minor releases, `fix` or `perf` for patch releases, and `!` after the type/scope or a `BREAKING CHANGE:` footer for a major release. `docs`, `test`, `build`, `ci`, `refactor`, and `chore` normally do not release a version.

Keep subjects imperative, concise, and without a trailing period. When squash merging, the squash title is the release-driving commit, so it must remain Conventional Commit compliant.

## Pull requests

PR descriptions must include:

- the user-visible change;
- migration, compatibility, rollback, or operational effects when applicable;
- checks actually run and their results; and
- material limitations or follow-up work.

Keep changes focused, preserve unrelated work, and add regression coverage for changed behavior.

## Automated release and Homebrew tap

A qualifying Conventional Commit merged to `main` runs Semantic Release. It calculates the semantic version, publishes `@jwoo0122/engineering-harness-skills` to npm, creates the Git tag and GitHub release, and then updates `jwoo0122/homebrew-tap`'s `Formula/engineering-harness.rb`.

Repository maintainers must configure these GitHub Actions secrets before the first release:

- `NPM_TOKEN`: npm automation or granular token with publish access to `@jwoo0122/engineering-harness-skills`.
- `HOMEBREW_TAP_TOKEN`: fine-grained token limited to Contents read/write on `jwoo0122/homebrew-tap`.

The sync step creates or updates `Formula/engineering-harness.rb` on the tap's `main` branch, including an empty new tap. Do not hand-edit release versions or checksums in this repository.
