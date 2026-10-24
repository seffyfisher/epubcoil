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

async function saveMobileScreen(page, testInfo, step) {
  await mkdir(screensDir, { recursive: true });
  const slug = deviceSlug(testInfo.project.name);
  await page.screenshot({
    path: path.join(screensDir, `mobile2-${slug}-${step}.png`),
  });
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

/**
 * Perform a real multi-step touch swipe via Chrome DevTools Protocol (CDP).
 */
async function cdpSwipe(
  cdp,
  {
    fromX,
    fromY,
    toX,
    toY,
    steps = 8,
    stepDelayMs = 12,
    holdBeforeEndMs = 0,
    onMidSwipe = null,
  },
) {
  const startX = Math.round(fromX);
  const startY = Math.round(fromY);

  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: startX, y: startY, radiusX: 4, radiusY: 4, force: 1, id: 1 },
    ],
  });

  const midStep = Math.max(1, Math.floor(steps / 2));
  for (let i = 1; i <= steps; i++) {
    if (stepDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, stepDelayMs));
    }
    const t = i / steps;
    const curX = Math.round(fromX + (toX - fromX) * t);
    const curY = Math.round(fromY + (toY - fromY) * t);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: curX, y: curY, radiusX: 4, radiusY: 4, force: 1, id: 1 },
      ],
    });
    if (i === midStep && typeof onMidSwipe === 'function') {
      await onMidSwipe({ curX, curY });
    }
  }

  if (holdBeforeEndMs > 0) {
    await new Promise(resolve => setTimeout(resolve, holdBeforeEndMs));
  }

  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

/**
 * Perform a real touch tap via CDP (`touchStart` -> short hold -> `touchEnd`).
 */
async function cdpTap(cdp, x, y, holdMs = 25) {
  const px = Math.round(x);
  const py = Math.round(y);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: px, y: py, radiusX: 4, radiusY: 4, force: 1, id: 1 }],
  });
  if (holdMs > 0) {
    await new Promise(resolve => setTimeout(resolve, holdMs));
  }
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

test.describe('Mobile-First Gestures & Phone UI (CDP Real Touch)', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      !testInfo.project.use.hasTouch,
      'Touch gesture suite runs only on touch-enabled device projects',
    );
  });

  test('a) swipe forward and back in an RTL book (long-hebrew.epub): finger left->right advances, right->left goes back', async ({
    page,
  }, testInfo) => {
    await page.goto('/reader/');
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'long-hebrew.epub'));
    await waitForReaderReady(page);

    const cdp = await page.context().newCDPSession(page);
    const vp = page.viewportSize();
    const midY = Math.round(vp.height * 0.5);

    const loc0 = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
    }));

    // RTL book: finger left -> right advances to the next page
    await cdpSwipe(cdp, {
      fromX: vp.width * 0.22,
      fromY: midY,
      toX: vp.width * 0.82,
      toY: midY,
      steps: 8,
      stepDelayMs: 14,
    });

    await expect
      .poll(() => page.evaluate(() => window.__reader.getLocation().fraction))
      .toBeGreaterThan(loc0.fraction);

    const loc1 = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
    }));
    expect(loc1.cfi).not.toBe(loc0.cfi);

    // RTL book: finger right -> left goes back to the previous page
    await cdpSwipe(cdp, {
      fromX: vp.width * 0.82,
      fromY: midY,
      toX: vp.width * 0.22,
      toY: midY,
      steps: 8,
      stepDelayMs: 14,
    });

    await expect
      .poll(() => page.evaluate(() => window.__reader.getLocation().fraction))
      .toBeLessThan(loc1.fraction);

    const locBack = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
    }));
    expect(locBack.cfi).toBe(loc0.cfi);
  });

  test('b) swipe forward and back in an LTR book (alice-ltr.epub): finger right->left advances, left->right goes back', async ({
    page,
  }) => {
    await page.goto('/reader/');
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'alice-ltr.epub'));
    await waitForReaderReady(page);

    const cdp = await page.context().newCDPSession(page);
    const vp = page.viewportSize();
    const midY = Math.round(vp.height * 0.5);

    // Double-tap cover image in reflowable book opens full-screen image viewer overlay; Esc closes at same location
    const coverCfi = await page.evaluate(
      () => window.__reader.getLocation().cfi,
    );
    const imgY = Math.round(vp.height * 0.28);
    await cdpTap(cdp, vp.width * 0.5, imgY, 20);
    await page.waitForTimeout(90);
    await cdpTap(cdp, vp.width * 0.5, imgY, 20);
    await expect(page.locator('#image-viewer')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#image-viewer')).toBeHidden();
    expect(
      await page.evaluate(() => window.__reader.getLocation().cfi),
    ).toBe(coverCfi);

    // Step past the cover into Chapter 1 so multi-page swipe forward/back is tested cleanly
    await page.evaluate(() => window.__reader.next());

    const loc0 = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
    }));

    // LTR book: finger right -> left advances to the next page
    await cdpSwipe(cdp, {
      fromX: vp.width * 0.82,
      fromY: midY,
      toX: vp.width * 0.2,
      toY: midY,
      steps: 8,
      stepDelayMs: 14,
    });

    await expect
      .poll(() => page.evaluate(() => window.__reader.getLocation().fraction))
      .toBeGreaterThan(loc0.fraction);

    const loc1 = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
    }));
    expect(loc1.cfi).not.toBe(loc0.cfi);

    // LTR book: finger left -> right goes back
    await cdpSwipe(cdp, {
      fromX: vp.width * 0.2,
      fromY: midY,
      toX: vp.width * 0.82,
      toY: midY,
      steps: 8,
      stepDelayMs: 14,
    });

    await expect
      .poll(() => page.evaluate(() => window.__reader.getLocation().fraction))
      .toBeLessThan(loc1.fraction);
  });

  test('c) mostly-vertical drag does NOT turn the page in paginated mode, and in scroll mode scrolls vertically without changing section', async ({
    page,
  }) => {
    await page.goto('/reader/');
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'long-hebrew.epub'));
    await waitForReaderReady(page);

    // Advance one page so neither direction is clamped
    await page.evaluate(() => window.__reader.next());

    const cdp = await page.context().newCDPSession(page);
    const vp = page.viewportSize();

    const paginatedBefore = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
      page: window.__reader.view.renderer.page,
    }));

    // Mostly-vertical drag (|dy| = 240px >> |dx| = 30px) in paginated mode
    await cdpSwipe(cdp, {
      fromX: vp.width * 0.45,
      fromY: vp.height * 0.72,
      toX: vp.width * 0.53,
      toY: vp.height * 0.28,
      steps: 10,
      stepDelayMs: 14,
    });

    await page.waitForTimeout(200);
    const paginatedAfter = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
      page: window.__reader.view.renderer.page,
    }));
    expect(paginatedAfter.page).toBe(paginatedBefore.page);
    expect(paginatedAfter.cfi).toBe(paginatedBefore.cfi);

    // Switch to scrolled mode
    if (await page.locator('body.chrome-hidden').count()) {
      await page.locator('.tap.centre').click();
    }
    await page.locator('#settings-btn').click();
    await page.locator('[data-k="flow"]').selectOption('scrolled');
    await page.locator('#drawer-close-btn').click();

    await page.evaluate(() => window.__reader.view.goTo(2));
    await expect
      .poll(() => page.evaluate(() => window.__reader.getLocation().section.current))
      .toBe(2);

    const scrollBefore = await page.evaluate(() => ({
      section: window.__reader.getLocation().section.current,
      start: window.__reader.view.renderer.start,
    }));

    // Vertical drag in scroll mode: scrolls vertically (or stays in section 2) and never triggers swipe-turn to another section
    await cdpSwipe(cdp, {
      fromX: vp.width * 0.5,
      fromY: vp.height * 0.72,
      toX: vp.width * 0.52,
      toY: vp.height * 0.28,
      steps: 10,
      stepDelayMs: 15,
    });
    await page.waitForTimeout(300);

    const scrollAfter = await page.evaluate(() => ({
      section: window.__reader.getLocation().section.current,
      start: window.__reader.view.renderer.start,
      fraction: window.__reader.getLocation().fraction,
    }));
    expect(scrollAfter.section).toBe(scrollBefore.section);

    // Clear horizontal swipe in scrolled mode (|dx| > 60px, mostly horizontal) advances in RTL
    await cdpSwipe(cdp, {
      fromX: vp.width * 0.2,
      fromY: vp.height * 0.5,
      toX: vp.width * 0.82,
      toY: vp.height * 0.5,
      steps: 6,
      stepDelayMs: 12,
    });
    await expect
      .poll(() => page.evaluate(() => window.__reader.getLocation().fraction))
      .toBeGreaterThan(scrollAfter.fraction);
  });

  test('d) small horizontal drag (< threshold, slow) snaps back without turning', async ({
    page,
  }) => {
    await page.goto('/reader/');
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'long-hebrew.epub'));
    await waitForReaderReady(page);

    const cdp = await page.context().newCDPSession(page);
    const vp = page.viewportSize();
    const midY = Math.round(vp.height * 0.5);

    const before = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
      page: window.__reader.view.renderer.page,
    }));

    // Drag only ~9% of width (< 18% threshold) slowly and hold before release so velocity is ~0
    const startX = vp.width * 0.45;
    const endX = startX + vp.width * 0.09;
    let movedDuringDrag = false;

    await cdpSwipe(cdp, {
      fromX: startX,
      fromY: midY,
      toX: endX,
      toY: midY,
      steps: 8,
      stepDelayMs: 30,
      holdBeforeEndMs: 140,
      onMidSwipe: async () => {
        const startPx = await page.evaluate(
          () => window.__reader.view.renderer.start,
        );
        if (Math.abs(startPx - vp.width) > 1) {
          movedDuringDrag = true;
        }
      },
    });

    expect(movedDuringDrag).toBe(true);
    await page.waitForTimeout(220);

    const after = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
      page: window.__reader.view.renderer.page,
    }));
    expect(after.page).toBe(before.page);
    expect(after.cfi).toBe(before.cfi);
    expect(after.fraction).toBeCloseTo(before.fraction, 5);
  });

  test('e) swipe through long-hebrew.epub to 100% end (fraction 1, #percent 100%, last section), never stuck > 3 swipes', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180000);
    await page.goto('/reader/');
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'long-hebrew.epub'));
    await waitForReaderReady(page);

    const cdp = await page.context().newCDPSession(page);
    const vp = page.viewportSize();
    const midY = Math.round(vp.height * 0.5);

    let prevFraction = await page.evaluate(
      () => window.__reader.getLocation().fraction,
    );
    let stuckCount = 0;
    let swipes = 0;
    const visitedSections = new Set();

    while (swipes < 400) {
      const loc = await page.evaluate(() => window.__reader.getLocation());
      visitedSections.add(loc.section.current);
      const pctText = (await page.locator('#percent').textContent())?.trim();
      if (loc.fraction >= 1 && pctText === '100%') {
        break;
      }

      await cdpSwipe(cdp, {
        fromX: vp.width * 0.2,
        fromY: midY,
        toX: vp.width * 0.82,
        toY: midY,
        steps: 5,
        stepDelayMs: 8,
      });
      swipes++;

      // Wait for snap animation (110ms) and any section transition to settle
      await page.waitForTimeout(150);

      const nextLoc = await page.evaluate(() => window.__reader.getLocation());
      visitedSections.add(nextLoc.section.current);
      expect(nextLoc.fraction).toBeGreaterThanOrEqual(prevFraction - 1e-4);

      if (Math.abs(nextLoc.fraction - prevFraction) < 1e-5) {
        stuckCount++;
      } else {
        stuckCount = 0;
      }
      expect(stuckCount).toBeLessThanOrEqual(3);
      prevFraction = nextLoc.fraction;
    }

    console.log(
      `[${testInfo.project.name}] swipe-to-100% completed in ${swipes} real CDP swipes`,
    );
    expect(visitedSections.size).toBe(12);
    await expect(page.locator('#percent')).toHaveText('100%');
    const finalLoc = await page.evaluate(() => window.__reader.getLocation());
    expect(finalLoc.fraction).toBe(1);
    expect(finalLoc.section.current).toBe(11);
  });

  test('f) orientation change: setViewportSize portrait->landscape->portrait keeps the same CFI (or same section and fraction within 0.01)', async ({
    page,
  }) => {
    await page.goto('/reader/');
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'long-hebrew.epub'));
    await waitForReaderReady(page);

    // Navigate into Chapter 4 page 2
    await page.evaluate(() => window.__reader.view.goTo(3));
    await page.evaluate(() => window.__reader.next());
    await page.waitForTimeout(150);

    const portraitVp = page.viewportSize();
    const initialLoc = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
      section: window.__reader.getLocation().section.current,
    }));
    expect(initialLoc.section).toBe(3);

    // Rotate to landscape
    await page.setViewportSize({
      width: portraitVp.height,
      height: portraitVp.width,
    });
    await page.waitForTimeout(300);

    const landscapeLoc = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
      section: window.__reader.getLocation().section.current,
    }));
    expect(landscapeLoc.section).toBe(initialLoc.section);
    expect(Math.abs(landscapeLoc.fraction - initialLoc.fraction)).toBeLessThanOrEqual(
      0.015,
    );

    // Rotate back to portrait
    await page.setViewportSize(portraitVp);
    await page.waitForTimeout(300);

    const restoredLoc = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
      section: window.__reader.getLocation().section.current,
    }));
    expect(restoredLoc.section).toBe(initialLoc.section);
    const sameCfiOrCloseFraction =
      restoredLoc.cfi === initialLoc.cfi ||
      Math.abs(restoredLoc.fraction - initialLoc.fraction) <= 0.01;
    expect(sameCfiOrCloseFraction).toBe(true);
  });

  test('g) bottom sheet & library grid: on phone, open contents/settings from bottom bar, verify anchored to bottom, close via backdrop tap and Esc, focus returns to trigger', async ({
    page,
  }, testInfo) => {
    await page.goto('/reader/');
    await expect(page.locator('#library')).toBeVisible();

    // Seed library with two books so the 2-column cover grid is populated for the screenshot
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'alice-ltr.epub'));
    await waitForReaderReady(page);
    await page.locator('#back').click();
    await expect(page.locator('#library')).toBeVisible();

    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'long-hebrew.epub'));
    await waitForReaderReady(page);
    await page.evaluate(() => window.__reader.next());
    await page.locator('#back').click();
    await expect(page.locator('#library')).toBeVisible();

    // Verify 2-column cover grid on phone
    await expect(page.locator('#book-list .book-card')).toHaveCount(2);
    const cardBoxes = await page
      .locator('#book-list .book-card')
      .evaluateAll(els => els.map(el => el.getBoundingClientRect()));
    expect(cardBoxes.length).toBe(2);
    expect(Math.abs(cardBoxes[0].top - cardBoxes[1].top)).toBeLessThan(8);

    await page.locator('#book-list').scrollIntoViewIfNeeded();
    await saveMobileScreen(page, testInfo, 'library-grid');

    // Open long-hebrew from the library grid
    await page.locator('#book-list .book-card .open-saved').first().click();
    await waitForReaderReady(page);

    const vp = page.viewportSize();
    const cdp = await page.context().newCDPSession(page);

    // Ensure chrome is visible and bottom bar holds the tools
    if (await page.locator('body.chrome-hidden').count()) {
      await cdpTap(cdp, vp.width * 0.5, vp.height * 0.5);
    }
    await expect(page.locator('body')).not.toHaveClass(/chrome-hidden/);
    await expect(page.locator('#bottom-tools #toc-btn')).toBeVisible();
    await expect(page.locator('#bottom-tools #settings-btn')).toBeVisible();

    await saveMobileScreen(page, testInfo, 'chrome-shown-bottom-bar');

    // 1. Open Contents bottom sheet from bottom bar
    await page.locator('#bottom-tools #toc-btn').focus();
    await page.locator('#bottom-tools #toc-btn').click();
    await expect(page.locator('#drawer')).toBeVisible();

    const tocSheetBox = await page.locator('#drawer').boundingBox();
    expect(tocSheetBox).not.toBeNull();
    // Sheet must be anchored to the bottom of the phone viewport
    expect(Math.abs(tocSheetBox.y + tocSheetBox.height - vp.height)).toBeLessThanOrEqual(2);
    expect(tocSheetBox.width).toBeCloseTo(vp.width, 0);

    await saveMobileScreen(page, testInfo, 'contents-sheet');

    // Close via real CDP backdrop tap and verify focus returns to #toc-btn
    await cdpTap(cdp, vp.width * 0.5, Math.max(24, tocSheetBox.y - 40));
    await expect(page.locator('#drawer')).toBeHidden();
    const activeAfterBackdrop = await page.evaluate(
      () => document.activeElement?.id,
    );
    expect(activeAfterBackdrop).toBe('toc-btn');

    // 2. Open Settings bottom sheet from bottom bar
    await page.locator('#bottom-tools #settings-btn').focus();
    await page.locator('#bottom-tools #settings-btn').click();
    await expect(page.locator('#drawer')).toBeVisible();

    const settingsSheetBox = await page.locator('#drawer').boundingBox();
    expect(settingsSheetBox).not.toBeNull();
    expect(
      Math.abs(settingsSheetBox.y + settingsSheetBox.height - vp.height),
    ).toBeLessThanOrEqual(2);

    await saveMobileScreen(page, testInfo, 'settings-sheet');

    // Close via Escape and verify focus returns to #settings-btn
    await page.keyboard.press('Escape');
    await expect(page.locator('#drawer')).toBeHidden();
    const activeAfterEsc = await page.evaluate(
      () => document.activeElement?.id,
    );
    expect(activeAfterEsc).toBe('settings-btn');

    // 3. Re-open sheet and close via swipe-down on the grab handle/header
    await page.locator('#bottom-tools #settings-btn').click();
    await expect(page.locator('#drawer')).toBeVisible();
    const handleBox = await page.locator('#drawer-grab-handle').boundingBox();
    expect(handleBox).not.toBeNull();
    await cdpSwipe(cdp, {
      fromX: handleBox.x + handleBox.width / 2,
      fromY: handleBox.y + handleBox.height / 2,
      toX: handleBox.x + handleBox.width / 2,
      toY: handleBox.y + 140,
      steps: 6,
      stepDelayMs: 12,
    });
    await expect(page.locator('#drawer')).toBeHidden();
  });

  test('h) tap zones work by real CDP touch tap in RTL: tap physical left advances, centre tap toggles chrome without resizing reading area', async ({
    page,
  }, testInfo) => {
    await page.goto('/reader/');
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'long-hebrew.epub'));
    await waitForReaderReady(page);

    const cdp = await page.context().newCDPSession(page);
    const vp = page.viewportSize();
    const midY = Math.round(vp.height * 0.5);

    const initialLoc = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
    }));

    // Real CDP touch tap on physical left (x = 12% of width) in RTL book advances page
    await cdpTap(cdp, vp.width * 0.12, midY);

    await expect
      .poll(() => page.evaluate(() => window.__reader.getLocation().fraction))
      .toBeGreaterThan(initialLoc.fraction);

    // Measure reading area (#viewer-wrap and #view) while chrome is visible
    await expect(page.locator('body')).not.toHaveClass(/chrome-hidden/);
    const boxShown = await page.locator('#viewer-wrap').boundingBox();

    // Real CDP touch tap on centre (x = 50%, y = 50%) hides chrome
    await cdpTap(cdp, vp.width * 0.5, midY);
    await expect(page.locator('body')).toHaveClass(/chrome-hidden/);
    await page.waitForTimeout(250);

    const boxHidden = await page.locator('#viewer-wrap').boundingBox();
    expect(boxHidden.width).toBe(boxShown.width);
    expect(boxHidden.height).toBe(boxShown.height);

    await saveMobileScreen(page, testInfo, 'chrome-hidden');

    // Real CDP touch tap on centre reveals chrome again
    await cdpTap(cdp, vp.width * 0.5, midY);
    await expect(page.locator('body')).not.toHaveClass(/chrome-hidden/);
  });

  test('i) edge swipe starting within 10px of the screen edge does not turn the page', async ({
    page,
  }) => {
    await page.goto('/reader/');
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'long-hebrew.epub'));
    await waitForReaderReady(page);

    // Advance one page so neither direction is at start
    await page.evaluate(() => window.__reader.next());

    const cdp = await page.context().newCDPSession(page);
    const vp = page.viewportSize();
    const midY = Math.round(vp.height * 0.5);

    const before = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
      page: window.__reader.view.renderer.page,
    }));

    // Left-edge swipe starting at x = 6px (< 10px from left edge)
    await cdpSwipe(cdp, {
      fromX: 6,
      fromY: midY,
      toX: vp.width * 0.8,
      toY: midY,
      steps: 8,
      stepDelayMs: 12,
    });
    await page.waitForTimeout(180);

    const afterLeftEdge = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
      page: window.__reader.view.renderer.page,
    }));
    expect(afterLeftEdge.page).toBe(before.page);
    expect(afterLeftEdge.cfi).toBe(before.cfi);

    // Right-edge swipe starting at x = width - 6px (< 10px from right edge)
    await cdpSwipe(cdp, {
      fromX: vp.width - 6,
      fromY: midY,
      toX: vp.width * 0.2,
      toY: midY,
      steps: 8,
      stepDelayMs: 12,
    });
    await page.waitForTimeout(180);

    const afterRightEdge = await page.evaluate(() => ({
      cfi: window.__reader.getLocation().cfi,
      fraction: window.__reader.getLocation().fraction,
      page: window.__reader.view.renderer.page,
    }));
    expect(afterRightEdge.page).toBe(before.page);
    expect(afterRightEdge.cfi).toBe(before.cfi);
  });

  test('j) mid-swipe screenshot: pause during touchMove before touchEnd to show live drag preview', async ({
    page,
  }, testInfo) => {
    await page.goto('/reader/');
    await page
      .locator('#file-input')
      .setInputFiles(path.join(fixturesDir, 'long-hebrew.epub'));
    await waitForReaderReady(page);

    const cdp = await page.context().newCDPSession(page);
    const vp = page.viewportSize();
    const midY = Math.round(vp.height * 0.5);

    const startOffset = await page.evaluate(
      () => window.__reader.view.renderer.start,
    );
    let midOffset = startOffset;

    await cdpSwipe(cdp, {
      fromX: vp.width * 0.2,
      fromY: midY,
      toX: vp.width * 0.8,
      toY: midY,
      steps: 8,
      stepDelayMs: 16,
      onMidSwipe: async () => {
        midOffset = await page.evaluate(
          () => window.__reader.view.renderer.start,
        );
        await saveMobileScreen(page, testInfo, 'mid-swipe');
      },
    });

    // Verify the page was physically mid-scroll between pages when the screenshot was taken
    expect(Math.abs(midOffset - startOffset)).toBeGreaterThan(30);
  });
});
