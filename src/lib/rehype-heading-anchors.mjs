export default function rehypeHeadingAnchors() {
  return (tree) => {
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (
        (node.tagName === "h2" || node.tagName === "h3") &&
        node.properties?.id
      ) {
        const id = String(node.properties.id);
        node.children ??= [];
        node.children.push({
          type: "element",
          tagName: "a",
          properties: {
            className: ["heading-anchor"],
            href: `#${id}`,
            ariaLabel: `קישור אל ${id}`,
          },
          children: [{ type: "text", value: "#" }],
        });
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
  };
}
