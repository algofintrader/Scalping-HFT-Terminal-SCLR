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

test('Stress scroll test - memory and performance', async ({ page }) => {
  const errors: string[] = [];
  const slidingWindowLogs: string[] = [];

  // Collect console errors
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') {
      errors.push(text);
      console.log('ERROR:', text);
    }
    if (text.includes('[SlidingWindow]') || text.includes('[SLIDING_WINDOW]')) {
      slidingWindowLogs.push(text);
      console.log('Browser:', text);
    }
  });

  // Collect page errors
  page.on('pageerror', err => {
    errors.push(err.message);
    console.log('PAGE ERROR:', err.message);
  });

  await page.goto(BASE_URL);
  await addInstrument(page, 'BTCUSDT');

  // Get initial memory
  const getMemory = async () => {
    return await page.evaluate(() => {
      if ((performance as any).memory) {
        return {
          usedJSHeapSize: Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024),
          totalJSHeapSize: Math.round((performance as any).memory.totalJSHeapSize / 1024 / 1024),
        };
      }
      return null;
    });
  };

  const initialMemory = await getMemory();
  console.log('Initial memory:', initialMemory);

  // Find scrollable container
  const orderbookContainer = page.getByTestId('orderbook-container');
  await orderbookContainer.click();

  // Helper to scroll
  const scrollUp = async (times: number) => {
    for (let i = 0; i < times; i++) {
      await page.mouse.wheel(0, -200);
      await page.waitForTimeout(100);
    }
  };

  const scrollDown = async (times: number) => {
    for (let i = 0; i < times; i++) {
      await page.mouse.wheel(0, 200);
      await page.waitForTimeout(100);
    }
  };

  console.log('\n=== SCROLLING UP (50 times) ===');
  const startUp = Date.now();
  await scrollUp(50);
  const upTime = Date.now() - startUp;
  console.log(`Scroll UP took: ${upTime}ms`);

  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/stress-1-after-up.png', fullPage: true });

  const afterUpMemory = await getMemory();
  console.log('Memory after scroll UP:', afterUpMemory);

  console.log('\n=== SCROLLING DOWN (100 times) ===');
  const startDown = Date.now();
  await scrollDown(100);
  const downTime = Date.now() - startDown;
  console.log(`Scroll DOWN took: ${downTime}ms`);

  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/stress-2-after-down.png', fullPage: true });

  const afterDownMemory = await getMemory();
  console.log('Memory after scroll DOWN:', afterDownMemory);

  console.log('\n=== SCROLLING UP AGAIN (50 times) ===');
  await scrollUp(50);
  await page.waitForTimeout(1000);

  const finalMemory = await getMemory();
  console.log('Final memory:', finalMemory);

  // Press C to center
  console.log('\n=== PRESSING C TO CENTER ===');
  await page.keyboard.press('c');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/stress-3-after-center.png', fullPage: true });

  const afterCenterMemory = await getMemory();
  console.log('Memory after center:', afterCenterMemory);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log('Sliding window triggers:', slidingWindowLogs.length);
  console.log('Errors:', errors.length);
  if (errors.length > 0) {
    console.log('Error details:', errors);
  }

  if (initialMemory && finalMemory) {
    const memoryGrowth = finalMemory.usedJSHeapSize - initialMemory.usedJSHeapSize;
    console.log(`Memory growth: ${memoryGrowth} MB`);
  }

  // Check for performance issues
  const avgScrollTime = (upTime + downTime) / 150;
  console.log(`Average scroll time: ${avgScrollTime.toFixed(2)}ms per scroll`);

  // Assertions
  expect(errors.length).toBe(0);
  expect(slidingWindowLogs.length).toBeGreaterThan(0); // Should have triggered sliding window
});
