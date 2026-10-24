/**
 * 64-bit FNV-1a hash algorithm returning a 16-character hex string.
 * Fast, pure TypeScript with excellent collision resistance and zero external dependencies.
 */
export function fnv1a64(str: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;

  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ (ch >> 8), 0x01000193);
  }

  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return hex1 + hex2;
}

/**
 * Normalizes card content for hashing:
 * - Unifies line endings (\r\n -> \n)
 * - Trims each line to ignore accidental trailing spaces
 * - Trims overall string
 */
export function normalizeCardContent(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

/**
 * Generates a stable deterministic ID for a flashcard.
 * If customId is provided (e.g. %% @card id::my-card %%), it takes precedence.
 * Otherwise, computes a hash from filePath and normalized front content.
 */
export function generateCardId(
  filePath: string,
  frontContent: string,
  customId?: string,
  collisionIndex = 0
): string {
  if (customId && customId.trim()) {
    const cleanId = customId.trim();
    return collisionIndex > 0 ? `${cleanId}_${collisionIndex}` : cleanId;
  }

  const normalized = normalizeCardContent(frontContent);
  const hash = fnv1a64(`${filePath}::${normalized}`);
  return collisionIndex > 0 ? `${hash}_${collisionIndex}` : hash;
}
