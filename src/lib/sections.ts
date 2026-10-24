export type SectionKey =
  | "basics"
  | "reading"
  | "hebrew"
  | "production"
  | "design"
  | "css"
  | "js"
  | "experiments";

export interface Section {
  key: SectionKey;
  title: string;
  description: string;
}

export const sections: readonly Section[] = [
  {
    key: "basics",
    title: "יסודות",
    description: "מבנה הפורמט והמושגים הראשונים.",
  },
  { key: "reading", title: "קריאה", description: "פתיחה, שליחה ובחירת קורא." },
  {
    key: "hebrew",
    title: "עברית וימין־לשמאל",
    description: "טקסט עברי, ניקוד וכיווניות.",
  },
  {
    key: "production",
    title: "הפקה",
    description: "תהליך עבודה, מטא־דאטה ובדיקות.",
  },
  {
    key: "design",
    title: "עיצוב",
    description: "טיפוגרפיה, תמונות ופריסה זורמת.",
  },
  {
    key: "css",
    title: "CSS ב־EPUB",
    description: "כללי עיצוב עמידים לקוראים.",
  },
  {
    key: "js",
    title: "JavaScript ב־EPUB",
    description: "אינטראקטיביות, אבטחה ו־fallback.",
  },
  {
    key: "experiments",
    title: "ניסויים ומיוחדים",
    description: "SVG, MathML ומדיה עשירה.",
  },
];

export const sectionMap = Object.fromEntries(
  sections.map(({ key, title }) => [key, title]),
) as Record<SectionKey, string>;
export const plannedTopics: Record<SectionKey, string[]> = {
  basics: [
    "what-is-epub",
    "epub2-vs-epub3",
    "epub-file-structure",
    "epub-vs-pdf-mobi-kfx",
    "audiobooks-media-overlays",
  ],
  reading: ["open-epub", "send-to-kindle", "reading-apps"],
  hebrew: [
    "rtl-basics",
    "hebrew-fonts",
    "nikud",
    "justification-hyphenation",
    "bidi-numbers-latin",
    "reader-issues",
  ],
  production: [
    "workflow",
    "tools",
    "metadata",
    "cover",
    "toc-nav",
    "epubcheck",
    "accessibility",
    "drm-lcp-watermark",
  ],
  design: [
    "typography",
    "reflowable-vs-fixed-layout",
    "images",
    "tables",
    "footnotes",
    "kids-comics",
  ],
  css: [
    "css-in-epub",
    "epub-prefixes",
    "media-queries-dark-mode",
    "page-breaks",
    "fonts-css",
    "reader-pitfalls",
  ],
  js: ["js-in-epub", "interactivity-examples", "security-fallbacks"],
  experiments: ["svg-animation", "mathml", "audio-video"],
};
export const titleForSlug = (slug: string) => slug.replaceAll("-", " ");
export const articleSlug = (id: string) => id.split("/").at(-1)!;
export const issueUrl = "https://github.com/seffyfisher/epubcoil/issues/new";
