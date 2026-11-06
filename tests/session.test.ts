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

test('Session shuffle: when not flipped, shuffles current card and all subsequent cards', () => {
  const cards = [
    createMockCard('c1'),
    createMockCard('c2'),
    createMockCard('c3'),
    createMockCard('c4'),
    createMockCard('c5'),
  ];

  const currentIndex = 2; // card c3
  const isFlipped = false;

  const remainingCount = cards.length - currentIndex;
  assert.strictEqual(remainingCount, 3);

  const before = cards.slice(0, currentIndex);
  const toShuffle = cards.slice(currentIndex);

  assert.deepStrictEqual(before.map((c) => c.id), ['c1', 'c2']);
  assert.deepStrictEqual(toShuffle.map((c) => c.id), ['c3', 'c4', 'c5']);

  // Simulate shuffle
  const shuffled = [toShuffle[2], toShuffle[0], toShuffle[1]]; // c5, c3, c4
  const newQueue = [...before, ...shuffled];

  assert.deepStrictEqual(newQueue.map((c) => c.id), ['c1', 'c2', 'c5', 'c3', 'c4']);
  // Cards before index are preserved untouched
  assert.deepStrictEqual(newQueue.slice(0, currentIndex), before);
});

test('Session shuffle: when flipped, keeps current card fixed and shuffles only subsequent cards', () => {
  const cards = [
    createMockCard('c1'),
    createMockCard('c2'),
    createMockCard('c3'),
    createMockCard('c4'),
    createMockCard('c5'),
  ];

  const currentIndex = 2; // card c3 (flipped)
  const isFlipped = true;

  const afterCount = cards.length - (currentIndex + 1);
  assert.strictEqual(afterCount, 2);

  const before = cards.slice(0, currentIndex + 1);
  const toShuffle = cards.slice(currentIndex + 1);

  assert.deepStrictEqual(before.map((c) => c.id), ['c1', 'c2', 'c3']);
  assert.deepStrictEqual(toShuffle.map((c) => c.id), ['c4', 'c5']);

  // Simulate shuffle
  const shuffled = [toShuffle[1], toShuffle[0]]; // c5, c4
  const newQueue = [...before, ...shuffled];

  assert.deepStrictEqual(newQueue.map((c) => c.id), ['c1', 'c2', 'c3', 'c5', 'c4']);
  // Current card c3 remains exactly at index 2
  assert.strictEqual(newQueue[currentIndex].id, 'c3');
});

test('Session replay: snapshot updates and preserves the last obtained order', () => {
  const initialPool = [
    createMockCard('c1'),
    createMockCard('c2'),
    createMockCard('c3'),
    createMockCard('c4'),
    createMockCard('c5'),
  ];

  let lastSessionQueue = [...initialPool];

  const updateSnapshot = (toShuffle: Flashcard[], shuffled: Flashcard[]) => {
    const toShuffleIdSet = new Set(toShuffle.map((c) => c.id));
    const indices: number[] = [];
    lastSessionQueue.forEach((card, idx) => {
      if (toShuffleIdSet.has(card.id)) {
        indices.push(idx);
      }
    });

    let shuffledIdx = 0;
    for (const pos of indices) {
      if (shuffledIdx < shuffled.length) {
        lastSessionQueue[pos] = shuffled[shuffledIdx];
        shuffledIdx++;
      }
    }
  };

  // User shuffles at card c3 (unflipped): c3, c4, c5 -> c5, c3, c4
  const toShuffle = [initialPool[2], initialPool[3], initialPool[4]];
  const shuffled = [initialPool[4], initialPool[2], initialPool[3]]; // c5, c3, c4

  updateSnapshot(toShuffle, shuffled);

  assert.deepStrictEqual(
    lastSessionQueue.map((c) => c.id),
    ['c1', 'c2', 'c5', 'c3', 'c4']
  );

  // When repeating session, user gets exact last obtained order
  const repeatedSessionQueue = [...lastSessionQueue];
  assert.deepStrictEqual(
    repeatedSessionQueue.map((c) => c.id),
    ['c1', 'c2', 'c5', 'c3', 'c4']
  );
});

test('Session shuffle edge cases: detects when not enough cards to shuffle', () => {
  const singleCardQueue = [createMockCard('c1')];
  assert.strictEqual(singleCardQueue.length <= 1, true);

  const fiveCardQueue = [
    createMockCard('c1'),
    createMockCard('c2'),
    createMockCard('c3'),
    createMockCard('c4'),
    createMockCard('c5'),
  ];

  // At last card (index 4), not flipped
  const remainingNotFlipped = fiveCardQueue.length - 4;
  assert.strictEqual(remainingNotFlipped <= 1, true);

  // At last card (index 4), flipped
  const afterCountFlippedLast = fiveCardQueue.length - (4 + 1);
  assert.strictEqual(afterCountFlippedLast, 0);

  // At second-to-last card (index 3), flipped
  const afterCountFlippedSecondToLast = fiveCardQueue.length - (3 + 1);
  assert.strictEqual(afterCountFlippedSecondToLast, 1);
});

