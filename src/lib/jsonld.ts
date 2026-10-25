import type { CollectionEntry } from "astro:content";
import { articleSlug, sectionMap } from "./sections";
import { articlePath } from "./links";

export const organization = {
  "@type": "Organization",
  name: "epub.co.il",
  url: "https://epub.co.il/",
  logo: "https://epub.co.il/icons/icon-512.png",
};

export const websiteJsonLd = {
  "@type": "WebSite",
  name: "epub.co.il",
  url: "https://epub.co.il/",
  potentialAction: {
    "@type": "SearchAction",
    target: "https://epub.co.il/search/?q={search_term_string}",
    "query-input": "required name=search_term_string",
  },
};

export function articleJsonLd(entry: CollectionEntry<"articles">) {
  const data = entry.data;
  const url = `https://epub.co.il/${data.section}/${articleSlug(entry.id)}/`;
  return [
    {
      "@type": "TechArticle",
      headline: data.title,
      description: data.description,
      datePublished: data.published.toISOString(),
      dateModified: data.updated.toISOString(),
      inLanguage: "he",
      author: organization,
      publisher: organization,
      mainEntityOfPage: url,
      image: "https://epub.co.il/og/brand.png",
      articleSection: sectionMap[data.section],
      abstract: data.answer,
    },
  ];
}

export function articleGraph(entry: CollectionEntry<"articles">) {
  const data = entry.data;
  const path = articlePath(entry);
  const url = `https://epub.co.il${path}`;
  const breadcrumbs = [
    ["דף הבית", "https://epub.co.il/"],
    [sectionMap[data.section], `https://epub.co.il/${data.section}/`],
    [data.title, url],
  ];

  return [
    ...articleJsonLd(entry),
    {
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbs.map(([name, item], index) => ({
        "@type": "ListItem",
        position: index + 1,
        name,
        item,
      })),
    },
    ...(data.howto
      ? [
          {
            "@type": "HowTo",
            name: data.howto.name,
            step: data.howto.steps.map((step) => ({
              "@type": "HowToStep",
              ...step,
            })),
          },
        ]
      : []),
    ...(data.faq?.length
      ? [
          {
            "@type": "FAQPage",
            mainEntity: data.faq.map((faq) => ({
              "@type": "Question",
              name: faq.q,
              acceptedAnswer: { "@type": "Answer", text: faq.a },
            })),
          },
        ]
      : []),
  ];
}
