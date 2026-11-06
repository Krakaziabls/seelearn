# Design: Session Flow and Limits

## Context
See [proposal.md](proposal.md) and [specs/session-flow/spec.md](specs/session-flow/spec.md).

Currently, `StudyView` in `src/view.ts` handles candidate card filtering in `getFilteredCards()` and session queue initiation directly inside `startSession()`:
- `this.sessionQueue` is assigned after optional topic interleaving or shuffling.
- Card limits are hardcoded (`maxDuePerSession = 50`, `maxNewPerSession = 25`) and apply only in Test mode when queue filter is `'all'`.
- The exit/finish button was placed in `.seelearn-toolbar` without mode differentiation.
- Presets were rendered in `renderLobbyState` whenever `presets.length > 0 && this.isTestMode()`, without checking `srsFilter`.

## Goals / Non-Goals

**Goals:**
- Provide a clean, isolated Core module `src/session.ts` with pure function `prepareSessionPool`.
- Support user-selected card limit $N$ (`10`, `20`, `50`, `100`, `'all'`) configured in the lobby and applied uniformly to standard scope and test presets.
- Guarantee unbiased uniform random sampling by performing Fisher-Yates shuffle prior to slicing the pool to $N$ cards.
- Support linear review order (`linearSessionOrder`) for users studying textbooks or sequential lectures.
- Provide a dedicated, accessible exit button in the bottom navigation bar (`.seelearn-nav-bar`) exclusively in Learn mode («Ботать»), while strictly prohibiting exit buttons in Test mode («Проверка знаний»).
- Hide test presets in the lobby whenever SRS queue filters (`due`, `new`) are active.

**Non-Goals:**
- Modifying the underlying SM-2 mathematical progression logic or interval calculations in `src/srs.ts`.
- Changing the vault storage structure in `data.json`.
- Introducing multi-step wizard dialogs for session start.

## Decisions

### 1. Pure Core `prepareSessionPool` Architecture
**Decision**: Extract pool preparation into `src/session.ts`:
```ts
export interface PrepareSessionPoolOptions {
  limit?: number | 'all';
  shuffle?: boolean; // defaults to true unless linearSessionOrder is set
}

export function prepareSessionPool(
  cards: Flashcard[],
  options: PrepareSessionPoolOptions = {}
): Flashcard[] {
  const { limit = 'all', shuffle = true } = options;
  let pool = [...cards];
  if (shuffle) {
    pool = fisherYatesShuffle(pool);
  }
  if (typeof limit === 'number' && limit > 0 && limit < pool.length) {
    pool = pool.slice(0, limit);
  }
  return pool;
}
```
**Rationale**:
- Performing shuffle *before* slicing guarantees that every card in the deck has an identical probability $N / \text{total}$ of being included in the session (reservoir/random sampling). Slicing first and then shuffling would bias selection only to the first $N$ cards of the file system.
- Extracting to a pure function enables comprehensive automated unit testing without needing DOM or Obsidian mock environments.
**Alternatives considered**:
- Slicing first, then shuffling: rejected due to selection bias.
- Inlining inside `StudyView.startSession`: rejected because view components should not contain core algorithmic data transformations.

### 2. Session Exit Button Placement and Mode Isolation
**Decision**: Place `.seelearn-nav-exit-btn` in `.seelearn-nav-group.right` inside `.seelearn-nav-bar`:
```ts
// Inside renderNavBar():
if (this.sessionState === 'active' && !this.isTestMode()) {
  const exitBtn = rightNav.createEl('button', {
    cls: 'clickable-icon seelearn-btn-icon seelearn-nav-exit-btn',
    title: 'Завершить сессию и перейти к итогам',
  });
  setIcon(exitBtn, 'log-out');
  setTooltip(exitBtn, 'Завершить сессию и перейти к итогам');
  exitBtn.addEventListener('click', () => {
    this.sessionState = 'finished';
    this.renderAll();
  });
}
```
In Test mode (`this.isTestMode()`), `rightNav` remains empty, serving only as a visual flex spacer to keep center controls aligned.
Remove finish buttons from `seelearn-toolbar`.
**Rationale**:
- The bottom navigation bar is the focal point of interaction during card study.
- Learn mode is exploratory and benefits from an explicit, quick exit at any time.
- Test mode simulates an exam/retrieval test and requires commitment to avoid distraction and premature quitting.
- Transitioning to `'finished'` automatically persists all progress recorded so far (`sessionStats`, SRS reviews in storage).

### 3. Session Card Limit Selector in Lobby
**Decision**: Render interactive limit chips in `.seelearn-lobby-box` above the start button:
- Values: `[ 10 | 20 | 50 | 100 | Все ]`.
- Active chip styled with `.is-active`.
- Stored in `this.plugin.settings.sessionCardLimit` and persisted to `data.json`.
- When starting either a regular session or a test preset, pass `this.plugin.settings.sessionCardLimit` to `prepareSessionPool`.
**Rationale**:
- Segmented pills provide instant 1-click selection without opening secondary modals or typing in numeric inputs.

### 4. Context-Sensitive Lobby Preset Display
**Decision**: In `renderLobbyState()`:
```ts
const showPresets = this.srsFilter === 'all';
if (showPresets) {
  // Render presets section and save test button
}
```
**Rationale**:
- Test presets are saved filters over specific folders and tags. Showing them when the user specifically clicked "К повторению" or "Новые" is contradictory and clutters the lobby.

## Risks / Trade-offs

- **[Risk]** Pool smaller than selected limit $N$ (e.g. limit is 20, but deck has 7 cards).  
  → **Mitigation**: `prepareSessionPool` slices up to `pool.length`. If candidate count $\le N$, the entire pool is used without errors.
- **[Risk]** User sets limit $N$, but saved preset was intended to run all cards.  
  → **Mitigation**: The limit pill selected in lobby clearly displays the active value. If user wants all cards of a preset, they select «Все» in the lobby pills.
- **[Risk]** Accidental data loss on early exit in Learn mode.  
  → **Mitigation**: Any reviewed card has already updated `sessionStats` and local storage upon flipping/reading; clicking exit immediately transitions to the summary screen displaying exact metrics for cards reviewed.

## Migration Plan

1. Add `sessionCardLimit: 'all' | number` (default `'all'`) and `linearSessionOrder: boolean` (default `false`) to `SeeLearnSettings` in `src/types.ts`.
2. Existing settings in `data.json` will safely inherit defaults via `Object.assign({}, DEFAULT_SETTINGS, loadedData.settings)`.
