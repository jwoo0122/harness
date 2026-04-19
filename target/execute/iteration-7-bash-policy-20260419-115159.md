# Execution Report: iteration-7 bash-policy seam extraction
> Generated: 20260419-115159
> Roles: 📋 PLN | 🔨 IMP | ✅ VER

## Pre-flight baseline
- Existing extracted seams before this increment:
  - `extensions/agent-prompts.ts`
  - `extensions/verification-registry.ts`
- Current next seam from `target/explore/extensions-refactor-plan-20260418-172749.md` was `extensions/bash-policy.ts`.
- Baseline validation before changes:
  - `npm run validate:extensions` → ✅ PASS
- Verification registry baseline:
  - fallback used direct read of `.harness/verification-registry.json` because `harness_verify_list` was unavailable outside execute-mode tool context
  - baseline entries loaded: 1 (`AC-SMOKE-1`)
  - baseline manual regression re-check for `AC-SMOKE-1`: source inspection confirmed `harness_verify_register` / `harness_verify_list` are still registered in `extensions/index.ts` and remain documented in `README.md` and `INTEGRATION.md`

## Increment log

### INC-1 — Plan
- Criteria created: `.iteration-7-criteria.md`
- Scope fixed to the bash-policy classification seam only.
- Planned extraction target:
  - prefix arrays
  - bash classification helpers
  - child-policy dispatcher
- Explicit non-goals preserved:
  - no tool-handler extraction
  - no web-helper extraction
  - no lifecycle refactor
  - no `extensions/subagents.ts` / `extensions/compact-tool-renderers.ts` refactor

### INC-2 — Validate (prepare)
Files added/changed:
- `package.json`
- `tests/extensions/prepare-bash-policy.mjs`

Command run:
```sh
npm run validate:extensions:prepare
```
Result:
- ✅ PASS

What it checked:
- active prepare entrypoint is bash-policy-specific
- prior prepare validators remain in the repo
- bash-policy seam still existed in `extensions/index.ts`
- adjacent non-scope helpers remained in `extensions/index.ts`
- extraction had not already happened yet
- validation remained Node-builtins-only and did not require peer dependency installs

### INC-3 — Implement
Files added/changed:
- `extensions/bash-policy.ts`
- `extensions/index.ts`
- `package.json`
- `tests/extensions/validate-bash-policy.mjs`
- `tests/extensions/validate-verification-registry.mjs`
- `README.md`
- `CHANGELOG.md`

Implementation summary:
- extracted bash-policy classification helpers into `extensions/bash-policy.ts`
- moved:
  - `READ_ONLY_BASH_PREFIXES`
  - `MUTATING_BASH_PREFIXES`
  - `RAW_NETWORK_BASH_PREFIXES`
  - `VERIFY_BASH_PREFIXES`
  - `isAgentBrowserCommand`
  - `classifyExploreBash`
  - `classifyExecuteBash`
  - `classifyChildBashCommand`
- updated `extensions/index.ts` to import from `./bash-policy.js`
- kept `parseHarnessSubagentBashPolicy`, tool handlers, web helpers, and lifecycle wiring in `extensions/index.ts`
- relaxed the registry full validator so future prepare-entrypoint rotation does not break the full validation chain

### INC-4 — Validate
Command run:
```sh
npm run validate:extensions
```
Result:
- ✅ PASS

What it checked:
- syntax checks for:
  - `extensions/index.ts`
  - `extensions/agent-prompts.ts`
  - `extensions/bash-policy.ts`
  - `extensions/verification-registry.ts`
  - `extensions/subagents.ts`
- existing prompt validation still passes
- existing registry validation still passes
- bash-policy validator proves:
  - extracted module exists and is leaf-like
  - `extensions/index.ts` imports `./bash-policy.js`
  - extracted seam is no longer defined in `extensions/index.ts`
  - representative explore-mode behavior is preserved
  - representative execute-mode behavior is preserved
  - child-policy delegation is preserved
  - overlapping-prefix order behavior is preserved

### INC-5 — Verification registry update + regression scan
Registry update method:
- fallback used direct write to `.harness/verification-registry.json` because `harness_verify_register` was unavailable outside execute-mode tool context

Entries updated/added:
- updated `AC-SMOKE-1` last verification status
- added `AC-5.3`
- added `AC-6.3`
- added `AC-7.3`

Regression scan method:
- fallback used direct read of `.harness/verification-registry.json` because `harness_verify_list` was unavailable outside execute-mode tool context
- re-ran registered automated verification command:
  - `npm run validate:extensions` → ✅ PASS
- re-checked manual registry entry:
  - `AC-SMOKE-1` → ✅ PASS by source inspection of tool registrations/docs

Registry size after scan:
- 4 entries

## Final AC matrix (✅ VER is sole authority)
| AC | Status | Evidence | Verified by |
|----|--------|----------|-------------|
| AC-7.1 | ✅ PASS | `package.json` repoints `validate:extensions:prepare` to `tests/extensions/prepare-bash-policy.mjs` | prepare validator + source inspection |
| AC-7.2 | ✅ PASS* | pre-extraction prepare gate passed and is Node-builtins-only | command result + `tests/extensions/prepare-bash-policy.mjs` |
| AC-7.3 | ✅ PASS | `extensions/bash-policy.ts` owns the extracted bash-policy seam | source inspection + `npm run validate:extensions` |
| AC-7.4 | ✅ PASS | extracted module avoids `extensions/index.ts` / peer-dependency imports and preserves ordered `startsWith` semantics | source inspection + `tests/extensions/validate-bash-policy.mjs` |
| AC-7.5 | ✅ PASS | `extensions/index.ts` imports `./bash-policy.js`; non-scope logic remains in root | source inspection + `npm run validate:extensions` |
| AC-7.6 | ✅ PASS | full validation chain stays green and proves bash-policy behavior parity | `package.json`, `tests/extensions/validate-bash-policy.mjs`, `npm run validate:extensions` |
| AC-7.7 | ✅ PASS | full validators no longer hardcode the prior registry prepare-entrypoint owner | `tests/extensions/validate-agent-prompts.mjs`, `tests/extensions/validate-verification-registry.mjs`, `npm run validate:extensions` |
| AC-7.8 | ✅ PASS | no bash-policy redesign or unrelated scope expansion was introduced | source inspection + validator behavior matrix |

\* AC-7.2 audit caveat: this is a phase gate tied to the pre-extraction state, so current `HEAD` cannot independently replay the seam-present condition after extraction.

## VER's audit of this report
✅ VER audit summary:
- Scope stayed within the bash-policy classification seam.
- `parseHarnessSubagentBashPolicy`, tool handlers, web helpers, and lifecycle wiring remain in `extensions/index.ts`.
- Validation-first sequencing was followed and aggregate validation remained green.
- Registry-driven regression scan was completed using fallback file-based workflow because execute-mode registry tools were unavailable in this session.

## Regressions detected & resolved
- No regression detected in the extension validation chain.
- No regression detected in the preserved verify-register / verify-list tool definitions or docs for `AC-SMOKE-1`.
- `MODULE_TYPELESS_PACKAGE_JSON` warnings appeared during Node validation imports for extracted `.ts` modules; this is non-blocking and unchanged behavior.

## Remaining work
Next likely seam from the refactor roadmap:
1. web helpers
2. later: subagent-support formatting / record helpers
3. later: deeper composition-root thinning

## Recommendations
- Keep rotating `validate:extensions:prepare` to the active seam-specific prepare validator per increment.
- Keep full validators forward-compatible so future seam rotations do not require unrelated validator churn.
- If execute-mode registry tools are needed during future sessions, re-run `AC-SMOKE-1` as a live tool-path check in true execute mode to replace the fallback manual verification here.
