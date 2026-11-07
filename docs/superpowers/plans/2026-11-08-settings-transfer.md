# Settings and portable sorting implementation plan

**Goal:** Repair export/import in shared Chrome/desktop runtime, simplify existing settings and remove rule intersection indicators.

**Architecture:** Retain the scoped closed-schema v1 transfer format and confirmed merge/undo. Treat empty taskId as absence. Present file and code transfer in one scrollable dialog reached from the existing filter/settings panel, with no additional tab. Remove background intersection counting and badges; keep first-match priority and explicit preview.

**Tech Stack:** Existing JavaScript/CSS, Node model tests and Chromium MV3 fixtures.

**Spec:** User delegates design decisions. Existing panel uses grouped controls, readable spacing, one collapsed advanced section. Transfer offers file export plus selectable/copyable JSON fallback for desktop hosts. Import validates scope/size/schema before confirmation, reports counts and preserves undo. No message content or authentication data exported.

## Constraints and review focus
- Preserve version 8.0.66 as most recent explicit release constraint; do not change release assets until checks pass.
- Empty task IDs from real ordinary-chat records must export; invalid nonempty IDs must fail.
- Clipboard failure or absent host downloads must leave usable selectable code.
- Stale file reads, edited code, closed dialog and user changes must never enable stale confirmation.
- Full import backup must survive failed writes; undo must work across reopen.
- Layout must scroll at 360px and short viewports; focus and Escape must work.

## Tasks
- [x] Reproduce empty taskId failure in tests/native-catalog-model.mjs; repair extension/native-catalog.js and verify strict round trip.
- [x] Rebuild _openSortingTransfer in extension/injected.js with explicit file/code export and import validation; retain safe commit/backup and add accessible status/layout in extension/injected.css.
- [x] Group existing filter/settings controls, flatten nested settings details; remove conflict counter implementation/styles, update relevant browser tests.
- [x] Verify model, Chrome transfer, shared desktop fixture, rules drag/races, responsive screenshots and exact release profile; update PROJECT_CONTEXT.md and delivery documentation. Local final search-focused 16/16 in 390.5s; source 98133cb; Chrome package f96d1439…; rules drag 7 phases, preview races 9 phases and release notes passed separately.
- [x] Retrieve verified Windows/macOS preview installers from CI 42415082497; sidecars, frozen source and identical local/CI Chrome package verified. Public 8.0.66 is already published in Chrome; next release version awaits user response, so no public assets/channel/Store submission are changed.
