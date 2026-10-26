import { Plugin } from 'obsidian';
import {
  CardProgressRecord,
  DEFAULT_SETTINGS,
  DEFAULT_STORAGE_DATA,
  Flashcard,
  SeeLearnSettings,
  SeeLearnStorageData,
  SRSRatingValue,
  StudyStreakStats,
  TestPreset,
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
        testPresets: {},
      };
    } else {
      this.data = {
        version: rawData.version || 1,
        settings: Object.assign({}, DEFAULT_SETTINGS, rawData.settings),
        progress: rawData.progress || {},
        testPresets: rawData.testPresets || {},
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

  /**
   * Calculates study streak statistics (current streak, best streak, daily activity).
   */
  getStudyStreakStats(): StudyStreakStats {
    const dailyActivity: Record<string, number> = {};
    let totalReviews = 0;
    const todayStr = new Date().toISOString().split('T')[0];

    for (const record of Object.values(this.data.progress)) {
      if (record.history && record.history.length > 0) {
        for (const review of record.history) {
          totalReviews++;
          const dateStr = review.date.split('T')[0];
          dailyActivity[dateStr] = (dailyActivity[dateStr] || 0) + 1;
        }
      } else if (record.lastReviewed) {
        totalReviews++;
        const dateStr = record.lastReviewed.split('T')[0];
        dailyActivity[dateStr] = (dailyActivity[dateStr] || 0) + 1;
      }
    }

    const reviewedToday = dailyActivity[todayStr] || 0;

    // Calculate streaks
    let currentStreak = 0;
    let bestStreak = 0;

    const now = new Date();
    let checkDate = new Date(now);
    if (!dailyActivity[todayStr]) {
      // Check yesterday to see if streak is still active
      checkDate.setDate(checkDate.getDate() - 1);
    }

    while (true) {
      const dStr = checkDate.toISOString().split('T')[0];
      if (dailyActivity[dStr] && dailyActivity[dStr] > 0) {
        currentStreak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    // Best streak
    const sortedDates = Object.keys(dailyActivity).sort();
    if (sortedDates.length > 0) {
      let tempStreak = 0;
      let prevTs = 0;
      const oneDayMs = 24 * 60 * 60 * 1000;
      for (const d of sortedDates) {
        const ts = new Date(d).getTime();
        if (prevTs === 0 || Math.round((ts - prevTs) / oneDayMs) === 1) {
          tempStreak++;
        } else {
          tempStreak = 1;
        }
        prevTs = ts;
        if (tempStreak > bestStreak) {
          bestStreak = tempStreak;
        }
      }
    }

    if (currentStreak > bestStreak) {
      bestStreak = currentStreak;
    }

    return {
      currentStreak,
      bestStreak,
      totalReviews,
      reviewedToday,
      dailyActivity,
    };
  }

  /**
   * Migrates card progress records when card IDs change (e.g. on file rename).
   */
  migrateCardIds(idMap: Map<string, string>): void {
    let changed = false;
    for (const [oldId, newId] of idMap.entries()) {
      if (this.data.progress[oldId] && oldId !== newId) {
        const record = this.data.progress[oldId];
        record.cardId = newId;
        this.data.progress[newId] = record;
        delete this.data.progress[oldId];
        changed = true;
      }
    }
    if (changed) {
      this.scheduleSave();
    }
  }

  /**
   * Cleans up orphaned card progress records no longer present in the vault.
   */
  pruneOrphanedCards(validCardIds: Set<string>): number {
    let prunedCount = 0;
    for (const id of Object.keys(this.data.progress)) {
      if (!validCardIds.has(id)) {
        delete this.data.progress[id];
        prunedCount++;
      }
    }
    if (prunedCount > 0) {
      this.scheduleSave();
    }
    return prunedCount;
  }

  /**
   * Returns all saved test presets.
   */
  getTestPresets(): TestPreset[] {
    if (!this.data.testPresets) {
      this.data.testPresets = {};
    }
    return Object.values(this.data.testPresets).sort((a, b) =>
      (b.lastRun || b.createdAt).localeCompare(a.lastRun || a.createdAt)
    );
  }

  getTestPreset(id: string): TestPreset | undefined {
    return this.data.testPresets?.[id];
  }

  saveTestPreset(preset: TestPreset): void {
    if (!this.data.testPresets) {
      this.data.testPresets = {};
    }
    this.data.testPresets[preset.id] = preset;
    this.scheduleSave();
  }

  deleteTestPreset(id: string): void {
    if (this.data.testPresets && this.data.testPresets[id]) {
      delete this.data.testPresets[id];
      this.scheduleSave();
    }
  }

  recordTestPresetRun(id: string): void {
    if (this.data.testPresets && this.data.testPresets[id]) {
      this.data.testPresets[id].runsCount = (this.data.testPresets[id].runsCount || 0) + 1;
      this.data.testPresets[id].lastRun = new Date().toISOString();
      this.scheduleSave();
    }
  }

  /**
   * Immediately flushes any debounced pending writes to disk.
   */
  async flush(): Promise<void> {
    if (this.saveTimeoutId !== null) {
      clearTimeout(this.saveTimeoutId as any);
      this.saveTimeoutId = null;
      try {
        await this.plugin.saveData(this.data);
      } catch (err) {
        console.error('SeeLearn: Failed to flush data on exit:', err);
      }
    }
  }

  async cleanup(): Promise<void> {
    await this.flush();
  }
}


