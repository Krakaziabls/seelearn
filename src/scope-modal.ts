import { App, Modal, Notice, setIcon, setTooltip } from 'obsidian';
import { Flashcard, ScopeInput, WorkspaceScope } from './types';
import {
  buildScopeTree,
  countScopedCards,
  formatScopeLabel,
  normalizeScope,
  ScopeFileNode,
  ScopeFolderNode,
  ScopeTreeRoot,
} from './scope';

export class WorkspaceScopeModal extends Modal {
  private cards: Flashcard[];
  private onApply: (scope: WorkspaceScope) => void;
  private tree: ScopeTreeRoot;
  private allFilePaths: string[];

  // Selection state
  private isAll: boolean;
  private selectedFolders: Set<string>;
  private selectedFiles: Set<string>;

  // UI state
  private searchQuery = '';
  private collapsedFolders = new Set<string>();

  // DOM Elements
  private treeContainerEl!: HTMLElement;
  private searchInputEl!: HTMLInputElement;
  private footerSummaryEl!: HTMLElement;
  private applyBtnEl!: HTMLButtonElement;

  constructor(
    app: App,
    cards: Flashcard[],
    initialScope: ScopeInput,
    onApply: (scope: WorkspaceScope) => void
  ) {
    super(app);
    this.cards = cards;
    this.onApply = onApply;
    this.tree = buildScopeTree(cards);

    // Extract all unique file paths containing cards
    const uniqueFiles = new Set<string>();
    for (const card of cards) {
      uniqueFiles.add(card.filePath);
    }
    this.allFilePaths = Array.from(uniqueFiles);

    const norm = normalizeScope(initialScope);
    this.isAll = norm.all;
    this.selectedFolders = new Set(norm.folders);
    this.selectedFiles = new Set(norm.files);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass('seelearn-scope-modal');
    contentEl.empty();

    // 1. Modal Header
    const headerEl = contentEl.createDiv({ cls: 'seelearn-scope-header' });
    const titleRow = headerEl.createDiv({ cls: 'seelearn-scope-title-row' });
    const titleLeft = titleRow.createDiv({ cls: 'seelearn-scope-title-left' });

    const iconSpan = titleLeft.createSpan({ cls: 'seelearn-icon-inline' });
    setIcon(iconSpan, 'folder-tree');
    titleLeft.createEl('h2', { text: 'Пространство карточек', cls: 'seelearn-scope-title' });

    // 2. Search Bar
    const searchContainer = headerEl.createDiv({ cls: 'seelearn-scope-search-box' });
    const searchIcon = searchContainer.createSpan({ cls: 'seelearn-scope-search-icon' });
    setIcon(searchIcon, 'search');

    this.searchInputEl = searchContainer.createEl('input', {
      type: 'text',
      cls: 'seelearn-scope-search-input',
      placeholder: 'Поиск по папкам и заметкам...',
    });

    const clearSearchBtn = searchContainer.createEl('button', {
      cls: 'seelearn-btn-icon seelearn-scope-clear-search',
    });
    setTooltip(clearSearchBtn, 'Очистить поиск');
    const clearIcon = clearSearchBtn.createSpan({ cls: 'seelearn-icon-inline' });
    setIcon(clearIcon, 'x');
    clearSearchBtn.style.display = 'none';

    this.searchInputEl.addEventListener('input', () => {
      this.searchQuery = this.searchInputEl.value.trim().toLowerCase();
      clearSearchBtn.style.display = this.searchQuery ? 'inline-flex' : 'none';
      this.renderTree();
    });

    clearSearchBtn.addEventListener('click', () => {
      this.searchInputEl.value = '';
      this.searchQuery = '';
      clearSearchBtn.style.display = 'none';
      this.renderTree();
    });

    // 3. Bulk Actions Toolbar
    const actionsBar = contentEl.createDiv({ cls: 'seelearn-scope-actions-bar' });

    const leftActions = actionsBar.createDiv({ cls: 'seelearn-scope-actions-left' });
    const selectAllBtn = leftActions.createEl('button', {
      cls: 'seelearn-btn seelearn-btn-secondary seelearn-scope-btn-sm',
      text: 'Выбрать все',
    });
    selectAllBtn.addEventListener('click', () => {
      this.isAll = true;
      this.selectedFolders.clear();
      this.selectedFiles.clear();
      this.renderTree();
      this.updateFooter();
    });

    const resetBtn = leftActions.createEl('button', {
      cls: 'seelearn-btn seelearn-btn-secondary seelearn-scope-btn-sm',
      text: 'Сбросить',
    });
    resetBtn.addEventListener('click', () => {
      this.isAll = false;
      this.selectedFolders.clear();
      this.selectedFiles.clear();
      this.renderTree();
      this.updateFooter();
    });

    const rightActions = actionsBar.createDiv({ cls: 'seelearn-scope-actions-right' });
    const expandAllBtn = rightActions.createEl('button', {
      cls: 'seelearn-btn seelearn-btn-secondary seelearn-scope-btn-sm',
      text: 'Развернуть все',
    });
    expandAllBtn.addEventListener('click', () => {
      this.collapsedFolders.clear();
      this.renderTree();
    });

    const collapseAllBtn = rightActions.createEl('button', {
      cls: 'seelearn-btn seelearn-btn-secondary seelearn-scope-btn-sm',
      text: 'Свернуть все',
    });
    collapseAllBtn.addEventListener('click', () => {
      this.collapseAllFolders();
      this.renderTree();
    });

    // 4. Scrollable Tree Container
    this.treeContainerEl = contentEl.createDiv({ cls: 'seelearn-scope-tree' });
    this.renderTree();

    // 5. Modal Footer
    const footerEl = contentEl.createDiv({ cls: 'seelearn-scope-footer' });
    this.footerSummaryEl = footerEl.createDiv({ cls: 'seelearn-scope-summary' });
    this.updateFooter();

    const footerButtons = footerEl.createDiv({ cls: 'seelearn-scope-footer-buttons' });
    const cancelBtn = footerButtons.createEl('button', {
      cls: 'seelearn-btn seelearn-btn-secondary',
      text: 'Отмена',
    });
    cancelBtn.addEventListener('click', () => this.close());

    this.applyBtnEl = footerButtons.createEl('button', {
      cls: 'seelearn-btn seelearn-btn-primary mod-cta',
      text: 'Применить',
    });
    this.applyBtnEl.addEventListener('click', () => {
      if (!this.hasSelection()) {
        new Notice('Не выбрано ни одной карточки. Выберите хотя бы одну папку или заметку.');
        return;
      }
      const scope = this.getCurrentScope();
      this.close();
      this.onApply(scope);
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }

  private collapseAllFolders(): void {
    const collectPaths = (folders: Map<string, ScopeFolderNode>) => {
      for (const folder of folders.values()) {
        this.collapsedFolders.add(folder.path);
        collectPaths(folder.subfolders);
      }
    };
    collectPaths(this.tree.folders);
  }

  private hasSelection(): boolean {
    if (this.isAll) return this.cards.length > 0;
    return this.selectedFolders.size > 0 || this.selectedFiles.size > 0;
  }

  /**
   * Constructs the current WorkspaceScope object from current selections.
   */
  private getCurrentScope(): WorkspaceScope {
    if (this.isAll) {
      return { all: true, folders: [], files: [] };
    }
    return {
      all: false,
      folders: Array.from(this.selectedFolders).sort(),
      files: Array.from(this.selectedFiles).sort(),
    };
  }

  /**
   * Updates the footer selection summary and matching card count.
   */
  private updateFooter(): void {
    if (!this.hasSelection()) {
      this.footerSummaryEl.setText('Нет карт в выборке');
      if (this.applyBtnEl) {
        this.applyBtnEl.addClass('is-disabled');
        this.applyBtnEl.setAttribute('aria-disabled', 'true');
      }
      return;
    }

    if (this.applyBtnEl) {
      this.applyBtnEl.removeClass('is-disabled');
      this.applyBtnEl.removeAttribute('aria-disabled');
    }

    const scope = this.getCurrentScope();
    const label = formatScopeLabel(scope, this.cards);
    this.footerSummaryEl.setText(label);
  }

  /**
   * Determines if a file is considered checked under current state.
   */
  private isFileChecked(filePath: string): boolean {
    if (this.isAll) return true;
    if (this.selectedFiles.has(filePath)) return true;
    for (const f of this.selectedFolders) {
      if (filePath.startsWith(`${f}/`)) return true;
    }
    return false;
  }

  /**
   * Gathers all file paths under a folder node.
   */
  private getAllFolderFiles(folder: ScopeFolderNode): string[] {
    const files: string[] = folder.files.map((f) => f.path);
    for (const sub of folder.subfolders.values()) {
      files.push(...this.getAllFolderFiles(sub));
    }
    return files;
  }

  /**
   * Computes checkbox state for a folder:
   * returns { checked: boolean, indeterminate: boolean }
   */
  private getFolderCheckboxState(folder: ScopeFolderNode): {
    checked: boolean;
    indeterminate: boolean;
  } {
    if (this.isAll) {
      return { checked: true, indeterminate: false };
    }

    const allFiles = this.getAllFolderFiles(folder);
    if (allFiles.length === 0) {
      return { checked: false, indeterminate: false };
    }

    let checkedCount = 0;
    for (const filePath of allFiles) {
      if (this.isFileChecked(filePath)) {
        checkedCount++;
      }
    }

    if (checkedCount === allFiles.length) {
      return { checked: true, indeterminate: false };
    }
    if (checkedCount > 0) {
      return { checked: false, indeterminate: true };
    }
    return { checked: false, indeterminate: false };
  }

  /**
   * Toggles folder selection.
   */
  private toggleFolder(folder: ScopeFolderNode, currentlyChecked: boolean): void {
    const folderFiles = this.getAllFolderFiles(folder);

    if (currentlyChecked) {
      // Uncheck folder
      if (this.isAll) {
        this.isAll = false;
        // Select all vault files except this folder's files
        this.selectedFiles = new Set(this.allFilePaths.filter((p) => !folderFiles.includes(p)));
        this.selectedFolders.clear();
      } else {
        this.selectedFolders.delete(folder.path);
        // Also remove any descendant subfolders or files
        for (const f of Array.from(this.selectedFolders)) {
          if (f.startsWith(`${folder.path}/`)) {
            this.selectedFolders.delete(f);
          }
        }
        for (const f of folderFiles) {
          this.selectedFiles.delete(f);
        }
      }
    } else {
      // Check folder
      if (this.isAll) {
        return;
      }
      this.selectedFolders.add(folder.path);
      // Clean up redundant individual files under this folder
      for (const f of folderFiles) {
        this.selectedFiles.delete(f);
      }
      // Check if all vault files are now checked
      this.checkIfAllSelected();
    }

    this.renderTree();
    this.updateFooter();
  }

  /**
   * Toggles single file selection.
   */
  private toggleFile(filePath: string, currentlyChecked: boolean): void {
    if (currentlyChecked) {
      // Uncheck file
      if (this.isAll) {
        this.isAll = false;
        this.selectedFiles = new Set(this.allFilePaths.filter((p) => p !== filePath));
        this.selectedFolders.clear();
      } else {
        // If an ancestor folder was selected, decompose it into individual files minus this one
        for (const folder of Array.from(this.selectedFolders)) {
          if (filePath.startsWith(`${folder}/`)) {
            this.selectedFolders.delete(folder);
            const parentFiles = this.allFilePaths.filter(
              (p) => p.startsWith(`${folder}/`) && p !== filePath
            );
            for (const pf of parentFiles) {
              this.selectedFiles.add(pf);
            }
          }
        }
        this.selectedFiles.delete(filePath);
      }
    } else {
      // Check file
      if (this.isAll) {
        return;
      }
      this.selectedFiles.add(filePath);
      this.checkIfAllSelected();
    }

    this.renderTree();
    this.updateFooter();
  }

  private checkIfAllSelected(): void {
    let allChecked = true;
    for (const p of this.allFilePaths) {
      if (!this.isFileChecked(p)) {
        allChecked = false;
        break;
      }
    }
    if (allChecked) {
      this.isAll = true;
      this.selectedFolders.clear();
      this.selectedFiles.clear();
    }
  }

  /**
   * Recursively renders the scope tree into the container element.
   */
  private renderTree(): void {
    this.treeContainerEl.empty();

    if (this.cards.length === 0) {
      const emptyEl = this.treeContainerEl.createDiv({ cls: 'seelearn-scope-empty' });
      emptyEl.setText('В хранилище не найдено карточек #seelearn');
      return;
    }

    let renderedAny = false;

    // Render folders
    for (const folder of this.tree.folders.values()) {
      if (this.matchesQuery(folder)) {
        this.renderFolderNode(this.treeContainerEl, folder, 0);
        renderedAny = true;
      }
    }

    // Render root files
    for (const file of this.tree.rootFiles) {
      if (this.fileMatchesQuery(file)) {
        this.renderFileNode(this.treeContainerEl, file, 0);
        renderedAny = true;
      }
    }

    if (!renderedAny) {
      const noMatchEl = this.treeContainerEl.createDiv({ cls: 'seelearn-scope-empty' });
      noMatchEl.setText('Ничего не найдено по вашему запросу');
    }
  }

  private matchesQuery(folder: ScopeFolderNode): boolean {
    if (!this.searchQuery) return true;
    if (folder.name.toLowerCase().includes(this.searchQuery)) return true;
    for (const f of folder.files) {
      if (this.fileMatchesQuery(f)) return true;
    }
    for (const sub of folder.subfolders.values()) {
      if (this.matchesQuery(sub)) return true;
    }
    return false;
  }

  private fileMatchesQuery(file: ScopeFileNode): boolean {
    if (!this.searchQuery) return true;
    return (
      file.title.toLowerCase().includes(this.searchQuery) ||
      file.path.toLowerCase().includes(this.searchQuery)
    );
  }

  private renderFolderNode(
    parentEl: HTMLElement,
    folder: ScopeFolderNode,
    level: number
  ): void {
    const isCollapsed = this.searchQuery ? false : this.collapsedFolders.has(folder.path);
    const { checked, indeterminate } = this.getFolderCheckboxState(folder);

    const folderRow = parentEl.createDiv({
      cls: `seelearn-scope-item seelearn-scope-folder-row ${checked ? 'is-selected' : ''}`,
    });
    folderRow.style.paddingLeft = `${Math.min(level * 20 + 8, 80)}px`;

    // 1. Collapse / Expand toggle chevron
    const toggleBtn = folderRow.createSpan({ cls: 'seelearn-scope-toggle-icon' });
    setIcon(toggleBtn, isCollapsed ? 'chevron-right' : 'chevron-down');
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isCollapsed) {
        this.collapsedFolders.delete(folder.path);
      } else {
        this.collapsedFolders.add(folder.path);
      }
      this.renderTree();
    });

    // 2. Folder Checkbox
    const checkbox = folderRow.createEl('input', {
      type: 'checkbox',
      cls: 'seelearn-scope-checkbox',
    });
    checkbox.checked = checked;
    checkbox.indeterminate = indeterminate;

    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      this.toggleFolder(folder, checked);
    });

    // 3. Folder Icon & Label
    const iconSpan = folderRow.createSpan({ cls: 'seelearn-scope-item-icon' });
    setIcon(iconSpan, isCollapsed ? 'folder' : 'folder-open');

    const nameSpan = folderRow.createSpan({
      cls: 'seelearn-scope-item-name',
      text: folder.name,
    });

    // Clicking row toggles folder selection
    folderRow.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target === checkbox || target.closest('.seelearn-scope-toggle-icon')) return;
      this.toggleFolder(folder, checked);
    });


    // If expanded, render subfolders and files
    if (!isCollapsed) {
      const childrenContainer = parentEl.createDiv({ cls: 'seelearn-scope-children' });
      for (const sub of folder.subfolders.values()) {
        if (this.matchesQuery(sub)) {
          this.renderFolderNode(childrenContainer, sub, level + 1);
        }
      }
      for (const file of folder.files) {
        if (this.fileMatchesQuery(file)) {
          this.renderFileNode(childrenContainer, file, level + 1);
        }
      }
    }
  }

  private renderFileNode(
    parentEl: HTMLElement,
    file: ScopeFileNode,
    level: number
  ): void {
    const checked = this.isFileChecked(file.path);

    const fileRow = parentEl.createDiv({
      cls: `seelearn-scope-item seelearn-scope-file-row ${checked ? 'is-selected' : ''}`,
    });
    fileRow.style.paddingLeft = `${Math.min(level * 20 + 26, 96)}px`;

    // File Checkbox
    const checkbox = fileRow.createEl('input', {
      type: 'checkbox',
      cls: 'seelearn-scope-checkbox',
    });
    checkbox.checked = checked;

    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      this.toggleFile(file.path, checked);
    });

    // File Icon & Label
    const iconSpan = fileRow.createSpan({ cls: 'seelearn-scope-item-icon' });
    setIcon(iconSpan, 'file-text');

    fileRow.createSpan({
      cls: 'seelearn-scope-item-name',
      text: file.title,
    });

    fileRow.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target === checkbox) return;
      this.toggleFile(file.path, checked);
    });

  }
}
