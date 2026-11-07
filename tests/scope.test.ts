import assert from 'node:assert';
import test from 'node:test';
import {
  buildScopeTree,
  cardMatchesScope,
  countScopedCards,
  formatScopeLabel,
  normalizeScope,
} from '../src/scope';
import { Flashcard, WorkspaceScope } from '../src/types';

function createCard(id: string, filePath: string): Flashcard {
  return {
    id,
    filePath,
    fileName: filePath.split('/').pop() || filePath,
    lineStart: 1,
    lineEnd: 5,
    front: `Question ${id}`,
    back: `Answer ${id}`,
    hasBack: true,
    isCloze: false,
    tags: ['topic'],
    globalTopics: ['topic'],
    localTags: ['topic'],
  };
}

test('normalizeScope handles legacy strings and defaults', () => {
  assert.deepStrictEqual(normalizeScope(''), { all: true, folders: [], files: [] });
  assert.deepStrictEqual(normalizeScope(null), { all: true, folders: [], files: [] });
  assert.deepStrictEqual(normalizeScope(undefined), { all: true, folders: [], files: [] });

  assert.deepStrictEqual(normalizeScope('folder:Languages/Spanish'), {
    all: false,
    folders: ['Languages/Spanish'],
    files: [],
  });

  assert.deepStrictEqual(normalizeScope('file:Science/Physics.md'), {
    all: false,
    folders: [],
    files: ['Science/Physics.md'],
  });

  // Empty folder/file fallback to all
  assert.deepStrictEqual(normalizeScope('folder:'), { all: true, folders: [], files: [] });
  assert.deepStrictEqual(normalizeScope('file:'), { all: true, folders: [], files: [] });
});

test('normalizeScope handles modern WorkspaceScope structures', () => {
  const scope: WorkspaceScope = {
    all: false,
    folders: ['Biology', 'Math/Algebra'],
    files: ['History/Rome.md'],
  };
  assert.deepStrictEqual(normalizeScope(scope), {
    all: false,
    folders: ['Biology', 'Math/Algebra'],
    files: ['History/Rome.md'],
  });

  // Empty arrays with all: false represents empty selection
  assert.deepStrictEqual(normalizeScope({ all: false, folders: [], files: [] }), {
    all: false,
    folders: [],
    files: [],
  });
});

test('cardMatchesScope matches single and multi-selection scopes correctly', () => {
  const c1 = createCard('1', 'Science/Biology/Cell.md');
  const c2 = createCard('2', 'Science/Biology/Genetics.md');
  const c3 = createCard('3', 'Science/Physics.md');
  const c4 = createCard('4', 'Languages/Spanish.md');
  const c5 = createCard('5', 'RootNote.md');

  // 1. All scope
  assert.strictEqual(cardMatchesScope(c1, ''), true);
  assert.strictEqual(cardMatchesScope(c5, { all: true, folders: [], files: [] }), true);

  // 2. Folder scope (including subfolders)
  const bioScope = { all: false, folders: ['Science/Biology'], files: [] };
  assert.strictEqual(cardMatchesScope(c1, bioScope), true);
  assert.strictEqual(cardMatchesScope(c2, bioScope), true);
  assert.strictEqual(cardMatchesScope(c3, bioScope), false);

  const scienceScope = 'folder:Science';
  assert.strictEqual(cardMatchesScope(c1, scienceScope), true);
  assert.strictEqual(cardMatchesScope(c2, scienceScope), true);
  assert.strictEqual(cardMatchesScope(c3, scienceScope), true);
  assert.strictEqual(cardMatchesScope(c4, scienceScope), false);

  // 3. File scope
  const physicsScope = 'file:Science/Physics.md';
  assert.strictEqual(cardMatchesScope(c3, physicsScope), true);
  assert.strictEqual(cardMatchesScope(c1, physicsScope), false);

  // 4. Multi-selection union
  const multiScope: WorkspaceScope = {
    all: false,
    folders: ['Languages'],
    files: ['Science/Physics.md', 'RootNote.md'],
  };
  assert.strictEqual(cardMatchesScope(c1, multiScope), false);
  assert.strictEqual(cardMatchesScope(c3, multiScope), true); // matches file
  assert.strictEqual(cardMatchesScope(c4, multiScope), true); // matches folder
  assert.strictEqual(cardMatchesScope(c5, multiScope), true); // matches file
});

test('buildScopeTree constructs hierarchical tree with correct card aggregations', () => {
  const cards = [
    createCard('1', 'Science/Biology/Cell.md'),
    createCard('2', 'Science/Biology/Cell.md'),
    createCard('3', 'Science/Biology/Genetics.md'),
    createCard('4', 'Science/Physics.md'),
    createCard('5', 'RootNote.md'),
  ];

  const tree = buildScopeTree(cards);

  assert.strictEqual(tree.totalCards, 5);
  assert.strictEqual(tree.rootFiles.length, 1);
  assert.strictEqual(tree.rootFiles[0].name, 'RootNote.md');
  assert.strictEqual(tree.rootFiles[0].count, 1);

  assert.strictEqual(tree.folders.size, 1);
  const scienceFolder = tree.folders.get('Science')!;
  assert.ok(scienceFolder);
  assert.strictEqual(scienceFolder.count, 4); // 2 in Cell + 1 in Genetics + 1 in Physics
  assert.strictEqual(scienceFolder.files.length, 1); // Physics.md
  assert.strictEqual(scienceFolder.files[0].name, 'Physics.md');
  assert.strictEqual(scienceFolder.files[0].count, 1);

  const bioFolder = scienceFolder.subfolders.get('Biology')!;
  assert.ok(bioFolder);
  assert.strictEqual(bioFolder.count, 3); // 2 Cell + 1 Genetics
  assert.strictEqual(bioFolder.files.length, 2);
  assert.strictEqual(bioFolder.files[0].title, 'Cell');
  assert.strictEqual(bioFolder.files[0].count, 2);
  assert.strictEqual(bioFolder.files[1].title, 'Genetics');
  assert.strictEqual(bioFolder.files[1].count, 1);
});

test('countScopedCards counts matching cards accurately', () => {
  const cards = [
    createCard('1', 'FolderA/Note1.md'),
    createCard('2', 'FolderA/Note2.md'),
    createCard('3', 'FolderB/Note3.md'),
    createCard('4', 'Note4.md'),
  ];

  assert.strictEqual(countScopedCards(cards, ''), 4);
  assert.strictEqual(countScopedCards(cards, 'folder:FolderA'), 2);
  assert.strictEqual(countScopedCards(cards, 'file:Note4.md'), 1);
  assert.strictEqual(
    countScopedCards(cards, { all: false, folders: ['FolderA'], files: ['Note4.md'] }),
    3
  );
});

test('formatScopeLabel generates compact, intuitive Russian summaries', () => {
  const cards = [
    createCard('1', 'FolderA/Note1.md'),
    createCard('2', 'FolderA/Note2.md'),
    createCard('3', 'FolderB/Note3.md'),
    createCard('4', 'Note4.md'),
  ];

  // 0. Empty selection
  assert.strictEqual(
    formatScopeLabel({ all: false, folders: [], files: [] }, cards),
    'Нет карт в выборке'
  );

  // 1. All
  assert.strictEqual(formatScopeLabel('', cards), 'Все заметки (4)');
  assert.strictEqual(formatScopeLabel({ all: true, folders: [], files: [] }, cards), 'Все заметки (4)');

  // 2. Single folder
  assert.strictEqual(formatScopeLabel('folder:FolderA', cards), 'Папка: FolderA (2)');

  // 3. Single file
  assert.strictEqual(formatScopeLabel('file:Note4.md', cards), 'Заметка: Note4 (1)');

  // 4. Multiple folders
  assert.strictEqual(
    formatScopeLabel({ all: false, folders: ['FolderA', 'FolderB'], files: [] }, cards),
    'Выбрано: 2 папки (3)'
  );

  // 5. Multiple files
  assert.strictEqual(
    formatScopeLabel({ all: false, folders: [], files: ['FolderA/Note1.md', 'FolderA/Note2.md'] }, cards),
    'Выбрано: 2 заметки (2)'
  );

  // 6. Folders and files combined with plural forms
  assert.strictEqual(
    formatScopeLabel(
      { all: false, folders: ['FolderA'], files: ['FolderB/Note3.md', 'Note4.md'] },
      cards
    ),
    'Выбрано: 1 папка, 2 заметки (4)'
  );
});
