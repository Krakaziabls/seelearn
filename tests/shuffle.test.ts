import assert from 'node:assert';
import test from 'node:test';
import { fisherYatesShuffle, interleaveCards } from '../src/shuffle';
import { Flashcard } from '../src/types';

test('fisherYatesShuffle produces a permutation without modifying original array', () => {
  const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const shuffled = fisherYatesShuffle(original);

  assert.strictEqual(shuffled.length, original.length);
  assert.deepStrictEqual([...shuffled].sort((a, b) => a - b), original);
  // Original is not mutated
  assert.deepStrictEqual(original, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('interleaveCards distributes cards across topics', () => {
  const makeCard = (id: string, tag: string): Flashcard => ({
    id,
    filePath: 'test.md',
    fileName: 'test.md',
    lineStart: 1,
    lineEnd: 5,
    front: `Q ${id}`,
    back: `A ${id}`,
    tags: [tag],
    globalTopics: [tag],
    localTags: [tag],
    hasBack: true,
  });

  const cards: Flashcard[] = [
    makeCard('js1', 'javascript'),
    makeCard('js2', 'javascript'),
    makeCard('js3', 'javascript'),
    makeCard('py1', 'python'),
    makeCard('py2', 'python'),
    makeCard('css1', 'css'),
  ];

  const interleaved = interleaveCards(cards);
  assert.strictEqual(interleaved.length, 6);

  // Check that the first two cards do not have the same topic if multiple topics exist
  const firstTwoSame = interleaved[0].tags[0] === interleaved[1].tags[0];
  assert.strictEqual(firstTwoSame, false);
});
