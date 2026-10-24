import { STRINGS } from './he.js';
import { isStoragePersisted } from './storage.js';

const HEBREW_UNICODE_RANGE =
  'U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F';
const LATIN_UNICODE_RANGE =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

const FONT_DEFINITIONS = [
  {
    family: 'Frank Ruhl Libre',
    slug: 'frank-ruhl-libre',
  },
  {
    family: 'David Libre',
    slug: 'david-libre',
  },
  {
    family: 'Noto Serif Hebrew',
    slug: 'noto-serif-hebrew',
  },
  {
    family: 'Heebo',
    slug: 'heebo',
  },
  {
    family: 'Assistant',
    slug: 'assistant',
  },
];

const FONT_STACK_MAP = {
  default: null,
  frank: '"Frank Ruhl Libre", serif',
  david: '"David Libre", serif',
  noto: '"Noto Serif Hebrew", serif',
  heebo: '"Heebo", sans-serif',
  assistant: '"Assistant", sans-serif',
  system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

const THEME_PALETTES = {
  light: {
    paper: '#faf8f2',
    ink: '#1e1b18',
    link: '#6e4715',
    scheme: 'light',
  },
  sepia: {
    paper: '#f2e6cf',
    ink: '#3d2e1e',
    link: '#754614',
    scheme: 'light',
  },
  dark: {
    paper: '#181715',
    ink: '#eae4da',
    link: '#e0ae67',
    scheme: 'dark',
  },
  oled: {
    paper: '#000000',
    ink: '#f2eee8',
    link: '#edb567',
    scheme: 'dark',
  },
};

let cachedFontFacesCSS = null;

/**
 * Build @font-face declarations with absolute URLs resolved via import.meta.url
 * so that fonts load properly inside sandboxed blob: book iframes.
 */
export function getIframeFontFacesCSS() {
  if (cachedFontFacesCSS) return cachedFontFacesCSS;

  const rules = [];
  for (const { family, slug } of FONT_DEFINITIONS) {
    for (const weight of [400, 700]) {
      const hebrewUrl = new URL(
        `../fonts/${slug}-hebrew-${weight}-normal.woff2`,
        import.meta.url,
      ).href;
      const latinUrl = new URL(
        `../fonts/${slug}-latin-${weight}-normal.woff2`,
        import.meta.url,
      ).href;

      rules.push(`
@font-face {
  font-family: "${family}";
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url("${hebrewUrl}") format("woff2");
  unicode-range: ${HEBREW_UNICODE_RANGE};
}
@font-face {
  font-family: "${family}";
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url("${latinUrl}") format("woff2");
  unicode-range: ${LATIN_UNICODE_RANGE};
}`);
    }
  }

  cachedFontFacesCSS = rules.join('\n');
  return cachedFontFacesCSS;
}

/**
 * Resolve 'auto' theme using system prefers-color-scheme media query.
 */
export function resolveEffectiveTheme(themeSetting) {
  if (themeSetting === 'auto' || !THEME_PALETTES[themeSetting]) {
    const prefersDark =
      globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    return prefersDark ? 'dark' : 'light';
  }
  return themeSetting;
}

/**
 * Apply theme attribute to document root and body for chrome styling.
 */
export function applyThemeToDocument(settings) {
  const effective = resolveEffectiveTheme(settings.theme);
  document.documentElement.dataset.theme = effective;
  document.body.dataset.theme = effective;
  return effective;
}

/**
 * Compute a deterministic layout signature string for caching per-section page counts.
 */
export function getLayoutSignature(view, settings) {
  const rect = view?.getBoundingClientRect?.() || {};
  const w = Math.round(rect.width || globalThis.innerWidth || 0);
  const h = Math.round(rect.height || globalThis.innerHeight || 0);
  const flow = settings.flow === 'scrolled' ? 'scrolled' : 'paginated';
  const font = settings.font || 'default';
  const fontSize = Number(settings.fontSize) || 100;
  const lineHeight = Number(settings.lineHeight) || 1.7;
  const margins = Number(settings.margins) || 0;
  const maxWidth = Number(settings.maxWidth) || 720;
  const columns = settings.columns || 'auto';
  const justify = settings.justify ? 1 : 0;
  const hyphenate = settings.hyphenate ? 1 : 0;
  return `${w}x${h}|fl:${flow}|f:${font}|fs:${fontSize}|lh:${lineHeight}|m:${margins}|mw:${maxWidth}|c:${columns}|j:${justify}|hy:${hyphenate}`;
}

/**
 * Apply typography, theme, layout flow, margins, and columns to the active foliate-view renderer.
 */
export function applySettingsToView(view, settings, bookDir = 'rtl') {
  const effectiveTheme = applyThemeToDocument(settings);
  const palette = THEME_PALETTES[effectiveTheme] || THEME_PALETTES.light;

  if (!view || !view.renderer) return;

  const renderer = view.renderer;
  const flow = settings.flow === 'scrolled' ? 'scrolled' : 'paginated';
  const sideMargin = Math.max(0, Number(settings.margins) ?? 32);
  const verticalMargin = Math.max(10, Math.round(14 + sideMargin * 0.44));
  const gapPct = Math.max(3, Math.min(18, Number((3 + sideMargin * 0.095).toFixed(2))));
  const blockPadInline = Math.round(sideMargin * 0.35);

  view.setAttribute('flow', flow);
  renderer.setAttribute('flow', flow);
  renderer.setAttribute('margin', `${verticalMargin}px`);
  renderer.setAttribute('gap', `${gapPct}%`);
  renderer.setAttribute('max-inline-size', `${settings.maxWidth}px`);

  const maxCols = settings.columns === '1' ? '1' : '2';
  renderer.setAttribute('max-column-count', maxCols);

  const prefersReducedMotion =
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (prefersReducedMotion) {
    renderer.removeAttribute('animated');
  } else {
    renderer.setAttribute('animated', '');
  }

  const chosenFontStack = FONT_STACK_MAP[settings.font] || null;
  const fontRule = chosenFontStack
    ? `html, body, p, li, div, blockquote, dd, dt, span { font-family: ${chosenFontStack} !important; }`
    : `body { font-family: "Frank Ruhl Libre", "David Libre", "Noto Serif Hebrew", serif; }`;

  const hyphenRule = settings.hyphenate
    ? '-webkit-hyphens: auto !important; hyphens: auto !important;'
    : '-webkit-hyphens: manual !important; hyphens: manual !important;';

  const textAlign = settings.justify ? 'justify' : 'start';

  const css = `
${getIframeFontFacesCSS()}

html {
  color-scheme: ${palette.scheme} !important;
  background-color: ${palette.paper} !important;
  color: ${palette.ink} !important;
}

body {
  background-color: ${palette.paper} !important;
  color: ${palette.ink} !important;
  font-size: ${settings.fontSize}% !important;
  line-height: ${settings.lineHeight} !important;
  padding-inline: ${sideMargin}px !important;
  letter-spacing: normal !important;
}

${fontRule}

p, li, blockquote, dd {
  line-height: ${settings.lineHeight} !important;
  text-align: ${textAlign} !important;
  padding-inline: ${blockPadInline}px !important;
  ${bookDir === 'ltr' ? hyphenRule : '-webkit-hyphens: none !important; hyphens: none !important;'}
}

a, a:link, a:visited {
  color: ${palette.link} !important;
}

pre, code {
  white-space: pre-wrap !important;
}
`;

  renderer.setStyles?.(css);
}

/**
 * Render the Settings panel inside the drawer container and wire up instant controls.
 */
export async function renderSettingsDrawer(container, {
  settings,
  onUpdateSettings,
  onOpenBookmarks,
  onClearAllData,
  wakeLockSupported = false,
}) {
  const persisted = await isStoragePersisted();
  const storageStatusText = persisted
    ? STRINGS.storageProtected
    : STRINGS.storageUnprotected;

  container.innerHTML = `
    <div class="settings-list">
      <div class="setting-row">
        <label for="setting-theme">${STRINGS.settingTheme}</label>
        <select id="setting-theme" data-k="theme">
          <option value="auto">${STRINGS.themeAuto}</option>
          <option value="light">${STRINGS.themeLight}</option>
          <option value="sepia">${STRINGS.themeSepia}</option>
          <option value="dark">${STRINGS.themeDark}</option>
          <option value="oled">${STRINGS.themeOled}</option>
        </select>
      </div>

      <div class="setting-row">
        <label for="setting-font">${STRINGS.settingFontFamily}</label>
        <select id="setting-font" data-k="font">
          <option value="default">${STRINGS.fontDefault}</option>
          <option value="frank">${STRINGS.fontFrank}</option>
          <option value="david">${STRINGS.fontDavid}</option>
          <option value="noto">${STRINGS.fontNoto}</option>
          <option value="heebo">${STRINGS.fontHeebo}</option>
          <option value="assistant">${STRINGS.fontAssistant}</option>
          <option value="system">${STRINGS.fontSystem}</option>
        </select>
      </div>

      <div class="setting-row">
        <div class="setting-label-group">
          <label for="setting-font-size">${STRINGS.settingFontSize}</label>
          <output id="out-fontSize" for="setting-font-size">${settings.fontSize}%</output>
        </div>
        <input id="setting-font-size" data-k="fontSize" type="range" min="75" max="160" step="5" value="${settings.fontSize}">
      </div>

      <div class="setting-row">
        <div class="setting-label-group">
          <label for="setting-line-height">${STRINGS.settingLineHeight}</label>
          <output id="out-lineHeight" for="setting-line-height">${settings.lineHeight}</output>
        </div>
        <input id="setting-line-height" data-k="lineHeight" type="range" min="1.2" max="2.4" step="0.1" value="${settings.lineHeight}">
      </div>

      <div class="setting-row">
        <div class="setting-label-group">
          <label for="setting-margins">${STRINGS.settingMargins}</label>
          <output id="out-margins" for="setting-margins">${settings.margins}px</output>
        </div>
        <input id="setting-margins" data-k="margins" type="range" min="0" max="80" step="4" value="${settings.margins}">
      </div>

      <div class="setting-row">
        <div class="setting-label-group">
          <label for="setting-max-width">${STRINGS.settingMaxWidth}</label>
          <output id="out-maxWidth" for="setting-max-width">${settings.maxWidth}px</output>
        </div>
        <input id="setting-max-width" data-k="maxWidth" type="range" min="480" max="1100" step="20" value="${settings.maxWidth}">
      </div>

      <div class="setting-row">
        <label for="setting-flow">${STRINGS.settingFlow}</label>
        <select id="setting-flow" data-k="flow">
          <option value="paginated">${STRINGS.flowPaginated}</option>
          <option value="scrolled">${STRINGS.flowScrolled}</option>
        </select>
      </div>

      <div class="setting-row">
        <label for="setting-columns">${STRINGS.settingColumns}</label>
        <select id="setting-columns" data-k="columns">
          <option value="auto">${STRINGS.columnsAuto}</option>
          <option value="1">${STRINGS.columnsOne}</option>
          <option value="2">${STRINGS.columnsTwo}</option>
        </select>
      </div>

      <div class="setting-row setting-toggle">
        <label for="setting-justify">${STRINGS.settingJustify}</label>
        <input id="setting-justify" data-k="justify" type="checkbox">
      </div>

      <div class="setting-row setting-toggle">
        <label for="setting-hyphenate">${STRINGS.settingHyphenate}</label>
        <input id="setting-hyphenate" data-k="hyphenate" type="checkbox">
      </div>

      ${wakeLockSupported ? `
      <div class="setting-row setting-toggle">
        <label for="setting-wakelock">${STRINGS.settingWakeLock}</label>
        <input id="setting-wakelock" data-k="wakeLock" type="checkbox">
      </div>
      ` : ''}

      <div class="setting-section-title">${STRINGS.footerSettingsHeading}</div>

      <div class="setting-row setting-toggle">
        <label for="setting-footer-page">${STRINGS.settingFooterPage}</label>
        <input id="setting-footer-page" data-k="footerPage" type="checkbox">
      </div>

      <div class="setting-row setting-toggle">
        <label for="setting-footer-pages-left">${STRINGS.settingFooterPagesLeft}</label>
        <input id="setting-footer-pages-left" data-k="footerPagesLeft" type="checkbox">
      </div>

      <div class="setting-row setting-toggle">
        <label for="setting-footer-percent">${STRINGS.settingFooterPercent}</label>
        <input id="setting-footer-percent" data-k="footerPercent" type="checkbox">
      </div>

      <div class="setting-row setting-toggle">
        <label for="setting-footer-chapter">${STRINGS.settingFooterChapter}</label>
        <input id="setting-footer-chapter" data-k="footerChapter" type="checkbox">
      </div>

      <div class="storage-status" id="storage-status-note">
        <span>${storageStatusText}</span>
      </div>

      <div class="drawer-actions">
        <button type="button" id="bookmarks-list" class="button">${STRINGS.bookmarksTitle}</button>
        <button type="button" id="clear-data" class="button danger">${STRINGS.clearAllBtn}</button>
      </div>
    </div>
  `;

  // Initialize values and bind change/input listeners
  for (const control of container.querySelectorAll('[data-k]')) {
    const key = control.dataset.k;
    if (control.type === 'checkbox') {
      control.checked = Boolean(settings[key]);
    } else {
      control.value = String(settings[key]);
    }

    const handleChange = event => {
      let nextVal;
      if (control.type === 'checkbox') {
        nextVal = control.checked;
      } else if (control.type === 'range') {
        nextVal = Number(control.value);
      } else {
        nextVal = control.value;
      }

      const outEl = container.querySelector(`#out-${key}`);
      if (outEl) {
        if (key === 'fontSize') outEl.textContent = `${nextVal}%`;
        else if (key === 'margins' || key === 'maxWidth') outEl.textContent = `${nextVal}px`;
        else outEl.textContent = String(nextVal);
      }

      onUpdateSettings({ [key]: nextVal }, { type: event?.type || 'change', key });
    };

    control.addEventListener('input', handleChange);
    control.addEventListener('change', handleChange);
  }

  const bookmarksBtn = container.querySelector('#bookmarks-list');
  if (bookmarksBtn && onOpenBookmarks) {
    bookmarksBtn.addEventListener('click', onOpenBookmarks);
  }

  const clearBtn = container.querySelector('#clear-data');
  if (clearBtn && onClearAllData) {
    clearBtn.addEventListener('click', onClearAllData);
  }
}
