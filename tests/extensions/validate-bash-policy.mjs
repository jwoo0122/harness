import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const modulePath = resolve(repoRoot, "extensions/bash-policy.ts");
const indexPath = resolve(repoRoot, "extensions/index.ts");
const packageJsonPath = resolve(repoRoot, "package.json");

assert.ok(existsSync(modulePath), "extensions/bash-policy.ts must exist before full validation");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
assert.ok(packageJson.scripts?.["validate:extensions:prepare"], "package.json must define validate:extensions:prepare");
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /extensions\/bash-policy\.ts/,
  "validate:extensions must syntax-check extensions/bash-policy.ts",
);
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /tests\/extensions\/validate-agent-prompts\.mjs/,
  "validate:extensions must keep prompt validation",
);
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /tests\/extensions\/validate-verification-registry\.mjs/,
  "validate:extensions must keep registry validation",
);
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /tests\/extensions\/validate-bash-policy\.mjs/,
  "validate:extensions must include bash-policy validation",
);

const moduleSource = readFileSync(modulePath, "utf-8");
const indexSource = readFileSync(indexPath, "utf-8");

for (const forbiddenImport of ["./index", "@mariozechner/", "@sinclair/typebox"]) {
  assert.ok(!moduleSource.includes(forbiddenImport), `extensions/bash-policy.ts must not import ${forbiddenImport}`);
}

for (const sourceMarker of [
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
  assert.ok(moduleSource.includes(sourceMarker), `extensions/bash-policy.ts missing source marker: ${sourceMarker}`);
}

assert.ok(indexSource.includes('from "./bash-policy.js"'), "extensions/index.ts must import ./bash-policy.js");
for (const removedMarker of [
  "const READ_ONLY_BASH_PREFIXES = [",
  "const MUTATING_BASH_PREFIXES = [",
  "const RAW_NETWORK_BASH_PREFIXES = [",
  "const VERIFY_BASH_PREFIXES = [",
  "function isAgentBrowserCommand(",
  "function classifyExploreBash(",
  "function classifyExecuteBash(",
  "function classifyChildBashCommand(",
]) {
  assert.ok(!indexSource.includes(removedMarker), `extensions/index.ts must no longer define ${removedMarker}`);
}
for (const remainingMarker of [
  "function parseHarnessSubagentBashPolicy(",
  "function decodeHtmlEntities(",
  'name: "harness_web_search"',
]) {
  assert.ok(indexSource.includes(remainingMarker), `extensions/index.ts must still contain ${remainingMarker}`);
}

const bashPolicyModule = await import(pathToFileURL(modulePath).href);
const {
  isAgentBrowserCommand,
  classifyExploreBash,
  classifyExecuteBash,
  classifyChildBashCommand,
} = bashPolicyModule;

for (const exportedName of [
  "isAgentBrowserCommand",
  "classifyExploreBash",
  "classifyExecuteBash",
  "classifyChildBashCommand",
]) {
  assert.equal(typeof bashPolicyModule[exportedName], "function", `missing exported function: ${exportedName}`);
}

assert.equal(isAgentBrowserCommand("agent-browser https://example.com"), true, "agent-browser should be detected");
assert.equal(isAgentBrowserCommand("npx agent-browser https://example.com"), true, "npx agent-browser should be detected");
assert.equal(isAgentBrowserCommand("echo agent-browser"), false, "non-prefix agent-browser text should not be detected");

const exploreEmpty = classifyExploreBash("");
assert.equal(exploreEmpty.allowed, false, "empty explore command must be rejected");
assert.equal(exploreEmpty.reason, "Empty bash command.", "empty explore command should keep the same reason");

assert.deepEqual(classifyExploreBash("ls -la"), { allowed: true }, "read-only explore command must be allowed");

const exploreNetwork = classifyExploreBash("curl https://example.com");
assert.equal(exploreNetwork.allowed, false, "raw network explore command must be rejected");
assert.match(exploreNetwork.reason ?? "", /Raw network bash commands are blocked in explore mode/);

const exploreMutating = classifyExploreBash("rm -rf tmp");
assert.equal(exploreMutating.allowed, false, "mutating explore command must be rejected");
assert.match(exploreMutating.reason ?? "", /matched prefix: rm/);

const exploreCompound = classifyExploreBash("git status | cat");
assert.equal(exploreCompound.allowed, false, "compound explore command must be rejected");
assert.match(exploreCompound.reason ?? "", /Compound bash commands, pipes, and redirects are blocked in explore mode/);

assert.deepEqual(
  classifyExploreBash("agent-browser https://example.com | tee out.txt"),
  { allowed: true },
  "explore agent-browser pipe exemption must be preserved",
);

const exploreUnknown = classifyExploreBash("cat README.md");
assert.equal(exploreUnknown.allowed, false, "unknown explore command must be rejected");
assert.match(exploreUnknown.reason ?? "", /Unknown bash command in explore mode/);

assert.deepEqual(classifyExecuteBash("npm test"), { allowed: true }, "npm test must remain allowed in execute mode");
assert.deepEqual(classifyExecuteBash("cargo check"), { allowed: true }, "cargo check must remain allowed in execute mode");

const executeMutating = classifyExecuteBash("npm install");
assert.equal(executeMutating.allowed, false, "mutating execute command must be rejected");
assert.match(executeMutating.reason ?? "", /matched prefix: npm install/);

const executeNetwork = classifyExecuteBash("curl https://example.com");
assert.equal(executeNetwork.allowed, false, "raw network execute command must be rejected");
assert.match(executeNetwork.reason ?? "", /Raw network bash commands are blocked for execute subagents/);

const executeCompound = classifyExecuteBash("agent-browser https://example.com | tee out.txt");
assert.equal(executeCompound.allowed, false, "compound execute command must be rejected");
assert.match(executeCompound.reason ?? "", /Compound bash commands, pipes, and redirects are blocked for execute subagents/);

const executeUnknown = classifyExecuteBash("cat README.md");
assert.equal(executeUnknown.allowed, false, "unknown execute command must be rejected");
assert.match(executeUnknown.reason ?? "", /Unknown execute-mode bash command/);

const executeOrderSentinel = classifyExecuteBash("cargo test");
assert.equal(executeOrderSentinel.allowed, false, "overlapping execute prefix order must be preserved");
assert.match(executeOrderSentinel.reason ?? "", /matched prefix: cargo test/);

const childNone = classifyChildBashCommand("none", "ls");
assert.equal(childNone.allowed, false, "none bash policy must reject bash");
assert.equal(childNone.reason, "This subagent is not allowed to use bash.");

assert.deepEqual(
  classifyChildBashCommand("read-only", "ls -la"),
  { allowed: true },
  "read-only child policy must delegate to explore classification",
);
assert.deepEqual(
  classifyChildBashCommand("verify", "cargo check"),
  { allowed: true },
  "verify child policy must delegate to execute classification",
);
assert.deepEqual(
  classifyChildBashCommand("implement", "npm test"),
  { allowed: true },
  "implement child policy must delegate to execute classification",
);

const childUnknown = classifyChildBashCommand("mystery", "ls");
assert.equal(childUnknown.allowed, false, "unknown child bash policy must be rejected");
assert.match(childUnknown.reason ?? "", /Unknown child bash policy: mystery/);

console.log("validate:bash-policy passed");
