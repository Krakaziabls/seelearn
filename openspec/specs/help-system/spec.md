# help-system Specification

## Purpose
Provides a permanent, responsive entry point to documentation and cheatsheet notes directly from the navigation bar, retiring obsolete modal dialogs.

## Requirements

### Requirement: Navigation Bar Help Button
A persistent circular help button must be located in the left group of the navigation bar.

#### Scenario: Rendering help button
- **WHEN** the study view renders in any state (lobby, active session, finished)
- **THEN** the bottom navigation bar \`.seelearn-nav-bar\` is always displayed
- **AND** a circular button \`.seelearn-nav-help-btn\` is rendered in its left group with the Lucide \`help-circle\` icon
- **AND** the tooltip says "Шпаргалка и справка"
- **AND** computed styles adhere to 28x28px circular dimensions (\`border-radius: 50%\`) with standard 16px horizontal padding.

### Requirement: Opening and Focusing the Cheatsheet Note
Clicking the help button MUST present options to open the syntax cheatsheet (`Шпаргалка SeeLearn — Синтаксис.md`) or the methodology cheatsheet (`Шпаргалка SeeLearn — Методология.md`) and display the selected note in Obsidian editor view.

#### Scenario: Cheatsheet tab already open
- **GIVEN** an open leaf already displays the requested cheatsheet (`Шпаргалка SeeLearn — Синтаксис.md` or `Шпаргалка SeeLearn — Методология.md`)
- **WHEN** the user selects the corresponding cheatsheet option
- **THEN** that existing leaf is focused and activated without opening duplicate tabs.

#### Scenario: Cheatsheet note closed
- **GIVEN** no open leaf contains the requested cheatsheet note
- **WHEN** the user selects the cheatsheet option
- **THEN** the note is opened in a new workspace leaf (`tab`).

#### Scenario: Cheatsheet file deleted or missing
- **GIVEN** the requested cheatsheet file has been deleted or moved
- **WHEN** the user attempts to open it
- **THEN** the plugin automatically recreates the file in `SeeLearn Examples/` and opens it.

### Requirement: Retirement of Legacy Methodology Link and Modal
The temporary inline link and modal dialog must be removed to streamline the UI.

#### Scenario: Lobby view rendering
- **WHEN** the study lobby (\`.seelearn-lobby-box\`) is displayed
- **THEN** \`.seelearn-methodology-link\` is absent from the DOM
- **AND** no \`SRSMethodologyModal\` instances are mounted.
