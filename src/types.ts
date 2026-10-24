export type RevealMode = 'replace' | 'append';

export interface SeeLearnSettings {
  triggerProperty: string;
  triggerValue: string;
  topicProperty: string;
  revealMode: RevealMode;
  autoFlipOnSpace: boolean;
}

export const DEFAULT_SETTINGS: SeeLearnSettings = {
  triggerProperty: 'tags',
  triggerValue: 'seelearn',
  topicProperty: 'topics',
  revealMode: 'append',
  autoFlipOnSpace: true,
};

export interface Flashcard {
  id: string;
  filePath: string;
  fileName: string;
  lineStart: number;
  lineEnd: number;
  front: string;
  back: string;
  tags: string[];
  globalTopics: string[];
  localTags: string[];
}

export interface ValidationWarning {
  filePath: string;
  line: number;
  message: string;
  rawText?: string;
}

export interface ParsedFileResult {
  filePath: string;
  cards: Flashcard[];
  warnings: ValidationWarning[];
}

export interface DeckFilter {
  tag?: string;
  filePath?: string;
}
