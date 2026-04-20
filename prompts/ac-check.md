---
description: Run a VER-focused acceptance-criteria verification pass
argument-hint: "<criteria-file-or-requirement>"
---
Run a VER-focused acceptance-criteria check for: $ARGUMENTS

Requirements:
- Do not write production code.
- Interpret the criteria, identify the ACs, required evidence, and likely verification commands.
- If the `@jwoo0122/harness` extension is active, prefer `harness_subagents` for any isolated PLN / VER review pass.
- For every AC, report: status, missing evidence, recommended verification spec, and regression risk.
- If something should become a reusable verification spec later, say exactly how to register it with `harness_verify_register`.
- If the check would need executed evidence, say how it should be run with `harness_verify_run` and what `harness_verify_list` should show afterward.
