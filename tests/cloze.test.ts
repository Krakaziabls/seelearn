import assert from 'node:assert';
import test from 'node:test';
import { hasClozeDeletions, renderClozeBack, renderClozeFront } from '../src/cloze';

test('hasClozeDeletions detects Anki and highlight syntax', () => {
  assert.strictEqual(hasClozeDeletions('Hello world'), false);
  assert.strictEqual(hasClozeDeletions('Capital of Spain is {{c1::Madrid}}'), true);
  assert.strictEqual(hasClozeDeletions('Capital of Spain is {{Madrid}}'), true);
  assert.strictEqual(hasClozeDeletions('Capital of Spain is ==Madrid=='), true);
});

test('renderClozeFront masks cloze targets with placeholders or hints', () => {
  const ankiWithHint = 'The capital of {{c1::France::country}} is {{c2::Paris::city}}.';
  const front1 = renderClozeFront(ankiWithHint);
  assert.ok(front1.includes('<span class="seelearn-cloze-target">[country]</span>'));
  assert.ok(front1.includes('<span class="seelearn-cloze-target">[city]</span>'));

  const ankiWithoutHint = 'The capital is {{Paris}}.';
  const front2 = renderClozeFront(ankiWithoutHint);
  assert.ok(front2.includes('<span class="seelearn-cloze-target">[...]</span>'));

  const highlight = 'The formula is ==E = mc^2== according to Einstein.';
  const front3 = renderClozeFront(highlight);
  assert.ok(front3.includes('<span class="seelearn-cloze-target">[...]</span>'));
});

test('renderClozeBack reveals all cloze answers with highlighted styling', () => {
  const ankiWithHint = 'The capital of {{c1::France::country}} is {{c2::Paris::city}}.';
  const back1 = renderClozeBack(ankiWithHint);
  assert.ok(back1.includes('<span class="seelearn-cloze-revealed">France</span>'));
  assert.ok(back1.includes('<span class="seelearn-cloze-revealed">Paris</span>'));

  const highlight = 'The formula is ==E = mc^2== according to Einstein.';
  const back2 = renderClozeBack(highlight);
  assert.ok(back2.includes('<span class="seelearn-cloze-revealed">E = mc^2</span>'));
});
