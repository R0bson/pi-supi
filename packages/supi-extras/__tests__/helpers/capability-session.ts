import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { footerContributions } from "@mrclrchtr/supi-core/footer-registry";
import {
  clearPendingSessionCapabilityForks,
  sessionCapabilityState,
} from "@mrclrchtr/supi-core/session";
import { createPiMock, getHandlerOrThrow, makeCtx } from "@mrclrchtr/supi-test-utils";
import { vi } from "vitest";
import sessionCapabilities from "../../src/session-capabilities.ts";
import { createCapabilityProfileStore } from "../../src/session-capability-profile-store.ts";

interface Selector {
  render(width: number): string[];
  handleInput(data: string): void;
}

/** A real capability extension with temporary configuration and a Pi host mock. */
export function capabilitySession() {
  const root = mkdtempSync(join(tmpdir(), "capability-session-"));
  const cwd = join(root, "project");
  const homeDir = join(root, "home");
  const entries: Array<Record<string, unknown>> = [];
  let active = ["read", "first", "second"];
  const tools = ["read", "first", "second", "inactive"].map((name) => ({
    name,
    description: `${name} description`,
    sourceInfo: { source: name === "read" ? "builtin" : "example", path: `/${name}.ts` },
  }));
  const pi = createPiMock();
  pi.getAllTools = vi.fn(() => tools);
  pi.getActiveTools = vi.fn(() => [...active]);
  pi.setActiveTools = vi.fn((names: string[]) => {
    active = [...names];
  });
  pi.appendEntry = vi.fn((customType: string, data: unknown) => {
    entries.push({ type: "custom", customType, data: structuredClone(data) });
  });
  const ctx = makeCtx({
    cwd,
    isIdle: vi.fn(() => true),
    waitForIdle: vi.fn(async () => {}),
    sessionManager: {
      getSessionId: () => root,
      getSessionFile: () => undefined,
      getEntries: () => entries,
      getHeader: () => null,
    },
  }) as unknown as ExtensionCommandContext;
  ctx.ui.select = vi.fn(async () => undefined);
  ctx.ui.confirm = vi.fn(async () => true);
  let selector: Selector | undefined;
  ctx.ui.custom = vi.fn(
    (factory) =>
      new Promise((resolve) => {
        selector = factory(
          { requestRender: vi.fn() } as never,
          ctx.ui.theme,
          {} as never,
          resolve,
        ) as Selector;
      }),
  ) as ExtensionCommandContext["ui"]["custom"];
  const store = createCapabilityProfileStore({
    cwd,
    homeDir,
    isProjectTrusted: () => ctx.isProjectTrusted(),
  });
  sessionCapabilities(pi as unknown as ExtensionAPI, { homeDir });
  const command = pi.getCommandHandler("supi-capabilities") as (
    args: string,
    ctx: ExtensionCommandContext,
  ) => Promise<void>;
  return {
    root,
    cwd,
    homeDir,
    pi,
    ctx,
    store,
    entries,
    tools,
    active: () => [...active],
    state: () => sessionCapabilityState.get(root),
    selector: () => selector,
    open: () => command("", ctx),
    event: (name: string, event: Record<string, unknown>) =>
      getHandlerOrThrow(pi, name)(event, ctx),
    cleanup: () => {
      sessionCapabilityState.clear(root);
      clearPendingSessionCapabilityForks();
      footerContributions.clear();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Select a searchable row and choose its action by menu position. */
export function chooseRow(selector: Selector | undefined, text: string, action = 0): void {
  if (!selector) throw new Error("Selector is not open");
  for (const character of text) selector.handleInput(character);
  selector.handleInput("\r");
  for (let index = 0; index < action; index++) selector.handleInput("\u001b[B");
  selector.handleInput("\r");
}
