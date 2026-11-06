import { Flashcard } from './types';
import { fisherYatesShuffle } from './shuffle';

export interface PrepareSessionPoolOptions {
  limit?: number | 'all';
  shuffle?: boolean;
}

/**
 * Pure function to prepare a study session card pool.
 * - Defaults to Fisher-Yates auto-shuffling before slicing to limit N to guarantee
 *   uniform random reservoir sampling.
 * - If shuffle is false (linearSessionOrder), original card order is preserved.
 * - If limit is specified and less than pool size, slices pool to limit.
 */
export function prepareSessionPool(
  cards: readonly Flashcard[],
  options: PrepareSessionPoolOptions = {}
): Flashcard[] {
  const { limit = 'all', shuffle = true } = options;
  let pool = [...cards];

  if (shuffle) {
    pool = fisherYatesShuffle(pool);
  }

  if (typeof limit === 'number' && limit > 0 && limit < pool.length) {
    pool = pool.slice(0, limit);
  }

  return pool;
}
