import type { APIRoute } from "astro";
import { readFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

/** Brand OG image: the EPUB diamond mark (public/logo.svg) over a thin accent rule. */
export const getStaticPaths = () => [{ params: { slug: "brand" } }];

export const GET: APIRoute = async () => {
  const logo = await readFile(`${process.cwd()}/public/logo.svg`, "utf8");
  const path = logo.match(/<path[^>]*\sd="([^"]+)"/)?.[1] ?? "";
  const size = 260;
  const scale = size / 384;
  const x = (1200 - size) / 2;
  const y = 130;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#fdfcfa"/>
  <path d="${path}" fill="#1a1a1a" transform="translate(${x} ${y}) scale(${scale})"/>
  <rect x="330" y="${y + size + 60}" width="540" height="3" fill="#8b2635"/>
</svg>`;
  return new Response(new Resvg(svg).render().asPng(), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
