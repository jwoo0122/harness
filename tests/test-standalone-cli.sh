#!/bin/sh
set -eu

ROOT=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
command -v npm >/dev/null 2>&1 || { printf '%s\n' 'npm is required for the standalone CLI test' >&2; exit 1; }
command -v node >/dev/null 2>&1 || { printf '%s\n' 'Node.js is required for the standalone CLI test' >&2; exit 1; }
command -v git >/dev/null 2>&1 || { printf '%s\n' 'git is required for the standalone CLI test' >&2; exit 1; }

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
# pnpm creates POSIX shell shims for package binaries. Supply only the
# utilities required by those shims so PATH still cannot resolve a global pi.
for command in dirname sed uname git; do
  ln -s "$(command -v "$command")" "$NODE_ONLY_BIN/$command"
done
printf '%s\n' 'throw new Error("global Pi state must not load")' > "$HOME_ROOT/.pi/agent/extensions/poison.ts"
printf '%s\n' '---' 'name: engineering-lead' 'description: poison global skill must not load' '---' '# Poison' > "$HOME_ROOT/.agents/skills/engineering-lead/SKILL.md"

(
  cd "$ROOT"
  PACK_JSON=$(npm pack --dry-run --json --ignore-scripts)
  printf '%s\n' "$PACK_JSON" | grep -F 'bin/engineering-harness.js' >/dev/null
  printf '%s\n' "$PACK_JSON" | grep -F 'lib/launcher.js' >/dev/null
  printf '%s\n' "$PACK_JSON" | grep -F 'lib/workflow-context.js' >/dev/null
  printf '%s\n' "$PACK_JSON" | grep -F '.agents/skills/engineering-lead/SKILL.md' >/dev/null
  printf '%s\n' "$PACK_JSON" | grep -F '.pi/agents/implementer.md' >/dev/null
  printf '%s\n' "$PACK_JSON" | grep -F 'resources/AGENTS.md' >/dev/null
  npm pack --ignore-scripts --pack-destination "$TEST_ROOT" >/dev/null
)

TARBALL=$(find "$TEST_ROOT" -maxdepth 1 -name 'jwoo0122-engineering-harness-skills-*.tgz' -print -quit)
[ -n "$TARBALL" ]
npm install --global --prefix "$INSTALL_ROOT" --ignore-scripts --no-audit --no-fund "$TARBALL" >/dev/null

BIN="$INSTALL_ROOT/bin/engineering-harness"
PACKAGE_INSTALL="$INSTALL_ROOT/lib/node_modules/@jwoo0122/engineering-harness-skills"
[ -x "$BIN" ]
[ -d "$PACKAGE_INSTALL" ]
[ ! -e "$NODE_ONLY_BIN/pi" ]

PNPM="$ROOT/node_modules/.bin/pnpm"
[ -x "$PNPM" ] || { printf '%s\n' 'pnpm test dependency is required for the standalone CLI test' >&2; exit 1; }
PNPM_PROJECT="$TEST_ROOT/pnpm-project"
PNPM_STORE="$TEST_ROOT/pnpm-store"
PNPM_HOME="$TEST_ROOT/pnpm-home"
mkdir -p "$PNPM_PROJECT" "$PNPM_HOME"
printf '%s\n' '{"name":"engineering-harness-pnpm-test","private":true}' > "$PNPM_PROJECT/package.json"
"$PNPM" --dir "$PNPM_PROJECT" add --ignore-scripts --config.node-linker=isolated --store-dir "$PNPM_STORE" "$TARBALL" >/dev/null
PNPM_BIN="$PNPM_PROJECT/node_modules/.bin/engineering-harness"
PNPM_PACKAGE="$PNPM_PROJECT/node_modules/@jwoo0122/engineering-harness-skills"
[ -x "$PNPM_BIN" ]
[ -d "$PNPM_PACKAGE" ]
PNPM_PACKAGE_REAL=$(CDPATH= cd "$PNPM_PACKAGE" && pwd -P)
[ ! -e "$PNPM_PACKAGE_REAL/node_modules/pi-sub-agent" ]
[ ! -e "$PNPM_PACKAGE_REAL/node_modules/@earendil-works/pi-coding-agent" ]
(
  cd "$PROJECT_ROOT"
  printf '%s\n' '{"id":"pnpm-commands","type":"get_commands"}' |
    env -i HOME="$PNPM_HOME" PATH="$NODE_ONLY_BIN" PI_OFFLINE=1 "$PNPM_BIN" --mode rpc --no-session --approve > "$TEST_ROOT/pnpm-rpc-output.jsonl"
)
grep -F '"command":"get_commands"' "$TEST_ROOT/pnpm-rpc-output.jsonl" >/dev/null
grep -F 'sub-agent-settings' "$TEST_ROOT/pnpm-rpc-output.jsonl" >/dev/null

VERSION=$(env -i HOME="$HOME_ROOT" PATH="$NODE_ONLY_BIN" "$BIN" --version)
EXPECTED_VERSION=$(PACKAGE_JSON="$(cat "$ROOT/package.json")" node --input-type=module -e 'import process from "node:process"; process.stdout.write(JSON.parse(process.env.PACKAGE_JSON).version)')
[ "$VERSION" = "$EXPECTED_VERSION" ]
env -i HOME="$HOME_ROOT" PATH="$NODE_ONLY_BIN" "$BIN" --help | grep -F 'No separate pi installation is required.' >/dev/null
for command in setup status resume verify; do
  if env -i HOME="$HOME_ROOT" PATH="$NODE_ONLY_BIN" "$BIN" --help | grep -F "$command" >/dev/null; then
    printf '%s\n' "Harness help must not advertise a $command command" >&2
    exit 1
  fi
done
[ ! -e "$HOME_ROOT/.engineering-harness/agent/agents/implementer.md" ]

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
for role in requirements-analyst explorer architect implementer verifier reviewer; do
  [ -f "$HOME_ROOT/.engineering-harness/agent/agents/$role.md" ]
done
[ ! -e "$HOME_ROOT/.pi/agent/agents/implementer.md" ]
if grep -F -e 'global Pi state must not load' -e 'ambient Pi state must not load' -e 'poison global skill must not load' "$TEST_ROOT/rpc-output.jsonl" >/dev/null; then
  printf '%s\n' 'standalone CLI loaded ambient Pi state' >&2
  exit 1
fi

WORKFLOW_ROOT="$TEST_ROOT/workflow-project"
mkdir -p "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-alpha/manifest" \
  "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-alpha/receipts" \
  "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-complete/manifest" \
  "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-complete/receipts" \
  "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-invalid" \
  "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-cycle/manifest"
(
  cd "$WORKFLOW_ROOT"
  git init -q
)
cat > "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-alpha/manifest/1.json" <<'EOF'
{"schemaVersion":1,"workflowId":"workflow-alpha","version":1,"title":"Alpha workflow","goal":"Prove workflow context injection","acceptanceCriteria":[{"id":"criterion-1","description":"Context is injected"}],"workUnits":[{"id":"unit-1","title":"Inject context","dependsOn":[],"blockers":[],"acceptanceCriteria":["criterion-1"]}],"relationships":[]}
EOF
cat > "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-alpha/state.json" <<'EOF'
{"schemaVersion":1,"workflowId":"workflow-alpha","manifestVersion":1,"revision":3,"status":"in_progress","approval":{"status":"approved"},"updatedAt":"2026-07-12T00:00:00Z","workUnits":{"unit-1":{"status":"in_progress"}}}
EOF
cat > "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-complete/manifest/1.json" <<'EOF'
{"schemaVersion":1,"workflowId":"workflow-complete","version":1,"title":"Completed workflow","goal":"Prove receipt validation","acceptanceCriteria":[{"id":"criterion-1","description":"Receipt exists"}],"workUnits":[{"id":"unit-1","title":"Verify receipt","dependsOn":[],"blockers":[],"acceptanceCriteria":["criterion-1"]}],"relationships":[]}
EOF
cat > "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-complete/state.json" <<'EOF'
{"schemaVersion":1,"workflowId":"workflow-complete","manifestVersion":1,"revision":1,"status":"completed","approval":{"status":"approved"},"updatedAt":"2026-07-12T00:00:00Z","workUnits":{"unit-1":{"status":"completed"}}}
EOF
cat > "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-complete/receipts/receipt-1.json" <<'EOF'
{"schemaVersion":1,"id":"receipt-1","workflowId":"workflow-complete","manifestVersion":1,"result":"passed","projectRevision":"working-tree","verifiedBy":"verifier","verifiedAt":"2026-07-12T00:00:00Z","acceptanceCriteria":[{"id":"criterion-1","result":"passed","evidence":"npm test passed"}],"commands":[{"command":"npm test","exitCode":0,"result":"passed"}],"remainingRisks":[]}
EOF
printf '%s\n' '{invalid json' > "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-invalid/state.json"
cat > "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-cycle/manifest/1.json" <<'EOF'
{"schemaVersion":1,"workflowId":"workflow-cycle","version":1,"title":"Cyclic workflow","goal":"Must be excluded","acceptanceCriteria":[{"id":"criterion-1","description":"Cycle rejected"}],"workUnits":[{"id":"unit-1","title":"First","dependsOn":["unit-2"],"blockers":[],"acceptanceCriteria":["criterion-1"]},{"id":"unit-2","title":"Second","dependsOn":["unit-1"],"blockers":[],"acceptanceCriteria":["criterion-1"]}],"relationships":[]}
EOF
cat > "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-cycle/state.json" <<'EOF'
{"schemaVersion":1,"workflowId":"workflow-cycle","manifestVersion":1,"revision":1,"status":"approved","approval":{"status":"approved"},"updatedAt":"2026-07-12T00:00:00Z","workUnits":{"unit-1":{"status":"pending"},"unit-2":{"status":"pending"}}}
EOF
(
  cd "$WORKFLOW_ROOT"
  git add .
  git -c user.name='Harness Test' -c user.email='harness@example.test' commit -qm 'test: add workflow fixtures'
)
BASE_REV=$(git -C "$WORKFLOW_ROOT" rev-parse HEAD)
cat > "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-complete/receipts/receipt-1.json" <<EOF
{"schemaVersion":1,"id":"receipt-1","workflowId":"workflow-complete","manifestVersion":1,"result":"passed","projectRevision":"$BASE_REV","verifiedBy":"verifier","verifiedAt":"2026-07-12T00:00:00Z","acceptanceCriteria":[{"id":"criterion-1","result":"passed","evidence":"npm test passed"}],"commands":[{"command":"npm test","exitCode":0,"result":"passed"}],"remainingRisks":[]}
EOF
cp -R "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-complete" "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-bad-revision"
cp -R "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-complete" "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-incomplete"
cp -R "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-complete" "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-unrecipted"
rm -rf "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-unrecipted/receipts"
cp -R "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-alpha" "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-invalid-time"
WORKFLOW_ROOT="$WORKFLOW_ROOT" node --input-type=module <<'EOF'
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.env.WORKFLOW_ROOT, ".engineering-harness", "workflows");
function updateJson(path, update) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  update(value);
  writeFileSync(path, `${JSON.stringify(value)}\n`);
}
for (const [id, receiptId, projectRevision] of [["workflow-bad-revision", "receipt-bad", "not-a-commit"], ["workflow-incomplete", "receipt-incomplete", undefined], ["workflow-unrecipted", "receipt-none", undefined]]) {
  updateJson(join(root, id, "manifest", "1.json"), (manifest) => { manifest.workflowId = id; manifest.title = id; });
  updateJson(join(root, id, "state.json"), (state) => { state.workflowId = id; });
  const receipt = join(root, id, "receipts", "receipt-1.json");
  try {
    updateJson(receipt, (value) => { value.id = receiptId; value.workflowId = id; if (projectRevision !== undefined) value.projectRevision = projectRevision; });
  } catch {}
}
updateJson(join(root, "workflow-incomplete", "state.json"), (state) => { state.workUnits["unit-1"].status = "pending"; });
updateJson(join(root, "workflow-invalid-time", "manifest", "1.json"), (manifest) => { manifest.workflowId = "workflow-invalid-time"; manifest.title = "Invalid timestamp"; });
updateJson(join(root, "workflow-invalid-time", "state.json"), (state) => { state.workflowId = "workflow-invalid-time"; state.updatedAt = "2026-02-30T00:00:00Z"; });
EOF
ln -s workflow-alpha "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-linked"
(
  cd "$WORKFLOW_ROOT"
  git add -A
  git -c user.name='Harness Test' -c user.email='harness@example.test' commit -qm 'test: add invalid workflow fixtures'
)
mkdir -p "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-local/manifest"
cat > "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-local/manifest/1.json" <<'EOF'
{"schemaVersion":1,"workflowId":"workflow-local","version":1,"title":"Uncommitted workflow","goal":"Must not be injected","acceptanceCriteria":[{"id":"criterion-1","description":"Not injected"}],"workUnits":[{"id":"unit-1","title":"Stay local","dependsOn":[],"blockers":[],"acceptanceCriteria":["criterion-1"]}],"relationships":[]}
EOF
cat > "$WORKFLOW_ROOT/.engineering-harness/workflows/workflow-local/state.json" <<'EOF'
{"schemaVersion":1,"workflowId":"workflow-local","manifestVersion":1,"revision":1,"status":"approved","approval":{"status":"approved"},"updatedAt":"2026-07-12T00:00:00Z","workUnits":{"unit-1":{"status":"pending"}}}
EOF
WORKFLOW_ROOT="$WORKFLOW_ROOT" node --input-type=module <<'EOF'
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const path = join(process.env.WORKFLOW_ROOT, ".engineering-harness", "workflows", "workflow-alpha", "state.json");
const state = JSON.parse(readFileSync(path, "utf8"));
state.revision = 999;
writeFileSync(path, `${JSON.stringify(state)}\n`);
EOF
WORKFLOW_ROOT="$WORKFLOW_ROOT" NODE_PATH="$ROOT" node --input-type=module <<'EOF'
import assert from "node:assert/strict";
import process from "node:process";
import { buildWorkflowPrompt, discoverWorkflowContext } from "./lib/workflow-context.js";

const context = discoverWorkflowContext(process.env.WORKFLOW_ROOT);
assert.equal(context.workflows.length, 2);
assert.deepEqual(context.workflows.map((workflow) => workflow.id), ["workflow-alpha", "workflow-complete"]);
assert.equal(context.workflows.find((workflow) => workflow.id === "workflow-alpha").state.revision, 3);
const prompt = buildWorkflowPrompt(context);
assert.match(prompt, /workflow-alpha/);
assert.doesNotMatch(prompt, /workflow-invalid/);
assert.doesNotMatch(prompt, /workflow-cycle/);
assert.doesNotMatch(prompt, /workflow-bad-revision/);
assert.doesNotMatch(prompt, /workflow-incomplete/);
assert.doesNotMatch(prompt, /workflow-unrecipted/);
assert.doesNotMatch(prompt, /workflow-invalid-time/);
assert.doesNotMatch(prompt, /workflow-linked/);
assert.doesNotMatch(prompt, /workflow-local/);
EOF

MOCK_SERVER="$TEST_ROOT/mock-openai.mjs"
MOCK_LOG="$TEST_ROOT/mock-openai.log"
MOCK_REQUEST_LOG="$TEST_ROOT/mock-openai.requests.jsonl"
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
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    requestCount += 1;
    appendFileSync(process.env.MOCK_LOG, `${requestCount}\n`);
    appendFileSync(process.env.MOCK_REQUEST_LOG, `${JSON.stringify({ requestCount, body: Buffer.concat(chunks).toString("utf8") })}\n`);
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
MOCK_LOG="$MOCK_LOG" MOCK_REQUEST_LOG="$MOCK_REQUEST_LOG" "$NODE_ONLY_BIN/node" "$MOCK_SERVER" > "$MOCK_PORT_FILE" &
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
  cd "$WORKFLOW_ROOT"
  env -i HOME="$HOME_ROOT" PATH="$NODE_ONLY_BIN" PI_OFFLINE=1 "$BIN" --model mock/test --api-key test --no-session -p 'run child test' > "$TEST_ROOT/subagent-output.txt"
)
grep -Fx 'parent completed' "$TEST_ROOT/subagent-output.txt" >/dev/null
[ "$(wc -l < "$MOCK_LOG" | tr -d ' ')" -eq 3 ]
grep -F 'workflow-alpha' "$MOCK_REQUEST_LOG" >/dev/null
for workflow in workflow-invalid workflow-cycle workflow-bad-revision workflow-incomplete workflow-unrecipted workflow-invalid-time workflow-linked workflow-local; do
  if grep -F "$workflow" "$MOCK_REQUEST_LOG" >/dev/null; then
    printf '%s\n' "excluded workflow artifact was injected: $workflow" >&2
    exit 1
  fi
done

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
