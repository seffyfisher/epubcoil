import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { articleSlug } from "../lib/sections";

export async function GET(context: { site?: URL }) {
  const articles = (
    await getCollection("articles", ({ data }) => !data.draft)
  ).sort((a, b) => b.data.updated.getTime() - a.data.updated.getTime());
  return rss({
    title: "epub.co.il",
    description: "ידע עברי על ספרים דיגיטליים",
    site: context.site!,
    items: articles.map((article) => ({
      title: article.data.title,
      description: article.data.description,
      pubDate: article.data.updated,
      link: `/${article.data.section}/${articleSlug(article.id)}/`,
    })),
  });
}
