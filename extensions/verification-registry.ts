import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface VerificationEntry {
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

export interface VerificationRegistry {
  $schema: string;
  entries: Record<string, VerificationEntry>;
}

const REGISTRY_DIR = ".harness";
const REGISTRY_FILE = "verification-registry.json";
const REGISTRY_SCHEMA = "harness-verification-registry-v1";

export async function readRegistry(cwd: string): Promise<VerificationRegistry> {
  try {
    const content = await readFile(join(cwd, REGISTRY_DIR, REGISTRY_FILE), "utf-8");
    return JSON.parse(content);
  } catch {
    return { $schema: REGISTRY_SCHEMA, entries: {} };
  }
}

export async function writeRegistry(cwd: string, registry: VerificationRegistry): Promise<void> {
  const dir = join(cwd, REGISTRY_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(cwd, REGISTRY_DIR, REGISTRY_FILE), JSON.stringify(registry, null, 2) + "\n", "utf-8");
}
