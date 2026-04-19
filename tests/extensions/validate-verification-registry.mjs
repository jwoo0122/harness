import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_SCHEMA = "harness-verification-registry-v1";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const modulePath = resolve(repoRoot, "extensions/verification-registry.ts");
const indexPath = resolve(repoRoot, "extensions/index.ts");
const packageJsonPath = resolve(repoRoot, "package.json");

assert.ok(existsSync(modulePath), "extensions/verification-registry.ts must exist before full validation");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
assert.ok(packageJson.scripts?.["validate:extensions:prepare"], "package.json must define validate:extensions:prepare");
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /extensions\/verification-registry\.ts/,
  "validate:extensions must syntax-check extensions/verification-registry.ts",
);
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /tests\/extensions\/validate-agent-prompts\.mjs/,
  "validate:extensions must keep prompt validation",
);
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /tests\/extensions\/validate-verification-registry\.mjs/,
  "validate:extensions must include registry validation",
);

const moduleSource = readFileSync(modulePath, "utf-8");
const indexSource = readFileSync(indexPath, "utf-8");

for (const forbiddenImport of ["./index", "@mariozechner/", "@sinclair/typebox"]) {
  assert.ok(!moduleSource.includes(forbiddenImport), `extensions/verification-registry.ts must not import ${forbiddenImport}`);
}

assert.ok(indexSource.includes('from "./verification-registry.js"'), "extensions/index.ts must import ./verification-registry.js");
for (const removedMarker of [
  "interface VerificationEntry",
  "interface VerificationRegistry",
  'const REGISTRY_DIR = ".harness"',
  'const REGISTRY_FILE = "verification-registry.json"',
  "async function readRegistry(",
  "async function writeRegistry(",
]) {
  assert.ok(!indexSource.includes(removedMarker), `extensions/index.ts must no longer define ${removedMarker}`);
}
for (const remainingMarker of [
  'name: "harness_verify_register"',
  'name: "harness_verify_list"',
]) {
  assert.ok(indexSource.includes(remainingMarker), `extensions/index.ts must still contain ${remainingMarker}`);
}

const registryModule = await import(pathToFileURL(modulePath).href);
const { readRegistry, writeRegistry } = registryModule;
assert.equal(typeof readRegistry, "function", "readRegistry export must exist");
assert.equal(typeof writeRegistry, "function", "writeRegistry export must exist");

const tempRoot = await mkdtemp(join(tmpdir(), "harness-registry-test-"));
const registryFilePath = join(tempRoot, ".harness", "verification-registry.json");

try {
  const emptyRegistry = await readRegistry(tempRoot);
  assert.deepEqual(
    emptyRegistry,
    { $schema: DEFAULT_SCHEMA, entries: {} },
    "missing registry file must return the default empty registry",
  );

  const sampleRegistry = {
    $schema: DEFAULT_SCHEMA,
    entries: {
      "AC-REG-1": {
        requirement: "Registry round-trip sample",
        source: ".iteration-6-criteria.md",
        verification: {
          strategy: "automated-test",
          command: "npm run validate:extensions",
          files: ["tests/extensions/validate-verification-registry.mjs"],
          description: "Ensures verification registry extraction preserves file I/O semantics",
        },
        registeredAt: "INC-2",
        lastVerifiedAt: "INC-2",
        lastResult: "pass",
      },
    },
  };

  await writeRegistry(tempRoot, sampleRegistry);
  assert.ok(existsSync(registryFilePath), "writeRegistry must create .harness/verification-registry.json");

  const writtenContent = await readFile(registryFilePath, "utf-8");
  assert.equal(
    writtenContent,
    JSON.stringify(sampleRegistry, null, 2) + "\n",
    "registry file must remain pretty-printed with a trailing newline",
  );

  const rereadRegistry = await readRegistry(tempRoot);
  assert.deepEqual(rereadRegistry, sampleRegistry, "readRegistry must round-trip written registry data");

  await writeFile(registryFilePath, "{ this is not valid json\n", "utf-8");
  const malformedFallback = await readRegistry(tempRoot);
  assert.deepEqual(
    malformedFallback,
    { $schema: DEFAULT_SCHEMA, entries: {} },
    "malformed registry JSON must fall back to the default empty registry",
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("validate:verification-registry passed");
