# Tasks

## 1. Type Definitions & Storage Layer

- [x] 1.1 Define `CardSizePreset` (`xs`, `s`, `m`, `l`, `xl`, `full`) and `CardSizeSetting` in `src/types.ts` and add `cardSizes?: Record<string, CardSizeSetting | CardSizePreset>` to `SeeLearnStorageData` interface and `DEFAULT_STORAGE_DATA`.
- [x] 1.2 Implement `getCardSize(cardId: string, fallback?: CardSizePreset): CardSizePreset`, `setCardSize(cardId: string, size: CardSizePreset): void`, and `clearCardSize(cardId: string): void` in `src/storage.ts` with automatic debounced saving via `scheduleSave()`.
- [x] 1.3 Update `migrateCardIds` and `pruneOrphanedCards` in `src/storage.ts` to migrate or clean up entries in `cardSizes`.
- [x] 1.4 Add `hasCustomCardSize(cardId: string): boolean` and `clearAllCardSizes(): number` to `StorageManager` in `src/storage.ts`.
- [x] 1.5 Add `cardSizeProperty` (default `card_size`) and `defaultCardSize` (default `m`) to `SeeLearnSettings` in `src/types.ts`.
- [x] 1.6 Add `cardSize?: CardSizePreset` and `fileCardSize?: CardSizePreset` to `Flashcard` in `src/types.ts`.
- [x] 1.7 Add unit tests in `tests/storage.test.ts` verifying storing, retrieving, defaulting, fallback, migrating, pruning, and clearing card size entries.

## 2. Card Layout Styles & Preset Classes

- [x] 2.1 Update `styles.css` to harmonize default base dimensions of `.seelearn-card-container` with `.seelearn-lobby-box` (`max-width: 640px; height: 460px; min-height: 280px; max-height: calc(100% - 40px);`).
- [x] 2.2 Add size preset modifier classes in `styles.css` (`.seelearn-size-xs`, `.seelearn-size-s`, `.seelearn-size-m`, `.seelearn-size-l`, `.seelearn-size-xl`, `.seelearn-size-full`).
- [x] 2.3 Style `.seelearn-card-fullscreen-btn` in `.seelearn-header-right` and the interactive corner handle `.seelearn-card-resize-handle` at bottom-right corner.
- [x] 2.4 Add mobile responsive overrides (`@media (max-width: 768px)` and `.is-mobile`) to clamp cards to 100% viewport width matching the mobile lobby footprint.
- [x] 2.5 Protect side arrow positions: maintain wrapper at 900px, clamp interactive drag to 820px, and ensure at least 20px clearance between cards and side arrows.

## 3. UI Controls, Sizing Hierarchy & Parser

- [x] 3.1 Implement `extractCardSize(args?: string): CardSizePreset | undefined` in `src/parser.ts` to detect `@size:xs|s|m|l|xl|full` without leaking into tags or IDs.
- [x] 3.2 Implement `extractFileCardSize(frontmatter, propName)` in `src/parser.ts` and pass file-level size to `parseCardsFromMarkdown` in `src/main.ts`.
- [x] 3.3 In `src/view.ts`, resolve `currentSize` via 4-level hierarchy: `@size:` > file frontmatter property > storage custom size > settings `defaultCardSize`.
- [x] 3.4 In `src/view.ts`, add the fullscreen button to `.seelearn-header-right` next to `.seelearn-jump-btn` with `maximize-2` / `minimize-2` icons and toggle behavior restoring previous size preset.
- [x] 3.5 In `src/view.ts`, mount `.seelearn-card-resize-handle` on `.seelearn-card-container` with pointer/touch event handlers that dynamically resize the container and snap to the nearest size preset on drag completion.
- [x] 3.6 In `src/view.ts`, only persist custom size to storage if the card has NO `@size:` and NO file frontmatter property.
- [x] 3.7 In `src/settings.ts`, add Card Sizing section: configurable property name, default card size dropdown, and reset button to clear custom sizes.

## 4. Verification & Testing

- [x] 4.1 Run unit test suite `npm test` and verify all tests (65 tests) pass with 100% success.
- [x] 4.2 Run `npm run build` and ensure TypeScript typecheck and esbuild bundle build with zero errors.
- [x] 4.3 Verify 4-level priority resolution with dedicated unit tests in `tests/parser.test.ts`.
- [x] 4.4 Visually verify card dimensions in Obsidian desktop and mobile views:
  - Base card size matches `.seelearn-lobby-box` (640px).
  - Clicking fullscreen button expands card and clicking again restores previous size.
  - Dragging `.seelearn-card-resize-handle` smoothly resizes card and snaps to presets.
  - Side navigation arrows remain fixed and safe from overlap.

