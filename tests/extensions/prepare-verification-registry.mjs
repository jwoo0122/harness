import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packageJsonPath = resolve(repoRoot, "package.json");
const indexPath = resolve(repoRoot, "extensions/index.ts");
const promptPreparePath = resolve(repoRoot, "tests/extensions/prepare-agent-prompts.mjs");

assert.ok(existsSync(indexPath), "extensions/index.ts must exist");
assert.ok(existsSync(promptPreparePath), "existing prompt prepare validator should remain in repo");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
assert.equal(
  packageJson.scripts?.["validate:extensions:prepare"],
  "node tests/extensions/prepare-verification-registry.mjs",
  "validate:extensions:prepare must point to the registry prepare validator",
);
assert.ok(packageJson.scripts?.["validate:extensions"], "package.json must still define validate:extensions");

const indexSource = readFileSync(indexPath, "utf-8");

for (const marker of [
  "interface VerificationEntry",
  "interface VerificationRegistry",
  'const REGISTRY_DIR = ".harness"',
  'const REGISTRY_FILE = "verification-registry.json"',
  "async function readRegistry(",
  "async function writeRegistry(",
  'name: "harness_verify_register"',
  'name: "harness_verify_list"',
  "const registry = await readRegistry(ctx.cwd)",
  "await writeRegistry(ctx.cwd, registry)",
]) {
  assert.ok(indexSource.includes(marker), `registry prepare seam missing from extensions/index.ts: ${marker}`);
}

assert.ok(
  !indexSource.includes('from "./verification-registry.js"'),
  "extensions/index.ts must not import ./verification-registry.js before extraction",
);

console.log("validate:extensions:prepare passed");
