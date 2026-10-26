import { Plugin, WorkspaceLeaf, TFile } from 'obsidian';
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

  private fileCardsMap = new Map<string, Flashcard[]>();
  private fileWarningsMap = new Map<string, ValidationWarning[]>();
  private pendingFileUpdates = new Set<TFile>();
  private fileUpdateTimeoutId: number | null = null;
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
      name: 'Открыть панель карточек (Open SeeLearn Study View)',
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: 'flip-card',
      name: 'Показать ответ / Перевернуть карточку (Flip Card)',
      checkCallback: (checking: boolean) => {
        const view = this.getActiveStudyView();
        if (view) {
          if (!checking) view.flipCardAction();
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: 'next-card',
      name: 'Следующая карточка (Next Card)',
      checkCallback: (checking: boolean) => {
        const view = this.getActiveStudyView();
        if (view && view.isSessionActive()) {
          if (!checking) view.nextCardAction();
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: 'prev-card',
      name: 'Предыдущая карточка (Previous Card)',
      checkCallback: (checking: boolean) => {
        const view = this.getActiveStudyView();
        if (view && view.isSessionActive()) {
          if (!checking) view.prevCardAction();
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: 'rate-again',
      name: 'Оценка SRS: [1] Снова (Again)',
      checkCallback: (checking: boolean) => {
        const view = this.getActiveStudyView();
        if (view && view.isSessionActive()) {
          if (!checking) view.rateAgainAction();
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: 'rate-hard',
      name: 'Оценка SRS: [2] Трудно (Hard)',
      checkCallback: (checking: boolean) => {
        const view = this.getActiveStudyView();
        if (view && view.isSessionActive()) {
          if (!checking) view.rateHardAction();
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: 'rate-good',
      name: 'Оценка SRS: [3] Хорошо (Good)',
      checkCallback: (checking: boolean) => {
        const view = this.getActiveStudyView();
        if (view && view.isSessionActive()) {
          if (!checking) view.rateGoodAction();
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: 'rate-easy',
      name: 'Оценка SRS: [4] Легко (Easy)',
      checkCallback: (checking: boolean) => {
        const view = this.getActiveStudyView();
        if (view && view.isSessionActive()) {
          if (!checking) view.rateEasyAction();
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: 'undo-review',
      name: 'Отменить последнее действие (Undo)',
      checkCallback: (checking: boolean) => {
        const view = this.getActiveStudyView();
        if (view && view.isSessionActive()) {
          if (!checking) view.undoAction();
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: 'shuffle-queue',
      name: 'Перемешать карточки в текущей сессии (Shuffle Queue)',
      checkCallback: (checking: boolean) => {
        const view = this.getActiveStudyView();
        if (view) {
          if (!checking) view.shuffleQueueAction();
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: 'insert-card-template',
      name: 'Вставить шаблон карточки (Insert Card Template)',
      editorCallback: (editor) => {
        const isComment = this.settings.templateStyle !== 'plain';
        const template = isComment
          ? `%% @card %%\n%% @front %%\nВопрос\n%% @back %%\nОтвет\n%% @end %%\n`
          : `@card\n@front\nВопрос\n@back\nОтвет\n@end\n`;
        editor.replaceSelection(template);
      },
    });

    this.addCommand({
      id: 'insert-cloze-template',
      name: 'Вставить шаблон карточки с пропуском (Insert Cloze Template)',
      editorCallback: (editor) => {
        const isComment = this.settings.templateStyle !== 'plain';
        const template = isComment
          ? `%% @card %%\nТекст вопроса с {{c1::скрытым ответом}}.\n%% @end %%\n`
          : `@card\nТекст вопроса с {{c1::скрытым ответом}}.\n@end\n`;
        editor.replaceSelection(template);
      },
    });

    // Add settings tab
    this.addSettingTab(new SeeLearnSettingTab(this.app, this));

    // Wait for Obsidian layout and metadataCache to be ready before indexing
    this.app.workspace.onLayoutReady(() => {
      this.reloadAllCards();
    });

    // Watch vault and metadata changes incrementally
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.scheduleIncrementalFileIndex(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.handleFileDelete(file.path);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (file instanceof TFile && file.extension === 'md') {
          this.handleFileRename(file, oldPath);
        }
      })
    );
  }

  async onunload(): Promise<void> {
    if (this.storage) {
      await this.storage.cleanup();
    }
    if (this.reloadTimeoutId !== null) {
      window.clearTimeout(this.reloadTimeoutId);
      this.reloadTimeoutId = null;
    }
    if (this.fileUpdateTimeoutId !== null) {
      window.clearTimeout(this.fileUpdateTimeoutId);
      this.fileUpdateTimeoutId = null;
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
   * Retrieves the active or open StudyView instance, if any.
   */
  getActiveStudyView(): StudyView | null {
    const activeView = this.app.workspace.getActiveViewOfType(StudyView);
    if (activeView) return activeView;

    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SEELEARN);
    if (leaves.length > 0 && leaves[0].view instanceof StudyView) {
      return leaves[0].view as StudyView;
    }
    return null;
  }

  private rebuildCardsFromMap(): void {
    const allCards: Flashcard[] = [];
    const allWarnings: ValidationWarning[] = [];

    for (const cards of this.fileCardsMap.values()) {
      allCards.push(...cards);
    }
    for (const warns of this.fileWarningsMap.values()) {
      allWarnings.push(...warns);
    }

    this.cards = allCards;
    this.warnings = allWarnings;

    // Notify active StudyViews
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SEELEARN);
    for (const leaf of leaves) {
      if (leaf.view instanceof StudyView) {
        leaf.view.onIndexUpdated();
      }
    }
  }

  /**
   * Scans all markdown files in the vault matching trigger properties and parses cards.
   */
  async reloadAllCards(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    this.fileCardsMap.clear();
    this.fileWarningsMap.clear();

    for (const file of files) {
      if (!shouldIndexFile(file, this.app.metadataCache, this.settings)) {
        continue;
      }

      await this.indexSingleFile(file);
    }

    this.rebuildCardsFromMap();

    if (this.warnings.length > 0) {
      console.warn(
        `SeeLearn: обнаружено ${this.warnings.length} предупреждений валидации карточек:`,
        this.warnings
      );
    }
  }

  private async indexSingleFile(file: TFile): Promise<void> {
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

      this.fileCardsMap.set(file.path, result.cards);
      if (result.warnings.length > 0) {
        this.fileWarningsMap.set(file.path, result.warnings);
      } else {
        this.fileWarningsMap.delete(file.path);
      }
    } catch (err) {
      console.error(`SeeLearn: Error reading file ${file.path}:`, err);
      this.fileCardsMap.delete(file.path);
      this.fileWarningsMap.set(file.path, [
        {
          filePath: file.path,
          line: 1,
          message: `Ошибка чтения файла: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    }
  }

  private scheduleIncrementalFileIndex(file: TFile, delayMs = 300): void {
    this.pendingFileUpdates.add(file);

    if (this.fileUpdateTimeoutId !== null) {
      window.clearTimeout(this.fileUpdateTimeoutId);
    }

    this.fileUpdateTimeoutId = window.setTimeout(async () => {
      this.fileUpdateTimeoutId = null;
      const filesToUpdate = Array.from(this.pendingFileUpdates);
      this.pendingFileUpdates.clear();

      for (const f of filesToUpdate) {
        if (!shouldIndexFile(f, this.app.metadataCache, this.settings)) {
          this.fileCardsMap.delete(f.path);
          this.fileWarningsMap.delete(f.path);
        } else {
          await this.indexSingleFile(f);
        }
      }

      this.rebuildCardsFromMap();
    }, delayMs);
  }

  private handleFileDelete(filePath: string): void {
    if (this.fileCardsMap.has(filePath) || this.fileWarningsMap.has(filePath)) {
      this.fileCardsMap.delete(filePath);
      this.fileWarningsMap.delete(filePath);
      this.rebuildCardsFromMap();
    }
  }

  private async handleFileRename(file: TFile, oldPath: string): Promise<void> {
    const oldCards = this.fileCardsMap.get(oldPath) || [];
    this.fileCardsMap.delete(oldPath);
    this.fileWarningsMap.delete(oldPath);

    if (shouldIndexFile(file, this.app.metadataCache, this.settings)) {
      await this.indexSingleFile(file);
      const newCards = this.fileCardsMap.get(file.path) || [];

      // Migrate card IDs in storage so SRS progress is preserved
      if (oldCards.length > 0 && newCards.length > 0) {
        const idMap = new Map<string, string>();
        for (const oldCard of oldCards) {
          const match = newCards.find((nc) => nc.front === oldCard.front);
          if (match && match.id !== oldCard.id) {
            idMap.set(oldCard.id, match.id);
          }
        }
        if (idMap.size > 0) {
          this.storage.migrateCardIds(idMap);
        }
      }
    }

    this.rebuildCardsFromMap();
  }
}
