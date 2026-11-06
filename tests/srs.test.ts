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

test('calculateSRSReview handles standard Good progression with damping', () => {
  const t0 = new Date('2026-01-01T00:00:00Z');

  // Review 1: Good on new card -> 1 day
  const r1 = calculateSRSReview(undefined, 'good', t0);
  assert.strictEqual(r1.repetitions, 1);
  assert.strictEqual(r1.interval, 1);
  assert.strictEqual(r1.easeFactor, 2.5);
  assert.strictEqual(r1.dueDate, '2026-01-02');

  // Review 2: Good -> raw 4 days, window [3, 5]
  const cardAfterR1: CardProgressRecord = {
    cardId: 'c1',
    ...r1,
    lastReviewed: t0.toISOString(),
  };
  const r2 = calculateSRSReview(cardAfterR1, 'good', t0);
  assert.strictEqual(r2.repetitions, 2);
  assert.strictEqual(r2.interval >= 3 && r2.interval <= 5, true);
  assert.strictEqual(r2.easeFactor, 2.5);

  // Review 3: Good -> grows past review 2
  const cardAfterR2: CardProgressRecord = {
    cardId: 'c1',
    ...r2,
    lastReviewed: t0.toISOString(),
  };
  const r3 = calculateSRSReview(cardAfterR2, 'good', t0);
  assert.strictEqual(r3.repetitions, 3);
  assert.strictEqual(r3.interval > r2.interval, true);
});

test('calculateSRSReview handles Again (lapse) and recovery step', () => {
  // Mature card (interval >= 10): recovery step Math.min(7, Math.max(1, Math.round(25 * 0.15))) = 4
  const matureCard: CardProgressRecord = {
    cardId: 'c2',
    repetitions: 4,
    interval: 25,
    easeFactor: 1.4, // close to min 1.3
    dueDate: '2026-01-01',
    lastReviewed: '2025-12-05',
    lapses: 1,
  };

  const res = calculateSRSReview(matureCard, 'again');
  assert.strictEqual(res.repetitions, 0);
  assert.strictEqual(res.lapses, 2);
  // Ease factor was 1.4 - 0.2 = 1.2, but should be bounded at 1.3!
  assert.strictEqual(res.easeFactor, 1.3);
  // Recovery step: 4 in window [3, 5]
  assert.strictEqual(res.interval >= 3 && res.interval <= 5, true);

  // Young card (interval < 10): resets to 1 day
  const youngCard: CardProgressRecord = {
    cardId: 'c3',
    repetitions: 2,
    interval: 6,
    easeFactor: 2.5,
    dueDate: '2026-01-01',
    lastReviewed: '2025-12-25',
    lapses: 0,
  };
  const resYoung = calculateSRSReview(youngCard, 'again');
  assert.strictEqual(resYoung.repetitions, 0);
  assert.strictEqual(resYoung.interval, 1);
  assert.strictEqual(resYoung.lapses, 1);
});

test('calculateSRSReview handles Easy bonus and Hard penalty with strict EF bounds', () => {
  // Easy on new card: raw 4 days, window [3, 5], EF capped at 2.5
  const easyNew = calculateSRSReview(undefined, 'easy');
  assert.strictEqual(easyNew.repetitions, 1);
  assert.strictEqual(easyNew.interval >= 3 && easyNew.interval <= 5, true);
  assert.strictEqual(easyNew.easeFactor, 2.5); // Capped at 2.5, not 2.65!

  // Hard on new card: 1 day, EF 2.5 - 0.15 = 2.35
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
  assert.strictEqual(previews.easy.includes('д'), true);
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

test('Horizon Test: 20 consecutive Good or Easy ratings never exceed 365 days and grow sublinearly', () => {
  const t0 = new Date('2026-01-01T00:00:00Z');

  // Test 20 Good reviews
  let currentGood: CardProgressRecord | undefined = undefined;
  const goodIntervals: number[] = [];
  for (let i = 0; i < 20; i++) {
    const res = calculateSRSReview(currentGood, 'good', t0);
    assert.strictEqual(res.interval <= 365, true, `Good interval ${res.interval} at step ${i} exceeded 365`);
    goodIntervals.push(res.interval);
    currentGood = {
      cardId: 'horizon-good',
      ...res,
      lastReviewed: t0.toISOString(),
    };
  }

  // Test 20 Easy reviews
  let currentEasy: CardProgressRecord | undefined = undefined;
  const easyIntervals: number[] = [];
  for (let i = 0; i < 20; i++) {
    const res = calculateSRSReview(currentEasy, 'easy', t0);
    assert.strictEqual(res.interval <= 365, true, `Easy interval ${res.interval} at step ${i} exceeded 365`);
    easyIntervals.push(res.interval);
    currentEasy = {
      cardId: 'horizon-easy',
      ...res,
      lastReviewed: t0.toISOString(),
    };
  }

  // Sublinear growth past 90 days:
  // Growth rate (I_{n+1} - I_n) / I_n should be lower for intervals > 90 than for intervals < 30
  const earlyGrowth = (goodIntervals[4] - goodIntervals[3]) / goodIntervals[3];
  const lateIndex = goodIntervals.findIndex((iv) => iv > 90);
  if (lateIndex !== -1 && lateIndex + 1 < goodIntervals.length) {
    const lateGrowth = (goodIntervals[lateIndex + 1] - goodIntervals[lateIndex]) / goodIntervals[lateIndex];
    assert.strictEqual(lateGrowth < earlyGrowth, true);
  }
});

test('Cohort De-clustering Test: 200 new cards spread across calendar days over 3 cycles', () => {
  const CARD_COUNT = 200;
  const cards: CardProgressRecord[] = [];
  const t0 = new Date('2026-01-01T00:00:00Z');

  // Cycle 1: 200 new cards reviewed Good on day 0 -> all interval 1 (day 1)
  for (let i = 0; i < CARD_COUNT; i++) {
    const res = calculateSRSReview(undefined, 'good', t0);
    cards.push({
      cardId: `cohort-${i}`,
      ...res,
      lastReviewed: t0.toISOString(),
    });
  }

  // Cycle 2: on Day 1, all 200 cards are reviewed Good during an active study session
  const t1 = new Date('2026-01-02T00:00:00Z');
  const dueCountsCycle2: Record<number, number> = {};
  for (let i = 0; i < CARD_COUNT; i++) {
    const res = calculateSRSReview(cards[i], 'good', t1, {
      dueCountsByDay: dueCountsCycle2,
      seed: cards[i].cardId,
    });
    // In-session live increment
    dueCountsCycle2[res.interval] = (dueCountsCycle2[res.interval] ?? 0) + 1;
    cards[i] = {
      ...cards[i],
      ...res,
      lastReviewed: t1.toISOString(),
    };
  }

  const cycle2Days = Object.keys(dueCountsCycle2).map(Number);
  const cycle2Counts = Object.values(dueCountsCycle2);
  const cycle2Max = Math.max(...cycle2Counts);

  // Requirement: spreads across >= 3 distinct days, peak day <= 70 cards
  assert.strictEqual(cycle2Days.length >= 3, true, `Cycle 2 days count: ${cycle2Days.length}`);
  assert.strictEqual(cycle2Max <= 70, true, `Cycle 2 max load: ${cycle2Max}`);

  // Cycle 3: simulate third review as cards mature on their scheduled due dates
  const dueDatesCycle3: Record<string, number> = {};
  for (let i = 0; i < CARD_COUNT; i++) {
    const cardDueDate = new Date(cards[i].dueDate);
    const res = calculateSRSReview(cards[i], 'good', cardDueDate, {
      seed: cards[i].cardId,
    });
    dueDatesCycle3[res.dueDate] = (dueDatesCycle3[res.dueDate] ?? 0) + 1;
  }

  const cycle3Dates = Object.keys(dueDatesCycle3);
  const cycle3Counts = Object.values(dueDatesCycle3);
  const cycle3Max = Math.max(...cycle3Counts);

  // Requirement: cycle 3 spreads across >= 7 days, peak load reduced by > 4x (< 50 cards)
  assert.strictEqual(cycle3Dates.length >= 7, true, `Cycle 3 distinct dates count: ${cycle3Dates.length}`);
  assert.strictEqual(cycle3Max < 50, true, `Cycle 3 peak load: ${cycle3Max}`);
});

test('Overdue Scaling Test: 49 days overdue on 10-day interval scales sublinearly', () => {
  const lastReviewedDate = new Date('2026-01-01T00:00:00Z');
  const reviewDate = new Date('2026-03-01T00:00:00Z'); // 59 elapsed days (49 days overdue)

  const overdueCard: CardProgressRecord = {
    cardId: 'overdue-c1',
    repetitions: 3,
    interval: 10,
    easeFactor: 2.5,
    dueDate: '2026-01-11',
    lastReviewed: lastReviewedDate.toISOString(),
    lapses: 0,
  };

  const res = calculateSRSReview(overdueCard, 'good', reviewDate);
  // I_eff = 10 + sqrt(49) = 17 days
  // With Good rating, interval is bounded between 30 and 55 days
  assert.strictEqual(res.interval >= 30 && res.interval <= 55, true, `Interval was ${res.interval}`);
  assert.strictEqual(res.repetitions, 4);
});

test('Deterministic Tie-Breaker Test: reproducible interval dispersion without dueCountsByDay', () => {
  const matureCard: CardProgressRecord = {
    cardId: 'tie-card',
    repetitions: 3,
    interval: 10,
    easeFactor: 2.5,
    dueDate: '2026-01-11',
    lastReviewed: '2026-01-01',
    lapses: 0,
  };

  // Repeated calls with same seed produce identical interval
  const res1 = calculateSRSReview(matureCard, 'good', new Date('2026-01-11'), { seed: 'same-seed' });
  const res2 = calculateSRSReview(matureCard, 'good', new Date('2026-01-11'), { seed: 'same-seed' });
  assert.strictEqual(res1.interval, res2.interval);

  // Different seeds produce distributed intervals within window
  const intervals = new Set<number>();
  for (let i = 0; i < 20; i++) {
    const res = calculateSRSReview(matureCard, 'good', new Date('2026-01-11'), { seed: `seed-${i}` });
    intervals.add(res.interval);
  }
  // Across 20 distinct seeds, multiple distinct intervals within the window are hit
  assert.strictEqual(intervals.size >= 3, true, `Distinct intervals hit: ${intervals.size}`);
});
