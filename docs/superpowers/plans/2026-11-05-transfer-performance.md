# Transfer and Chrome usability — 8.0.66

Goal: remove the exhausted-list notice, transfer sorting between desktop and Chrome, expose update information without clipping, reduce redundant work.

Architecture: shared native-catalog validates a versioned JSON snapshot. The native settings UI exports/imports only folder, group, assignment and rule data for the same authenticated portal/user. Import previews counts, explicitly confirms merge/overwrite of matching entries, retains unrelated local entries and saves a rollback snapshot. It does not transfer credentials, messages or timers. Existing dialogs remain subject to confirmation when rules disagree with their placement.

UI: Filters → Settings → Advanced → Transfer. Chrome update explanation is anchored to its button in a document-level overlay, clamped to viewport and dismissed on outside click/Escape.

Performance: inspect hot rendering/storage paths, remove demonstrably redundant work, preserve event and lifecycle behavior. Measure deterministic work counts in existing regression suites.

Validation: expand native-catalog-model, native-lazy-list, native-dom-mutation and chrome-browser coverage as relevant. Run exact 16-suite search-focused profile and project context check. No full test suite. Real-Mac and live-portal checks must not be claimed from fixtures.

Delivery: version bump and context; immutable GitHub source/Windows/macOS/Chrome release, public update-channel readback, replace files in existing Yandex version folder, upload Chrome package and submit updated review. Verify external state before claiming completion.
