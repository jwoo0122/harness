---
description: Run a VER-focused acceptance-criteria verification pass
argument-hint: "<criteria-file-or-requirement>"
---
Run a VER-focused acceptance-criteria check for: $ARGUMENTS

Requirements:
- Do not write production code.
- Interpret the criteria, identify the ACs, required evidence, and likely verification commands.
- If the `@jwoo0122/harness` extension is active, prefer `harness_subagents` for any isolated PLN / VER review pass.
- For every AC, report: status, missing evidence, recommended verification method, regression risk.
- If something could be registered later with `harness_verify_register`, say exactly how.
