# Design

## Context

Flashcards in SeeLearn are rendered dynamically within `StudyView` (`src/view.ts`) inside `.seelearn-card-wrapper` and `.seelearn-card-area`. Currently, `.seelearn-card-container` uses static CSS (`max-width: 820px; height: 100%`), whereas the lobby (`.seelearn-lobby-box`) uses `max-width: 640px; width: 100%`. There is currently no mechanism for card resizing, fullscreen toggling, or persisting per-card visual layout. All data persistence in SeeLearn is governed by `StorageManager` (`src/storage.ts`) backed exclusively by `<vault>/.obsidian/plugins/seelearn/data.json` under strict Zero Note Pollution constraints.

See `proposal.md` for user motivation and problem statement.

## Goals / Non-Goals

**Goals:**
- Provide consistent default visual footprint matching `.seelearn-lobby-box` on desktop (`max-width: 640px`) and responsive adaptation on mobile.
- Implement an instant fullscreen expansion toggle (`maximize-2` / `minimize-2`) in `.seelearn-card-header` right actions.
- Implement an interactive corner drag-to-resize handle (`.seelearn-card-resize-handle`) in the bottom-right corner of `.seelearn-card-container`.
- Provide a discrete sizing scale (`xs`, `s`, `m` [default], `l`, `xl`, `full`).
- Persist individual card sizes by `cardId` in `data.json` without any note modifications.
- Gracefully fall back to default size (`m`) for cards without custom saved sizes.

**Non-Goals:**
- Free-form floating window/modal detachment: cards remain mounted within the plugin's `StudyView` tab.
- Persisting card position coordinates (x, y offsets): cards remain centered in `.seelearn-card-area`.
- Modifying markdown frontmatter or inline comments to store card sizing.

## Decisions

### 1. Dedicated `cardSizes` Mapping in `SeeLearnStorageData` vs `CardProgressRecord`
- **Decision:** Store card size settings in a dedicated `cardSizes: Record<string, CardSizeSetting | CardSizePreset>` field in `SeeLearnStorageData` rather than embedding inside `CardProgressRecord`.
- **Rationale:** 
  - A user may adjust the size of a new card before submitting any SRS rating. Storing sizes in `progress` would require fabricating premature SRS progress records for unreviewed cards.
  - Decoupling visual layout preferences from mathematical spaced repetition state keeps the SRS engine purely functional and clean.
  - Resetting or re-scheduling SRS progress does not inadvertently wipe out the user's carefully configured card visual dimensions.
- **Alternatives Considered:** Embedding `customSize?: CardSizePreset` in `CardProgressRecord` (rejected because unreviewed cards would lack records, coupling review math with UI layout).

### 2. Discrete Sizing Scale (`xs` to `xl` + `full`) with Snapping
- **Decision:** Define 6 standard size steps:
  - `xs`: 480px width, 340px height
  - `s`: 560px width, 400px height
  - `m` (default): 640px width, 460px height (matches `.seelearn-lobby-box`)
  - `l`: 800px width, 560px height
  - `xl`: 960px width, 660px height
  - `full`: 100% width, 100% height
  During corner dragging, the container resizes interactively with live visual feedback, and snaps to the closest preset upon drag completion (pointerup/touchend), saving the preset key.
- **Rationale:** Discrete steps guarantee clean, predictable typography, aspect ratios, and padding across themes, avoiding weird 1-pixel artifacts while keeping storage data tiny (e.g. `"m"`, `"l"`, `"xl"`).
- **Alternatives Considered:** Storing arbitrary raw pixel integers `{ width: 731, height: 489 }` (rejected as default because it causes brittle layout on window resizing; raw custom dimensions can still be supported as an optional fallback).

### 3. Sizing Control Elements & Placement
- **Header Action Button:** Add `.seelearn-card-fullscreen-btn` to `.seelearn-header-right` immediately adjacent to `.seelearn-jump-btn`.
  - Uses Lucide icons `maximize-2` (when in normal size) and `minimize-2` (when in fullscreen mode).
  - Toggling remembers the pre-fullscreen size and restores it on toggle off.
- **Bottom-Right Resize Grip:** Place `.seelearn-card-resize-handle` at bottom-right corner with a subtle diagonal grip icon/dots (`grip-horizontal` or custom svg dots/stripes).
  - Uses pointer events (`pointerdown`, `pointermove`, `pointerup`, with `setPointerCapture`) for smooth handling across mouse and touch devices.

### 4. Responsive & Mobile Adaptation
- **Decision:** On mobile devices (`Platform.isMobile` / `.is-mobile` class), the card container automatically overrides fixed pixel dimensions to fill available screen width (`max-width: 100%; width: 100%; height: 100%`). The resize handle is hidden or inert on narrow phones where arbitrary resizing is not physically practical, while the fullscreen toggle remains active to toggle clutter-free reading.
- **Rationale:** Mobile viewports have restricted dimensions; attempting to set 960px width breaks mobile usability.

## Risks / Trade-offs

- **[Risk] Wide cards overflow small Obsidian sidebars:**
  - *Mitigation:* Card container has `max-width: 100%` and `max-height: 100%` constraints applied by CSS, ensuring that even if preset `xl` (960px) is chosen, the card will never exceed the pane boundaries.
- **[Risk] Rapid dragging causing lag or excessive saves:**
  - *Mitigation:* Inline style updates are applied synchronously during pointer moves via `requestAnimationFrame` / direct element style, while storage persistence (`scheduleSave`) is triggered only once upon pointer release (`pointerup`).
- **[Risk] Long markdown content overflowing resized cards:**
  - *Mitigation:* `.seelearn-card-body` continues to use `overflow-y: auto; flex: 1; min-height: 0;`, ensuring content scrolls smoothly at all size presets.

## Migration Plan

- Backwards-compatible schema addition: `cardSizes?: Record<string, CardSizeSetting | CardSizePreset>` defaults to `{}` when opening existing `data.json`.
- Missing size preference defaults to `'m'`.
- Storage maintenance: `StorageManager.pruneOrphanedCards` and `StorageManager.migrateCardId` will be updated to also prune and rename keys in `cardSizes`.
