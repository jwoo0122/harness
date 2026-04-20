import {
  INTERNAL_MANAGED_WORKTREE_COMMAND,
  type ManagedExecuteResumeRequest,
  buildManagedExecuteResumeCommand,
} from "./managed-worktrees.js";

export interface ManagedWorktreeBootstrapRequest {
  headOnlyFromDirty?: boolean;
  resumeExecuteArgsText?: string;
}

export interface ManagedExecuteStartupDecision {
  mode: "reuse" | "bootstrap";
  transformedText: string;
  notification: string;
  preservePendingInvocation: boolean;
}

export interface ManagedDirtyExecuteBootstrapDecision {
  action: "proceed" | "confirm" | "cancel";
  title?: string;
  message?: string;
  notification?: string;
  headOnlyFromDirty: boolean;
}

export interface ManagedExecuteResumePlan {
  action: "resume" | "skip" | "warn";
  notification?: string;
  commandText?: string;
  consumedRequestId?: string;
}

export function encodeManagedWorktreeBootstrapRequest(request: ManagedWorktreeBootstrapRequest): string {
  return Buffer.from(JSON.stringify(request), "utf-8").toString("base64url");
}

export function decodeManagedWorktreeBootstrapRequest(rawValue: string | undefined): ManagedWorktreeBootstrapRequest {
  if (!rawValue) return {};
  try {
    const parsed = JSON.parse(Buffer.from(rawValue, "base64url").toString("utf-8"));
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as ManagedWorktreeBootstrapRequest;
  } catch {
    return {};
  }
}

export function buildManagedExecuteBootstrapCommand(
  argsText: string,
  headOnlyFromDirty = false,
  commandName = INTERNAL_MANAGED_WORKTREE_COMMAND,
): string {
  const payload = encodeManagedWorktreeBootstrapRequest({
    headOnlyFromDirty,
    resumeExecuteArgsText: argsText,
  });
  return `/${commandName} ${payload}`;
}

export function decideManagedExecuteStartup(options: {
  argsText: string;
  reuseManagedWorkspace: boolean;
  currentManagedWorktreeId?: string;
  commandName?: string;
}): ManagedExecuteStartupDecision {
  if (options.reuseManagedWorkspace) {
    return {
      mode: "reuse",
      transformedText: options.argsText ? `/skill:execute ${options.argsText}` : "/skill:execute",
      notification: options.currentManagedWorktreeId
        ? `Reusing managed worktree ${options.currentManagedWorktreeId} for /execute.`
        : "Reusing the current managed worktree for /execute.",
      preservePendingInvocation: true,
    };
  }

  return {
    mode: "bootstrap",
    transformedText: buildManagedExecuteBootstrapCommand(
      options.argsText,
      false,
      options.commandName ?? INTERNAL_MANAGED_WORKTREE_COMMAND,
    ),
    notification: "Preparing a managed worktree for /execute before implementation begins.",
    preservePendingInvocation: false,
  };
}

export function evaluateDirtyExecuteBootstrap(options: {
  hasDirtyChanges: boolean;
  headOnlyFromDirty?: boolean;
  confirmed?: boolean;
}): ManagedDirtyExecuteBootstrapDecision {
  if (!options.hasDirtyChanges || options.headOnlyFromDirty) {
    return {
      action: "proceed",
      headOnlyFromDirty: Boolean(options.headOnlyFromDirty),
    };
  }

  if (options.confirmed === undefined) {
    return {
      action: "confirm",
      headOnlyFromDirty: false,
      title: "Dirty checkout",
      message: "The current checkout has uncommitted changes. They will not be carried into the managed worktree. Continue /execute from HEAD only?",
    };
  }

  if (!options.confirmed) {
    return {
      action: "cancel",
      headOnlyFromDirty: false,
      notification: "Managed worktree bootstrap cancelled: the current checkout is dirty, and uncommitted changes are not carried into the new worktree. Re-run with explicit HEAD-only confirmation.",
    };
  }

  return {
    action: "proceed",
    headOnlyFromDirty: true,
  };
}

export function planManagedExecuteResume(options: {
  pendingResume?: ManagedExecuteResumeRequest;
  currentManagedWorktreeId?: string;
  leaseLifecycleState?: string;
}): ManagedExecuteResumePlan {
  if (!options.pendingResume) {
    return { action: "skip" };
  }

  if (options.currentManagedWorktreeId && options.leaseLifecycleState === "managed-active") {
    return {
      action: "resume",
      notification: `Resuming /execute in managed worktree ${options.currentManagedWorktreeId}.`,
      commandText: buildManagedExecuteResumeCommand(options.pendingResume),
      consumedRequestId: options.pendingResume.requestId,
    };
  }

  return {
    action: "warn",
    notification: "Cannot resume /execute automatically because the managed workspace is not active.",
  };
}
