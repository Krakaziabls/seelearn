import assert from 'node:assert';
import test from 'node:test';
import { StorageManager } from '../src/storage';
import { Plugin } from 'obsidian';

test('StorageManager handles migration from legacy settings', async () => {
  let savedData: any = null;
  const mockPlugin = {
    loadData: async () => ({
      triggerProperty: 'custom-tag',
      triggerValue: 'my-deck',
      revealMode: 'replace',
    }),
    saveData: async (data: any) => {
      savedData = data;
    },
  } as unknown as Plugin;

  const storage = new StorageManager(mockPlugin);
  await storage.load();

  assert.strictEqual(storage.data.version, 1);
  assert.strictEqual(storage.settings.triggerProperty, 'custom-tag');
  assert.strictEqual(storage.settings.triggerValue, 'my-deck');
  assert.deepStrictEqual(storage.data.progress, {});
});

test('StorageManager records know and repeat reviews properly', async () => {
  const mockPlugin = {
    loadData: async () => null,
    saveData: async () => {},
  } as unknown as Plugin;

  const storage = new StorageManager(mockPlugin);
  await storage.load();

  // 1st review: know
  const r1 = storage.recordReview('card-abc', 'know');
  assert.strictEqual(r1.repetitions, 1);
  assert.strictEqual(r1.interval, 1);
  assert.strictEqual(r1.lapses, 0);

  // 2nd review: know
  const r2 = storage.recordReview('card-abc', 'know');
  assert.strictEqual(r2.repetitions, 2);
  assert.strictEqual(r2.interval, 6);

  // 3rd review: repeat (lapse)
  const r3 = storage.recordReview('card-abc', 'repeat');
  assert.strictEqual(r3.repetitions, 0);
  assert.strictEqual(r3.interval, 1);
  assert.strictEqual(r3.lapses, 1);

  // Stats
  const stats = storage.getStats();
  assert.strictEqual(stats.totalTracked, 1);
  assert.strictEqual(stats.totalLapses, 1);
  assert.strictEqual(stats.reviewedToday, 1);
});

test('StorageManager migrates card IDs on file rename and prunes orphaned cards', async () => {
  let savedData: any = null;
  const mockPlugin = {
    loadData: async () => null,
    saveData: async (data: any) => {
      savedData = data;
    },
  } as unknown as Plugin;

  const storage = new StorageManager(mockPlugin);
  await storage.load();

  storage.recordReview('old-hash-1', 'good');
  storage.recordReview('old-hash-2', 'good');
  assert.ok(storage.getProgress('old-hash-1'));
  assert.ok(storage.getProgress('old-hash-2'));

  // Test migration
  const idMap = new Map([
    ['old-hash-1', 'new-hash-1'],
    ['old-hash-2', 'new-hash-2'],
  ]);
  storage.migrateCardIds(idMap);

  assert.strictEqual(storage.getProgress('old-hash-1'), undefined);
  assert.ok(storage.getProgress('new-hash-1'));
  assert.strictEqual(storage.getProgress('new-hash-1')?.repetitions, 1);

  // Test flush
  await storage.flush();
  assert.ok(savedData);
  assert.ok(savedData.progress['new-hash-1']);

  // Test pruning orphaned cards
  const validIds = new Set(['new-hash-1']);
  const pruned = storage.pruneOrphanedCards(validIds);
  assert.strictEqual(pruned, 1); // new-hash-2 pruned
  assert.ok(storage.getProgress('new-hash-1'));
  assert.strictEqual(storage.getProgress('new-hash-2'), undefined);
});

test('StorageManager calculates study streaks and daily activity', async () => {
  const mockPlugin = {
    loadData: async () => null,
    saveData: async () => {},
  } as unknown as Plugin;

  const storage = new StorageManager(mockPlugin);
  await storage.load();

  const today = new Date();
  const dToday = today.toISOString().split('T')[0];

  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  const dYest = yest.toISOString().split('T')[0];

  const dayBefore = new Date(today);
  dayBefore.setDate(dayBefore.getDate() - 2);
  const dDayBefore = dayBefore.toISOString().split('T')[0];

  storage.data.progress['c1'] = {
    cardId: 'c1',
    repetitions: 1,
    interval: 1,
    easeFactor: 2.5,
    dueDate: dToday,
    lastReviewed: `${dDayBefore}T10:00:00.000Z`,
    lapses: 0,
    history: [
      { date: `${dDayBefore}T10:00:00.000Z`, rating: 'good' },
      { date: `${dYest}T10:00:00.000Z`, rating: 'good' },
      { date: `${dToday}T10:00:00.000Z`, rating: 'easy' },
    ],
  };

  const streak = storage.getStudyStreakStats();
  assert.strictEqual(streak.currentStreak, 3);
  assert.strictEqual(streak.bestStreak, 3);
  assert.strictEqual(streak.totalReviews, 3);
  assert.strictEqual(streak.reviewedToday, 1);
  assert.strictEqual(streak.dailyActivity[dToday], 1);
  assert.strictEqual(streak.dailyActivity[dYest], 1);
  assert.strictEqual(streak.dailyActivity[dDayBefore], 1);
});


