import { visibleWidth } from "@earendil-works/pi-tui";
import { makeCtx } from "@mrclrchtr/supi-test-utils";
import { describe, expect, it, vi } from "vitest";
import { AgentsDialog } from "../../src/ui/agents-overlay.ts";
import type { AgentsDialogDependencies } from "../../src/ui/agents-overlay-data.ts";
import { runListPreview } from "../../src/ui/agents-run-list.ts";
import { makeAgentsRun } from "../helpers/agents-viewer-fixtures.ts";

function dependencies(rows = 24): AgentsDialogDependencies {
  return {
    theme: makeCtx().ui.theme as never,
    done: vi.fn(),
    tui: { requestRender: vi.fn(), terminal: { rows } },
    onSteer: vi.fn(async () => "queued" as const),
    onStop: vi.fn(async () => "accepted" as const),
  };
}

describe("Agent Run usage status", () => {
  it("states that uncollected usage is absent from parent totals", () => {
    const run = makeAgentsRun({
      active: false,
      status: "completed",
      result: {
        finalText: "Done.",
        display: { usageStatus: "uncollected" },
      },
    });

    const preview = runListPreview(run).join("\n");
    expect(preview).toContain("Usage uncollected");
    expect(preview).toContain("not included in parent totals");

    const dialog = new AgentsDialog({ runs: [run] }, dependencies());
    expect(dialog.render(60).join("\n")).toContain("not included in parent totals");
    dialog.handleInput("\n");
    const lines = dialog.render(60);
    const text = lines.join("\n");
    expect(text).toContain("Usage uncollected");
    expect(text).toContain("not included in parent totals");
    expect(lines.every((line) => visibleWidth(line) <= 60)).toBe(true);
  });

  it("shows reported usage quietly and does not add a notice without status", () => {
    const reported = makeAgentsRun({
      active: false,
      status: "completed",
      result: { finalText: "Done.", display: { usageStatus: "reported" } },
    });
    const reportedText = runListPreview(reported).join("\n");
    expect(reportedText).toContain("Usage reported");
    expect(reportedText).not.toContain("parent totals");

    const metadataStatus = makeAgentsRun({ display: { usageStatus: "uncollected" } });
    expect(runListPreview(metadataStatus).join("\n")).toContain("not included in parent totals");

    const collected = makeAgentsRun({
      display: { usageStatus: "uncollected" },
      result: { display: { usageStatus: "reported" } },
    });
    const collectedText = runListPreview(collected).join("\n");
    expect(collectedText).toContain("Usage reported");
    expect(collectedText).not.toContain("parent totals");

    const unchanged = makeAgentsRun({
      active: false,
      status: "completed",
      display: { target: "Filesystem changes" },
      result: { finalText: "Done.", display: { target: "Filesystem changes", verdict: "pass" } },
    });
    expect(runListPreview(unchanged).join("\n")).not.toContain("Usage");
  });
});
