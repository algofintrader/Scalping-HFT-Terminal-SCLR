/**
 *
 */

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const CONFIG = {
  URL: process.env.SCLR_URL || 'http://localhost:5173',

  SYMBOLS: [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT',
    'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT'
  ],

  DURATION_MS: 30 * 60 * 1000,  // 30 minutes

  METRICS_INTERVAL_MS: 10 * 1000,  // 10 seconds

  BINANCE_INTERVAL_MS: 30 * 1000,  // 30 seconds (to avoid API overload)

  // Binance API
  BINANCE_API: 'https://fapi.binance.com/fapi/v1/depth',

  THRESHOLDS: {
    MIN_FPS_PASS: 45,
    MIN_FPS_WARN: 30,
    MAX_FLUSH_TIME_PASS: 3,
    MAX_FLUSH_TIME_WARN: 5,
    BINANCE_BEST_MATCH_PASS: 0.9,
    BINANCE_BEST_MATCH_WARN: 0.7,
    BINANCE_TOP20_MATCH_PASS: 0.5,
    BINANCE_TOP20_MATCH_WARN: 0.3,
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
    serverTimestamp: number;
    clientReceiveTime: number;
  }>;
}

interface BinanceComparison {
  timestamp: number;
  symbol: string;
  matchedBids: number;
  matchedAsks: number;
  totalBids: number;
  totalAsks: number;
  bestBidMatch: boolean;
  bestAskMatch: boolean;
  latencyMs: number;
  discrepancies: string[];
}

interface TestReport {
  startTime: number;
  endTime: number;
  duration: number;
  symbols: string[];
  metrics: MetricsSample[];
  comparisons: BinanceComparison[];
  summary: {
    avgFps: number;
    minFps: number;
    maxFps: number;
    avgFlushTime: number;
    maxFlushTime: number;
    binanceBestMatchRate: number;
    binanceTop20MatchRate: number;
    totalComparisons: number;
    status: 'PASSED' | 'WARNING' | 'FAILED';
    issues: string[];
  };
}

async function collectMetrics(page: Page): Promise<MetricsSample | null> {
  try {
    return await page.evaluate(() => {
      const renderLoop = (window as any).__renderLoop;
      const buffer = (window as any).__marketDataBuffer;
      const store = (window as any).__marketDataStore;

      if (!renderLoop || !buffer || !store) {
        return null;
      }

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
            serverTimestamp: ob.serverTimestamp ?? 0,
            clientReceiveTime: ob.clientReceiveTime ?? 0,
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
    console.error('Error collecting metrics:', e);
    return null;
  }
}

async function fetchBinanceDepth(symbol: string): Promise<{ bids: [string, string][]; asks: [string, string][]; timestamp: number } | null> {
  try {
    const response = await fetch(`${CONFIG.BINANCE_API}?symbol=${symbol}&limit=100`);
    if (!response.ok) return null;

    const data = await response.json();
    return {
      bids: data.bids || [],
      asks: data.asks || [],
      timestamp: data.T || Date.now(),
    };
  } catch (e) {
    console.error(`Error fetching Binance depth for ${symbol}:`, e);
    return null;
  }
}

async function getSclrOrderBook(page: Page, symbol: string): Promise<{
  bids: [string, string][];
  asks: [string, string][];
  bestBid: string;
  bestAsk: string;
  serverTimestamp: number;
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

      return {
        bids,
        asks,
        bestBid: ob.bestBid,
        bestAsk: ob.bestAsk,
        serverTimestamp: ob.serverTimestamp ?? 0,
      };
    }, symbol);
  } catch (e) {
    console.error(`Error getting SCLR orderbook for ${symbol}:`, e);
    return null;
  }
}

function compareToBinance(
  sclr: { bids: [string, string][]; asks: [string, string][]; bestBid: string; bestAsk: string; serverTimestamp: number },
  binance: { bids: [string, string][]; asks: [string, string][]; timestamp: number },
  symbol: string
): BinanceComparison {
  const discrepancies: string[] = [];

  const top20Bids = Math.min(20, sclr.bids.length, binance.bids.length);
  let matchedBids = 0;

  for (let i = 0; i < top20Bids; i++) {
    const sclrBid = sclr.bids[i];
    const binanceBid = binance.bids[i];

    if (sclrBid && binanceBid && sclrBid[0] === binanceBid[0]) {
      matchedBids++;
    } else if (i < 5) {
      discrepancies.push(`bid[${i}]: SCLR=${sclrBid?.[0] ?? 'N/A'} vs Binance=${binanceBid?.[0] ?? 'N/A'}`);
    }
  }

  const top20Asks = Math.min(20, sclr.asks.length, binance.asks.length);
  let matchedAsks = 0;

  for (let i = 0; i < top20Asks; i++) {
    const sclrAsk = sclr.asks[i];
    const binanceAsk = binance.asks[i];

    if (sclrAsk && binanceAsk && sclrAsk[0] === binanceAsk[0]) {
      matchedAsks++;
    } else if (i < 5) {
      discrepancies.push(`ask[${i}]: SCLR=${sclrAsk?.[0] ?? 'N/A'} vs Binance=${binanceAsk?.[0] ?? 'N/A'}`);
    }
  }

  const bestBidMatch = sclr.bestBid === binance.bids[0]?.[0];
  const bestAskMatch = sclr.bestAsk === binance.asks[0]?.[0];

  if (!bestBidMatch) {
    discrepancies.push(`bestBid: SCLR=${sclr.bestBid} vs Binance=${binance.bids[0]?.[0] ?? 'N/A'}`);
  }
  if (!bestAskMatch) {
    discrepancies.push(`bestAsk: SCLR=${sclr.bestAsk} vs Binance=${binance.asks[0]?.[0] ?? 'N/A'}`);
  }

  return {
    timestamp: Date.now(),
    symbol,
    matchedBids,
    matchedAsks,
    totalBids: top20Bids,
    totalAsks: top20Asks,
    bestBidMatch,
    bestAskMatch,
    latencyMs: sclr.serverTimestamp ? Date.now() - sclr.serverTimestamp : 0,
    discrepancies,
  };
}

function generateSummary(metrics: MetricsSample[], comparisons: BinanceComparison[]): TestReport['summary'] {
  const issues: string[] = [];

  const fpsValues = metrics.filter(m => m.fps > 0).map(m => m.fps);
  const avgFps = fpsValues.length ? fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length : 0;
  const minFps = fpsValues.length ? Math.min(...fpsValues) : 0;
  const maxFps = fpsValues.length ? Math.max(...fpsValues) : 0;

  const flushTimes = metrics.map(m => m.avgFlushTime);
  const avgFlushTime = flushTimes.length ? flushTimes.reduce((a, b) => a + b, 0) / flushTimes.length : 0;
  const maxFlushTime = flushTimes.length ? Math.max(...flushTimes) : 0;

  // Binance match rate
  const bestMatches = comparisons.filter(c => c.bestBidMatch && c.bestAskMatch).length;
  const binanceBestMatchRate = comparisons.length ? bestMatches / comparisons.length : 0;

  const top20Matches = comparisons.map(c => (c.matchedBids + c.matchedAsks) / (c.totalBids + c.totalAsks || 1));
  const binanceTop20MatchRate = top20Matches.length ? top20Matches.reduce((a, b) => a + b, 0) / top20Matches.length : 0;

  let status: 'PASSED' | 'WARNING' | 'FAILED' = 'PASSED';

  if (minFps <= CONFIG.THRESHOLDS.MIN_FPS_WARN) {
    issues.push(`Min FPS ${minFps} <= ${CONFIG.THRESHOLDS.MIN_FPS_WARN}`);
    status = minFps <= CONFIG.THRESHOLDS.MIN_FPS_WARN ? 'FAILED' : 'WARNING';
  } else if (minFps <= CONFIG.THRESHOLDS.MIN_FPS_PASS) {
    issues.push(`Min FPS ${minFps} below optimal ${CONFIG.THRESHOLDS.MIN_FPS_PASS}`);
    if (status !== 'FAILED') status = 'WARNING';
  }

  if (maxFlushTime >= CONFIG.THRESHOLDS.MAX_FLUSH_TIME_WARN) {
    issues.push(`Max flush time ${maxFlushTime.toFixed(2)}ms >= ${CONFIG.THRESHOLDS.MAX_FLUSH_TIME_WARN}ms`);
    status = 'FAILED';
  } else if (maxFlushTime >= CONFIG.THRESHOLDS.MAX_FLUSH_TIME_PASS) {
    issues.push(`Max flush time ${maxFlushTime.toFixed(2)}ms above optimal ${CONFIG.THRESHOLDS.MAX_FLUSH_TIME_PASS}ms`);
    if (status !== 'FAILED') status = 'WARNING';
  }

  if (binanceBestMatchRate < CONFIG.THRESHOLDS.BINANCE_BEST_MATCH_WARN) {
    issues.push(`Binance best match rate ${(binanceBestMatchRate * 100).toFixed(1)}% < ${CONFIG.THRESHOLDS.BINANCE_BEST_MATCH_WARN * 100}%`);
    status = 'FAILED';
  } else if (binanceBestMatchRate < CONFIG.THRESHOLDS.BINANCE_BEST_MATCH_PASS) {
    issues.push(`Binance best match rate ${(binanceBestMatchRate * 100).toFixed(1)}% below optimal ${CONFIG.THRESHOLDS.BINANCE_BEST_MATCH_PASS * 100}%`);
    if (status !== 'FAILED') status = 'WARNING';
  }

  return {
    avgFps: Math.round(avgFps * 10) / 10,
    minFps,
    maxFps,
    avgFlushTime: Math.round(avgFlushTime * 100) / 100,
    maxFlushTime: Math.round(maxFlushTime * 100) / 100,
    binanceBestMatchRate: Math.round(binanceBestMatchRate * 1000) / 10,
    binanceTop20MatchRate: Math.round(binanceTop20MatchRate * 1000) / 10,
    totalComparisons: comparisons.length,
    status,
    issues,
  };
}

function generateHtmlReport(report: TestReport): string {
  const startDate = new Date(report.startTime);
  const dateStr = startDate.toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const timestamps = report.metrics.map(m => new Date(m.timestamp).toLocaleTimeString());
  const fpsData = report.metrics.map(m => m.fps);
  const flushTimeData = report.metrics.map(m => m.avgFlushTime);
  const pendingData = report.metrics.map(m => m.pendingOB + m.pendingClusters + m.pendingTicks);

  const binanceTimestamps = report.comparisons.map(c => new Date(c.timestamp).toLocaleTimeString());
  const binanceBestMatchData = report.comparisons.map(c => (c.bestBidMatch && c.bestAskMatch) ? 100 : 0);
  const binanceTop20MatchData = report.comparisons.map(c =>
    ((c.matchedBids + c.matchedAsks) / (c.totalBids + c.totalAsks || 1)) * 100
  );

  const statusColor = report.summary.status === 'PASSED' ? '#22c55e' :
                      report.summary.status === 'WARNING' ? '#eab308' : '#ef4444';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SCLR Stress Test Report - ${dateStr}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f0f;
      color: #e5e5e5;
      padding: 20px;
      line-height: 1.6;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px;
      background: #1a1a1a;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .header h1 { font-size: 24px; color: #fff; }
    .status {
      padding: 8px 16px;
      border-radius: 4px;
      font-weight: bold;
      font-size: 14px;
      background: ${statusColor};
      color: #000;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .summary-card {
      background: #1a1a1a;
      padding: 16px;
      border-radius: 8px;
      border-left: 3px solid #3b82f6;
    }
    .summary-card h3 { color: #888; font-size: 12px; text-transform: uppercase; margin-bottom: 8px; }
    .summary-card .value { font-size: 28px; font-weight: bold; color: #fff; }
    .summary-card .unit { font-size: 14px; color: #666; }
    .chart-container {
      background: #1a1a1a;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .chart-container h2 { margin-bottom: 16px; font-size: 16px; color: #fff; }
    .chart-wrapper { height: 250px; }
    .issues {
      background: #1a1a1a;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .issues h2 { margin-bottom: 16px; font-size: 16px; color: #fff; }
    .issue-item {
      padding: 8px 12px;
      background: #2a2a2a;
      border-radius: 4px;
      margin-bottom: 8px;
      border-left: 3px solid ${statusColor};
    }
    .discrepancies {
      background: #1a1a1a;
      padding: 20px;
      border-radius: 8px;
      max-height: 400px;
      overflow-y: auto;
    }
    .discrepancies h2 { margin-bottom: 16px; font-size: 16px; color: #fff; }
    .discrepancy-item {
      padding: 8px 12px;
      background: #2a2a2a;
      border-radius: 4px;
      margin-bottom: 8px;
      font-family: monospace;
      font-size: 12px;
    }
    .discrepancy-item .time { color: #666; }
    .discrepancy-item .symbol { color: #3b82f6; }
    .meta {
      margin-top: 20px;
      padding: 16px;
      background: #1a1a1a;
      border-radius: 8px;
      font-size: 12px;
      color: #666;
    }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    @media (max-width: 900px) { .two-col { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1>SCLR Stress Test Report</h1>
        <div style="color: #888; font-size: 14px; margin-top: 4px;">
          ${startDate.toLocaleString()} | Duration: ${Math.round(report.duration / 60000)} min | Symbols: ${report.symbols.length}
        </div>
      </div>
      <div class="status">${report.summary.status}</div>
    </div>

    <div class="summary-grid">
      <div class="summary-card">
        <h3>Average FPS</h3>
        <div class="value">${report.summary.avgFps}<span class="unit"> fps</span></div>
      </div>
      <div class="summary-card">
        <h3>Min FPS</h3>
        <div class="value">${report.summary.minFps}<span class="unit"> fps</span></div>
      </div>
      <div class="summary-card">
        <h3>Avg Flush Time</h3>
        <div class="value">${report.summary.avgFlushTime}<span class="unit"> ms</span></div>
      </div>
      <div class="summary-card">
        <h3>Max Flush Time</h3>
        <div class="value">${report.summary.maxFlushTime}<span class="unit"> ms</span></div>
      </div>
      <div class="summary-card">
        <h3>Binance Best Match</h3>
        <div class="value">${report.summary.binanceBestMatchRate}<span class="unit">%</span></div>
      </div>
      <div class="summary-card">
        <h3>Binance Top-20 Match</h3>
        <div class="value">${report.summary.binanceTop20MatchRate}<span class="unit">%</span></div>
      </div>
    </div>

    ${report.summary.issues.length > 0 ? `
    <div class="issues">
      <h2>Issues</h2>
      ${report.summary.issues.map(issue => `<div class="issue-item">${issue}</div>`).join('')}
    </div>
    ` : ''}

    <div class="two-col">
      <div class="chart-container">
        <h2>FPS over Time</h2>
        <div class="chart-wrapper">
          <canvas id="fpsChart"></canvas>
        </div>
      </div>
      <div class="chart-container">
        <h2>Flush Time over Time</h2>
        <div class="chart-wrapper">
          <canvas id="flushChart"></canvas>
        </div>
      </div>
    </div>

    <div class="two-col">
      <div class="chart-container">
        <h2>Queue Depth over Time</h2>
        <div class="chart-wrapper">
          <canvas id="queueChart"></canvas>
        </div>
      </div>
      <div class="chart-container">
        <h2>Binance Match Rate over Time</h2>
        <div class="chart-wrapper">
          <canvas id="binanceChart"></canvas>
        </div>
      </div>
    </div>

    <div class="discrepancies">
      <h2>Discrepancies (${report.comparisons.filter(c => c.discrepancies.length > 0).length} samples with issues)</h2>
      ${report.comparisons
        .filter(c => c.discrepancies.length > 0)
        .slice(0, 50)
        .map(c => `
          <div class="discrepancy-item">
            <span class="time">${new Date(c.timestamp).toLocaleTimeString()}</span>
            <span class="symbol">${c.symbol}</span>:
            ${c.discrepancies.join(', ')}
          </div>
        `).join('') || '<div style="color: #666;">No discrepancies found</div>'}
    </div>

    <div class="meta">
      <strong>Test Configuration:</strong><br>
      URL: ${CONFIG.URL}<br>
      Symbols: ${report.symbols.join(', ')}<br>
      Metrics samples: ${report.metrics.length}<br>
      Binance comparisons: ${report.comparisons.length}<br>
      Generated: ${new Date().toISOString()}
    </div>
  </div>

  <script>
    const chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { maxTicksLimit: 10, color: '#666' }, grid: { color: '#333' } },
        y: { ticks: { color: '#666' }, grid: { color: '#333' } }
      },
      plugins: { legend: { display: false } }
    };

    // FPS Chart
    new Chart(document.getElementById('fpsChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(timestamps)},
        datasets: [{
          data: ${JSON.stringify(fpsData)},
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true,
          tension: 0.3
        }]
      },
      options: { ...chartOptions, scales: { ...chartOptions.scales, y: { ...chartOptions.scales.y, min: 0, max: 70 } } }
    });

    // Flush Time Chart
    new Chart(document.getElementById('flushChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(timestamps)},
        datasets: [{
          data: ${JSON.stringify(flushTimeData)},
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34, 197, 94, 0.1)',
          fill: true,
          tension: 0.3
        }]
      },
      options: chartOptions
    });

    // Queue Depth Chart
    new Chart(document.getElementById('queueChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(timestamps)},
        datasets: [{
          data: ${JSON.stringify(pendingData)},
          borderColor: '#eab308',
          backgroundColor: 'rgba(234, 179, 8, 0.1)',
          fill: true,
          tension: 0.3
        }]
      },
      options: chartOptions
    });

    // Binance Match Chart
    new Chart(document.getElementById('binanceChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(binanceTimestamps)},
        datasets: [
          {
            label: 'Best Match',
            data: ${JSON.stringify(binanceBestMatchData)},
            borderColor: '#3b82f6',
            tension: 0.3
          },
          {
            label: 'Top-20 Match',
            data: ${JSON.stringify(binanceTop20MatchData)},
            borderColor: '#22c55e',
            tension: 0.3
          }
        ]
      },
      options: {
        ...chartOptions,
        plugins: { legend: { display: true, labels: { color: '#888' } } },
        scales: { ...chartOptions.scales, y: { ...chartOptions.scales.y, min: 0, max: 100 } }
      }
    });
  </script>
</body>
</html>`;
}

test.describe('SCLR Stress Test', () => {
  test.setTimeout(1900000); // 31+ minutes

  test('30-minute stress test with 8 instruments', async ({ page }) => {
    const metrics: MetricsSample[] = [];
    const comparisons: BinanceComparison[] = [];
    const startTime = Date.now();

    console.log('='.repeat(60));
    console.log('SCLR Stress Test Starting');
    console.log(`URL: ${CONFIG.URL}`);
    console.log(`Symbols: ${CONFIG.SYMBOLS.join(', ')}`);
    console.log(`Duration: ${CONFIG.DURATION_MS / 60000} minutes`);
    console.log('='.repeat(60));

    console.log('\n[Setup] Navigating to', CONFIG.URL);
    await page.goto(CONFIG.URL, { waitUntil: 'networkidle' });

    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });

    console.log('[Setup] Waiting for store initialization...');
    await page.waitForFunction(() => {
      return !!(window as any).__marketDataStore &&
             !!(window as any).__renderLoop &&
             !!(window as any).__marketDataBuffer;
    }, { timeout: 30000 });

    console.log('[Setup] Store initialized');

    console.log('[Setup] Adding instruments...');
    for (const symbol of CONFIG.SYMBOLS) {
      await page.evaluate((sym) => {
        const workspace = (window as any).__workspaceStore;
        if (workspace) {
          workspace.getState().addInstrument(sym);
        }
      }, symbol);
      console.log(`  Added ${symbol}`);
      await page.waitForTimeout(500); // Small pause between additions
    }

    console.log('[Setup] Waiting for data...');
    await page.waitForTimeout(5000);

    console.log('\n[Collection] Starting metrics collection loop...');

    const endTime = startTime + CONFIG.DURATION_MS;
    let lastBinanceCheck = 0;
    let sampleCount = 0;

    while (Date.now() < endTime) {
      const now = Date.now();
      const elapsed = Math.round((now - startTime) / 1000);
      const remaining = Math.round((endTime - now) / 1000);

      const sample = await collectMetrics(page);
      if (sample) {
        metrics.push(sample);
        sampleCount++;

        if (sampleCount % 3 === 0) {
          console.log(`[${elapsed}s] FPS: ${sample.fps}, Flush: ${sample.avgFlushTime.toFixed(2)}ms, Pending: ${sample.pendingOB}/${sample.pendingClusters}/${sample.pendingTicks}, Remaining: ${remaining}s`);
        }
      }

      if (now - lastBinanceCheck >= CONFIG.BINANCE_INTERVAL_MS) {
        lastBinanceCheck = now;

        const symbolsToCheck = CONFIG.SYMBOLS.slice(0, 4); // First 4 symbols

        for (const symbol of symbolsToCheck) {
          const sclrData = await getSclrOrderBook(page, symbol);
          const binanceData = await fetchBinanceDepth(symbol);

          if (sclrData && binanceData) {
            const comparison = compareToBinance(sclrData, binanceData, symbol);
            comparisons.push(comparison);

            if (comparison.discrepancies.length > 0) {
              console.log(`[Binance] ${symbol}: ${comparison.discrepancies.length} discrepancies`);
            }
          }
        }
      }

      await page.waitForTimeout(CONFIG.METRICS_INTERVAL_MS);
    }

    console.log('\n[Report] Generating report...');

    const report: TestReport = {
      startTime,
      endTime: Date.now(),
      duration: Date.now() - startTime,
      symbols: CONFIG.SYMBOLS,
      metrics,
      comparisons,
      summary: generateSummary(metrics, comparisons),
    };

    const dateStr = new Date(startTime).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const reportPath = path.join(__dirname, 'reports', `stress-test-${dateStr}.html`);
    const htmlReport = generateHtmlReport(report);

    fs.mkdirSync(path.join(__dirname, 'reports'), { recursive: true });
    fs.writeFileSync(reportPath, htmlReport);

    console.log('\n' + '='.repeat(60));
    console.log('STRESS TEST COMPLETE');
    console.log('='.repeat(60));
    console.log(`Status: ${report.summary.status}`);
    console.log(`Avg FPS: ${report.summary.avgFps} | Min FPS: ${report.summary.minFps}`);
    console.log(`Avg Flush: ${report.summary.avgFlushTime}ms | Max Flush: ${report.summary.maxFlushTime}ms`);
    console.log(`Binance Best Match: ${report.summary.binanceBestMatchRate}%`);
    console.log(`Binance Top-20 Match: ${report.summary.binanceTop20MatchRate}%`);
    console.log(`Report saved to: ${reportPath}`);
    console.log('='.repeat(60));

    if (report.summary.issues.length > 0) {
      console.log('\nIssues:');
      report.summary.issues.forEach(issue => console.log(`  - ${issue}`));
    }

    expect(report.summary.status).not.toBe('FAILED');
  });
});
