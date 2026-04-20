import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packageJsonPath = resolve(repoRoot, "package.json");
const indexPath = resolve(repoRoot, "extensions/index.ts");
const bashPolicyPath = resolve(repoRoot, "extensions/bash-policy.ts");
const priorPreparePaths = [
  resolve(repoRoot, "tests/extensions/prepare-agent-prompts.mjs"),
  resolve(repoRoot, "tests/extensions/prepare-verification-registry.mjs"),
];

assert.ok(existsSync(indexPath), "extensions/index.ts must exist");
assert.ok(existsSync(bashPolicyPath), "extensions/bash-policy.ts must exist");
for (const priorPreparePath of priorPreparePaths) {
  assert.ok(existsSync(priorPreparePath), `prior prepare validator should remain in repo: ${priorPreparePath}`);
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
assert.equal(
  packageJson.scripts?.["validate:extensions:prepare"],
  "node tests/extensions/prepare-bash-policy.mjs",
  "validate:extensions:prepare must point to the bash-policy prepare validator",
);
assert.ok(packageJson.scripts?.["validate:extensions"], "package.json must still define validate:extensions");

const indexSource = readFileSync(indexPath, "utf-8");
const bashPolicySource = readFileSync(bashPolicyPath, "utf-8");

const bashPolicyImportMatch = indexSource.match(
  /import\s*\{([\s\S]*?)\}\s*from\s*["']\.\/bash-policy\.js["'];?/,
);
assert.ok(bashPolicyImportMatch, "extensions/index.ts must import ./bash-policy.js");
for (const importedName of ["classifyChildBashCommand", "classifyExploreBash", "isAgentBrowserCommand"]) {
  assert.match(
    bashPolicyImportMatch[1] ?? "",
    new RegExp(`\\b${importedName}\\b`),
    `extensions/index.ts must import ${importedName} from ./bash-policy.js`,
  );
}

for (const marker of [
  'import type { SubagentBashPolicy } from "./subagents.js";',
  "const READ_ONLY_BASH_PREFIXES = [",
  "const MUTATING_BASH_PREFIXES = [",
  "const RAW_NETWORK_BASH_PREFIXES = [",
  "const VERIFY_BASH_PREFIXES = [",
  '"agent-browser"',
  '"npm test"',
  "export function isAgentBrowserCommand(",
  "export function classifyExploreBash(",
  "export function classifyExecuteBash(",
  "export function classifyChildBashCommand(",
]) {
  assert.ok(bashPolicySource.includes(marker), `bash-policy prepare seam missing from extensions/bash-policy.ts: ${marker}`);
}

for (const movedMarker of [
  "const READ_ONLY_BASH_PREFIXES = [",
  "const MUTATING_BASH_PREFIXES = [",
  "const RAW_NETWORK_BASH_PREFIXES = [",
  "const VERIFY_BASH_PREFIXES = [",
  "function isAgentBrowserCommand(",
  "function classifyExploreBash(",
  "function classifyExecuteBash(",
  "function classifyChildBashCommand(",
]) {
  assert.ok(!indexSource.includes(movedMarker), `extensions/index.ts must no longer define ${movedMarker}`);
}

for (const guardMarker of [
  "function decodeHtmlEntities(",
  "function parseHarnessSubagentBashPolicy(",
  'name: "harness_web_search"',
]) {
  assert.ok(indexSource.includes(guardMarker), `non-scope guard missing from extensions/index.ts: ${guardMarker}`);
}

console.log("validate:extensions:prepare passed");
