import {
  ItemView,
  WorkspaceLeaf,
  MarkdownRenderer,
  Component,
  TFile,
  setIcon,
  setTooltip,
  Notice,
  Modal,
  App,
  Setting,
  Menu,
} from 'obsidian';
import type SeeLearnPlugin from './main';
import { CardProgressRecord, CardSizePreset, Flashcard, SRSQueueFilter, TestPreset, ValidationWarning } from './types';
import { fisherYatesShuffle, interleaveCards } from './shuffle';
import { prepareSessionPool } from './session';
import { getSRSIntervalPreviews, isCardDue, isCardLeech, isCardNew, SRSRating } from './srs';
import { OnboardingManager } from './onboarding';

export const VIEW_TYPE_SEELEARN = 'seelearn-study-view';

const CARD_SIZE_PRESETS: CardSizePreset[] = ['xs', 's', 'm', 'l', 'xl'];
const PRESET_DIMENSIONS: Record<CardSizePreset, { width: number; height: number }> = {
  xs: { width: 480, height: 340 },
  s: { width: 560, height: 400 },
  m: { width: 640, height: 460 },
  l: { width: 730, height: 520 },
  xl: { width: 820, height: 580 },
  full: { width: 9999, height: 9999 },
};

function formatFlipsCount(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 19) return `${count} флипов`;
  if (mod10 === 1) return `${count} флип`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} флипа`;
  return `${count} флипов`;
}

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
  private selectedTagsOrder: string[] = [];
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

    this.registerDomEvent(window, 'blur', () => {
      this.clearActiveTooltips();
    });

    this.sessionState = 'lobby';
    this.resetSession();
  }

  async onClose(): Promise<void> {
    this.clearActiveTooltips();
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
    this.clearActiveTooltips();
    let filtered = this.getFilteredCards();
    if (filtered.length === 0) {
      new Notice('Нет доступных карточек для начала сессии');
      return;
    }

    filtered = prepareSessionPool(filtered, {
      limit: this.plugin.settings.sessionCardLimit ?? 'all',
      shuffle: !this.plugin.settings.linearSessionOrder,
    });

    if (this.plugin.settings.interleaveTopics && !this.plugin.settings.linearSessionOrder) {
      filtered = interleaveCards(filtered);
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
    this.clearActiveTooltips();
    let filtered = this.getFilteredCards();

    if (this.sessionState === 'active') {
      filtered = prepareSessionPool(filtered, {
        limit: this.plugin.settings.sessionCardLimit ?? 'all',
        shuffle: !this.plugin.settings.linearSessionOrder,
      });

      if (this.plugin.settings.interleaveTopics && !this.plugin.settings.linearSessionOrder) {
        filtered = interleaveCards(filtered);
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

      // SRS Queue filter (applies to both Learn and Test modes)
      const record = this.plugin.storage.getProgress(card.id);
      if (this.srsFilter === 'due' && !isCardDue(record, todayStr)) {
        return false;
      }
      if (this.srsFilter === 'new' && !isCardNew(record)) {
        return false;
      }

      return true;
    });

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
    this.clearActiveTooltips();
    this.renderToolbar();
    this.renderTagsBar();
    this.renderCardArea();
    this.renderNavBar();
  }

  /**
   * Renders the top toolbar with Mode Switcher (Ботать / Проверить знания), Scope Selector, Shuffle, and Stats.
   */
  private renderToolbar(): void {
    this.clearActiveTooltips();
    this.toolbarEl.empty();

    const leftGroup = this.toolbarEl.createDiv({ cls: 'seelearn-toolbar-group left' });
    const rightGroup = this.toolbarEl.createDiv({ cls: 'seelearn-toolbar-group right' });

    // 1. Study Mode Toggle (Compact): [ icon "Проверка знаний" / "Ботать" ]
    const isTest = this.isTestMode();
    const modeToggle = leftGroup.createEl('button', {
      cls: `seelearn-mode-toggle ${isTest ? 'is-test' : 'is-learn'}`,
    });
    setTooltip(
      modeToggle,
      isTest
        ? 'Режим проверки знаний (SRS). Нажмите для переключения на режим «Ботать»'
        : 'Режим «Ботать» (чтение). Нажмите для переключения на режим «Проверка знаний»'
    );
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
      text: `Все заметки (${this.plugin.cards.length})`,
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

    // 3. Scoped SRS Queue Filter Pills (reflects ONLY cards in selected scope! Visible only in lobby)
    if (this.sessionState === 'lobby') {
      const scopedCards = this.plugin.cards.filter((c) => this.cardMatchesScope(c));
      const breakdown = this.plugin.storage.getSRSBreakdown(scopedCards);
      const srsGroup = rightGroup.createDiv({ cls: 'seelearn-srs-filter-group' });

      const allPill = srsGroup.createEl('button', {
        cls: `seelearn-srs-pill ${this.srsFilter === 'all' ? 'is-active' : ''}`,
        text: `Все (${breakdown.total})`,
      });
      setTooltip(allPill, 'Показать все карточки в выбранной области');
      allPill.addEventListener('click', () => {
        this.srsFilter = 'all';
        this.sessionState = 'lobby';
        this.resetSession();
      });

      const duePill = srsGroup.createEl('button', {
        cls: `seelearn-srs-pill seelearn-pill-due ${this.srsFilter === 'due' ? 'is-active' : ''}`,
        text: `К повторению (${breakdown.due})`,
      });
      setTooltip(duePill, 'Карточки, запланированные на сегодня в этой папке/странице');
      duePill.addEventListener('click', () => {
        this.srsFilter = 'due';
        this.sessionState = 'lobby';
        this.resetSession();
      });

      const newPill = srsGroup.createEl('button', {
        cls: `seelearn-srs-pill seelearn-pill-new ${this.srsFilter === 'new' ? 'is-active' : ''}`,
        text: `Новые (${breakdown.newCards})`,
      });
      setTooltip(newPill, 'Еще не изученные карточки в этой папке/странице');
      newPill.addEventListener('click', () => {
        this.srsFilter = 'new';
        this.sessionState = 'lobby';
        this.resetSession();
      });
    }

    // 6. Validation warnings badge (if any)
    if (this.plugin.warnings.length > 0) {
      const warnBadge = rightGroup.createEl('button', {
        cls: 'seelearn-badge seelearn-badge-warning',
      });
      setTooltip(warnBadge, 'Нажмите, чтобы просмотреть предупреждения валидации');
      setIcon(warnBadge.createSpan({ cls: 'seelearn-icon-inline' }), 'alert-triangle');
      warnBadge.createSpan({ text: ` Ошибки: ${this.plugin.warnings.length}` });
      warnBadge.addEventListener('click', () => {
        new WarningsModal(this.app, this.plugin.warnings).open();
      });
    }

    // 7. Session Actions & Card Counter (strictly centered in toolbar via absolute positioning)
    if (this.sessionState === 'active') {
      const total = this.sessionQueue.length;
      const current = total > 0 ? this.currentIndex + 1 : 0;
      this.toolbarEl.createDiv({
        cls: 'seelearn-counter-badge',
        text: `Карта ${current} из ${total}`,
      });
    } else if (this.sessionState === 'lobby') {
      const matchingCount = this.getFilteredCards().length;
      const currentLimit = this.plugin.settings.sessionCardLimit ?? 'all';
      const effectiveCount =
        typeof currentLimit === 'number' && currentLimit < matchingCount
          ? currentLimit
          : matchingCount;

      const badgeText = `Кол-во карт: ${effectiveCount}`;

      const badge = this.toolbarEl.createEl('button', {
        cls: 'seelearn-counter-badge is-interactive',
      });
      setTooltip(badge, 'Лимит карточек на сессию. Нажмите, чтобы изменить');
      badge.createSpan({ text: badgeText });
      const chevronEl = badge.createSpan({ cls: 'seelearn-badge-chevron seelearn-icon-inline' });
      setIcon(chevronEl, 'chevron-down');

      badge.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        this.openLimitMenu(e, badge, matchingCount);
      });
    }
  }

  /**
   * Opens the card limit selection menu on counter badge click.
   */
  private openLimitMenu(e: MouseEvent, targetEl: HTMLElement, totalAvailable: number): void {
    const menu = new Menu();
    const currentLimit = this.plugin.settings.sessionCardLimit ?? 'all';

    menu.addItem((item) => {
      item.setTitle('Лимит карточек на сессию').setDisabled(true);
    });
    menu.addSeparator();

    // Standard preset candidates: 10, 20, 50, 100
    // "когда карточек в пуле меньше, опции лишние не показывать (всего карт 22, опции 50 и сто скрыть)"
    const standardPresets = [10, 20, 50, 100];
    const validPresets = standardPresets.filter((n) => n < totalAvailable);

    // If current limit is a custom number < totalAvailable not in standardPresets, include it in sorted order
    const numericOptions = [...validPresets];
    if (
      typeof currentLimit === 'number' &&
      currentLimit < totalAvailable &&
      !numericOptions.includes(currentLimit)
    ) {
      numericOptions.push(currentLimit);
      numericOptions.sort((a, b) => a - b);
    }

    for (const num of numericOptions) {
      const isCustom = !standardPresets.includes(num);
      menu.addItem((item) => {
        item
          .setTitle(isCustom ? `${num} карт (свой лимит)` : `${num} карт`)
          .setChecked(currentLimit === num)
          .onClick(async () => {
            this.plugin.settings.sessionCardLimit = num;
            await this.plugin.saveSettings();
            this.renderAll();
          });
      });
    }

    // Option "Все доступные (totalAvailable)"
    menu.addItem((item) => {
      item
        .setTitle(`Все доступные (${totalAvailable})`)
        .setChecked(currentLimit === 'all' || (typeof currentLimit === 'number' && currentLimit >= totalAvailable))
        .onClick(async () => {
          this.plugin.settings.sessionCardLimit = 'all';
          await this.plugin.saveSettings();
          this.renderAll();
        });
    });

    menu.addSeparator();

    // Option "Указать свой лимит..."
    menu.addItem((item) => {
      item
        .setTitle('Указать свой лимит...')
        .setIcon('sliders-horizontal')
        .onClick(() => {
          new CustomLimitModal(
            this.app,
            currentLimit,
            totalAvailable,
            async (newLimit) => {
              this.plugin.settings.sessionCardLimit = newLimit;
              await this.plugin.saveSettings();
              this.renderAll();
            }
          ).open();
        });
    });

    const rect = targetEl.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 6 });
  }

  /**
   * Renders tag chips with search input when count > 6.
   */
  private renderTagsBar(): void {
    this.clearActiveTooltips();
    this.tagsBarEl.empty();

    // Hide completely when not in lobby (active session or finished summary)
    if (this.sessionState !== 'lobby') {
      this.tagsBarEl.style.display = 'none';
      return;
    }

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
      this.selectedTagsOrder = [];
      this.sessionState = 'lobby';
      this.resetSession();
    });

    const filteredTags = this.tagSearchQuery
      ? tags.filter((t) => t.tag.toLowerCase().includes(this.tagSearchQuery.toLowerCase()))
      : tags;

    const tagsMap = new Map(tags.map((t) => [t.tag, t.count]));

    // 1. Selected (active) tags in MRU order (freshest selected tag is leftmost, right after "Все темы")
    const activeTagsToRender = this.selectedTagsOrder.filter((tag) => {
      if (!this.selectedTags.has(tag)) return false;
      if (this.tagSearchQuery && !tag.toLowerCase().includes(this.tagSearchQuery.toLowerCase())) {
        return false;
      }
      return true;
    });

    for (const tag of activeTagsToRender) {
      const count = tagsMap.get(tag) || 0;
      const chip = container.createEl('button', {
        cls: 'seelearn-tag-chip is-active',
      });
      chip.createSpan({ text: `#${tag}` });
      chip.createSpan({ cls: 'seelearn-tag-count', text: `${count}` });

      chip.addEventListener('click', () => {
        this.selectedTags.delete(tag);
        this.selectedTagsOrder = this.selectedTagsOrder.filter((t) => t !== tag);
        this.sessionState = 'lobby';
        this.resetSession();
      });
    }

    // 2. Unselected tags in standard order
    for (const { tag, count } of filteredTags) {
      if (this.selectedTags.has(tag)) continue;

      const chip = container.createEl('button', {
        cls: 'seelearn-tag-chip',
      });
      chip.createSpan({ text: `#${tag}` });
      chip.createSpan({ cls: 'seelearn-tag-count', text: `${count}` });

      chip.addEventListener('click', () => {
        this.selectedTags.add(tag);
        this.selectedTagsOrder = [tag, ...this.selectedTagsOrder.filter((t) => t !== tag)];
        this.sessionState = 'lobby';
        this.resetSession();
      });
    }

    const totalRendered = activeTagsToRender.length + filteredTags.filter((t) => !this.selectedTags.has(t.tag)).length;
    if (totalRendered === 0 && this.tagSearchQuery) {
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
    this.clearActiveTooltips();
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
    });
    setTooltip(prevArrow, 'Предыдущая карточка (ArrowLeft)');
    setIcon(prevArrow, 'chevron-left');
    prevArrow.disabled = this.currentIndex === 0;
    prevArrow.addEventListener('click', (e) => {
      e.stopPropagation();
      this.clearActiveTooltips();
      this.prevCard();
    });

    const cardContainer = cardWrapper.createDiv({ cls: 'seelearn-card-container' });
    let currentSize: CardSizePreset;
    if (card.cardSize) {
      currentSize = card.cardSize;
    } else if (card.fileCardSize) {
      currentSize = card.fileCardSize;
    } else if (this.plugin.storage.hasCustomCardSize(card.id)) {
      currentSize = this.plugin.storage.getCardSize(card.id, this.plugin.settings.defaultCardSize);
    } else {
      currentSize = this.plugin.settings.defaultCardSize || 'm';
    }
    let lastNonFullPreset: CardSizePreset = currentSize !== 'full' ? currentSize : 'm';

    cardContainer.addClass(`seelearn-size-${currentSize}`);
    cardWrapper.toggleClass('is-fullscreen', currentSize === 'full');
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
      setTooltip(progressPill, 'Односторонняя карточка для изучения информации');
    } else if (this.isTestMode()) {
      if (isLeech) {
        progressPill.addClass('is-leech');
        const iconSpan = progressPill.createSpan({ cls: 'seelearn-icon-inline' });
        setIcon(iconSpan, 'alert-circle');
        progressPill.createSpan({ text: ` Пиявка (${progress?.lapses || 0})` });
        setTooltip(
          progressPill,
          `Карточка вызывает частые ошибки (${progress?.lapses} сбоев). Рекомендуется переформулировать или разбить на простые факты.`
        );
      } else if (progress && (progress.repetitions > 0 || progress.lapses > 0)) {
        progressPill.setText(`Интервал: ${progress.interval} дн.`);
        progressPill.addClass('is-learned');
        setTooltip(
          progressPill,
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

    // Header Meta Block: Tags List
    const headerMeta = cardHeader.createDiv({ cls: 'seelearn-header-meta' });

    // Tags list container with overflow scroll
    const tagsContainer = headerMeta.createDiv({ cls: 'seelearn-card-tags' });
    if (card.tags.length > 0) {
      for (const tag of card.tags) {
        tagsContainer.createSpan({ cls: 'seelearn-card-tag-pill', text: `#${tag}` });
      }
    }

    const headerRight = cardHeader.createDiv({ cls: 'seelearn-header-right' });

    // Jump to Note Button with fast native Obsidian tooltip
    const jumpBtn = headerRight.createEl('button', {
      cls: 'seelearn-jump-btn',
    });
    setTooltip(jumpBtn, `${card.fileName}:${card.lineStart}`);
    const jumpIconSpan = jumpBtn.createSpan({ cls: 'seelearn-icon-inline' });
    setIcon(jumpIconSpan, 'external-link');

    jumpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.clearActiveTooltips();
      this.openCardInNote(card);
    });

    // Fullscreen Toggle Button (strictly icon-only: maximize-2 / minimize-2)
    const fullscreenBtn = headerRight.createEl('button', {
      cls: `seelearn-card-fullscreen-btn ${currentSize === 'full' ? 'is-active' : ''}`,
    });
    setTooltip(
      fullscreenBtn,
      currentSize === 'full' ? 'Вернуть стандартный размер' : 'Растянуть на весь экран'
    );
    const fsIconSpan = fullscreenBtn.createSpan({ cls: 'seelearn-icon-inline' });
    setIcon(fsIconSpan, currentSize === 'full' ? 'minimize-2' : 'maximize-2');

    fullscreenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isFull = currentSize === 'full';
      let nextSize: CardSizePreset;
      if (isFull) {
        nextSize = lastNonFullPreset;
      } else {
        lastNonFullPreset = currentSize;
        nextSize = 'full';
      }

      CARD_SIZE_PRESETS.forEach((p) => cardContainer.removeClass(`seelearn-size-${p}`));
      cardContainer.removeClass('seelearn-size-full');

      cardContainer.addClass(`seelearn-size-${nextSize}`);
      currentSize = nextSize;

      // Only persist to storage if the card has NO explicit @size: and NO fileCardSize
      if (!card.cardSize && !card.fileCardSize) {
        this.plugin.storage.setCardSize(card.id, nextSize);
      }

      cardWrapper.toggleClass('is-fullscreen', nextSize === 'full');
      fullscreenBtn.toggleClass('is-active', nextSize === 'full');
      setTooltip(
        fullscreenBtn,
        nextSize === 'full' ? 'Вернуть стандартный размер' : 'Растянуть на весь экран'
      );
      fsIconSpan.empty();
      setIcon(fsIconSpan, nextSize === 'full' ? 'minimize-2' : 'maximize-2');
    });

    // Interactive corner resize handle (bottom-right)
    const resizeHandle = cardContainer.createDiv({
      cls: 'seelearn-card-resize-handle',
    });
    setTooltip(resizeHandle, 'Потяните для изменения размера');
    resizeHandle.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="8.5" y1="1.5" x2="1.5" y2="8.5"></line><line x1="8.5" y1="5.5" x2="5.5" y2="8.5"></line></svg>`;

    let startX = 0;
    let startY = 0;
    let startWidth = 0;
    let startHeight = 0;
    let isDragging = false;

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!isDragging) return;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const newW = Math.min(820, Math.max(360, startWidth + dx));
      const newH = Math.min(640, Math.max(260, startHeight + dy));
      cardContainer.style.width = `${newW}px`;
      cardContainer.style.height = `${newH}px`;
    };

    const onPointerUp = () => {
      if (!isDragging) return;
      isDragging = false;
      cardContainer.removeClass('is-resizing');
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

      const finalW = cardContainer.offsetWidth;
      const finalH = cardContainer.offsetHeight;

      cardContainer.style.width = '';
      cardContainer.style.height = '';

      let closestPreset: CardSizePreset = 'm';
      let minDiff = Infinity;
      for (const p of CARD_SIZE_PRESETS) {
        const targetDim = PRESET_DIMENSIONS[p];
        const diff = Math.hypot(finalW - targetDim.width, finalH - targetDim.height);
        if (diff < minDiff) {
          minDiff = diff;
          closestPreset = p;
        }
      }

      CARD_SIZE_PRESETS.forEach((p) => cardContainer.removeClass(`seelearn-size-${p}`));
      cardContainer.removeClass('seelearn-size-full');
      cardContainer.addClass(`seelearn-size-${closestPreset}`);
      currentSize = closestPreset;
      lastNonFullPreset = closestPreset;

      // Only persist to storage if the card has NO explicit @size: and NO fileCardSize
      if (!card.cardSize && !card.fileCardSize) {
        this.plugin.storage.setCardSize(card.id, closestPreset);
      }

      cardWrapper.removeClass('is-fullscreen');
      fullscreenBtn.removeClass('is-active');
      setTooltip(fullscreenBtn, 'Растянуть на весь экран');
      fsIconSpan.empty();
      setIcon(fsIconSpan, 'maximize-2');
    };

    resizeHandle.addEventListener('pointerdown', (downEvent: PointerEvent) => {
      downEvent.stopPropagation();
      downEvent.preventDefault();
      isDragging = true;
      startX = downEvent.clientX;
      startY = downEvent.clientY;
      startWidth = cardContainer.offsetWidth;
      startHeight = cardContainer.offsetHeight;
      cardContainer.addClass('is-resizing');
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    });

    // Card Body
    const cardBody = cardContainer.createDiv({ cls: 'seelearn-card-body' });

    // Create Component for MarkdownRenderer lifecycle
    this.activeCardComponent = new Component();
    this.addChild(this.activeCardComponent);
    this.activeCardComponent.load();
    this.activeCardComponent.register(() => {
      if (isDragging) {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      }
    });

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

      const isLastCard = this.currentIndex >= this.sessionQueue.length - 1;
      const promptEl = cardBody.createDiv({ cls: 'seelearn-flip-prompt' });
      promptEl.createSpan({
        text: !this.isFlipped
          ? 'Нажмите Пробел или карточку, чтобы посмотреть ответ'
          : this.isTestMode()
          ? 'Оцените сложность (клавиши 1-4)'
          : isLastCard
          ? 'Ответ показан (Space — завершить сессию)'
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
    const isLastCard = this.currentIndex >= this.sessionQueue.length - 1;
    const canAdvanceOnLast = !this.isTestMode() && isLastCard && (this.isFlipped || !card.hasBack);

    const nextArrow = cardWrapper.createEl('button', {
      cls: 'seelearn-side-arrow next',
    });
    setTooltip(nextArrow, canAdvanceOnLast ? 'Завершить сессию (ArrowRight)' : 'Следующая карточка (ArrowRight)');
    setIcon(nextArrow, 'chevron-right');
    nextArrow.disabled = isLastCard && !canAdvanceOnLast;
    nextArrow.addEventListener('click', (e) => {
      e.stopPropagation();
      this.clearActiveTooltips();
      this.nextCard();
    });
  }

  /**
   * Renders the pre-session Lobby screen (Deck Overview).
   */
  private renderLobbyState(): void {
    const matchingCards = this.getFilteredCards();

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
        this.selectedTagsOrder = [];
        this.srsFilter = 'all';
        this.resetSession();
      });
      return;
    }

    // Grid with statistics (context-sensitive 2 cards: specific queue count + estimated time)
    const statsGrid = lobbyBox.createDiv({ cls: 'seelearn-lobby-grid' });

    if (this.srsFilter === 'due') {
      const dueCard = statsGrid.createDiv({ cls: 'seelearn-stat-card' });
      dueCard.createDiv({ cls: 'seelearn-stat-val text-warning', text: `${matchingCards.length}` });
      dueCard.createDiv({ cls: 'seelearn-stat-lbl', text: 'К повторению' });
    } else if (this.srsFilter === 'new') {
      const newCard = statsGrid.createDiv({ cls: 'seelearn-stat-card' });
      newCard.createDiv({ cls: 'seelearn-stat-val text-new', text: `${matchingCards.length}` });
      newCard.createDiv({ cls: 'seelearn-stat-lbl', text: 'Новые' });
    } else {
      const totalCard = statsGrid.createDiv({ cls: 'seelearn-stat-card' });
      totalCard.createDiv({ cls: 'seelearn-stat-val', text: `${matchingCards.length}` });
      totalCard.createDiv({ cls: 'seelearn-stat-lbl', text: 'Пул карт' });
    }

    const currentLimit = this.plugin.settings.sessionCardLimit ?? 'all';
    const sessionCount =
      typeof currentLimit === 'number' && currentLimit < matchingCards.length
        ? currentLimit
        : matchingCards.length;

    const estMinutes = Math.max(1, Math.ceil(sessionCount * 0.4));
    const timeCard = statsGrid.createDiv({ cls: 'seelearn-stat-card' });
    timeCard.createDiv({ cls: 'seelearn-stat-val', text: `~${estMinutes} мин` });
    timeCard.createDiv({ cls: 'seelearn-stat-lbl', text: 'Расчетное время' });

    // Streak stats
    const streakStats = this.plugin.storage.getStudyStreakStats();
    const streakBanner = lobbyBox.createDiv({ cls: 'seelearn-streak-banner' });
    const pill1 = streakBanner.createDiv({ cls: 'seelearn-streak-pill' });
    setIcon(pill1.createSpan({ cls: 'seelearn-icon-inline' }), 'flame');
    pill1.createSpan({ text: `Стрик: ${streakStats.currentStreak} дн.` });

    const pill2 = streakBanner.createDiv({ cls: 'seelearn-streak-pill' });
    setIcon(pill2.createSpan({ cls: 'seelearn-icon-inline' }), 'trophy');
    pill2.createSpan({ text: `Рекорд: ${streakStats.bestStreak} дн.` });

    // Primary action button & test saving
    const actionsRow = lobbyBox.createDiv({ cls: 'seelearn-lobby-actions' });
    const startBtn = actionsRow.createEl('button', {
      cls: 'seelearn-start-session-btn mod-cta',
    });
    setIcon(startBtn.createSpan({ cls: 'seelearn-icon-inline' }), 'play');

    const limitSuffix =
      typeof currentLimit === 'number' && currentLimit < matchingCards.length
        ? ` (${currentLimit} карт)`
        : ` (все ${matchingCards.length})`;

    startBtn.createSpan({
      text: this.isTestMode()
        ? `Начать сессию проверки${limitSuffix}`
        : `Начать изучение${limitSuffix}`,
    });
    startBtn.addEventListener('click', () => {
      this.activePresetName = undefined;
      this.startSession();
    });

    if (this.isTestMode() && this.srsFilter === 'all') {
      const saveTestBtn = actionsRow.createEl('button', {
        cls: 'seelearn-nav-btn seelearn-btn-save-test',
        text: 'Сохранить как тест...',
      });
      setTooltip(saveTestBtn, 'Упаковать текущую выборку карточек в быстрый тест для повторного прохождения');
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
      text: 'Нажмите Пробел или Enter для быстрого старта',
    });

    // Saved test presets list (for rapid testing, shown only when srsFilter === 'all')
    const presets = this.plugin.storage.getTestPresets();
    if (presets.length > 0 && this.isTestMode() && this.srsFilter === 'all') {
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
        });
        setTooltip(playBtn, 'Пройти этот тест');
        setIcon(playBtn.createSpan({ cls: 'seelearn-icon-inline' }), 'play');
        playBtn.addEventListener('click', () => {
          this.startTestPreset(preset);
        });

        const delBtn = right.createEl('button', {
          cls: 'clickable-icon seelearn-btn-icon',
        });
        setTooltip(delBtn, 'Удалить тест');
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
    pill1.createSpan({ text: `Стрик: ${streakStats.currentStreak} дн.` });

    const pill2 = streakBanner.createDiv({ cls: 'seelearn-streak-pill' });
    setIcon(pill2.createSpan({ cls: 'seelearn-icon-inline' }), 'trophy');
    pill2.createSpan({ text: `Рекорд: ${streakStats.bestStreak} дн.` });

    const pill3 = streakBanner.createDiv({ cls: 'seelearn-streak-pill' });
    setIcon(pill3.createSpan({ cls: 'seelearn-icon-inline' }), 'layers');
    pill3.createSpan({ text: `Всего: ${formatFlipsCount(streakStats.totalReviews)}` });

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
      setTooltip(cell, `${dateStr}: ${count} повторений`);
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
      cls: 'seelearn-nav-btn seelearn-summary-btn',
      text: 'Вернуться в лобби',
    });
    lobbyBtn.addEventListener('click', () => {
      this.sessionState = 'lobby';
      this.renderAll();
    });

    if (this.sessionStats.failedCards.length > 0) {
      const repeatFailedBtn = actionsRow.createEl('button', {
        cls: 'seelearn-nav-btn seelearn-btn-repeat seelearn-summary-btn',
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
      cls: 'seelearn-nav-btn mod-cta seelearn-summary-btn',
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
    this.clearActiveTooltips();
    this.navBarEl.empty();
    this.navBarEl.style.display = 'flex';

    // 1. Left group: persistent utility actions (Help, Shuffle, Refresh)
    const leftNav = this.navBarEl.createDiv({ cls: 'seelearn-nav-group left' });
    const actionsGroup = leftNav.createDiv({ cls: 'seelearn-nav-actions' });

    // Help button
    const helpBtn = actionsGroup.createEl('button', {
      cls: 'clickable-icon seelearn-btn-icon seelearn-nav-help-btn',
    });
    setIcon(helpBtn, 'help-circle');
    setTooltip(helpBtn, 'Шпаргалка и справка');
    helpBtn.addEventListener('click', async () => {
      await OnboardingManager.openCheatsheetNote(this.app);
    });

    // Shuffle button
    const shuffleBtn = actionsGroup.createEl('button', {
      cls: 'clickable-icon seelearn-btn-icon seelearn-nav-shuffle-btn',
    });
    setIcon(shuffleBtn, 'shuffle');
    setTooltip(
      shuffleBtn,
      this.sessionState === 'active'
        ? 'Перемешать оставшиеся карточки в очереди'
        : 'Перемешать колоду'
    );
    shuffleBtn.addEventListener('click', () => {
      this.shuffleQueue();
    });

    // Refresh / Reindex button
    const refreshBtn = actionsGroup.createEl('button', {
      cls: 'clickable-icon seelearn-btn-icon seelearn-nav-refresh-btn',
    });
    setIcon(refreshBtn, 'refresh-cw');
    setTooltip(refreshBtn, 'Переиндексировать хранилище');
    refreshBtn.addEventListener('click', async () => {
      new Notice('SeeLearn: переиндексация карточек...');
      await this.plugin.reloadAllCards();
    });

    // 2. Center group: navigation and rating buttons (populated in active session)
    const centerNav = this.navBarEl.createDiv({ cls: 'seelearn-nav-group center' });

    // 3. Right group: exit button in active session (both Learn and Test modes)
    const rightNav = this.navBarEl.createDiv({ cls: 'seelearn-nav-group right' });

    if (this.sessionState === 'active') {
      const exitBtn = rightNav.createEl('button', {
        cls: 'clickable-icon seelearn-btn-icon seelearn-nav-exit-btn',
      });
      setIcon(exitBtn, 'log-out');
      setTooltip(exitBtn, 'Завершить сессию и перейти к итогам');
      exitBtn.addEventListener('click', async () => {
        await this.plugin.storage.saveNow();
        this.sessionState = 'finished';
        this.renderAll();
      });
    }

    if (this.sessionState !== 'active' || this.sessionQueue.length === 0) {
      return;
    }

    const currentCard = this.sessionQueue[this.currentIndex];

    if (!this.isTestMode()) {
      // LEARN MODE (Режим "Ботать" по умолчанию)
      if (currentCard?.hasBack) {
        const isLastCard = this.currentIndex === this.sessionQueue.length - 1;
        const flipText = !this.isFlipped
          ? 'Показать ответ (Space)'
          : isLastCard
          ? 'Завершить сессию (Space)'
          : 'Скрыть ответ (Space)';
        const flipBtn = centerNav.createEl('button', {
          cls: 'seelearn-nav-btn mod-cta',
          text: flipText,
        });
        setTooltip(
          flipBtn,
          isLastCard && this.isFlipped ? 'Завершить сессию (Space)' : 'Перевернуть карточку (Space)'
        );
        flipBtn.addEventListener('click', () => {
          if (isLastCard && this.isFlipped) {
            this.nextCard();
          } else {
            this.flipCard();
          }
        });
      }
    } else {
      // TEST MODE (Режим "Проверить знания" с SM-2)
      if (!currentCard?.hasBack) {
        // Front-only info card in test mode
        const readBtn = centerNav.createEl('button', {
          cls: 'seelearn-nav-btn mod-cta',
          text: 'Понятно / Изучено (Space)',
        });
        setTooltip(readBtn, 'Понятно / Изучено (Space)');
        readBtn.addEventListener('click', () => this.handleSRSRating('good'));
      } else if (!this.isFlipped) {
        // Front of two-sided card in test mode
        const flipBtn = centerNav.createEl('button', {
          cls: 'seelearn-nav-btn mod-cta',
          text: 'Показать ответ (Space)',
        });
        setTooltip(flipBtn, 'Перевернуть карточку (Space)');
        flipBtn.addEventListener('click', () => this.flipCard());
      } else {
        // Back of two-sided card: 4 SRS Rating Buttons with predicted intervals
        const record = currentCard ? this.plugin.storage.getProgress(currentCard.id) : undefined;
        const previews = getSRSIntervalPreviews(record);

        // [1] Снова
        const againBtn = centerNav.createEl('button', {
          cls: 'seelearn-nav-btn seelearn-btn-srs seelearn-btn-again',
        });
        setTooltip(againBtn, 'Забыл ответ (клавиша 1)');
        againBtn.createSpan({ cls: 'seelearn-srs-title', text: '[1] Снова' });
        againBtn.createSpan({ cls: 'seelearn-srs-badge', text: previews.again });
        againBtn.addEventListener('click', () => this.handleSRSRating('again'));

        // [2] Трудно
        const hardBtn = centerNav.createEl('button', {
          cls: 'seelearn-nav-btn seelearn-btn-srs seelearn-btn-hard',
        });
        setTooltip(hardBtn, 'Вспомнил с заметным трудом (клавиша 2)');
        hardBtn.createSpan({ cls: 'seelearn-srs-title', text: '[2] Трудно' });
        hardBtn.createSpan({ cls: 'seelearn-srs-badge', text: previews.hard });
        hardBtn.addEventListener('click', () => this.handleSRSRating('hard'));

        // [3] Хорошо (unify style, remove mod-cta)
        const goodBtn = centerNav.createEl('button', {
          cls: 'seelearn-nav-btn seelearn-btn-srs seelearn-btn-good',
        });
        setTooltip(goodBtn, 'Уверенно вспомнил (клавиша 3)');
        goodBtn.createSpan({ cls: 'seelearn-srs-title', text: '[3] Хорошо' });
        goodBtn.createSpan({ cls: 'seelearn-srs-badge', text: previews.good });
        goodBtn.addEventListener('click', () => this.handleSRSRating('good'));

        // [4] Легко
        const easyBtn = centerNav.createEl('button', {
          cls: 'seelearn-nav-btn seelearn-btn-srs seelearn-btn-easy',
        });
        setTooltip(easyBtn, 'Мгновенный и легкий ответ (клавиша 4)');
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
        this.nextCard();
      }
    }
  }

  private flipCard(): void {
    this.clearActiveTooltips();
    if (this.sessionQueue.length === 0) return;
    const currentCard = this.sessionQueue[this.currentIndex];
    if (!currentCard?.hasBack) return; // Cannot flip front-only card

    this.isFlipped = !this.isFlipped;

    const cardContainer = this.cardAreaEl.querySelector('.seelearn-card-container');
    const answerSection = this.cardAreaEl.querySelector<HTMLElement>('.seelearn-answer-section');
    const frontEl = this.cardAreaEl.querySelector<HTMLElement>('.seelearn-front');
    const promptEl = this.cardAreaEl.querySelector<HTMLElement>('.seelearn-flip-prompt');

    if (cardContainer && answerSection && frontEl) {
      const isLastCard = this.currentIndex >= this.sessionQueue.length - 1;
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
            this.isTestMode()
              ? 'Оцените сложность (клавиши 1-4)'
              : isLastCard
              ? 'Ответ показан (Space — завершить сессию)'
              : 'Ответ показан (Space — далее)'
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

      // Update next side arrow state reactively
      const nextArrowEl = this.cardAreaEl.querySelector<HTMLButtonElement>('.seelearn-side-arrow.next');
      if (nextArrowEl) {
        const canAdvanceOnLast = !this.isTestMode() && isLastCard && (this.isFlipped || !currentCard?.hasBack);
        nextArrowEl.disabled = isLastCard && !canAdvanceOnLast;
        setTooltip(nextArrowEl, canAdvanceOnLast ? 'Завершить сессию (ArrowRight)' : 'Следующая карточка (ArrowRight)');
      }

      this.renderNavBar();
    } else {
      this.renderCardArea();
      this.renderNavBar();
    }
  }

  private nextCard(): void {
    this.clearActiveTooltips();
    if (this.currentIndex < this.sessionQueue.length - 1) {
      this.pushHistoryState();
      this.currentIndex++;
      this.isFlipped = false;
      this.sessionStats.totalReviewed++;
      this.renderToolbar();
      this.renderCardArea();
      this.renderNavBar();
    } else if (this.currentIndex === this.sessionQueue.length - 1) {
      // In Learn mode: if the user hasn't viewed the answer yet, flip first
      if (!this.isTestMode()) {
        const currentCard = this.sessionQueue[this.currentIndex];
        if (currentCard?.hasBack && !this.isFlipped) {
          this.flipCard();
          return;
        }
      }
      // Finished all cards
      this.sessionStats.totalReviewed++;
      this.sessionState = 'finished';
      this.sessionQueue = [];
      this.renderAll();
    }
  }

  private prevCard(): void {
    this.clearActiveTooltips();
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
    this.clearActiveTooltips();
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
    this.clearActiveTooltips();
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
    this.clearActiveTooltips();
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
    this.clearActiveTooltips();
    this.selectedScope = preset.scope;
    this.selectedTags = new Set(preset.tags);
    this.selectedTagsOrder = [...preset.tags];
    this.srsFilter = 'all';
    this.plugin.settings.studyMode = 'test';
    this.activePresetName = preset.name;
    this.plugin.storage.recordTestPresetRun(preset.id);
    new Notice(`Запуск теста «${preset.name}»`);
    this.startSession();
  }

  private async openCardInNote(card: Flashcard): Promise<void> {
    this.clearActiveTooltips();
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

  /**
   * Clears any active Obsidian tooltips from DOM and dispatches mouseleave
   * to hovered elements to avoid orphaned tooltips when elements are unmounted.
   */
  private clearActiveTooltips(): void {
    try {
      if (this.containerEl) {
        try {
          const hovered = this.containerEl.querySelectorAll(':hover');
          hovered.forEach((el) => {
            el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false, cancelable: true }));
            el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, cancelable: true }));
          });
        } catch {
          // Ignore if :hover is not supported in environment
        }
      }

      const doc = this.containerEl?.ownerDocument || (window as any).activeDocument || document;
      if (doc) {
        doc.querySelectorAll('.tooltip').forEach((t: Element) => {
          try {
            t.remove();
          } catch {
            // Ignore
          }
        });
      }
    } catch {
      // Safe fallback
    }
  }

  private cleanupCardComponent(): void {
    this.clearActiveTooltips();
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
    this.modalEl.addClass('seelearn-save-test-modal');
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

/**
 * Modal to configure custom session card limit.
 */
export class CustomLimitModal extends Modal {
  private currentLimit: number | 'all';
  private totalAvailable: number;
  private onSave: (limit: number | 'all') => void;
  private inputVal: string = '';

  constructor(
    app: App,
    currentLimit: number | 'all',
    totalAvailable: number,
    onSave: (limit: number | 'all') => void
  ) {
    super(app);
    this.currentLimit = currentLimit;
    this.totalAvailable = totalAvailable;
    this.onSave = onSave;
    this.inputVal = typeof currentLimit === 'number' ? String(currentLimit) : '';
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass('seelearn-custom-limit-modal');
    contentEl.addClass('seelearn-custom-limit-modal');

    contentEl.createEl('h2', { text: 'Лимит карточек на сессию' });
    contentEl.createEl('p', {
      cls: 'seelearn-modal-desc',
      text: `Укажите максимальное число карточек для одной учебной сессии. Доступно в текущей выборке: ${this.totalAvailable}.`,
    });

    new Setting(contentEl)
      .setName('Число карточек')
      .setDesc('Введите число больше 0 или оставьте пустым для прохождения всех карт.')
      .addText((text) => {
        text
          .setPlaceholder(`Все (${this.totalAvailable})`)
          .setValue(this.inputVal)
          .onChange((val) => {
            this.inputVal = val.trim();
          });
        text.inputEl.type = 'number';
        text.inputEl.min = '1';
        text.inputEl.focus();
        text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.handleSave();
          }
        });
      });

    const btnRow = contentEl.createDiv({ cls: 'seelearn-modal-btn-row modal-button-container' });

    const allBtn = btnRow.createEl('button', {
      cls: 'seelearn-nav-btn',
      text: 'Сбросить (Все)',
    });
    allBtn.addEventListener('click', () => {
      this.onSave('all');
      this.close();
    });

    const cancelBtn = btnRow.createEl('button', {
      cls: 'seelearn-nav-btn',
      text: 'Отмена',
    });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = btnRow.createEl('button', {
      cls: 'seelearn-nav-btn mod-cta',
      text: 'Зафиксировать лимит',
    });
    saveBtn.addEventListener('click', () => this.handleSave());
  }

  private handleSave(): void {
    if (!this.inputVal || this.inputVal.toLowerCase() === 'all') {
      this.onSave('all');
      this.close();
      return;
    }
    const parsed = parseInt(this.inputVal, 10);
    if (!isNaN(parsed) && parsed > 0) {
      this.onSave(parsed);
      this.close();
    } else {
      new Notice('Пожалуйста, введите положительное число');
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}


