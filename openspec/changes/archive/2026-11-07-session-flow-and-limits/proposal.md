# Proposal: Session Flow and Limits

## Why

Currently in SeeLearn, starting a study session is an all-or-nothing process:
1. Users cannot set a maximum limit of $N$ cards to review in a single sitting, which creates cognitive fatigue when studying large decks or scopes (e.g. 200+ cards).
2. The exit button was located in the top toolbar rather than the bottom navigation bar, and was present in both Learn and Test modes, risking accidental premature exits during strict knowledge testing.
3. Card shuffling was coupled to an obscure setting, and didn't provide a fair, unbiased sample of $N$ cards from the available scope or allow easily toggling linear/sequential review.
4. When filtering the lobby by SRS queues ("К повторению" or "Новые"), the lobby still presented unrelated test presets that were built for different scopes and tags, confusing users.

This proposal refines session lifecycle, introduces a session limit control ($N$ or All), establishes an auto-shuffle pool preparation engine with linear review fallback, standardizes the in-session exit button in the bottom navigation bar strictly for Learn mode, and cleans up the lobby experience when filtering by SRS queues.

## What Changes

1. **Session Exit Button in Bottom Navigation Bar (`.seelearn-nav-bar`)**:
   - In **«Ботать» (Learn mode)**, an exit button (`clickable-icon seelearn-btn-icon seelearn-nav-exit-btn` with `log-out` icon) appears on the right side of `.seelearn-nav-bar` during active sessions.
   - Clicking the exit button finishes the session immediately, preserving all reviewed card progress and statistics in the summary screen and `data.json`.
   - In **«Проверка знаний» (Test mode / `.is-test`)**, the exit button in `.seelearn-nav-bar` is strictly prohibited and must NOT be rendered.
   - Remove redundant finish buttons from the top toolbar.

2. **Session Card Limit ($N$ or All)**:
   - Add a session card limit selector in `.seelearn-lobby-box` (e.g. options `Все`, `10`, `20`, `50`, `100` or custom numeric limit).
   - The selected limit $N$ applies to both regular sessions and Test Preset runs in both Learn and Test modes.
   - Setting persists in plugin settings (`sessionCardLimit: number | 'all'`).

3. **Lobby Context-Sensitive Preset Visibility**:
   - When filtering by `.seelearn-pill-due` («К повторению») or `.seelearn-pill-new` («Новые»), test presets and the "Сохранить как тест..." button are hidden from `.seelearn-lobby-box`, leaving only the card limit selector and start button.
   - Test presets and test saving are displayed only when the queue filter is «Все» (`srsFilter === 'all'`).
   - Enable SRS queue filter pills in the lobby for both Learn and Test modes so users can study only due or new cards in either mode.

4. **Auto-Shuffling & Pure Core Pool Preparation**:
   - Every session automatically shuffles the pool of matching cards using the Fisher-Yates algorithm before slicing to the limit $N$, ensuring a uniform unbiased sample.
   - Add a setting / toggle («Проходить линейно / по порядку» / `linearSessionOrder: boolean`) that disables shuffling and preserves note source order.
   - Extract pure function `prepareSessionPool(cards, { limit, shuffle })` into the Core layer (`src/session.ts`) with 100% test coverage in `tests/session.test.ts`.

## Capabilities

### New Capabilities
- `session-flow`: Manages the session pool preparation (fair random sampling, card limits, linear order), session exit navigation rules across Learn and Test modes, and queue-sensitive lobby controls.

### Modified Capabilities
<!-- None: help-system and onboarding requirements remain intact. -->

## Impact
- `src/types.ts`: Update `SeeLearnSettings` and `DEFAULT_SETTINGS` with `sessionCardLimit` and `linearSessionOrder`.
- `src/session.ts`: New pure core module containing `prepareSessionPool`.
- `src/view.ts`: Integrate `prepareSessionPool`, update `renderNavBar` with right-aligned exit button for Learn mode only, update `renderLobbyState` to conditionally hide presets on `due`/`new` and render limit pills, and make SRS pills available in lobby for both modes.
- `styles.css`: Styles for `.seelearn-nav-exit-btn` and `.seelearn-limit-pills` in lobby.
- `tests/session.test.ts`: Unit tests verifying `prepareSessionPool` sampling, slicing, and linear order.
