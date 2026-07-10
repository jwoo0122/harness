# Work Contract

Use this contract for non-trivial work. Keep it concise and evidence-based.

## Contract fields

- **Goal:** Observable end state requested by the user.
- **Current state:** Confirmed relevant behavior and repository condition.
- **Gap:** Difference between current and desired state.
- **Constraints:** Contracts, compatibility, security, data, scope, time, and repository rules to preserve.
- **Non-goals:** Adjacent work intentionally excluded.
- **Acceptance criteria:** Binary or measurable conditions that determine success.
- **Evidence:** Tests, measurements, logs, rendered output, or inspection required for each criterion.
- **Assumptions:** Unverified facts temporarily treated as true.
- **Risks:** Unknowns or failure modes that could invalidate the approach.

## Decomposition test

Each task must have:

1. One purpose.
2. Defined inputs and outputs.
3. Owned files or state.
4. Independent acceptance criteria.
5. A reproducible verification method.
6. Explicit dependencies.
7. Prohibited changes.
8. Stop or escalation conditions.

Reject vague tasks such as “improve architecture,” “fix all errors,” or “clean up the code.” Replace them with a bounded observable result.

## Execution order

Default to:

1. Requirement interpretation.
2. Current-state exploration.
3. Highest-risk assumption validation.
4. Interface or architecture decision.
5. Focused implementation.
6. Focused verification.
7. Integration verification.
8. Independent review when risk warrants it.
9. Regression prevention.

Use a repository execution plan when `PLANS.md` or equivalent guidance exists and the change is cross-module, architectural, migratory, or otherwise long-running.

## Quantitative acceptance

Define the baseline, target, environment, input data, procedure, allowed variance, failure threshold, and counter-metrics that must not regress.

Do not claim an improvement from an uncontrolled comparison.

## Qualitative acceptance

Use executable scenarios, requirement checklists, forbidden conditions, compatibility matrices, before/after inspection, or independent review. “Looks good” and “should work” are not criteria.
