# Tasks

## 1. Settings and Core Session Pool Logic

- [x] 1.1 Add `sessionCardLimit` (`'all' | number`) and `linearSessionOrder` (`boolean`) to `SeeLearnSettings` and `DEFAULT_SETTINGS` in `src/types.ts`, verifying with `npm run build`.
- [x] 1.2 Implement pure function `prepareSessionPool(cards, options)` in `src/session.ts` with shuffle-before-slice sampling and linear order support.
- [x] 1.3 Add automated unit tests in `tests/session.test.ts` covering default auto-shuffle, unbiased limit slicing, linear sequential ordering, and small pool edge cases, verifying with `npm test`.

## 2. In-Session Navigation and Exit Flow

- [x] 2.1 Add early exit button (`.seelearn-nav-exit-btn`) with `log-out` icon in `.seelearn-nav-group.right` in `src/view.ts` for active Learn mode sessions, ensuring progress is preserved and summary is shown on click.
- [x] 2.2 Enforce strict prohibition of exit button in Test mode (`.is-test`) in `src/view.ts`, leaving `.seelearn-nav-group.right` empty in navigation bar.
- [x] 2.3 Remove redundant legacy finish session controls from `.seelearn-toolbar` in `src/view.ts`.

## 3. Lobby Controls and Queue-Sensitive Visibility

- [x] 3.1 Implement session card limit selector (`.seelearn-limit-pills`) in `.seelearn-lobby-box` in `src/view.ts` with options `[10, 20, 50, 100, Все]` updating `settings.sessionCardLimit`.
- [x] 3.2 Update `StudyView.startSession()` and `startTestPreset()` in `src/view.ts` to use `prepareSessionPool` with active limit and linear order settings.
- [x] 3.3 Restrict test presets section and test save button visibility in `.seelearn-lobby-box` to only show when `srsFilter === 'all'`.
- [x] 3.4 Enable SRS queue filter pills in lobby for both Learn and Test modes.

## 4. Styling and Verification

- [x] 4.1 Add CSS styling in `styles.css` for `.seelearn-nav-exit-btn`, `.seelearn-limit-selector`, and `.seelearn-limit-pills` using native Obsidian CSS variables.
- [x] 4.2 Run complete automated test suite and type check via `npm run verify` (`npm test` and `npm run build`).
- [x] 4.3 Perform visual and interactive verification in Obsidian via Chrome DevTools MCP verifying exit button, limit selector, and preset hiding.
