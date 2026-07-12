#!/bin/sh
set -eu

ROOT=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
command -v npm >/dev/null 2>&1 || { printf '%s\n' 'npm is required for the standalone CLI test' >&2; exit 1; }
command -v node >/dev/null 2>&1 || { printf '%s\n' 'Node.js is required for the standalone CLI test' >&2; exit 1; }

TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/engineering-harness-cli.XXXXXX")
TEST_ROOT=$(CDPATH= cd "$TEST_ROOT" && pwd -P)
SERVER_PID=
cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT HUP INT TERM

INSTALL_ROOT="$TEST_ROOT/install"
HOME_ROOT="$TEST_ROOT/home"
PROJECT_ROOT="$TEST_ROOT/project"
NODE_ONLY_BIN="$TEST_ROOT/node-bin"
mkdir -p "$INSTALL_ROOT" "$HOME_ROOT/.pi/agent/extensions" "$HOME_ROOT/.agents/skills/engineering-lead" "$PROJECT_ROOT" "$NODE_ONLY_BIN"
ln -s "$(command -v node)" "$NODE_ONLY_BIN/node"
printf '%s\n' 'throw new Error("global Pi state must not load")' > "$HOME_ROOT/.pi/agent/extensions/poison.ts"
printf '%s\n' '---' 'name: engineering-lead' 'description: poison global skill must not load' '---' '# Poison' > "$HOME_ROOT/.agents/skills/engineering-lead/SKILL.md"

(
  cd "$ROOT"
  PACK_JSON=$(npm pack --dry-run --json --ignore-scripts)
  printf '%s\n' "$PACK_JSON" | grep -F 'bin/engineering-harness.js' >/dev/null
  printf '%s\n' "$PACK_JSON" | grep -F 'lib/launcher.js' >/dev/null
  printf '%s\n' "$PACK_JSON" | grep -F '.agents/skills/engineering-lead/SKILL.md' >/dev/null
  printf '%s\n' "$PACK_JSON" | grep -F '.pi/agents/implementer.md' >/dev/null
  printf '%s\n' "$PACK_JSON" | grep -F 'resources/AGENTS.md' >/dev/null
  npm pack --ignore-scripts --pack-destination "$TEST_ROOT" >/dev/null
)

TARBALL=$(find "$TEST_ROOT" -maxdepth 1 -name 'engineering-harness-skills-*.tgz' -print -quit)
[ -n "$TARBALL" ]
npm install --global --prefix "$INSTALL_ROOT" --ignore-scripts --no-audit --no-fund "$TARBALL" >/dev/null

BIN="$INSTALL_ROOT/bin/engineering-harness"
PACKAGE_INSTALL="$INSTALL_ROOT/lib/node_modules/engineering-harness-skills"
[ -x "$BIN" ]
[ -d "$PACKAGE_INSTALL" ]
[ ! -e "$NODE_ONLY_BIN/pi" ]

VERSION=$(env -i HOME="$HOME_ROOT" PATH="$NODE_ONLY_BIN" "$BIN" --version)
EXPECTED_VERSION=$(PACKAGE_JSON="$(cat "$ROOT/package.json")" node --input-type=module -e 'import process from "node:process"; process.stdout.write(JSON.parse(process.env.PACKAGE_JSON).version)')
[ "$VERSION" = "$EXPECTED_VERSION" ]
env -i HOME="$HOME_ROOT" PATH="$NODE_ONLY_BIN" "$BIN" --help | grep -F 'No separate pi installation is required.' >/dev/null
if env -i HOME="$HOME_ROOT" PATH="$NODE_ONLY_BIN" "$BIN" setup --check >/dev/null 2>&1; then
  printf '%s\n' 'setup --check must fail without changing missing defaults' >&2
  exit 1
fi
[ ! -e "$HOME_ROOT/.engineering-harness/agent/agents/implementer.md" ]
env -i HOME="$HOME_ROOT" PATH="$NODE_ONLY_BIN" "$BIN" setup >/dev/null
env -i HOME="$HOME_ROOT" PATH="$NODE_ONLY_BIN" "$BIN" setup --check | grep -F 'current' >/dev/null

for role in requirements-analyst explorer architect implementer verifier reviewer; do
  [ -f "$HOME_ROOT/.engineering-harness/agent/agents/$role.md" ]
done
[ ! -e "$HOME_ROOT/.pi/agent/agents/implementer.md" ]

AMBIENT_PI_HOME="$TEST_ROOT/ambient-pi"
AMBIENT_SESSION_DIR="$TEST_ROOT/ambient-sessions"
AMBIENT_PACKAGE_DIR="$TEST_ROOT/ambient-package"
mkdir -p "$AMBIENT_PI_HOME/extensions" "$AMBIENT_PACKAGE_DIR"
printf '%s\n' 'throw new Error("ambient Pi state must not load")' > "$AMBIENT_PI_HOME/extensions/poison.ts"
(
  cd "$PROJECT_ROOT"
  printf '%s\n' '{"id":"commands","type":"get_commands"}' |
    env -i HOME="$HOME_ROOT" PATH="$NODE_ONLY_BIN" PI_OFFLINE=1 PI_CODING_AGENT_DIR="$AMBIENT_PI_HOME" PI_CODING_AGENT_SESSION_DIR="$AMBIENT_SESSION_DIR" PI_PACKAGE_DIR="$AMBIENT_PACKAGE_DIR" "$BIN" --mode rpc --no-session --approve > "$TEST_ROOT/rpc-output.jsonl"
)
[ ! -e "$AMBIENT_SESSION_DIR" ]

grep -F '"command":"get_commands"' "$TEST_ROOT/rpc-output.jsonl" >/dev/null
grep -F 'skill:engineering-lead' "$TEST_ROOT/rpc-output.jsonl" >/dev/null
grep -F "$PACKAGE_INSTALL/.agents/skills/engineering-lead/SKILL.md" "$TEST_ROOT/rpc-output.jsonl" >/dev/null
grep -F 'skill:grill-with-docs' "$TEST_ROOT/rpc-output.jsonl" >/dev/null
grep -F 'sub-agent-settings' "$TEST_ROOT/rpc-output.jsonl" >/dev/null
if grep -F -e 'global Pi state must not load' -e 'ambient Pi state must not load' -e 'poison global skill must not load' "$TEST_ROOT/rpc-output.jsonl" >/dev/null; then
  printf '%s\n' 'standalone CLI loaded ambient Pi state' >&2
  exit 1
fi

MOCK_SERVER="$TEST_ROOT/mock-openai.mjs"
MOCK_LOG="$TEST_ROOT/mock-openai.log"
MOCK_PORT_FILE="$TEST_ROOT/mock-openai.port"
cat > "$MOCK_SERVER" <<'EOF'
import { appendFileSync } from "node:fs";
import http from "node:http";

let requestCount = 0;
function send(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    res.writeHead(404).end();
    return;
  }
  req.resume();
  req.on("end", () => {
    requestCount += 1;
    appendFileSync(process.env.MOCK_LOG, `${requestCount}\n`);
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (requestCount === 1) {
      send(res, {
        id: "parent-tool",
        object: "chat.completion.chunk",
        choices: [{
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [{
              index: 0,
              id: "call_probe",
              type: "function",
              function: {
                name: "subagent",
                arguments: '{"agent":"explorer","task":"Return exactly child completed."}',
              },
            }],
          },
          finish_reason: null,
        }],
      });
      send(res, {
        id: "parent-tool",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      });
    } else {
      const content = requestCount === 2 ? "child completed" : "parent completed";
      send(res, {
        id: `response-${requestCount}`,
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
      });
      send(res, {
        id: `response-${requestCount}`,
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      });
    }
    res.end("data: [DONE]\n\n");
  });
});

server.listen(0, "127.0.0.1", () => console.log(server.address().port));
EOF
MOCK_LOG="$MOCK_LOG" "$NODE_ONLY_BIN/node" "$MOCK_SERVER" > "$MOCK_PORT_FILE" &
SERVER_PID=$!
ATTEMPTS=0
while [ ! -s "$MOCK_PORT_FILE" ] && [ "$ATTEMPTS" -lt 50 ]; do
  ATTEMPTS=$((ATTEMPTS + 1))
  sleep 1
done
[ -s "$MOCK_PORT_FILE" ] || { printf '%s\n' 'mock OpenAI server did not start' >&2; exit 1; }
MOCK_PORT=$(cat "$MOCK_PORT_FILE")
cat > "$HOME_ROOT/.engineering-harness/agent/models.json" <<EOF
{"providers":{"mock":{"baseUrl":"http://127.0.0.1:$MOCK_PORT/v1","api":"openai-completions","apiKey":"test","compat":{"supportsDeveloperRole":false,"supportsReasoningEffort":false},"models":[{"id":"test","reasoning":false,"input":["text"],"contextWindow":32768,"maxTokens":2048,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}]}}}
EOF
(
  cd "$PROJECT_ROOT"
  env -i HOME="$HOME_ROOT" PATH="$NODE_ONLY_BIN" PI_OFFLINE=1 "$BIN" --model mock/test --api-key test --no-session -p 'run child test' > "$TEST_ROOT/subagent-output.txt"
)
grep -Fx 'parent completed' "$TEST_ROOT/subagent-output.txt" >/dev/null
[ "$(wc -l < "$MOCK_LOG" | tr -d ' ')" -eq 3 ]

NODE_PATH="$ROOT" node --input-type=module <<'EOF'
import { isSupportedNodeVersion, nodeVersionDiagnostic } from "./lib/launcher.js";
if (!isSupportedNodeVersion("22.19.0") || !isSupportedNodeVersion("24.0.0") || isSupportedNodeVersion("22.18.99")) {
  throw new Error("Node version compatibility check is incorrect");
}
if (!nodeVersionDiagnostic("22.18.99", "/custom/node").includes("Node.js >= 22.19.0")) {
  throw new Error("Node version diagnostic is missing the supported range");
}
EOF

printf '%s\n' 'Standalone CLI acceptance test passed.'
