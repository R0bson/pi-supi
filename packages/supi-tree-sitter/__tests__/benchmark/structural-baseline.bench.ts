import { resolve } from "node:path";
import { configureDebugRegistry, resetDebugRegistry } from "@mrclrchtr/supi-core/debug";
import { afterAll, beforeAll, describe, test } from "vitest";
import { createTreeSitterSession, type TreeSitterSession } from "../../src/api.ts";

const FIXTURE_DIR = resolve(import.meta.dirname, "../fixtures");
const FIXTURE_FILE = "structural-baseline.ts";
const BENCHMARK_OPTIONS = { iterations: 10, time: 500 };

let repeatedSession: TreeSitterSession;

function failureMessage(result: { kind: string; message?: string; reason?: string }): string {
  return result.reason ?? result.message ?? result.kind;
}

beforeAll(async () => {
  configureDebugRegistry({ enabled: true, maxEvents: 10_000 });
  repeatedSession = createTreeSitterSession(FIXTURE_DIR);
  const outlineWarmup = await repeatedSession.outline(FIXTURE_FILE);
  if (outlineWarmup.kind !== "success") {
    throw new Error(`Structural outline warmup failed: ${failureMessage(outlineWarmup)}`);
  }
  const queryWarmup = await repeatedSession.callSites(FIXTURE_FILE);
  if (queryWarmup.kind !== "success") {
    throw new Error(`Structural query warmup failed: ${failureMessage(queryWarmup)}`);
  }
});

afterAll(async () => {
  await repeatedSession.dispose();
  resetDebugRegistry();
});

describe("representative structural operation baselines", () => {
  const defineBaseline = (name: string, fn: () => Promise<void>) => {
    test(name, async ({ bench }) => {
      await bench(name, fn).run(BENCHMARK_OPTIONS);
    });
  };

  defineBaseline("cold parser and outline", async () => {
    const session = createTreeSitterSession(FIXTURE_DIR);
    try {
      const result = await session.outline(FIXTURE_FILE);
      if (result.kind !== "success")
        throw new Error(`Cold outline failed: ${failureMessage(result)}`);
    } finally {
      await session.dispose();
    }
  });

  defineBaseline("repeated parsed tree and outline", async () => {
    const result = await repeatedSession.outline(FIXTURE_FILE);
    if (result.kind !== "success")
      throw new Error(`Repeated outline failed: ${failureMessage(result)}`);
  });

  defineBaseline("cold parser, query compilation, and call sites", async () => {
    const session = createTreeSitterSession(FIXTURE_DIR);
    try {
      const result = await session.callSites(FIXTURE_FILE);
      if (result.kind !== "success")
        throw new Error(`Cold call sites failed: ${failureMessage(result)}`);
    } finally {
      await session.dispose();
    }
  });

  defineBaseline("repeated parsed tree, compiled query, and call sites", async () => {
    const result = await repeatedSession.callSites(FIXTURE_FILE);
    if (result.kind !== "success") {
      throw new Error(`Repeated call sites failed: ${failureMessage(result)}`);
    }
  });

  defineBaseline("post-restart cold parser and outline", async () => {
    await repeatedSession.dispose();
    repeatedSession = createTreeSitterSession(FIXTURE_DIR);
    const result = await repeatedSession.outline(FIXTURE_FILE);
    if (result.kind !== "success")
      throw new Error(`Post-restart outline failed: ${failureMessage(result)}`);
  });
});
