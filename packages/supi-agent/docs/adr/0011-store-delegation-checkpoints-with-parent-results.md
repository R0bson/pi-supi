---
status: accepted
---

# Store Delegation Checkpoints with parent results

Retain child context in non-model parent result data so related tasks and implementation corrections can reuse it after the parent session is reopened. Each follow-up starts a new Agent Run; only stored task results establish checkpoints. Use Pi's existing branch and session-copy behavior instead of separate child files, accepting larger parent files and loss of uncollected work to avoid a second ownership and retention system.

## Consequences

- The [conversation design](../resumable-conversations.md) defines the implemented contract and verification requirements.
- Parent copies and JSONL exports include saved child context. Parent deletion and retention also apply to that context.
- [ADR 0009](0009-store-human-agent-run-transcripts-temporarily.md) still applies to temporary human-viewer transcripts; those files are not restoration data.
- [ADR 0010](0010-own-background-delegation-in-the-containing-session.md) still applies to active background work. Saved checkpoints can survive reopening, but active runs and uncollected results do not.
- A follow-up reports only new Usage, not Usage already present in restored child history.
