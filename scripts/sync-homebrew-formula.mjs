import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PACKAGE_NAME = "engineering-harness-skills";
const TAP_REPOSITORY = "jwoo0122/homebrew-tap";
const FORMULA_PATH = "Formula/engineering-harness.rb";
const FORMULA_CLASS = "EngineeringHarness";

function requireReleaseVersion(value) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) {
    throw new Error(`expected a semantic release version, received: ${value || "(empty)"}`);
  }
  return value;
}

function countMatches(source, expression) {
  return [...source.matchAll(expression)].length;
}

export function buildFormula({ version, tarballUrl, sha256 }) {
  return `class ${FORMULA_CLASS} < Formula
  desc "Standalone engineering workflow harness CLI"
  homepage "https://github.com/jwoo0122/engineering-harness-skills"
  url "${tarballUrl}"
  sha256 "${sha256}"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/engineering-harness --version")
  end
end
`;
}

export function updateFormula(existing, release) {
  if (existing === undefined) return buildFormula(release);
  if (!existing.includes(`class ${FORMULA_CLASS} < Formula`)) {
    throw new Error(`refusing to update unexpected Homebrew formula class in ${FORMULA_PATH}`);
  }
  if (countMatches(existing, /^\s*url\s+"[^"]+"\s*$/gm) !== 1 || countMatches(existing, /^\s*sha256\s+"[a-f0-9]{64}"\s*$/gm) !== 1) {
    throw new Error(`refusing to update ambiguous url or sha256 lines in ${FORMULA_PATH}`);
  }

  const currentUrl = /^\s*url\s+"([^"]+)"\s*$/m.exec(existing)?.[1];
  const expectedPrefix = `https://registry.npmjs.org/${PACKAGE_NAME}/-/`;
  if (!currentUrl?.startsWith(expectedPrefix)) {
    throw new Error(`refusing to replace a non-${PACKAGE_NAME} Homebrew source URL`);
  }

  return existing
    .replace(/^\s*url\s+"[^"]+"\s*$/m, `  url "${release.tarballUrl}"`)
    .replace(/^\s*sha256\s+"[a-f0-9]{64}"\s*$/m, `  sha256 "${release.sha256}"`);
}

async function requireJson(response, description) {
  if (!response.ok) {
    throw new Error(`${description} failed with HTTP ${response.status}`);
  }
  return response.json();
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "engineering-harness-release",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function syncHomebrewFormula(version, {
  environment = process.env,
  fetchImpl = globalThis.fetch,
  log = console.log,
} = {}) {
  const releaseVersion = requireReleaseVersion(version);
  const token = environment.HOMEBREW_TAP_TOKEN;
  if (!token) {
    if (environment.REQUIRE_HOMEBREW_SYNC === "1") {
      throw new Error("HOMEBREW_TAP_TOKEN is required for this release");
    }
    log("Homebrew formula sync skipped: HOMEBREW_TAP_TOKEN is not configured.");
    return { skipped: true };
  }
  if (typeof fetchImpl !== "function") throw new Error("fetch is required to synchronize the Homebrew formula");

  const metadataUrl = `https://registry.npmjs.org/${PACKAGE_NAME}/${releaseVersion}`;
  const metadata = await requireJson(await fetchImpl(metadataUrl), "npm registry lookup");
  const tarballUrl = metadata?.dist?.tarball;
  const expectedTarballUrl = `https://registry.npmjs.org/${PACKAGE_NAME}/-/${PACKAGE_NAME}-${releaseVersion}.tgz`;
  if (tarballUrl !== expectedTarballUrl) {
    throw new Error(`npm registry returned an unexpected tarball URL for ${PACKAGE_NAME}@${releaseVersion}`);
  }

  const tarballResponse = await fetchImpl(tarballUrl);
  if (!tarballResponse.ok) throw new Error(`npm tarball download failed with HTTP ${tarballResponse.status}`);
  const sha256 = createHash("sha256").update(Buffer.from(await tarballResponse.arrayBuffer())).digest("hex");
  const release = { version: releaseVersion, tarballUrl, sha256 };

  const contentsUrl = `https://api.github.com/repos/${TAP_REPOSITORY}/contents/${FORMULA_PATH}`;
  const headers = githubHeaders(token);
  const existingResponse = await fetchImpl(contentsUrl, { headers });
  let existing;
  let existingSha;
  if (existingResponse.status === 404) {
    existing = undefined;
  } else {
    const payload = await requireJson(existingResponse, "Homebrew formula lookup");
    if (typeof payload.content !== "string" || typeof payload.sha !== "string") {
      throw new Error(`Homebrew formula lookup returned an invalid Contents API payload for ${FORMULA_PATH}`);
    }
    existing = Buffer.from(payload.content, "base64").toString("utf8");
    existingSha = payload.sha;
  }

  const next = updateFormula(existing, release);
  if (next === existing) {
    log(`Homebrew formula is already current for ${PACKAGE_NAME}@${releaseVersion}.`);
    return { updated: false, release };
  }

  const updatePayload = {
    message: `chore(homebrew): bump engineering-harness to ${releaseVersion}`,
    content: Buffer.from(next).toString("base64"),
    branch: "main",
    ...(existingSha ? { sha: existingSha } : {}),
  };
  const updateResponse = await fetchImpl(contentsUrl, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(updatePayload),
  });
  await requireJson(updateResponse, "Homebrew formula update");
  log(`Updated ${TAP_REPOSITORY}/${FORMULA_PATH} for ${PACKAGE_NAME}@${releaseVersion}.`);
  return { updated: true, release };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  syncHomebrewFormula(process.argv[2]).catch((error) => {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
