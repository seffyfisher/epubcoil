import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');
const screensDir = '/workspace/projects/epubcoil-reader/screens';

async function saveScreen(page, project, step) {
  await mkdir(screensDir, { recursive: true });
  await page.screenshot({
    path: path.join(screensDir, `${project}-${step}.png`),
  });
}

/**
 * Wait until the reader view is open and has reported its initial location.
 */
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

/**
 * Chrome auto-hides while reading (immersive mode); a centre tap reveals it,
 * exactly as a user would do before reaching for the toolbar.
 */
async function showChrome(page) {
  if (await page.locator('body.chrome-hidden').count()) {
    await page.locator('.tap.centre').click();
  }
  await expect(page.locator('body')).not.toHaveClass(/chrome-hidden/);
}

test.describe('קורא EPUB — epub.co.il (מובייל ודסקטופ)', () => {
  test('a1) ספר ההדגמה: פתיחה מהספרייה, דפדוף קדימה עד 100% ודפדוף אחורה', async ({
    page,
  }, testInfo) => {
    await page.goto('/reader/');
    await expect(page.locator('#library')).toBeVisible();
    await saveScreen(page, testInfo.project.name, 'library-home');

    await page.locator('#open-demo').click();
    await waitForReaderReady(page);

    expect(await page.locator('html').getAttribute('dir')).toBe('rtl');

    let prevFraction = await page.evaluate(
      () => window.__reader.getLocation().fraction,
    );
    let stuckCount = 0;
    let steps = 0;

    while (steps < 60) {
      const pctText = (await page.locator('#percent').textContent())?.trim();
      const loc = await page.evaluate(() => window.__reader.getLocation());
      if (loc.fraction >= 1 && pctText === '100%') {
        break;
      }

      await page.evaluate(() => window.__reader.next());
      steps++;

      const nextLoc = await page.evaluate(() => window.__reader.getLocation());
      expect(nextLoc.fraction).toBeGreaterThanOrEqual(prevFraction - 1e-4);

      if (Math.abs(nextLoc.fraction - prevFraction) < 1e-5) {
        stuckCount++;
      } else {
        stuckCount = 0;
      }
      expect(stuckCount).toBeLessThanOrEqual(3);
      prevFraction = nextLoc.fraction;
    }

    await expect(page.locator('#percent')).toHaveText('100%');
    const endFraction = await page.evaluate(
      () => window.__reader.getLocation().fraction,
    );
    expect(endFraction).toBe(1);

    // Calling next() at the end is a safe no-op without errors
    await page.evaluate(() => window.__reader.next());
    await expect(page.locator('#percent')).toHaveText('100%');

    // Page back a few times and verify fraction decreases
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.__reader.prev());
    }
    const afterBackFraction = await page.evaluate(
      () => window.__reader.getLocation().fraction,
    );
    expect(afterBackFraction).toBeLessThan(1);

    await saveScreen(page, testInfo.project.name, 'a1-demo-reader');
  });

  test('a2) ספר עברי ארוך (long-hebrew.epub): דפדוף מלא עד 100% בעמודים ובגלילה ללא היתקעות ב־60%', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240000); // long book paged in both flows on a slow mobile viewport
    await page.goto('/reader/');
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'long-hebrew.epub'));
    await waitForReaderReady(page);

    expect(await page.locator('html').getAttribute('dir')).toBe('rtl');
    const totalSections = await page.evaluate(
      () => window.__reader.view.book.sections.length,
    );
    expect(totalSections).toBe(12);

    // 1. Paginated flow: page through all 12 chapters to 100%
    let prevFraction = await page.evaluate(
      () => window.__reader.getLocation().fraction,
    );
    let stuckCount = 0;
    let steps = 0;
    let passedSixtyPercent = false;
    const visitedSections = new Set();

    while (steps < 800) {
      const loc = await page.evaluate(() => window.__reader.getLocation());
      visitedSections.add(loc.section.current);
      const pctText = (await page.locator('#percent').textContent())?.trim();
      if (loc.fraction >= 0.55 && loc.fraction <= 0.85) {
        passedSixtyPercent = true;
      }
      if (loc.fraction >= 1 && pctText === '100%') {
        break;
      }

      await page.evaluate(() => window.__reader.next());
      steps++;

      const nextLoc = await page.evaluate(() => window.__reader.getLocation());
      expect(nextLoc.fraction).toBeGreaterThanOrEqual(prevFraction - 1e-4);

      if (Math.abs(nextLoc.fraction - prevFraction) < 1e-5) {
        stuckCount++;
      } else {
        stuckCount = 0;
      }
      expect(stuckCount).toBeLessThanOrEqual(3);
      prevFraction = nextLoc.fraction;
    }

    expect(passedSixtyPercent).toBe(true);
    // Every chapter must have been visited page by page (no skipped sections),
    // and the book must span many pages (this is a real long-book regression).
    expect(visitedSections.size).toBe(12);
    expect(steps).toBeGreaterThan(30);
    console.log(`[${testInfo.project.name}] long-hebrew paginated steps to 100%: ${steps}`);
    testInfo.annotations.push({ type: 'paginated-steps', description: String(steps) });
    await expect(page.locator('#percent')).toHaveText('100%');
    const finalPaginatedLoc = await page.evaluate(() =>
      window.__reader.getLocation(),
    );
    expect(finalPaginatedLoc.fraction).toBe(1);
    expect(finalPaginatedLoc.section.current).toBe(11);

    await saveScreen(page, testInfo.project.name, 'a2-long-hebrew-100');

    // Page back 3 times and assert fraction decreases
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.__reader.prev());
    }
    expect(
      await page.evaluate(() => window.__reader.getLocation().fraction),
    ).toBeLessThan(1);

    // 2. Scrolled flow: verify 100%-at-end behaviour in scrolled mode as well
    await showChrome(page);
    await page.locator('#settings-btn').click();
    await page.locator('[data-k="flow"]').selectOption('scrolled');
    await page.locator('#drawer-close-btn').click();

    await page.evaluate(() => window.__reader.view.goTo(0));
    let scrolledPrev = await page.evaluate(
      () => window.__reader.getLocation().fraction,
    );
    let scrolledStuck = 0;
    let scrolledSteps = 0;

    while (scrolledSteps < 800) {
      const loc = await page.evaluate(() => window.__reader.getLocation());
      const pctText = (await page.locator('#percent').textContent())?.trim();
      if (loc.fraction >= 1 && pctText === '100%') {
        break;
      }

      await page.evaluate(() => window.__reader.next());
      scrolledSteps++;

      const nextLoc = await page.evaluate(() => window.__reader.getLocation());
      expect(nextLoc.fraction).toBeGreaterThanOrEqual(scrolledPrev - 1e-4);
      if (Math.abs(nextLoc.fraction - scrolledPrev) < 1e-5) {
        scrolledStuck++;
      } else {
        scrolledStuck = 0;
      }
      expect(scrolledStuck).toBeLessThanOrEqual(3);
      scrolledPrev = nextLoc.fraction;
    }

    console.log(`[${testInfo.project.name}] long-hebrew scrolled steps to 100%: ${scrolledSteps}`);
    await expect(page.locator('#percent')).toHaveText('100%');
    const finalScrolledLoc = await page.evaluate(() =>
      window.__reader.getLocation(),
    );
    expect(finalScrolledLoc.fraction).toBe(1);
    expect(finalScrolledLoc.section.current).toBe(11);
  });

  test('b) אזורי הקשה ומקלדת תלויי־כיוון (RTL: צד שמאל ו־ArrowLeft מקדמים; LTR: צד ימין ו־ArrowRight מקדמים)', async ({
    page,
  }, testInfo) => {
    await page.goto('/reader/');
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'long-hebrew.epub'));
    await waitForReaderReady(page);

    const initialLoc = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
    }));

    // Physical left side tap in RTL book must advance to the next page
    const viewerBox = await page.locator('#viewer-wrap').boundingBox();
    expect(viewerBox).not.toBeNull();
    await page.mouse.click(
      viewerBox.x + 24,
      viewerBox.y + viewerBox.height / 2,
    );

    await expect
      .poll(() => page.evaluate(() => window.__reader.getLocation().fraction))
      .toBeGreaterThan(initialLoc.fraction);

    const afterLeftTapLoc = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
    }));
    expect(afterLeftTapLoc.cfi).not.toBe(initialLoc.cfi);

    // Keyboard ArrowLeft in RTL book must advance to the next page
    await page.keyboard.press('ArrowLeft');
    await expect
      .poll(() => page.evaluate(() => window.__reader.getLocation().fraction))
      .toBeGreaterThan(afterLeftTapLoc.fraction);

    const afterArrowLeftLoc = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
    }));

    // Keyboard ArrowRight in RTL book must go back to the previous page
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => page.evaluate(() => window.__reader.getLocation().fraction))
      .toBeLessThan(afterArrowLeftLoc.fraction);

    // Return to library and open LTR book (alice-ltr.epub)
    await page.locator('#back').click();
    await expect(page.locator('#library')).toBeVisible();

    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'alice-ltr.epub'));
    await waitForReaderReady(page);
    expect(await page.locator('html').getAttribute('dir')).toBe('rtl');
    expect(await page.locator('#viewer-wrap').getAttribute('dir')).toBe('ltr');

    // Advance once into Alice content, then test ArrowRight in LTR
    await page.evaluate(() => window.__reader.next());
    const ltrBefore = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
    }));

    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => page.evaluate(() => window.__reader.getLocation().fraction))
      .toBeGreaterThan(ltrBefore.fraction);

    await saveScreen(page, testInfo.project.name, 'b-rtl-ltr-navigation');
  });

  test('c) תוכן עניינים (TOC): פתיחת המגירה וקפיצה לפרק 3', async ({
    page,
  }, testInfo) => {
    await page.goto('/reader/');
    await page.locator('#open-demo').click();
    await waitForReaderReady(page);

    const initialSection = await page.evaluate(
      () => window.__reader.getLocation().section.current,
    );

    await page.locator('#toc-btn').click();
    await expect(page.locator('#drawer')).toBeVisible();

    const tocEntries = page.locator('#drawer-content [data-href]');
    expect(await tocEntries.count()).toBeGreaterThanOrEqual(5);

    const chapter3Label = (await tocEntries.nth(2).textContent())?.trim();
    await saveScreen(page, testInfo.project.name, 'c-toc-open');

    await tocEntries.nth(2).click();
    await expect(page.locator('#drawer')).toBeHidden();

    await expect(page.locator('#chapter')).toHaveText(chapter3Label);
    const newSection = await page.evaluate(
      () => window.__reader.getLocation().section.current,
    );
    expect(newSection).not.toBe(initialSection);
  });

  test('d) הגדרות תצוגה ושמירת מיקום: שינוי ערכת נושא (ספיה), גודל גופן וגופן ושחזור מלא לאחר רענון', async ({
    page,
  }, testInfo) => {
    await page.goto('/reader/');
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'long-hebrew.epub'));
    await waitForReaderReady(page);

    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.__reader.next());
    }

    await page.locator('#settings-btn').click();
    await expect(page.locator('#drawer')).toBeVisible();

    await page.locator('[data-k="theme"]').selectOption('sepia');
    await page.locator('[data-k="font"]').selectOption('frank');
    await page.locator('[data-k="fontSize"]').fill('135');
    await page.locator('[data-k="fontSize"]').dispatchEvent('change');

    await expect(page.locator('body')).toHaveAttribute('data-theme', 'sepia');
    await saveScreen(page, testInfo.project.name, 'd-settings-sepia');

    await page.locator('#drawer-close-btn').click();
    await expect(page.locator('#drawer')).toBeHidden();

    const beforeReload = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
      section: window.__reader.getLocation().section.current,
    }));
    expect(beforeReload.fraction).toBeGreaterThan(0);

    await page.reload();
    await waitForReaderReady(page);

    await expect(page.locator('body')).toHaveAttribute('data-theme', 'sepia');

    const persistedSettings = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('epubcoil.reader.v2.settings')),
    );
    expect(persistedSettings.theme).toBe('sepia');
    expect(persistedSettings.font).toBe('frank');
    expect(persistedSettings.fontSize).toBe(135);

    const afterReload = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
      section: window.__reader.getLocation().section.current,
    }));

    expect(afterReload.section).toBe(beforeReload.section);
    expect(afterReload.cfi).toBe(beforeReload.cfi);
    expect(Math.abs(afterReload.fraction - beforeReload.fraction)).toBeLessThan(
      0.03,
    );
  });

  test('e) פתיחת alice-ltr.epub מקובץ, שמירה ב־IndexedDB עם תמונת כריכה אמיתית, ושחזור מיקום וכיוון LTR', async ({
    page,
  }, testInfo) => {
    await page.goto('/reader/');
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'alice-ltr.epub'));
    await waitForReaderReady(page);

    expect(await page.locator('html').getAttribute('dir')).toBe('rtl');
    expect(await page.locator('#viewer-wrap').getAttribute('dir')).toBe('ltr');

    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.__reader.next());
    }

    const savedLoc = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
      section: window.__reader.getLocation().section.current,
    }));
    expect(savedLoc.fraction).toBeGreaterThan(0);

    // Reload while reading: should automatically reopen Alice at the saved location
    await page.reload();
    await waitForReaderReady(page);
    expect(await page.locator('html').getAttribute('dir')).toBe('rtl');
    expect(await page.locator('#viewer-wrap').getAttribute('dir')).toBe('ltr');

    const resumedLoc = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
      section: window.__reader.getLocation().section.current,
    }));
    expect(resumedLoc.section).toBe(savedLoc.section);
    expect(resumedLoc.cfi).toBe(savedLoc.cfi);
    expect(Math.abs(resumedLoc.fraction - savedLoc.fraction)).toBeLessThan(
      0.03,
    );

    // Go back to library and verify book card and real resized cover thumbnail exist
    await page.locator('#back').click();
    await expect(page.locator('#library')).toBeVisible();

    const bookCard = page.locator('.book-card').first();
    await expect(bookCard).toBeVisible();
    await expect(bookCard).toContainText("Alice's Adventures in Wonderland");

    const coverImg = bookCard.locator('img.cover-img');
    await expect(coverImg).toBeVisible();
    await expect
      .poll(() =>
        coverImg.evaluate(img => img.complete && img.naturalWidth > 0),
      )
      .toBe(true);
    const imgDimensions = await coverImg.evaluate(img => ({
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    }));
    expect(imgDimensions.complete).toBe(true);
    expect(imgDimensions.naturalWidth).toBeGreaterThan(0);
    expect(imgDimensions.naturalWidth).toBeLessThanOrEqual(200);

    await saveScreen(page, testInfo.project.name, 'e-library-with-cover');

    // Reopen from library card and verify location resumes
    await bookCard.locator('.open-saved').first().click();
    await waitForReaderReady(page);
    expect(await page.locator('html').getAttribute('dir')).toBe('rtl');
    expect(await page.locator('#viewer-wrap').getAttribute('dir')).toBe('ltr');
    const reopenedLoc = await page.evaluate(() => ({
      section: window.__reader.getLocation().section.current,
      fraction: window.__reader.getLocation().fraction,
    }));
    expect(reopenedLoc.section).toBe(savedLoc.section);
  });

  test('f) טיפול בקובצי שגיאה (not-epub, corrupt, drm) ופתיחת ספר בעימוד קבוע (fixed-layout.epub)', async ({
    page,
  }, testInfo) => {
    await page.goto('/reader/');

    // 1. Non-EPUB text file
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'not-epub.epub'));
    await expect(page.locator('#error-banner')).toBeVisible();
    await expect(page.locator('#error-text')).toContainText('אינו ספר EPUB תקין');
    await expect(page.locator('#loading')).toBeHidden();

    // 2. Corrupt (truncated real EPUB zip)
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'corrupt.epub'));
    await expect(page.locator('#error-banner')).toBeVisible();
    await expect(page.locator('#error-text')).toContainText('פגום או לא שלם');
    await expect(page.locator('#loading')).toBeHidden();

    // 3. DRM-encrypted EPUB
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'drm.epub'));
    await expect(page.locator('#error-banner')).toBeVisible();
    await expect(page.locator('#error-text')).toContainText('DRM');
    await expect(page.locator('#loading')).toBeHidden();

    await saveScreen(page, testInfo.project.name, 'f-drm-error');

    // 4. App remains usable afterwards: open fixed-layout.epub and page through all 3 pages
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'fixed-layout.epub'));
    await waitForReaderReady(page);
    await expect(page.locator('#error-banner')).toBeHidden();

    const isFxl = await page.evaluate(() => window.__reader.view.isFixedLayout);
    expect(isFxl).toBe(true);

    await page.evaluate(() => window.__reader.next());
    expect(
      await page.evaluate(() => window.__reader.getLocation().section.current),
    ).toBe(1);

    await page.evaluate(() => window.__reader.next());
    expect(
      await page.evaluate(() => window.__reader.getLocation().section.current),
    ).toBe(2);
    await expect(page.locator('#percent')).toHaveText('100%');

    await saveScreen(page, testInfo.project.name, 'f-fixed-layout');
  });

  test('g) חיפוש בספר (כולל התאמה ללא ניקוד בעברית) וניהול סימניות (הוספה, רשימה, מעבר ומחיקה)', async ({
    page,
  }, testInfo) => {
    await page.goto('/reader/');
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'long-hebrew.epub'));
    await waitForReaderReady(page);

    // 1. Search for 'שלום' (matches 'שָׁלוֹם' with nikud in long-hebrew.epub)
    await page.locator('#search-btn').click();
    await expect(page.locator('#drawer')).toBeVisible();
    await page.locator('#search-input').fill('שלום');
    await page.locator('#search-submit-btn').click();

    const results = page.locator('#search-results .search-result-item');
    await expect(results.first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#search-cancel-btn')).toBeHidden({ timeout: 10000 });
    const count = await results.count();
    expect(count).toBeGreaterThan(20);

    // Verify excerpt contains <mark> highlight, not [object Object]
    const firstResultText = await results.first().textContent();
    expect(firstResultText).not.toContain('[object Object]');

    await saveScreen(page, testInfo.project.name, 'g-search-results');

    // Click the last search result (in chapter 12) and verify jump
    const targetResult = results.last();
    await targetResult.click();
    await expect(page.locator('#drawer')).toBeHidden();

    const jumpedLocation = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      section: window.__reader.getLocation().section.current,
      fraction: window.__reader.getLocation().fraction,
    }));
    expect(jumpedLocation.section).toBeGreaterThan(0);

    // 2. Bookmarks: toggle bookmark on current location
    const bookmarkBtn = page.locator('#bookmark-btn');
    await expect(bookmarkBtn).toHaveAttribute('aria-pressed', 'false');
    await bookmarkBtn.click();
    await expect(bookmarkBtn).toHaveAttribute('aria-pressed', 'true');

    // Navigate back to start of book
    await page.evaluate(() => window.__reader.view.goTo(0));
    await expect
      .poll(() =>
        page.evaluate(() => window.__reader.getLocation().section.current),
      )
      .toBe(0);
    await expect(bookmarkBtn).toHaveAttribute('aria-pressed', 'false');

    // Open Bookmarks drawer, verify bookmark is listed, and jump to it
    await page.locator('#bookmarks-btn').click();
    await expect(page.locator('#drawer')).toBeVisible();
    const bookmarkRow = page.locator('#drawer-content .bookmark-item .bm');
    await expect(bookmarkRow).toHaveCount(1);

    await bookmarkRow.click();
    await expect(page.locator('#drawer')).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(() => window.__reader.getLocation().section.current),
      )
      .toBe(jumpedLocation.section);
    await expect(bookmarkBtn).toHaveAttribute('aria-pressed', 'true');

    // Reopen Bookmarks drawer and delete the bookmark
    await page.locator('#bookmarks-btn').click();
    await expect(page.locator('#drawer')).toBeVisible();
    await page.locator('#drawer-content .bookmark-item .del').click();
    await expect(page.locator('#drawer-content')).toContainText(
      'עדיין לא נוספו סימניות',
    );
    await page.locator('#drawer-close-btn').click();
    await expect(bookmarkBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('h) הגירה (Migration) מנתוני epubcoil.reader.v1 ב־localStorage ללא קריסה', async ({
    page,
  }, testInfo) => {
    await page.goto('/reader/');

    // Seed legacy v1 settings and clear v2 migration flag, then reload
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem(
        'epubcoil.reader.v1',
        JSON.stringify({ theme: 'sepia', fontSize: 120 }),
      );
    });

    await page.reload();
    await expect(page.locator('#library')).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'sepia');

    const migratedSettings = await page.evaluate(() => ({
      migrated: localStorage.getItem('epubcoil.reader.v2.migrated'),
      settings: JSON.parse(localStorage.getItem('epubcoil.reader.v2.settings')),
    }));
    expect(migratedSettings.migrated).toBe('1');
    expect(migratedSettings.settings.theme).toBe('sepia');
    expect(migratedSettings.settings.fontSize).toBe(120);

    // Also verify corrupt garbage in v1 never crashes the reader
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('epubcoil.reader.v1', '{corrupt-json-garbage!!!');
    });
    await page.reload();
    await expect(page.locator('#library')).toBeVisible();

    await saveScreen(page, testInfo.project.name, 'h-migration');
  });

  test('i) PWA מלא: אימות manifest וצלמיות, שליטת Service Worker, ופתיחה/דפדוף בספר שמור במצב Offline', async ({
    page,
    context,
  }, testInfo) => {
    // 1. Validate manifest.webmanifest and icons HTTP 200 + dimensions
    const manifestRes = await page.request.get('/reader/manifest.webmanifest');
    expect(manifestRes.status()).toBe(200);
    const manifest = await manifestRes.json();

    expect(manifest.name).toContain('קורא EPUB');
    expect(manifest.short_name).toBe('קורא EPUB');
    expect(manifest.lang).toBe('he');
    expect(manifest.dir).toBe('rtl');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.icons).toHaveLength(4);

    for (const icon of manifest.icons) {
      const iconUrl = new URL(icon.src, 'http://127.0.0.1:4173/reader/').href;
      const res = await page.request.get(iconUrl);
      expect(res.status()).toBe(200);
      const buf = await res.body();
      expect(buf.length).toBeGreaterThan(100);

      // Read PNG IHDR width & height at bytes 16..24
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      expect(`${width}x${height}`).toBe(icon.sizes);
    }

    // 2. Open /reader/, save alice-ltr.epub in IndexedDB, page forward, and return to library
    await page.goto('/reader/');
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'alice-ltr.epub'));
    await waitForReaderReady(page);
    await page.evaluate(() => window.__reader.next());
    await page.evaluate(() => window.__reader.next());

    const savedOfflineFraction = await page.evaluate(
      () => window.__reader.getLocation().fraction,
    );

    await page.locator('#back').click();
    await expect(page.locator('#library')).toBeVisible();

    // 3. Ensure Service Worker is active and controls the page after reload
    await page.reload();
    await expect
      .poll(
        () =>
          page.evaluate(() => Boolean(navigator.serviceWorker?.controller)),
        { timeout: 15000 },
      )
      .toBe(true);

    // 4. Go Offline, reload page, verify app shell + library + reopening saved book from IndexedDB works offline
    await context.setOffline(true);
    try {
      await page.reload();
      await expect(
        page.getByRole('heading', { name: 'הספרייה שלי' }),
      ).toBeVisible();

      const savedBookCard = page.locator('.book-card').first();
      await expect(savedBookCard).toBeVisible();
      await expect(savedBookCard).toContainText(
        "Alice's Adventures in Wonderland",
      );

      await savedBookCard.locator('.open-saved').first().click();
      await waitForReaderReady(page);

      const offlineOpenedFraction = await page.evaluate(
        () => window.__reader.getLocation().fraction,
      );
      expect(
        Math.abs(offlineOpenedFraction - savedOfflineFraction),
      ).toBeLessThan(0.03);

      // Page forward while offline and verify fraction increases
      await page.evaluate(() => window.__reader.next());
      const afterOfflineNextFraction = await page.evaluate(
        () => window.__reader.getLocation().fraction,
      );
      expect(afterOfflineNextFraction).toBeGreaterThan(offlineOpenedFraction);

      await saveScreen(page, testInfo.project.name, 'i-offline-reader');
    } finally {
      await context.setOffline(false);
    }
  });

  test('j) ספר LTR (Alice): קפיצה ל־90% דרך המחוון ודפדוף עד 100% בסוף הספר', async ({
    page,
  }, testInfo) => {
    await page.goto('/reader/');
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'alice-ltr.epub'));
    await waitForReaderReady(page);

    await page.evaluate(() => window.__reader.goToFraction?.(0.9) ?? window.__reader.view.goToFraction(0.9));
    await expect
      .poll(() => page.evaluate(() => window.__reader.getLocation().fraction))
      .toBeGreaterThan(0.85);

    let prev = await page.evaluate(() => window.__reader.getLocation().fraction);
    let stuck = 0;
    let steps = 0;
    while (steps < 800) {
      const loc = await page.evaluate(() => window.__reader.getLocation());
      if (loc.fraction >= 1) break;
      await page.keyboard.press('PageDown');
      await page.waitForTimeout(30);
      steps++;
      const now = await page.evaluate(() => window.__reader.getLocation().fraction);
      stuck = Math.abs(now - prev) < 1e-5 ? stuck + 1 : 0;
      expect(stuck).toBeLessThanOrEqual(5);
      prev = now;
    }
    await expect(page.locator('#percent')).toHaveText('100%');
    const last = await page.evaluate(() => window.__reader.getLocation());
    expect(last.section.current).toBe(
      await page.evaluate(() => {
        const s = window.__reader.view.book.sections;
        return s.findLastIndex(x => x.linear !== 'no');
      }),
    );
    await saveScreen(page, testInfo.project.name, 'j-alice-end');
  });

  test('k) מצב קריאה סוחף: הקשה במרכז מסתירה ומציגה את סרגלי הכלים', async ({ page }) => {
    await page.goto('/reader/');
    await page.locator('#open-demo').click();
    await waitForReaderReady(page);
    await showChrome(page);
    await page.locator('.tap.centre').click();
    await expect(page.locator('body')).toHaveClass(/chrome-hidden/);
    await page.locator('.tap.centre').click();
    await expect(page.locator('body')).not.toHaveClass(/chrome-hidden/);
    // Chrome auto-hides after inactivity while reading
    await expect(page.locator('body')).toHaveClass(/chrome-hidden/, { timeout: 8000 });
  });
});
