import { Plugin } from 'obsidian';
import {
  CardProgressRecord,
  DEFAULT_SETTINGS,
  DEFAULT_STORAGE_DATA,
  Flashcard,
  SeeLearnSettings,
  SeeLearnStorageData,
  SRSRatingValue,
} from './types';
import { calculateSRSReview, isCardDue, isCardNew, SRSRating } from './srs';

export class StorageManager {
  private plugin: Plugin;
  public data: SeeLearnStorageData;
  private saveTimeoutId: number | null = null;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.data = JSON.parse(JSON.stringify(DEFAULT_STORAGE_DATA));
  }

  /**
   * Loads storage data from data.json with backwards compatibility migration.
   */
  async load(): Promise<SeeLearnStorageData> {
    const rawData = await this.plugin.loadData();
    if (!rawData) {
      this.data = JSON.parse(JSON.stringify(DEFAULT_STORAGE_DATA));
      return this.data;
    }

    // Migration from v1.0.0: check if data is legacy flat settings object
    if (!('progress' in rawData) && !('version' in rawData)) {
      this.data = {
        version: 1,
        settings: Object.assign({}, DEFAULT_SETTINGS, rawData),
        progress: {},
      };
    } else {
      this.data = {
        version: rawData.version || 1,
        settings: Object.assign({}, DEFAULT_SETTINGS, rawData.settings),
        progress: rawData.progress || {},
      };
    }

    return this.data;
  }

  get settings(): SeeLearnSettings {
    return this.data.settings;
  }

  set settings(newSettings: SeeLearnSettings) {
    this.data.settings = newSettings;
  }

  /**
   * Immediately saves data to data.json.
   */
  async saveNow(): Promise<void> {
    if (this.saveTimeoutId !== null) {
      clearTimeout(this.saveTimeoutId as any);
      this.saveTimeoutId = null;
    }
    await this.plugin.saveData(this.data);
  }

  /**
   * Schedules debounced saving to prevent disk I/O thrashing during study sessions.
   */
  scheduleSave(delayMs = 1200): void {
    if (this.saveTimeoutId !== null) {
      clearTimeout(this.saveTimeoutId as any);
    }

    this.saveTimeoutId = setTimeout(async () => {
      this.saveTimeoutId = null;
      try {
        await this.plugin.saveData(this.data);
      } catch (err) {
        console.error('SeeLearn: Failed to save progress data:', err);
      }
    }, delayMs) as any;
  }

  /**
   * Retrieves review progress for a card by its stable ID.
   */
  getProgress(cardId: string): CardProgressRecord | undefined {
    return this.data.progress[cardId];
  }

  /**
   * Records a review using the SM-2 algorithm, updating intervals, repetitions, and history.
   */
  recordReview(cardId: string, rating: SRSRatingValue): CardProgressRecord {
    let srsRating: SRSRating = 'good';
    if (rating === 'again' || rating === 'repeat' || rating === 1) {
      srsRating = 'again';
    } else if (rating === 'hard' || rating === 2) {
      srsRating = 'hard';
    } else if (rating === 'easy' || rating === 4 || rating === 5) {
      srsRating = 'easy';
    } else {
      srsRating = 'good';
    }

    const currentRecord = this.data.progress[cardId];
    const result = calculateSRSReview(currentRecord, srsRating);

    const record: CardProgressRecord = currentRecord
      ? currentRecord
      : {
          cardId,
          repetitions: 0,
          interval: 0,
          easeFactor: 2.5,
          dueDate: '',
          lastReviewed: '',
          lapses: 0,
          history: [],
        };

    record.repetitions = result.repetitions;
    record.interval = result.interval;
    record.easeFactor = result.easeFactor;
    record.dueDate = result.dueDate;
    record.lapses = result.lapses;
    record.lastReviewed = new Date().toISOString();

    if (!record.history) {
      record.history = [];
    }
    record.history.push({
      date: record.lastReviewed,
      rating,
    });

    this.data.progress[cardId] = record;
    this.scheduleSave();
    return record;
  }

  /**
   * Calculates SRS breakdown for a list of cards (due, new, learned).
   */
  getSRSBreakdown(cards: Flashcard[]): {
    total: number;
    due: number;
    newCards: number;
    learned: number;
  } {
    const todayStr = new Date().toISOString().split('T')[0];
    let due = 0;
    let newCards = 0;
    let learned = 0;

    for (const card of cards) {
      const record = this.data.progress[card.id];
      if (isCardNew(record)) {
        newCards++;
      } else if (isCardDue(record, todayStr)) {
        due++;
      } else {
        learned++;
      }
    }

    return {
      total: cards.length,
      due,
      newCards,
      learned,
    };
  }


  /**
   * Returns statistics about all tracked cards.
   */
  getStats(): { totalTracked: number; totalLapses: number; reviewedToday: number } {
    const todayStr = new Date().toISOString().split('T')[0];
    let totalLapses = 0;
    let reviewedToday = 0;

    const records = Object.values(this.data.progress);
    for (const r of records) {
      totalLapses += r.lapses || 0;
      if (r.lastReviewed && r.lastReviewed.startsWith(todayStr)) {
        reviewedToday += 1;
      }
    }

    return {
      totalTracked: records.length,
      totalLapses,
      reviewedToday,
    };
  }

  cleanup(): void {
    if (this.saveTimeoutId !== null) {
      clearTimeout(this.saveTimeoutId as any);
      this.saveTimeoutId = null;
    }
  }
}

