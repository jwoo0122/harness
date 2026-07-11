# Contributing to Engineering Harness

This file governs contributions to this repository. Runtime instructions shipped to installed Harness agents live in [`resources/AGENTS.md`](resources/AGENTS.md); do not add contributor, release, or repository-maintenance instructions there.

## Contribution workflow

- Inspect relevant source, tests, CI, documentation, and working-tree state before editing.
- Make the smallest coherent change, preserve unrelated work, and add the strongest practical regression guard.
- Run `npm ci --ignore-scripts` and `npm test` before requesting review when dependencies or behavior change.
- Do not commit, push, publish, tag, release, or deploy unless the user explicitly requests it.

## Conventional Commits and pull requests

All commits intended for `main` and all pull-request titles **must** use Conventional Commit syntax:

```text
<type>(optional-scope): imperative summary
```

Allowed types include `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, and `chore`.

- `feat` releases a minor version; `fix` and `perf` release a patch version.
- Add `!` after the type/scope or a `BREAKING CHANGE:` footer for a major release.
- Keep the subject imperative, concise, and free of a trailing period.
- Use the final squash-merge title as the release-driving Conventional Commit. A non-conventional merge title can prevent an intended release.
- PR descriptions must state user-visible changes, migration or rollback implications, and checks actually run.

## Releases

- `main` is the only release branch. Semantic Release calculates versions, tags, npm publication, GitHub releases, and Homebrew formula updates from Conventional Commits.
- Never manually edit release versions, create release tags, or publish from a workstation.
- Release credentials remain GitHub Actions secrets. Do not print, commit, or pass tokens in command arguments.

## Completion

Before completion, inspect the final diff for unintended changes, missing tests, security or data risks, debug artifacts, and release-contract drift. Report only checks actually run and any material remaining risk.
