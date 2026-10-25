import { defineCollection, z } from "astro:content";
import { glob, file } from "astro/loaders";

/** Content sections (the `section` frontmatter field). Keep in sync with src/lib/sections.ts */
export const SECTION_KEYS = [
  "basics",
  "reading",
  "hebrew",
  "production",
  "design",
  "css",
  "js",
  "experiments",
] as const;

const source = z.object({
  title: z.string().min(1),
  url: z.string().url(),
});

/** "section/slug" for articles, e.g. "basics/what-is-epub" */
const articleRef = z
  .string()
  .regex(/^[a-z0-9-]+\/[a-z0-9-]+$/, 'related must look like "section/slug"');

const articles = defineCollection({
  // Files starting with "_" (e.g. _template.md.example) are ignored.
  loader: glob({ pattern: ["**/[^_]*.md"], base: "./src/content/articles" }),
  schema: z.object({
    title: z.string().min(2),
    /** Meta description, aim for 120-160 chars (reported in dist/_review.json if outside). */
    description: z.string().min(50).max(220),
    section: z.enum(SECTION_KEYS),
    order: z.number().default(100),
    /** 1-2 sentence direct answer: answer box + JSON-LD. */
    answer: z.string().min(20),
    published: z.coerce.date(),
    updated: z.coerce.date(),
    faq: z
      .array(z.object({ q: z.string().min(3), a: z.string().min(3) }))
      .optional(),
    sources: z.array(source).min(1),
    related: z.array(articleRef).optional(),
    howto: z
      .object({
        name: z.string(),
        steps: z.array(z.object({ name: z.string(), text: z.string() })).min(2),
      })
      .optional(),
    tags: z.array(z.string()).optional(),
    draft: z.boolean().optional(),
    /** Uncertain claims to verify. Collected into dist/_review.json, never shown publicly. */
    needsReview: z.array(z.string()).optional(),
    /** Show on the home page "featured" list. */
    featured: z.boolean().optional(),
  }),
});

const glossary = defineCollection({
  loader: glob({ pattern: ["**/[^_]*.md"], base: "./src/content/glossary" }),
  schema: z.object({
    term: z.string().min(1),
    termEn: z.string().min(1),
    /** One-sentence definition. */
    short: z.string().min(10),
    related: z.array(z.string()).optional(),
    sources: z.array(source).min(1),
    updated: z.coerce.date().optional(),
    needsReview: z.array(z.string()).optional(),
    draft: z.boolean().optional(),
  }),
});

const resourceBase = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  url: z.string().url(),
  checked: z.coerce.date(),
});
const links = defineCollection({
  loader: file("src/data/resources/links.yaml"),
  schema: resourceBase.extend({
    title: z.string(),
    description: z.string(),
    category: z.enum([
      "standards",
      "specs",
      "communities",
      "blogs",
      "newsletters",
      "conferences",
      "publisher-guidelines",
      "documentation",
    ]),
    region: z.enum(["israel", "world"]),
    lang: z.enum(["he", "en", "other"]),
  }),
});
const software = defineCollection({
  loader: file("src/data/resources/software.yaml"),
  schema: resourceBase.extend({
    name: z.string(),
    description: z.string(),
    category: z.enum([
      "authoring",
      "conversion",
      "validation",
      "reading",
      "accessibility",
      "fonts",
      "libraries",
      "other",
    ]),
    platforms: z.array(
      z.enum(["web", "windows", "mac", "linux", "ios", "android", "eink"]),
    ),
    pricing: z.enum(["free", "paid", "freemium"]),
    openSource: z.boolean(),
    rtlNotes: z.string().optional(),
  }),
});
const experiments = defineCollection({
  loader: file("src/data/resources/experiments.yaml"),
  schema: resourceBase.extend({
    title: z.string(),
    description: z.string(),
    kind: z.enum([
      "interactive",
      "fixed-layout",
      "audio-video",
      "scripted",
      "typography",
      "accessibility",
      "generative",
      "other",
    ]),
    creator: z.string().optional(),
    year: z.number().int().optional(),
  }),
});
const leaders = defineCollection({
  loader: file("src/data/resources/leaders.yaml"),
  schema: resourceBase.extend({
    name: z.string(),
    kind: z.enum(["person", "organization"]),
    region: z.enum(["israel", "world"]),
    why: z.string(),
  }),
});
const providers = defineCollection({
  loader: file("src/data/resources/providers.yaml"),
  schema: resourceBase.extend({
    name: z.string(),
    services: z.array(
      z.enum([
        "production",
        "conversion",
        "design",
        "typesetting",
        "accessibility",
        "audiobooks",
        "distribution",
      ]),
    ),
    city: z.string().optional(),
    description: z.string(),
    sourceUrl: z.string().url(),
  }),
});

export const collections = {
  articles,
  glossary,
  links,
  software,
  experiments,
  leaders,
  providers,
};
