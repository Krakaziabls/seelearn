import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type SeeLearnPlugin from './main';
import { CardSizePreset, RevealMode } from './types';

export class SeeLearnSettingTab extends PluginSettingTab {
  plugin: SeeLearnPlugin;

  constructor(app: App, plugin: SeeLearnPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Настройки SeeLearn' });

    new Setting(containerEl)
      .setName('Trigger Property Name')
      .setDesc('Имя свойства в YAML Frontmatter, в котором плагин ищет управляющий тег (по умолчанию: tags).')
      .addText((text) =>
        text
          .setPlaceholder('tags')
          .setValue(this.plugin.settings.triggerProperty)
          .onChange(async (value) => {
            this.plugin.settings.triggerProperty = value.trim() || 'tags';
            await this.plugin.saveSettings();
            await this.plugin.reloadAllCards();
          })
      );

    new Setting(containerEl)
      .setName('Trigger Value / Tag')
      .setDesc('Значение тега или свойства, активирующее индексацию файла (можно с # или без, по умолчанию: seelearn).')
      .addText((text) =>
        text
          .setPlaceholder('seelearn')
          .setValue(this.plugin.settings.triggerValue)
          .onChange(async (value) => {
            this.plugin.settings.triggerValue = value.trim() || 'seelearn';
            await this.plugin.saveSettings();
            await this.plugin.reloadAllCards();
          })
      );

    new Setting(containerEl)
      .setName('Topic Property Name')
      .setDesc('Имя свойства в Frontmatter, откуда карточки файла наследуют глобальные темы (по умолчанию: topics).')
      .addText((text) =>
        text
          .setPlaceholder('topics')
          .setValue(this.plugin.settings.topicProperty)
          .onChange(async (value) => {
            this.plugin.settings.topicProperty = value.trim() || 'topics';
            await this.plugin.saveSettings();
            await this.plugin.reloadAllCards();
          })
      );

    new Setting(containerEl)
      .setName('Режим обучения по умолчанию (Default Study Mode)')
      .setDesc('Выберите режим по умолчанию: «Ботать» (изучение и просмотр без оценок) или «Проверить знания» (SM-2 интервальное тестирование).')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('learn', 'Ботать (Изучение и чтение карточек без оценок - по умолчанию)')
          .addOption('test', 'Проверить знания (Интервальное повторение SM-2, оценки 1-4)')
          .addOption('srs', 'SM-2 Интервальное повторение (классический режим)')
          .addOption('cram', 'Свободная зубрежка (Cram Mode: Повторить позже / Знаю)')
          .setValue(this.plugin.settings.studyMode)
          .onChange(async (value: string) => {
            this.plugin.settings.studyMode = value as any;
            await this.plugin.saveSettings();
            this.plugin.reloadAllCards();
          })
      );

    new Setting(containerEl)
      .setName('3D-анимация переворота (3D Flip)')
      .setDesc('Включить плавную 3D-анимацию переворота карточки при показе ответа.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enable3DFlip)
          .onChange(async (value) => {
            this.plugin.settings.enable3DFlip = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Режим показа ответа (Reveal Mode)')
      .setDesc('Выберите, как отображать оборотную сторону карточки (@back).')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('append', 'Показывать ответ под вопросом через разделитель')
          .addOption('replace', 'Заменять вопрос ответом при перевороте')
          .setValue(this.plugin.settings.revealMode)
          .onChange(async (value: string) => {
            this.plugin.settings.revealMode = value as RevealMode;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Переворот клавишей Пробел (Space)')
      .setDesc('Разрешить переворачивать карточку и переходить к следующей клавишей Пробел.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoFlipOnSpace)
          .onChange(async (value) => {
            this.plugin.settings.autoFlipOnSpace = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl('h3', { text: 'Размеры карточек (Card Sizing)' });

    new Setting(containerEl)
      .setName('Свойство размера карточки в файле (Card Size Property Name)')
      .setDesc('Имя свойства в YAML Frontmatter, определяющее размер карточек для всего файла (по умолчанию: card_size).')
      .addText((text) =>
        text
          .setPlaceholder('card_size')
          .setValue(this.plugin.settings.cardSizeProperty || 'card_size')
          .onChange(async (value) => {
            this.plugin.settings.cardSizeProperty = value.trim() || 'card_size';
            await this.plugin.saveSettings();
            await this.plugin.reloadAllCards();
          })
      );

    new Setting(containerEl)
      .setName('Размер карточек по умолчанию (Default Card Size)')
      .setDesc('Размер отображения для всех карточек, у которых не задан явный @size: или свойство в файле.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('xs', 'Очень маленький (XS: 480x340)')
          .addOption('s', 'Маленький (S: 560x400)')
          .addOption('m', 'Стандартный / размер лобби (M: 640x460 - по умолчанию)')
          .addOption('l', 'Большой (L: 730x520)')
          .addOption('xl', 'Очень большой (XL: 820x580)')
          .addOption('full', 'Во весь экран (Full)')
          .setValue(this.plugin.settings.defaultCardSize || 'm')
          .onChange(async (value: string) => {
            this.plugin.settings.defaultCardSize = value as CardSizePreset;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Сбросить сохранённые размеры карточек')
      .setDesc('Сбросить кастомные размеры карточек, измененные вручную во время сессий, вернув их к текущему дефолтному размеру плагина.')
      .addButton((button) =>
        button
          .setButtonText('Сбросить размеры')
          .onClick(async () => {
            const count = this.plugin.storage.clearAllCardSizes();
            new Notice(`SeeLearn: сброшены индивидуальные размеры для ${count} карточек.`);
          })
      );

    containerEl.createEl('h3', { text: 'Управление сессией и алгоритмы SRS' });

    new Setting(containerEl)
      .setName('Лимит карточек на сессию по умолчанию')
      .setDesc('Ограничение количества карточек для одной учебной сессии (число, например 20, или "all" для прохождения всех доступных карт).')
      .addText((text) =>
        text
          .setPlaceholder('all')
          .setValue(String(this.plugin.settings.sessionCardLimit ?? 'all'))
          .onChange(async (val) => {
            const trimmed = val.trim();
            if (!trimmed || trimmed.toLowerCase() === 'all') {
              this.plugin.settings.sessionCardLimit = 'all';
            } else {
              const parsed = parseInt(trimmed, 10);
              if (!isNaN(parsed) && parsed > 0) {
                this.plugin.settings.sessionCardLimit = parsed;
              }
            }
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Лимит новых карт за сессию')
      .setDesc('Максимальное количество новых карточек для включения в одну учебную сессию.')
      .addText((text) =>
        text
          .setPlaceholder('25')
          .setValue(String(this.plugin.settings.maxNewPerSession || 25))
          .onChange(async (val) => {
            const parsed = parseInt(val, 10);
            this.plugin.settings.maxNewPerSession = !isNaN(parsed) && parsed > 0 ? parsed : 25;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Лимит карт к повторению (Due) за сессию')
      .setDesc('Максимальное количество созревших для повторения карточек за одну сессию.')
      .addText((text) =>
        text
          .setPlaceholder('50')
          .setValue(String(this.plugin.settings.maxDuePerSession || 50))
          .onChange(async (val) => {
            const parsed = parseInt(val, 10);
            this.plugin.settings.maxDuePerSession = !isNaN(parsed) && parsed > 0 ? parsed : 50;
            await this.plugin.saveSettings();
          })
      );


    new Setting(containerEl)
      .setName('Перемешивать карточки в начале сессии')
      .setDesc('Автоматически перемешивать очередь при запуске или смене фильтра по алгоритму Фишера-Йетса.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.shuffleOnStart)
          .onChange(async (value) => {
            this.plugin.settings.shuffleOnStart = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Чередование тем (Topic Interleaving)')
      .setDesc('Предотвращать скопление карточек одной темы подряд при перемешивании.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.interleaveTopics)
          .onChange(async (value) => {
            this.plugin.settings.interleaveTopics = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Шаг повтора отложенной карты (Requeue Step)')
      .setDesc('Через сколько карточек возвращать отложенную карту при нажатии «Повторить позже» (по умолчанию: 3).')
      .addSlider((slider) =>
        slider
          .setLimits(1, 10, 1)
          .setValue(this.plugin.settings.requeueStep)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.requeueStep = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Порог детектора пиявок (Leech Threshold)')
      .setDesc('Количество ошибок (нажатий «Снова»), после которого карточка помечается как пиявка (по умолчанию: 4).')
      .addSlider((slider) =>
        slider
          .setLimits(2, 10, 1)
          .setValue(this.plugin.settings.leechThreshold || 4)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.leechThreshold = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Поддержка карточек с пропусками (Cloze Deletions)')
      .setDesc('Автоматически распознавать синтаксис {{c1::ответ}} и ==выделенный текст== как карточки с заполнением пропусков.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableCloze)
          .onChange(async (value) => {
            this.plugin.settings.enableCloze = value;
            await this.plugin.saveSettings();
            await this.plugin.reloadAllCards();
          })
      );

    new Setting(containerEl)
      .setName('Формат шаблона карточки по умолчанию')
      .setDesc('Формат вставки шаблона по горячей клавише: в комментариях (%% @card %% ... %% @end %%) или открытым текстом.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('comment', 'В комментариях (%% @card %% ... %%) — скрыто в режиме чтения')
          .addOption('plain', 'Открытый текст (@card ... @end)')
          .setValue(this.plugin.settings.templateStyle || 'comment')
          .onChange(async (value: string) => {
            this.plugin.settings.templateStyle = value as any;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl('h3', { text: 'Хранилище данных и статистика' });

    const stats = this.plugin.storage.getStats();
    const statsDesc = `Всего отслеживаемых карточек: ${stats.totalTracked} | Повторено сегодня: ${stats.reviewedToday} | Забываний (Lapses): ${stats.totalLapses}`;
    new Setting(containerEl)
      .setName('Статистика прогресса (data.json)')
      .setDesc(statsDesc);

    new Setting(containerEl)
      .setName('Принудительное переиндексирование')
      .setDesc('Заново просканировать все файлы хранилища и обновить колоду карточек.')
      .addButton((button) =>
        button
          .setButtonText('Переиндексировать сейчас')
          .setCta()
          .onClick(async () => {
            await this.plugin.reloadAllCards();
          })
      );

    new Setting(containerEl)
      .setName('Очистить устаревшие карточки (Garbage Collection)')
      .setDesc('Удалить из data.json прогресс карточек, которые были удалены или больше не существуют в заметках.')
      .addButton((button) =>
        button
          .setButtonText('Очистить кэш')
          .onClick(async () => {
            const validIds = new Set(this.plugin.cards.map((c) => c.id));
            const count = this.plugin.storage.pruneOrphanedCards(validIds);
            new Notice(`SeeLearn: удалено ${count} устаревших записей из data.json`);
            this.display(); // Refresh settings tab stats
          })
      );
  }
}

