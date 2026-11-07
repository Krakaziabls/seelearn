# Tasks: Workspace Scope Manager

## 1. Data Model & Pure Scope Engine

- [x] 1.1 Add `WorkspaceScope` interface (`all: boolean; folders: string[]; files: string[]`) and `ScopeInput` type to `src/types.ts`, ensuring backwards compatibility for `TestPreset.scope` and `StudyView.selectedScope`.
- [x] 1.2 Implement pure logic module `src/scope.ts` with `normalizeScope()`, `cardMatchesScope()`, `buildScopeTree()`, `formatScopeLabel()`, and `countScopedCards()`.
- [x] 1.3 Create unit test suite `tests/scope.test.mjs` covering multi-folder matching, multi-file selection, hierarchical folder prefixes, legacy string parsing, and label formatting; verify execution with `node --test tests/scope.test.mjs`.

## 2. Reusable Scope Modal Component

- [x] 2.1 Create modular `WorkspaceScopeModal` (`src/scope-modal.ts`) accepting `cards`, `initialScope`, and `onApply` callback for seamless reuse across Study View and Test Presets.
- [x] 2.2 Implement searchable hierarchical folder tree rendering with collapsible nodes, Lucide icons (`folder-tree`, `folder`, `file-text`, chevrons), and live card counters per folder/file.
- [x] 2.3 Implement interactive checkbox logic: checking folders toggles all descendant files, unchecking single files updates folder to indeterminate state, plus "Выбрать все" and "Сбросить" bulk actions.
- [x] 2.4 Add complete styling in `styles.css` for `.seelearn-scope-modal`, `.seelearn-scope-search-input`, `.seelearn-scope-tree`, checkboxes, indeterminate states, and badges using Obsidian CSS variables.

## 3. Study View Toolbar Integration & Dropdown Removal

- [x] 3.1 Remove deprecated native dropdown `<select class="dropdown seelearn-file-select">` and flat `<optgroup>` generation from `src/view.ts`.
- [x] 3.2 Add `.seelearn-scope-trigger-btn` to Study View toolbar left group displaying `folder-tree` icon, compact formatted label, and dropdown chevron.
- [x] 3.3 Connect `.seelearn-scope-trigger-btn` click to open `WorkspaceScopeModal`, updating `selectedScope`, lobby queue pills, and tags on apply.
- [x] 3.4 Ensure `startTestPreset()` and session replay correctly handle both legacy string scopes and new `WorkspaceScope` objects.

## 4. Verification & Testing

- [x] 4.1 Run full automated test suite `npm test` and verify all tests pass with zero regressions.
- [x] 4.2 Run production build `npm run build` and verify clean compilation without TypeScript warnings or bundle issues.
- [x] 4.3 Verify live Obsidian UI via Chrome DevTools Protocol (`/test-ui`): inspect trigger button, open scope modal, search folder, multi-select files, and verify scoped lobby card counts.
