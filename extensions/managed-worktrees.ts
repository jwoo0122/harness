import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const MANAGED_BRANCH_PREFIX = "harness/wt/";
export const MANAGED_WORKTREE_SCHEMA = "harness-managed-worktree/v1";
export const MANAGED_SESSION_BINDING_SCHEMA = "harness-managed-session-binding/v1";
export const MANAGED_SESSION_BINDING_CUSTOM_TYPE = "harness-managed-worktree-binding";
export const MANAGED_EXECUTE_RESUME_SCHEMA = "harness-managed-execute-resume/v1";
export const MANAGED_EXECUTE_RESUME_CUSTOM_TYPE = "harness-managed-execute-resume";
export const MANAGED_EXECUTE_RESUME_CONSUMED_CUSTOM_TYPE = "harness-managed-execute-resume-consumed";
export const MANAGED_LEASE_DIRECTORY = "pi-harness/worktrees";
export const INTERNAL_MANAGED_WORKTREE_COMMAND = "harness-internal-managed-worktree-create";
export const INTERNAL_MANAGED_WORKTREE_TOOL = "harness_prepare_managed_workspace";
export const DEFAULT_MANAGED_LEASE_TTL_MS = 1000 * 60 * 60 * 24;

export type ManagedWorkspaceLifecycleState =
  | "unmanaged"
  | "provisioning"
  | "managed-active"
  | "managed-released"
  | "managed-missing"
  | "manual-cleanup-required";

export interface ManagedSessionBinding {
  schema: typeof MANAGED_SESSION_BINDING_SCHEMA;
  managed: true;
  worktreeId: string;
  worktreePath: string;
  targetCwd: string;
  branch: string;
  repoRoot: string;
  gitCommonDir: string;
  leaseFile: string;
  sessionFile?: string;
}

export interface ManagedWorktreeLease {
  schema: typeof MANAGED_WORKTREE_SCHEMA;
  managed: true;
  worktreeId: string;
  worktreePath: string;
  targetCwd: string;
  branch: string;
  repoRoot: string;
  gitCommonDir: string;
  baseCommit: string;
  leaseFile: string;
  sessionFile?: string;
  lastSeenAt: string;
  leaseExpiresAt: string;
  lifecycleState: ManagedWorkspaceLifecycleState;
  createdAt: string;
  releasedAt?: string;
  missingSince?: string;
}

export interface ManagedExecuteResumeRequest {
  schema: typeof MANAGED_EXECUTE_RESUME_SCHEMA;
  requestId: string;
  protocol: "execute";
  argsText: string;
  createdAt: string;
  sourceSessionFile?: string;
}

export interface ManagedSessionCustomEntry {
  customType: string;
  data?: unknown;
}

export interface GitWorktreeRecord {
  worktreePath: string;
  head?: string;
  branch?: string;
  locked?: boolean;
  prunable?: boolean;
  bare?: boolean;
}

export interface GitStatusEntry {
  status: string;
  path: string;
}

export interface ManagedMutationGateInput {
  required: boolean;
  cwd: string;
  binding?: ManagedSessionBinding;
  lease?: ManagedWorktreeLease;
  liveWorktreePath?: string;
  liveBranch?: string;
}

export interface ManagedMutationGateResult {
  allowed: boolean;
  reason?: string;
}

export interface ManagedJanitorDecisionInput {
  lease: ManagedWorktreeLease;
  now?: Date;
  currentBindingId?: string;
  worktreeRecord?: GitWorktreeRecord;
  clean: boolean;
  uniqueCommitCount: number;
}

export interface ManagedJanitorDecision {
  remove: boolean;
  reason: string;
  nextState?: ManagedWorkspaceLifecycleState;
}

export interface ManagedSessionFileOptions {
  cwd: string;
  sessionDir: string;
  parentSession?: string;
  binding?: ManagedSessionBinding;
  customEntries?: ManagedSessionCustomEntry[];
  now?: Date;
}

function createShortEntryId(): string {
  return randomUUID().slice(0, 8);
}

function formatTimestampForFile(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

function normalizeAbsolutePath(path: string): string {
  return resolve(path);
}

export function createManagedWorktreeId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

export function buildManagedBranchName(id: string): string {
  return `${MANAGED_BRANCH_PREFIX}${id}`;
}

export function isHarnessManagedBranch(branch: string | undefined): boolean {
  return typeof branch === "string" && branch.startsWith(MANAGED_BRANCH_PREFIX);
}

export function isPathInside(parentPath: string, childPath: string): boolean {
  const parent = normalizeAbsolutePath(parentPath);
  const child = normalizeAbsolutePath(childPath);
  if (parent === child) return true;
  return child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}

export function resolveGitCommonDir(repoRoot: string, gitCommonDirOutput: string): string {
  const trimmed = gitCommonDirOutput.trim();
  if (!trimmed) throw new Error("git common dir output was empty");
  return isAbsolute(trimmed)
    ? normalizeAbsolutePath(trimmed)
    : normalizeAbsolutePath(resolve(repoRoot, trimmed));
}

export function resolveCanonicalRepoRoot(repoRoot: string, gitCommonDir: string): string {
  if (basename(gitCommonDir) === ".git") {
    return normalizeAbsolutePath(dirname(gitCommonDir));
  }
  return normalizeAbsolutePath(repoRoot);
}

export function resolveManagedWorktreeRoot(canonicalRepoRoot: string, worktreeId: string): string {
  return normalizeAbsolutePath(join(dirname(canonicalRepoRoot), ".worktrees", basename(canonicalRepoRoot), worktreeId));
}

export function resolveRepoRelativePath(repoRoot: string, cwd: string): string {
  const rel = relative(normalizeAbsolutePath(repoRoot), normalizeAbsolutePath(cwd));
  if (!rel || rel === "") return ".";
  if (rel.startsWith("..") || isAbsolute(rel)) return ".";
  return rel;
}

export function resolveManagedTargetCwd(worktreeRoot: string, repoRoot: string, cwd: string): string {
  const repoRelativePath = resolveRepoRelativePath(repoRoot, cwd);
  return repoRelativePath === "."
    ? normalizeAbsolutePath(worktreeRoot)
    : normalizeAbsolutePath(join(worktreeRoot, repoRelativePath));
}

export function resolveTargetSessionDir(currentSessionDir: string, targetWorktreeRoot: string): string {
  return isAbsolute(currentSessionDir)
    ? normalizeAbsolutePath(currentSessionDir)
    : normalizeAbsolutePath(resolve(targetWorktreeRoot, currentSessionDir));
}

export function resolveSessionDirForCwd(sessionDir: string, cwd: string): string {
  return isAbsolute(sessionDir)
    ? normalizeAbsolutePath(sessionDir)
    : normalizeAbsolutePath(resolve(cwd, sessionDir));
}

export function resolveManagedLeaseDir(gitCommonDir: string): string {
  return normalizeAbsolutePath(join(gitCommonDir, MANAGED_LEASE_DIRECTORY));
}

export function resolveManagedLeaseFile(gitCommonDir: string, worktreeId: string): string {
  return normalizeAbsolutePath(join(resolveManagedLeaseDir(gitCommonDir), `${worktreeId}.json`));
}

export function createManagedSessionBinding(lease: ManagedWorktreeLease): ManagedSessionBinding {
  return {
    schema: MANAGED_SESSION_BINDING_SCHEMA,
    managed: true,
    worktreeId: lease.worktreeId,
    worktreePath: normalizeAbsolutePath(lease.worktreePath),
    targetCwd: normalizeAbsolutePath(lease.targetCwd),
    branch: lease.branch,
    repoRoot: normalizeAbsolutePath(lease.repoRoot),
    gitCommonDir: normalizeAbsolutePath(lease.gitCommonDir),
    leaseFile: normalizeAbsolutePath(lease.leaseFile),
    sessionFile: lease.sessionFile ? normalizeAbsolutePath(lease.sessionFile) : undefined,
  };
}

export function createManagedWorktreeLease(input: {
  worktreeId: string;
  worktreePath: string;
  targetCwd: string;
  branch: string;
  repoRoot: string;
  gitCommonDir: string;
  baseCommit: string;
  sessionFile?: string;
  lifecycleState: ManagedWorkspaceLifecycleState;
  now?: Date;
  leaseTtlMs?: number;
}): ManagedWorktreeLease {
  const now = input.now ?? new Date();
  const leaseTtlMs = input.leaseTtlMs ?? DEFAULT_MANAGED_LEASE_TTL_MS;
  return {
    schema: MANAGED_WORKTREE_SCHEMA,
    managed: true,
    worktreeId: input.worktreeId,
    worktreePath: normalizeAbsolutePath(input.worktreePath),
    targetCwd: normalizeAbsolutePath(input.targetCwd),
    branch: input.branch,
    repoRoot: normalizeAbsolutePath(input.repoRoot),
    gitCommonDir: normalizeAbsolutePath(input.gitCommonDir),
    baseCommit: input.baseCommit,
    leaseFile: resolveManagedLeaseFile(input.gitCommonDir, input.worktreeId),
    sessionFile: input.sessionFile ? normalizeAbsolutePath(input.sessionFile) : undefined,
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    leaseExpiresAt: new Date(now.getTime() + leaseTtlMs).toISOString(),
    lifecycleState: input.lifecycleState,
  };
}

export function refreshManagedLease(
  lease: ManagedWorktreeLease,
  lifecycleState: ManagedWorkspaceLifecycleState,
  now = new Date(),
  leaseTtlMs = DEFAULT_MANAGED_LEASE_TTL_MS,
): ManagedWorktreeLease {
  return {
    ...lease,
    lastSeenAt: now.toISOString(),
    leaseExpiresAt: new Date(now.getTime() + leaseTtlMs).toISOString(),
    lifecycleState,
    releasedAt: lifecycleState === "managed-released" ? now.toISOString() : lease.releasedAt,
    missingSince: lifecycleState === "managed-missing"
      ? lease.missingSince ?? now.toISOString()
      : lease.missingSince,
  };
}

export function isManagedLeaseExpired(lease: ManagedWorktreeLease, now = new Date()): boolean {
  return Date.parse(lease.leaseExpiresAt) <= now.getTime();
}

export async function writeManagedWorktreeLease(lease: ManagedWorktreeLease): Promise<void> {
  const filePath = normalizeAbsolutePath(lease.leaseFile);
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${randomUUID()}`;
  await writeFile(tempPath, `${JSON.stringify(lease, null, 2)}\n`, "utf-8");
  await rename(tempPath, filePath);
}

export async function readManagedWorktreeLease(filePath: string): Promise<ManagedWorktreeLease | undefined> {
  try {
    const content = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    if (!isManagedWorktreeLease(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export async function deleteManagedWorktreeLease(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

export async function listManagedWorktreeLeaseFiles(gitCommonDir: string): Promise<string[]> {
  const leaseDir = resolveManagedLeaseDir(gitCommonDir);
  try {
    const entries = await readdir(leaseDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => join(leaseDir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

export function parseGitWorktreeList(text: string): GitWorktreeRecord[] {
  const blocks = text
    .trim()
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block) => {
    const record: GitWorktreeRecord = { worktreePath: "" };
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) {
        record.worktreePath = normalizeAbsolutePath(line.slice("worktree ".length).trim());
      } else if (line.startsWith("HEAD ")) {
        record.head = line.slice("HEAD ".length).trim();
      } else if (line.startsWith("branch ")) {
        const branchRef = line.slice("branch ".length).trim();
        record.branch = branchRef.replace(/^refs\/heads\//, "");
      } else if (line === "locked") {
        record.locked = true;
      } else if (line.startsWith("prunable")) {
        record.prunable = true;
      } else if (line === "bare") {
        record.bare = true;
      }
    }
    return record;
  }).filter((record) => Boolean(record.worktreePath));
}

export function findGitWorktreeRecord(records: GitWorktreeRecord[], worktreePath: string): GitWorktreeRecord | undefined {
  const target = normalizeAbsolutePath(worktreePath);
  return records.find((record) => normalizeAbsolutePath(record.worktreePath) === target);
}

export function parseGitStatusPorcelain(text: string): GitStatusEntry[] {
  return text
    .split(/\r?\n/g)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2);
      const remainder = line.slice(3).trim();
      const path = remainder.includes(" -> ")
        ? remainder.split(" -> ").at(-1) ?? remainder
        : remainder;
      return { status, path: path.replace(/^"|"$/g, "") };
    });
}

export function hasRelevantGitStatusChanges(
  statusText: string,
  repoRoot: string,
  ignoredAbsolutePaths: string[] = [],
): boolean {
  const repo = normalizeAbsolutePath(repoRoot);
  const ignored = ignoredAbsolutePaths.map((value) => normalizeAbsolutePath(value));

  return parseGitStatusPorcelain(statusText).some((entry) => {
    const absolutePath = normalizeAbsolutePath(join(repo, entry.path));
    return !ignored.some((ignoredPath) => isPathInside(ignoredPath, absolutePath));
  });
}

export function createManagedSessionFileName(now = new Date(), sessionId = randomUUID()): string {
  return `${formatTimestampForFile(now)}_${sessionId}.jsonl`;
}

export function createManagedExecuteResumeRequest(
  argsText: string,
  options?: { sourceSessionFile?: string; requestId?: string; now?: Date },
): ManagedExecuteResumeRequest {
  const now = options?.now ?? new Date();
  return {
    schema: MANAGED_EXECUTE_RESUME_SCHEMA,
    requestId: options?.requestId ?? randomUUID(),
    protocol: "execute",
    argsText: argsText.trim(),
    createdAt: now.toISOString(),
    sourceSessionFile: options?.sourceSessionFile ? normalizeAbsolutePath(options.sourceSessionFile) : undefined,
  };
}

export function buildManagedExecuteResumeCommand(request: ManagedExecuteResumeRequest): string {
  return request.argsText ? `/execute ${request.argsText}` : "/execute";
}

export function isManagedExecuteResumeRequest(value: unknown): value is ManagedExecuteResumeRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.schema === MANAGED_EXECUTE_RESUME_SCHEMA
    && candidate.protocol === "execute"
    && typeof candidate.requestId === "string"
    && typeof candidate.argsText === "string"
    && typeof candidate.createdAt === "string";
}

export function readPendingManagedExecuteResume(
  entries: Array<{ type: string; customType?: string; data?: unknown }>,
): ManagedExecuteResumeRequest | undefined {
  const consumedIds = new Set<string>();
  let latestPending: ManagedExecuteResumeRequest | undefined;

  for (const entry of entries) {
    if (entry.type !== "custom") continue;

    if (entry.customType === MANAGED_EXECUTE_RESUME_CONSUMED_CUSTOM_TYPE) {
      const requestId = typeof (entry.data as { requestId?: unknown } | undefined)?.requestId === "string"
        ? (entry.data as { requestId: string }).requestId
        : undefined;
      if (requestId) consumedIds.add(requestId);
      continue;
    }

    if (entry.customType === MANAGED_EXECUTE_RESUME_CUSTOM_TYPE && isManagedExecuteResumeRequest(entry.data)) {
      latestPending = entry.data;
    }
  }

  if (!latestPending) return undefined;
  return consumedIds.has(latestPending.requestId) ? undefined : latestPending;
}

export async function writeManagedSessionFile(options: ManagedSessionFileOptions): Promise<string> {
  const now = options.now ?? new Date();
  const sessionId = randomUUID();
  const sessionDir = normalizeAbsolutePath(options.sessionDir);
  const sessionFile = normalizeAbsolutePath(join(sessionDir, createManagedSessionFileName(now, sessionId)));
  const header = {
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: now.toISOString(),
    cwd: normalizeAbsolutePath(options.cwd),
    parentSession: options.parentSession,
  };

  const entries: any[] = [header];
  let parentId: string | null = null;

  if (options.binding) {
    const bindingEntryId = createShortEntryId();
    entries.push({
      type: "custom",
      id: bindingEntryId,
      parentId,
      timestamp: now.toISOString(),
      customType: MANAGED_SESSION_BINDING_CUSTOM_TYPE,
      data: options.binding,
    });
    parentId = bindingEntryId;
  }

  for (const customEntry of options.customEntries ?? []) {
    const entryId = createShortEntryId();
    entries.push({
      type: "custom",
      id: entryId,
      parentId,
      timestamp: now.toISOString(),
      customType: customEntry.customType,
      data: customEntry.data,
    });
    parentId = entryId;
  }

  await mkdir(sessionDir, { recursive: true });
  await writeFile(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf-8");
  return sessionFile;
}

export function readManagedSessionBinding(entries: Array<{ type: string; customType?: string; data?: unknown }>): ManagedSessionBinding | undefined {
  let latest: ManagedSessionBinding | undefined;
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== MANAGED_SESSION_BINDING_CUSTOM_TYPE) continue;
    if (isManagedSessionBinding(entry.data)) {
      latest = entry.data;
    }
  }
  return latest;
}

export function evaluateManagedMutationGate(input: ManagedMutationGateInput): ManagedMutationGateResult {
  if (!input.required) return { allowed: true };

  if (!input.binding) {
    return {
      allowed: false,
      reason: "Managed workspace binding required, but the current session has no managed-worktree binding.",
    };
  }

  if (!existsSync(input.binding.worktreePath)) {
    return {
      allowed: false,
      reason: `Managed worktree path is missing: ${input.binding.worktreePath}`,
    };
  }

  if (!input.lease) {
    return {
      allowed: false,
      reason: `Managed worktree lease is missing for ${input.binding.worktreeId}.`,
    };
  }

  if (input.lease.worktreeId !== input.binding.worktreeId) {
    return {
      allowed: false,
      reason: `Managed lease/binding mismatch: binding=${input.binding.worktreeId} lease=${input.lease.worktreeId}`,
    };
  }

  if (input.lease.lifecycleState !== "managed-active") {
    return {
      allowed: false,
      reason: `Managed worktree ${input.binding.worktreeId} is not mutable in lifecycle state ${input.lease.lifecycleState}.`,
    };
  }

  if (!isPathInside(input.binding.targetCwd, input.cwd)) {
    return {
      allowed: false,
      reason: `Current cwd ${normalizeAbsolutePath(input.cwd)} is outside the managed target cwd ${input.binding.targetCwd}.`,
    };
  }

  if (input.liveWorktreePath && normalizeAbsolutePath(input.liveWorktreePath) !== normalizeAbsolutePath(input.binding.worktreePath)) {
    return {
      allowed: false,
      reason: `Live worktree root ${normalizeAbsolutePath(input.liveWorktreePath)} does not match the bound managed worktree ${input.binding.worktreePath}.`,
    };
  }

  if (input.liveBranch && input.liveBranch !== input.binding.branch) {
    return {
      allowed: false,
      reason: `Live branch ${input.liveBranch} does not match the bound managed branch ${input.binding.branch}.`,
    };
  }

  return { allowed: true };
}

export function evaluateManagedJanitorDecision(input: ManagedJanitorDecisionInput): ManagedJanitorDecision {
  const now = input.now ?? new Date();
  const { lease } = input;

  if (input.currentBindingId && lease.worktreeId === input.currentBindingId) {
    return {
      remove: false,
      reason: `Managed worktree ${lease.worktreeId} is the currently bound workspace.`,
    };
  }

  if (!isManagedLeaseExpired(lease, now)) {
    return {
      remove: false,
      reason: `Managed worktree ${lease.worktreeId} is not expired.`,
    };
  }

  if (!input.worktreeRecord || !existsSync(lease.worktreePath)) {
    return {
      remove: false,
      reason: `Managed worktree ${lease.worktreeId} is missing on disk.`,
      nextState: "managed-missing",
    };
  }

  if (!input.clean) {
    return {
      remove: false,
      reason: `Managed worktree ${lease.worktreeId} is dirty.`,
      nextState: "manual-cleanup-required",
    };
  }

  if (input.uniqueCommitCount > 0) {
    return {
      remove: false,
      reason: `Managed worktree ${lease.worktreeId} has ${input.uniqueCommitCount} unique commits.`,
      nextState: "manual-cleanup-required",
    };
  }

  return {
    remove: true,
    reason: `Managed worktree ${lease.worktreeId} is expired, clean, and non-diverged.`,
  };
}

export function isManagedSessionBinding(value: unknown): value is ManagedSessionBinding {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.schema === MANAGED_SESSION_BINDING_SCHEMA
    && candidate.managed === true
    && typeof candidate.worktreeId === "string"
    && typeof candidate.worktreePath === "string"
    && typeof candidate.targetCwd === "string"
    && typeof candidate.branch === "string"
    && typeof candidate.repoRoot === "string"
    && typeof candidate.gitCommonDir === "string"
    && typeof candidate.leaseFile === "string";
}

export function isManagedWorktreeLease(value: unknown): value is ManagedWorktreeLease {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.schema === MANAGED_WORKTREE_SCHEMA
    && candidate.managed === true
    && typeof candidate.worktreeId === "string"
    && typeof candidate.worktreePath === "string"
    && typeof candidate.targetCwd === "string"
    && typeof candidate.branch === "string"
    && typeof candidate.repoRoot === "string"
    && typeof candidate.gitCommonDir === "string"
    && typeof candidate.baseCommit === "string"
    && typeof candidate.leaseFile === "string"
    && typeof candidate.lastSeenAt === "string"
    && typeof candidate.leaseExpiresAt === "string"
    && typeof candidate.lifecycleState === "string"
    && typeof candidate.createdAt === "string";
}
