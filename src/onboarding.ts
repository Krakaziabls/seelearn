import type { App, TFile } from 'obsidian';

function isTFile(file: unknown): file is TFile {
  return file != null && typeof (file as TFile).extension === 'string';
}

/**
 * Manages first-run onboarding, demo note generation, and the persistent cheatsheet.
 */
export class OnboardingManager {
  public static readonly EXAMPLES_DIR = 'SeeLearn Examples';
  public static readonly CHEATSHEET_FILE = 'SeeLearn Examples/Шпаргалка SeeLearn — Синтаксис и Методология.md';
  public static readonly DEMO_NOTE_1 = 'SeeLearn Examples/Пример — Биология клетки.md';
  public static readonly DEMO_NOTE_2 = 'SeeLearn Examples/Пример — Столицы и Факты.md';

  /**
   * Generates the comprehensive cheatsheet content.
   * NOTE: Deliberately omits #seelearn in body/frontmatter to avoid parsing as study cards.
   */
  public static getCheatsheetMarkdownContent(): string {
    return `# Шпаргалка SeeLearn — Синтаксис и Методология

Добро пожаловать в **SeeLearn** — систему интервального повторения (SRS), встроенную прямо в ваши заметки Obsidian!

Эта заметка является постоянным справочником по синтаксису создания карточек и методологии интервального повторения.

> [!TIP] Обратите внимание
> В этой шпаргалке намеренно **нет** тега подключения, поэтому сама она не добавляется в колоду для заучивания.

---

## 1. Подключение заметок к SeeLearn

Чтобы плагин проиндексировал карточки из ваших заметок, добавьте метку SeeLearn в свойства (frontmatter) заметки:

\`\`\`yaml
---
tags:
  - seelearn
topics:
  - Биология
  - Цитология
---
\`\`\`

- **Свойство \`tags\`**: значение \`seelearn\` активирует поиск карточек в файле (настраивается в настройках плагина).
- **Свойство \`topics\`**: определяет глобальные темы для всех карточек заметки. Вы сможете фильтровать колоду по этим темам.

---

## 2. Поддерживаемый синтаксис карточек

SeeLearn поддерживает несколько удобных способов разметки карточек прямо в тексте ваших конспектов.

### А. Двусторонние карточки (@front / @back)

Вы можете использовать как чистый синтаксис, так и синтаксис внутри комментариев Obsidian (\`%% ... %%\`). Комментарии удобны тем, что маркеры карточки не видны при обычном чтении конспекта.

**Внутри комментариев (рекомендуется для конспектов):**
\`\`\`markdown
%% @card #цитология %%
%% @front %%
Какова основная функция митохондрий в клетке?
%% @back %%
Синтез АТФ (клеточное дыхание) и обеспечение клетки энергией.
%% @end %%
\`\`\`

**Открытый синтаксис (без комментариев):**
\`\`\`markdown
@card #цитология
@front
Какова основная функция митохондрий в клетке?
@back
Синтез АТФ (клеточное дыхание) и обеспечение клетки энергией.
@end
\`\`\`

---

### Б. Карточки с пропусками (Cloze Deletions)

Карточки с пропусками позволяют проверять знание терминов, дат и определений прямо в контексте предложений.

1. **Несколько пропусков (Multi-cloze):**
   \`\`\`markdown
   %% @card #столицы %%
   Столицей Франции является {{c1::Париж}}, а столицей Германии — {{c2::Берлин}}.
   %% @end %%
   \`\`\`
   *Плагин автоматически создаст две независимые карточки: для c1 и для c2.*

2. **Пропуски с подсказкой:**
   \`\`\`markdown
   %% @card #география %%
   Самая высокая вершина планеты — {{c1::Эверест::Джомолунгма (8848м)}}.
   %% @end %%
   \`\`\`

3. **Синтаксис подсветки (Markdown Highlights):**
   \`\`\`markdown
   %% @card #химия %%
   Формула воды — это ==H2O==.
   %% @end %%
   \`\`\`

4. **Cloze с дополнительным блоком @back:**
   Вы можете добавить блок \`@back\` к любой cloze-карточке, чтобы вывести пояснение или схему после открытия ответа.

---

### В. Полная приватность в Reading View (%%%% ... %%%%)

Если вы хотите, чтобы вся карточка (включая вопрос и ответ) была полностью скрыта при чтении конспекта в режиме Reading View, оберните её в четыре знака процента:

\`\`\`markdown
%%%%
@card #экзамен
@front
Секретный вопрос для подготовки к экзамену
@back
Развернутый ответ преподавателя
@end
%%%%
\`\`\`

---

## 3. Методология интервального повторения (SM-2)

SeeLearn использует модифицированный алгоритм **SuperMemo-2 (SM-2)**, рассчитывающий оптимальные интервалы для долговременного запоминания.

### Очередь повторения:
- **Новые (New)**: Карточки, которые вы еще ни разу не оценивали в режиме проверки знаний.
- **К повторению (Due)**: Карточки, у которых подошла дата очередного повторения. Повторяйте их ежедневно для удержания в памяти.

### Оценки карточек (горячие клавиши 1–4):

1. **[1] Снова (Again)** — *Клавиша 1*:
   - Полный сброс текущего интервала (интервал сбрасывается на 1 день).
   - Штраф к фактору легкости (Ease Factor снижается на 0.20).
   - Карточка вернется в текущую учебную сессию через N шагов (параметр \`requeueStep\`), чтобы вы закрепили материал прямо сейчас.
   - Увеличивается счетчик ошибок карточки.

2. **[2] Трудно (Hard)** — *Клавиша 2*:
   - Ответ дан с трудом или с долгим воспоминанием.
   - Интервал увеличивается с небольшим множителем (в 1.2 раза).
   - Легкий штраф к фактору легкости (Ease Factor снижается на 0.15).

3. **[3] Хорошо (Good)** — *Клавиша 3*:
   - Стандартный успешный ответ по алгоритму SM-2.
   - Интервал рассчитывается как: \`Новый интервал = Старый интервал × Фактор легкости\`.
   - Фактор легкости сохраняется без изменений.

4. **[4] Легко (Easy)** — *Клавиша 4*:
   - Ответ дан мгновенно и без колебаний.
   - Интервал получает дополнительный бонус: \`Новый интервал = Старый интервал × Фактор легкости × 1.3\`.
   - Фактор легкости повышается (Ease Factor увеличивается на 0.15).

---

### Что такое карточки-«Пиявки» (Leech)?

Если вы ошибаетесь на карточке несколько раз подряд (по умолчанию 4 раза, настраивается параметром \`leechThreshold\`), карточка получает статус **«Пиявка» (Leech)** и помечается специальным бейджем.

> [!WARNING] Внимание: Пиявка!
> «Пиявка» означает, что карточка забирает непропорционально много времени, но не запоминается.
> **Что делать с пиявкой:**
> 1. Откройте исходную заметку, кликнув на заголовок карточки.
> 2. Упростите формулировку: разбейте сложный вопрос на 2–3 атомарных карточки.
> 3. Добавьте яркую ассоциацию, подсказку или мнемоническое правило.
`;
  }

  /**
   * Generates demo note 1: Biology / Cell.
   */
  public static getDemoNote1Content(): string {
    return `---
tags:
  - seelearn
topics:
  - Биология
  - Цитология
---

# Пример — Биология клетки

Эта заметка создана автоматически плагином SeeLearn в качестве демонстрации. Вы можете смело редактировать её или использовать в качестве образца для своих конспектов.

## 1. Строение клетки и органоиды

Ниже пример стандартной двусторонней карточки, спрятанной внутри комментариев Obsidian. Она не мешает чтению конспекта!

%% @card #митохондрии %%
%% @front %%
Какова главная энергетическая функция **митохондрий** в эукариотической клетке?
%% @back %%
Синтез молекул **АТФ** (аденозинтрифосфата) в процессе клеточного дыхания и окислительного фосфорилирования.
%% @end %%

---

## 2. Генетический материал клетки

А это пример карточки с пропуском (**Cloze Deletion**) и встроенной подсказкой.

%% @card #генетика %%
В ядре клетки содержится {{c1::ДНК::дезоксирибонуклеиновая кислота}}, хранящая наследственную информацию организма.
%% @back %%
Молекула ДНК упакована в хроматин с помощью специальных белков — гистонов.
%% @end %%

---

## 3. Синтез белка

Пример карточки с пропуском через синтаксис подсветки (Markdown Highlights):

%% @card #рибосомы %%
Рибосомы отвечают за ==трансляцию информационной РНК в полипептидную цепь белка==.
%% @end %%
`;
  }

  /**
   * Generates demo note 2: Capitals & World Facts.
   */
  public static getDemoNote2Content(): string {
    return `---
tags:
  - seelearn
topics:
  - География
  - Страны
---

# Пример — Столицы и Факты

Вторая демонстрационная заметка с примерами продвинутых карточек SeeLearn.

## 1. Европейские столицы (Мульти-пропуск)

Одна карточка с двумя пропусками автоматически создаст **две разные карточки** в колоде:

%% @card #европа %%
Столицей Норвегии является {{c1::Осло}}, а столицей Финляндии — {{c2::Хельсинки}}.
%% @end %%

---

## 2. Открытая карточка с явным ID

Карточка в открытом формате (без символов процента) и с постоянным идентификатором:

@card #горы id::geo-everest
@front
Какая горная вершина является высочайшей точкой Земли над уровнем моря и какова её высота?
@back
**Джомолунгма (Эверест)** — 8848 метров над уровнем моря на границе Непала и Китая.
@end

---

## 3. Карточка со скрытием в Reading View (%%%% ... %%%%)

Эта карточка полностью скрыта при переключении заметки в режим чтения (Reading View):

%%%%
@card #рекорды
@front
Какая река признана самой полноводной и длинной в мире по современным гидрологическим данным?
@back
**Амазонка** (длина свыше 6992 км, бассейн более 7 млн км²).
@end
%%%%
`;
  }

  /**
   * Ensures that the 'SeeLearn Examples' directory and initial files exist.
   * Recreates the cheatsheet if it was deleted.
   */
  public static async ensureOnboardingAssets(app: App): Promise<TFile> {
    const { vault } = app;

    // 1. Ensure folder exists
    const existingFolder = vault.getAbstractFileByPath(OnboardingManager.EXAMPLES_DIR);
    if (!existingFolder) {
      try {
        await vault.createFolder(OnboardingManager.EXAMPLES_DIR);
      } catch {
        // Folder may have been created concurrently
      }
    }

    // 2. Ensure cheatsheet exists
    let cheatsheetFile = vault.getAbstractFileByPath(OnboardingManager.CHEATSHEET_FILE);
    if (!isTFile(cheatsheetFile)) {
      try {
        cheatsheetFile = await vault.create(
          OnboardingManager.CHEATSHEET_FILE,
          OnboardingManager.getCheatsheetMarkdownContent()
        );
      } catch {
        cheatsheetFile = vault.getAbstractFileByPath(OnboardingManager.CHEATSHEET_FILE);
      }
    }

    // 3. Ensure demo notes exist
    const demo1 = vault.getAbstractFileByPath(OnboardingManager.DEMO_NOTE_1);
    if (!isTFile(demo1)) {
      try {
        await vault.create(
          OnboardingManager.DEMO_NOTE_1,
          OnboardingManager.getDemoNote1Content()
        );
      } catch {
        // Ignore if created concurrently
      }
    }

    const demo2 = vault.getAbstractFileByPath(OnboardingManager.DEMO_NOTE_2);
    if (!isTFile(demo2)) {
      try {
        await vault.create(
          OnboardingManager.DEMO_NOTE_2,
          OnboardingManager.getDemoNote2Content()
        );
      } catch {
        // Ignore if created concurrently
      }
    }

    return cheatsheetFile as TFile;
  }

  /**
   * Opens the cheatsheet note in an editor tab.
   * If the cheatsheet is already open in a workspace leaf, activates and focuses that leaf.
   * If the file is missing, recreates it automatically before opening.
   */
  public static async openCheatsheetNote(app: App): Promise<void> {
    const cheatsheetFile = await OnboardingManager.ensureOnboardingAssets(app);
    if (!isTFile(cheatsheetFile)) return;

    // Check if an existing markdown leaf already has this cheatsheet open
    const markdownLeaves = app.workspace.getLeavesOfType('markdown');
    for (const leaf of markdownLeaves) {
      const view = leaf.view;
      if (view && 'file' in view && (view as any).file?.path === OnboardingManager.CHEATSHEET_FILE) {
        app.workspace.setActiveLeaf(leaf, { focus: true });
        return;
      }
    }

    // Otherwise, open in a new workspace tab
    const leaf = app.workspace.getLeaf('tab');
    await leaf.openFile(cheatsheetFile);
    app.workspace.setActiveLeaf(leaf, { focus: true });
  }
}
