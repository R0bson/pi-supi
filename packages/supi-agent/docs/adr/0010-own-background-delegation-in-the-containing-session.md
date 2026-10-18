---
status: accepted
---

# Own background delegation in the containing session

For read-only Agent Profiles, make Delegation Batches background by default in TUI and RPC so the parent can continue. Keep each batch owned by its session and launch branch, and cancel it on parent abort or loss of ownership. Report Usage through per-task result collection, accepting incomplete parent totals until collection because Pi extensions cannot append late Usage records.

## Consequences

- This decision supersedes [ADR 0008](0008-keep-agent-runs-foreground-and-awaited.md).
- Preserve the mutation restrictions in [ADR 0001](0001-limit-parallel-delegation-to-read-only-profiles.md).
- Background runs do not survive session shutdown or restart.
- The [background delegation design](../background-delegation.md) defines the execution, delivery, cancellation, capacity, and accounting contracts.
