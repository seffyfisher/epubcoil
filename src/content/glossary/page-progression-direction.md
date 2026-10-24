---
term: "כיוון התקדמות עמודים"
termEn: "page-progression-direction"
short: "מאפיין של spine ב־EPUB המצהיר אם זרימת העמודים הכללית היא משמאל לימין או מימין לשמאל."
related: [hebrew/rtl-basics, glossary/spine, glossary/opf]
sources:
  - title: "EPUB 3.3 — page-progression-direction"
    url: "https://www.w3.org/TR/epub-33/#attrdef-spine-page-progression-direction"
  - title: "EPUB Reading Systems 3.3"
    url: "https://www.w3.org/TR/epub-rs-33/"
updated: 2026-10-24
---

`page-progression-direction` הוא מאפיין אופציונלי של [spine](/glossary/spine/). הערכים התקניים שלו הם `ltr`, ‏`rtl` ו-`default`. הוא מצהיר על הכיוון הכללי שבו התוכן זורם בין עמודים או מסכים, ולא על כיוון האותיות בתוך פסקה.

בספר עברי זורם נהוג להגדיר `rtl`; לצד זה צריך להגדיר `dir="rtl"` במסמכי XHTML ואת השפה במטא־דאטה. אם משתמשים ב-`default` או משמיטים את המאפיין, מערכת הקריאה יכולה לבחור את כיוון התצוגה. Reading Systems 3.3 מחייבת להניח `default` כאשר לא צוין ערך.

```xml
<spine page-progression-direction="rtl">
  <itemref idref="chapter-01"/>
</spine>
```

המאפיין משפיע בעיקר על ניווט ועל פריסה; הוא לא מחליף את סדר הפרקים ב־spine ולא את `dir` במסמך.

הבדיקה החשובה היא פעולה, לא רק מראה: עברו לפרק הבא וחזרו לקודם בקורא היעד. בדקו גם מסך כפול אם הקורא מציע אותו. הגדרה נכונה מעבירה את כוונת הפרסום למערכת, אך קורא יכול להציע למשתמש שינוי העדפה משלו.

אין להסיק מכיוון הטקסט של פסקה בודדת על כיוון ההתקדמות של ספר שלם.

הגדירו את הערך פעם אחת על spine ובדקו אותו בכל פלט סופי.

העדפת הקורא עשויה לשנות את החוויה, אך אינה משנה את הצהרת הפרסום.
