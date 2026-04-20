# PR Draft — Verification accumulation core

## Suggested title
`feat: split verification accumulation into committed specs and runtime receipts`

## Summary
This PR narrows the verification redesign to the core accumulation problem.

Instead of treating `.harness/verification-registry.json` as mutable pass/fail truth, the system now splits authority into:
- **committed reusable verification specs** in `.harness/verification-registry.json`
- **runtime immutable verification receipts** under the repo's git common dir at `pi-harness/verification/`

That makes verification accumulation durable and reusable while keeping runtime truth tied to actual executed evidence.

## What changed
- upgraded the committed registry to schema `harness-verification-registry-v2`
- migrated legacy v1 `entries` into v2 `specs`
- stopped treating legacy `lastResult` / `lastVerifiedAt` as runtime truth
- added repo-shared append-only receipt storage under the git common dir
- added `harness_verify_run` for executing automated verification specs and appending receipts
- changed `harness_verify_register` to register/update reusable specs only
- changed `harness_verify_list` to report receipt-derived `pass` / `fail` / `missing` / `stale`
- expanded deterministic validation to cover migration, receipt sharing, corruption failures, and freshness derivation
- updated docs and prompts to reflect the new authority model
- registered Iteration 10 itself as a reusable validation-backed verification spec

## Why
The previous model accumulated descriptions of verification methods, but not authoritative executed evidence. It also allowed a committed repo file to look like a source of truth for pass/fail freshness.

This PR fixes that by:
- preserving reusable verification knowledge in Git
- moving runtime evidence into immutable receipts
- deriving current status from the latest relevant receipts instead of mutable summary fields

## Key files
- `extensions/verification-registry.ts`
- `extensions/index.ts`
- `tests/extensions/validate-verification-registry.mjs`
- `.harness/verification-registry.json`
- `README.md`
- `INTEGRATION.md`
- `skills/execute/SKILL.md`
- `prompts/ac-check.md`
- `agents/VER.md`
- `CHANGELOG.md`

## Validation
Ran:
```sh
npm run validate:extensions
```

Also smoke-checked:
```sh
node --experimental-strip-types --input-type=module <<'EOF'
import { readRegistry, readVerificationReceiptStore, deriveVerificationStatuses } from './extensions/verification-registry.ts';
const cwd = process.cwd();
const registry = await readRegistry(cwd);
const store = await readVerificationReceiptStore(cwd);
const statuses = await deriveVerificationStatuses(cwd, registry, store.receipts);
console.log(JSON.stringify({
  schema: registry.$schema,
  specCount: Object.keys(registry.specs).length,
  receiptCount: store.receipts.length,
  iteration10: statuses
    .filter(({ check_id, bindings }) => check_id === 'validate-iteration-10-verification-accumulation' || bindings.some((binding) => binding.binding_id.startsWith('AC-10.')))
    .map(({ check_id, status, bindings }) => ({ check_id, status, bindings: bindings.map((binding) => binding.binding_id) })),
}, null, 2));
EOF
```

## Reviewer guide
Suggested review order:
1. `extensions/verification-registry.ts`
2. `tests/extensions/validate-verification-registry.mjs`
3. `extensions/index.ts`
4. `.harness/verification-registry.json`
5. docs/prompt updates

Things to verify while reviewing:
- v1 → v2 migration never promotes legacy pass/fail summary fields to truth
- receipt log path is resolved from git common dir, not cwd-local repo state
- malformed runtime receipts fail loudly
- `harness_verify_register` does not imply pass
- `harness_verify_run` appends immutable receipts
- `harness_verify_list` is receipt-derived and freshness-aware

## Caveats / follow-up
- This PR does **not** yet gate `harness_commit` on fresh blocking verification status.
- A true live execute-mode smoke inside pi (`register → run → list`) is still a useful follow-up, but deterministic source+runtime validation is already covered in the repo validator.
- Node emits existing non-blocking `MODULE_TYPELESS_PACKAGE_JSON` warnings while importing `.ts` modules during validation.
