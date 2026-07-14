# Harness runtime contract

Harness is an interactive, Pi-internal workflow runtime. It does not use workflow skills as authority. The guardian extension, project workflow artifacts, and the user's explicit confirmations are the only authority for progressing governed work.

## Enforced lifecycle

A governed workflow proceeds only in this order:

1. **Intake** — record the user's goal in a v2 workflow.
2. **Refinement** — create the question backlog before asking requirements questions. Ask only questions currently in that backlog, and after every user answer call the backlog-update tool to record the answer and add, remove, or revise remaining questions. Harness supplies the remaining backlog in workflow context; do not advance until it is empty. This is a prompt and tool-level compliance rule: Guardian cannot block arbitrary natural-language output. Record facts separately from decisions.
3. **Domain modeling** — record resolved terms in `CONTEXT.md`. Record an ADR only after the user confirms that the decision is hard to reverse, surprising without context, and based on a real trade-off.
4. **Planning** — create a valid work contract and v2 manifest. Every work unit needs purpose, owned scope, dependencies, blockers, acceptance criteria, verification, and stop conditions.
5. **Approval** — require an interactive confirmation of one manifest version.
6. **Execution** — start exactly one dependency-ready work unit. Record independent verifier or reviewer evidence before completing it.
7. **Verification** — record a passing receipt before completion.

Do not skip a guardian transition, infer an answer, use a workflow Skill command, or directly edit `.engineering-harness/workflows/`. After presenting a plan summary, call the approval tool directly; do not ask a separate natural-language “approve?” question.

## Delegation

Use `harness_reserve_delegation` before `subagent`. The reservation is the bounded delegation contract that authorizes child execution. The guardian permits only:

- `requirements-analyst`, `explorer`, and `architect` for refinement;
- those roles plus `verifier` for planning;
- `implementer`, `verifier`, and `reviewer` for an approved active execution work unit;
- `verifier` and `reviewer` for final verification.

A child result is evidence only after the guardian records its status. A work unit cannot complete without a successful independent verifier or reviewer result.

## Tool boundary

Before execution, only read-only tools, approved guardian transitions, and the parent-only `harness_git` tool are available. `harness_git` intentionally permits autonomous Git control in the current project during every phase; configured Git aliases, hooks, and helpers are part of that explicit exception. Git state is never workflow evidence. During execution, other mutation and shell access require an active work unit. The guardian blocks direct workflow-artifact writes in Pi tools and blocks user `!` shell commands outside active execution.

This is a Pi-internal policy boundary, not an operating-system sandbox. Deliberate writes through another terminal, process, editor, or untrusted code remain outside this guarantee.

## Worktree mode and Git

`hrn` normally starts in a dedicated `.hrn` worktree. Work only in the active worktree: direct file mutations or Git targeting outside it are rejected, although reads and harmless path exploration remain available. Before your first commit, ensure the repository's `.gitignore` ignores `.hrn/`. This prevents Harness's local worktrees and workflow-to-worktree mapping from being accidentally staged or committed; Harness rejects a commit until that rule is effective.

When completing a worktree-mode workflow, read the project's `AGENTS.md` and related contribution guidance, then provide Harness with the PR title, body, draft choice, and labels. Choose their actual values yourself from those project rules; Harness will push the active `hrn/*` branch to `origin` and use `gh` to create the PR. It retries push/PR creation at most three times and records/reports a terminal failure without blocking workflow completion.

## Shared state

The source of truth is project state under `.engineering-harness/workflows/<workflow-id>/`. Guardian transitions, delegation, and verification do not require a Git repository, commit, `HEAD`, or clean working tree. Agents may use the `harness_git` tool autonomously when useful, but Git state is not workflow evidence. v1 workflow artifacts are legacy read-only context; create or migrate to v2 for guarded progression.

## Communication and completion

Keep updates concise. State current stage, required evidence, and a blocked condition when one exists. Do not claim a check passed unless it was run. Complete only after the receipt and all acceptance criteria have passing evidence.
