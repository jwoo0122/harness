import { appendFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || "")) {
  throw new Error(`expected a semantic release version, received: ${version || "(empty)"}`);
}
if (!process.env.GITHUB_OUTPUT) {
  throw new Error("GITHUB_OUTPUT is required when recording a release version");
}

appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
