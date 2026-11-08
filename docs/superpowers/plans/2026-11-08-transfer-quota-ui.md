# Transfer reliability and layout correction

Version stays **8.0.67**. User explicitly requires release approval before publication. This task produces a tested preview only: do not replace the public tag, release, update channel, Disk distribution or Chrome Web Store package.

## Design

Keep the original filters unchanged. The transfer dialog shows a populated, read-only export code immediately, with its copy button below. Successful copying changes the button to «Скопировано»; denied clipboard access offers manual copying without a false success state. Use existing typography, consistent spacing and restrained hover/press/focus transitions with reduced-motion support. All controls must remain reachable on small and short windows, without relying on the host page's box-sizing reset.

Import must create a usable undo record without duplicating a large snapshot into already-full localStorage. A backup failure must leave settings untouched. A commit failure must restore all touched keys and preserve the previous undo record. Restore must remain scoped and survive reopening the panel; cross-tab and identity changes must not apply stale data.

## Responsibilities

- Storage specialist: backup storage, transaction/rollback, import/undo handlers and dedicated storage regression.
- Interface specialist: transfer markup/export/copy and scoped styles. No filter redesign.
- QA specialist: shared desktop/Chrome UI acceptance, copy success/failure, expanded and host-style layout checks.
- Parent: integration review, context, exact search-focused gate plus affected tests, frozen preview packaging and delivery.

## Acceptance

- [x] Reproduce quota failure and prove safe import/undo with nearly-full localStorage.
- [x] Exercise failed commit and failed backup, stale scope/confirmation and reopen.
- [x] Verify code is populated before interaction; copy button follows code and reports real success.
- [x] Inspect screenshots at regular/narrow/short widths; test real scrolling and host content-box styles.
- [ ] Run affected tests and exact 16-suite release profile; keep tests tied to the packaged source.
- [ ] Deliver preview 8.0.67 with evidence and known live-host limits. Await user release approval.
