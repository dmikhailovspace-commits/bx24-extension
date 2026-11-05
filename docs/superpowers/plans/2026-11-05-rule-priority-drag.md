# Rule priority and release notes implementation plan

**Goal:** Make ordered rule precedence clear, replace arrow buttons with pointer dragging and show short release notes across Chrome/desktop in internal 8.0.66.

**Architecture:** Preserve first-match model and confirmation journal. Reorder only the editor draft until Save. Pointer capture, insertion marker and bounded scroll animation belong to the editor and are cleaned up on drop/cancel/close. Preview reports overlapping matches and their winning rule. Shared bundled release-note rendering supplies installed-version notes; desktop can render validated remote notes for a newer version.

**Tech Stack:** Existing JavaScript, CSS, MV3, Playwright, Node.

**Spec:** Explicit user request: same local build/version, drag with left mouse and visible insertion position; clarify dominant rules; concise changelog in update UI with secondary platform update guidance. No publication or installer release.

## Decisions
- First enabled matching rule wins; missing data in an earlier possible rule blocks lower ones. Specificity never silently overrides explicit order.
- Drag handle replaces arrow buttons. Alt+Up/Down on that handle remains a keyboard alternative. Threshold prevents accidental drag; Escape/outside/cancel leaves draft order unchanged. Autoscroll supports long lists.
- Existing placements remain subject to confirmation after priority changes; permanent exclusions remain authoritative.
- Update notes are plain text, bounded, and separate from install consent/status. Chrome does not fetch or install remote executable code.

## Tasks
- [x] Add pointer reorder and visible priority/overlap explanation; preserve collapsed state, draft cancellation and persistence.
- [x] Add collapsed on/off switches, same-folder conflict suppression and live/lookup/dirty-fact badge refresh.
- [x] Add priority model/journal and browser drag tests: up/down/end, cancellation, auto-scroll, expanded cards, pending preview, save/reopen, narrow layout.
- [x] Add shared installed release notes and desktop remote changelog; test safe rendering and platform instructions.
- [x] Run affected suites, full gate, context verification; rebuild and verify local 8.0.66 preview. Publish nothing.
- [ ] New user instruction supersedes the internal-only restriction: after verification, replace GitHub release and Store submission under 8.0.66; preserve old release, verify frozen CI artifacts and public update channel, update delivery folder.
