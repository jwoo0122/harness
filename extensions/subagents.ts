import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";

export type HarnessMode = "explore" | "execute";
export type SubagentBashPolicy = "none" | "read-only" | "verify" | "implement";
export type SubagentBatchMode = "parallel" | "sequential";

const BUILTIN_TOOL_NAMES = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);

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

export interface HarnessSubagentRunResult<TRole extends string = string> {
  mode: HarnessMode;
  role: TRole;
  label: string;
  task: string;
  output: string;
  citations: string[];
  toolCalls: Record<string, number>;
  exitCode: number;
  stderr: string;
  model?: string;
}

interface HarnessSubagentBatchOptions<TRole extends string = string> {
  mode: SubagentBatchMode;
  taskResolver?: (
    spec: HarnessSubagentSpec<TRole>,
    previousResults: HarnessSubagentRunResult<TRole>[],
  ) => string;
  onProgress?: (results: HarnessSubagentRunResult<TRole>[], completed: number, total: number) => void;
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
): Promise<HarnessSubagentRunResult<TRole>> {
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

  const invocation = getPiInvocation(args);
  const toolCalls: Record<string, number> = {};
  const citations = new Set<string>();
  const assistantMessages: any[] = [];
  let stderr = "";
  let model = spec.modelSpec;
  let wasAborted = false;

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

    let buffer = "";

    const processLine = (line: string) => {
      if (!line.trim()) return;

      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }

      if (event.type !== "message_end" || !event.message) return;

      const message = event.message as any;
      if (message.role === "assistant") {
        assistantMessages.push(message);
        if (typeof message.model === "string" && message.model) {
          model = message.model;
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
      resolve(code ?? 0);
    });

    child.on("error", () => resolve(1));

    if (spec.signal) {
      const killChild = () => {
        wasAborted = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 3000);
      };

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
  };
}

export async function runHarnessSubagentBatch<TRole extends string>(
  specs: HarnessSubagentSpec<TRole>[],
  options: HarnessSubagentBatchOptions<TRole>,
): Promise<HarnessSubagentRunResult<TRole>[]> {
  const results: HarnessSubagentRunResult<TRole>[] = [];
  const emitProgress = () => options.onProgress?.([...results], results.length, specs.length);

  if (options.mode === "parallel") {
    emitProgress();
    await Promise.all(specs.map(async (spec) => {
      const result = await runHarnessSubagentProcess({
        ...spec,
        task: options.taskResolver ? options.taskResolver(spec, []) : spec.task,
      });
      results.push(result);
      emitProgress();
    }));
    return results;
  }

  emitProgress();
  for (const spec of specs) {
    const task = options.taskResolver ? options.taskResolver(spec, results) : spec.task;
    const result = await runHarnessSubagentProcess({ ...spec, task });
    results.push(result);
    emitProgress();
  }
  return results;
}
