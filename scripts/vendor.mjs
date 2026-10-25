import { cp, mkdir } from "node:fs/promises";

await mkdir("public/vendor", { recursive: true });
await cp("node_modules/jszip/dist/jszip.min.js", "public/vendor/jszip.min.js");
await cp("node_modules/epubjs/dist/epub.min.js", "public/vendor/epub.min.js");
