import { MetadataCache, TFile } from 'obsidian';
import { Flashcard, ParsedFileResult, SeeLearnSettings, ValidationWarning } from './types';
import { generateCardId, normalizeCardContent } from './hash';

export type MarkerType = 'card' | 'front' | 'back' | 'end';

export interface MarkerMatch {
  type: MarkerType;
  args?: string;
}

/**
 * Extracts an explicit custom ID from card header arguments (e.g. id::my-card).
 */
export function extractCustomId(args?: string): string | undefined {
  if (!args) return undefined;
  const match = args.match(/(?:^|\s)id::([^\s#%]+)/i);
  return match ? match[1].trim() : undefined;
}

/**
 * Parses a single line to determine if it is a SeeLearn marker.
 * Supports both Obsidian comment syntax:
 *   %% @card #tag1 #tag2 %%
 *   %% @front %%
 *   %% @back %%
 *   %% @end %%
 * and plain marker syntax:
 *   @card #tag1 #tag2
 *   @front
 *   @back
 *   @end
 */
export function parseMarkerLine(line: string): MarkerMatch | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let content = trimmed;

  // Check and strip optional enclosing %% ... %%
  if (content.startsWith('%%')) {
    content = content.substring(2);
    if (content.endsWith('%%')) {
      content = content.substring(0, content.length - 2);
    }
    content = content.trim();
  }

  const match = content.match(/^@(card|front|back|end)(?:\s+(.*)|\s*$)/i);
  if (!match) return null;

  const type = match[1].toLowerCase() as MarkerType;
  let args = match[2] ? match[2].trim() : undefined;

  // Clean trailing %% in case user had %% @card #tag %% without whitespace before %%
  if (args && args.endsWith('%%')) {
    args = args.substring(0, args.length - 2).trim();
  }

  return { type, args };
}

/**
 * Extracts local tags/attributes from the @card header line arguments.
 * Supports:
 * - Hashtags: #tag #sub/tag #сложно
 * - Key-value: topic:: value, topics:: value, tags:: value
 */
export function extractLocalTags(args?: string): string[] {
  if (!args) return [];

  const tags = new Set<string>();

  // 1. Extract Dataview-style key-values (topic:: ..., topics:: ..., tags:: ...)
  const kvRegex = /(?:topics?|tags?|subject)::\s*([^#%]+)/gi;
  let kvMatch: RegExpExecArray | null;
  while ((kvMatch = kvRegex.exec(args)) !== null) {
    const rawValues = kvMatch[1].split(/[,\s]+/);
    for (const val of rawValues) {
      const cleaned = cleanTag(val);
      if (cleaned) tags.add(cleaned);
    }
  }

  // 2. Extract hashtags with Unicode letter/number support (Russian, English, digits, etc.)
  const hashRegex = /#([\p{L}\p{N}_\-/]+)/gu;
  let hashMatch: RegExpExecArray | null;
  while ((hashMatch = hashRegex.exec(args)) !== null) {
    const cleaned = cleanTag(hashMatch[1]);
    if (cleaned) tags.add(cleaned);
  }

  return Array.from(tags);
}

/**
 * Cleans a tag string by stripping leading #, wikilink brackets [[...]], and whitespace.
 */
export function cleanTag(raw: string): string {
  if (!raw) return '';
  let str = raw.trim();
  if (str.startsWith('[[')) str = str.substring(2);
  if (str.endsWith(']]')) str = str.substring(0, str.length - 2);
  if (str.startsWith('#')) str = str.substring(1);
  return str.trim();
}

/**
 * Checks whether a given file should be indexed based on Frontmatter settings.
 */
export function shouldIndexFile(
  file: TFile,
  metadataCache: MetadataCache,
  settings: SeeLearnSettings
): boolean {
  if (file.extension !== 'md') return false;

  const fileCache = metadataCache.getFileCache(file);
  const frontmatter = fileCache?.frontmatter;
  if (!frontmatter) return false;

  const targetTrigger = cleanTag(settings.triggerValue).toLowerCase();
  if (!targetTrigger) return false;

  const targetPropKey = (settings.triggerProperty || 'tags').trim().toLowerCase();

  // Find matching frontmatter key (case-insensitive)
  for (const [key, value] of Object.entries(frontmatter)) {
    const lowerKey = key.toLowerCase();
    const isKeyMatch =
      lowerKey === targetPropKey ||
      (targetPropKey === 'tags' && lowerKey === 'tag');

    if (isKeyMatch && value !== undefined && value !== null) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (cleanTag(String(item)).toLowerCase() === targetTrigger) {
            return true;
          }
        }
      } else if (typeof value === 'string') {
        const tokens = value.split(/[,\s]+/);
        for (const token of tokens) {
          if (cleanTag(token).toLowerCase() === targetTrigger) {
            return true;
          }
        }
      } else if (cleanTag(String(value)).toLowerCase() === targetTrigger) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Extracts global topics/attributes from file Frontmatter based on settings.topicProperty.
 */
export function extractGlobalTopics(
  frontmatter: Record<string, any> | undefined,
  settings: SeeLearnSettings
): string[] {
  if (!frontmatter) return [];

  const targetPropKey = (settings.topicProperty || 'topics').trim().toLowerCase();
  const topics = new Set<string>();

  for (const [key, value] of Object.entries(frontmatter)) {
    if (key.toLowerCase() === targetPropKey && value !== undefined && value !== null) {
      if (Array.isArray(value)) {
        for (const item of value) {
          const cleaned = cleanTag(String(item));
          if (cleaned) topics.add(cleaned);
        }
      } else if (typeof value === 'string') {
        const tokens = value.split(/[,\n]+/);
        for (const token of tokens) {
          const cleaned = cleanTag(token);
          if (cleaned) topics.add(cleaned);
        }
      } else {
        const cleaned = cleanTag(String(value));
        if (cleaned) topics.add(cleaned);
      }
    }
  }

  return Array.from(topics);
}

/**
 * Parses markdown file content into Flashcards and records validation warnings.
 */
export function parseCardsFromMarkdown(
  filePath: string,
  fileName: string,
  content: string,
  globalTopics: string[] = []
): ParsedFileResult {
  const lines = content.split(/\r?\n/);
  const cards: Flashcard[] = [];
  const warnings: ValidationWarning[] = [];
  const contentOccurrences = new Map<string, number>();

  let inCard = false;
  let cardStartLine = 0;
  let cardArgs = '';
  let currentSection: 'none' | 'front' | 'back' = 'none';
  let frontLines: string[] = [];
  let backLines: string[] = [];
  let frontCount = 0;
  let backCount = 0;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const line = lines[i];
    const trimmed = line.trim();

    // Check code fence (``` or ~~~)
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inCodeBlock = !inCodeBlock;
    }

    const marker = parseMarkerLine(line);

    // If inside code fence, ignore @front and @back lines to prevent false matches inside code snippets
    if (inCodeBlock && marker && (marker.type === 'front' || marker.type === 'back')) {
      if (currentSection === 'front') {
        frontLines.push(line);
      } else if (currentSection === 'back') {
        backLines.push(line);
      }
      continue;
    }

    if (marker) {
      switch (marker.type) {
        case 'card': {
          if (inCard) {
            // Previous card was not closed with @end
            warnings.push({
              filePath,
              line: cardStartLine,
              message: `Незакрытая карточка: обнаружен новый маркер @card на строке ${lineNumber} до завершения предыдущей карты маркером @end`,
            });
          }

          // Start new card
          inCard = true;
          cardStartLine = lineNumber;
          cardArgs = marker.args || '';
          currentSection = 'none';
          frontLines = [];
          backLines = [];
          frontCount = 0;
          backCount = 0;
          break;
        }

        case 'front': {
          if (!inCard) {
            warnings.push({
              filePath,
              line: lineNumber,
              message: `Маркер @front находится вне карточки @card ... @end`,
              rawText: line,
            });
            break;
          }
          frontCount++;
          currentSection = 'front';
          break;
        }

        case 'back': {
          if (!inCard) {
            warnings.push({
              filePath,
              line: lineNumber,
              message: `Маркер @back находится вне карточки @card ... @end`,
              rawText: line,
            });
            break;
          }
          backCount++;
          currentSection = 'back';
          break;
        }

        case 'end': {
          if (!inCard) {
            warnings.push({
              filePath,
              line: lineNumber,
              message: `Маркер @end находится вне карточки @card ... @end`,
              rawText: line,
            });
            break;
          }

          // Validate card
          const cardErrors: string[] = [];
          if (frontCount === 0) {
            cardErrors.push('отсутствует обязательный блок @front');
          } else if (frontCount > 1) {
            cardErrors.push(`обнаружено несколько блоков @front (${frontCount})`);
          }

          if (backCount > 1) {
            cardErrors.push(`обнаружено несколько блоков @back (${backCount})`);
          }

          if (cardErrors.length > 0) {
            warnings.push({
              filePath,
              line: cardStartLine,
              message: `Невалидная карточка (строки ${cardStartLine}-${lineNumber}): ${cardErrors.join(', ')}`,
            });
          } else {
            // Valid card! (either two-sided or front-only info card)
            const localTags = extractLocalTags(cardArgs);
            const mergedTags = Array.from(new Set([...globalTopics, ...localTags]));

            const frontContent = frontLines.join('\n').trim();
            const backContent = backLines.join('\n').trim();
            const hasBack = backCount === 1 && backContent.length > 0;
            const customId = extractCustomId(cardArgs);

            const normFront = normalizeCardContent(frontContent);
            const occurrence = contentOccurrences.get(normFront) || 0;
            contentOccurrences.set(normFront, occurrence + 1);

            const cardId = generateCardId(filePath, frontContent, customId, occurrence);

            cards.push({
              id: cardId,
              customId,
              filePath,
              fileName,
              lineStart: cardStartLine,
              lineEnd: lineNumber,
              front: frontContent,
              back: backContent,
              hasBack,
              tags: mergedTags,
              globalTopics,
              localTags,
            });
          }


          // Reset card state
          inCard = false;
          currentSection = 'none';
          frontLines = [];
          backLines = [];
          frontCount = 0;
          backCount = 0;
          break;
        }
      }
    } else if (inCard) {
      if (currentSection === 'front') {
        frontLines.push(line);
      } else if (currentSection === 'back') {
        backLines.push(line);
      }
    }
  }

  // EOF reached
  if (inCard) {
    warnings.push({
      filePath,
      line: cardStartLine,
      message: `Незакрытая карточка: файл закончился без маркера @end (начало на строке ${cardStartLine})`,
    });
  }

  return {
    filePath,
    cards,
    warnings,
  };
}
