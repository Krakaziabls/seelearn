import assert from 'node:assert';
import test from 'node:test';
import {
  parseMarkerLine,
  extractLocalTags,
  cleanTag,
  parseCardsFromMarkdown,
  extractGlobalTopics
} from '../src/parser';
import { DEFAULT_SETTINGS } from '../src/types';

test('parseMarkerLine identifies various syntaxes', () => {
  // Comment syntax
  assert.deepStrictEqual(parseMarkerLine('%% @card #js #async %%'), {
    type: 'card',
    args: '#js #async'
  });
  assert.deepStrictEqual(parseMarkerLine('%% @front %%'), {
    type: 'front',
    args: undefined
  });
  assert.deepStrictEqual(parseMarkerLine('%% @back %%'), {
    type: 'back',
    args: undefined
  });
  assert.deepStrictEqual(parseMarkerLine('%% @end %%'), {
    type: 'end',
    args: undefined
  });

  // Plain syntax
  assert.deepStrictEqual(parseMarkerLine('@card #typescript #сложно'), {
    type: 'card',
    args: '#typescript #сложно'
  });
  assert.deepStrictEqual(parseMarkerLine('@front'), {
    type: 'front',
    args: undefined
  });
  assert.deepStrictEqual(parseMarkerLine('@back'), {
    type: 'back',
    args: undefined
  });
  assert.deepStrictEqual(parseMarkerLine('@end'), {
    type: 'end',
    args: undefined
  });

  // Non-markers
  assert.strictEqual(parseMarkerLine('Just regular text'), null);
  assert.strictEqual(parseMarkerLine('email@front.com'), null);
});

test('extractLocalTags extracts hashtags and dataview topics', () => {
  const tags1 = extractLocalTags('#js #async #сложно topic:: Web, Architecture');
  assert.ok(tags1.includes('js'));
  assert.ok(tags1.includes('async'));
  assert.ok(tags1.includes('сложно'));
  assert.ok(tags1.includes('Web'));
  assert.ok(tags1.includes('Architecture'));

  const tags2 = extractLocalTags('%% @card #algorithm/sort #dsa %%');
  assert.ok(tags2.includes('algorithm/sort'));
  assert.ok(tags2.includes('dsa'));
});

test('extractGlobalTopics parses frontmatter correctly', () => {
  const fm1 = { topics: ['JavaScript', '[[Web]]', '#frontend'] };
  assert.deepStrictEqual(extractGlobalTopics(fm1, DEFAULT_SETTINGS), [
    'JavaScript',
    'Web',
    'frontend'
  ]);

  const fm2 = { topics: 'Algorithms, Data Structures' };
  assert.deepStrictEqual(extractGlobalTopics(fm2, DEFAULT_SETTINGS), [
    'Algorithms',
    'Data Structures'
  ]);
});

test('parseCardsFromMarkdown parses valid cards in regular and reversed order', () => {
  const md = `
# Note title

%% @card #js #functions %%
%% @front %%
What is a closure?
%% @back %%
A function bundled with its lexical environment.
%% @end %%

Some markdown in between.

@card #python
@back
Yield produces a generator.
@front
What does yield do in Python?
@end
`;

  const result = parseCardsFromMarkdown('notes/test.md', 'test.md', md, ['Programming']);
  assert.strictEqual(result.warnings.length, 0);
  assert.strictEqual(result.cards.length, 2);

  const card1 = result.cards[0];
  assert.strictEqual(card1.front, 'What is a closure?');
  assert.strictEqual(card1.back, 'A function bundled with its lexical environment.');
  assert.ok(card1.tags.includes('Programming'));
  assert.ok(card1.tags.includes('js'));
  assert.ok(card1.tags.includes('functions'));

  // Test reversed order: @back before @front in markdown, but front & back are preserved
  const card2 = result.cards[1];
  assert.strictEqual(card2.front, 'What does yield do in Python?');
  assert.strictEqual(card2.back, 'Yield produces a generator.');
  assert.ok(card2.tags.includes('Programming'));
  assert.ok(card2.tags.includes('python'));
});

test('parseCardsFromMarkdown requires both @front and @back for regular cards', () => {
  // Front-only without back is no longer allowed for non-cloze cards
  const mdInfo = `
%% @card #info #important %%
%% @front %%
Formula: E = mc^2
%% @end %%
`;
  const resultInfo = parseCardsFromMarkdown('notes/info.md', 'info.md', mdInfo, []);
  assert.strictEqual(resultInfo.cards.length, 0);
  assert.strictEqual(resultInfo.warnings.length, 1);
  assert.ok(resultInfo.warnings[0].message.includes('отсутствует обязательный блок @back'));

  // Missing @front (invalid!)
  const mdMissingFront = `
%% @card #broken %%
%% @back %%
Only back without front...
%% @end %%
`;
  const resultMissing = parseCardsFromMarkdown('notes/broken.md', 'broken.md', mdMissingFront, []);
  assert.strictEqual(resultMissing.cards.length, 0);
  assert.strictEqual(resultMissing.warnings.length, 1);
  assert.ok(resultMissing.warnings[0].message.includes('отсутствует обязательный блок @front'));
});

test('parseCardsFromMarkdown allows cloze cards without @front and @back markers', () => {
  const mdCloze = `
%% @card #grammar %%
The past tense of "go" is {{c1::went}}.
%% @end %%
`;
  const result = parseCardsFromMarkdown('notes/grammar.md', 'grammar.md', mdCloze, []);
  assert.strictEqual(result.warnings.length, 0);
  assert.strictEqual(result.cards.length, 1);
  assert.strictEqual(result.cards[0].isCloze, true);
  assert.ok(result.cards[0].front.includes('<span class="seelearn-cloze-target">[...]</span>'));
  assert.ok(result.cards[0].back.includes('<span class="seelearn-cloze-revealed">went</span>'));
});

test('parseCardsFromMarkdown supports hiding cards completely with %%%% comment fences', () => {
  const mdHidden = `
# Lecture Note
Some public text here.

%%%%
@card #biology
@front
What is the powerhouse of the cell?
@back
Mitochondria.
@end
%%%%

Another note paragraph.

%%%%
@card #history
The Roman empire fell in {{c1::476}} AD.
@end
%%%%
`;
  const result = parseCardsFromMarkdown('notes/lecture.md', 'lecture.md', mdHidden, []);
  assert.strictEqual(result.warnings.length, 0);
  assert.strictEqual(result.cards.length, 2);

  assert.strictEqual(result.cards[0].front, 'What is the powerhouse of the cell?');
  assert.strictEqual(result.cards[0].back, 'Mitochondria.');
  assert.ok(result.cards[0].tags.includes('biology'));

  assert.strictEqual(result.cards[1].isCloze, true);
  assert.ok(result.cards[1].back.includes('476'));
});


test('parseCardsFromMarkdown validates multiple front blocks', () => {
  const md = `
%% @card #duplicate %%
%% @front %%
Front 1
%% @front %%
Front 2
%% @back %%
Back content
%% @end %%
`;

  const result = parseCardsFromMarkdown('notes/test.md', 'test.md', md, []);
  assert.strictEqual(result.cards.length, 0);
  assert.strictEqual(result.warnings.length, 1);
  assert.ok(result.warnings[0].message.includes('обнаружено несколько блоков @front (2)'));
});

test('parseCardsFromMarkdown handles code blocks with markers inside without breaking', () => {
  const md = `
%% @card #code %%
%% @front %%
How to write a card in markdown?
\`\`\`markdown
%% @front %%
Sample code
%% @back %%
\`\`\`
%% @back %%
Use the comments above!
%% @end %%
`;

  const result = parseCardsFromMarkdown('notes/test.md', 'test.md', md, []);
  assert.strictEqual(result.warnings.length, 0);
  assert.strictEqual(result.cards.length, 1);
  assert.ok(result.cards[0].front.includes('Sample code'));
  assert.strictEqual(result.cards[0].back, 'Use the comments above!');
});

test('parseCardsFromMarkdown validates unclosed cards', () => {
  const md = `
%% @card #tag1 %%
%% @front %%
Front 1
%% @back %%
Back 1
%% @card #tag2 %%
%% @front %%
Front 2
%% @back %%
Back 2
%% @end %%
`;

  const result = parseCardsFromMarkdown('notes/test.md', 'test.md', md, []);
  assert.strictEqual(result.cards.length, 1); // card 2 is valid
  assert.strictEqual(result.warnings.length, 1);
  assert.ok(result.warnings[0].message.includes('Незакрытая карточка'));
});

test('extractLocalTags supports Cyrillic and nested tags', () => {
  const tags = extractLocalTags('#конспект #тема/подтема #react-hooks #v1_2');
  assert.ok(tags.includes('конспект'));
  assert.ok(tags.includes('тема/подтема'));
  assert.ok(tags.includes('react-hooks'));
  assert.ok(tags.includes('v1_2'));
});

test('cleanTag strips leading hash and wikilinks', () => {
  assert.strictEqual(cleanTag('#tag'), 'tag');
  assert.strictEqual(cleanTag('[[Note Title]]'), 'Note Title');
  assert.strictEqual(cleanTag('   #nested/tag   '), 'nested/tag');
});

test('parseCardsFromMarkdown parses cards inside blockquotes and callouts', () => {
  const md = `
> [!NOTE] Go Concurrency
> %% @card #golang #channels %%
> %% @front %%
> How do unbuffered channels work?
> %% @back %%
> Sender blocks until receiver is ready.
> %% @end %%
`;

  const result = parseCardsFromMarkdown('notes/go.md', 'go.md', md, []);
  assert.strictEqual(result.cards.length, 1);
  assert.strictEqual(result.warnings.length, 0);
  assert.ok(result.cards[0].tags.includes('golang'));
  assert.ok(result.cards[0].front.includes('How do unbuffered channels work?'));
  assert.ok(result.cards[0].back.includes('Sender blocks until receiver is ready.'));
});

test('parseCardsFromMarkdown parses cloze deletion cards with {{c1::answer}} and ==highlight==', () => {
  const md = `
%% @card #history %%
%% @front %%
The capital of France is {{c1::Paris::city}}.
%% @end %%

%% @card #web %%
%% @front %%
HTTP error ==404== means Not Found.
%% @end %%
`;

  const result = parseCardsFromMarkdown('notes/test.md', 'test.md', md, []);
  assert.strictEqual(result.cards.length, 2);
  assert.strictEqual(result.warnings.length, 0);

  // Card 1: Anki style cloze
  const c1 = result.cards[0];
  assert.strictEqual(c1.isCloze, true);
  assert.strictEqual(c1.hasBack, true);
  assert.ok(c1.front.includes('<span class="seelearn-cloze-target">[city]</span>'));
  assert.ok(c1.back.includes('<span class="seelearn-cloze-revealed">Paris</span>'));

  // Card 2: Highlight style cloze
  const c2 = result.cards[1];
  assert.strictEqual(c2.isCloze, true);
  assert.strictEqual(c2.hasBack, true);
  assert.ok(c2.front.includes('<span class="seelearn-cloze-target">[...]</span>'));
  assert.ok(c2.back.includes('<span class="seelearn-cloze-revealed">404</span>'));
});

test('parseCardsFromMarkdown splits multi-cloze cards into virtual cards c1 and c2 with distinct IDs and tags', () => {
  const md = `
%% @card #geography %%
%% @front %%
The capital of {{c1::France}} is {{c2::Paris}}.
%% @end %%
`;

  const result = parseCardsFromMarkdown('notes/geo.md', 'geo.md', md, []);
  assert.strictEqual(result.cards.length, 2);
  assert.strictEqual(result.warnings.length, 0);

  const card1 = result.cards[0];
  assert.strictEqual(card1.isCloze, true);
  assert.strictEqual(card1.clozeIndex, 1);
  assert.ok(card1.front.includes('<span class="seelearn-cloze-target">[...]</span>'));
  assert.ok(card1.front.includes('is Paris.'));
  assert.ok(card1.back.includes('<span class="seelearn-cloze-revealed">France</span>'));
  assert.ok(card1.tags.includes('c1'));

  const card2 = result.cards[1];
  assert.strictEqual(card2.isCloze, true);
  assert.strictEqual(card2.clozeIndex, 2);
  assert.ok(card2.front.includes('The capital of France is'));
  assert.ok(card2.front.includes('<span class="seelearn-cloze-target">[...]</span>'));
  assert.ok(card2.back.includes('<span class="seelearn-cloze-revealed">Paris</span>'));
  assert.ok(card2.tags.includes('c2'));

  assert.notStrictEqual(card1.id, card2.id);
});




