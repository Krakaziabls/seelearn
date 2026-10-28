---
description: Правила работы с Obsidian API, файловой системой и жизненным циклом компонентов
globs: ["src/**/*.ts", "src/**/*.tsx"]
---

# Obsidian API Constraints

1. **Source of Truth:**
   - Всегда сверяйся с `node_modules/obsidian/obsidian.d.ts` перед вызовом методов API.
   - Не придумывай несуществующие сигнатуры методов или свойства классов Obsidian.

2. **Запрет на прямое использование Node.js FS:**
   - Строго запрещено импортировать и вызывать `fs`, `fs/promises` или `path` внутри модулей плагина.
   - Для всех операций с файлами и папками хранилища используй `this.app.vault`, `this.app.vault.adapter` и утилиту `normalizePath()`.
   - Для данных плагина используй нативные методы `loadData()` и `saveData()` класса `Plugin`.

3. **Работа с Frontmatter и метаданными:**
   - Никогда не парси YAML-фронтматтер и теги заметок регулярными выражениями вручную при наличии файла в кэше.
   - Читай метаданные через `this.app.metadataCache.getFileCache(file)`.
   - Если требуется модифицировать фронтматтер, используй нативное API `this.app.fileManager.processFrontMatter(file, (fm) => { ... })`.

4. **Рендеринг Markdown (MarkdownRenderer):**
   - Для рендеринга Markdown-контента внутри UI (карточки, предпросмотр, модалки) обязательно используй `MarkdownRenderer.render(this.app, markdown, containerEl, sourcePath, component)`.
   - Всегда передавай валидный экземпляр `Component` (или `ItemView` / `Modal`), к которому привязан жизненный цикл рендеринга, чтобы исключить утечки памяти и зависшие DOM-слушатели при размонтировании.

5. **Очистка ресурсов и Lifecycle:**
   - Все подписки на события Obsidian оборачивай в `this.registerEvent()`.
   - Все DOM-слушатели оборачивай в `this.registerDomEvent()`.
   - Все таймеры и интервалы оборачивай в `this.registerInterval()`.
