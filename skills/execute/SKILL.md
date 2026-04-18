---
name: execute
description: "Agile execution mode with 3-role mutual verification (Planner / Implementer / Verifier). No role evaluates its own output. Micro-increment implementation with regression suppression. Triggers: 'execute', 'implement', 'build it', 'start iteration', 'ship it'. Works in any harness; gains state tracking in pi."
argument-hint: "[criteria-file or milestone name]"
---

# Execute — Agile Execution Harness

You are now in **convergent mode** with a **three-role agent system**.

Arguments: $ARGUMENTS — path to criteria/requirements file, or milestone name. If blank, look for the most recent criteria/requirements document in the project.

> **Harness note:** This skill is project-agnostic. When running inside pi with the `@jwoo0122/harness` extension, AC status is persisted across sessions, the parent `/execute` agent becomes an orchestrator, and real isolated subagents should be invoked through the generic `harness_subagents` tool instead of role-playing every function in one context. PLN / IMP / VER are injected by this skill as role-specific subagent configurations.

---

## The Three Roles

Three specialized roles operate in a **continuous check loop**. Critical constraint: **no role evaluates its own output.**
These sub-agents are run in a row, and we can repeat the cycle if the verification fails.

### Planner
- **Responsibility**: decompose requirements, design increment order, ensure acceptance criteria (AC) coverage, detect gaps
- **Authority**: decides WHAT to build and in WHAT ORDER
- **Cannot do**: write production code, mark ACs as passed
- **Challenges IMP**: "Your change touches 5 files — break it down." "This doesn't advance any AC."
- **Challenges VER**: "You're testing the wrong thing. The AC requires X, you checked Y."

### Implementer
- **Responsibility**: write code, make changes, fix build errors — nothing else
- **Authority**: decides HOW to implement (code-level decisions within PLN's plan)
- **Cannot do**: mark ACs as passed, skip gate checks, modify the increment plan
- **Challenges PLN**: "This order won't compile — B depends on A." "You missed a dependency."
- **Challenges VER**: "That test checks old behavior, not the AC."

### Verifier
- **Responsibility**: run gates, verify ACs, detect regressions, challenge claims of completion
- **Authority**: **sole authority** to mark ACs as passed or failed
- **Cannot do**: write production code, modify the plan, hand-wave ("it probably works")
- **Challenges IMP**: "You say it works. Show me the output." "Gate 3 failed. Fix it."
- **Challenges PLN**: "Your plan missed AC-7.3." "AC-2.1 regressed after INC-3."

---

## Separation of Concerns (iron law)

```
  📋 PLN ──── defines scope ────► 🔨 IMP ──── code ────► ✅ VER
    ▲                                ▲                       │
    │         challenges             │       challenges      │
    ◄────────────────────────────────┤◄──────────────────────┘
    │                                │                       ▲
    │         challenges             │       challenges      │
    └────────────────────────────────►───────────────────────►┘

  No role marks its own output as correct.
  VER never writes code. IMP never says "AC passed". PLN never runs tests.
```

---

## Cumulative Verification Registry

Execute mode maintains a **Verification Registry** — a persistent catalog that records HOW each acceptance criterion is verified. The registry lives in the project at `.harness/verification-registry.json` and is committed alongside production code.

### Why cumulative verification

| Without registry | With registry |
|---|---|
| VER invents verification ad-hoc per increment | VER re-runs recorded, proven verification methods |
| Regression checks are shallow ("test suite passes") | Every past AC has a specific, reproducible verification |
| Verification knowledge is lost between iterations | Catalog grows with each iteration, carries forward |
| Quality floor is implicit and drifts | Quality floor is explicit and enforced |

### What VER records

For each AC that passes, VER registers:
- **strategy** — how it's verified (`automated-test`, `type-check`, `build-output`, `lint-rule`, `manual-check`, etc.)
- **command** — the exact command to re-run the verification (if applicable)
- **files** — test or verification files involved
- **description** — human-readable explanation of what's being checked

### When to register

VER registers a verification method immediately after marking an AC as passed (Phase 2d). If a passing AC has no registered verification method, this is a **gap** — PLN should challenge VER.

### When to consult

During regression checks (Phase 2e), VER pulls the full registry and re-runs every registered verification. A regression is not just "does the test suite pass" — it's "does every individual AC's specific verification still hold."

### Registry lifecycle

```
Iteration 1: VER verifies AC-1.1, AC-1.2
             → registers 2 methods → registry has 2 entries

Iteration 2: VER verifies AC-2.1, AC-2.2
             → registers 2 methods → registry has 4 entries
             → regression check re-runs all 4 registered verifications

Iteration 3: VER verifies AC-3.1
             → registers 1 method → registry has 5 entries
             → regression check re-runs all 5 registered verifications

...quality floor only rises, never falls.
```

### Registry file format

`.harness/verification-registry.json`:
```json
{
  "$schema": "harness-verification-registry-v1",
  "entries": {
    "AC-1.1": {
      "requirement": "User can log in with email",
      "source": "iteration-4-criteria.md",
      "verification": {
        "strategy": "automated-test",
        "command": "npm test -- --grep 'login with email'",
        "files": ["tests/auth/login.test.ts"],
        "description": "Integration test verifying email login returns valid session"
      },
      "registeredAt": "INC-1",
      "lastVerifiedAt": "INC-7",
      "lastResult": "pass"
    }
  }
}
```

---

## Procedure

### Phase 0 — Pre-flight (VER leads, PLN reviews)

**VER** runs the project's baseline checks and records results.
**PLN** reviews whether the baseline is healthy enough to start.

Adapt gate commands to your project's toolchain:
```
VER runs baseline:
  - Formatter check (e.g., cargo fmt / prettier / black)
  - Linter (e.g., clippy / eslint / pylint)
  - Test suite (e.g., cargo test / jest / pytest)
  - Full build (e.g., cargo build / npm run build)

VER records:
  - Format: pass/fail
  - Lint warning count: [N]
  - Tests: [passed]/[total]
  - Build: pass/fail
  - Verification Registry: [N] entries loaded from .harness/verification-registry.json
  - If registry exists, VER re-runs ALL registered verifications as part of baseline

PLN reviews:
  - Baseline failure → STOP. IMP fixes baseline first.
  - Baseline clean → proceed.
```

### Phase 1 — Increment Planning (PLN leads)

In pi with the harness extension, prefer invoking `harness_subagents` in sequential mode with PLN first (then IMP / VER review subagents) instead of simulating all three roles in one response.

**PLN** reads the criteria, decomposes into micro-increments.

```markdown
📋 PLN: Increment plan

## Criteria source: [path or name]
## Total ACs: [count]

- [ ] INC-1: [description]
  - Files: [≤ 3]
  - Enables: AC-x.y, AC-x.z
  - Depends on: (none)
- [ ] INC-2: [description]
  - Files: [≤ 3]
  - Enables: AC-x.y
  - Depends on: INC-1
```

**IMP** reviews for buildability:
```markdown
🔨 IMP reviews: "INC-4 also needs Cargo.toml change" → PLN fixes
```

**VER** reviews for AC coverage:
```markdown
✅ VER reviews: "AC-3.5 not covered by any increment" → PLN adds
```

PLN revises until both approve.

### Phase 2 — Execute Cycle (repeat per increment)

#### 2a. IMP implements

In pi with the harness extension, prefer invoking `harness_subagents` with an IMP-configured subagent for code changes, followed by a VER-configured subagent for gate checks and verification.

```markdown
🔨 IMP: INC-[N]
- Changed: [file1] — [what and why]
- Changed: [file2] — [what and why]
- Known concern: [anything unsure]
```

**IMP may NOT say**: "AC-x.y is done." That's VER's job.

#### 2b. VER runs gates

**VER** runs all gates. No exceptions.

```markdown
✅ VER: Gates for INC-[N]
  Gate 1 — Build:    [pass/fail]
  Gate 2 — Lint:     [N] warnings (baseline: [M])
  Gate 3 — Format:   [pass/fail]
  Gate 4 — Tests:    [pass/fail]
  Gate 5 — Platform: [pass/fail] (if applicable)
  Verdict: [ALL PASS / BLOCKED on Gate N]
```

Gate fail → VER sends back to IMP with exact error. IMP fixes. VER re-runs.

#### 2c. VER runs verification

Based on what changed, invoke project-specific verification:
- Unit-level changes → test suite sufficient
- UI/renderer changes → visual/accessibility verification
- API changes → integration tests

VER should design verifications that are **registrable** — specific, reproducible commands that can be re-run in future regression checks. Prefer automated tests over manual inspection. "I eyeballed it" is not a registrable verification.

#### 2d. VER checks ACs

**VER** — and ONLY VER — marks AC status:

```markdown
✅ VER: AC checkpoint after INC-[N]
| AC     | Status  | Evidence               |
|--------|---------|------------------------|
| AC-1.1 | ✅ PASS | [specific proof]       |
| AC-2.1 | ⏳      | scheduled for INC-3    |
```

**PLN** cross-checks VER's evaluation:
```markdown
📋 PLN reviews: "AC-1.3 — VER checked names but not types" → VER re-verifies
```

After marking an AC as ✅ PASS, VER **MUST** register the verification method:

**If running inside pi with the harness extension**, VER calls `harness_verify_register`:
```
harness_verify_register({
  ac_id: "AC-1.1",
  requirement: "User can log in with email",
  strategy: "automated-test",
  command: "npm test -- --grep 'login with email'",
  files: ["tests/auth/login.test.ts"],
  description: "Integration test verifying email login returns valid session",
  increment: "INC-1"
})
```

**If running without the extension**, append the entry to `.harness/verification-registry.json`.

A passing AC without a registered verification method is a **gap**. PLN should challenge: "How will we catch regressions for this AC in future increments?"

#### 2e. VER regression check (registry-driven)

After every increment, VER consults the **Verification Registry** and re-runs ALL registered verifications — not just a general test suite pass.

**Step 1**: Call `harness_verify_list` (or read `.harness/verification-registry.json`) to get all registered methods.

**Step 2**: Re-run every registered verification command.

**Step 3**: Report per-entry results:

```markdown
✅ VER: Regression scan after INC-[N]
Registry entries: [total]

| AC     | Strategy        | Command                           | Result        |
|--------|----------------|-----------------------------------|---------------|
| AC-1.1 | automated-test | npm test -- --grep 'login'        | ✅ still pass  |
| AC-1.2 | type-check     | tsc --noEmit                      | ✅ still pass  |
| AC-2.1 | automated-test | npm test -- --grep 'user profile' | ❌ REGRESSED   |

🚨 REGRESSION in AC-2.1 → STOP
```

On regression:
1. VER reports with the **specific failing verification command and its output**
2. PLN decides: fix forward or revert
3. IMP executes the fix
4. VER re-runs the **full registry** — not just the failed entry
5. **No increment advances past a known regression.**

#### 2f. Commit & push verified increment (VER triggers)

After ALL gates pass AND regression scan is clean, VER commits the increment:

```markdown
✅ VER: Committing INC-[N]
  Commit message: "INC-[N]: [brief description of changes]"
  Push: [success / fail — reason]
```

**If running inside pi with the harness extension**, VER calls the `harness_commit` tool:
```
harness_commit({ increment: "INC-1", message: "Add user model and migration" })
```

**If running without the extension** (Claude Code, etc.), VER runs git commands directly:
```bash
git add -A
git commit -m "INC-[N]: [description]"
git push
```

**Iron rules:**
- Never commit with failing gates or known regressions.
- Never commit before VER's regression scan completes.
- If push fails, VER reports the error. PLN decides how to proceed (retry, rebase, etc.).
- Commit messages always start with the increment ID for traceability.

### Phase 3 — Completion Report (PLN writes, VER audits)

Write to `target/execute/<name>-<YYYYMMDD-HHMMSS>.md`:

```markdown
# Execution Report: [milestone]
> Generated: [timestamp]
> Roles: 📋 PLN | 🔨 IMP | ✅ VER

## Pre-flight baseline
## Increment log (per INC: gates, verification, ACs, challenges)
## Final AC matrix (✅ VER is sole authority)
| AC | Status | Evidence | Verified by |
## VER's audit of this report
## Regressions detected & resolved
## Remaining work
## Recommendations
```

**VER signs off:**
```markdown
✅ VER: Report audit complete.
- Total ACs: [N], Passed: [N], Failed: [N]
- Report accuracy: [confirmed / corrections needed]
```

---

## Failure Protocols

### Build failure
VER detects → IMP fixes → VER re-runs gates

### Test failure
VER reports → PLN decides (real bug vs outdated test) → IMP fixes → VER re-verifies

### Regression
VER detects → ALL STOP → PLN decides fix/revert → IMP acts → VER clears

### Role disagreement
Criteria text is the tiebreaker. Ambiguous criteria → STOP, ask user.

---

## Anti-patterns

- ❌ IMP marking their own ACs as passed
- ❌ VER writing production code
- ❌ PLN skipping VER's audit
- ❌ Any role saying "it probably works" without evidence
- ❌ Implementing multiple increments before VER verifies
- ❌ Proceeding past a VER STOP signal
- ❌ Roles collapsing ("I'll just quickly check it myself")
- ❌ Creative exploration beyond the criteria (→ use /explore)
- ❌ VER passing an AC without registering a verification method
- ❌ Running regression checks without consulting the Verification Registry
- ❌ Registering "manual-check" when an automated verification is feasible

## Transition Rules

- Criteria **ambiguous** → PLN pauses, asks user
- **Better approach** discovered → note in log, suggest /explore after current increment
- **All ACs pass** → VER signs off, PLN writes report
