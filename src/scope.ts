import { Flashcard, ScopeInput, WorkspaceScope } from './types';

export interface ScopeFileNode {
  type: 'file';
  path: string;
  name: string;
  title: string;
  count: number;
}

export interface ScopeFolderNode {
  type: 'folder';
  path: string;
  name: string;
  count: number;
  subfolders: Map<string, ScopeFolderNode>;
  files: ScopeFileNode[];
}

export interface ScopeTreeRoot {
  totalCards: number;
  folders: Map<string, ScopeFolderNode>;
  rootFiles: ScopeFileNode[];
}

/**
 * Normalizes legacy string scopes ('', 'folder:...', 'file:...') and modern WorkspaceScope
 * into a standard WorkspaceScope structure.
 */
export function normalizeScope(scope: ScopeInput): WorkspaceScope {
  if (!scope) {
    return { all: true, folders: [], files: [] };
  }

  if (typeof scope === 'string') {
    const trimmed = scope.trim();
    if (!trimmed) {
      return { all: true, folders: [], files: [] };
    }
    if (trimmed.startsWith('folder:')) {
      const folderPath = trimmed.substring(7).trim();
      if (!folderPath) {
        return { all: true, folders: [], files: [] };
      }
      return {
        all: false,
        folders: [folderPath],
        files: [],
      };
    }
    if (trimmed.startsWith('file:')) {
      const filePath = trimmed.substring(5).trim();
      if (!filePath) {
        return { all: true, folders: [], files: [] };
      }
      return {
        all: false,
        folders: [],
        files: [filePath],
      };
    }
    return { all: true, folders: [], files: [] };
  }

  if (typeof scope === 'object') {
    const folders = Array.isArray(scope.folders) ? scope.folders.filter(Boolean) : [];
    const files = Array.isArray(scope.files) ? scope.files.filter(Boolean) : [];
    const all = Boolean(scope.all);
    return {
      all,
      folders: all ? [] : folders,
      files: all ? [] : files,
    };
  }

  return { all: true, folders: [], files: [] };
}

/**
 * Checks whether a flashcard matches the given workspace scope.
 */
export function cardMatchesScope(
  card: { filePath: string },
  scopeInput: ScopeInput
): boolean {
  const scope = normalizeScope(scopeInput);
  if (scope.all) return true;

  // Direct file match
  if (scope.files.includes(card.filePath)) {
    return true;
  }

  // Folder prefix match
  for (const folder of scope.folders) {
    if (card.filePath === folder || card.filePath.startsWith(`${folder}/`)) {
      return true;
    }
  }

  return false;
}

/**
 * Counts how many flashcards match the given scope.
 */
export function countScopedCards(
  cards: Flashcard[],
  scopeInput: ScopeInput
): number {
  return cards.filter((card) => cardMatchesScope(card, scopeInput)).length;
}

/**
 * Formats a Russian plural word for folder/file counts.
 */
function formatPlural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 19) return `${count} ${many}`;
  if (mod10 === 1) return `${count} ${one}`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} ${few}`;
  return `${count} ${many}`;
}

/**
 * Formats a concise, human-readable scope label for display in the toolbar button.
 * e.g.:
 * - "Все заметки (120)"
 * - "Папка: Biology (45)"
 * - "Заметка: Cell (15)"
 * - "Выбрано: 2 папки, 3 заметки (85)"
 */
export function formatScopeLabel(
  scopeInput: ScopeInput,
  cards: Flashcard[]
): string {
  const scope = normalizeScope(scopeInput);
  const count = countScopedCards(cards, scope);

  if (!scope.all && scope.folders.length === 0 && scope.files.length === 0) {
    return 'Нет карт в выборке';
  }

  if (scope.all) {
    return `Все заметки (${cards.length})`;
  }

  if (scope.folders.length === 1 && scope.files.length === 0) {
    const folder = scope.folders[0];
    const name = folder.split('/').pop() || folder;
    return `Папка: ${name} (${count})`;
  }

  if (scope.files.length === 1 && scope.folders.length === 0) {
    const file = scope.files[0];
    const name = file.split('/').pop()?.replace(/\.md$/, '') || file;
    return `Заметка: ${name} (${count})`;
  }

  const folderCount = scope.folders.length;
  const fileCount = scope.files.length;

  if (folderCount > 0 && fileCount > 0) {
    const folderStr = formatPlural(folderCount, 'папка', 'папки', 'папок');
    const fileStr = formatPlural(fileCount, 'заметка', 'заметки', 'заметок');
    return `Выбрано: ${folderStr}, ${fileStr} (${count})`;
  }

  if (folderCount > 1) {
    const folderStr = formatPlural(folderCount, 'папка', 'папки', 'папок');
    return `Выбрано: ${folderStr} (${count})`;
  }

  if (fileCount > 1) {
    const fileStr = formatPlural(fileCount, 'заметка', 'заметки', 'заметок');
    return `Выбрано: ${fileStr} (${count})`;
  }

  return `Все заметки (${cards.length})`;
}

/**
 * Builds a hierarchical tree structure of folders and files from cards.
 * Only folders and files that contain at least one card are included.
 */
export function buildScopeTree(cards: Flashcard[]): ScopeTreeRoot {
  const fileCardCounts = new Map<string, number>();
  for (const card of cards) {
    fileCardCounts.set(card.filePath, (fileCardCounts.get(card.filePath) || 0) + 1);
  }

  const root: ScopeTreeRoot = {
    totalCards: cards.length,
    folders: new Map(),
    rootFiles: [],
  };

  for (const [filePath, count] of fileCardCounts.entries()) {
    const parts = filePath.split('/');
    const fileName = parts.pop() || filePath;
    const title = fileName.replace(/\.md$/, '');
    const fileNode: ScopeFileNode = {
      type: 'file',
      path: filePath,
      name: fileName,
      title,
      count,
    };

    if (parts.length === 0) {
      root.rootFiles.push(fileNode);
    } else {
      let currentMap = root.folders;
      let currentPath = '';

      for (let i = 0; i < parts.length; i++) {
        const segment = parts[i];
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;

        let folderNode = currentMap.get(segment);
        if (!folderNode) {
          folderNode = {
            type: 'folder',
            path: currentPath,
            name: segment,
            count: 0,
            subfolders: new Map(),
            files: [],
          };
          currentMap.set(segment, folderNode);
        }

        folderNode.count += count;

        if (i === parts.length - 1) {
          folderNode.files.push(fileNode);
        } else {
          currentMap = folderNode.subfolders;
        }
      }
    }
  }

  // Sort files and subfolders alphabetically
  root.rootFiles.sort((a, b) => a.title.localeCompare(b.title));
  sortFolderTree(root.folders);

  return root;
}

function sortFolderTree(folderMap: Map<string, ScopeFolderNode>): void {
  for (const folder of folderMap.values()) {
    folder.files.sort((a, b) => a.title.localeCompare(b.title));
    sortFolderTree(folder.subfolders);
  }
}

/**
 * Checks if a folder path is included in the scope.
 */
export function isFolderSelected(
  folderPath: string,
  scope: WorkspaceScope
): boolean {
  if (scope.all) return true;
  for (const f of scope.folders) {
    if (folderPath === f || folderPath.startsWith(`${f}/`)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if a file path is included in the scope.
 */
export function isFileSelected(
  filePath: string,
  scope: WorkspaceScope
): boolean {
  if (scope.all) return true;
  if (scope.files.includes(filePath)) return true;
  for (const f of scope.folders) {
    if (filePath.startsWith(`${f}/`)) {
      return true;
    }
  }
  return false;
}
