import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { recordDebugEvent, truncateDebugIdentity } from "@mrclrchtr/supi-core/debug";
import type { WorkspaceBudgetWarning } from "../tool/code_orientation/workspace-output.ts";

/** Keep soft-limit notices out of model content in every execution mode. */
export function reportWorkspaceBudget(
  ctx: ExtensionContext,
  warning: WorkspaceBudgetWarning | undefined,
  operationId?: string,
): void {
  if (!warning) return;
  const message = `Code Intelligence ${warning.surface} exceeds soft token budget: ${warning.estimatedTokens} estimated tokens (budget: ${warning.threshold})`;
  recordDebugEvent({
    source: "code-intelligence",
    level: "warning",
    category: warning.surface,
    cwd: truncateDebugIdentity(ctx.cwd),
    message,
    operationId,
    data: { estimatedTokens: warning.estimatedTokens, budget: warning.threshold },
  });
  if (ctx.hasUI) ctx.ui.notify(message, "warning");
}
