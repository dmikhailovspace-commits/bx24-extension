# Rules preview 8.0.66 implementation plan

**Goal:** Verify every exposed automation condition, repair reproducible defects and deliver a local Chrome preview at version 8.0.66.

**Architecture:** Keep the shared condition model and native integration. Exercise the actual Chrome package in an isolated MV3 browser against synthetic Bitrix fixtures; do not mutate the user's portal. Existing manual assignments require explicit confirmation; unknown facts cannot authorize a transfer.

**Tech Stack:** JavaScript, Node, Playwright Chromium, existing native Bitrix harnesses.

**Spec:** User request of 2026-11-05: all conditions and updates work, saved rules collapsed on every editor opening, new rules and validation errors can open, internal preview only, same version, no GitHub/Store publication.

## Constraints
- Keep 8.0.66. No push, release, Store upload, update-channel or Disk writes.
- Preserve the released worktree and existing user modifications; work in this isolated checkout.
- No live portal writes, no replacement of the installed extension.

## Review focus
- Unknown or malformed person/status/date facts must not satisfy negative conditions.
- Changed titles and task metadata must reach rules without stale responses reverting them.
- New arrivals, existing baselines, manual moves and permanent exclusions stay distinct.
- Preview must explain all matches and pending facts without changing assignments.
- Accordion default, validation, narrow view and actual MV3 injection must agree.

## Tasks
- [x] Extend model matrix across every field/operator, true/false/unknown, all/any and priority; reproduce then fix defects in native-catalog.js.
- [x] Exercise runtime updates, safe proposals, stale responses and new arrivals; reproduce then fix integration defects in injected.js.
- [x] Change initial accordion state; test reopening, reload, adding, reordering and validation.
- [x] Add actual MV3 rule-panel coverage for title/type and task rules, preview, persistence and updating.
- [x] Run focused automation checks, then the full local regression gate authorized by this comprehensive audit; rerun affected checks after fixes.
- [x] Inspect UI screenshots. Build local Chrome ZIP/unpacked folder, verify version/hash/runtime and document limits and installation instructions.
