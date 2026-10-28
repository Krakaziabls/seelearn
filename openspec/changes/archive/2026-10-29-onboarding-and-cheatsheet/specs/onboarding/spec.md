# Spec Delta: Onboarding Capability

## Purpose
Provides an automated first-run experience that scaffolds an isolated demo folder `SeeLearn Examples` containing interactive flashcard notes and a complete reference cheatsheet note.

## ADDED Requirements

### Requirement: First-Run Detection and State Persistence
The plugin must track whether the onboarding process has previously run in this vault.

#### Scenario: First run on fresh vault
- **GIVEN** `onboardingCompleted` setting is `false` or undefined
- **WHEN** the plugin layout completes initialization (`workspace.onLayoutReady`)
- **THEN** the onboarding flow executes and persists `onboardingCompleted: true` in settings.

#### Scenario: Subsequent runs
- **GIVEN** `onboardingCompleted` setting is `true`
- **WHEN** the plugin initializes
- **THEN** the onboarding flow does not run again automatically.

### Requirement: Demo Folder and Notes Generation
The plugin must generate an isolated folder named `SeeLearn Examples` containing working example notes and the comprehensive cheatsheet without mutating existing user notes.

#### Scenario: Generating SeeLearn Examples structure
- **WHEN** the onboarding flow executes
- **THEN** the folder `SeeLearn Examples` is created in vault root if it does not already exist
- **AND** `Шпаргалка SeeLearn — Синтаксис и Методология.md` is generated without `#seelearn` trigger tag
- **AND** at least two demonstration notes with active `#seelearn` tags and working cards (two-sided and cloze) are generated.

#### Scenario: Opening cheatsheet tab
- **WHEN** the demo assets have been created during first run
- **THEN** `Шпаргалка SeeLearn — Синтаксис и Методология.md` is automatically opened in a new workspace leaf (`tab`).
