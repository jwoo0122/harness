import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const indexPath = resolve(repoRoot, "extensions/index.ts");
const packageJsonPath = resolve(repoRoot, "package.json");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /tests\/extensions\/validate-subagent-rendering\.mjs/,
  "validate:extensions must include subagent rendering validation",
);

const indexSource = readFileSync(indexPath, "utf-8");

for (const marker of [
  "class StableTextLineList extends Container",
  "function renderStableTextLineList(",
  'return renderStableTextLineList(renderHarnessSubagentsCollapsedText(details, theme), context);',
  'return renderStableTextLineList(renderExploreSubagentCollapsedText(details, theme), context);',
  'return renderStableTextLineList(renderExecuteSubagentCollapsedText(details, theme), context);',
]) {
  assert.ok(indexSource.includes(marker), `extensions/index.ts must contain ${marker}`);
}

console.log("validate:subagent-rendering passed");
