import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const ARTIFACT_ROOT = ".engineering-harness/workflows";
export const WORKFLOW_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const REFINEMENT_TOPICS = [
  "goal-and-users",
  "scope-and-non-goals",
  "domain-terms",
  "primary-scenarios",
  "boundaries-and-failures",
  "alternatives-and-tradeoffs",
  "acceptance-and-evidence",
  "rollout-and-verification",
];
export const PHASES = ["intake", "refinement", "planning", "awaiting_approval", "execution", "verification", "completed"];
export const DELEGATION_ROLES = {
  refinement: new Set(["requirements-analyst", "explorer", "architect"]),
  planning: new Set(["requirements-analyst", "explorer", "architect", "verifier"]),
  execution: new Set(["implementer", "verifier", "reviewer"]),
  verification: new Set(["verifier", "reviewer"]),
};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function idsAreUnique(items) {
  const ids = new Set();
  return items.every((item) => isRecord(item)
    && isNonEmptyString(item.id)
    && !ids.has(item.id)
    && (ids.add(item.id), true));
}

export function isV2Manifest(manifest, workflowId) {
  if (!isRecord(manifest)
    || manifest.schemaVersion !== 2
    || manifest.workflowId !== workflowId
    || !Number.isSafeInteger(manifest.version)
    || manifest.version < 1
    || !isNonEmptyString(manifest.title)
    || !isNonEmptyString(manifest.goal)
    || !Array.isArray(manifest.acceptanceCriteria)
    || !Array.isArray(manifest.workUnits)
    || !Array.isArray(manifest.relationships)
    || !idsAreUnique(manifest.acceptanceCriteria)
    || !idsAreUnique(manifest.workUnits)) return false;

  const criterionIds = new Set(manifest.acceptanceCriteria.map(({ id }) => id));
  const unitIds = new Set(manifest.workUnits.map(({ id }) => id));
  if (criterionIds.size === 0 || unitIds.size === 0) return false;

  const unitById = new Map(manifest.workUnits.map((unit) => [unit.id, unit]));
  for (const unit of manifest.workUnits) {
    if (!isNonEmptyString(unit.title)
      || !isNonEmptyString(unit.purpose)
      || !Array.isArray(unit.ownedScope)
      || unit.ownedScope.some((path) => !isNonEmptyString(path))
      || !Array.isArray(unit.dependsOn)
      || !Array.isArray(unit.blockers)
      || !Array.isArray(unit.acceptanceCriteria)
      || !Array.isArray(unit.verification)
      || !Array.isArray(unit.stopConditions)
      || unit.acceptanceCriteria.length === 0
      || unit.verification.length === 0
      || unit.stopConditions.length === 0
      || unit.dependsOn.some((id) => !unitIds.has(id) || id === unit.id)
      || unit.acceptanceCriteria.some((id) => !criterionIds.has(id))) return false;
    if (!unit.blockers.every((blocker) => isRecord(blocker)
      && isNonEmptyString(blocker.id)
      && isNonEmptyString(blocker.description)
      && isNonEmptyString(blocker.resolvesWhen))) return false;
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    const valid = unitById.get(id).dependsOn.every(visit);
    visiting.delete(id);
    if (valid) visited.add(id);
    return valid;
  };
  return [...unitIds].every(visit);
}

export function isV2State(state, manifest, workflowId) {
  if (!isRecord(state)
    || state.schemaVersion !== 2
    || state.workflowId !== workflowId
    || state.manifestVersion !== manifest.version
    || !Number.isSafeInteger(state.revision)
    || state.revision < 0
    || !PHASES.includes(state.phase)
    || !isRecord(state.evidence)
    || !isRecord(state.workUnits)
    || !Array.isArray(state.delegations)) return false;

  const expectedIds = new Set(manifest.workUnits.map(({ id }) => id));
  if (Object.keys(state.workUnits).length !== expectedIds.size
    || Object.keys(state.workUnits).some((id) => !expectedIds.has(id))) return false;
  return Object.values(state.workUnits).every((unit) => isRecord(unit)
    && ["pending", "in_progress", "completed", "blocked", "failed"].includes(unit.status));
}

export function nextRefinementTopic(state) {
  const completed = new Set(Object.keys(state.evidence.refinement ?? {}));
  return REFINEMENT_TOPICS.find((topic) => !completed.has(topic));
}

export function canEnterPlanning(state) {
  return REFINEMENT_TOPICS.every((topic) => isRecord(state.evidence.refinement?.[topic]))
    && state.evidence.sharedUnderstanding === true;
}

export function canEnterExecution(state) {
  return state.phase === "awaiting_approval" && state.evidence.approval === true;
}

export function dependenciesComplete(manifest, state, unitId) {
  const unit = manifest.workUnits.find((candidate) => candidate.id === unitId);
  return Boolean(unit) && unit.dependsOn.every((id) => state.workUnits[id]?.status === "completed")
    && unit.blockers.length === 0;
}

export function allowedRoles(phase) {
  return DELEGATION_ROLES[phase] ?? new Set();
}

export function workflowArtifactPath(cwd, workflowId) {
  if (!WORKFLOW_ID.test(workflowId)) throw new Error("Workflow id is unsafe");
  return resolve(cwd, ARTIFACT_ROOT, workflowId);
}

export function readLiveV2Workflow(cwd, workflowId) {
  const root = workflowArtifactPath(cwd, workflowId);
  const statePath = join(root, "state.json");
  if (!existsSync(statePath)) return undefined;
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    const manifestPath = join(root, "manifest", `${state.manifestVersion}.json`);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!isV2Manifest(manifest, workflowId) || !isV2State(state, manifest, workflowId)) return undefined;
    return { root, statePath, manifestPath, manifest, state };
  } catch {
    return undefined;
  }
}

export function buildWorkList(manifest, state, limit = 5) {
  const units = manifest.workUnits.map((unit) => ({ ...unit, ...state.workUnits[unit.id] }));
  const remaining = units.filter((unit) => unit.status !== "completed");
  const prioritized = units.length > limit ? remaining : units;
  const selected = prioritized.slice(0, limit);
  return { units: selected, hidden: Math.max(0, prioritized.length - selected.length) };
}
