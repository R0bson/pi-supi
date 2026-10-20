import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

/** Render a bounded page request without showing saved child context. */
export function renderCall(args: unknown, theme: Theme): Text {
  const input = (args ?? {}) as { offset?: number; limit?: number };
  const page = input.offset ? ` · offset ${input.offset}` : "";
  const limit = input.limit ? ` · limit ${input.limit}` : "";
  return new Text(theme.fg("toolTitle", `Agent List${page}${limit}`), 0, 0);
}

/** Render only public conversation labels, profile IDs, and availability. */
export function renderResult(
  result: { content?: Array<{ type: string; text?: string }>; details?: unknown },
  options: { expanded: boolean; isPartial: boolean },
  theme: Theme,
): Text {
  if (options.isPartial) return new Text(theme.fg("dim", "Listing Agent Conversations…"), 0, 0);
  const details = result.details as
    | {
        total?: number;
        rows?: Array<{
          label: string;
          profileId: string;
          status: string;
          conversationId: string;
          reason?: string;
        }>;
      }
    | undefined;
  const rows = details?.rows ?? [];
  const text = rows.length
    ? rows
        .map(
          (row) =>
            `${row.conversationId} · ${row.label} · ${row.profileId} · ${row.status}${row.reason ? ` — ${row.reason}` : ""}`,
        )
        .join("\n")
    : "No saved Agent Conversations on this branch.";
  const count = details?.total ?? rows.length;
  return new Text(
    theme.fg("accent", `${count} saved Agent Conversation${count === 1 ? "" : "s"}\n${text}`),
    0,
    0,
  );
}
