import assert from 'node:assert';
import test from 'node:test';
import { fnv1a64, generateCardId, normalizeCardContent } from '../src/hash';

test('fnv1a64 generates consistent 16-char hex hash', () => {
  const hash1 = fnv1a64('Sample Question');
  const hash2 = fnv1a64('Sample Question');
  const hashDiff = fnv1a64('Different Question');

  assert.strictEqual(hash1, hash2);
  assert.strictEqual(hash1.length, 16);
  assert.notStrictEqual(hash1, hashDiff);
});

test('normalizeCardContent handles CRLF and accidental trailing whitespace', () => {
  const raw1 = 'Line 1   \r\nLine 2\t\r\n';
  const raw2 = 'Line 1\nLine 2\n';

  assert.strictEqual(normalizeCardContent(raw1), normalizeCardContent(raw2));
});

test('generateCardId is deterministic and ignores line numbers', () => {
  const id1 = generateCardId('Folder/Note.md', 'What is React?');
  const id2 = generateCardId('Folder/Note.md', 'What is React?');
  const idDiffFile = generateCardId('Folder/Another.md', 'What is React?');

  assert.strictEqual(id1, id2);
  assert.notStrictEqual(id1, idDiffFile);
});

test('generateCardId supports custom ID and collision index', () => {
  const custom = generateCardId('Note.md', 'Question', 'custom-slug-123');
  assert.strictEqual(custom, 'custom-slug-123');

  const collision0 = generateCardId('Note.md', 'Duplicate question', undefined, 0);
  const collision1 = generateCardId('Note.md', 'Duplicate question', undefined, 1);
  assert.ok(collision1.endsWith('_1'));
  assert.notStrictEqual(collision0, collision1);
});
