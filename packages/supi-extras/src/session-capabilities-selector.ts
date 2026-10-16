import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type {
  SessionCapabilityProfileSnapshot,
  SessionCapabilitySkill,
  SessionCapabilityState,
} from "@mrclrchtr/supi-core/session";
import {
  type CapabilityProfileAction,
  type CapabilityToolItem,
  createCapabilitySelector,
} from "./session-capabilities-ui.ts";
import type { CapabilitySection } from "./session-capabilities-ui-rows.ts";
import { createCapabilityProfileStore } from "./session-capability-profile-store.ts";
import {
  buildCapabilityProfileRows,
  runCapabilityProfileAction,
} from "./session-capability-profile-ui.ts";

interface SelectorOptions {
  ctx: ExtensionCommandContext;
  homeDir?: string;
  state: SessionCapabilityState;
  tools: CapabilityToolItem[];
  skills: SessionCapabilitySkill[] | undefined;
  onChange(id: string, value: string): void;
  onApply(profile: SessionCapabilityProfileSnapshot): void;
}

/** Close custom UI before built-in dialogs, then reopen Profiles with current configuration. */
export async function openCapabilitySelector(options: SelectorOptions): Promise<void> {
  const { ctx, state, tools, skills } = options;
  const store = createCapabilityProfileStore({
    cwd: ctx.cwd,
    homeDir: options.homeDir,
    isProjectTrusted: () => ctx.isProjectTrusted(),
  });
  let initialSection: CapabilitySection = "tools";
  while (true) {
    const profileRows = buildCapabilityProfileRows({
      catalog: store.read(),
      tools,
      skills,
      projectTrusted: ctx.isProjectTrusted(),
    });
    const action = await ctx.ui.custom<CapabilityProfileAction | undefined>(
      (tui, theme, _keys, done) =>
        createCapabilitySelector({
          state,
          tools,
          skills,
          profileRows,
          initialSection,
          theme,
          tui,
          done,
          onChange: options.onChange,
        }),
    );
    if (!action) return;
    try {
      await runCapabilityProfileAction(action, { ctx, store, state, apply: options.onApply });
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    }
    initialSection = "profiles";
  }
}
