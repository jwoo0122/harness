import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const modulePath = resolve(repoRoot, "extensions/managed-worktrees.ts");
const indexPath = resolve(repoRoot, "extensions/index.ts");
const packageJsonPath = resolve(repoRoot, "package.json");

assert.ok(existsSync(modulePath), "extensions/managed-worktrees.ts must exist before lifecycle validation");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /tests\/extensions\/validate-managed-worktree-lifecycle\.mjs/,
  "validate:extensions must include managed-worktree lifecycle validation",
);

const indexSource = readFileSync(indexPath, "utf-8");
for (const marker of [
  'await reconcileManagedSessionBinding(ctx);',
  'pi.on("session_shutdown"',
  'await softReleaseManagedLease();',
  'await refreshManagedLeaseHeartbeat();',
  'Managed worktree:',
  'Managed state:',
  'ctx.ui.setStatus("harness", `🧱 WT ${getManagedStatusSummary()}`);',
]) {
  assert.ok(indexSource.includes(marker), `extensions/index.ts missing lifecycle marker: ${marker}`);
}

const managedModule = await import(pathToFileURL(modulePath).href);
const {
  createManagedSessionBinding,
  createManagedWorktreeLease,
  readManagedSessionBinding,
  refreshManagedLease,
  writeManagedSessionFile,
} = managedModule;

const tempRoot = await mkdtemp(join(tmpdir(), "harness-managed-lifecycle-"));
const worktreeRoot = join(tempRoot, "worktree");
const sessionDir = join(tempRoot, "sessions");
const gitCommonDir = join(tempRoot, ".git");

try {
  const lease = createManagedWorktreeLease({
    worktreeId: "life-1",
    worktreePath: worktreeRoot,
    targetCwd: join(worktreeRoot, "src"),
    branch: "harness/wt/life-1",
    repoRoot: worktreeRoot,
    gitCommonDir,
    baseCommit: "abc123",
    lifecycleState: "provisioning",
    now: new Date("2026-04-19T12:00:00.000Z"),
  });
  const binding = createManagedSessionBinding(lease);
  const sessionFile = await writeManagedSessionFile({
    cwd: binding.targetCwd,
    sessionDir,
    binding,
    parentSession: "/tmp/source-session.jsonl",
  });

  const sessionEntries = readFileSync(sessionFile, "utf-8").trim().split("\n").slice(1).map((line) => JSON.parse(line));
  const restoredBinding = readManagedSessionBinding(sessionEntries);
  const { sessionFile: _expectedSessionFile, ...expectedBinding } = binding;
  const { sessionFile: _actualSessionFile, ...actualBinding } = restoredBinding ?? {};
  assert.deepEqual(actualBinding, expectedBinding, "managed session binding must survive session-file round-trip");

  const activeLease = refreshManagedLease(lease, "managed-active", new Date("2026-04-19T13:00:00.000Z"));
  assert.equal(activeLease.lifecycleState, "managed-active", "session_start reconciliation must be able to activate the lease");
  assert.ok(Date.parse(activeLease.lastSeenAt) > Date.parse(lease.lastSeenAt), "lease heartbeat must advance lastSeenAt");

  const releasedLease = refreshManagedLease(activeLease, "managed-released", new Date("2026-04-19T14:00:00.000Z"));
  assert.equal(releasedLease.lifecycleState, "managed-released", "session_shutdown must soft-release the lease");
  assert.equal(typeof releasedLease.releasedAt, "string", "soft release must stamp releasedAt");

  const missingLease = refreshManagedLease(activeLease, "managed-missing", new Date("2026-04-19T15:00:00.000Z"));
  assert.equal(missingLease.lifecycleState, "managed-missing", "missing worktree reconciliation must move the lease to managed-missing");
  assert.equal(typeof missingLease.missingSince, "string", "missing worktree reconciliation must stamp missingSince");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("validate:managed-worktree-lifecycle passed");
