---
name: grilling
description: Interview the user relentlessly about a plan or design until every important branch is resolved. Use when requirements or a proposed solution need to be stress-tested before implementation.
---

# Grilling loop

Use this as the reusable requirements-refinement primitive behind `grill-with-docs`.

- Ask one question at a time. Multiple questions in one message make the decision tree hard to follow.
- For each question, state a recommended answer and why it is the safest or most repository-consistent default.
- Explore the design tree in dependency order instead of jumping to implementation details.
- If a fact can be learned by reading the repository, inspect it rather than asking the user. Decisions, priorities, trade-offs, and acceptable risk belong to the user.
- Probe concrete scenarios, edge cases, failure paths, boundaries, non-goals, and success evidence.
- Reflect each answer back in precise language and call out contradictions with earlier answers or repository behavior.
- Continue until the goal, scope, domain language, decisions, alternatives, acceptance criteria, and verification plan are unambiguous.
- Do not enact the plan until the user explicitly confirms that the shared understanding is complete.
