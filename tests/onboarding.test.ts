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

test('Onboarding: Demo Note 1 (Biology) contains valid parseable cards', () => {
  const content = OnboardingManager.getDemoNote1Content();
  assert.ok(content.includes('tags:\n  - seelearn'), 'Demo 1 must have seelearn tag');
  assert.ok(content.includes('topics:'), 'Demo 1 must define topics');

  const { cards, warnings } = parseCardsFromMarkdown(
    OnboardingManager.DEMO_NOTE_1,
    'Пример — Биология клетки.md',
    content,
    ['Биология', 'Цитология']
  );

  assert.equal(warnings.length, 0, `Expected 0 warnings, got: ${JSON.stringify(warnings)}`);
  assert.ok(cards.length >= 3, `Expected at least 3 cards, got ${cards.length}`);

  // Card 1: Mitochondria regular
  assert.match(cards[0].front, /митохондрий/i);
  assert.match(cards[0].back, /АТФ/i);

  // Card 2: Cloze DNA
  assert.ok(cards[1].isCloze, 'Card 2 should be cloze');
  assert.match(cards[1].front, /дезоксирибонуклеиновая кислота/i, 'Hint should appear in front');
  assert.match(cards[1].back, /ДНК/i, 'Answer should appear in back');

  // Card 3: Highlight Ribosomes
  assert.ok(cards[2].isCloze, 'Card 3 should be cloze from highlight');
  assert.match(cards[2].back, /трансляцию/i);
});

test('Onboarding: Demo Note 2 (Capitals & Facts) contains valid parseable cards', () => {
  const content = OnboardingManager.getDemoNote2Content();
  assert.ok(content.includes('tags:\n  - seelearn'), 'Demo 2 must have seelearn tag');

  const { cards, warnings } = parseCardsFromMarkdown(
    OnboardingManager.DEMO_NOTE_2,
    'Пример — Столицы и Факты.md',
    content,
    ['География', 'Страны']
  );

  assert.equal(warnings.length, 0, `Expected 0 warnings, got: ${JSON.stringify(warnings)}`);
  // Multi-cloze splits into 2 cards + 1 Everest + 1 Amazon = 4 cards
  assert.equal(cards.length, 4, `Expected 4 cards, got ${cards.length}`);

  // Verify multi-cloze split
  const clozeCards = cards.filter((c) => c.isCloze);
  assert.equal(clozeCards.length, 2, 'Multi-cloze should produce 2 cards');
  assert.ok(clozeCards.some((c) => c.clozeIndex === 1 && c.back.includes('Осло')));
  assert.ok(clozeCards.some((c) => c.clozeIndex === 2 && c.back.includes('Хельсинки')));

  // Verify explicit ID card
  const everestCard = cards.find((c) => c.customId === 'geo-everest');
  assert.ok(everestCard, 'Everest card should retain customId geo-everest');

  // Verify privacy %%%% card
  const amazonCard = cards.find((c) => c.front.includes('полноводной'));
  assert.ok(amazonCard, 'Amazon card wrapped in %%%% should be parsed successfully');
});

test('Onboarding: ensureOnboardingAssets creates missing assets and handles recreation', async () => {
  const mockVaultFiles = new Map<string, { path: string; extension: string; content?: string }>();
  const mockFolders = new Set<string>();

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
