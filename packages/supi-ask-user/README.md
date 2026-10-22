<div align="center">
  <a href="https://github.com/mrclrchtr/supi/tree/main/packages/supi-ask-user">
    <img src="https://raw.githubusercontent.com/mrclrchtr/supi/main/packages/supi-ask-user/assets/social-preview.png" alt="SuPi Ask User" width="100%">
  </a>
</div>

# @mrclrchtr/supi-ask-user — Ask-User Tool for Pi

[![GitHub stars](https://img.shields.io/github/stars/mrclrchtr/supi)](https://github.com/mrclrchtr/supi/stargazers) [![npm downloads](https://img.shields.io/npm/dm/@mrclrchtr/supi-ask-user)](https://www.npmjs.com/package/@mrclrchtr/supi-ask-user)

Adds `ask_user`, a structured decision-form tool for the [Pi coding agent](https://github.com/earendil-works/pi). The agent can collect related blocking decisions in one keyboard form and continue with structured answers.

## What it adds

- **One focused form** — one blocking form contains 1-10 related questions, with separate questions for independently answerable choices.
- **Choice and text questions** — choose one option, choose multiple options, or enter free-form text.
- **Recommendations** — the agent can select or prefill a suggested answer. You can change it.
- **Independent advisor** — a separately configured model reviews the session and form asynchronously, can inspect local project text, and returns all suggestions together. It never changes answers automatically.
- **Option context** — focused options can show descriptions, trade-offs, consequences, or code samples.
- **Comments at each level** — add a form comment, a question comment, or a comment on a selected or unselected option.
- **Review before submission** — inspect each answer, edit a question, and see unanswered items.
- **Structured results** — complete forms return `submitted`. Forms with unanswered questions return `needs_discussion`.

## Example requests

You can tell Pi when you want a structured handoff:

- “Before scaffolding the project, ask me about the package manager, test runner, and linting.”
- “If you find product decisions during implementation, collect the related questions into one form.”
- “Show the trade-offs beside each migration option before I choose.”
- “Ask me which findings to fix, and let me comment on individual choices.”

The agent is guided to complete available investigation first and ask about authorization or trade-offs—not whether to perform routine verification, provide status updates, or gather facts it can determine from the repository.

Related questions belong in one call, not one compound question. If you could choose different actions for two findings, each finding gets its own question. A shared policy that applies equally to both can remain one question. Options should not bundle combinations or defer already-known choices to a later form.

## Context for informed decisions

Assume the operator understands the domain, but has not followed the agent's investigation and does not know the specific problem, relevant code, or proposed solution. The form must be understandable without reading prior chat or tool output.

- **Form intro:** shared situation, goal, and relevant constraints.
- **Question prompt:** the specific problem, current behavior, why it matters, relevant findings and uncertainty, then the decision needed. Explain what referenced code does rather than listing symbols or paths without explanation.
- **Option description:** what the option changes and its main consequence or trade-off. Explain why the recommendation fits the situation.
- **Option details:** supporting rationale, examples, or code snippets. Do not hide essential problem context here; details are shown only when the option is focused.

Keep explanations decision-relevant: do not teach domain basics, dump the investigation transcript, or describe an unverified suspicion as a confirmed bug.

For example, instead of asking “Fix summary handling?”, explain: “The advisor uses session history to prepare advice. Source inspection suggests it may omit summaries that preserve earlier work after history is shortened or branched; this could leave advice without relevant context. This has not been reproduced. May I fix the omission if verification confirms it?” An option such as “Verify and fix if confirmed” should state that it changes which history the advisor receives and adds regression coverage, rather than promising a fix to an unconfirmed bug.

## How it works

1. The agent calls `ask_user` with related blocking decisions, separated into independently answerable questions.
2. Pi opens a keyboard-driven form and pauses the agent.
3. You answer, comment, or deliberately mark a question unanswered.
4. The review screen lets you edit the form before submitting.
5. The agent receives ordered, structured responses and continues from your decision.

Completed forms have the `decision` label in Pi's session tree. The result remains in chat history. Use the `app.tools.expand` keybinding (`Ctrl+O` by default) to expand it for read-only review.

## See it in action

<table>
  <tr>
    <td align="center">
      <img src="https://raw.githubusercontent.com/mrclrchtr/supi/main/packages/supi-ask-user/assets/ask-user-choice-details.png" width="100%" alt="Single-choice decision with a recommendation and side-by-side details" />
      <br/>Single choice with recommendation and details
    </td>
    <td align="center">
      <img src="https://raw.githubusercontent.com/mrclrchtr/supi/main/packages/supi-ask-user/assets/ask-user-multi-choice-details.png" width="100%" alt="Multi-select decision with recommendations and side-by-side details" />
      <br/>Multi-select with recommendation and details
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="https://raw.githubusercontent.com/mrclrchtr/supi/main/packages/supi-ask-user/assets/ask-user-text-input.png" width="100%" alt="Free-form text answer prefilled with a recommendation" />
      <br/>Text answer with a recommendation
    </td>
    <td align="center">
      <img src="https://raw.githubusercontent.com/mrclrchtr/supi/main/packages/supi-ask-user/assets/ask-user-question-comment.png" width="100%" alt="Question comment editor" />
      <br/>Question comment
    </td>
  </tr>
  <tr>
    <td colspan="2" align="center">
      <img src="https://raw.githubusercontent.com/mrclrchtr/supi/main/packages/supi-ask-user/assets/ask-user-review-form-comment.png" width="70%" alt="Review screen showing answers, an unanswered question, and a form comment" />
      <br/>Review answers, comments, and unanswered questions
    </td>
  </tr>
</table>

## Install

This package is in the recommended SuPi release stack. SuPi is pre-release.

Install it globally:

```bash
pi install npm:@mrclrchtr/supi-ask-user
```

Install it for one project:

```bash
pi install npm:@mrclrchtr/supi-ask-user -l
```

Try it for one run without a persistent install:

```bash
pi -e npm:@mrclrchtr/supi-ask-user
```

## Keyboard controls

The form shows context-specific key hints at the bottom.

| Key | Action |
|---|---|
| `↑` `↓` | Move through choices or review rows; at the first or last row, scroll surrounding content |
| `Alt+Page Up` / `Alt+Page Down` | Scroll the outer form while editing text or comments |
| `Space` | Select a single choice or toggle a multi-select option |
| `Enter` | Accept an answer, save text or comments, edit a review row, or submit the form |
| `←` `→` | Move between choice questions; `←` returns from review |
| `Tab` / `Shift+Tab` | Move forward or backward between questions |
| `c` / `Alt+C` | Comment on the current question (`Alt+C` for text questions) |
| `n` | Comment on the focused choice option |
| `u` / `Alt+U` | Mark the question unanswered (`Alt+U` for text questions) |
| `Esc` | Cancel the form; in a comment editor, discard unsaved comment text |
| `Alt+A` | Apply advice to the current question without advancing; for an outside option, open an editable question-comment draft |
| `Alt+I` | Expand/collapse advisor details (outside comment editors) |
| `Alt+R` | Refresh/retry advice using current answers and comments (outside comment editors) |

On wide terminals, option details appear beside the choices. On narrow terminals, they appear below the choices. Ask User uses up to 85% of the terminal height, capped at 36 rows. If a form is taller than its inline height limit, Ask User keeps the focused row visible and shows a scroll position indicator.

## Orca integration

In Orca-managed panes (`ORCA_PANE_KEY` is set), Ask User preserves Orca's terminal title on both form open and close. It still sounds the attention bell and hides Pi's local working indicator while the form is open. Pi's native custom-UI prompt lifecycle lets Orca report needs-input without ending the active agent turn; closing the form lets Orca resume working or idle as appropriate.

Orca's Pi status and title hooks must support `ui_prompt_start` / `ui_prompt_end`. Restart Pi after updating its runtime or Orca-managed hooks so the session loads the current integration. SuPi does not modify those generated hooks.

## Requirements, defaults, and limits

- `ask_user` requires Pi's interactive TUI and custom component support. The tool is only registered in TUI sessions and is not offered to the model in RPC, JSON, or print mode.
- The form itself needs no additional binary, service, or API key. The independent advisor uses the configured Pi provider and requires access to that model; failure does not block the form.
- Only one form can be active. The tool uses sequential execution, so sibling tool calls do not run beside a live form.
- Cancelling a form cancels the current agent turn. It does not record a user response.
- All questions are expected for a complete submission. Mark a question unanswered to request discussion.
- A form contains 1-10 questions. A choice question contains 2-12 options with unique values.
- If a single-choice question has no recommendation, the first option is selected. A multi-select question has no selection by default.
- Titles can contain 120 characters. Headers can contain 60 characters. Intros and prompts can contain 4,000 characters. Text placeholders can contain 200 characters.
- Ask User reuses a compatible Pi custom editor for text and comments. It uses the default editor if the custom editor is not compatible.
- The model-visible result is limited to Pi's default 2,000 lines or 50 KB. The structured result remains available in the session transcript.

## Independent advisor

The `ask_user` tool starts one independent analysis when its form opens. The form remains usable while a spinner and elapsed time show that the advisor is working. All validated suggestions appear together after one final response—there is no per-question publishing tool or live reasoning display.

The advisor favors the smallest sufficient reversible step rather than unnecessary caution. It can disagree with the author's `[recommended]` option, suggest one or several existing choices, draft a text answer, or propose an alternative outside the available options. Each question has its own rationale and optional comment about the question itself.

- `[advisor]` marks an existing suggested option separately from the author's recommendation.
- Advice appears below the question/options and Details panel. `Alt+I` reveals longer explanations, actual file-read sources, and the profile used. Review shows a summary for each question.
- Arrival of advice never changes selections, comments, focus, navigation, or submission. `Alt+A` applies an existing answer without advancing.
- An outside alternative opens an editable question-comment draft. Existing comments are retained and the draft is appended; only saving adopts it. `Esc` discards the draft.
- Initial analysis receives session evidence and the full form, not live edits. `Alt+R` takes a fresh snapshot including current answers and comments. Old advice remains visibly stale and cannot be applied while refreshing or after a failed refresh.
- Submitting, cancelling, aborting, or disposing the form cancels analysis and ignores late results. You never have to wait for the advisor to submit.
- Errors are shown without provider payloads or credentials. There are no automatic retries or model fallbacks. Valid recommendations from a partially invalid final response are retained; missing questions are marked unavailable.
- Unaccepted reports are ephemeral and are not appended to the transcript or sent to the primary agent. Only user answers and explicitly saved comments enter the tool result.

### Advisor settings

Use `/supi-settings` → **Ask User Advisor**, or the normal SuPi config files (`~/.pi/agent/supi/config.json` globally, `.pi/supi/config.json` for the project):

```json
{
  "ask-user-advisor": {
    "provider": "openai",
    "model": "gpt-6.1-sol",
    "reasoning": "medium",
    "maxToolTurns": 6,
    "maxToolCalls": 20
  }
}
```

These are the defaults. The profile is fixed independently of the primary agent and cannot be overridden by tool-call parameters. Model lookup and authentication use Pi's registry; a missing/inaccessible model shows an unavailable status without choosing another model. Config changes apply on the next analysis/refresh.

`maxToolTurns` accepts 0–30 and limits assistant turns executing tools. `maxToolCalls` accepts 0–100 and limits total executed calls. Zero disables inspection. After inspection is exhausted, one tool-free final completion is allowed. There is **no feature-level time limit**; provider/transport limits still apply.

The advisor receives the **full text history of the current session branch**, including original messages from before Pi compaction, earlier decisions, system instructions as evidence, and tool calls/results. It does not use compaction or branch summaries as substitutes, impose character caps, or silently trim history to fit. Explicit context edits remain authoritative; other branches, binary attachment data, tool details, and private reasoning are not included. If full history exceeds the model's capacity, analysis fails visibly rather than compacting it.

Its only tools are dedicated project-relative text read, literal search, and file listing. They do not inherit parent tools, execute shell commands, access the network, or write files. Reads/traversal/output are bounded; symlinks, hardlinked files, common credential/generated paths, and conservatively interpreted ancestor/nested Git ignore rules are excluded. Negations do not re-include excluded files; unsupported ignore syntax fails closed. These safeguards are not a general-purpose sandbox or a guarantee that ordinary source files contain no sensitive data.

## Model guidance configuration

You can change the model-facing tool description, prompt snippet, and guidelines. This configuration changes the instructions that Pi sends to the model. It does not change form behavior.

Use `~/.pi/agent/supi/config.json` for global configuration or `.pi/supi/config.json` for project configuration:

```json
{
  "ask-user": {
    "tools": {
      "ask_user": {
        "promptSurface": {
          "appendPromptGuidelines": [
            "Use ask_user for release decisions that need maintainer approval."
          ]
        }
      }
    }
  }
}
```

The extension applies package defaults, then global values, then trusted project values. It ignores project prompt overrides unless Pi trusts the project and finds a trust-requiring project resource, such as `.pi/settings.json`.

`promptSurface` accepts `description`, `promptSnippet`, `promptGuidelines`, `prependPromptGuidelines`, and `appendPromptGuidelines`. Use `$reset` with an array of `description`, `promptSnippet`, or `promptGuidelines` to restore those fields to package defaults. Run `/reload` after you edit the file.

## Public API

The package also provides a headless TypeScript API. Install the package and its schema dependency with your package manager:

```bash
pnpm add @mrclrchtr/supi-ask-user typebox
```

Import the explicit API subpath:

```ts
import {
  AskUserController,
  normalizeQuestionnaire,
  openAskUserForm,
  type AskUserOutcome,
} from "@mrclrchtr/supi-ask-user/api";

const questionnaire = normalizeQuestionnaire({
  questions: [
    {
      type: "text",
      id: "notes",
      header: "Notes",
      prompt: "What must the agent know?",
    },
  ],
});

const controller = new AskUserController(questionnaire);
const outcome: AskUserOutcome = controller.outcome();

// Open the full form from an extension context.
const result = await openAskUserForm(questionnaire, {
  ui: ctx.ui,
  signal: ctx.signal,
});
```

API callers do **not** start the advisor implicitly. To opt in with the caller's Pi session context:

```ts
import { createAdvisorRunner, openAskUserForm } from "@mrclrchtr/supi-ask-user/api";

const result = await openAskUserForm(questionnaire, {
  ui: ctx.ui,
  signal: ctx.signal,
  advisor: createAdvisorRunner(ctx),
});
```

The `advisor` option also accepts a custom `AdvisorRunner`. It must return one validated `AdvisorReport` for the supplied questionnaire, honor cancellation, and never mutate the supplied snapshots. It is invoked only after the shared form lock is acquired. The form owns cancellation and late-result suppression; API callers still own persistence and main-agent control flow.

`openAskUserForm()` uses the shared form UI in Pi's editor area and one lock for all callers. Pass `overlay: true` to use a focused overlay instead. It returns structured answers or a cancel/abort result. It does not write to the session transcript or call `ctx.abort()`; the caller owns those actions. A caller can pass its own `AbortSignal`.

The API exports `AskUserParamsSchema`, `normalizeQuestionnaire`, `AskUserValidationError`, `AskUserController`, and `openAskUserForm()`. It also exports types for the form UI, normalized questions, responses, outcomes, tool details, and cancel or abort interaction results. The package root is not an import surface. Use `/api` for the library or `/extension` for the Pi extension entrypoint.

The package ships TypeScript source. A standalone consumer must use a runtime or build tool that can load TypeScript.

## Privacy and security

Pi stores the tool result in the session. The active model receives a text summary of answers and comments. **The advisor makes separate model requests through your configured Pi provider**, sending the questionnaire, full uncompacted session text, and any local text it reads. Explicit refresh also sends the current answer/comment snapshot. This can incur additional provider charges. No external process is started; no unaccepted advisor report is added to the primary agent's context.

Like all Pi extensions, this package runs with your user permissions. Review the package source before installation.
