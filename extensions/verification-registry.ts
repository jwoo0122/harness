import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type VerificationMode = "automated" | "manual";
export type VerificationRunStatus = "pass" | "fail";
export type VerificationDerivedStatus = VerificationRunStatus | "missing" | "stale";

export interface VerificationBinding {
  binding_id: string;
  requirement: string;
  source?: string;
  registeredAt: string;
}

export interface VerificationDefinition {
  strategy: string;
  mode: VerificationMode;
  blocking: boolean;
  command?: string;
  files?: string[];
  description: string;
}

export interface VerificationSpec {
  check_id: string;
  bindings: VerificationBinding[];
  verification: VerificationDefinition;
}

export interface VerificationRegistry {
  $schema: string;
  specs: Record<string, VerificationSpec>;
}

interface LegacyVerificationEntry {
  requirement: string;
  source?: string;
  verification: {
    strategy: string;
    command?: string;
    files?: string[];
    description: string;
  };
  registeredAt: string;
  lastVerifiedAt?: string;
  lastResult?: "pass" | "fail";
}

interface LegacyVerificationRegistry {
  $schema?: string;
  entries: Record<string, LegacyVerificationEntry>;
}

export interface VerificationReceipt {
  receipt_id: string;
  check_id: string;
  spec_hash: string;
  status: VerificationRunStatus;
  mode: VerificationMode;
  blocking: boolean;
  command: string;
  exit_code: number;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  commit_hash: string;
  commit_short: string;
  git_common_dir: string;
  worktree_path: string;
  stdout_sha256?: string;
  stderr_sha256?: string;
  stdout_preview?: string;
  stderr_preview?: string;
}

export interface VerificationReceiptStore {
  gitCommonDir: string;
  runtimeDir: string;
  receiptLogPath: string;
  receipts: VerificationReceipt[];
}

export interface VerificationStatusEntry {
  check_id: string;
  spec_hash: string;
  status: VerificationDerivedStatus;
  bindings: VerificationBinding[];
  verification: VerificationDefinition;
  latestReceipt?: VerificationReceipt;
  currentHeadReceipt?: VerificationReceipt;
}

export interface VerificationSpecInput {
  ac_id: string;
  check_id?: string;
  requirement: string;
  source?: string;
  strategy: string;
  mode?: VerificationMode;
  blocking?: boolean;
  command?: string;
  files?: string[];
  description: string;
  increment?: string;
}

export interface VerificationSelectionOptions {
  check_ids?: string[];
  filter?: string;
  automatedOnly?: boolean;
  includeNonBlocking?: boolean;
}

const REGISTRY_DIR = ".harness";
const REGISTRY_FILE = "verification-registry.json";
const REGISTRY_SCHEMA_V2 = "harness-verification-registry-v2";
const RECEIPT_RUNTIME_DIR = join("pi-harness", "verification");
const RECEIPT_LOG_FILE = "receipts.jsonl";

export function createEmptyRegistry(): VerificationRegistry {
  return { $schema: REGISTRY_SCHEMA_V2, specs: {} };
}

export async function readRegistry(cwd: string): Promise<VerificationRegistry> {
  const path = join(cwd, REGISTRY_DIR, REGISTRY_FILE);
  let content: string;

  try {
    content = await readFile(path, "utf-8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return createEmptyRegistry();
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Malformed verification registry JSON at ${path}: ${formatError(error)}`);
  }

  if (isLegacyRegistry(parsed)) {
    return migrateLegacyRegistry(parsed);
  }

  if (!isVerificationRegistry(parsed)) {
    throw new Error(`Unsupported verification registry shape at ${path}. Expected ${REGISTRY_SCHEMA_V2} or legacy v1 entries.`);
  }

  return normalizeRegistry(parsed);
}

export async function writeRegistry(cwd: string, registry: VerificationRegistry): Promise<void> {
  const dir = join(cwd, REGISTRY_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, REGISTRY_FILE), JSON.stringify(normalizeRegistry(registry), null, 2) + "\n", "utf-8");
}

export function upsertVerificationSpec(registry: VerificationRegistry, input: VerificationSpecInput): {
  registry: VerificationRegistry;
  checkId: string;
  isUpdate: boolean;
  isBindingUpdate: boolean;
} {
  const checkId = normalizeIdentifier(input.check_id ?? input.ac_id, "check_id");
  const bindingId = normalizeIdentifier(input.ac_id, "ac_id");
  const increment = normalizeOptionalString(input.increment) ?? "unknown";
  const mode = normalizeMode(input.mode ?? inferMode(input.strategy));
  const blocking = typeof input.blocking === "boolean"
    ? input.blocking
    : mode === "manual"
      ? false
      : true;

  const spec: VerificationSpec = {
    check_id: checkId,
    bindings: [],
    verification: {
      strategy: normalizeIdentifier(input.strategy, "strategy"),
      mode,
      blocking,
      command: normalizeOptionalString(input.command),
      files: normalizeStringArray(input.files),
      description: normalizeIdentifier(input.description, "description"),
    },
  };

  const existing = registry.specs[checkId];
  const bindings = [...(existing?.bindings ?? [])];
  const bindingIndex = bindings.findIndex((binding) => binding.binding_id === bindingId);
  const existingBinding = bindingIndex >= 0 ? bindings[bindingIndex] : undefined;

  const updatedBinding: VerificationBinding = {
    binding_id: bindingId,
    requirement: normalizeIdentifier(input.requirement, "requirement"),
    source: normalizeOptionalString(input.source),
    registeredAt: existingBinding?.registeredAt ?? increment,
  };

  if (bindingIndex >= 0) {
    bindings[bindingIndex] = updatedBinding;
  } else {
    bindings.push(updatedBinding);
  }

  spec.bindings = normalizeBindings(bindings);

  const nextRegistry = normalizeRegistry({
    ...registry,
    $schema: REGISTRY_SCHEMA_V2,
    specs: {
      ...registry.specs,
      [checkId]: spec,
    },
  });

  return {
    registry: nextRegistry,
    checkId,
    isUpdate: Boolean(existing),
    isBindingUpdate: Boolean(existingBinding),
  };
}

export function selectVerificationSpecs(
  registry: VerificationRegistry,
  options: VerificationSelectionOptions = {},
): VerificationSpec[] {
  const requestedIds = new Set((options.check_ids ?? []).map((value) => normalizeIdentifier(value, "check_id")));
  const filter = normalizeOptionalString(options.filter);
  const automatedOnly = options.automatedOnly ?? false;
  const includeNonBlocking = options.includeNonBlocking ?? true;

  const specs = Object.values(registry.specs)
    .map((spec) => normalizeSpec(spec))
    .filter((spec) => {
      if (requestedIds.size > 0 && !requestedIds.has(spec.check_id)) {
        return false;
      }
      if (filter) {
        const matchesCheckId = spec.check_id.startsWith(filter);
        const matchesBinding = spec.bindings.some((binding) => binding.binding_id.startsWith(filter));
        if (!matchesCheckId && !matchesBinding) {
          return false;
        }
      }
      if (automatedOnly && spec.verification.mode !== "automated") {
        return false;
      }
      if (!includeNonBlocking && !spec.verification.blocking) {
        return false;
      }
      return true;
    })
    .sort((a, b) => a.check_id.localeCompare(b.check_id));

  return specs;
}

export function hashVerificationSpec(spec: VerificationSpec): string {
  return createHash("sha256")
    .update(stableStringify(normalizeSpec(spec)))
    .digest("hex");
}

export async function resolveVerificationRuntimePaths(cwd: string): Promise<{
  gitCommonDir: string;
  runtimeDir: string;
  receiptLogPath: string;
}> {
  const gitCommonDirRaw = await execGit(cwd, ["rev-parse", "--git-common-dir"]);
  const gitCommonDir = resolve(cwd, gitCommonDirRaw);
  const runtimeDir = join(gitCommonDir, RECEIPT_RUNTIME_DIR);
  const receiptLogPath = join(runtimeDir, RECEIPT_LOG_FILE);
  return { gitCommonDir, runtimeDir, receiptLogPath };
}

export async function readVerificationReceiptStore(cwd: string): Promise<VerificationReceiptStore> {
  const { gitCommonDir, runtimeDir, receiptLogPath } = await resolveVerificationRuntimePaths(cwd);
  let content: string;

  try {
    content = await readFile(receiptLogPath, "utf-8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { gitCommonDir, runtimeDir, receiptLogPath, receipts: [] };
    }
    throw error;
  }

  const receipts: VerificationReceipt[] = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(`Malformed verification receipt store at ${receiptLogPath}:${index + 1}: ${formatError(error)}`);
    }

    if (!isVerificationReceipt(parsed)) {
      throw new Error(`Malformed verification receipt store at ${receiptLogPath}:${index + 1}: invalid receipt shape.`);
    }

    receipts.push(parsed);
  }

  return { gitCommonDir, runtimeDir, receiptLogPath, receipts };
}

export async function appendVerificationReceipt(cwd: string, receipt: VerificationReceipt): Promise<VerificationReceiptStore> {
  if (!isVerificationReceipt(receipt)) {
    throw new Error("appendVerificationReceipt received an invalid receipt object.");
  }

  const store = await resolveVerificationRuntimePaths(cwd);
  await mkdir(store.runtimeDir, { recursive: true });
  await appendFile(store.receiptLogPath, JSON.stringify(receipt) + "\n", "utf-8");
  return {
    ...store,
    receipts: [receipt],
  };
}

export async function getGitHead(cwd: string): Promise<{ full: string; short: string }> {
  const full = await execGit(cwd, ["rev-parse", "HEAD"]);
  const short = await execGit(cwd, ["rev-parse", "--short", "HEAD"]);
  return { full, short };
}

export async function deriveVerificationStatuses(
  cwd: string,
  registry: VerificationRegistry,
  providedReceipts?: VerificationReceipt[],
): Promise<VerificationStatusEntry[]> {
  const head = await getGitHead(cwd);
  const receipts = providedReceipts ?? (await readVerificationReceiptStore(cwd)).receipts;
  const specs = selectVerificationSpecs(registry);

  return specs.map((spec) => {
    const specHash = hashVerificationSpec(spec);
    const receiptsForCheck = receipts.filter((receipt) => receipt.check_id === spec.check_id);
    const receiptsForCurrentSpec = receiptsForCheck.filter((receipt) => receipt.spec_hash === specHash);
    const receiptsForCurrentHead = receiptsForCurrentSpec.filter((receipt) => receipt.commit_hash === head.full);
    const currentHeadReceipt = last(receiptsForCurrentHead);
    const latestReceipt = currentHeadReceipt ?? last(receiptsForCurrentSpec) ?? last(receiptsForCheck);

    let status: VerificationDerivedStatus = "missing";
    if (currentHeadReceipt) {
      status = currentHeadReceipt.status;
    } else if (latestReceipt) {
      status = "stale";
    }

    return {
      check_id: spec.check_id,
      spec_hash: specHash,
      status,
      bindings: spec.bindings,
      verification: spec.verification,
      latestReceipt,
      currentHeadReceipt,
    };
  });
}

function migrateLegacyRegistry(legacy: LegacyVerificationRegistry): VerificationRegistry {
  const specs: Record<string, VerificationSpec> = {};

  for (const [acId, entry] of Object.entries(legacy.entries ?? {})) {
    const checkId = normalizeIdentifier(acId, "legacy entry key");
    specs[checkId] = normalizeSpec({
      check_id: checkId,
      bindings: [{
        binding_id: normalizeIdentifier(acId, "legacy binding_id"),
        requirement: normalizeIdentifier(entry.requirement, `legacy requirement for ${acId}`),
        source: normalizeOptionalString(entry.source),
        registeredAt: normalizeIdentifier(entry.registeredAt, `legacy registeredAt for ${acId}`),
      }],
      verification: {
        strategy: normalizeIdentifier(entry.verification?.strategy, `legacy strategy for ${acId}`),
        mode: inferMode(entry.verification?.strategy),
        blocking: inferMode(entry.verification?.strategy) === "manual" ? false : true,
        command: normalizeOptionalString(entry.verification?.command),
        files: normalizeStringArray(entry.verification?.files),
        description: normalizeIdentifier(entry.verification?.description, `legacy description for ${acId}`),
      },
    });
  }

  return normalizeRegistry({ $schema: REGISTRY_SCHEMA_V2, specs });
}

function normalizeRegistry(registry: VerificationRegistry): VerificationRegistry {
  const specs = Object.entries(registry.specs ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .reduce<Record<string, VerificationSpec>>((acc, [checkId, spec]) => {
      const normalized = normalizeSpec({ ...spec, check_id: checkId });
      acc[normalized.check_id] = normalized;
      return acc;
    }, {});

  return {
    $schema: REGISTRY_SCHEMA_V2,
    specs,
  };
}

function normalizeSpec(spec: VerificationSpec): VerificationSpec {
  const checkId = normalizeIdentifier(spec.check_id, "check_id");
  const mode = normalizeMode(spec.verification?.mode ?? inferMode(spec.verification?.strategy));
  return {
    check_id: checkId,
    bindings: normalizeBindings(spec.bindings ?? []),
    verification: {
      strategy: normalizeIdentifier(spec.verification?.strategy, `strategy for ${checkId}`),
      mode,
      blocking: Boolean(spec.verification?.blocking),
      command: normalizeOptionalString(spec.verification?.command),
      files: normalizeStringArray(spec.verification?.files),
      description: normalizeIdentifier(spec.verification?.description, `description for ${checkId}`),
    },
  };
}

function normalizeBindings(bindings: VerificationBinding[]): VerificationBinding[] {
  const deduped = new Map<string, VerificationBinding>();

  for (const binding of bindings) {
    const normalized: VerificationBinding = {
      binding_id: normalizeIdentifier(binding.binding_id, "binding_id"),
      requirement: normalizeIdentifier(binding.requirement, `requirement for ${binding.binding_id}`),
      source: normalizeOptionalString(binding.source),
      registeredAt: normalizeIdentifier(binding.registeredAt, `registeredAt for ${binding.binding_id}`),
    };
    deduped.set(normalized.binding_id, normalized);
  }

  return [...deduped.values()].sort((left, right) => left.binding_id.localeCompare(right.binding_id));
}

function normalizeMode(value: VerificationMode | string): VerificationMode {
  return value === "manual" ? "manual" : "automated";
}

function inferMode(strategy: string | undefined): VerificationMode {
  return normalizeOptionalString(strategy) === "manual-check" ? "manual" : "automated";
}

function normalizeIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid ${label}: expected non-empty string.`);
  }
  return value.trim();
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  return normalized.length > 0 ? normalized : undefined;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    return `{${Object.keys(objectValue)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function execGit(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", args, { cwd });
    return result.stdout.trim();
  } catch (error) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${formatError(error)}`);
  }
}

function isLegacyRegistry(value: unknown): value is LegacyVerificationRegistry {
  if (!value || typeof value !== "object") return false;
  return "entries" in value && typeof (value as { entries?: unknown }).entries === "object";
}

function isVerificationRegistry(value: unknown): value is VerificationRegistry {
  if (!value || typeof value !== "object") return false;
  return (value as { $schema?: unknown }).$schema === REGISTRY_SCHEMA_V2
    && typeof (value as { specs?: unknown }).specs === "object";
}

function isVerificationReceipt(value: unknown): value is VerificationReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Record<string, unknown>;
  return typeof receipt.receipt_id === "string"
    && typeof receipt.check_id === "string"
    && typeof receipt.spec_hash === "string"
    && (receipt.status === "pass" || receipt.status === "fail")
    && (receipt.mode === "automated" || receipt.mode === "manual")
    && typeof receipt.blocking === "boolean"
    && typeof receipt.command === "string"
    && typeof receipt.exit_code === "number"
    && typeof receipt.started_at === "string"
    && typeof receipt.finished_at === "string"
    && typeof receipt.duration_ms === "number"
    && typeof receipt.commit_hash === "string"
    && typeof receipt.commit_short === "string"
    && typeof receipt.git_common_dir === "string"
    && typeof receipt.worktree_path === "string";
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return Boolean(value) && typeof value === "object" && "code" in value;
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function last<T>(items: T[]): T | undefined {
  return items.length > 0 ? items[items.length - 1] : undefined;
}
