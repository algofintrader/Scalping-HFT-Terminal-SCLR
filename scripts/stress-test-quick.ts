/**
 *
 */

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const CONFIG = {
  URL: process.env.SCLR_URL || 'http://localhost:5173',
  SYMBOLS: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'],
  DURATION_MS: 2 * 60 * 1000,  // 2 minutes
  METRICS_INTERVAL_MS: 5 * 1000,  // 5 seconds
  BINANCE_INTERVAL_MS: 15 * 1000,  // 15 seconds
  BINANCE_API: 'https://fapi.binance.com/fapi/v1/depth',
  THRESHOLDS: {
    MIN_FPS_PASS: 45,
    MIN_FPS_WARN: 30,
    MAX_FLUSH_TIME_PASS: 3,
    MAX_FLUSH_TIME_WARN: 5,
    BINANCE_BEST_MATCH_PASS: 0.9,
    BINANCE_BEST_MATCH_WARN: 0.7,
  },
};

interface MetricsSample {
  timestamp: number;
  fps: number;
  avgFlushTime: number;
  pendingOB: number;
  pendingClusters: number;
  pendingTicks: number;
  symbols: Record<string, {
    revision: number;
    bidsCount: number;
    asksCount: number;
    bestBid: string;
    bestAsk: string;
  }>;
}

interface BinanceComparison {
  timestamp: number;
  symbol: string;
  bestBidMatch: boolean;
  bestAskMatch: boolean;
  matchedBids: number;
  matchedAsks: number;
  discrepancies: string[];
}

async function collectMetrics(page: Page): Promise<MetricsSample | null> {
  try {
    return await page.evaluate(() => {
      const renderLoop = (window as any).__renderLoop;
      const buffer = (window as any).__marketDataBuffer;
      const store = (window as any).__marketDataStore;

      if (!renderLoop || !buffer || !store) return null;

      const renderStats = renderLoop.getStats();
      const bufferStats = buffer.getStats();
      const state = store.getState();

      const symbolsData: MetricsSample['symbols'] = {};
      for (const [symbol, data] of Object.entries(state.symbols) as any) {
        if (data?.orderbookV2) {
          const ob = data.orderbookV2;
          symbolsData[symbol] = {
            revision: ob.revision,
            bidsCount: ob.bids?.size ?? 0,
            asksCount: ob.asks?.size ?? 0,
            bestBid: ob.bestBid,
            bestAsk: ob.bestAsk,
          };
        }
      }

      return {
        timestamp: Date.now(),
        fps: renderStats.fps,
        avgFlushTime: renderStats.avgFlushTime,
        pendingOB: bufferStats.pendingOBV2,
        pendingClusters: bufferStats.pendingClusters,
        pendingTicks: bufferStats.pendingTicks,
        symbols: symbolsData,
      };
    });
  } catch (e) {
    return null;
  }
}

async function fetchBinanceDepth(symbol: string): Promise<{ bids: [string, string][]; asks: [string, string][] } | null> {
  try {
    const response = await fetch(`${CONFIG.BINANCE_API}?symbol=${symbol}&limit=20`);
    if (!response.ok) return null;
    const data = await response.json();
    return { bids: data.bids || [], asks: data.asks || [] };
  } catch (e) {
    return null;
  }
}

async function getSclrOrderBook(page: Page, symbol: string): Promise<{
  bids: [string, string][];
  asks: [string, string][];
  bestBid: string;
  bestAsk: string;
} | null> {
  try {
    return await page.evaluate((sym) => {
      const store = (window as any).__marketDataStore;
      if (!store) return null;

      const state = store.getState();
      const data = state.symbols[sym];
      if (!data?.orderbookV2) return null;

      const ob = data.orderbookV2;
      const bids = Array.from(ob.bids.entries() as Iterable<[string, string]>)
        .sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]));
      const asks = Array.from(ob.asks.entries() as Iterable<[string, string]>)
        .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));

      return { bids, asks, bestBid: ob.bestBid, bestAsk: ob.bestAsk };
    }, symbol);
  } catch (e) {
    return null;
  }
}

test.describe('SCLR Quick Stress Test', () => {
  test.setTimeout(180000); // 3 minutes max

  test('2-minute quick stress test', async ({ page }) => {
    const metrics: MetricsSample[] = [];
    const comparisons: BinanceComparison[] = [];
    const startTime = Date.now();

    console.log('='.repeat(60));
    console.log('SCLR Quick Stress Test (2 minutes)');
    console.log(`URL: ${CONFIG.URL}`);
    console.log(`Symbols: ${CONFIG.SYMBOLS.join(', ')}`);
    console.log('='.repeat(60));

    console.log('\n[Setup] Navigating...');
    await page.goto(CONFIG.URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });

    await page.waitForFunction(() => {
      return !!(window as any).__marketDataStore &&
             !!(window as any).__renderLoop &&
             !!(window as any).__marketDataBuffer;
    }, { timeout: 30000 });

    console.log('[Setup] Adding instruments...');
    for (const symbol of CONFIG.SYMBOLS) {
      await page.evaluate((sym) => {
        const workspace = (window as any).__workspaceStore;
        if (workspace) workspace.getState().addInstrument(sym);
      }, symbol);
      await page.waitForTimeout(300);
    }

    await page.waitForTimeout(3000); // Wait for data

    console.log('\n[Collection] Starting...');
    const endTime = startTime + CONFIG.DURATION_MS;
    let lastBinanceCheck = 0;

    while (Date.now() < endTime) {
      const now = Date.now();
      const elapsed = Math.round((now - startTime) / 1000);
      const remaining = Math.round((endTime - now) / 1000);

      const sample = await collectMetrics(page);
      if (sample) {
        metrics.push(sample);
        console.log(`[${elapsed}s] FPS: ${sample.fps}, Flush: ${sample.avgFlushTime.toFixed(2)}ms, Remaining: ${remaining}s`);
      }

      // Binance comparison
      if (now - lastBinanceCheck >= CONFIG.BINANCE_INTERVAL_MS) {
        lastBinanceCheck = now;
        for (const symbol of CONFIG.SYMBOLS.slice(0, 2)) {
          const sclr = await getSclrOrderBook(page, symbol);
          const binance = await fetchBinanceDepth(symbol);
          if (sclr && binance) {
            const bestBidMatch = sclr.bestBid === binance.bids[0]?.[0];
            const bestAskMatch = sclr.bestAsk === binance.asks[0]?.[0];
            let matchedBids = 0, matchedAsks = 0;
            for (let i = 0; i < 10; i++) {
              if (sclr.bids[i]?.[0] === binance.bids[i]?.[0]) matchedBids++;
              if (sclr.asks[i]?.[0] === binance.asks[i]?.[0]) matchedAsks++;
            }
            comparisons.push({
              timestamp: now,
              symbol,
              bestBidMatch,
              bestAskMatch,
              matchedBids,
              matchedAsks,
              discrepancies: bestBidMatch && bestAskMatch ? [] : [`best mismatch`],
            });
            console.log(`  [Binance] ${symbol}: best=${bestBidMatch && bestAskMatch ? 'OK' : 'MISMATCH'}, top10=${matchedBids + matchedAsks}/20`);
          }
        }
      }

      await page.waitForTimeout(CONFIG.METRICS_INTERVAL_MS);
    }

    // 4. Summary
    const fpsValues = metrics.filter(m => m.fps > 0).map(m => m.fps);
    const avgFps = fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length;
    const minFps = Math.min(...fpsValues);
    const flushTimes = metrics.map(m => m.avgFlushTime);
    const maxFlushTime = Math.max(...flushTimes);
    const bestMatches = comparisons.filter(c => c.bestBidMatch && c.bestAskMatch).length;
    const matchRate = comparisons.length ? (bestMatches / comparisons.length * 100).toFixed(1) : 'N/A';

    console.log('\n' + '='.repeat(60));
    console.log('QUICK TEST COMPLETE');
    console.log('='.repeat(60));
    console.log(`Avg FPS: ${avgFps.toFixed(1)} | Min FPS: ${minFps}`);
    console.log(`Max Flush: ${maxFlushTime.toFixed(2)}ms`);
    console.log(`Binance Best Match: ${matchRate}%`);
    console.log('='.repeat(60));

    expect(minFps).toBeGreaterThan(CONFIG.THRESHOLDS.MIN_FPS_WARN);
    expect(maxFlushTime).toBeLessThan(CONFIG.THRESHOLDS.MAX_FLUSH_TIME_WARN);
  });
});
