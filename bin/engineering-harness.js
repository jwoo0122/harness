#!/usr/bin/env node

import { runCli } from "../lib/launcher.js";

runCli().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exitCode = 1;
});
