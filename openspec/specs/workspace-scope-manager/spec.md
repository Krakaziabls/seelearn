# workspace-scope-manager Specification

## Purpose
Provides an interactive, hierarchical, searchable workspace scope manager with multi-selection checkboxes and live card volume counters, replacing the native dropdown and enabling modular scope selection for regular study and test presets.

## Requirements

### Requirement: Toolbar Scope Trigger Button
In the Study View toolbar left group (`.seelearn-toolbar-group.left`), the native `<select class="seelearn-file-select">` MUST be replaced with an interactive Scope Trigger button (`.seelearn-scope-trigger-btn`). The trigger button MUST display an icon (`folder-tree`), a compact summary of the active selection, and a card count badge. Clicking the trigger MUST open `WorkspaceScopeModal`.

#### Scenario: Scope trigger button rendering
- **GIVEN** Study View is rendered in lobby mode
- **WHEN** `.seelearn-toolbar-group.left` is inspected
- **THEN** native `<select class="seelearn-file-select">` is absent
- **AND** `.seelearn-scope-trigger-btn` is present with Lucide icon `folder-tree` and text reflecting the current scope

#### Scenario: Trigger button click opens Scope Modal
- **GIVEN** the user is in Study View lobby
- **WHEN** the user clicks `.seelearn-scope-trigger-btn`
- **THEN** `WorkspaceScopeModal` opens displaying the hierarchical folder and file tree

---

### Requirement: Hierarchical Folder Tree with Card Counters
Inside `WorkspaceScopeModal`, all vault markdown files containing `#seelearn` cards MUST be grouped into a hierarchical collapsible folder tree. Each folder node MUST display a folder icon, name, collapse/expand toggle, a checkbox, and a badge with the total number of flashcards in that folder and its subfolders. Each file node MUST display a file icon, note name, a checkbox, and a badge with the note's card count.

#### Scenario: Folder and file tree nodes with counters
- **GIVEN** the vault has cards in `Biology/Cell.md` (5 cards) and `Biology/Genetics.md` (10 cards)
- **WHEN** `WorkspaceScopeModal` is opened
- **THEN** a folder node `Biology` is rendered with a counter badge showing `15`
- **AND** child file nodes `Cell.md` (5) and `Genetics.md` (10) are nested within `Biology`

#### Scenario: Collapsing and expanding folder nodes
- **GIVEN** a folder node `Biology` is expanded
- **WHEN** the user clicks the folder chevron toggle
- **THEN** its children are collapsed and hidden
- **AND** clicking the chevron again expands its children

---

### Requirement: Multi-Selection with Checkboxes and Bulk Controls
`WorkspaceScopeModal` MUST support multi-selection across any combination of folders and individual files. Checking a folder MUST select all files and subfolders within it. The modal MUST provide "Выбрать все" (Select All), "Сбросить" (Reset), and "Применить" (Apply) actions.

#### Scenario: Selecting an entire folder
- **GIVEN** the user opens `WorkspaceScopeModal` with no custom selection
- **WHEN** the user checks folder `Biology`
- **THEN** all files inside `Biology` become selected
- **AND** clicking "Применить" sets the scope to `{ all: false, folders: ['Biology'], files: [] }`

#### Scenario: Selecting multiple separate files
- **GIVEN** the user wants cards from `Math/Algebra.md` and `History/Rome.md`
- **WHEN** the user checks both files individually
- **THEN** clicking "Применить" sets the scope to `{ all: false, folders: [], files: ['Math/Algebra.md', 'History/Rome.md'] }`
- **AND** only cards from those two files appear in the session queue

#### Scenario: Bulk Reset to All
- **GIVEN** custom folders and files are currently selected
- **WHEN** the user clicks "Сбросить"
- **THEN** all checkboxes reset and the scope reverts to `{ all: true, folders: [], files: [] }`

---

### Requirement: Real-Time Search in Scope Manager
`WorkspaceScopeModal` MUST render a search input field (`.seelearn-scope-search-input`) at the top. Typing in the search input MUST filter the tree in real time, keeping matching files and their ancestor folders visible while hiding non-matching entries.

#### Scenario: Searching by file or folder keyword
- **GIVEN** the tree contains 50 files across 10 folders
- **WHEN** the user types `mito` into `.seelearn-scope-search-input`
- **THEN** only files with `mito` in their name (and their ancestor folders) remain visible in the tree
- **AND** clearing the search input restores the complete tree without altering checkbox selections

---

### Requirement: Compact Scope Label Formatting
The trigger button (`.seelearn-scope-trigger-btn`) MUST display a compact, informative text label formatted according to the current selection:
1. All workspace: `Все заметки (N)`
2. Single folder: `Папка: <Name> (N)`
3. Single file: `Заметка: <Name> (N)`
4. Multiple items: `Выбрано: X папок, Y файлов (N)` (or `X папок (N)` / `Y заметок (N)`)

#### Scenario: Label for all workspace
- **GIVEN** scope is `{ all: true, folders: [], files: [] }` and vault has 120 cards
- **WHEN** `.seelearn-scope-trigger-btn` renders
- **THEN** the text reads `Все заметки (120)`

#### Scenario: Label for single folder
- **GIVEN** scope has folder `Physics` selected containing 35 cards
- **WHEN** `.seelearn-scope-trigger-btn` renders
- **THEN** the text reads `Папка: Physics (35)`

#### Scenario: Label for multi-selection
- **GIVEN** scope has 2 folders and 3 individual files selected containing 85 cards in total
- **WHEN** `.seelearn-scope-trigger-btn` renders
- **THEN** the text reads `Выбрано: 2 папки, 3 заметки (85)`

---

### Requirement: Reusable Scope Selector Component for Test Presets
The scope selection data model and UI component MUST be decoupled from `StudyView` such that it can be invoked with any arbitrary initial scope and callback (`onSelect: (scope: WorkspaceScope) => void`), enabling direct reuse in the Test Preset builder and future test editors.

#### Scenario: Invoking scope manager from Test Preset editor
- **GIVEN** the test preset builder requires selecting target folders/files
- **WHEN** `new WorkspaceScopeModal(app, cards, currentScope, onSelect).open()` is called
- **THEN** the modal opens with `currentScope` pre-checked
- **AND** clicking "Применить" executes `onSelect` with the updated `WorkspaceScope`
