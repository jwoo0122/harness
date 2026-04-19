import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packageJsonPath = resolve(repoRoot, "package.json");
const indexPath = resolve(repoRoot, "extensions/index.ts");
const priorPreparePaths = [
  resolve(repoRoot, "tests/extensions/prepare-agent-prompts.mjs"),
  resolve(repoRoot, "tests/extensions/prepare-verification-registry.mjs"),
];

assert.ok(existsSync(indexPath), "extensions/index.ts must exist");
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

for (const marker of [
  "const READ_ONLY_BASH_PREFIXES = [",
  "const MUTATING_BASH_PREFIXES = [",
  "const RAW_NETWORK_BASH_PREFIXES = [",
  "const VERIFY_BASH_PREFIXES = [",
  "function isAgentBrowserCommand(",
  "function classifyExploreBash(",
  "function classifyExecuteBash(",
  "function classifyChildBashCommand(",
]) {
  assert.ok(indexSource.includes(marker), `bash-policy prepare seam missing from extensions/index.ts: ${marker}`);
}

for (const guardMarker of [
  "function decodeHtmlEntities(",
  "function parseHarnessSubagentBashPolicy(",
  'name: "harness_web_search"',
]) {
  assert.ok(indexSource.includes(guardMarker), `non-scope guard missing from extensions/index.ts: ${guardMarker}`);
}

assert.ok(
  !indexSource.includes('from "./bash-policy.js"'),
  "extensions/index.ts must not import ./bash-policy.js before extraction",
);

console.log("validate:extensions:prepare passed");
