#!/bin/sh
set -eu

ROOT=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
command -v npm >/dev/null 2>&1 || { printf '%s\n' 'npm is required for the standalone CLI test' >&2; exit 1; }
command -v node >/dev/null 2>&1 || { printf '%s\n' 'node is required for the standalone CLI test' >&2; exit 1; }
command -v git >/dev/null 2>&1 || { printf '%s\n' 'git is required for the standalone CLI test' >&2; exit 1; }

TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/engineering-harness-cli.XXXXXX")
trap 'rm -rf "$TEST_ROOT"' EXIT HUP INT TERM
INSTALL_ROOT="$TEST_ROOT/install"
HOME_ROOT="$TEST_ROOT/home"
PROJECT_ROOT="$TEST_ROOT/project"
NODE_ONLY_BIN="$TEST_ROOT/node-bin"
mkdir -p "$INSTALL_ROOT" "$HOME_ROOT" "$PROJECT_ROOT" "$NODE_ONLY_BIN"
ln -s "$(command -v node)" "$NODE_ONLY_BIN/node"
for command in dirname sed uname git; do ln -s "$(command -v "$command")" "$NODE_ONLY_BIN/$command"; done

(
  cd "$ROOT"
  PACK_JSON=$(npm pack --dry-run --json --ignore-scripts)
  printf '%s\n' "$PACK_JSON" | grep -F 'bin/hrn.js' >/dev/null
  printf '%s\n' "$PACK_JSON" | grep -F 'extensions/workflow-guardian.ts' >/dev/null
  printf '%s\n' "$PACK_JSON" | grep -F 'lib/workflow-protocol.js' >/dev/null
  printf '%s\n' "$PACK_JSON" | grep -F 'lib/workflow-context.js' >/dev/null
  npm pack --ignore-scripts --pack-destination "$TEST_ROOT" >/dev/null
)

TARBALL=$(find "$TEST_ROOT" -maxdepth 1 -name 'jwoo0122-harness-*.tgz' -print -quit)
[ -n "$TARBALL" ]
npm install --global --prefix "$INSTALL_ROOT" --ignore-scripts --no-audit --no-fund "$TARBALL" >/dev/null
BIN="$INSTALL_ROOT/bin/hrn"
PACKAGE_INSTALL="$INSTALL_ROOT/lib/node_modules/@jwoo0122/harness"
[ -x "$BIN" ]
[ -f "$PACKAGE_INSTALL/extensions/workflow-guardian.ts" ]
[ -f "$PACKAGE_INSTALL/lib/workflow-protocol.js" ]

VERSION=$(env -i HOME="$HOME_ROOT" PATH="$NODE_ONLY_BIN" "$BIN" --version)
EXPECTED_VERSION=$(PACKAGE_JSON="$(cat "$ROOT/package.json")" node --input-type=module -e 'import process from "node:process"; process.stdout.write(JSON.parse(process.env.PACKAGE_JSON).version)')
[ "$VERSION" = "$EXPECTED_VERSION" ]
HELP=$(env -i HOME="$HOME_ROOT" PATH="$NODE_ONLY_BIN" "$BIN" --help)
printf '%s\n' "$HELP" | grep -Fx 'Harness' >/dev/null
printf '%s\n' "$HELP" | grep -F 'hrn [Pi options] [message...]' >/dev/null
PI_HELP=$(env -i HOME="$HOME_ROOT" PATH="$NODE_ONLY_BIN" "$BIN" --pi-help)
printf '%s\n' "$PI_HELP" | grep -F 'pi - AI coding assistant' >/dev/null

for invocation in '--mode rpc' '-p blocked' '--skill /tmp/skill' '--extension /tmp/extension.ts'; do
  if sh -c "env -i HOME='$HOME_ROOT' PATH='$NODE_ONLY_BIN' '$BIN' $invocation" >"$TEST_ROOT/rejected.out" 2>&1; then
    printf '%s\n' "expected Harness to reject: $invocation" >&2
    exit 1
  fi
  grep -F 'interactive TUI' "$TEST_ROOT/rejected.out" >/dev/null
done

WORKFLOW_ROOT="$TEST_ROOT/workflow-project"
mkdir -p "$WORKFLOW_ROOT/.engineering-harness/workflows/v1/manifest" "$WORKFLOW_ROOT/.engineering-harness/workflows/v2/manifest"
(
  cd "$WORKFLOW_ROOT"
  git init -q
)
cat > "$WORKFLOW_ROOT/.engineering-harness/workflows/v1/manifest/1.json" <<'EOF'
{"schemaVersion":1,"workflowId":"v1","version":1,"title":"Legacy","goal":"Read only","acceptanceCriteria":[{"id":"criterion","description":"proof"}],"workUnits":[{"id":"unit","title":"Legacy unit","dependsOn":[],"blockers":[],"acceptanceCriteria":["criterion"]}],"relationships":[]}
EOF
cat > "$WORKFLOW_ROOT/.engineering-harness/workflows/v1/state.json" <<'EOF'
{"schemaVersion":1,"workflowId":"v1","manifestVersion":1,"revision":1,"status":"in_progress","approval":{"status":"approved"},"updatedAt":"2026-07-12T00:00:00Z","workUnits":{"unit":{"status":"in_progress"}}}
EOF
cat > "$WORKFLOW_ROOT/.engineering-harness/workflows/v2/manifest/1.json" <<'EOF'
{"schemaVersion":2,"workflowId":"v2","version":1,"title":"Guarded","goal":"Runtime enforcement","acceptanceCriteria":[{"id":"criterion","description":"proof"}],"workUnits":[{"id":"unit","title":"Guarded unit","purpose":"Prove guarded work","ownedScope":["lib"],"dependsOn":[],"blockers":[],"acceptanceCriteria":["criterion"],"verification":["test"],"stopConditions":["failure"]}],"relationships":[]}
EOF
cat > "$WORKFLOW_ROOT/.engineering-harness/workflows/v2/state.json" <<'EOF'
{"schemaVersion":2,"workflowId":"v2","manifestVersion":1,"revision":1,"phase":"planning","evidence":{"refinement":{},"terms":[],"adrs":[],"sharedUnderstanding":false,"approval":false},"delegations":[],"workUnits":{"unit":{"status":"pending"}},"updatedAt":"2026-07-12T00:00:00Z"}
EOF
(
  cd "$WORKFLOW_ROOT"
  git add .
  git -c user.name='Harness Test' -c user.email='harness@example.test' commit -qm 'test: add workflow fixtures'
)
ROOT="$ROOT" WORKFLOW_ROOT="$WORKFLOW_ROOT" node --input-type=module <<'EOF'
import assert from "node:assert/strict";
import { buildWorkflowPrompt, discoverWorkflowContext } from "./lib/workflow-context.js";
const context = discoverWorkflowContext(process.env.WORKFLOW_ROOT);
assert.deepEqual(context.workflows.map((workflow) => workflow.id), ["v1", "v2"]);
assert.equal(context.workflows.find((workflow) => workflow.id === "v2").state.phase, "planning");
assert.match(buildWorkflowPrompt(context), /v2/);
EOF

ROOT="$ROOT" PACKAGE_INSTALL="$PACKAGE_INSTALL" PLAIN_WORKFLOW_ROOT="$TEST_ROOT/plain-workflow" node --input-type=module <<'EOF'
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.PACKAGE_INSTALL;
const projectRoot = process.env.PLAIN_WORKFLOW_ROOT;
const { createJiti } = await import(pathToFileURL(join(root, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "jiti", "lib", "jiti.mjs")).href);
const jiti = createJiti(import.meta.url);
const extension = await jiti.import(join(root, "extensions", "workflow-guardian.ts"));
const { buildWorkflowPrompt, discoverWorkflowContext } = await import(pathToFileURL(join(process.env.ROOT, "lib", "workflow-context.js")).href);
if (typeof extension.default !== "function") throw new Error("guardian extension did not export a factory");
const tools = new Map();
const events = new Map();
extension.default({ on: (name, handler) => events.set(name, handler), registerTool: (tool) => tools.set(tool.name, tool) });
for (const name of ["harness_git", "harness_select_workflow", "harness_begin_workflow", "harness_update_question_backlog", "harness_record_term", "harness_record_adr", "harness_propose_plan", "harness_reserve_delegation", "harness_request_approval", "harness_start_work_unit", "harness_complete_work_unit", "harness_record_verification"]) {
  if (!tools.has(name)) throw new Error(`guardian did not register ${name}`);
}
for (const name of ["tool_call", "tool_result", "user_bash"]) {
  if (!events.has(name)) throw new Error(`guardian did not register ${name}`);
}

mkdirSync(projectRoot, { recursive: true });
writeFileSync(join(projectRoot, "package.json"), '{"scripts":{"test":"node -e \\"\\""}}\n');
const statePath = join(projectRoot, ".engineering-harness", "workflows", "uncommitted", "state.json");
const state = () => JSON.parse(readFileSync(statePath, "utf8"));
const confirmations = [];
const context = {
  cwd: projectRoot,
  hasUI: true,
  ui: { confirm: async (title, message) => { confirmations.push([title, message]); return true; }, setWidget: () => {} },
};
const call = (name, params) => tools.get(name).execute("test", params, undefined, () => {}, context);
const gitRoot = join(projectRoot, "..", "git-tool");
mkdirSync(gitRoot, { recursive: true });
const gitResult = await tools.get("harness_git").execute("test", { args: ["init", "-q"] }, undefined, () => {}, { ...context, cwd: gitRoot });
assert.equal(gitResult.isError, undefined);

await call("harness_begin_workflow", { workflowId: "uncommitted", title: "Uncommitted workflow", goal: "Advance without Git" });
await call("harness_update_question_backlog", {
  workflowId: "uncommitted",
  expectedRevision: state().revision,
  questions: [{ id: "goal", question: "Who uses this?" }],
});
assert.match(buildWorkflowPrompt(discoverWorkflowContext(projectRoot)), /Who uses this\?/);
await assert.rejects(
  () => call("harness_confirm_understanding", { workflowId: "uncommitted", expectedRevision: state().revision }),
  /Process every question/,
);
await call("harness_update_question_backlog", {
  workflowId: "uncommitted",
  expectedRevision: state().revision,
  answeredQuestionId: "goal",
  answer: "Harness users",
  questions: [{ id: "scope", question: "What is in scope?" }],
});
await assert.equal(state().evidence.questionAnswers.length, 1);
await assert.rejects(
  () => call("harness_update_question_backlog", {
    workflowId: "uncommitted", expectedRevision: state().revision, answeredQuestionId: "missing", answer: "no", questions: [],
  }),
  /not in the current backlog/,
);
await call("harness_update_question_backlog", {
  workflowId: "uncommitted",
  expectedRevision: state().revision,
  answeredQuestionId: "scope",
  answer: "Adaptive refinement",
  questions: [],
});
assert.deepEqual(state().evidence.questionBacklog, []);
await call("harness_begin_workflow", { workflowId: "legacy-refinement", title: "Legacy refinement", goal: "Initialize lazily" });
const legacyStatePath = join(projectRoot, ".engineering-harness", "workflows", "legacy-refinement", "state.json");
const legacyState = JSON.parse(readFileSync(legacyStatePath, "utf8"));
legacyState.phase = "refinement";
delete legacyState.evidence.questionBacklog;
delete legacyState.evidence.questionAnswers;
writeFileSync(legacyStatePath, `${JSON.stringify(legacyState)}\n`);
await call("harness_update_question_backlog", {
  workflowId: "legacy-refinement",
  expectedRevision: legacyState.revision,
  questions: [{ id: "legacy", question: "What remains?" }],
});
assert.deepEqual(JSON.parse(readFileSync(legacyStatePath, "utf8")).evidence.questionBacklog, [{ id: "legacy", question: "What remains?" }]);
await call("harness_begin_workflow", { workflowId: "reopened-refinement", title: "Reopened refinement", goal: "Initialize after reopening" });
await call("harness_reopen_workflow", { workflowId: "reopened-refinement", expectedRevision: 0, reason: "Exercise legacy backlog initialization" });
await call("harness_update_question_backlog", {
  workflowId: "reopened-refinement",
  expectedRevision: 1,
  questions: [{ id: "reopened", question: "What changed?" }],
});
assert.deepEqual(JSON.parse(readFileSync(join(projectRoot, ".engineering-harness", "workflows", "reopened-refinement", "state.json"), "utf8")).evidence.questionBacklog, [{ id: "reopened", question: "What changed?" }]);
await call("harness_confirm_understanding", { workflowId: "uncommitted", expectedRevision: state().revision });
const manifest = {
  schemaVersion: 2,
  workflowId: "uncommitted",
  version: 2,
  title: "Uncommitted workflow",
  goal: "Advance without Git",
  acceptanceCriteria: [{ id: "criterion", description: "Proof" }],
  workUnits: [{
    id: "unit",
    title: "Unit",
    purpose: "Exercise every non-Git Guardian transition",
    ownedScope: ["fixture"],
    dependsOn: [],
    blockers: [],
    acceptanceCriteria: ["criterion"],
    verification: ["npm test"],
    stopConditions: ["test failure"],
  }],
  relationships: [],
};
await call("harness_propose_plan", { workflowId: "uncommitted", expectedRevision: state().revision, manifest: JSON.stringify(manifest) });
await assert.rejects(
  () => call("harness_start_work_unit", { workflowId: "uncommitted", workUnitId: "unit", expectedRevision: state().revision }),
  /Execution has not been approved/,
);
confirmations.length = 0;
await call("harness_request_approval", { workflowId: "uncommitted", expectedRevision: state().revision });
assert.equal(confirmations.length, 1);
assert.equal(confirmations[0][0], "Approve workflow");
assert.match(readFileSync(join(root, "resources", "AGENTS.md"), "utf8"), /call the approval tool directly/);
assert.match(readFileSync(join(root, "resources", "AGENTS.md"), "utf8"), /cannot block arbitrary natural-language output/);
assert.match(readFileSync(join(process.env.ROOT, "docs", "adr", "0001-persist-the-requirements-question-backlog-explicitly.md"), "utf8"), /cannot technically block an unregistered question/);
await call("harness_start_work_unit", { workflowId: "uncommitted", workUnitId: "unit", expectedRevision: state().revision });
await assert.rejects(
  () => call("harness_record_verification", { workflowId: "uncommitted", expectedRevision: state().revision }),
  /All work units must be completed/,
);
const reservation = await call("harness_reserve_delegation", {
  workflowId: "uncommitted",
  expectedRevision: state().revision,
  role: "reviewer",
  purpose: "Independently review the fixture",
  inputs: "fixture workflow",
  readOnlyDependencies: "workflow artifacts",
  prohibitedScope: "all writes",
  verification: "inspect state",
  stopConditions: "unexpected state",
  workUnitId: "unit",
});
assert.equal(events.get("tool_call")({ toolName: "subagent", input: { agent: "reviewer", task: reservation.details.task } }, context), undefined);
await assert.rejects(
  () => call("harness_complete_work_unit", { workflowId: "uncommitted", workUnitId: "unit", expectedRevision: state().revision, evidence: "missing review" }),
  /independent verifier or reviewer/,
);
events.get("tool_result")({ toolName: "subagent", input: { task: reservation.details.task }, isError: false }, context);
await call("harness_record_delegation_result", {
  workflowId: "uncommitted",
  delegationId: reservation.details.delegationId,
  expectedRevision: state().revision,
  evidence: "Independent review accepted.",
  accepted: true,
});
await call("harness_complete_work_unit", { workflowId: "uncommitted", workUnitId: "unit", expectedRevision: state().revision, evidence: "Independent review accepted." });
const verification = await call("harness_record_verification", { workflowId: "uncommitted", expectedRevision: state().revision });
assert.equal("projectRevision" in verification.details.receipt, false);
assert.equal(state().phase, "completed");
assert.deepEqual(discoverWorkflowContext(projectRoot).workflows.map((workflow) => workflow.id), ["legacy-refinement", "reopened-refinement", "uncommitted"]);
EOF

NODE_PATH="$ROOT" node --input-type=module <<'EOF'
import { isSupportedNodeVersion, nodeVersionDiagnostic } from "./lib/launcher.js";
if (!isSupportedNodeVersion("22.19.0") || !isSupportedNodeVersion("24.0.0") || isSupportedNodeVersion("22.18.99")) throw new Error("Node version compatibility check is incorrect");
if (!nodeVersionDiagnostic("22.18.99", "/custom/node").includes("Node.js >= 22.19.0")) throw new Error("Node version diagnostic is missing the supported range");
EOF

printf '%s\n' 'Standalone CLI acceptance test passed.'
