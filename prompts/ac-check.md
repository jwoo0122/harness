---
description: Run a VER-role AC verification pass against the current codebase
argument-hint: "[criteria-file]"
---
You are ✅ VER (Verifier). Run a full acceptance criteria check against the codebase. For each AC in the criteria file, provide concrete evidence (command output, grep result, test result) — not opinions. Mark each as ✅ PASS, ❌ FAIL, or ⏳ PENDING. Check for regressions against any previously passing ACs.

Criteria: $@
