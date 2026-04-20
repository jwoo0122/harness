import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const modulePath = resolve(repoRoot, "extensions/explore-gate.ts");
const indexPath = resolve(repoRoot, "extensions/index.ts");
const packageJsonPath = resolve(repoRoot, "package.json");

assert.ok(existsSync(modulePath), "extensions/explore-gate.ts must exist before full validation");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
assert.ok(packageJson.scripts?.["validate:extensions:prepare"], "package.json must define validate:extensions:prepare");
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /extensions\/explore-gate\.ts/,
  "validate:extensions must syntax-check extensions/explore-gate.ts",
);
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /tests\/extensions\/validate-explore-gate\.mjs/,
  "validate:extensions must include explore-gate validation",
);

const moduleSource = readFileSync(modulePath, "utf-8");
const indexSource = readFileSync(indexPath, "utf-8");

for (const forbiddenImport of ["./index", "@mariozechner/", "@sinclair/typebox"]) {
  assert.ok(!moduleSource.includes(forbiddenImport), `extensions/explore-gate.ts must not import ${forbiddenImport}`);
}

assert.ok(indexSource.includes('from "./explore-gate.js"'), "extensions/index.ts must import ./explore-gate.js");
assert.ok(indexSource.includes('pi.on("turn_end"'), "extensions/index.ts must enforce explore gating in turn_end");
assert.ok(indexSource.includes('deliverAs: "steer"'), "extensions/index.ts must steer explore retries before completion");
assert.ok(indexSource.includes('ctx.ui.setWidget("harness", undefined);'), "updateUI must clear stale harness widget state before rerendering managed identity UI");
assert.ok(
  indexSource.includes('ctx.ui.setWidget("harness", widgetLines, { placement: "belowEditor" });'),
  "updateUI may render the managed-worktree identity widget below the editor",
);
assert.equal(
  (indexSource.match(/setWidget\("harness"/g) ?? []).length,
  2,
  "extensions/index.ts should only clear and rerender the managed harness widget surface",
);
assert.ok(
  indexSource.includes('ctx.ui.setStatus("harness", `🧱 WT ${managedStatus}`);'),
  "updateUI must retain the managed worktree status path",
);
assert.ok(
  indexSource.includes('ctx.ui.setStatus("harness", undefined);'),
  "updateUI must clear harness status when no managed worktree is bound",
);
assert.ok(
  !indexSource.includes('pi.sendUserMessage("/skill:explore') && !indexSource.includes('pi.sendUserMessage("/skill:execute'),
  "extensions/index.ts should no longer dispatch /skill:explore or /skill:execute followUps",
);
assert.ok(indexSource.includes("CHILD_SUBAGENT_MODE"), "extensions/index.ts must consume HARNESS_SUBAGENT_MODE");
assert.ok(
  indexSource.includes("[HARNESS SUBAGENT: EXPLORE CHILD PROTOCOL ACTIVE]"),
  "extensions/index.ts must inject a child-safe explore prompt",
);
for (const removedMarker of [
  "interface ExploreLiveBatchState",
  "interface ExecuteLiveBatchState",
  "interface HarnessLiveBatchState",
  "function describeLiveSubagent(",
  "function formatLiveExploreBatchStatus(",
  "function formatLiveExecuteBatchStatus(",
  "function formatLiveHarnessBatchStatus(",
]) {
  assert.ok(!indexSource.includes(removedMarker), `extensions/index.ts must no longer contain ${removedMarker}`);
}
for (const perSubagentMarker of [
  'lines.push(renderCollapsedSubagentLine(`${role.icon} ${role.persona}`, snapshot, result, theme));',
  'lines.push(renderCollapsedSubagentLine(`${spec.icon} ${role}`, snapshot, result, theme));',
  'lines.push(renderCollapsedSubagentLine(label, snapshot, result, theme));',
]) {
  assert.ok(indexSource.includes(perSubagentMarker), `collapsed subagent rows must remain per-subagent: ${perSubagentMarker}`);
}

const gateModule = await import(pathToFileURL(modulePath).href);
const { hasExternalCitation, evaluateExploreEvidenceGate } = gateModule;

assert.equal(typeof hasExternalCitation, "function", "hasExternalCitation export must exist");
assert.equal(typeof evaluateExploreEvidenceGate, "function", "evaluateExploreEvidenceGate export must exist");
assert.equal(hasExternalCitation("See https://example.com"), true, "URLs must count as external citations");
assert.equal(hasExternalCitation("No URL here"), false, "missing URLs must fail citation detection");

const missingParent = evaluateExploreEvidenceGate({
  scope: "parent",
  searches: 0,
  fetches: 0,
  subagentRuns: 0,
  browserResearchCalls: 0,
  uniqueSourceCount: 0,
  finalText: "No citations yet",
});
assert.equal(missingParent.requiresSubagents, true, "parent explore gate must require subagents");
assert.equal(missingParent.minSources, 2, "parent explore gate must require at least two sources");
assert.equal(missingParent.researchReady, false, "parent explore gate must fail without evidence gathering");
assert.equal(missingParent.completionReady, false, "parent explore gate must fail without citations");
assert.deepEqual(
  missingParent.missingCompletion,
  [
    "run the isolated OPT/PRA/SKP/EMP subagent pass",
    "perform at least one external search or browser research step",
    "fetch at least one source URL before relying on it",
    "collect at least 2 unique external source URLs",
    "cite explicit source URLs in the answer",
  ],
  "parent explore gate should explain each missing pre-completion requirement",
);

const passingParent = evaluateExploreEvidenceGate({
  scope: "parent",
  searches: 1,
  fetches: 1,
  subagentRuns: 1,
  browserResearchCalls: 0,
  uniqueSourceCount: 2,
  finalText: "Supported by https://example.com/a and https://example.com/b",
});
assert.equal(passingParent.researchReady, true, "parent explore gate must pass once research requirements are met");
assert.equal(passingParent.completionReady, true, "parent explore gate must pass once citations are present");
assert.deepEqual(passingParent.missingCompletion, [], "passing parent explore gate should have no missing requirements");

const childResearchReady = evaluateExploreEvidenceGate({
  scope: "child",
  searches: 1,
  fetches: 1,
  subagentRuns: 0,
  browserResearchCalls: 0,
  uniqueSourceCount: 1,
  finalText: "Working notes only",
});
assert.equal(childResearchReady.requiresSubagents, false, "child explore gate must not require recursive subagents");
assert.equal(childResearchReady.minSources, 1, "child explore gate should accept one strong external source");
assert.equal(childResearchReady.researchReady, true, "child explore gate should recognize sufficient gathered evidence");
assert.equal(childResearchReady.completionReady, false, "child explore gate should still require explicit URL citations before completion");
assert.deepEqual(
  childResearchReady.missingCompletion,
  ["cite explicit source URLs in the answer"],
  "child explore gate should only require citations once research is sufficient",
);

const childCompletionReady = evaluateExploreEvidenceGate({
  scope: "child",
  searches: 1,
  fetches: 1,
  subagentRuns: 0,
  browserResearchCalls: 0,
  uniqueSourceCount: 1,
  finalText: "Final answer with https://example.com/source",
});
assert.equal(childCompletionReady.researchReady, true, "child explore gate research readiness should stay true");
assert.equal(childCompletionReady.completionReady, true, "child explore gate should pass once URLs are cited");

console.log("validate:explore-gate passed");
