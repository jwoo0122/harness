import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
    `warning: engineering-harness requires Node.js >= ${MIN_NODE_VERSION}; found ${version}.`,
    `  Node executable: ${execPath}`,
    "  Upgrade Node.js, restart the terminal, then run engineering-harness again.",
  ].join("\n");
}

function packageRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
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

function inspectDefaultAgents({ root, agentDir }) {
  const sourceDir = join(root, ".pi", "agents");
  const targetDir = join(agentDir, "agents");
  return readdirSync(sourceDir)
    .filter((entry) => entry.endsWith(".md"))
    .sort()
    .map((name) => {
      const source = join(sourceDir, name);
      const target = join(targetDir, name);
      if (!existsSync(target)) return { name, state: "missing" };
      const stat = lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink()) return { name, state: "unsafe" };
      return readFileSync(source).equals(readFileSync(target))
        ? { name, state: "current" }
        : { name, state: "customized" };
    });
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

function handleSetup(args, paths) {
  const allowed = new Set(["--check", "--force"]);
  if (args.some((arg) => !allowed.has(arg))) {
    throw new Error("Usage: engineering-harness setup [--check | --force]");
  }
  if (args.includes("--check") && args.includes("--force")) {
    throw new Error("--check and --force cannot be used together");
  }

  if (args.includes("--check")) {
    const stale = inspectDefaultAgents({ root: paths.root, agentDir: paths.agentDir })
      .filter((result) => result.state !== "current");
    if (stale.length > 0) {
      console.error(`Harness defaults are not current: ${stale.map((result) => result.name).join(", ")}`);
      process.exitCode = 1;
      return;
    }
    console.log("Engineering Harness defaults are installed and current.");
    return;
  }

  const results = copyDefaultAgents({
    root: paths.root,
    agentDir: paths.agentDir,
    force: args.includes("--force"),
  });
  for (const result of results) {
    console.log(`${result.state}: ${join(paths.agentDir, "agents", result.name)}`);
  }
}

function printHelp() {
  console.log(`Engineering Harness\n\nUsage:\n  engineering-harness [Pi options] [message...]\n  engineering-harness setup [--check | --force]\n\nThe command runs the bundled Pi runtime. No separate pi installation is required.\n\nHarness options:\n  --help       Show this help\n  --version    Show the Engineering Harness version\n  --pi-help    Show bundled Pi options\n  setup        Install or verify default Harness subagent roles\n  update       Show the npm update command\n\nNode.js >= ${MIN_NODE_VERSION} is required. Configure a model with /login or provider API-key environment variables.`);
}

function printUpdateInstruction(metadata) {
  console.log(`Update Engineering Harness with:\n  npm install -g --ignore-scripts ${metadata.name}\n\nThe bundled Pi runtime is updated with the Harness package; do not run pi update.`);
}

export async function runCli(args = process.argv.slice(2), environment = process.env) {
  if (!isSupportedNodeVersion(process.versions.node)) {
    console.error(nodeVersionDiagnostic());
    process.exitCode = 1;
    return;
  }

  const root = packageRoot();
  const metadata = readPackageMetadata(root);
  const agentDir = getHarnessAgentDir(environment);
  const paths = {
    root,
    agentDir,
    extension: join(root, "node_modules", "pi-sub-agent", "extensions", "index.ts"),
    skills: join(root, ".agents", "skills"),
    guidance: join(root, "AGENTS.md"),
    piCli: join(root, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js"),
  };

  if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    printHelp();
    return;
  }
  if (args[0] === "--version" || args[0] === "-v") {
    console.log(metadata.version);
    return;
  }
  if (args[0] === "setup") {
    handleSetup(args.slice(1), paths);
    return;
  }
  if (args[0] === "update") {
    printUpdateInstruction(metadata);
    return;
  }

  for (const [label, path] of Object.entries(paths)) {
    if (label !== "root" && label !== "agentDir" && !existsSync(path)) {
      throw new Error(`Installed package is missing bundled ${label}: ${path}`);
    }
  }

  copyDefaultAgents({ root, agentDir, force: false });

  // Keep the harness state separate from any globally installed Pi. This also
  // propagates to pi-sub-agent children, which re-execute this wrapper.
  process.env.PI_CODING_AGENT_DIR = agentDir;
  delete process.env.PI_CODING_AGENT_SESSION_DIR;
  delete process.env.PI_PACKAGE_DIR;
  const piArgs = [
    "--no-skills",
    "--extension",
    paths.extension,
    "--skill",
    paths.skills,
    "--append-system-prompt",
    paths.guidance,
    ...(args[0] === "--pi-help" ? ["--help", ...args.slice(1)] : args),
  ];
  process.argv.splice(2, process.argv.length - 2, ...piArgs);

  // pi-sub-agent intentionally re-executes process.argv[1]. Keeping this
  // wrapper as argv[1] guarantees subagents use this bundled runtime rather
  // than resolving an ambient `pi` executable from PATH.
  await import(pathToFileURL(paths.piCli).href);
}
