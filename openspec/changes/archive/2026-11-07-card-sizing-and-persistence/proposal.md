# Proposal

## Why

Currently, flashcards during study sessions occupy an inconsistent and oversized footprint compared to the deck overview lobby (`.seelearn-lobby-box`). While `.seelearn-lobby-box` uses a focused `max-width: 640px` with natural height proportions, `.seelearn-card-container` is hardcoded to `max-width: 820px` and stretches to `height: 100%`, often creating vast empty space on simple vocabulary cards or breaking visual continuity between lobby and study mode. 

Furthermore, users frequently encounter cards with complex, dense markdown: multi-column comparison tables, large code blocks, or wide Mermaid/image diagrams. Users have no way to enlarge individual complex cards without stretching the entire Obsidian workspace. Conversely, when users switch between desktop PC and mobile phone, static sizing creates suboptimal viewing ergonomics.

By introducing default card dimensions matching the lobby, an instant fullscreen toggle (`maximize-2` / `minimize-2`), an interactive drag-to-resize handle at the bottom-right corner, a discrete preset scale (`xs` through `xl` + `full`), and persistent per-card size storage in `data.json`, users gain complete visual control over their learning experience while maintaining zero note pollution.

## What Changes

1. **Default Base Dimensions Harmonized with Lobby (PC vs Mobile):**
   - Align default card size (`m`) with `.seelearn-lobby-box` dimensions: `max-width: 640px` on desktop, with proportional base height (`min-height: 380px; max-height: 520px; height: 460px;`).
   - Adaptive sizing for mobile: on phones (`Platform.isMobile` / `.is-mobile`), both lobby and cards naturally stretch to `width: 100%; max-width: 100%; height: 100%` within comfortable viewport padding.
2. **Fullscreen Workspace Toggle Button:**
   - Add an icon button in `.seelearn-card-header` on the right (adjacent to `.seelearn-jump-btn`) with Lucide icons `maximize-2` / `minimize-2`.
   - Clicking expands the card to 100% width and 100% height of `.seelearn-card-area` (`full` mode), while clicking again restores the card to its previous size.
3. **Interactive Corner Resize Handle (`.seelearn-card-resize-handle`):**
   - Position an unobtrusive resize grip at the bottom-right of `.seelearn-card-container` supporting mouse drag and touch gestures.
   - Sizing system based on predefined standard steps:
     - `xs`: `max-width: 480px`, `height: 340px`
     - `s`: `max-width: 560px`, `height: 400px`
     - `m` (default): `max-width: 640px`, `height: 460px` (matches lobby)
     - `l`: `max-width: 800px`, `height: 560px`
     - `xl`: `max-width: 960px`, `height: 660px`
     - `full`: fills 100% width and 100% height of the card area
   - Dragging dynamically resizes the container within boundaries, snapping or mapping to discrete size presets or custom width/height.
4. **Per-Card Size Persistence:**
   - Store the user's chosen size for a specific card by `cardId` in `data.json` (inside `cardSizes: Record<string, CardSizeSetting>` or in `CardProgressRecord`).
   - When navigating cards during a session, if a card has a saved size, it automatically renders at that size. If not, it falls back to the default `m` size.
   - Zero note pollution: note content is never modified.

## Capabilities

### New Capabilities
- `card-sizing`: Base card dimensions harmonized with lobby (PC vs Mobile), fullscreen toggle button in card header, interactive bottom-right resize handle (`xs`–`xl`, `full`), and per-card size persistence in storage by `cardId`.

### Modified Capabilities
<!-- None. Existing capabilities (session-flow, help-system, onboarding) remain unchanged. -->

## Impact

- **Storage / Data Schema (`src/types.ts` & `src/storage.ts`):**
  - Add `CardSizePreset = 'xs' | 's' | 'm' | 'l' | 'xl' | 'full'` and `CardSizeSetting` (preset or custom dimensions) to `SeeLearnStorageData` or `CardProgressRecord`.
  - Add helper methods in `StorageManager` to get and set card size preferences by `cardId`.
- **View & Lifecycle (`src/view.ts`):**
  - Card rendering mounts the fullscreen toggle in `cardHeader` next to `jumpBtn`.
  - Mount `.seelearn-card-resize-handle` in `cardContainer`.
  - Apply size class or CSS custom properties dynamically when rendering each card.
  - Implement drag listeners (mouse & touch) with cleanup.
- **Styling (`styles.css`):**
  - Classes `.seelearn-size-xs`, `.seelearn-size-s`, `.seelearn-size-m`, `.seelearn-size-l`, `.seelearn-size-xl`, `.seelearn-size-full`.
  - Styling for `.seelearn-card-fullscreen-btn` and `.seelearn-card-resize-handle`.
  - Harmonized `.seelearn-lobby-box` and `.seelearn-card-container` desktop/mobile rules.
- **Dependencies & Performance:**
  - Zero external runtime dependencies; uses Obsidian Lucide icons and native pointer/touch events.
