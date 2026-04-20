import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const helperModulePath = resolve(repoRoot, "extensions/execute-managed-bootstrap.ts");
const managedModulePath = resolve(repoRoot, "extensions/managed-worktrees.ts");
const protocolModulePath = resolve(repoRoot, "extensions/protocol-invocation.ts");
const indexPath = resolve(repoRoot, "extensions/index.ts");
const packageJsonPath = resolve(repoRoot, "package.json");
const readmePath = resolve(repoRoot, "README.md");
const executeSkillPath = resolve(repoRoot, "skills/execute/SKILL.md");

assert.ok(existsSync(helperModulePath), "extensions/execute-managed-bootstrap.ts must exist before execute auto-bootstrap validation");
assert.ok(existsSync(managedModulePath), "extensions/managed-worktrees.ts must exist before execute auto-bootstrap validation");
assert.ok(existsSync(protocolModulePath), "extensions/protocol-invocation.ts must exist before execute auto-bootstrap validation");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /extensions\/execute-managed-bootstrap\.ts/,
  "validate:extensions must syntax-check the execute managed-bootstrap helper seam",
);
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /tests\/extensions\/validate-execute-auto-bootstrap\.mjs/,
  "validate:extensions must include execute auto-bootstrap validation",
);
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /tests\/extensions\/validate-managed-worktree-bootstrap\.mjs/,
  "validate:extensions must keep managed bootstrap validation in the same chain",
);
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /tests\/extensions\/validate-managed-mutation-gate\.mjs/,
  "validate:extensions must keep mutation-gate validation in the same chain",
);
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /tests\/extensions\/validate-protocol-invocation\.mjs/,
  "validate:extensions must keep protocol invocation validation in the same chain",
);

const helperSource = readFileSync(helperModulePath, "utf-8");
const indexSource = readFileSync(indexPath, "utf-8");
const readmeSource = readFileSync(readmePath, "utf-8");
const executeSkillSource = readFileSync(executeSkillPath, "utf-8");

for (const marker of [
  'export function decideManagedExecuteStartup(options: {',
  'export function evaluateDirtyExecuteBootstrap(options: {',
  'export function planManagedExecuteResume(options: {',
  'return `/${commandName} ${payload}`;',
]) {
  assert.ok(helperSource.includes(marker), `extensions/execute-managed-bootstrap.ts missing execute auto-bootstrap helper marker: ${marker}`);
}

for (const marker of [
  'decideManagedExecuteStartup({',
  'evaluateDirtyExecuteBootstrap({',
  'planManagedExecuteResume({',
  'decodeManagedWorktreeBootstrapRequest(args.trim())',
]) {
  assert.ok(indexSource.includes(marker), `extensions/index.ts must wire execute auto-bootstrap through the helper seam: ${marker}`);
}

for (const forbiddenDocMarker of [
  "/worktree-new",
  "harness_prepare_managed_workspace",
  "harness-internal-managed-worktree-create",
]) {
  assert.ok(!readmeSource.includes(forbiddenDocMarker), `README.md must not advertise ${forbiddenDocMarker} as a public execute workflow`);
  assert.ok(!executeSkillSource.includes(forbiddenDocMarker), `skills/execute/SKILL.md must not advertise ${forbiddenDocMarker} as a public execute workflow`);
}

const importTempRoot = await mkdtemp(join(tmpdir(), "harness-execute-bootstrap-import-"));
const patchedHelperModulePath = join(importTempRoot, "execute-managed-bootstrap.importable.ts");
await writeFile(
  patchedHelperModulePath,
  readFileSync(helperModulePath, "utf-8").replace(
    '"./managed-worktrees.js"',
    `"${pathToFileURL(managedModulePath).href}"`,
  ),
  "utf-8",
);

const helperModule = await import(pathToFileURL(patchedHelperModulePath).href);
const managedModule = await import(pathToFileURL(managedModulePath).href);
const protocolModule = await import(pathToFileURL(protocolModulePath).href);

const {
  buildManagedExecuteBootstrapCommand,
  decodeManagedWorktreeBootstrapRequest,
  decideManagedExecuteStartup,
  evaluateDirtyExecuteBootstrap,
  planManagedExecuteResume,
} = helperModule;
const {
  INTERNAL_MANAGED_WORKTREE_COMMAND,
  MANAGED_EXECUTE_RESUME_CONSUMED_CUSTOM_TYPE,
  MANAGED_EXECUTE_RESUME_CUSTOM_TYPE,
  MANAGED_SESSION_BINDING_CUSTOM_TYPE,
  buildManagedBranchName,
  createManagedExecuteResumeRequest,
  createManagedSessionBinding,
  createManagedWorktreeLease,
  parseGitWorktreeList,
  readPendingManagedExecuteResume,
  resolveCanonicalRepoRoot,
  resolveGitCommonDir,
  resolveManagedWorktreeRoot,
  writeManagedSessionFile,
  writeManagedWorktreeLease,
} = managedModule;
const { parseHarnessProtocolInvocation } = protocolModule;

assert.equal(typeof buildManagedExecuteBootstrapCommand, "function", "buildManagedExecuteBootstrapCommand export must exist");
assert.equal(typeof decodeManagedWorktreeBootstrapRequest, "function", "decodeManagedWorktreeBootstrapRequest export must exist");
assert.equal(typeof decideManagedExecuteStartup, "function", "decideManagedExecuteStartup export must exist");
assert.equal(typeof evaluateDirtyExecuteBootstrap, "function", "evaluateDirtyExecuteBootstrap export must exist");
assert.equal(typeof planManagedExecuteResume, "function", "planManagedExecuteResume export must exist");
assert.equal(
  parseHarnessProtocolInvocation("/new"),
  undefined,
  "execute auto-bootstrap must not intercept or rewrite built-in /new",
);

const bootstrapDecision = decideManagedExecuteStartup({
  argsText: ".iteration-11-criteria.md",
  reuseManagedWorkspace: false,
  commandName: INTERNAL_MANAGED_WORKTREE_COMMAND,
});
assert.equal(bootstrapDecision.mode, "bootstrap", "unmanaged /execute must route through managed-worktree bootstrap");
assert.equal(bootstrapDecision.preservePendingInvocation, false, "bootstrap routing must clear the pending execute invocation until after the session switch");
assert.equal(bootstrapDecision.notification, "Preparing a managed worktree for /execute before implementation begins.");
assert.ok(
  bootstrapDecision.transformedText.startsWith(`/${INTERNAL_MANAGED_WORKTREE_COMMAND} `),
  "bootstrap routing must return the internal managed-worktree command transform",
);
assert.deepEqual(
  decodeManagedWorktreeBootstrapRequest(bootstrapDecision.transformedText.slice(`/${INTERNAL_MANAGED_WORKTREE_COMMAND} `.length)),
  {
    headOnlyFromDirty: false,
    resumeExecuteArgsText: ".iteration-11-criteria.md",
  },
  "bootstrap routing must preserve the original /execute criteria arguments in the encoded internal request",
);
assert.equal(
  buildManagedExecuteBootstrapCommand(".iteration-11-criteria.md"),
  bootstrapDecision.transformedText,
  "bootstrap command reconstruction must stay deterministic for validation-backed routing",
);

const reuseDecision = decideManagedExecuteStartup({
  argsText: ".iteration-11-criteria.md",
  reuseManagedWorkspace: true,
  currentManagedWorktreeId: "wt-123",
  commandName: INTERNAL_MANAGED_WORKTREE_COMMAND,
});
assert.deepEqual(
  reuseDecision,
  {
    mode: "reuse",
    transformedText: "/skill:execute .iteration-11-criteria.md",
    notification: "Reusing managed worktree wt-123 for /execute.",
    preservePendingInvocation: true,
  },
  "valid managed /execute sessions must stay in place and reuse the current managed workspace instead of re-bootstrapping",
);

assert.deepEqual(
  evaluateDirtyExecuteBootstrap({ hasDirtyChanges: false }),
  { action: "proceed", headOnlyFromDirty: false },
  "clean execute startup must proceed without extra confirmation",
);
assert.deepEqual(
  evaluateDirtyExecuteBootstrap({ hasDirtyChanges: true }),
  {
    action: "confirm",
    headOnlyFromDirty: false,
    title: "Dirty checkout",
    message: "The current checkout has uncommitted changes. They will not be carried into the managed worktree. Continue /execute from HEAD only?",
  },
  "dirty unmanaged execute startup must require explicit HEAD-only confirmation",
);
assert.deepEqual(
  evaluateDirtyExecuteBootstrap({ hasDirtyChanges: true, confirmed: false }),
  {
    action: "cancel",
    headOnlyFromDirty: false,
    notification: "Managed worktree bootstrap cancelled: the current checkout is dirty, and uncommitted changes are not carried into the new worktree. Re-run with explicit HEAD-only confirmation.",
  },
  "declining the dirty execute confirmation must cancel bootstrap without implying edit carryover",
);
assert.deepEqual(
  evaluateDirtyExecuteBootstrap({ hasDirtyChanges: true, confirmed: true }),
  { action: "proceed", headOnlyFromDirty: true },
  "accepting the dirty execute confirmation must continue explicitly from HEAD only",
);

const pendingResume = createManagedExecuteResumeRequest(".iteration-11-criteria.md", {
  sourceSessionFile: "/tmp/source-session.jsonl",
  requestId: "resume-1",
});
assert.deepEqual(
  planManagedExecuteResume({
    pendingResume,
    currentManagedWorktreeId: "wt-123",
    leaseLifecycleState: "managed-active",
  }),
  {
    action: "resume",
    notification: "Resuming /execute in managed worktree wt-123.",
    commandText: "/execute .iteration-11-criteria.md",
    consumedRequestId: "resume-1",
  },
  "an active managed session must replay the visible /execute entrypoint exactly once after the session switch",
);
assert.deepEqual(
  planManagedExecuteResume({
    pendingResume,
    currentManagedWorktreeId: "wt-123",
    leaseLifecycleState: "managed-missing",
  }),
  {
    action: "warn",
    notification: "Cannot resume /execute automatically because the managed workspace is not active.",
  },
  "a missing or non-active managed workspace must fail resume explicitly instead of partially continuing",
);
assert.deepEqual(
  planManagedExecuteResume({}),
  { action: "skip" },
  "session_start with no pending execute-resume marker must be inert",
);

function runGit(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function listWorktrees(repoPath) {
  return parseGitWorktreeList(runGit(["-C", repoPath, "worktree", "list", "--porcelain"]));
}

function readJsonl(filePath) {
  const text = readFileSync(filePath, "utf-8").trim();
  return text ? text.split("\n").map((line) => JSON.parse(line)) : [];
}

const tempRoot = await mkdtemp(join(tmpdir(), "harness-execute-auto-bootstrap-"));
const tempRepo = join(tempRoot, "repo");

try {
  runGit(["init", tempRepo], { stdio: "ignore" });
  runGit(["-C", tempRepo, "config", "user.email", "harness@example.com"]);
  runGit(["-C", tempRepo, "config", "user.name", "Harness Test"]);
  await mkdir(join(tempRepo, "packages", "app"), { recursive: true });
  await writeFile(join(tempRepo, "packages", "app", "index.ts"), "export const value = 1;\n", "utf-8");
  runGit(["-C", tempRepo, "add", "."]);
  runGit(["-C", tempRepo, "commit", "-m", "init"], { stdio: "ignore" });

  const repoRootOutput = runGit(["-C", tempRepo, "rev-parse", "--show-toplevel"]).trim();
  const gitCommonDir = resolveGitCommonDir(
    repoRootOutput,
    runGit(["-C", tempRepo, "rev-parse", "--path-format=absolute", "--git-common-dir"]),
  );
  const canonicalRepoRoot = resolveCanonicalRepoRoot(repoRootOutput, gitCommonDir);
  const worktreeId = "execute-runtime-smoke";
  const branch = buildManagedBranchName(worktreeId);
  const worktreeRoot = resolveManagedWorktreeRoot(canonicalRepoRoot, worktreeId);

  await writeFile(join(tempRepo, "packages", "app", "index.ts"), "export const value = 2;\n", "utf-8");
  const dirtyOutcome = evaluateDirtyExecuteBootstrap({ hasDirtyChanges: true, confirmed: true });
  assert.equal(dirtyOutcome.headOnlyFromDirty, true, "dirty execute runtime smoke must proceed only after explicit HEAD-only confirmation");

  runGit(["-C", repoRootOutput, "worktree", "add", "-b", branch, worktreeRoot, "HEAD"], { stdio: "ignore" });
  assert.equal(listWorktrees(repoRootOutput).length, 2, "runtime smoke must allocate a managed worktree when bootstrap proceeds");
  assert.equal(
    readFileSync(join(worktreeRoot, "packages", "app", "index.ts"), "utf-8"),
    "export const value = 1;\n",
    "HEAD-only execute bootstrap must leave the dirty source edit behind and keep the managed worktree clean",
  );

  const lease = createManagedWorktreeLease({
    worktreeId,
    worktreePath: worktreeRoot,
    targetCwd: worktreeRoot,
    branch,
    repoRoot: repoRootOutput,
    gitCommonDir,
    baseCommit: runGit(["-C", repoRootOutput, "rev-parse", "HEAD"]).trim(),
    lifecycleState: "managed-active",
  });
  await writeManagedWorktreeLease(lease);

  const binding = createManagedSessionBinding(lease);
  const executeResume = createManagedExecuteResumeRequest(".iteration-11-criteria.md", {
    sourceSessionFile: join(tempRepo, ".pi", "sessions", "source.jsonl"),
    requestId: "runtime-resume-1",
  });
  const sessionFile = await writeManagedSessionFile({
    cwd: worktreeRoot,
    sessionDir: join(worktreeRoot, ".pi", "sessions"),
    binding,
    customEntries: [{ customType: MANAGED_EXECUTE_RESUME_CUSTOM_TYPE, data: executeResume }],
  });

  const sessionEntries = readJsonl(sessionFile);
  const bindingEntry = sessionEntries.find((entry) => entry.customType === MANAGED_SESSION_BINDING_CUSTOM_TYPE);
  const pendingEntry = sessionEntries.find((entry) => entry.customType === MANAGED_EXECUTE_RESUME_CUSTOM_TYPE);
  assert.ok(bindingEntry, "runtime smoke must persist the managed binding into the target session file before the switch boundary");
  assert.ok(pendingEntry, "runtime smoke must persist the pending execute-resume marker into the target session file before the switch boundary");
  assert.deepEqual(
    readPendingManagedExecuteResume(sessionEntries),
    executeResume,
    "session_start resume logic must be able to recover the pending /execute context from the switched session file",
  );

  assert.deepEqual(
    planManagedExecuteResume({
      pendingResume: executeResume,
      currentManagedWorktreeId: worktreeId,
      leaseLifecycleState: "managed-active",
    }),
    {
      action: "resume",
      notification: `Resuming /execute in managed worktree ${worktreeId}.`,
      commandText: "/execute .iteration-11-criteria.md",
      consumedRequestId: "runtime-resume-1",
    },
    "runtime smoke must replay the original /execute criteria in the active managed session after the switch",
  );

  const consumedEntries = [
    ...sessionEntries,
    {
      type: "custom",
      customType: MANAGED_EXECUTE_RESUME_CONSUMED_CUSTOM_TYPE,
      data: { requestId: executeResume.requestId },
    },
  ];
  assert.equal(
    readPendingManagedExecuteResume(consumedEntries),
    undefined,
    "a consumed execute-resume marker must suppress duplicate /execute replay on later session_start events",
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

await rm(importTempRoot, { recursive: true, force: true });

console.log("validate:execute-auto-bootstrap passed");
