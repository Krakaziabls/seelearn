import assert from 'node:assert';
import test from 'node:test';
import { prepareSessionPool } from '../src/session';
import { Flashcard } from '../src/types';

function createMockCard(id: string): Flashcard {
  return {
    id,
    filePath: 'notes/test.md',
    fileName: 'test.md',
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

test('prepareSessionPool: returns all cards if limit is "all" or omitted', () => {
  const cards = [createMockCard('1'), createMockCard('2'), createMockCard('3')];
  const pool = prepareSessionPool(cards, { limit: 'all', shuffle: false });

  assert.strictEqual(pool.length, 3);
  assert.deepStrictEqual(
    pool.map((c) => c.id),
    ['1', '2', '3']
  );
});

test('prepareSessionPool: linear order slices without shuffling when shuffle: false', () => {
  const cards = [
    createMockCard('c1'),
    createMockCard('c2'),
    createMockCard('c3'),
    createMockCard('c4'),
    createMockCard('c5'),
  ];
  const pool = prepareSessionPool(cards, { limit: 3, shuffle: false });

  assert.strictEqual(pool.length, 3);
  assert.deepStrictEqual(
    pool.map((c) => c.id),
    ['c1', 'c2', 'c3']
  );
});

test('prepareSessionPool: default auto-shuffle produces a permutation', () => {
  const cards = Array.from({ length: 20 }, (_, i) => createMockCard(`c${i}`));
  const pool = prepareSessionPool(cards, { limit: 'all' });

  assert.strictEqual(pool.length, 20);
  // Verify all original cards are present
  const originalIds = new Set(cards.map((c) => c.id));
  const poolIds = new Set(pool.map((c) => c.id));
  assert.strictEqual(poolIds.size, 20);
  assert.deepStrictEqual(poolIds, originalIds);
});

test('prepareSessionPool: slices pool to requested limit when shuffle: true', () => {
  const cards = Array.from({ length: 50 }, (_, i) => createMockCard(`c${i}`));
  const pool = prepareSessionPool(cards, { limit: 15, shuffle: true });

  assert.strictEqual(pool.length, 15);
  // Every card in pool must come from original cards
  const originalIds = new Set(cards.map((c) => c.id));
  for (const card of pool) {
    assert.strictEqual(originalIds.has(card.id), true);
  }
  // Ensure no duplicate cards
  const uniqueIds = new Set(pool.map((c) => c.id));
  assert.strictEqual(uniqueIds.size, 15);
});

test('prepareSessionPool: pool smaller than limit returns entire pool without errors', () => {
  const cards = [createMockCard('1'), createMockCard('2'), createMockCard('3')];
  const pool = prepareSessionPool(cards, { limit: 10, shuffle: false });

  assert.strictEqual(pool.length, 3);
  assert.deepStrictEqual(
    pool.map((c) => c.id),
    ['1', '2', '3']
  );
});

test('prepareSessionPool: does not mutate the original input array', () => {
  const cards = [createMockCard('1'), createMockCard('2'), createMockCard('3')];
  const copy = [...cards];
  prepareSessionPool(cards, { limit: 2, shuffle: true });

  assert.strictEqual(cards.length, 3);
  assert.deepStrictEqual(
    cards.map((c) => c.id),
    copy.map((c) => c.id)
  );
});
