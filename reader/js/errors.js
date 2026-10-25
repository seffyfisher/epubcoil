import { STRINGS } from './he.js';

/**
 * Allowed font-obfuscation algorithms per EPUB 3 OCF specification.
 * These are NOT DRM and must be permitted.
 */
const ALLOWED_OBFUSCATION_ALGORITHMS = new Set([
  'http://www.idpf.org/2008/embedding',
  'http://ns.adobe.com/pdf/enc#RC',
]);

/**
 * Structured error class for reader-specific failures.
 */
export class ReaderError extends Error {
  /**
   * @param {'not-epub'|'drm'|'corrupt'|'missing-opf'|'demo-offline'|'generic'} code
   * @param {string} [detail]
   */
  constructor(code, detail = '') {
    const message = STRINGS.errors[code] || STRINGS.errors.generic;
    super(message);
    this.name = 'ReaderError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Convert any caught error into a user-friendly Hebrew message.
 */
export function getFriendlyErrorMessage(err) {
  if (err instanceof ReaderError) {
    return STRINGS.errors[err.code] || STRINGS.errors.generic;
  }
  const msg = String(err?.message || '').toLowerCase();
  if (msg.includes('drm') || msg.includes('encrypted')) {
    return STRINGS.errors.drm;
  }
  if (msg.includes('not-epub') || msg.includes('unsupportedtype')) {
    return STRINGS.errors['not-epub'];
  }
  if (msg.includes('corrupt') || msg.includes('zip') || msg.includes('central directory') || msg.includes('end of central directory')) {
    return STRINGS.errors.corrupt;
  }
  if (msg.includes('opf') || msg.includes('package document') || msg.includes('container')) {
    return STRINGS.errors['missing-opf'];
  }
  return STRINGS.errors.generic;
}

/**
 * Extract all encryption Algorithm URIs from META-INF/encryption.xml content.
 */
function extractEncryptionAlgorithms(xmlText) {
  const algorithms = new Set();

  try {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (!doc.querySelector('parsererror')) {
      const methods = [
        ...doc.getElementsByTagName('EncryptionMethod'),
        ...doc.getElementsByTagNameNS('*', 'EncryptionMethod'),
      ];
      for (const el of methods) {
        const algo = el.getAttribute('Algorithm')?.trim();
        if (algo) algorithms.add(algo);
      }
    }
  } catch {
    // Fallback to regex matching below
  }

  for (const match of xmlText.matchAll(/Algorithm\s*=\s*["']([^"']+)["']/gi)) {
    if (match[1]?.trim()) {
      algorithms.add(match[1].trim());
    }
  }

  return [...algorithms];
}

/**
 * Validate an EPUB Blob/File using the vendored zip.js before passing it to foliate-js.
 * Distinguishes:
 * - Non-ZIP / non-EPUB files ('not-epub')
 * - Truncated or corrupt ZIP archives ('corrupt')
 * - DRM-protected EPUBs ('drm') vs font obfuscation (allowed)
 * - Missing or empty OPF package documents ('missing-opf')
 */
export async function validateEpubFile(file) {
  if (!file || typeof file.slice !== 'function' || file.size < 4) {
    throw new ReaderError('not-epub', 'File is empty or too small');
  }

  // 1. Check ZIP local file header magic bytes (PK\x03\x04)
  const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZipHeader =
    magic[0] === 0x50 &&
    magic[1] === 0x4b &&
    magic[2] === 0x03 &&
    magic[3] === 0x04;

  if (!isZipHeader) {
    throw new ReaderError('not-epub', 'Missing ZIP magic signature');
  }

  // 2. Open ZIP archive with vendored zip.js and inspect entries
  const { configure, ZipReader, BlobReader, TextWriter } = await import(
    '../vendor/foliate-js/vendor/zip.js'
  );
  configure({ useWebWorkers: false });

  const zipReader = new ZipReader(new BlobReader(file));
  try {
    let entries;
    try {
      entries = await zipReader.getEntries();
    } catch (zipErr) {
      throw new ReaderError('corrupt', zipErr?.message || 'Failed to read ZIP central directory');
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      throw new ReaderError('corrupt', 'ZIP archive has no entries');
    }

    const entryMap = new Map(entries.map(entry => [entry.filename, entry]));

    // 3. Check META-INF/encryption.xml for DRM before anything else
    const encryptionEntry = entryMap.get('META-INF/encryption.xml');
    if (encryptionEntry) {
      let encXml = '';
      try {
        encXml = await encryptionEntry.getData(new TextWriter());
      } catch (readErr) {
        throw new ReaderError('corrupt', readErr?.message || 'Failed to read encryption.xml');
      }

      const algorithms = extractEncryptionAlgorithms(encXml);
      const hasDrm = algorithms.some(algo => !ALLOWED_OBFUSCATION_ALGORITHMS.has(algo));
      if (hasDrm) {
        throw new ReaderError('drm', `Unsupported encryption algorithm: ${algorithms.join(', ')}`);
      }
    }

    // 4. Verify META-INF/container.xml exists and points to a valid OPF
    const containerEntry = entryMap.get('META-INF/container.xml');
    if (!containerEntry) {
      throw new ReaderError('not-epub', 'Missing META-INF/container.xml');
    }

    let containerXml = '';
    try {
      containerXml = await containerEntry.getData(new TextWriter());
    } catch (readErr) {
      throw new ReaderError('corrupt', readErr?.message || 'Failed to extract container.xml');
    }

    if (!containerXml || !containerXml.trim()) {
      throw new ReaderError('corrupt', 'Empty META-INF/container.xml');
    }

    const parser = new DOMParser();
    const containerDoc = parser.parseFromString(containerXml, 'application/xml');
    if (containerDoc.querySelector('parsererror')) {
      throw new ReaderError('corrupt', 'Malformed META-INF/container.xml');
    }

    const rootfiles = [
      ...containerDoc.getElementsByTagName('rootfile'),
      ...containerDoc.getElementsByTagNameNS('*', 'rootfile'),
    ];
    const opfPath = rootfiles[0]?.getAttribute('full-path')?.trim();
    if (!opfPath) {
      throw new ReaderError('missing-opf', 'No rootfile full-path in container.xml');
    }

    // 5. Verify OPF package document exists and is valid XML with spine items
    const opfEntry = entryMap.get(opfPath);
    if (!opfEntry) {
      throw new ReaderError('missing-opf', `OPF entry not found at ${opfPath}`);
    }

    let opfXml = '';
    try {
      opfXml = await opfEntry.getData(new TextWriter());
    } catch (readErr) {
      throw new ReaderError('corrupt', readErr?.message || 'Failed to extract OPF document');
    }

    if (!opfXml || !opfXml.trim()) {
      throw new ReaderError('missing-opf', 'Empty OPF document');
    }

    const opfDoc = parser.parseFromString(opfXml, 'application/xml');
    if (opfDoc.querySelector('parsererror')) {
      throw new ReaderError('corrupt', 'Malformed OPF XML');
    }

    const itemrefs = [
      ...opfDoc.getElementsByTagName('itemref'),
      ...opfDoc.getElementsByTagNameNS('*', 'itemref'),
    ];
    if (itemrefs.length === 0) {
      throw new ReaderError('missing-opf', 'OPF spine has no itemref elements');
    }
  } finally {
    try {
      await zipReader.close();
    } catch {
      // Ignore close errors
    }
  }
}
