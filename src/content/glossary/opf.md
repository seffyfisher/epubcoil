---
term: "מסמך חבילה"
termEn: "Package Document (OPF)"
short: "קובץ XML ב־EPUB המתאר את המטא־דאטה, המשאבים וסדר הקריאה של הפרסום."
related: [basics/epub-file-structure, glossary/epub, glossary/spine, glossary/nav-document]
sources:
  - title: "EPUB 3.3 — Package document"
    url: "https://www.w3.org/TR/epub-33/#sec-package-doc"
updated: 2026-10-24
---

OPF הוא השם המקובל למסמך החבילה של EPUB, בדרך כלל קובץ עם הסיומת `.opf`. הוא נקודת התיאור המרכזית של הספר: ב-`metadata` נמצאים פרטים כגון כותרת ושפה, ב-`manifest` רשומים המשאבים, וב-`spine` נקבע סדר הקריאה.

הקורא אינו אמור לנחש אילו קבצים שייכים לספר. stylesheet, תמונה, גופן ומסמך XHTML שנעשה בהם שימוש צריכים להופיע ב־manifest. מסמך ניווט מקבל גם את המאפיין `nav` ברשומת ה־item שלו. מיקום ה־OPF עצמו נמצא דרך `META-INF/container.xml`.

```xml
<package version="3.0" unique-identifier="book-id">
  <metadata><dc:language>he</dc:language></metadata>
  <manifest>...</manifest>
  <spine>...</spine>
</package>
```

קובץ OPF מסודר מפשט איתור תקלות, אך יש לבדוק גם שהנתיבים וה־media types של המשאבים נכונים.

ב־EPUB אחד יכול להיות יותר ממסמך XML, אך ה־OPF הוא המסמך שמחבר בין החלקים לצורך פרסום. שינוי שם של קובץ או העברת תמונה מחייבים לעדכן את ההפניה הרלוונטית. כלי ולידציה יכול למצוא חלק מן הפערים האלה לפני פתיחה בקורא.

הבנת OPF מועילה גם כאשר משתמשים בתוכנת יצוא, מפני שהודעות שגיאה רבות מפנות לרכיביו.

לפני הפצה בדקו שהמטא־דאטה מתאר את הספר הנכון ולא טיוטה ישנה.

שמרו את ה־OPF יחד עם המקור, כדי שכל יצוא יהיה ניתן לשחזור ולבדיקה.
