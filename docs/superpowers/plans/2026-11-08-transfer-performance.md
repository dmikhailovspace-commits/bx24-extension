# Responsive settings transfer implementation plan

Keep version 8.0.67 and preview-only delivery until user release approval.

User design: Settings directly exposes a plain Transfer action. No extra disclosure/card/help paragraph. Download file precedes explicit Build code. Build shows progress; Copy uses the finished code. Dialog/header/footer geometry stays stable across actions. Textareas fit content from one line to a bounded maximum. No background export generation.

Implementation:
- Parent: lazy cancellable snapshot and chunked JSON generation, cheap state fences, cached Copy/Download, no snapshot when opening or re-rendering settings. Deferred backup availability without loading large backup bodies. Record measurement and package preview.
- Model specialist: shared generator validator with synchronous and asynchronous facades, schema/error parity tests.
- UI specialist: direct Settings entry, fixed responsive dialog, reserved status/progress space, content-sized code fields.
- QA: old/new 4000/10000-dialog measurements, heartbeat/RAF during build, cancel/stale guards, stable geometry, copy cached, affected desktop/MV3 tests.

Acceptance: target panels open without any export snapshot; cooperative build gives main thread time; no export work on copy. Same closed transfer schema, scoped import/undo and quota behavior. Run affected tests + exact search-focused16, verify packages against frozen source. No public release, update-channel, Disk or Store changes.
