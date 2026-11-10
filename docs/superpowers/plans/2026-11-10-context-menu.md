# Context menu scroll and reload icon implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make long right-click menus usable on small Bitrix24 windows and use the same Chrome-style reload icon in all builds.

**Architecture:** Share the PENA menu mount/position logic, measure unanimated layout size, and reserve an internal scrollbar gutter. Preserve original Bitrix callbacks. Reuse the Google Material refresh SVG in the list, time, and extension update buttons.

**Tech Stack:** JavaScript, CSS, Chromium/Playwright, GitHub Actions.

**Spec:** PROJECT_CONTEXT.md, release 9.0.2.

## Global Constraints

- Start at the verified 9.0.1 source; preserve the previous release and its tag.
- Use the exact search-focused profile and existing supplemental CI checks; no full regression run.
- Deliver Windows, Universal macOS and Chrome from one frozen commit, then verify desktop update channel, Disk and Store.

## Review Focus

- Right and bottom edges, narrow and resized windows, long labels, native action expansion, and real wheel input at the end of a menu.

- [x] Extend the existing search-state browser check with a real bottom/right context click, viewport resize and wheel scroll to the native submenu.
- [x] Share mounting/positioning across PENA context menus and style the bounded scrollbar in both CSS copies. Keep wheel scroll inside the menu and existing dismiss behavior.
- [ ] Reuse the Material reload vector in the chat-list, time, and extension update buttons, preserving their hover/loading states.
- [x] Verify focused checks and publish all three packages and the desktop update channel.
- [ ] Upload the verified package to Chrome Web Store and replace the files in the existing Disk folder. Browser access stopped before upload.
