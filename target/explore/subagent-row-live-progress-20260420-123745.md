# Exploration: Generic live subagent rows with persistent spinner/activity

## Context snapshot
This repo is a TypeScript pi package that implements `/explore` and `/execute` as protocols on top of a generic isolated-subagent runtime; the relevant runtime and UI surfaces live in `extensions/subagents.ts` and `extensions/index.ts`, with package-level behavior described in `README.md`. The current design explicitly removed the separate live subagent widget and already renders one collapsed line per subagent inside the tool call row, while expanded mode shows recent stream history and output previews (`README.md`, `CHANGELOG.md`, `extensions/index.ts`). The real gap for the requested UX is not row existence but data richness and motion: `extensions/subagents.ts` captures assistant text and tool start/end events, but currently drops `tool_execution_update.partialResult`, `tool_execution_end.result`, and `thinking_*` events that would let the row show true “thinking” state plus live/final tool previews; pi’s renderer docs indicate row-local rerender via `invalidate()` is available if animation is added later (`extensions/subagents.ts`, `/Users/jinwoo/.local/share/mise/installs/node/25.6.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/json.md`, `/Users/jinwoo/.local/share/mise/installs/node/25.6.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/rpc.md`, `/Users/jinwoo/.local/share/mise/installs/node/25.6.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`).

## Debate transcript

### Round 1 — Opening positions

**🔴 OPT:** Imagine if every `harness_subagents`-driven tool call became a stable mini-dashboard: a header plus one persistent row per subagent that moves from `queued → starting → thinking → tool/command → done/failed` without ever leaving the tool row. This unlocks a single generic UX for `harness_subagents`, `harness_explore_subagents`, and `harness_execute_subagents`, and the upside is massive because the current completed-row layout can become the live layout instead of a second surface. OPT initially pushed for a richer “dashboard-like” feel, but still inside the tool row.

**🟡 PRA:** In practice, do not add a new widget. The real cost is keeping generic/explore/execute in sync, so the best shipping path is to keep everything inside the existing tool row, unify the row model once, and extend the runtime only where the current state is insufficient.

**🟢 SKP:** But what about the missing data? The failure mode is polishing text while the runtime still cannot show actual live tool output or real thinking state. SKP argues the renderer is already close enough; the risky part is pretending the snapshot model already contains the information the user asked for.

**🔵 EMP:** What evidence would change our mind? If a minimal extension of the current row path can satisfy one scripted smoke run showing `queued`, `thinking`, `tool running`, `done`, and `failed`, then a separate widget is unnecessary. EMP frames the decision as a proof problem: keep the current shell unless evidence shows the shell itself is the blocker.

### Round 2 — Cross-examination (evidence required)

**🟢 SKP → 🔴 OPT:** OPT’s “dashboard” instinct collides with the package’s own stated architecture: `README.md` says there is “no separate live subagent widget” and that live progress stays inside the tool call row; `CHANGELOG.md` records the same simplification. External prior art also does not require a second surface: Listr2 keeps task output attached to each task row and supports `outputBar` plus `persistentOutput` to retain output after completion (`https://listr2.kilic.dev/task/output.html`), while PTerm’s site and spinner example show multiple simultaneous live lines resolving into success/failure in place rather than moving into a separate pane (`https://pterm.sh/`, `https://github.com/pterm/pterm/blob/master/_examples/spinner/README.md`). **Claim struck:** “A separate live dashboard is needed.”

**🔵 EMP → 🟡 PRA:** PRA is right about reusing the existing row shell, but wrong if that becomes “mostly done already.” Local evidence shows the current snapshot/runtime is still incomplete for the requested UX: `extensions/subagents.ts` defines recent stream items only as `assistant_text | tool_execution_start | tool_execution_end` and currently ignores `tool_execution_update.partialResult`, `tool_execution_end.result`, and `thinking_*` assistant events. Pi’s JSON/RPC docs explicitly expose all three missing signals (`/Users/jinwoo/.local/share/mise/installs/node/25.6.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/json.md`, `/Users/jinwoo/.local/share/mise/installs/node/25.6.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/rpc.md`). **Claim struck:** “Existing snapshots already satisfy live tool/result preview requirements.”

**🟡 PRA → 🟢 SKP:** SKP is right about the missing runtime data, but wrong if that implies a rewrite. `extensions/index.ts` already has the correct skeleton: `renderCollapsedSubagentLine(...)` is used by generic/explore/execute collapsed renderers, and `StableTextLineList` preserves in-place row identity while snapshots morph into results. Listr2’s persistent task/output model supports the same basic pattern—stable task rows with retained output rather than delete-and-reinsert output somewhere else (`https://listr2.kilic.dev/task/output.html`). So the cheapest credible plan is to enrich the existing model, not replace it.

**🔴 OPT → 🟢 SKP + 🔵 EMP:** Once the runtime gap is fixed, a real spinner is not obviously blocked. Pi’s renderer docs say `renderCall`/`renderResult` get `lastComponent` plus `invalidate()` for row-local rerender, and the package already has a simple timer-based animation example in `examples/extensions/titlebar-spinner.ts` (local pi examples). PTerm’s multiple live spinners prove the UX pattern is familiar (`https://github.com/pterm/pterm/blob/master/_examples/spinner/README.md`). **But** the claim that continuous animation materially improves comprehension beyond phase text is **[UNVERIFIED]**; that did not survive as a must-have architectural premise.

### Round 3 — Final statements + unsupported claim purge

**🔴 OPT (revised):** The ambitious version that survived is not a second widget but a “flight deck inside the existing tool row”: stable per-subagent rows, richer live tool/result previews, and optionally a subtle spinner once the data model is trustworthy. OPT withdraws the separate-dashboard idea.

**🟡 PRA (revised):** Ship one shared row model across generic/explore/execute; widen runtime capture to include thinking and tool preview signals; keep the current row shape so live rows morph into completed rows. Treat animation as a second-step polish unless it is nearly free.

**🟢 SKP (revised):** The runtime needs three safeguards before this is considered done: stable subagent identity not keyed only by `role`, explicit handling for live thinking/tool preview data, and a collapsed row that stays one-line-per-subagent rather than becoming a noisy transcript. SKP also flags current ambiguity if generic runs reuse the same `role` string, because `extensions/index.ts` currently looks up rows by `role` via `.find(...)`.

**🔵 EMP (revised):** The minimum discriminating experiment is clear: one smoke batch with three subagents must visibly cover `queued → starting → thinking → tool/command running → done/failed`, preserve rows after completion, and show a one-line live/final preview when a tool emits output. If that passes, a separate widget is disproven. Animation value beyond that remains **[UNVERIFIED]** until dogfooding confirms it.

### Unsupported claims struck from the record
- **Struck:** “A separate live subagent widget is required.”
- **Struck:** “Current snapshots already contain enough data for true live tool/result previews.”
- **Struck:** “Animation is impossible in the current tool-row renderer.”
- **Not adopted into synthesis:** “A continuously spinning icon is necessary for usability.” **[UNVERIFIED]**

## Synthesis table
| Decision | Surviving position | Killed alternatives | Confidence | Needs user input? |
|----------|-------------------|---------------------|------------|-------------------|
| Live UI surface | Keep live progress inside the existing `harness_subagents*` tool row; do not add a separate widget/banner. | Separate dashboard/widget was killed by repo intent in `README.md`/`CHANGELOG.md` and by prior art that keeps task progress in-place. | High | No |
| Row model | Make the current per-subagent collapsed row the canonical live+completed row for generic/explore/execute, with stable identity and in-place morphing. | Separate live and completed layouts were killed as duplicate surfaces with drift risk. | High | No |
| Runtime data | Extend the runtime to capture real thinking/tool-preview evidence: `thinking_*`, `tool_execution_update.partialResult`, and truncated `tool_execution_end.result`; avoid matching rows only by `role`. | Pure visual-only change was killed because the current data model cannot yet satisfy the user’s requested live preview behavior. | High | No |
| Spinner scope | Add a real animated spinner only if it can be layered cleanly on top of the enriched row model; otherwise ship truthful phase text first and treat animation as polish. | Making spinner-first the architectural driver was killed; claiming animation is mandatory remained [UNVERIFIED]. | Medium | Maybe |

**Synthesis:**
- **Position:** Reuse the existing tool-row surface and existing per-subagent rows, but upgrade them into a shared generic live/completed row model backed by richer runtime events. The winning design is a single stable row per subagent that appears immediately, stays ordered, shows truthful state transitions, surfaces the active tool/command and one-line preview when available, and remains in place after completion.
- **Killed by debate:** A separate live widget/dashboard was killed by both local architectural intent (`README.md`, `CHANGELOG.md`) and external CLI prior art (`https://listr2.kilic.dev/task/output.html`, `https://github.com/pterm/pterm/blob/master/_examples/spinner/README.md`). A pure renderer-only tweak was killed because the runtime currently discards the exact events required for the requested live previews.
- **Open tension:** Whether a continuously animated spinner should be part of v1 or stage-2 polish remains the only meaningful tension. The architecture supports trying it, but the user-value over event-driven phase text is still **[UNVERIFIED]**.
- **Confidence:** High on the architecture; medium on making continuous animation a v1 requirement.

## Ambitious vision (annotated)

### 🔴 OPT — Vision
Turn each `harness_subagents*` tool result into a compact “mission board” that feels alive while still staying text-first:
- summary line for the batch
- one persistent row per subagent
- row state flows smoothly from waiting to active reasoning to tool execution to outcome
- when a subagent uses a tool, the row shows the tool/command plus a short live or final preview
- expanded mode remains the deep transcript, while collapsed mode becomes the trustworthy executive view

### 🟡 PRA — Effort / milestone annotations
- **Milestone A (small):** unify the collapsed row view-model across generic/explore/execute and keep row identity stable.
- **Milestone B (medium):** widen runtime capture for `thinking_*`, `tool_execution_update`, and final tool previews.
- **Milestone C (small-medium):** refine collapsed-row copy so completion uses the same shape as live rows.
- **Milestone D (optional small/medium):** add actual animated spinner behavior if cleanup/rerender semantics are comfortable in dogfood.

### 🟢 SKP — Risk annotations
- Risk of ambiguous row identity if generic subagents reuse the same `role` string.
- Risk of noisy collapsed UI if live previews become mini-transcripts instead of one-line summaries.
- Risk of lossy display when multiple tools are in flight for one subagent if the UI assumes a single `currentToolName` forever.
- Risk of timer leaks or flicker if animation is added before row-local lifecycle handling is thought through.

### 🔵 EMP — Proof thresholds / experiments
Before scaling the bet, prove these in one smoke scenario:
1. A batch with declared subagents shows all rows immediately, before any child completes.
2. A subagent with no tools visibly transitions through waiting/starting/thinking/done.
3. A subagent with a long-running tool shows active tool/command plus a one-line live preview from `partialResult`.
4. A failing subagent keeps its row and shows `failed` plus one-line stderr/result preview.
5. A generic run with duplicate `role` labels does not collapse two rows into one visual identity.
6. If animation is attempted, stopping conditions are deterministic and no orphan rerenders remain after completion.

## Concrete work plan (planning-only)
| Phase | Goal | Dependencies | Risks | Exit criteria |
|-------|------|--------------|-------|---------------|
| 0. Acceptance framing | Turn the synthesis into explicit UX acceptance criteria covering surface, state transitions, preview truncation, and completion persistence. | User sign-off on this exploration. | Criteria too vague will cause debate to reopen during execute. | A criteria document exists and names the intended live/completed row behavior. |
| 1. Runtime signal widening | Expand subagent runtime state so the row can represent real thinking and tool previews, not just assistant text plus tool start/end. | Agreement to keep the feature in the existing tool row. | Overcapturing too much stream data can make collapsed rows noisy. | Shared runtime model can represent thinking, live tool preview, final tool preview, and stable subagent identity. |
| 2. Shared row-model unification | Make one generic collapsed-row/view-model path power generic, explore, and execute tool renderers. | Phase 1 data model. | Duplicate-role collisions or renderer drift between modes. | All three tool families render the same live/completed row semantics with only header/totals differences. |
| 3. Completion-shape alignment | Ensure the live row and completed row are the same conceptual layout so completion feels like a morph, not a removal. | Phase 2. | Copy churn or inconsistent failure labeling. | Live and completed rows share the same label/phase/activity structure. |
| 4. Optional animation polish | Decide whether to add a true spinner/pulse for active rows or keep static phase text. | Phase 3 and dogfood confidence. | Timer cleanup, flicker, or marginal UX gain. | Either (a) spinner proves stable and helpful in dogfood, or (b) static phase text is intentionally retained and documented. |
| 5. Verification / dogfood gate | Validate the UX with targeted smoke scenarios and at least one dogfood session using real subagent batches. | Phases 1–4. | Passing synthetic tests but poor real readability. | The agreed smoke cases pass and the row behavior is acceptable in real use. |

## Clarification questions
| QID | Question | Why it matters | What changes depending on the answer? | Priority |
|-----|----------|----------------|---------------------------------------|----------|
| Q1 | Should this apply only to `/explore` or to all `harness_subagents` runs? **Answered:** all subagent runs. | Determines whether the design can be narrow/special-case or must be generic. | The answer locked the recommendation toward a shared renderer/runtime path, not an explore-only patch. | High |
| Q2 | Should rows show only a spinner, or full state changes plus active tool/command info? **Answered:** show state changes and, if possible, tool/command + short result preview. | Determines whether a renderer-only tweak is enough. | The answer forced runtime-data widening into the synthesis. | High |
| Q3 | Should rows disappear after completion or remain as result rows? **Answered:** remain as rows, ideally the same layout as during execution. | Determines whether the feature is ephemeral status or persistent task history. | The answer locked in the “single live/completed row model” recommendation. | High |

## Assumptions
- [ASSUMPTION] This repo currently has no `CLAUDE.md` or `.iteration-*-criteria.md`, so the exploration is anchored to the current README/docs/code rather than an already-approved iteration contract.
- [ASSUMPTION] The target is the interactive TUI experience; print/JSON output can degrade to static textual state because animated row behavior is only meaningful in the TUI.
- [ASSUMPTION] Generic `harness_subagents` usage may eventually include repeated `role` names, so stable internal subagent identity is safer than row lookup by role label alone.

## External sources
- Listr2 task output + persistent output: https://listr2.kilic.dev/task/output.html
- PTerm component catalog (includes spinner and multiple-live-printers): https://pterm.sh/
- PTerm spinner + multiple simultaneous spinner example: https://github.com/pterm/pterm/blob/master/_examples/spinner/README.md

## Local evidence base
- `README.md`
- `CHANGELOG.md`
- `extensions/index.ts`
- `extensions/subagents.ts`
- `/Users/jinwoo/.local/share/mise/installs/node/25.6.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`
- `/Users/jinwoo/.local/share/mise/installs/node/25.6.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/json.md`
- `/Users/jinwoo/.local/share/mise/installs/node/25.6.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/rpc.md`
- `/Users/jinwoo/.local/share/mise/installs/node/25.6.0/lib/node_modules/@mariozechner/pi-coding-agent/docs/tui.md`

## Ready for /execute
- **No**
- **Blockers:** user sign-off on the synthesis, plus a concrete criteria file for the intended UX/verification contract.