import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@mariozechner/pi-coding-agent";
import { Container, Text } from "@mariozechner/pi-tui";
import { homedir } from "node:os";

const MAX_INLINE_PREVIEW_CHARS = 96;
const MAX_ERROR_PREVIEW_CHARS = 140;

function createBuiltInTools(cwd: string) {
  return {
    bash: createBashTool(cwd),
    edit: createEditTool(cwd),
    find: createFindTool(cwd),
    grep: createGrepTool(cwd),
    ls: createLsTool(cwd),
    read: createReadTool(cwd),
    write: createWriteTool(cwd),
  };
}

const toolCache = new Map<string, ReturnType<typeof createBuiltInTools>>();
const rendererTools = createBuiltInTools(process.cwd());

function getBuiltInTools(cwd: string) {
  let tools = toolCache.get(cwd);
  if (!tools) {
    tools = createBuiltInTools(cwd);
    toolCache.set(cwd, tools);
  }
  return tools;
}

function shortenPath(path: string | undefined): string {
  const value = path?.trim() ?? "";
  if (!value) return "...";

  const home = homedir();
  if (value.startsWith(home)) return `~${value.slice(home.length)}`;
  return value;
}

function compactInline(text: string | undefined, maxChars = MAX_INLINE_PREVIEW_CHARS): string {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}…`;
}

function statusPrefix(theme: any, context: any): string {
  if (context?.isError) return theme.fg("error", "✕");
  if (!context?.executionStarted || context?.isPartial) return theme.fg("warning", "…");
  return theme.fg("success", "✓");
}

function renderEmpty(): Container {
  return new Container();
}

function renderLines(theme: any, token: string, text: string | undefined): Text | Container {
  if (!text) return renderEmpty();
  const lines = text
    .split("\n")
    .map((line) => theme.fg(token, line))
    .join("\n");
  return new Text(lines, 0, 0);
}

function renderExpandedResult(originalTool: any, result: any, options: any, theme: any, context: any): Text | Container {
  try {
    const rendered = originalTool.renderResult?.(result, options, theme, context);
    if (rendered) return rendered;
  } catch {
    // Fall back to plain text rendering below.
  }

  return renderLines(theme, context?.isError ? "error" : "toolOutput", extractText(result));
}

function extractText(result: any): string {
  return (result?.content ?? [])
    .filter((item: any) => item?.type === "text" && typeof item.text === "string")
    .map((item: any) => item.text)
    .join("\n")
    .trim();
}

function renderCompactResult(originalTool: any, result: any, options: any, theme: any, context: any): Text | Container {
  if (options.expanded) return renderExpandedResult(originalTool, result, options, theme, context);
  if (!context?.isError) return renderEmpty();

  const errorText = compactInline(extractText(result), MAX_ERROR_PREVIEW_CHARS) || "Tool failed.";
  return renderLines(theme, "error", errorText);
}

function renderCompactCallStart(theme: any, context: any, label: string): string {
  return `${statusPrefix(theme, context)} ${theme.fg("toolTitle", theme.bold(label))}`;
}

export function registerCompactBuiltinToolRenderers(pi: ExtensionAPI) {
  const readTool = rendererTools.read;
  pi.registerTool({
    ...readTool,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).read.execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme, context) {
      const path = shortenPath(args.path);
      const start = args.offset ?? 1;
      const end = args.limit !== undefined ? start + args.limit - 1 : undefined;
      const range = args.offset !== undefined || args.limit !== undefined
        ? theme.fg("warning", `:${start}${end ? `-${end}` : ""}`)
        : "";
      return new Text(`${renderCompactCallStart(theme, context, "read")} ${theme.fg("accent", path)}${range}`, 0, 0);
    },
    renderResult(result, options, theme, context) {
      return renderCompactResult(readTool, result, options, theme, context);
    },
  });

  const bashTool = rendererTools.bash;
  pi.registerTool({
    ...bashTool,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).bash.execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme, context) {
      const command = compactInline(args.command);
      const timeout = typeof args.timeout === "number" ? theme.fg("muted", ` · ${args.timeout}s`) : "";
      return new Text(`${statusPrefix(theme, context)} ${theme.fg("toolTitle", theme.bold("$"))} ${theme.fg("accent", command || "...")}${timeout}`, 0, 0);
    },
    renderResult(result, options, theme, context) {
      return renderCompactResult(bashTool, result, options, theme, context);
    },
  });

  const editTool = rendererTools.edit;
  pi.registerTool({
    ...editTool,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).edit.execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme, context) {
      const path = shortenPath(args.path);
      const editCount = Array.isArray(args.edits)
        ? args.edits.length
        : (typeof args.oldText === "string" && typeof args.newText === "string" ? 1 : 0);
      const meta = editCount > 0 ? theme.fg("muted", ` · ${editCount} change${editCount === 1 ? "" : "s"}`) : "";
      return new Text(`${renderCompactCallStart(theme, context, "edit")} ${theme.fg("accent", path)}${meta}`, 0, 0);
    },
    renderResult(result, options, theme, context) {
      return renderCompactResult(editTool, result, options, theme, context);
    },
  });

  const writeTool = rendererTools.write;
  pi.registerTool({
    ...writeTool,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).write.execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme, context) {
      const path = shortenPath(args.path);
      const lineCount = typeof args.content === "string" && args.content.length > 0
        ? args.content.split("\n").length
        : 0;
      const meta = lineCount > 0 ? theme.fg("muted", ` · ${lineCount} lines`) : "";
      return new Text(`${renderCompactCallStart(theme, context, "write")} ${theme.fg("accent", path)}${meta}`, 0, 0);
    },
    renderResult(result, options, theme, context) {
      return renderCompactResult(writeTool, result, options, theme, context);
    },
  });

  const grepTool = rendererTools.grep;
  pi.registerTool({
    ...grepTool,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).grep.execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme, context) {
      const pattern = compactInline(args.pattern, 48) || "...";
      const path = shortenPath(args.path || ".");
      const suffix: string[] = [theme.fg("muted", ` · ${path}`)];
      if (args.glob) suffix.push(theme.fg("muted", ` · ${compactInline(args.glob, 24)}`));
      return new Text(`${renderCompactCallStart(theme, context, "grep")} ${theme.fg("accent", `/${pattern}/`)}${suffix.join("")}`, 0, 0);
    },
    renderResult(result, options, theme, context) {
      return renderCompactResult(grepTool, result, options, theme, context);
    },
  });

  const findTool = rendererTools.find;
  pi.registerTool({
    ...findTool,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).find.execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme, context) {
      const pattern = compactInline(args.pattern, 48) || "...";
      const path = shortenPath(args.path || ".");
      return new Text(`${renderCompactCallStart(theme, context, "find")} ${theme.fg("accent", pattern)}${theme.fg("muted", ` · ${path}`)}`, 0, 0);
    },
    renderResult(result, options, theme, context) {
      return renderCompactResult(findTool, result, options, theme, context);
    },
  });

  const lsTool = rendererTools.ls;
  pi.registerTool({
    ...lsTool,
    renderShell: "self",
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getBuiltInTools(ctx.cwd).ls.execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme, context) {
      const path = shortenPath(args.path || ".");
      const limit = typeof args.limit === "number" ? theme.fg("muted", ` · limit ${args.limit}`) : "";
      return new Text(`${renderCompactCallStart(theme, context, "ls")} ${theme.fg("accent", path)}${limit}`, 0, 0);
    },
    renderResult(result, options, theme, context) {
      return renderCompactResult(lsTool, result, options, theme, context);
    },
  });
}
