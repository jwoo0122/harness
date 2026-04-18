import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type HarnessSubagentRunResult,
  type HarnessSubagentSnapshot,
  type HarnessSubagentSpec,
  type SubagentBashPolicy,
  formatPriorSubagentOutputs,
  runHarnessSubagentBatch,
} from "./subagents.js";

// ─── Types ────────────────────────────────────────────────────────────

type Mode = "explore" | "execute" | "off";
type SearchBackend = "duckduckgo" | "searxng" | "tavily";
type ExplorePersona = "OPT" | "PRA" | "SKP";
type ExecuteRole = "PLN" | "IMP" | "VER";

interface ACStatus {
  id: string;
  status: "pass" | "fail" | "pending";
  evidence?: string;
  verifiedAfter?: string; // INC-N
}

interface HarnessState {
  mode: Mode;
  criteriaFile?: string;
  acStatuses: ACStatus[];
  currentIncrement?: string;
  regressionCount: number;
  debateRound?: number;
  commitCount: number;
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
  mode: "explore" | "execute";
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

interface ExecuteSubagentTotals {
  subagentRuns: number;
  roleRuns: Record<ExecuteRole, number>;
}

interface ExploreLiveBatchState {
  topic: string;
  completed: number;
  total: number;
  personas: ExplorePersona[];
  snapshots: HarnessSubagentSnapshot<ExplorePersona>[];
}

interface ExecuteLiveBatchState {
  objective: string;
  completed: number;
  total: number;
  roles: ExecuteRole[];
  snapshots: HarnessSubagentSnapshot<ExecuteRole>[];
}

interface WebSearchResult {
  title: string;
  url: string;
  snippet?: string;
  source: string;
}

// ─── Verification Registry ───────────────────────────────────────────

interface VerificationEntry {
  requirement: string;
  source?: string;
  verification: {
    strategy: string;
    command?: string;
    files?: string[];
    description: string;
  };
  registeredAt: string;
  lastVerifiedAt?: string;
  lastResult?: "pass" | "fail";
}

interface VerificationRegistry {
  $schema: string;
  entries: Record<string, VerificationEntry>;
}

const REGISTRY_DIR = ".harness";
const REGISTRY_FILE = "verification-registry.json";
const CURRENT_EXTENSION_PATH = fileURLToPath(import.meta.url);
const IS_SUBAGENT_CHILD = process.env.HARNESS_SUBAGENT_CHILD === "1";
const CHILD_SUBAGENT_MODE = process.env.HARNESS_SUBAGENT_MODE as Mode | undefined;
const CHILD_SUBAGENT_ROLE = process.env.HARNESS_SUBAGENT_ROLE ?? "";
const CHILD_SUBAGENT_TOOLS = (process.env.HARNESS_SUBAGENT_TOOLS ?? "")
  .split(",")
  .map((tool) => tool.trim())
  .filter(Boolean);
const CHILD_SUBAGENT_BASH_POLICY = (process.env.HARNESS_SUBAGENT_BASH_POLICY ?? "none") as SubagentBashPolicy;
const SAFE_EXPLORE_TOOL_NAMES = new Set([
  "read",
  "bash",
  "grep",
  "find",
  "ls",
  "harness_web_search",
  "harness_web_fetch",
  "harness_explore_subagents",
]);
const SAFE_EXECUTE_TOOL_NAMES = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "harness_web_search",
  "harness_web_fetch",
  "harness_execute_subagents",
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

const EXPLORE_SUBAGENT_ROLES: Array<{
  persona: ExplorePersona;
  label: string;
  icon: string;
  stance: string;
  challengeFocus: string;
}> = [
  {
    persona: "OPT",
    label: "Optimist",
    icon: "🔴",
    stance: "Push for upside, leverage, compounding effects, and the strongest ambitious path.",
    challengeFocus: "Explain what becomes possible if the team accepts more short-term complexity.",
  },
  {
    persona: "PRA",
    label: "Pragmatist",
    icon: "🟡",
    stance: "Focus on what actually ships, sequencing, effort/reward, and reversible decisions.",
    challengeFocus: "Explain the smallest viable path that preserves most of the upside.",
  },
  {
    persona: "SKP",
    label: "Skeptic",
    icon: "🟢",
    stance: "Pressure-test assumptions, failure modes, operational burden, and hidden constraints.",
    challengeFocus: "Explain what is likely to break and what evidence is still missing.",
  },
];

const EXECUTE_SUBAGENT_ROLES: Array<{
  role: ExecuteRole;
  label: string;
  icon: string;
  activeTools: string[];
  bashPolicy: SubagentBashPolicy;
  mission: string;
  outputFormat: string[];
}> = [
  {
    role: "PLN",
    label: "Planner",
    icon: "📋",
    activeTools: ["read", "grep", "find", "ls", "harness_web_search", "harness_web_fetch"],
    bashPolicy: "read-only",
    mission: "Decide what to build and in what order. Decompose work, cover ACs, and challenge gaps.",
    outputFormat: [
      "## Plan",
      "## AC coverage",
      "## Risks / dependencies",
      "## Challenges to IMP and VER",
    ],
  },
  {
    role: "IMP",
    label: "Implementer",
    icon: "🔨",
    activeTools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
    bashPolicy: "implement",
    mission: "Implement the requested increment only. Report changes and concerns, but never declare ACs passed.",
    outputFormat: [
      "## Implementation summary",
      "## Files changed",
      "## Commands run",
      "## Known concerns / handoff to VER",
    ],
  },
  {
    role: "VER",
    label: "Verifier",
    icon: "✅",
    activeTools: ["read", "bash", "grep", "find", "ls"],
    bashPolicy: "verify",
    mission: "Run gates, verify AC evidence, detect regressions, and challenge unsupported completion claims.",
    outputFormat: [
      "## Gate results",
      "## Verification evidence",
      "## AC verdict",
      "## Regressions / blockers / challenges",
    ],
  },
];

const READ_ONLY_BASH_PREFIXES = [
  "ls",
  "head",
  "tail",
  "wc",
  "grep",
  "rg",
  "ag",
  "find",
  "tree",
  "file",
  "stat",
  "du",
  "df",
  "echo",
  "printf",
  "date",
  "which",
  "where",
  "type",
  "env",
  "printenv",
  "uname",
  "pwd",
  "sort",
  "cut",
  "awk",
  "jq",
  "git log",
  "git show",
  "git diff",
  "git status",
  "git branch",
  "git tag",
  "git remote",
  "git rev-parse",
  "git grep",
  "cargo search",
  "cargo doc",
  "rustup show",
  "npm search",
  "npm info",
  "npm view",
  "pnpm search",
  "pnpm info",
  "pip show",
  "pip list",
  "agent-browser",
  "npx agent-browser",
];

const MUTATING_BASH_PREFIXES = [
  "rm",
  "mv",
  "cp",
  "mkdir",
  "touch",
  "chmod",
  "chown",
  "git add",
  "git commit",
  "git push",
  "git pull",
  "git merge",
  "git rebase",
  "git switch",
  "git checkout",
  "git restore",
  "cargo build",
  "cargo run",
  "cargo test",
  "cargo install",
  "cargo xtask",
  "npm run",
  "npm install",
  "npm ci",
  "yarn",
  "pnpm install",
  "pnpm add",
  "make",
  "cmake",
  "python",
  "node",
  "deno",
  "bun run",
  "docker",
  "kubectl",
];

const RAW_NETWORK_BASH_PREFIXES = [
  "curl",
  "wget",
  "http",
  "https",
  "xh",
  "lynx",
  "links",
  "elinks",
];

const VERIFY_BASH_PREFIXES = [
  ...READ_ONLY_BASH_PREFIXES,
  "cargo test",
  "cargo build",
  "cargo check",
  "cargo clippy",
  "cargo fmt",
  "npm test",
  "npm run",
  "pnpm test",
  "pnpm run",
  "yarn test",
  "yarn run",
  "bun test",
  "bun run",
  "deno test",
  "deno check",
  "pytest",
  "python -m pytest",
  "python -m unittest",
  "jest",
  "vitest",
  "eslint",
  "prettier",
  "tsc",
  "ruff",
  "mypy",
  "go test",
  "go build",
  "go vet",
  "gradle test",
  "gradle build",
  "./gradlew test",
  "./gradlew build",
  "mvn test",
  "mvn verify",
  "mvn package",
  "make test",
  "make build",
  "make check",
  "make lint",
  "make verify",
];

async function readRegistry(cwd: string): Promise<VerificationRegistry> {
  try {
    const content = await readFile(join(cwd, REGISTRY_DIR, REGISTRY_FILE), "utf-8");
    return JSON.parse(content);
  } catch {
    return { $schema: "harness-verification-registry-v1", entries: {} };
  }
}

async function writeRegistry(cwd: string, registry: VerificationRegistry): Promise<void> {
  const dir = join(cwd, REGISTRY_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(cwd, REGISTRY_DIR, REGISTRY_FILE), JSON.stringify(registry, null, 2) + "\n", "utf-8");
}

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

function buildExploreSubagentSystemPrompt(
  role: { persona: ExplorePersona; label: string; stance: string; challengeFocus: string },
): string {
  return [
    "[HARNESS EXPLORE SUBAGENT]",
    `You are ${role.persona} (${role.label}) in an isolated explore subagent.`,
    role.stance,
    `Primary challenge focus: ${role.challengeFocus}`,
    "",
    "Operating rules:",
    "- You are a real isolated subagent, not a role-played paragraph in the main context.",
    "- Use only read-only local inspection and structured web evidence tools.",
    "- You MUST use harness_web_search at least once before making ecosystem or prior-art claims.",
    "- You MUST use harness_web_fetch on at least one URL you intend to rely on.",
    "- External claims without explicit URL citations are forbidden.",
    "- Local codebase claims should cite file paths.",
    "- Do not write files, edit code, or suggest implementation as already decided.",
    "- Return concise markdown with citations inline.",
  ].join("\n");
}

function buildExploreSubagentTask(
  role: { persona: ExplorePersona; label: string; icon: string },
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
    "2. Search the web for external evidence relevant to the topic.",
    "3. Fetch at least one strong source you plan to cite.",
    "4. Produce your position in markdown.",
    "",
    "Required output format:",
    `## ${role.persona} thesis`,
    "## Evidence",
    "- Local: [file-path] claim",
    "- External: [URL] claim",
    "## Attacks on the other two personas",
    "## Surviving recommendation",
    "## Confidence",
    "",
    "Any claim without a file path or URL must be marked [UNVERIFIED].",
  ].filter(Boolean).join("\n");
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

function buildExecuteRoleSystemPrompt(
  role: { role: ExecuteRole; label: string; mission: string; outputFormat: string[] },
): string {
  const prohibitions = role.role === "PLN"
    ? ["Do not write code.", "Do not mark ACs as passed.", "Do not run mutating commands."]
    : role.role === "IMP"
      ? ["Do not mark ACs as passed.", "Do not commit or push git changes.", "Stay inside the assigned implementation scope."]
      : ["Do not write production code.", "Do not change the increment plan.", "Do not hand-wave. Show evidence."];

  return [
    "[HARNESS EXECUTE SUBAGENT]",
    `You are ${role.role} (${role.label}) in an isolated execute subagent.`,
    role.mission,
    "",
    "Operating rules:",
    "- You are a real isolated subagent, not an internal monologue of the parent agent.",
    ...prohibitions.map((line) => `- ${line}`),
    "- Report in markdown only.",
    "- If evidence is missing, say so explicitly.",
    "- If you are blocked, describe the exact blocker and next handoff needed.",
    "",
    "Required sections:",
    ...role.outputFormat.map((section) => `- ${section}`),
  ].join("\n");
}

function buildExecuteRoleTask(
  role: { role: ExecuteRole; label: string; icon: string },
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

function describeLiveSubagent<TRole extends string>(snapshot: HarnessSubagentSnapshot<TRole> | undefined): string {
  if (!snapshot) return "queued";
  if (snapshot.livePhase === "tool_running") {
    return snapshot.currentToolName ? formatLiveToolName(snapshot.currentToolName) : "working";
  }
  if (snapshot.livePhase === "running") return "thinking";
  if (snapshot.livePhase === "starting") return "starting";
  if (snapshot.livePhase === "completed") return "done";
  return "failed";
}

function formatLiveExploreBatchStatus(batch: ExploreLiveBatchState): string {
  const snapshotsByPersona = new Map<ExplorePersona, HarnessSubagentSnapshot<ExplorePersona>>();
  for (const snapshot of batch.snapshots) {
    snapshotsByPersona.set(snapshot.role, snapshot);
  }

  const segments = batch.personas.map((persona) => {
    const spec = resolveExplorePersona(persona);
    return `${spec.icon}${persona} ${describeLiveSubagent(snapshotsByPersona.get(persona))}`;
  });

  return `🤖 ${batch.completed}/${batch.total} · ${segments.join(" · ")}`;
}

function formatLiveExecuteBatchStatus(batch: ExecuteLiveBatchState): string {
  const snapshotsByRole = new Map<ExecuteRole, HarnessSubagentSnapshot<ExecuteRole>>();
  for (const snapshot of batch.snapshots) {
    snapshotsByRole.set(snapshot.role, snapshot);
  }

  const segments = batch.roles.map((role) => {
    const spec = resolveExecuteRole(role);
    return `${spec.icon}${role} ${describeLiveSubagent(snapshotsByRole.get(role))}`;
  });

  return `🤖 ${batch.completed}/${batch.total} · ${segments.join(" · ")}`;
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
  snapshot: HarnessSubagentSnapshot<ExecuteRole> | undefined,
  result: ExecuteSubagentResult | undefined,
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
  return EXPLORE_SUBAGENT_ROLES.map((role) => {
    const result = details.results.find((entry) => entry.persona === role.persona);
    const snapshot = details.snapshots.find((entry) => entry.role === role.persona);
    const source = snapshot ?? result;
    const line = [
      theme.fg("toolTitle", theme.bold(`${role.icon} ${role.persona}`)),
      theme.fg("dim", formatSubagentPid(source?.provenance.pid)),
      theme.fg(getSubagentPhaseTone(snapshot, result), getSubagentPhase(snapshot, result)),
      theme.fg("toolOutput", summarizeExploreCollapsedActivity(snapshot, result)),
    ].filter(Boolean);
    return `${line[0]} ${theme.fg("muted", "·")} ${line.slice(1).join(` ${theme.fg("muted", "·")} `)}`;
  }).join("\n");
}

function renderExecuteSubagentCollapsedText(
  details: ExecuteSubagentToolDetails,
  theme: { fg: (token: string, text: string) => string; bold: (text: string) => string },
): string {
  return details.roles.map((role) => {
    const result = details.results.find((entry) => entry.role === role);
    const snapshot = details.snapshots.find((entry) => entry.role === role);
    const source = snapshot ?? result;
    const line = [
      theme.fg("toolTitle", theme.bold(`${resolveExecuteRole(role).icon} ${role}`)),
      theme.fg("dim", formatSubagentPid(source?.provenance.pid)),
      theme.fg(getSubagentPhaseTone(snapshot, result), getSubagentPhase(snapshot, result)),
      theme.fg("toolOutput", summarizeExecuteCollapsedActivity(snapshot, result)),
    ].filter(Boolean);
    return `${line[0]} ${theme.fg("muted", "·")} ${line.slice(1).join(` ${theme.fg("muted", "·")} `)}`;
  }).join("\n");
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

function formatPersistedSubagentRecordSummary(record: PersistedSubagentBatchRecord): string {
  const subject = summarizeSubagentText(
    record.mode === "explore" ? record.topic : record.objective,
    72,
  ) || `${record.mode} batch`;
  const evidenceSummary = record.mode === "explore"
    ? ` | 🔎${record.totals.evidence?.searches ?? 0} | 🌐${record.totals.evidence?.fetches ?? 0}`
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

function lastAssistantMessageText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "assistant") return extractAssistantText(message);
  }
  return "";
}

function hasExternalCitation(text: string): boolean {
  return /https?:\/\//i.test(text);
}

function extractUrlsFromText(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)\]>"']+/g) ?? [];
  return uniqueUrls(matches);
}

// ─── Explore bash enforcement helpers ─────────────────────────────────

function isAgentBrowserCommand(command: string): boolean {
  const trimmed = command.trim();
  return trimmed.startsWith("agent-browser") || trimmed.startsWith("npx agent-browser");
}

function classifyExploreBash(command: string): { allowed: boolean; reason?: string } {
  const trimmed = command.trim();
  if (!trimmed) {
    return { allowed: false, reason: "Empty bash command." };
  }

  if ((/[;&>|]/.test(trimmed) || /\btee\b/.test(trimmed)) && !isAgentBrowserCommand(trimmed)) {
    return {
      allowed: false,
      reason: "Compound bash commands, pipes, and redirects are blocked in explore mode. Use structured tools or a single read-only command.",
    };
  }

  for (const prefix of RAW_NETWORK_BASH_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      return {
        allowed: false,
        reason: "Raw network bash commands are blocked in explore mode. Use harness_web_search for discovery and harness_web_fetch for source inspection so external evidence remains auditable.",
      };
    }
  }

  for (const prefix of MUTATING_BASH_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      return {
        allowed: false,
        reason: `This bash command appears to mutate state (matched prefix: ${prefix}). Explore mode is strictly read-only.`,
      };
    }
  }

  for (const prefix of READ_ONLY_BASH_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      return { allowed: true };
    }
  }

  return {
    allowed: false,
    reason: "Unknown bash command in explore mode. Use read/grep/find/ls for local inspection, or harness_web_search / harness_web_fetch for external research.",
  };
}

function classifyExecuteBash(command: string): { allowed: boolean; reason?: string } {
  const trimmed = command.trim();
  if (!trimmed) {
    return { allowed: false, reason: "Empty bash command." };
  }

  if (/[;&>|]/.test(trimmed) || /\btee\b/.test(trimmed)) {
    return {
      allowed: false,
      reason: "Compound bash commands, pipes, and redirects are blocked for execute subagents. Run one verification/build command per tool call.",
    };
  }

  for (const prefix of RAW_NETWORK_BASH_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      return {
        allowed: false,
        reason: "Raw network bash commands are blocked for execute subagents.",
      };
    }
  }

  for (const prefix of MUTATING_BASH_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      return {
        allowed: false,
        reason: `This bash command is blocked for execute subagents (matched prefix: ${prefix}). Use edit/write for code changes and reserve git mutations for harness_commit.`,
      };
    }
  }

  for (const prefix of VERIFY_BASH_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      return { allowed: true };
    }
  }

  return {
    allowed: false,
    reason: "Unknown execute-mode bash command. Use focused build/test/lint/typecheck commands, or read/grep/find/ls for inspection.",
  };
}

function classifyChildBashCommand(policy: SubagentBashPolicy, command: string): { allowed: boolean; reason?: string } {
  switch (policy) {
    case "none":
      return { allowed: false, reason: "This subagent is not allowed to use bash." };
    case "read-only":
      return classifyExploreBash(command);
    case "verify":
    case "implement":
      return classifyExecuteBash(command);
    default:
      return { allowed: false, reason: `Unknown child bash policy: ${policy}` };
  }
}

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
  let state: HarnessState = {
    mode: "off",
    acStatuses: [],
    regressionCount: 0,
    commitCount: 0,
  };

  let baselineActiveTools: string[] = [];
  let exploreTotals = createExploreEvidenceTotals();
  let exploreChain = createExploreEvidenceChain();
  let executeTotals = createExecuteSubagentTotals();
  let liveExploreBatch: ExploreLiveBatchState | undefined;
  let liveExecuteBatch: ExecuteLiveBatchState | undefined;

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

  function clearLiveSubagentBatches() {
    liveExploreBatch = undefined;
    liveExecuteBatch = undefined;
  }

  function setLiveExploreBatch(details: ExploreSubagentToolDetails) {
    liveExploreBatch = {
      topic: details.topic,
      completed: details.completed,
      total: details.total,
      personas: EXPLORE_SUBAGENT_ROLES.map((role) => role.persona),
      snapshots: details.snapshots,
    };
    liveExecuteBatch = undefined;
  }

  function setLiveExecuteBatch(details: ExecuteSubagentToolDetails) {
    liveExecuteBatch = {
      objective: details.objective,
      completed: details.completed,
      total: details.total,
      roles: [...details.roles],
      snapshots: details.snapshots,
    };
    liveExploreBatch = undefined;
  }

  function resetExploreTracking() {
    exploreTotals = createExploreEvidenceTotals();
    exploreChain = createExploreEvidenceChain();
  }

  function resetExecuteTracking() {
    executeTotals = createExecuteSubagentTotals();
  }

  function beginExploreEvidenceChainIfNeeded() {
    if (state.mode !== "explore") return;
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

  function markSubagentUsage(details: ExploreSubagentToolDetails | undefined) {
    beginExploreEvidenceChainIfNeeded();
    exploreTotals.subagentRuns += 1;
    if (exploreChain.active) exploreChain.subagentRuns += 1;
    if (!details) return;

    exploreTotals.searches += details.results.reduce((sum, result) => sum + result.searches, 0);
    exploreTotals.fetches += details.results.reduce((sum, result) => sum + result.fetches, 0);
    if (exploreChain.active) {
      exploreChain.searches += details.results.reduce((sum, result) => sum + result.searches, 0);
      exploreChain.fetches += details.results.reduce((sum, result) => sum + result.fetches, 0);
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

  function markExecuteSubagentUsage(details: ExecuteSubagentToolDetails | undefined) {
    executeTotals.subagentRuns += 1;
    if (!details) return;

    for (const result of details.results) {
      executeTotals.roleRuns[result.role] += 1;
    }
  }

  function setModeTools(mode: Mode) {
    const all = new Set(getAllToolNames());

    if (baselineActiveTools.length === 0) {
      baselineActiveTools = getActiveToolNames();
    }

    if (mode === "explore") {
      const safe = [...SAFE_EXPLORE_TOOL_NAMES].filter((name) => all.has(name));
      pi.setActiveTools(safe);
      return;
    }

    if (mode === "execute") {
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

  function updateUI(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;

    if (state.mode === "explore") {
      ctx.ui.setStatus(
        "harness",
        `🧠 EXPLORE 🤖${exploreTotals.subagentRuns} 🔎${exploreTotals.searches} 🌐${exploreTotals.fetches} 🔗${exploreTotals.sources.size}`,
      );
      ctx.ui.setWidget(
        "harness",
        liveExploreBatch ? [formatLiveExploreBatchStatus(liveExploreBatch)] : undefined,
      );
      return;
    }

    if (state.mode === "execute") {
      const passed = state.acStatuses.filter((a) => a.status === "pass").length;
      const failed = state.acStatuses.filter((a) => a.status === "fail").length;
      const pending = state.acStatuses.filter((a) => a.status === "pending").length;

      ctx.ui.setStatus(
        "harness",
        `⚙️ EXECUTE 🤖${executeTotals.subagentRuns} ✅${passed} ❌${failed} ⏳${pending} 📦${state.commitCount}`,
      );
      ctx.ui.setWidget(
        "harness",
        liveExecuteBatch ? [formatLiveExecuteBatchStatus(liveExecuteBatch)] : undefined,
      );
      return;
    }

    ctx.ui.setStatus("harness", undefined);
    ctx.ui.setWidget("harness", undefined);
  }

  function endExploreEvidenceChain() {
    exploreChain = createExploreEvidenceChain();
  }

  // ── State persistence ─────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    state = { mode: "off", acStatuses: [], regressionCount: 0, commitCount: 0 };
    baselineActiveTools = getActiveToolNames();
    resetExploreTracking();
    resetExecuteTracking();
    clearLiveSubagentBatches();

    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === "cognitive-harness-state") {
        state = {
          mode: "off",
          acStatuses: [],
          regressionCount: 0,
          commitCount: 0,
          ...(entry.data as Partial<HarnessState>),
        };
      }
    }

    if (IS_SUBAGENT_CHILD) {
      const childTools = (CHILD_SUBAGENT_TOOLS.length > 0 ? CHILD_SUBAGENT_TOOLS : [...SAFE_SUBAGENT_CHILD_TOOL_NAMES])
        .filter((name) => getAllToolNames().includes(name));
      pi.setActiveTools(childTools);
      return;
    }

    setModeTools(state.mode);
    updateUI(ctx);
  });

  // ── Mode switching commands ───────────────────────────────────────

  pi.registerCommand("explore", {
    description: "Switch to divergent thinking mode (3-persona debate)",
    handler: async (args, ctx) => {
      state.mode = "explore";
      state.debateRound = 0;
      saveState();
      resetExploreTracking();
      resetExecuteTracking();
      clearLiveSubagentBatches();
      setModeTools("explore");
      updateUI(ctx);
      ctx.ui.notify("🧠 Explore mode activated — isolated subagents + structured web evidence required", "info");

      const topic = args || "next iteration";
      pi.sendUserMessage(`/skill:explore ${topic}`, { deliverAs: "followUp" });
    },
  });

  pi.registerCommand("execute", {
    description: "Switch to agile execution mode (3-role verification)",
    handler: async (args, ctx) => {
      state.mode = "execute";
      state.criteriaFile = args || undefined;
      state.currentIncrement = undefined;
      state.regressionCount = 0;
      state.commitCount = 0;
      saveState();
      endExploreEvidenceChain();
      resetExecuteTracking();
      clearLiveSubagentBatches();
      setModeTools("execute");
      updateUI(ctx);
      ctx.ui.notify("⚙️ Execute mode activated — orchestration-only parent + isolated role subagents enabled", "info");

      const criteria = args || "";
      pi.sendUserMessage(`/skill:execute ${criteria}`, { deliverAs: "followUp" });
    },
  });

  pi.registerCommand("harness-off", {
    description: "Disable cognitive harness (return to normal mode)",
    handler: async (_args, ctx) => {
      state.mode = "off";
      saveState();
      endExploreEvidenceChain();
      resetExecuteTracking();
      clearLiveSubagentBatches();
      setModeTools("off");
      updateUI(ctx);
      ctx.ui.notify("Cognitive harness disabled", "info");
    },
  });

  pi.registerCommand("harness-status", {
    description: "Show current harness mode and AC status",
    handler: async (_args, ctx) => {
      if (state.mode === "off") {
        ctx.ui.notify("Harness is off. Use /explore or /execute to activate.", "info");
        return;
      }

      const lines: string[] = [];
      lines.push(`Mode: ${state.mode}`);

      if (state.mode === "execute") {
        const passed = state.acStatuses.filter((a) => a.status === "pass").length;
        const failed = state.acStatuses.filter((a) => a.status === "fail").length;
        const pending = state.acStatuses.filter((a) => a.status === "pending").length;
        lines.push(`ACs: ✅ ${passed} | ❌ ${failed} | ⏳ ${pending}`);
        lines.push(`Regressions: ${state.regressionCount}`);
        lines.push(`Subagents: 🤖 ${executeTotals.subagentRuns} | PLN ${executeTotals.roleRuns.PLN} | IMP ${executeTotals.roleRuns.IMP} | VER ${executeTotals.roleRuns.VER}`);
        if (state.currentIncrement) lines.push(`Current: ${state.currentIncrement}`);
        if (state.criteriaFile) lines.push(`Criteria: ${state.criteriaFile}`);
      }

      if (state.mode === "explore") {
        lines.push(`Debate round: ${state.debateRound ?? 0}/3`);
        lines.push(`External evidence: 🤖 ${exploreTotals.subagentRuns} subagent rounds | 🔎 ${exploreTotals.searches} searches | 🌐 ${exploreTotals.fetches} fetches | 🔗 ${exploreTotals.sources.size} URLs | ↺ ${exploreTotals.retries} retries`);
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // ── External evidence tracking ─────────────────────────────────────

  pi.on("agent_start", async () => {
    if (state.mode !== "explore") return;
    if (!exploreChain.active) {
      beginExploreEvidenceChainIfNeeded();
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    if (state.mode === "explore") {
      if (event.toolName === "harness_explore_subagents") {
        const details = event.details as ExploreSubagentToolDetails | undefined;
        markSubagentUsage(details);
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

    if (state.mode === "execute" && event.toolName === "harness_execute_subagents") {
      const details = event.details as ExecuteSubagentToolDetails | undefined;
      markExecuteSubagentUsage(details);
      updateUI(ctx);
    }
  });

  pi.on("agent_end", async (event, ctx) => {
    if (state.mode !== "explore" || !exploreChain.active) return;

    const finalText = lastAssistantMessageText(event.messages as any[]);
    const usedSubagents = exploreChain.subagentRuns > 0;
    const usedDiscovery = exploreChain.searches > 0 || exploreChain.browserResearchCalls > 0;
    const usedInspection = exploreChain.fetches > 0;
    const enoughSources = exploreChain.sources.size >= 2;
    const citedSources = hasExternalCitation(finalText);
    const compliant = usedSubagents && usedDiscovery && usedInspection && enoughSources && citedSources;

    if (compliant) {
      endExploreEvidenceChain();
      updateUI(ctx);
      return;
    }

    if (exploreChain.retries >= 1) {
      ctx.ui.notify(
        "Explore output still lacks sufficient external evidence after an automatic retry. Review citations manually or rerun /explore with a narrower topic.",
        "warning",
      );
      endExploreEvidenceChain();
      updateUI(ctx);
      return;
    }

    exploreChain.retries += 1;
    exploreTotals.retries += 1;
    updateUI(ctx);
    ctx.ui.notify("External-evidence gate triggered — forcing an evidence-backed revision pass.", "warning");

    pi.sendUserMessage(
      [
        {
          type: "text",
          text: [
            "SYSTEM ENFORCEMENT: The previous /explore output is not accepted yet.",
            "It did not show enough external evidence usage and/or explicit URL citations.",
            "",
            "Before revising, you MUST:",
            "1. Call harness_explore_subagents to run the isolated OPT/PRA/SKP subagents in parallel if you have not already.",
            "2. Use harness_web_search for focused external queries when you need additional evidence beyond the subagent pass.",
            "3. Use harness_web_fetch on relevant URLs before relying on them in the synthesis.",
            "4. Revise the debate so every external claim cites explicit source URLs.",
            "5. Mark unsupported claims as [UNVERIFIED] or strike them from the synthesis.",
            "6. Keep local codebase claims tied to file paths; keep external claims tied to URLs.",
            "",
            "Return only the revised exploration update.",
          ].join("\n"),
        },
      ],
      { deliverAs: "followUp" },
    );
  });

  // ── Tool enforcement ──────────────────────────────────────────────

  pi.on("tool_call", async (event) => {
    if (IS_SUBAGENT_CHILD) {
      if ((event.toolName === "write" || event.toolName === "edit") && CHILD_SUBAGENT_ROLE !== "IMP") {
        return {
          block: true,
          reason: `🔴 BLOCKED: ${CHILD_SUBAGENT_ROLE || "This child subagent"} cannot mutate files.`,
        };
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

      return;
    }

    if (state.mode === "explore") {
      if (event.toolName === "write" || event.toolName === "edit") {
        return {
          block: true,
          reason: `🔴 BLOCKED: \"${event.toolName}\" is not allowed in explore mode. Explore mode is read-only — no code modifications. Use /execute to switch to implementation mode.`,
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

    if (state.mode === "execute") {
      if (event.toolName === "write" || event.toolName === "edit") {
        return {
          block: true,
          reason: `🔴 BLOCKED: Main execute mode is orchestration-only. Delegate implementation to harness_execute_subagents with the IMP role.`,
        };
      }

      if (isToolCallEventType("bash", event)) {
        return {
          block: true,
          reason: "🔴 BLOCKED: Main execute mode is orchestration-only. Delegate build/test/check commands to harness_execute_subagents with the VER role.",
        };
      }
    }
  });

  // ── System prompt injection ───────────────────────────────────────

  pi.on("before_agent_start", async (event) => {
    if (state.mode === "off") return;

    let injection = "";

    if (state.mode === "explore") {
      injection = `
[COGNITIVE HARNESS: EXPLORE MODE ACTIVE]
You are operating in divergent thinking mode with 3-persona debate.
- 🔴 OPT (Optimist): Push for the ambitious path
- 🟡 PRA (Pragmatist): Ground in what ships
- 🟢 SKP (Skeptic): Find what breaks
Rules: No unanimous agreement in Round 1. Evidence required from Round 2. Unsupported claims struck in Round 3.
Local file mutation is BLOCKED.
Structured external-evidence tools are active:
- harness_explore_subagents: REQUIRED isolated parallel OPT/PRA/SKP subagent pass before final synthesis.
- harness_web_search: discover ecosystem, prior-art, benchmark, and failure-mode sources.
- harness_web_fetch: inspect source pages and cite exact URLs before relying on them.
External-evidence policy:
- Codebase-local claims may cite repository files.
- Ecosystem, library, market, benchmark, standards, prior-art, and failure-mode claims MUST be backed by external URLs.
- Search snippets alone are not enough for key claims; fetch the strongest sources.
- Raw network bash (curl/wget/etc.) is BLOCKED so provenance stays auditable.
- Before producing a final /explore synthesis, you MUST call harness_explore_subagents at least once.
- A synthesis is not acceptable unless it cites explicit source URLs or marks a claim [UNVERIFIED].
Evidence collected this session so far: ${exploreTotals.subagentRuns} subagent rounds, ${exploreTotals.searches} searches, ${exploreTotals.fetches} fetches, ${exploreTotals.sources.size} unique URLs.
`;
    }

    if (state.mode === "execute") {
      const passed = state.acStatuses.filter((a) => a.status === "pass").length;
      const total = state.acStatuses.length;

      injection = `
[COGNITIVE HARNESS: EXECUTE MODE ACTIVE]
You are operating in convergent execution mode with 3-role mutual verification.
- 📋 PLN (Planner): Decides what/order. Cannot write code or mark ACs.
- 🔨 IMP (Implementer): Writes code. Cannot mark ACs passed.
- ✅ VER (Verifier): Sole authority on AC pass/fail. Cannot write code.
Iron law: No role evaluates its own output.
This parent execute agent is an ORCHESTRATOR. Direct write/edit/bash implementation is blocked here.
Use harness_execute_subagents to invoke real isolated PLN / IMP / VER subprocess agents.
AC Status: ${passed}/${total} passed. Regressions: ${state.regressionCount}. Commits: ${state.commitCount}.
${state.currentIncrement ? `Current increment: ${state.currentIncrement}` : ""}
VERIFICATION REGISTRY: VER must maintain a cumulative Verification Registry (.harness/verification-registry.json).
- After confirming an AC passes, VER MUST call harness_verify_register to record the verification method.
- Before regression checks, VER MUST call harness_verify_list and re-run every registered verification.
- A passing AC without a registered verification is a gap that PLN should challenge.
- Planning, implementation, and verification work should be delegated to harness_execute_subagents rather than role-played in the parent context.
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
    description: "Search the public web for external sources. Use this in explore mode to gather ecosystem, prior-art, benchmark, or failure-mode evidence before making claims.",
    promptSnippet: "Search the public web for external evidence and candidate sources.",
    promptGuidelines: [
      "Use harness_web_search in explore mode before making ecosystem or prior-art claims.",
      "Prefer multiple focused queries over one broad query.",
      "After finding promising results, call harness_web_fetch on the strongest URLs before relying on them in the synthesis.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      max_results: Type.Optional(Type.Number({ description: "Maximum results to return (default 5, max 10)" })),
      backend: Type.Optional(Type.String({ description: "Optional search backend override: duckduckgo, searxng, or tavily" })),
    }),
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
  });

  pi.registerTool({
    name: "harness_explore_subagents",
    label: "Explore Subagents",
    description: "Run isolated OPT/PRA/SKP explore subagents in parallel using separate pi subprocesses. Use this in explore mode before synthesis so each persona gathers its own evidence-backed position.",
    promptSnippet: "Run isolated OPT/PRA/SKP subagents in parallel for explore mode and return their evidence-backed positions.",
    promptGuidelines: [
      "Call harness_explore_subagents in explore mode before writing the final debate synthesis; it launches OPT/PRA/SKP in parallel.",
      "Pass a concise topic and optional project context summary so each subagent can research independently.",
      "Use the returned citations directly in the final debate transcript and synthesis.",
    ],
    parameters: Type.Object({
      topic: Type.String({ description: "Exploration topic or decision question" }),
      project_context: Type.Optional(Type.String({ description: "Optional codebase/project context summary for the subagents" })),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (state.mode !== "explore") {
        throw new Error("harness_explore_subagents is only available in explore mode. Use /explore first.");
      }

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
        activeTools: ["read", "grep", "find", "ls", "harness_web_search", "harness_web_fetch"],
        bashPolicy: "read-only",
        extensionPath: CURRENT_EXTENSION_PATH,
        modelSpec,
        thinkingLevel,
        signal,
      }));

      setLiveExploreBatch(buildExploreSubagentDetails(params.topic, 0, EXPLORE_SUBAGENT_ROLES.length, [], []));
      updateUI(ctx);

      try {
        const results = await runHarnessSubagentBatch(specs, {
          mode: "parallel",
          onSnapshot: (snapshots, completed, total, batchResults) => {
            latestSnapshots = snapshots;
            const details = buildExploreSubagentDetails(params.topic, completed, total, batchResults, snapshots);
            setLiveExploreBatch(details);
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
        clearLiveSubagentBatches();
        updateUI(ctx);
      }
    },
    renderCall(args, theme, _context) {
      const topic = summarizeSubagentText(args.topic, MAX_SUBAGENT_CALL_PREVIEW_CHARS) || "...";
      const text = [
        theme.fg("toolTitle", theme.bold("explore_subagents ")),
        theme.fg("accent", topic),
        theme.fg("muted", " · OPT/PRA/SKP · parallel isolated subprocesses"),
      ].join("");
      return new Text(text, 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme, _context) {
      const details = result.details as ExploreSubagentToolDetails | undefined;
      if (!details) {
        const textBlock = result.content.find((item) => item.type === "text");
        const fallback = textBlock?.type === "text" ? textBlock.text : "";
        if (isPartial) return new Text(theme.fg("warning", "Launching explore subagents..."), 0, 0);
        return new Text(expanded ? (fallback || "(no output)") : (summarizeSubagentText(fallback, 160) || "(no output)"), 0, 0);
      }

      return new Text(
        expanded
          ? renderExploreSubagentExpandedText(details, isPartial, theme)
          : renderExploreSubagentCollapsedText(details, theme),
        0,
        0,
      );
    },
  });

  pi.registerTool({
    name: "harness_execute_subagents",
    label: "Execute Subagents",
    description: "Run isolated PLN / IMP / VER execute subagents using separate pi subprocesses. Use this in execute mode instead of role-playing the three roles inside the parent agent.",
    promptSnippet: "Run isolated execute subagents (PLN / IMP / VER) and return their role-specific outputs.",
    promptGuidelines: [
      "Use harness_execute_subagents in execute mode for planning, implementation, and verification work.",
      "Default to sequential mode so each role can react to prior role outputs.",
      "Reserve registry updates and harness_commit for the parent execute agent after VER's evidence is in.",
    ],
    parameters: Type.Object({
      objective: Type.String({ description: "The concrete execute objective, e.g. 'Plan increments for criteria X' or 'Implement and verify INC-2'" }),
      roles: Type.Optional(Type.Array(Type.String(), { description: "Subset/order of roles to run, e.g. ['PLN','IMP','VER']" })),
      mode: Type.Optional(Type.String({ description: "Execution mode: 'sequential' (default) or 'parallel'" })),
      context: Type.Optional(Type.String({ description: "Optional additional context for the role subagents" })),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (state.mode !== "execute") {
        throw new Error("harness_execute_subagents is only available in execute mode. Use /execute first.");
      }

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
          modelSpec,
          thinkingLevel,
          signal,
        };
      });

      setLiveExecuteBatch(buildExecuteSubagentDetails(params.objective, mode, roles, 0, roles.length, [], []));
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
            setLiveExecuteBatch(details);
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
        clearLiveSubagentBatches();
        updateUI(ctx);
      }
    },
    renderCall(args, theme, _context) {
      const objective = summarizeSubagentText(args.objective, MAX_SUBAGENT_CALL_PREVIEW_CHARS) || "...";
      const mode = typeof args.mode === "string" && args.mode.trim().toLowerCase() === "parallel"
        ? "parallel"
        : "sequential";
      const roles = Array.isArray(args.roles) && args.roles.length > 0
        ? args.roles.map((role) => String(role).trim().toUpperCase()).filter(Boolean).join("/")
        : "PLN/IMP/VER";
      const text = [
        theme.fg("toolTitle", theme.bold("execute_subagents ")),
        theme.fg("accent", objective),
        theme.fg("muted", ` · ${mode} · ${roles}`),
      ].join("");
      return new Text(text, 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme, _context) {
      const details = result.details as ExecuteSubagentToolDetails | undefined;
      if (!details) {
        const textBlock = result.content.find((item) => item.type === "text");
        const fallback = textBlock?.type === "text" ? textBlock.text : "";
        if (isPartial) return new Text(theme.fg("warning", "Launching execute subagents..."), 0, 0);
        return new Text(expanded ? (fallback || "(no output)") : (summarizeSubagentText(fallback, 160) || "(no output)"), 0, 0);
      }

      return new Text(
        expanded
          ? renderExecuteSubagentExpandedText(details, isPartial, theme)
          : renderExecuteSubagentCollapsedText(details, theme),
        0,
        0,
      );
    },
  });

  // ── Verification Registry tools ───────────────────────────────────

  pi.registerTool({
    name: "harness_verify_register",
    label: "Register Verification Method",
    description: "Register or update a verification method for an acceptance criterion. VER calls this after confirming an AC passes, recording HOW it was verified so future regression checks can re-run the same verification.",
    promptSnippet: "Register a reproducible verification method for an AC (execute mode, VER role only)",
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
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (state.mode !== "execute") {
        throw new Error("harness_verify_register is only available in execute mode.");
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
  });

  pi.registerTool({
    name: "harness_verify_list",
    label: "List Verification Registry",
    description: "List all registered verification methods from the project's Verification Registry. VER calls this before regression checks to get every verification that must be re-run.",
    promptSnippet: "List all registered verification methods for regression checks (execute mode)",
    promptGuidelines: [
      "Call harness_verify_list before running regression checks to get all registered verification methods.",
      "Re-run every listed verification command during regression scans.",
    ],
    parameters: Type.Object({
      filter: Type.Optional(Type.String({ description: "Filter entries by AC ID prefix, e.g. 'AC-1'" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (state.mode !== "execute") {
        throw new Error("harness_verify_list is only available in execute mode.");
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
  });

  // ── Commit & push tool (VER calls after verification) ─────────────

  pi.registerTool({
    name: "harness_commit",
    label: "Commit & Push Increment",
    description: "Commit verified increment changes and push to remote. Only VER should call this after all gates pass and no regressions are detected.",
    promptSnippet: "Commit and push verified increment changes (execute mode, VER role only)",
    promptGuidelines: [
      "Only call harness_commit in execute mode after VER confirms all gates pass and no regressions.",
      "Include the increment ID (e.g. INC-1) and a brief description of the changes.",
    ],
    parameters: Type.Object({
      increment: Type.String({ description: "Increment ID, e.g. 'INC-1'" }),
      message: Type.String({ description: "Brief description of changes in this increment" }),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (state.mode !== "execute") {
        throw new Error("harness_commit is only available in execute mode. Use /execute first.");
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
  });

  // ── Keyboard shortcut ─────────────────────────────────────────────

  pi.registerShortcut("ctrl+shift+h", {
    description: "Toggle harness mode: off → explore → execute → off",
    handler: async (ctx) => {
      const cycle: Mode[] = ["off", "explore", "execute"];
      const idx = cycle.indexOf(state.mode);
      const next = cycle[(idx + 1) % cycle.length];
      state.mode = next;
      saveState();
      if (next === "explore") resetExploreTracking();
      if (next === "execute") resetExecuteTracking();
      if (next !== "explore") endExploreEvidenceChain();
      clearLiveSubagentBatches();
      setModeTools(next);
      updateUI(ctx);
      ctx.ui.notify(`Harness: ${next === "off" ? "disabled" : next}`, "info");
    },
  });
}
