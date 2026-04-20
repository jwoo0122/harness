import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const criteriaModulePath = resolve(repoRoot, "extensions/criteria-docs.ts");
const managedModulePath = resolve(repoRoot, "extensions/managed-worktrees.ts");
const indexPath = resolve(repoRoot, "extensions/index.ts");
const readmePath = resolve(repoRoot, "README.md");
const exploreSkillPath = resolve(repoRoot, "skills/explore/SKILL.md");
const executeSkillPath = resolve(repoRoot, "skills/execute/SKILL.md");
const gitignorePath = resolve(repoRoot, ".gitignore");
const packageJsonPath = resolve(repoRoot, "package.json");

assert.ok(existsSync(criteriaModulePath), "extensions/criteria-docs.ts must exist before validation");
assert.ok(existsSync(gitignorePath), "repo root .gitignore must exist before validation");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /extensions\/criteria-docs\.ts/,
  "validate:extensions must syntax-check extensions/criteria-docs.ts",
);
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /tests\/extensions\/validate-criteria-docs\.mjs/,
  "validate:extensions must include criteria-doc validation",
);

const indexSource = readFileSync(indexPath, "utf-8");
const readmeSource = readFileSync(readmePath, "utf-8");
const exploreSkillSource = readFileSync(exploreSkillPath, "utf-8");
const executeSkillSource = readFileSync(executeSkillPath, "utf-8");
const gitignoreSource = readFileSync(gitignorePath, "utf-8");

assert.ok(indexSource.includes('from "./criteria-docs.js"'), "extensions/index.ts must import ./criteria-docs.js");
assert.ok(indexSource.includes("validateExecuteCriteriaCandidate("), "extensions/index.ts must validate execute criteria before runtime");
assert.ok(indexSource.includes("rehydrateManagedCriteriaDocument("), "extensions/index.ts must rehydrate criteria into managed worktrees");
assert.ok(indexSource.includes('customType: "cognitive-harness-state"'), "managed worktree bootstrap must seed cognitive harness state into the target session");
assert.ok(indexSource.includes("[HARNESS EXECUTE ENTRY BLOCKED]"), "invalid execute input must surface an explicit pre-runtime block prompt");
assert.ok(!indexSource.includes("state.criteriaFile = invocation?.argsText || undefined;"), "execute runtime must not store raw criteria args without validation");

assert.match(gitignoreSource, /^\/\.target\/$/m, "root .gitignore must ignore /.target/");
assert.match(gitignoreSource, /^\/\.iteration-\*$/m, "root .gitignore should continue ignoring legacy /.iteration-* temp docs");

assert.ok(readmeSource.includes("/.target/criteria/"), "README.md must document canonical /.target/criteria/ usage");
assert.ok(readmeSource.includes("/.target/execute/"), "README.md must document /.target/execute/ reports");
assert.ok(!readmeSource.includes("/execute .iteration-4-criteria.md"), "README.md must not keep the legacy .iteration execute example");
assert.ok(exploreSkillSource.includes("/.target/explore/"), "skills/explore/SKILL.md must point explore output at /.target/explore/");
assert.ok(exploreSkillSource.includes("/.target/criteria/"), "skills/explore/SKILL.md must point execute handoff at /.target/criteria/");
assert.ok(!exploreSkillSource.includes("write to: `target/explore/"), "skills/explore/SKILL.md must not keep target/explore as canonical guidance");
assert.ok(!exploreSkillSource.includes("Requirements criteria written as `.iteration-N-criteria.md`"), "skills/explore/SKILL.md must not keep .iteration criteria as canonical guidance");
assert.ok(executeSkillSource.includes("/.target/criteria/"), "skills/execute/SKILL.md must require /.target/criteria/ inputs");
assert.ok(executeSkillSource.includes("/.target/execute/"), "skills/execute/SKILL.md must point reports at /.target/execute/");
assert.ok(!executeSkillSource.includes("If blank, look for the most recent criteria/requirements document in the project."), "skills/execute/SKILL.md must not keep blank execute fallback guidance");

const criteriaModule = await import(pathToFileURL(criteriaModulePath).href);
const managedModule = await import(pathToFileURL(managedModulePath).href);
const {
  EXECUTE_CRITERIA_DIRECTORY,
  validateExecuteCriteriaCandidate,
  isCanonicalExecuteCriteriaPath,
  isRepoSharedGitignoreSource,
  rehydrateManagedCriteriaDocument,
} = criteriaModule;
const { writeManagedSessionFile } = managedModule;

assert.equal(EXECUTE_CRITERIA_DIRECTORY, ".target/criteria", "canonical execute criteria dir must be .target/criteria");
assert.equal(isCanonicalExecuteCriteriaPath(".target/criteria/foo.md"), true, "canonical criteria path should pass");
assert.equal(isCanonicalExecuteCriteriaPath(".target/criteria/nested/foo.md"), false, "nested criteria paths should fail");
assert.equal(isCanonicalExecuteCriteriaPath("target/criteria/foo.md"), false, "legacy target/ paths should fail");
assert.equal(isRepoSharedGitignoreSource(".gitignore"), true, "root .gitignore should count as repo-shared");
assert.equal(isRepoSharedGitignoreSource("subdir/.gitignore"), true, "in-repo .gitignore files should count as repo-shared");
assert.equal(isRepoSharedGitignoreSource(".git/info/exclude"), false, "repo-local info/exclude must not count as repo-shared .gitignore policy");
assert.equal(isRepoSharedGitignoreSource("/Users/me/.gitignore"), false, "absolute .gitignore paths must not count as repo-shared policy");
assert.equal(isRepoSharedGitignoreSource("/Users/me/.config/git/ignore"), false, "global excludes must not count as repo-shared .gitignore policy");

function runGit(repoPath, ...args) {
  return execFileSync("git", ["-C", repoPath, ...args], { encoding: "utf-8", stdio: "pipe" });
}

function runGitResult(repoPath, args) {
  try {
    return {
      code: 0,
      stdout: execFileSync("git", ["-C", repoPath, ...args], { encoding: "utf-8", stdio: "pipe" }),
      stderr: "",
    };
  } catch (error) {
    return {
      code: error.status ?? 1,
      stdout: error.stdout ? String(error.stdout) : "",
      stderr: error.stderr ? String(error.stderr) : "",
    };
  }
}

function initTempRepo() {
  const repoPath = mkdtempSync(join(tmpdir(), "harness-criteria-docs-"));
  runGit(repoPath, "init");
  runGit(repoPath, "config", "user.name", "Harness Test");
  runGit(repoPath, "config", "user.email", "harness@example.com");
  writeFileSync(join(repoPath, "README.md"), "temp repo\n", "utf-8");
  runGit(repoPath, "add", "README.md");
  runGit(repoPath, "commit", "-m", "init");
  return repoPath;
}

async function validateInRepo(repoPath, rawPath) {
  return validateExecuteCriteriaCandidate({
    repoRoot: repoPath,
    cwd: repoPath,
    rawPath,
    runGit: (args) => Promise.resolve(runGitResult(repoPath, args)),
  });
}

const reposToClean = [];
try {
  const validRepo = initTempRepo();
  reposToClean.push(validRepo);
  writeFileSync(join(validRepo, ".gitignore"), "/.target/\n", "utf-8");
  mkdirSync(join(validRepo, ".target", "criteria"), { recursive: true });
  writeFileSync(join(validRepo, ".target", "criteria", "valid.md"), "# valid\n", "utf-8");
  const validResult = await validateInRepo(validRepo, ".target/criteria/valid.md");
  assert.equal(validResult.ok, true, "valid ignored .target criteria doc must be accepted");
  assert.equal(validResult.repoRelativePath, ".target/criteria/valid.md", "accepted criteria path must stay repo-relative");
  assert.equal(validResult.ignoreSource, ".gitignore", "accepted criteria must prove ignore via repo .gitignore");
  const rootedAliasResult = await validateInRepo(validRepo, "/.target/criteria/valid.md");
  assert.equal(rootedAliasResult.ok, true, "repo-root /.target alias should resolve to the canonical criteria doc");

  const legacyIterationRepo = initTempRepo();
  reposToClean.push(legacyIterationRepo);
  writeFileSync(join(legacyIterationRepo, ".gitignore"), "/.iteration-*\n", "utf-8");
  writeFileSync(join(legacyIterationRepo, ".iteration-11-criteria.md"), "# legacy\n", "utf-8");
  const legacyIterationResult = await validateInRepo(legacyIterationRepo, ".iteration-11-criteria.md");
  assert.equal(legacyIterationResult.ok, false, "legacy .iteration criteria path must be rejected");
  assert.match(legacyIterationResult.reason, /Root `.iteration-\*` criteria files are no longer accepted/u);

  const legacyTargetRepo = initTempRepo();
  reposToClean.push(legacyTargetRepo);
  mkdirSync(join(legacyTargetRepo, "target", "criteria"), { recursive: true });
  writeFileSync(join(legacyTargetRepo, "target", "criteria", "legacy.md"), "# legacy target\n", "utf-8");
  const legacyTargetResult = await validateInRepo(legacyTargetRepo, "target/criteria/legacy.md");
  assert.equal(legacyTargetResult.ok, false, "legacy target/ criteria path must be rejected");
  assert.match(legacyTargetResult.reason, /target/u);

  const trackedRepo = initTempRepo();
  reposToClean.push(trackedRepo);
  writeFileSync(join(trackedRepo, ".gitignore"), "/.target/\n", "utf-8");
  mkdirSync(join(trackedRepo, ".target", "criteria"), { recursive: true });
  writeFileSync(join(trackedRepo, ".target", "criteria", "tracked.md"), "# tracked\n", "utf-8");
  runGit(trackedRepo, "add", ".gitignore");
  runGit(trackedRepo, "add", "-f", ".target/criteria/tracked.md");
  const trackedResult = await validateInRepo(trackedRepo, ".target/criteria/tracked.md");
  assert.equal(trackedResult.ok, false, "tracked criteria doc must be rejected");
  assert.match(trackedResult.reason, /must remain untracked/u);

  const nonIgnoredRepo = initTempRepo();
  reposToClean.push(nonIgnoredRepo);
  mkdirSync(join(nonIgnoredRepo, ".target", "criteria"), { recursive: true });
  writeFileSync(join(nonIgnoredRepo, ".target", "criteria", "not-ignored.md"), "# not ignored\n", "utf-8");
  const nonIgnoredResult = await validateInRepo(nonIgnoredRepo, ".target/criteria/not-ignored.md");
  assert.equal(nonIgnoredResult.ok, false, "non-ignored criteria doc must be rejected");
  assert.match(nonIgnoredResult.reason, /must be ignored by repo-shared \.gitignore policy/u);

  const infoExcludeRepo = initTempRepo();
  reposToClean.push(infoExcludeRepo);
  mkdirSync(join(infoExcludeRepo, ".target", "criteria"), { recursive: true });
  writeFileSync(join(infoExcludeRepo, ".target", "criteria", "exclude-only.md"), "# exclude only\n", "utf-8");
  writeFileSync(join(infoExcludeRepo, ".git", "info", "exclude"), "/.target/\n", "utf-8");
  const infoExcludeResult = await validateInRepo(infoExcludeRepo, ".target/criteria/exclude-only.md");
  assert.equal(infoExcludeResult.ok, false, "info/exclude-only ignore proof must be rejected");
  assert.match(infoExcludeResult.reason, /repo-shared \.gitignore/u);

  const globalGitignoreRepo = initTempRepo();
  reposToClean.push(globalGitignoreRepo);
  mkdirSync(join(globalGitignoreRepo, ".target", "criteria"), { recursive: true });
  writeFileSync(join(globalGitignoreRepo, ".target", "criteria", "global-only.md"), "# global only\n", "utf-8");
  const absoluteGlobalGitignore = join(dirname(globalGitignoreRepo), `${globalGitignoreRepo.split("/").pop()}-global.gitignore`);
  writeFileSync(absoluteGlobalGitignore, "/.target/\n", "utf-8");
  runGit(globalGitignoreRepo, "config", "core.excludesFile", absoluteGlobalGitignore);
  const globalGitignoreResult = await validateInRepo(globalGitignoreRepo, ".target/criteria/global-only.md");
  assert.equal(globalGitignoreResult.ok, false, "absolute global .gitignore ignore proof must be rejected");
  assert.match(globalGitignoreResult.reason, /repo-shared \.gitignore/u);
  rmSync(absoluteGlobalGitignore, { force: true });

  const missingRepo = initTempRepo();
  reposToClean.push(missingRepo);
  writeFileSync(join(missingRepo, ".gitignore"), "/.target/\n", "utf-8");
  const missingResult = await validateInRepo(missingRepo, ".target/criteria/missing.md");
  assert.equal(missingResult.ok, false, "missing criteria doc must fail explicitly");
  assert.match(missingResult.reason, /does not exist/u);

  const directoryRepo = initTempRepo();
  reposToClean.push(directoryRepo);
  writeFileSync(join(directoryRepo, ".gitignore"), "/.target/\n", "utf-8");
  mkdirSync(join(directoryRepo, ".target", "criteria", "dir.md"), { recursive: true });
  const directoryResult = await validateInRepo(directoryRepo, ".target/criteria/dir.md");
  assert.equal(directoryResult.ok, false, "directory criteria path must fail explicitly");
  assert.match(directoryResult.reason, /existing regular file/u);

  const outsideRepo = initTempRepo();
  reposToClean.push(outsideRepo);
  const outsideFile = join(dirname(outsideRepo), "outside-criteria.md");
  writeFileSync(outsideFile, "# outside\n", "utf-8");
  const outsideResult = await validateInRepo(outsideRepo, outsideFile);
  assert.equal(outsideResult.ok, false, "outside-repo criteria path must be rejected");
  assert.match(outsideResult.reason, /must stay inside the current repository root/u);
  rmSync(outsideFile, { force: true });

  const blankRepo = initTempRepo();
  reposToClean.push(blankRepo);
  const blankResult = await validateInRepo(blankRepo, "");
  assert.equal(blankResult.ok, false, "blank execute input must be rejected");
  assert.match(blankResult.reason, /requires an explicit criteria path/u);

  const rehydrateRoot = mkdtempSync(join(tmpdir(), "harness-criteria-rehydrate-"));
  reposToClean.push(rehydrateRoot);
  const rehydratedPath = await rehydrateManagedCriteriaDocument({
    worktreeRoot: rehydrateRoot,
    repoRelativePath: ".target/criteria/rehydrated.md",
    content: "# rehydrated\n",
  });
  assert.equal(readFileSync(rehydratedPath, "utf-8"), "# rehydrated\n", "rehydration must materialize the criteria file inside the target worktree");
  await assert.rejects(
    () => rehydrateManagedCriteriaDocument({
      worktreeRoot: rehydrateRoot,
      repoRelativePath: "../escape.md",
      content: "bad\n",
    }),
    /canonical \/\.target\/criteria\/\*\.md path/u,
    "rehydration must fail explicitly for non-canonical paths",
  );

  const sessionRoot = mkdtempSync(join(tmpdir(), "harness-criteria-session-"));
  reposToClean.push(sessionRoot);
  const sessionFile = await writeManagedSessionFile({
    cwd: sessionRoot,
    sessionDir: join(sessionRoot, ".pi", "sessions"),
    parentSession: "/tmp/source-session.jsonl",
    seedEntries: [{
      customType: "cognitive-harness-state",
      data: {
        criteriaFile: ".target/criteria/rehydrated.md",
        criteriaContent: "# rehydrated\n",
        commitCount: 0,
        regressionCount: 0,
        acStatuses: [],
      },
    }],
  });
  const sessionLines = readFileSync(sessionFile, "utf-8").trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(
    sessionLines.some((entry) => entry.customType === "cognitive-harness-state" && entry.data.criteriaFile === ".target/criteria/rehydrated.md"),
    "managed target session file must seed cognitive harness state for the rehydrated criteria path",
  );
} finally {
  for (const repoPath of reposToClean.reverse()) {
    rmSync(repoPath, { recursive: true, force: true });
  }
}

console.log("validate:criteria-docs passed");
