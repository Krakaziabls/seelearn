import { Flashcard } from './types';

/**
 * Pure Fisher-Yates (Knuth) shuffle algorithm.
 * Guarantees uniform random distribution in O(n) time.
 * Returns a new shuffled array without mutating the input.
 */
export function fisherYatesShuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }
  return result;
}

/**
 * Topic / Source Interleaving algorithm.
 * Groups cards by their primary category (primary tag or source file)
 * and distributes them in a round-robin order to prevent consecutive
 * cards belonging to the same topic/file.
 */
export function interleaveCards(cards: readonly Flashcard[]): Flashcard[] {
  if (cards.length <= 2) {
    return [...cards];
  }

  // 1. Group cards by primary topic (or file name if no tags)
  const buckets = new Map<string, Flashcard[]>();
  for (const card of cards) {
    const key = card.tags.length > 0 ? card.tags[0] : card.fileName;
    let list = buckets.get(key);
    if (!list) {
      list = [];
      buckets.set(key, list);
    }
    list.push(card);
  }

  // 2. Shuffle each bucket internally with Fisher-Yates
  const shuffledBuckets: Flashcard[][] = [];
  for (const list of buckets.values()) {
    shuffledBuckets.push(fisherYatesShuffle(list));
  }

  // 3. Sort buckets by size descending so largest buckets distribute smoothly
  shuffledBuckets.sort((a, b) => b.length - a.length);

  // 4. Interleave items in round-robin fashion
  const result: Flashcard[] = [];
  let itemsRemaining = true;
  let cycle = 0;

  while (itemsRemaining) {
    itemsRemaining = false;
    for (const bucket of shuffledBuckets) {
      if (bucket.length > 0) {
        result.push(bucket.shift()!);
        itemsRemaining = true;
      }
    }
    cycle++;
  }

  return result;
}
