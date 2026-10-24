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
import { Flashcard, ValidationWarning } from './types';

export const VIEW_TYPE_SEELEARN = 'seelearn-study-view';

export class StudyView extends ItemView {
  plugin: SeeLearnPlugin;
  private selectedTags: Set<string> = new Set();
  private selectedFile: string = '';
  private sessionQueue: Flashcard[] = [];
  private currentIndex: number = 0;
  private isFlipped: boolean = false;
  private activeCardComponent: Component | null = null;

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
      } else if (evt.code === 'KeyR' || evt.code === 'Digit1') {
        evt.preventDefault();
        this.repeatLater();
      } else if (evt.code === 'KeyK' || evt.code === 'Digit2') {
        evt.preventDefault();
        this.markKnown();
      }
    });

    this.resetSession();
  }

  async onClose(): Promise<void> {
    this.cleanupCardComponent();
    this.contentEl.empty();
  }

  /**
   * Resets the session queue according to currently active filters.
   */
  public resetSession(keepIndex = false): void {
    const filtered = this.getFilteredCards();
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
    // Preserve current card if still present in filtered list
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

  private getFilteredCards(): Flashcard[] {
    return this.plugin.cards.filter((card) => {
      // File filter
      if (this.selectedFile && card.filePath !== this.selectedFile) {
        return false;
      }

      // Tag filter (must contain all selected tags)
      if (this.selectedTags.size > 0) {
        for (const tag of this.selectedTags) {
          if (!card.tags.includes(tag)) {
            return false;
          }
        }
      }

      return true;
    });
  }

  private getAllAvailableTags(): { tag: string; count: number }[] {
    const tagCounts = new Map<string, number>();

    // Count tags only for cards matching the file filter (if any)
    const baseCards = this.selectedFile
      ? this.plugin.cards.filter((c) => c.filePath === this.selectedFile)
      : this.plugin.cards;

    for (const card of baseCards) {
      for (const tag of card.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    return Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  private getAllFiles(): string[] {
    const files = new Set<string>();
    for (const card of this.plugin.cards) {
      files.add(card.filePath);
    }
    return Array.from(files).sort();
  }

  private renderAll(): void {
    this.renderToolbar();
    this.renderTagsBar();
    this.renderCardArea();
    this.renderNavBar();
  }

  /**
   * Renders the top toolbar with file filter, shuffle, stats, and warnings.
   */
  private renderToolbar(): void {
    this.toolbarEl.empty();

    const leftGroup = this.toolbarEl.createDiv({ cls: 'seelearn-toolbar-group left' });
    const rightGroup = this.toolbarEl.createDiv({ cls: 'seelearn-toolbar-group right' });

    // File Selector Dropdown
    const files = this.getAllFiles();
    const fileSelect = leftGroup.createEl('select', { cls: 'dropdown seelearn-file-select' });

    const defaultOption = fileSelect.createEl('option', {
      value: '',
      text: `Все заметки (${this.plugin.cards.length} карт)`,
    });
    if (!this.selectedFile) defaultOption.selected = true;

    for (const file of files) {
      const count = this.plugin.cards.filter((c) => c.filePath === file).length;
      const opt = fileSelect.createEl('option', {
        value: file,
        text: `${file} (${count})`,
      });
      if (this.selectedFile === file) opt.selected = true;
    }

    fileSelect.addEventListener('change', () => {
      this.selectedFile = fileSelect.value;
      // Clear tag filters that might not exist in the selected file
      this.resetSession();
    });

    // Shuffle Button
    const shuffleBtn = leftGroup.createEl('button', {
      cls: 'clickable-icon seelearn-btn-icon',
      title: 'Перемешать колоду',
    });
    setIcon(shuffleBtn, 'shuffle');
    shuffleBtn.addEventListener('click', () => {
      this.shuffleQueue();
    });

    // Refresh Button
    const refreshBtn = leftGroup.createEl('button', {
      cls: 'clickable-icon seelearn-btn-icon',
      title: 'Переиндексировать хранилище',
    });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', async () => {
      new Notice('SeeLearn: переиндексация карточек...');
      await this.plugin.reloadAllCards();
    });

    // Validation warnings badge (if any)
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

    // Card Counter
    const total = this.sessionQueue.length;
    const current = total > 0 ? this.currentIndex + 1 : 0;
    rightGroup.createDiv({
      cls: 'seelearn-counter-badge',
      text: `Карта ${current} из ${total}`,
    });
  }

  /**
   * Renders tag chips for filtering.
   */
  private renderTagsBar(): void {
    this.tagsBarEl.empty();

    const tags = this.getAllAvailableTags();
    if (tags.length === 0) {
      this.tagsBarEl.style.display = 'none';
      return;
    }
    this.tagsBarEl.style.display = 'flex';

    // "All" chip
    const allChip = this.tagsBarEl.createEl('button', {
      cls: `seelearn-tag-chip ${this.selectedTags.size === 0 ? 'is-active' : ''}`,
      text: 'Все темы',
    });
    allChip.addEventListener('click', () => {
      this.selectedTags.clear();
      this.resetSession();
    });

    // Individual tag chips
    for (const { tag, count } of tags) {
      const isActive = this.selectedTags.has(tag);
      const chip = this.tagsBarEl.createEl('button', {
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
  }

  /**
   * Renders the card container, header, front/back markdown content.
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

    // Card Header (Tags, File, Jump to Note button)
    const cardHeader = cardContainer.createDiv({ cls: 'seelearn-card-header' });

    const headerLeft = cardHeader.createDiv({ cls: 'seelearn-header-left' });
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

    if (!this.isFlipped) {
      // STATE 1: Question (@front)
      const frontEl = cardBody.createDiv({ cls: 'seelearn-content seelearn-front' });
      await MarkdownRenderer.render(
        this.app,
        card.front,
        frontEl,
        card.filePath,
        this.activeCardComponent
      );

      // Prompt overlay / button
      const promptEl = cardBody.createDiv({ cls: 'seelearn-flip-prompt' });
      promptEl.createSpan({ text: 'Нажмите пробел или карточку, чтобы посмотреть ответ' });

      cardBody.addEventListener('click', () => {
        this.flipCard();
      });
    } else {
      // STATE 2: Answer (@back)
      if (this.plugin.settings.revealMode === 'append') {
        // Mode A: Front + Divider + Back
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
        // Mode B: Replace with Back only
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
   * Renders empty or completed state when no cards are available.
   */
  private renderEmptyState(): void {
    const emptyBox = this.cardAreaEl.createDiv({ cls: 'seelearn-empty-box' });

    if (this.plugin.cards.length === 0) {
      setIcon(emptyBox.createDiv({ cls: 'seelearn-empty-icon' }), 'inbox');
      emptyBox.createEl('h3', { text: 'Карточки не найдены' });
      emptyBox.createEl('p', {
        text: `Убедитесь, что в заметках указано свойство ${this.plugin.settings.triggerProperty}: ${this.plugin.settings.triggerValue} и используется разметка %% @card %% ... %% @end %%.`,
      });

      const helpCode = emptyBox.createEl('pre', { cls: 'seelearn-sample-code' });
      helpCode.createEl('code', {
        text: `---
tags:
  - seelearn
topics:
  - JavaScript
---

%% @card #basics %%
%% @front %%
Что такое замыкание (closure)?
%% @back %%
Функция вместе со своим лексическим окружением.
%% @end %%`,
      });
    } else {
      setIcon(emptyBox.createDiv({ cls: 'seelearn-empty-icon' }), 'check-circle');
      emptyBox.createEl('h3', { text: '🎉 Сессия завершена!' });
      emptyBox.createEl('p', {
        text: 'Вы повторили все карточки в этой выборке.',
      });

      const restartBtn = emptyBox.createEl('button', {
        cls: 'mod-cta',
        text: 'Повторить снова',
      });
      restartBtn.addEventListener('click', () => {
        this.resetSession();
      });
    }
  }

  /**
   * Renders the bottom navigation bar with Back, Flip, Next, Know, Repeat later buttons.
   */
  private renderNavBar(): void {
    this.navBarEl.empty();

    const hasCards = this.sessionQueue.length > 0;
    const isFirst = this.currentIndex === 0;
    const isLast = this.currentIndex >= this.sessionQueue.length - 1;

    const leftNav = this.navBarEl.createDiv({ cls: 'seelearn-nav-group left' });
    const centerNav = this.navBarEl.createDiv({ cls: 'seelearn-nav-group center' });
    const rightNav = this.navBarEl.createDiv({ cls: 'seelearn-nav-group right' });

    // Previous Button
    const prevBtn = leftNav.createEl('button', {
      cls: 'seelearn-nav-btn',
      text: '← Назад',
      title: 'Предыдущая карточка (ArrowLeft)',
    });
    prevBtn.disabled = !hasCards || isFirst;
    prevBtn.addEventListener('click', () => this.prevCard());

    // Flip Button
    const flipText = !this.isFlipped ? 'Показать ответ' : 'Скрыть ответ';
    const flipBtn = centerNav.createEl('button', {
      cls: 'seelearn-nav-btn mod-cta',
      text: `${flipText} (Space)`,
      title: 'Перевернуть карточку (Space)',
    });
    flipBtn.disabled = !hasCards;
    flipBtn.addEventListener('click', () => this.flipCard());

    // Next Button
    const nextBtn = centerNav.createEl('button', {
      cls: 'seelearn-nav-btn',
      text: 'Далее →',
      title: 'Следующая карточка (ArrowRight)',
    });
    nextBtn.disabled = !hasCards || isLast;
    nextBtn.addEventListener('click', () => this.nextCard());

    // Session buttons: Repeat Later & Know
    const repeatBtn = rightNav.createEl('button', {
      cls: 'seelearn-nav-btn seelearn-btn-repeat',
      text: 'Повторить позже',
      title: 'Переместить карту в конец очереди (клавиша 1 / R)',
    });
    repeatBtn.disabled = !hasCards;
    repeatBtn.addEventListener('click', () => this.repeatLater());

    const knowBtn = rightNav.createEl('button', {
      cls: 'seelearn-nav-btn seelearn-btn-know',
      text: 'Знаю ✓',
      title: 'Убрать карту из текущей сессии (клавиша 2 / K)',
    });
    knowBtn.disabled = !hasCards;
    knowBtn.addEventListener('click', () => this.markKnown());
  }

  // --- ACTIONS ---

  private handleSpace(): void {
    if (this.sessionQueue.length === 0) return;
    if (!this.isFlipped) {
      this.flipCard();
    } else {
      if (this.currentIndex < this.sessionQueue.length - 1) {
        this.nextCard();
      } else {
        this.flipCard();
      }
    }
  }

  private flipCard(): void {
    if (this.sessionQueue.length === 0) return;
    this.isFlipped = !this.isFlipped;
    this.renderCardArea();
    this.renderNavBar();
  }

  private nextCard(): void {
    if (this.currentIndex < this.sessionQueue.length - 1) {
      this.currentIndex++;
      this.isFlipped = false;
      this.renderToolbar();
      this.renderCardArea();
      this.renderNavBar();
    }
  }

  private prevCard(): void {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.isFlipped = false;
      this.renderToolbar();
      this.renderCardArea();
      this.renderNavBar();
    }
  }

  private repeatLater(): void {
    if (this.sessionQueue.length === 0) return;

    const card = this.sessionQueue[this.currentIndex];
    // Move current card to the end of the queue
    this.sessionQueue.splice(this.currentIndex, 1);
    this.sessionQueue.push(card);

    if (this.currentIndex >= this.sessionQueue.length) {
      this.currentIndex = Math.max(0, this.sessionQueue.length - 1);
    }

    this.isFlipped = false;
    new Notice('Карточка отложена в конец очереди');
    this.renderAll();
  }

  private markKnown(): void {
    if (this.sessionQueue.length === 0) return;

    // Remove card from current session
    this.sessionQueue.splice(this.currentIndex, 1);

    if (this.currentIndex >= this.sessionQueue.length) {
      this.currentIndex = Math.max(0, this.sessionQueue.length - 1);
    }

    this.isFlipped = false;
    new Notice('Карточка освоена!');
    this.renderAll();
  }

  private shuffleQueue(): void {
    if (this.sessionQueue.length <= 1) return;

    for (let i = this.sessionQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.sessionQueue[i], this.sessionQueue[j]] = [
        this.sessionQueue[j],
        this.sessionQueue[i],
      ];
    }

    this.currentIndex = 0;
    this.isFlipped = false;
    new Notice('Колода перемешана');
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
