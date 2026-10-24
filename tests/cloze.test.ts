import assert from 'node:assert';
import test from 'node:test';
import { getClozeIndices, hasClozeDeletions, renderClozeBack, renderClozeFront } from '../src/cloze';

test('hasClozeDeletions detects Anki and highlight syntax', () => {
  assert.strictEqual(hasClozeDeletions('Hello world'), false);
  assert.strictEqual(hasClozeDeletions('Capital of Spain is {{c1::Madrid}}'), true);
  assert.strictEqual(hasClozeDeletions('Capital of Spain is {{Madrid}}'), true);
  assert.strictEqual(hasClozeDeletions('Capital of Spain is ==Madrid=='), true);
});

test('getClozeIndices extracts unique sorted cloze indices', () => {
  assert.deepStrictEqual(getClozeIndices('Hello world'), []);
  assert.deepStrictEqual(getClozeIndices('Single {{c1::fact}}'), [1]);
  assert.deepStrictEqual(getClozeIndices('Implicit {{fact}}'), [1]);
  assert.deepStrictEqual(getClozeIndices('Highlight ==fact=='), [1]);
  assert.deepStrictEqual(getClozeIndices('{{c2::second}} and {{c1::first}} and {{c3::third}}'), [1, 2, 3]);
  assert.deepStrictEqual(getClozeIndices('{{c1::first}} and {{c1::another first}}'), [1]);
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

test('renderClozeFront with targetIndex masks only selected index and leaves others plain', () => {
  const text = 'The capital of {{c1::France::country}} is {{c2::Paris::city}}.';
  
  // Target c1: France is masked, Paris is plain text
  const frontC1 = renderClozeFront(text, 1);
  assert.ok(frontC1.includes('<span class="seelearn-cloze-target">[country]</span>'));
  assert.ok(frontC1.includes('is Paris.'));
  assert.ok(!frontC1.includes('[city]'));

  // Target c2: Paris is masked, France is plain text
  const frontC2 = renderClozeFront(text, 2);
  assert.ok(frontC2.includes('The capital of France is'));
  assert.ok(frontC2.includes('<span class="seelearn-cloze-target">[city]</span>'));
  assert.ok(!frontC2.includes('[country]'));
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

test('renderClozeBack with targetIndex highlights only selected index and leaves others plain', () => {
  const text = 'The capital of {{c1::France::country}} is {{c2::Paris::city}}.';

  // Target c1: France is revealed with tag, Paris is plain text
  const backC1 = renderClozeBack(text, 1);
  assert.ok(backC1.includes('<span class="seelearn-cloze-revealed">France</span>'));
  assert.ok(backC1.includes('is Paris.'));
  assert.ok(!backC1.includes('<span class="seelearn-cloze-revealed">Paris</span>'));

  // Target c2: Paris is revealed with tag, France is plain text
  const backC2 = renderClozeBack(text, 2);
  assert.ok(backC2.includes('The capital of France is'));
  assert.ok(backC2.includes('<span class="seelearn-cloze-revealed">Paris</span>'));
  assert.ok(!backC2.includes('<span class="seelearn-cloze-revealed">France</span>'));
});
