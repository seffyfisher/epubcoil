# epub.co.il

_Hebrew knowledge hub and free in-browser tools for digital books (EPUB). Astro 5, static, content in Markdown/YAML._

מדריך עברי לספרים דיגיטליים, EPUB, הפקה, קריאה ועבודה מימין לשמאל.

## הפעלה

דרוש Node 20.3 ומעלה (ב־CI משתמשים ב־22, ראו `.node-version`).

```sh
npm install
npm run dev       # שרת פיתוח
npm run build     # astro build ואז אינדקס חיפוש של Pagefind
npm run preview   # הצגת dist מקומית
```

## מבנה

- `src/content/articles/<section>/<slug>.md` — מאמרים. `src/content/glossary/<slug>.md` — מילון.
- `src/data/resources/*.yaml` — רשימות המשאבים (קישורים, תוכנות, ניסויים, דמויות מובילות, ספקים).
- `src/pages/` — תבניות העמודים, `rss.xml`, `llms.txt`, `llms-full.txt`, תמונת OG.
- `src/pages/tools/` ו־`src/scripts/` — בודק ה־EPUB והצ'קליסט. ה־JavaScript נטען רק בעמודי הכלים.
- `public/reader/` — קורא ה־EPUB (גרסה 2, foliate-js), אפליקציית PWA סטטית. המקור מתוחזק בענף `feature/reader-v2` (תיקייה `reader/`) ומועתק לכאן כמו שהוא; אחרי שינוי בקורא יש להעלות את `VERSION` ב־`reader/sw.js`.

## הוספת מאמר

העתיקו את `src/content/articles/_template.md.example` אל `src/content/articles/<section>/<slug>.md`. שדות ה־frontmatter:

|שדה|סוג|הערה|
|---|---|---|
|title, description, answer|string|התיאור רצוי באורך 120–160 תווים|
|section|enum|basics, reading, hebrew, production, design, css, js, experiments|
|order|number|סדר במדור|
|published, updated|date|YYYY-MM-DD|
|faq|מערך `{q,a}`|3–6 שאלות כשיש FAQ|
|sources|מערך `{title,url}`|לפחות מקור אחד|
|related|מערך `section/slug`|אופציונלי|
|howto|object|`name`, `steps[{name,text}]`|
|tags|מערך מחרוזות|אופציונלי|
|draft, featured|boolean|אופציונלי|
|needsReview|מערך מחרוזות|פרטים לבדיקה|

## מילון ומשאבים

להוספת מונח העתיקו את `src/content/glossary/_template.md.example`; השדות הם `term`, `termEn`, `short`, `related`, `sources`, `updated`, `needsReview`, `draft`.

הוסיפו אובייקט אחד למערך YAML המתאים ב־`src/data/resources/`: בכל הרשימות `id`, `url`, `checked`; בקישורים: `title`, `description`, `category`, `region`, `lang`; בתוכנות: `name`, `description`, `category`, `platforms`, `pricing`, `openSource`, `rtlNotes`; בניסויים: `title`, `description`, `kind`, `creator`, `year`; בדמויות: `name`, `kind`, `region`, `why`; בספקים: `name`, `services`, `city`, `description`, `sourceUrl`.

דוח הבדיקה נוצר ב־`dist/_review.json` ומכיל טיוטות, תיאורים חריגים, קישורים פנימיים חסרים וסימוני בדיקה.

## פריסה

ב־GitHub Pages יש לבחור מקור **GitHub Actions**. קובץ ה־workflow נמצא כרגע ב־`ops/github-pages-deploy.yml` ויש להעביר אותו אל `.github/workflows/deploy.yml` (מופעל רק ב־push ל־main וב־workflow_dispatch). ב־Cloudflare Pages: פקודת build היא `npm run build`, ספריית הפלט היא `dist`, ו־`NODE_VERSION` הוא `22`.
