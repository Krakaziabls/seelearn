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
 * Extracts all unique cloze deletion indices present in the text (e.g. [1, 2, 3]).
 * If text contains clozes without explicit c-numbers (e.g. {{answer}} or ==answer==), index 1 is assumed.
 */
export function getClozeIndices(text: string): number[] {
  if (!text) return [];
  const indices = new Set<number>();

  const ankiRegex = /\{\{(?:c(\d+)::)?(.*?)(?:::([^}]+))?\}\}/g;
  let match: RegExpExecArray | null;
  let foundAnyAnki = false;
  while ((match = ankiRegex.exec(text)) !== null) {
    foundAnyAnki = true;
    const num = match[1] ? parseInt(match[1], 10) : 1;
    if (!isNaN(num) && num > 0) {
      indices.add(num);
    }
  }

  const highlightRegex = /==([^\n]+?)==/g;
  if (highlightRegex.test(text)) {
    indices.add(1);
  }

  if (indices.size === 0 && (foundAnyAnki || hasClozeDeletions(text))) {
    indices.add(1);
  }

  return Array.from(indices).sort((a, b) => a - b);
}

/**
 * Replaces cloze deletion targets with placeholders on the front of the card.
 * If targetIndex is specified, only clozes matching that index are masked with placeholders;
 * other cloze deletions are rendered as normal plain text.
 * If targetIndex is omitted, all cloze deletions are masked.
 */
export function renderClozeFront(text: string, targetIndex?: number): string {
  if (!text) return '';

  const ankiRegex = /\{\{(?:c(\d+)::)?(.*?)(?:::([^}]+))?\}\}/g;
  const highlightRegex = /==([^\n]+?)==/g;

  // 1. Process Anki-style {{c1::answer}} or {{c1::answer::hint}}
  let result = text.replace(ankiRegex, (_match, clozeNum, answer, hint) => {
    const idx = clozeNum ? parseInt(clozeNum, 10) : 1;
    if (targetIndex === undefined || idx === targetIndex) {
      const placeholder = hint && hint.trim() ? `[${hint.trim()}]` : '[...]';
      return `<span class="seelearn-cloze-target">${placeholder}</span>`;
    }
    return answer;
  });

  // 2. Process Obsidian ==highlighted== text
  result = result.replace(highlightRegex, (_match, answer) => {
    if (targetIndex === undefined || targetIndex === 1) {
      return `<span class="seelearn-cloze-target">[...]</span>`;
    }
    return answer;
  });

  return result;
}

/**
 * Replaces cloze deletion targets with highlighted answers on the back of the card.
 * If targetIndex is specified, only clozes matching that index are highlighted;
 * other cloze deletions are rendered as normal plain text.
 * If targetIndex is omitted, all cloze deletions are highlighted.
 */
export function renderClozeBack(text: string, targetIndex?: number): string {
  if (!text) return '';

  const ankiRegex = /\{\{(?:c(\d+)::)?(.*?)(?:::([^}]+))?\}\}/g;
  const highlightRegex = /==([^\n]+?)==/g;

  // 1. Process Anki-style {{c1::answer}} or {{c1::answer::hint}}
  let result = text.replace(ankiRegex, (_match, clozeNum, answer) => {
    const idx = clozeNum ? parseInt(clozeNum, 10) : 1;
    if (targetIndex === undefined || idx === targetIndex) {
      return `<span class="seelearn-cloze-revealed">${answer}</span>`;
    }
    return answer;
  });

  // 2. Process Obsidian ==highlighted== text
  result = result.replace(highlightRegex, (_match, answer) => {
    if (targetIndex === undefined || targetIndex === 1) {
      return `<span class="seelearn-cloze-revealed">${answer}</span>`;
    }
    return answer;
  });

  return result;
}
