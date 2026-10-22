import type { AdvisorReport, AdvisorRunner } from "../advisor/types.ts";
import type { AskUserOutcome, NormalizedQuestionnaire } from "../types.ts";

/** Ephemeral advice is deliberately separate from the controller's user-owned answers. */
export interface FormAdvisorState {
  status: "working" | "ready" | "error";
  report?: AdvisorReport;
  error?: string;
  startedAt: number;
  expanded: boolean;
}

/** Owns one form's asynchronous analysis, cancellation, refresh generations and repaint timer. */
export class FormAdvisor {
  readonly state: FormAdvisorState = {
    status: "working",
    startedAt: Date.now(),
    expanded: false,
  };
  private abort?: AbortController;
  private generation = 0;
  private disposed = false;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly runner: AdvisorRunner,
    private readonly questionnaire: NormalizedQuestionnaire,
    private readonly changed: (layoutChanged: boolean) => void,
  ) {}

  start(outcome?: AskUserOutcome): void {
    if (this.disposed) return;
    this.abort?.abort();
    this.stopTimer();
    const generation = ++this.generation;
    const abort = new AbortController();
    this.abort = abort;
    this.state.status = "working";
    this.state.error = undefined;
    this.state.startedAt = Date.now();
    // Copy before dispatch: neither a custom runner nor later edits may mutate this snapshot.
    const form = structuredClone(this.questionnaire);
    const answers = outcome === undefined ? undefined : structuredClone(outcome);
    this.timer = setInterval(() => this.changed(false), 500);
    this.changed(true);
    void Promise.resolve()
      .then(() => {
        abort.signal.throwIfAborted();
        return this.runner(form, answers, abort.signal);
      })
      .then(
        (report) => {
          if (!this.isCurrent(generation)) return;
          this.state.report = report;
          this.state.status = "ready";
        },
        () => {
          if (!this.isCurrent(generation)) return;
          this.state.status = "error";
          // A reusable caller may throw provider errors containing credentials. Never render them.
          this.state.error =
            "Advice unavailable. Check the advisor model/settings and whether the full session exceeds its context window, then retry.";
        },
      )
      .finally(() => {
        if (!this.isCurrent(generation)) return;
        this.stopTimer();
        this.changed(true);
      });
  }

  toggleDetails(): void {
    this.state.expanded = !this.state.expanded;
    this.changed(true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.stopTimer();
    this.abort?.abort();
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && this.generation === generation;
  }

  private stopTimer(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }
}
