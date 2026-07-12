import { execFileSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Type } from "typebox";
import { createLocalBashOperations, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  ARTIFACT_ROOT,
  REFINEMENT_TOPICS,
  allowedRoles,
  buildWorkList,
  canEnterExecution,
  canEnterPlanning,
  dependenciesComplete,
  isV2Manifest,
  nextRefinementTopic,
  readLiveV2Workflow,
  workflowArtifactPath,
} from "../lib/workflow-protocol.js";

const MUTATING_TOOLS = new Set(["write", "edit", "bash", "subagent"]);
const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function now() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function stateFor(cwd: string, workflowId: string) {
  const workflow = readLiveV2Workflow(cwd, workflowId);
  if (!workflow) throw new Error(`No valid v2 workflow named ${workflowId}`);
  return workflow;
}

function writeState(workflow: ReturnType<typeof stateFor>, expectedRevision: number, update: (state: any) => void) {
  const lockPath = `${workflow.statePath}.lock`;
  let lock;
  try {
    lock = openSync(lockPath, "wx", 0o600);
    const current = JSON.parse(readFileSync(workflow.statePath, "utf8"));
    if (current.revision !== expectedRevision) throw new Error(`Workflow revision changed from ${expectedRevision} to ${current.revision}; reload before retrying.`);
    const next = structuredClone(current);
    update(next);
    next.revision += 1;
    next.updatedAt = now();
    const temporary = `${workflow.statePath}.${process.pid}.${next.revision}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, workflow.statePath);
    return next;
  } finally {
    if (lock !== undefined) closeSync(lock);
    try { unlinkSync(lockPath); } catch {}
  }
}

function isCheckpointed(cwd: string, path: string) {
  try { return execFileSync("git", ["show", `HEAD:${relative(cwd, path)}`], { cwd, encoding: "utf8" }) === readFileSync(path, "utf8"); } catch { return false; }
}

function isArtifactPath(cwd: string, value: unknown) {
  if (typeof value !== "string") return false;
  const artifactRoot = resolve(cwd, ARTIFACT_ROOT);
  const path = resolve(cwd, value.replace(/^@/, ""));
  return path === artifactRoot || path.startsWith(`${artifactRoot}/`);
}

function renderWidgets(ctx: any, workflowId: string | undefined, frame: number) {
  if (!workflowId) {
    ctx.ui.setWidget("harness-workflow-phase", ["Harness stage: select or create a workflow"], { placement: "belowEditor" });
    ctx.ui.setWidget("harness-workflow-work", undefined, { placement: "aboveEditor" });
    return;
  }
  const workflow = readLiveV2Workflow(ctx.cwd, workflowId);
  if (!workflow) {
    ctx.ui.setWidget("harness-workflow-phase", ["Harness stage: workflow checkpoint is required"], { placement: "belowEditor" });
    ctx.ui.setWidget("harness-workflow-work", undefined, { placement: "aboveEditor" });
    return;
  }
  const list = buildWorkList(workflow.manifest, workflow.state, 5);
  const lines = list.units.map((unit) => {
    if (unit.status === "completed") return `\x1b[2m\x1b[9m✓ ${unit.title}\x1b[0m`;
    if (unit.status === "in_progress") return `${SPINNER[frame % SPINNER.length]} ${unit.title}`;
    if (unit.status === "blocked") return `! ${unit.title}`;
    return `○ ${unit.title}`;
  });
  if (list.hidden > 0 && lines.length < 5) lines.push(`+${list.hidden} remaining work units`);
  ctx.ui.setWidget("harness-workflow-phase", [`Harness stage: ${workflow.state.phase}`], { placement: "belowEditor" });
  ctx.ui.setWidget("harness-workflow-work", lines, { placement: "aboveEditor" });
}

function initialState(workflowId: string, manifestVersion: number, units: Array<{ id: string }>) {
  return {
    schemaVersion: 2,
    workflowId,
    manifestVersion,
    revision: 0,
    phase: "intake",
    evidence: { refinement: {}, terms: [], adrs: [], sharedUnderstanding: false, approval: false },
    delegations: [],
    workUnits: Object.fromEntries(units.map((unit) => [unit.id, { status: "pending" }])),
    updatedAt: now(),
  };
}

export default function workflowGuardian(pi: ExtensionAPI) {
  let selectedWorkflowId: string | undefined;
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const refresh = (ctx: any) => renderWidgets(ctx, selectedWorkflowId, frame);

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    refresh(ctx);
    timer = setInterval(() => {
      frame += 1;
      refresh(ctx);
    }, 120);
    timer.unref?.();
  });
  pi.on("session_shutdown", () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  });

  pi.on("user_bash", (_event, ctx) => {
    const workflow = selectedWorkflowId ? readLiveV2Workflow(ctx.cwd, selectedWorkflowId) : undefined;
    if (!workflow || workflow.state.phase !== "execution" || !Object.values(workflow.state.workUnits).some((unit: any) => unit.status === "in_progress")) {
      return { result: { output: "Blocked by Harness: shell access requires an active execution work unit.", exitCode: 1, cancelled: false, truncated: false } };
    }
    return { operations: createLocalBashOperations() };
  });

  pi.on("tool_call", (event, ctx) => {
    if (event.toolName.startsWith("harness_")) {
      if (process.env.PI_SUB_AGENT_DEPTH) return { block: true, reason: "Only the parent lead may interact with Harness guardian transitions." };
      return;
    }
    const workflow = selectedWorkflowId ? readLiveV2Workflow(ctx.cwd, selectedWorkflowId) : undefined;
    if (event.toolName === "write" && isArtifactPath(ctx.cwd, event.input.path)) {
      return { block: true, reason: "Workflow artifacts are writable only through Harness guardian transitions." };
    }
    if (event.toolName === "edit" && isArtifactPath(ctx.cwd, event.input.path)) {
      return { block: true, reason: "Workflow artifacts are writable only through Harness guardian transitions." };
    }
    if (!workflow || workflow.state.phase !== "execution") {
      if (READ_ONLY_TOOLS.has(event.toolName)) return;
      if (event.toolName === "subagent" && workflow && allowedRoles(workflow.state.phase).size > 0) {
        const task = typeof event.input.task === "string" ? event.input.task : "";
        const reservation = workflow.state.delegations.find((entry: any) => entry.status === "reserved" && entry.task === task);
        if (reservation && event.input.agent === reservation.role && isCheckpointed(ctx.cwd, workflow.statePath)) return;
      }
      if (MUTATING_TOOLS.has(event.toolName)) return { block: true, reason: "Blocked by Harness: complete the required workflow phase first." };
      return { block: true, reason: "Blocked by Harness: only read-only tools are available before execution." };
    }
    const activeUnit = Object.values(workflow.state.workUnits).some((unit: any) => unit.status === "in_progress");
    if (MUTATING_TOOLS.has(event.toolName) && !activeUnit) {
      return { block: true, reason: "Start one dependency-ready work unit before mutating files or running commands." };
    }
    if (event.toolName === "subagent") {
      const task = typeof event.input.task === "string" ? event.input.task : "";
      const reservation = workflow.state.delegations.find((entry: any) => entry.status === "reserved" && task === entry.task);
      if (!reservation || event.input.agent !== reservation.role || !isCheckpointed(ctx.cwd, workflow.statePath)) return { block: true, reason: "Create and checkpoint a matching structured Harness delegation reservation before calling subagent." };
    }
  });

  pi.on("tool_result", (event, ctx) => {
    if (event.toolName !== "subagent" || !selectedWorkflowId) return;
    const workflow = readLiveV2Workflow(ctx.cwd, selectedWorkflowId);
    const task = typeof event.input.task === "string" ? event.input.task : "";
    const reservation = workflow?.state.delegations.find((entry: any) => entry.status === "reserved" && entry.task === task);
    if (!workflow || !reservation) return;
    try {
      writeState(workflow, workflow.state.revision, (state) => {
        const entry = state.delegations.find((candidate: any) => candidate.id === reservation.id);
        entry.status = event.isError ? "failed" : "reported";
        entry.reportedAt = now();
        entry.isError = event.isError;
      });
      refresh(ctx);
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: `Harness could not record delegation evidence: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  });

  pi.registerTool({
    name: "harness_select_workflow",
    label: "Select Harness Workflow",
    description: "Select an existing committed v2 workflow before governed work begins.",
    parameters: Type.Object({ workflowId: Type.String() }),
    async execute(_id, params, _signal, _update, ctx) {
      stateFor(ctx.cwd, params.workflowId);
      selectedWorkflowId = params.workflowId;
      refresh(ctx);
      return { content: [{ type: "text", text: `Selected ${params.workflowId}.` }], details: {} };
    },
  });

  pi.registerTool({
    name: "harness_begin_workflow",
    label: "Begin Harness Workflow",
    description: "Create a v2 Harness workflow from a user requirement. This is the only way to begin a governed workflow.",
    parameters: Type.Object({ workflowId: Type.String(), title: Type.String(), goal: Type.String() }),
    async execute(_id, params, _signal, _update, ctx) {
      const root = workflowArtifactPath(ctx.cwd, params.workflowId);
      const manifestPath = join(root, "manifest", "1.json");
      try { readFileSync(manifestPath); throw new Error(`Workflow ${params.workflowId} already exists.`); } catch (error) { if (!(error as NodeJS.ErrnoException).code?.includes("ENOENT")) throw error; }
      const manifest = {
        schemaVersion: 2,
        workflowId: params.workflowId,
        version: 1,
        title: params.title,
        goal: params.goal,
        acceptanceCriteria: [{ id: "requirements-understood", description: "The user confirmed the shared understanding." }],
        workUnits: [{ id: "plan-work", title: "Create an approved plan", purpose: "Convert the clarified requirement into an executable plan.", ownedScope: [], dependsOn: [], blockers: [], acceptanceCriteria: ["requirements-understood"], verification: ["Validate the plan structurally."], stopConditions: ["Stop when a material ambiguity remains."] }],
        relationships: [],
      };
      mkdirSync(dirname(manifestPath), { recursive: true });
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
      writeFileSync(join(root, "state.json"), `${JSON.stringify(initialState(params.workflowId, 1, manifest.workUnits), null, 2)}\n`, { mode: 0o600 });
      selectedWorkflowId = params.workflowId;
      refresh(ctx);
      return { content: [{ type: "text", text: `Created ${params.workflowId}. Commit this intake checkpoint before delegating or changing phases.` }], details: { workflowId: params.workflowId } };
    },
  });

  pi.registerTool({
    name: "harness_refine_requirement",
    label: "Refine Requirement",
    description: "Record exactly one ordered requirements-refinement answer and return the next required topic.",
    parameters: Type.Object({ workflowId: Type.String(), expectedRevision: Type.Integer(), topic: Type.String(), question: Type.String(), answer: Type.String(), factOrDecision: Type.Union([Type.Literal("fact"), Type.Literal("decision")]) }),
    async execute(_id, params, _signal, _update, ctx) {
      const workflow = stateFor(ctx.cwd, params.workflowId);
      const expectedTopic = nextRefinementTopic(workflow.state);
      if (workflow.state.phase === "intake" && params.topic === REFINEMENT_TOPICS[0]) {
        writeState(workflow, params.expectedRevision, (state) => { state.phase = "refinement"; state.evidence.refinement[params.topic] = { question: params.question, answer: params.answer, kind: params.factOrDecision }; });
      } else {
        if (workflow.state.phase !== "refinement" || expectedTopic !== params.topic) throw new Error(`Expected refinement topic: ${expectedTopic ?? "shared understanding confirmation"}.`);
        writeState(workflow, params.expectedRevision, (state) => { state.evidence.refinement[params.topic] = { question: params.question, answer: params.answer, kind: params.factOrDecision }; });
      }
      selectedWorkflowId = params.workflowId;
      const updated = stateFor(ctx.cwd, params.workflowId);
      refresh(ctx);
      const next = nextRefinementTopic(updated.state);
      return { content: [{ type: "text", text: next ? `Next required topic: ${next}. Ask exactly one question with a recommended answer before recording it.` : "All required topics are recorded. Obtain explicit shared-understanding confirmation next." }], details: { nextTopic: next } };
    },
  });

  pi.registerTool({
    name: "harness_confirm_understanding",
    label: "Confirm Shared Understanding",
    description: "Record the user's explicit confirmation that requirements, terms, alternatives, criteria, and evidence are complete.",
    parameters: Type.Object({ workflowId: Type.String(), expectedRevision: Type.Integer() }),
    async execute(_id, params, _signal, _update, ctx) {
      if (!ctx.hasUI) throw new Error("Shared-understanding confirmation requires an interactive UI.");
      const workflow = stateFor(ctx.cwd, params.workflowId);
      if (nextRefinementTopic(workflow.state)) throw new Error("Complete every required refinement topic first.");
      const confirmed = await ctx.ui.confirm("Confirm shared understanding", "Requirements, terms, decisions, acceptance criteria, evidence, and rejected alternatives are complete.");
      if (!confirmed) throw new Error("The user did not confirm shared understanding.");
      writeState(workflow, params.expectedRevision, (state) => { state.evidence.sharedUnderstanding = true; state.phase = "planning"; });
      selectedWorkflowId = params.workflowId;
      refresh(ctx);
      return { content: [{ type: "text", text: "Shared understanding recorded. Create a structurally valid v2 plan before requesting approval." }], details: {} };
    },
  });

  pi.registerTool({
    name: "harness_record_term",
    label: "Record Domain Term",
    description: "Record one resolved project term in CONTEXT.md through the governed refinement workflow.",
    parameters: Type.Object({ workflowId: Type.String(), expectedRevision: Type.Integer(), term: Type.String(), definition: Type.String(), avoid: Type.Optional(Type.String()) }),
    async execute(_id, params, _signal, _update, ctx) {
      const workflow = stateFor(ctx.cwd, params.workflowId);
      if (!["refinement", "planning"].includes(workflow.state.phase)) throw new Error("Terms may be recorded only during refinement or planning.");
      const contextPath = join(ctx.cwd, "CONTEXT.md");
      const avoid = params.avoid ? `\n_Avoid_: ${params.avoid}` : "";
      const entry = `\n\n**${params.term}**:\n${params.definition}${avoid}\n`;
      const current = (() => { try { return readFileSync(contextPath, "utf8"); } catch { return "# Project Context\n"; } })();
      if (current.includes(`**${params.term}**:`)) throw new Error(`The term ${params.term} is already defined; resolve the conflict before replacing it.`);
      writeFileSync(contextPath, `${current.trimEnd()}${entry}`, { mode: 0o600 });
      writeState(workflow, params.expectedRevision, (state) => { state.evidence.terms.push({ term: params.term, definition: params.definition, recordedAt: now() }); });
      selectedWorkflowId = params.workflowId;
      refresh(ctx);
      return { content: [{ type: "text", text: `Recorded the resolved term ${params.term} in CONTEXT.md.` }], details: {} };
    },
  });

  pi.registerTool({
    name: "harness_record_adr",
    label: "Record Architectural Decision",
    description: "Record a confirmed hard-to-reverse, surprising, trade-off-bearing decision as an ADR.",
    parameters: Type.Object({ workflowId: Type.String(), expectedRevision: Type.Integer(), title: Type.String(), context: Type.String(), decision: Type.String(), consequences: Type.String() }),
    async execute(_id, params, _signal, _update, ctx) {
      if (!ctx.hasUI) throw new Error("ADR confirmation requires an interactive UI.");
      const workflow = stateFor(ctx.cwd, params.workflowId);
      if (!["refinement", "planning"].includes(workflow.state.phase)) throw new Error("ADRs may be recorded only during refinement or planning.");
      const confirmed = await ctx.ui.confirm("Record ADR", `Confirm that '${params.title}' is hard to reverse, surprising without context, and a real trade-off.`);
      if (!confirmed) throw new Error("The user did not confirm this ADR.");
      const adrDirectory = join(ctx.cwd, "docs", "adr");
      mkdirSync(adrDirectory, { recursive: true });
      const sequence = workflow.state.evidence.adrs.length + 1;
      const slug = params.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "decision";
      const filename = `${String(sequence).padStart(4, "0")}-${slug}.md`;
      writeFileSync(join(adrDirectory, filename), `# ${params.title}\n\n## Status\n\nAccepted\n\n## Context\n\n${params.context}\n\n## Decision\n\n${params.decision}\n\n## Consequences\n\n${params.consequences}\n`);
      writeState(workflow, params.expectedRevision, (state) => { state.evidence.adrs.push({ title: params.title, path: `docs/adr/${filename}`, recordedAt: now() }); });
      selectedWorkflowId = params.workflowId;
      refresh(ctx);
      return { content: [{ type: "text", text: `Recorded ADR docs/adr/${filename}.` }], details: {} };
    },
  });

  pi.registerTool({
    name: "harness_propose_plan",
    label: "Propose Harness Plan",
    description: "Validate and persist an immutable v2 manifest for a shared-understanding-confirmed workflow.",
    parameters: Type.Object({ workflowId: Type.String(), expectedRevision: Type.Integer(), manifest: Type.String() }),
    async execute(_id, params, _signal, _update, ctx) {
      const workflow = stateFor(ctx.cwd, params.workflowId);
      if (workflow.state.phase !== "planning" || !canEnterPlanning(workflow.state)) throw new Error("Complete refinement and shared-understanding confirmation first.");
      let manifest: any;
      try { manifest = JSON.parse(params.manifest); } catch { throw new Error("Plan manifest must be valid JSON."); }
      if (manifest.schemaVersion !== 2 || manifest.workflowId !== params.workflowId || manifest.version !== workflow.manifest.version + 1 || !isV2Manifest(manifest, params.workflowId)) {
        throw new Error("Plan manifest is not a valid next v2 workflow manifest.");
      }
      const nextState = structuredClone(workflow.state);
      nextState.manifestVersion = manifest.version;
      nextState.evidence.planProposed = manifest.version;
      nextState.workUnits = Object.fromEntries(manifest.workUnits.map((unit: any) => [unit.id, { status: "pending" }]));
      nextState.revision += 1;
      nextState.updatedAt = now();
      const manifestPath = join(workflow.root, "manifest", `${manifest.version}.json`);
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
      if (workflow.state.revision !== params.expectedRevision) throw new Error("Workflow revision changed; retry with the current revision.");
      writeFileSync(workflow.statePath, `${JSON.stringify(nextState, null, 2)}\n`, { mode: 0o600 });
      selectedWorkflowId = params.workflowId;
      refresh(ctx);
      return { content: [{ type: "text", text: `Recorded manifest v${manifest.version}. Request approval only after checkpointing it.` }], details: { manifestVersion: manifest.version } };
    },
  });

  pi.registerTool({
    name: "harness_reserve_delegation",
    label: "Reserve Harness Delegation",
    description: "Validate and reserve one bounded subagent assignment for the current phase.",
    parameters: Type.Object({ workflowId: Type.String(), expectedRevision: Type.Integer(), role: Type.String(), purpose: Type.String(), inputs: Type.String(), readOnlyDependencies: Type.String(), prohibitedScope: Type.String(), verification: Type.String(), stopConditions: Type.String(), workUnitId: Type.Optional(Type.String()) }),
    async execute(_id, params, _signal, _update, ctx) {
      const workflow = stateFor(ctx.cwd, params.workflowId);
      if (!allowedRoles(workflow.state.phase).has(params.role)) throw new Error(`${params.role} is not permitted during ${workflow.state.phase}.`);
      if (workflow.state.phase === "execution" && (!params.workUnitId || workflow.state.workUnits[params.workUnitId]?.status !== "in_progress")) throw new Error("Execution delegation must name the active work unit.");
      const delegationId = `delegation-${workflow.state.revision + 1}`;
      const task = `[[harness-delegation:${delegationId}]]\nRole: ${params.role}\nPurpose: ${params.purpose}\nInputs: ${params.inputs}\nRead-only dependencies: ${params.readOnlyDependencies}\nProhibited scope: ${params.prohibitedScope}\nVerification: ${params.verification}\nStop conditions: ${params.stopConditions}\nReturn status, evidence, files changed, verification performed, assumptions, remaining risks, and unresolved issues.`;
      writeState(workflow, params.expectedRevision, (state) => { state.delegations.push({ id: delegationId, role: params.role, workUnitId: params.workUnitId, task, status: "reserved", createdAt: now() }); });
      selectedWorkflowId = params.workflowId;
      refresh(ctx);
      return { content: [{ type: "text", text: `Delegation reserved. Commit the workflow checkpoint, then call subagent with this exact task:\n${task}` }], details: { delegationId, task } };
    },
  });

  pi.registerTool({
    name: "harness_record_delegation_result",
    label: "Record Delegation Result",
    description: "Parent lead records its review of a child result before it may support a workflow transition.",
    parameters: Type.Object({ workflowId: Type.String(), delegationId: Type.String(), expectedRevision: Type.Integer(), evidence: Type.String(), accepted: Type.Boolean() }),
    async execute(_id, params, _signal, _update, ctx) {
      const workflow = stateFor(ctx.cwd, params.workflowId);
      const reservation = workflow.state.delegations.find((entry: any) => entry.id === params.delegationId && entry.status === "reported");
      if (!reservation) throw new Error("No reported delegation is available for parent review.");
      writeState(workflow, params.expectedRevision, (state) => { const entry = state.delegations.find((candidate: any) => candidate.id === params.delegationId); entry.status = params.accepted ? "accepted" : "rejected"; entry.parentEvidence = params.evidence; });
      selectedWorkflowId = params.workflowId; refresh(ctx);
      return { content: [{ type: "text", text: "Parent delegation review recorded." }], details: {} };
    },
  });

  pi.registerTool({
    name: "harness_reopen_workflow",
    label: "Reopen Workflow",
    description: "Parent lead records a material risk and reopens the current workflow for refinement.",
    parameters: Type.Object({ workflowId: Type.String(), expectedRevision: Type.Integer(), reason: Type.String() }),
    async execute(_id, params, _signal, _update, ctx) {
      const workflow = stateFor(ctx.cwd, params.workflowId);
      writeState(workflow, params.expectedRevision, (state) => { state.phase = "refinement"; state.evidence.reopened = { reason: params.reason, at: now(), invalidatedManifestVersion: state.manifestVersion }; state.evidence.sharedUnderstanding = false; state.evidence.approval = false; delete state.evidence.planProposed; });
      selectedWorkflowId = params.workflowId; refresh(ctx);
      return { content: [{ type: "text", text: "Workflow reopened for requirements refinement; propose a new manifest version before execution." }], details: {} };
    },
  });

  pi.registerTool({
    name: "harness_request_approval",
    label: "Request Workflow Approval",
    description: "Request interactive approval for a structurally valid planning workflow.",
    parameters: Type.Object({ workflowId: Type.String(), expectedRevision: Type.Integer() }),
    async execute(_id, params, _signal, _update, ctx) {
      if (!ctx.hasUI) throw new Error("Approval requires an interactive UI.");
      const workflow = stateFor(ctx.cwd, params.workflowId);
      if (workflow.state.phase !== "planning" || !canEnterPlanning(workflow.state) || workflow.state.evidence.planProposed !== workflow.manifest.version || (workflow.state.evidence.reopened && workflow.manifest.version <= workflow.state.evidence.reopened.invalidatedManifestVersion)) throw new Error("A validated successor plan is required before approval.");
      const approved = await ctx.ui.confirm("Approve workflow", `Approve ${params.workflowId} manifest v${workflow.manifest.version}?`);
      if (!approved) return { content: [{ type: "text", text: "Approval declined; workflow remains in planning." }], details: {} };
      writeState(workflow, params.expectedRevision, (state) => { state.phase = "awaiting_approval"; state.evidence.approval = true; });
      selectedWorkflowId = params.workflowId;
      refresh(ctx);
      return { content: [{ type: "text", text: "Approval recorded. Commit this approval checkpoint before beginning execution." }], details: {} };
    },
  });

  pi.registerTool({
    name: "harness_start_work_unit",
    label: "Start Work Unit",
    description: "Start one dependency-ready work unit after approval.",
    parameters: Type.Object({ workflowId: Type.String(), workUnitId: Type.String(), expectedRevision: Type.Integer() }),
    async execute(_id, params, _signal, _update, ctx) {
      const workflow = stateFor(ctx.cwd, params.workflowId);
      if (!canEnterExecution(workflow.state) && workflow.state.phase !== "execution") throw new Error("Execution has not been approved.");
      if (!dependenciesComplete(workflow.manifest, workflow.state, params.workUnitId)) throw new Error("Work unit dependencies or blockers are unresolved.");
      if (Object.values(workflow.state.workUnits).some((unit: any) => unit.status === "in_progress")) throw new Error("Only one work unit may be active at a time.");
      writeState(workflow, params.expectedRevision, (state) => { state.phase = "execution"; state.workUnits[params.workUnitId].status = "in_progress"; });
      selectedWorkflowId = params.workflowId;
      refresh(ctx);
      return { content: [{ type: "text", text: `Work unit ${params.workUnitId} is active.` }], details: {} };
    },
  });

  pi.registerTool({
    name: "harness_record_verification",
    label: "Record Workflow Verification",
    description: "Run the maintained test command and record a passing receipt only from its actual result.",
    parameters: Type.Object({ workflowId: Type.String(), expectedRevision: Type.Integer() }),
    async execute(_id, params, _signal, _update, ctx) {
      const workflow = stateFor(ctx.cwd, params.workflowId);
      if (workflow.state.phase !== "verification" || !Object.values(workflow.state.workUnits).every((unit: any) => unit.status === "completed")) throw new Error("All work units must be completed before workflow verification.");
      if (!workflow.state.delegations.some((entry: any) => entry.status === "accepted" && ["verifier", "reviewer"].includes(entry.role) && !entry.isError)) throw new Error("Independent verification evidence is required.");
      if (workflow.state.revision !== params.expectedRevision) throw new Error("Workflow revision changed; reload before recording verification.");
      let testResult;
      try { testResult = execFileSync("npm", ["test"], { cwd: ctx.cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (error) { throw new Error(`npm test failed: ${error instanceof Error ? error.message : String(error)}`); }
      const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ctx.cwd, encoding: "utf8" }).trim();
      const evidence = "npm test exited 0 under Harness guardian verification.";
      const criteria = workflow.manifest.acceptanceCriteria.map((criterion: any) => ({ id: criterion.id, result: "passed", evidence }));
      const receipt = { schemaVersion: 1, id: `receipt-${Date.now()}`, workflowId: params.workflowId, manifestVersion: workflow.manifest.version, result: "passed", projectRevision: revision, verifiedBy: "harness-guardian", verifiedAt: now(), acceptanceCriteria: criteria, commands: [{ command: "npm test", exitCode: 0, result: testResult.slice(-2000) }], remainingRisks: ["Pi-internal enforcement does not prevent deliberate changes outside hrn."] };
      const receiptPath = join(workflow.root, "receipts", `${receipt.id}.json`);
      mkdirSync(dirname(receiptPath), { recursive: true });
      writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
      writeState(workflow, params.expectedRevision, (state) => { state.phase = "completed"; state.evidence.verification = { receipt: relative(ctx.cwd, receiptPath), recordedAt: now() }; });
      selectedWorkflowId = params.workflowId;
      refresh(ctx);
      return { content: [{ type: "text", text: `Recorded passing receipt ${relative(ctx.cwd, receiptPath)}. Commit it to complete the workflow.` }], details: { receipt } };
    },
  });

  pi.registerTool({
    name: "harness_complete_work_unit",
    label: "Complete Work Unit",
    description: "Complete an active work unit only after an independent verifier or reviewer recorded evidence.",
    parameters: Type.Object({ workflowId: Type.String(), workUnitId: Type.String(), expectedRevision: Type.Integer(), evidence: Type.String() }),
    async execute(_id, params, _signal, _update, ctx) {
      const workflow = stateFor(ctx.cwd, params.workflowId);
      if (workflow.state.phase !== "execution" || workflow.state.workUnits[params.workUnitId]?.status !== "in_progress") throw new Error("Only the active execution work unit may be completed.");
      const independentEvidence = workflow.state.delegations.some((entry: any) => entry.status === "accepted" && entry.workUnitId === params.workUnitId && ["verifier", "reviewer"].includes(entry.role) && !entry.isError);
      if (!independentEvidence) throw new Error("An independent verifier or reviewer delegation must report before completion.");
      writeState(workflow, params.expectedRevision, (state) => {
        state.workUnits[params.workUnitId] = { status: "completed", evidence: params.evidence, completedAt: now() };
        if (Object.values(state.workUnits).every((unit: any) => unit.status === "completed")) state.phase = "verification";
      });
      selectedWorkflowId = params.workflowId;
      refresh(ctx);
      return { content: [{ type: "text", text: "Work unit completion and evidence recorded." }], details: {} };
    },
  });
}
