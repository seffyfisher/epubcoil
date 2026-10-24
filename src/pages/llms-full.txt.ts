import { getCollection } from "astro:content";
import { articleSlug } from "../lib/sections";

export async function GET() {
  const articles = await getCollection("articles", ({ data }) => !data.draft);
  const glossary = await getCollection("glossary", ({ data }) => !data.draft);
  let output = "# epub.co.il — תוכן מלא\n";
  for (const article of articles)
    output += `\n## ${article.data.title}\nURL: https://epub.co.il/${article.data.section}/${articleSlug(article.id)}/\nעודכן: ${article.data.updated.toISOString().slice(0, 10)}\nתשובה: ${article.data.answer}\n\n${article.body ?? ""}\n`;
  for (const item of glossary)
    output += `\n## ${item.data.term}\nURL: https://epub.co.il/glossary/${item.id}/\n${item.data.short}\n\n${item.body ?? ""}\n`;
  return new Response(output, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
