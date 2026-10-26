export type RevealMode = 'replace' | 'append';
export type StudyMode = 'learn' | 'test' | 'srs' | 'cram';
export type SRSQueueFilter = 'all' | 'due' | 'new';
export type SRSRatingValue = 'again' | 'hard' | 'good' | 'easy' | 'know' | 'repeat' | number;

export interface CardReviewEntry {
  date: string;
  rating: SRSRatingValue;
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

export interface StudyStreakStats {
  currentStreak: number;
  bestStreak: number;
  totalReviews: number;
  reviewedToday: number;
  dailyActivity: Record<string, number>; // YYYY-MM-DD -> count
}

export type TemplateStyle = 'comment' | 'plain';

export interface TestPreset {
  id: string;
  name: string;
  scope: string; // '' for all, 'folder:...' or 'file:...'
  tags: string[];
  createdAt: string;
  lastRun?: string;
  runsCount: number;
}

export interface SeeLearnSettings {
  triggerProperty: string;
  triggerValue: string;
  topicProperty: string;
  revealMode: RevealMode;
  studyMode: StudyMode;
  srsFilter: SRSQueueFilter;
  autoFlipOnSpace: boolean;
  shuffleOnStart: boolean;
  interleaveTopics: boolean;
  enable3DFlip: boolean;
  enableCloze: boolean;
  templateStyle: TemplateStyle;
  leechThreshold: number;
  requeueStep: number;
  maxNewPerSession: number;
  maxDuePerSession: number;
}

export const DEFAULT_SETTINGS: SeeLearnSettings = {
  triggerProperty: 'tags',
  triggerValue: 'seelearn',
  topicProperty: 'topics',
  revealMode: 'append',
  studyMode: 'learn', // По умолчанию режим "Ботать"
  srsFilter: 'all',
  autoFlipOnSpace: true,
  shuffleOnStart: false,
  interleaveTopics: true,
  enable3DFlip: true,
  enableCloze: true,
  templateStyle: 'comment',
  leechThreshold: 4,
  requeueStep: 3,
  maxNewPerSession: 25,
  maxDuePerSession: 50,
};

export interface SeeLearnStorageData {
  version: number;
  settings: SeeLearnSettings;
  progress: Record<string, CardProgressRecord>;
  testPresets?: Record<string, TestPreset>;
}

export const DEFAULT_STORAGE_DATA: SeeLearnStorageData = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  progress: {},
  testPresets: {},
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
  hasBack: boolean; // false for front-only info cards
  isCloze: boolean;
  clozeIndex?: number;
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
