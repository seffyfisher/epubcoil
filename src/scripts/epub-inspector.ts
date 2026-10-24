import JSZip from "jszip";

type Check = {
  severity: "שגיאה" | "אזהרה" | "מידע";
  text: string;
  href?: string;
};
type Item = { id: string; href: string; media: string; properties: string };
const DC = "http://purl.org/dc/elements/1.1/";
const RTL = /^(he|yi|ar|fa|ur)(-|$)/i;
const FONT =
  /^(font\/|application\/(font-woff|vnd\.ms-opentype|x-font-(ttf|otf)|font-sfnt))/i;
const links = {
  structure: "/basics/epub-file-structure/",
  rtl: "/hebrew/rtl-basics/",
  css: "/css/css-in-epub/",
  epubcheck: "/glossary/epubcheck/",
  nav: "/glossary/nav-document/",
  ppd: "/glossary/page-progression-direction/",
};

function text(node: Element | null | undefined) {
  return node?.textContent?.trim() || "";
}
function xml(source: string) {
  return new DOMParser().parseFromString(source, "application/xml");
}
function invalid(doc: Document) {
  return doc.getElementsByTagName("parsererror").length > 0;
}
function pathFor(base: string, target: string) {
  try {
    return new URL(target, `https://epub.local/${base}`).pathname.slice(1);
  } catch {
    return target;
  }
}
function add(parent: Element, tag: string, value?: string) {
  const el = document.createElement(tag);
  if (value) el.textContent = value;
  parent.append(el);
  return el;
}
function link(parent: Element, label: string, href?: string) {
  if (!href) return add(parent, "span", label);
  const a = add(parent, "a", label) as HTMLAnchorElement;
  a.href = href;
  return a;
}
function bytes(value: number) {
  return (
    new Intl.NumberFormat("he-IL", { maximumFractionDigits: 1 }).format(
      value < 1024 * 1024 ? value / 1024 : value / 1024 / 1024,
    ) + (value < 1024 * 1024 ? " KB" : " MB")
  );
}

async function read(zip: JSZip, name: string) {
  return zip.file(name)?.async("string") ?? "";
}
async function sampleDocuments(zip: JSZip, items: Item[], opfPath: string) {
  const docs: {
    path: string;
    doc: Document;
    html: Element | null;
    body: Element | null;
    source: string;
  }[] = [];
  for (const item of items
    .filter((x) => /xhtml|html/.test(x.media))
    .slice(0, 20)) {
    const path = pathFor(opfPath, item.href);
    const source = await read(zip, path);
    const doc = xml(source);
    if (!invalid(doc))
      docs.push({
        path,
        doc,
        html: doc.documentElement,
        body: doc.getElementsByTagNameNS("*", "body")[0] || null,
        source,
      });
  }
  return docs;
}
function metadata(opf: Document, name: string) {
  return [...opf.getElementsByTagNameNS(DC, name)].map(text).filter(Boolean);
}
function anyMeta(opf: Document, property: string) {
  return [...opf.getElementsByTagNameNS("*", "meta")].some(
    (node) => node.getAttribute("property") === property,
  );
}
function cssForbidden(source: string) {
  return /(^|[;{\s])(direction|unicode-bidi)\s*:/im.test(source);
}

export default function initInspector() {
  const input = document.querySelector<HTMLInputElement>("[data-file-input]")!;
  const zone = document.querySelector<HTMLElement>("[data-drop-zone]")!;
  const results = document.querySelector<HTMLElement>("[data-results]")!;
  const sample = document.querySelector<HTMLButtonElement>("[data-sample]")!;
  let coverUrl = "";
  const reset = () => {
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    coverUrl = "";
    results.replaceChildren();
    input.value = "";
  };
  const showMessage = (message: string) => {
    reset();
    const p = add(results, "p", message);
    p.className = "notice";
  };
  const load = async (file: File) => {
    reset();
    results.setAttribute("aria-busy", "true");
    add(results, "p", `בודקים את ${file.name}…`);
    try {
      await inspect(file);
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : "לא ניתן לקרוא את הקובץ.",
      );
    } finally {
      results.setAttribute("aria-busy", "false");
    }
  };
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) load(file);
  });
  zone.addEventListener("click", (event) => {
    if ((event.target as Element).tagName !== "LABEL") input.click();
  });
  zone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });
  ["dragenter", "dragover"].forEach((name) =>
    zone.addEventListener(name, (event) => {
      event.preventDefault();
      zone.classList.add("is-dragging");
    }),
  );
  ["dragleave", "drop"].forEach((name) =>
    zone.addEventListener(name, (event) => {
      event.preventDefault();
      zone.classList.remove("is-dragging");
    }),
  );
  zone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files[0];
    if (file) load(file);
  });
  sample.addEventListener("click", async () => {
    try {
      const response = await fetch("/hebrew.epub");
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      await load(
        new File([blob], "hebrew.epub", { type: "application/epub+zip" }),
      );
    } catch {
      showMessage("לא ניתן לטעון את ספר הדוגמה כרגע.");
    }
  });

  async function inspect(file: File) {
    if (file.size > 200 * 1024 * 1024)
      add(
        results,
        "p",
        "הקובץ גדול מ־200MB; הבדיקה עשויה להימשך זמן רב.",
      ).className = "notice";
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch {
      throw new Error("זה אינו קובץ ZIP תקין, ולכן אינו EPUB שניתן לבדוק.");
    }
    const names = Object.keys(zip.files);
    const checks: Check[] = [];
    const mimetype = zip.file("mimetype");
    const first = names[0];
    const mimeContent = mimetype ? await mimetype.async("string") : "";
    const mimeCompressed = Boolean(
      mimetype &&
      (mimetype as any)._data?.compressedSize !==
        (mimetype as any)._data?.uncompressedSize,
    );
    if (
      first !== "mimetype" ||
      mimeCompressed ||
      mimeContent !== "application/epub+zip"
    )
      checks.push({
        severity: "שגיאה",
        text: "קובץ mimetype אינו הרשומה הראשונה, דחוס, או שתוכנו אינו application/epub+zip.",
        href: links.structure,
      });
    const containerSource = await read(zip, "META-INF/container.xml");
    if (!containerSource) {
      checks.push({
        severity: "שגיאה",
        text: "META-INF/container.xml חסר.",
        href: links.structure,
      });
      return renderMinimal(file, names, checks);
    }
    const container = xml(containerSource);
    const rootfile = container.getElementsByTagNameNS("*", "rootfile")[0];
    const opfPath = rootfile?.getAttribute("full-path") || "";
    if (!opfPath) {
      checks.push({
        severity: "שגיאה",
        text: "לא נמצא rootfile ב־container.xml.",
        href: links.structure,
      });
      return renderMinimal(file, names, checks);
    }
    const opfSource = await read(zip, opfPath);
    const opf = xml(opfSource);
    if (!opfSource || invalid(opf) || !opf.documentElement) {
      checks.push({
        severity: "שגיאה",
        text: `מסמך OPF חסר, אינו XML תקין, או שהנתיב ${opfPath} ב־container.xml שגוי.`,
        href: links.structure,
      });
      return renderMinimal(file, names, checks);
    }
    const pkg = opf.documentElement;
    const version = pkg.getAttribute("version") || "לא צוין";
    const items = [...opf.getElementsByTagNameNS("*", "item")].map((node) => ({
      id: node.getAttribute("id") || "",
      href: node.getAttribute("href") || "",
      media: node.getAttribute("media-type") || "",
      properties: node.getAttribute("properties") || "",
    }));
    const spine = opf.getElementsByTagNameNS("*", "spine")[0];
    const spineRefs = spine
      ? [...spine.getElementsByTagNameNS("*", "itemref")]
      : [];
    const languages = metadata(opf, "language");
    const rtlBook = languages.some((language) => RTL.test(language));
    const ppd = spine?.getAttribute("page-progression-direction") || "לא צוין";
    if (!languages.length)
      checks.push({
        severity: "שגיאה",
        text: "חסר dc:language במסמך OPF.",
        href: links.rtl,
      });
    const nav = items.find((item) =>
      item.properties.split(/\s+/).includes("nav"),
    );
    const ncx =
      items.find((item) => /ncx/i.test(item.media)) ||
      items.find((item) => item.id === spine?.getAttribute("toc"));
    if (/^3/.test(version) && !nav)
      checks.push({
        severity: "שגיאה",
        text: "ב־EPUB 3 חסר מסמך nav.",
        href: links.nav,
      });
    if (/^2/.test(version) && !ncx)
      checks.push({
        severity: "שגיאה",
        text: "ב־EPUB 2 חסר קובץ NCX.",
        href: links.nav,
      });
    if (/^3/.test(version) && !anyMeta(opf, "dcterms:modified"))
      checks.push({
        severity: "שגיאה",
        text: "ב־EPUB 3 חסר dcterms:modified.",
        href: links.structure,
      });
    if (rtlBook && ppd !== "rtl")
      checks.push({
        severity: "אזהרה",
        text: 'לספר בעל שפת RTL אין page-progression-direction="rtl" ב־spine.',
        href: links.ppd,
      });
    const docs = await sampleDocuments(zip, items, opfPath);
    if (
      rtlBook &&
      docs.some(
        (doc) =>
          !(
            doc.html?.getAttribute("lang") || doc.html?.getAttribute("xml:lang")
          ) ||
          !(doc.html?.getAttribute("dir") || doc.body?.getAttribute("dir")),
      )
    )
      checks.push({
        severity: "אזהרה",
        text: "ייתכן שבמסמכי תוכן חסרים lang או dir לספר RTL (מדגם).",
        href: links.rtl,
      });
    const images = items.filter((item) => item.media.startsWith("image/"));
    const altMissing = docs.reduce(
      (sum, doc) =>
        sum +
        [...doc.doc.getElementsByTagNameNS("*", "img")].filter(
          (img) => !img.hasAttribute("alt"),
        ).length,
      0,
    );
    if (altMissing)
      checks.push({
        severity: "אזהרה",
        text: `${altMissing} תמונות ללא alt במדגם מסמכי התוכן.`,
        href: links.css,
      });
    const fontItems = items.filter((item) => FONT.test(item.media));
    const cssItems = items.filter((item) => /css/.test(item.media));
    const cssSources = await Promise.all(
      cssItems.map(async (item) => ({
        path: pathFor(opfPath, item.href),
        source: await read(zip, pathFor(opfPath, item.href)),
      })),
    );
    const fontUrls = cssSources.flatMap(({ path, source }) =>
      [
        ...source.matchAll(
          /@font-face\s*{[^}]*?src\s*:\s*url\(\s*['"]?([^'"\)]+)['"]?\s*\)/gis,
        ),
      ].map((match) => pathFor(path, match[1])),
    );
    const lowerNames = new Set(names.map((name) => name.toLowerCase()));
    if (fontUrls.some((url) => !lowerNames.has(url.toLowerCase())))
      checks.push({
        severity: "אזהרה",
        text: "גופן שמוזכר ב־@font-face אינו נמצא בחבילה.",
        href: links.css,
      });
    if (
      cssSources.some(({ source }) => cssForbidden(source)) ||
      docs.some((doc) =>
        [...doc.doc.getElementsByTagNameNS("*", "style")].some((style) =>
          cssForbidden(text(style)),
        ),
      )
    )
      checks.push({
        severity: "אזהרה",
        text: "CSS משתמש ב־direction או unicode-bidi, האסורים ב־EPUB 3.3 §6.3.1.2.",
        href: links.rtl,
      });
    const cover =
      items.find((item) =>
        item.properties.split(/\s+/).includes("cover-image"),
      ) ||
      items.find(
        (item) =>
          item.id ===
          [...opf.getElementsByTagNameNS("*", "meta")]
            .find((meta) => meta.getAttribute("name") === "cover")
            ?.getAttribute("content"),
      );
    if (!cover)
      checks.push({
        severity: "אזהרה",
        text: "לא נמצאה תמונת כריכה בהצהרת EPUB 3 או EPUB 2.",
        href: links.structure,
      });
    if (
      ![
        "schema:accessMode",
        "schema:accessibilityFeature",
        "schema:accessibilitySummary",
        "dcterms:conformsTo",
        "a11y:certifiedBy",
      ].some((property) => anyMeta(opf, property))
    )
      checks.push({
        severity: "אזהרה",
        text: "לא נמצא מטא־דאטה של נגישות.",
        href: links.epubcheck,
      });
    for (const image of images) {
      const entry = zip.file(pathFor(opfPath, image.href));
      if (entry && (entry as any)._data?.uncompressedSize > 2 * 1024 * 1024)
        checks.push({
          severity: "אזהרה",
          text: `ייתכן שהתמונה ${image.href} גדולה מ־2MB.`,
          href: links.css,
        });
    }
    if (!fontItems.length && !fontUrls.length)
      checks.push({
        severity: "מידע",
        text: "לא נמצאו גופנים מוטמעים.",
        href: links.css,
      });
    const encryption = await read(zip, "META-INF/encryption.xml");
    if (encryption) {
      const encrypted = xml(encryption);
      const algorithms = [
        ...encrypted.getElementsByTagNameNS("*", "EncryptionMethod"),
      ].map((node) => node.getAttribute("Algorithm") || "");
      const fontOnly = algorithms.every(
        (algorithm) =>
          algorithm === "http://www.idpf.org/2008/embedding" ||
          algorithm === "http://ns.adobe.com/pdf/enc#RC",
      );
      if (fontOnly)
        checks.push({
          severity: "מידע",
          text: "נמצאה ערפול גופנים.",
          href: links.css,
        });
      else
        checks.push({
          severity: "אזהרה",
          text: "הקובץ מוצפן (DRM), אפשר לבדוק רק חלק מהמידע.",
        });
    }
    if (items.some((item) => item.properties.split(/\s+/).includes("scripted")))
      checks.push({
        severity: "מידע",
        text: "נמצאו מסמכי תוכן עם scripted.",
        href: links.structure,
      });
    if (
      [...opf.getElementsByTagNameNS("*", "meta")].some(
        (meta) =>
          meta.getAttribute("property") === "rendition:layout" &&
          text(meta) === "pre-paginated",
      )
    )
      checks.push({ severity: "מידע", text: "זהו EPUB בפריסה קבועה." });
    if (/^2/.test(version))
      checks.push({ severity: "מידע", text: "זהו EPUB 2." });
    render({
      file,
      names,
      zip,
      opfPath,
      opf,
      version,
      items,
      spineRefs,
      docs,
      checks,
      cover,
      cssSources,
      fontItems,
      images,
      ppd,
    });
  }
  function renderMinimal(file: File, names: string[], checks: Check[]) {
    renderChecks(checks);
    const section = add(results, "section");
    section.className = "result-section";
    add(section, "h2", "פרטי הקובץ");
    facts(section, [
      ["שם", file.name],
      ["קבצים", String(names.length)],
      ["גודל", bytes(file.size)],
    ]);
  }
  function facts(section: Element, rows: string[][]) {
    const list = add(section, "dl");
    list.className = "facts";
    rows.forEach(([key, value]) => {
      add(list, "dt", key);
      add(list, "dd", value || "—");
    });
  }
  function renderChecks(checks: Check[]) {
    const section = add(results, "section");
    section.className = "result-section";
    add(section, "h2", "בדיקות");
    const list = add(section, "ul");
    list.className = "check-list";
    const rank = { שגיאה: 0, אזהרה: 1, מידע: 2 };
    checks
      .sort((a, b) => rank[a.severity] - rank[b.severity])
      .forEach((check) => {
        const item = add(list, "li");
        add(item, "span", check.severity).className = "severity";
        link(item, check.text, check.href);
      });
    if (!checks.length) add(section, "p", "לא נמצאו בדיקות להצגה.");
  }
  async function render(data: any) {
    results.replaceChildren();
    const title = metadata(data.opf, "title")[0] || "ללא כותרת";
    const creator = metadata(data.opf, "creator").join(", ");
    const identifier = metadata(data.opf, "identifier").join(", ");
    const publisher = metadata(data.opf, "publisher").join(", ");
    const modified = [...data.opf.getElementsByTagNameNS("*", "meta")].find(
      (meta: Element) => meta.getAttribute("property") === "dcterms:modified",
    );
    const layout = [...data.opf.getElementsByTagNameNS("*", "meta")].find(
      (meta: Element) => meta.getAttribute("property") === "rendition:layout",
    );
    const total = data.names.reduce(
      (sum: number, name: string) =>
        sum + ((data.zip.file(name) as any)?._data?.uncompressedSize || 0),
      0,
    );
    const compressed = data.names.reduce(
      (sum: number, name: string) =>
        sum + ((data.zip.file(name) as any)?._data?.compressedSize || 0),
      0,
    );
    const summary = add(results, "section");
    summary.className = "result-section";
    add(summary, "h2", "סיכום");
    facts(summary, [
      ["כותרת", title],
      ["יוצרים", creator],
      ["שפה", metadata(data.opf, "language").join(", ")],
      ["מזהה", identifier],
      ["מוציא לאור", publisher],
      ["שונה לאחרונה", text(modified)],
      ["גרסת EPUB", data.version],
      ["פריסה", text(layout)],
      ["כיוון התקדמות", data.ppd],
      ["מספר קבצים", String(data.names.length)],
      ["לא דחוס", bytes(total)],
      ["דחוס", bytes(compressed)],
      ["תמונות", String(data.images.length)],
    ]);
    if (data.cover) {
      const entry = data.zip.file(pathFor(data.opfPath, data.cover.href));
      if (entry) {
        coverUrl = URL.createObjectURL(await entry.async("blob"));
        const section = add(results, "section");
        section.className = "result-section";
        add(section, "h2", "כריכה");
        const image = add(section, "img") as HTMLImageElement;
        image.src = coverUrl;
        image.alt = "תמונת הכריכה מתוך הקובץ";
        image.className = "cover";
      }
    }
    const spine = add(results, "section");
    spine.className = "result-section";
    add(spine, "h2", "Spine");
    const spineList = add(spine, "ol");
    spineList.className = "tree";
    data.spineRefs.forEach((ref: Element) => {
      const item = data.items.find(
        (candidate: Item) => candidate.id === ref.getAttribute("idref"),
      );
      add(
        spineList,
        "li",
        `${ref.getAttribute("idref") || ""} → ${item?.href || "לא נמצא"}${ref.getAttribute("linear") ? ` (${ref.getAttribute("linear")})` : ""}`,
      );
    });
    const toc = await tocList(data);
    if (toc) {
      const section = add(results, "section");
      section.className = "result-section";
      add(section, "h2", "תוכן עניינים");
      section.append(toc);
    }
    const language = add(results, "section");
    language.className = "result-section";
    add(language, "h2", "שפה וכיוון — מדגם מסמכים");
    table(
      language,
      ["קובץ", "html lang", "xml:lang", "html dir", "body dir"],
      data.docs.map((doc: any) => [
        doc.path,
        doc.html?.getAttribute("lang") || "",
        doc.html?.getAttribute("xml:lang") || "",
        doc.html?.getAttribute("dir") || "",
        doc.body?.getAttribute("dir") || "",
      ]),
    );
    const fonts = add(results, "section");
    fonts.className = "result-section";
    add(fonts, "h2", "גופנים");
    add(
      fonts,
      "p",
      `גופנים ב־manifest: ${data.fontItems.map((item: Item) => item.href).join(", ") || "אין"}.`,
    );
    add(
      fonts,
      "p",
      `כתובות @font-face: ${data.cssSources.flatMap((x: any) => [...x.source.matchAll(/url\(\s*['"]?([^'"\)]+)/g)].map((m: RegExpMatchArray) => m[1])).join(", ") || "אין"}.`,
    );
    renderChecks(data.checks);
    const files = add(results, "section");
    files.className = "result-section";
    const details = add(files, "details");
    add(details, "summary", `רשימת קבצים (${data.names.length})`);
    table(
      details,
      ["קובץ", "לא דחוס", "דחוס"],
      data.names.map((name: string) => {
        const entry: any = data.zip.file(name);
        return [
          name,
          bytes(entry?._data?.uncompressedSize || 0),
          bytes(entry?._data?.compressedSize || 0),
        ];
      }),
    );
    const note = add(results, "p");
    note.className = "notice";
    note.append("זה לא תחליף ל־");
    link(note, "EPUBCheck", "https://www.w3.org/publishing/epubcheck/");
    note.append(" — כלי בדיקה מלא של EPUB. ");
    link(note, "קראו על EPUBCheck", links.epubcheck);
    const another = add(
      results,
      "button",
      "בדיקת קובץ אחר",
    ) as HTMLButtonElement;
    another.className = "tool-button tool-button--plain";
    another.type = "button";
    another.addEventListener("click", reset);
  }
  function table(parent: Element, headers: string[], rows: string[][]) {
    const wrap = add(parent, "div");
    wrap.className = "result-table-wrap";
    const table = add(wrap, "table");
    table.className = "result-table";
    const head = add(table, "thead");
    const header = add(head, "tr");
    headers.forEach((value) => add(header, "th", value));
    const body = add(table, "tbody");
    rows.forEach((row) => {
      const tr = add(body, "tr");
      row.forEach((value) => add(tr, "td", value));
    });
  }
  async function tocList(data: any) {
    const nav = data.items.find((item: Item) =>
      item.properties.split(/\s+/).includes("nav"),
    );
    const ncx = data.items.find((item: Item) => /ncx/i.test(item.media));
    const item = nav || ncx;
    if (!item) return null;
    const doc = xml(await read(data.zip, pathFor(data.opfPath, item.href)));
    if (invalid(doc)) return null;
    const root = nav
      ? [...doc.getElementsByTagNameNS("*", "nav")].find(
          (node) =>
            node.getAttribute("epub:type") === "toc" ||
            node.getAttributeNS("http://www.idpf.org/2007/ops", "type") ===
              "toc",
        )
      : doc.getElementsByTagNameNS("*", "navMap")[0];
    if (!root) return null;
    const list = document.createElement("ul");
    list.className = "tree";
    const entries = nav
      ? [...root.querySelectorAll("a")]
      : [...root.getElementsByTagNameNS("*", "navLabel")];
    entries.forEach((entry) =>
      add(
        list,
        "li",
        nav ? text(entry) : text(entry.getElementsByTagNameNS("*", "text")[0]),
      ),
    );
    return list;
  }
}
