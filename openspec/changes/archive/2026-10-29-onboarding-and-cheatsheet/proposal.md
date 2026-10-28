# Proposal: Onboarding, Demo Notes Generation, and Persistent Cheatsheet System

## Why
New users installing SeeLearn currently encounter an empty lobby without guidance on how to mark up cards, connect tags, or utilize spaced repetition. The only built-in documentation was a tiny text link (`.seelearn-methodology-link`) buried at the bottom of `.seelearn-lobby-box`, opening an ephemeral modal window (`SRSMethodologyModal`) that offered limited explanations and could not be kept open alongside notes.

This change introduces:
1. An automated First-Run Experience (onboarding) that safely generates a self-contained `SeeLearn Examples` folder containing working cards and a comprehensive reference note (`Шпаргалка SeeLearn — Синтаксис и Методология.md`).
2. A persistent, elegant help button in the navigation bar (`.seelearn-nav-help-btn`) that opens or focuses the cheatsheet note in Obsidian, recreating it if deleted.
3. Clean retirement of the temporary modal dialog (`SRSMethodologyModal`) and the legacy lobby link.

## What Changes
- **First-Run Onboarding**: Add `onboardingCompleted: boolean` to `SeeLearnSettings` (default `false`). When `false` on layout ready, create `SeeLearn Examples/` in the vault root with demo cards and the full cheatsheet, then open the cheatsheet in a new tab and mark `onboardingCompleted = true`.
- **Comprehensive Cheatsheet**: Markdown reference note covering YAML frontmatter (`topics`), body tags (`#seelearn`), dual syntax (`%% @card %%` and open format), Cloze deletion variants (`{{c1::...}}`, `==...==`), Reading View privacy fences (`%%%% ... %%%%`), and the complete SuperMemo-2 (SM-2) methodology (due queue criteria, ratings [1]-[4], interval growth, and leech handling).
- **Interactive Demo Notes**: Working notes with active `#seelearn` tags showcasing real two-sided and cloze flashcards so users can immediately test the plugin in the lobby.
- **Navbar Help Button**: Add a circular 28x28px button `.seelearn-nav-help-btn` with Lucide `help-circle` icon in the left group of the navigation bar, opening or focusing the cheatsheet.
- **Legacy UI Cleanup**: Completely remove `.seelearn-methodology-link` from `.seelearn-lobby-box` and remove the obsolete `SRSMethodologyModal` class and its styles.

## Capabilities

### New Capabilities
- `onboarding`: First-run detection, generation of `SeeLearn Examples` directory with working flashcard notes and reference cheatsheet, auto-launching in an editor tab.
- `help-system`: Dedicated navbar help button (`.seelearn-nav-help-btn`) that reliably navigates to or recreates the Markdown cheatsheet note without disrupting active sessions.

### Modified Capabilities
<!-- None: This is the first OpenSpec change establishing these capabilities -->

## Impact
- **Settings**: Extended `SeeLearnSettings` in `src/types.ts` with `onboardingCompleted: boolean`.
- **Plugin Lifecycle**: `src/main.ts` executes onboarding generator during `onLayoutReady`.
- **UI Components**: `src/view.ts` removes `.seelearn-methodology-link` and `SRSMethodologyModal`, adds `.seelearn-nav-help-btn` in `renderNavBar()` / `renderToolbar()`.
- **Styles**: `styles.css` adds scoped styles for `.seelearn-nav-help-btn` and purges obsolete `.seelearn-methodology-link` and `.seelearn-methodology-modal` rules.
- **Architectural Constraints**: Preserves Zero Note Pollution (only creates isolated demo notes in a dedicated folder; never alters existing user files).
