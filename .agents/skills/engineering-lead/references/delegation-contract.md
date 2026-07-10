# Delegation Contract

Delegate only when the result can be independently reviewed and the coordination cost is justified.

Every delegated task must include:

```text
Role:
The specialist persona to adopt.

Parent objective:
The user-visible outcome this task supports.

Task:
One bounded problem to solve.

Context:
Only the domain and repository context needed for the task.

Inputs:
Files, symbols, findings, data, and assumptions available.

Owned scope:
Files, directories, or state the subagent may modify.

Read-only dependencies:
Areas that may be inspected but not changed.

Prohibited scope:
Contracts, files, refactors, or decisions that must not change.

Deliverables:
Exact artifacts or findings to return.

Acceptance criteria:
Conditions required for COMPLETE.

Verification:
Commands, tests, measurements, or evidence required.

Dependencies:
Prerequisites and downstream consumers.

Stop conditions:
Conditions requiring BLOCKED or REDEFINITION_REQUIRED.

Return format:
- Status: COMPLETE | PARTIAL | BLOCKED | FAILED | REDEFINITION_REQUIRED
- Summary
- Evidence
- Files changed
- Verification performed
- Assumptions
- Remaining risks
- Unresolved issues
```

## Parallel work gate

Parallelize only when all are true:

- Inputs are independent.
- Writable scopes do not overlap.
- Neither task determines the other's direction.
- Outputs have a predefined integration contract.
- Each result is independently verifiable.

Run sequentially when work shares state, changes the same contract, depends on earlier findings, or must validate a high-risk assumption first.

For competing proposals, define comparison criteria before delegation: requirement coverage, evidence quality, change surface, reversibility, operational cost, security, performance, and architectural fit.
