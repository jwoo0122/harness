import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const modulePath = resolve(repoRoot, "extensions/managed-worktrees.ts");
const indexPath = resolve(repoRoot, "extensions/index.ts");
const subagentsPath = resolve(repoRoot, "extensions/subagents.ts");
const packageJsonPath = resolve(repoRoot, "package.json");

assert.ok(existsSync(modulePath), "extensions/managed-worktrees.ts must exist before mutation-gate validation");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /tests\/extensions\/validate-managed-mutation-gate\.mjs/,
  "validate:extensions must include managed-mutation-gate validation",
);

const indexSource = readFileSync(indexPath, "utf-8");
const subagentsSource = readFileSync(subagentsPath, "utf-8");

for (const marker of [
  'const CHILD_MANAGED_WORKTREE_REQUIRED = process.env.HARNESS_MANAGED_WORKTREE_REQUIRED === "1";',
  'const CHILD_MANAGED_WORKTREE_BINDING = decodeManagedBindingFromEnv(process.env.HARNESS_MANAGED_WORKTREE_BINDING);',
  'function buildManagedSubagentEnv(): Record<string, string> | undefined {',
  'HARNESS_MANAGED_WORKTREE_REQUIRED: "1"',
  'HARNESS_MANAGED_WORKTREE_BINDING: Buffer.from(JSON.stringify(currentManagedBinding), "utf-8").toString("base64url")',
  'event.toolName === "harness_commit"',
  'const gate = await evaluateCurrentManagedMutation(ctx, true);',
]) {
  assert.ok(indexSource.includes(marker), `extensions/index.ts missing managed mutation-gate marker: ${marker}`);
}

assert.ok(subagentsSource.includes("env?: Record<string, string | undefined>;"), "HarnessSubagentSpec must support injected env for managed-worktree bindings");
assert.ok(subagentsSource.includes("...spec.env,"), "runHarnessSubagentProcess must forward managed-worktree env into child subprocesses");

const managedModule = await import(pathToFileURL(modulePath).href);
const {
  createManagedSessionBinding,
  createManagedWorktreeLease,
  evaluateManagedMutationGate,
} = managedModule;

const tempRoot = await mkdtemp(join(tmpdir(), "harness-managed-gate-"));
const worktreeRoot = join(tempRoot, "worktree");
const targetCwd = join(worktreeRoot, "src");
mkdirSync(targetCwd, { recursive: true });

try {
  const lease = createManagedWorktreeLease({
    worktreeId: "gate-1",
    worktreePath: worktreeRoot,
    targetCwd,
    branch: "harness/wt/gate-1",
    repoRoot: worktreeRoot,
    gitCommonDir: join(tempRoot, ".git"),
    baseCommit: "abc123",
    lifecycleState: "managed-active",
  });
  const binding = createManagedSessionBinding(lease);

  assert.deepEqual(
    evaluateManagedMutationGate({ required: false, cwd: tempRoot }),
    { allowed: true },
    "mutation gate must stay inert when no managed binding is required",
  );

  const missingBinding = evaluateManagedMutationGate({ required: true, cwd: targetCwd });
  assert.equal(missingBinding.allowed, false, "managed mutation must be blocked without a binding when required");
  assert.match(missingBinding.reason ?? "", /no managed-worktree binding/i);

  const missingLease = evaluateManagedMutationGate({ required: true, cwd: targetCwd, binding });
  assert.equal(missingLease.allowed, false, "managed mutation must be blocked when the lease is missing");
  assert.match(missingLease.reason ?? "", /lease is missing/i);

  const allowed = evaluateManagedMutationGate({
    required: true,
    cwd: targetCwd,
    binding,
    lease,
    liveWorktreePath: worktreeRoot,
    liveBranch: binding.branch,
  });
  assert.deepEqual(allowed, { allowed: true }, "managed mutation must be allowed when binding, cwd, branch, and lease all agree");

  const wrongCwd = evaluateManagedMutationGate({
    required: true,
    cwd: tempRoot,
    binding,
    lease,
    liveWorktreePath: worktreeRoot,
    liveBranch: binding.branch,
  });
  assert.equal(wrongCwd.allowed, false, "managed mutation must be blocked outside the bound target cwd");
  assert.match(wrongCwd.reason ?? "", /outside the managed target cwd/i);

  const wrongBranch = evaluateManagedMutationGate({
    required: true,
    cwd: targetCwd,
    binding,
    lease,
    liveWorktreePath: worktreeRoot,
    liveBranch: "main",
  });
  assert.equal(wrongBranch.allowed, false, "managed mutation must be blocked when the live branch diverges from the binding");
  assert.match(wrongBranch.reason ?? "", /does not match the bound managed branch/i);

  rmSync(worktreeRoot, { recursive: true, force: true });
  const missingWorktree = evaluateManagedMutationGate({
    required: true,
    cwd: targetCwd,
    binding,
    lease,
    liveWorktreePath: worktreeRoot,
    liveBranch: binding.branch,
  });
  assert.equal(missingWorktree.allowed, false, "managed mutation must be blocked when the worktree path is missing");
  assert.match(missingWorktree.reason ?? "", /path is missing/i);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("validate:managed-mutation-gate passed");
