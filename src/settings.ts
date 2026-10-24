import { App, PluginSettingTab, Setting } from 'obsidian';
import type SeeLearnPlugin from './main';
import { RevealMode } from './types';

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
  }
}
