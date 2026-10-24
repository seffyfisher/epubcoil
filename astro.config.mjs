import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { writeReviewReport } from "./src/lib/review-report.mjs";
import remarkLocalLinks from "./src/lib/remark-local-links.mjs";
import rehypeHeadingAnchors from "./src/lib/rehype-heading-anchors.mjs";

// The report is a build artifact: Astro ignores underscore-prefixed page files.
export default defineConfig({
  site: "https://epub.co.il",
  output: "static",
  trailingSlash: "always",
  build: { format: "directory" },
  logger: { level: "error" },
  integrations: [
    sitemap({
      filter: (page) => !page.includes("/404/") && !page.includes("_review"),
    }),
    {
      name: "epubcoil-review-report",
      hooks: { "astro:build:done": async ({ dir }) => writeReviewReport(dir) },
    },
  ],
  markdown: {
    remarkPlugins: [remarkLocalLinks],
    rehypePlugins: [rehypeHeadingAnchors],
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
    },
  },
});
