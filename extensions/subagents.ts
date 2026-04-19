import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";

export type HarnessMode = "generic" | "explore" | "execute";
export type SubagentBashPolicy = "none" | "read-only" | "verify" | "implement";
export type SubagentBatchMode = "parallel" | "sequential";
export type HarnessSubagentLivePhase = "starting" | "running" | "tool_running" | "completed" | "failed";

export function resolveGenericSubagentChildMode(parentMode: HarnessMode | "off"): HarnessMode {
  return parentMode === "explore" ? "explore" : "generic";
}

const BUILTIN_TOOL_NAMES = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);
const MAX_RECENT_STREAM_ITEMS = 24;
const MAX_ASSISTANT_PREVIEW_CHARS = 400;
const MAX_STREAM_ITEM_TEXT_CHARS = 160;

export interface HarnessSubagentProvenance {
  pid?: number;
  command: string;
  args: string[];
  cwd: string;
  startedAt?: string;
  endedAt?: string;
}

export interface HarnessSubagentRecentStreamItem {
  at: string;
  type: "assistant_text" | "tool_execution_start" | "tool_execution_end";
  toolName?: string;
  text?: string;
  isError?: boolean;
}

export interface HarnessSubagentSnapshot<TRole extends string = string> {
  mode: HarnessMode;
  role: TRole;
  label: string;
  livePhase: HarnessSubagentLivePhase;
  currentToolName?: string;
  assistantPreview: string;
  recentStream: HarnessSubagentRecentStreamItem[];
  model?: string;
  provenance: HarnessSubagentProvenance;
}

export interface HarnessSubagentSpec<TRole extends string = string> {
  mode: HarnessMode;
  role: TRole;
  label: string;
  task: string;
  systemPrompt: string;
  cwd: string;
  activeTools: string[];
  bashPolicy: SubagentBashPolicy;
  extensionPath: string;
  modelSpec?: string;
  thinkingLevel?: string;
  signal?: AbortSignal;
}

export interface HarnessSubagentRunResult<TRole extends string = string> extends HarnessSubagentSnapshot<TRole> {
  task: string;
  output: string;
  citations: string[];
  toolCalls: Record<string, number>;
  exitCode: number;
  stderr: string;
}

interface HarnessSubagentRunOptions<TRole extends string = string> {
  onSnapshot?: (snapshot: HarnessSubagentSnapshot<TRole>) => void;
}

interface HarnessSubagentBatchOptions<TRole extends string = string> {
  mode: SubagentBatchMode;
  taskResolver?: (
    spec: HarnessSubagentSpec<TRole>,
    previousResults: HarnessSubagentRunResult<TRole>[],
  ) => string;
  onProgress?: (
    results: HarnessSubagentRunResult<TRole>[],
    completed: number,
    total: number,
    snapshots: HarnessSubagentSnapshot<TRole>[],
  ) => void;
  onSnapshot?: (
    snapshots: HarnessSubagentSnapshot<TRole>[],
    completed: number,
    total: number,
    results: HarnessSubagentRunResult<TRole>[],
  ) => void;
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

function uniqueUrls(urls: Iterable<string>): string[] {
  const deduped = new Set<string>();
  for (const url of urls) {
    const normalized = normalizeSourceUrl(url);
    if (normalized) deduped.add(normalized);
  }
  return [...deduped];
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

function extractUrlsFromText(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)\]>"']+/g) ?? [];
  return uniqueUrls(matches);
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const execName = basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }

  return { command: "pi", args };
}

function getBuiltInToolArgs(activeTools: string[]): string[] {
  const builtIns = activeTools.filter((tool) => BUILTIN_TOOL_NAMES.has(tool));
  if (builtIns.length > 0) {
    return ["--tools", builtIns.join(",")];
  }
  return ["--no-tools"];
}

function buildSubagentCliArgs<TRole extends string>(spec: HarnessSubagentSpec<TRole>): string[] {
  const args = [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--no-extensions",
    "-e",
    spec.extensionPath,
    "--no-skills",
    "--no-prompt-templates",
    ...getBuiltInToolArgs(spec.activeTools),
    "--append-system-prompt",
    spec.systemPrompt,
  ];

  if (spec.modelSpec) {
    args.push("--model", spec.modelSpec);
  }

  if (spec.thinkingLevel) {
    args.push("--thinking", spec.thinkingLevel);
  }

  args.push(spec.task);
  return args;
}

function cloneRecentStream(
  recentStream: HarnessSubagentRecentStreamItem[],
): HarnessSubagentRecentStreamItem[] {
  return recentStream.map((item) => ({ ...item }));
}

function cloneSnapshot<TRole extends string>(snapshot: HarnessSubagentSnapshot<TRole>): HarnessSubagentSnapshot<TRole> {
  return {
    ...snapshot,
    provenance: {
      ...snapshot.provenance,
      args: [...snapshot.provenance.args],
    },
    recentStream: cloneRecentStream(snapshot.recentStream),
  };
}

function summarizeTextFragment(text: string, maxChars = MAX_STREAM_ITEM_TEXT_CHARS): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}…`;
}

function summarizeToolArgs(toolName: string, args: any): string | undefined {
  if (toolName === "bash" && typeof args?.command === "string") {
    return summarizeTextFragment(args.command);
  }

  if (typeof args?.path === "string") {
    return summarizeTextFragment(args.path);
  }

  try {
    const serialized = JSON.stringify(args);
    return serialized ? summarizeTextFragment(serialized) : undefined;
  } catch {
    return undefined;
  }
}

function lastMapValue<TKey>(map: Map<TKey, string>): string | undefined {
  let value: string | undefined;
  for (const current of map.values()) value = current;
  return value;
}

function pushRecentStream<TRole extends string>(
  snapshot: HarnessSubagentSnapshot<TRole>,
  item: HarnessSubagentRecentStreamItem,
) {
  snapshot.recentStream.push(item);
  if (snapshot.recentStream.length > MAX_RECENT_STREAM_ITEMS) {
    snapshot.recentStream.splice(0, snapshot.recentStream.length - MAX_RECENT_STREAM_ITEMS);
  }
}

export function formatPriorSubagentOutputs<TRole extends string>(results: HarnessSubagentRunResult<TRole>[]): string {
  return results
    .map((result) => [
      `### ${result.label}`,
      result.output || "[No assistant output captured]",
    ].join("\n"))
    .join("\n\n");
}

export async function runHarnessSubagentProcess<TRole extends string>(
  spec: HarnessSubagentSpec<TRole>,
  options: HarnessSubagentRunOptions<TRole> = {},
): Promise<HarnessSubagentRunResult<TRole>> {
  const invocation = getPiInvocation(buildSubagentCliArgs(spec));
  const toolCalls: Record<string, number> = {};
  const citations = new Set<string>();
  const assistantMessages: any[] = [];
  const inFlightTools = new Map<string, string>();
  const snapshot: HarnessSubagentSnapshot<TRole> = {
    mode: spec.mode,
    role: spec.role,
    label: spec.label,
    livePhase: "starting",
    assistantPreview: "",
    recentStream: [],
    model: spec.modelSpec,
    provenance: {
      command: invocation.command,
      args: [...invocation.args],
      cwd: spec.cwd,
    },
  };

  let stderr = "";
  let model = spec.modelSpec;
  let wasAborted = false;
  let assistantPreviewTail = "";
  let assistantPreviewWasTrimmed = false;

  const emitSnapshot = () => options.onSnapshot?.(cloneSnapshot(snapshot));
  const refreshLiveState = () => {
    snapshot.currentToolName = lastMapValue(inFlightTools);
    if (snapshot.livePhase === "completed" || snapshot.livePhase === "failed") return;
    snapshot.livePhase = snapshot.currentToolName ? "tool_running" : "running";
  };
  const syncAssistantPreview = (text: string) => {
    if (text.length > MAX_ASSISTANT_PREVIEW_CHARS) {
      assistantPreviewTail = text.slice(-MAX_ASSISTANT_PREVIEW_CHARS);
      assistantPreviewWasTrimmed = true;
    } else {
      assistantPreviewTail = text;
      assistantPreviewWasTrimmed = false;
    }
    snapshot.assistantPreview = assistantPreviewWasTrimmed ? `…${assistantPreviewTail}` : assistantPreviewTail;
  };
  const appendAssistantPreview = (delta: string) => {
    const next = assistantPreviewTail + delta;
    if (next.length > MAX_ASSISTANT_PREVIEW_CHARS) {
      assistantPreviewTail = next.slice(-MAX_ASSISTANT_PREVIEW_CHARS);
      assistantPreviewWasTrimmed = true;
    } else {
      assistantPreviewTail = next;
    }
    snapshot.assistantPreview = assistantPreviewWasTrimmed ? `…${assistantPreviewTail}` : assistantPreviewTail;
  };

  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: spec.cwd,
      env: {
        ...process.env,
        HARNESS_SUBAGENT_CHILD: "1",
        HARNESS_SUBAGENT_MODE: spec.mode,
        HARNESS_SUBAGENT_ROLE: String(spec.role),
        HARNESS_SUBAGENT_TOOLS: spec.activeTools.join(","),
        HARNESS_SUBAGENT_BASH_POLICY: spec.bashPolicy,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    snapshot.provenance.pid = child.pid ?? undefined;
    snapshot.provenance.startedAt = new Date().toISOString();
    emitSnapshot();

    let buffer = "";
    let settled = false;
    let finalized = false;
    let abortListener: (() => void) | undefined;

    const settle = (code: number) => {
      if (settled) return;
      settled = true;
      if (spec.signal && abortListener) {
        spec.signal.removeEventListener("abort", abortListener);
      }
      resolve(code);
    };

    const finalizeSnapshot = (code: number) => {
      if (finalized) return;
      finalized = true;
      snapshot.model = model;
      snapshot.provenance.endedAt = new Date().toISOString();
      inFlightTools.clear();
      snapshot.currentToolName = undefined;
      snapshot.livePhase = code === 0 ? "completed" : "failed";
      emitSnapshot();
    };

    const processLine = (line: string) => {
      if (!line.trim()) return;

      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }

      if (event.type === "message_update" && event.message?.role === "assistant") {
        const assistantEvent = event.assistantMessageEvent;
        if (assistantEvent?.type === "text_delta" && typeof assistantEvent.delta === "string") {
          appendAssistantPreview(assistantEvent.delta);
          pushRecentStream(snapshot, {
            at: new Date().toISOString(),
            type: "assistant_text",
            text: summarizeTextFragment(assistantEvent.delta),
          });
          refreshLiveState();
          emitSnapshot();
        }
        return;
      }

      if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
        inFlightTools.set(String(event.toolCallId ?? `${event.toolName}:${Date.now()}`), event.toolName);
        refreshLiveState();
        pushRecentStream(snapshot, {
          at: new Date().toISOString(),
          type: "tool_execution_start",
          toolName: event.toolName,
          text: summarizeToolArgs(event.toolName, event.args),
        });
        emitSnapshot();
        return;
      }

      if (event.type === "tool_execution_end" && typeof event.toolName === "string") {
        inFlightTools.delete(String(event.toolCallId ?? ""));
        refreshLiveState();
        pushRecentStream(snapshot, {
          at: new Date().toISOString(),
          type: "tool_execution_end",
          toolName: event.toolName,
          isError: Boolean(event.isError),
        });
        emitSnapshot();
        return;
      }

      if (event.type !== "message_end" || !event.message) return;

      const message = event.message as any;
      if (message.role === "assistant") {
        assistantMessages.push(message);
        if (typeof message.model === "string" && message.model) {
          model = message.model;
          snapshot.model = message.model;
        }

        const assistantText = extractAssistantText(message);
        if (assistantText) {
          syncAssistantPreview(assistantText);
          refreshLiveState();
          emitSnapshot();
        }
        return;
      }

      if (message.role !== "toolResult" || typeof message.toolName !== "string") return;

      toolCalls[message.toolName] = (toolCalls[message.toolName] ?? 0) + 1;

      if (message.toolName === "harness_web_search") {
        const urls = (message.details?.results ?? [])
          .map((item: { url?: string }) => item.url)
          .filter((url: string | undefined): url is string => Boolean(url));
        for (const url of urls) citations.add(normalizeSourceUrl(url));
      }

      if (message.toolName === "harness_web_fetch" && typeof message.details?.finalUrl === "string") {
        citations.add(normalizeSourceUrl(message.details.finalUrl));
      }
    };

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) processLine(line);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (buffer.trim()) processLine(buffer);
      finalizeSnapshot(code ?? 0);
      settle(code ?? 0);
    });

    child.on("error", () => {
      finalizeSnapshot(1);
      settle(1);
    });

    if (spec.signal) {
      const killChild = () => {
        wasAborted = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 3000);
      };

      abortListener = killChild;
      if (spec.signal.aborted) {
        killChild();
      } else {
        spec.signal.addEventListener("abort", killChild, { once: true });
      }
    }
  });

  if (wasAborted) {
    throw new Error(`Subagent ${spec.label} was aborted`);
  }

  const output = lastAssistantMessageText(assistantMessages);
  if (output) {
    syncAssistantPreview(output);
  }
  for (const url of extractUrlsFromText(output)) citations.add(normalizeSourceUrl(url));

  return {
    mode: spec.mode,
    role: spec.role,
    label: spec.label,
    task: spec.task,
    output,
    citations: uniqueUrls(citations),
    toolCalls,
    exitCode,
    stderr,
    model,
    livePhase: exitCode === 0 ? "completed" : "failed",
    currentToolName: undefined,
    assistantPreview: snapshot.assistantPreview,
    recentStream: cloneRecentStream(snapshot.recentStream),
    provenance: {
      ...snapshot.provenance,
      args: [...snapshot.provenance.args],
    },
  };
}

export async function runHarnessSubagentBatch<TRole extends string>(
  specs: HarnessSubagentSpec<TRole>[],
  options: HarnessSubagentBatchOptions<TRole>,
): Promise<HarnessSubagentRunResult<TRole>[]> {
  const resultSlots: Array<HarnessSubagentRunResult<TRole> | undefined> = new Array(specs.length).fill(undefined);
  const snapshotSlots: Array<HarnessSubagentSnapshot<TRole> | undefined> = new Array(specs.length).fill(undefined);

  const getResults = () => resultSlots.filter((result): result is HarnessSubagentRunResult<TRole> => Boolean(result));
  const getSnapshots = () => snapshotSlots
    .filter((snapshot): snapshot is HarnessSubagentSnapshot<TRole> => Boolean(snapshot))
    .map((snapshot) => cloneSnapshot(snapshot));
  const emitProgress = () => {
    const results = getResults();
    options.onProgress?.(results, results.length, specs.length, getSnapshots());
  };
  const emitSnapshot = () => {
    const results = getResults();
    const snapshots = getSnapshots();
    options.onSnapshot?.(snapshots, results.length, specs.length, results);
  };

  if (options.mode === "parallel") {
    emitProgress();
    emitSnapshot();
    await Promise.all(specs.map(async (spec, index) => {
      const result = await runHarnessSubagentProcess({
        ...spec,
        task: options.taskResolver ? options.taskResolver(spec, []) : spec.task,
      }, {
        onSnapshot: (snapshot) => {
          snapshotSlots[index] = snapshot;
          emitSnapshot();
        },
      });
      resultSlots[index] = result;
      snapshotSlots[index] = cloneSnapshot(result);
      emitSnapshot();
      emitProgress();
    }));
    return getResults();
  }

  emitProgress();
  emitSnapshot();
  for (let index = 0; index < specs.length; index++) {
    const spec = specs[index];
    const previousResults = getResults();
    const task = options.taskResolver ? options.taskResolver(spec, previousResults) : spec.task;
    const result = await runHarnessSubagentProcess({ ...spec, task }, {
      onSnapshot: (snapshot) => {
        snapshotSlots[index] = snapshot;
        emitSnapshot();
      },
    });
    resultSlots[index] = result;
    snapshotSlots[index] = cloneSnapshot(result);
    emitSnapshot();
    emitProgress();
  }
  return getResults();
}
