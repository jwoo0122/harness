import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const subagentsPath = resolve(repoRoot, "extensions/subagents.ts");
const indexPath = resolve(repoRoot, "extensions/index.ts");
const packageJsonPath = resolve(repoRoot, "package.json");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /tests\/extensions\/validate-subagent-mode\.mjs/,
  "validate:extensions must include subagent child-mode validation",
);

const subagentsSource = readFileSync(subagentsPath, "utf-8");
const indexSource = readFileSync(indexPath, "utf-8");

assert.ok(
  subagentsSource.includes("HARNESS_SUBAGENT_MODE: spec.mode"),
  "runHarnessSubagentProcess must forward spec.mode through HARNESS_SUBAGENT_MODE",
);
assert.ok(
  indexSource.includes("resolveGenericSubagentChildMode(getRuntimeProtocol())"),
  "harness_subagents must derive child mode from the current runtime protocol",
);
assert.ok(
  indexSource.includes("mode: genericSubagentChildMode,"),
  "harness_subagents specs must propagate the derived child mode",
);

const { resolveGenericSubagentChildMode } = await import(pathToFileURL(subagentsPath).href);

assert.equal(
  resolveGenericSubagentChildMode("explore"),
  "explore",
  "generic harness_subagents must preserve explore child behavior while the parent is in /explore",
);

for (const parentMode of ["generic", "execute", "off"]) {
  assert.equal(
    resolveGenericSubagentChildMode(parentMode),
    "generic",
    `generic harness_subagents must stay generic outside explore (${parentMode})`,
  );
}

console.log("validate:subagent-mode passed");
