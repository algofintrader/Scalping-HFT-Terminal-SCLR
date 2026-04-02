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

test('Press C key to center on mid-price', async ({ page }) => {
  const logs: string[] = [];

  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);
    if (text.includes('[SlidingWindow]') || text.includes('center')) {
      console.log('Browser:', text);
    }
  });

  await page.goto(BASE_URL);
  await addInstrument(page, 'BTCUSDT');

  // Screenshot 1: Initial state
  await page.screenshot({ path: '/tmp/center-1-initial.png', fullPage: true });

  // Get initial prices
  const initialPrices = await page.evaluate(() => {
    const priceElements = document.querySelectorAll('div');
    const prices: string[] = [];
    priceElements.forEach(el => {
      const text = el.textContent || '';
      const match = text.match(/\d{5}\.\d{2}/);
      if (match) prices.push(match[0]);
    });
    return prices.slice(0, 5);
  });
  console.log('Initial prices visible:', initialPrices);

  // Scroll far down
  await page.evaluate(() => {
    const allDivs = document.querySelectorAll('div');
    for (const el of allDivs) {
      const style = window.getComputedStyle(el);
      if ((style.overflow === 'auto' || style.overflowY === 'auto') &&
          el.scrollHeight > el.clientHeight + 100) {
        el.scrollTop = el.scrollHeight - el.clientHeight; // Scroll to bottom
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
        return;
      }
    }
  });

  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/center-2-scrolled-down.png', fullPage: true });

  // Get prices after scroll
  const scrolledPrices = await page.evaluate(() => {
    const priceElements = document.querySelectorAll('div');
    const prices: string[] = [];
    priceElements.forEach(el => {
      const text = el.textContent || '';
      const match = text.match(/\d{5}\.\d{2}/);
      if (match) prices.push(match[0]);
    });
    return prices.slice(0, 5);
  });
  console.log('Prices after scroll down:', scrolledPrices);

  // Click on orderbook container to give it focus
  const orderbookContainer = page.getByTestId('orderbook-container');
  await orderbookContainer.click();
  console.log('Clicked on orderbook container');

  await page.waitForTimeout(200);

  // Check if element is focused
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
  console.log('Focused element:', focusedTag);

  // Press C key
  console.log('Pressing C key...');
  await page.keyboard.press('c');

  // Wait for server response and re-render
  await page.waitForTimeout(2000);

  await page.screenshot({ path: '/tmp/center-3-after-C.png', fullPage: true });

  // Get prices after C
  const centeredPrices = await page.evaluate(() => {
    const priceElements = document.querySelectorAll('div');
    const prices: string[] = [];
    priceElements.forEach(el => {
      const text = el.textContent || '';
      const match = text.match(/\d{5}\.\d{2}/);
      if (match) prices.push(match[0]);
    });
    return prices.slice(0, 5);
  });
  console.log('Prices after C key:', centeredPrices);

  // Check clusters are visible
  const clusterCells = await page.evaluate(() => {
    // Look for cluster data (small numbers like 0.01, 0.02, etc in green/red)
    const cells = document.querySelectorAll('div');
    let count = 0;
    cells.forEach(el => {
      const text = el.textContent?.trim() || '';
      // Cluster cells have small decimal values
      if (/^[0-9]+(\.[0-9]+)?$/.test(text) && parseFloat(text) < 100 && parseFloat(text) > 0) {
        count++;
      }
    });
    return count;
  });
  console.log('Cluster cells visible:', clusterCells);

  // Verify that we're now near mid-price (should be different from scrolled position)
  // The prices should have changed after pressing C
  console.log('Test completed');
});

test('Verify C key sends centerOnMid message (hover only, no click)', async ({ page }) => {
  const wsSent: string[] = [];

  page.on('websocket', ws => {
    ws.on('framesent', frame => {
      if (frame.payload) {
        const data = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString();
        wsSent.push(data);
        if (data.includes('centerOnMid')) {
          console.log('WS sent centerOnMid:', data);
        }
      }
    });
  });

  await page.goto(BASE_URL);
  await addInstrument(page, 'BTCUSDT');

  // Just hover over orderbook container (NO click!)
  const orderbookContainer = page.getByTestId('orderbook-container');
  await orderbookContainer.hover();
  console.log('Hovering over orderbook container (no click)');

  // Press C while hovering
  await page.keyboard.press('c');
  await page.waitForTimeout(1000);

  // Check if centerOnMid was sent
  const centerOnMidMessages = wsSent.filter(m => m.includes('centerOnMid'));
  console.log('centerOnMid messages sent:', centerOnMidMessages.length);
  console.log('Messages:', centerOnMidMessages);

  expect(centerOnMidMessages.length).toBeGreaterThan(0);
});
