# Exploration: extensions refactor plan

## Project status summary
- `extensions/index.ts` is the main maintenance hotspot at 3543 lines and currently mixes helper domains, rendering helpers, persistence helpers, policy logic, web utilities, and the extension composition/wiring layer in one file (`extensions/index.ts`).
- `extensions/subagents.ts` (573 lines) and `extensions/compact-tool-renderers.ts` (238 lines) are already comparatively cohesive, which means the codebase already has at least two good seams we should preserve rather than re-open (`extensions/subagents.ts`, `extensions/compact-tool-renderers.ts`).
- The recent move to flat `agents/*.md` prompt bodies is a good signal that content/config concerns can live outside the main extension file, so the next refactor should turn `extensions/index.ts` into a composition root rather than a feature monolith (`agents/`, `extensions/index.ts`).

## Synthesis table
| Decision | Surviving position | Killed alternatives | Confidence | Needs user input? |
|----------|-------------------|---------------------|------------|-------------------|
| Target architecture | Make `extensions/index.ts` the control plane / composition root only; move leaf feature logic into dedicated modules | Splitting everything into many tiny files; keeping the monolith and only adding comments | High | No |
| First extraction targets | Extract leaf, low-coupling modules first: prompt loading, web helpers, registry I/O, bash policy, subagent support formatting/records/widgets | Starting with lifecycle hook splitting or rewriting `extensions/subagents.ts` first | High | No |
| What stays together initially | Keep session restore, mode switching, event hooks, tool gating, and system-prompt injection together until late because they are orchestration-coupled | Prematurely splitting runtime control flow into multiple files/factories | High | No |
| Verification strategy | Use characterization/snapshot parity around tool surface, gating, session restore, widget output, prompt loading, and registry round-trips before/while extracting | Refactoring by file count or aesthetics alone | High | No |
| End-state granularity | Prefer a small number of feature-owned modules over many micro-files; avoid generic `utils.ts`/`common.ts` dumping grounds | Over-normalizing into dozens of thin files or barrel-heavy hierarchies | Medium | No |

## Strongest surviving synthesis

**Position:**
Turn `extensions/index.ts` into a thin composition root and extract only clear leaf domains first. The winning boundary is not “one file per idea,” but “one file per stable ownership boundary.”

**Killed by debate:**
- **Full fragmentation first** — killed because it increases circular-dependency risk and makes context chasing worse.
- **Leave lifecycle in place and only add comments** — killed because it does not materially reduce context size or change locality.
- **Rewrite `extensions/subagents.ts` first** — killed because `extensions/subagents.ts` is already cohesive and reopening it early increases risk without removing the main pain point.

**Open tension:**
Whether subagent formatting/records/widgets should become one `subagent-support` module first or be split into 2–3 files later. The safe plan is to start as one support module and only split further if it remains too large.

**Confidence:** High

## Recommended target structure

```text
extensions/
├── index.ts                       # composition root only
├── compact-tool-renderers.ts      # keep as-is
├── subagents.ts                   # keep as-is for first pass
├── agent-prompts.ts               # loadAgentPrompt, agents/*.md cache/load
├── bash-policy.ts                 # classifyExplore/Execute/Child bash commands
├── registry.ts                    # verification registry read/write/list helpers
├── web-tools.ts                   # web search/fetch helpers + backend normalization
├── subagent-support.ts            # prompt/task builders, result formatting, records, widgets
├── state.ts                       # pure state factory / restore shaping helpers
└── tools/
    ├── web.ts                     # register harness_web_search/fetch
    ├── subagents.ts               # register harness_subagents + aliases
    ├── verify.ts                  # register harness_verify_register/list
    └── commit.ts                  # register harness_commit
```

## Ambitious vision (annotated)

### 🔴 OPT — If we go all the way
Make `extensions/index.ts` so small that a new contributor or future agent can understand the extension entrypoint in one screen. A web-search change should never require loading registry logic, and a registry change should never require reading live widget formatting.

### 🟡 PRA — Incremental milestones
1. **Milestone A — characterization first**
   - capture current behavior around tool names/schemas, gating, prompt injection, registry I/O, widget output
2. **Milestone B — extract pure leaves**
   - `agent-prompts.ts`
   - `bash-policy.ts`
   - `registry.ts`
3. **Milestone C — extract medium-risk leaves**
   - `web-tools.ts`
   - `subagent-support.ts`
4. **Milestone D — thin the root**
   - keep `index.ts` as orchestration-only wiring
5. **Milestone E — optional second split**
   - only if `subagent-support.ts` remains too large, split it by real ownership

### 🟢 SKP — Risk flags
- Do **not** split lifecycle orchestration too early; `session_start`, `tool_call`, `before_agent_start`, mode switching, and tool registration are tightly coupled inside `extensions/index.ts:2151-3543`.
- Do **not** introduce barrels or vague shared modules (`utils.ts`, `common.ts`, `shared.ts`) because they will become the next monolith.
- Do **not** move code if the extracted module must import back into `index.ts`; that indicates a fake boundary.

### 🔵 EMP — Proof thresholds
The refactor only counts as successful if:
- `extensions/index.ts` drops from 3543 LOC to roughly sub-1000 LOC without behavior drift
- no extracted module imports from `extensions/index.ts`
- representative tool registration snapshots remain identical
- mode/tool-gating matrix remains identical
- session restore behavior remains identical
- prompt loading from `agents/*.md` remains byte-for-byte equivalent for sampled files
- registry read/write/list round-trips remain identical
- widget/render snapshots remain identical

## Suggested next steps

### Phase 0 — characterize current behavior
Create regression coverage for:
- tool registration surface
- mode/tool gating
- system-prompt injection
- session restore
- prompt loading from `agents/*.md`
- verification registry round-trip
- live widget / formatter snapshots

### Phase 1 — first safe extraction batch
Extract from `extensions/index.ts`:
- `agent-prompts.ts`
- `bash-policy.ts`
- `registry.ts`

### Phase 2 — second extraction batch
Extract from `extensions/index.ts`:
- `web-tools.ts`
- `subagent-support.ts`

### Phase 3 — root thinning
Reduce `extensions/index.ts` to:
- state ownership
- session restore orchestration
- mode switching
- event hooks
- tool registration/composition

### Phase 4 — reassess, then stop if readability is already good
Only split further if one extracted module is still too large **and** has a real ownership seam.

## Explicit non-goals
- no behavior redesign
- no tool/schema renames
- no first-pass rewrite of `extensions/subagents.ts`
- no refactor of `extensions/compact-tool-renderers.ts` beyond import updates
- no reorganization of flat `agents/` prompt files
