import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');
const screensDir = '/workspace/projects/epubcoil-reader/screens';

function deviceSlug(projectName) {
  return String(projectName || 'device')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function savePagesScreen(page, testInfo, step) {
  await mkdir(screensDir, { recursive: true });
  const rawName = testInfo.project.name;
  const slug = deviceSlug(rawName);
  await page.screenshot({
    path: path.join(screensDir, `pages-${rawName}-${step}.png`),
  });
  if (slug !== rawName) {
    await page.screenshot({
      path: path.join(screensDir, `pages-${slug}-${step}.png`),
    });
  }
}

async function waitForReaderReady(page) {
  await expect(page.locator('#reader')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#loading')).toBeHidden({ timeout: 15000 });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const loc = window.__reader?.getLocation?.();
          return Boolean(
            window.__reader?.view?.book &&
              loc &&
              typeof loc.fraction === 'number' &&
              loc.section &&
              typeof loc.section.current === 'number',
          );
        }),
      { timeout: 15000 },
    )
    .toBe(true);
}

async function showChrome(page) {
  if (await page.locator('body.chrome-hidden').count()) {
    await page.locator('.tap.centre').click();
    await expect(page.locator('body')).not.toHaveClass(/chrome-hidden/);
    await page.waitForTimeout(250);
  }
}

async function hideChrome(page) {
  if (!(await page.locator('body.chrome-hidden').count())) {
    await page.locator('.tap.centre').click();
    await expect(page.locator('body')).toHaveClass(/chrome-hidden/);
    await page.waitForTimeout(250);
  }
}

function parsePageText(text) {
  const cleaned = String(text || '').trim();
  const m = cleaned.match(/^עמוד\s+(~?)(\d+)\s+מתוך\s+(~?)(\d+)$/);
  if (!m) return null;
  return {
    raw: cleaned,
    hasEstimate: Boolean(m[1] || m[3]),
    x: Number(m[2]),
    y: Number(m[4]),
  };
}

test.describe('Relative Page Numbering, Chapter Pages Left & Half-Height Settings Sheet', () => {
  test('a) settings sheet: half-height (<= 55% viewport), no opaque scrim, book text visible above sheet', async ({
    page,
  }, testInfo) => {
    await page.goto('/reader/');
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'long-hebrew.epub'));
    await waitForReaderReady(page);
    await showChrome(page);

    const vp = page.viewportSize();
    const isPhone = vp.width <= 640;

    if (isPhone) {
      await expect(page.locator('#bottom-tools #settings-btn')).toBeVisible();
      await page.locator('#bottom-tools #settings-btn').click();
    } else {
      await page.locator('#settings-btn').click();
    }

    await expect(page.locator('#drawer')).toBeVisible();
    await expect(page.locator('#drawer')).toHaveAttribute('data-kind', 'settings');

    const sheetBox = await page.locator('#drawer').boundingBox();
    expect(sheetBox).not.toBeNull();

    // 1. Height <= 55% of viewport height and anchored to bottom
    expect(sheetBox.height).toBeLessThanOrEqual(vp.height * 0.55);
    expect(Math.abs(sheetBox.y + sheetBox.height - vp.height)).toBeLessThanOrEqual(2);

    // 2. No opaque scrim (backdrop hidden/absent or computed alpha/opacity <= 0.15)
    const scrimCheck = await page.evaluate(() => {
      const backdrop = document.getElementById('modal-backdrop');
      if (!backdrop || backdrop.hidden) {
        return { absent: true, alpha: 0, opacity: 0 };
      }
      const style = getComputedStyle(backdrop);
      const opacity = parseFloat(style.opacity || '1');
      const bg = style.backgroundColor || '';
      const rgbaMatch = bg.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*([\d.]+))?\s*\)/);
      const bgAlpha = rgbaMatch ? (rgbaMatch[1] !== undefined ? parseFloat(rgbaMatch[1]) : 1) : 0;
      return {
        absent: style.display === 'none' || style.visibility === 'hidden',
        alpha: opacity * bgAlpha,
        opacity,
      };
    });
    expect(scrimCheck.absent || scrimCheck.alpha <= 0.15).toBe(true);

    // 3. Book text region above the sheet has height >= 40% of viewport and visible text in iframe
    const viewBox = await page.locator('#view').boundingBox();
    expect(viewBox).not.toBeNull();
    const visibleViewHeightAboveSheet = sheetBox.y - viewBox.y;
    expect(visibleViewHeightAboveSheet).toBeGreaterThanOrEqual(vp.height * 0.4);

    const textAboveSheet = await page.evaluate(sheetTopY => {
      const probeX = window.innerWidth / 2;
      const probeY = Math.round(Math.max(70, sheetTopY * 0.45));
      const hostHit = document.elementFromPoint(probeX, probeY);
      const doc = window.__reader?.view?.renderer?.getContents?.()?.[0]?.doc;
      if (!doc?.body) return { hostTag: hostHit?.tagName, hasVisibleText: false };
      const frame = doc.__hostFrame || doc.defaultView?.frameElement;
      const frameRect = frame?.getBoundingClientRect?.() || { top: 0, left: 0 };

      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      let visibleText = '';
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.nodeValue?.trim()) continue;
        const range = doc.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          const hostTop = frameRect.top + r.top;
          const hostBottom = frameRect.top + r.bottom;
          const hostLeft = frameRect.left + r.left;
          const hostRight = frameRect.left + r.right;
          if (
            r.width > 0 &&
            r.height > 0 &&
            hostTop >= 54 &&
            hostBottom <= sheetTopY - 4 &&
            hostRight > 0 &&
            hostLeft < window.innerWidth
          ) {
            visibleText += node.nodeValue.trim() + ' ';
            break;
          }
        }
        if (visibleText.length > 20) break;
      }
      return {
        hostTag: hostHit?.tagName?.toLowerCase(),
        hasVisibleText: visibleText.trim().length > 0,
        sample: visibleText.trim().slice(0, 40),
      };
    }, sheetBox.y);

    expect(textAboveSheet.hostTag).toBe('foliate-view');
    expect(textAboveSheet.hasVisibleText).toBe(true);

    await savePagesScreen(page, testInfo, 'settings-half-sheet');
  });

  test('b) live settings update behind open sheet & reading position stability across multiple font size changes', async ({
    page,
  }) => {
    await page.goto('/reader/');
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'long-hebrew.epub'));
    await waitForReaderReady(page);

    // Navigate to Chapter 3 page 2 so position is in the middle of a chapter
    await page.evaluate(() => window.__reader.view.goTo(2));
    await page.evaluate(() => window.__reader.next());
    await page.waitForTimeout(100);

    await showChrome(page);
    await page.locator('#settings-btn').click();
    await expect(page.locator('#drawer')).toBeVisible();

    const before = await page.evaluate(() => {
      const loc = window.__reader.getLocation();
      const doc = window.__reader.view.renderer.getContents()[0].doc;
      const computedFontSize = parseFloat(doc.defaultView.getComputedStyle(doc.body).fontSize);
      const rangeText = loc.range?.toString?.()?.trim() || '';
      const anchorPhrase = rangeText.slice(0, 24).trim();
      return {
        section: loc.section.current,
        fraction: loc.fraction,
        cfi: loc.cfi,
        computedFontSize,
        anchorPhrase,
        sectionPages: window.__reader.getPageInfo().sectionPages,
      };
    });
    expect(before.section).toBe(2);
    expect(before.anchorPhrase.length).toBeGreaterThan(4);

    // Perform multiple live font size changes via `input` events without closing the sheet
    for (const size of [120, 140, 85, 135]) {
      await page.locator('#setting-font-size').fill(String(size));
      await page.locator('#setting-font-size').dispatchEvent('input');
      await page.waitForTimeout(150);
      await expect(page.locator('#drawer')).toBeVisible();
    }

    const after = await page.evaluate(anchorPhrase => {
      const loc = window.__reader.getLocation();
      const doc = window.__reader.view.renderer.getContents()[0].doc;
      const computedFontSize = parseFloat(doc.defaultView.getComputedStyle(doc.body).fontSize);
      const visibleText = loc.range?.toString?.() || '';
      return {
        section: loc.section.current,
        fraction: loc.fraction,
        cfi: loc.cfi,
        computedFontSize,
        sectionPages: window.__reader.getPageInfo().sectionPages,
        containsAnchor: visibleText.includes(anchorPhrase),
      };
    }, before.anchorPhrase);

    // Sheet is still open, font size and page count updated live behind it
    await expect(page.locator('#drawer')).toBeVisible();
    expect(after.computedFontSize).toBeGreaterThan(before.computedFontSize);
    expect(after.sectionPages).toBeGreaterThan(before.sectionPages);

    // Reading position stayed stable: same section, original anchor passage still in view, fraction within 0.02
    expect(after.section).toBe(before.section);
    expect(after.containsAnchor).toBe(true);
    expect(Math.abs(after.fraction - before.fraction)).toBeLessThanOrEqual(0.02);
  });

  test('c) page X/Y: increments by 1 on page turn, updates live in scroll mode, recalculates on font size & rotation, and "~" estimate becomes exact', async ({
    page,
  }) => {
    await page.goto('/reader/');
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'long-hebrew.epub'));
    await waitForReaderReady(page);

    const footerPage = page.locator('#footer-page');
    await expect(footerPage).toBeVisible();

    // 1. Estimate marker '~' eventually disappears (exact) for long-hebrew.epub (12 sections)
    await expect
      .poll(
        async () => {
          const parsed = parsePageText(await footerPage.textContent());
          return Boolean(parsed && !parsed.hasEstimate && parsed.y > 20);
        },
        { timeout: 15000 },
      )
      .toBe(true);

    const p1 = parsePageText(await footerPage.textContent());
    expect(p1).not.toBeNull();
    expect(p1.hasEstimate).toBe(false);
    expect(p1.x).toBe(1);
    expect(p1.y).toBeGreaterThan(20);

    // 2. Paginated mode: X increases by 1 on a page turn
    await page.evaluate(() => window.__reader.next());
    const p2 = parsePageText(await footerPage.textContent());
    expect(p2.x).toBe(p1.x + 1);
    expect(p2.y).toBe(p1.y);

    await page.evaluate(() => window.__reader.next());
    const p3 = parsePageText(await footerPage.textContent());
    expect(p3.x).toBe(p2.x + 1);
    expect(p3.y).toBe(p1.y);

    // 3. Font size change changes Y (total) for long-hebrew.epub
    await showChrome(page);
    await page.locator('#settings-btn').click();
    await page.locator('#setting-font-size').fill('140');
    await page.locator('#setting-font-size').dispatchEvent('change');
    await page.locator('#drawer-close-btn').click();

    await expect
      .poll(
        async () => {
          const parsed = parsePageText(await footerPage.textContent());
          return Boolean(parsed && !parsed.hasEstimate && parsed.y !== p1.y);
        },
        { timeout: 15000 },
      )
      .toBe(true);

    const afterFont = parsePageText(await footerPage.textContent());
    expect(afterFont.y).toBeGreaterThan(p1.y);

    // 4. Rotation (setViewportSize landscape) recalculates Y
    const portraitVp = page.viewportSize();
    await page.setViewportSize({
      width: portraitVp.height,
      height: portraitVp.width,
    });

    await expect
      .poll(
        async () => {
          const parsed = parsePageText(await footerPage.textContent());
          return Boolean(parsed && !parsed.hasEstimate && parsed.y !== afterFont.y);
        },
        { timeout: 15000 },
      )
      .toBe(true);

    const landscapePage = parsePageText(await footerPage.textContent());
    expect(landscapePage.y).not.toBe(afterFont.y);

    // Restore portrait viewport
    await page.setViewportSize(portraitVp);
    await expect
      .poll(
        async () => {
          const parsed = parsePageText(await footerPage.textContent());
          return Boolean(parsed && !parsed.hasEstimate && parsed.y === afterFont.y);
        },
        { timeout: 15000 },
      )
      .toBe(true);

    // 5. Scroll mode: X updates live while scrolling the renderer container
    await showChrome(page);
    await page.locator('#settings-btn').click();
    await page.locator('[data-k="flow"]').selectOption('scrolled');
    await page.locator('#drawer-close-btn').click();

    await page.evaluate(() => window.__reader.view.goTo(0));
    await expect
      .poll(async () => parsePageText(await footerPage.textContent())?.x)
      .toBe(1);

    const scrollBefore = parsePageText(await footerPage.textContent());
    expect(scrollBefore.x).toBe(1);

    // Scroll the renderer container down by 2 viewport heights
    await page.evaluate(() => {
      const renderer = window.__reader.view.renderer;
      const scroller = renderer.scrollContainer;
      scroller.scrollTop = Math.min(
        scroller.scrollHeight - scroller.clientHeight,
        Math.round(renderer.size * 2.1),
      );
      scroller.dispatchEvent(new Event('scroll'));
    });

    await expect
      .poll(async () => parsePageText(await footerPage.textContent())?.x)
      .toBeGreaterThan(scrollBefore.x);
  });

  test('d) pages-left-in-chapter: decreases by 1 per turn, shows "נותר עמוד אחד בפרק" then "עמוד אחרון בפרק", and resets on next chapter', async ({
    page,
  }, testInfo) => {
    await page.goto('/reader/');
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'long-hebrew.epub'));
    await waitForReaderReady(page);

    // Ensure chapter 0 has >= 3 pages on all viewports (including wide desktop)
    const sectionPages = await page.evaluate(
      () => window.__reader.getPageInfo().sectionPages,
    );
    if (sectionPages < 3) {
      await showChrome(page);
      await page.locator('#settings-btn').click();
      await page.locator('#setting-font-size').fill('150');
      await page.locator('#setting-font-size').dispatchEvent('change');
      await page.locator('#drawer-close-btn').click();
    }

    const pagesLeftEl = page.locator('#footer-pages-left');
    await expect(pagesLeftEl).toBeVisible();

    const initialInfo = await page.evaluate(() => window.__reader.getPageInfo());
    expect(initialInfo.sectionIndex).toBe(0);
    expect(initialInfo.pagesLeftInChapter).toBeGreaterThanOrEqual(2);
    await expect(pagesLeftEl).toHaveText(
      `נותרו ${initialInfo.pagesLeftInChapter} עמודים בפרק`,
    );

    let expectedRemaining = initialInfo.pagesLeftInChapter;
    while (expectedRemaining > 2) {
      await page.evaluate(() => window.__reader.next());
      expectedRemaining--;
      await expect(pagesLeftEl).toHaveText(`נותרו ${expectedRemaining} עמודים בפרק`);
    }

    // Step to second-to-last page of chapter -> 'נותר עמוד אחד בפרק'
    await page.evaluate(() => window.__reader.next());
    await expect(pagesLeftEl).toHaveText('נותר עמוד אחד בפרק');

    // Step to final page of chapter -> 'עמוד אחרון בפרק'
    await page.evaluate(() => window.__reader.next());
    await expect(pagesLeftEl).toHaveText('עמוד אחרון בפרק');

    await expect
      .poll(
        async () => {
          const parsed = parsePageText(await page.locator('#footer-page').textContent());
          return Boolean(parsed && !parsed.hasEstimate);
        },
        { timeout: 15000 },
      )
      .toBe(true);

    await hideChrome(page);
    await savePagesScreen(page, testInfo, 'footer-last-page');

    // Next turn crosses into Chapter 2 -> resets to a larger number ('נותרו N עמודים בפרק')
    await page.evaluate(() => window.__reader.next());
    const nextChapterInfo = await page.evaluate(() => window.__reader.getPageInfo());
    expect(nextChapterInfo.sectionIndex).toBe(1);
    expect(nextChapterInfo.pagesLeftInChapter).toBeGreaterThanOrEqual(2);
    await expect(pagesLeftEl).toHaveText(
      `נותרו ${nextChapterInfo.pagesLeftInChapter} עמודים בפרק`,
    );
  });

  test('e) numbers recalc after line height and margins change — Y changes and X stays consistent with position', async ({
    page,
  }) => {
    await page.goto('/reader/');
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'long-hebrew.epub'));
    await waitForReaderReady(page);

    const footerPage = page.locator('#footer-page');
    await expect
      .poll(
        async () => {
          const parsed = parsePageText(await footerPage.textContent());
          return Boolean(parsed && !parsed.hasEstimate);
        },
        { timeout: 15000 },
      )
      .toBe(true);

    // Jump to middle of book (Chapter 5, page 2)
    await page.evaluate(() => window.__reader.view.goTo(4));
    await page.evaluate(() => window.__reader.next());
    await page.waitForTimeout(100);

    const before = parsePageText(await footerPage.textContent());
    const beforeFraction = await page.evaluate(
      () => window.__reader.getLocation().fraction,
    );
    expect(before.x).toBeLessThanOrEqual(before.y);
    expect(Math.abs(beforeFraction - before.x / before.y)).toBeLessThan(0.08);

    // Change line-height and margins in settings
    await showChrome(page);
    await page.locator('#settings-btn').click();
    await page.locator('#setting-line-height').fill('2.3');
    await page.locator('#setting-line-height').dispatchEvent('change');
    await page.locator('#setting-margins').fill('68');
    await page.locator('#setting-margins').dispatchEvent('change');
    await page.locator('#drawer-close-btn').click();

    await expect
      .poll(
        async () => {
          const parsed = parsePageText(await footerPage.textContent());
          return Boolean(parsed && !parsed.hasEstimate && parsed.y !== before.y);
        },
        { timeout: 15000 },
      )
      .toBe(true);

    const after = parsePageText(await footerPage.textContent());
    const afterFraction = await page.evaluate(
      () => window.__reader.getLocation().fraction,
    );
    expect(after.y).toBeGreaterThan(before.y);
    expect(after.x).toBeGreaterThanOrEqual(1);
    expect(after.x).toBeLessThanOrEqual(after.y);
    expect(Math.abs(afterFraction - after.x / after.y)).toBeLessThan(0.08);
  });

  test('f) footer stays visible when chrome is hidden; footer toggles in settings hide/show each part and persist across reload', async ({
    page,
  }, testInfo) => {
    await page.goto('/reader/');
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'long-hebrew.epub'));
    await waitForReaderReady(page);

    // Wait for exact page count before taking footer screenshot
    await expect
      .poll(
        async () => {
          const parsed = parsePageText(await page.locator('#footer-page').textContent());
          return Boolean(parsed && !parsed.hasEstimate);
        },
        { timeout: 15000 },
      )
      .toBe(true);

    await hideChrome(page);
    await expect(page.locator('body')).toHaveClass(/chrome-hidden/);

    // Footer and its default-enabled parts remain visible when chrome is hidden
    await expect(page.locator('#reading-footer')).toBeVisible();
    await expect(page.locator('#footer-page')).toBeVisible();
    await expect(page.locator('#footer-pages-left')).toBeVisible();
    await expect(page.locator('#footer-percent')).toBeVisible();
    await expect(page.locator('#footer-chapter')).toBeHidden();

    await savePagesScreen(page, testInfo, 'footer');

    // Open Settings and toggle each footer item
    await showChrome(page);
    await page.locator('#settings-btn').click();
    await expect(page.locator('#drawer')).toBeVisible();

    await page.locator('#setting-footer-page').uncheck();
    await expect(page.locator('#footer-page')).toBeHidden();

    await page.locator('#setting-footer-pages-left').uncheck();
    await expect(page.locator('#footer-pages-left')).toBeHidden();

    await page.locator('#setting-footer-percent').uncheck();
    await expect(page.locator('#footer-percent')).toBeHidden();

    await page.locator('#setting-footer-chapter').check();
    await expect(page.locator('#footer-chapter')).toBeVisible();
    await expect(page.locator('#footer-chapter')).not.toHaveText('');

    // Re-enable page number, leaving: page ON, chapter ON, pages-left OFF, percent OFF
    await page.locator('#setting-footer-page').check();
    await expect(page.locator('#footer-page')).toBeVisible();

    await page.locator('#drawer-close-btn').click();
    await expect(page.locator('#drawer')).toBeHidden();

    // Reload and verify toggles persisted
    await page.reload();
    await waitForReaderReady(page);

    await expect(page.locator('#footer-page')).toBeVisible();
    await expect(page.locator('#footer-chapter')).toBeVisible();
    await expect(page.locator('#footer-pages-left')).toBeHidden();
    await expect(page.locator('#footer-percent')).toBeHidden();
  });
});
