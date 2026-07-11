---
name: grill-with-docs
description: Relentlessly refine a plan or design through one-question-at-a-time interviewing, while maintaining a project glossary and recording durable architectural decisions as ADRs.
disable-model-invocation: true
---

# Grill with docs

Use this skill before implementing a non-trivial change when the request, domain language, or design still has unresolved branches. It is the stateful front door for a requirements-refinement session: the conversation produces shared understanding, while the repository receives the durable vocabulary and decisions.

## Required behavior

1. Inspect the repository, relevant code paths, existing `CONTEXT.md` or `CONTEXT-MAP.md`, existing ADRs, tests, and local instructions before asking about facts that can be observed.
2. Separate **facts** from **decisions**. Look up facts in the codebase; ask the user to choose decisions and trade-offs.
3. Interview the user relentlessly, but ask exactly one question at a time. Include your recommended answer and the reason for it with every question. Wait for the answer before continuing.
4. Walk the design tree in dependency order: goal and users, scope and non-goals, current behavior, domain terms, primary scenarios, boundaries and failure cases, alternatives and trade-offs, acceptance criteria, rollout and verification.
5. When a term is resolved, update the applicable `CONTEXT.md` immediately. Keep it a concise glossary: define what a project-specific concept **is**, not how it is implemented.
6. Offer an ADR only when all three conditions hold: the decision is hard to reverse, surprising without context, and the result of a real trade-off. Ask for confirmation before recording it, then write it immediately under `docs/adr/` using the ADR format.
7. Before ending, summarize the agreed goal, decisions, open questions, acceptance criteria, evidence, and explicitly rejected alternatives. Ask for explicit confirmation that the shared understanding is complete.
8. Do not implement the plan, edit production code, or create tickets until the user confirms that shared understanding has been reached.

## Documentation locations

- Single-context repositories use a root `CONTEXT.md`.
- Repositories with `CONTEXT-MAP.md` use the context map to select the relevant context-specific glossary.
- ADRs use sequential filenames under `docs/adr/`, such as `0001-use-event-boundary.md`.
- Create these files and directories lazily: only after a term or decision is actually resolved.

Read [the grilling loop](../grilling/SKILL.md), [the domain-modeling rules](../domain-modeling/SKILL.md), [the glossary format](../domain-modeling/references/CONTEXT-FORMAT.md), and [the ADR format](../domain-modeling/references/ADR-FORMAT.md) before starting a session.

## Handoff

When the user confirms the shared understanding, hand the result to the next appropriate workflow. Prefer a written specification before ticket breakdown or implementation. If the effort is too large to hold in one session, stop and recommend splitting the unknowns into separately researched decisions rather than silently guessing.
