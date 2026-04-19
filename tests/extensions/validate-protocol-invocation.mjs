import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const modulePath = resolve(repoRoot, "extensions/protocol-invocation.ts");
const indexPath = resolve(repoRoot, "extensions/index.ts");
const readmePath = resolve(repoRoot, "README.md");
const integrationPath = resolve(repoRoot, "INTEGRATION.md");
const packageJsonPath = resolve(repoRoot, "package.json");

assert.ok(existsSync(modulePath), "extensions/protocol-invocation.ts must exist before full validation");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /extensions\/protocol-invocation\.ts/,
  "validate:extensions must syntax-check extensions/protocol-invocation.ts",
);
assert.match(
  packageJson.scripts?.["validate:extensions"] ?? "",
  /tests\/extensions\/validate-protocol-invocation\.mjs/,
  "validate:extensions must include protocol invocation validation",
);

const moduleSource = readFileSync(modulePath, "utf-8");
const indexSource = readFileSync(indexPath, "utf-8");
const readmeSource = readFileSync(readmePath, "utf-8");
const integrationSource = readFileSync(integrationPath, "utf-8");

for (const forbiddenImport of ["./index", "@mariozechner/", "@sinclair/typebox"]) {
  assert.ok(!moduleSource.includes(forbiddenImport), `extensions/protocol-invocation.ts must not import ${forbiddenImport}`);
}

assert.ok(indexSource.includes('from "./protocol-invocation.js"'), "extensions/index.ts must import ./protocol-invocation.js");
assert.ok(indexSource.includes('pi.on("input"'), "extensions/index.ts must route /explore and /execute through input interception");
assert.ok(indexSource.includes("parseHarnessProtocolInvocation(event.text)"), "extensions/index.ts must parse raw protocol invocations from input");
assert.ok(indexSource.includes("beginActiveProtocolRun(pendingProtocolInvocation, ctx);"), "extensions/index.ts must activate protocol routing per run");
assert.ok(indexSource.includes("clearActiveProtocolRun(ctx);"), "extensions/index.ts must clear protocol routing after the run completes");
assert.ok(indexSource.includes("stripLegacyHarnessMode"), "extensions/index.ts must ignore restored legacy mode state");
assert.ok(!indexSource.includes('registerCommand("explore"'), "extensions/index.ts must not register /explore as a persistent mode command");
assert.ok(!indexSource.includes('registerCommand("execute"'), "extensions/index.ts must not register /execute as a persistent mode command");
assert.ok(!indexSource.includes('registerCommand("harness-off"'), "extensions/index.ts must not expose a mode-off command");
assert.ok(!indexSource.includes('registerCommand("harness-status"'), "extensions/index.ts must not expose a harness-status command");
assert.ok(!indexSource.includes('registerShortcut("ctrl+shift+h"'), "extensions/index.ts must not keep the mode toggle shortcut");
assert.ok(!indexSource.includes("setStatus("), "extensions/index.ts must not render protocol status in the footer");
assert.ok(!indexSource.includes("mode: Mode"), "HarnessState must no longer persist a mode field");
assert.ok(!/footer status|status UI|live status UI/.test(readmeSource), "README.md must not advertise protocol status surfaces");
assert.ok(!/footer status|status UI|live status UI/.test(integrationSource), "INTEGRATION.md must not advertise protocol status surfaces");

const protocolModule = await import(pathToFileURL(modulePath).href);
const { parseHarnessProtocolInvocation, stripLegacyHarnessMode } = protocolModule;

assert.equal(typeof parseHarnessProtocolInvocation, "function", "parseHarnessProtocolInvocation export must exist");
assert.equal(typeof stripLegacyHarnessMode, "function", "stripLegacyHarnessMode export must exist");

assert.deepEqual(
  parseHarnessProtocolInvocation("/explore"),
  { protocol: "explore", argsText: "", rewrittenText: "/skill:explore" },
  "/explore alias must rewrite to /skill:explore without args",
);
assert.deepEqual(
  parseHarnessProtocolInvocation("/explore next iteration"),
  { protocol: "explore", argsText: "next iteration", rewrittenText: "/skill:explore next iteration" },
  "/explore alias must preserve arguments when rewritten",
);
assert.deepEqual(
  parseHarnessProtocolInvocation("/execute .iteration-9-criteria.md"),
  { protocol: "execute", argsText: ".iteration-9-criteria.md", rewrittenText: "/skill:execute .iteration-9-criteria.md" },
  "/execute alias must rewrite to /skill:execute with criteria args",
);
assert.deepEqual(
  parseHarnessProtocolInvocation("/skill:explore architecture tradeoffs"),
  { protocol: "explore", argsText: "architecture tradeoffs" },
  "direct /skill:explore calls must be recognized without rewriting",
);
assert.deepEqual(
  parseHarnessProtocolInvocation("/skill:execute"),
  { protocol: "execute", argsText: "" },
  "direct /skill:execute calls must be recognized without args",
);
assert.equal(
  parseHarnessProtocolInvocation("/skill:other"),
  undefined,
  "non-harness skills must not be intercepted",
);
assert.deepEqual(
  stripLegacyHarnessMode({ mode: "explore", criteriaFile: "x", commitCount: 2 }),
  { criteriaFile: "x", commitCount: 2 },
  "legacy persisted mode must be stripped during session restore",
);

console.log("validate:protocol-invocation passed");
