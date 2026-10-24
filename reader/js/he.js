/**
 * Hebrew (RTL) localization strings and formatting helpers for the epub.co.il reader.
 */

export const STRINGS = {
  appTitle: 'קורא EPUB — epub.co.il',
  eyebrow: 'epub.co.il',
  libraryTitle: 'הספרייה שלי',
  openFileBtn: 'פתיחת קובץ EPUB',
  demoTitle: 'ספר ההדגמה',
  demoSubtitle: 'מהו EPUB — מדריך קצר בעברית (מימין לשמאל)',
  dropNote: 'אפשר גם לגרור לכאן קובץ EPUB לקריאה מיידית',
  emptyLibrary: 'עדיין אין ספרים שמורים במכשיר.',
  unknownAuthor: 'מחבר לא ידוע',
  untitledBook: 'ספר ללא כותרת',

  // Actions & Confirmations
  openBookAria: 'פתיחת ספר',
  removeBookAria: 'מחיקת ספר מהמכשיר',
  confirmRemoveBook: 'האם למחוק את הספר מהמכשיר?',
  confirmClearAll: 'האם למחוק את כל הספרים השמורים, הסימניות וההגדרות מהמכשיר?',
  dataClearedToast: 'כל הנתונים והספרים השמורים נמחקו.',
  quotaExceededToast: 'אין די מקום פנוי לשמירת הספר במכשיר; הקריאה תימשך ללא שמירה מקומית.',

  // Reader Topbar & Controls
  backToLibrary: 'חזרה לספרייה',
  tocTitle: 'תוכן עניינים',
  bookmarksTitle: 'סימניות',
  bookmarkAdd: 'הוספת סימנייה לעמוד זה',
  bookmarkRemove: 'הסרת סימנייה מעמוד זה',
  searchTitle: 'חיפוש בספר',
  settingsTitle: 'הגדרות',
  fullscreenEnter: 'מעבר למסך מלא',
  fullscreenExit: 'יציאה ממסך מלא',
  closeDrawer: 'סגירה',

  // Tap Zones & Navigation
  nextPageAria: 'עמוד הבא',
  prevPageAria: 'עמוד קודם',
  toggleChromeAria: 'הצגת או הסתרת סרגלי הכלים',
  loadingBook: 'טוען את הספר…',
  progressAria: 'התקדמות בקריאה',
  goToPercentLabel: 'מעבר ל־',
  goToPercentAria: 'מעבר לאחוז בספר',
  chapterFallback: index => `פרק ${index + 1}`,
  liveProgress: (percent, chapter) =>
    chapter ? `${chapter}, ${percent} אחוז` : `התקדמות קריאה ${percent} אחוז`,

  // TOC & Bookmarks
  emptyToc: 'אין תוכן עניינים זמין בספר זה.',
  emptyBookmarks: 'עדיין לא נוספו סימניות בספר זה.',
  addBookmarkHere: 'הוספת סימנייה למיקום הנוכחי',
  deleteBookmarkAria: 'מחיקת סימנייה',
  defaultBookmarkLabel: 'סימנייה',

  // Search
  searchPlaceholder: 'הזינו מילה או ביטוי לחיפוש…',
  searchSubmit: 'חיפוש',
  searchCancel: 'ביטול',
  searchingStatus: 'מחפש בספר…',
  searchCancelled: 'החיפוש הופסק.',
  searchNoResults: 'לא נמצאו תוצאות עבור החיפוש.',
  searchResultsCount: count =>
    count === 1 ? 'נמצאה תוצאה אחת' : `נמצאו ${count} תוצאות`,
  searchFailed: 'אירעה שגיאה במהלך החיפוש.',

  // Settings Labels
  settingTheme: 'ערכת צבעים',
  themeAuto: 'אוטומטי',
  themeLight: 'בהיר (נייר)',
  themeSepia: 'ספיה',
  themeDark: 'כהה',
  themeOled: 'שחור OLED',
  settingFontSize: 'גודל גופן',
  settingLineHeight: 'גובה שורה',
  settingMargins: 'שולי עמוד',
  settingMaxWidth: 'רוחב טור מרבי',
  settingFontFamily: 'גופן',
  fontDefault: 'ברירת מחדל של הספר',
  fontFrank: 'Frank Ruhl Libre',
  fontDavid: 'David Libre',
  fontNoto: 'Noto Serif Hebrew',
  fontHeebo: 'Heebo',
  fontAssistant: 'Assistant',
  fontSystem: 'גופן מערכת',
  settingFlow: 'פריסת קריאה',
  flowPaginated: 'עמודים',
  flowScrolled: 'גלילה',
  settingColumns: 'טורים במסך רחב',
  columnsAuto: 'אוטומטי (עד 2)',
  columnsOne: 'טור יחיד',
  columnsTwo: 'שני טורים',
  settingJustify: 'יישור טקסט מלא',
  settingHyphenate: 'מיקוף אוטומטי (אנגלית/LTR)',
  settingWakeLock: 'מניעת כיבוי מסך בקריאה',
  clearAllBtn: 'מחיקת כל הנתונים',
  storageProtected: 'האחסון מוגן מפני מחיקה אוטומטית',
  storageUnprotected: 'האחסון אינו מוגן מפני מחיקה אוטומטית',

  // PWA & Install
  swUpdateAvailable: 'גרסה חדשה זמינה — רענון',
  swUpdateBtn: 'רענון',
  installPromptText: 'התקינו את הקורא לגישה מהירה וקריאה ללא חיבור',
  installBtn: 'התקנה',
  installIosText: 'הקישו על שיתוף ואז על "הוספה למסך הבית"',
  dismissInstallAria: 'סגירת הודעת התקנה',

  // Errors
  errors: {
    'not-epub': 'הקובץ אינו ספר EPUB תקין. יש לבחור קובץ בפורמט EPUB.',
    drm: 'הספר מוגן ב־DRM (ניהול זכויות דיגיטלי) ולכן לא ניתן לפתוח אותו בקורא זה.',
    corrupt: 'קובץ ה־EPUB פגום או לא שלם. נסו להוריד את הקובץ מחדש.',
    'missing-opf': 'קובץ ה־EPUB חסר מידע מבני (OPF) או שהוא ריק מתוכן.',
    'demo-offline': 'לא ניתן לטעון את ספר ההדגמה כעת. בדקו את החיבור או הנתיב.',
    generic: 'לא ניתן לפתוח את הספר. נסו קובץ EPUB אחר.',
  },
  errorRetryBtn: 'ניסיון חוזר',
  errorBackBtn: 'חזרה לספרייה',
};

/**
 * Safely escape text for HTML insertion.
 */
export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return ch;
    }
  });
}
