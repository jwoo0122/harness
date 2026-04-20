import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const modulePath = resolve(repoRoot, "extensions/managed-worktrees.ts");
const indexPath = resolve(repoRoot, "extensions/index.ts");
const packageJsonPath = resolve(repoRoot, "package.json");

assert.ok(existsSync(modulePath), "extensions/managed-worktrees.ts must exist before full validation");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /extensions\/managed-worktrees\.ts/,
  "validate:extensions must syntax-check extensions/managed-worktrees.ts",
);
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /tests\/extensions\/validate-managed-worktrees\.mjs/,
  "validate:extensions must include managed-worktrees validation",
);

const moduleSource = readFileSync(modulePath, "utf-8");
const indexSource = readFileSync(indexPath, "utf-8");

for (const forbiddenImport of ["./index", "@mariozechner/", "@sinclair/typebox"]) {
  assert.ok(!moduleSource.includes(forbiddenImport), `extensions/managed-worktrees.ts must not import ${forbiddenImport}`);
}

for (const marker of [
  'export const MANAGED_BRANCH_PREFIX = "harness/wt/"',
  'export const MANAGED_LEASE_DIRECTORY = "pi-harness/worktrees"',
  "export function buildManagedBranchName(",
  "export function resolveManagedLeaseDir(",
  "export function resolveManagedWorktreeRoot(",
  "export function resolveTargetSessionDir(",
  "export async function writeManagedSessionFile(",
  "export function evaluateManagedMutationGate(",
]) {
  assert.ok(moduleSource.includes(marker), `extensions/managed-worktrees.ts missing marker: ${marker}`);
}

assert.ok(indexSource.includes('from "./managed-worktrees.js"'), "extensions/index.ts must import ./managed-worktrees.js");
assert.ok(indexSource.includes("currentManagedBinding"), "extensions/index.ts must track managed session binding state");
assert.ok(indexSource.includes("currentManagedLease"), "extensions/index.ts must track managed lease state");

const managedModule = await import(pathToFileURL(modulePath).href);
const {
  MANAGED_BRANCH_PREFIX,
  createManagedWorktreeId,
  buildManagedBranchName,
  resolveGitCommonDir,
  resolveCanonicalRepoRoot,
  resolveManagedWorktreeRoot,
  resolveManagedTargetCwd,
  resolveManagedLeaseDir,
  resolveManagedLeaseFile,
  resolveTargetSessionDir,
  createManagedWorktreeLease,
  writeManagedWorktreeLease,
  readManagedWorktreeLease,
} = managedModule;

assert.equal(typeof createManagedWorktreeId, "function", "createManagedWorktreeId export must exist");
assert.equal(typeof buildManagedBranchName, "function", "buildManagedBranchName export must exist");
assert.equal(buildManagedBranchName("abc123"), `${MANAGED_BRANCH_PREFIX}abc123`, "managed branch name must use the harness/wt prefix");

const tempRoot = await mkdtemp(join(tmpdir(), "harness-managed-worktrees-"));
const tempRepo = join(tempRoot, "repo");

try {
  execFileSync("git", ["init", tempRepo], { stdio: "ignore" });
  execFileSync("git", ["-C", tempRepo, "config", "user.email", "harness@example.com"]);
  execFileSync("git", ["-C", tempRepo, "config", "user.name", "Harness Test"]);
  execFileSync("bash", ["-lc", `mkdir -p ${JSON.stringify(join(tempRepo, "src"))} && echo test > ${JSON.stringify(join(tempRepo, "src", "index.ts"))}`]);
  execFileSync("git", ["-C", tempRepo, "add", "."]);
  execFileSync("git", ["-C", tempRepo, "commit", "-m", "init"], { stdio: "ignore" });

  const repoRootOutput = execFileSync("git", ["-C", tempRepo, "rev-parse", "--show-toplevel"], { encoding: "utf-8" }).trim();
  const gitCommonDirOutput = execFileSync("git", ["-C", tempRepo, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf-8" });
  const gitCommonDir = resolveGitCommonDir(repoRootOutput, gitCommonDirOutput);
  const canonicalRepoRoot = resolveCanonicalRepoRoot(repoRootOutput, gitCommonDir);

  assert.equal(canonicalRepoRoot, repoRootOutput, "canonical repo root should resolve back to the main checkout for a non-worktree repo");
  assert.ok(resolveManagedLeaseDir(gitCommonDir).startsWith(gitCommonDir), "lease dir must live under git common dir");

  const worktreeId = createManagedWorktreeId(new Date("2026-04-19T12:34:56.000Z"));
  const worktreeRoot = resolveManagedWorktreeRoot(canonicalRepoRoot, worktreeId);
  const targetCwd = resolveManagedTargetCwd(worktreeRoot, repoRootOutput, join(repoRootOutput, "src"));
  const sessionDir = resolveTargetSessionDir(".pi/sessions", worktreeRoot);
  const leaseFile = resolveManagedLeaseFile(gitCommonDir, worktreeId);

  assert.ok(worktreeRoot.includes(`${join(".worktrees", "repo")}`), "managed worktree root must use deterministic sibling .worktrees/<repo>/<id> layout");
  assert.equal(targetCwd, join(worktreeRoot, "src"), "target cwd must preserve the repo-relative subdirectory when possible");
  assert.ok(sessionDir.startsWith(worktreeRoot), "relative sessionDir must resolve under the target worktree root");
  assert.ok(leaseFile.startsWith(gitCommonDir), "lease file must resolve under git common dir");
  assert.ok(!leaseFile.includes(join(tempRepo, ".harness")), "lease file must not resolve under cwd-local .harness");

  const headCommit = execFileSync("git", ["-C", tempRepo, "rev-parse", "HEAD"], { encoding: "utf-8" }).trim();
  const lease = createManagedWorktreeLease({
    worktreeId,
    worktreePath: worktreeRoot,
    targetCwd,
    branch: buildManagedBranchName(worktreeId),
    repoRoot: repoRootOutput,
    gitCommonDir,
    baseCommit: headCommit,
    lifecycleState: "provisioning",
    now: new Date("2026-04-19T12:34:56.000Z"),
  });

  await writeManagedWorktreeLease(lease);
  const rereadLease = await readManagedWorktreeLease(lease.leaseFile);
  const { sessionFile: _expectedSessionFile, ...expectedLease } = lease;
  const { sessionFile: _actualSessionFile, ...actualLease } = rereadLease ?? {};
  assert.deepEqual(
    actualLease,
    expectedLease,
    "managed worktree lease must round-trip through the shared git-common-dir store",
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("validate:managed-worktrees passed");
