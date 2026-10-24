import type { CollectionEntry } from "astro:content";
import { articleSlug } from "./sections";

export type ArticleEntry = CollectionEntry<"articles">;
export const articlePath = (entry: ArticleEntry) =>
  `/${entry.data.section}/${articleSlug(entry.id)}/`;
export const articleReference = (entry: ArticleEntry) =>
  `${entry.data.section}/${articleSlug(entry.id)}`;

export function existingRelated(
  entries: ArticleEntry[],
  references: string[] = [],
): ArticleEntry[] {
  const lookup = new Map(
    entries.map((entry) => [articleReference(entry), entry]),
  );
  return references.flatMap((reference) => lookup.get(reference) ?? []);
}

/** Escape plain frontmatter text and render `code` spans (for answers/descriptions). */
export function inlineMarkup(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return escaped.replace(/`([^`]+)`/g, '<code dir="ltr">$1</code>');
}
