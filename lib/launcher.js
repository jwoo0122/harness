import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildWorkflowPrompt, discoverWorkflowContext } from "./workflow-context.js";
import { parseWorktreeOption, prepareWorkspace, workspaceEnvironment } from "./worktree-manager.js";

export const MIN_NODE_VERSION = "22.19.0";

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return undefined;
  return match.slice(1).map(Number);
}

export function isSupportedNodeVersion(version) {
  const parsed = parseVersion(version);
  const minimum = parseVersion(MIN_NODE_VERSION);
  if (!parsed || !minimum) return false;

  for (let index = 0; index < minimum.length; index += 1) {
    if (parsed[index] > minimum[index]) return true;
    if (parsed[index] < minimum[index]) return false;
  }
  return true;
}

export function nodeVersionDiagnostic(version = process.versions.node, execPath = process.execPath) {
  return [
    `warning: Harness requires Node.js >= ${MIN_NODE_VERSION}; found ${version}.`,
    `  Node executable: ${execPath}`,
    "  Upgrade Node.js, restart the terminal, then run hrn again.",
  ].join("\n");
}

function packageRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function resolveBundledDependency(specifier, label) {
  try {
    return fileURLToPath(import.meta.resolve(specifier));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Installed package could not resolve bundled ${label}: ${message}`);
  }
}

function resolveBundledRuntime() {
  const piEntry = resolveBundledDependency(
    "@earendil-works/pi-coding-agent",
    "Pi runtime",
  );
  return {
    extension: resolveBundledDependency("pi-sub-agent/extensions/index.ts", "extension"),
    // Pi does not export its CLI entry point. Its pinned package entry point
    // is dist/index.js, so the CLI is its sibling at dist/cli.js.
    piCli: join(dirname(piEntry), "cli.js"),
  };
}

function readPackageMetadata(root) {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
}

function getHarnessAgentDir(environment) {
  const home = environment.HOME || homedir();
  const configured = environment.ENGINEERING_HARNESS_AGENT_DIR;
  if (!configured) return join(home, ".engineering-harness", "agent");

  const expanded = configured === "~"
    ? home
    : configured.startsWith("~/") || configured.startsWith("~\\")
      ? join(home, configured.slice(2))
      : configured;
  const absolute = resolve(expanded);
  // Child subagents inherit the environment but can use a different cwd. Store
  // the canonical location so every process shares one Harness state tree.
  environment.ENGINEERING_HARNESS_AGENT_DIR = absolute;
  return absolute;
}

function requireRegularDirectory(path, label) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  } else {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`${label} must be a directory that is not a symlink: ${path}`);
    }
  }
  chmodSync(path, 0o700);
}

function copyDefaultAgents({ root, agentDir, force }) {
  const sourceDir = join(root, ".pi", "agents");
  const targetDir = join(agentDir, "agents");
  requireRegularDirectory(agentDir, "Harness state directory");
  requireRegularDirectory(targetDir, "Harness agent directory");

  const results = [];
  for (const name of readdirSync(sourceDir).filter((entry) => entry.endsWith(".md")).sort()) {
    const source = join(sourceDir, name);
    const target = join(targetDir, name);
    const sourceContents = readFileSync(source);
    const targetExists = existsSync(target);

    if (targetExists) {
      const stat = lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`Harness agent file must be a regular file that is not a symlink: ${target}`);
      }
      if (sourceContents.equals(readFileSync(target))) {
        results.push({ name, state: "current" });
        continue;
      }
      if (!force) {
        results.push({ name, state: "customized" });
        continue;
      }
    }

    cpSync(source, target, { force: true });
    chmodSync(target, 0o600);
    results.push({ name, state: targetExists ? "updated" : "installed" });
  }
  return results;
}

export async function configureQuietStartup(agentDir, piCli) {
  const settingsManagerPath = join(dirname(piCli), "core", "settings-manager.js");
  const { FileSettingsStorage, SettingsManager } = await import(pathToFileURL(settingsManagerPath).href);
  const storage = new FileSettingsStorage(process.cwd(), agentDir);
  storage.withLock("global", (current) => {
    let settings = {};
    if (current) {
      try {
        settings = JSON.parse(current);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Harness settings file must contain JSON: ${message}`);
      }
      if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
        throw new Error("Harness settings file must contain a JSON object");
      }
    }
    if (settings.quietStartup === true) return current;
    return `${JSON.stringify({ ...settings, quietStartup: true }, null, 2)}\n`;
  });

  // Pi merges trusted project settings over global settings. The pinned runtime
  // has no quiet-startup CLI flag, so force the resolved value for every
  // session manager while preserving --verbose as Pi's explicit UI override.
  SettingsManager.prototype.getQuietStartup = () => true;
}

function printHelp() {
  console.log(`Harness\n\nUsage:\n  hrn [--worktree true|false] [Pi options] [message...]\n\nThe command runs the bundled Pi runtime. No separate pi installation is required.\n\nHarness options:\n  --worktree   Create or reuse an isolated .hrn Git worktree (true by default)\n  --help       Show this help\n  --version    Show the Harness version\n  --pi-help    Show bundled Pi options\n  update       Show the npm update command\n\nNode.js >= ${MIN_NODE_VERSION} is required. Configure a model with /login or provider API-key environment variables.`);
}

function printUpdateInstruction(metadata) {
  console.log(`Update Harness with:\n  npm install -g --ignore-scripts ${metadata.name}\n\nThe bundled Pi runtime is updated with the Harness package; do not run pi update.`);
}

export async function runCli(args = process.argv.slice(2), environment = process.env) {
  if (!isSupportedNodeVersion(process.versions.node)) {
    console.error(nodeVersionDiagnostic());
    process.exitCode = 1;
    return;
  }

  const parsedOptions = parseWorktreeOption(args);
  const piInput = parsedOptions.args;
  const root = packageRoot();
  const metadata = readPackageMetadata(root);
  const agentDir = getHarnessAgentDir(environment);
  const paths = {
    root,
    agentDir,
    guardian: join(root, "extensions", "workflow-guardian.ts"),
    guidance: join(root, "resources", "AGENTS.md"),
  };

  if (piInput[0] === "--help" || piInput[0] === "-h" || piInput[0] === "help") {
    printHelp();
    return;
  }
  if (piInput[0] === "--version" || piInput[0] === "-v") {
    console.log(metadata.version);
    return;
  }
  if (piInput[0] === "update") {
    printUpdateInstruction(metadata);
    return;
  }

  const isSubagentChild = Number(process.env.PI_SUB_AGENT_DEPTH || "0") > 0;
  if (!isSubagentChild && piInput.some((arg) => ["-p", "--print", "--mode", "--json", "--extension", "-e", "--skill"].includes(arg)
    || arg.startsWith("--mode=") || arg.startsWith("--extension=") || arg.startsWith("--skill="))) {
    throw new Error("Harness workflows require the interactive TUI; print, JSON/RPC, custom extensions, and skills are unavailable.");
  }

  // --pi-help does not begin workflow work, so it intentionally avoids Git
  // workspace setup. Children inherit the parent's selected mode; otherwise
  // the documented default is enabled.
  const worktreeEnabled = piInput[0] === "--pi-help"
    ? false
    : environment.HARNESS_WORKTREE_ENABLED === "false" ? false : parsedOptions.worktree;
  if (worktreeEnabled) {
    const workspace = prepareWorkspace(process.cwd());
    Object.assign(environment, workspaceEnvironment(workspace));
    Object.assign(process.env, workspaceEnvironment(workspace));
    process.chdir(workspace.worktreePath);
  } else {
    Object.assign(environment, workspaceEnvironment({ enabled: false }));
    Object.assign(process.env, workspaceEnvironment({ enabled: false }));
  }

  Object.assign(paths, resolveBundledRuntime());

  for (const [label, path] of Object.entries(paths)) {
    if (label !== "root" && label !== "agentDir" && !existsSync(path)) {
      throw new Error(`Installed package is missing bundled ${label}: ${path}`);
    }
  }

  copyDefaultAgents({ root, agentDir, force: false });

  // Keep the Harness state separate from any globally installed Pi. This also
  // propagates to pi-sub-agent children, which re-execute this wrapper.
  process.env.PI_CODING_AGENT_DIR = agentDir;
  delete process.env.PI_CODING_AGENT_SESSION_DIR;
  delete process.env.PI_PACKAGE_DIR;
  await configureQuietStartup(agentDir, paths.piCli);
  const workflowPrompt = buildWorkflowPrompt(discoverWorkflowContext(process.cwd()));
  const piArgs = [
    "--no-skills",
    "--no-extensions",
    "--extension",
    paths.guardian,
    "--extension",
    paths.extension,
    "--append-system-prompt",
    paths.guidance,
    "--append-system-prompt",
    workflowPrompt,
    ...(piInput[0] === "--pi-help" ? ["--help", ...piInput.slice(1)] : piInput),
  ];
  process.argv.splice(2, process.argv.length - 2, ...piArgs);

  // pi-sub-agent intentionally re-executes process.argv[1]. Keeping this
  // wrapper as argv[1] guarantees subagents use this bundled runtime rather
  // than resolving an ambient `pi` executable from PATH.
  await import(pathToFileURL(paths.piCli).href);
}
