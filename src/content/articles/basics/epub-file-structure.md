---
title: "מבנה קובץ EPUB: מה יש בתוך הקובץ"
description: "מבנה קובץ EPUB: mimetype, container.xml, OPF, manifest, spine ומסמך ניווט, עם XHTML, CSS, גופנים ובדיקת אריזה לפני הפצה."
section: basics
order: 20
answer: "EPUB הוא ארכיון ZIP בעל מבנה מוסכם: קובץ mimetype ראשון ולא דחוס, container.xml שמפנה ל־OPF, ומסמכי תוכן ומשאבים המנויים במסמך החבילה. ה־manifest אומר מה נמצא בספר וה־spine אומר באיזה סדר לקרוא אותו."
published: 2026-10-24
updated: 2026-10-24
featured: true
faq:
  - q: "האם אפשר לשנות סיומת ZIP ל־EPUB?"
    a: "לא די בכך. EPUB זקוק למבנה מוגדר, לקובץ mimetype תקין, ל־container.xml ולמסמך חבילה שמפנה לכל המשאבים."
  - q: "מה ההבדל בין manifest ל־spine?"
    a: "ה־manifest הוא מלאי המשאבים; ה־spine הוא סדר הקריאה של פריטי תוכן מן המלאי."
  - q: "למה mimetype חייב להיות ראשון ולא דחוס?"
    a: "מפרט עיבוד OCF מגדיר זאת עבור מיכל ZIP של EPUB. אריזה אחרת עלולה לגרום לכלים או לקוראים לדחות את הקובץ."
  - q: "האם כל קובץ XHTML חייב להיכלל ב־spine?"
    a: "לא בהכרח. משאב יכול להיות ב־manifest בלי להיות חלק מסדר הקריאה הראשי, למשל עמוד עזר או קובץ ניווט."
sources:
  - title: "EPUB 3.3 — W3C Recommendation"
    url: "https://www.w3.org/TR/epub-33/"
  - title: "EPUB Reading Systems 3.3 — W3C Recommendation"
    url: "https://www.w3.org/TR/epub-rs-33/"
related:
  - basics/what-is-epub
  - production/epubcheck
  - production/metadata
  - production/toc-nav
tags: [epub, opf, ocf, manifest, spine, xhtml]
needsReview:
  - "פקודות האריזה מתאימות ל־Info-ZIP; יש לאמת את התחביר ואת תוצאת הארכיון מול כלי ה־ZIP המדויק שבו משתמש תהליך ההפקה."
---

קובץ EPUB תקין הוא ZIP עם כמה כללים שאי אפשר לראות רק לפי הסיומת. בראשו קובץ `mimetype` לא דחוס, בתוכו `META-INF/container.xml` שמצביע אל מסמך חבילה, ובשאר התיקיות XHTML, CSS, תמונות, גופנים וקובץ ניווט. מסמך החבילה, בדרך כלל OPF, מונה את המשאבים וקובע את סדר הקריאה. כשמכירים את החלוקה הזאת אפשר לאתר במהירות קישור שבור, פרק חסר או אריזה שגויה.

## תמונת המבנה

השמות של התיקיות אינם כולם קדושים; `EPUB/` הוא שם נפוץ ולא חובה. לעומת זאת, הנתיב `META-INF/container.xml` וקובץ `mimetype` בשורש הם חלק ממבנה המיכל. עץ קטן של ספר יכול להיראות כך:

```text
book.epub
├── mimetype
├── META-INF/
│   └── container.xml
└── EPUB/
    ├── package.opf
    ├── nav.xhtml
    ├── text/
    │   ├── title.xhtml
    │   └── chapter-01.xhtml
    ├── styles/book.css
    ├── fonts/FrankRuhlLibre.woff2
    └── images/cover.jpg
```

הארכיון עצמו נקרא OCF, או Open Container Format, במינוח מפרט מערכות הקריאה. קורא אינו אמור לנחש איפה נמצא הספר לפי שם תיקייה. הוא מתחיל בקובץ המיכל ומוצא משם את מסמך החבילה. זו גם הסיבה ששינוי מבני "קטן" בתוך ZIP עלול לשבור קובץ שנראה תקין כשפותחים אותו בתוכנת קבצים.

## mimetype: הקובץ הקטן שבודק את האריזה

הקובץ `mimetype` נמצא בשורש ומכיל בדיוק את סוג המדיה של הפרסום:

```text
application/epub+zip
```

במיכל ZIP של EPUB הוא צריך להיות הרשומה הראשונה בארכיון וללא דחיסה. מפרט OCF מוסיף גם שאסור שיהיה לרשומה הזאת ZIP extra field בכותרת המקומית שלה. אין להוסיף לו שורת רווח, BOM או טקסט הסבר. תוכנת ZIP רגילה עשויה ליצור ארכיון תקין מבחינת ZIP אך לא מבחינת EPUB אם היא דוחסת את הקובץ או מכניסה לפניו רשומה אחרת.

## container.xml: השלט שמכוון אל OPF

בתיקיית `META-INF` נמצא `container.xml`. הוא כולל `rootfile` עם נתיב יחסי למסמך החבילה וסוג המדיה שלו. זהו מינימום שימושי:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0"
  xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf"
      media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
```

אפשר תיאורטית לרשום יותר מ־`rootfile` אחד, אך קורא משתמש כברירת מחדל בראשון. ספר רגיל צריך בדרך כלל מסמך חבילה אחד ברור. אל תכתבו נתיב מוחלט של המחשב; הנתיב הוא נתיב בתוך הארכיון.

## OPF: מסמך החבילה

ה־[OPF](/glossary/opf/) הוא מרכז הבקרה. שורש `package` מגדיר גרסת EPUB ומזהה ייחודי, ובתוכו שלושה חלקים שנפגשים כמעט בכל בדיקה: `metadata`, `manifest` ו־[spine](/glossary/spine/). מטא־נתונים מתארים את הפרסום; manifest מצהיר על כל משאב; spine מסדר את מסמכי הקריאה.

הדוגמה הבאה אינה ספר שלם, אבל היא מציגה OPF מינימלי שימושי לספר עברי. `dcterms:modified` הוא זמן השינוי בפורמט UTC, ואילו `dc:language` מתאר את שפת הפרסום.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf"
  version="3.0" unique-identifier="book-id" xml:lang="he">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="book-id">urn:isbn:9780000000000</dc:identifier>
    <dc:title>ספר לדוגמה</dc:title>
    <dc:language>he</dc:language>
    <meta property="dcterms:modified">2026-10-24T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml"
      media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="text/chapter-01.xhtml"
      media-type="application/xhtml+xml"/>
    <item id="css" href="styles/book.css" media-type="text/css"/>
  </manifest>
  <spine page-progression-direction="rtl">
    <itemref idref="c1"/>
  </spine>
</package>
```

המזהה אינו חייב להיות ISBN; הוא צריך להיות מזהה יציב וייחודי לפרסום. בדוגמה ה־ISBN הוא ערך מדומה בלבד, ולכן אין להעתיק אותו לספר אמיתי. אם משתמשים ב־ISBN, הוא חייב להיות המזהה שניתן בפועל. `xml:lang="he"` ו־`dc:language` אינם תחליף להגדרת `lang` ו־`dir` במסמכי XHTML עצמם.

## metadata, manifest ו־spine

`metadata` הוא המקום לשם הספר, שפה, מזהה ונתונים נוספים. הוא אינו רק קישוט לחנות: קוראים וספריות משתמשים בו כדי להציג ולמיין את הספר. המטא־נתונים צריכים להיות עקביים עם הכריכה ועם מה שהקורא רואה בפועל. לפרטים על בחירת שדות ראו [מטא־נתונים ל־EPUB](/production/metadata/).

ה־[manifest](/glossary/manifest/) הוא רשימת מלאי. לכל `item` יש `id`, נתיב `href` וסוג מדיה. אם פרק, תמונה, CSS, גופן או מסמך ניווט אינם רשומים בו, אין להניח שקורא ימצא אותם רק מפני שהם נמצאים ב־ZIP. ה־manifest גם מאפשר לקורא לדעת אילו משאבים קיימים בלי לסרוק תיקיות באופן שרירותי.

ה־spine משתמש ב־`idref` כדי להצביע ל־`id` קיים ב־manifest, וקובע את סדר הקריאה הראשי. פרק ראשון לפני פרק שני אינו נקבע לפי שם הקובץ `chapter-01.xhtml`, אלא לפי סדר `itemref`. בספר עברי אפשר לציין `page-progression-direction="rtl"`; זהו רמז לכיוון התקדמות הדפים, לא מנגנון שמתקן אוטומטית את כיווניות כל הפסקאות. לפרטים ראו [page-progression-direction](/glossary/page-progression-direction/) ו־[יסודות RTL](/hebrew/rtl-basics/).

## מסמך ניווט ותוכן הקריאה

מסמך ניווט הוא בדרך כלל XHTML עם `nav` סמנטי. ב־OPF הוא מסומן `properties="nav"`. קורא יכול להציג ממנו תוכן עניינים, ולעתים גם רשימת עמודים או נקודות ציון. הוא אינו מחליף spine: תוכן העניינים מספק דרך לבחור יעד, ואילו spine מגדיר את המסלול הראשי. ראו [תוכן עניינים ומסמך nav](/production/toc-nav/).

כל פרק קריא הוא EPUB Content Document, לרוב XHTML. כתבו HTML תקני וסמנטי: `h1` לכותרת פרק, `p` לפסקה, `ol` לרשימה מסודרת. CSS מחובר כרגיל ב־`link`; תמונה נכנסת עם `img` וטקסט חלופי; גופנים מקומיים מוגדרים ב־`@font-face` ומופיעים גם ב־manifest. SVG יכול להיות מסמך נפרד או מוטמע לפי כללי EPUB והווב.

```html
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="he" dir="rtl">
<head>
  <title>פרק ראשון</title>
  <link rel="stylesheet" href="../styles/book.css" />
</head>
<body>
  <section epub:type="chapter" xmlns:epub="http://www.idpf.org/2007/ops">
    <h1>פרק ראשון</h1>
    <p>זהו טקסט אמיתי, לא תמונה של טקסט.</p>
  </section>
</body>
</html>
```

## נתיבים, סוגי מדיה ושמות קבצים

כל `href` ב־OPF מחושב ביחס למיקומו של `package.opf`, לא ביחס לשורש הדיסק ולא בהכרח ביחס לקובץ ה־XHTML הנוכחי. לכן `styles/book.css` בדוגמת ה־manifest הוא נתיב מן התיקייה `EPUB/`, ואילו `../styles/book.css` בדוגמת הפרק הוא נתיב מן התיקייה `EPUB/text/`. בלבול בין שני בסיסי הנתיב הוא סיבה נפוצה ל־CSS או לתמונה שלא נטענים.

סוג המדיה ב־manifest צריך לתאר את המשאב באמת: `application/xhtml+xml` למסמך XHTML, `text/css` ל־CSS, וסוג תמונה מתאים לתמונה. אל תסתמכו על סיומת בלבד ואל תוסיפו קובץ "ליתר ביטחון" בלי `item` מתאים. בדיקת EPUB מזהה חלק מן הפערים האלה, אך פתיחה בפרק שמכיל תמונה וגופן היא בדיקה מעשית לא פחות חשובה.

שמרו שמות קבצים ונתיבים פשוטים ועקביים. מזהים ב־manifest הם מזהים פנימיים של XML, ואילו `href` הוא הנתיב שמשמש לטעינת המשאב; אלה שני שדות שונים. שינוי שם של פרק מחייב לעדכן את ה־manifest, את ההפניה ב־spine ואת כל הקישורים אליו. תוכנת חיפוש והחלפה יכולה לעזור, אבל יש לבדוק אחריה כל קישור עוגן כמו `chapter-01.xhtml#note-3`.

## פתיחה, סגירה ואריזה מחדש

כדי לבדוק ספר, העתיקו אותו לספריית עבודה ופתחו אותו בכלי ZIP; אל תערכו ישירות בתוך ארכיון אם הכלי אינו שומר את דרישות `mimetype`. אחרי תיקון, נכנסים לתיקיית השורש שבה נמצאים `mimetype`, `META-INF` ו־`EPUB`, ומייצרים ארכיון מחדש. ב־Info-ZIP הפקודות המקובלות הן:

```bash
zip -X0 ../book.epub mimetype
zip -rX9 ../book.epub META-INF EPUB
```

`-0` שומר ללא דחיסה, `-9` מבקש דחיסה מרבית לשאר הקבצים, `-X` משמיט שדות קובץ נוספים, והפקודה הראשונה מבטיחה ש־`mimetype` נכנס ראשון. אל תריצו את הפקודה השנייה עם `mimetype` פעם נוספת. אם שמות התיקיות שונים, החליפו רק את שמות התיקיות, לא את עקרון סדר האריזה.

לאחר האריזה פתחו את הקובץ בקורא ובדקו אותו ב־[EPUBCheck](/production/epubcheck/). ZIP שנפתח אינו בהכרח EPUB תקני; לעומת זאת, EPUBCheck וקורא אמיתי משלימים זה את זה: הראשון תופס הפרות מבניות, והשני חושף בעיות טיפוגרפיה, ניווט והתנהגות בפועל.

## סדר בדיקה שמוצא תקלות מוקדם

אחרי יצירת הקובץ, הציגו את רשימת הרשומות בכלי ה־ZIP. בדקו ש־`mimetype` מופיע ראשון, מאוחסן ללא דחיסה, וש־`META-INF/container.xml` נמצא בנתיב המדויק. פתחו את `container.xml`, העתיקו את `full-path` ובדקו שהקובץ שאליו הוא מפנה קיים באותו איות. כך מפרידים בין תקלה באריזה לבין תקלה במסמך החבילה.

ב־OPF עברו על כל `href` ב־manifest. משאב שמשמש להצגת הפרסום צריך להיות רשום שם, וכל `idref` ב־spine צריך להפנות ל־`id` קיים. ודאו שלמסמך הניווט יש `properties="nav"` ושקישורי תוכן העניינים מגיעים לפרקים הקיימים. בדקו גם שה־`dcterms:modified` קיים פעם אחת ובפורמט UTC הנדרש. אחר כך הפעילו EPUBCheck ופתחו את הספר בקורא.

כשיש תקלה, אל תתחילו בשינוי CSS. רשמו תחילה את שם הקובץ והנתיב שמופיעים בדוח, ובדקו אם מדובר בהפניה חסרה, media type שגוי או סדר אריזה. תיקון קטן במקור ואז אריזה מחדש עדיפים על תיקון ידני בתוך EPUB סופי, שעלול להישכח ביצוא הבא.

אפשר לבדוק גם שהנתיבים אינם כוללים רווח לא צפוי או הבדל אותיות. במערכת קבצים אחת טעות כזאת עשויה להסתתר, ובקורא אחר היא תכשיל משאב.

בדקו את הארכיון הסופי בכל יצוא, גם אם רק הוחלפה תמונה. שינוי יחיד יכול לעדכן נתיב, manifest או חותמת שינוי בלי שייראה בעורך המקור. תהליך חוזר של אריזה, ולידציה ופתיחה בקורא שומר על ההבחנה בין קובץ עבודה לבין קובץ הפצה.
