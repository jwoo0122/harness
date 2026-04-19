import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packageJsonPath = resolve(repoRoot, "package.json");
const indexPath = resolve(repoRoot, "extensions/index.ts");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
assert.ok(packageJson.scripts?.["validate:extensions:prepare"], "package.json must define validate:extensions:prepare");
assert.ok(packageJson.scripts?.["validate:extensions"], "package.json must define validate:extensions");

assert.ok(existsSync(indexPath), "extensions/index.ts must exist");
const indexSource = readFileSync(indexPath, "utf-8");

for (const functionName of [
  "loadAgentPrompt",
  "buildExploreSubagentSystemPrompt",
  "buildExploreSubagentTask",
  "buildExecuteRoleSystemPrompt",
  "buildExecuteRoleTask",
]) {
  assert.ok(indexSource.includes(`function ${functionName}(`), `prepare seam missing from extensions/index.ts: ${functionName}`);
}

for (const guardName of [
  "summarizeExploreSubagentProgress",
  "formatExploreSubagentResults",
  "buildHarnessSubagentSystemPrompt",
]) {
  assert.ok(indexSource.includes(`function ${guardName}(`), `non-scope guard missing from extensions/index.ts: ${guardName}`);
}

for (const relativePath of [
  "agents/OPT.md",
  "agents/PRA.md",
  "agents/SKP.md",
  "agents/EMP.md",
  "agents/PLN.md",
  "agents/IMP.md",
  "agents/VER.md",
  "agents/README.md",
]) {
  const promptPath = resolve(repoRoot, relativePath);
  assert.ok(existsSync(promptPath), `missing agents markdown file: ${promptPath}`);
  const content = readFileSync(promptPath, "utf-8").trim();
  assert.ok(content.length > 0, `agents markdown file must be non-empty: ${promptPath}`);
}

const tsImportProbe = spawnSync(
  process.execPath,
  [
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    "import('./extensions/subagents.ts').then(() => process.stdout.write('ok'))",
  ],
  {
    cwd: repoRoot,
    encoding: "utf-8",
  },
);

assert.equal(tsImportProbe.status, 0, `TS import probe failed:\nSTDOUT:\n${tsImportProbe.stdout}\nSTDERR:\n${tsImportProbe.stderr}`);
assert.match(tsImportProbe.stdout, /ok/, "TS import probe did not complete successfully");

console.log("validate:extensions:prepare passed");
