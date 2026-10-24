---
term: "עמוד השדרה"
termEn: "Spine"
short: "רכיב במסמך החבילה של EPUB הקובע את סדר הקריאה הליניארי ואת כיוון התקדמות העמודים."
related: [basics/epub-file-structure, hebrew/rtl-basics, glossary/opf, glossary/page-progression-direction]
sources:
  - title: "EPUB 3.3 — The spine element"
    url: "https://www.w3.org/TR/epub-33/#sec-spine-elem"
updated: 2026-10-24
---

ה־spine הוא רשימת `itemref` בתוך מסמך [OPF](/glossary/opf/). כל `itemref` מפנה לפי `idref` לרשומה ב־manifest, והסדר ברשימה מגדיר את סדר הקריאה הרגיל של פרקי הספר. manifest אומר אילו משאבים קיימים; spine אומר אילו מהם נכנסים לרצף.

לספר עברי אפשר להגדיר על spine את `page-progression-direction="rtl"`. הגדרה זו מבטאת את כיוון המעבר הכללי, אך אינה הופכת את סדר ה-`itemref`: פרק ראשון עדיין צריך לבוא לפני פרק שני.

```xml
<spine page-progression-direction="rtl">
  <itemref idref="cover" linear="no"/>
  <itemref idref="chapter-01"/>
</spine>
```

המאפיין `linear="no"` מסמן משאב שאינו חלק מהקריאה הליניארית הראשית. תוכן עניינים ומסמכים מסייעים יכולים להיות נגישים בלי להיות פרק רגיל.

שינוי spine הוא שינוי עריכתי, לא רק טכני: הוא קובע מה יקרה כאשר הקורא יבחר "הפרק הבא". לכן כדאי לבנות אותו מתוך סדר הספר המיועד, ולא מתוך סדר הקבצים בתיקייה. תוכן עניינים טוב מפנה לאותו סדר אך אינו מחליף אותו.

בדקו כל שינוי ברצף קריאה אמיתי, ולא רק ברשימת הקבצים של פרויקט ההפקה המקומי.

כך נשמרת גם חוויית קריאה עקבית בכל קורא שתומך בפרסום.

בדקו את הרצף אחרי כל הוספה, מחיקה או העברה של פרק.
