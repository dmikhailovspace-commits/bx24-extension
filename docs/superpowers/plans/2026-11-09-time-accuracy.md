# Time accuracy 9.0.1 Implementation Plan

**Goal:** Automatically converge to the current elapsed journal on opening/changing periods without requiring Refresh or Retry.
**Architecture:** Keep authoritative server journal reads and scoped caches. Bound cache lifetime independently of partial updates; recover missing/failed task reads with bounded retries fenced by scope, selected range and cache ownership. Never declare an unknown task irrelevant merely to hide incomplete coverage.
**Tech Stack:** Existing JavaScript runtime, VM regression fixtures, Windows/macOS release CI.

- [ ] Reproduce stale totals without a native event; add automatic revalidation without expiring the head of an ongoing long audit.
- [ ] Reproduce partial and superseded reads; retry only unresolved tasks, with bounded delays and cancellation on scope/range change.
- [ ] Verify transient errors recover, permanent failures stay honest, concurrent reads cannot overwrite newer data.
- [ ] Run affected time suites and the required search-focused release gate; bump 9.0.1, update context, freeze source and publish all delivery channels.
- [ ] Include the user's follow-up: remove the original-menu escape and duplicate native read/later commands; expose native pin/unpin/hide for the captured multi-selection with per-target context/permission revalidation; cover browser selection and callbacks in both chats/tasks.
