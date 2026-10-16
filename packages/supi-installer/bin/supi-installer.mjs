#!/usr/bin/env node
import { runCli } from "../src/cli.mjs";

const controller = new AbortController();
const cancel = () => controller.abort();
process.on("SIGINT", cancel);
process.on("SIGTERM", cancel);
try {
  process.exitCode = await runCli(process.argv.slice(2), { signal: controller.signal });
} finally {
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
}
