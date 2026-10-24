import { CardProgressRecord } from './types';

export type SRSRating = 'again' | 'hard' | 'good' | 'easy';

export interface SRSReviewResult {
  repetitions: number;
  interval: number; // in days
  easeFactor: number;
  dueDate: string; // YYYY-MM-DD
  lapses: number;
}

/**
 * Formats a day count into a friendly interval label.
 * Examples: 0 -> "<1д", 1 -> "1д", 7 -> "7д", 30 -> "1мес", 365 -> "1г"
 */
export function formatIntervalPreview(days: number): string {
  if (days <= 0) return '<1д';
  if (days === 1) return '1д';
  if (days < 30) return `${days}д`;
  if (days < 365) {
    const months = Math.round(days / 30);
    return `${months}мес`;
  }
  const years = (days / 365).toFixed(1).replace('.0', '');
  return `${years}г`;
}

/**
 * Calculates next interval, repetitions, ease factor, and due date
 * using a modernized SuperMemo-2 (SM-2) algorithm.
 *
 * Ratings:
 * - 'again' (q=2): Complete lapse. Resets repetitions to 0, interval to 1 day,
 *   increments lapses, decreases ease factor by 0.2.
 * - 'hard'  (q=3): Successful recall with difficulty. Interval grows modestly (1.2x),
 *   decreases ease factor slightly by 0.15.
 * - 'good'  (q=4): Normal successful recall. Follows standard SM-2 intervals (1d -> 6d -> I*EF).
 *   Ease factor remains unchanged.
 * - 'easy'  (q=5): Quick and confident recall. Bonus interval (1.3x),
 *   increases ease factor by 0.15.
 */
export function calculateSRSReview(
  record: CardProgressRecord | undefined,
  rating: SRSRating,
  today = new Date()
): SRSReviewResult {
  const currentEase = record?.easeFactor ?? 2.5;
  const currentReps = record?.repetitions ?? 0;
  const currentInterval = record?.interval ?? 0;
  const currentLapses = record?.lapses ?? 0;

  let newReps = currentReps;
  let newInterval = currentInterval;
  let newEase = currentEase;
  let newLapses = currentLapses;

  switch (rating) {
    case 'again': {
      newReps = 0;
      newInterval = 1;
      newLapses += 1;
      newEase = Math.max(1.3, currentEase - 0.2);
      break;
    }

    case 'hard': {
      newReps += 1;
      if (newReps === 1) {
        newInterval = 1;
      } else if (newReps === 2) {
        newInterval = 3;
      } else {
        newInterval = Math.max(currentInterval + 1, Math.round(currentInterval * 1.2));
      }
      newEase = Math.max(1.3, currentEase - 0.15);
      break;
    }

    case 'good': {
      newReps += 1;
      if (newReps === 1) {
        newInterval = 1;
      } else if (newReps === 2) {
        newInterval = 6;
      } else {
        newInterval = Math.max(currentInterval + 1, Math.round(currentInterval * currentEase));
      }
      // Standard SM-2 formula: q=4 leaves EF unchanged
      break;
    }

    case 'easy': {
      newReps += 1;
      if (newReps === 1) {
        newInterval = 4;
      } else if (newReps === 2) {
        newInterval = 10;
      } else {
        newInterval = Math.max(
          currentInterval + 2,
          Math.round(currentInterval * currentEase * 1.3)
        );
      }
      newEase = Math.min(3.0, currentEase + 0.15);
      break;
    }
  }

  // Compute ISO date string for next review
  const nextDueDate = new Date(today);
  nextDueDate.setDate(nextDueDate.getDate() + newInterval);
  const dueDateStr = nextDueDate.toISOString().split('T')[0];

  return {
    repetitions: newReps,
    interval: newInterval,
    easeFactor: Number(newEase.toFixed(2)),
    dueDate: dueDateStr,
    lapses: newLapses,
  };
}

/**
 * Computes preview labels for each rating button before the user clicks.
 */
export function getSRSIntervalPreviews(
  record: CardProgressRecord | undefined,
  today = new Date()
): Record<SRSRating, string> {
  const again = calculateSRSReview(record, 'again', today);
  const hard = calculateSRSReview(record, 'hard', today);
  const good = calculateSRSReview(record, 'good', today);
  const easy = calculateSRSReview(record, 'easy', today);

  return {
    again: formatIntervalPreview(again.interval),
    hard: formatIntervalPreview(hard.interval),
    good: formatIntervalPreview(good.interval),
    easy: formatIntervalPreview(easy.interval),
  };
}

/**
 * Checks whether a card is due for review today or overdue.
 */
export function isCardDue(record: CardProgressRecord | undefined, todayStr?: string): boolean {
  if (!record || record.repetitions === 0) {
    return false; // New or unreviewed cards are in the 'new' queue
  }
  const targetDate = todayStr || new Date().toISOString().split('T')[0];
  return record.dueDate <= targetDate;
}

/**
 * Checks whether a card is brand new (never reviewed or 0 repetitions).
 */
export function isCardNew(record: CardProgressRecord | undefined): boolean {
  return !record || record.repetitions === 0;
}

/**
 * Checks whether a card is a "leech" (has exceeded the lapse threshold).
 */
export function isCardLeech(record: CardProgressRecord | undefined, threshold = 4): boolean {
  if (!record) return false;
  return (record.lapses || 0) >= threshold;
}

