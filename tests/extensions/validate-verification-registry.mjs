import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const V2_SCHEMA = "harness-verification-registry-v2";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const modulePath = resolve(repoRoot, "extensions/verification-registry.ts");
const indexPath = resolve(repoRoot, "extensions/index.ts");
const packageJsonPath = resolve(repoRoot, "package.json");

assert.ok(existsSync(modulePath), "extensions/verification-registry.ts must exist before full validation");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
assert.ok(packageJson.scripts?.["validate:extensions:prepare"], "package.json must define validate:extensions:prepare");
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /extensions\/verification-registry\.ts/,
  "validate:extensions must syntax-check extensions/verification-registry.ts",
);
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /tests\/extensions\/validate-verification-registry\.mjs/,
  "validate:extensions must include registry validation",
);

const moduleSource = readFileSync(modulePath, "utf-8");
const indexSource = readFileSync(indexPath, "utf-8");

for (const forbiddenImport of ["./index", "@mariozechner/", "@sinclair/typebox"]) {
  assert.ok(!moduleSource.includes(forbiddenImport), `extensions/verification-registry.ts must not import ${forbiddenImport}`);
}

assert.ok(indexSource.includes('from "./verification-registry.js"'), "extensions/index.ts must import ./verification-registry.js");
for (const removedMarker of [
  "interface VerificationEntry",
  'lastResult: "pass"',
  "lastVerifiedAt:",
]) {
  assert.ok(!indexSource.includes(removedMarker), `extensions/index.ts must no longer contain ${removedMarker}`);
}
for (const requiredMarker of [
  'name: "harness_verify_register"',
  'name: "harness_verify_run"',
  'name: "harness_verify_list"',
  "receipt-derived",
]) {
  assert.ok(indexSource.includes(requiredMarker), `extensions/index.ts must contain ${requiredMarker}`);
}

const registryModule = await import(pathToFileURL(modulePath).href);
const {
  appendVerificationReceipt,
  createEmptyRegistry,
  deriveVerificationStatuses,
  getGitHead,
  hashVerificationSpec,
  readRegistry,
  readVerificationReceiptStore,
  resolveVerificationRuntimePaths,
  selectVerificationSpecs,
  upsertVerificationSpec,
  writeRegistry,
} = registryModule;

for (const [name, value] of Object.entries({
  appendVerificationReceipt,
  createEmptyRegistry,
  deriveVerificationStatuses,
  getGitHead,
  hashVerificationSpec,
  readRegistry,
  readVerificationReceiptStore,
  resolveVerificationRuntimePaths,
  selectVerificationSpecs,
  upsertVerificationSpec,
  writeRegistry,
})) {
  assert.equal(typeof value, "function", `${name} export must exist`);
}

const tempRoot = await mkdtemp(join(tmpdir(), "harness-registry-v2-"));
const repoDir = join(tempRoot, "repo");
const linkedWorktreeDir = join(tempRoot, "repo-linked");
const registryFilePath = join(repoDir, ".harness", "verification-registry.json");

try {
  execGit(tempRoot, ["init", repoDir]);
  execGit(repoDir, ["config", "user.email", "harness@example.com"]);
  execGit(repoDir, ["config", "user.name", "Harness Test"]);
  await writeFile(join(repoDir, "README.md"), "# temp repo\n", "utf-8");
  execGit(repoDir, ["add", "README.md"]);
  execGit(repoDir, ["commit", "-m", "init"]);

  const emptyRegistry = await readRegistry(repoDir);
  assert.deepEqual(emptyRegistry, createEmptyRegistry(), "missing registry file must return the default empty v2 registry");

  const legacyRegistry = {
    $schema: "harness-verification-registry-v1",
    entries: {
      "AC-LEG-1": {
        requirement: "Legacy entry migrates to a reusable spec",
        source: ".iteration-6-criteria.md",
        verification: {
          strategy: "automated-test",
          command: "npm run validate:extensions",
          files: ["tests/extensions/validate-verification-registry.mjs"],
          description: "Legacy v1 sample",
        },
        registeredAt: "INC-6",
        lastVerifiedAt: "INC-9",
        lastResult: "pass",
      },
    },
  };

  await mkdir(dirname(registryFilePath), { recursive: true });
  await writeFile(registryFilePath, JSON.stringify(legacyRegistry, null, 2) + "\n", "utf-8");
  const migratedRegistry = await readRegistry(repoDir);
  assert.equal(migratedRegistry.$schema, V2_SCHEMA, "legacy v1 registry must migrate to v2 on read");
  assert.ok(migratedRegistry.specs["AC-LEG-1"], "legacy AC id must become a v2 check_id when migrating");
  assert.equal(migratedRegistry.specs["AC-LEG-1"].bindings[0].registeredAt, "INC-6", "legacy registeredAt must survive migration");
  assert.ok(!("entries" in migratedRegistry), "migrated registry must not preserve the legacy top-level entries shape");
  assert.ok(!("lastResult" in migratedRegistry.specs["AC-LEG-1"]), "legacy pass/fail summary must not become authoritative v2 state");

  let registry = createEmptyRegistry();
  registry = upsertVerificationSpec(registry, {
    ac_id: "AC-PASS-1",
    check_id: "pass-check",
    requirement: "Pass status comes from a current-head receipt",
    source: ".iteration-10-criteria.md",
    strategy: "automated-test",
    command: "npm run validate:extensions",
    files: ["tests/extensions/validate-verification-registry.mjs"],
    description: "Automated pass sample",
    increment: "INC-1",
  }).registry;
  registry = upsertVerificationSpec(registry, {
    ac_id: "AC-FAIL-1",
    check_id: "fail-check",
    requirement: "Fail status comes from a current-head receipt",
    source: ".iteration-10-criteria.md",
    strategy: "automated-test",
    command: "npm run validate:extensions",
    files: ["tests/extensions/validate-verification-registry.mjs"],
    description: "Automated fail sample",
    increment: "INC-1",
  }).registry;
  registry = upsertVerificationSpec(registry, {
    ac_id: "AC-MISS-1",
    check_id: "missing-check",
    requirement: "Missing status appears when no receipts exist",
    source: ".iteration-10-criteria.md",
    strategy: "automated-test",
    command: "npm run validate:extensions",
    files: ["tests/extensions/validate-verification-registry.mjs"],
    description: "Missing sample",
    increment: "INC-1",
  }).registry;
  registry = upsertVerificationSpec(registry, {
    ac_id: "AC-STALE-HEAD-1",
    check_id: "head-stale-check",
    requirement: "Stale status appears when receipts are from an older HEAD",
    source: ".iteration-10-criteria.md",
    strategy: "automated-test",
    command: "npm run validate:extensions",
    files: ["tests/extensions/validate-verification-registry.mjs"],
    description: "Head freshness sample",
    increment: "INC-1",
  }).registry;
  registry = upsertVerificationSpec(registry, {
    ac_id: "AC-MANUAL-1",
    check_id: "manual-review",
    requirement: "Manual checks remain selectable but not automated by default",
    source: ".iteration-10-criteria.md",
    strategy: "manual-check",
    mode: "manual",
    blocking: false,
    description: "Manual sample",
    increment: "INC-1",
  }).registry;

  await writeRegistry(repoDir, registry);
  const writtenContent = await readFile(registryFilePath, "utf-8");
  assert.equal(writtenContent, JSON.stringify(registry, null, 2) + "\n", "writeRegistry must pretty-print v2 JSON with a trailing newline");

  const rereadRegistry = await readRegistry(repoDir);
  assert.deepEqual(rereadRegistry, registry, "v2 registry must round-trip through readRegistry/writeRegistry");

  const defaultSelection = selectVerificationSpecs(registry, { automatedOnly: true, includeNonBlocking: false });
  assert.deepEqual(
    defaultSelection.map((spec) => spec.check_id),
    ["fail-check", "head-stale-check", "missing-check", "pass-check"],
    "default automated blocking selection must exclude manual/non-blocking specs and stay sorted by check_id",
  );
  assert.deepEqual(
    selectVerificationSpecs(registry, { filter: "AC-PASS" }).map((spec) => spec.check_id),
    ["pass-check"],
    "selection filter must match bound AC IDs as well as check_ids",
  );

  const head1 = await getGitHead(repoDir);
  const mainRuntimePaths = await resolveVerificationRuntimePaths(repoDir);
  const emptyStore = await readVerificationReceiptStore(repoDir);
  assert.equal(emptyStore.receipts.length, 0, "missing runtime store must behave as empty");
  assert.equal(emptyStore.receiptLogPath, mainRuntimePaths.receiptLogPath, "resolved receipt path must match empty store path");

  await appendVerificationReceipt(repoDir, buildReceipt({
    registry,
    repoDir,
    gitCommonDir: mainRuntimePaths.gitCommonDir,
    head: head1,
    checkId: "head-stale-check",
    receiptId: "r-head-1",
    status: "pass",
    exitCode: 0,
  }));

  await writeFile(join(repoDir, "touch.txt"), "second commit\n", "utf-8");
  execGit(repoDir, ["add", "touch.txt"]);
  execGit(repoDir, ["commit", "-m", "second"]);
  const head2 = await getGitHead(repoDir);

  execGit(repoDir, ["worktree", "add", "-b", "linked-verification", linkedWorktreeDir, "HEAD"]);
  const linkedRuntimePaths = await resolveVerificationRuntimePaths(linkedWorktreeDir);
  assert.equal(
    await realpath(linkedRuntimePaths.receiptLogPath),
    await realpath(mainRuntimePaths.receiptLogPath),
    "linked worktrees must share a single receipt log via git common dir",
  );

  await appendVerificationReceipt(repoDir, buildReceipt({
    registry,
    repoDir,
    gitCommonDir: mainRuntimePaths.gitCommonDir,
    head: head2,
    checkId: "pass-check",
    receiptId: "r-pass-2",
    status: "pass",
    exitCode: 0,
  }));
  await appendVerificationReceipt(linkedWorktreeDir, buildReceipt({
    registry,
    repoDir: linkedWorktreeDir,
    gitCommonDir: linkedRuntimePaths.gitCommonDir,
    head: head2,
    checkId: "fail-check",
    receiptId: "r-fail-2",
    status: "fail",
    exitCode: 1,
  }));

  const sharedStoreMain = await readVerificationReceiptStore(repoDir);
  const sharedStoreLinked = await readVerificationReceiptStore(linkedWorktreeDir);
  assert.equal(sharedStoreMain.receipts.length, 3, "receipt history must append rather than overwrite");
  assert.equal(sharedStoreLinked.receipts.length, 3, "linked worktree must observe the same shared receipt history");

  const receiptLines = (await readFile(sharedStoreMain.receiptLogPath, "utf-8")).trim().split(/\r?\n/);
  assert.equal(receiptLines.length, 3, "receipt log must remain append-only JSONL with one line per receipt");

  const statuses = await deriveVerificationStatuses(repoDir, registry, sharedStoreMain.receipts);
  assert.equal(findStatus(statuses, "pass-check").status, "pass", "current-head pass receipt must derive PASS");
  assert.equal(findStatus(statuses, "fail-check").status, "fail", "current-head failing receipt must derive FAIL");
  assert.equal(findStatus(statuses, "missing-check").status, "missing", "missing receipts must derive MISSING");
  assert.equal(findStatus(statuses, "head-stale-check").status, "stale", "older-head receipts must derive STALE");

  registry = upsertVerificationSpec(registry, {
    ac_id: "AC-PASS-1",
    check_id: "pass-check",
    requirement: "Pass status becomes stale after the spec changes",
    source: ".iteration-10-criteria.md",
    strategy: "automated-test",
    command: "npm run validate:extensions",
    files: ["tests/extensions/validate-verification-registry.mjs"],
    description: "Automated pass sample updated",
    increment: "INC-2",
  }).registry;
  await writeRegistry(repoDir, registry);
  const statusesAfterSpecChange = await deriveVerificationStatuses(repoDir, registry, sharedStoreMain.receipts);
  assert.equal(findStatus(statusesAfterSpecChange, "pass-check").status, "stale", "spec-hash changes must make old receipts stale");

  await writeFile(sharedStoreMain.receiptLogPath, `${await readFile(sharedStoreMain.receiptLogPath, "utf-8")}not-json\n`, "utf-8");
  await assert.rejects(
    () => readVerificationReceiptStore(repoDir),
    /Malformed verification receipt store/,
    "malformed runtime receipt content must fail explicitly",
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("validate:verification-registry passed");

function execGit(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function buildReceipt({ registry, repoDir, gitCommonDir, head, checkId, receiptId, status, exitCode }) {
  const spec = registry.specs[checkId];
  assert.ok(spec, `spec ${checkId} must exist before building a receipt`);
  return {
    receipt_id: receiptId,
    check_id: checkId,
    spec_hash: hashVerificationSpec(spec),
    status,
    mode: spec.verification.mode,
    blocking: spec.verification.blocking,
    command: spec.verification.command,
    exit_code: exitCode,
    started_at: new Date("2026-04-20T00:00:00.000Z").toISOString(),
    finished_at: new Date("2026-04-20T00:00:01.000Z").toISOString(),
    duration_ms: 1000,
    commit_hash: head.full,
    commit_short: head.short,
    git_common_dir: gitCommonDir,
    worktree_path: repoDir,
    stdout_sha256: "stdout-hash",
    stderr_sha256: exitCode === 0 ? undefined : "stderr-hash",
    stdout_preview: "preview",
    stderr_preview: exitCode === 0 ? undefined : "error preview",
  };
}

function findStatus(statuses, checkId) {
  const entry = statuses.find((status) => status.check_id === checkId);
  assert.ok(entry, `status for ${checkId} must exist`);
  return entry;
}
