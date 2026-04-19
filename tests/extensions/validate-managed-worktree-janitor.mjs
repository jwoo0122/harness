import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const modulePath = resolve(repoRoot, "extensions/managed-worktrees.ts");
const indexPath = resolve(repoRoot, "extensions/index.ts");
const packageJsonPath = resolve(repoRoot, "package.json");

assert.ok(existsSync(modulePath), "extensions/managed-worktrees.ts must exist before janitor validation");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /tests\/extensions\/validate-managed-worktree-janitor\.mjs/,
  "validate:extensions must include managed-worktree janitor validation",
);

const indexSource = readFileSync(indexPath, "utf-8");
for (const marker of [
  'await runManagedWorktreeJanitor(ctx, repoContext.gitCommonDir, currentManagedBinding?.worktreeId);',
  'await runManagedWorktreeJanitor(ctx, janitorRepo.gitCommonDir, currentManagedBinding?.worktreeId);',
  'worktree", "list", "--porcelain"',
  'evaluateManagedJanitorDecision({',
  'worktree", "remove", lease.worktreePath',
  'await deleteManagedWorktreeLease(lease.leaseFile);',
]) {
  assert.ok(indexSource.includes(marker), `extensions/index.ts missing janitor marker: ${marker}`);
}

const managedModule = await import(pathToFileURL(modulePath).href);
const {
  createManagedWorktreeLease,
  evaluateManagedJanitorDecision,
  findGitWorktreeRecord,
  parseGitWorktreeList,
  resolveCanonicalRepoRoot,
  resolveGitCommonDir,
  resolveManagedWorktreeRoot,
} = managedModule;

const tempRoot = await mkdtemp(join(tmpdir(), "harness-managed-janitor-"));
const tempRepo = join(tempRoot, "repo");
const userWorktree = join(tempRoot, "user-worktree");

try {
  execFileSync("git", ["init", tempRepo], { stdio: "ignore" });
  execFileSync("git", ["-C", tempRepo, "config", "user.email", "harness@example.com"]);
  execFileSync("git", ["-C", tempRepo, "config", "user.name", "Harness Test"]);
  await writeFile(join(tempRepo, "README.md"), "hello\n", "utf-8");
  execFileSync("git", ["-C", tempRepo, "add", "."]);
  execFileSync("git", ["-C", tempRepo, "commit", "-m", "init"], { stdio: "ignore" });

  const repoRootOutput = execFileSync("git", ["-C", tempRepo, "rev-parse", "--show-toplevel"], { encoding: "utf-8" }).trim();
  const gitCommonDirOutput = execFileSync("git", ["-C", tempRepo, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf-8" });
  const gitCommonDir = resolveGitCommonDir(repoRootOutput, gitCommonDirOutput);
  const canonicalRepoRoot = resolveCanonicalRepoRoot(repoRootOutput, gitCommonDir);
  const headCommit = execFileSync("git", ["-C", tempRepo, "rev-parse", "HEAD"], { encoding: "utf-8" }).trim();

  const managedId = "janitor-test";
  const managedWorktree = resolveManagedWorktreeRoot(canonicalRepoRoot, managedId);
  execFileSync("git", ["-C", repoRootOutput, "worktree", "add", "-b", `harness/wt/${managedId}`, managedWorktree, "HEAD"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoRootOutput, "worktree", "add", "-b", "user/janitor-check", userWorktree, "HEAD"], { stdio: "ignore" });

  const worktreeListText = execFileSync("git", ["-C", repoRootOutput, "worktree", "list", "--porcelain"], { encoding: "utf-8" });
  const worktreeRecords = parseGitWorktreeList(worktreeListText);
  const managedRecord = findGitWorktreeRecord(worktreeRecords, managedWorktree);
  const userRecord = worktreeRecords.find((record) => record.branch === "user/janitor-check");

  assert.ok(managedRecord, "janitor smoke must find the managed worktree in git worktree list output");
  assert.ok(userRecord, "janitor smoke must find the user-created worktree in git worktree list output");
  assert.equal(userRecord?.branch, "user/janitor-check", "user-created worktree must remain distinguishable from the managed branch prefix");

  const expiredLease = createManagedWorktreeLease({
    worktreeId: managedId,
    worktreePath: managedWorktree,
    targetCwd: managedWorktree,
    branch: `harness/wt/${managedId}`,
    repoRoot: repoRootOutput,
    gitCommonDir,
    baseCommit: headCommit,
    lifecycleState: "managed-released",
    now: new Date("2026-04-17T00:00:00.000Z"),
    leaseTtlMs: 1000,
  });

  const safeDecision = evaluateManagedJanitorDecision({
    lease: expiredLease,
    now: new Date("2026-04-19T00:00:00.000Z"),
    worktreeRecord: managedRecord,
    clean: true,
    uniqueCommitCount: 0,
  });
  assert.deepEqual(
    safeDecision,
    {
      remove: true,
      reason: `Managed worktree ${managedId} is expired, clean, and non-diverged.`,
    },
    "janitor must allow removal only for expired clean non-diverged managed worktrees",
  );

  const dirtyDecision = evaluateManagedJanitorDecision({
    lease: expiredLease,
    now: new Date("2026-04-19T00:00:00.000Z"),
    worktreeRecord: managedRecord,
    clean: false,
    uniqueCommitCount: 0,
  });
  assert.equal(dirtyDecision.remove, false, "janitor must never auto-remove dirty managed worktrees");
  assert.equal(dirtyDecision.nextState, "manual-cleanup-required", "dirty expired managed worktrees must be retained for manual cleanup");

  const divergedDecision = evaluateManagedJanitorDecision({
    lease: expiredLease,
    now: new Date("2026-04-19T00:00:00.000Z"),
    worktreeRecord: managedRecord,
    clean: true,
    uniqueCommitCount: 2,
  });
  assert.equal(divergedDecision.remove, false, "janitor must never auto-remove managed worktrees with unique commits");
  assert.equal(divergedDecision.nextState, "manual-cleanup-required", "diverged expired managed worktrees must be retained for manual cleanup");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("validate:managed-worktree-janitor passed");
