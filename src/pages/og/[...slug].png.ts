import type { APIRoute } from "astro";
import { readFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

export const getStaticPaths = () => [{ params: { slug: "brand" } }];
export const GET: APIRoute = async () => {
  const font = await readFile(
    `${process.cwd()}/src/assets/og-fonts/FrankRuhlLibre-Regular.ttf`,
  );
  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "#fdfcfa",
          color: "#1a1a1a",
          fontSize: 86,
          fontFamily: "Frank",
        },
        children: [
          { type: "div", props: { children: "epub.co.il" } },
          {
            type: "div",
            props: {
              style: {
                width: 540,
                height: 3,
                background: "#8b2635",
                marginTop: 22,
              },
              children: "",
            },
          },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      fonts: [{ name: "Frank", data: font, weight: 400, style: "normal" }],
    },
  );
  return new Response(new Resvg(svg).render().asPng(), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
