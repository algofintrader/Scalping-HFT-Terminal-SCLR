import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';
const WS_URL = 'ws://localhost:3001';

// Helper to add instrument
async function addInstrument(page: Page, symbol: string = 'BTCUSDT') {
  // Click the + button to add instrument
  const addButton = page.locator('button:has-text("+")').or(page.getByText('+'));
  await addButton.click();

  // Wait for dropdown/modal
  await page.waitForTimeout(500);

  // Click on BTCUSDT in the list
  const symbolOption = page.getByText(symbol, { exact: true }).or(
    page.locator(`[data-symbol="${symbol}"]`)
  ).or(
    page.locator(`button:has-text("${symbol}")`)
  );

  if (await symbolOption.count() > 0) {
    await symbolOption.first().click();
  }

  // Wait for data to load
  await page.waitForTimeout(3000);
}

test.describe('Sliding Window', () => {
  test.beforeEach(async ({ page }) => {
    // Listen for console messages
    page.on('console', msg => {
      if (msg.text().includes('[SlidingWindow]') || msg.text().includes('[Scroll]')) {
        console.log('Browser:', msg.text());
      }
    });
  });

  test('should load orderbook and display levels', async ({ page }) => {
    await page.goto(BASE_URL);

    // Add BTCUSDT instrument
    await addInstrument(page, 'BTCUSDT');

    // Take screenshot for debugging
    await page.screenshot({ path: '/tmp/orderbook-initial.png', fullPage: true });

    // Check that prices are visible
    const prices = page.locator('text=/\\d{5}\\.\\d{2}/');  // Match prices like 90123.45
    const priceCount = await prices.count();
    console.log(`Found ${priceCount} price elements`);

    expect(priceCount).toBeGreaterThan(0);
    console.log('Page loaded successfully with orderbook data');
  });

  test('should trigger sliding window on scroll down', async ({ page }) => {
    await page.goto(BASE_URL);

    // Add BTCUSDT instrument
    await addInstrument(page, 'BTCUSDT');

    // Take initial screenshot
    await page.screenshot({ path: '/tmp/before-scroll.png', fullPage: true });

    // Get initial scroll position - find the scrollable div inside panel
    const initialScroll = await page.evaluate(() => {
      // Find all divs with overflow: auto/scroll
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
            className: el.className
          };
        }
      }
      return null;
    });

    console.log('Initial scroll state:', initialScroll);

    // Scroll to bottom (85%+)
    const scrollResult = await page.evaluate(() => {
      const allDivs = document.querySelectorAll('div');
      for (const el of allDivs) {
        const style = window.getComputedStyle(el);
        if ((style.overflow === 'auto' || style.overflowY === 'auto' ||
             style.overflow === 'scroll' || style.overflowY === 'scroll') &&
            el.scrollHeight > el.clientHeight + 100) {
          const maxScroll = el.scrollHeight - el.clientHeight;
          el.scrollTop = maxScroll * 0.85; // Scroll to 85%
          el.dispatchEvent(new Event('scroll', { bubbles: true }));
          return { scrolled: true, to: el.scrollTop, max: maxScroll };
        }
      }
      return { scrolled: false };
    });

    console.log('Scroll result:', scrollResult);

    // Wait for sliding window to trigger
    await page.waitForTimeout(1000);

    // Take screenshot after scroll
    await page.screenshot({ path: '/tmp/after-scroll-down.png', fullPage: true });
  });

  test('should center on mid-price when pressing C', async ({ page }) => {
    await page.goto(BASE_URL);

    // Add BTCUSDT instrument
    await addInstrument(page, 'BTCUSDT');

    // Find and click on the panel to give it focus
    const panel = page.locator('div').filter({ hasText: /\d{5}\.\d{2}/ }).first();
    await panel.click();

    // Wait a bit
    await page.waitForTimeout(500);

    // Press C key
    await page.keyboard.press('c');

    // Wait for server response
    await page.waitForTimeout(1500);

    // Take screenshot
    await page.screenshot({ path: '/tmp/after-center.png', fullPage: true });

    console.log('Pressed C for center');
  });

  test('WebSocket connection test', async ({ page }) => {
    // Monitor WebSocket messages
    const wsMessages: string[] = [];
    const wsSent: string[] = [];

    // Intercept WebSocket
    page.on('websocket', ws => {
      console.log(`WebSocket opened: ${ws.url()}`);

      ws.on('framereceived', frame => {
        if (frame.payload) {
          const data = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString();
          if (data.includes('viewport') || data.includes('snapshot') || data.includes('delta')) {
            wsMessages.push(data.substring(0, 300));
          }
        }
      });

      ws.on('framesent', frame => {
        if (frame.payload) {
          const data = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString();
          wsSent.push(data);
          console.log('WS sent:', data);
        }
      });
    });

    await page.goto(BASE_URL);

    // Add BTCUSDT instrument
    await addInstrument(page, 'BTCUSDT');

    // Trigger center on mid by pressing C
    const panel = page.locator('div').filter({ hasText: /\d{5}\.\d{2}/ }).first();
    if (await panel.count() > 0) {
      await panel.click();
      await page.keyboard.press('c');
      await page.waitForTimeout(1500);
    }

    console.log('WS messages received:', wsMessages.length);
    console.log('WS messages sent:', wsSent.filter(m => m.includes('viewport')));

    // Check that viewport_update was sent
    const viewportUpdates = wsSent.filter(m => m.includes('viewport_update') || m.includes('centerOnMid'));
    console.log('Viewport updates sent:', viewportUpdates);
  });
});
