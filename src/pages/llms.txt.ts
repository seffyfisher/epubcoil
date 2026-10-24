import { getCollection } from "astro:content";
import { articleSlug, sections } from "../lib/sections";

export async function GET() {
  const articles = await getCollection("articles", ({ data }) => !data.draft);
  const glossary = await getCollection("glossary", ({ data }) => !data.draft);
  const resourceNames = [
    "links",
    "software",
    "experiments",
    "leaders",
    "providers",
  ] as const;
  const resources = await Promise.all(
    resourceNames.map((name) => getCollection(name)),
  );
  const output = [
    "# epub.co.il",
    "ידע עברי עצמאי על ספרים דיגיטליים ו־EPUB, עם התמחות בעברית ו־RTL.",
    "## מדורים",
    ...sections.map(
      (section) => `- ${section.title}: https://epub.co.il/${section.key}/`,
    ),
    "## מאמרים",
    ...articles.map(
      (article) =>
        `- ${article.data.title} — https://epub.co.il/${article.data.section}/${articleSlug(article.id)}/\n  ${article.data.answer}`,
    ),
    "## מילון",
    ...glossary.map(
      (item) => `- ${item.data.term}: https://epub.co.il/glossary/${item.id}/`,
    ),
    "## משאבים",
    ...resourceNames.map(
      (name, index) =>
        `- ${name} (${resources[index].length}): https://epub.co.il/resources/${name}/`,
    ),
    "## כלים",
    "- קורא EPUB: https://epub.co.il/reader/",
    "- כלים: https://epub.co.il/tools/",
  ].join("\n\n");
  return new Response(output, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
