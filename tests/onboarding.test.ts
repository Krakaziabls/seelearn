import test from 'node:test';
import assert from 'node:assert/strict';
import { OnboardingManager } from '../src/onboarding';
import { parseCardsFromMarkdown } from '../src/parser';
import type { App, TFile } from 'obsidian';

test('Onboarding: cheatsheet template does not include #seelearn trigger tag', () => {
  const cheatsheet = OnboardingManager.getCheatsheetMarkdownContent();

  // The tag #seelearn must not appear as an active tag in frontmatter or plain text
  // (Only allowed inside code blocks showing example syntax)
  const lines = cheatsheet.split('\n');
  let inCodeBlock = false;
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (!inCodeBlock) {
      assert.ok(
        !line.includes('#seelearn'),
        `Cheatsheet should not contain #seelearn outside code blocks: "${line}"`
      );
    }
  }
});

test('Onboarding: cheatsheet template covers all required syntax and SM-2 methodology', () => {
  const content = OnboardingManager.getCheatsheetMarkdownContent();

  // Syntax requirements
  assert.ok(content.includes('@front'), 'Must document @front');
  assert.ok(content.includes('@back'), 'Must document @back');
  assert.ok(content.includes('%% @card'), 'Must document comment syntax');
  assert.ok(content.includes('{{c1::'), 'Must document Cloze syntax');
  assert.ok(content.includes('=='), 'Must document highlight syntax');
  assert.ok(content.includes('%%%%'), 'Must document privacy %%%% syntax');

  // SM-2 methodology requirements
  assert.ok(content.includes('SM-2'), 'Must mention SM-2');
  assert.ok(content.includes('Новые (New)'), 'Must explain New queue');
  assert.ok(content.includes('К повторению (Due)'), 'Must explain Due queue');
  assert.ok(content.includes('[1] Снова'), 'Must explain Again rating');
  assert.ok(content.includes('[2] Трудно'), 'Must explain Hard rating');
  assert.ok(content.includes('[3] Хорошо'), 'Must explain Good rating');
  assert.ok(content.includes('[4] Легко'), 'Must explain Easy rating');
  assert.ok(content.includes('Пиявка') || content.includes('Пиявки') || content.includes('Leech'), 'Must explain Leeches');
});

test('Onboarding: Demo Note 1 (Basic & Scroll) contains valid parseable cards', () => {
  const content = OnboardingManager.getDemoNote1Content();
  assert.ok(content.includes('tags:\n  - seelearn'), 'Demo 1 must have seelearn tag');
  assert.ok(content.includes('topics:'), 'Demo 1 must define topics');

  const { cards, warnings } = parseCardsFromMarkdown(
    OnboardingManager.DEMO_NOTE_1,
    'Пример 1 — Базовые карты и Скролл.md',
    content,
    ['Биология', 'Анатомия']
  );

  assert.equal(warnings.length, 0, `Expected 0 warnings, got: ${JSON.stringify(warnings)}`);
  assert.equal(cards.length, 4, `Expected 4 cards, got ${cards.length}`);

  // Card 1: Mitochondria regular comment
  assert.match(cards[0].front, /митохондрий/i);
  assert.match(cards[0].back, /АТФ/i);

  // Card 2: Ribosomes open with custom ID
  const ribosome = cards.find((c) => c.customId === 'bio-ribosome-01');
  assert.ok(ribosome, 'Ribosome card should retain customId bio-ribosome-01');
  assert.match(ribosome.front, /рибосом/i);

  // Card 3: Apoptosis reversed card
  assert.match(cards[2].front, /запрограммированной гибели/i);
  assert.match(cards[2].back, /Апоптоз/i);

  // Card 4: Internal capsule long scroll card
  const capsule = cards.find((c) => c.customId === 'bio-internal-capsule');
  assert.ok(capsule, 'Capsule card should retain customId bio-internal-capsule');
  assert.match(capsule.back, /Передняя ножка/i);
});

test('Onboarding: Demo Note 2 (Cloze & Multi-cloze) contains valid parseable cards', () => {
  const content = OnboardingManager.getDemoNote2Content();
  assert.ok(content.includes('tags:\n  - seelearn'), 'Demo 2 must have seelearn tag');

  const { cards, warnings } = parseCardsFromMarkdown(
    OnboardingManager.DEMO_NOTE_2,
    'Пример 2 — Cloze-пропуски и Мульти-клоуз.md',
    content,
    ['География', 'Страны']
  );

  assert.equal(warnings.length, 0, `Expected 0 warnings, got: ${JSON.stringify(warnings)}`);
  // 1 Amazon + 1 Everest (with hint) + 2 Oslo/Helsinki (multi-cloze) + 1 Vostok (highlight) + 1 Panama (cloze + back) = 6 cards
  assert.equal(cards.length, 6, `Expected 6 cards, got ${cards.length}`);

  // Verify multi-cloze split
  const clozeCards = cards.filter((c) => c.isCloze);
  assert.ok(clozeCards.some((c) => c.clozeIndex === 1 && c.back.includes('Осло')));
  assert.ok(clozeCards.some((c) => c.clozeIndex === 2 && c.back.includes('Хельсинки')));

  // Verify hint
  const everestCard = cards.find((c) => c.front.includes('границе Непала и Китая'));
  assert.ok(everestCard, 'Everest card should show hint on front');

  // Verify cloze with back block
  const panamaCard = cards.find((c) => c.customId === 'geo-panama');
  assert.ok(panamaCard, 'Panama card should retain customId geo-panama');
  assert.match(panamaCard.back, /Строительство канала длиной около 80 км/i);
});

test('Onboarding: Demo Note 3 (Code & Programming) contains valid parseable cards', () => {
  const content = OnboardingManager.getDemoNote3Content();
  assert.ok(content.includes('tags:\n  - seelearn'), 'Demo 3 must have seelearn tag');

  const { cards, warnings } = parseCardsFromMarkdown(
    OnboardingManager.DEMO_NOTE_3,
    'Пример 3 — Блоки кода и Программирование.md',
    content,
    ['IT', 'Программирование', 'Алгоритмы']
  );

  assert.equal(warnings.length, 0, `Expected 0 warnings, got: ${JSON.stringify(warnings)}`);
  assert.equal(cards.length, 4, `Expected 4 cards, got ${cards.length}`);

  // Event loop card with code block
  const eventLoop = cards.find((c) => c.customId === 'it-eventloop-01');
  assert.ok(eventLoop, 'Event Loop card should exist');
  assert.match(eventLoop.front, /console\.log\('1'\)/);
  assert.match(eventLoop.back, /1, 4, 3, 2/);

  // Binary search card with Python code
  const binarySearch = cards.find((c) => c.customId === 'it-binary-search');
  assert.ok(binarySearch, 'Binary search card should exist');
  assert.match(binarySearch.back, /def binary_search/);

  // SQL cloze card
  const sqlCard = cards.find((c) => c.tags.includes('sql'));
  assert.ok(sqlCard?.isCloze, 'SQL card should be cloze');
  assert.match(sqlCard.back, /HAVING/);
});

test('Onboarding: Demo Note 4 (LaTeX & Exact Sciences) contains valid parseable cards', () => {
  const content = OnboardingManager.getDemoNote4Content();
  assert.ok(content.includes('tags:\n  - seelearn'), 'Demo 4 must have seelearn tag');

  const { cards, warnings } = parseCardsFromMarkdown(
    OnboardingManager.DEMO_NOTE_4,
    'Пример 4 — Формулы LaTeX и Точные науки.md',
    content,
    ['Физика', 'Математика']
  );

  assert.equal(warnings.length, 0, `Expected 0 warnings, got: ${JSON.stringify(warnings)}`);
  assert.equal(cards.length, 4, `Expected 4 cards, got ${cards.length}`);

  // Einstein card
  assert.match(cards[0].back, /E = mc\^2/);

  // Gauss integral
  const gauss = cards.find((c) => c.customId === 'math-gauss-integral');
  assert.ok(gauss, 'Gauss integral card should exist');
  assert.match(gauss.back, /\\sqrt\{\\pi\}/);

  // Discriminant cloze
  const algebra = cards.find((c) => c.tags.includes('алгебра'));
  assert.ok(algebra?.isCloze, 'Algebra card should be cloze');
  assert.match(algebra.back, /D = b\^2 - 4ac/);
});

test('Onboarding: Demo Note 5 (Lecture Note with %%%% Privacy) contains valid parseable cards', () => {
  const content = OnboardingManager.getDemoNote5Content();
  assert.ok(content.includes('tags:\n  - seelearn'), 'Demo 5 must have seelearn tag');

  const { cards, warnings } = parseCardsFromMarkdown(
    OnboardingManager.DEMO_NOTE_5,
    'Пример 5 — Конспект с приватными картами (%%%%).md',
    content,
    ['История', 'Конспекты']
  );

  assert.equal(warnings.length, 0, `Expected 0 warnings, got: ${JSON.stringify(warnings)}`);
  // 1 Gutenberg + 2 Fyodorov (multi-cloze) + 1 Impact = 4 cards
  assert.equal(cards.length, 4, `Expected 4 cards, got ${cards.length}`);

  const gutenberg = cards.find((c) => c.customId === 'hist-gutenberg-01');
  assert.ok(gutenberg, 'Gutenberg card wrapped in %%%% should be parsed successfully');

  const clozeCards = cards.filter((c) => c.isCloze);
  assert.equal(clozeCards.length, 2, 'Fyodorov multi-cloze should produce 2 cards');
});

test('Onboarding: ensureOnboardingAssets creates missing assets and handles recreation', async () => {
  const mockVaultFiles = new Map<string, { path: string; extension: string; content?: string }>();
  const mockFolders = new Set<string>();

  // Add a legacy file to test automatic cleanup
  mockVaultFiles.set('SeeLearn Examples/Пример — Биология клетки.md', {
    path: 'SeeLearn Examples/Пример — Биология клетки.md',
    extension: 'md',
  });

  const mockApp = {
    vault: {
      getAbstractFileByPath: (p: string) => {
        if (mockFolders.has(p)) return { path: p };
        return mockVaultFiles.get(p) || null;
      },
      createFolder: async (p: string) => {
        mockFolders.add(p);
      },
      create: async (p: string, content: string) => {
        const file = { path: p, extension: 'md', content };
        mockVaultFiles.set(p, file);
        return file;
      },
      delete: async (file: any) => {
        mockVaultFiles.delete(file.path);
      },
    },
    workspace: {
      getLeavesOfType: () => [],
      getLeaf: () => ({
        openFile: async () => {},
      }),
      setActiveLeaf: () => {},
    },
  } as unknown as App;

  // First run: files do not exist
  const cheatsheet = await OnboardingManager.ensureOnboardingAssets(mockApp);
  assert.ok(cheatsheet, 'Should return created cheatsheet');
  assert.equal(cheatsheet.path, OnboardingManager.CHEATSHEET_FILE);
  assert.ok(mockFolders.has(OnboardingManager.EXAMPLES_DIR), 'Folder should be created');
  assert.ok(mockVaultFiles.has(OnboardingManager.CHEATSHEET_FILE), 'Cheatsheet should be created');
  assert.ok(mockVaultFiles.has(OnboardingManager.DEMO_NOTE_1), 'Demo 1 should be created');
  assert.ok(mockVaultFiles.has(OnboardingManager.DEMO_NOTE_2), 'Demo 2 should be created');
  assert.ok(mockVaultFiles.has(OnboardingManager.DEMO_NOTE_3), 'Demo 3 should be created');
  assert.ok(mockVaultFiles.has(OnboardingManager.DEMO_NOTE_4), 'Demo 4 should be created');
  assert.ok(mockVaultFiles.has(OnboardingManager.DEMO_NOTE_5), 'Demo 5 should be created');

  // Verify legacy file was cleaned up
  assert.ok(!mockVaultFiles.has('SeeLearn Examples/Пример — Биология клетки.md'), 'Legacy demo note should be cleaned up');

  // Second run: delete cheatsheet and ensure it recreates
  mockVaultFiles.delete(OnboardingManager.CHEATSHEET_FILE);
  const recreated = await OnboardingManager.ensureOnboardingAssets(mockApp);
  assert.ok(recreated, 'Should recreate cheatsheet');
  assert.ok(mockVaultFiles.has(OnboardingManager.CHEATSHEET_FILE), 'Cheatsheet should exist again');
});

test('Onboarding: openCheatsheetNote focuses existing leaf or opens a new tab', async () => {
  const mockVaultFiles = new Map<string, { path: string; extension: string }>();
  const mockFolders = new Set<string>([OnboardingManager.EXAMPLES_DIR]);
  const cheatsheetObj = { path: OnboardingManager.CHEATSHEET_FILE, extension: 'md' };
  mockVaultFiles.set(OnboardingManager.CHEATSHEET_FILE, cheatsheetObj);

  let activeLeafCalledWith: any = null;
  let newLeafOpenedWith: any = null;

  // Scenario A: Leaf already open
  const openLeafMock = {
    view: { file: { path: OnboardingManager.CHEATSHEET_FILE } },
  };

  const mockAppA = {
    vault: {
      getAbstractFileByPath: (p: string) => mockVaultFiles.get(p) || null,
      createFolder: async () => {},
      create: async () => cheatsheetObj,
    },
    workspace: {
      getLeavesOfType: (type: string) => (type === 'markdown' ? [openLeafMock] : []),
      setActiveLeaf: (leaf: any) => {
        activeLeafCalledWith = leaf;
      },
      getLeaf: () => {
        throw new Error('Should not open a new leaf if already present');
      },
    },
  } as unknown as App;

  await OnboardingManager.openCheatsheetNote(mockAppA);
  assert.strictEqual(activeLeafCalledWith, openLeafMock, 'Existing leaf should be focused');

  // Scenario B: Leaf not open
  const mockAppB = {
    vault: {
      getAbstractFileByPath: (p: string) => mockVaultFiles.get(p) || null,
      createFolder: async () => {},
      create: async () => cheatsheetObj,
    },
    workspace: {
      getLeavesOfType: () => [],
      getLeaf: (mode: string) => {
        assert.equal(mode, 'tab');
        return {
          openFile: async (f: any) => {
            newLeafOpenedWith = f;
          },
        };
      },
      setActiveLeaf: (leaf: any) => {
        activeLeafCalledWith = leaf;
      },
    },
  } as unknown as App;

  await OnboardingManager.openCheatsheetNote(mockAppB);
  assert.strictEqual(newLeafOpenedWith?.path, OnboardingManager.CHEATSHEET_FILE, 'New tab must open cheatsheet file');
});
