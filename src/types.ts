export type RevealMode = 'replace' | 'append';

export interface CardReviewEntry {
  date: string;
  rating: 'know' | 'repeat' | number;
}

export interface CardProgressRecord {
  cardId: string;
  repetitions: number;
  interval: number; // in days
  easeFactor: number; // default 2.5
  dueDate: string; // YYYY-MM-DD
  lastReviewed: string; // ISO string
  lapses: number;
  history?: CardReviewEntry[];
}

export interface SeeLearnSettings {
  triggerProperty: string;
  triggerValue: string;
  topicProperty: string;
  revealMode: RevealMode;
  autoFlipOnSpace: boolean;
  shuffleOnStart: boolean;
  interleaveTopics: boolean;
  requeueStep: number;
}

export const DEFAULT_SETTINGS: SeeLearnSettings = {
  triggerProperty: 'tags',
  triggerValue: 'seelearn',
  topicProperty: 'topics',
  revealMode: 'append',
  autoFlipOnSpace: true,
  shuffleOnStart: false,
  interleaveTopics: true,
  requeueStep: 3,
};

export interface SeeLearnStorageData {
  version: number;
  settings: SeeLearnSettings;
  progress: Record<string, CardProgressRecord>;
}

export const DEFAULT_STORAGE_DATA: SeeLearnStorageData = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  progress: {},
};

export interface Flashcard {
  id: string;
  customId?: string;
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
