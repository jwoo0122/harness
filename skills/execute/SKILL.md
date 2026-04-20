---
name: execute
description: "Agile execution protocol with 3-role mutual verification (Planner / Implementer / Verifier). No role evaluates its own output. Micro-increment implementation with regression suppression. Triggers: 'execute', 'implement', 'build it', 'start iteration', 'ship it'. Works in any harness; gains state tracking in pi."
argument-hint: "[/.target/criteria/<criteria-file>.md]"
---

# Execute — Agile Execution Harness

You are now running the **convergent execute protocol** with a **three-role agent system**.

Arguments: $ARGUMENTS — path to a temporary gitignored criteria / PRD file under `/.target/criteria/`. Blank or non-canonical inputs should be treated as blocked.

> **Harness note:** This skill is project-agnostic. When running inside pi with the `@jwoo0122/harness` extension, AC status is persisted across sessions, the parent `/execute` agent becomes an orchestrator, and real isolated subagents should be invoked through the generic `harness_subagents` tool instead of role-playing every function in one context. PLN / IMP / VER are injected by this skill as role-specific subagent configurations. In the package extension, the canonical prompt bodies for those roles live in the flat `agents/` directory.

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

## Cumulative Verification Accumulation

The execute protocol maintains cumulative verification in **two layers**:

1. **Committed verification specs** in `.harness/verification-registry.json`
   - reusable definitions of **how** a requirement is verified
   - these are policy / catalog, not runtime truth
2. **Runtime immutable receipts** under the repo's **git common dir**
   - authoritative evidence of actual executions
   - these receipts determine the latest `pass` / `fail` / `missing` / `stale` status

### Why cumulative verification accumulation

| Without accumulated specs + receipts | With accumulated specs + receipts |
|---|---|
| VER invents verification ad-hoc per increment | reusable specs survive across increments |
| A repo file can claim a pass without executed proof | runtime status is derived from executed receipts |
| Regression checks are shallow ("test suite passes") | every accumulated check has durable execution evidence |
| Verification knowledge drifts | the committed spec catalog stays stable while receipts keep growing |

### What VER registers

VER registers a reusable **Verification Spec** describing:
- **check_id** — stable identifier for the reusable check
- **bindings** — requirement / AC bindings satisfied by the check
- **strategy** — how it's verified (`automated-test`, `type-check`, `build-output`, `lint-rule`, `manual-check`, etc.)
- **mode** — `automated` or `manual`
- **blocking** — whether the check is gating or advisory
- **command** — exact command to execute when automated
- **files** — relevant files / inputs
- **description** — what the check proves

### What VER executes

VER then runs automated specs to produce immutable **Verification Receipts** containing executed evidence such as:
- spec/check identity
- commit identity
- worktree/session context when available
- exact command executed
- timestamps
- exit status
- stdout / stderr references or digests

### When to register vs run

- `harness_verify_register` defines or updates the reusable spec.
- `harness_verify_run` executes automated specs and appends receipts.
- `harness_verify_list` shows the latest **receipt-derived** status.

A registered spec without executed receipts is **not yet proven**.
A passing AC without a reusable verification spec is still a **gap** — PLN should challenge VER.

### Verification lifecycle

```
Iteration 1: VER defines 2 reusable specs
             → committed spec surface has 2 specs
             → VER executes them → runtime receipt ledger has 2 receipts

Iteration 2: VER defines 1 more spec and re-runs prior blocking specs
             → committed spec surface has 3 specs
             → runtime receipt ledger appends fresh receipts
             → latest status is derived from the freshest applicable receipts

...the verification method catalog stays reusable, and the evidence ledger keeps growing.
```

### Committed spec file format

`.harness/verification-registry.json`:
```json
{
  "$schema": "harness-verification-registry-v2",
  "specs": {
    "login-email": {
      "check_id": "login-email",
      "bindings": [
        {
          "binding_id": "AC-1.1",
          "requirement": "User can log in with email",
          "source": "iteration-4-criteria.md",
          "registeredAt": "INC-1"
        }
      ],
      "verification": {
        "strategy": "automated-test",
        "mode": "automated",
        "blocking": true,
        "command": "npm test -- --grep 'login with email'",
        "files": ["tests/auth/login.test.ts"],
        "description": "Integration test verifying email login returns valid session"
      }
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
  - Verification Specs: [N] specs loaded from .harness/verification-registry.json
  - Verification Receipts: [N] receipts observed in the git-common-dir runtime store
  - If blocking specs already exist, VER inspects receipt-derived status and re-runs stale/missing/needed specs as part of baseline

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

After marking an AC as ✅ PASS, VER **MUST** ensure there is a reusable verification spec and executed evidence for it.

**If running inside pi with the harness extension**, VER first calls `harness_verify_register` to define or update the reusable verification spec:
```
harness_verify_register({
  ac_id: "AC-1.1",
  check_id: "login-email",
  requirement: "User can log in with email",
  strategy: "automated-test",
  mode: "automated",
  blocking: true,
  command: "npm test -- --grep 'login with email'",
  files: ["tests/auth/login.test.ts"],
  description: "Integration test verifying email login returns valid session",
  increment: "INC-1"
})
```

Then VER executes the spec to produce authoritative receipts:
```
harness_verify_run({ check_ids: ["login-email"] })
```

Then VER inspects the latest receipt-derived status:
```
harness_verify_list({ filter: "login-email" })
```

**If running without the extension**, update the committed spec file and run the corresponding verification command yourself; do not treat a repo-file summary as authoritative pass/fail truth.

A passing AC without a reusable verification spec is a **gap**. PLN should challenge: "How will we catch regressions for this AC in future increments?"

#### 2e. VER regression check (receipt-driven)

After every increment, VER consults the committed spec catalog and the accumulated receipt ledger — not just a general test suite pass.

**Step 1**: Call `harness_verify_list` to inspect the latest receipt-derived status for the accumulated specs.

**Step 2**: Call `harness_verify_run` for any blocking specs that are missing, stale, or otherwise need fresh execution evidence.

**Step 3**: Report per-spec results:

```markdown
✅ VER: Regression scan after INC-[N]
Specs shown: [total]

| Check ID     | Status   | Command                           | Evidence                    |
|--------------|----------|-----------------------------------|-----------------------------|
| login-email  | ✅ PASS  | npm test -- --grep 'login'        | receipt rcp-001 @ HEAD      |
| types-main   | ✅ PASS  | tsc --noEmit                      | receipt rcp-002 @ HEAD      |
| user-profile | ❌ FAIL  | npm test -- --grep 'user profile' | receipt rcp-003 exit 1      |
| api-smoke    | ⌛ STALE | npm run smoke:api                 | latest receipt on old spec  |

🚨 REGRESSION / STALE BLOCKER in user-profile or api-smoke → STOP
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

Write to `/.target/execute/<name>-<YYYYMMDD-HHMMSS>.md`:

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
- ❌ VER passing an AC without registering a reusable verification spec
- ❌ Treating spec registration as proof of pass without executed receipts
- ❌ Running regression checks without consulting receipt-derived status via the verification catalog + receipt ledger
- ❌ Registering `manual-check` as blocking when an automated verification is feasible

## Transition Rules

- Criteria **ambiguous** → PLN pauses, asks user
- **Better approach** discovered → note in log, suggest /explore after current increment
- **All ACs pass** → VER signs off, PLN writes report
