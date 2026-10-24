# קורא EPUB — epub.co.il

קורא ספרים דיגיטליים (EPUB 2 / EPUB 3) עצמאי, מתקדם וניתן להתקנה כ־PWA עבור **epub.co.il**.
התיקייה `reader/` בנויה כתיקייה סטטית עצמאית לחלוטין (Self-contained) ללא צעד בנייה (No build step), ללא תלות ב־CDN חיצוני, ועם נתיבים יחסיים בלבד — כך שניתן להגיש אותה תחת כל נתיב בסיס (כגון `/reader/` או להעתיק אותה אל `public/reader/`).

## ארכיטקטורה ומבנה קבצים

- `reader/index.html` — מעטפת היישום (ספרייה, תצוגת קריאה, מגירות נשלפות, באנר שגיאות והתקנה).
- `reader/reader.css` — מערכת עיצוב מערכתית־ספרותית (Editorial), הגדרות `@font-face` עם `unicode-range` לגופנים עבריים ולטיניים (משקלים 400 ו־700), ערכות נושא (`light`, `sepia`, `dark`, `oled`, `auto`), ותמיכה מלאה ב־RTL/LTR.
- `reader/app.js` ו־`reader/storage.js` — נקודות כניסה ראשיות.
- `reader/js/app.js` — מתאם היישום הראשי (אירועים, פתיחת ספרים, קיצורי מקלדת, אזורי הקשה ומחזור חיים).
- `reader/js/engine.js` — מעטפת סביב `foliate-js` הכוללת טעינה עצלה (Lazy-loading), זיהוי כיווניות (`rtl`/`ltr`), ניווט מוגן (`next`/`prev`) שלעולם אינו נתקע, ונרמול אחוזי התקדמות עד `100%` בסוף הספר במצב עמודים ובמצב גלילה.
- `reader/js/storage.js` — שכבת האחסון המקומי (IndexedDB + localStorage + הגירה מ־v1).
- `reader/js/library.js` — ניהול תצוגת הספרייה ויצירת תמונות ממוזערות של כריכות הספרים (`book.getCover()`) באמצעות `createImageBitmap` ו־Canvas בפורמט WebP/JPEG ברוחב ~200px, עם חלופה טיפוגרפית (אות ראשונה של הכותרת) כשאין כריכה.
- `reader/js/settings.js` — ניהול הגדרות תצוגה וטיפוגרפיה והזרקת גופנים לתוך ה־iframe של הספר.
- `reader/js/errors.js` — בדיקת תקינות מקדימה (Preflight) באמצעות `vendor/foliate-js/vendor/zip.js` לזיהוי קבצים שאינם EPUB, ארכיוני ZIP פגומים/קטועים, וקובצי DRM ב־`META-INF/encryption.xml` (תוך התרת ערפול גופנים תקני של IDPF/Adobe).
- `reader/js/ui/drawers.js` — ניהול מגירות נגישות (`role="dialog"`, לכידת פוקוס, סגירה ב־`Escape`, החזרת פוקוס) ותצוגת תוכן עניינים היררכי.
- `reader/js/bookmarks.js` — הוספה, הסרה, הצגה ומעבר לסימניות.
- `reader/js/search.js` — חיפוש בטקסט הספר (כולל התעלמות מניקוד בעברית) עם הדגשת תוצאות ומעבר למיקום.
- `reader/js/pwa.js` — רישום Service Worker, עדכון גרסה, באנר התקנה, מסך מלא ו־Wake Lock.
- `reader/js/he.js` — מחרוזות הממשק בעברית.
- `reader/sw.js` — Service Worker השומר במטמון את מעטפת היישום, הגופנים, המנוע וספר ההדגמה לעבודה מלאה ללא חיבור (Offline).

## מודל האחסון

1. **IndexedDB (`epubcoil.reader.v2`, חנות אובייקטים `books`)**:
   - מפתח (`id`): גיבוב `SHA-256` של תוכן הקובץ (`crypto.subtle.digest`).
   - ערך: `{ id, blob, coverBlob, meta: { name, title, author, dir, size, openedAt } }`.
   - קובצי המשתמש לעולם אינם עוזבים את המכשיר ואינם נשמרים במטמון ה־Service Worker.
2. **localStorage**:
   - `epubcoil.reader.v2.settings`: הגדרות תצוגה גלובליות והספר האחרון שנפתח (`lastOpen`, `onLibrary`).
   - `epubcoil.reader.v2.book.<id>`: מצב קריאה לכל ספר (`cfi`, `fraction`, `sectionIndex`, `updatedAt`, `bookmarks`, `highlights`).
   - `epubcoil.reader.v2.migrated`: דגל הגירה חד־פעמית ובטוחה מהמפתח הישן `epubcoil.reader.v1`.

## הטמעה והגדרה (`public/reader/`)

העתיקו את תיקיית `reader/` כפי שהיא אל `public/reader/`.
כתובת ספר ההדגמה ברירת המחדל היא `../hebrew.epub`. ניתן לשנותה בשתי דרכים:
1. פרמטר בשורת הכתובת: `/reader/?book=/path/to/demo.epub`
2. תכונת HTML על אלמנט ה־`<html>` בקובץ `reader/index.html`: `data-demo-book="../hebrew.epub"`
