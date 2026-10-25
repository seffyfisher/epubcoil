import { existsSync } from "node:fs";

const localPath =
  /^\/(glossary|basics|reading|hebrew|production|design|css|js|experiments)\/([a-z0-9-]+)\/?$/;

/** Planned pages are plain text until their Markdown source exists. */
export default function remarkLocalLinks() {
  return (tree) => {
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "link" && typeof node.url === "string") {
        const match = node.url.match(localPath);
        if (match) {
          const [, section, slug] = match;
          const source =
            section === "glossary"
              ? `src/content/glossary/${slug}.md`
              : `src/content/articles/${section}/${slug}.md`;
          if (!existsSync(source)) {
            node.type = "text";
            node.value = (node.children ?? [])
              .map((child) => child.value ?? "")
              .join("");
            delete node.url;
            delete node.children;
          }
        }
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
  };
}
