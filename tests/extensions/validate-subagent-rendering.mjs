import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const indexPath = resolve(repoRoot, "extensions/index.ts");
const subagentsPath = resolve(repoRoot, "extensions/subagents.ts");
const packageJsonPath = resolve(repoRoot, "package.json");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /tests\/extensions\/validate-subagent-rendering\.mjs/,
  "validate:extensions must include subagent rendering validation",
);

const indexSource = readFileSync(indexPath, "utf-8");
const subagentsSource = readFileSync(subagentsPath, "utf-8");

for (const marker of [
  "class StableTextLineList extends Container",
  "function renderStableTextLineList(",
  "const SUBAGENT_SPINNER_FRAMES = [",
  "setAnimation(active: boolean, invalidate?: () => void): void {",
  "function getStableTextLineAnimationFrame(",
  "function formatExploreSubagentLivePartialText(",
  "function formatExecuteSubagentLivePartialText(",
  "function formatHarnessSubagentsLivePartialText(",
  "function createLiveSubagentPartialEmitter<TDetails>(params: {",
  'instanceId: `subagent:${declaredIndex}`,',
  'instanceId: subagent.instanceId,',
  'declaredIndex: subagent.declaredIndex,',
  'const result = details.results.find((entry) => entry.instanceId === subagent.instanceId);',
  'const snapshot = details.snapshots.find((entry) => entry.instanceId === subagent.instanceId);',
  'const label = subagent.icon ? `${subagent.icon} ${subagent.label}` : subagent.label;',
  'livePartialEmitter.update(details);',
  'livePartialEmitter.stop();',
  'const partialText = isPartial && !expanded ? extractToolTextContent(result) : "";',
  'return renderStableTextLineList(partialText, context, false);',
  'stopStableTextLineListAnimation(context.lastComponent);',
  'details.completed < details.total,',
]) {
  assert.ok(indexSource.includes(marker), `extensions/index.ts must contain ${marker}`);
}

assert.ok(
  !indexSource.includes('entry.role === subagent.role'),
  "generic subagent rendering must not key rows by role alone",
);
assert.ok(
  !indexSource.includes('[CALL DEBUG]'),
  'temporary subagent call debug copy must be removed once live partial content rendering lands',
);

for (const marker of [
  'export type HarnessSubagentLivePhase = "queued" | "starting" | "running" | "tool_running" | "completed" | "failed";',
  'type: "assistant_text" | "tool_execution_start" | "tool_execution_update" | "tool_execution_end";',
  'instanceId: string;',
  'declaredIndex: number;',
  'currentToolCallId?: string;',
  'function buildQueuedSubagentSnapshot<TRole extends string>(',
  'function summarizeRecentTextFragment(text: string, maxChars = MAX_STREAM_ITEM_TEXT_CHARS): string {',
  'function summarizeToolResult(result: any): string | undefined {',
  'function lastMapEntry<TKey>(map: Map<TKey, string>): { key: TKey; value: string } | undefined {',
  'livePhase: "queued",',
  'snapshot.currentToolCallId = typeof currentTool?.key === "string" ? currentTool.key : undefined;',
  'if (event.type === "tool_execution_update" && typeof event.toolName === "string") {',
  'const snapshotSlots: HarnessSubagentSnapshot<TRole>[] = specs.map((spec) => buildQueuedSubagentSnapshot(spec));',
]) {
  assert.ok(subagentsSource.includes(marker), `extensions/subagents.ts must contain ${marker}`);
}

console.log("validate:subagent-rendering passed");
