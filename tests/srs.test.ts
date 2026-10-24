import assert from 'node:assert';
import test from 'node:test';
import {
  calculateSRSReview,
  formatIntervalPreview,
  getSRSIntervalPreviews,
  isCardDue,
  isCardLeech,
  isCardNew,
} from '../src/srs';
import { CardProgressRecord } from '../src/types';

test('formatIntervalPreview formats various day counts properly', () => {
  assert.strictEqual(formatIntervalPreview(0), '<1д');
  assert.strictEqual(formatIntervalPreview(1), '1д');
  assert.strictEqual(formatIntervalPreview(7), '7д');
  assert.strictEqual(formatIntervalPreview(45), '2мес');
  assert.strictEqual(formatIntervalPreview(365), '1г');
  assert.strictEqual(formatIntervalPreview(730), '2г');
});

test('calculateSRSReview handles standard SM-2 Good progression', () => {
  const t0 = new Date('2026-01-01T00:00:00Z');

  // Review 1: Good on new card
  const r1 = calculateSRSReview(undefined, 'good', t0);
  assert.strictEqual(r1.repetitions, 1);
  assert.strictEqual(r1.interval, 1);
  assert.strictEqual(r1.easeFactor, 2.5);
  assert.strictEqual(r1.dueDate, '2026-01-02');

  // Review 2: Good
  const cardAfterR1: CardProgressRecord = {
    cardId: 'c1',
    ...r1,
    lastReviewed: t0.toISOString(),
  };
  const r2 = calculateSRSReview(cardAfterR1, 'good', t0);
  assert.strictEqual(r2.repetitions, 2);
  assert.strictEqual(r2.interval, 6);
  assert.strictEqual(r2.easeFactor, 2.5);

  // Review 3: Good (interval = 6 * 2.5 = 15)
  const cardAfterR2: CardProgressRecord = {
    cardId: 'c1',
    ...r2,
    lastReviewed: t0.toISOString(),
  };
  const r3 = calculateSRSReview(cardAfterR2, 'good', t0);
  assert.strictEqual(r3.repetitions, 3);
  assert.strictEqual(r3.interval, 15);
});

test('calculateSRSReview handles Again (lapse) and EF floor', () => {
  const card: CardProgressRecord = {
    cardId: 'c2',
    repetitions: 4,
    interval: 25,
    easeFactor: 1.4, // close to min 1.3
    dueDate: '2026-01-01',
    lastReviewed: '2025-12-05',
    lapses: 1,
  };

  const res = calculateSRSReview(card, 'again');
  assert.strictEqual(res.repetitions, 0);
  assert.strictEqual(res.interval, 1);
  assert.strictEqual(res.lapses, 2);
  // Ease factor was 1.4 - 0.2 = 1.2, but should be bounded at 1.3!
  assert.strictEqual(res.easeFactor, 1.3);
});

test('calculateSRSReview handles Easy bonus and Hard penalty', () => {
  // Easy on new card
  const easyNew = calculateSRSReview(undefined, 'easy');
  assert.strictEqual(easyNew.repetitions, 1);
  assert.strictEqual(easyNew.interval, 4);
  assert.strictEqual(easyNew.easeFactor, 2.65); // 2.5 + 0.15

  // Hard on new card
  const hardNew = calculateSRSReview(undefined, 'hard');
  assert.strictEqual(hardNew.repetitions, 1);
  assert.strictEqual(hardNew.interval, 1);
  assert.strictEqual(hardNew.easeFactor, 2.35); // 2.5 - 0.15
});

test('getSRSIntervalPreviews generates preview labels for all 4 ratings', () => {
  const previews = getSRSIntervalPreviews(undefined);
  assert.strictEqual(previews.again, '1д');
  assert.strictEqual(previews.hard, '1д');
  assert.strictEqual(previews.good, '1д');
  assert.strictEqual(previews.easy, '4д');
});

test('isCardDue and isCardNew accurately reflect card state', () => {
  assert.strictEqual(isCardNew(undefined), true);
  assert.strictEqual(
    isCardNew({
      cardId: 'c',
      repetitions: 0,
      interval: 0,
      easeFactor: 2.5,
      dueDate: '2026-01-01',
      lastReviewed: '',
      lapses: 0,
    }),
    true
  );

  const dueCard: CardProgressRecord = {
    cardId: 'c',
    repetitions: 2,
    interval: 6,
    easeFactor: 2.5,
    dueDate: '2026-01-01',
    lastReviewed: '2025-12-25',
    lapses: 0,
  };

  assert.strictEqual(isCardDue(dueCard, '2026-01-01'), true);
  assert.strictEqual(isCardDue(dueCard, '2026-01-05'), true); // Overdue
  assert.strictEqual(isCardDue(dueCard, '2025-12-31'), false); // Not due yet
});

test('isCardLeech accurately flags cards exceeding lapse threshold', () => {
  assert.strictEqual(isCardLeech(undefined), false);

  const normalCard: CardProgressRecord = {
    cardId: 'c1',
    repetitions: 3,
    interval: 10,
    easeFactor: 2.3,
    dueDate: '2026-02-01',
    lastReviewed: '2026-01-20',
    lapses: 2,
  };
  assert.strictEqual(isCardLeech(normalCard, 4), false);

  const leechCard: CardProgressRecord = {
    ...normalCard,
    lapses: 4,
  };
  assert.strictEqual(isCardLeech(leechCard, 4), true);
  assert.strictEqual(isCardLeech(leechCard, 5), false);
});

