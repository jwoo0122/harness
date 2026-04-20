import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const modulePath = resolve(repoRoot, "extensions/managed-worktrees.ts");
const indexPath = resolve(repoRoot, "extensions/index.ts");
const readmePath = resolve(repoRoot, "README.md");
const executeSkillPath = resolve(repoRoot, "skills/execute/SKILL.md");
const packageJsonPath = resolve(repoRoot, "package.json");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /tests\/extensions\/validate-managed-worktree-bootstrap\.mjs/,
  "validate:extensions must include managed-worktree bootstrap validation",
);

const indexSource = readFileSync(indexPath, "utf-8");
const readmeSource = readFileSync(readmePath, "utf-8");
const executeSkillSource = readFileSync(executeSkillPath, "utf-8");

for (const marker of [
  'pi.registerCommand(INTERNAL_MANAGED_WORKTREE_COMMAND',
  'name: INTERNAL_MANAGED_WORKTREE_TOOL',
  'ctx.switchSession(targetSessionFile)',
  'resolveTargetSessionDir(ctx.sessionManager.getSessionDir(), worktreeRoot)',
  'writeManagedSessionFile({',
  'hasRelevantGitStatusChanges(statusResult.stdout, repoContext.repoRoot, ignoredStatusPaths)',
  'headOnlyFromDirty',
  'evaluateDirtyExecuteBootstrap({',
  'dirtyDecision.notification',
]) {
  assert.ok(indexSource.includes(marker), `extensions/index.ts missing bootstrap marker: ${marker}`);
}

for (const forbiddenDocMarker of [
  "/worktree-new",
  "harness-internal-managed-worktree-create",
]) {
  assert.ok(!readmeSource.includes(forbiddenDocMarker), `README.md must not advertise ${forbiddenDocMarker} as a public workflow`);
  assert.ok(!executeSkillSource.includes(forbiddenDocMarker), `skills/execute/SKILL.md must not advertise ${forbiddenDocMarker} as a public workflow`);
}

assert.ok(!indexSource.includes('registerCommand("worktree-new"'), "extensions/index.ts must not expose a public /worktree-new command");
assert.ok(!indexSource.includes('parseHarnessProtocolInvocation("/new"'), "managed-worktree bootstrap must not rewrite built-in /new in this iteration");

const managedModule = await import(pathToFileURL(modulePath).href);
const {
  buildManagedBranchName,
  createManagedSessionBinding,
  createManagedWorktreeLease,
  parseGitWorktreeList,
  resolveCanonicalRepoRoot,
  resolveGitCommonDir,
  resolveManagedTargetCwd,
  resolveManagedWorktreeRoot,
  resolveTargetSessionDir,
  writeManagedSessionFile,
} = managedModule;

const tempRoot = await mkdtemp(join(tmpdir(), "harness-managed-bootstrap-"));
const tempRepo = join(tempRoot, "repo");
const absoluteSessionDir = join(tempRoot, "absolute-sessions");

try {
  execFileSync("git", ["init", tempRepo], { stdio: "ignore" });
  execFileSync("git", ["-C", tempRepo, "config", "user.email", "harness@example.com"]);
  execFileSync("git", ["-C", tempRepo, "config", "user.name", "Harness Test"]);
  await mkdir(join(tempRepo, "packages", "app"), { recursive: true });
  await writeFile(join(tempRepo, "packages", "app", "index.ts"), "export const value = 1;\n", "utf-8");
  execFileSync("git", ["-C", tempRepo, "add", "."]);
  execFileSync("git", ["-C", tempRepo, "commit", "-m", "init"], { stdio: "ignore" });

  const repoRootOutput = execFileSync("git", ["-C", tempRepo, "rev-parse", "--show-toplevel"], { encoding: "utf-8" }).trim();
  const gitCommonDirOutput = execFileSync("git", ["-C", tempRepo, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf-8" });
  const gitCommonDir = resolveGitCommonDir(repoRootOutput, gitCommonDirOutput);
  const canonicalRepoRoot = resolveCanonicalRepoRoot(repoRootOutput, gitCommonDir);
  const worktreeId = "bootstrap-test";
  const branch = buildManagedBranchName(worktreeId);
  const worktreeRoot = resolveManagedWorktreeRoot(canonicalRepoRoot, worktreeId);
  const requestedTargetCwd = resolveManagedTargetCwd(worktreeRoot, repoRootOutput, join(repoRootOutput, "packages", "app"));

  execFileSync("git", ["-C", repoRootOutput, "worktree", "add", "-b", branch, worktreeRoot, "HEAD"], { stdio: "ignore" });
  const worktreeList = execFileSync("git", ["-C", repoRootOutput, "worktree", "list", "--porcelain"], { encoding: "utf-8" });
  const parsedWorktrees = parseGitWorktreeList(worktreeList);
  assert.ok(parsedWorktrees.some((record) => record.worktreePath === worktreeRoot && record.branch === branch), "temp-repo smoke must create a managed branch-shaped git worktree");
  assert.ok(existsSync(requestedTargetCwd), "target cwd should preserve the repo-relative subdirectory when it exists in HEAD");

  const headCommit = execFileSync("git", ["-C", repoRootOutput, "rev-parse", "HEAD"], { encoding: "utf-8" }).trim();
  const lease = createManagedWorktreeLease({
    worktreeId,
    worktreePath: worktreeRoot,
    targetCwd: requestedTargetCwd,
    branch,
    repoRoot: repoRootOutput,
    gitCommonDir,
    baseCommit: headCommit,
    lifecycleState: "managed-active",
  });
  const binding = createManagedSessionBinding(lease);

  const relativeSessionFile = await writeManagedSessionFile({
    cwd: requestedTargetCwd,
    sessionDir: resolveTargetSessionDir(".pi/sessions", worktreeRoot),
    parentSession: "/tmp/source-session.jsonl",
    binding,
  });
  assert.ok(relativeSessionFile.startsWith(join(worktreeRoot, ".pi", "sessions")), "relative sessionDir must resolve under the target worktree root");

  const absoluteSessionFile = await writeManagedSessionFile({
    cwd: requestedTargetCwd,
    sessionDir: absoluteSessionDir,
    parentSession: "/tmp/source-session.jsonl",
    binding,
  });
  assert.ok(absoluteSessionFile.startsWith(absoluteSessionDir), "absolute sessionDir must remain absolute when creating the target session file");

  const relativeSessionLines = (await readFile(relativeSessionFile, "utf-8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(relativeSessionLines[0].cwd, requestedTargetCwd, "target session header cwd must equal the target managed cwd");
  assert.equal(relativeSessionLines[1].customType, "harness-managed-worktree-binding", "target session file must persist the managed binding before switching");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("validate:managed-worktree-bootstrap passed");
