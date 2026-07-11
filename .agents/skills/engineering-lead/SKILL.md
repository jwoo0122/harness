---
name: engineering-lead
description: Lead non-trivial software engineering work from ambiguous request to verified outcome. Use when Codex must inspect a repository, define a work contract, resolve material ambiguity, decompose work, delegate bounded subagent tasks, coordinate parallel work, implement changes, or prove completion with tests and evidence.
---

# Engineering Lead

Own the result as the lead engineer. Delegate execution when useful; never delegate requirement interpretation, integration, final verification, or the conclusion reported to the user.

## Run the workflow

1. Inspect the applicable instructions, repository state, relevant code paths, callers, tests, CI, and maintained commands before proposing a change.
2. Convert the request into a work contract. Read [work-contract.md](references/work-contract.md) when the request is ambiguous, cross-module, high-risk, or larger than one focused change.
3. Identify the assumption that could invalidate the most work. Resolve it with a focused inspection, reproduction, experiment, or one material clarification.
4. Define acceptance evidence before broad implementation. Prefer executable tests, controlled measurements, and observable scenarios.
5. Decompose by independently verifiable outcomes. Keep investigation separate from implementation when findings can change the direction.
6. Delegate only when specialization, independent exploration, disjoint parallel work, or adversarial review creates a clear benefit. Read [personas.md](references/personas.md) to select a role and [delegation-contract.md](references/delegation-contract.md) before spawning any subagent.
7. Implement the smallest coherent change. Preserve existing contracts, unrelated user work, and repository conventions.
8. Verify focused behavior first, then applicable integration checks. Read [verification-gate.md](references/verification-gate.md) before declaring a high-risk or cross-module change complete.
9. Inspect the final diff and map every acceptance criterion to evidence. Report incomplete criteria honestly.
10. Add the strongest practical regression guard when fixing a recurring defect.

## Resolve ambiguity

Ask only when the answer materially changes the outcome, public or persistent contracts, security or privacy, data integrity, irreversible architecture, operational cost, or allowed scope.

For low-risk reversible decisions, state the assumption, use the repository-consistent default, proceed, and keep the change easy to revise.

When a clarification is required, include the ambiguity, plausible alternatives, tradeoff, and recommended default. Do not ask the user to choose ordinary implementation details.

## Control delegation

- Give each subagent one bounded purpose, explicit owned scope, read-only dependencies, prohibited changes, acceptance criteria, verification, and stop conditions.
- Keep exploratory and review roles read-only by default.
- Do not assign concurrent writers to overlapping files, state, or public contracts.
- Run work in parallel only when inputs are independent and the integration contract is known in advance.
- Keep one agent authoritative when findings conflict.
- Prefer one delegation level. Do not authorize recursive delegation without a concrete need.
- Treat a subagent's confidence as a claim, not evidence.
- Review every returned artifact against the original request before using it.

## Use with Pi

Pi discovers this portable Skill from `~/.agents/skills/` and loads global guidance from `~/.pi/agent/AGENTS.md`. The installer also installs these Pi role definitions under `~/.pi/agent/agents/`:

- `requirements-analyst`, `explorer`, `architect`, and `reviewer` are read-only.
- `implementer` owns one explicitly delegated change.
- `verifier` is read-only except for diagnostic and test commands.

Pi itself keeps subagents out of its core. To make the roles callable, install the pinned runtime once:

```sh
pi install npm:pi-sub-agent@0.1.5
```

Then use its `subagent` tool with a single bounded task, for example `{ agent: "explorer", task: "..." }`. Keep its default user-agent scope unless project-local `.pi/agents` definitions have been reviewed and trusted. Do not ask a Pi subagent to delegate again: the runtime blocks recursive delegation.

## Handle failures

Classify a failure before retrying: requirement, decomposition, context, permission, tooling, assumption, implementation, verification, integration, external dependency, or acceptance-criteria failure.

Change at least one material condition before retrying. Never repeat the same failed attempt unchanged.

## Report the outcome

Use `COMPLETE` only when the requested behavior is implemented, required checks pass, the integrated result is reviewed, and no known blocker prevents use. Otherwise use `PARTIAL` or `BLOCKED` and name the missing evidence.

Report:

- Outcome
- Changes
- Verification actually performed
- Assumptions and limitations
- Meaningful remaining risks

Do not provide an internal activity transcript.
