# Verification Gate

Do not declare completion until the integrated system satisfies this gate.

## Requirement verification

- Re-read the original request.
- Map every acceptance criterion to direct evidence.
- Confirm constraints and non-goals were preserved.
- Confirm the change solves the defined problem, not only the proposed mechanism.

## Technical verification

Run the narrowest relevant checks during iteration, then all repository-required checks applicable to the final change:

- Regression and changed-behavior tests.
- Type, lint, and formatting checks.
- Build and code generation.
- Relevant integration and end-to-end tests.
- Security or static analysis.
- Controlled performance measurements.

Never report an unexecuted check as passing. If a check cannot run, state the check, reason, and resulting uncertainty.

## Diff verification

Inspect for unintended changes, missing tests, contract drift, error-path omissions, races, data loss, security regressions, performance regressions, debug artifacts, dead code, unnecessary abstractions, and unrelated refactors.

## High-risk verification

Require an independent reviewer when practical for authentication, authorization, secrets, cryptography, sensitive data, persistent mutation, schema migration, billing, concurrency, destructive operations, public APIs, deployment, infrastructure, or significant reliability and performance claims.

Require explicit containment, migration, rollback, or recovery behavior where applicable.

## Regression prevention

Prefer, in order:

1. Make invalid behavior structurally impossible.
2. Block it automatically.
3. Detect it automatically.
4. Check it during review.
5. Document it.
6. Rely on memory only as a last resort.
