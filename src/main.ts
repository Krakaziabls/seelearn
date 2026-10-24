import { Plugin, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, Flashcard, SeeLearnSettings, ValidationWarning } from './types';
import { SeeLearnSettingTab } from './settings';
import { extractGlobalTopics, parseCardsFromMarkdown, shouldIndexFile } from './parser';
import { StudyView, VIEW_TYPE_SEELEARN } from './view';
import { StorageManager } from './storage';

export default class SeeLearnPlugin extends Plugin {
  settings: SeeLearnSettings = DEFAULT_SETTINGS;
  storage!: StorageManager;
  cards: Flashcard[] = [];
  warnings: ValidationWarning[] = [];

  private reloadTimeoutId: number | null = null;

  async onload(): Promise<void> {
    this.storage = new StorageManager(this);
    await this.storage.load();
    this.settings = this.storage.settings;

    // Register custom ItemView
    this.registerView(
      VIEW_TYPE_SEELEARN,
      (leaf: WorkspaceLeaf) => new StudyView(leaf, this)
    );

    // Add ribbon icon
    this.addRibbonIcon('layers', 'SeeLearn: Карточки для изучения', () => {
      this.activateView();
    });

    // Add command to palette
    this.addCommand({
      id: 'open-study-view',
      name: 'Open SeeLearn Study View',
      callback: () => this.activateView(),
    });

    // Add settings tab
    this.addSettingTab(new SeeLearnSettingTab(this.app, this));

    // Wait for Obsidian layout and metadataCache to be ready before indexing
    this.app.workspace.onLayoutReady(() => {
      this.reloadAllCards();
    });

    // Watch vault and metadata changes to keep deck up to date
    this.registerEvent(
      this.app.metadataCache.on('changed', () => {
        this.scheduleDebouncedReload();
      })
    );

    this.registerEvent(
      this.app.vault.on('delete', () => {
        this.scheduleDebouncedReload();
      })
    );

    this.registerEvent(
      this.app.vault.on('rename', () => {
        this.scheduleDebouncedReload();
      })
    );
  }

  onunload(): void {
    if (this.storage) {
      this.storage.cleanup();
    }
    if (this.reloadTimeoutId !== null) {
      window.clearTimeout(this.reloadTimeoutId);
      this.reloadTimeoutId = null;
    }
  }

  async saveSettings(): Promise<void> {
    this.storage.settings = this.settings;
    await this.storage.saveNow();
  }


  /**
   * Opens or reveals the SeeLearn study view.
   */
  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_SEELEARN);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      // Create new leaf in the main center or active split
      leaf = workspace.getLeaf(false);
      await leaf.setViewState({
        type: VIEW_TYPE_SEELEARN,
        active: true,
      });
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  /**
   * Scans all markdown files in the vault matching trigger properties and parses cards.
   */
  async reloadAllCards(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    const allCards: Flashcard[] = [];
    const allWarnings: ValidationWarning[] = [];

    for (const file of files) {
      if (!shouldIndexFile(file, this.app.metadataCache, this.settings)) {
        continue;
      }

      try {
        const content = await this.app.vault.read(file);
        const fileCache = this.app.metadataCache.getFileCache(file);
        const globalTopics = extractGlobalTopics(fileCache?.frontmatter, this.settings);

        const result = parseCardsFromMarkdown(
          file.path,
          file.basename,
          content,
          globalTopics
        );

        allCards.push(...result.cards);
        allWarnings.push(...result.warnings);
      } catch (err) {
        console.error(`SeeLearn: Error reading file ${file.path}:`, err);
        allWarnings.push({
          filePath: file.path,
          line: 1,
          message: `Ошибка чтения файла: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    this.cards = allCards;
    this.warnings = allWarnings;

    // Log warnings in console if any
    if (this.warnings.length > 0) {
      console.warn(
        `SeeLearn: обнаружено ${this.warnings.length} предупреждений валидации карточек:`,
        this.warnings
      );
    }

    // Notify any active StudyViews to re-render
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SEELEARN);
    for (const leaf of leaves) {
      if (leaf.view instanceof StudyView) {
        leaf.view.onIndexUpdated();
      }
    }
  }

  private scheduleDebouncedReload(delayMs = 400): void {
    if (this.reloadTimeoutId !== null) {
      window.clearTimeout(this.reloadTimeoutId);
    }

    this.reloadTimeoutId = window.setTimeout(async () => {
      this.reloadTimeoutId = null;
      await this.reloadAllCards();
    }, delayMs);
  }
}
