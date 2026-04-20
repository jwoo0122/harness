import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { Container, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildExecuteRoleSystemPrompt,
  buildExecuteRoleTask,
  buildExploreSubagentSystemPrompt,
  buildExploreSubagentTask,
} from "./agent-prompts.js";
import { classifyChildBashCommand, classifyExploreBash, isAgentBrowserCommand } from "./bash-policy.js";
import { registerCompactBuiltinToolRenderers } from "./compact-tool-renderers.js";
import { evaluateExploreEvidenceGate } from "./explore-gate.js";
import {
  type HarnessProtocol,
  parseHarnessProtocolInvocation,
  stripLegacyHarnessMode,
} from "./protocol-invocation.js";
import {
  type ManagedSessionBinding,
  type ManagedWorktreeLease,
  INTERNAL_MANAGED_WORKTREE_COMMAND,
  INTERNAL_MANAGED_WORKTREE_TOOL,
  DEFAULT_MANAGED_LEASE_TTL_MS,
  buildManagedBranchName,
  createManagedSessionBinding,
  createManagedWorktreeId,
  createManagedWorktreeLease,
  deleteManagedWorktreeLease,
  evaluateManagedJanitorDecision,
  evaluateManagedMutationGate,
  findGitWorktreeRecord,
  hasRelevantGitStatusChanges,
  isManagedSessionBinding,
  isPathInside,
  listManagedWorktreeLeaseFiles,
  parseGitWorktreeList,
  readManagedSessionBinding,
  readManagedWorktreeLease,
  refreshManagedLease,
  resolveCanonicalRepoRoot,
  resolveGitCommonDir,
  resolveManagedTargetCwd,
  resolveManagedWorktreeRoot,
  resolveSessionDirForCwd,
  resolveTargetSessionDir,
  writeManagedSessionFile,
  writeManagedWorktreeLease,
} from "./managed-worktrees.js";
import { readRegistry, writeRegistry } from "./verification-registry.js";
import {
  type HarnessSubagentRunResult,
  type HarnessSubagentSnapshot,
  type HarnessSubagentSpec,
  type SubagentBashPolicy,
  formatPriorSubagentOutputs,
  resolveGenericSubagentChildMode,
  runHarnessSubagentBatch,
} from "./subagents.js";

// ─── Types ────────────────────────────────────────────────────────────

type SearchBackend = "duckduckgo" | "searxng" | "tavily";
type ExplorePersona = "OPT" | "PRA" | "SKP" | "EMP";
type ExecuteRole = "PLN" | "IMP" | "VER";

interface ACStatus {
  id: string;
  status: "pass" | "fail" | "pending";
  evidence?: string;
  verifiedAfter?: string; // INC-N
}

interface HarnessState {
  criteriaFile?: string;
  acStatuses: ACStatus[];
  currentIncrement?: string;
  regressionCount: number;
  debateRound?: number;
  commitCount: number;
}

interface PendingProtocolInvocation {
  protocol: HarnessProtocol;
  argsText: string;
}

interface ExploreEvidenceTotals {
  searches: number;
  fetches: number;
  subagentRuns: number;
  sources: Set<string>;
  retries: number;
}

interface ExploreEvidenceChain {
  active: boolean;
  searches: number;
  fetches: number;
  subagentRuns: number;
  browserResearchCalls: number;
  sources: Set<string>;
  retries: number;
  readyToConcludeSent: boolean;
}

interface ExploreSubagentResult extends HarnessSubagentRunResult<ExplorePersona> {
  persona: ExplorePersona;
  topic: string;
  searches: number;
  fetches: number;
}

type PersistedSubagentBatchExitStatus = "success" | "partial_failure" | "failed";

interface PersistedSubagentBatchRecordLink {
  entryType: "custom";
  customType: "harness-subagent-record";
  toolCallId: string;
  summary: string;
}

interface PersistedSubagentRunRecord {
  role: string;
  label: string;
  pid?: number;
  model?: string;
  exitCode: number;
  exitStatus: "success" | "error";
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  invocation: string;
  citationsCount: number;
  evidence?: {
    searches?: number;
    fetches?: number;
  };
  toolCalls: Record<string, number>;
  outputPreview?: string;
  stderrPreview?: string;
}

interface PersistedSubagentBatchRecord {
  schema: "harness-subagent-record/v1";
  toolCallId: string;
  mode: "generic" | "explore" | "execute";
  subject?: string;
  topic?: string;
  objective?: string;
  executionMode?: "parallel" | "sequential";
  batch: {
    startedAt: string;
    endedAt: string;
    durationMs: number;
    completed: number;
    total: number;
    exitStatus: PersistedSubagentBatchExitStatus;
  };
  totals: {
    citationsCount: number;
    evidence?: {
      searches?: number;
      fetches?: number;
    };
    toolCalls: {
      total: number;
      byTool: Record<string, number>;
    };
  };
  subagents: PersistedSubagentRunRecord[];
}

interface ExploreSubagentToolDetails {
  topic: string;
  mode: "parallel";
  completed: number;
  total: number;
  results: ExploreSubagentResult[];
  snapshots: HarnessSubagentSnapshot<ExplorePersona>[];
  record?: PersistedSubagentBatchRecordLink;
}

interface ExecuteSubagentResult extends HarnessSubagentRunResult<ExecuteRole> {
  objective: string;
}

interface ExecuteSubagentToolDetails {
  objective: string;
  mode: "parallel" | "sequential";
  completed: number;
  total: number;
  roles: ExecuteRole[];
  results: ExecuteSubagentResult[];
  snapshots: HarnessSubagentSnapshot<ExecuteRole>[];
  record?: PersistedSubagentBatchRecordLink;
}

interface HarnessSubagentConfigInput {
  role: string;
  label?: string;
  icon?: string;
  task?: string;
  system_prompt: string;
  active_tools?: string[];
  bash_policy?: string;
}

interface HarnessSubagentDefinition {
  role: string;
  label: string;
  icon?: string;
  task: string;
  systemPrompt: string;
  activeTools: string[];
  bashPolicy: SubagentBashPolicy;
}

interface HarnessSubagentsResult extends HarnessSubagentRunResult<string> {
  subject: string;
  searches: number;
  fetches: number;
}

interface HarnessSubagentsToolDetails {
  subject: string;
  mode: "parallel" | "sequential";
  completed: number;
  total: number;
  subagents: Array<Pick<HarnessSubagentDefinition, "role" | "label" | "icon">>;
  results: HarnessSubagentsResult[];
  snapshots: HarnessSubagentSnapshot<string>[];
  record?: PersistedSubagentBatchRecordLink;
}

interface ExecuteSubagentTotals {
  subagentRuns: number;
  roleRuns: Record<ExecuteRole, number>;
}

interface WebSearchResult {
  title: string;
  url: string;
  snippet?: string;
  source: string;
}

function decodeManagedBindingFromEnv(rawValue: string | undefined): ManagedSessionBinding | undefined {
  if (!rawValue) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(rawValue, "base64url").toString("utf-8"));
    return isManagedSessionBinding(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// ─── Verification Registry ───────────────────────────────────────────

const CURRENT_EXTENSION_PATH = fileURLToPath(import.meta.url);
const IS_SUBAGENT_CHILD = process.env.HARNESS_SUBAGENT_CHILD === "1";
const CHILD_SUBAGENT_MODE = process.env.HARNESS_SUBAGENT_MODE ?? "generic";
const CHILD_SUBAGENT_ROLE = process.env.HARNESS_SUBAGENT_ROLE ?? "";
const CHILD_SUBAGENT_TOOLS = (process.env.HARNESS_SUBAGENT_TOOLS ?? "")
  .split(",")
  .map((tool) => tool.trim())
  .filter(Boolean);
const CHILD_SUBAGENT_BASH_POLICY = (process.env.HARNESS_SUBAGENT_BASH_POLICY ?? "none") as SubagentBashPolicy;
const CHILD_MANAGED_WORKTREE_REQUIRED = process.env.HARNESS_MANAGED_WORKTREE_REQUIRED === "1";
const CHILD_MANAGED_WORKTREE_BINDING = decodeManagedBindingFromEnv(process.env.HARNESS_MANAGED_WORKTREE_BINDING);
const SAFE_EXPLORE_TOOL_NAMES = new Set([
  "read",
  "bash",
  "grep",
  "find",
  "ls",
  "harness_web_search",
  "harness_web_fetch",
  "harness_subagents",
  "harness_explore_subagents",
]);
const SAFE_EXECUTE_TOOL_NAMES = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "harness_web_search",
  "harness_web_fetch",
  "harness_subagents",
  "harness_execute_subagents",
  INTERNAL_MANAGED_WORKTREE_TOOL,
  "harness_verify_register",
  "harness_verify_list",
  "harness_commit",
]);
const SAFE_SUBAGENT_CHILD_TOOL_NAMES = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "harness_web_search",
  "harness_web_fetch",
]);
const MAX_SUBAGENT_CALL_PREVIEW_CHARS = 96;
const MAX_SUBAGENT_ACTIVITY_CHARS = 72;
const MAX_SUBAGENT_INVOCATION_CHARS = 240;
const MAX_SUBAGENT_OUTPUT_PREVIEW_LINES = 8;
const MAX_SUBAGENT_OUTPUT_LINE_CHARS = 120;
const MAX_SUBAGENT_STDERR_PREVIEW_CHARS = 200;
const MAX_SUBAGENT_RECENT_STREAM_RENDER_ITEMS = 8;
const MAX_SUBAGENT_CITATIONS_RENDER = 4;
const HARNESS_SUBAGENT_RECORD_TYPE = "harness-subagent-record";
const MAX_SUBAGENT_RECORD_OUTPUT_PREVIEW_CHARS = 200;
const MAX_SUBAGENT_RECORD_STDERR_PREVIEW_CHARS = 160;

interface ExploreSubagentRoleDefinition {
  persona: ExplorePersona;
  label: string;
  icon: string;
  promptPath: string;
  activeTools: string[];
  bashPolicy: SubagentBashPolicy;
}

interface ExecuteSubagentRoleDefinition {
  role: ExecuteRole;
  label: string;
  icon: string;
  promptPath: string;
  activeTools: string[];
  bashPolicy: SubagentBashPolicy;
}

const EXPLORE_SUBAGENT_ROLES: ExploreSubagentRoleDefinition[] = [
  {
    persona: "OPT",
    label: "Optimist",
    icon: "🔴",
    promptPath: "agents/OPT.md",
    activeTools: ["read", "grep", "find", "ls", "harness_web_search", "harness_web_fetch"],
    bashPolicy: "read-only",
  },
  {
    persona: "PRA",
    label: "Pragmatist",
    icon: "🟡",
    promptPath: "agents/PRA.md",
    activeTools: ["read", "grep", "find", "ls", "harness_web_search", "harness_web_fetch"],
    bashPolicy: "read-only",
  },
  {
    persona: "SKP",
    label: "Skeptic",
    icon: "🟢",
    promptPath: "agents/SKP.md",
    activeTools: ["read", "grep", "find", "ls", "harness_web_search", "harness_web_fetch"],
    bashPolicy: "read-only",
  },
  {
    persona: "EMP",
    label: "Empiricist",
    icon: "🔵",
    promptPath: "agents/EMP.md",
    activeTools: ["read", "grep", "find", "ls", "harness_web_search", "harness_web_fetch"],
    bashPolicy: "read-only",
  },
];

const EXECUTE_SUBAGENT_ROLES: ExecuteSubagentRoleDefinition[] = [
  {
    role: "PLN",
    label: "Planner",
    icon: "📋",
    promptPath: "agents/PLN.md",
    activeTools: ["read", "grep", "find", "ls", "harness_web_search", "harness_web_fetch"],
    bashPolicy: "read-only",
  },
  {
    role: "IMP",
    label: "Implementer",
    icon: "🔨",
    promptPath: "agents/IMP.md",
    activeTools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
    bashPolicy: "implement",
  },
  {
    role: "VER",
    label: "Verifier",
    icon: "✅",
    promptPath: "agents/VER.md",
    activeTools: ["read", "bash", "grep", "find", "ls"],
    bashPolicy: "verify",
  },
];

// ─── Web search helpers ──────────────────────────────────────────────

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(input: string): string {
  return decodeHtmlEntities(input.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function htmlToText(html: string): string {
  const withoutNoise = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(h[1-6]|section|article|main|header|footer|tr)>/gi, "\n");

  const text = stripTags(withoutNoise)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  return text;
}

function extractTitleFromHtml(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripTags(match[1]) : undefined;
}

function normalizeSourceUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

function unwrapDuckDuckGoUrl(url: string): string {
  try {
    const parsed = new URL(url, "https://duckduckgo.com");
    if (parsed.hostname.endsWith("duckduckgo.com") && parsed.pathname.startsWith("/l/")) {
      const redirected = parsed.searchParams.get("uddg");
      if (redirected) return decodeURIComponent(redirected);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function uniqueUrls(urls: Iterable<string>): string[] {
  const deduped = new Set<string>();
  for (const url of urls) {
    const normalized = normalizeSourceUrl(url);
    if (normalized) deduped.add(normalized);
  }
  return [...deduped];
}

function modelToCliSpec(model: { provider?: string; id?: string } | undefined): string | undefined {
  if (!model?.provider || !model?.id) return undefined;
  return `${model.provider}/${model.id}`;
}

function summarizeExploreSubagentProgress(details: ExploreSubagentToolDetails): string {
  const completedLabels = details.results.map((result) => result.persona).join(", ") || "none";
  return `Running explore subagents in ${details.mode} for \"${details.topic}\" — ${details.completed}/${details.total} complete (${completedLabels})`;
}

function formatExploreSubagentResults(details: ExploreSubagentToolDetails): string {
  const totalSearches = details.results.reduce((sum, result) => sum + result.searches, 0);
  const totalFetches = details.results.reduce((sum, result) => sum + result.fetches, 0);
  const totalUrls = uniqueUrls(details.results.flatMap((result) => result.citations)).length;

  const lines: string[] = [];
  lines.push(`Explore subagents completed in ${details.mode} for: ${details.topic}`);
  lines.push(`Coverage: ${details.results.length}/${details.total} personas | 🔎 ${totalSearches} searches | 🌐 ${totalFetches} fetches | 🔗 ${totalUrls} URLs`);
  lines.push("");

  for (const result of details.results) {
    lines.push(`## ${result.label} (${result.persona})`);
    lines.push(`Exit: ${result.exitCode === 0 ? "success" : `error ${result.exitCode}`}`);
    lines.push(`Evidence: 🔎 ${result.searches} | 🌐 ${result.fetches} | 🔗 ${result.citations.length}`);
    if (result.model) lines.push(`Model: ${result.model}`);
    if (result.citations.length > 0) lines.push(`Citations: ${result.citations.join(", ")}`);
    lines.push("");
    lines.push(result.output || "[No assistant output captured]");
    if (result.stderr.trim()) {
      lines.push("");
      lines.push(`stderr: ${result.stderr.trim()}`);
    }
    lines.push("");
  }

  lines.push("Use these isolated subagent positions as Round-1 inputs, then continue the debate and synthesize only what survives with citations.");
  return lines.join("\n");
}

function buildHarnessSubagentSystemPrompt(subagent: Pick<HarnessSubagentDefinition, "role" | "label" | "systemPrompt">): string {
  return [
    "[HARNESS SUBAGENT]",
    `You are ${subagent.role}${subagent.label && subagent.label !== subagent.role ? ` (${subagent.label})` : ""} in an isolated harness subagent subprocess.`,
    subagent.systemPrompt,
    "",
    "Operating rules:",
    "- You are a real isolated subagent, not a role-played paragraph in the parent context.",
    "- Stay inside the persona, role, or evaluation lens defined above.",
    "- Use only the tools enabled for this subagent.",
    "- If evidence is missing, say so explicitly.",
    "- Return concise markdown unless the task requires another structured format.",
  ].join("\n");
}

function buildHarnessSubagentTask(
  subject: string,
  subagent: Pick<HarnessSubagentConfigInput, "task">,
  context?: string,
): string {
  if (subagent.task?.trim()) return subagent.task.trim();

  return [
    "[HARNESS SUBAGENT TASK]",
    `Subject: ${subject}`,
    context ? `Context: ${context}` : "",
    "",
    "Stay in role. Use tools only if needed. Return concise markdown.",
  ].filter(Boolean).join("\n");
}

function parseHarnessSubagentBashPolicy(
  value: string | undefined,
  activeTools: string[],
): SubagentBashPolicy {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "none" || normalized === "read-only" || normalized === "verify" || normalized === "implement") {
    return normalized;
  }

  return activeTools.includes("bash") ? "read-only" : "none";
}

function normalizeHarnessSubagentDefinitions(
  subject: string,
  subagents: HarnessSubagentConfigInput[],
  context?: string,
): HarnessSubagentDefinition[] {
  return subagents.flatMap((subagent) => {
    const role = subagent.role.trim();
    const systemPromptBody = subagent.system_prompt.trim();
    if (!role || !systemPromptBody) return [];

    const label = subagent.label?.trim() || role;
    const icon = subagent.icon?.trim() || undefined;
    const activeTools = (subagent.active_tools ?? ["read", "grep", "find", "ls"])
      .map((tool) => tool.trim())
      .filter(Boolean);

    return [{
      role,
      label,
      icon,
      task: buildHarnessSubagentTask(subject, subagent, context),
      systemPrompt: buildHarnessSubagentSystemPrompt({
        role,
        label,
        systemPrompt: systemPromptBody,
      }),
      activeTools,
      bashPolicy: parseHarnessSubagentBashPolicy(subagent.bash_policy, activeTools),
    }];
  });
}

function mapHarnessSubagentsRunResult(
  subject: string,
  result: HarnessSubagentRunResult<string>,
): HarnessSubagentsResult {
  return {
    ...result,
    subject,
    searches: result.toolCalls.harness_web_search ?? 0,
    fetches: result.toolCalls.harness_web_fetch ?? 0,
  };
}

function buildHarnessSubagentsDetails(
  subject: string,
  mode: "parallel" | "sequential",
  subagents: Array<Pick<HarnessSubagentDefinition, "role" | "label" | "icon">>,
  completed: number,
  total: number,
  results: HarnessSubagentRunResult<string>[],
  snapshots: HarnessSubagentSnapshot<string>[],
): HarnessSubagentsToolDetails {
  return {
    subject,
    mode,
    completed,
    total,
    subagents,
    results: results.map((result) => mapHarnessSubagentsRunResult(subject, result)),
    snapshots,
  };
}

function summarizeHarnessSubagentsProgress(details: HarnessSubagentsToolDetails): string {
  const completedLabels = details.results.map((result) => result.role).join(", ") || "none";
  return `Running harness subagents for \"${details.subject}\" — ${details.completed}/${details.total} complete (${completedLabels})`;
}

function formatHarnessSubagentsResults(details: HarnessSubagentsToolDetails): string {
  const totalSearches = details.results.reduce((sum, result) => sum + result.searches, 0);
  const totalFetches = details.results.reduce((sum, result) => sum + result.fetches, 0);
  const totalUrls = uniqueUrls(details.results.flatMap((result) => result.citations)).length;

  const lines: string[] = [];
  lines.push(`Harness subagents completed for: ${details.subject}`);
  lines.push(`Mode: ${details.mode} | Subagents: ${details.subagents.map((subagent) => subagent.role).join(", ")}`);
  lines.push(`Coverage: ${details.results.length}/${details.total} | 🔎 ${totalSearches} searches | 🌐 ${totalFetches} fetches | 🔗 ${totalUrls} URLs`);
  lines.push("");

  for (const subagent of details.subagents) {
    const result = details.results.find((entry) => entry.role === subagent.role);
    lines.push(`## ${subagent.label}${subagent.label !== subagent.role ? ` (${subagent.role})` : ""}`);
    if (!result) {
      lines.push("[No assistant output captured]");
      lines.push("");
      continue;
    }
    lines.push(`Exit: ${result.exitCode === 0 ? "success" : `error ${result.exitCode}`}`);
    lines.push(`Evidence: 🔎 ${result.searches} | 🌐 ${result.fetches} | 🔗 ${result.citations.length}`);
    const toolSummary = Object.entries(result.toolCalls)
      .map(([tool, count]) => `${tool}×${count}`)
      .join(", ");
    if (toolSummary) lines.push(`Tools: ${toolSummary}`);
    if (result.model) lines.push(`Model: ${result.model}`);
    if (result.citations.length > 0) lines.push(`Citations: ${result.citations.join(", ")}`);
    lines.push("");
    lines.push(result.output || "[No assistant output captured]");
    if (result.stderr.trim()) {
      lines.push("");
      lines.push(`stderr: ${result.stderr.trim()}`);
    }
    lines.push("");
  }

  lines.push("Use these isolated subagent outputs as first-class evidence-backed perspectives for the current task.");
  return lines.join("\n");
}

function resolveExplorePersona(persona: ExplorePersona) {
  return EXPLORE_SUBAGENT_ROLES.find((entry) => entry.persona === persona)!;
}

function resolveExecuteRole(role: ExecuteRole) {
  return EXECUTE_SUBAGENT_ROLES.find((entry) => entry.role === role)!;
}

function formatLiveToolName(toolName: string): string {
  switch (toolName) {
    case "harness_web_search":
      return "search";
    case "harness_web_fetch":
      return "fetch";
    case "harness_verify_register":
      return "register";
    case "harness_verify_list":
      return "registry";
    case "harness_commit":
      return "commit";
    default:
      return toolName;
  }
}

function summarizeExecuteSubagentProgress(details: ExecuteSubagentToolDetails): string {
  const completedLabels = details.results.map((result) => result.role).join(", ") || "none";
  return `Running execute subagents for \"${details.objective}\" — ${details.completed}/${details.total} complete (${completedLabels})`;
}

function formatExecuteSubagentResults(details: ExecuteSubagentToolDetails): string {
  const lines: string[] = [];
  lines.push(`Execute subagents completed for: ${details.objective}`);
  lines.push(`Mode: ${details.mode} | Roles: ${details.roles.join(", ")}`);
  lines.push("");

  for (const result of details.results) {
    lines.push(`## ${result.label} (${result.role})`);
    lines.push(`Exit: ${result.exitCode === 0 ? "success" : `error ${result.exitCode}`}`);
    const toolSummary = Object.entries(result.toolCalls)
      .map(([tool, count]) => `${tool}×${count}`)
      .join(", ");
    if (toolSummary) lines.push(`Tools: ${toolSummary}`);
    if (result.model) lines.push(`Model: ${result.model}`);
    lines.push("");
    lines.push(result.output || "[No assistant output captured]");
    if (result.stderr.trim()) {
      lines.push("");
      lines.push(`stderr: ${result.stderr.trim()}`);
    }
    lines.push("");
  }

  lines.push("Use these isolated role outputs as the authoritative PLN / IMP / VER perspectives for the current execute step.");
  return lines.join("\n");
}

function summarizeSubagentText(text: string | undefined, maxChars: number): string {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}…`;
}

function extractToolTextContent(result: { content?: Array<{ type?: string; text?: string }> } | undefined): string {
  return (result?.content ?? [])
    .filter((item): item is { type: "text"; text: string } => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function renderEmptyToolContent(): Container {
  return new Container();
}

function renderToolTextBlock(
  text: string | undefined,
  theme: { fg: (token: string, text: string) => string },
  token: string = "toolOutput",
): Text | Container {
  const normalized = (text ?? "").trim();
  if (!normalized) return renderEmptyToolContent();

  const content = normalized
    .split("\n")
    .map((line) => theme.fg(token, line))
    .join("\n");
  return new Text(content, 0, 0);
}

interface StableTextLine {
  id: string;
  text: string;
}

class StableTextLineList extends Container {
  private readonly lineComponents = new Map<string, Text>();

  setLines(lines: StableTextLine[]): void {
    const nextIds = new Set(lines.map((line) => line.id));
    for (const id of [...this.lineComponents.keys()]) {
      if (!nextIds.has(id)) this.lineComponents.delete(id);
    }

    this.clear();
    for (const line of lines) {
      let component = this.lineComponents.get(line.id);
      if (!component) {
        component = new Text("", 0, 0);
        this.lineComponents.set(line.id, component);
      }
      component.setText(line.text || " ");
      this.addChild(component);
    }
  }
}

function renderStableTextLineList(
  text: string,
  context: { lastComponent?: unknown },
): StableTextLineList {
  const component = context.lastComponent instanceof StableTextLineList
    ? context.lastComponent
    : new StableTextLineList();
  component.setLines(
    text
      .split("\n")
      .map((line, index) => ({ id: `line:${index}`, text: line })),
  );
  return component;
}

function compactToolStatusPrefix(
  theme: { fg: (token: string, text: string) => string },
  context: { isPartial?: boolean; executionStarted?: boolean; isError?: boolean },
): string {
  if (context.isError) return theme.fg("error", "✕");
  if (!context.executionStarted || context.isPartial) return theme.fg("warning", "…");
  return theme.fg("success", "✓");
}

function compactToolTitle(
  theme: { fg: (token: string, text: string) => string; bold: (text: string) => string },
  context: { isPartial?: boolean; executionStarted?: boolean; isError?: boolean },
  title: string,
): string {
  return `${compactToolStatusPrefix(theme, context)} ${theme.fg("toolTitle", theme.bold(title))}`;
}

function renderCompactToolResult(
  result: { content?: Array<{ type?: string; text?: string }> },
  options: { expanded: boolean },
  theme: { fg: (token: string, text: string) => string },
  context: { isError?: boolean },
  collapsedSummary?: string,
): Text | Container {
  const text = extractToolTextContent(result);

  if (options.expanded) {
    return renderToolTextBlock(text, theme, context.isError ? "error" : "toolOutput");
  }

  if (context.isError) {
    const summary = summarizeSubagentText(text || "Tool failed.", MAX_SUBAGENT_STDERR_PREVIEW_CHARS);
    return renderToolTextBlock(summary, theme, "error");
  }

  if (collapsedSummary) {
    return renderToolTextBlock(collapsedSummary, theme, "muted");
  }

  return renderEmptyToolContent();
}

function quoteCliArg(arg: string): string {
  if (!arg) return '""';
  if (/[\s"'\\]/.test(arg)) return JSON.stringify(arg);
  return arg;
}

function formatSubagentPid(pid: number | undefined): string {
  return pid ? `pid ${pid}` : "pid —";
}

function getSubagentPhase(snapshot: HarnessSubagentSnapshot | undefined, result?: HarnessSubagentRunResult): string {
  if (result) return result.exitCode === 0 ? "done" : `exit ${result.exitCode}`;
  switch (snapshot?.livePhase) {
    case "starting":
      return "starting";
    case "running":
      return "thinking";
    case "tool_running":
      return "tool";
    case "completed":
      return "done";
    case "failed":
      return "failed";
    default:
      return "queued";
  }
}

function getSubagentPhaseTone(snapshot: HarnessSubagentSnapshot | undefined, result?: HarnessSubagentRunResult): string {
  if ((result && result.exitCode !== 0) || snapshot?.livePhase === "failed") return "error";
  if (result || snapshot?.livePhase === "completed") return "success";
  if (snapshot?.livePhase === "running" || snapshot?.livePhase === "tool_running") return "warning";
  return "muted";
}

function lastSubagentStreamItem(
  items: HarnessSubagentSnapshot["recentStream"],
): HarnessSubagentSnapshot["recentStream"][number] | undefined {
  return items.length > 0 ? items[items.length - 1] : undefined;
}

function findLastSubagentStreamItem(
  items: HarnessSubagentSnapshot["recentStream"],
  predicate: (item: HarnessSubagentSnapshot["recentStream"][number]) => boolean,
): HarnessSubagentSnapshot["recentStream"][number] | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (predicate(item)) return item;
  }
  return undefined;
}

function formatSubagentToolActivity(
  toolName: string | undefined,
  detail: string | undefined,
  maxChars = MAX_SUBAGENT_ACTIVITY_CHARS,
): string {
  const toolLabel = toolName ? formatLiveToolName(toolName) : "tool";
  const detailLabel = summarizeSubagentText(detail, maxChars);
  return detailLabel ? `${toolLabel} ${detailLabel}` : toolLabel;
}

function describeSubagentLiveActivity(snapshot: HarnessSubagentSnapshot | undefined): string {
  if (!snapshot) return "waiting";

  if (snapshot.livePhase === "tool_running") {
    const liveToolItem = findLastSubagentStreamItem(
      snapshot.recentStream,
      (item) => item.type === "tool_execution_start" && item.toolName === snapshot.currentToolName,
    );
    return formatSubagentToolActivity(snapshot.currentToolName, liveToolItem?.text);
  }

  const lastAssistant = findLastSubagentStreamItem(
    snapshot.recentStream,
    (item) => item.type === "assistant_text" && Boolean(item.text),
  );
  const assistantPreview = summarizeSubagentText(lastAssistant?.text ?? snapshot.assistantPreview, MAX_SUBAGENT_ACTIVITY_CHARS);
  if (assistantPreview) return assistantPreview;

  const lastItem = lastSubagentStreamItem(snapshot.recentStream);
  if (lastItem?.type === "tool_execution_end") {
    return `${formatLiveToolName(lastItem.toolName ?? "tool")} ${lastItem.isError ? "failed" : "done"}`;
  }

  if (snapshot.livePhase === "starting") return "booting";
  if (snapshot.livePhase === "running") return "awaiting output";
  return "idle";
}

function lastSubagentToolStart(
  snapshot: HarnessSubagentSnapshot | HarnessSubagentRunResult | undefined,
): HarnessSubagentSnapshot["recentStream"][number] | undefined {
  if (!snapshot) return undefined;
  return findLastSubagentStreamItem(
    snapshot.recentStream,
    (item) => item.type === "tool_execution_start" && Boolean(item.toolName),
  );
}

function lastSubagentToolEnd(
  snapshot: HarnessSubagentSnapshot | HarnessSubagentRunResult | undefined,
): HarnessSubagentSnapshot["recentStream"][number] | undefined {
  if (!snapshot) return undefined;
  return findLastSubagentStreamItem(
    snapshot.recentStream,
    (item) => item.type === "tool_execution_end" && Boolean(item.toolName),
  );
}

function describeSubagentLastToolCall(
  snapshot: HarnessSubagentSnapshot | HarnessSubagentRunResult | undefined,
): string {
  const lastToolStart = lastSubagentToolStart(snapshot);
  if (lastToolStart?.toolName) {
    return formatSubagentToolActivity(lastToolStart.toolName, lastToolStart.text);
  }

  const lastToolEnd = lastSubagentToolEnd(snapshot);
  if (lastToolEnd?.toolName) {
    return formatLiveToolName(lastToolEnd.toolName);
  }

  return "";
}

function describeCollapsedSubagentActivity(
  snapshot: HarnessSubagentSnapshot | undefined,
  result: HarnessSubagentRunResult | undefined,
): { text: string; tone: string } {
  if (snapshot?.livePhase === "tool_running") {
    return {
      text: describeSubagentLiveActivity(snapshot),
      tone: "accent",
    };
  }

  if (result?.exitCode !== 0) {
    const stderrPreview = summarizeSubagentText(result.stderr, MAX_SUBAGENT_ACTIVITY_CHARS);
    if (stderrPreview) {
      return {
        text: `stderr ${stderrPreview}`,
        tone: "error",
      };
    }
  }

  const lastToolCall = describeSubagentLastToolCall(snapshot ?? result);
  if (lastToolCall) {
    return {
      text: `last ${lastToolCall}`,
      tone: "accent",
    };
  }

  const assistantPreview = summarizeSubagentText(result?.output ?? snapshot?.assistantPreview, MAX_SUBAGENT_ACTIVITY_CHARS);
  if (assistantPreview) {
    return {
      text: assistantPreview,
      tone: "toolOutput",
    };
  }

  return {
    text: describeSubagentLiveActivity(snapshot),
    tone: "muted",
  };
}

function renderCollapsedSubagentLine(
  label: string,
  snapshot: HarnessSubagentSnapshot | undefined,
  result: HarnessSubagentRunResult | undefined,
  theme: { fg: (token: string, text: string) => string; bold: (text: string) => string },
): string {
  const phase = getSubagentPhase(snapshot, result);
  const phaseTone = getSubagentPhaseTone(snapshot, result);
  const activity = describeCollapsedSubagentActivity(snapshot, result);
  const parts = [
    `  ${theme.fg("toolTitle", theme.bold(label))}`,
    theme.fg("muted", "·"),
    theme.fg(phaseTone, phase),
  ];

  if (activity.text) {
    parts.push(theme.fg("muted", "·"));
    parts.push(theme.fg(activity.tone, activity.text));
  }

  return parts.join(" ");
}

function formatSubagentToolCounts(toolCalls: Record<string, number>, maxItems = Number.MAX_SAFE_INTEGER): string {
  const entries = Object.entries(toolCalls)
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right));

  if (entries.length === 0) return "";

  const visible = entries
    .slice(0, maxItems)
    .map(([tool, count]) => `${formatLiveToolName(tool)}×${count}`)
    .join(", ");
  const hidden = entries.length - Math.min(entries.length, maxItems);
  return hidden > 0 ? `${visible} +${hidden} more` : visible;
}

function formatSubagentCitationPreview(citations: string[]): string {
  const ordered = [...uniqueUrls(citations)].sort((left, right) => left.localeCompare(right));
  if (ordered.length === 0) return "none";
  const visible = ordered.slice(0, MAX_SUBAGENT_CITATIONS_RENDER).join(", ");
  const hidden = ordered.length - Math.min(ordered.length, MAX_SUBAGENT_CITATIONS_RENDER);
  return hidden > 0 ? `${visible} +${hidden} more` : visible;
}

function summarizeExploreCollapsedActivity(
  snapshot: HarnessSubagentSnapshot<ExplorePersona> | undefined,
  result: ExploreSubagentResult | undefined,
): string {
  if (!result) return describeSubagentLiveActivity(snapshot);
  if (snapshot && ["starting", "running", "tool_running"].includes(snapshot.livePhase)) {
    return describeSubagentLiveActivity(snapshot);
  }

  if (result.exitCode !== 0) {
    const stderrPreview = summarizeSubagentText(result.stderr, MAX_SUBAGENT_ACTIVITY_CHARS);
    if (stderrPreview) return `stderr ${stderrPreview}`;
  }

  return `🔎${result.searches} 🌐${result.fetches} 🔗${result.citations.length}`;
}

function summarizeExecuteCollapsedActivity(
  snapshot: HarnessSubagentSnapshot<string> | undefined,
  result: HarnessSubagentRunResult<string> | undefined,
): string {
  if (!result) return describeSubagentLiveActivity(snapshot);
  if (snapshot && ["starting", "running", "tool_running"].includes(snapshot.livePhase)) {
    return describeSubagentLiveActivity(snapshot);
  }

  if (result.exitCode !== 0) {
    const stderrPreview = summarizeSubagentText(result.stderr, MAX_SUBAGENT_ACTIVITY_CHARS);
    if (stderrPreview) return `stderr ${stderrPreview}`;
  }

  const toolSummary = formatSubagentToolCounts(result.toolCalls, 3);
  if (toolSummary) return toolSummary;

  return summarizeSubagentText(result.output || snapshot?.assistantPreview, MAX_SUBAGENT_ACTIVITY_CHARS) || "no output";
}

function extractSubagentIsolationFlags(args: string[]): string[] {
  const flags: string[] = [];
  if (args.includes("--no-session")) flags.push("--no-session");
  if (args.includes("--no-extensions")) flags.push("--no-extensions");
  if (args.includes("--no-skills")) flags.push("--no-skills");
  if (args.includes("--no-prompt-templates")) flags.push("--no-prompt-templates");

  const toolsIndex = args.indexOf("--tools");
  if (toolsIndex >= 0 && typeof args[toolsIndex + 1] === "string") {
    flags.push(`tools=${args[toolsIndex + 1]}`);
  } else if (args.includes("--no-tools")) {
    flags.push("--no-tools");
  }

  return flags;
}

function summarizeSubagentInvocation(provenance: HarnessSubagentSnapshot["provenance"]): string {
  const renderedArgs: string[] = [];

  for (let index = 0; index < provenance.args.length; index += 1) {
    const arg = provenance.args[index];

    if (arg === "--append-system-prompt") {
      renderedArgs.push("--append-system-prompt", "[omitted]");
      index += 1;
      continue;
    }

    if (["--mode", "-e", "--tools", "--model", "--thinking"].includes(arg)) {
      const value = provenance.args[index + 1];
      if (typeof value === "string") {
        renderedArgs.push(arg, quoteCliArg(summarizeSubagentText(value, 80) || value));
        index += 1;
        continue;
      }
    }

    if (arg.startsWith("-")) {
      renderedArgs.push(arg);
      continue;
    }

    renderedArgs.push("[task omitted]");
    break;
  }

  return summarizeSubagentText([quoteCliArg(provenance.command), ...renderedArgs].join(" "), MAX_SUBAGENT_INVOCATION_CHARS);
}

function formatSubagentStreamTimestamp(value: string | undefined): string {
  if (!value) return "--:--:--";
  return value.length >= 19 ? value.slice(11, 19) : value;
}

function renderSubagentRecentStreamLines(
  snapshot: HarnessSubagentSnapshot | HarnessSubagentRunResult | undefined,
  theme: { fg: (token: string, text: string) => string },
): string[] {
  const items = snapshot?.recentStream ?? [];
  if (items.length === 0) {
    return [theme.fg("muted", "    (no recent stream items captured)")];
  }

  const startIndex = Math.max(0, items.length - MAX_SUBAGENT_RECENT_STREAM_RENDER_ITEMS);
  const lines: string[] = [];
  if (startIndex > 0) {
    lines.push(theme.fg("muted", `    … ${startIndex} earlier items`));
  }

  for (const item of items.slice(startIndex)) {
    const at = formatSubagentStreamTimestamp(item.at);
    if (item.type === "assistant_text") {
      lines.push(`${theme.fg("dim", `    [${at}]`)} ${theme.fg("toolOutput", `✎ ${summarizeSubagentText(item.text, MAX_SUBAGENT_OUTPUT_LINE_CHARS) || "…"}`)}`);
      continue;
    }

    if (item.type === "tool_execution_start") {
      lines.push(`${theme.fg("dim", `    [${at}]`)} ${theme.fg("accent", `→ ${formatSubagentToolActivity(item.toolName, item.text, MAX_SUBAGENT_OUTPUT_LINE_CHARS)}`)}`);
      continue;
    }

    lines.push(`${theme.fg("dim", `    [${at}]`)} ${theme.fg(item.isError ? "error" : "success", `${item.isError ? "✗" : "✓"} ${formatLiveToolName(item.toolName ?? "tool")}`)}`);
  }

  return lines;
}

function renderSubagentPreviewLines(
  text: string | undefined,
  theme: { fg: (token: string, text: string) => string },
): string[] {
  const normalized = (text ?? "").trim();
  if (!normalized) return [theme.fg("muted", "    (none)")];

  const sourceLines = normalized.split("\n");
  const visible = sourceLines
    .slice(0, MAX_SUBAGENT_OUTPUT_PREVIEW_LINES)
    .map((line) => theme.fg("toolOutput", `    ${summarizeSubagentText(line, MAX_SUBAGENT_OUTPUT_LINE_CHARS) || " "}`));
  const hidden = sourceLines.length - Math.min(sourceLines.length, MAX_SUBAGENT_OUTPUT_PREVIEW_LINES);
  if (hidden > 0) {
    visible.push(theme.fg("muted", `    … +${hidden} more lines`));
  }
  return visible;
}

function renderExploreSubagentCollapsedText(
  details: ExploreSubagentToolDetails,
  theme: { fg: (token: string, text: string) => string; bold: (text: string) => string },
): string {
  const totalSearches = details.results.reduce((sum, result) => sum + result.searches, 0);
  const totalFetches = details.results.reduce((sum, result) => sum + result.fetches, 0);
  const totalUrls = uniqueUrls(details.results.flatMap((result) => result.citations)).length;
  const failures = details.results.filter((result) => result.exitCode !== 0).length;
  const status = details.completed >= details.total
    ? failures > 0
      ? theme.fg("error", `${details.completed}/${details.total} done · ${failures} failed`)
      : theme.fg("success", `${details.completed}/${details.total} done`)
    : theme.fg("warning", `${details.completed}/${details.total} running`);

  const lines = [[
    status,
    totalSearches > 0 ? theme.fg("muted", `🔎 ${totalSearches}`) : undefined,
    totalFetches > 0 ? theme.fg("muted", `🌐 ${totalFetches}`) : undefined,
    totalUrls > 0 ? theme.fg("muted", `🔗 ${totalUrls}`) : undefined,
  ].filter(Boolean).join(` ${theme.fg("muted", "·")} `)];

  for (const role of EXPLORE_SUBAGENT_ROLES) {
    const result = details.results.find((entry) => entry.persona === role.persona);
    const snapshot = details.snapshots.find((entry) => entry.role === role.persona);
    lines.push(renderCollapsedSubagentLine(`${role.icon} ${role.persona}`, snapshot, result, theme));
  }

  return lines.join("\n");
}

function renderExecuteSubagentCollapsedText(
  details: ExecuteSubagentToolDetails,
  theme: { fg: (token: string, text: string) => string; bold: (text: string) => string },
): string {
  const failures = details.results.filter((result) => result.exitCode !== 0).length;
  const status = details.completed >= details.total
    ? failures > 0
      ? theme.fg("error", `${details.completed}/${details.total} done · ${failures} failed`)
      : theme.fg("success", `${details.completed}/${details.total} done`)
    : theme.fg("warning", `${details.completed}/${details.total} running`);
  const toolSummary = formatSubagentToolCounts(
    details.results.reduce<Record<string, number>>((acc, result) => {
      for (const [tool, count] of Object.entries(result.toolCalls)) {
        acc[tool] = (acc[tool] ?? 0) + count;
      }
      return acc;
    }, {}),
    3,
  );

  const lines = [[
    status,
    toolSummary ? theme.fg("muted", toolSummary) : undefined,
  ].filter(Boolean).join(` ${theme.fg("muted", "·")} `)];

  for (const role of details.roles) {
    const snapshot = details.snapshots.find((entry) => entry.role === role);
    const result = details.results.find((entry) => entry.role === role);
    const spec = resolveExecuteRole(role);
    lines.push(renderCollapsedSubagentLine(`${spec.icon} ${role}`, snapshot, result, theme));
  }

  return lines.join("\n");
}

function renderExploreSubagentExpandedText(
  details: ExploreSubagentToolDetails,
  isPartial: boolean,
  theme: { fg: (token: string, text: string) => string; bold: (text: string) => string },
): string {
  const lines: string[] = [];
  lines.push(theme.fg("toolTitle", theme.bold(`Topic: ${details.topic}`)));
  lines.push(theme.fg("muted", `Mode: ${details.mode} · ${details.completed}/${details.total} personas complete${isPartial ? " · live" : ""}`));

  for (const role of EXPLORE_SUBAGENT_ROLES) {
    const result = details.results.find((entry) => entry.persona === role.persona);
    const snapshot = details.snapshots.find((entry) => entry.role === role.persona);
    const source = snapshot ?? result;
    const phase = getSubagentPhase(snapshot, result);
    const phaseTone = getSubagentPhaseTone(snapshot, result);
    const toolSummary = result ? formatSubagentToolCounts(result.toolCalls) : "";
    const isolationFlags = source ? extractSubagentIsolationFlags(source.provenance.args) : [];

    lines.push("");
    lines.push(theme.fg("toolTitle", theme.bold(`${role.icon} ${role.label} (${role.persona})`)));
    lines.push(`  ${theme.fg("muted", "PID:")} ${theme.fg("dim", String(source?.provenance.pid ?? "—"))}`);
    lines.push(`  ${theme.fg("muted", "Phase:")} ${theme.fg(phaseTone, phase)}${result ? theme.fg("dim", ` · exit ${result.exitCode}`) : ""}`);
    if (source?.model) lines.push(`  ${theme.fg("muted", "Model:")} ${theme.fg("dim", source.model)}`);
    if (source?.provenance.cwd) lines.push(`  ${theme.fg("muted", "CWD:")} ${theme.fg("dim", source.provenance.cwd)}`);
    if (source) lines.push(`  ${theme.fg("muted", "Invocation:")} ${theme.fg("dim", summarizeSubagentInvocation(source.provenance))}`);
    if (isolationFlags.length > 0) lines.push(`  ${theme.fg("muted", "Isolation:")} ${theme.fg("dim", isolationFlags.join(", "))}`);
    if (source?.provenance.startedAt || source?.provenance.endedAt) {
      lines.push(`  ${theme.fg("muted", "Lifetime:")} ${theme.fg("dim", `${source.provenance.startedAt ?? "?"} → ${source.provenance.endedAt ?? "running"}`)}`);
    }
    if (result) {
      lines.push(`  ${theme.fg("muted", "Evidence:")} ${theme.fg("dim", `search×${result.searches}, fetch×${result.fetches}, citations×${result.citations.length}`)}`);
      lines.push(`  ${theme.fg("muted", "Tools:")} ${theme.fg("dim", toolSummary || "none")}`);
      lines.push(`  ${theme.fg("muted", "Citations:")} ${theme.fg("dim", formatSubagentCitationPreview(result.citations))}`);
    }
    lines.push(`  ${theme.fg("muted", "Recent stream:")}`);
    lines.push(...renderSubagentRecentStreamLines(source, theme));
    lines.push(`  ${theme.fg("muted", "Output preview:")}`);
    lines.push(...renderSubagentPreviewLines(result?.output ?? source?.assistantPreview, theme));
    if (result?.stderr.trim()) {
      lines.push(`  ${theme.fg("muted", "stderr:")} ${theme.fg("error", summarizeSubagentText(result.stderr, MAX_SUBAGENT_STDERR_PREVIEW_CHARS))}`);
    }
  }

  return lines.join("\n");
}

function renderExecuteSubagentExpandedText(
  details: ExecuteSubagentToolDetails,
  isPartial: boolean,
  theme: { fg: (token: string, text: string) => string; bold: (text: string) => string },
): string {
  const lines: string[] = [];
  lines.push(theme.fg("toolTitle", theme.bold(`Objective: ${details.objective}`)));
  lines.push(theme.fg("muted", `Mode: ${details.mode} · ${details.completed}/${details.total} roles complete${isPartial ? " · live" : ""}`));

  for (const role of details.roles) {
    const spec = resolveExecuteRole(role);
    const result = details.results.find((entry) => entry.role === role);
    const snapshot = details.snapshots.find((entry) => entry.role === role);
    const source = snapshot ?? result;
    const phase = getSubagentPhase(snapshot, result);
    const phaseTone = getSubagentPhaseTone(snapshot, result);
    const toolSummary = result ? formatSubagentToolCounts(result.toolCalls) : "";
    const isolationFlags = source ? extractSubagentIsolationFlags(source.provenance.args) : [];

    lines.push("");
    lines.push(theme.fg("toolTitle", theme.bold(`${spec.icon} ${spec.label} (${role})`)));
    lines.push(`  ${theme.fg("muted", "PID:")} ${theme.fg("dim", String(source?.provenance.pid ?? "—"))}`);
    lines.push(`  ${theme.fg("muted", "Phase:")} ${theme.fg(phaseTone, phase)}${result ? theme.fg("dim", ` · exit ${result.exitCode}`) : ""}`);
    if (source?.model) lines.push(`  ${theme.fg("muted", "Model:")} ${theme.fg("dim", source.model)}`);
    if (source?.provenance.cwd) lines.push(`  ${theme.fg("muted", "CWD:")} ${theme.fg("dim", source.provenance.cwd)}`);
    if (source) lines.push(`  ${theme.fg("muted", "Invocation:")} ${theme.fg("dim", summarizeSubagentInvocation(source.provenance))}`);
    if (isolationFlags.length > 0) lines.push(`  ${theme.fg("muted", "Isolation:")} ${theme.fg("dim", isolationFlags.join(", "))}`);
    if (source?.provenance.startedAt || source?.provenance.endedAt) {
      lines.push(`  ${theme.fg("muted", "Lifetime:")} ${theme.fg("dim", `${source.provenance.startedAt ?? "?"} → ${source.provenance.endedAt ?? "running"}`)}`);
    }
    if (result) {
      lines.push(`  ${theme.fg("muted", "Tools:")} ${theme.fg("dim", toolSummary || "none")}`);
      lines.push(`  ${theme.fg("muted", "Citations:")} ${theme.fg("dim", formatSubagentCitationPreview(result.citations))}`);
    }
    lines.push(`  ${theme.fg("muted", "Recent stream:")}`);
    lines.push(...renderSubagentRecentStreamLines(source, theme));
    lines.push(`  ${theme.fg("muted", "Output preview:")}`);
    lines.push(...renderSubagentPreviewLines(result?.output ?? source?.assistantPreview, theme));
    if (result?.stderr.trim()) {
      lines.push(`  ${theme.fg("muted", "stderr:")} ${theme.fg("error", summarizeSubagentText(result.stderr, MAX_SUBAGENT_STDERR_PREVIEW_CHARS))}`);
    }
  }

  return lines.join("\n");
}

function renderHarnessSubagentsCollapsedText(
  details: HarnessSubagentsToolDetails,
  theme: { fg: (token: string, text: string) => string; bold: (text: string) => string },
): string {
  const failures = details.results.filter((result) => result.exitCode !== 0).length;
  const totalSearches = details.results.reduce((sum, result) => sum + result.searches, 0);
  const totalFetches = details.results.reduce((sum, result) => sum + result.fetches, 0);
  const totalUrls = uniqueUrls(details.results.flatMap((result) => result.citations)).length;
  const status = details.completed >= details.total
    ? failures > 0
      ? theme.fg("error", `${details.completed}/${details.total} done · ${failures} failed`)
      : theme.fg("success", `${details.completed}/${details.total} done`)
    : theme.fg("warning", `${details.completed}/${details.total} running`);
  const toolSummary = formatSubagentToolCounts(
    details.results.reduce<Record<string, number>>((acc, result) => {
      for (const [tool, count] of Object.entries(result.toolCalls)) {
        acc[tool] = (acc[tool] ?? 0) + count;
      }
      return acc;
    }, {}),
    3,
  );

  const lines = [[
    status,
    totalSearches > 0 ? theme.fg("muted", `🔎 ${totalSearches}`) : undefined,
    totalFetches > 0 ? theme.fg("muted", `🌐 ${totalFetches}`) : undefined,
    totalUrls > 0 ? theme.fg("muted", `🔗 ${totalUrls}`) : undefined,
    toolSummary ? theme.fg("muted", toolSummary) : undefined,
  ].filter(Boolean).join(` ${theme.fg("muted", "·")} `)];

  for (const subagent of details.subagents) {
    const result = details.results.find((entry) => entry.role === subagent.role);
    const snapshot = details.snapshots.find((entry) => entry.role === subagent.role);
    const label = subagent.icon ? `${subagent.icon} ${subagent.role}` : subagent.role;
    lines.push(renderCollapsedSubagentLine(label, snapshot, result, theme));
  }

  return lines.join("\n");
}

function renderHarnessSubagentsExpandedText(
  details: HarnessSubagentsToolDetails,
  isPartial: boolean,
  theme: { fg: (token: string, text: string) => string; bold: (text: string) => string },
): string {
  const lines: string[] = [];
  lines.push(theme.fg("toolTitle", theme.bold(`Subject: ${details.subject}`)));
  lines.push(theme.fg("muted", `Mode: ${details.mode} · ${details.completed}/${details.total} subagents complete${isPartial ? " · live" : ""}`));

  for (const subagent of details.subagents) {
    const result = details.results.find((entry) => entry.role === subagent.role);
    const snapshot = details.snapshots.find((entry) => entry.role === subagent.role);
    const source = snapshot ?? result;
    const phase = getSubagentPhase(snapshot, result);
    const phaseTone = getSubagentPhaseTone(snapshot, result);
    const toolSummary = result ? formatSubagentToolCounts(result.toolCalls) : "";
    const isolationFlags = source ? extractSubagentIsolationFlags(source.provenance.args) : [];
    const title = `${subagent.icon ? `${subagent.icon} ` : ""}${subagent.label}${subagent.label !== subagent.role ? ` (${subagent.role})` : ""}`;

    lines.push("");
    lines.push(theme.fg("toolTitle", theme.bold(title)));
    lines.push(`  ${theme.fg("muted", "PID:")} ${theme.fg("dim", String(source?.provenance.pid ?? "—"))}`);
    lines.push(`  ${theme.fg("muted", "Phase:")} ${theme.fg(phaseTone, phase)}${result ? theme.fg("dim", ` · exit ${result.exitCode}`) : ""}`);
    if (source?.model) lines.push(`  ${theme.fg("muted", "Model:")} ${theme.fg("dim", source.model)}`);
    if (source?.provenance.cwd) lines.push(`  ${theme.fg("muted", "CWD:")} ${theme.fg("dim", source.provenance.cwd)}`);
    if (source) lines.push(`  ${theme.fg("muted", "Invocation:")} ${theme.fg("dim", summarizeSubagentInvocation(source.provenance))}`);
    if (isolationFlags.length > 0) lines.push(`  ${theme.fg("muted", "Isolation:")} ${theme.fg("dim", isolationFlags.join(", "))}`);
    if (source?.provenance.startedAt || source?.provenance.endedAt) {
      lines.push(`  ${theme.fg("muted", "Lifetime:")} ${theme.fg("dim", `${source.provenance.startedAt ?? "?"} → ${source.provenance.endedAt ?? "running"}`)}`);
    }
    if (result) {
      lines.push(`  ${theme.fg("muted", "Evidence:")} ${theme.fg("dim", `search×${result.searches}, fetch×${result.fetches}, citations×${result.citations.length}`)}`);
      lines.push(`  ${theme.fg("muted", "Tools:")} ${theme.fg("dim", toolSummary || "none")}`);
      lines.push(`  ${theme.fg("muted", "Citations:")} ${theme.fg("dim", formatSubagentCitationPreview(result.citations))}`);
    }
    lines.push(`  ${theme.fg("muted", "Recent stream:")}`);
    lines.push(...renderSubagentRecentStreamLines(source, theme));
    lines.push(`  ${theme.fg("muted", "Output preview:")}`);
    lines.push(...renderSubagentPreviewLines(result?.output ?? source?.assistantPreview, theme));
    if (result?.stderr.trim()) {
      lines.push(`  ${theme.fg("muted", "stderr:")} ${theme.fg("error", summarizeSubagentText(result.stderr, MAX_SUBAGENT_STDERR_PREVIEW_CHARS))}`);
    }
  }

  return lines.join("\n");
}

function mapExploreRunResult(topic: string, result: HarnessSubagentRunResult<ExplorePersona>): ExploreSubagentResult {
  return {
    ...result,
    persona: result.role,
    topic,
    searches: result.toolCalls.harness_web_search ?? 0,
    fetches: result.toolCalls.harness_web_fetch ?? 0,
  };
}

function buildExploreSubagentDetails(
  topic: string,
  completed: number,
  total: number,
  results: HarnessSubagentRunResult<ExplorePersona>[],
  snapshots: HarnessSubagentSnapshot<ExplorePersona>[],
): ExploreSubagentToolDetails {
  return {
    topic,
    mode: "parallel",
    completed,
    total,
    results: results.map((result) => mapExploreRunResult(topic, result)),
    snapshots,
  };
}

function mapExecuteRunResult(objective: string, result: HarnessSubagentRunResult<ExecuteRole>): ExecuteSubagentResult {
  return {
    ...result,
    objective,
  };
}

function buildExecuteSubagentDetails(
  objective: string,
  mode: "parallel" | "sequential",
  roles: ExecuteRole[],
  completed: number,
  total: number,
  results: HarnessSubagentRunResult<ExecuteRole>[],
  snapshots: HarnessSubagentSnapshot<ExecuteRole>[],
): ExecuteSubagentToolDetails {
  return {
    objective,
    mode,
    completed,
    total,
    roles,
    results: results.map((result) => mapExecuteRunResult(objective, result)),
    snapshots,
  };
}

function parseIsoTimestampMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getElapsedMs(startedAt: string | undefined, endedAt: string | undefined): number | undefined {
  const startMs = parseIsoTimestampMs(startedAt);
  const endMs = parseIsoTimestampMs(endedAt);
  if (startMs === undefined || endMs === undefined) return undefined;
  return Math.max(0, endMs - startMs);
}

function sumToolCallMap(toolCalls: Record<string, number>): number {
  return Object.values(toolCalls).reduce((sum, count) => sum + count, 0);
}

function mergeToolCallCounts(results: Array<{ toolCalls: Record<string, number> }>): Record<string, number> {
  const merged: Record<string, number> = {};

  for (const result of results) {
    for (const [toolName, count] of Object.entries(result.toolCalls)) {
      merged[toolName] = (merged[toolName] ?? 0) + count;
    }
  }

  return merged;
}

function getSubagentBatchExitStatus(
  results: Array<{ exitCode: number }>,
): PersistedSubagentBatchExitStatus {
  if (results.length === 0) return "failed";

  const failures = results.filter((result) => result.exitCode !== 0).length;
  if (failures === 0) return "success";
  if (failures === results.length) return "failed";
  return "partial_failure";
}

function buildPersistedSubagentRunRecord(
  result: HarnessSubagentRunResult<string>,
  evidence?: PersistedSubagentRunRecord["evidence"],
): PersistedSubagentRunRecord {
  const outputPreview = summarizeSubagentText(
    result.output || result.assistantPreview,
    MAX_SUBAGENT_RECORD_OUTPUT_PREVIEW_CHARS,
  ) || undefined;
  const stderrPreview = summarizeSubagentText(result.stderr, MAX_SUBAGENT_RECORD_STDERR_PREVIEW_CHARS) || undefined;

  return {
    role: String(result.role),
    label: result.label,
    pid: result.provenance.pid,
    model: result.model,
    exitCode: result.exitCode,
    exitStatus: result.exitCode === 0 ? "success" : "error",
    startedAt: result.provenance.startedAt,
    endedAt: result.provenance.endedAt,
    durationMs: getElapsedMs(result.provenance.startedAt, result.provenance.endedAt),
    invocation: summarizeSubagentInvocation(result.provenance),
    citationsCount: result.citations.length,
    evidence,
    toolCalls: { ...result.toolCalls },
    outputPreview,
    stderrPreview,
  };
}

function buildExploreSubagentRecord(
  toolCallId: string,
  details: ExploreSubagentToolDetails,
  batchStartedAt: string,
  batchEndedAt: string,
): PersistedSubagentBatchRecord {
  const toolCalls = mergeToolCallCounts(details.results);
  const searches = details.results.reduce((sum, result) => sum + result.searches, 0);
  const fetches = details.results.reduce((sum, result) => sum + result.fetches, 0);

  return {
    schema: "harness-subagent-record/v1",
    toolCallId,
    mode: "explore",
    topic: details.topic,
    executionMode: details.mode,
    batch: {
      startedAt: batchStartedAt,
      endedAt: batchEndedAt,
      durationMs: getElapsedMs(batchStartedAt, batchEndedAt) ?? 0,
      completed: details.completed,
      total: details.total,
      exitStatus: getSubagentBatchExitStatus(details.results),
    },
    totals: {
      citationsCount: uniqueUrls(details.results.flatMap((result) => result.citations)).length,
      evidence: {
        searches,
        fetches,
      },
      toolCalls: {
        total: sumToolCallMap(toolCalls),
        byTool: toolCalls,
      },
    },
    subagents: details.results.map((result) => buildPersistedSubagentRunRecord(result, {
      searches: result.searches,
      fetches: result.fetches,
    })),
  };
}

function buildExecuteSubagentRecord(
  toolCallId: string,
  details: ExecuteSubagentToolDetails,
  batchStartedAt: string,
  batchEndedAt: string,
): PersistedSubagentBatchRecord {
  const toolCalls = mergeToolCallCounts(details.results);

  return {
    schema: "harness-subagent-record/v1",
    toolCallId,
    mode: "execute",
    objective: details.objective,
    executionMode: details.mode,
    batch: {
      startedAt: batchStartedAt,
      endedAt: batchEndedAt,
      durationMs: getElapsedMs(batchStartedAt, batchEndedAt) ?? 0,
      completed: details.completed,
      total: details.total,
      exitStatus: getSubagentBatchExitStatus(details.results),
    },
    totals: {
      citationsCount: uniqueUrls(details.results.flatMap((result) => result.citations)).length,
      toolCalls: {
        total: sumToolCallMap(toolCalls),
        byTool: toolCalls,
      },
    },
    subagents: details.results.map((result) => buildPersistedSubagentRunRecord(result)),
  };
}

function buildHarnessSubagentsRecord(
  toolCallId: string,
  details: HarnessSubagentsToolDetails,
  batchStartedAt: string,
  batchEndedAt: string,
): PersistedSubagentBatchRecord {
  const toolCalls = mergeToolCallCounts(details.results);
  const searches = details.results.reduce((sum, result) => sum + result.searches, 0);
  const fetches = details.results.reduce((sum, result) => sum + result.fetches, 0);

  return {
    schema: "harness-subagent-record/v1",
    toolCallId,
    mode: "generic",
    subject: details.subject,
    executionMode: details.mode,
    batch: {
      startedAt: batchStartedAt,
      endedAt: batchEndedAt,
      durationMs: getElapsedMs(batchStartedAt, batchEndedAt) ?? 0,
      completed: details.completed,
      total: details.total,
      exitStatus: getSubagentBatchExitStatus(details.results),
    },
    totals: {
      citationsCount: uniqueUrls(details.results.flatMap((result) => result.citations)).length,
      evidence: {
        searches,
        fetches,
      },
      toolCalls: {
        total: sumToolCallMap(toolCalls),
        byTool: toolCalls,
      },
    },
    subagents: details.results.map((result) => buildPersistedSubagentRunRecord(result, {
      searches: result.searches,
      fetches: result.fetches,
    })),
  };
}

function formatPersistedSubagentRecordSummary(record: PersistedSubagentBatchRecord): string {
  const subject = summarizeSubagentText(
    record.subject ?? record.topic ?? record.objective,
    72,
  ) || `${record.mode} batch`;
  const evidenceSummary = record.totals.evidence
    ? ` | 🔎${record.totals.evidence.searches ?? 0} | 🌐${record.totals.evidence.fetches ?? 0}`
    : "";

  return `${record.mode}:${record.batch.exitStatus} | ${subject} | ${record.batch.completed}/${record.batch.total} | 🔗${record.totals.citationsCount} | 🛠️${record.totals.toolCalls.total}${evidenceSummary}`;
}

function parseDuckDuckGoHtml(html: string, maxResults: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  const linkRegex = /<a[^>]+class="[^"]*(?:result__a|result-link)[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    const rawUrl = decodeHtmlEntities(match[1]);
    const url = normalizeSourceUrl(unwrapDuckDuckGoUrl(rawUrl));
    const title = stripTags(match[2]);

    if (!title || !/^https?:\/\//i.test(url) || seen.has(url)) continue;

    const windowHtml = html.slice(match.index, Math.min(html.length, match.index + 1800));
    const snippetMatch = windowHtml.match(/<(?:a|div)[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]) : undefined;

    seen.add(url);
    results.push({ title, url, snippet, source: "duckduckgo" });

    if (results.length >= maxResults) break;
  }

  return results;
}

function ensureHttpUrl(input: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Only http(s) URLs are supported. Received: ${parsed.protocol}`);
  }

  return parsed;
}

function getSearchBackend(requested?: string): SearchBackend {
  const normalized = requested?.trim().toLowerCase();
  if (normalized === "duckduckgo" || normalized === "searxng" || normalized === "tavily") {
    return normalized;
  }
  if (process.env.TAVILY_API_KEY) return "tavily";
  if (process.env.HARNESS_SEARXNG_URL) return "searxng";
  return "duckduckgo";
}

async function searchWithDuckDuckGo(query: string, maxResults: number, signal?: AbortSignal): Promise<WebSearchResult[]> {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    method: "GET",
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; harness-web-search/1.0)",
      accept: "text/html,application/xhtml+xml",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const results = parseDuckDuckGoHtml(html, maxResults);
  if (results.length === 0) {
    throw new Error("DuckDuckGo search returned no parseable results. Configure TAVILY_API_KEY or HARNESS_SEARXNG_URL for a more structured backend.");
  }
  return results;
}

async function searchWithSearxng(query: string, maxResults: number, signal?: AbortSignal): Promise<WebSearchResult[]> {
  const baseUrl = process.env.HARNESS_SEARXNG_URL;
  if (!baseUrl) {
    throw new Error("HARNESS_SEARXNG_URL is not set.");
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/search?format=json&q=${encodeURIComponent(query)}`, {
    headers: { accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    throw new Error(`SearXNG search failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };

  return (data.results ?? [])
    .filter((item) => item.title && item.url)
    .slice(0, maxResults)
    .map((item) => ({
      title: item.title!,
      url: normalizeSourceUrl(item.url!),
      snippet: item.content,
      source: "searxng",
    }));
}

async function searchWithTavily(query: string, maxResults: number, signal?: AbortSignal): Promise<WebSearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is not set.");
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      search_depth: "advanced",
      include_answer: false,
      include_raw_content: false,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };

  return (data.results ?? [])
    .filter((item) => item.title && item.url)
    .slice(0, maxResults)
    .map((item) => ({
      title: item.title!,
      url: normalizeSourceUrl(item.url!),
      snippet: item.content,
      source: "tavily",
    }));
}

async function runWebSearch(
  query: string,
  maxResults: number,
  backend: SearchBackend,
  signal?: AbortSignal,
): Promise<{ backend: SearchBackend; results: WebSearchResult[] }> {
  const results = backend === "tavily"
    ? await searchWithTavily(query, maxResults, signal)
    : backend === "searxng"
      ? await searchWithSearxng(query, maxResults, signal)
      : await searchWithDuckDuckGo(query, maxResults, signal);

  return { backend, results: results.slice(0, maxResults) };
}

function extractAssistantText(message: any): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((item: any) => item?.type === "text" && typeof item.text === "string")
      .map((item: any) => item.text)
      .join("\n");
  }
  if (typeof message.text === "string") return message.text;
  return "";
}

function extractUrlsFromText(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)\]>"']+/g) ?? [];
  return uniqueUrls(matches);
}

// ─── Explore bash enforcement helpers ─────────────────────────────────

function createExploreEvidenceTotals(): ExploreEvidenceTotals {
  return {
    searches: 0,
    fetches: 0,
    subagentRuns: 0,
    sources: new Set<string>(),
    retries: 0,
  };
}

function createExploreEvidenceChain(): ExploreEvidenceChain {
  return {
    active: false,
    searches: 0,
    fetches: 0,
    subagentRuns: 0,
    browserResearchCalls: 0,
    sources: new Set<string>(),
    retries: 0,
    readyToConcludeSent: false,
  };
}

function createExecuteSubagentTotals(): ExecuteSubagentTotals {
  return {
    subagentRuns: 0,
    roleRuns: {
      PLN: 0,
      IMP: 0,
      VER: 0,
    },
  };
}

// ─── Extension ────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  registerCompactBuiltinToolRenderers(pi);

  let state: HarnessState = {
    acStatuses: [],
    regressionCount: 0,
    commitCount: 0,
  };
  let activeProtocol: HarnessProtocol | undefined;
  let pendingProtocolInvocation: PendingProtocolInvocation | undefined;

  let baselineActiveTools: string[] = [];
  let exploreTotals = createExploreEvidenceTotals();
  let exploreChain = createExploreEvidenceChain();
  let executeTotals = createExecuteSubagentTotals();
  let currentManagedBinding: ManagedSessionBinding | undefined;
  let currentManagedLease: ManagedWorktreeLease | undefined;

  function getRuntimeProtocol(): HarnessProtocol | "generic" {
    if (IS_SUBAGENT_CHILD) {
      return CHILD_SUBAGENT_MODE === "explore" || CHILD_SUBAGENT_MODE === "execute"
        ? CHILD_SUBAGENT_MODE
        : "generic";
    }
    return activeProtocol ?? "generic";
  }

  function isExploreRuntime(): boolean {
    return getRuntimeProtocol() === "explore";
  }

  function isExecuteRuntime(): boolean {
    return getRuntimeProtocol() === "execute";
  }

  function isChildExploreRuntime(): boolean {
    return IS_SUBAGENT_CHILD && CHILD_SUBAGENT_MODE === "explore";
  }

  function getActiveToolNames(): string[] {
    const active = pi.getActiveTools() as Array<string | { name?: string }>;
    return active
      .map((tool) => typeof tool === "string" ? tool : tool?.name)
      .filter((name): name is string => typeof name === "string");
  }

  function getAllToolNames(): string[] {
    return pi.getAllTools().map((tool) => tool.name);
  }

  function saveState() {
    pi.appendEntry("cognitive-harness-state", { ...state });
  }

  function appendSubagentBatchRecord(record: PersistedSubagentBatchRecord): PersistedSubagentBatchRecordLink {
    pi.appendEntry(HARNESS_SUBAGENT_RECORD_TYPE, record);
    return {
      entryType: "custom",
      customType: HARNESS_SUBAGENT_RECORD_TYPE,
      toolCallId: record.toolCallId,
      summary: formatPersistedSubagentRecordSummary(record),
    };
  }

  function resetExploreTracking() {
    exploreTotals = createExploreEvidenceTotals();
    exploreChain = createExploreEvidenceChain();
  }

  function resetExecuteTracking() {
    executeTotals = createExecuteSubagentTotals();
  }

  function beginExploreEvidenceChainIfNeeded() {
    if (!isExploreRuntime()) return;
    if (!exploreChain.active) {
      exploreChain = createExploreEvidenceChain();
      exploreChain.active = true;
    }
  }

  function recordExternalSources(urls: Iterable<string>) {
    for (const url of uniqueUrls(urls)) {
      exploreTotals.sources.add(url);
      if (exploreChain.active) exploreChain.sources.add(url);
    }
  }

  function markSearchUsage(urls: Iterable<string>) {
    beginExploreEvidenceChainIfNeeded();
    exploreTotals.searches += 1;
    if (exploreChain.active) exploreChain.searches += 1;
    recordExternalSources(urls);
  }

  function markFetchUsage(urls: Iterable<string>) {
    beginExploreEvidenceChainIfNeeded();
    exploreTotals.fetches += 1;
    if (exploreChain.active) exploreChain.fetches += 1;
    recordExternalSources(urls);
  }

  function getTrackedSubagentSearchCount(result: { searches?: number; toolCalls?: Record<string, number> }): number {
    return result.searches ?? result.toolCalls?.harness_web_search ?? 0;
  }

  function getTrackedSubagentFetchCount(result: { fetches?: number; toolCalls?: Record<string, number> }): number {
    return result.fetches ?? result.toolCalls?.harness_web_fetch ?? 0;
  }

  function markSubagentUsage(details: { results: Array<{ citations: string[]; searches?: number; fetches?: number; toolCalls?: Record<string, number> }> } | undefined) {
    beginExploreEvidenceChainIfNeeded();
    exploreTotals.subagentRuns += 1;
    if (exploreChain.active) exploreChain.subagentRuns += 1;
    if (!details) return;

    const searches = details.results.reduce((sum, result) => sum + getTrackedSubagentSearchCount(result), 0);
    const fetches = details.results.reduce((sum, result) => sum + getTrackedSubagentFetchCount(result), 0);

    exploreTotals.searches += searches;
    exploreTotals.fetches += fetches;
    if (exploreChain.active) {
      exploreChain.searches += searches;
      exploreChain.fetches += fetches;
    }
    recordExternalSources(details.results.flatMap((result) => result.citations));
  }

  function markBrowserResearch(command: string) {
    beginExploreEvidenceChainIfNeeded();
    exploreTotals.fetches += 1;
    if (exploreChain.active) {
      exploreChain.fetches += 1;
      exploreChain.browserResearchCalls += 1;
    }
    recordExternalSources(extractUrlsFromText(command));
  }

  function markExecuteSubagentUsage(details: { results: Array<{ role: string }> } | undefined) {
    executeTotals.subagentRuns += 1;
    if (!details) return;

    for (const result of details.results) {
      if (result.role === "PLN" || result.role === "IMP" || result.role === "VER") {
        executeTotals.roleRuns[result.role] += 1;
      }
    }
  }

  function setProtocolTools(protocol: HarnessProtocol | undefined) {
    const all = new Set(getAllToolNames());

    if (baselineActiveTools.length === 0) {
      baselineActiveTools = getActiveToolNames();
    }

    if (protocol === "explore") {
      const safe = [...SAFE_EXPLORE_TOOL_NAMES].filter((name) => all.has(name));
      pi.setActiveTools(safe);
      return;
    }

    if (protocol === "execute") {
      const safe = [...SAFE_EXECUTE_TOOL_NAMES].filter((name) => all.has(name));
      pi.setActiveTools(safe);
      return;
    }

    const target = new Set<string>([
      ...baselineActiveTools,
      ...SAFE_EXPLORE_TOOL_NAMES,
      ...SAFE_EXECUTE_TOOL_NAMES,
    ]);

    pi.setActiveTools([...target].filter((name) => all.has(name)));
  }

  async function execGit(args: string[], timeout = 10_000, signal?: AbortSignal) {
    return pi.exec("git", args, { signal, timeout });
  }

  function getManagedStatusSummary(): string | undefined {
    if (!currentManagedBinding) return undefined;
    const stateLabel = currentManagedLease?.lifecycleState ?? "binding-only";
    return `${currentManagedBinding.worktreeId} · ${stateLabel}`;
  }

  async function getGitRepoContext(cwd: string, signal?: AbortSignal) {
    const repoRootResult = await execGit(["-C", cwd, "rev-parse", "--show-toplevel"], 10_000, signal);
    if (repoRootResult.code !== 0) {
      throw new Error("Managed worktrees require a git repository.");
    }

    let gitCommonDirResult = await execGit(["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], 10_000, signal);
    if (gitCommonDirResult.code !== 0) {
      gitCommonDirResult = await execGit(["-C", cwd, "rev-parse", "--git-common-dir"], 10_000, signal);
    }
    if (gitCommonDirResult.code !== 0) {
      throw new Error(gitCommonDirResult.stderr.trim() || "Failed to resolve git common dir.");
    }

    const headResult = await execGit(["-C", cwd, "rev-parse", "HEAD"], 10_000, signal);
    if (headResult.code !== 0) {
      throw new Error(headResult.stderr.trim() || "Failed to resolve HEAD commit.");
    }

    const repoRoot = repoRootResult.stdout.trim();
    const gitCommonDir = resolveGitCommonDir(repoRoot, gitCommonDirResult.stdout);
    return {
      repoRoot,
      gitCommonDir,
      canonicalRepoRoot: resolveCanonicalRepoRoot(repoRoot, gitCommonDir),
      headCommit: headResult.stdout.trim(),
    };
  }

  async function loadManagedLease(binding: ManagedSessionBinding | undefined): Promise<ManagedWorktreeLease | undefined> {
    if (!binding) return undefined;
    return readManagedWorktreeLease(binding.leaseFile);
  }

  async function getLiveManagedGitFacts(cwd: string, signal?: AbortSignal): Promise<{ worktreePath?: string; branch?: string }> {
    const worktreeResult = await execGit(["-C", cwd, "rev-parse", "--show-toplevel"], 10_000, signal);
    const branchResult = await execGit(["-C", cwd, "branch", "--show-current"], 10_000, signal);
    return {
      worktreePath: worktreeResult.code === 0 ? worktreeResult.stdout.trim() : undefined,
      branch: branchResult.code === 0 ? branchResult.stdout.trim() : undefined,
    };
  }

  async function evaluateCurrentManagedMutation(ctx: ExtensionContext, required = Boolean(currentManagedBinding)) {
    const binding = IS_SUBAGENT_CHILD ? CHILD_MANAGED_WORKTREE_BINDING : currentManagedBinding;
    const lease = IS_SUBAGENT_CHILD ? await loadManagedLease(binding) : currentManagedLease;
    const facts = await getLiveManagedGitFacts(ctx.cwd, ctx.signal);
    return evaluateManagedMutationGate({
      required: IS_SUBAGENT_CHILD ? CHILD_MANAGED_WORKTREE_REQUIRED : required,
      cwd: ctx.cwd,
      binding,
      lease,
      liveWorktreePath: facts.worktreePath,
      liveBranch: facts.branch,
    });
  }

  function buildManagedSubagentEnv(): Record<string, string> | undefined {
    if (!currentManagedBinding) return undefined;
    return {
      HARNESS_MANAGED_WORKTREE_REQUIRED: "1",
      HARNESS_MANAGED_WORKTREE_BINDING: Buffer.from(JSON.stringify(currentManagedBinding), "utf-8").toString("base64url"),
    };
  }

  async function reconcileManagedSessionBinding(ctx: ExtensionContext) {
    currentManagedBinding = readManagedSessionBinding(ctx.sessionManager.getEntries() as Array<{ type: string; customType?: string; data?: unknown }>);
    currentManagedLease = await loadManagedLease(currentManagedBinding);

    if (currentManagedBinding && !currentManagedLease) {
      ctx.ui.notify(`Managed worktree lease is missing for ${currentManagedBinding.worktreeId}.`, "warning");
      return;
    }

    if (!currentManagedBinding || !currentManagedLease) return;

    if (!currentManagedBinding.sessionFile && ctx.sessionManager.getSessionFile()) {
      currentManagedBinding = {
        ...currentManagedBinding,
        sessionFile: ctx.sessionManager.getSessionFile(),
      };
    }

    if (!currentManagedLease.sessionFile && ctx.sessionManager.getSessionFile()) {
      currentManagedLease = {
        ...currentManagedLease,
        sessionFile: ctx.sessionManager.getSessionFile(),
      };
    }

    if (!currentManagedBinding || !currentManagedLease) return;

    if (!currentManagedBinding.worktreePath || !currentManagedBinding.targetCwd) return;

    if (!existsSync(currentManagedBinding.worktreePath)) {
      currentManagedLease = {
        ...currentManagedLease,
        lifecycleState: "managed-missing",
        missingSince: currentManagedLease.missingSince ?? new Date().toISOString(),
      };
      await writeManagedWorktreeLease(currentManagedLease);
      ctx.ui.notify(`Managed worktree path is missing: ${currentManagedBinding.worktreePath}`, "warning");
      return;
    }

    currentManagedLease = refreshManagedLease(
      currentManagedLease,
      "managed-active",
      new Date(),
      DEFAULT_MANAGED_LEASE_TTL_MS,
    );
    await writeManagedWorktreeLease(currentManagedLease);
  }

  async function refreshManagedLeaseHeartbeat() {
    if (!currentManagedLease) return;
    currentManagedLease = refreshManagedLease(currentManagedLease, "managed-active", new Date(), DEFAULT_MANAGED_LEASE_TTL_MS);
    await writeManagedWorktreeLease(currentManagedLease);
  }

  async function softReleaseManagedLease() {
    if (!currentManagedLease) return;
    currentManagedLease = refreshManagedLease(currentManagedLease, "managed-released", new Date(), DEFAULT_MANAGED_LEASE_TTL_MS);
    await writeManagedWorktreeLease(currentManagedLease);
  }

  async function runManagedWorktreeJanitor(ctx: ExtensionContext, gitCommonDir: string, currentBindingId?: string) {
    const leaseFiles = await listManagedWorktreeLeaseFiles(gitCommonDir);
    if (leaseFiles.length === 0) return;

    const worktreeListResult = await execGit(["-C", ctx.cwd, "worktree", "list", "--porcelain"], 10_000, ctx.signal);
    if (worktreeListResult.code !== 0) return;

    const worktreeRecords = parseGitWorktreeList(worktreeListResult.stdout);

    for (const leaseFile of leaseFiles) {
      const lease = await readManagedWorktreeLease(leaseFile);
      if (!lease) continue;

      const worktreeRecord = findGitWorktreeRecord(worktreeRecords, lease.worktreePath);
      let clean = false;
      let uniqueCommitCount = Number.POSITIVE_INFINITY;

      if (worktreeRecord) {
        const statusResult = await execGit(["-C", lease.worktreePath, "status", "--porcelain", "--untracked-files=all"], 10_000, ctx.signal);
        clean = statusResult.code === 0 && !hasRelevantGitStatusChanges(statusResult.stdout, lease.worktreePath);

        const revListResult = await execGit(["-C", lease.worktreePath, "rev-list", "--count", `${lease.baseCommit}..HEAD`], 10_000, ctx.signal);
        uniqueCommitCount = revListResult.code === 0 ? Number.parseInt(revListResult.stdout.trim() || "0", 10) : Number.POSITIVE_INFINITY;
      }

      const decision = evaluateManagedJanitorDecision({
        lease,
        currentBindingId,
        worktreeRecord,
        clean,
        uniqueCommitCount,
      });

      if (decision.remove) {
        await execGit(["-C", lease.repoRoot, "worktree", "remove", lease.worktreePath], 15_000, ctx.signal);
        await deleteManagedWorktreeLease(lease.leaseFile);
        continue;
      }

      if (decision.nextState && lease.lifecycleState !== decision.nextState) {
        await writeManagedWorktreeLease({
          ...lease,
          lifecycleState: decision.nextState,
          missingSince: decision.nextState === "managed-missing"
            ? lease.missingSince ?? new Date().toISOString()
            : lease.missingSince,
        });
      }
    }
  }

  function beginActiveProtocolRun(invocation: PendingProtocolInvocation | undefined, ctx: ExtensionContext) {
    activeProtocol = invocation?.protocol;
    pendingProtocolInvocation = undefined;

    if (activeProtocol === "explore") {
      state.debateRound = 0;
      saveState();
      resetExploreTracking();
      resetExecuteTracking();
      setProtocolTools("explore");
      updateUI(ctx);
      return;
    }

    if (activeProtocol === "execute") {
      state.criteriaFile = invocation?.argsText || undefined;
      state.currentIncrement = undefined;
      state.regressionCount = 0;
      state.commitCount = 0;
      saveState();
      endExploreEvidenceChain();
      resetExecuteTracking();
      setProtocolTools("execute");
      updateUI(ctx);
      return;
    }

    setProtocolTools(undefined);
    updateUI(ctx);
  }

  function clearActiveProtocolRun(ctx: ExtensionContext) {
    activeProtocol = undefined;
    pendingProtocolInvocation = undefined;
    endExploreEvidenceChain();
    setProtocolTools(undefined);
    updateUI(ctx);
  }

  function updateUI(ctx: ExtensionContext) {
    if (IS_SUBAGENT_CHILD || !ctx.hasUI) return;

    ctx.ui.setWidget("harness", undefined);

    if (getManagedStatusSummary()) {
      ctx.ui.setStatus("harness", `🧱 WT ${getManagedStatusSummary()}`);
      return;
    }

    ctx.ui.setStatus("harness", undefined);
  }

  function endExploreEvidenceChain() {
    exploreChain = createExploreEvidenceChain();
  }

  function getExploreGateAssessment(finalText: string) {
    return evaluateExploreEvidenceGate({
      scope: IS_SUBAGENT_CHILD ? "child" : "parent",
      searches: exploreChain.searches,
      fetches: exploreChain.fetches,
      subagentRuns: exploreChain.subagentRuns,
      browserResearchCalls: exploreChain.browserResearchCalls,
      uniqueSourceCount: exploreChain.sources.size,
      finalText,
    });
  }

  function formatExploreGateMissingItems(items: string[]): string[] {
    return items.map((item, index) => `${index + 1}. ${item}`);
  }

  function buildExploreKeepResearchingMessage(finalText: string): string {
    const assessment = getExploreGateAssessment(finalText);
    const lines: string[] = [];

    if (IS_SUBAGENT_CHILD) {
      lines.push("SYSTEM ENFORCEMENT: Do not conclude yet.");
      lines.push("Keep researching until the external-evidence gate passes.");
      lines.push("");
      lines.push("Missing before conclusion:");
      lines.push(...formatExploreGateMissingItems(assessment.missingCompletion));
      lines.push("");
      lines.push("Use only read-only local inspection plus harness_web_search / harness_web_fetch.");
      lines.push("Do not call harness_subagents from this child process.");
      lines.push("When you have enough evidence, wait for the next instruction to conclude.");
      return lines.join("\n");
    }

    lines.push("SYSTEM ENFORCEMENT: Do not conclude the /explore run yet.");
    lines.push("The external-evidence gate is still open.");
    lines.push("");
    lines.push("Missing before completion:");
    lines.push(...formatExploreGateMissingItems(assessment.missingCompletion));
    lines.push("");
    lines.push("Before the next answer, you MUST:");
    lines.push("1. Call harness_subagents to run the isolated OPT/PRA/SKP/EMP subagents in parallel if that is still missing.");
    lines.push("2. Use harness_web_search for focused external queries when you need additional evidence beyond the subagent pass.");
    lines.push("3. Use harness_web_fetch on relevant URLs before relying on them in the synthesis.");
    lines.push("4. Revise the debate so every external claim cites explicit source URLs.");
    lines.push("5. Mark unsupported claims as [UNVERIFIED] or strike them from the synthesis.");
    lines.push("6. Keep local codebase claims tied to file paths; keep external claims tied to URLs.");
    lines.push("");
    lines.push("Continue exploring; do not conclude until the gate passes.");
    return lines.join("\n");
  }

  function buildExploreReadyToConcludeMessage(): string {
    return [
      "SYSTEM ENFORCEMENT: Evidence bar met.",
      "Stop researching and conclude now.",
      "",
      "Return the final markdown in the required format.",
      "- Cite local claims with file paths.",
      "- Cite external claims with explicit URLs.",
      "- Keep unsupported claims marked [UNVERIFIED].",
      "- Do not call more tools unless a citation is still missing.",
    ].join("\n");
  }

  // ── State persistence ─────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    state = { acStatuses: [], regressionCount: 0, commitCount: 0 };
    activeProtocol = undefined;
    pendingProtocolInvocation = undefined;
    baselineActiveTools = getActiveToolNames();
    resetExploreTracking();
    resetExecuteTracking();
    currentManagedBinding = undefined;
    currentManagedLease = undefined;

    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === "cognitive-harness-state") {
        state = {
          acStatuses: [],
          regressionCount: 0,
          commitCount: 0,
          ...stripLegacyHarnessMode((entry.data ?? {}) as Partial<HarnessState & { mode?: unknown }>),
        };
      }
    }

    if (IS_SUBAGENT_CHILD) {
      const childTools = (CHILD_SUBAGENT_TOOLS.length > 0 ? CHILD_SUBAGENT_TOOLS : [...SAFE_SUBAGENT_CHILD_TOOL_NAMES])
        .filter((name) => getAllToolNames().includes(name));
      pi.setActiveTools(childTools);
      return;
    }

    await reconcileManagedSessionBinding(ctx);
    const janitorRepo = currentManagedBinding
      ? { gitCommonDir: currentManagedBinding.gitCommonDir }
      : await getGitRepoContext(ctx.cwd).catch(() => undefined);
    if (janitorRepo?.gitCommonDir) {
      await runManagedWorktreeJanitor(ctx, janitorRepo.gitCommonDir, currentManagedBinding?.worktreeId);
    }

    setProtocolTools(undefined);
    updateUI(ctx);
  });

  // ── Protocol invocation routing ───────────────────────────────────

  pi.on("input", async (event) => {
    if (IS_SUBAGENT_CHILD || event.source === "extension") {
      return { action: "continue" };
    }

    const invocation = parseHarnessProtocolInvocation(event.text);
    pendingProtocolInvocation = invocation
      ? { protocol: invocation.protocol, argsText: invocation.argsText }
      : undefined;

    if (!invocation?.rewrittenText) {
      return { action: "continue" };
    }

    return {
      action: "transform",
      text: invocation.rewrittenText,
    };
  });

  pi.registerCommand("harness-status", {
    description: "Show the active harness run and stored execute state",
    handler: async (_args, ctx) => {
      const lines: string[] = [];
      lines.push(activeProtocol
        ? `Active protocol: ${activeProtocol}`
        : "No active /explore or /execute run.");

      if (activeProtocol === "explore") {
        lines.push(`Debate round: ${state.debateRound ?? 0}/3`);
        lines.push(`External evidence: 🤖 ${exploreTotals.subagentRuns} subagent rounds | 🔎 ${exploreTotals.searches} searches | 🌐 ${exploreTotals.fetches} fetches | 🔗 ${exploreTotals.sources.size} URLs | ↺ ${exploreTotals.retries} retries`);
      }

      if (activeProtocol === "execute" || state.criteriaFile || state.currentIncrement || state.commitCount > 0 || state.regressionCount > 0 || state.acStatuses.length > 0) {
        const passed = state.acStatuses.filter((a) => a.status === "pass").length;
        const failed = state.acStatuses.filter((a) => a.status === "fail").length;
        const pending = state.acStatuses.filter((a) => a.status === "pending").length;
        lines.push(`ACs: ✅ ${passed} | ❌ ${failed} | ⏳ ${pending}`);
        lines.push(`Regressions: ${state.regressionCount}`);
        lines.push(`Subagents: 🤖 ${executeTotals.subagentRuns} | PLN ${executeTotals.roleRuns.PLN} | IMP ${executeTotals.roleRuns.IMP} | VER ${executeTotals.roleRuns.VER}`);
        if (state.currentIncrement) lines.push(`Current: ${state.currentIncrement}`);
        if (state.criteriaFile) lines.push(`Criteria: ${state.criteriaFile}`);
        lines.push(`Commits: ${state.commitCount}`);
      }

      if (currentManagedBinding) {
        lines.push(`Managed worktree: ${currentManagedBinding.worktreeId}`);
        lines.push(`Managed branch: ${currentManagedBinding.branch}`);
        lines.push(`Managed path: ${currentManagedBinding.worktreePath}`);
        lines.push(`Managed state: ${currentManagedLease?.lifecycleState ?? "binding-only"}`);
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand(INTERNAL_MANAGED_WORKTREE_COMMAND, {
    description: "[internal] Create a managed worktree and switch into its session",
    handler: async (args, ctx) => {
      let request: { headOnlyFromDirty?: boolean } = {};
      const trimmedArgs = args.trim();
      if (trimmedArgs) {
        try {
          request = JSON.parse(Buffer.from(trimmedArgs, "base64url").toString("utf-8"));
        } catch {
          ctx.ui.notify("Managed worktree bootstrap arguments were invalid.", "error");
          return;
        }
      }

      let repoContext;
      try {
        repoContext = await getGitRepoContext(ctx.cwd);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Managed worktree bootstrap failed: ${reason}`, "error");
        return;
      }

      await runManagedWorktreeJanitor(ctx, repoContext.gitCommonDir, currentManagedBinding?.worktreeId);

      const sessionDirPath = resolveSessionDirForCwd(ctx.sessionManager.getSessionDir(), ctx.cwd);
      const ignoredStatusPaths = isPathInside(repoContext.repoRoot, sessionDirPath) ? [sessionDirPath] : [];
      const statusResult = await execGit(["-C", repoContext.repoRoot, "status", "--porcelain", "--untracked-files=all"], 10_000);
      if (statusResult.code !== 0) {
        ctx.ui.notify(`Managed worktree bootstrap failed: ${statusResult.stderr.trim()}`, "error");
        return;
      }

      const hasDirtyChanges = hasRelevantGitStatusChanges(statusResult.stdout, repoContext.repoRoot, ignoredStatusPaths);
      if (hasDirtyChanges && !request.headOnlyFromDirty) {
        ctx.ui.notify(
          "Managed worktree bootstrap cancelled: the current checkout is dirty, and uncommitted changes are not carried into the new worktree. Re-run with explicit HEAD-only confirmation.",
          "warning",
        );
        return;
      }

      const worktreeId = createManagedWorktreeId();
      const branch = buildManagedBranchName(worktreeId);
      const worktreeRoot = resolveManagedWorktreeRoot(repoContext.canonicalRepoRoot, worktreeId);
      let targetCwd = resolveManagedTargetCwd(worktreeRoot, repoContext.repoRoot, ctx.cwd);
      const targetSessionDir = resolveTargetSessionDir(ctx.sessionManager.getSessionDir(), worktreeRoot);
      const initialLease = createManagedWorktreeLease({
        worktreeId,
        worktreePath: worktreeRoot,
        targetCwd,
        branch,
        repoRoot: repoContext.repoRoot,
        gitCommonDir: repoContext.gitCommonDir,
        baseCommit: repoContext.headCommit,
        lifecycleState: "provisioning",
      });

      await writeManagedWorktreeLease(initialLease);

      try {
        const addResult = await execGit(["-C", repoContext.repoRoot, "worktree", "add", "-b", branch, worktreeRoot, "HEAD"], 20_000);
        if (addResult.code !== 0) {
          throw new Error(addResult.stderr.trim() || addResult.stdout.trim() || "git worktree add failed");
        }

        if (!existsSync(targetCwd)) {
          targetCwd = worktreeRoot;
        }

        const targetSessionFile = await writeManagedSessionFile({
          cwd: targetCwd,
          sessionDir: targetSessionDir,
          parentSession: ctx.sessionManager.getSessionFile(),
          binding: createManagedSessionBinding({
            ...initialLease,
            targetCwd,
          }),
        });

        currentManagedLease = refreshManagedLease({
          ...initialLease,
          targetCwd,
          sessionFile: targetSessionFile,
        }, "managed-active", new Date(), DEFAULT_MANAGED_LEASE_TTL_MS);
        await writeManagedWorktreeLease(currentManagedLease);

        ctx.ui.notify(
          `Prepared managed worktree ${worktreeId} (${branch}). Switching to ${targetCwd}.`,
          "info",
        );
        await ctx.switchSession(targetSessionFile);
      } catch (error) {
        await deleteManagedWorktreeLease(initialLease.leaseFile);
        await execGit(["-C", repoContext.repoRoot, "worktree", "remove", "--force", worktreeRoot], 15_000);
        await execGit(["-C", repoContext.repoRoot, "branch", "-D", branch], 10_000);

        const reason = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Managed worktree bootstrap failed: ${reason}`, "error");
      }
    },
  });

  // ── External evidence tracking ─────────────────────────────────────

  pi.on("agent_start", async () => {
    if (!isExploreRuntime()) return;
    if (!exploreChain.active) {
      beginExploreEvidenceChainIfNeeded();
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    if (isExploreRuntime()) {
      if (event.toolName === "harness_subagents" || event.toolName === "harness_explore_subagents") {
        const details = event.details as HarnessSubagentsToolDetails | ExploreSubagentToolDetails | undefined;
        markSubagentUsage(details as { results: Array<{ citations: string[]; searches?: number; fetches?: number; toolCalls?: Record<string, number> }> } | undefined);
        updateUI(ctx);
        return;
      }

      if (event.toolName === "harness_web_search") {
        const details = event.details as { results?: Array<{ url?: string }> } | undefined;
        markSearchUsage((details?.results ?? []).map((item) => item.url).filter((url): url is string => Boolean(url)));
        updateUI(ctx);
        return;
      }

      if (event.toolName === "harness_web_fetch") {
        const details = event.details as { finalUrl?: string } | undefined;
        markFetchUsage(details?.finalUrl ? [details.finalUrl] : []);
        updateUI(ctx);
        return;
      }

      if (event.toolName === "bash") {
        const input = event.input as { command?: string } | undefined;
        const command = input?.command?.trim();
        if (command && isAgentBrowserCommand(command)) {
          markBrowserResearch(command);
          updateUI(ctx);
        }
      }

      return;
    }

    if (isExecuteRuntime() && (event.toolName === "harness_subagents" || event.toolName === "harness_execute_subagents")) {
      const details = event.details as HarnessSubagentsToolDetails | ExecuteSubagentToolDetails | undefined;
      markExecuteSubagentUsage(details as { results: Array<{ role: string }> } | undefined);
      updateUI(ctx);
    }
  });

  pi.on("turn_end", async (event, ctx) => {
    if (!IS_SUBAGENT_CHILD && currentManagedLease?.lifecycleState === "managed-active") {
      await refreshManagedLeaseHeartbeat();
    }

    if (!isExploreRuntime() || !exploreChain.active) return;

    const finalText = event.message?.role === "assistant"
      ? extractAssistantText(event.message as any)
      : "";
    const assessment = getExploreGateAssessment(finalText);
    const hasToolResults = event.toolResults.length > 0;

    if (hasToolResults) {
      if (isChildExploreRuntime() && assessment.researchReady && !exploreChain.readyToConcludeSent) {
        exploreChain.readyToConcludeSent = true;
        pi.sendUserMessage(buildExploreReadyToConcludeMessage(), { deliverAs: "steer" });
      }
      return;
    }

    if (assessment.completionReady) {
      endExploreEvidenceChain();
      updateUI(ctx);
      return;
    }

    exploreChain.retries += 1;
    exploreTotals.retries += 1;
    updateUI(ctx);
    if (!IS_SUBAGENT_CHILD) {
      ctx.ui.notify("External-evidence gate triggered — continuing exploration before conclusion.", "warning");
    }
    pi.sendUserMessage(buildExploreKeepResearchingMessage(finalText), { deliverAs: "steer" });
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (isExploreRuntime() && exploreChain.active) {
      if (!IS_SUBAGENT_CHILD) {
        ctx.ui.notify(
          "Explore run ended while the external-evidence gate was still open. Review the final citations manually before accepting the result.",
          "warning",
        );
      }
      endExploreEvidenceChain();
    }

    if (!IS_SUBAGENT_CHILD) {
      clearActiveProtocolRun(ctx);
    }
  });

  pi.on("session_shutdown", async () => {
    if (IS_SUBAGENT_CHILD) return;
    await softReleaseManagedLease();
  });

  // ── Tool enforcement ──────────────────────────────────────────────

  pi.on("tool_call", async (event, ctx) => {
    if (IS_SUBAGENT_CHILD) {
      if (event.toolName === "write" || event.toolName === "edit") {
        const allowed = CHILD_SUBAGENT_TOOLS.includes(event.toolName);
        if (!allowed) {
          return {
            block: true,
            reason: `🔴 BLOCKED: ${CHILD_SUBAGENT_ROLE || "This child subagent"} cannot mutate files.`,
          };
        }
      }

      if (isToolCallEventType("bash", event)) {
        const classification = classifyChildBashCommand(CHILD_SUBAGENT_BASH_POLICY, event.input.command);
        if (!classification.allowed) {
          return {
            block: true,
            reason: `🔴 BLOCKED: ${classification.reason}`,
          };
        }
      }

      if (CHILD_MANAGED_WORKTREE_REQUIRED && (event.toolName === "write" || event.toolName === "edit" || isToolCallEventType("bash", event))) {
        const gate = await evaluateCurrentManagedMutation(ctx, true);
        if (!gate.allowed) {
          return {
            block: true,
            reason: `🔴 BLOCKED: ${gate.reason}`,
          };
        }
      }

      return;
    }

    if (activeProtocol === "explore") {
      if (event.toolName === "write" || event.toolName === "edit") {
        return {
          block: true,
          reason: `🔴 BLOCKED: \"${event.toolName}\" is not allowed during /explore. /explore is read-only — no code modifications. Use /execute when you are ready to implement.`,
        };
      }

      if (isToolCallEventType("bash", event)) {
        const classification = classifyExploreBash(event.input.command);
        if (!classification.allowed) {
          return {
            block: true,
            reason: `🔴 BLOCKED: ${classification.reason}`,
          };
        }
      }

      return;
    }

    if (activeProtocol === "execute") {
      if (event.toolName === "write" || event.toolName === "edit") {
        return {
          block: true,
          reason: "🔴 BLOCKED: The parent /execute run is orchestration-only. Delegate implementation to harness_subagents with an IMP-configured subagent.",
        };
      }

      if (isToolCallEventType("bash", event)) {
        return {
          block: true,
          reason: "🔴 BLOCKED: The parent /execute run is orchestration-only. Delegate build/test/check commands to harness_subagents with a VER-configured subagent.",
        };
      }
    }

    if (currentManagedBinding && (event.toolName === "write" || event.toolName === "edit" || event.toolName === "harness_commit" || isToolCallEventType("bash", event))) {
      const gate = await evaluateCurrentManagedMutation(ctx, true);
      if (!gate.allowed) {
        return {
          block: true,
          reason: `🔴 BLOCKED: ${gate.reason}`,
        };
      }
    }
  });

  // ── System prompt injection ───────────────────────────────────────

  pi.on("before_agent_start", async (event, ctx) => {
    if (!IS_SUBAGENT_CHILD) {
      beginActiveProtocolRun(pendingProtocolInvocation, ctx);
    }

    let injection = "";

    if (IS_SUBAGENT_CHILD) {
      if (CHILD_SUBAGENT_MODE === "explore") {
        injection = `
[HARNESS SUBAGENT: EXPLORE CHILD PROTOCOL ACTIVE]
You are inside a child explore subprocess, not the parent /explore orchestrator.
- Do not call harness_subagents recursively; it is unavailable here.
- Use read-only local inspection plus harness_web_search and harness_web_fetch to gather evidence.
- Keep researching until the external-evidence gate passes.
- When the harness tells you "Evidence bar met", stop researching and conclude in the required markdown format.
- External claims must cite explicit URLs; local claims must cite file paths.
- Unsupported claims must be marked [UNVERIFIED].
Evidence collected in this child so far: ${exploreTotals.searches} searches, ${exploreTotals.fetches} fetches, ${exploreTotals.sources.size} unique URLs.
`;
      }
    } else if (activeProtocol === "explore") {
      injection = `
[COGNITIVE HARNESS: EXPLORE PROTOCOL RUN ACTIVE]
You are running the divergent /explore protocol with 4-persona debate.
- 🔴 OPT (Optimist): Push for the ambitious path
- 🟡 PRA (Pragmatist): Ground in what ships
- 🟢 SKP (Skeptic): Find what breaks
- 🔵 EMP (Empiricist): Demand the evidence that would settle the disagreement
Rules: No unanimous agreement in Round 1. Evidence required from Round 2. Unsupported claims struck in Round 3.
Local file mutation is BLOCKED.
Structured external-evidence tools are active:
- harness_subagents: REQUIRED isolated parallel OPT/PRA/SKP/EMP subagent pass before final synthesis. Inject OPT/PRA/SKP/EMP as subagent personas.
- harness_web_search: discover ecosystem, prior-art, benchmark, and failure-mode sources.
- harness_web_fetch: inspect source pages and cite exact URLs before relying on them.
External-evidence policy:
- Codebase-local claims may cite repository files.
- Ecosystem, library, market, benchmark, standards, prior-art, and failure-mode claims MUST be backed by external URLs.
- Search snippets alone are not enough for key claims; fetch the strongest sources.
- Raw network bash (curl/wget/etc.) is BLOCKED so provenance stays auditable.
- Before producing a final /explore synthesis, you MUST call harness_subagents at least once with OPT/PRA/SKP/EMP personas.
- A synthesis is not acceptable unless it cites explicit source URLs or marks a claim [UNVERIFIED].
Evidence collected this session so far: ${exploreTotals.subagentRuns} subagent rounds, ${exploreTotals.searches} searches, ${exploreTotals.fetches} fetches, ${exploreTotals.sources.size} unique URLs.
`;
    } else if (activeProtocol === "execute") {
      const passed = state.acStatuses.filter((a) => a.status === "pass").length;
      const total = state.acStatuses.length;

      injection = `
[COGNITIVE HARNESS: EXECUTE PROTOCOL RUN ACTIVE]
You are running the convergent /execute protocol with 3-role mutual verification.
- 📋 PLN (Planner): Decides what/order. Cannot write code or mark ACs.
- 🔨 IMP (Implementer): Writes code. Cannot mark ACs passed.
- ✅ VER (Verifier): Sole authority on AC pass/fail. Cannot write code.
Iron law: No role evaluates its own output.
This parent /execute agent is an ORCHESTRATOR. Direct write/edit/bash implementation is blocked here.
Use harness_subagents to invoke real isolated PLN / IMP / VER subprocess agents. Use sequential mode for PLN → IMP → VER handoffs.
AC Status: ${passed}/${total} passed. Regressions: ${state.regressionCount}. Commits: ${state.commitCount}.
${state.currentIncrement ? `Current increment: ${state.currentIncrement}` : ""}
VERIFICATION REGISTRY: VER must maintain a cumulative Verification Registry (.harness/verification-registry.json).
- After confirming an AC passes, VER MUST call harness_verify_register to record the verification method.
- Before regression checks, VER MUST call harness_verify_list and re-run every registered verification.
- A passing AC without a registered verification is a gap that PLN should challenge.
- Planning, implementation, and verification work should be delegated to harness_subagents rather than role-played in the parent context.
After VER confirms all gates pass and no regressions for an increment, VER MUST call the harness_commit tool to commit and push the changes before proceeding to the next increment.
`;
    }

    if (injection) {
      return {
        systemPrompt: event.systemPrompt + injection,
      };
    }
  });

  // ── Web research tools ────────────────────────────────────────────

  pi.registerTool({
    name: "harness_web_search",
    label: "Harness Web Search",
    description: "Search the public web for external sources. Use this during /explore or other research-heavy runs to gather ecosystem, prior-art, benchmark, or failure-mode evidence before making claims.",
    promptSnippet: "Search the public web for external evidence and candidate sources.",
    promptGuidelines: [
      "Use harness_web_search during /explore before making ecosystem or prior-art claims.",
      "Prefer multiple focused queries over one broad query.",
      "After finding promising results, call harness_web_fetch on the strongest URLs before relying on them in the synthesis.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      max_results: Type.Optional(Type.Number({ description: "Maximum results to return (default 5, max 10)" })),
      backend: Type.Optional(Type.String({ description: "Optional search backend override: duckduckgo, searxng, or tavily" })),
    }),
    renderShell: "self",
    async execute(_toolCallId, params, signal) {
      const backend = getSearchBackend(params.backend);
      const maxResults = Math.max(1, Math.min(10, Math.floor(params.max_results ?? 5)));
      const { results } = await runWebSearch(params.query, maxResults, backend, signal);

      const lines: string[] = [];
      lines.push(`Web search for: ${params.query}`);
      lines.push(`Backend: ${backend}`);
      lines.push("");

      results.forEach((result, index) => {
        lines.push(`${index + 1}. ${result.title}`);
        lines.push(`   URL: ${result.url}`);
        if (result.snippet) lines.push(`   Snippet: ${result.snippet}`);
        lines.push("");
      });

      lines.push("Use harness_web_fetch on the most relevant URLs before treating their claims as accepted evidence.");

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          backend,
          query: params.query,
          results,
        },
      };
    },
    renderCall(args, theme, context) {
      const query = summarizeSubagentText(args.query, MAX_SUBAGENT_CALL_PREVIEW_CHARS) || "...";
      const backend = args.backend ? getSearchBackend(args.backend) : "auto";
      return new Text(
        `${compactToolTitle(theme, context, "search")} ${theme.fg("accent", query)}${theme.fg("muted", ` · ${backend}`)}`,
        0,
        0,
      );
    },
    renderResult(result, options, theme, context) {
      const details = result.details as { results?: unknown[]; backend?: string } | undefined;
      const count = details?.results?.length ?? 0;
      const summary = `${count} result${count === 1 ? "" : "s"}${details?.backend ? ` · ${details.backend}` : ""}`;
      return renderCompactToolResult(result, options, theme, context, summary);
    },
  });

  pi.registerTool({
    name: "harness_web_fetch",
    label: "Harness Web Fetch",
    description: "Fetch a public URL and extract readable text so external claims can be grounded in the actual source content.",
    promptSnippet: "Fetch and inspect a source URL before accepting its claims as evidence.",
    promptGuidelines: [
      "Use harness_web_fetch after harness_web_search for the URLs you intend to cite.",
      "Cite the fetched URL explicitly in the final explore output.",
      "Do not rely on snippets alone for major conclusions when the original page is fetchable.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "http(s) URL to fetch" }),
      max_chars: Type.Optional(Type.Number({ description: "Maximum characters of extracted text to return (default 12000, max 30000)" })),
    }),
    renderShell: "self",
    async execute(_toolCallId, params, signal) {
      const url = ensureHttpUrl(params.url);
      const maxChars = Math.max(500, Math.min(30_000, Math.floor(params.max_chars ?? 12_000)));

      const response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; harness-web-fetch/1.0)",
          accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
        signal,
      });

      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") ?? "unknown";
      const rawText = await response.text();
      const title = contentType.includes("html") ? extractTitleFromHtml(rawText) : undefined;
      const extracted = contentType.includes("html")
        ? htmlToText(rawText)
        : contentType.includes("json")
          ? JSON.stringify(JSON.parse(rawText), null, 2)
          : rawText;
      const truncated = extracted.length > maxChars;
      const body = extracted.slice(0, maxChars);

      const lines: string[] = [];
      lines.push(title ? `Title: ${title}` : `URL: ${response.url}`);
      if (title) lines.push(`URL: ${response.url}`);
      lines.push(`Status: ${response.status}`);
      lines.push(`Content-Type: ${contentType}`);
      lines.push("");
      lines.push(body || "[No extractable body text]");
      if (truncated) {
        lines.push("");
        lines.push(`[TRUNCATED to ${maxChars} chars]`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          requestedUrl: url.toString(),
          finalUrl: response.url,
          status: response.status,
          contentType,
          title,
          truncated,
          extractedChars: extracted.length,
        },
      };
    },
    renderCall(args, theme, context) {
      const url = summarizeSubagentText(args.url, MAX_SUBAGENT_CALL_PREVIEW_CHARS) || "...";
      return new Text(`${compactToolTitle(theme, context, "fetch")} ${theme.fg("accent", url)}`, 0, 0);
    },
    renderResult(result, options, theme, context) {
      const details = result.details as { status?: number; contentType?: string; truncated?: boolean } | undefined;
      const status = details?.status ? String(details.status) : "fetched";
      const contentType = details?.contentType ? summarizeSubagentText(details.contentType, 32) : undefined;
      const summary = [status, contentType, details?.truncated ? "truncated" : undefined].filter(Boolean).join(" · ");
      return renderCompactToolResult(result, options, theme, context, summary || undefined);
    },
  });

  pi.registerTool({
    name: "harness_subagents",
    label: "Harness Subagents",
    description: "Run isolated subagents in parallel or sequentially using injected personas, system prompts, and per-subagent tool policies.",
    promptSnippet: "Run generic isolated subagents with injected personas, prompts, and tool policies.",
    promptGuidelines: [
      "Use harness_subagents whenever you want real isolated subprocess agents instead of role-playing multiple viewpoints in one context.",
      "Inject the persona or role through each subagent's system_prompt and choose active_tools / bash_policy explicitly.",
      "Use parallel mode for independent perspectives, or sequential mode when later subagents should react to earlier outputs.",
      "For /explore, configure OPT / PRA / SKP / EMP in parallel. For /execute, configure PLN / IMP / VER in sequential mode.",
    ],
    parameters: Type.Object({
      subject: Type.String({ description: "Shared subject, objective, or decision question for this subagent batch" }),
      subagents: Type.Array(Type.Object({
        role: Type.String({ description: "Subagent identifier, persona, or role name" }),
        label: Type.Optional(Type.String({ description: "Optional human-readable label" })),
        icon: Type.Optional(Type.String({ description: "Optional icon prefix such as 🔴 or ✅" })),
        task: Type.Optional(Type.String({ description: "Optional per-subagent task override. Defaults to a generic subject/context task." })),
        system_prompt: Type.String({ description: "System prompt injected into this subagent to define its persona, role, and operating rules" }),
        active_tools: Type.Optional(Type.Array(Type.String(), { description: "Optional allowed tools for this subagent" })),
        bash_policy: Type.Optional(Type.String({ description: "Optional bash policy: none, read-only, verify, or implement" })),
      }), { description: "Subagent specifications" }),
      mode: Type.Optional(Type.String({ description: "Batch mode: 'parallel' (default) or 'sequential'" })),
      context: Type.Optional(Type.String({ description: "Optional shared context appended to default-generated tasks" })),
    }),
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const mode = (params.mode?.trim().toLowerCase() === "sequential" ? "sequential" : "parallel") as "parallel" | "sequential";
      const definitions = normalizeHarnessSubagentDefinitions(params.subject, params.subagents, params.context);
      if (definitions.length === 0) {
        throw new Error("harness_subagents requires at least one valid subagent definition.");
      }

      const descriptors = definitions.map(({ role, label, icon }) => ({ role, label, icon }));
      const modelSpec = modelToCliSpec(ctx.model as { provider?: string; id?: string } | undefined);
      const thinkingLevel = pi.getThinkingLevel();
      const genericSubagentChildMode = resolveGenericSubagentChildMode(getRuntimeProtocol());
      let latestSnapshots: HarnessSubagentSnapshot<string>[] = [];
      const batchStartedAt = new Date().toISOString();

      const specs: HarnessSubagentSpec<string>[] = definitions.map((subagent) => ({
        mode: genericSubagentChildMode,
        role: subagent.role,
        label: `${subagent.icon ? `${subagent.icon} ` : ""}${subagent.label}`,
        task: subagent.task,
        systemPrompt: subagent.systemPrompt,
        cwd: ctx.cwd,
        activeTools: subagent.activeTools,
        bashPolicy: subagent.bashPolicy,
        extensionPath: CURRENT_EXTENSION_PATH,
        env: buildManagedSubagentEnv(),
        modelSpec,
        thinkingLevel,
        signal,
      }));

      updateUI(ctx);

      try {
        const results = await runHarnessSubagentBatch(specs, {
          mode,
          taskResolver: mode === "sequential"
            ? (spec, previousResults) => {
                if (previousResults.length === 0) return spec.task;
                return [
                  spec.task,
                  "",
                  "Context from prior subagent outputs:",
                  formatPriorSubagentOutputs(previousResults),
                ].join("\n");
              }
            : undefined,
          onSnapshot: (snapshots, completed, total, batchResults) => {
            latestSnapshots = snapshots;
            const details = buildHarnessSubagentsDetails(params.subject, mode, descriptors, completed, total, batchResults, snapshots);
            updateUI(ctx);
            onUpdate?.({
              content: [{ type: "text", text: summarizeHarnessSubagentsProgress(details) }],
              details,
            });
          },
        });

        const details = buildHarnessSubagentsDetails(
          params.subject,
          mode,
          descriptors,
          results.length,
          descriptors.length,
          results,
          latestSnapshots,
        );
        const batchEndedAt = new Date().toISOString();
        details.record = appendSubagentBatchRecord(buildHarnessSubagentsRecord(
          toolCallId,
          details,
          batchStartedAt,
          batchEndedAt,
        ));

        return {
          content: [{ type: "text", text: formatHarnessSubagentsResults(details) }],
          details,
        };
      } finally {
        updateUI(ctx);
      }
    },
    renderCall(args, theme, context) {
      const subject = summarizeSubagentText(args.subject, MAX_SUBAGENT_CALL_PREVIEW_CHARS) || "...";
      const mode = typeof args.mode === "string" && args.mode.trim().toLowerCase() === "sequential"
        ? "sequential"
        : "parallel";
      const roles = Array.isArray(args.subagents)
        ? args.subagents
          .map((subagent) => typeof subagent?.role === "string" ? subagent.role.trim() : "")
          .filter(Boolean)
          .join(", ") || "subagents"
        : "subagents";
      return new Text(
        `${compactToolTitle(theme, context, "subagents")} ${theme.fg("accent", subject)}${theme.fg("muted", ` · ${mode} · ${roles}`)}`,
        0,
        0,
      );
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      const details = result.details as HarnessSubagentsToolDetails | undefined;
      if (!details) {
        const fallback = summarizeSubagentText(extractToolTextContent(result), 160) || undefined;
        return renderCompactToolResult(result, { expanded }, theme, context, fallback);
      }

      if (expanded) {
        return new Text(renderHarnessSubagentsExpandedText(details, isPartial, theme), 0, 0);
      }

      return renderStableTextLineList(renderHarnessSubagentsCollapsedText(details, theme), context);
    },
  });

  pi.registerTool({
    name: "harness_explore_subagents",
    label: "Explore Subagents",
    description: "Deprecated compatibility alias for harness_subagents preconfigured with OPT/PRA/SKP/EMP personas.",
    promptSnippet: "Compatibility alias: use harness_subagents for new code; this launches OPT/PRA/SKP/EMP in parallel.",
    promptGuidelines: [
      "Prefer harness_subagents for new code. This alias remains for backward compatibility and launches OPT/PRA/SKP/EMP in parallel.",
      "Pass a concise topic and optional project context summary so each subagent can research independently.",
      "Use the returned citations directly in the final debate transcript and synthesis.",
    ],
    parameters: Type.Object({
      topic: Type.String({ description: "Exploration topic or decision question" }),
      project_context: Type.Optional(Type.String({ description: "Optional codebase/project context summary for the subagents" })),
    }),
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const modelSpec = modelToCliSpec(ctx.model as { provider?: string; id?: string } | undefined);
      const thinkingLevel = pi.getThinkingLevel();
      let latestSnapshots: HarnessSubagentSnapshot<ExplorePersona>[] = [];
      const batchStartedAt = new Date().toISOString();

      const specs: HarnessSubagentSpec<ExplorePersona>[] = EXPLORE_SUBAGENT_ROLES.map((role) => ({
        mode: "explore",
        role: role.persona,
        label: `${role.icon} ${role.label}`,
        task: buildExploreSubagentTask(role, params.topic, params.project_context),
        systemPrompt: buildExploreSubagentSystemPrompt(role),
        cwd: ctx.cwd,
        activeTools: role.activeTools,
        bashPolicy: role.bashPolicy,
        extensionPath: CURRENT_EXTENSION_PATH,
        env: buildManagedSubagentEnv(),
        modelSpec,
        thinkingLevel,
        signal,
      }));

      updateUI(ctx);

      try {
        const results = await runHarnessSubagentBatch(specs, {
          mode: "parallel",
          onSnapshot: (snapshots, completed, total, batchResults) => {
            latestSnapshots = snapshots;
            const details = buildExploreSubagentDetails(params.topic, completed, total, batchResults, snapshots);
            updateUI(ctx);
            onUpdate?.({
              content: [{ type: "text", text: summarizeExploreSubagentProgress(details) }],
              details,
            });
          },
        });

        const details = buildExploreSubagentDetails(
          params.topic,
          results.length,
          EXPLORE_SUBAGENT_ROLES.length,
          results,
          latestSnapshots,
        );
        const batchEndedAt = new Date().toISOString();
        details.record = appendSubagentBatchRecord(buildExploreSubagentRecord(
          toolCallId,
          details,
          batchStartedAt,
          batchEndedAt,
        ));

        return {
          content: [{ type: "text", text: formatExploreSubagentResults(details) }],
          details,
        };
      } finally {
        updateUI(ctx);
      }
    },
    renderCall(args, theme, context) {
      const topic = summarizeSubagentText(args.topic, MAX_SUBAGENT_CALL_PREVIEW_CHARS) || "...";
      return new Text(
        `${compactToolTitle(theme, context, "explore_subagents")} ${theme.fg("accent", topic)}${theme.fg("muted", " · OPT/PRA/SKP/EMP · parallel")}`, 
        0,
        0,
      );
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      const details = result.details as ExploreSubagentToolDetails | undefined;
      if (!details) {
        const fallback = summarizeSubagentText(extractToolTextContent(result), 160) || undefined;
        return renderCompactToolResult(result, { expanded }, theme, context, fallback);
      }

      if (expanded) {
        return new Text(renderExploreSubagentExpandedText(details, isPartial, theme), 0, 0);
      }

      return renderStableTextLineList(renderExploreSubagentCollapsedText(details, theme), context);
    },
  });

  pi.registerTool({
    name: "harness_execute_subagents",
    label: "Execute Subagents",
    description: "Deprecated compatibility alias for harness_subagents preconfigured with PLN / IMP / VER roles.",
    promptSnippet: "Compatibility alias: use harness_subagents for new code; this runs PLN / IMP / VER subagents.",
    promptGuidelines: [
      "Prefer harness_subagents for new code. This alias remains for backward compatibility and runs PLN / IMP / VER subagents.",
      "Default to sequential mode so each role can react to prior role outputs.",
      "Reserve registry updates and harness_commit for the parent execute agent after VER's evidence is in.",
    ],
    parameters: Type.Object({
      objective: Type.String({ description: "The concrete execute objective, e.g. 'Plan increments for criteria X' or 'Implement and verify INC-2'" }),
      roles: Type.Optional(Type.Array(Type.String(), { description: "Subset/order of roles to run, e.g. ['PLN','IMP','VER']" })),
      mode: Type.Optional(Type.String({ description: "Execution mode: 'sequential' (default) or 'parallel'" })),
      context: Type.Optional(Type.String({ description: "Optional additional context for the role subagents" })),
    }),
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const requestedRoles = (params.roles ?? ["PLN", "IMP", "VER"])
        .map((role) => role.trim().toUpperCase())
        .filter(Boolean);
      const invalidRole = requestedRoles.find((role) => !["PLN", "IMP", "VER"].includes(role));
      if (invalidRole) {
        throw new Error(`Invalid execute role: ${invalidRole}. Expected PLN, IMP, or VER.`);
      }

      const roles = requestedRoles as ExecuteRole[];
      const mode = (params.mode?.trim().toLowerCase() === "parallel" ? "parallel" : "sequential") as "parallel" | "sequential";
      const modelSpec = modelToCliSpec(ctx.model as { provider?: string; id?: string } | undefined);
      const thinkingLevel = pi.getThinkingLevel();
      let latestSnapshots: HarnessSubagentSnapshot<ExecuteRole>[] = [];
      const batchStartedAt = new Date().toISOString();

      const specs: HarnessSubagentSpec<ExecuteRole>[] = roles.map((role) => {
        const spec = resolveExecuteRole(role);
        return {
          mode: "execute",
          role: spec.role,
          label: `${spec.icon} ${spec.label}`,
          task: buildExecuteRoleTask(spec, params.objective, params.context),
          systemPrompt: buildExecuteRoleSystemPrompt(spec),
          cwd: ctx.cwd,
          activeTools: spec.activeTools,
          bashPolicy: spec.bashPolicy,
          extensionPath: CURRENT_EXTENSION_PATH,
          env: buildManagedSubagentEnv(),
          modelSpec,
          thinkingLevel,
          signal,
        };
      });

      updateUI(ctx);

      try {
        const results = await runHarnessSubagentBatch(specs, {
          mode,
          taskResolver: mode === "sequential"
            ? (spec, previousResults) => {
                if (previousResults.length === 0) return spec.task;
                return [
                  spec.task,
                  "",
                  "Context from prior role outputs:",
                  formatPriorSubagentOutputs(previousResults),
                ].join("\n");
              }
            : undefined,
          onSnapshot: (snapshots, completed, total, batchResults) => {
            latestSnapshots = snapshots;
            const details = buildExecuteSubagentDetails(params.objective, mode, roles, completed, total, batchResults, snapshots);
            updateUI(ctx);
            onUpdate?.({
              content: [{ type: "text", text: summarizeExecuteSubagentProgress(details) }],
              details,
            });
          },
        });

        const details = buildExecuteSubagentDetails(
          params.objective,
          mode,
          roles,
          results.length,
          roles.length,
          results,
          latestSnapshots,
        );
        const batchEndedAt = new Date().toISOString();
        details.record = appendSubagentBatchRecord(buildExecuteSubagentRecord(
          toolCallId,
          details,
          batchStartedAt,
          batchEndedAt,
        ));

        return {
          content: [{ type: "text", text: formatExecuteSubagentResults(details) }],
          details,
        };
      } finally {
        updateUI(ctx);
      }
    },
    renderCall(args, theme, context) {
      const objective = summarizeSubagentText(args.objective, MAX_SUBAGENT_CALL_PREVIEW_CHARS) || "...";
      const mode = typeof args.mode === "string" && args.mode.trim().toLowerCase() === "parallel"
        ? "parallel"
        : "sequential";
      const roles = Array.isArray(args.roles) && args.roles.length > 0
        ? args.roles.map((role) => String(role).trim().toUpperCase()).filter(Boolean).join("/")
        : "PLN/IMP/VER";
      return new Text(
        `${compactToolTitle(theme, context, "execute_subagents")} ${theme.fg("accent", objective)}${theme.fg("muted", ` · ${mode} · ${roles}`)}`,
        0,
        0,
      );
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      const details = result.details as ExecuteSubagentToolDetails | undefined;
      if (!details) {
        const fallback = summarizeSubagentText(extractToolTextContent(result), 160) || undefined;
        return renderCompactToolResult(result, { expanded }, theme, context, fallback);
      }

      if (expanded) {
        return new Text(renderExecuteSubagentExpandedText(details, isPartial, theme), 0, 0);
      }

      return renderStableTextLineList(renderExecuteSubagentCollapsedText(details, theme), context);
    },
  });

  pi.registerTool({
    name: INTERNAL_MANAGED_WORKTREE_TOOL,
    label: "Managed Workspace Bootstrap",
    description: "Queue the internal managed-worktree bootstrap so harness can create a clean isolated worktree and switch sessions without exposing a public slash-command workflow.",
    promptSnippet: "Queue the internal managed-worktree bootstrap for a task/session when isolated worktree execution is required.",
    promptGuidelines: [
      "Use this tool when a task needs a clean isolated managed worktree before implementation proceeds.",
      "This is an orchestration primitive; users are not expected to invoke the internal command directly.",
      "If the current checkout is dirty, set headOnlyFromDirty to true only when you explicitly want the new worktree based on HEAD without carrying local edits.",
    ],
    parameters: Type.Object({
      headOnlyFromDirty: Type.Optional(Type.Boolean({ description: "Explicitly confirm HEAD-only bootstrap when the current checkout is dirty." })),
    }),
    renderShell: "self",
    async execute(_toolCallId, params) {
      const payload = Buffer.from(JSON.stringify({ headOnlyFromDirty: params.headOnlyFromDirty === true }), "utf-8").toString("base64url");
      pi.sendUserMessage(`/${INTERNAL_MANAGED_WORKTREE_COMMAND} ${payload}`, { deliverAs: "followUp" });
      const summary = params.headOnlyFromDirty
        ? "Queued internal managed-worktree bootstrap with explicit HEAD-only confirmation for a dirty source checkout."
        : "Queued internal managed-worktree bootstrap. If the current checkout is dirty, the bootstrap will stop unless rerun with headOnlyFromDirty: true.";
      return {
        content: [{ type: "text", text: summary }],
        details: {
          queued: true,
          headOnlyFromDirty: params.headOnlyFromDirty === true,
          command: INTERNAL_MANAGED_WORKTREE_COMMAND,
        },
      };
    },
    renderCall(args, theme, context) {
      const dirtyMode = args.headOnlyFromDirty ? " · HEAD-only" : "";
      return new Text(`${compactToolTitle(theme, context, "managed_workspace")} ${theme.fg("accent", "queue bootstrap")}${theme.fg("muted", dirtyMode)}`, 0, 0);
    },
    renderResult(result, options, theme, context) {
      const details = result.details as { queued?: boolean; headOnlyFromDirty?: boolean } | undefined;
      const summary = details?.queued
        ? details.headOnlyFromDirty ? "queued · HEAD-only" : "queued"
        : undefined;
      return renderCompactToolResult(result, options, theme, context, summary);
    },
  });

  // ── Verification Registry tools ───────────────────────────────────

  pi.registerTool({
    name: "harness_verify_register",
    label: "Register Verification Method",
    description: "Register or update a verification method for an acceptance criterion. VER calls this after confirming an AC passes, recording HOW it was verified so future regression checks can re-run the same verification.",
    promptSnippet: "Register a reproducible verification method for an AC (during an active /execute run, VER role only)",
    promptGuidelines: [
      "Call harness_verify_register after marking an AC as passed to record the verification method.",
      "Include the exact command to re-run the verification and any test files involved.",
      "Prefer automated, reproducible strategies (automated-test, type-check, build-output) over manual-check.",
    ],
    parameters: Type.Object({
      ac_id: Type.String({ description: "AC identifier, e.g. 'AC-1.1'" }),
      requirement: Type.String({ description: "What this AC requires (human-readable)" }),
      source: Type.Optional(Type.String({ description: "Source criteria document, e.g. 'iteration-4-criteria.md'" })),
      strategy: Type.String({ description: "Verification strategy: 'automated-test', 'type-check', 'build-output', 'lint-rule', 'manual-check', etc." }),
      command: Type.Optional(Type.String({ description: "Exact command to re-run this verification, e.g. 'npm test -- --grep login'" })),
      files: Type.Optional(Type.Array(Type.String(), { description: "Test or verification files involved" })),
      description: Type.String({ description: "Human-readable explanation of what's being checked and how" }),
      increment: Type.Optional(Type.String({ description: "Current increment, e.g. 'INC-1'" })),
    }),
    renderShell: "self",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!isExecuteRuntime()) {
        throw new Error("harness_verify_register is only available during an active /execute run.");
      }

      const registry = await readRegistry(ctx.cwd);
      const isUpdate = params.ac_id in registry.entries;

      registry.entries[params.ac_id] = {
        requirement: params.requirement,
        source: params.source,
        verification: {
          strategy: params.strategy,
          command: params.command,
          files: params.files,
          description: params.description,
        },
        registeredAt: isUpdate
          ? registry.entries[params.ac_id].registeredAt
          : (params.increment ?? state.currentIncrement ?? "unknown"),
        lastVerifiedAt: params.increment ?? state.currentIncrement,
        lastResult: "pass",
      };

      await writeRegistry(ctx.cwd, registry);

      const count = Object.keys(registry.entries).length;
      const verb = isUpdate ? "Updated" : "Registered";
      const summary = `${verb} verification for ${params.ac_id} (${params.strategy}). Registry: ${count} entries total.`;

      return {
        content: [{ type: "text", text: summary }],
        details: { ac_id: params.ac_id, isUpdate, totalEntries: count },
      };
    },
    renderCall(args, theme, context) {
      return new Text(
        `${compactToolTitle(theme, context, "verify_register")} ${theme.fg("accent", args.ac_id)}${theme.fg("muted", ` · ${args.strategy}`)}`,
        0,
        0,
      );
    },
    renderResult(result, options, theme, context) {
      const details = result.details as { isUpdate?: boolean; totalEntries?: number } | undefined;
      const summary = details
        ? `${details.isUpdate ? "updated" : "registered"} · ${details.totalEntries ?? 0} entries`
        : undefined;
      return renderCompactToolResult(result, options, theme, context, summary);
    },
  });

  pi.registerTool({
    name: "harness_verify_list",
    label: "List Verification Registry",
    description: "List all registered verification methods from the project's Verification Registry. VER calls this before regression checks to get every verification that must be re-run.",
    promptSnippet: "List all registered verification methods for regression checks (during an active /execute run)",
    promptGuidelines: [
      "Call harness_verify_list before running regression checks to get all registered verification methods.",
      "Re-run every listed verification command during regression scans.",
    ],
    parameters: Type.Object({
      filter: Type.Optional(Type.String({ description: "Filter entries by AC ID prefix, e.g. 'AC-1'" })),
    }),
    renderShell: "self",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!isExecuteRuntime()) {
        throw new Error("harness_verify_list is only available during an active /execute run.");
      }

      const registry = await readRegistry(ctx.cwd);
      let entries = Object.entries(registry.entries);

      if (params.filter) {
        entries = entries.filter(([id]) => id.startsWith(params.filter!));
      }

      if (entries.length === 0) {
        const total = Object.keys(registry.entries).length;
        return {
          content: [{ type: "text", text: params.filter
            ? `No entries matching '${params.filter}'. Registry has ${total} total entries.`
            : "Verification Registry is empty. Register verifications after confirming ACs pass." }],
          details: { entries: [], totalEntries: total },
        };
      }

      const lines: string[] = [];
      lines.push(`Verification Registry: ${entries.length} entries${params.filter ? ` (filtered: '${params.filter}')` : ""}`);
      lines.push("");

      for (const [id, entry] of entries) {
        lines.push(`## ${id}: ${entry.requirement}`);
        lines.push(`  Strategy: ${entry.verification.strategy}`);
        if (entry.verification.command) {
          lines.push(`  Command: ${entry.verification.command}`);
        }
        if (entry.verification.files?.length) {
          lines.push(`  Files: ${entry.verification.files.join(", ")}`);
        }
        lines.push(`  Description: ${entry.verification.description}`);
        lines.push(`  Registered: ${entry.registeredAt} | Last verified: ${entry.lastVerifiedAt ?? "never"} | Result: ${entry.lastResult ?? "unknown"}`);
        if (entry.source) {
          lines.push(`  Source: ${entry.source}`);
        }
        lines.push("");
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {
          entries: entries.map(([id, entry]) => ({ id, ...entry })),
          totalEntries: Object.keys(registry.entries).length,
        },
      };
    },
    renderCall(args, theme, context) {
      const filter = typeof args.filter === "string" && args.filter.trim()
        ? theme.fg("muted", ` · ${args.filter.trim()}`)
        : "";
      return new Text(`${compactToolTitle(theme, context, "verify_list")}${filter}`, 0, 0);
    },
    renderResult(result, options, theme, context) {
      const details = result.details as { entries?: unknown[]; totalEntries?: number } | undefined;
      const visible = details?.entries?.length ?? 0;
      const total = details?.totalEntries ?? visible;
      const summary = `${visible} shown${visible !== total ? ` · ${total} total` : ""}`;
      return renderCompactToolResult(result, options, theme, context, summary);
    },
  });

  // ── Commit & push tool (VER calls after verification) ─────────────

  pi.registerTool({
    name: "harness_commit",
    label: "Commit & Push Increment",
    description: "Commit verified increment changes and push to remote. Only VER should call this after all gates pass and no regressions are detected.",
    promptSnippet: "Commit and push verified increment changes (during an active /execute run, VER role only)",
    promptGuidelines: [
      "Only call harness_commit during an active /execute run after VER confirms all gates pass and no regressions.",
      "Include the increment ID (e.g. INC-1) and a brief description of the changes.",
    ],
    parameters: Type.Object({
      increment: Type.String({ description: "Increment ID, e.g. 'INC-1'" }),
      message: Type.String({ description: "Brief description of changes in this increment" }),
    }),
    renderShell: "self",
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (!isExecuteRuntime()) {
        throw new Error("harness_commit is only available during an active /execute run.");
      }

      onUpdate?.({
        content: [{ type: "text", text: `Staging changes for ${params.increment}...` }],
        details: { stage: "staging", increment: params.increment },
      });

      const addResult = await pi.exec("git", ["add", "-A"], { signal, timeout: 10_000 });
      if (addResult.code !== 0) {
        throw new Error(`git add failed: ${addResult.stderr}`);
      }

      const diffResult = await pi.exec("git", ["diff", "--cached", "--quiet"], { signal, timeout: 10_000 });
      if (diffResult.code === 0) {
        return {
          content: [{ type: "text", text: `No changes to commit for ${params.increment}.` }],
          details: { increment: params.increment, skipped: true },
        };
      }

      const commitMsg = `${params.increment}: ${params.message}`;
      onUpdate?.({
        content: [{ type: "text", text: `Committing: ${commitMsg}` }],
        details: { stage: "committing", increment: params.increment, message: commitMsg },
      });

      const commitResult = await pi.exec("git", ["commit", "-m", commitMsg], { signal, timeout: 15_000 });
      if (commitResult.code !== 0) {
        throw new Error(`git commit failed: ${commitResult.stderr}`);
      }

      const hashResult = await pi.exec("git", ["rev-parse", "--short", "HEAD"], { signal, timeout: 5_000 });
      const hash = hashResult.stdout.trim();

      onUpdate?.({
        content: [{ type: "text", text: `Pushing ${hash}...` }],
        details: { stage: "pushing", increment: params.increment, hash },
      });

      const pushResult = await pi.exec("git", ["push"], { signal, timeout: 30_000 });
      const pushed = pushResult.code === 0;

      state.commitCount += 1;
      state.currentIncrement = params.increment;
      saveState();
      updateUI(ctx);

      const pushStatus = pushed
        ? "pushed to remote"
        : `push failed: ${pushResult.stderr.trim()}`;
      const icon = pushed ? "✅" : "⚠️";
      const summary = `${icon} ${params.increment} committed (${hash}) — ${pushStatus}`;

      ctx.ui.notify(summary, pushed ? "info" : "warning");

      return {
        content: [{ type: "text", text: summary }],
        details: {
          increment: params.increment,
          hash,
          message: commitMsg,
          pushed,
          pushError: pushed ? undefined : pushResult.stderr.trim(),
        },
      };
    },
    renderCall(args, theme, context) {
      const message = summarizeSubagentText(args.message, 48);
      const suffix = message ? theme.fg("muted", ` · ${message}`) : "";
      return new Text(`${compactToolTitle(theme, context, "commit")} ${theme.fg("accent", args.increment)}${suffix}`, 0, 0);
    },
    renderResult(result, options, theme, context) {
      const details = result.details as { hash?: string; pushed?: boolean; increment?: string; skipped?: boolean } | undefined;
      const summary = details?.skipped
        ? "no staged changes"
        : details?.hash
          ? `${details.hash}${details.pushed ? " · pushed" : " · commit only"}`
          : undefined;
      return renderCompactToolResult(result, options, theme, context, summary);
    },
  });

}
