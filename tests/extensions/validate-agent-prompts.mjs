import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const modulePath = resolve(repoRoot, "extensions/agent-prompts.ts");
const indexPath = resolve(repoRoot, "extensions/index.ts");
const packageJsonPath = resolve(repoRoot, "package.json");

assert.ok(existsSync(modulePath), "extensions/agent-prompts.ts must exist before full validation");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
assert.ok(packageJson.scripts?.["validate:extensions:prepare"], "package.json must define validate:extensions:prepare");
assert.ok(packageJson.scripts?.["validate:extensions"], "package.json must define validate:extensions");

const promptModule = await import(pathToFileURL(modulePath).href);
const {
  loadAgentPrompt,
  buildExploreSubagentSystemPrompt,
  buildExploreSubagentTask,
  buildExecuteRoleSystemPrompt,
  buildExecuteRoleTask,
} = promptModule;

for (const exportedName of [
  "loadAgentPrompt",
  "buildExploreSubagentSystemPrompt",
  "buildExploreSubagentTask",
  "buildExecuteRoleSystemPrompt",
  "buildExecuteRoleTask",
]) {
  assert.equal(typeof promptModule[exportedName], "function", `missing exported function: ${exportedName}`);
}

const moduleSource = readFileSync(modulePath, "utf-8");
const indexSource = readFileSync(indexPath, "utf-8");

assert.ok(!moduleSource.includes("./index"), "extensions/agent-prompts.ts must not import from ./index");
assert.ok(indexSource.includes('from "./agent-prompts.js"'), "extensions/index.ts must import ./agent-prompts.js");

for (const functionName of [
  "loadAgentPrompt",
  "buildExploreSubagentSystemPrompt",
  "buildExploreSubagentTask",
  "buildExecuteRoleSystemPrompt",
  "buildExecuteRoleTask",
]) {
  assert.ok(!indexSource.includes(`function ${functionName}(`), `extensions/index.ts must no longer define ${functionName}`);
}

function expectedPrompt(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), "utf-8").replace(/\r\n/g, "\n").trim();
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
  const expected = expectedPrompt(relativePath);
  assert.equal(loadAgentPrompt(relativePath), expected, `prompt load mismatch for ${relativePath}`);
  assert.equal(loadAgentPrompt(relativePath), expected, `repeated prompt load mismatch for ${relativePath}`);
}

let missingError;
try {
  loadAgentPrompt("agents/DOES-NOT-EXIST.md");
} catch (error) {
  missingError = error;
}
assert.ok(missingError instanceof Error, "missing prompt path must throw an Error");
assert.match(
  missingError.message,
  new RegExp(resolve(repoRoot, "agents/DOES-NOT-EXIST.md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  "missing prompt error must include resolved absolute path",
);

const optPromptBody = expectedPrompt("agents/OPT.md");
const expectedExploreSystemPrompt = [
  "[HARNESS EXPLORE SUBAGENT]",
  "You are OPT (Optimist) in an isolated explore subagent.",
  "Canonical persona definition source: agents/OPT.md",
  "",
  optPromptBody,
  "",
  "Common operating rules:",
  "- You are a real isolated subagent, not a role-played paragraph in the main context.",
  "- Use only read-only local inspection and structured web evidence tools.",
  "- You MUST use harness_web_search at least once before making ecosystem or prior-art claims.",
  "- You MUST use harness_web_fetch on at least one URL you intend to rely on.",
  "- External claims without explicit URL citations are forbidden.",
  "- Local codebase claims should cite file paths.",
  "- Do not write files, edit code, or suggest implementation as already decided.",
  "- Return concise markdown with citations inline.",
].join("\n");

assert.equal(
  buildExploreSubagentSystemPrompt({ persona: "OPT", label: "Optimist", icon: "🔴", promptPath: "agents/OPT.md" }),
  expectedExploreSystemPrompt,
  "explore system prompt must match exactly",
);

const verPromptBody = expectedPrompt("agents/VER.md");
const expectedExecuteSystemPrompt = [
  "[HARNESS EXECUTE SUBAGENT]",
  "You are VER (Verifier) in an isolated execute subagent.",
  "Canonical role definition source: agents/VER.md",
  "",
  verPromptBody,
  "",
  "Common operating rules:",
  "- You are a real isolated subagent, not an internal monologue of the parent agent.",
  "- Report in markdown only.",
  "- If evidence is missing, say so explicitly.",
  "- If you are blocked, describe the exact blocker and next handoff needed.",
].join("\n");

assert.equal(
  buildExecuteRoleSystemPrompt({ role: "VER", label: "Verifier", icon: "✅", promptPath: "agents/VER.md" }),
  expectedExecuteSystemPrompt,
  "execute system prompt must match exactly",
);

assert.equal(
  buildExploreSubagentTask({ persona: "EMP", icon: "🔵" }, "Prompt extraction", "Context goes here"),
  [
    "🔵 EMP isolated explore pass",
    "",
    "Topic: Prompt extraction",
    "Project context: Context goes here",
    "",
    "Required workflow:",
    "1. Briefly inspect the relevant local codebase/docs if helpful.",
    "2. Search the web for external evidence relevant to the topic.",
    "3. Fetch at least one strong source you plan to cite.",
    "4. Produce your position in markdown.",
    "",
    "Required output format:",
    "## EMP thesis",
    "## Evidence",
    "- Local: [file-path] claim",
    "- External: [URL] claim",
    "## Attacks on the other personas",
    "## Minimum discriminating experiment / next evidence step",
    "## Surviving recommendation",
    "## Confidence",
    "",
    "Any claim without a file path or URL must be marked [UNVERIFIED].",
  ].filter(Boolean).join("\n"),
  "explore task with context must match exactly",
);

assert.equal(
  buildExploreSubagentTask({ persona: "EMP", icon: "🔵" }, "Prompt extraction"),
  [
    "🔵 EMP isolated explore pass",
    "",
    "Topic: Prompt extraction",
    "",
    "Required workflow:",
    "1. Briefly inspect the relevant local codebase/docs if helpful.",
    "2. Search the web for external evidence relevant to the topic.",
    "3. Fetch at least one strong source you plan to cite.",
    "4. Produce your position in markdown.",
    "",
    "Required output format:",
    "## EMP thesis",
    "## Evidence",
    "- Local: [file-path] claim",
    "- External: [URL] claim",
    "## Attacks on the other personas",
    "## Minimum discriminating experiment / next evidence step",
    "## Surviving recommendation",
    "## Confidence",
    "",
    "Any claim without a file path or URL must be marked [UNVERIFIED].",
  ].filter(Boolean).join("\n"),
  "explore task without context must match exactly",
);

assert.equal(
  buildExecuteRoleTask({ role: "PLN", icon: "📋" }, "Plan refactor", "Carry prior context"),
  [
    "📋 PLN isolated execute pass",
    "",
    "Objective: Plan refactor",
    "Context: Carry prior context",
    "",
    "Stay in role. Use tools only if needed. Return concise markdown.",
  ].filter(Boolean).join("\n"),
  "execute task with context must match exactly",
);

assert.equal(
  buildExecuteRoleTask({ role: "PLN", icon: "📋" }, "Plan refactor"),
  [
    "📋 PLN isolated execute pass",
    "",
    "Objective: Plan refactor",
    "",
    "Stay in role. Use tools only if needed. Return concise markdown.",
  ].filter(Boolean).join("\n"),
  "execute task without context must match exactly",
);

console.log("validate:extensions passed");
