/**
 * Cloze deletion helper utilities.
 * Supports:
 * - Anki syntax: {{c1::answer}}, {{c1::answer::hint}}, {{answer}}
 * - Obsidian highlight syntax: ==answer==
 */

/**
 * Checks if the given text contains any cloze deletion patterns.
 */
export function hasClozeDeletions(text: string): boolean {
  if (!text) return false;
  return /\{\{(?:c\d+::)?[^}]+\}\}/.test(text) || /==[^\n]+?==/.test(text);
}

/**
 * Replaces cloze deletion targets with placeholders on the front of the card.
 */
export function renderClozeFront(text: string): string {
  if (!text) return '';

  const ankiRegex = /\{\{(?:c\d+::)?(.*?)(?:::([^}]+))?\}\}/g;
  const highlightRegex = /==([^\n]+?)==/g;

  // 1. Process Anki-style {{c1::answer}} or {{c1::answer::hint}}
  let result = text.replace(ankiRegex, (_match, _answer, hint) => {
    const placeholder = hint && hint.trim() ? `[${hint.trim()}]` : '[...]';
    return `<span class="seelearn-cloze-target">${placeholder}</span>`;
  });

  // 2. Process Obsidian ==highlighted== text
  result = result.replace(highlightRegex, () => {
    return `<span class="seelearn-cloze-target">[...]</span>`;
  });

  return result;
}

/**
 * Replaces cloze deletion targets with highlighted answers on the back of the card.
 */
export function renderClozeBack(text: string): string {
  if (!text) return '';

  const ankiRegex = /\{\{(?:c\d+::)?(.*?)(?:::([^}]+))?\}\}/g;
  const highlightRegex = /==([^\n]+?)==/g;

  // 1. Process Anki-style {{c1::answer}} or {{c1::answer::hint}}
  let result = text.replace(ankiRegex, (_match, answer) => {
    return `<span class="seelearn-cloze-revealed">${answer}</span>`;
  });

  // 2. Process Obsidian ==highlighted== text
  result = result.replace(highlightRegex, (_match, answer) => {
    return `<span class="seelearn-cloze-revealed">${answer}</span>`;
  });

  return result;
}
