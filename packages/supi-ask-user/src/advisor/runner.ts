import type { Api, Context, Model, ToolCall } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { completeSimpleModelRequest } from "@mrclrchtr/supi-core/llm";
import type { NormalizedQuestionnaire } from "../types.ts";
import { checkAdvisorAbort } from "./cancellation.ts";
import { ADVISOR_SYSTEM_PROMPT, snapshotAdvisorContext } from "./context.ts";
import { ADVISOR_PROJECT_TOOLS, AdvisorProjectTools } from "./project-tools.ts";
import { type AdvisorConfig, loadAdvisorConfig } from "./settings.ts";
import type { AdvisorReport, AdvisorRunner } from "./types.ts";
import { validateAdvisorReport } from "./validation.ts";

async function toolResult(
  tools: AdvisorProjectTools,
  call: ToolCall,
  permitted: boolean,
  signal: AbortSignal,
): Promise<{ text: string; isError: boolean }> {
  checkAdvisorAbort(signal);
  if (!permitted)
    return {
      text: "Tool budget exhausted. Return final JSON using available evidence.",
      isError: true,
    };
  try {
    const text = await tools.execute(call.name, call.arguments);
    checkAdvisorAbort(signal);
    return { text, isError: false };
  } catch {
    checkAdvisorAbort(signal);
    return {
      text: "Local tool unavailable or path excluded. Do not bypass project protections.",
      isError: true,
    };
  }
}

interface RunState {
  ctx: ExtensionContext;
  model: Model<Api>;
  config: AdvisorConfig;
  form: NormalizedQuestionnaire;
  context: Context;
  signal: AbortSignal;
  tools: AdvisorProjectTools;
}

async function appendResults(
  state: RunState,
  requested: ToolCall[],
  calls: number,
): Promise<number> {
  for (const call of requested) {
    checkAdvisorAbort(state.signal);
    const permitted = calls < state.config.maxToolCalls;
    if (permitted) calls++;
    const result = await toolResult(state.tools, call, permitted, state.signal);
    checkAdvisorAbort(state.signal);
    state.context.messages.push({
      role: "toolResult",
      toolCallId: call.id,
      toolName: call.name,
      content: [{ type: "text", text: result.text }],
      isError: result.isError,
      timestamp: Date.now(),
    });
  }
  return calls;
}

async function runLoop(state: RunState): Promise<AdvisorReport> {
  const { ctx, model, config, context, signal, tools, form } = state;
  let turns = 0;
  let calls = 0;
  while (true) {
    checkAdvisorAbort(signal);
    const toolsEnabled = turns < config.maxToolTurns && calls < config.maxToolCalls;
    context.tools = toolsEnabled ? ADVISOR_PROJECT_TOOLS : [];
    const response = await completeSimpleModelRequest(ctx, model, context, {
      affinityScope: "ask-user-advisor",
      reasoning: config.reasoning,
      signal,
    });
    checkAdvisorAbort(signal);
    if (response.stopReason === "error" || response.stopReason === "aborted")
      throw new Error("Advisor completion failed.");
    const requested = response.content.filter(
      (block): block is ToolCall => block.type === "toolCall",
    );
    if (!requested.length) {
      const json = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      const profile = {
        provider: config.provider,
        model: config.model,
        reasoning: config.reasoning,
      };
      return validateAdvisorReport(json, form, profile, tools.readSources);
    }
    // Final completion is allowed after exhaustion, but no additional tool turn.
    if (!toolsEnabled || requested.length > 100) throw new Error("Advisor exceeded tool budget.");
    context.messages.push(response);
    turns++;
    calls = await appendResults(state, requested, calls);
    checkAdvisorAbort(signal);
    if (turns >= config.maxToolTurns || calls >= config.maxToolCalls) {
      context.messages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: "Tool budget exhausted. No more tools. Return the final JSON report now.",
          },
        ],
        timestamp: Date.now(),
      });
    }
  }
}

/**
 * Lazy opt-in runner: no model/registry/context/file work until invoked AFTER acquiring the form
 * lock. Each invocation owns fresh context, budgets and read sources. Refresh answers enter only
 * through the explicit outcome, synchronously copied before the first await.
 */
export function createAdvisorRunner(ctx: ExtensionContext): AdvisorRunner {
  return async (questionnaire, outcome, signal) => {
    const signals = [ctx.signal, signal].filter((item): item is AbortSignal => !!item);
    const combined = AbortSignal.any(signals);
    checkAdvisorAbort(combined);
    try {
      const config = loadAdvisorConfig(ctx.cwd);
      const model = ctx.modelRegistry.find(config.provider, config.model);
      if (!model) throw new Error("Configured model unavailable.");
      const form = JSON.parse(JSON.stringify(questionnaire)) as typeof questionnaire;
      const context: Context = {
        systemPrompt: ADVISOR_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  questionnaire: form,
                  sessionEvidence: snapshotAdvisorContext(ctx),
                  ...(outcome === undefined ? {} : { outcomeSnapshot: outcome }),
                }),
              },
            ],
            timestamp: Date.now(),
          },
        ],
      };
      checkAdvisorAbort(combined);
      const tools = await AdvisorProjectTools.create(ctx.cwd, combined);
      checkAdvisorAbort(combined);
      return await runLoop({ ctx, model, config, form, context, signal: combined, tools });
    } catch {
      checkAdvisorAbort(combined);
      // biome-ignore lint/style/useErrorCause: provider/OS errors and causes may contain credentials.
      throw new Error(
        "Ask User advisor could not produce a valid report. Check its configured model and settings, then retry.",
      );
    }
  };
}
