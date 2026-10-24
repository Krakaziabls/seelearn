import {
  ItemView,
  WorkspaceLeaf,
  MarkdownRenderer,
  Component,
  TFile,
  setIcon,
  Notice,
  Modal,
  App,
} from 'obsidian';
import type SeeLearnPlugin from './main';
import { CardProgressRecord, Flashcard, SRSQueueFilter, ValidationWarning } from './types';
import { fisherYatesShuffle, interleaveCards } from './shuffle';
import { getSRSIntervalPreviews, isCardDue, isCardNew, SRSRating } from './srs';

export const VIEW_TYPE_SEELEARN = 'seelearn-study-view';

interface HistoryEntry {
  cardId: string;
  queueSnapshot: Flashcard[];
  currentIndex: number;
  isFlipped: boolean;
  previousProgressRecord?: CardProgressRecord;
}

export class StudyView extends ItemView {
  plugin: SeeLearnPlugin;
  private selectedTags: Set<string> = new Set();
  private selectedScope: string = ''; // '' for all, 'folder:...' or 'file:...'
  private srsFilter: SRSQueueFilter = 'all';
  private tagSearchQuery: string = '';
  private sessionQueue: Flashcard[] = [];
  private currentIndex: number = 0;
  private isFlipped: boolean = false;
  private activeCardComponent: Component | null = null;

  // Session metrics for summary dashboard
  private sessionStats = {
    totalReviewed: 0,
    againCount: 0,
    hardCount: 0,
    goodCount: 0,
    easyCount: 0,
    failedCards: [] as Flashcard[],
  };

  // Undo history stack
  private historyStack: HistoryEntry[] = [];

  // DOM Elements
  private toolbarEl!: HTMLElement;
  private tagsBarEl!: HTMLElement;
  private cardAreaEl!: HTMLElement;
  private navBarEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: SeeLearnPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_SEELEARN;
  }

  getDisplayText(): string {
    return 'SeeLearn: Карточки';
  }

  getIcon(): string {
    return 'layers';
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass('seelearn-view-root');

    // Create main layout sections
    this.toolbarEl = root.createDiv({ cls: 'seelearn-toolbar' });
    this.tagsBarEl = root.createDiv({ cls: 'seelearn-tags-bar' });
    this.cardAreaEl = root.createDiv({ cls: 'seelearn-card-area' });
    this.navBarEl = root.createDiv({ cls: 'seelearn-nav-bar' });

    // Register keyboard navigation
    this.registerDomEvent(window, 'keydown', (evt: KeyboardEvent) => {
      if (!this.containerEl.isShown()) return;

      const target = evt.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      // Undo: Ctrl+Z / Cmd+Z / Key U
      if ((evt.ctrlKey || evt.metaKey) && evt.code === 'KeyZ') {
        evt.preventDefault();
        this.undoLastAction();
        return;
      }

      if (evt.code === 'Space') {
        if (this.plugin.settings.autoFlipOnSpace) {
          evt.preventDefault();
          this.handleSpace();
        }
      } else if (evt.code === 'ArrowLeft') {
        evt.preventDefault();
        this.prevCard();
      } else if (evt.code === 'ArrowRight') {
        evt.preventDefault();
        this.nextCard();
      } else if (this.isTestMode()) {
        if (this.isFlipped) {
          if (evt.code === 'Digit1' || evt.code === 'Numpad1') {
            evt.preventDefault();
            this.handleSRSRating('again');
          } else if (evt.code === 'Digit2' || evt.code === 'Numpad2') {
            evt.preventDefault();
            this.handleSRSRating('hard');
          } else if (evt.code === 'Digit3' || evt.code === 'Numpad3') {
            evt.preventDefault();
            this.handleSRSRating('good');
          } else if (evt.code === 'Digit4' || evt.code === 'Numpad4') {
            evt.preventDefault();
            this.handleSRSRating('easy');
          }
        }
      }
    });

    this.resetSession();
  }

  async onClose(): Promise<void> {
    this.cleanupCardComponent();
    this.contentEl.empty();
  }

  private isTestMode(): boolean {
    return this.plugin.settings.studyMode === 'test' || this.plugin.settings.studyMode === 'srs';
  }

  /**
   * Resets the session queue according to currently active filters and scope.
   */
  public resetSession(keepIndex = false): void {
    let filtered = this.getFilteredCards();

    if (this.plugin.settings.shuffleOnStart) {
      filtered = this.plugin.settings.interleaveTopics
        ? interleaveCards(filtered)
        : fisherYatesShuffle(filtered);
    }

    this.sessionQueue = [...filtered];

    if (!keepIndex || this.currentIndex >= this.sessionQueue.length) {
      this.currentIndex = 0;
    }
    this.isFlipped = false;

    this.renderAll();
  }

  /**
   * Refreshes the view when plugin index is updated.
   */
  public onIndexUpdated(): void {
    const currentCardId = this.sessionQueue[this.currentIndex]?.id;
    const filtered = this.getFilteredCards();
    this.sessionQueue = [...filtered];

    if (currentCardId) {
      const newIndex = this.sessionQueue.findIndex((c) => c.id === currentCardId);
      this.currentIndex = newIndex >= 0 ? newIndex : 0;
    } else {
      this.currentIndex = 0;
    }

    this.renderAll();
  }

  private cardMatchesScope(card: Flashcard): boolean {
    if (!this.selectedScope) return true;
    if (this.selectedScope.startsWith('folder:')) {
      const folder = this.selectedScope.substring(7);
      return card.filePath === folder || card.filePath.startsWith(`${folder}/`);
    }
    if (this.selectedScope.startsWith('file:')) {
      const file = this.selectedScope.substring(5);
      return card.filePath === file;
    }
    return true;
  }

  private getFilteredCards(): Flashcard[] {
    const todayStr = new Date().toISOString().split('T')[0];

    const matching = this.plugin.cards.filter((card) => {
      // Scope filter (folder or file)
      if (!this.cardMatchesScope(card)) {
        return false;
      }

      // Tag filter
      if (this.selectedTags.size > 0) {
        for (const tag of this.selectedTags) {
          if (!card.tags.includes(tag)) {
            return false;
          }
        }
      }

      // Test / SRS Queue filter
      if (this.isTestMode()) {
        const record = this.plugin.storage.getProgress(card.id);
        if (this.srsFilter === 'due' && !isCardDue(record, todayStr)) {
          return false;
        }
        if (this.srsFilter === 'new' && !isCardNew(record)) {
          return false;
        }
      }

      return true;
    });

    if (this.isTestMode() && this.srsFilter === 'all') {
      const dueCards = matching.filter((c) =>
        isCardDue(this.plugin.storage.getProgress(c.id), todayStr)
      );
      const newCards = matching.filter((c) =>
        isCardNew(this.plugin.storage.getProgress(c.id))
      );
      const otherCards = matching.filter(
        (c) =>
          !isCardDue(this.plugin.storage.getProgress(c.id), todayStr) &&
          !isCardNew(this.plugin.storage.getProgress(c.id))
      );

      const maxDue = this.plugin.settings.maxDuePerSession || 50;
      const maxNew = this.plugin.settings.maxNewPerSession || 25;

      return [...dueCards.slice(0, maxDue), ...newCards.slice(0, maxNew), ...otherCards];
    }

    return matching;
  }

  private getAllAvailableTags(): { tag: string; count: number }[] {
    const tagCounts = new Map<string, number>();
    const baseCards = this.plugin.cards.filter((c) => this.cardMatchesScope(c));

    for (const card of baseCards) {
      for (const tag of card.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    return Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  private getAvailableScopes(): {
    folders: { path: string; label: string; count: number }[];
    files: { path: string; label: string; count: number }[];
  } {
    const folderCounts = new Map<string, number>();
    const fileCounts = new Map<string, number>();

    for (const card of this.plugin.cards) {
      fileCounts.set(card.filePath, (fileCounts.get(card.filePath) || 0) + 1);

      const parts = card.filePath.split('/');
      let currentFolder = '';
      for (let i = 0; i < parts.length - 1; i++) {
        currentFolder = currentFolder ? `${currentFolder}/${parts[i]}` : parts[i];
        folderCounts.set(currentFolder, (folderCounts.get(currentFolder) || 0) + 1);
      }
    }

    const folders = Array.from(folderCounts.entries())
      .map(([path, count]) => ({ path, label: `📁 ${path}/`, count }))
      .sort((a, b) => a.path.localeCompare(b.path));

    const files = Array.from(fileCounts.entries())
      .map(([path, count]) => ({
        path,
        label: `📄 ${path.split('/').pop() || path}`,
        count,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return { folders, files };
  }

  private renderAll(): void {
    this.renderToolbar();
    this.renderTagsBar();
    this.renderCardArea();
    this.renderNavBar();
  }

  /**
   * Renders the top toolbar with Mode Switcher (Ботать / Проверить знания), Scope Selector, Shuffle, and Stats.
   */
  private renderToolbar(): void {
    this.toolbarEl.empty();

    const leftGroup = this.toolbarEl.createDiv({ cls: 'seelearn-toolbar-group left' });
    const rightGroup = this.toolbarEl.createDiv({ cls: 'seelearn-toolbar-group right' });

    // 1. Study Mode Switcher: [ 📖 Ботать | 🎯 Проверить знания ]
    const modeSwitch = leftGroup.createDiv({ cls: 'seelearn-mode-switch' });
    const isTest = this.isTestMode();

    const learnBtn = modeSwitch.createEl('button', {
      cls: `seelearn-mode-btn ${!isTest ? 'is-active' : ''}`,
      text: '📖 Ботать',
      title: 'Режим изучения: чтение и просмотр материала без оценок (по умолчанию)',
    });
    learnBtn.addEventListener('click', async () => {
      this.plugin.settings.studyMode = 'learn';
      await this.plugin.saveSettings();
      this.resetSession();
    });

    const testBtn = modeSwitch.createEl('button', {
      cls: `seelearn-mode-btn ${isTest ? 'is-active' : ''}`,
      text: '🎯 Проверить знания',
      title: 'Режим тестирования: интервальное повторение SM-2, оценки 1-4 и замер успехов',
    });
    testBtn.addEventListener('click', async () => {
      this.plugin.settings.studyMode = 'test';
      await this.plugin.saveSettings();
      this.resetSession();
    });

    // 2. Scope Selector Dropdown (Folder / File)
    const { folders, files } = this.getAvailableScopes();
    const scopeSelect = leftGroup.createEl('select', { cls: 'dropdown seelearn-file-select' });

    const defaultOption = scopeSelect.createEl('option', {
      value: '',
      text: `Все заметки (${this.plugin.cards.length} карт)`,
    });
    if (!this.selectedScope) defaultOption.selected = true;

    if (folders.length > 0) {
      const folderGroup = scopeSelect.createEl('optgroup');
      folderGroup.label = 'Папки';
      for (const f of folders) {
        const opt = folderGroup.createEl('option', {
          value: `folder:${f.path}`,
          text: `${f.label} (${f.count})`,
        });
        if (this.selectedScope === `folder:${f.path}`) opt.selected = true;
      }
    }

    if (files.length > 0) {
      const fileGroup = scopeSelect.createEl('optgroup');
      fileGroup.label = 'Заметки';
      for (const f of files) {
        const opt = fileGroup.createEl('option', {
          value: `file:${f.path}`,
          text: `${f.label} (${f.count})`,
        });
        if (this.selectedScope === `file:${f.path}`) opt.selected = true;
      }
    }

    scopeSelect.addEventListener('change', () => {
      this.selectedScope = scopeSelect.value;
      this.resetSession();
    });

    // 3. Shuffle Button
    const shuffleBtn = leftGroup.createEl('button', {
      cls: 'clickable-icon seelearn-btn-icon',
      title: 'Перемешать колоду',
    });
    setIcon(shuffleBtn, 'shuffle');
    shuffleBtn.addEventListener('click', () => {
      this.shuffleQueue();
    });

    // 4. Refresh Button
    const refreshBtn = leftGroup.createEl('button', {
      cls: 'clickable-icon seelearn-btn-icon',
      title: 'Переиндексировать хранилище',
    });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', async () => {
      new Notice('SeeLearn: переиндексация карточек...');
      await this.plugin.reloadAllCards();
    });

    // 5. Scoped SRS Queue Filter Pills (reflects ONLY cards in selected scope!)
    if (isTest) {
      const scopedCards = this.plugin.cards.filter((c) => this.cardMatchesScope(c));
      const breakdown = this.plugin.storage.getSRSBreakdown(scopedCards);
      const srsGroup = this.toolbarEl.createDiv({ cls: 'seelearn-srs-filter-group' });

      const allPill = srsGroup.createEl('button', {
        cls: `seelearn-srs-pill ${this.srsFilter === 'all' ? 'is-active' : ''}`,
        text: `Все (${breakdown.total})`,
        title: 'Показать все карточки в выбранной области',
      });
      allPill.addEventListener('click', () => {
        this.srsFilter = 'all';
        this.resetSession();
      });

      const duePill = srsGroup.createEl('button', {
        cls: `seelearn-srs-pill seelearn-pill-due ${this.srsFilter === 'due' ? 'is-active' : ''}`,
        text: `К повторению (${breakdown.due})`,
        title: 'Карточки, запланированные на сегодня в этой папке/странице',
      });
      duePill.addEventListener('click', () => {
        this.srsFilter = 'due';
        this.resetSession();
      });

      const newPill = srsGroup.createEl('button', {
        cls: `seelearn-srs-pill seelearn-pill-new ${this.srsFilter === 'new' ? 'is-active' : ''}`,
        text: `Новые (${breakdown.newCards})`,
        title: 'Еще не изученные карточки в этой папке/странице',
      });
      newPill.addEventListener('click', () => {
        this.srsFilter = 'new';
        this.resetSession();
      });
    }

    // 6. Validation warnings badge (if any)
    if (this.plugin.warnings.length > 0) {
      const warnBadge = rightGroup.createEl('button', {
        cls: 'seelearn-badge seelearn-badge-warning',
        text: `⚠️ Ошибки: ${this.plugin.warnings.length}`,
        title: 'Нажмите, чтобы просмотреть предупреждения валидации',
      });
      warnBadge.addEventListener('click', () => {
        new WarningsModal(this.app, this.plugin.warnings).open();
      });
    }

    // 7. Card Counter
    const total = this.sessionQueue.length;
    const current = total > 0 ? this.currentIndex + 1 : 0;
    rightGroup.createDiv({
      cls: 'seelearn-counter-badge',
      text: `Карта ${current} из ${total}`,
    });
  }

  /**
   * Renders tag chips with search input when count > 6.
   */
  private renderTagsBar(): void {
    this.tagsBarEl.empty();

    const tags = this.getAllAvailableTags();
    if (tags.length === 0) {
      this.tagsBarEl.style.display = 'none';
      return;
    }
    this.tagsBarEl.style.display = 'flex';

    // Render search input if tags count > 6
    if (tags.length > 6) {
      const searchBox = this.tagsBarEl.createDiv({ cls: 'seelearn-tag-search-box' });
      setIcon(searchBox.createSpan({ cls: 'seelearn-tag-search-icon' }), 'search');
      const searchInput = searchBox.createEl('input', {
        type: 'text',
        cls: 'seelearn-tag-search-input',
        placeholder: 'Поиск темы...',
        value: this.tagSearchQuery,
      });

      searchInput.addEventListener('input', () => {
        this.tagSearchQuery = searchInput.value;
        this.renderTagChipsList(chipsContainer, tags);
      });

      if (this.tagSearchQuery) {
        const clearBtn = searchBox.createSpan({ cls: 'seelearn-tag-search-clear', text: '×' });
        clearBtn.addEventListener('click', () => {
          this.tagSearchQuery = '';
          this.renderTagsBar();
        });
      }
    }

    const chipsContainer = this.tagsBarEl.createDiv({ cls: 'seelearn-tags-chips-container' });
    this.renderTagChipsList(chipsContainer, tags);
  }

  private renderTagChipsList(
    container: HTMLElement,
    tags: { tag: string; count: number }[]
  ): void {
    container.empty();

    // "All" chip
    const allChip = container.createEl('button', {
      cls: `seelearn-tag-chip ${this.selectedTags.size === 0 ? 'is-active' : ''}`,
      text: 'Все темы',
    });
    allChip.addEventListener('click', () => {
      this.selectedTags.clear();
      this.resetSession();
    });

    const filteredTags = this.tagSearchQuery
      ? tags.filter((t) => t.tag.toLowerCase().includes(this.tagSearchQuery.toLowerCase()))
      : tags;

    for (const { tag, count } of filteredTags) {
      const isActive = this.selectedTags.has(tag);
      const chip = container.createEl('button', {
        cls: `seelearn-tag-chip ${isActive ? 'is-active' : ''}`,
      });
      chip.createSpan({ text: `#${tag}` });
      chip.createSpan({ cls: 'seelearn-tag-count', text: `${count}` });

      chip.addEventListener('click', () => {
        if (this.selectedTags.has(tag)) {
          this.selectedTags.delete(tag);
        } else {
          this.selectedTags.add(tag);
        }
        this.resetSession();
      });
    }

    if (filteredTags.length === 0 && this.tagSearchQuery) {
      container.createSpan({
        cls: 'seelearn-tags-empty-hint',
        text: 'Тема не найдена',
      });
    }
  }

  /**
   * Renders the card container, header, progress track, and markdown content.
   */
  private async renderCardArea(): Promise<void> {
    this.cleanupCardComponent();
    this.cardAreaEl.empty();

    if (this.sessionQueue.length === 0) {
      this.renderEmptyState();
      return;
    }

    const card = this.sessionQueue[this.currentIndex];
    if (!card) {
      this.renderEmptyState();
      return;
    }

    const cardContainer = this.cardAreaEl.createDiv({ cls: 'seelearn-card-container' });
    if (this.plugin.settings.enable3DFlip) {
      cardContainer.addClass('seelearn-enable-3d');
    }
    if (this.isFlipped) {
      cardContainer.addClass('is-flipped');
    }

    // Progress Bar Track at top of card
    const progressTrack = cardContainer.createDiv({ cls: 'seelearn-progress-track' });
    const percent = Math.min(
      100,
      Math.round(((this.currentIndex + 1) / this.sessionQueue.length) * 100)
    );
    const progressFill = progressTrack.createDiv({ cls: 'seelearn-progress-fill' });
    progressFill.style.width = `${percent}%`;

    // Card Header (Tags, File, Jump to Note button)
    const cardHeader = cardContainer.createDiv({ cls: 'seelearn-card-header' });

    const headerLeft = cardHeader.createDiv({ cls: 'seelearn-header-left' });

    // Progress badge / Card kind pill
    const progress = this.plugin.storage.getProgress(card.id);
    const progressPill = headerLeft.createSpan({ cls: 'seelearn-progress-pill' });

    if (!card.hasBack) {
      progressPill.setText('ИНФО');
      progressPill.addClass('is-info');
      progressPill.setAttribute('title', 'Односторонняя карточка для изучения информации');
    } else if (this.isTestMode()) {
      if (progress && progress.repetitions > 0) {
        progressPill.setText(`Интервал: ${progress.interval} дн.`);
        progressPill.addClass('is-learned');
        progressPill.setAttribute(
          'title',
          `Повторений: ${progress.repetitions}, Фактор легкости: ${progress.easeFactor}, Забываний: ${progress.lapses}`
        );
      } else {
        progressPill.setText('Новая карта');
        progressPill.addClass('is-new');
      }
    } else {
      progressPill.setText('КАРТОЧКА');
      progressPill.addClass('is-learn');
    }

    // Tags list container with overflow scroll
    if (card.tags.length > 0) {
      const tagsContainer = headerLeft.createDiv({ cls: 'seelearn-card-tags' });
      for (const tag of card.tags) {
        tagsContainer.createSpan({ cls: 'seelearn-card-tag-pill', text: `#${tag}` });
      }
    }

    const headerRight = cardHeader.createDiv({ cls: 'seelearn-header-right' });

    const fileLabel = headerRight.createDiv({
      cls: 'seelearn-file-link',
      title: `Файл: ${card.filePath}, строка ${card.lineStart}`,
    });
    setIcon(fileLabel.createSpan({ cls: 'seelearn-icon-inline' }), 'file-text');
    fileLabel.createSpan({ text: `${card.fileName}:${card.lineStart}` });

    const jumpBtn = headerRight.createEl('button', {
      cls: 'seelearn-jump-btn',
      title: 'Открыть заметку на этой карточке',
    });
    setIcon(jumpBtn.createSpan({ cls: 'seelearn-icon-inline' }), 'external-link');
    jumpBtn.createSpan({ text: 'В заметку' });
    jumpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openCardInNote(card);
    });

    // Card Body
    const cardBody = cardContainer.createDiv({ cls: 'seelearn-card-body' });

    // Create Component for MarkdownRenderer lifecycle
    this.activeCardComponent = new Component();
    this.addChild(this.activeCardComponent);
    this.activeCardComponent.load();

    if (!card.hasBack) {
      // FRONT-ONLY INFO CARD
      const frontEl = cardBody.createDiv({ cls: 'seelearn-content seelearn-front' });
      await MarkdownRenderer.render(
        this.app,
        card.front,
        frontEl,
        card.filePath,
        this.activeCardComponent
      );

      const promptEl = cardBody.createDiv({ cls: 'seelearn-flip-prompt' });
      promptEl.createSpan({ text: 'Нажмите Пробел или кнопку «Далее» для продолжения' });

      cardBody.addEventListener('click', () => {
        this.nextCard();
      });
    } else if (!this.isFlipped) {
      // TWO-SIDED CARD: Question (@front)
      const frontEl = cardBody.createDiv({ cls: 'seelearn-content seelearn-front' });
      await MarkdownRenderer.render(
        this.app,
        card.front,
        frontEl,
        card.filePath,
        this.activeCardComponent
      );

      const promptEl = cardBody.createDiv({ cls: 'seelearn-flip-prompt' });
      promptEl.createSpan({ text: 'Нажмите Пробел или карточку, чтобы посмотреть ответ' });

      cardBody.addEventListener('click', () => {
        this.flipCard();
      });
    } else {
      // TWO-SIDED CARD: Answer (@back)
      if (this.plugin.settings.revealMode === 'append') {
        const frontEl = cardBody.createDiv({
          cls: 'seelearn-content seelearn-front seelearn-faded',
        });
        await MarkdownRenderer.render(
          this.app,
          card.front,
          frontEl,
          card.filePath,
          this.activeCardComponent
        );

        const dividerEl = cardBody.createDiv({ cls: 'seelearn-divider' });
        dividerEl.createSpan({ cls: 'seelearn-divider-text', text: 'ОТВЕТ' });

        const backEl = cardBody.createDiv({ cls: 'seelearn-content seelearn-back' });
        await MarkdownRenderer.render(
          this.app,
          card.back,
          backEl,
          card.filePath,
          this.activeCardComponent
        );
      } else {
        const backEl = cardBody.createDiv({ cls: 'seelearn-content seelearn-back' });
        await MarkdownRenderer.render(
          this.app,
          card.back,
          backEl,
          card.filePath,
          this.activeCardComponent
        );
      }
    }
  }

  /**
   * Renders empty or completed state with session summary dashboard.
   */
  private renderEmptyState(): void {
    const emptyBox = this.cardAreaEl.createDiv({ cls: 'seelearn-empty-box' });

    if (this.plugin.cards.length === 0) {
      setIcon(emptyBox.createDiv({ cls: 'seelearn-empty-icon' }), 'inbox');
      emptyBox.createEl('h3', { text: 'Карточки не найдены' });
      emptyBox.createEl('p', {
        text: `Убедитесь, что в свойствах заметок указано ${this.plugin.settings.triggerProperty}: ${this.plugin.settings.triggerValue} и используется разметка %% @card %% ... %% @end %%.`,
      });

      const helpCode = emptyBox.createEl('pre', { cls: 'seelearn-sample-code' });
      helpCode.createEl('code', {
        text: `---
tags:
  - seelearn
topics:
  - Разработка
---

%% @card #frontend %%
%% @front %%
Что такое Virtual DOM?
%% @back %%
Легковесная копия реального DOM для оптимизации рендеринга.
%% @end %%`,
      });
    } else {
      // SESSION SUMMARY DASHBOARD
      setIcon(emptyBox.createDiv({ cls: 'seelearn-empty-icon seelearn-icon-celebrate' }), 'award');
      emptyBox.createEl('h2', { text: '🎉 Сессия завершена!' });
      emptyBox.createEl('p', {
        text: this.isTestMode()
          ? 'Вы повторили запланированные карточки по графику интервального повторения.'
          : 'Вы изучили все карточки в выбранной области.',
      });

      const statsGrid = emptyBox.createDiv({ cls: 'seelearn-stats-grid' });

      const item1 = statsGrid.createDiv({ cls: 'seelearn-stat-card' });
      item1.createDiv({ cls: 'seelearn-stat-val', text: `${this.sessionStats.totalReviewed}` });
      item1.createDiv({ cls: 'seelearn-stat-lbl', text: 'Пройдено карточек' });

      if (this.isTestMode()) {
        const successes = this.sessionStats.goodCount + this.sessionStats.easyCount;
        const totalAnswers = successes + this.sessionStats.hardCount + this.sessionStats.againCount;
        const successRate = totalAnswers > 0 ? Math.round((successes / totalAnswers) * 100) : 100;

        const item2 = statsGrid.createDiv({ cls: 'seelearn-stat-card' });
        item2.createDiv({ cls: 'seelearn-stat-val', text: `${successRate}%` });
        item2.createDiv({ cls: 'seelearn-stat-lbl', text: 'Успешность (Good/Easy)' });

        const item3 = statsGrid.createDiv({ cls: 'seelearn-stat-card' });
        item3.createDiv({ cls: 'seelearn-stat-val', text: `${this.sessionStats.againCount}` });
        item3.createDiv({ cls: 'seelearn-stat-lbl', text: 'Забываний (Снова)' });
      }

      const actionsRow = emptyBox.createDiv({ cls: 'seelearn-summary-actions' });

      const restartBtn = actionsRow.createEl('button', {
        cls: 'mod-cta',
        text: 'Повторить сессию снова',
      });
      restartBtn.addEventListener('click', () => {
        this.sessionStats = {
          totalReviewed: 0,
          againCount: 0,
          hardCount: 0,
          goodCount: 0,
          easyCount: 0,
          failedCards: [],
        };
        this.resetSession();
      });

      if (this.sessionStats.failedCards.length > 0) {
        const repeatFailedBtn = actionsRow.createEl('button', {
          cls: 'seelearn-nav-btn seelearn-btn-repeat',
          text: `Повторить с ошибками (${this.sessionStats.failedCards.length})`,
        });
        repeatFailedBtn.addEventListener('click', () => {
          this.sessionQueue = [...this.sessionStats.failedCards];
          this.sessionStats.failedCards = [];
          this.currentIndex = 0;
          this.isFlipped = false;
          this.renderAll();
        });
      }
    }
  }

  /**
   * Renders the bottom navigation bar with Learn Mode navigation, SRS ratings, and Undo button.
   */
  private renderNavBar(): void {
    this.navBarEl.empty();

    const hasCards = this.sessionQueue.length > 0;
    const isFirst = this.currentIndex === 0;
    const isLast = this.currentIndex >= this.sessionQueue.length - 1;
    const currentCard = this.sessionQueue[this.currentIndex];

    const leftNav = this.navBarEl.createDiv({ cls: 'seelearn-nav-group left' });
    const centerNav = this.navBarEl.createDiv({ cls: 'seelearn-nav-group center' });
    const rightNav = this.navBarEl.createDiv({ cls: 'seelearn-nav-group right' });

    // Left Navigation: Previous Card
    const prevBtn = leftNav.createEl('button', {
      cls: 'seelearn-nav-btn',
      text: '← Назад',
      title: 'Предыдущая карточка (ArrowLeft)',
    });
    prevBtn.disabled = !hasCards || isFirst;
    prevBtn.addEventListener('click', () => this.prevCard());

    // Center Controls: Dependent on Mode and Card Type
    if (!this.isTestMode()) {
      // LEARN MODE (Режим "Ботать" по умолчанию)
      if (currentCard?.hasBack) {
        const flipText = !this.isFlipped ? 'Показать ответ (Space)' : 'Скрыть ответ (Space)';
        const flipBtn = centerNav.createEl('button', {
          cls: 'seelearn-nav-btn mod-cta',
          text: flipText,
          title: 'Перевернуть карточку (Space)',
        });
        flipBtn.disabled = !hasCards;
        flipBtn.addEventListener('click', () => this.flipCard());
      }

      const nextBtn = centerNav.createEl('button', {
        cls: 'seelearn-nav-btn',
        text: 'Далее →',
        title: 'Следующая карточка (ArrowRight / Space)',
      });
      nextBtn.disabled = !hasCards || isLast;
      nextBtn.addEventListener('click', () => this.nextCard());
    } else {
      // TEST MODE (Режим "Проверить знания" с SM-2)
      if (!currentCard?.hasBack) {
        // Front-only info card in test mode
        const readBtn = centerNav.createEl('button', {
          cls: 'seelearn-nav-btn mod-cta',
          text: 'Понятно / Изучено ✓ (Space)',
        });
        readBtn.disabled = !hasCards;
        readBtn.addEventListener('click', () => this.handleSRSRating('good'));
      } else if (!this.isFlipped) {
        // Front of two-sided card in test mode
        const flipBtn = centerNav.createEl('button', {
          cls: 'seelearn-nav-btn mod-cta',
          text: 'Показать ответ (Space)',
          title: 'Перевернуть карточку (Space)',
        });
        flipBtn.disabled = !hasCards;
        flipBtn.addEventListener('click', () => this.flipCard());

        const nextBtn = centerNav.createEl('button', {
          cls: 'seelearn-nav-btn',
          text: 'Далее →',
          title: 'Следующая карточка (ArrowRight)',
        });
        nextBtn.disabled = !hasCards || isLast;
        nextBtn.addEventListener('click', () => this.nextCard());
      } else {
        // Back of two-sided card: 4 SRS Rating Buttons with predicted intervals
        const record = currentCard ? this.plugin.storage.getProgress(currentCard.id) : undefined;
        const previews = getSRSIntervalPreviews(record);

        // [1] Снова
        const againBtn = centerNav.createEl('button', {
          cls: 'seelearn-nav-btn seelearn-btn-srs seelearn-btn-again',
          title: 'Забыл ответ (клавиша 1)',
        });
        againBtn.createSpan({ cls: 'seelearn-srs-title', text: '[1] Снова' });
        againBtn.createSpan({ cls: 'seelearn-srs-badge', text: previews.again });
        againBtn.addEventListener('click', () => this.handleSRSRating('again'));

        // [2] Трудно
        const hardBtn = centerNav.createEl('button', {
          cls: 'seelearn-nav-btn seelearn-btn-srs seelearn-btn-hard',
          title: 'Вспомнил с заметным трудом (клавиша 2)',
        });
        hardBtn.createSpan({ cls: 'seelearn-srs-title', text: '[2] Трудно' });
        hardBtn.createSpan({ cls: 'seelearn-srs-badge', text: previews.hard });
        hardBtn.addEventListener('click', () => this.handleSRSRating('hard'));

        // [3] Хорошо
        const goodBtn = centerNav.createEl('button', {
          cls: 'seelearn-nav-btn seelearn-btn-srs seelearn-btn-good mod-cta',
          title: 'Уверенно вспомнил (клавиша 3)',
        });
        goodBtn.createSpan({ cls: 'seelearn-srs-title', text: '[3] Хорошо' });
        goodBtn.createSpan({ cls: 'seelearn-srs-badge', text: previews.good });
        goodBtn.addEventListener('click', () => this.handleSRSRating('good'));

        // [4] Легко
        const easyBtn = centerNav.createEl('button', {
          cls: 'seelearn-nav-btn seelearn-btn-srs seelearn-btn-easy',
          title: 'Мгновенный и легкий ответ (клавиша 4)',
        });
        easyBtn.createSpan({ cls: 'seelearn-srs-title', text: '[4] Легко' });
        easyBtn.createSpan({ cls: 'seelearn-srs-badge', text: previews.easy });
        easyBtn.addEventListener('click', () => this.handleSRSRating('easy'));
      }
    }

    // Right Controls: Undo Button
    const undoBtn = rightNav.createEl('button', {
      cls: 'seelearn-nav-btn seelearn-btn-undo',
      text: '↶ Отмена',
      title: 'Отменить последнее действие (Ctrl+Z / Cmd+Z)',
    });
    undoBtn.disabled = this.historyStack.length === 0;
    undoBtn.addEventListener('click', () => this.undoLastAction());
  }

  // --- ACTIONS ---

  private handleSpace(): void {
    if (this.sessionQueue.length === 0) return;
    const currentCard = this.sessionQueue[this.currentIndex];

    if (!currentCard?.hasBack) {
      // Front-only card: Space advances
      if (this.isTestMode()) {
        this.handleSRSRating('good');
      } else {
        this.nextCard();
      }
    } else if (!this.isFlipped) {
      this.flipCard();
    } else {
      if (this.isTestMode()) {
        this.handleSRSRating('good');
      } else {
        if (this.currentIndex < this.sessionQueue.length - 1) {
          this.nextCard();
        } else {
          this.flipCard();
        }
      }
    }
  }

  private flipCard(): void {
    if (this.sessionQueue.length === 0) return;
    const currentCard = this.sessionQueue[this.currentIndex];
    if (!currentCard?.hasBack) return; // Cannot flip front-only card

    this.isFlipped = !this.isFlipped;
    this.renderCardArea();
    this.renderNavBar();
  }

  private nextCard(): void {
    if (this.currentIndex < this.sessionQueue.length - 1) {
      this.pushHistoryState();
      this.currentIndex++;
      this.isFlipped = false;
      this.sessionStats.totalReviewed++;
      this.renderToolbar();
      this.renderCardArea();
      this.renderNavBar();
    } else if (this.currentIndex === this.sessionQueue.length - 1) {
      // Finished all cards
      this.sessionStats.totalReviewed++;
      this.sessionQueue = [];
      this.renderAll();
    }
  }

  private prevCard(): void {
    if (this.currentIndex > 0) {
      this.pushHistoryState();
      this.currentIndex--;
      this.isFlipped = false;
      this.renderToolbar();
      this.renderCardArea();
      this.renderNavBar();
    }
  }

  private handleSRSRating(rating: SRSRating): void {
    if (this.sessionQueue.length === 0) return;

    this.pushHistoryState();
    const card = this.sessionQueue[this.currentIndex];
    const result = this.plugin.storage.recordReview(card.id, rating);

    this.sessionStats.totalReviewed++;
    if (rating === 'again') {
      this.sessionStats.againCount++;
      if (!this.sessionStats.failedCards.some((c) => c.id === card.id)) {
        this.sessionStats.failedCards.push(card);
      }
    } else if (rating === 'hard') {
      this.sessionStats.hardCount++;
    } else if (rating === 'good') {
      this.sessionStats.goodCount++;
    } else if (rating === 'easy') {
      this.sessionStats.easyCount++;
    }

    const labels: Record<SRSRating, string> = {
      again: 'Снова (<1д)',
      hard: `Трудно (${result.interval} дн.)`,
      good: `Хорошо (${result.interval} дн.)`,
      easy: `Легко (${result.interval} дн.)`,
    };

    new Notice(`${labels[rating]} — интервал обновлен`);

    if (rating === 'again') {
      this.sessionQueue.splice(this.currentIndex, 1);
      const step = Math.max(1, this.plugin.settings.requeueStep || 3);
      const insertAt = Math.min(this.sessionQueue.length, this.currentIndex + step);
      this.sessionQueue.splice(insertAt, 0, card);
    } else {
      this.sessionQueue.splice(this.currentIndex, 1);
    }

    if (this.currentIndex >= this.sessionQueue.length) {
      this.currentIndex = Math.max(0, this.sessionQueue.length - 1);
    }

    this.isFlipped = false;
    this.renderAll();
  }

  private pushHistoryState(): void {
    const card = this.sessionQueue[this.currentIndex];
    if (!card) return;

    this.historyStack.push({
      cardId: card.id,
      queueSnapshot: [...this.sessionQueue],
      currentIndex: this.currentIndex,
      isFlipped: this.isFlipped,
      previousProgressRecord: this.plugin.storage.getProgress(card.id)
        ? JSON.parse(JSON.stringify(this.plugin.storage.getProgress(card.id)))
        : undefined,
    });

    if (this.historyStack.length > 25) {
      this.historyStack.shift();
    }
  }

  private undoLastAction(): void {
    if (this.historyStack.length === 0) return;

    const last = this.historyStack.pop()!;
    this.sessionQueue = last.queueSnapshot;
    this.currentIndex = last.currentIndex;
    this.isFlipped = last.isFlipped;

    if (last.previousProgressRecord) {
      this.plugin.storage.data.progress[last.cardId] = last.previousProgressRecord;
      this.plugin.storage.scheduleSave();
    } else {
      delete this.plugin.storage.data.progress[last.cardId];
      this.plugin.storage.scheduleSave();
    }

    new Notice('Действие отменено (Undo)');
    this.renderAll();
  }

  private shuffleQueue(): void {
    if (this.sessionQueue.length <= 1) return;

    this.sessionQueue = this.plugin.settings.interleaveTopics
      ? interleaveCards(this.sessionQueue)
      : fisherYatesShuffle(this.sessionQueue);

    this.currentIndex = 0;
    this.isFlipped = false;
    new Notice(
      this.plugin.settings.interleaveTopics
        ? 'Колода перемешана (с чередованием тем)'
        : 'Колода перемешана (Фишер-Йетс)'
    );
    this.renderAll();
  }

  private async openCardInNote(card: Flashcard): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(card.filePath);
    if (file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf(false);
      const targetLine = Math.max(0, card.lineStart - 1);
      await leaf.openFile(file, {
        eState: {
          line: targetLine,
          cursor: {
            from: { line: targetLine, ch: 0 },
            to: { line: targetLine, ch: 0 },
          },
        },
      });
    } else {
      new Notice(`Файл не найден: ${card.filePath}`);
    }
  }

  private cleanupCardComponent(): void {
    if (this.activeCardComponent) {
      this.removeChild(this.activeCardComponent);
      this.activeCardComponent.unload();
      this.activeCardComponent = null;
    }
  }
}

/**
 * Modal dialog for displaying validation warnings and jumping to issues.
 */
class WarningsModal extends Modal {
  private warnings: ValidationWarning[];

  constructor(app: App, warnings: ValidationWarning[]) {
    super(app);
    this.warnings = warnings;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: `Предупреждения валидации (${this.warnings.length})` });

    const list = contentEl.createEl('div', { cls: 'seelearn-warnings-list' });

    for (const warn of this.warnings) {
      const item = list.createDiv({ cls: 'seelearn-warning-item' });
      const title = item.createDiv({ cls: 'seelearn-warning-title' });
      title.createEl('strong', { text: `${warn.filePath}:${warn.line}` });

      item.createDiv({ cls: 'seelearn-warning-msg', text: warn.message });

      if (warn.rawText) {
        item.createEl('code', { text: warn.rawText });
      }

      const openBtn = item.createEl('button', {
        cls: 'mod-small',
        text: 'Перейти к строке',
      });
      openBtn.addEventListener('click', async () => {
        const file = this.app.vault.getAbstractFileByPath(warn.filePath);
        if (file instanceof TFile) {
          const leaf = this.app.workspace.getLeaf(false);
          await leaf.openFile(file, {
            eState: { line: Math.max(0, warn.line - 1) },
          });
          this.close();
        }
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
