import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.dirname(fileURLToPath(import.meta.url));
const encoder = new TextEncoder();

/**
 * Compute standard CRC-32 for a Uint8Array buffer.
 */
function crc32(bytes) {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
    }
  }
  return (~c) >>> 0;
}

function pushU16(arr, val) {
  arr.push(val & 0xff, (val >>> 8) & 0xff);
}

function pushU32(arr, val) {
  arr.push(
    val & 0xff,
    (val >>> 8) & 0xff,
    (val >>> 16) & 0xff,
    (val >>> 24) & 0xff,
  );
}

/**
 * Minimal store-only (method 0) ZIP archive builder for EPUB fixtures.
 */
function createZip(filesMap) {
  const localRecords = [];
  const centralDirectory = [];
  let offset = 0;
  const entries = Object.entries(filesMap);

  for (const [name, content] of entries) {
    const nameBytes = encoder.encode(name);
    const dataBytes = content instanceof Uint8Array ? content : encoder.encode(content);
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    // Local file header (signature 0x04034b50)
    pushU32(localRecords, 0x04034b50);
    pushU16(localRecords, 20); // version needed
    pushU16(localRecords, 0);  // general purpose bit flag
    pushU16(localRecords, 0);  // compression method: 0 (store)
    pushU16(localRecords, 0);  // mod time
    pushU16(localRecords, 0);  // mod date
    pushU32(localRecords, crc);
    pushU32(localRecords, size);
    pushU32(localRecords, size);
    pushU16(localRecords, nameBytes.length);
    pushU16(localRecords, 0);  // extra field length
    for (let i = 0; i < nameBytes.length; i++) localRecords.push(nameBytes[i]);
    for (let i = 0; i < dataBytes.length; i++) localRecords.push(dataBytes[i]);

    // Central directory header (signature 0x02014b50)
    pushU32(centralDirectory, 0x02014b50);
    pushU16(centralDirectory, 20); // version made by
    pushU16(centralDirectory, 20); // version needed
    pushU16(centralDirectory, 0);  // flags
    pushU16(centralDirectory, 0);  // method: store
    pushU16(centralDirectory, 0);  // time
    pushU16(centralDirectory, 0);  // date
    pushU32(centralDirectory, crc);
    pushU32(centralDirectory, size);
    pushU32(centralDirectory, size);
    pushU16(centralDirectory, nameBytes.length);
    pushU16(centralDirectory, 0);  // extra length
    pushU16(centralDirectory, 0);  // comment length
    pushU16(centralDirectory, 0);  // disk number
    pushU16(centralDirectory, 0);  // internal attrs
    pushU32(centralDirectory, 0);  // external attrs
    pushU32(centralDirectory, offset);
    for (let i = 0; i < nameBytes.length; i++) centralDirectory.push(nameBytes[i]);

    offset = localRecords.length;
  }

  const cdStart = localRecords.length;
  const cdSize = centralDirectory.length;
  const output = [...localRecords, ...centralDirectory];

  // End of central directory record (signature 0x06054b50)
  pushU32(output, 0x06054b50);
  pushU16(output, 0);
  pushU16(output, 0);
  pushU16(output, entries.length);
  pushU16(output, entries.length);
  pushU32(output, cdSize);
  pushU32(output, cdStart);
  pushU16(output, 0);

  return Buffer.from(output);
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

function buildEpub({
  rtl = true,
  fixed = false,
  drm = false,
  chapterCount = fixed ? 3 : drm ? 2 : 12,
  paragraphsPerChapter = fixed ? 2 : drm ? 2 : 12,
  sentencesPerParagraph = fixed ? 2 : drm ? 2 : 6,
} = {}) {
  const dir = rtl ? 'rtl' : 'ltr';
  const lang = rtl ? 'he' : 'en';
  const bookTitle = fixed
    ? 'ספר בעימוד קבוע'
    : drm
      ? 'ספר מוגן'
      : 'ספר עברי ארוך';

  const manifestItems = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
  ];
  const spineItems = [];
  const navLinks = [];

  for (let i = 0; i < chapterCount; i++) {
    manifestItems.push(
      `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`,
    );
    spineItems.push(`<itemref idref="c${i}"/>`);
    navLinks.push(`<li><a href="c${i}.xhtml">פרק ${i + 1}</a></li>`);
  }

  const fixedMeta = fixed
    ? `<meta property="rendition:layout">pre-paginated</meta>\n    <meta property="rendition:spread">none</meta>`
    : '';

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:12345678-1234-1234-1234-${fixed ? '000000000002' : drm ? '000000000003' : '000000000001'}</dc:identifier>
    <dc:title>${bookTitle}</dc:title>
    <dc:creator>הוצאת epub.co.il</dc:creator>
    <dc:language>${lang}</dc:language>
    <meta property="dcterms:modified">2026-10-24T00:00:00Z</meta>
    ${fixedMeta}
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine page-progression-direction="${dir}">
    ${spineItems.join('\n    ')}
  </spine>
</package>`;

  const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}" dir="${dir}">
<head>
  <meta charset="utf-8"/>
  <title>תוכן עניינים</title>
</head>
<body>
  <nav epub:type="toc" role="doc-toc">
    <h1>תוכן עניינים</h1>
    <ol>
      ${navLinks.join('\n      ')}
    </ol>
  </nav>
</body>
</html>`;

  const files = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': CONTAINER_XML,
    'OEBPS/content.opf': opf,
    'OEBPS/nav.xhtml': navXhtml,
  };

  const baseSentenceHe =
    'שָׁלוֹם עוֹלָם עִם נִיקּוּד מָלֵא, קְרִיאָה רְצִיפָה בְּעִבְרִית מִיָּמִין לִשְׂמֹאל בְּתוֹךְ דַּפְדְּפָן מוֹדֶרְנִי. ';
  const baseSentenceEn =
    'A clear English sentence for testing reflowable pagination and layout consistency across viewports. ';

  for (let i = 0; i < chapterCount; i++) {
    const paragraphs = [];
    for (let p = 0; p < paragraphsPerChapter; p++) {
      const sentence = (rtl ? baseSentenceHe : baseSentenceEn).repeat(sentencesPerParagraph);
      paragraphs.push(
        `<p>פסקה ${p + 1} בפרק ${i + 1}: ${sentence}</p>`,
      );
    }
    const viewportMeta = fixed
      ? `<meta name="viewport" content="width=600, height=800"/>`
      : '';
    const fixedStyle = fixed
      ? `<style>html, body { width: 600px; height: 800px; margin: 0; padding: 32px; box-sizing: border-box; }</style>`
      : '';

    files[`OEBPS/c${i}.xhtml`] = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${lang}" xml:lang="${lang}" dir="${dir}">
<head>
  <meta charset="utf-8"/>
  <title>פרק ${i + 1}</title>
  ${viewportMeta}
  ${fixedStyle}
</head>
<body>
  <section>
    <h1>פרק ${i + 1}</h1>
    ${paragraphs.join('\n    ')}
  </section>
</body>
</html>`;
  }

  if (drm) {
    files['META-INF/encryption.xml'] = `<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
            xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
    <enc:CipherData>
      <enc:CipherReference URI="OEBPS/c0.xhtml"/>
    </enc:CipherData>
  </enc:EncryptedData>
</encryption>`;
  }

  return createZip(files);
}

await mkdir(outDir, { recursive: true });

// 1. long-hebrew.epub: 12 long chapters, RTL with nikud
const longHebrewBuf = buildEpub({
  rtl: true,
  chapterCount: 12,
  paragraphsPerChapter: 24, // several pages per chapter even on desktop (real 60%-bug regression)
  sentencesPerParagraph: 3,
});
await writeFile(path.join(outDir, 'long-hebrew.epub'), longHebrewBuf);

// 2. fixed-layout.epub: 3 pre-paginated pages
const fixedLayoutBuf = buildEpub({
  rtl: true,
  fixed: true,
  chapterCount: 3,
});
await writeFile(path.join(outDir, 'fixed-layout.epub'), fixedLayoutBuf);

// 3. drm.epub: valid zip with META-INF/encryption.xml non-font-obfuscation algorithm
const drmBuf = buildEpub({
  rtl: true,
  drm: true,
});
await writeFile(path.join(outDir, 'drm.epub'), drmBuf);

// 4. corrupt.epub: truncated real EPUB zip (first ~60% of bytes of a valid epub)
const validForCorrupt = buildEpub({
  rtl: true,
  chapterCount: 3,
  paragraphsPerChapter: 4,
  sentencesPerParagraph: 3,
});
const truncatedLength = Math.floor(validForCorrupt.length * 0.6);
await writeFile(
  path.join(outDir, 'corrupt.epub'),
  validForCorrupt.subarray(0, truncatedLength),
);

// 5. not-epub.epub: plain text file (not a zip)
await writeFile(
  path.join(outDir, 'not-epub.epub'),
  'This is plain text, not an EPUB file.\n',
);
