import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const localLink =
  /\]\(\/?((?:glossary|basics|reading|hebrew|production|design|css|js|experiments)\/[\w-]+)\/?\)/g;

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const children = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? files(join(directory, entry.name))
        : entry.name.endsWith(".md") && !entry.name.startsWith("_")
          ? [join(directory, entry.name)]
          : [],
    ),
  );
  return children.flat();
}

/** Parsed YAML frontmatter of a Markdown file ({} when absent or invalid). */
const frontmatter = (text) => {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  try {
    return (match && yaml.load(match[1])) || {};
  } catch {
    return {};
  }
};
const idFor = (file) =>
  file.includes("/glossary/")
    ? `glossary/${file.split("/").at(-1).replace(/\.md$/, "")}`
    : relative("src/content/articles", file).replace(/\.md$/, "");

/** Emits dist/_review.json; documented here because Astro ignores src/pages/_*. */
export async function writeReviewReport(buildDir) {
  const outputDirectory =
    buildDir instanceof URL ? fileURLToPath(buildDir) : buildDir;
  const records = await Promise.all(
    (
      await Promise.all([
        files("src/content/articles"),
        files("src/content/glossary"),
      ])
    )
      .flat()
      .map(async (file) => ({ file, source: await readFile(file, "utf8") })),
  );
  const known = new Set(records.map(({ file }) => idFor(file)));
  const articles = records.filter(({ file }) => file.includes("/articles/"));
  const report = {
    generatedBy: "src/lib/review-report.mjs via astro:build:done",
    needsReview: records.flatMap(({ file, source }) => {
      const items = frontmatter(source).needsReview ?? [];
      return items.length ? [{ id: idFor(file), items }] : [];
    }),
    descriptionOutsideRange: articles.flatMap(({ file, source }) => {
      const description = String(frontmatter(source).description ?? "");
      return description.length < 120 || description.length > 160
        ? [{ id: idFor(file), length: description.length }]
        : [];
    }),
    missingInternalLinks: records.flatMap(({ file, source }) =>
      [...source.matchAll(localLink)]
        .map((match) => match[1])
        .filter((target) => !known.has(target))
        .map((target) => ({ from: idFor(file), target })),
    ),
    drafts: records
      .filter(({ source }) => frontmatter(source).draft === true)
      .map(({ file }) => idFor(file)),
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, "_review.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}
