import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const modulePath = resolve(repoRoot, "extensions/managed-worktree-presentation.ts");
const indexPath = resolve(repoRoot, "extensions/index.ts");
const packageJsonPath = resolve(repoRoot, "package.json");

assert.ok(existsSync(modulePath), "extensions/managed-worktree-presentation.ts must exist before managed-worktree identity UI validation");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /extensions\/managed-worktree-presentation\.ts/,
  "validate:extensions must syntax-check extensions/managed-worktree-presentation.ts",
);
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /tests\/extensions\/validate-managed-worktree-identity-ui\.mjs/,
  "validate:extensions must include managed-worktree identity UI validation",
);

const moduleSource = readFileSync(modulePath, "utf-8");
const indexSource = readFileSync(indexPath, "utf-8");

for (const forbiddenImport of ["@mariozechner/", "@sinclair/typebox", "./index"]) {
  assert.ok(!moduleSource.includes(forbiddenImport), `extensions/managed-worktree-presentation.ts must not import ${forbiddenImport}`);
}

assert.ok(
  indexSource.includes('from "./managed-worktree-presentation.js"'),
  "extensions/index.ts must import the managed-worktree presentation seam",
);
assert.ok(
  indexSource.includes('deriveManagedWorktreePresentation({'),
  "extensions/index.ts must derive managed-worktree presentation from current binding/lease/cwd",
);
assert.ok(
  indexSource.includes('ctx.ui.setWidget("harness", widgetLines, { placement: "belowEditor" });'),
  "updateUI must render the managed-worktree identity widget below the editor",
);
assert.ok(
  indexSource.includes('ctx.ui.setStatus("harness", `🧱 WT ${managedStatus}`);'),
  "updateUI must retain the compact managed-worktree status fallback",
);
assert.ok(
  indexSource.includes('⚙️ EXECUTE'),
  "updateUI must compose managed identity into execute-mode status where applicable",
);
assert.ok(
  !indexSource.includes('🧠 EXPLORE'),
  "updateUI must not restore the removed explore status copy",
);
assert.ok(
  indexSource.includes('updateUI(ctx);\n\n    if (!isExploreRuntime() || !exploreChain.active) return;'),
  "turn_end must refresh the managed-worktree UI from current cwd context before explore gating returns",
);
assert.ok(
  !indexSource.includes("setFooter("),
  "managed-worktree identity UI must not take over the footer",
);

const presentationModule = await import(pathToFileURL(modulePath).href);
const {
  deriveManagedWorktreePresentation,
  renderManagedWorktreeStatusText,
  renderManagedWorktreeWidgetLines,
} = presentationModule;

assert.equal(typeof deriveManagedWorktreePresentation, "function", "deriveManagedWorktreePresentation export must exist");
assert.equal(typeof renderManagedWorktreeStatusText, "function", "renderManagedWorktreeStatusText export must exist");
assert.equal(typeof renderManagedWorktreeWidgetLines, "function", "renderManagedWorktreeWidgetLines export must exist");

function createBinding(overrides = {}) {
  return {
    schema: "harness-managed-session-binding/v1",
    managed: true,
    worktreeId: "wt-123",
    worktreePath: resolve("/repo/.worktrees/project/wt-123"),
    targetCwd: resolve("/repo/.worktrees/project/wt-123"),
    branch: "harness/wt/wt-123",
    repoRoot: resolve("/repo/project"),
    gitCommonDir: resolve("/repo/project/.git"),
    leaseFile: resolve("/repo/project/.git/pi-harness/worktrees/wt-123.json"),
    ...overrides,
  };
}

function createLease(binding, lifecycleState, overrides = {}) {
  return {
    schema: "harness-managed-worktree/v1",
    managed: true,
    worktreeId: binding.worktreeId,
    worktreePath: binding.worktreePath,
    targetCwd: binding.targetCwd,
    branch: binding.branch,
    repoRoot: binding.repoRoot,
    gitCommonDir: binding.gitCommonDir,
    baseCommit: "abc123",
    leaseFile: binding.leaseFile,
    lastSeenAt: "2026-04-20T03:00:00.000Z",
    leaseExpiresAt: "2026-04-21T03:00:00.000Z",
    lifecycleState,
    createdAt: "2026-04-20T02:00:00.000Z",
    ...overrides,
  };
}

const unmanaged = deriveManagedWorktreePresentation({ cwd: resolve("/repo/project") });
assert.equal(unmanaged.state, "unmanaged", "no binding must remain unmanaged");
assert.equal(renderManagedWorktreeStatusText(unmanaged), undefined, "unmanaged sessions must not render compact status text");
assert.equal(renderManagedWorktreeWidgetLines(unmanaged), undefined, "unmanaged sessions must not render a managed widget");

const rootBinding = createBinding();
const activeRootLease = createLease(rootBinding, "managed-active");
const healthyRoot = deriveManagedWorktreePresentation({
  binding: rootBinding,
  lease: activeRootLease,
  cwd: rootBinding.worktreePath,
  worktreePathExists: true,
});
assert.equal(healthyRoot.state, "healthy", "managed-active root must render as healthy");
assert.equal(healthyRoot.location?.kind, "root", "healthy root case must label the managed root explicitly");
assert.equal(healthyRoot.location?.label, "root", "healthy root case must render root explicitly");
assert.equal(renderManagedWorktreeStatusText(healthyRoot), "wt-123 · root", "healthy root status must include identity and location");
assert.deepEqual(
  renderManagedWorktreeWidgetLines(healthyRoot),
  ["🧱 Managed WT wt-123 · root"],
  "healthy root widget must stay concise and identity-first",
);
assert.ok(
  !renderManagedWorktreeWidgetLines(healthyRoot)?.join("\n").includes(rootBinding.worktreePath),
  "healthy widget must not depend on the absolute worktree path by default",
);
assert.ok(
  !renderManagedWorktreeWidgetLines(healthyRoot)?.join("\n").includes(rootBinding.branch),
  "healthy widget must not depend on the full managed branch name by default",
);

const entryBinding = createBinding({
  targetCwd: join(rootBinding.worktreePath, "src"),
});
const activeEntryLease = createLease(entryBinding, "managed-active");
const healthyEntry = deriveManagedWorktreePresentation({
  binding: entryBinding,
  lease: activeEntryLease,
  cwd: entryBinding.targetCwd,
  worktreePathExists: true,
});
assert.equal(healthyEntry.state, "healthy", "entry cwd inside a managed-active worktree must be healthy");
assert.equal(healthyEntry.location?.kind, "entry", "entry cwd must be distinguished from generic nested paths");
assert.equal(healthyEntry.location?.label, "entry src", "entry cwd must stay explicit and readable");
assert.equal(renderManagedWorktreeStatusText(healthyEntry), "wt-123 · entry src", "entry location must flow into compact status text");
assert.deepEqual(
  renderManagedWorktreeWidgetLines(healthyEntry),
  ["🧱 Managed WT wt-123 · entry src"],
  "entry location widget must remain concise and identity-first",
);

const healthyNested = deriveManagedWorktreePresentation({
  binding: entryBinding,
  lease: activeEntryLease,
  cwd: join(entryBinding.targetCwd, "lib"),
  worktreePathExists: true,
});
assert.equal(healthyNested.state, "healthy", "nested cwd under the managed target must remain healthy");
assert.equal(healthyNested.location?.kind, "nested", "nested cwd must be distinguished from root and entry states");
assert.equal(healthyNested.location?.label, "src/lib", "nested cwd must render relative location within the worktree");
assert.equal(renderManagedWorktreeStatusText(healthyNested), "wt-123 · src/lib", "nested cwd must update compact status text from current cwd");
assert.deepEqual(
  renderManagedWorktreeWidgetLines(healthyNested),
  ["🧱 Managed WT wt-123 · src/lib"],
  "nested cwd widget must include both identity and relative location",
);

const outsideTarget = deriveManagedWorktreePresentation({
  binding: entryBinding,
  lease: activeEntryLease,
  cwd: entryBinding.worktreePath,
  worktreePathExists: true,
});
assert.equal(outsideTarget.state, "degraded", "cwd outside the bound target cwd must degrade the managed presentation");
assert.equal(outsideTarget.reason, "outside-target-cwd", "outside-target degradation must be explicit in the model");
assert.equal(outsideTarget.severity, "warning", "outside-target degradation must be visibly different from healthy state");
assert.deepEqual(
  renderManagedWorktreeWidgetLines(outsideTarget),
  [
    "⚠️ Managed WT wt-123 · root",
    "Writes blocked outside entry src.",
  ],
  "outside-target widget must keep the location visible and explain that writes are blocked",
);
assert.equal(
  renderManagedWorktreeStatusText(outsideTarget),
  "wt-123 · blocked · root",
  "outside-target compact status must remain short while marking the state blocked",
);

const provisioning = deriveManagedWorktreePresentation({
  binding: rootBinding,
  lease: createLease(rootBinding, "provisioning"),
  cwd: rootBinding.worktreePath,
  worktreePathExists: true,
});
assert.equal(provisioning.state, "degraded", "provisioning must not render like a healthy managed workspace");
assert.equal(provisioning.reason, "provisioning", "provisioning must stay explicit in the presentation model");
assert.deepEqual(
  renderManagedWorktreeWidgetLines(provisioning),
  [
    "⚠️ Managed WT wt-123 · provisioning",
    "Writes blocked until the workspace is ready.",
  ],
  "provisioning widget must be visibly degraded and explain the blocked consequence",
);
assert.equal(renderManagedWorktreeStatusText(provisioning), "wt-123 · provisioning", "provisioning compact status must remain available");

const released = deriveManagedWorktreePresentation({
  binding: rootBinding,
  lease: createLease(rootBinding, "managed-released"),
  cwd: rootBinding.worktreePath,
  worktreePathExists: true,
});
assert.deepEqual(
  renderManagedWorktreeWidgetLines(released),
  [
    "⚠️ Managed WT wt-123 · released",
    "Writes blocked until a new managed session is prepared.",
  ],
  "released worktrees must stay in the same widget surface with explicit blocked copy",
);
assert.equal(renderManagedWorktreeStatusText(released), "wt-123 · released", "released worktrees must keep compact status visibility");

const missing = deriveManagedWorktreePresentation({
  binding: rootBinding,
  lease: createLease(rootBinding, "managed-missing"),
  cwd: rootBinding.worktreePath,
  worktreePathExists: true,
});
assert.equal(missing.severity, "error", "managed-missing must escalate severity beyond healthy/warning copy");
assert.deepEqual(
  renderManagedWorktreeWidgetLines(missing),
  [
    "⛔ Managed WT wt-123 · path missing",
    "Writes blocked: managed worktree state is missing from disk.",
  ],
  "managed-missing widget must fail loudly and specifically",
);
assert.equal(renderManagedWorktreeStatusText(missing), "wt-123 · missing", "managed-missing compact status must remain short and explicit");

const cleanupRequired = deriveManagedWorktreePresentation({
  binding: rootBinding,
  lease: createLease(rootBinding, "manual-cleanup-required"),
  cwd: rootBinding.worktreePath,
  worktreePathExists: true,
});
assert.deepEqual(
  renderManagedWorktreeWidgetLines(cleanupRequired),
  [
    "⚠️ Managed WT wt-123 · cleanup required",
    "Writes blocked until manual cleanup is resolved.",
  ],
  "manual cleanup required must stay explicit in the managed widget surface",
);
assert.equal(renderManagedWorktreeStatusText(cleanupRequired), "wt-123 · cleanup", "manual cleanup required must keep a compact status fallback");

const bindingOnly = deriveManagedWorktreePresentation({
  binding: rootBinding,
  cwd: rootBinding.worktreePath,
  worktreePathExists: true,
});
assert.equal(bindingOnly.lifecycleState, "binding-only", "missing lease must degrade via an explicit binding-only lifecycle state");
assert.equal(bindingOnly.reason, "lease-missing", "missing lease must stay explicit in the presentation model");
assert.deepEqual(
  renderManagedWorktreeWidgetLines(bindingOnly),
  [
    "⚠️ Managed WT wt-123 · lease missing",
    "Writes blocked: managed lease metadata is missing.",
  ],
  "missing lease must be distinguishable from healthy managed-active copy",
);
assert.equal(renderManagedWorktreeStatusText(bindingOnly), "wt-123 · lease missing", "missing lease must still produce compact status text");

const missingPath = deriveManagedWorktreePresentation({
  binding: rootBinding,
  lease: activeRootLease,
  cwd: rootBinding.worktreePath,
  worktreePathExists: false,
});
assert.equal(missingPath.reason, "worktree-path-missing", "missing worktree paths must surface an explicit degraded reason");
assert.equal(missingPath.severity, "error", "missing worktree paths must fail loudly");
assert.deepEqual(
  renderManagedWorktreeWidgetLines(missingPath),
  [
    "⛔ Managed WT wt-123 · path missing",
    `Writes blocked: missing ${rootBinding.worktreePath}.`,
  ],
  "missing worktree paths must mention the missing path rather than silently degrading to generic cwd copy",
);
assert.equal(renderManagedWorktreeStatusText(missingPath), "wt-123 · missing", "missing worktree paths must still preserve compact status identity");
assert.ok(
  Array.isArray(renderManagedWorktreeWidgetLines(healthyNested)),
  "managed-worktree widget rendering must stay RPC-compatible via plain string arrays",
);

console.log("validate:managed-worktree-identity-ui passed");
