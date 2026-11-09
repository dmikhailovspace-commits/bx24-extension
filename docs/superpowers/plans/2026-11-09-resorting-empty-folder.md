# Empty-folder resorting Implementation Plan

> **For agentic workers:** Execute the following checks in this session; the user explicitly requested the fix and replacement release.

**Goal:** Never request a resort from an unassigned dialog or to its current folder.

**Architecture:** Correct the shared page integration used by desktop and Chrome. Retain activation snapshots, permanent exceptions, manual root placements, and durable journal writes. Distinguish different folders with identical names in proposal labels.

**Tech Stack:** JavaScript, VM regression fixtures, Playwright, PowerShell, native GitHub Actions builds.

**Spec:** User instructions of 09.11.2026 and PROJECT_CONTEXT.md.

## Global Constraints

- Latest user decision: release version 8.0.69, on GitHub, the public update channel, Chrome Web Store and the existing Yandex folder.
- Run the exact search-focused 16 suites and seven rules suites; no full registry.
- Build all packages from one frozen source commit; preserve the existing 8.0.68 release.

## Review Focus

- A new dialog first fails a rule, then matches after facts arrive: assign directly once.
- An old unassigned dialog in the activation snapshot: leave untouched unless explicitly included.
- An already handled dialog manually moved to root: do not offer a transfer or undo the move.
- A stale ticket after manual placement or journal quota failure: never show or accept a no-op.
- Different folder IDs with the same title: retain the valid move and distinguish the labels.

## Task 1: Correct and verify shared automation

- [x] Extend rules-resorting-regression.mjs for both modes and prove failures before editing runtime.
- [x] Update _applyDialogAutomation and _dialogAutomationTickets in extension/injected.js; validate current placement at confirmation.
- [x] Update rules-preview-races-regression.mjs for unassigned dialogs and duplicate folder labels; retain the assigned-dialog dismissal scenario.
- [x] Run affected regressions, seven rules suites and exact search-focused; update release notes and project context.

## Task 2: Replace the release

- [x] Freeze and push source; build Windows, macOS and Chrome through the existing gated workflow.
- [x] Verify artifact hashes and source identity; publish v8.0.69 assets and publish main/update.json with public readback.
- [x] Replace the Store submission and the six files in the existing Yandex folder, verify results, document actual platform status.

Self-review: every requested behavior and each failure mode above has a target regression. Google rejected the already-published number; the user authorized 8.0.69 everywhere. Release, update channel and Yandex verified; Store submission accepted for automatic publication after review.
