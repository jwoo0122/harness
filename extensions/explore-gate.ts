export type ExploreGateScope = "parent" | "child";

export interface ExploreEvidenceGateInput {
  scope: ExploreGateScope;
  searches: number;
  fetches: number;
  subagentRuns: number;
  browserResearchCalls: number;
  uniqueSourceCount: number;
  finalText?: string;
}

export interface ExploreEvidenceGateAssessment {
  scope: ExploreGateScope;
  requiresSubagents: boolean;
  minSources: number;
  usedSubagents: boolean;
  usedDiscovery: boolean;
  usedInspection: boolean;
  enoughSources: boolean;
  citedSources: boolean;
  researchReady: boolean;
  completionReady: boolean;
  missingResearch: string[];
  missingCompletion: string[];
}

function normalizeCount(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value ?? 0));
}

export function hasExternalCitation(text: string | undefined): boolean {
  return /https?:\/\//i.test(text ?? "");
}

export function evaluateExploreEvidenceGate(
  input: ExploreEvidenceGateInput,
): ExploreEvidenceGateAssessment {
  const requiresSubagents = input.scope === "parent";
  const minSources = input.scope === "parent" ? 2 : 1;
  const subagentRuns = normalizeCount(input.subagentRuns);
  const searches = normalizeCount(input.searches);
  const fetches = normalizeCount(input.fetches);
  const browserResearchCalls = normalizeCount(input.browserResearchCalls);
  const uniqueSourceCount = normalizeCount(input.uniqueSourceCount);

  const usedSubagents = !requiresSubagents || subagentRuns > 0;
  const usedDiscovery = searches > 0 || browserResearchCalls > 0;
  const usedInspection = fetches > 0;
  const enoughSources = uniqueSourceCount >= minSources;
  const citedSources = hasExternalCitation(input.finalText);

  const missingResearch: string[] = [];
  if (!usedSubagents) {
    missingResearch.push("run the isolated OPT/PRA/SKP/EMP subagent pass");
  }
  if (!usedDiscovery) {
    missingResearch.push("perform at least one external search or browser research step");
  }
  if (!usedInspection) {
    missingResearch.push("fetch at least one source URL before relying on it");
  }
  if (!enoughSources) {
    missingResearch.push(`collect at least ${minSources} unique external source URL${minSources === 1 ? "" : "s"}`);
  }

  const missingCompletion = [...missingResearch];
  if (!citedSources) {
    missingCompletion.push("cite explicit source URLs in the answer");
  }

  return {
    scope: input.scope,
    requiresSubagents,
    minSources,
    usedSubagents,
    usedDiscovery,
    usedInspection,
    enoughSources,
    citedSources,
    researchReady: missingResearch.length === 0,
    completionReady: missingCompletion.length === 0,
    missingResearch,
    missingCompletion,
  };
}
