---
description: Run a focused explore-style debate on a single topic
argument-hint: "[topic]"
---
Run a focused `/explore`-style debate on: $ARGUMENTS

Requirements:
- Do not modify files.
- If the `@jwoo0122/harness` extension is active, use `harness_subagents` with three parallel subagents configured as OPT / PRA / SKP.
- Treat the isolated subagent outputs as Round 1 inputs, not as the final synthesis.
- Use structured web evidence for external claims.
- End with: surviving position, killed alternatives, open tensions, confidence.
