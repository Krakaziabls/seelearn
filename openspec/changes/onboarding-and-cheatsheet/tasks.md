# Tasks: Onboarding, Demo Notes Generation, and Persistent Cheatsheet System

## 1. Types & Settings

- [ ] 1.1 Add `onboardingCompleted: boolean` (default: `false`) to `SeeLearnSettings` and `DEFAULT_SETTINGS` in `src/types.ts`, verifying types compile with `tsc --noEmit`.

## 2. Onboarding Service Implementation

- [ ] 2.1 Implement `OnboardingManager` in `src/onboarding.ts` with template generator for `Шпаргалка SeeLearn — Синтаксис и Методология.md` (excluding `#seelearn` trigger tag, including dual syntax, cloze variants, reading privacy, and SM-2 methodology).
- [ ] 2.2 Implement generation of two runnable demo notes in `SeeLearn Examples/` with active `#seelearn` tag and working flashcards in `src/onboarding.ts`.
- [ ] 2.3 Implement smart tab opening (`openCheatsheetNote`) with leaf deduplication and auto-recreation of missing file.
- [ ] 2.4 Hook `OnboardingManager` into `src/main.ts` on `workspace.onLayoutReady` when `!this.settings.onboardingCompleted`.

## 3. UI Navigation Bar & Legacy Modal Cleanup

- [ ] 3.1 Remove `.seelearn-methodology-link` from `src/view.ts` (`renderLobbyContent()`) and remove the `SRSMethodologyModal` class.
- [ ] 3.2 Add circular `.seelearn-nav-help-btn` to the navigation bar in `src/view.ts` with Lucide `help-circle` icon, tooltip, and click handler opening the cheatsheet via `OnboardingManager`.
- [ ] 3.3 Add scoped styles for `.seelearn-nav-help-btn` in `styles.css` (28x28px, circular, `var(--text-muted)` with hover state) and remove obsolete methodology link/modal styles.

## 4. Automated Testing & Verification

- [ ] 4.1 Create `tests/onboarding.test.ts` testing cheatsheet template generation (syntax coverage, absence of `#seelearn` in cheatsheet, presence of valid cards in demo notes).
- [ ] 4.2 Run complete verification via `npm run verify` (`tsc --noEmit`, unit tests, `esbuild` production build, `openspec doctor`).
- [ ] 4.3 Perform visual and DOM validation via `/test-ui` (port 9222): verify absence of old methodology link in lobby and presence of `.seelearn-nav-help-btn` in navbar with correct circular dimensions.

## Workflow follow-up

- Archive the change after implementation and visual verification (`openspec archive onboarding-and-cheatsheet`).
- Sync new capabilities to `openspec/specs/`.
