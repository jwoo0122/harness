import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

export const TEMP_DOC_ROOT = ".target";
export const EXPLORE_DOC_DIRECTORY = ".target/explore";
export const EXECUTE_CRITERIA_DIRECTORY = ".target/criteria";
export const EXECUTE_REPORT_DIRECTORY = ".target/execute";

export interface GitCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type GitCommandRunner = (args: string[]) => Promise<GitCommandResult>;

export interface ExecuteCriteriaValidationSuccess {
  ok: true;
  absolutePath: string;
  repoRelativePath: string;
  content: string;
  ignoreSource: string;
}

export interface ExecuteCriteriaValidationFailure {
  ok: false;
  reason: string;
  absolutePath?: string;
  repoRelativePath?: string;
}

export type ExecuteCriteriaValidationResult = ExecuteCriteriaValidationSuccess | ExecuteCriteriaValidationFailure;

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function normalizeAbsolutePath(path: string): string {
  return resolve(path);
}

export function isPathInside(parentPath: string, childPath: string): boolean {
  const parent = normalizeAbsolutePath(parentPath);
  const child = normalizeAbsolutePath(childPath);
  if (parent === child) return true;
  return child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}

export function toRepoRelativePath(repoRoot: string, candidatePath: string): string | undefined {
  const relativePath = normalizeSlashes(relative(normalizeAbsolutePath(repoRoot), normalizeAbsolutePath(candidatePath)));
  if (!relativePath || relativePath === "") return ".";
  if (relativePath.startsWith("../") || relativePath === "..") return undefined;
  return relativePath;
}

export function isCanonicalExecuteCriteriaPath(repoRelativePath: string): boolean {
  const normalized = normalizeSlashes(repoRelativePath).replace(/^\/+/, "");
  return /^\.target\/criteria\/[^/]+\.md$/u.test(normalized);
}

export function isLegacyIterationCriteriaPath(repoRelativePath: string): boolean {
  return /^\.iteration-[^/]+\.md$/u.test(normalizeSlashes(repoRelativePath).replace(/^\/+/, ""));
}

export function isLegacyTargetCriteriaPath(repoRelativePath: string): boolean {
  return /^target(?:\/|$)/u.test(normalizeSlashes(repoRelativePath).replace(/^\/+/, ""));
}

export function isRepoSharedGitignoreSource(source: string): boolean {
  const normalized = normalizeSlashes(source);
  if (normalized.startsWith("/")) return false;

  const trimmed = normalized.replace(/^\.\//u, "").replace(/^\/+/, "");
  if (!trimmed.endsWith(".gitignore")) return false;
  if (trimmed.startsWith(".git/")) return false;
  return true;
}

export function parseCheckIgnoreVerboseOutput(stdout: string): { source: string; lineNumber: number; pattern: string; path: string } | undefined {
  const line = stdout.trim().split(/\r?\n/u, 1)[0];
  if (!line) return undefined;

  const tabIndex = line.lastIndexOf("\t");
  if (tabIndex < 0) return undefined;

  const metadata = line.slice(0, tabIndex);
  const path = line.slice(tabIndex + 1);
  const match = metadata.match(/^(.*?):(\d+):(.*)$/u);
  if (!match) return undefined;

  return {
    source: normalizeSlashes(match[1]),
    lineNumber: Number.parseInt(match[2], 10),
    pattern: match[3],
    path,
  };
}

function resolveCriteriaCandidateAbsolutePath(repoRoot: string, cwd: string, rawPath: string): string {
  const trimmedPath = rawPath.trim();
  if (/^\/(?:\.target\/|target\/|\.iteration-)/u.test(trimmedPath)) {
    return normalizeAbsolutePath(resolve(repoRoot, trimmedPath.slice(1)));
  }
  return normalizeAbsolutePath(resolve(cwd, trimmedPath));
}

export async function validateExecuteCriteriaCandidate(input: {
  repoRoot: string;
  cwd: string;
  rawPath: string;
  runGit: GitCommandRunner;
}): Promise<ExecuteCriteriaValidationResult> {
  const trimmedPath = input.rawPath.trim();
  if (!trimmedPath) {
    return {
      ok: false,
      reason: "`/execute` requires an explicit criteria path under `.target/criteria/*.md`; blank execute inputs are blocked.",
    };
  }

  const absolutePath = resolveCriteriaCandidateAbsolutePath(input.repoRoot, input.cwd, trimmedPath);
  const repoRelativePath = toRepoRelativePath(input.repoRoot, absolutePath);
  if (!repoRelativePath) {
    return {
      ok: false,
      absolutePath,
      reason: `Criteria path must stay inside the current repository root: ${input.repoRoot}`,
    };
  }

  if (isLegacyIterationCriteriaPath(repoRelativePath)) {
    return {
      ok: false,
      absolutePath,
      repoRelativePath,
      reason: "Root `.iteration-*` criteria files are no longer accepted by `/execute`; use `/.target/criteria/*.md` instead.",
    };
  }

  if (isLegacyTargetCriteriaPath(repoRelativePath)) {
    return {
      ok: false,
      absolutePath,
      repoRelativePath,
      reason: "`target/...` criteria files are not canonical temp docs; use `/.target/criteria/*.md` instead.",
    };
  }

  if (!isCanonicalExecuteCriteriaPath(repoRelativePath)) {
    return {
      ok: false,
      absolutePath,
      repoRelativePath,
      reason: "Criteria path must point to a markdown file directly under `/.target/criteria/`.",
    };
  }

  let stats;
  try {
    stats = await lstat(absolutePath);
  } catch {
    return {
      ok: false,
      absolutePath,
      repoRelativePath,
      reason: `Criteria file does not exist: ${repoRelativePath}`,
    };
  }

  if (!stats.isFile()) {
    return {
      ok: false,
      absolutePath,
      repoRelativePath,
      reason: `Criteria path must be an existing regular file: ${repoRelativePath}`,
    };
  }

  const trackedResult = await input.runGit(["ls-files", "--error-unmatch", "--", repoRelativePath]);
  if (trackedResult.code === 0) {
    return {
      ok: false,
      absolutePath,
      repoRelativePath,
      reason: `Criteria file must remain untracked so it stays temporal: ${repoRelativePath}`,
    };
  }

  const ignoredResult = await input.runGit(["check-ignore", "-v", "--no-index", "--", repoRelativePath]);
  if (ignoredResult.code !== 0) {
    return {
      ok: false,
      absolutePath,
      repoRelativePath,
      reason: `Criteria file must be ignored by repo-shared .gitignore policy: ${repoRelativePath}`,
    };
  }

  const ignoreMatch = parseCheckIgnoreVerboseOutput(ignoredResult.stdout);
  if (!ignoreMatch) {
    return {
      ok: false,
      absolutePath,
      repoRelativePath,
      reason: `Criteria ignore proof could not be parsed from Git output: ${repoRelativePath}`,
    };
  }

  if (!isRepoSharedGitignoreSource(ignoreMatch.source)) {
    return {
      ok: false,
      absolutePath,
      repoRelativePath,
      reason: `Criteria ignore rule must come from a repo-shared .gitignore, not ${ignoreMatch.source}.`,
    };
  }

  return {
    ok: true,
    absolutePath,
    repoRelativePath,
    content: await readFile(absolutePath, "utf-8"),
    ignoreSource: ignoreMatch.source,
  };
}

export async function rehydrateManagedCriteriaDocument(input: {
  worktreeRoot: string;
  repoRelativePath: string;
  content: string;
}): Promise<string> {
  if (!isCanonicalExecuteCriteriaPath(input.repoRelativePath)) {
    throw new Error(`Managed criteria rehydration requires a canonical /.target/criteria/*.md path, got: ${input.repoRelativePath}`);
  }

  const targetPath = normalizeAbsolutePath(resolve(input.worktreeRoot, input.repoRelativePath));
  if (!isPathInside(input.worktreeRoot, targetPath)) {
    throw new Error(`Managed criteria rehydration path escaped the target worktree: ${targetPath}`);
  }

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, input.content, "utf-8");
  return targetPath;
}
