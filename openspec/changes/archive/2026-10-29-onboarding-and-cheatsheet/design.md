# Design: Onboarding, Demo Notes Generation, and Persistent Cheatsheet System

## Context
See proposal.md and specs for motivation and requirements. Currently, SeeLearn loads without proactive guidance, and help content is trapped inside an ephemeral modal (`SRSMethodologyModal`).

## Goals / Non-Goals

**Goals:**
- Provide a zero-friction first-run onboarding experience generating an isolated folder `SeeLearn Examples/` with runnable flashcards and a comprehensive cheatsheet.
- Keep `main.ts` and `view.ts` modular by implementing a dedicated `OnboardingManager` in `src/onboarding.ts`.
- Replace the legacy `.seelearn-methodology-link` and `SRSMethodologyModal` with a persistent circular navbar button `.seelearn-nav-help-btn`.
- Smart leaf management: focus an existing cheatsheet tab if already open; recreate missing file if deleted.

**Non-Goals:**
- Never modify or tag existing user markdown notes outside `SeeLearn Examples/` (maintaining strict Zero Note Pollution).
- Not altering core parsing rules or SM-2 algorithms.
- Not loading external web links for documentation; all help is local, offline, and native markdown.

## Decisions

### 1. Isolated Onboarding Service (`src/onboarding.ts`)
Instead of inlining extensive markdown text into `main.ts`, we extract onboarding logic into a dedicated `OnboardingManager`:
- `ensureOnboardingAssets(app: App): Promise<TFile>`: creates folder `SeeLearn Examples` and writes the cheatsheet note and demo notes if missing.
- `openCheatsheetNote(app: App): Promise<void>`: handles opening or focusing the cheatsheet leaf.
- `getCheatsheetMarkdownContent()`: returns the complete, formatted markdown text covering syntax, Cloze, Reading View privacy, and SM-2 methodology.

*Alternative considered*: Inlining templates in `main.ts`. Rejected because it inflates plugin entrypoint by 400+ lines.

### 2. State Storage in `SeeLearnSettings`
Add `onboardingCompleted: boolean` (default `false`) to `SeeLearnSettings` in `src/types.ts`.
- Checked in `main.ts` during `workspace.onLayoutReady`.
- Automatically flipped to `true` and saved via `plugin.saveSettings()` upon initial asset generation.

*Alternative considered*: Storing in `data.json`. Rejected because `data.json` is scoped to card progress and review history via `StorageManager`, whereas feature flags belong in plugin settings.

### 3. Smart Tab Focus and Auto-Recreation
When clicking `.seelearn-nav-help-btn`:
1. Search active markdown leaves: `app.workspace.getLeavesOfType('markdown')`.
2. If a leaf is already viewing `Шпаргалка SeeLearn — Синтаксис и Методология.md`, call `app.workspace.setActiveLeaf(leaf, { focus: true })`.
3. If not open, retrieve the file via `app.vault.getAbstractFileByPath(...)`. If missing, re-generate it using `OnboardingManager.ensureOnboardingAssets()`.
4. Open in a new tab: `app.workspace.getLeaf('tab').openFile(file)`.

### 4. UI Architecture and Scoped Styling
- Remove `.seelearn-methodology-link` from `src/view.ts` (`renderLobbyContent()`).
- Delete `SRSMethodologyModal` class and its styles.
- Add `.seelearn-nav-help-btn` to the navigation bar:
  * Dimensions: `width: 28px; height: 28px; border-radius: 50%`.
  * Layout: `display: flex; align-items: center; justify-content: center`.
  * Icon: Lucide `help-circle` rendered via `setIcon(el, 'help-circle')`.
  * Tooltip: `setTooltip(el, 'Шпаргалка и справка')`.
  * Theme integration: `color: var(--text-muted); background: transparent; transition: all 0.15s ease;` with hover `background-color: var(--background-modifier-hover); color: var(--text-normal)`.

## Risks / Trade-offs

- **[Risk] User renames or deletes the `SeeLearn Examples` folder**  
  → *Mitigation*: The help button handles missing files gracefully: clicking `?` detects that the file is missing and transparently recreates the cheatsheet in `SeeLearn Examples` before opening.

- **[Risk] Cluttering user notes with `#seelearn` tags from the cheatsheet itself**  
  → *Mitigation*: The cheatsheet note deliberately omits the `#seelearn` tag from its body and frontmatter so it is never parsed as a study card.

- **[Risk] Duplicate tabs created upon repeated clicks**  
  → *Mitigation*: Leaf deduplication algorithm checks all open markdown leaves before opening a new tab.
