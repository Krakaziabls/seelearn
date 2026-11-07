# Proposal: Workspace Scope Manager

## Why
Currently, SeeLearn uses a primitive HTML `<select class="dropdown seelearn-file-select">` to filter cards by a single folder or a single file. This approach suffers from several key limitations:
1. **No Multi-Selection:** Users cannot select multiple folders or combine specific notes into a single study scope (e.g. studying "Folder A" and "Note B" simultaneously).
2. **Poor Navigation in Large Vaults:** The flat `<optgroup>` dropdown becomes cluttered and unwieldy when a vault contains dozens of folders and hundreds of notes. There is no search, no hierarchy, and no way to inspect nested folder trees.
3. **Lack of Material Volume Feedback:** While item counts are shown, it is difficult to quickly assess the volume of nested subfolders or collapse categories.
4. **Not Reusable for Test Presets:** The test creator (and future test editor) requires a folder/file selector to configure test scopes. Reusing a rigid `<select>` element is impractical.

Replacing this outdated dropdown with a dedicated, modular **Workspace Scope Manager** component will provide a modern, tree-structured, searchable, and multi-selectable interface for managing card sources, with seamless reusability across both the Study View lobby and the Test Preset builder.

## What Changes
1. **Deprecation of Native `<select class="seelearn-file-select">`:**
   - Remove the `<select>` element from the Study View toolbar.
   - Replace it with a sleek Scope Trigger button (`.seelearn-scope-trigger-btn`) displaying an icon (`folder-tree` or `layers`), compact summary of the current selection, and card count.
2. **Interactive Workspace Scope Manager Modal / Popover:**
   - Clicking the trigger opens an interactive `WorkspaceScopeModal` (or scope popover on desktop).
   - **Search Input:** Real-time fuzzy/substring filter for folders and file names.
   - **Tree / Folder Grouped Hierarchy:** Collapsible folder nodes with nested files containing flashcards.
   - **Multi-Selection with Checkboxes:** Independent selection of entire folders, subfolders, or specific individual notes.
   - **Bulk Actions:** Quick "Выбрать все" (Select All) and "Сбросить" (Reset to All / Clear) actions.
   - **Card Counters:** Live badge counters for each folder and file indicating the exact number of contained flashcards.
3. **Extended Scope Data Model & Matching Logic:**
   - Introduce `WorkspaceScope` interface (`{ all: boolean, folders: string[], files: string[] }`) with backwards compatibility for legacy string scopes (`''`, `'folder:...'`, `'file:...'`).
   - Update `cardMatchesScope(card, scope)` to support multi-folder and multi-file matching.
   - Compact label generator: «Все пространство», «Папка: Biology (45)», «Заметка: Mitosis», or «Выбрано: 2 папки, 3 файла (84)».
4. **Modular Architecture for Test Preset Builder Reusability:**
   - Implement the selector as a decoupled UI component / modal (`WorkspaceScopeModal` and `ScopeSelectorComponent`) that can be instantiated with initial selections and a change callback, ready to be embedded into the Test Preset creator/editor.

## Capabilities

### New Capabilities
- `workspace-scope-manager`: Interactive hierarchical workspace scope manager with folder trees, multi-select checkboxes, search filtering, card counters, and compact trigger summaries for targeted card sessions and test presets.

### Modified Capabilities
<!-- None: existing capability requirements remain intact; session-flow operates over whatever pool cardMatchesScope provides. -->

## Impact
- **Code:** `src/types.ts` (adds `WorkspaceScope`), `src/view.ts` (replaces dropdown with trigger button and wires to `WorkspaceScopeModal`), `src/scope-modal.ts` (new modal component), `styles.css` (modal, tree nodes, search, checkboxes, and badge styling).
- **APIs / Backwards Compatibility:** `TestPreset.scope` and `StudyView.selectedScope` gracefully handle both legacy string formats and new structured scope objects without migration errors or data loss.
- **Dependencies:** Standard Obsidian API (`Modal`, `setIcon`, `Setting`), zero third-party dependencies.
