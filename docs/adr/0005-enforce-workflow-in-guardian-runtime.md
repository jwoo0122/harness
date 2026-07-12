# Enforce workflow in a guardian runtime

## Status

Accepted

## Context

Harness previously described requirements refinement, domain modeling, planning, approval, delegation, and verification through skills and prompt guidance. A model could skip those instructions, directly call mutating tools, or delegate without a bounded contract. The project-local workflow protocol made plans and receipts durable, but it did not make their order an execution precondition.

## Decision

- Bundle a trusted guardian Pi extension and load it before the bundled subagent extension.
- Disable workflow skills and automatic extension discovery in `hrn`; reject non-interactive, caller-supplied skill, and caller-supplied extension paths.
- Add a v2 workflow model with explicit intake, refinement, planning, approval, execution, verification, and completion phases; preserve v1 artifacts as read-only legacy context.
- Make guardian tools the only Pi-mediated workflow-state writers. They validate refinement topics, term and ADR records, plan shape, approval, delegation reservations, work-unit dependencies, independent verification, and receipts.
- Gate Pi tool calls and user shell commands by phase and active work unit. Render the phase below the editor and a prioritized five-line work list above it.
- Require a committed checkpoint before a workflow state can authorize a child agent or a later Harness session.

## Consequences

The interactive workflow becomes observable and resistant to ordinary model non-compliance. It is deliberately more explicit: users must confirm requirements and approvals, and collaborators checkpoint state before delegation.

The boundary is not a sandbox. A user or process with filesystem access can modify files outside Pi, and an unrestricted execution-stage shell can still be used to evade path-level policy. Stronger integrity requires a future OS sandbox or a maintained Pi fork.
