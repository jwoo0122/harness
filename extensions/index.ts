import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────

type Mode = "explore" | "execute" | "off";
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

// ─── Verification Registry ───────────────────────────────────────────────

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
  await writeFile(join(dir, REGISTRY_FILE), JSON.stringify(registry, null, 2) + "\n", "utf-8");
}

// ─── Mutating tools blocked in explore mode ───────────────────────────

const MUTATING_TOOLS = new Set(["write", "edit", "bash"]);

function isMutatingBashCommand(command: string): boolean {
  // Allow read-only bash: ls, cat, grep, find, rg, ag, head, tail, wc, etc.
  const readOnlyPrefixes = [
    "ls", "cat", "head", "tail", "wc", "grep", "rg", "ag", "find",
    "tree", "file", "stat", "du", "df", "echo", "printf", "date",
    "which", "where", "type", "env", "printenv", "uname",
    "cargo search", "cargo doc", "rustup", "npm search", "npm info",
    "pip show", "pip list", "pip search",
    "git log", "git show", "git diff", "git status", "git branch",
    "git tag", "git remote", "git rev-parse",
    "curl -s", "curl --silent", "curl -sf",
  ];

  const trimmed = command.trim();
  for (const prefix of readOnlyPrefixes) {
    if (trimmed.startsWith(prefix)) return false;
  }

  // Block cargo build/test/run/install, npm run/install, make, etc.
  const mutatingPrefixes = [
    "rm", "mv", "cp", "mkdir", "touch", "chmod", "chown",
    "cargo build", "cargo run", "cargo test", "cargo install", "cargo xtask",
    "npm run", "npm install", "npm ci", "yarn", "pnpm",
    "make", "cmake", "python", "node", "deno", "bun run",
    "docker", "kubectl",
  ];

  for (const prefix of mutatingPrefixes) {
    if (trimmed.startsWith(prefix)) return true;
  }

  // Pipe chains, redirects, and semicolons are suspicious
  if (/[|;>&]/.test(trimmed) && !trimmed.startsWith("grep") && !trimmed.startsWith("rg")) {
    return true;
  }

  return false;
}

// ─── Extension ────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let state: HarnessState = {
    mode: "off",
    acStatuses: [],
    regressionCount: 0,
    commitCount: 0,
  };

  // ── State persistence ─────────────────────────────────────────────

  function saveState() {
    pi.appendEntry("cognitive-harness-state", { ...state });
  }

  pi.on("session_start", async (_event, ctx) => {
    state = { mode: "off", acStatuses: [], regressionCount: 0, commitCount: 0 };
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === "cognitive-harness-state") {
        state = entry.data as HarnessState;
      }
    }
    updateUI(ctx);
  });

  // ── Mode switching commands ───────────────────────────────────────

  pi.registerCommand("explore", {
    description: "Switch to divergent thinking mode (3-persona debate)",
    handler: async (args, ctx) => {
      state.mode = "explore";
      state.debateRound = 0;
      saveState();
      updateUI(ctx);
      ctx.ui.notify("🧠 Explore mode activated — write/edit/build tools blocked", "info");

      // Send the skill content as a user message to activate the protocol
      const topic = args || "next iteration";
      pi.sendUserMessage(`/skill:explore ${topic}`, { deliverAs: "followUp" });
    },
  });

  pi.registerCommand("execute", {
    description: "Switch to agile execution mode (3-role verification)",
    handler: async (args, ctx) => {
      state.mode = "execute";
      state.currentIncrement = undefined;
      state.regressionCount = 0;
      state.commitCount = 0;
      saveState();
      updateUI(ctx);
      ctx.ui.notify("⚙️ Execute mode activated — full tool access, AC tracking enabled", "info");

      const criteria = args || "";
      pi.sendUserMessage(`/skill:execute ${criteria}`, { deliverAs: "followUp" });
    },
  });

  pi.registerCommand("harness-off", {
    description: "Disable cognitive harness (return to normal mode)",
    handler: async (_args, ctx) => {
      state.mode = "off";
      saveState();
      ctx.ui.setStatus("harness", undefined);
      ctx.ui.setWidget("harness", undefined);
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
        const passed = state.acStatuses.filter(a => a.status === "pass").length;
        const failed = state.acStatuses.filter(a => a.status === "fail").length;
        const pending = state.acStatuses.filter(a => a.status === "pending").length;
        lines.push(`ACs: ✅ ${passed} | ❌ ${failed} | ⏳ ${pending}`);
        lines.push(`Regressions: ${state.regressionCount}`);
        if (state.currentIncrement) lines.push(`Current: ${state.currentIncrement}`);
        if (state.criteriaFile) lines.push(`Criteria: ${state.criteriaFile}`);
      }

      if (state.mode === "explore" && state.debateRound !== undefined) {
        lines.push(`Debate round: ${state.debateRound}/3`);
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // ── Tool enforcement ──────────────────────────────────────────────

  pi.on("tool_call", async (event, ctx) => {
    if (state.mode !== "explore") return;

    // Block write and edit entirely in explore mode
    if (event.toolName === "write" || event.toolName === "edit") {
      return {
        block: true,
        reason: `🔴 BLOCKED: "${event.toolName}" is not allowed in explore mode. Explore mode is read-only — no code modifications. Use /execute to switch to implementation mode.`,
      };
    }

    // For bash, allow read-only commands, block mutating ones
    if (isToolCallEventType("bash", event)) {
      if (isMutatingBashCommand(event.input.command)) {
        return {
          block: true,
          reason: `🔴 BLOCKED: This bash command appears to mutate state ("${event.input.command.slice(0, 60)}..."). Explore mode only allows read-only commands (ls, grep, find, git log, cargo search, etc.). Use /execute to switch to implementation mode.`,
        };
      }
    }
  });

  // ── System prompt injection ───────────────────────────────────────

  pi.on("before_agent_start", async (event, _ctx) => {
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
Write/edit/build tools are BLOCKED. Read-only research only.
`;
    }

    if (state.mode === "execute") {
      const passed = state.acStatuses.filter(a => a.status === "pass").length;
      const total = state.acStatuses.length;

      injection = `
[COGNITIVE HARNESS: EXECUTE MODE ACTIVE]
You are operating in convergent execution mode with 3-role mutual verification.
- 📋 PLN (Planner): Decides what/order. Cannot write code or mark ACs.
- 🔨 IMP (Implementer): Writes code. Cannot mark ACs passed.
- ✅ VER (Verifier): Sole authority on AC pass/fail. Cannot write code.
Iron law: No role evaluates its own output.
AC Status: ${passed}/${total} passed. Regressions: ${state.regressionCount}. Commits: ${state.commitCount}.
${state.currentIncrement ? `Current increment: ${state.currentIncrement}` : ""}
VERIFICATION REGISTRY: VER must maintain a cumulative Verification Registry (.harness/verification-registry.json).
- After confirming an AC passes, VER MUST call harness_verify_register to record the verification method.
- Before regression checks, VER MUST call harness_verify_list and re-run every registered verification.
- A passing AC without a registered verification is a gap that PLN should challenge.
After VER confirms all gates pass and no regressions for an increment, VER MUST call the harness_commit tool to commit and push the changes before proceeding to the next increment.
`;
    }

    if (injection) {
      return {
        systemPrompt: event.systemPrompt + injection,
      };
    }
  });

  // ── UI updates ────────────────────────────────────────────────────

  function updateUI(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;

    if (state.mode === "explore") {
      ctx.ui.setStatus("harness", "🧠 EXPLORE");

      const round = state.debateRound ?? 0;
      const lines = [
        "🧠 Explore Mode — 3-Persona Debate",
        `Round: ${round}/3  |  🔴 OPT  🟡 PRA  🟢 SKP`,
        "Tools: read-only (write/edit/build blocked)",
      ];
      ctx.ui.setWidget("harness", lines);
    }

    if (state.mode === "execute") {
      const passed = state.acStatuses.filter(a => a.status === "pass").length;
      const failed = state.acStatuses.filter(a => a.status === "fail").length;
      const pending = state.acStatuses.filter(a => a.status === "pending").length;

      ctx.ui.setStatus(
        "harness",
        `⚙️ EXECUTE ✅${passed} ❌${failed} ⏳${pending} 📦${state.commitCount}`,
      );

      const lines = [
        "⚙️ Execute Mode — 3-Role Verification",
        `📋 PLN → 🔨 IMP → ✅ VER → 📦 Commit`,
        `ACs: ✅ ${passed} | ❌ ${failed} | ⏳ ${pending} | Regressions: ${state.regressionCount} | Commits: ${state.commitCount}`,
      ];
      if (state.currentIncrement) {
        lines.push(`Current: ${state.currentIncrement}`);
      }
      ctx.ui.setWidget("harness", lines);
    }

    if (state.mode === "off") {
      ctx.ui.setStatus("harness", undefined);
      ctx.ui.setWidget("harness", undefined);
    }
  }

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
          entries: entries.map(([id, e]) => ({ id, ...e })),
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
      });

      // Stage all changes
      const addResult = await pi.exec("git", ["add", "-A"], { signal, timeout: 10_000 });
      if (addResult.code !== 0) {
        throw new Error(`git add failed: ${addResult.stderr}`);
      }

      // Check if there are staged changes
      const diffResult = await pi.exec("git", ["diff", "--cached", "--quiet"], { signal, timeout: 10_000 });
      if (diffResult.code === 0) {
        return {
          content: [{ type: "text", text: `No changes to commit for ${params.increment}.` }],
          details: { increment: params.increment, skipped: true },
        };
      }

      // Commit
      const commitMsg = `${params.increment}: ${params.message}`;
      onUpdate?.({
        content: [{ type: "text", text: `Committing: ${commitMsg}` }],
      });

      const commitResult = await pi.exec("git", ["commit", "-m", commitMsg], { signal, timeout: 15_000 });
      if (commitResult.code !== 0) {
        throw new Error(`git commit failed: ${commitResult.stderr}`);
      }

      // Get commit hash
      const hashResult = await pi.exec("git", ["rev-parse", "--short", "HEAD"], { signal, timeout: 5_000 });
      const hash = hashResult.stdout.trim();

      // Push
      onUpdate?.({
        content: [{ type: "text", text: `Pushing ${hash}...` }],
      });

      const pushResult = await pi.exec("git", ["push"], { signal, timeout: 30_000 });
      const pushed = pushResult.code === 0;

      // Update state
      state.commitCount++;
      state.currentIncrement = params.increment;
      saveState();
      updateUI(ctx);

      const pushStatus = pushed
        ? "pushed to remote"
        : `push failed: ${pushResult.stderr.trim()}`;
      const icon = pushed ? "✅" : "⚠️";
      const summary = `${icon} ${params.increment} committed (${hash}) — ${pushStatus}`;

      ctx.ui.notify(summary, pushed ? "success" : "warning");

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

  /*
  pi.registerTool({
    name: "harness_ac_update",
    label: "Update AC Status",
    description: "Update acceptance criteria status. Only VER role should call this in execute mode.",
    parameters: Type.Object({
      ac_id: Type.String({ description: "AC identifier, e.g. 'AC-1.1'" }),
      status: StringEnum(["pass", "fail", "pending"] as const),
      evidence: Type.Optional(Type.String({ description: "Evidence for pass/fail" })),
      increment: Type.Optional(Type.String({ description: "Which increment, e.g. 'INC-3'" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (state.mode !== "execute") {
        throw new Error("AC tracking is only available in execute mode. Use /execute first.");
      }

      const existing = state.acStatuses.find(a => a.id === params.ac_id);
      if (existing) {
        // Regression detection
        if (existing.status === "pass" && params.status === "fail") {
          state.regressionCount++;
        }
        existing.status = params.status;
        existing.evidence = params.evidence;
        existing.verifiedAfter = params.increment;
      } else {
        state.acStatuses.push({
          id: params.ac_id,
          status: params.status,
          evidence: params.evidence,
          verifiedAfter: params.increment,
        });
      }

      saveState();
      updateUI(ctx);

      const passed = state.acStatuses.filter(a => a.status === "pass").length;
      const total = state.acStatuses.length;

      return {
        content: [{
          type: "text",
          text: `AC ${params.ac_id}: ${params.status}. Total: ${passed}/${total} passed.`,
        }],
        details: { acStatuses: state.acStatuses },
      };
    },
  });
  */

  // ── Keyboard shortcut ─────────────────────────────────────────────

  pi.registerShortcut("ctrl+shift+h", {
    description: "Toggle harness mode: off → explore → execute → off",
    handler: async (ctx) => {
      const cycle: Mode[] = ["off", "explore", "execute"];
      const idx = cycle.indexOf(state.mode);
      const next = cycle[(idx + 1) % cycle.length];
      state.mode = next;
      saveState();
      updateUI(ctx);
      ctx.ui.notify(`Harness: ${next === "off" ? "disabled" : next}`, "info");
    },
  });
}
