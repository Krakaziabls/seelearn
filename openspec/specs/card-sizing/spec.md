# card-sizing Specification

## Purpose

Provides adaptive card sizing harmonized with the deck lobby, full-panel workspace expansion, interactive corner drag-to-resize, discrete scale presets (`xs` through `xl`, `full`), and per-card size persistence in storage.

## Requirements

### Requirement: Standard Default Card Dimensions (PC vs Mobile)
By default, flashcards rendered in an active study session MUST have standard base dimensions aligned with the deck lobby container (`.seelearn-lobby-box`), adapting seamlessly to the user's platform.

#### Scenario: Default Desktop Dimensions Matching Lobby
- **GIVEN** a study session running on desktop Obsidian (non-mobile)
- **WHEN** a card with no custom saved size is displayed
- **THEN** `.seelearn-card-container` renders with default `m` dimensions matching the lobby (`max-width: 640px; height: 460px; min-height: 280px; max-height: calc(100% - 40px)`), centered horizontally and vertically inside `.seelearn-card-area`.

#### Scenario: Default Mobile Dimensions Matching Mobile Lobby
- **GIVEN** a study session running on a mobile device (`Platform.isMobile` or body has `.is-mobile`)
- **WHEN** a card is displayed
- **THEN** `.seelearn-card-container` automatically fills the available width (`width: 100%; max-width: 100%`) with standard safe-area padding, matching the mobile lobby footprint.

### Requirement: Fullscreen Workspace Toggle
The card header MUST provide an accessible icon toggle to expand the card across the full available plugin workspace area and restore it to its prior size.

#### Scenario: Expanding Card to Fullscreen
- **GIVEN** a card rendered in the active session
- **WHEN** the user clicks the fullscreen icon button (`.seelearn-card-fullscreen-btn`) in `.seelearn-card-header`
- **THEN** `.seelearn-card-container` immediately gains the `.seelearn-size-full` modifier (stretching to 100% width and 100% height of `.seelearn-card-area`), and the button icon toggles from `maximize-2` to `minimize-2`.

#### Scenario: Restoring Card from Fullscreen
- **GIVEN** a card currently displayed in fullscreen mode (`.seelearn-size-full`)
- **WHEN** the user clicks the fullscreen icon button again
- **THEN** `.seelearn-card-container` reverts to its previous sizing state (either default `m` or its custom saved size), and the button icon reverts to `maximize-2`.

### Requirement: Interactive Bottom-Right Resize Handle and Discrete Sizing System
Cards MUST feature an interactive resize handle in the bottom-right corner that allows smooth mouse and touch resizing across a discrete sizing scale.

#### Scenario: Sizing Scale Presets
- **GIVEN** an active card container
- **THEN** the system supports the following discrete sizing presets:
  - `xs`: `max-width: 480px; height: 340px;`
  - `s`: `max-width: 560px; height: 400px;`
  - `m` (default): `max-width: 640px; height: 460px;` (lobby match)
  - `l`: `max-width: 800px; height: 560px;`
  - `xl`: `max-width: 960px; height: 660px;`
  - `full`: `width: 100%; height: 100%; max-width: 100%;`

#### Scenario: Corner Drag Handle Interaction
- **GIVEN** an active card in desktop or tablet mode
- **WHEN** the user clicks/touches and drags `.seelearn-card-resize-handle` at the bottom-right corner of `.seelearn-card-container`
- **THEN** the card container smoothly resizes its dimensions following pointer movement within allowed min/max boundaries, visual feedback is shown during drag, and on pointer release it snaps/maps to the resulting size.

### Requirement: Per-Card Size Persistence & Sizing Hierarchy
A card's rendered size MUST be resolved according to a strict 4-level hierarchy:
1. Explicit `@size:` in card definition (`@card ... @size:xs|s|m|l|xl|full`)
2. File-level frontmatter property (configurable in settings, default `card_size`)
3. Session interactive resize saved in storage (only for cards with neither @size: nor file property)
4. Global default card size in settings (default `m`)

#### Scenario: Priority Resolution with @size: Overriding Everything
- **GIVEN** a card with `@size:xl` in its `@card` header line
- **WHEN** rendered or displayed across any session
- **THEN** it renders with preset `xl`, ignoring file frontmatter properties, saved session sizes, and global settings defaults.
- **AND** interactive resize in the current session updates visual display for the active view, but is NOT persisted to `data.json`, guaranteeing that subsequent sessions reset to `@size:xl`.

#### Scenario: File Frontmatter Size Applied
- **GIVEN** a markdown note with frontmatter property (e.g. `card_size: l`) and cards without `@size:`
- **WHEN** the file is indexed and its cards rendered
- **THEN** all cards inherit `fileCardSize: l` and render with preset `l`.
- **AND** interactive resize in session is visual-only and resets to `l` in new sessions.

#### Scenario: Session Persistence for Cards without Declarative Size
- **GIVEN** a card with NO `@size:` and NO file frontmatter size
- **WHEN** the user resizes the card or toggles fullscreen in an active session
- **THEN** the chosen size is persisted in `data.json` under `cardSizes[card.id]`.
- **AND** subsequent sessions automatically render this card in that saved custom size.

#### Scenario: Resetting Custom Card Sizes in Settings
- **GIVEN** user has custom resized cards in storage
- **WHEN** the user clicks "Сбросить сохранённые размеры карточек" in plugin settings
- **THEN** all entries in `storage.data.cardSizes` are deleted.
- **AND** cards without `@size:` or file frontmatter size revert immediately to the active `defaultCardSize` setting.

### Requirement: Arrow Geometry Safety
Expansion of cards (fullscreen or drag) MUST NEVER overlap or reduce distance with the navigation side arrows (`seelearn-side-arrow.prev` and `seelearn-side-arrow.next`), preserving at least 20px of clear space at all times.

#### Scenario: Preserving Side Arrow Spacing on Expansion
- **GIVEN** an active card in `.seelearn-card-area`
- **WHEN** the card expands to fullscreen or is resized to its maximum width
- **THEN** navigation side arrows maintain fixed side positions with at least 20px clearance, and cards never overlap or displace the buttons.
