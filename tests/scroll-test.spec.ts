import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';

async function addInstrument(page: any, symbol: string = 'BTCUSDT') {
  const addButton = page.locator('button:has-text("+")');
  await addButton.click();
  await page.waitForTimeout(500);
  const symbolOption = page.getByText(symbol, { exact: true });
  if (await symbolOption.count() > 0) {
    await symbolOption.first().click();
  }
  await page.waitForTimeout(3000);
}

// Helper to find scrollable container
async function findScrollableContainer(page: any) {
  return page.evaluate(() => {
    const allDivs = document.querySelectorAll('div');
    for (const el of allDivs) {
      const style = window.getComputedStyle(el);
      if ((style.overflow === 'auto' || style.overflowY === 'auto' ||
           style.overflow === 'scroll' || style.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 100) {
        return {
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          maxScroll: el.scrollHeight - el.clientHeight
        };
      }
    }
    return null;
  });
}

test('Scroll test - check data loading and clusters persistence', async ({ page }) => {
  // Listen for console
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[SlidingWindow]') || text.includes('[Clusters]')) {
      console.log('Browser:', text);
    }
  });

  await page.goto(BASE_URL);
  await addInstrument(page, 'BTCUSDT');

  // Screenshot 1: Initial state
  await page.screenshot({ path: '/tmp/scroll-1-initial.png', fullPage: true });
  console.log('Screenshot 1: Initial state saved');

  // Get cluster data count before scroll
  const clustersBefore = await page.evaluate(() => {
    // Count non-empty cluster cells
    const cells = document.querySelectorAll('[class*="cluster"]');
    return cells.length;
  });
  console.log('Clusters before scroll:', clustersBefore);

  // Find scrollable container and scroll DOWN to 85%
  await page.evaluate(() => {
    const allDivs = document.querySelectorAll('div');
    for (const el of allDivs) {
      const style = window.getComputedStyle(el);
      if ((style.overflow === 'auto' || style.overflowY === 'auto' ||
           style.overflow === 'scroll' || style.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 100) {
        const maxScroll = el.scrollHeight - el.clientHeight;
        el.scrollTop = maxScroll * 0.9; // Scroll to 90%
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
        return;
      }
    }
  });

  await page.waitForTimeout(1500);

  // Screenshot 2: After scroll down
  await page.screenshot({ path: '/tmp/scroll-2-after-down.png', fullPage: true });
  console.log('Screenshot 2: After scroll DOWN saved');

  // Scroll UP to top (10%)
  await page.evaluate(() => {
    const allDivs = document.querySelectorAll('div');
    for (const el of allDivs) {
      const style = window.getComputedStyle(el);
      if ((style.overflow === 'auto' || style.overflowY === 'auto' ||
           style.overflow === 'scroll' || style.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 100) {
        const maxScroll = el.scrollHeight - el.clientHeight;
        el.scrollTop = maxScroll * 0.1; // Scroll to 10%
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
        return;
      }
    }
  });

  await page.waitForTimeout(1500);

  // Screenshot 3: After scroll up
  await page.screenshot({ path: '/tmp/scroll-3-after-up.png', fullPage: true });
  console.log('Screenshot 3: After scroll UP saved');

  // Scroll back to center
  await page.evaluate(() => {
    const allDivs = document.querySelectorAll('div');
    for (const el of allDivs) {
      const style = window.getComputedStyle(el);
      if ((style.overflow === 'auto' || style.overflowY === 'auto' ||
           style.overflow === 'scroll' || style.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 100) {
        const maxScroll = el.scrollHeight - el.clientHeight;
        el.scrollTop = maxScroll * 0.5; // Scroll to center
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
        return;
      }
    }
  });

  await page.waitForTimeout(1000);

  // Screenshot 4: Back to center
  await page.screenshot({ path: '/tmp/scroll-4-center.png', fullPage: true });
  console.log('Screenshot 4: Back to center saved');

  // Press C to center on mid-price
  const panel = page.locator('div').filter({ hasText: /\d{5}\.\d{2}/ }).first();
  if (await panel.count() > 0) {
    await panel.click();
    await page.keyboard.press('c');
    await page.waitForTimeout(1500);
  }

  // Screenshot 5: After pressing C (center on mid)
  await page.screenshot({ path: '/tmp/scroll-5-after-C.png', fullPage: true });
  console.log('Screenshot 5: After pressing C saved');

  console.log('All screenshots saved to /tmp/scroll-*.png');
});

test('Scroll at top edge - should trigger sliding window up via wheel', async ({ page }) => {
  const slidingWindowLogs: string[] = [];

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[SlidingWindow]')) {
      slidingWindowLogs.push(text);
      console.log('Browser:', text);
    }
  });

  await page.goto(BASE_URL);
  await addInstrument(page, 'BTCUSDT');

  // Get initial prices visible
  const initialState = await findScrollableContainer(page);
  console.log('Initial state:', initialState);

  // Scroll to very top (scrollTop = 0)
  await page.evaluate(() => {
    const allDivs = document.querySelectorAll('div');
    for (const el of allDivs) {
      const style = window.getComputedStyle(el);
      if ((style.overflow === 'auto' || style.overflowY === 'auto') &&
          el.scrollHeight > el.clientHeight + 100) {
        el.scrollTop = 0;
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
        return;
      }
    }
  });

  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/edge-1-at-top.png', fullPage: true });
  console.log('Screenshot: At top edge');

  // Clear logs
  slidingWindowLogs.length = 0;

  // Now simulate wheel scroll UP while at top edge
  // This should trigger sliding window via handleWheel
  await page.evaluate(() => {
    const allDivs = document.querySelectorAll('div');
    for (const el of allDivs) {
      const style = window.getComputedStyle(el);
      if ((style.overflow === 'auto' || style.overflowY === 'auto') &&
          el.scrollHeight > el.clientHeight + 100) {
        // Dispatch wheel event with deltaY < 0 (scroll up)
        const wheelEvent = new WheelEvent('wheel', {
          deltaY: -100,
          bubbles: true
        });
        el.dispatchEvent(wheelEvent);
        return;
      }
    }
  });

  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/edge-2-after-wheel-up.png', fullPage: true });
  console.log('Screenshot: After wheel up at edge');

  // Check if sliding window was triggered
  const wheelAtTopLogs = slidingWindowLogs.filter(l => l.includes('Wheel at top'));
  const shiftUpLogs = slidingWindowLogs.filter(l => l.includes('Shift up'));

  console.log('Wheel at top logs:', wheelAtTopLogs.length);
  console.log('Shift up logs:', shiftUpLogs.length);
  console.log('All sliding window logs:', slidingWindowLogs);

  // Verify sliding window was triggered
  expect(slidingWindowLogs.length).toBeGreaterThan(0);
});
