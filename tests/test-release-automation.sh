#!/bin/sh
set -eu

ROOT=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
[ -f "$ROOT/.releaserc.json" ] || { printf '%s\n' 'missing semantic-release configuration' >&2; exit 1; }
[ -f "$ROOT/.github/workflows/release.yml" ] || { printf '%s\n' 'missing release workflow' >&2; exit 1; }
[ -f "$ROOT/CONTRIBUTING.md" ] || { printf '%s\n' 'missing contributor guide' >&2; exit 1; }
[ -f "$ROOT/resources/AGENTS.md" ] || { printf '%s\n' 'missing runtime guidance resource' >&2; exit 1; }

ROOT="$ROOT" node --input-type=module <<'EOF'
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.ROOT;
const packageManifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
assert.equal(packageManifest.name, "@jwoo0122/engineering-harness-skills");
assert.equal(packageManifest.publishConfig.access, "public");
const releaseConfig = JSON.parse(readFileSync(resolve(root, ".releaserc.json"), "utf8"));
assert.deepEqual(releaseConfig.branches, ["main"]);
assert.equal(releaseConfig.tagFormat, "v${version}");
const pluginName = (plugin) => Array.isArray(plugin) ? plugin[0] : plugin;
const pluginNames = releaseConfig.plugins.map(pluginName);
assert.deepEqual(pluginNames, [
  "@semantic-release/commit-analyzer",
  "@semantic-release/release-notes-generator",
  "@semantic-release/changelog",
  "@semantic-release/npm",
  "@semantic-release/git",
  "@semantic-release/github",
  "@semantic-release/exec",
]);
assert.match(releaseConfig.plugins.at(-1)[1].publishCmd, /write-release-output\.mjs \$\{nextRelease\.version\}/);

const { buildFormula, syncHomebrewFormula, updateFormula } = await import(
  pathToFileURL(resolve(root, "scripts/sync-homebrew-formula.mjs")).href,
);
let tokenlessFetches = 0;
const tokenless = await syncHomebrewFormula("1.2.3", {
  environment: {},
  fetchImpl: async () => {
    tokenlessFetches += 1;
    throw new Error("tokenless sync must not make a network request");
  },
  log: () => {},
});
assert.equal(tokenless.skipped, true);
assert.equal(tokenlessFetches, 0);
await assert.rejects(
  () => syncHomebrewFormula("1.2.3", {
    environment: { REQUIRE_HOMEBREW_SYNC: "1" },
    fetchImpl: async () => {
      throw new Error("required sync must fail before a network request");
    },
    log: () => {},
  }),
  /HOMEBREW_TAP_TOKEN is required/,
);

const tarball = Buffer.from("deterministic npm tarball");
const sha256 = createHash("sha256").update(tarball).digest("hex");
const oldFormula = buildFormula({
  version: "1.2.2",
  tarballUrl: "https://registry.npmjs.org/engineering-harness-skills/-/engineering-harness-skills-1.2.2.tgz",
  sha256: "0".repeat(64),
});
const requests = [];
const fetchImpl = async (url, options = {}) => {
  requests.push({ url: String(url), options });
  if (url === "https://registry.npmjs.org/@jwoo0122%2Fengineering-harness-skills/1.2.3") {
    return Response.json({
      dist: {
        tarball: "https://registry.npmjs.org/@jwoo0122/engineering-harness-skills/-/engineering-harness-skills-1.2.3.tgz",
      },
    });
  }
  if (url === "https://registry.npmjs.org/@jwoo0122/engineering-harness-skills/-/engineering-harness-skills-1.2.3.tgz") {
    return new Response(tarball);
  }
  if (url === "https://api.github.com/repos/jwoo0122/homebrew-tap/contents/Formula/engineering-harness.rb" && !options.method) {
    return Response.json({ content: Buffer.from(oldFormula).toString("base64"), sha: "existing-formula-sha" });
  }
  if (url === "https://api.github.com/repos/jwoo0122/homebrew-tap/contents/Formula/engineering-harness.rb" && options.method === "PUT") {
    const payload = JSON.parse(options.body);
    const formula = Buffer.from(payload.content, "base64").toString("utf8");
    assert.ok(formula.includes('url "https://registry.npmjs.org/@jwoo0122/engineering-harness-skills/-/engineering-harness-skills-1.2.3.tgz"'));
    assert.match(formula, new RegExp(sha256));
    assert.equal(payload.branch, "main");
    assert.equal(payload.sha, "existing-formula-sha");
    assert.equal(payload.message, "chore(homebrew): bump engineering-harness to 1.2.3");
    return Response.json({ content: {} }, { status: 200 });
  }
  throw new Error(`unexpected request: ${url}`);
};
const synchronized = await syncHomebrewFormula("1.2.3", {
  environment: { HOMEBREW_TAP_TOKEN: "test-token" },
  fetchImpl,
  log: () => {},
});
assert.equal(synchronized.updated, true);
assert.equal(requests.length, 4);

const createdRequests = [];
const createFormulaFetch = async (url, options = {}) => {
  createdRequests.push({ url: String(url), options });
  if (url === "https://registry.npmjs.org/@jwoo0122%2Fengineering-harness-skills/1.2.4") {
    return Response.json({
      dist: {
        tarball: "https://registry.npmjs.org/@jwoo0122/engineering-harness-skills/-/engineering-harness-skills-1.2.4.tgz",
      },
    });
  }
  if (url === "https://registry.npmjs.org/@jwoo0122/engineering-harness-skills/-/engineering-harness-skills-1.2.4.tgz") {
    return new Response(tarball);
  }
  if (url === "https://api.github.com/repos/jwoo0122/homebrew-tap/contents/Formula/engineering-harness.rb" && !options.method) {
    return new Response(null, { status: 404 });
  }
  if (url === "https://api.github.com/repos/jwoo0122/homebrew-tap/contents/Formula/engineering-harness.rb" && options.method === "PUT") {
    const payload = JSON.parse(options.body);
    assert.equal(payload.branch, "main");
    assert.equal("sha" in payload, false);
    return Response.json({ content: {} }, { status: 201 });
  }
  throw new Error(`unexpected create request: ${url}`);
};
const created = await syncHomebrewFormula("1.2.4", {
  environment: { HOMEBREW_TAP_TOKEN: "test-token" },
  fetchImpl: createFormulaFetch,
  log: () => {},
});
assert.equal(created.updated, true);
assert.equal(createdRequests.length, 4);

assert.throws(
  () => updateFormula('class Wrong < Formula\n  url "https://example.com/source.tgz"\n  sha256 "' + "0".repeat(64) + '"\nend\n', synchronized.release),
  /unexpected Homebrew formula class/,
);
assert.throws(
  () => updateFormula(buildFormula({
    version: "1.2.2",
    tarballUrl: "https://registry.npmjs.org/engineering-harness-skills/-/other.tgz",
    sha256: "0".repeat(64),
  }), synchronized.release),
  /non-Harness npm Homebrew source URL/,
);
EOF

grep -Fx '  push:' "$ROOT/.github/workflows/release.yml" >/dev/null
grep -F 'branches: [main]' "$ROOT/.github/workflows/release.yml" >/dev/null
grep -F 'fetch-depth: 0' "$ROOT/.github/workflows/release.yml" >/dev/null
grep -F 'cancel-in-progress: false' "$ROOT/.github/workflows/release.yml" >/dev/null
grep -F 'contents: write' "$ROOT/.github/workflows/release.yml" >/dev/null
grep -F 'Verify Homebrew synchronization credentials' "$ROOT/.github/workflows/release.yml" >/dev/null
grep -F 'persist-credentials: false' "$ROOT/.github/workflows/release.yml" >/dev/null
grep -F 'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5' "$ROOT/.github/workflows/release.yml" >/dev/null
grep -F 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020' "$ROOT/.github/workflows/release.yml" >/dev/null
grep -F 'NPM_TOKEN: ${{ secrets.NPM_TOKEN }}' "$ROOT/.github/workflows/release.yml" >/dev/null
grep -F 'HOMEBREW_TAP_TOKEN: ${{ secrets.HOMEBREW_TAP_TOKEN }}' "$ROOT/.github/workflows/release.yml" >/dev/null
grep -F 'All commits intended for `main`' "$ROOT/AGENTS.md" >/dev/null
grep -F 'Conventional Commit' "$ROOT/CONTRIBUTING.md" >/dev/null
grep -F 'Act as the lead engineer responsible for delivering a working, verified result.' "$ROOT/resources/AGENTS.md" >/dev/null
RELEASE_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/engineering-harness-release-output.XXXXXX")
trap 'rm -f "$RELEASE_OUTPUT"' EXIT HUP INT TERM
GITHUB_OUTPUT="$RELEASE_OUTPUT" node "$ROOT/scripts/write-release-output.mjs" 1.2.3
grep -Fx 'version=1.2.3' "$RELEASE_OUTPUT" >/dev/null

PACK_JSON=$(cd "$ROOT" && npm pack --dry-run --json --ignore-scripts)
PACK_JSON="$PACK_JSON" node --input-type=module <<'EOF'
import assert from "node:assert/strict";
const packed = JSON.parse(process.env.PACK_JSON);
assert.equal(packed[0].name, "@jwoo0122/engineering-harness-skills");
const files = packed[0].files.map((entry) => entry.path);
assert(files.includes("resources/AGENTS.md"));
assert(!files.includes("AGENTS.md"));
assert(!files.includes("CONTRIBUTING.md"));
assert(!files.some((path) => path.startsWith("scripts/")));
assert(!files.some((path) => path.startsWith(".github/")));
EOF

printf '%s\n' 'Release automation acceptance test passed.'
