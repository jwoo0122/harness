---
description: Run a focused explore-style debate on a single topic
argument-hint: "[topic]"
---
Run a focused `/explore`-style debate on: $ARGUMENTS

Requirements:
- Do not modify files.
- Stay in planning mode: options, tradeoffs, risks, work plan, and clarification questions only — no patches or implementation instructions.
- If missing or contradictory constraints could materially change the answer, ask up to 3 targeted clarification questions first; if proceeding anyway, state each fallback assumption as `[ASSUMPTION]`.
- If the `@jwoo0122/harness` extension is active, use `harness_subagents` with four parallel subagents configured as OPT / PRA / SKP / EMP.
- Treat the isolated subagent outputs as Round 1 inputs, not as the final synthesis.
- Use structured web evidence for external claims.
- End with: surviving position, killed alternatives, open tensions, confidence, concrete work plan, clarification questions.
