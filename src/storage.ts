import { Plugin } from 'obsidian';
import {
  CardProgressRecord,
  DEFAULT_SETTINGS,
  DEFAULT_STORAGE_DATA,
  SeeLearnSettings,
  SeeLearnStorageData,
} from './types';

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
   * Records a study review for a card, updating interval, repetitions, and history.
   */
  recordReview(cardId: string, rating: 'know' | 'repeat' | number): CardProgressRecord {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    let record = this.data.progress[cardId];
    if (!record) {
      record = {
        cardId,
        repetitions: 0,
        interval: 0,
        easeFactor: 2.5,
        dueDate: todayStr,
        lastReviewed: today.toISOString(),
        lapses: 0,
        history: [],
      };
      this.data.progress[cardId] = record;
    }

    if (!record.history) {
      record.history = [];
    }

    record.lastReviewed = today.toISOString();
    record.history.push({
      date: today.toISOString(),
      rating,
    });

    if (rating === 'know' || (typeof rating === 'number' && rating >= 3)) {
      record.repetitions += 1;
      if (record.repetitions === 1) {
        record.interval = 1;
      } else if (record.repetitions === 2) {
        record.interval = 6;
      } else {
        record.interval = Math.round(record.interval * record.easeFactor);
      }
    } else {
      // Repeat / Again
      record.repetitions = 0;
      record.interval = 1;
      record.lapses += 1;
      record.easeFactor = Math.max(1.3, record.easeFactor - 0.2);
    }

    // Compute next due date: today + interval days
    const nextDue = new Date(today);
    nextDue.setDate(nextDue.getDate() + record.interval);
    record.dueDate = nextDue.toISOString().split('T')[0];

    this.scheduleSave();
    return record;
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

