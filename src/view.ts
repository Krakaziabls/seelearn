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
  Setting,
} from 'obsidian';
import type SeeLearnPlugin from './main';
import { CardProgressRecord, Flashcard, SRSQueueFilter, TestPreset, ValidationWarning } from './types';
import { fisherYatesShuffle, interleaveCards } from './shuffle';
import { getSRSIntervalPreviews, isCardDue, isCardLeech, isCardNew, SRSRating } from './srs';

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
  private sessionState: 'lobby' | 'active' | 'finished' = 'lobby';
  private activePresetName?: string;

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
      // Check if StudyView or leaf has focus
      const activeView = this.app.workspace.getActiveViewOfType(StudyView);
      const isFocused = this.containerEl.contains(document.activeElement);
      if (activeView !== this && !isFocused) return;

      const target = evt.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable ||
          target.closest('input, textarea, select, [contenteditable="true"]'))
      ) {
        return;
      }

      // Lobby navigation: Space or Enter starts the session
      if (this.sessionState === 'lobby') {
        if (evt.code === 'Space' || evt.code === 'Enter') {
          evt.preventDefault();
          this.startSession();
        }
        return;
      }

      // Summary screen navigation: Space or Enter returns to lobby
      if (this.sessionState === 'finished') {
        if (evt.code === 'Space' || evt.code === 'Enter') {
          evt.preventDefault();
          this.sessionState = 'lobby';
          this.resetSession();
        }
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

    this.registerTouchGestures();

    this.sessionState = 'lobby';
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
   * Begins an active learning or testing session with a frozen queue snapshot.
   */
  public startSession(): void {
    let filtered = this.getFilteredCards();
    if (filtered.length === 0) {
      new Notice('Нет доступных карточек для начала сессии');
      return;
    }

    if (this.plugin.settings.shuffleOnStart) {
      filtered = this.plugin.settings.interleaveTopics
        ? interleaveCards(filtered)
        : fisherYatesShuffle(filtered);
    }

    this.sessionQueue = [...filtered];
    this.currentIndex = 0;
    this.isFlipped = false;
    this.sessionState = 'active';
    this.historyStack = [];
    this.sessionStats = {
      totalReviewed: 0,
      againCount: 0,
      hardCount: 0,
      goodCount: 0,
      easyCount: 0,
      failedCards: [],
    };
    this.renderAll();
  }

  /**
   * Resets the session queue according to currently active filters and scope.
   */
  public resetSession(keepIndex = false): void {
    let filtered = this.getFilteredCards();

    if (this.sessionState === 'active') {
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
    }

    this.renderAll();
  }

  /**
   * Refreshes the view when plugin index is updated without disrupting the current session.
   */
  public onIndexUpdated(): void {
    if (this.sessionQueue.length === 0) {
      this.resetSession();
      return;
    }

    const currentCard = this.sessionQueue[this.currentIndex];
    const cardsMap = new Map(this.plugin.cards.map((c) => [c.id, c]));

    // Update in-flight cards in place preserving active queue order
    this.sessionQueue = this.sessionQueue
      .map((c) => cardsMap.get(c.id))
      .filter((c): c is Flashcard => c !== undefined && this.cardMatchesScope(c));

    if (this.sessionQueue.length === 0) {
      this.resetSession();
      return;
    }

    if (currentCard) {
      const idx = this.sessionQueue.findIndex((c) => c.id === currentCard.id);
      this.currentIndex = idx >= 0 ? idx : Math.min(this.currentIndex, this.sessionQueue.length - 1);
    } else {
      this.currentIndex = Math.min(this.currentIndex, this.sessionQueue.length - 1);
    }

    this.renderToolbar();
    this.renderCardArea();
    this.renderNavBar();
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
      .map(([path, count]) => ({ path, label: `${path}/`, count }))
      .sort((a, b) => a.path.localeCompare(b.path));

    const files = Array.from(fileCounts.entries())
      .map(([path, count]) => ({
        path,
        label: `${path.split('/').pop() || path}`,
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

    // 1. Study Mode Toggle (Compact): [ icon "Проверка знаний" / "Ботать" ]
    const isTest = this.isTestMode();
    const modeToggle = leftGroup.createEl('button', {
      cls: `seelearn-mode-toggle ${isTest ? 'is-test' : 'is-learn'}`,
      title: isTest
        ? 'Режим проверки знаний (SRS). Нажмите для переключения на режим «Ботать»'
        : 'Режим «Ботать» (чтение). Нажмите для переключения на режим «Проверка знаний»',
    });
    const modeIcon = modeToggle.createSpan({ cls: 'seelearn-icon-inline' });
    setIcon(modeIcon, isTest ? 'crosshair' : 'book-open');
    modeToggle.createSpan({
      cls: 'seelearn-mode-label',
      text: isTest ? 'Проверка знаний' : 'Ботать',
    });
    modeToggle.addEventListener('click', async () => {
      this.plugin.settings.studyMode = isTest ? 'learn' : 'test';
      await this.plugin.saveSettings();
      this.sessionState = 'lobby';
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
      this.sessionState = 'lobby';
      this.resetSession();
    });

    // 3. Shuffle Button
    const shuffleBtn = leftGroup.createEl('button', {
      cls: 'clickable-icon seelearn-btn-icon',
      title:
        this.sessionState === 'active'
          ? 'Перемешать оставшиеся карточки в очереди'
          : 'Перемешать колоду',
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
        this.sessionState = 'lobby';
        this.resetSession();
      });

      const duePill = srsGroup.createEl('button', {
        cls: `seelearn-srs-pill seelearn-pill-due ${this.srsFilter === 'due' ? 'is-active' : ''}`,
        text: `К повторению (${breakdown.due})`,
        title: 'Карточки, запланированные на сегодня в этой папке/странице',
      });
      duePill.addEventListener('click', () => {
        this.srsFilter = 'due';
        this.sessionState = 'lobby';
        this.resetSession();
      });

      const newPill = srsGroup.createEl('button', {
        cls: `seelearn-srs-pill seelearn-pill-new ${this.srsFilter === 'new' ? 'is-active' : ''}`,
        text: `Новые (${breakdown.newCards})`,
        title: 'Еще не изученные карточки в этой папке/странице',
      });
      newPill.addEventListener('click', () => {
        this.srsFilter = 'new';
        this.sessionState = 'lobby';
        this.resetSession();
      });

      const helpBtn = srsGroup.createEl('button', {
        cls: 'clickable-icon seelearn-btn-icon seelearn-help-btn',
        title: 'Справка по методологии SRS: когда карточки попадают в «К повторению», оценки и пиявки',
      });
      setIcon(helpBtn, 'help-circle');
      helpBtn.addEventListener('click', () => {
        new SRSMethodologyModal(this.app).open();
      });
    }

    // 6. Validation warnings badge (if any)
    if (this.plugin.warnings.length > 0) {
      const warnBadge = rightGroup.createEl('button', {
        cls: 'seelearn-badge seelearn-badge-warning',
        title: 'Нажмите, чтобы просмотреть предупреждения валидации',
      });
      setIcon(warnBadge.createSpan({ cls: 'seelearn-icon-inline' }), 'alert-triangle');
      warnBadge.createSpan({ text: ` Ошибки: ${this.plugin.warnings.length}` });
      warnBadge.addEventListener('click', () => {
        new WarningsModal(this.app, this.plugin.warnings).open();
      });
    }

    // 7. Session Actions & Card Counter
    if (this.sessionState === 'active') {
      const finishBtn = rightGroup.createEl('button', {
        cls: 'clickable-icon seelearn-btn-icon',
        title: 'Завершить текущую сессию и перейти к итогам',
      });
      setIcon(finishBtn, 'log-out');
      finishBtn.addEventListener('click', () => {
        this.sessionState = 'finished';
        this.renderAll();
      });

      const total = this.sessionQueue.length;
      const current = total > 0 ? this.currentIndex + 1 : 0;
      rightGroup.createDiv({
        cls: 'seelearn-counter-badge',
        text: `Карта ${current} из ${total}`,
      });
    } else if (this.sessionState === 'lobby') {
      const matchingCount = this.getFilteredCards().length;
      rightGroup.createDiv({
        cls: 'seelearn-counter-badge',
        text: `В очереди: ${matchingCount}`,
      });
    }
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
      this.sessionState = 'lobby';
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
        this.sessionState = 'lobby';
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
  /**
   * Renders the card container, header, progress track, and markdown content.
   */
  private async renderCardArea(): Promise<void> {
    this.cleanupCardComponent();
    this.cardAreaEl.empty();

    if (this.plugin.cards.length === 0) {
      this.renderEmptyState();
      return;
    }

    if (this.sessionState === 'lobby') {
      this.renderLobbyState();
      return;
    }

    if (this.sessionState === 'finished' || this.sessionQueue.length === 0) {
      this.renderFinishedState();
      return;
    }

    const card = this.sessionQueue[this.currentIndex];
    if (!card) {
      this.renderFinishedState();
      return;
    }

    const cardWrapper = this.cardAreaEl.createDiv({ cls: 'seelearn-card-wrapper' });

    // Side navigation arrow: Previous
    const prevArrow = cardWrapper.createEl('button', {
      cls: 'seelearn-side-arrow prev',
      title: 'Предыдущая карточка (ArrowLeft)',
    });
    setIcon(prevArrow, 'chevron-left');
    prevArrow.disabled = this.currentIndex === 0;
    prevArrow.addEventListener('click', (e) => {
      e.stopPropagation();
      this.prevCard();
    });

    const cardContainer = cardWrapper.createDiv({ cls: 'seelearn-card-container' });
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
    const isLeech = isCardLeech(progress, this.plugin.settings.leechThreshold || 4);
    const progressPill = headerLeft.createSpan({ cls: 'seelearn-progress-pill' });

    if (!card.hasBack) {
      progressPill.setText('ИНФО');
      progressPill.addClass('is-info');
      progressPill.setAttribute('title', 'Односторонняя карточка для изучения информации');
    } else if (this.isTestMode()) {
      if (isLeech) {
        progressPill.addClass('is-leech');
        const iconSpan = progressPill.createSpan({ cls: 'seelearn-icon-inline' });
        setIcon(iconSpan, 'alert-circle');
        progressPill.createSpan({ text: ` Пиявка (${progress?.lapses || 0})` });
        progressPill.setAttribute(
          'title',
          `Карточка вызывает частые ошибки (${progress?.lapses} сбоев). Рекомендуется переформулировать или разбить на простые факты.`
        );
      } else if (progress && (progress.repetitions > 0 || progress.lapses > 0)) {
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

    // Cloze Deletion badge (icon only, minimalist)
    if (card.isCloze) {
      const clozePill = headerLeft.createSpan({ cls: 'seelearn-progress-pill is-cloze' });
      setIcon(clozePill.createSpan({ cls: 'seelearn-icon-inline' }), 'scissors');
      clozePill.setAttribute(
        'title',
        `Карточка с заполнением пропусков (Cloze Deletion${card.clozeIndex ? `, c${card.clozeIndex}` : ''})`
      );
    }

    // Tags list container with overflow scroll
    if (card.tags.length > 0) {
      const tagsContainer = headerLeft.createDiv({ cls: 'seelearn-card-tags' });
      for (const tag of card.tags) {
        tagsContainer.createSpan({ cls: 'seelearn-card-tag-pill', text: `#${tag}` });
      }
    }

    const headerRight = cardHeader.createDiv({ cls: 'seelearn-header-right' });

    // Quick Edit Button
    const editBtn = headerRight.createEl('button', {
      cls: 'seelearn-jump-btn seelearn-btn-edit',
      title: 'Быстрое редактирование карточки без перехода в заметку',
    });
    setIcon(editBtn.createSpan({ cls: 'seelearn-icon-inline' }), 'file-edit');
    editBtn.createSpan({ text: 'Изменить' });
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      new QuickEditCardModal(this.app, card, async () => {
        await this.plugin.reloadAllCards();
      }).open();
    });

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
      promptEl.createSpan({ text: 'Нажмите Пробел или стрелку «Далее» для продолжения' });

      cardBody.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'A' || target.closest('a')) return;
        this.nextCard();
      });
    } else {
      // TWO-SIDED CARD: Render front and answer section
      const frontEl = cardBody.createDiv({
        cls: `seelearn-content seelearn-front ${this.isFlipped && this.plugin.settings.revealMode === 'append' ? 'seelearn-faded' : ''}`,
      });
      if (this.isFlipped && this.plugin.settings.revealMode === 'replace') {
        frontEl.style.display = 'none';
      }
      await MarkdownRenderer.render(
        this.app,
        card.front,
        frontEl,
        card.filePath,
        this.activeCardComponent
      );

      const answerSection = cardBody.createDiv({ cls: 'seelearn-answer-section' });
      if (!this.isFlipped) {
        answerSection.style.display = 'none';
      }

      if (this.plugin.settings.revealMode === 'append') {
        const dividerEl = answerSection.createDiv({ cls: 'seelearn-divider' });
        dividerEl.createSpan({ cls: 'seelearn-divider-text', text: 'ОТВЕТ' });
      }

      const backEl = answerSection.createDiv({ cls: 'seelearn-content seelearn-back' });
      await MarkdownRenderer.render(
        this.app,
        card.back,
        backEl,
        card.filePath,
        this.activeCardComponent
      );

      const promptEl = cardBody.createDiv({ cls: 'seelearn-flip-prompt' });
      promptEl.createSpan({
        text: !this.isFlipped
          ? 'Нажмите Пробел или карточку, чтобы посмотреть ответ'
          : this.isTestMode()
          ? 'Оцените сложность (клавиши 1-4)'
          : 'Ответ показан (Space — далее)',
      });

      cardBody.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'A' || target.closest('a')) return;
        if (!this.isFlipped) {
          this.flipCard();
        }
      });
    }

    // Side navigation arrow: Next
    const nextArrow = cardWrapper.createEl('button', {
      cls: 'seelearn-side-arrow next',
      title: 'Следующая карточка (ArrowRight)',
    });
    setIcon(nextArrow, 'chevron-right');
    nextArrow.disabled = this.currentIndex >= this.sessionQueue.length - 1;
    nextArrow.addEventListener('click', (e) => {
      e.stopPropagation();
      this.nextCard();
    });
  }

  /**
   * Renders the pre-session Lobby screen (Deck Overview).
   */
  private renderLobbyState(): void {
    const matchingCards = this.getFilteredCards();
    const todayStr = new Date().toISOString().split('T')[0];

    const dueCards = matchingCards.filter((c) =>
      isCardDue(this.plugin.storage.getProgress(c.id), todayStr)
    );
    const newCards = matchingCards.filter((c) =>
      isCardNew(this.plugin.storage.getProgress(c.id))
    );

    const lobbyBox = this.cardAreaEl.createDiv({ cls: 'seelearn-lobby-box' });

    // Lobby Header
    const iconWrap = lobbyBox.createDiv({ cls: 'seelearn-lobby-icon' });
    setIcon(iconWrap, this.isTestMode() ? 'crosshair' : 'book-open');

    let scopeLabel = 'Все заметки';
    if (this.selectedScope.startsWith('folder:')) {
      scopeLabel = `Папка: ${this.selectedScope.substring(7)}`;
    } else if (this.selectedScope.startsWith('file:')) {
      scopeLabel = `Заметка: ${this.selectedScope.substring(5).split('/').pop()}`;
    }

    lobbyBox.createEl('h2', {
      cls: 'seelearn-lobby-title',
      text: this.isTestMode() ? 'Готовность к проверке знаний' : 'Готовность к изучению',
    });
    lobbyBox.createEl('p', {
      cls: 'seelearn-lobby-subtitle',
      text: `${scopeLabel}${this.selectedTags.size > 0 ? ' • ' + Array.from(this.selectedTags).map((t) => '#' + t).join(' ') : ''}`,
    });

    if (matchingCards.length === 0) {
      const emptyNote = lobbyBox.createDiv({ cls: 'seelearn-lobby-empty' });
      emptyNote.createEl('p', {
        text: 'По выбранным критериям (папка / тема / очередь) карточки не найдены.',
      });
      const resetBtn = emptyNote.createEl('button', {
        cls: 'seelearn-nav-btn',
        text: 'Сбросить фильтры',
      });
      resetBtn.addEventListener('click', () => {
        this.selectedScope = '';
        this.selectedTags.clear();
        this.srsFilter = 'all';
        this.resetSession();
      });
      return;
    }

    // Grid with statistics
    const statsGrid = lobbyBox.createDiv({ cls: 'seelearn-lobby-grid' });

    if (this.isTestMode()) {
      const dueCard = statsGrid.createDiv({ cls: 'seelearn-stat-card' });
      dueCard.createDiv({ cls: 'seelearn-stat-val text-warning', text: `${dueCards.length}` });
      dueCard.createDiv({ cls: 'seelearn-stat-lbl', text: 'К повторению' });

      const newCard = statsGrid.createDiv({ cls: 'seelearn-stat-card' });
      newCard.createDiv({ cls: 'seelearn-stat-val text-accent', text: `${newCards.length}` });
      newCard.createDiv({ cls: 'seelearn-stat-lbl', text: 'Новые' });
    }

    const totalCard = statsGrid.createDiv({ cls: 'seelearn-stat-card' });
    totalCard.createDiv({ cls: 'seelearn-stat-val', text: `${matchingCards.length}` });
    totalCard.createDiv({ cls: 'seelearn-stat-lbl', text: 'Всего в очереди' });

    const estMinutes = Math.max(1, Math.ceil(matchingCards.length * 0.4));
    const timeCard = statsGrid.createDiv({ cls: 'seelearn-stat-card' });
    timeCard.createDiv({ cls: 'seelearn-stat-val', text: `~${estMinutes} мин` });
    timeCard.createDiv({ cls: 'seelearn-stat-lbl', text: 'Расчетное время' });

    // Streak stats
    const streakStats = this.plugin.storage.getStudyStreakStats();
    const streakBanner = lobbyBox.createDiv({ cls: 'seelearn-streak-banner' });
    const pill1 = streakBanner.createDiv({ cls: 'seelearn-streak-pill' });
    setIcon(pill1.createSpan({ cls: 'seelearn-icon-inline' }), 'flame');
    pill1.createSpan({ text: ` Стрик: ${streakStats.currentStreak} дн.` });

    const pill2 = streakBanner.createDiv({ cls: 'seelearn-streak-pill' });
    setIcon(pill2.createSpan({ cls: 'seelearn-icon-inline' }), 'trophy');
    pill2.createSpan({ text: ` Рекорд: ${streakStats.bestStreak} дн.` });

    // Primary action button & test saving
    const actionsRow = lobbyBox.createDiv({ cls: 'seelearn-lobby-actions' });
    const startBtn = actionsRow.createEl('button', {
      cls: 'seelearn-start-session-btn mod-cta',
    });
    setIcon(startBtn.createSpan({ cls: 'seelearn-icon-inline' }), 'play');
    startBtn.createSpan({
      text: this.isTestMode() ? 'Начать сессию проверки' : 'Начать изучение',
    });
    startBtn.addEventListener('click', () => {
      this.activePresetName = undefined;
      this.startSession();
    });

    if (this.isTestMode()) {
      const saveTestBtn = actionsRow.createEl('button', {
        cls: 'seelearn-nav-btn seelearn-btn-save-test',
        text: 'Сохранить как тест...',
        title: 'Упаковать текущую выборку карточек в быстрый тест для повторного прохождения',
      });
      setIcon(saveTestBtn.createSpan({ cls: 'seelearn-icon-inline' }), 'bookmark');
      saveTestBtn.addEventListener('click', () => {
        new SaveTestModal(
          this.app,
          this.selectedScope,
          Array.from(this.selectedTags),
          (preset) => {
            this.plugin.storage.saveTestPreset(preset);
            new Notice(`Тест «${preset.name}» сохранен!`);
            this.renderAll();
          }
        ).open();
      });
    }

    const hintRow = lobbyBox.createDiv({ cls: 'seelearn-lobby-hint-row' });
    hintRow.createSpan({
      cls: 'seelearn-lobby-hint',
      text: 'Нажмите Пробел или Enter для быстрого старта • ',
    });
    const methodologyLink = hintRow.createEl('a', {
      cls: 'seelearn-methodology-link',
      text: 'Как работает интервальное повторение?',
    });
    methodologyLink.addEventListener('click', (e) => {
      e.preventDefault();
      new SRSMethodologyModal(this.app).open();
    });

    // Saved test presets list (for rapid testing)
    const presets = this.plugin.storage.getTestPresets();
    if (presets.length > 0 && this.isTestMode()) {
      const presetsSection = lobbyBox.createDiv({ cls: 'seelearn-presets-section' });
      const presetsHeader = presetsSection.createDiv({ cls: 'seelearn-presets-header' });
      setIcon(presetsHeader.createSpan({ cls: 'seelearn-icon-inline' }), 'list-checks');
      presetsHeader.createEl('h4', { text: 'Сохранённые тесты' });

      const presetsList = presetsSection.createDiv({ cls: 'seelearn-presets-list' });
      for (const preset of presets) {
        const item = presetsList.createDiv({ cls: 'seelearn-preset-item' });
        const left = item.createDiv({ cls: 'seelearn-preset-left' });
        left.createDiv({ cls: 'seelearn-preset-name', text: preset.name });

        const meta = left.createDiv({ cls: 'seelearn-preset-meta' });
        const scopeText = preset.scope
          ? (preset.scope.startsWith('folder:') ? `📁 ${preset.scope.substring(7)}` : `📄 ${preset.scope.substring(5).split('/').pop()}`)
          : '🌐 Все заметки';
        meta.createSpan({ text: scopeText });
        if (preset.tags.length > 0) {
          meta.createSpan({ text: ' • ' + preset.tags.map((t) => '#' + t).join(' ') });
        }
        meta.createSpan({ text: ` • Пройден: ${preset.runsCount || 0} раз` });

        const right = item.createDiv({ cls: 'seelearn-preset-right' });
        const playBtn = right.createEl('button', {
          cls: 'seelearn-nav-btn mod-cta mod-small',
          text: 'Запустить',
          title: 'Пройти этот тест',
        });
        setIcon(playBtn.createSpan({ cls: 'seelearn-icon-inline' }), 'play');
        playBtn.addEventListener('click', () => {
          this.startTestPreset(preset);
        });

        const delBtn = right.createEl('button', {
          cls: 'clickable-icon seelearn-btn-icon',
          title: 'Удалить тест',
        });
        setIcon(delBtn, 'trash');
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.plugin.storage.deleteTestPreset(preset.id);
          new Notice(`Тест «${preset.name}» удален`);
          this.renderAll();
        });
      }
    }
  }

  /**
   * Renders completed state with session summary dashboard.
   */
  private renderFinishedState(): void {
    const emptyBox = this.cardAreaEl.createDiv({ cls: 'seelearn-empty-box' });
    setIcon(emptyBox.createDiv({ cls: 'seelearn-empty-icon seelearn-icon-celebrate' }), 'award');
    const titleText = this.activePresetName
      ? `Тест «${this.activePresetName}» завершён!`
      : 'Сессия завершена!';
    emptyBox.createEl('h2', { text: titleText });
    const subtitleText = this.activePresetName
      ? 'Результаты прохождения теста зафиксированы в статистике.'
      : this.isTestMode()
      ? 'Вы повторили запланированные карточки по графику интервального повторения.'
      : 'Вы изучили все карточки в выбранной области.';
    emptyBox.createEl('p', { text: subtitleText });

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

    // Streak Stats Banner
    const streakStats = this.plugin.storage.getStudyStreakStats();
    const streakBanner = emptyBox.createDiv({ cls: 'seelearn-streak-banner' });
    const pill1 = streakBanner.createDiv({ cls: 'seelearn-streak-pill' });
    setIcon(pill1.createSpan({ cls: 'seelearn-icon-inline' }), 'flame');
    pill1.createSpan({ text: ` Стрик: ${streakStats.currentStreak} дн.` });

    const pill2 = streakBanner.createDiv({ cls: 'seelearn-streak-pill' });
    setIcon(pill2.createSpan({ cls: 'seelearn-icon-inline' }), 'trophy');
    pill2.createSpan({ text: ` Рекорд: ${streakStats.bestStreak} дн.` });

    const pill3 = streakBanner.createDiv({ cls: 'seelearn-streak-pill' });
    setIcon(pill3.createSpan({ cls: 'seelearn-icon-inline' }), 'layers');
    pill3.createSpan({ text: ` Всего: ${streakStats.totalReviews} повторений` });

    // 35-Day (5-week) Activity Heatmap
    const heatmapContainer = emptyBox.createDiv({ cls: 'seelearn-heatmap-wrap' });
    heatmapContainer.createEl('div', {
      cls: 'seelearn-heatmap-title',
      text: 'Активность повторений за последние 5 недель',
    });
    const heatmapGrid = heatmapContainer.createDiv({ cls: 'seelearn-heatmap-grid' });
    const today = new Date();
    for (let i = 34; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const count = streakStats.dailyActivity[dateStr] || 0;
      let level = 0;
      if (count > 0 && count <= 3) level = 1;
      else if (count > 3 && count <= 10) level = 2;
      else if (count > 10 && count <= 25) level = 3;
      else if (count > 25) level = 4;

      const cell = heatmapGrid.createDiv({ cls: `seelearn-heatmap-cell level-${level}` });
      cell.setAttribute('title', `${dateStr}: ${count} повторений`);
    }

    // Leech warning banner (if any leeches in vault)
    const leeches = this.plugin.cards.filter((c) =>
      isCardLeech(this.plugin.storage.getProgress(c.id), this.plugin.settings.leechThreshold || 4)
    );
    if (leeches.length > 0) {
      const leechBox = emptyBox.createDiv({ cls: 'seelearn-leech-notice' });
      const leechNoticeText = leechBox.createSpan();
      setIcon(leechNoticeText.createSpan({ cls: 'seelearn-icon-inline' }), 'zap');
      leechNoticeText.createSpan({
        text: ` Внимание: обнаружено ${leeches.length} карточек-пиявок (карты с частыми ошибками).`,
      });
      const studyLeechesBtn = leechBox.createEl('button', {
        cls: 'seelearn-nav-btn mod-small',
        text: 'Изучить пиявки',
      });
      studyLeechesBtn.addEventListener('click', () => {
        this.sessionQueue = [...leeches];
        this.sessionState = 'active';
        this.currentIndex = 0;
        this.isFlipped = false;
        this.renderAll();
      });
    }

    const actionsRow = emptyBox.createDiv({ cls: 'seelearn-summary-actions' });

    const lobbyBtn = actionsRow.createEl('button', {
      cls: 'seelearn-nav-btn',
      text: 'Вернуться в лобби',
    });
    lobbyBtn.addEventListener('click', () => {
      this.sessionState = 'lobby';
      this.renderAll();
    });

    if (this.sessionStats.failedCards.length > 0) {
      const repeatFailedBtn = actionsRow.createEl('button', {
        cls: 'seelearn-nav-btn seelearn-btn-repeat',
        text: `Повторить ошибки (${this.sessionStats.failedCards.length})`,
      });
      repeatFailedBtn.addEventListener('click', () => {
        this.sessionQueue = [...this.sessionStats.failedCards];
        this.sessionStats.failedCards = [];
        this.sessionState = 'active';
        this.currentIndex = 0;
        this.isFlipped = false;
        this.renderAll();
      });
    }

    const restartBtn = actionsRow.createEl('button', {
      cls: 'mod-cta',
      text: 'Повторить всю сессию',
    });
    restartBtn.addEventListener('click', () => {
      this.startSession();
    });
  }

  /**
   * Renders empty state when no cards exist in vault.
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
      this.renderFinishedState();
    }
  }

  /**
   * Renders the bottom navigation bar with Learn Mode navigation and SRS ratings.
   */
  private renderNavBar(): void {
    this.navBarEl.empty();

    if (this.sessionState !== 'active' || this.sessionQueue.length === 0) {
      this.navBarEl.style.display = 'none';
      return;
    }
    this.navBarEl.style.display = 'flex';

    const currentCard = this.sessionQueue[this.currentIndex];
    const centerNav = this.navBarEl.createDiv({ cls: 'seelearn-nav-group center' });

    if (!this.isTestMode()) {
      // LEARN MODE (Режим "Ботать" по умолчанию)
      if (currentCard?.hasBack) {
        const flipText = !this.isFlipped ? 'Показать ответ (Space)' : 'Скрыть ответ (Space)';
        const flipBtn = centerNav.createEl('button', {
          cls: 'seelearn-nav-btn mod-cta',
          text: flipText,
          title: 'Перевернуть карточку (Space)',
        });
        flipBtn.addEventListener('click', () => this.flipCard());
      }
    } else {
      // TEST MODE (Режим "Проверить знания" с SM-2)
      if (!currentCard?.hasBack) {
        // Front-only info card in test mode
        const readBtn = centerNav.createEl('button', {
          cls: 'seelearn-nav-btn mod-cta',
          text: 'Понятно / Изучено (Space)',
        });
        readBtn.addEventListener('click', () => this.handleSRSRating('good'));
      } else if (!this.isFlipped) {
        // Front of two-sided card in test mode
        const flipBtn = centerNav.createEl('button', {
          cls: 'seelearn-nav-btn mod-cta',
          text: 'Показать ответ (Space)',
          title: 'Перевернуть карточку (Space)',
        });
        flipBtn.addEventListener('click', () => this.flipCard());
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

        // [3] Хорошо (unify style, remove mod-cta)
        const goodBtn = centerNav.createEl('button', {
          cls: 'seelearn-nav-btn seelearn-btn-srs seelearn-btn-good',
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

    const cardContainer = this.cardAreaEl.querySelector('.seelearn-card-container');
    const answerSection = this.cardAreaEl.querySelector<HTMLElement>('.seelearn-answer-section');
    const frontEl = this.cardAreaEl.querySelector<HTMLElement>('.seelearn-front');
    const promptEl = this.cardAreaEl.querySelector<HTMLElement>('.seelearn-flip-prompt');

    if (cardContainer && answerSection && frontEl) {
      if (this.isFlipped) {
        cardContainer.addClass('is-flipped');
        answerSection.style.display = 'block';
        if (this.plugin.settings.revealMode === 'append') {
          frontEl.addClass('seelearn-faded');
        } else {
          frontEl.style.display = 'none';
        }
        if (promptEl) {
          promptEl.setText(
            this.isTestMode() ? 'Оцените сложность (клавиши 1-4)' : 'Ответ показан (Space — далее)'
          );
        }
      } else {
        cardContainer.removeClass('is-flipped');
        answerSection.style.display = 'none';
        frontEl.removeClass('seelearn-faded');
        frontEl.style.display = '';
        if (promptEl) {
          promptEl.setText('Нажмите Пробел или карточку, чтобы посмотреть ответ');
        }
      }
      this.renderNavBar();
    } else {
      this.renderCardArea();
      this.renderNavBar();
    }
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
      this.sessionState = 'finished';
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

    if (this.sessionQueue.length === 0) {
      this.sessionState = 'finished';
      this.renderAll();
      return;
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
    if (this.historyStack.length === 0) {
      new Notice('Нет действий для отмены');
      return;
    }

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

  public shuffleQueue(): void {
    if (this.sessionQueue.length <= 1) return;

    if (this.sessionState === 'active') {
      const before = this.sessionQueue.slice(0, this.currentIndex + 1);
      const remaining = this.sessionQueue.slice(this.currentIndex + 1);
      if (remaining.length > 1) {
        const shuffledRemaining = this.plugin.settings.interleaveTopics
          ? interleaveCards(remaining)
          : fisherYatesShuffle(remaining);
        this.sessionQueue = [...before, ...shuffledRemaining];
        new Notice('Оставшиеся карточки в очереди перемешаны');
        this.renderAll();
      } else {
        new Notice('В очереди недостаточно оставшихся карточек для перемешивания');
      }
    } else {
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
  }

  public shuffleQueueAction(): void {
    this.shuffleQueue();
  }

  public startTestPreset(preset: TestPreset): void {
    this.selectedScope = preset.scope;
    this.selectedTags = new Set(preset.tags);
    this.srsFilter = 'all';
    this.plugin.settings.studyMode = 'test';
    this.activePresetName = preset.name;
    this.plugin.storage.recordTestPresetRun(preset.id);
    new Notice(`Запуск теста «${preset.name}»`);
    this.startSession();
  }

  private async openCardInNote(card: Flashcard): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(card.filePath);
    if (file instanceof TFile) {
      let leaf = this.app.workspace.getLeavesOfType('markdown')[0];
      if (!leaf || leaf.view === this) {
        leaf = this.app.workspace.getLeaf('tab');
      }
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
      this.app.workspace.revealLeaf(leaf);
    } else {
      new Notice(`Файл не найден: ${card.filePath}`);
    }
  }

  /**
   * Registers touch gestures for mobile swipes (swipe up = flip, swipe left = next/again, swipe right = prev/good).
   */
  private registerTouchGestures(): void {
    let touchStartX = 0;
    let touchStartY = 0;
    let touchEndX = 0;
    let touchEndY = 0;
    let touchStartTime = 0;
    let isTouchInsideScrollable = false;

    this.registerDomEvent(this.cardAreaEl, 'touchstart', (e: TouchEvent) => {
      if (e.touches.length !== 1 || this.sessionState !== 'active') return;
      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      touchEndX = touch.clientX;
      touchEndY = touch.clientY;
      touchStartTime = Date.now();

      const target = e.target as HTMLElement | null;
      const scrollParent = target?.closest('table, pre, .seelearn-card-tags') as HTMLElement | null;
      isTouchInsideScrollable = !!(
        scrollParent && scrollParent.scrollWidth > scrollParent.clientWidth
      );
    }, { passive: true });

    this.registerDomEvent(this.cardAreaEl, 'touchmove', (e: TouchEvent) => {
      if (e.touches.length !== 1 || this.sessionState !== 'active') return;
      const touch = e.touches[0];
      touchEndX = touch.clientX;
      touchEndY = touch.clientY;
    }, { passive: true });

    this.registerDomEvent(this.cardAreaEl, 'touchend', (_e: TouchEvent) => {
      if (this.sessionState !== 'active' || this.sessionQueue.length === 0) return;

      const elapsed = Date.now() - touchStartTime;
      if (elapsed > 700) return; // Ignore long presses / slow drags

      const deltaX = touchEndX - touchStartX;
      const deltaY = touchEndY - touchStartY;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      const SWIPE_THRESHOLD = 55;

      if (absX < SWIPE_THRESHOLD && absY < SWIPE_THRESHOLD) return;

      if (absY > absX * 1.2) {
        // Vertical swipe
        if (deltaY < -SWIPE_THRESHOLD) {
          // Swipe UP: Flip card or advance
          if (!this.isFlipped) {
            this.flipCard();
          } else if (!this.isTestMode()) {
            this.nextCard();
          }
        }
      } else if (absX > absY * 1.2) {
        // Horizontal swipe
        if (isTouchInsideScrollable) return; // Prevent swipe if scrolling table horizontally

        if (deltaX < -SWIPE_THRESHOLD) {
          // Swipe LEFT: Next card / Again in test mode when flipped
          if (this.isTestMode() && this.isFlipped) {
            this.handleSRSRating('again');
          } else {
            this.nextCard();
          }
        } else if (deltaX > SWIPE_THRESHOLD) {
          // Swipe RIGHT: Prev card / Good in test mode when flipped
          if (this.isTestMode() && this.isFlipped) {
            this.handleSRSRating('good');
          } else {
            this.prevCard();
          }
        }
      }
    }, { passive: true });
  }

  // --- PUBLIC ACTIONS FOR OBSIDIAN COMMANDS & HOTKEYS ---

  public isSessionActive(): boolean {
    return this.sessionState === 'active' && this.sessionQueue.length > 0;
  }

  public flipCardAction(): void {
    if (this.sessionState === 'lobby') {
      this.startSession();
    } else if (this.sessionState === 'finished') {
      this.sessionState = 'lobby';
      this.resetSession();
    } else if (this.sessionState === 'active') {
      this.handleSpace();
    }
  }

  public nextCardAction(): void {
    if (this.sessionState === 'active') {
      this.nextCard();
    }
  }

  public prevCardAction(): void {
    if (this.sessionState === 'active') {
      this.prevCard();
    }
  }

  public rateAgainAction(): void {
    if (this.sessionState === 'active' && this.isTestMode() && this.isFlipped) {
      this.handleSRSRating('again');
    }
  }

  public rateHardAction(): void {
    if (this.sessionState === 'active' && this.isTestMode() && this.isFlipped) {
      this.handleSRSRating('hard');
    }
  }

  public rateGoodAction(): void {
    if (this.sessionState === 'active') {
      if (this.isTestMode()) {
        if (this.isFlipped || !this.sessionQueue[this.currentIndex]?.hasBack) {
          this.handleSRSRating('good');
        } else {
          this.flipCard();
        }
      } else {
        this.handleSpace();
      }
    }
  }

  public rateEasyAction(): void {
    if (this.sessionState === 'active' && this.isTestMode() && this.isFlipped) {
      this.handleSRSRating('easy');
    }
  }

  public undoAction(): void {
    if (this.sessionState === 'active') {
      this.undoLastAction();
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

/**
 * Modal for editing flashcard content directly in place with horizontal side-by-side layout.
 */
class QuickEditCardModal extends Modal {
  private card: Flashcard;
  private onSaveCallback: () => Promise<void>;

  constructor(app: App, card: Flashcard, onSaveCallback: () => Promise<void>) {
    super(app);
    this.card = card;
    this.onSaveCallback = onSaveCallback;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('seelearn-modal-wide');

    // Header with Title and Metadata
    const headerEl = contentEl.createDiv({ cls: 'seelearn-modal-header' });
    const titleRow = headerEl.createDiv({ cls: 'seelearn-modal-title-row' });
    const titleIcon = titleRow.createSpan({ cls: 'seelearn-icon-inline' });
    setIcon(titleIcon, 'file-edit');
    titleRow.createEl('h2', { text: 'Редактирование карточки' });

    // Metadata bar: file, lines, tags
    const metaBar = headerEl.createDiv({ cls: 'seelearn-modal-meta' });
    const fileMeta = metaBar.createSpan({ cls: 'seelearn-meta-item' });
    setIcon(fileMeta.createSpan({ cls: 'seelearn-icon-inline' }), 'file-text');
    fileMeta.createSpan({
      text: `${this.card.filePath} (строки ${this.card.lineStart}-${this.card.lineEnd})`,
    });

    if (this.card.tags.length > 0) {
      const tagsMeta = metaBar.createDiv({ cls: 'seelearn-modal-tags' });
      for (const t of this.card.tags) {
        tagsMeta.createSpan({ cls: 'seelearn-card-tag-pill', text: `#${t}` });
      }
    }

    // Grid layout: Side-by-side if hasBack, single column if front-only
    const gridEl = contentEl.createDiv({
      cls: `seelearn-edit-grid ${this.card.hasBack ? 'two-col' : 'single-col'}`,
    });

    // Column 1: Front
    const frontCol = gridEl.createDiv({ cls: 'seelearn-edit-col' });
    frontCol.createEl('label', {
      cls: 'seelearn-edit-label',
      text: 'Лицевая сторона (@front):',
    });
    const frontArea = frontCol.createEl('textarea', {
      cls: 'seelearn-edit-textarea',
      value: this.card.front,
    });

    // Column 2: Back (if card has back)
    let backArea: HTMLTextAreaElement | null = null;
    if (this.card.hasBack) {
      const backCol = gridEl.createDiv({ cls: 'seelearn-edit-col' });
      backCol.createEl('label', {
        cls: 'seelearn-edit-label',
        text: 'Оборотная сторона (@back):',
      });
      backArea = backCol.createEl('textarea', {
        cls: 'seelearn-edit-textarea',
        value: this.card.back,
      });
    }

    // Actions Row
    const btnRow = contentEl.createDiv({ cls: 'seelearn-modal-actions' });
    const cancelBtn = btnRow.createEl('button', { text: 'Отмена' });
    cancelBtn.addEventListener('click', () => this.close());

    const doSave = async () => {
      const file = this.app.vault.getAbstractFileByPath(this.card.filePath);
      if (!(file instanceof TFile)) {
        new Notice('Файл карточки не найден на диске');
        return;
      }

      const newFront = frontArea.value.trim();
      const newBack = backArea ? backArea.value.trim() : '';

      try {
        const fileContent = await this.app.vault.read(file);
        const lines = fileContent.split(/\r?\n/);
        const startIdx = this.card.lineStart - 1;
        const endIdx = this.card.lineEnd - 1;

        if (startIdx < 0 || endIdx >= lines.length) {
          new Notice('Не удалось определить границы карточки в файле');
          return;
        }

        const originalHeader = lines[startIdx];
        const isCommentSyntax = originalHeader.includes('%%');
        const tagPart = this.card.localTags.length > 0 ? ` #${this.card.localTags.join(' #')}` : '';

        let replacement = '';
        if (isCommentSyntax) {
          replacement = `%% @card${tagPart} %%\n%% @front %%\n${newFront}\n`;
          if (this.card.hasBack && newBack) {
            replacement += `%% @back %%\n${newBack}\n`;
          }
          replacement += `%% @end %%`;
        } else {
          replacement = `@card${tagPart}\n@front\n${newFront}\n`;
          if (this.card.hasBack && newBack) {
            replacement += `@back\n${newBack}\n`;
          }
          replacement += `@end`;
        }

        const updatedLines = [
          ...lines.slice(0, startIdx),
          replacement,
          ...lines.slice(endIdx + 1),
        ];

        await this.app.vault.modify(file, updatedLines.join('\n'));
        new Notice('Карточка успешно обновлена');
        this.close();
        await this.onSaveCallback();
      } catch (err) {
        new Notice(`Ошибка сохранения: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    const saveBtn = btnRow.createEl('button', {
      cls: 'mod-cta',
      text: 'Сохранить (Ctrl+Enter)',
    });
    saveBtn.addEventListener('click', doSave);

    // Hotkey: Ctrl+Enter / Cmd+Enter inside textareas saves immediately
    const onKeydown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        doSave();
      }
    };
    frontArea.addEventListener('keydown', onKeydown);
    if (backArea) {
      backArea.addEventListener('keydown', onKeydown);
    }

    setTimeout(() => frontArea.focus(), 50);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Modal window explaining the SRS methodology, SM-2 intervals, due queue criteria, and leeches.
 */
export class SRSMethodologyModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('seelearn-methodology-modal');

    contentEl.createEl('h2', { text: 'Справка: Методология SeeLearn и интервальное повторение' });

    const sec1 = contentEl.createDiv({ cls: 'seelearn-methodology-section' });
    sec1.createEl('h3', { text: '📅 Когда карточка попадает в очередь «К повторению»?' });
    sec1.createEl('p', {
      text: 'Алгоритм интервального повторения (SM-2) формирует график на основе забывания по кривой Эббингауза:',
    });
    const ul1 = sec1.createEl('ul');
    ul1.createEl('li', {
      text: 'Новая карточка: при первом уверенном ответе (Хорошо/Легко) следующий повтор назначается на следующий день (+1 день). Завтра она автоматически появится в «К повторению».',
    });
    ul1.createEl('li', {
      text: 'Зрелая карточка: дата повтора вычисляется как Дата + Интервал дней. Как только наступает запланированный день (или если вы пропустили день), карточка переходит в статус «К повторению».',
    });
    ul1.createEl('li', {
      text: 'Забытая карточка (Снова [1]): если вы нажали «Снова», интервал сразу сбрасывается на 1 день. Карточка возвращается в конец текущей сессии через шаг requeue, а на следующий день снова требует повторения.',
    });

    const sec2 = contentEl.createDiv({ cls: 'seelearn-methodology-section' });
    sec2.createEl('h3', { text: '🎯 Оценки сложности в режиме «Проверка знаний»' });
    const ul2 = sec2.createEl('ul');
    ul2.createEl('li', {
      text: '[1] Снова: ответ забыт. Сброс интервала на 1 день, штраф к фактору легкости (-0.2 EF), возврат в очередь текущей сессии.',
    });
    ul2.createEl('li', {
      text: '[2] Трудно: ответ вспомнили с заметным усилием. Минимальный прирост интервала (1.2×), EF уменьшается (-0.15).',
    });
    ul2.createEl('li', {
      text: '[3] Хорошо: стандартный уверенный ответ. Интервал умножается на EF (1 день → 6 дней → интервал × EF).',
    });
    ul2.createEl('li', {
      text: '[4] Легко: мгновенный ответ без пауз. Бонус к фактору легкости (+0.15 EF) и ускоренный рост интервала (интервал × EF × 1.3).',
    });

    const sec3 = contentEl.createDiv({ cls: 'seelearn-methodology-section' });
    sec3.createEl('h3', { text: '⚡ Карточки-пиявки (Leeches)' });
    sec3.createEl('p', {
      text: 'Если карточка была забыта 4 и более раз (настраиваемый порог), она отмечается как пиявка. Это верный сигнал, что вопрос сформулирован слишком широко, двусмысленно или содержит лишнюю информацию. Рекомендуется нажать «Изменить» и разбить её на атомарные тезисы или оформить через клоуз-пропуски {{c1::...}}.',
    });

    const sec4 = contentEl.createDiv({ cls: 'seelearn-methodology-section' });
    sec4.createEl('h3', { text: '🔍 Фильтры очереди' });
    const ul4 = sec4.createEl('ul');
    ul4.createEl('li', {
      text: 'Все: полный охват карточек в текущей заметке или папке с учётом выбранных тегов.',
    });
    ul4.createEl('li', {
      text: 'К повторению: только созревшие на сегодня карточки.',
    });
    ul4.createEl('li', {
      text: 'Новые: карточки, которые вы ещё ни разу не изучали.',
    });

    const btnRow = contentEl.createDiv({ cls: 'seelearn-modal-btn-row' });
    const okBtn = btnRow.createEl('button', {
      cls: 'seelearn-nav-btn mod-cta',
      text: 'Понятно',
    });
    okBtn.addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Modal window to save current filtered selection of cards into a named Test Preset.
 */
export class SaveTestModal extends Modal {
  private name: string = '';
  private targetScope: string;
  private tags: string[];
  private onSave: (preset: TestPreset) => void;

  constructor(
    app: App,
    currentScope: string,
    currentTags: string[],
    onSave: (preset: TestPreset) => void
  ) {
    super(app);
    this.targetScope = currentScope;
    this.tags = [...currentTags];
    this.onSave = onSave;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('seelearn-save-test-modal');

    contentEl.createEl('h2', { text: 'Сохранить набор карточек в Тест' });

    let scopeDesc = 'Все заметки';
    if (this.targetScope.startsWith('folder:')) {
      scopeDesc = `Папка: ${this.targetScope.substring(7)}`;
    } else if (this.targetScope.startsWith('file:')) {
      scopeDesc = `Заметка: ${this.targetScope.substring(5).split('/').pop()}`;
    }

    const infoBox = contentEl.createDiv({ cls: 'seelearn-preset-info-box' });
    infoBox.createEl('p', { text: `Область: ${scopeDesc}` });
    infoBox.createEl('p', {
      text: `Теги: ${this.tags.length > 0 ? this.tags.map((t) => '#' + t).join(' ') : 'Все темы'}`,
    });

    new Setting(contentEl)
      .setName('Название теста')
      .setDesc('Введите название теста для быстрого запуска из списка.')
      .addText((text) =>
        text
          .setPlaceholder('Например: Экзамен по биохимии — Раздел 2')
          .setValue(this.name)
          .onChange((val) => {
            this.name = val;
          })
      );

    const btnRow = contentEl.createDiv({ cls: 'seelearn-modal-btn-row' });
    const cancelBtn = btnRow.createEl('button', {
      cls: 'seelearn-nav-btn',
      text: 'Отмена',
    });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = btnRow.createEl('button', {
      cls: 'seelearn-nav-btn mod-cta',
      text: 'Сохранить тест',
    });
    saveBtn.addEventListener('click', () => {
      const trimmedName = this.name.trim();
      if (!trimmedName) {
        new Notice('Пожалуйста, укажите название теста');
        return;
      }
      const preset: TestPreset = {
        id: 'test_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
        name: trimmedName,
        scope: this.targetScope,
        tags: this.tags,
        createdAt: new Date().toISOString(),
        runsCount: 0,
      };
      this.onSave(preset);
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}


