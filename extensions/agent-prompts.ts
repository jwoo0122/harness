import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_MODULE_PATH = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = resolve(dirname(CURRENT_MODULE_PATH), "..");
const AGENT_PROMPT_CACHE = new Map<string, string>();

export interface ExplorePromptRoleDefinition {
  persona: string;
  label: string;
  icon: string;
  promptPath: string;
}

export interface ExecutePromptRoleDefinition {
  role: string;
  label: string;
  icon: string;
  promptPath: string;
}

export function loadAgentPrompt(relativePath: string): string {
  const cached = AGENT_PROMPT_CACHE.get(relativePath);
  if (cached) return cached;

  const absolutePath = join(PACKAGE_ROOT, relativePath);
  try {
    const content = readFileSync(absolutePath, "utf-8").replace(/\r\n/g, "\n").trim();
    AGENT_PROMPT_CACHE.set(relativePath, content);
    return content;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load subagent prompt from ${absolutePath}: ${reason}`);
  }
}

export function buildExploreSubagentSystemPrompt(
  role: Pick<ExplorePromptRoleDefinition, "persona" | "label" | "promptPath">,
): string {
  return [
    "[HARNESS EXPLORE SUBAGENT]",
    `You are ${role.persona} (${role.label}) in an isolated explore subagent.`,
    `Canonical persona definition source: ${role.promptPath}`,
    "",
    loadAgentPrompt(role.promptPath),
    "",
    "Common operating rules:",
    "- You are a real isolated subagent, not a role-played paragraph in the main context.",
    "- Use only read-only local inspection and structured web evidence tools.",
    "- You MUST use harness_web_search at least once before making ecosystem or prior-art claims.",
    "- You MUST use harness_web_fetch on at least one URL you intend to rely on.",
    "- External claims without explicit URL citations are forbidden.",
    "- Local codebase claims should cite file paths.",
    "- Do not write files or edit code.",
    "- Stay in planning mode: analyze options, tradeoffs, dependencies, risks, and decision readiness; do not produce patches, code, or step-by-step implementation instructions.",
    "- If key requirements are ambiguous or contradictory, surface that explicitly and ask targeted clarification questions instead of silently inventing certainty.",
    "- If you proceed despite missing inputs, mark each inferred assumption as [ASSUMPTION].",
    "- Return concise markdown with citations inline.",
  ].join("\n");
}

export function buildExploreSubagentTask(
  role: Pick<ExplorePromptRoleDefinition, "persona" | "icon">,
  topic: string,
  projectContext?: string,
): string {
  return [
    `${role.icon} ${role.persona} isolated explore pass`,
    "",
    `Topic: ${topic}`,
    projectContext ? `Project context: ${projectContext}` : "",
    "",
    "Required workflow:",
    "1. Briefly inspect the relevant local codebase/docs if helpful.",
    "2. Identify any ambiguity or contradiction that could materially change the recommendation.",
    "3. Search the web for external evidence relevant to the topic.",
    "4. Fetch at least one strong source you plan to cite.",
    "5. Produce a planning-only position in markdown.",
    "",
    "Required output format:",
    `## ${role.persona} thesis`,
    "## Evidence",
    "- Local: [file-path] claim",
    "- External: [URL] claim",
    "## Clarifications needed / assumptions",
    "- Ask up to 3 targeted questions if needed",
    "- Mark any fallback inference as [ASSUMPTION]",
    "## Attacks on the other personas",
    "## Concrete work plan (planning-only)",
    "- Phases / dependencies / risks / decision gates",
    "## Minimum discriminating experiment / next evidence step",
    "## Surviving recommendation",
    "## Confidence",
    "",
    "Any claim without a file path or URL must be marked [UNVERIFIED].",
  ].filter(Boolean).join("\n");
}

export function buildExecuteRoleSystemPrompt(
  role: Pick<ExecutePromptRoleDefinition, "role" | "label" | "promptPath">,
): string {
  return [
    "[HARNESS EXECUTE SUBAGENT]",
    `You are ${role.role} (${role.label}) in an isolated execute subagent.`,
    `Canonical role definition source: ${role.promptPath}`,
    "",
    loadAgentPrompt(role.promptPath),
    "",
    "Common operating rules:",
    "- You are a real isolated subagent, not an internal monologue of the parent agent.",
    "- Report in markdown only.",
    "- If evidence is missing, say so explicitly.",
    "- If you are blocked, describe the exact blocker and next handoff needed.",
  ].join("\n");
}

export function buildExecuteRoleTask(
  role: Pick<ExecutePromptRoleDefinition, "role" | "icon">,
  objective: string,
  context?: string,
): string {
  return [
    `${role.icon} ${role.role} isolated execute pass`,
    "",
    `Objective: ${objective}`,
    context ? `Context: ${context}` : "",
    "",
    "Stay in role. Use tools only if needed. Return concise markdown.",
  ].filter(Boolean).join("\n");
}
