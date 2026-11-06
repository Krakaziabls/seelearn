import { CardProgressRecord, ScheduleContext } from './types';

export type { ScheduleContext };

export type SRSRating = 'again' | 'hard' | 'good' | 'easy';

export interface SRSReviewResult {
  repetitions: number;
  interval: number; // in days
  easeFactor: number;
  dueDate: string; // YYYY-MM-DD
  lapses: number;
}

/**
 * 32-bit FNV-1a hash for deterministic tie-breaking and fuzz distribution.
 */
function hashSeed(seed: string | number, reps: number): number {
  const str = `${seed}:${reps}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
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
 * using a modernized SuperMemo-2 (SM-2) algorithm with stability damping,
 * sublinear overdue scaling, 365-day horizon ceiling, and load-aware calendar balancing.
 */
export function calculateSRSReview(
  record: CardProgressRecord | undefined,
  rating: SRSRating,
  today = new Date(),
  context?: ScheduleContext
): SRSReviewResult {
  // 1. Ease Factor bounds: strict [1.3, 2.5]
  const currentEase = Math.min(2.5, Math.max(1.3, record?.easeFactor ?? 2.5));
  const currentReps = record?.repetitions ?? 0;
  const currentInterval = record?.interval ?? 0;
  const currentLapses = record?.lapses ?? 0;

  // 2. Sublinear overdue scaling
  let elapsedDays = currentInterval;
  if (record?.lastReviewed) {
    const lastDate = new Date(record.lastReviewed);
    const diffMs = today.getTime() - lastDate.getTime();
    if (!isNaN(diffMs)) {
      elapsedDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
    }
  }

  const isOverdue = elapsedDays > currentInterval && currentInterval > 0;
  const I_eff = isOverdue
    ? currentInterval + Math.sqrt(elapsedDays - currentInterval)
    : Math.max(1, currentInterval);

  // 3. Stability Damping Factor D and effective Good multiplier M_good
  const D = 1 / (Math.pow(1 + I_eff / 90, 0.35) * (1 + 0.08 * Math.min(currentLapses, 5)));
  const M_good = 1 + (currentEase - 1) * D;

  let newReps = currentReps;
  let newEase = currentEase;
  let newLapses = currentLapses;
  let I_raw = 1;

  // 4. Raw rating interval formulas
  switch (rating) {
    case 'again': {
      newReps = 0;
      newLapses += 1;
      newEase = Math.max(1.3, currentEase - 0.2);
      if (currentInterval >= 10) {
        I_raw = Math.min(7, Math.max(1, Math.round(currentInterval * 0.15)));
      } else {
        I_raw = 1;
      }
      break;
    }

    case 'hard': {
      newReps += 1;
      newEase = Math.max(1.3, currentEase - 0.15);
      const hardDamp = 1 - 0.04 * Math.min(currentLapses, 5);
      I_raw = Math.max(currentInterval + 1, Math.round(I_eff * 1.2 * hardDamp));
      break;
    }

    case 'good': {
      newReps += 1;
      newEase = currentEase; // Preserved within [1.3, 2.5]
      if (newReps === 1) {
        I_raw = 1;
      } else if (newReps === 2) {
        I_raw = 4;
      } else {
        I_raw = Math.round(I_eff * M_good);
      }
      break;
    }

    case 'easy': {
      newReps += 1;
      newEase = Math.min(2.5, currentEase + 0.15);
      if (newReps === 1) {
        I_raw = 4;
      } else if (newReps === 2) {
        I_raw = 8;
      } else {
        I_raw = Math.round(I_eff * M_good * 1.25);
      }
      break;
    }
  }

  // 5. Compression and 365-day ceiling
  const MAX_INTERVAL = 365;
  let I_target = I_raw;
  if (I_raw > 180) {
    I_target = Math.min(MAX_INTERVAL, Math.round((MAX_INTERVAL * I_raw) / (MAX_INTERVAL + I_raw * 0.35)));
  } else {
    I_target = Math.min(MAX_INTERVAL, I_raw);
  }

  // 6. Load-aware calendar balancing & dispersion window
  let finalInterval = I_target;
  if (I_target >= 3) {
    const delta = Math.max(1, Math.round(I_target * 0.18));
    const I_min = Math.max(2, I_target - delta);
    const I_max = Math.min(MAX_INTERVAL, I_target + delta);

    const dueCounts = context?.dueCountsByDay;
    const hasDueCounts = dueCounts && Object.keys(dueCounts).length > 0;
    const seed = context?.seed ?? record?.cardId ?? 0;
    const hash = hashSeed(seed, newReps);

    if (hasDueCounts) {
      let minScore = Infinity;
      const candidates: number[] = [];

      for (let d = I_min; d <= I_max; d++) {
        const load = dueCounts[d] ?? 0;
        const distPenalty = 0.35 * Math.abs(d - I_target);
        const score = load + distPenalty;

        if (score < minScore - 1e-6) {
          minScore = score;
          candidates.length = 0;
          candidates.push(d);
        } else if (Math.abs(score - minScore) <= 1e-6) {
          candidates.push(d);
        }
      }

      candidates.sort((a, b) => a - b);
      finalInterval = candidates[hash % candidates.length];
    } else {
      // In absence of dueCountsByDay, distribute deterministically across [I_min, I_max]
      const windowSize = I_max - I_min + 1;
      finalInterval = I_min + (hash % windowSize);
    }
  }

  // Compute ISO date string for next review
  const nextDueDate = new Date(today);
  nextDueDate.setDate(nextDueDate.getDate() + finalInterval);
  const dueDateStr = nextDueDate.toISOString().split('T')[0];

  return {
    repetitions: newReps,
    interval: finalInterval,
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
  today = new Date(),
  context?: ScheduleContext
): Record<SRSRating, string> {
  const again = calculateSRSReview(record, 'again', today, context);
  const hard = calculateSRSReview(record, 'hard', today, context);
  const good = calculateSRSReview(record, 'good', today, context);
  const easy = calculateSRSReview(record, 'easy', today, context);

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
