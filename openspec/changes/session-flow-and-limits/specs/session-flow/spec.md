# Spec Delta: Session Flow and Limits

## Purpose
Manages session queue preparation with fair random sampling and card limits, in-session navigation and exit controls across study modes, and context-sensitive lobby visibility.

## ADDED Requirements

### Requirement: Learn Mode In-Session Exit Button
In Learn mode («Ботать»), during an active session the bottom navigation bar (`.seelearn-nav-bar`) MUST render an exit button (`.seelearn-nav-exit-btn`) in its right group (`.seelearn-nav-group.right`). When clicked, the active session MUST terminate immediately and transition to the summary screen, saving all progress achieved so far without data loss.

#### Scenario: Exit button visibility in Learn mode
- **GIVEN** a study session in Learn mode («Ботать») is active
- **WHEN** `.seelearn-nav-bar` is rendered
- **THEN** `.seelearn-nav-group.right` contains a button with classes `clickable-icon seelearn-btn-icon seelearn-nav-exit-btn` and icon `log-out`

#### Scenario: Early exit saves progress
- **GIVEN** an active Learn session where the user has already flipped and reviewed 3 out of 10 cards
- **WHEN** the user clicks `.seelearn-nav-exit-btn`
- **THEN** `sessionState` transitions to `'finished'`, session statistics reflect the 3 reviewed cards, streak data is preserved, and the summary screen displays the results

### Requirement: Strict Test Mode Exit Prohibition
In Test mode («Проверка знаний» / `.is-test`), the exit button in `.seelearn-nav-bar` MUST NOT be rendered during an active session, ensuring strict test integrity and preventing accidental early termination.

#### Scenario: No exit button in Test mode
- **GIVEN** a study session in Test mode («Проверка знаний») is active
- **WHEN** `.seelearn-nav-bar` is rendered
- **THEN** `.seelearn-nav-group.right` does NOT contain `.seelearn-nav-exit-btn` and contains no interactive exit controls

### Requirement: Per-Session Card Limits (N or All)
The user MUST be able to specify a maximum card limit $N$ (or choose «Все») for each study session in `.seelearn-lobby-box`. The chosen limit MUST constrain the session queue for regular study and for launching Test Presets.

#### Scenario: Limit applied to scope session
- **GIVEN** a scope containing 50 matching cards and session limit set to 20
- **WHEN** the user starts the session
- **THEN** `sessionQueue.length` equals exactly 20, and the counter badge reads `Карта 1 из 20`

#### Scenario: Limit applied to Test Preset
- **GIVEN** a saved test preset containing 30 cards and session limit set to 10
- **WHEN** the user launches the preset
- **THEN** `sessionQueue.length` equals exactly 10

#### Scenario: All cards selected
- **GIVEN** a scope containing 42 cards and session limit set to «Все»
- **WHEN** the user starts the session
- **THEN** `sessionQueue.length` equals 42

### Requirement: Lobby Preset Visibility Based on SRS Filter
In `.seelearn-lobby-box`, the saved test presets section and the "Сохранить как тест..." button MUST be hidden when the active queue filter is «К повторению» (`due`) or «Новые» (`new`). They MUST be displayed only when the queue filter is «Все» (`all`).

#### Scenario: Presets hidden on due filter
- **GIVEN** the lobby has queue filter set to `due` («К повторению»)
- **WHEN** `.seelearn-lobby-box` renders
- **THEN** `.seelearn-presets-section` and `.seelearn-btn-save-test` are not rendered, and only the limit selector and start button are displayed

#### Scenario: Presets hidden on new filter
- **GIVEN** the lobby has queue filter set to `new` («Новые»)
- **WHEN** `.seelearn-lobby-box` renders
- **THEN** `.seelearn-presets-section` and `.seelearn-btn-save-test` are not rendered

#### Scenario: Presets visible on all filter
- **GIVEN** the lobby has queue filter set to `all` («Все») and saved presets exist
- **WHEN** `.seelearn-lobby-box` renders
- **THEN** `.seelearn-presets-section` is rendered and displays all saved presets

### Requirement: Auto-Shuffling and Linear Order Core Function
Every new session MUST automatically shuffle the candidate cards using the Fisher-Yates algorithm before slicing to the limit $N$ to guarantee fair uniform random selection, unless linear order is explicitly enabled. A pure function `prepareSessionPool(cards, { limit, shuffle })` in the core layer MUST implement this behavior.

#### Scenario: Default auto-shuffle with limit
- **GIVEN** a list of 100 cards and options `{ limit: 10, shuffle: true }`
- **WHEN** `prepareSessionPool` is executed
- **THEN** it returns an array of 10 cards that are a random uniform sample from the 100 cards

#### Scenario: Linear order without shuffle
- **GIVEN** a list of cards `[C1, C2, C3, C4, C5]` and options `{ limit: 3, shuffle: false }`
- **WHEN** `prepareSessionPool` is executed
- **THEN** it returns exactly `[C1, C2, C3]` in their original order

#### Scenario: Pool smaller than limit
- **GIVEN** a list of 5 cards and options `{ limit: 10, shuffle: true }`
- **WHEN** `prepareSessionPool` is executed
- **THEN** it returns all 5 cards in shuffled order without error or truncation
