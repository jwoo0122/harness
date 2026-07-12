# Harness Workflow Protocol

This context defines the shared vocabulary for the durable workflow records that Harness agents maintain in a project.

## Language

**Workflow Protocol**:
The explicit, repository-owned rules and records that govern a Harness work item from requirement through evidence-backed completion.
_Avoid_: implicit workflow, agent memory

**Project Workflow State**:
The version-controlled, project-local source of truth that collaborators and Harness agents jointly advance for workflow work items; it is not user-home or ignored runtime state.
_Avoid_: local cache, private state

**Execution Plan**:
The shared, approval-bound decomposition of a workflow manifest into identifiable work units, their dependencies, blockers, ownership, and acceptance evidence.
_Avoid_: todo list, implementation notes

**Work Unit**:
One independently verifiable, bounded item in an Execution Plan that may proceed only when its declared blockers are resolved.
_Avoid_: task, subtask

**Blocker**:
A declared unresolved dependency or condition that prevents a Work Unit from starting or completing.
_Avoid_: impediment, issue

**Manifest Approval**:
An explicit user decision that authorizes one immutable version of a Workflow Manifest, including its Execution Plan; a material change to that version requires a replacement approval.
_Avoid_: implied consent, blanket approval

**Workflow Relationship**:
A declared dependency, derivation, or extension link between two workflows that constrains their planning or execution; every proposed workflow is evaluated against existing workflows for such a link.
_Avoid_: unrelated parallel work, implicit dependency

**Run State**:
The durable lifecycle record for an approved workflow version. Its nominal progression is `draft`, `awaiting_approval`, `approved`, `in_progress`, `verification_pending`, and `completed`; `blocked`, `failed`, and `cancelled` are explicit exceptional states.
_Avoid_: session status, inferred progress

**Verification Receipt**:
An immutable evidence record tied to one manifest version and project revision. A passing receipt maps each acceptance criterion to observed results and is required before that workflow version can be completed.
_Avoid_: completion claim, test summary

**Workflow Context Injection**:
The automatic delivery of relevant shared workflow-state summaries and artifact references to every Harness agent started in the same Git worktree.
_Avoid_: setup command, manual resume command

**State Revision**:
The revision token for a mutable workflow artifact. A writer must reconcile against the latest revision before changing it, and records an unresolved unsafe merge as a blocker rather than overwriting it.
_Avoid_: last write wins, silent overwrite

**Contextual Approval**:
A user’s unstructured affirmative response to the one workflow manifest version the agent has just explicitly presented for approval. If that target is not unique, the agent asks which workflow and version the user intends rather than inferring it.
_Avoid_: approval syntax, inferred blanket consent

**Workflow Artifact Set**:
The committed project-local records for one workflow: immutable versioned manifests, one revisioned run-state record, and append-only verification receipts.
_Avoid_: ignored cache, session transcript

**Workflow Extension**:
A new manifest version of an existing workflow that incorporates a request within that workflow’s scope. A separate workflow is created only for an independently approvable and verifiable outcome, with all relationships declared on both sides.
_Avoid_: duplicate workflow, hidden scope expansion

**Workflow Selection**:
The user’s contextual choice of the workflow an initial Harness session will discuss or advance. Harness asks for this choice before work rather than automatically resuming an active workflow. The initial selection lists non-terminal workflows and a new-workflow option; terminal workflows appear only when requested.
_Avoid_: automatic resume, implicit workflow choice

**Invalid Workflow Artifact**:
A workflow artifact that cannot satisfy the protocol’s structural or reference rules. Harness excludes it from context injection, selection, and completion evidence without modifying it.
_Avoid_: blocked workflow, inferred recovery

**Guardian Runtime**:
The trusted Harness extension that is the only Pi-mediated authority for workflow transitions, delegation reservations, and phase-specific tool access.
_Avoid_: workflow skill, prompt-only enforcement

**Workflow Phase**:
The durable v2 position of a governed workflow: intake, refinement, planning, awaiting approval, execution, verification, or completed. A phase can advance only when its required evidence exists.
_Avoid_: inferred progress, session mode

**Delegation Reservation**:
A recorded, bounded contract that authorizes one subagent role, exact task, permitted phase, verification method, and stop conditions before the native subagent tool can run.
_Avoid_: free-form delegation, implicit handoff

**commit-independent Guardian operation**:
Guardian state transitions do not depend on Git commit presence, HEAD changes, or a clean working tree. Approval and verification evidence remain required.
_Avoid_: Do not interpret this as waiving approval, verification, or other non-Git evidence requirements.
