import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseCardsFromMarkdown } from '../src/parser';
const getFixturePath = (filename: string) => path.join(process.cwd(), 'tests', 'fixtures', filename);
test('Fixtures: basic-cards.md parses all regular and reversed cards with metadata', () => {
  const filePath = getFixturePath('basic-cards.md');
  const content = fs.readFileSync(filePath, 'utf-8');

  const { cards, warnings } = parseCardsFromMarkdown(
    'Notes/basic-cards.md',
    'basic-cards.md',
    content,
    ['Biology', 'anatomy']
  );

  assert.equal(warnings.length, 0);
  assert.equal(cards.length, 3);

  // Card 1: Cellular powerhouse
  assert.match(cards[0].front, /cellular powerhouse/);
  assert.match(cards[0].back, /mitochondrion/);
  assert.ok(cards[0].tags.includes('Biology'));
  assert.ok(cards[0].tags.includes('anatomy'));

  // Card 2: Ribosomes with local tags
  assert.match(cards[1].front, /ribosomes/);
  assert.match(cards[1].back, /protein synthesis/);
  assert.ok(cards[1].tags.includes('ribosome'));
  assert.ok(cards[1].tags.includes('protein-synthesis'));

  // Card 3: Reversed order
  assert.match(cards[2].front, /What does ATP stand for/);
  assert.match(cards[2].back, /Adenosine Triphosphate/);
});

test('Fixtures: cloze-cards.md splits multi-cloze and handles highlights', () => {
  const filePath = getFixturePath('cloze-cards.md');
  const content = fs.readFileSync(filePath, 'utf-8');

  const { cards, warnings } = parseCardsFromMarkdown(
    'Notes/cloze-cards.md',
    'cloze-cards.md',
    content,
    ['Physics/Relativity']
  );

  assert.equal(warnings.length, 0);
  // 1 (c1 light) + 2 (LIGO c1, c2) + 1 (Planck highlight c1) = 4 cards
  assert.equal(cards.length, 4);

  // All cards have distinct deterministic IDs
  const idSet = new Set(cards.map(c => c.id));
  assert.equal(idSet.size, 4);

  // LIGO multi-cloze produces c1 and c2 cards
  const ligoC1 = cards.find(c => c.clozeIndex === 1 && c.front.includes('observatory abbreviation'));
  const ligoC2 = cards.find(c => c.clozeIndex === 2 && c.front.includes('year'));
  assert.ok(ligoC1);
  assert.ok(ligoC2);
  assert.ok(ligoC1.tags.includes('c1'));
  assert.ok(ligoC2.tags.includes('c2'));
});

test('Fixtures: hidden-privacy-cards.md parses cards wrapped in %%%% fences', () => {
  const filePath = getFixturePath('hidden-privacy-cards.md');
  const content = fs.readFileSync(filePath, 'utf-8');

  const { cards, warnings } = parseCardsFromMarkdown(
    'Notes/hidden.md',
    'hidden.md',
    content,
    ['Privacy/Medical']
  );

  assert.equal(warnings.length, 0);
  assert.equal(cards.length, 2);

  assert.match(cards[0].front, /anaphylaxis/);
  assert.match(cards[0].back, /epinephrine/);

  assert.match(cards[1].back, /opioid receptors/);
});

test('Fixtures: long-content-scroll.md preserves multi-paragraph content', () => {
  const filePath = getFixturePath('long-content-scroll.md');
  const content = fs.readFileSync(filePath, 'utf-8');

  const { cards, warnings } = parseCardsFromMarkdown(
    'Notes/neuro.md',
    'neuro.md',
    content,
    ['Neuroanatomy']
  );

  assert.equal(warnings.length, 0);
  assert.equal(cards.length, 1);
  assert.match(cards[0].front, /internal capsule/);
  assert.match(cards[0].back, /Anterior limb/);
  assert.match(cards[0].back, /Charcot's artery/);
});
