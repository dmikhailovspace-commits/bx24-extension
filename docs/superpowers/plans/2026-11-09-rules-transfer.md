# Rules transfer and resorting implementation plan

**Goal:** Preserve selected people during settings transfer, fix two-letter search, add mandatory conditions and explicit automatic acceptance with persistent exclusions.

**Architecture:** Keep validation and matching in native-catalog.js, scoped persistence and native UI in injected.js. Extend existing automation version 1 with optional backwards-compatible fields; no new polling or global observers.

**Tech Stack:** JavaScript, native DOM/CSS, Playwright fixtures, MV3 Chrome package, Windows installer.

**Spec:** User request 09.11.2026; contracts below.

## Contracts

- Version 8.0.67, local preview only. No remote publication or channel changes.
- IDs determine person matching; labels are display metadata. Old exports remain accepted.
- Every required condition must match. Any/all combines non-required conditions; no optional conditions means required ones suffice. Unknown required facts remain pending, never a match.
- Auto-accept is off by default, scoped to portal/user/mode, enabled explicitly in resorting. It accepts current and future non-dismissed valid proposals. Permanent locks always win. Import resets auto-accept off.
- Existing-dialog activation baseline is not a permanent lock. Only persistent locks are listed as exclusions.
- Exclusions start collapsed, preserve open state during refresh, animate without timers/observers; reduced-motion supported. Native navigation is reused.
- Context menu excludes its targeted selection from rule transfers, not manual folder moves.

## Work and verification

- [x] Model: reproduce label loss; preserve labels/canonical IDs/required flags, test any/all/unknown/inversion/transfer and import auto-accept reset.
- [x] Search: reproduce two-letter input issue, fix threshold/stale UI, hydrate old numeric selections with scoped directory reads. Test Unicode, stale results and errors.
- [x] Runtime: auto-accept current valid proposals, preserve one-time dismissal and locks, clear stale tickets on exclusion, test re-enable/disabled extension/pending data/removal.
- [x] UI: required toggle, auto-accept control, smooth exclusions accordion, native dialog navigation and contextual exclusion. Verify narrow and reduced-motion states.
- [x] Run affected model/UI/transfer suites and exact search-focused 16. Record actual coverage and limits.
- [x] Update context, build local Chrome ZIP/unpacked and Windows installer, verify matching runtime hashes; no Mac artifact without a macOS builder, no publication.
