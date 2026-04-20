# Execution Report: persistent live subagent rows with spinner/activity
> Generated: 2026-04-20 14:49:44
> Criteria: `.iteration-1-criteria.md`
> Roles: 📋 PLN | 🔨 IMP | ✅ VER

## Pre-flight baseline

### Initial baseline
- `npm run validate:extensions:prepare` — **FAIL**
  - stale `tests/extensions/prepare-bash-policy.mjs` still expected pre-extraction bash-policy seams inside `extensions/index.ts`
- `npm run validate:extensions` — **PASS**

### Baseline repair result
- `npm run validate:extensions:prepare` — **PASS**
- `npm run validate:extensions` — **PASS**

## Increment log

### INC-0 — Repair stale prepare validator
**Files**
- `tests/extensions/prepare-bash-policy.mjs`

**What changed**
- Updated the prepare validator to reflect the extracted bash-policy module architecture:
  - `extensions/index.ts` must import `./bash-policy.js`
  - seam markers must live in `extensions/bash-policy.ts`
  - stale inline markers must no longer be present in `extensions/index.ts`

**Verification**
- `node tests/extensions/prepare-bash-policy.mjs` — PASS
- `npm run validate:extensions:prepare` — PASS

**Outcome**
- Pre-flight baseline unblocked.

---

### INC-1 — Persistent queued rows + stable per-instance identity
**Files**
- `extensions/subagents.ts`
- `extensions/index.ts`
- `tests/extensions/validate-subagent-rendering.mjs`

**What changed**
- Added queued snapshot seeding at batch declaration time so rows exist before child completion.
- Added stable per-subagent identity (`instanceId`, `declaredIndex`) to specs / snapshots / results.
- Stopped generic `harness_subagents` collapsed / expanded / summary lookup from matching rows by `role` alone.

**Verification**
- `node --experimental-strip-types --check extensions/subagents.ts` — PASS
- `node --experimental-strip-types --check extensions/index.ts` — PASS
- `node --experimental-strip-types tests/extensions/validate-subagent-rendering.mjs` — PASS
- `npm run validate:extensions` — PASS

**Outcome**
- AC-1 groundwork established.
- Sequential batches can now preserve not-yet-started rows as queued.

---

### INC-2 / INC-3 — Lifecycle/activity enrichment + active row spinner/pulse
**Files**
- `extensions/subagents.ts`
- `extensions/index.ts`
- `tests/extensions/validate-subagent-rendering.mjs`
- `tests/extensions/validate-explore-gate.mjs`

**What changed**
- Captured `tool_execution_update` and final tool-result previews in `extensions/subagents.ts`.
- Kept one collapsed row shape for live and terminal states: `label · phase · activity`.
- Surfaced phases as `queued`, `starting`, `thinking`, `tool`, `done`, `failed`.
- Added active-row spinner/pulse infrastructure in `StableTextLineList` using interval-driven `invalidate()`.
- Stopped animation on expanded/fallback paths.
- Updated validators to account for the new per-subagent render calls and spinner/runtime markers.

**Verification**
- `node --experimental-strip-types --check extensions/subagents.ts` — PASS
- `node --experimental-strip-types --check extensions/index.ts` — PASS
- `node --experimental-strip-types tests/extensions/validate-subagent-rendering.mjs` — PASS
- `node --experimental-strip-types tests/extensions/validate-explore-gate.mjs` — PASS
- `npm run validate:extensions` — PASS

**Outcome**
- AC-2, AC-3, AC-4, AC-6 satisfied by static/structural verification.
- AC-5 implemented in code, pending interactive runtime proof.

---

### INC-4 — Live multiline partial transport + manual interactive verification
**Files**
- `extensions/index.ts`
- `extensions/subagents.ts`
- `tests/extensions/validate-subagent-rendering.mjs`

**What changed**
- Switched live subagent rendering to a hybrid path:
  - **running state** uses multiline partial `content.text` updates inside the existing tool row
  - **completed state** keeps the final `details`-based renderer
- Added a shared live partial formatter/emitter for generic, explore, and execute subagent tools.
- Removed temporary call-slot debug copy after the partial-content path proved sufficient.
- Tightened live tool preview matching with `currentToolCallId` and improved preview summarization toward recent output.
- Hardened live rendering against formatter exceptions / missing `stderr` fields so a live update cannot crash the tool row.

**Verification**
- `node --experimental-strip-types --check extensions/index.ts` — PASS
- `node --experimental-strip-types --check extensions/subagents.ts` — PASS
- `node --experimental-strip-types tests/extensions/validate-subagent-rendering.mjs` — PASS
- `npm run validate:extensions` — PASS
- **Manual interactive verification after `/reload`** — PASS
  - Ran live smoke batches through `harness_subagents` in interactive pi.
  - User-confirmed evidence: **"row도 spinner도 preview도 다 보여."**
  - Observed outcomes from the interactive run:
    - per-subagent rows visible during execution
    - spinner/pulse visibly advanced while rows were active
    - live tool/activity preview updated in-row
    - completed rows remained in place with terminal state

**Outcome**
- AC-5 verified manually in the real interactive TUI.
- The hybrid live/final rendering path is the shippable solution for current pi behavior.

## Final AC matrix (✅ VER is sole authority)
| AC | Status | Evidence | Verified by |
|----|--------|----------|-------------|
| AC-1 | ✅ PASS | queued snapshots seeded from declared specs; stable generic row identity via `instanceId`; `npm run validate:extensions` pass | ✅ VER |
| AC-2 | ✅ PASS | shared collapsed/live-completed row model retained across running and terminal states; `npm run validate:extensions` pass | ✅ VER |
| AC-3 | ✅ PASS | explicit `queued / starting / thinking / tool / done / failed` phase mapping in `extensions/index.ts`; `npm run validate:extensions` pass | ✅ VER |
| AC-4 | ✅ PASS | start/update/end tool previews captured and rendered live in-row; `npm run validate:extensions` pass + manual TUI confirmation | ✅ VER |
| AC-5 | ✅ PASS | manual interactive pi verification after `/reload`: user confirmed visible row/spinner/preview behavior during execution | ✅ VER |
| AC-6 | ✅ PASS | expanded views still show recent stream + output preview; `npm run validate:extensions` pass | ✅ VER |

## VER's audit of this report
✅ VER audit summary:
- The baseline validator defect was repaired and project validation is green again.
- Automated validation is green after the hybrid live partial-content implementation.
- Manual interactive verification closed AC-5; all iteration ACs are now satisfied.

## Regressions detected & resolved
- Resolved: stale `tests/extensions/prepare-bash-policy.mjs` caused pre-flight red baseline.
- Resolved: `tests/extensions/validate-explore-gate.mjs` expected the old collapsed-row call sites and was updated for the spinner-frame-aware/shared-row path.
- Resolved: live partial rendering originally depended too heavily on the custom partial result renderer path; switched to multiline partial content transport for running state.
- Resolved: live formatter crash risk from missing `stderr` during partial updates.
- No remaining automated validation failures after the current changes.

## Remaining work
- None required for this iteration.
- Optional follow-up: add a stronger automated interactive/TUI harness if the repo later gains a stable visual test seam.

## Recommendations
- Commit and push the iteration as complete.
- Optional future cleanup: factor any remaining duplicated live/final row formatting into a thinner shared formatter if the code needs a follow-up refactor.
