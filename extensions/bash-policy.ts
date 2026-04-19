import type { SubagentBashPolicy } from "./subagents.js";

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

export function isAgentBrowserCommand(command: string): boolean {
  const trimmed = command.trim();
  return trimmed.startsWith("agent-browser") || trimmed.startsWith("npx agent-browser");
}

export function classifyExploreBash(command: string): { allowed: boolean; reason?: string } {
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

export function classifyExecuteBash(command: string): { allowed: boolean; reason?: string } {
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

export function classifyChildBashCommand(policy: SubagentBashPolicy, command: string): { allowed: boolean; reason?: string } {
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
