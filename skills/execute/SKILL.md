---
name: execute
description: "Agile execution mode with 3-role mutual verification (Planner / Implementer / Verifier). No role evaluates its own output. Micro-increment implementation with regression suppression. Triggers: 'execute', 'implement', 'build it', 'start iteration', 'ship it'. Works in any harness; gains state tracking in pi."
argument-hint: "[criteria-file or milestone name]"
---

# Execute — Agile Execution Harness

You are now in **convergent mode** with a **three-role agent system**.

Arguments: $ARGUMENTS — path to criteria/requirements file, or milestone name. If blank, look for the most recent criteria/requirements document in the project.

> **Harness note:** This skill is project-agnostic. When running inside pi with the `@jwoo0122/harness` extension, AC status is persisted across sessions and displayed in the footer widget.

---

## The Three Roles

Three specialized roles operate in a **continuous check loop**. Critical constraint: **no role evaluates its own output.**

### 📋 PLN — The Planner
- **Responsibility**: decompose requirements, design increment order, ensure acceptance criteria (AC) coverage, detect gaps
- **Authority**: decides WHAT to build and in WHAT ORDER
- **Cannot do**: write production code, mark ACs as passed
- **Challenges IMP**: "Your change touches 5 files — break it down." "This doesn't advance any AC."
- **Challenges VER**: "You're testing the wrong thing. The AC requires X, you checked Y."

### 🔨 IMP — The Implementer
- **Responsibility**: write code, make changes, fix build errors — nothing else
- **Authority**: decides HOW to implement (code-level decisions within PLN's plan)
- **Cannot do**: mark ACs as passed, skip gate checks, modify the increment plan
- **Challenges PLN**: "This order won't compile — B depends on A." "You missed a dependency."
- **Challenges VER**: "That test checks old behavior, not the AC."

### ✅ VER — The Verifier
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

PLN reviews:
  - Baseline failure → STOP. IMP fixes baseline first.
  - Baseline clean → proceed.
```

### Phase 1 — Increment Planning (PLN leads)

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

#### 2e. VER regression check

After every increment, VER re-checks ALL previously-passing ACs:

```markdown
✅ VER: Regression scan after INC-[N]
Previously passing: AC-1.1, AC-1.2
- AC-1.1: still ✅
- AC-1.2: ❌ REGRESSED — [cause]

🚨 REGRESSION → STOP
```

On regression:
1. VER reports with evidence
2. PLN decides: fix forward or revert
3. IMP executes
4. VER re-verifies everything
5. **No increment advances past a known regression.**

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

## Transition Rules

- Criteria **ambiguous** → PLN pauses, asks user
- **Better approach** discovered → note in log, suggest /explore after current increment
- **All ACs pass** → VER signs off, PLN writes report
