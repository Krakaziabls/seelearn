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
    return `> [!INFO] Добро пожаловать в SeeLearn
> Интерактивная система интервального повторения (**Spaced Repetition System / SM-2**), встроенная прямо в ваши заметки Obsidian с соблюдением принципа **Zero Note Pollution** — ваши файлы не загрязняются служебными ID и метаданными.

---

## ⚡ Быстрый старт: подключение заметок

Чтобы SeeLearn проиндексировал карточки из файла, добавьте в его свойства (**Frontmatter**) триггерный тег:

\`\`\`yaml
---
tags:
  - seelearn
topics:
  - Анатомия
  - Биология
---
\`\`\`

- **\`tags: seelearn\`** — обязательное свойство, разрешающее плагину сканировать этот документ на наличие карточек.
- **\`topics\`** — глобальные темы заметки. Позволяют фильтровать карточки в шапке плагина при подготовке к сессии.

---

## 🃏 Каталог типов карточек

| № | Тип карточки | Синтаксис | Видимость в Reading View | Назначение |
|---|---|---|---|---|
| **01** | **Двусторонняя в комментариях** | \`%% @card ... @front ... @back ... @end %%\` | 🙈 Полностью скрыта | Обычные конспекты без визуального шума |
| **02** | **Открытая двусторонняя** | \`@card ... @front ... @back ... @end\` | 📖 Видна в тексте | Отдельные файлы-словари или списки вопросов |
| **03** | **Пропуск Cloze (Multi-cloze)** | \`{{c1::ответ}}\`, \`{{c1::ответ::подсказка}}\` | 📖 Видна (как обычный текст) | Заучивание терминов, дат и фактов в контексте |
| **04** | **Быстрый пропуск (Highlight)** | \`==текст для запоминания==\` | 📖 Видна с подсветкой | Моментальное создание карты прямо при чтении |
| **05** | **Полная приватность (%%%%)** | \`%%%% ... @card ... @end %%%%\` | 🙈 Полностью скрыта | Секретные вопросы, шпоры, экзаменационные билеты |

---

### 01 · Двусторонняя карточка в комментариях (Рекомендуется)
> [!TIP] Когда использовать
> Идеально для конспектов лекций и книг. При обычном чтении конспекта в режиме Reading View разметка карточки невидима.

\`\`\`markdown
%% @card #цитология %%
%% @front %%
Какова главная энергетическая функция **митохондрий**?
%% @back %%
Синтез молекул **АТФ** в процессе клеточного дыхания.
%% @end %%
\`\`\`

- **Вопрос:** Текст блока \`%% @front %%\`
- **Ответ:** Текст блока \`%% @back %%\`

---

### 02 · Открытая двусторонняя карточка
> [!NOTE] Когда использовать
> Удобно для профильных файлов с карточками (деки, глоссарии, словари), где вы хотите видеть вопросы и ответы невооруженным глазом.

\`\`\`markdown
@card #горы id::geo-everest
@front
Какая горная вершина является высочайшей точкой Земли?
@back
**Джомолунгма (Эверест)** — 8848 метров над уровнем моря.
@end
\`\`\`

- Опциональный атрибут \`id:: custom-id\` фиксирует постоянный ID карты даже при перемещении между файлами.
- Теги на строке \`@card\` (\`#тег\`, \`topic:: Тема\`) объединяются с темами из frontmatter.

---

### 03 · Карточки с пропусками (Cloze Deletions)
> [!TIP] Когда использовать
> Заучивание определений и списков прямо в потоке предложений. Блоки \`@front\` и \`@back\` не требуются!

\`\`\`markdown
%% @card #столицы %%
Столицей Норвегии является {{c1::Осло}}, а столицей Финляндии — {{c2::Хельсинки::столица Суоми}}.
%% @end %%
\`\`\`

- **Мульти-пропуск:** если в тексте указаны \`c1\` и \`c2\`, SeeLearn автоматически сгенерирует **две независимые карточки**:
  1. Первая скроет \`Осло\`, оставив \`Хельсинки\` открытым.
  2. Вторая скроет \`Хельсинки\` с подсказкой \`[столица Суоми]\`.
- Прогресс по \`c1\` и \`c2\` отслеживается отдельно в алгоритме повторения.
- При необходимости можно дописать блок \`%% @back %%\`, чтобы показать развернутое объяснение или диаграмму после раскрытия ответа.

---

### 04 · Быстрый пропуск через подсветку \`==...==\`
> [!NOTE] Когда использовать
> Самый быстрый способ превратить конспект в тест. Просто выделите ключевое слово маркером Obsidian:

\`\`\`markdown
%% @card #химия %%
Химическая формула чистой воды — это ==H2O==.
%% @end %%
\`\`\`

- Автоматически работает как пропуск первого уровня (\`c1\`).

---

### 05 · Полная приватность в Reading View (\`%%%% ... %%%%\`)
> [!TIP] Когда использовать
> Четыре знака процента создают изолированный контейнер. Вся карточка (вопрос, ответ, формулы) полностью исчезает из режима чтения Obsidian, оставаясь доступной только в плагине SeeLearn.

\`\`\`markdown
%%%%
@card #экзамен
@front
Какой закон термодинамики формулирует невозможность вечного двигателя 2-го рода?
@back
Второй закон термодинамики (закон возрастания энтропии).
@end
%%%%
\`\`\`

---

## ⌨️ Горячие клавиши управления

| Клавиша | Режим «Ботать» | Режим «Проверка знаний» (SRS) | В лобби |
|---|---|---|---|
| \`Пробел\` | Перевернуть карту / Следующая | Показать ответ | Начать изучение |
| \`Enter\` | — | — | Начать изучение |
| \`←\` / \`→\` | Предыдущая / Следующая карта | Предыдущая / Следующая карта | — |
| \`1\` | — | Оценка **[1] Снова** (Again) | — |
| \`2\` | — | Оценка **[2] Трудно** (Hard) | — |
| \`3\` | — | Оценка **[3] Хорошо** (Good) | — |
| \`4\` | — | Оценка **[4] Легко** (Easy) | — |
| \`Ctrl+Z\` / \`Cmd+Z\` | Отмена действия (Undo) | Отмена последней оценки (Undo) | — |

---

## 🧠 Методология интервального повторения (SM-2)

SeeLearn использует математическую модель SuperMemo-2 (**SM-2**) на базе кривой забывания Эббингауза.

### Структура очереди:
- **Новые (New)**: карточки, которые вы еще ни разу не оценивали в режиме проверки знаний.
- **К повторению (Due)**: карточки, у которых подошла запланированная дата очередного повтора (Дата повтора $\\le$ Сегодня).

### Оценки сложности и поведение интервалов:

> [!EXAMPLE] [1] Снова (Again) — *Клавиша 1*
> - **Смысл:** Материал полностью забыт.
> - **Интервал:** Сбрасывается на **1 день**.
> - **Фактор легкости (Ease Factor):** Штраф **-0.20** (минимум 1.30).
> - **Сессия:** Карточка возвращается в текущую сессию через **N шагов** (\`requeueStep\`, по умолчанию через 3 карточки) для закрепления прямо сейчас.
> - **Ошибки:** Счётчик ошибок (lapses) увеличивается на +1.

> [!NOTE] [2] Трудно (Hard) — *Клавиша 2*
> - **Смысл:** Вспомнили с заметным усилием или паузой.
> - **Интервал:** Увеличивается с замедленным коэффициентом: $\\text{Новый интервал} = \\text{Интервал} \\times 1.2$.
> - **Фактор легкости:** Легкий штраф **-0.15**.

> [!TIP] [3] Хорошо (Good) — *Клавиша 3*
> - **Смысл:** Уверенный, спокойный ответ по графику.
> - **Интервал:** Стандартный рост SM-2: $\\text{Новый интервал} = \\text{Интервал} \\times \\text{Ease Factor}$.
> - **Фактор легкости:** Сохраняется без изменений.

> [!INFO] [4] Легко (Easy) — *Клавиша 4*
> - **Смысл:** Мгновенный, очевидный ответ.
> - **Интервал:** Ускоренный рост: $\\text{Новый интервал} = \\text{Интервал} \\times \\text{Ease Factor} \\times 1.3$.
> - **Фактор легкости:** Бонус к легкости **+0.15**.

---

### ⚡ Карточки-пиявки (Leech)

Если карточка забывается **4 и более раз** (настраиваемый порог \`leechThreshold\`), алгоритм помечает её статусом **«Пиявка» (Leech)**.

> [!WARNING] Внимание: Пиявка!
> «Пиявка» — сигнал алгоритма о том, что формулировка карточки дефектна: вопрос слишком широкий, двусмысленный или перегружен деталями.
>
> **Как обезвредить пиявку:**
> 1. Нажмите кнопку **«Изменить»** в карточке, чтобы открыть заметку.
> 2. Разбейте сложную карту на **2–3 простых атомарных вопроса**.
> 3. Переведите длинное определение в формат **Cloze-пропуска** (\`{{c1::...}}\`).
> 4. Добавьте мнемоническую ассоциацию или подсказку в блок \`{{c1::ответ::подсказка}}\`.
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
