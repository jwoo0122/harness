import { relative, resolve, sep } from "node:path";
import type {
  ManagedSessionBinding,
  ManagedWorkspaceLifecycleState,
  ManagedWorktreeLease,
} from "./managed-worktrees.js";

export type ManagedWorktreePresentationState = "unmanaged" | "healthy" | "degraded";
export type ManagedWorktreePresentationSeverity = "info" | "warning" | "error";
export type ManagedWorktreePresentationReason =
  | "unmanaged"
  | "healthy"
  | "blocked"
  | "worktree-path-missing"
  | "lease-missing"
  | "lease-binding-mismatch"
  | "provisioning"
  | "managed-released"
  | "managed-missing"
  | "manual-cleanup-required"
  | "outside-target-cwd"
  | "outside-worktree";
export type ManagedWorktreePresentationLifecycleState = ManagedWorkspaceLifecycleState | "binding-only";
export type ManagedWorktreeLocationKind = "root" | "entry" | "nested" | "outside-target-cwd" | "outside-worktree";

export interface ManagedWorktreePresentationInput {
  binding?: ManagedSessionBinding;
  lease?: ManagedWorktreeLease;
  cwd: string;
  worktreePathExists?: boolean;
}

export interface ManagedWorktreeLocation {
  kind: ManagedWorktreeLocationKind;
  label: string;
  entryLabel: string;
  relativeToWorktreeRoot?: string;
  relativeToTargetCwd?: string;
}

export interface ManagedWorktreePresentationModel {
  state: ManagedWorktreePresentationState;
  severity: ManagedWorktreePresentationSeverity;
  reason: ManagedWorktreePresentationReason;
  lifecycleState: ManagedWorktreePresentationLifecycleState;
  identity?: string;
  location?: ManagedWorktreeLocation;
  detail?: string;
  writesBlocked: boolean;
}

function normalizePath(value: string): string {
  return resolve(value);
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const parent = normalizePath(parentPath);
  const child = normalizePath(childPath);
  if (parent === child) return true;
  return child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}

function toDisplayRelativePath(basePath: string, targetPath: string): string | undefined {
  const base = normalizePath(basePath);
  const target = normalizePath(targetPath);
  if (!isPathInside(base, target)) return undefined;

  const rel = relative(base, target);
  if (!rel) return ".";
  return rel.split(sep).join("/");
}

function getEntryLabel(binding: ManagedSessionBinding): string {
  const entryRelative = toDisplayRelativePath(binding.worktreePath, binding.targetCwd);
  if (!entryRelative || entryRelative === ".") return "root";
  return entryRelative;
}

function deriveManagedWorktreeLocation(binding: ManagedSessionBinding, cwd: string): ManagedWorktreeLocation {
  const normalizedCwd = normalizePath(cwd);
  const normalizedWorktreePath = normalizePath(binding.worktreePath);
  const normalizedTargetCwd = normalizePath(binding.targetCwd);
  const relativeToWorktreeRoot = toDisplayRelativePath(normalizedWorktreePath, normalizedCwd);
  const relativeToTargetCwd = toDisplayRelativePath(normalizedTargetCwd, normalizedCwd);
  const entryLabel = getEntryLabel(binding);

  if (normalizedCwd === normalizedWorktreePath && normalizedTargetCwd === normalizedWorktreePath) {
    return {
      kind: "root",
      label: "root",
      entryLabel,
      relativeToWorktreeRoot: ".",
      relativeToTargetCwd: ".",
    };
  }

  if (normalizedCwd === normalizedTargetCwd) {
    return {
      kind: "entry",
      label: entryLabel === "root" ? "root" : `entry ${entryLabel}`,
      entryLabel,
      relativeToWorktreeRoot: relativeToWorktreeRoot ?? ".",
      relativeToTargetCwd: ".",
    };
  }

  if (isPathInside(normalizedTargetCwd, normalizedCwd)) {
    return {
      kind: "nested",
      label: relativeToWorktreeRoot ?? entryLabel,
      entryLabel,
      relativeToWorktreeRoot: relativeToWorktreeRoot ?? ".",
      relativeToTargetCwd: relativeToTargetCwd ?? ".",
    };
  }

  if (relativeToWorktreeRoot) {
    return {
      kind: "outside-target-cwd",
      label: relativeToWorktreeRoot === "." ? "root" : relativeToWorktreeRoot,
      entryLabel,
      relativeToWorktreeRoot,
    };
  }

  return {
    kind: "outside-worktree",
    label: "outside workspace",
    entryLabel,
  };
}

function createDegradedModel(
  base: {
    lifecycleState: ManagedWorktreePresentationLifecycleState;
    identity: string;
    location: ManagedWorktreeLocation;
  },
  reason: Exclude<ManagedWorktreePresentationReason, "unmanaged" | "healthy">,
  severity: ManagedWorktreePresentationSeverity,
  detail: string,
): ManagedWorktreePresentationModel {
  return {
    state: "degraded",
    severity,
    reason,
    lifecycleState: base.lifecycleState,
    identity: base.identity,
    location: base.location,
    detail,
    writesBlocked: true,
  };
}

function buildOutsideTargetDetail(location: ManagedWorktreeLocation): string {
  if (location.kind === "outside-worktree") {
    return location.entryLabel === "root"
      ? "Writes blocked until you return to the managed workspace."
      : `Writes blocked until you return to entry ${location.entryLabel}.`;
  }

  return location.entryLabel === "root"
    ? "Writes blocked outside the managed root."
    : `Writes blocked outside entry ${location.entryLabel}.`;
}

export function deriveManagedWorktreePresentation(
  input: ManagedWorktreePresentationInput,
): ManagedWorktreePresentationModel {
  if (!input.binding) {
    return {
      state: "unmanaged",
      severity: "info",
      reason: "unmanaged",
      lifecycleState: "unmanaged",
      writesBlocked: false,
    };
  }

  const location = deriveManagedWorktreeLocation(input.binding, input.cwd);
  const lifecycleState = input.lease?.lifecycleState ?? "binding-only";
  const base = {
    lifecycleState,
    identity: input.binding.worktreeId,
    location,
  };

  if (input.worktreePathExists === false) {
    return createDegradedModel(
      base,
      "worktree-path-missing",
      "error",
      `Writes blocked: missing ${normalizePath(input.binding.worktreePath)}.`,
    );
  }

  if (!input.lease) {
    return createDegradedModel(
      base,
      "lease-missing",
      "warning",
      "Writes blocked: managed lease metadata is missing.",
    );
  }

  if (input.lease.worktreeId !== input.binding.worktreeId) {
    return createDegradedModel(
      base,
      "lease-binding-mismatch",
      "error",
      `Writes blocked: lease ${input.lease.worktreeId} does not match binding ${input.binding.worktreeId}.`,
    );
  }

  switch (lifecycleState) {
    case "provisioning":
      return createDegradedModel(
        base,
        "provisioning",
        "warning",
        "Writes blocked until the workspace is ready.",
      );
    case "managed-released":
      return createDegradedModel(
        base,
        "managed-released",
        "warning",
        "Writes blocked until a new managed session is prepared.",
      );
    case "managed-missing":
      return createDegradedModel(
        base,
        "managed-missing",
        "error",
        "Writes blocked: managed worktree state is missing from disk.",
      );
    case "manual-cleanup-required":
      return createDegradedModel(
        base,
        "manual-cleanup-required",
        "warning",
        "Writes blocked until manual cleanup is resolved.",
      );
    case "managed-active":
      break;
    default:
      return createDegradedModel(
        base,
        "blocked",
        "warning",
        `Writes blocked: managed lifecycle state is ${lifecycleState}.`,
      );
  }

  if (location.kind === "outside-target-cwd" || location.kind === "outside-worktree") {
    return createDegradedModel(base, location.kind, "warning", buildOutsideTargetDetail(location));
  }

  return {
    state: "healthy",
    severity: "info",
    reason: "healthy",
    lifecycleState,
    identity: input.binding.worktreeId,
    location,
    writesBlocked: false,
  };
}

function renderManagedWorktreeHeadline(model: ManagedWorktreePresentationModel): string {
  if (model.state === "healthy") {
    return model.location?.label ?? "root";
  }

  switch (model.reason) {
    case "worktree-path-missing":
    case "managed-missing":
      return "path missing";
    case "lease-missing":
      return "lease missing";
    case "lease-binding-mismatch":
      return "binding mismatch";
    case "provisioning":
      return "provisioning";
    case "managed-released":
      return "released";
    case "manual-cleanup-required":
      return "cleanup required";
    case "outside-target-cwd":
    case "outside-worktree":
      return model.location?.label ?? "blocked";
    default:
      return "blocked";
  }
}

function renderManagedWorktreeStatusSuffix(model: ManagedWorktreePresentationModel): string {
  if (model.state === "healthy") {
    return model.location?.label ?? "root";
  }

  switch (model.reason) {
    case "worktree-path-missing":
    case "managed-missing":
      return "missing";
    case "lease-missing":
      return "lease missing";
    case "lease-binding-mismatch":
      return "mismatch";
    case "provisioning":
      return "provisioning";
    case "managed-released":
      return "released";
    case "manual-cleanup-required":
      return "cleanup";
    case "outside-target-cwd":
      return `blocked · ${model.location?.label ?? "outside"}`;
    case "outside-worktree":
      return "blocked · outside";
    default:
      return "blocked";
  }
}

export function renderManagedWorktreeWidgetLines(
  model: ManagedWorktreePresentationModel,
): string[] | undefined {
  if (model.state === "unmanaged" || !model.identity) return undefined;

  const prefix = model.severity === "error"
    ? "⛔"
    : model.state === "degraded"
      ? "⚠️"
      : "🧱";
  const lines = [`${prefix} Managed WT ${model.identity} · ${renderManagedWorktreeHeadline(model)}`];

  if (model.state === "degraded" && model.detail) {
    lines.push(model.detail);
  }

  return lines;
}

export function renderManagedWorktreeStatusText(
  model: ManagedWorktreePresentationModel,
): string | undefined {
  if (model.state === "unmanaged" || !model.identity) return undefined;
  return `${model.identity} · ${renderManagedWorktreeStatusSuffix(model)}`;
}
