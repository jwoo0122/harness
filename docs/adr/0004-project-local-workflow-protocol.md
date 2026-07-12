# Project-local workflow protocol

## Status

Accepted

## Context

Engineering Harness previously supplied lead-engineering guidance and isolated Pi state, but it had no shared, durable representation of a work item. Approval, a decomposed execution plan, blockers, progress, and verification evidence could be left in a session transcript or inferred from chat. That cannot be reviewed, safely resumed, or advanced by multiple collaborators.

The protocol needs to be visible to the Harness on every launch without adding workflow-management commands or putting project work state in a user-home directory. It must distinguish an approved plan from an unapproved proposal and completion evidence from an unsupported claim.

## Decision

- Store the workflow source of truth in the consumer project's committed `.engineering-harness/workflows/<workflow-id>/` directory. The launcher discovers the Git worktree for its cwd and injects a data-only summary of structurally valid artifacts into every parent and child Harness process.
- Use dependency-free JSON artifacts: immutable `manifest/<version>.json`, revisioned mutable `state.json`, and append-only `receipts/<receipt-id>.json`. The launcher reads regular blob artifacts from the current Git `HEAD`, not the working tree, so only committed state is injected across collaborators; repository history is the shared review and distribution mechanism.
- Approve a manifest version as a whole, including its work-unit DAG and blockers. The mutable state records approval because adding approval must not alter an immutable manifest. A material plan change creates a new manifest version and requires contextual user approval again.
- Require lifecycle states `draft`, `awaiting_approval`, `approved`, `in_progress`, `verification_pending`, and `completed`; `blocked`, `failed`, and `cancelled` are explicit exceptional states. A passing receipt tied to the manifest version and a resolvable Git commit that is an ancestor of the snapshot revision is required before `completed`.
- Require agents to examine existing workflows before a proposal, extending a compatible workflow instead of duplicating it and declaring bilateral relationships for independent workflows.
- Use optimistic concurrency for `state.json`. Agents re-read its revision before mutation, merge only safely, and record an unsafe merge as a blocker. Invalid or inconsistent artifacts are silently excluded from prompt context and completion evidence rather than guessed or repaired automatically.
- Do not add Harness `setup`, `status`, `resume`, or `verify` commands. Normal launcher startup continues to bootstrap missing default roles; workflow selection and contextual approval happen in the ordinary agent conversation.

## Consequences

Workflow progress becomes reviewable alongside the project and can be handed to a later agent or collaborator without relying on Pi session history. Agents begin with a choice of valid non-terminal workflows rather than an implicit resume target. Artifact edits must be committed before a handoff or later process can receive them; an agent asks for authorization rather than creating that commit on its own. The protocol is enforced primarily by prompt guidance and structural validation of injected data; direct file edits by a user or arbitrary tool are still outside a transactional enforcement boundary.

Existing customized Harness role files remain preserved by normal startup, so they may not receive new protocol guidance unless their owner reconciles them. Pi's own session `/resume` and `--resume` controls remain available but do not select or advance a Harness workflow.
