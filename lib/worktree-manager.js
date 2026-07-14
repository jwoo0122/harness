import { execFileSync } from "node:child_process";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";

export const WORKTREE_DIRECTORY = ".hrn";
export const WORKTREE_MAP_FILE = "worktrees.json";
const MAP_SCHEMA_VERSION = 1;
const TRUE_FALSE = new Set(["true", "false"]);

function runGit(cwd, args, options = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function gitOutput(cwd, args) {
  try {
    return runGit(cwd, args).trim();
  } catch {
    return undefined;
  }
}

function randomId() {
  return randomBytes(8).toString("hex");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeEntry(entry) {
  return isRecord(entry)
    && typeof entry.id === "string" && /^[a-f0-9]{16}$/.test(entry.id)
    // Mapping paths are manager-generated, never caller-supplied. Restricting
    // them to this exact relative layout prevents a corrupted map from making
    // Harness select an arbitrary repository or a path outside .hrn.
    && typeof entry.path === "string" && entry.path === join(WORKTREE_DIRECTORY, "worktrees", entry.id)
    && typeof entry.branch === "string" && entry.branch.startsWith("hrn/")
    && (entry.workflowId === null || (typeof entry.workflowId === "string" && entry.workflowId.length > 0));
}

function mapPath(projectRoot) {
  return join(projectRoot, WORKTREE_DIRECTORY, WORKTREE_MAP_FILE);
}

function emptyMap() {
  return { schemaVersion: MAP_SCHEMA_VERSION, worktrees: [] };
}

function readMap(projectRoot) {
  try {
    const mapping = JSON.parse(readFileSync(mapPath(projectRoot), "utf8"));
    if (mapping?.schemaVersion !== MAP_SCHEMA_VERSION
      || !Array.isArray(mapping.worktrees)
      || !mapping.worktrees.every(isSafeEntry)
      || new Set(mapping.worktrees.map((entry) => entry.id)).size !== mapping.worktrees.length) return undefined;
    return mapping;
  } catch {
    return undefined;
  }
}

function writeMap(projectRoot, mapping) {
  const destination = mapPath(projectRoot);
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.${randomId()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(mapping, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, destination);
}

function withMapLock(projectRoot, action) {
  const lockPath = `${mapPath(projectRoot)}.lock`;
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  let lock;
  try {
    lock = openSync(lockPath, "wx", 0o600);
    return action();
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error("Another Harness workspace operation is in progress; retry after it finishes.");
    }
    throw error;
  } finally {
    if (lock !== undefined) closeSync(lock);
    try { unlinkSync(lockPath); } catch {}
  }
}

function gitCommonDirectory(cwd) {
  const commonDirectory = gitOutput(cwd, ["rev-parse", "--git-common-dir"]);
  return commonDirectory ? resolve(cwd, commonDirectory) : undefined;
}

function isMappedWorktreeValid(projectRoot, entry) {
  const worktreePath = resolve(projectRoot, entry.path);
  if (!existsSync(worktreePath) || lstatSync(worktreePath).isSymbolicLink()) return false;
  const actualRoot = gitOutput(worktreePath, ["rev-parse", "--show-toplevel"]);
  const branch = gitOutput(worktreePath, ["branch", "--show-current"]);
  // A matching path and branch alone are forgeable by an unrelated repository
  // placed under .hrn. The worktree must also share Git's common directory
  // with the project that owns this mapping.
  return actualRoot === worktreePath
    && branch === entry.branch
    && gitCommonDirectory(worktreePath) === gitCommonDirectory(projectRoot);
}

function findMapRoot(cwd) {
  let current = resolve(cwd);
  while (true) {
    if (existsSync(mapPath(current))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function branchExists(projectRoot, branch) {
  if (gitOutput(projectRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]) !== undefined) return true;
  // A missing or temporarily unavailable origin must not prevent an offline
  // workspace from being created. A future confirmed collision is handled by
  // choosing a new branch before it is pushed.
  const remote = gitOutput(projectRoot, ["ls-remote", "--heads", "origin", branch]);
  return Boolean(remote);
}

function allocateBranch(projectRoot, hint) {
  const stem = `hrn/${hint}`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = `${stem}-${randomId().slice(0, 8)}`;
    if (!branchExists(projectRoot, candidate)) return candidate;
  }
  throw new Error("Could not allocate an unused hrn branch name after 20 attempts.");
}

function slug(value) {
  const normalized = String(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || "workflow";
}

function asWorkspace(projectRoot, entry) {
  return {
    enabled: true,
    projectRoot,
    id: entry.id,
    worktreePath: resolve(projectRoot, entry.path),
    branch: entry.branch,
    workflowId: entry.workflowId,
    mapPath: mapPath(projectRoot),
  };
}

export function parseWorktreeOption(args) {
  const forwarded = [];
  let worktree = true;
  let seen = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--worktree") {
      if (seen) throw new Error("--worktree may be specified only once.");
      const value = args[index + 1];
      if (!TRUE_FALSE.has(value)) throw new Error("--worktree requires the boolean value true or false.");
      worktree = value === "true";
      seen = true;
      index += 1;
      continue;
    }
    if (argument.startsWith("--worktree=")) {
      if (seen) throw new Error("--worktree may be specified only once.");
      const value = argument.slice("--worktree=".length);
      if (!TRUE_FALSE.has(value)) throw new Error("--worktree requires the boolean value true or false.");
      worktree = value === "true";
      seen = true;
      continue;
    }
    forwarded.push(argument);
  }
  return { worktree, args: forwarded };
}

export function currentGitRoot(cwd = process.cwd()) {
  const root = gitOutput(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root) throw new Error("--worktree true requires running hrn inside a Git repository with a local main branch; use --worktree false to disable isolation.");
  return root;
}

export function findMappedWorkspace(cwd = process.cwd()) {
  const projectRoot = findMapRoot(cwd);
  if (!projectRoot) return undefined;
  const mapping = readMap(projectRoot);
  if (!mapping) return undefined;
  const resolvedCwd = resolve(cwd);
  const entry = mapping.worktrees.find((candidate) => {
    const worktreePath = resolve(projectRoot, candidate.path);
    return resolvedCwd === worktreePath || resolvedCwd.startsWith(`${worktreePath}/`);
  });
  if (!entry || !isMappedWorktreeValid(projectRoot, entry)) return undefined;
  return asWorkspace(projectRoot, entry);
}

export function prepareWorkspace(cwd = process.cwd()) {
  const reusable = findMappedWorkspace(cwd);
  if (reusable) return reusable;

  const projectRoot = currentGitRoot(cwd);
  if (!gitOutput(projectRoot, ["rev-parse", "--verify", "--quiet", "refs/heads/main"])) {
    throw new Error("--worktree true requires a local main branch.");
  }

  return withMapLock(projectRoot, () => {
    const existingMap = readMap(projectRoot) ?? emptyMap();
    let id;
    let worktreePath;
    do {
      id = randomId();
      worktreePath = join(projectRoot, WORKTREE_DIRECTORY, "worktrees", id);
    } while (existsSync(worktreePath) || existingMap.worktrees.some((entry) => entry.id === id));

    const branch = allocateBranch(projectRoot, "session");
    mkdirSync(dirname(worktreePath), { recursive: true, mode: 0o700 });
    try {
      runGit(projectRoot, ["worktree", "add", "--no-checkout", "-b", branch, worktreePath, "main"]);
      runGit(worktreePath, ["checkout", "--quiet"]);
    } catch (error) {
      try { runGit(projectRoot, ["worktree", "remove", "--force", worktreePath]); } catch {}
      throw new Error(`Could not create the Harness worktree: ${error instanceof Error ? error.message : String(error)}`);
    }

    const entry = {
      id,
      path: relative(projectRoot, worktreePath),
      branch,
      workflowId: null,
    };
    const retained = existingMap.worktrees.filter((candidate) => isMappedWorktreeValid(projectRoot, candidate));
    writeMap(projectRoot, { schemaVersion: MAP_SCHEMA_VERSION, worktrees: [...retained, entry] });
    return asWorkspace(projectRoot, entry);
  });
}

export function attachWorkspaceToWorkflow(workspace, workflowId, branchHint) {
  if (!workspace?.enabled) return workspace;
  return withMapLock(workspace.projectRoot, () => {
    const mapping = readMap(workspace.projectRoot);
    if (!mapping) throw new Error("Harness worktree mapping is missing or invalid; start a new worktree session.");
    const index = mapping.worktrees.findIndex((entry) => entry.id === workspace.id);
    if (index < 0 || !isMappedWorktreeValid(workspace.projectRoot, mapping.worktrees[index])) {
      throw new Error("Harness worktree mapping is stale; start a new worktree session.");
    }

    const entry = mapping.worktrees[index];
    if (entry.workflowId && entry.workflowId !== workflowId) {
      throw new Error(`Harness worktree is already attached to workflow ${entry.workflowId}.`);
    }
    if (!entry.workflowId) {
      const nextBranch = allocateBranch(workspace.projectRoot, slug(branchHint));
      runGit(workspace.worktreePath, ["branch", "-m", entry.branch, nextBranch]);
      entry.branch = nextBranch;
      entry.workflowId = workflowId;
      writeMap(workspace.projectRoot, mapping);
    }
    return asWorkspace(workspace.projectRoot, entry);
  });
}

export function workspaceForWorkflow(projectRoot, workflowId) {
  const canonicalRoot = currentGitRoot(projectRoot);
  const mapping = readMap(canonicalRoot);
  if (!mapping) return undefined;
  const entry = mapping.worktrees.find((candidate) => candidate.workflowId === workflowId && isMappedWorktreeValid(canonicalRoot, candidate));
  return entry ? asWorkspace(canonicalRoot, entry) : undefined;
}

export function workspaceEnvironment(workspace) {
  if (!workspace?.enabled) return { HARNESS_WORKTREE_ENABLED: "false" };
  return {
    HARNESS_WORKTREE_ENABLED: "true",
    HARNESS_WORKTREE_ROOT: workspace.projectRoot,
    HARNESS_WORKTREE_PATH: workspace.worktreePath,
    HARNESS_WORKTREE_ID: workspace.id,
  };
}

export function workspaceFromEnvironment(environment = process.env) {
  if (environment.HARNESS_WORKTREE_ENABLED !== "true") return { enabled: false };
  const { HARNESS_WORKTREE_ROOT: projectRoot, HARNESS_WORKTREE_PATH: worktreePath, HARNESS_WORKTREE_ID: id } = environment;
  if (!projectRoot || !worktreePath || !id) return undefined;
  const mapping = readMap(projectRoot);
  const entry = mapping?.worktrees.find((candidate) => candidate.id === id && resolve(projectRoot, candidate.path) === resolve(worktreePath));
  return entry && isMappedWorktreeValid(projectRoot, entry) ? asWorkspace(projectRoot, entry) : undefined;
}
