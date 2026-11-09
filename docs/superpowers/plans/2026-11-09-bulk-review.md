# Bulk transfer review implementation plan

**Goal:** Confirm automation explicitly and apply review decisions to selected current proposals.
**Architecture:** Keep selection local to the existing automation dialog, keyed by mode, dialog ID and proposal signature. Reuse the existing guarded resolver for individual and bulk actions; yield between bounded batches and redraw once. Use the native confirmation overlay inside the top-layer rules overlay.
**Tech stack:** Shared injected JavaScript/CSS, Chromium harness, existing release workflow.
**Spec:** User request of 09.11.2026: confirmation popup, select all, similar destinations, selected confirmation/exclusions, centered accordion rotation; keep 8.0.69 unless Store requires an explicitly approved alternative.

## Constraints and review focus

- Selection never crosses changed proposals, users or deleted folders.
- Similarity uses mode and folder ID, not an ambiguous folder label.
- Cancellation, Escape and external config changes must not enable automation.
- Exclusions never move dialogues; changed or locked proposals cannot be accepted.
- Bulk work yields, exposes progress and suppresses duplicate actions.
- Run exact search-focused 16 and focused rule checks; no full registry. Publish one tested source only, verify update channel and Disk. Store already published 8.0.69; release choice is pending.

## Tasks

- [x] Update `extension/injected.js`: confirmation with draft preservation; local proposal selection; bulk resolver using existing freshness checks.
- [x] Update `extension/injected.css`: selection toolbar/card state and fixed 20px SVG chevron with centered transform origin.
- [x] Extend `tests/rules-settings-ui-regression.mjs`: cancellation/confirmation/keyboard focus and real chevron bounds. Add bulk UI cases through the same CI suite: both modes, matching IDs, partial/all selection, exceptions, stale proposals and scope changes.
- [x] Update manual/generated context; freeze source after focused checks. Verify exact CI profile and platform artifacts before delivery.
- [x] Replace authorized 8.0.69 release assets, publish and read back updater metadata, upload verified Disk files. Record limits and delivery proof in `docs/qa/release-8.0.69-bulk-review.md`.
- [ ] Store replacement requires a greater version. Current explicit request keeps 8.0.69; the question about an alternative has no answer. The already published Store package is unchanged.
