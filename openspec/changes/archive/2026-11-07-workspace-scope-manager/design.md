# Design: Workspace Scope Manager

## Context
SeeLearn currently uses a single string `this.selectedScope: string` (`''`, `'folder:<path>'`, `'file:<path>'`) rendered via an HTML `<select class="seelearn-file-select">`.
Every flashcard in the plugin has a `filePath: string` (e.g. `Notes/Science/Biology.md`).
The current scope matching function is a simple string prefix test in `src/view.ts`.

See `proposal.md` for motivation and user problems addressed.

## Goals / Non-Goals

**Goals:**
- Provide a rich, tree-structured, searchable, and multi-selectable UI for scoping flashcards by folders and files.
- Replace the native dropdown with a compact toolbar trigger button (`.seelearn-scope-trigger-btn`).
- Abstract scope matching into pure, unit-tested functions (`cardMatchesScope`, `normalizeScope`, `buildScopeTree`, `formatScopeLabel`).
- Maintain 100% backwards compatibility with existing `data.json` storage and saved `TestPreset` instances.
- Ensure the modal/selector is fully decoupled and reusable for the upcoming Test Preset builder/editor (p. 16).

**Non-Goals:**
- Modifying or replacing the existing Tag filter bar (`selectedTags`). Scope filters by file/folder location; tag bar filters by topics within that scope.
- Vault file management (renaming, moving, or creating notes inside the modal).
- Persisting temporary collapsed/expanded folder states across plugin restarts (in-session state is sufficient).

## Decisions

### 1. Scope Data Contract (`WorkspaceScope`)
In `src/types.ts`:
```ts
export interface WorkspaceScope {
  all: boolean;
  folders: string[]; // Folder paths relative to vault, e.g. "Languages/Spanish"
  files: string[];   // File paths relative to vault, e.g. "Science/Physics.md"
}

export type ScopeInput = WorkspaceScope | string;
```
**Rationale:**
- Explicit separation of `folders` and `files` allows clean union matching: a card is included if `all === true`, or if its `filePath` matches any folder prefix in `folders`, or if its `filePath` exactly matches any file in `files`.
- Backwards compatibility helper `normalizeScope(scope: ScopeInput): WorkspaceScope` converts legacy `''`, `'folder:path'`, `'file:path'` into `WorkspaceScope` instantly.

**Alternatives considered:**
- Storing a flat list of paths with prefixes: More prone to parsing bugs and awkward to manipulate.
- Glob patterns: Overkill for Obsidian note vaults and harder for users to configure with checkboxes.

### 2. Pure Scope Logic & Tree Builder (`src/scope.ts`)
Decouple scope computation from Obsidian DOM by creating a dedicated module `src/scope.ts`:
- `buildScopeTree(cards: Flashcard[]): ScopeFolderNode`: Constructs a hierarchical folder tree containing only folders and files that have cards.
- `cardMatchesScope(card: Flashcard, scope: ScopeInput): boolean`: Pure evaluation function.
- `formatScopeLabel(scope: ScopeInput, cards: Flashcard[]): string`: Generates compact summaries:
  - All: `Все заметки (120)`
  - Single folder: `Папка: Spanish (45)`
  - Single file: `Заметка: Verbs (12)`
  - Multi-select: `Выбрано: 2 папки, 3 заметки (57)`
- `countScopedCards(cards: Flashcard[], scope: ScopeInput): number`: Returns total matching cards.

**Rationale:**
- Keeps `src/view.ts` lean and clean.
- Enables exhaustive automated unit testing in `tests/scope.test.mjs` without mocking Obsidian DOM.

### 3. Reusable UI Architecture (`src/scope-modal.ts`)
Create `WorkspaceScopeModal extends Modal`:
```ts
export class WorkspaceScopeModal extends Modal {
  constructor(
    app: App,
    cards: Flashcard[],
    initialScope: ScopeInput,
    onApply: (scope: WorkspaceScope) => void
  )
}
```
**Components:**
1. **Header:** Title «Пространство карточек», badge with total matching cards, search bar with clear button (`lucide-search`, `lucide-x`).
2. **Action Bar:** "Выбрать все" button, "Сбросить" button.
3. **Scrollable Tree View (`.seelearn-scope-tree`):**
   - Folders: chevron toggle (`lucide-chevron-right` / `lucide-chevron-down`), folder icon (`lucide-folder`), folder name, checkbox, card count badge (`.seelearn-counter-badge`).
   - Files: file icon (`lucide-file-text`), note name, checkbox, card count badge.
   - Indeterminate checkbox support when a folder has only a subset of files selected.
4. **Footer:** Selection summary text, "Отмена" button, and primary "Применить" button (`mod-cta`).

**Rationale:**
- Decoupled from `StudyView` so the Test Preset builder or any future feature can open it with a single call:
  `new WorkspaceScopeModal(this.app, this.plugin.cards, preset.scope, (newScope) => { ... }).open()`.

### 4. Toolbar Trigger Button Integration
In `StudyView.renderToolbar()`:
- Replace `leftGroup.createEl('select', { cls: 'dropdown seelearn-file-select' })` with:
  ```ts
  const scopeTriggerBtn = leftGroup.createEl('button', {
    cls: 'seelearn-scope-trigger-btn',
  });
  ```
- Renders Lucide icon `folder-tree`, formatted scope label via `formatScopeLabel(this.selectedScope, this.plugin.cards)`, and dropdown chevron `chevron-down`.
- On click, opens `WorkspaceScopeModal`. Upon `onApply(newScope)`, updates `this.selectedScope = newScope`, resets to lobby, and re-renders scoped SRS queue pills and tag chips.

## Risks / Trade-offs

- **[Risk] Deep nesting causing horizontal truncation on mobile:**
  → *Mitigation:* Cap maximum visual indentation with CSS `min(level * 16px, 64px)`, use `text-overflow: ellipsis`, and keep checkboxes and count badges sticky/aligned.
- **[Risk] Search performance on vaults with hundreds of notes:**
  → *Mitigation:* Simple substring filtering directly toggling `.is-hidden` CSS class on tree items, with ancestor folder auto-expansion when a child matches.
- **[Risk] Backwards compatibility with saved Test Presets:**
  → *Mitigation:* `TestPreset.scope` can store `string | WorkspaceScope`. `normalizeScope()` safely handles strings, nulls, and structured objects.
