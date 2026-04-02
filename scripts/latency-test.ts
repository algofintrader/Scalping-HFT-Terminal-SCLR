/**
 * SCLR Frontend Latency Test
 *
 * Binance → SCLR Server → WS → Buffer → RenderLoop → Store → React → DOM
 *
 */

import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const CONFIG = {
  URL: process.env.SCLR_URL || 'http://localhost:5173',

  SYMBOL: 'BTCUSDT',

  DURATION_MS: 30 * 1000, // 30 seconds

  BINANCE_WS: 'wss://fstream.binance.com/ws',

  THRESHOLDS: {
    MATCH_RATE_PASS: 0.15,  // 15%+ = excellent (data not far behind)
    MATCH_RATE_WARN: 0.05,  // 5%+ = acceptable

    E2E_LATENCY_PASS: 500,
    E2E_LATENCY_WARN: 1000,

    // Frontend processing (Store update overhead)
    FRONTEND_OVERHEAD_PASS: 150,
    FRONTEND_OVERHEAD_WARN: 300,
  },
};

interface LatencySample {
  timestamp: number;
  binanceTime: number;      // Event time from Binance (T)
  binanceBid: string;
  binanceAsk: string;
  sclrBid: string;
  sclrAsk: string;
  sclrServerTime: number;   // serverTimestamp from SCLR
  sclrClientTime: number;   // clientReceiveTime from SCLR
  bidMatch: boolean;
  askMatch: boolean;
  bidDiff: number;          // Price difference ($)
  askDiff: number;
  e2eLatency: number;       // timestamp - binanceTime
  serverLatency: number;    // sclrServerTime - binanceTime (approximate)
  frontendLatency: number;  // sclrClientTime - sclrServerTime
}

interface TestReport {
  startTime: number;
  endTime: number;
  duration: number;
  symbol: string;
  samples: LatencySample[];
  summary: {
    totalSamples: number;
    bidMatchRate: number;
    askMatchRate: number;
    bothMatchRate: number;

    e2eLatency: {
      avg: number;
      min: number;
      max: number;
      p95: number;
    };

    serverLatency: {
      avg: number;
      min: number;
      max: number;
    };

    frontendLatency: {
      avg: number;
      min: number;
      max: number;
    };

    status: 'PASSED' | 'WARNING' | 'FAILED';
    issues: string[];
  };
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil(arr.length * p / 100) - 1;
  return sorted[Math.max(0, index)];
}

function generateSummary(samples: LatencySample[]): TestReport['summary'] {
  const issues: string[] = [];

  // Match rates
  const bidMatches = samples.filter(s => s.bidMatch).length;
  const askMatches = samples.filter(s => s.askMatch).length;
  const bothMatches = samples.filter(s => s.bidMatch && s.askMatch).length;

  const bidMatchRate = samples.length ? bidMatches / samples.length : 0;
  const askMatchRate = samples.length ? askMatches / samples.length : 0;
  const bothMatchRate = samples.length ? bothMatches / samples.length : 0;

  // E2E latency
  const e2eLatencies = samples.map(s => s.e2eLatency).filter(l => l > 0);
  const e2eAvg = e2eLatencies.length ? e2eLatencies.reduce((a, b) => a + b, 0) / e2eLatencies.length : 0;
  const e2eMin = e2eLatencies.length ? Math.min(...e2eLatencies) : 0;
  const e2eMax = e2eLatencies.length ? Math.max(...e2eLatencies) : 0;
  const e2eP95 = percentile(e2eLatencies, 95);

  const serverLatencies = samples.map(s => s.serverLatency).filter(l => l > 0 && l < 10000);
  const serverAvg = serverLatencies.length ? serverLatencies.reduce((a, b) => a + b, 0) / serverLatencies.length : 0;
  const serverMin = serverLatencies.length ? Math.min(...serverLatencies) : 0;
  const serverMax = serverLatencies.length ? Math.max(...serverLatencies) : 0;

  // Frontend latency
  const frontendLatencies = samples.map(s => s.frontendLatency).filter(l => l > 0 && l < 1000);
  const frontendAvg = frontendLatencies.length ? frontendLatencies.reduce((a, b) => a + b, 0) / frontendLatencies.length : 0;
  const frontendMin = frontendLatencies.length ? Math.min(...frontendLatencies) : 0;
  const frontendMax = frontendLatencies.length ? Math.max(...frontendLatencies) : 0;

  let status: 'PASSED' | 'WARNING' | 'FAILED' = 'PASSED';

  if (bothMatchRate < CONFIG.THRESHOLDS.MATCH_RATE_WARN) {
    issues.push(`Match rate ${(bothMatchRate * 100).toFixed(1)}% < ${CONFIG.THRESHOLDS.MATCH_RATE_WARN * 100}%`);
    status = 'FAILED';
  } else if (bothMatchRate < CONFIG.THRESHOLDS.MATCH_RATE_PASS) {
    issues.push(`Match rate ${(bothMatchRate * 100).toFixed(1)}% below optimal ${CONFIG.THRESHOLDS.MATCH_RATE_PASS * 100}%`);
    if (status !== 'FAILED') status = 'WARNING';
  }

  if (e2eAvg > CONFIG.THRESHOLDS.E2E_LATENCY_WARN) {
    issues.push(`E2E latency avg ${e2eAvg.toFixed(0)}ms > ${CONFIG.THRESHOLDS.E2E_LATENCY_WARN}ms`);
    status = 'FAILED';
  } else if (e2eAvg > CONFIG.THRESHOLDS.E2E_LATENCY_PASS) {
    issues.push(`E2E latency avg ${e2eAvg.toFixed(0)}ms above optimal ${CONFIG.THRESHOLDS.E2E_LATENCY_PASS}ms`);
    if (status !== 'FAILED') status = 'WARNING';
  }

  if (frontendAvg > CONFIG.THRESHOLDS.FRONTEND_OVERHEAD_WARN) {
    issues.push(`Frontend overhead avg ${frontendAvg.toFixed(0)}ms > ${CONFIG.THRESHOLDS.FRONTEND_OVERHEAD_WARN}ms`);
    status = 'FAILED';
  } else if (frontendAvg > CONFIG.THRESHOLDS.FRONTEND_OVERHEAD_PASS) {
    issues.push(`Frontend overhead avg ${frontendAvg.toFixed(0)}ms above optimal ${CONFIG.THRESHOLDS.FRONTEND_OVERHEAD_PASS}ms`);
    if (status !== 'FAILED') status = 'WARNING';
  }

  return {
    totalSamples: samples.length,
    bidMatchRate: Math.round(bidMatchRate * 1000) / 10,
    askMatchRate: Math.round(askMatchRate * 1000) / 10,
    bothMatchRate: Math.round(bothMatchRate * 1000) / 10,

    e2eLatency: {
      avg: Math.round(e2eAvg),
      min: Math.round(e2eMin),
      max: Math.round(e2eMax),
      p95: Math.round(e2eP95),
    },

    serverLatency: {
      avg: Math.round(serverAvg),
      min: Math.round(serverMin),
      max: Math.round(serverMax),
    },

    frontendLatency: {
      avg: Math.round(frontendAvg),
      min: Math.round(frontendMin),
      max: Math.round(frontendMax),
    },

    status,
    issues,
  };
}

function generateHtmlReport(report: TestReport): string {
  const startDate = new Date(report.startTime);
  const dateStr = startDate.toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const timestamps = report.samples.map(s => new Date(s.timestamp).toLocaleTimeString());
  const e2eLatencyData = report.samples.map(s => s.e2eLatency);
  const matchData = report.samples.map(s => (s.bidMatch && s.askMatch) ? 1 : 0);
  const bidDiffData = report.samples.map(s => s.bidDiff);
  const askDiffData = report.samples.map(s => s.askDiff);

  const statusColor = report.summary.status === 'PASSED' ? '#22c55e' :
                      report.summary.status === 'WARNING' ? '#eab308' : '#ef4444';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SCLR Latency Test Report - ${dateStr}</title>
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
    .container { max-width: 1200px; margin: 0 auto; }
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
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .summary-card {
      background: #1a1a1a;
      padding: 16px;
      border-radius: 8px;
      border-left: 3px solid #3b82f6;
    }
    .summary-card.latency { border-left-color: #22c55e; }
    .summary-card.match { border-left-color: #eab308; }
    .summary-card h3 { color: #888; font-size: 11px; text-transform: uppercase; margin-bottom: 8px; }
    .summary-card .value { font-size: 24px; font-weight: bold; color: #fff; }
    .summary-card .unit { font-size: 12px; color: #666; }
    .summary-card .detail { font-size: 11px; color: #666; margin-top: 4px; }
    .chart-container {
      background: #1a1a1a;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .chart-container h2 { margin-bottom: 16px; font-size: 16px; color: #fff; }
    .chart-wrapper { height: 200px; }
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
    .explanation {
      background: #1a1a1a;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .explanation h2 { margin-bottom: 16px; font-size: 16px; color: #fff; }
    .explanation p { color: #888; margin-bottom: 12px; font-size: 14px; }
    .explanation code { background: #2a2a2a; padding: 2px 6px; border-radius: 3px; color: #3b82f6; }
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
        <h1>SCLR Frontend Latency Test</h1>
        <div style="color: #888; font-size: 14px; margin-top: 4px;">
          ${startDate.toLocaleString()} | Duration: ${Math.round(report.duration / 1000)}s | Symbol: ${report.symbol}
        </div>
      </div>
      <div class="status">${report.summary.status}</div>
    </div>

    <div class="summary-grid">
      <div class="summary-card match">
        <h3>Best Bid Match</h3>
        <div class="value">${report.summary.bidMatchRate}<span class="unit">%</span></div>
      </div>
      <div class="summary-card match">
        <h3>Best Ask Match</h3>
        <div class="value">${report.summary.askMatchRate}<span class="unit">%</span></div>
      </div>
      <div class="summary-card match">
        <h3>Both Match</h3>
        <div class="value">${report.summary.bothMatchRate}<span class="unit">%</span></div>
      </div>
      <div class="summary-card latency">
        <h3>E2E Latency (avg)</h3>
        <div class="value">${report.summary.e2eLatency.avg}<span class="unit">ms</span></div>
        <div class="detail">P95: ${report.summary.e2eLatency.p95}ms | Max: ${report.summary.e2eLatency.max}ms</div>
      </div>
      <div class="summary-card latency">
        <h3>Server Latency (avg)</h3>
        <div class="value">${report.summary.serverLatency.avg}<span class="unit">ms</span></div>
        <div class="detail">Min: ${report.summary.serverLatency.min}ms | Max: ${report.summary.serverLatency.max}ms</div>
      </div>
      <div class="summary-card latency">
        <h3>Frontend Overhead (avg)</h3>
        <div class="value">${report.summary.frontendLatency.avg}<span class="unit">ms</span></div>
        <div class="detail">Min: ${report.summary.frontendLatency.min}ms | Max: ${report.summary.frontendLatency.max}ms</div>
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
        <h2>E2E Latency over Time</h2>
        <div class="chart-wrapper">
          <canvas id="latencyChart"></canvas>
        </div>
      </div>
      <div class="chart-container">
        <h2>Price Match (1=match, 0=mismatch)</h2>
        <div class="chart-wrapper">
          <canvas id="matchChart"></canvas>
        </div>
      </div>
    </div>

    <div class="chart-container">
      <h2>Price Difference (Binance - SCLR)</h2>
      <div class="chart-wrapper">
        <canvas id="diffChart"></canvas>
      </div>
    </div>

    <div class="explanation">
      <h2>Interpreting Results</h2>
      <p><strong>Match Rate</strong> - percentage of best bid/ask matches between Binance (direct) and SCLR Store.</p>
      <p><strong style="color: #eab308;">Why match rate is low (this is NORMAL):</strong></p>
      <ul style="margin: 8px 0 16px 20px; color: #888;">
        <li>Binance <code>bookTicker</code> arrives directly ~100 times/sec</li>
        <li>SCLR Server batches data and sends every 100ms</li>
        <li>At each comparison Binance already has the next update, while SCLR does not yet</li>
        <li>Match rate 15-30% = prices lag ~100-200ms = excellent for trading</li>
        <li>Match rate 5-15% = prices lag ~200-500ms = acceptable</li>
        <li>Match rate < 5% = synchronization issue</li>
      </ul>
      <p><strong>E2E Latency</strong> = <code>Date.now()</code> - <code>binanceTime</code> (total delay from Binance to our code)</p>
      <p><strong>Server Latency</strong> = <code>sclrServerTimestamp</code> - <code>binanceTime</code> (approximate, depends on clock sync)</p>
      <p><strong>Frontend Overhead</strong> = <code>sclrClientReceiveTime</code> - <code>sclrServerTimestamp</code> (client processing time: WS → Buffer → RenderLoop → Store)</p>
    </div>

    <div class="meta">
      <strong>Test Configuration:</strong><br>
      URL: ${CONFIG.URL}<br>
      Symbol: ${report.symbol}<br>
      Samples: ${report.summary.totalSamples}<br>
      Generated: ${new Date().toISOString()}
    </div>
  </div>

  <script>
    const chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: { ticks: { maxTicksLimit: 10, color: '#666' }, grid: { color: '#333' } },
        y: { ticks: { color: '#666' }, grid: { color: '#333' } }
      },
      plugins: { legend: { display: false } }
    };

    // Latency Chart
    new Chart(document.getElementById('latencyChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(timestamps)},
        datasets: [{
          data: ${JSON.stringify(e2eLatencyData)},
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34, 197, 94, 0.1)',
          fill: true,
          tension: 0.1,
          pointRadius: 0
        }]
      },
      options: chartOptions
    });

    // Match Chart
    new Chart(document.getElementById('matchChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(timestamps)},
        datasets: [{
          data: ${JSON.stringify(matchData)},
          borderColor: '#eab308',
          backgroundColor: 'rgba(234, 179, 8, 0.1)',
          fill: true,
          stepped: true,
          pointRadius: 0
        }]
      },
      options: { ...chartOptions, scales: { ...chartOptions.scales, y: { min: 0, max: 1.1, ticks: { color: '#666' }, grid: { color: '#333' } } } }
    });

    // Diff Chart
    new Chart(document.getElementById('diffChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(timestamps)},
        datasets: [
          {
            label: 'Bid Diff',
            data: ${JSON.stringify(bidDiffData)},
            borderColor: '#3b82f6',
            tension: 0.1,
            pointRadius: 0
          },
          {
            label: 'Ask Diff',
            data: ${JSON.stringify(askDiffData)},
            borderColor: '#ef4444',
            tension: 0.1,
            pointRadius: 0
          }
        ]
      },
      options: {
        ...chartOptions,
        plugins: { legend: { display: true, labels: { color: '#888' } } }
      }
    });
  </script>
</body>
</html>`;
}

test.describe('SCLR Frontend Latency Test', () => {
  test.setTimeout(120000); // 2 minutes max

  test('measure frontend latency vs direct Binance', async ({ page }) => {
    const startTime = Date.now();

    console.log('='.repeat(60));
    console.log('SCLR Frontend Latency Test Starting');
    console.log(`URL: ${CONFIG.URL}`);
    console.log(`Symbol: ${CONFIG.SYMBOL}`);
    console.log(`Duration: ${CONFIG.DURATION_MS / 1000} seconds`);
    console.log('='.repeat(60));

    console.log('\n[Setup] Navigating to', CONFIG.URL);
    await page.goto(CONFIG.URL, { waitUntil: 'networkidle' });

    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });

    console.log('[Setup] Waiting for store initialization and WebSocket connection...');
    await page.waitForFunction(() => {
      const marketStore = (window as any).__marketDataStore;
      const renderLoop = (window as any).__renderLoop;
      const buffer = (window as any).__marketDataBuffer;
      const workspaceStore = (window as any).__workspaceStore;

      if (!marketStore || !renderLoop || !buffer || !workspaceStore) {
        return false;
      }

      const workspaceState = workspaceStore.getState();
      if (!workspaceState._hasHydrated) {
        return false;
      }

      return true;
    }, { timeout: 30000 });

    console.log('[Setup] Store initialized, waiting for WebSocket...');

    await page.waitForTimeout(2000);

    console.log(`[Setup] Adding ${CONFIG.SYMBOL}...`);
    await page.evaluate((symbol) => {
      const workspace = (window as any).__workspaceStore;
      if (workspace) {
        const state = workspace.getState();
        for (const instrument of state.instruments) {
          state.removeInstrument(instrument.id);
        }
        state.addInstrument(symbol);
      }
    }, CONFIG.SYMBOL);

    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[WS] Error') || text.includes('[WS] Disconnected')) {
        console.log(`[Browser] ${text}`);
      }
    });

    console.log('[Setup] Waiting for initial data...');
    await page.waitForFunction((symbol) => {
      const store = (window as any).__marketDataStore;
      if (!store) return false;
      const state = store.getState();
      const data = state.symbols[symbol];
      return data?.orderbookV2?.bestBid && data.orderbookV2.bestBid !== '0';
    }, CONFIG.SYMBOL, { timeout: 60000 }); // Increased timeout to 60s

    console.log('[Setup] Initial data received');

    console.log('[Collection] Starting latency measurement...');

    const samples = await page.evaluate(async (config) => {
      return new Promise<LatencySample[]>((resolve) => {
        const samples: LatencySample[] = [];
        const symbol = config.SYMBOL;
        const duration = config.DURATION_MS;

        const binanceWs = new WebSocket(
          `${config.BINANCE_WS}/${symbol.toLowerCase()}@bookTicker`
        );

        const startTime = Date.now();

        binanceWs.onopen = () => {
          console.log('[Binance WS] Connected');
        };

        binanceWs.onmessage = (e) => {
          const now = Date.now();

          if (now - startTime >= duration) {
            binanceWs.close();
            resolve(samples);
            return;
          }

          try {
            const binanceData = JSON.parse(e.data);
            const binanceBid = binanceData.b;
            const binanceAsk = binanceData.a;
            const binanceTime = binanceData.T; // Event time from Binance

            const store = (window as any).__marketDataStore;
            if (!store) return;

            const state = store.getState();
            const sclrData = state.symbols[symbol]?.orderbookV2;
            if (!sclrData || !sclrData.bestBid || sclrData.bestBid === '0') return;

            const sclrBid = sclrData.bestBid;
            const sclrAsk = sclrData.bestAsk;
            const sclrServerTime = sclrData.serverTimestamp || 0;
            const sclrClientTime = sclrData.clientReceiveTime || 0;

            const bidMatch = binanceBid === sclrBid;
            const askMatch = binanceAsk === sclrAsk;
            const bidDiff = parseFloat(binanceBid) - parseFloat(sclrBid);
            const askDiff = parseFloat(binanceAsk) - parseFloat(sclrAsk);

            const e2eLatency = now - binanceTime;
            const serverLatency = sclrServerTime - binanceTime;
            const frontendLatency = sclrClientTime - sclrServerTime;

            samples.push({
              timestamp: now,
              binanceTime,
              binanceBid,
              binanceAsk,
              sclrBid,
              sclrAsk,
              sclrServerTime,
              sclrClientTime,
              bidMatch,
              askMatch,
              bidDiff,
              askDiff,
              e2eLatency,
              serverLatency,
              frontendLatency,
            });
          } catch (err) {
            console.error('[Binance WS] Parse error:', err);
          }
        };

        binanceWs.onerror = (err) => {
          console.error('[Binance WS] Error:', err);
        };

        binanceWs.onclose = () => {
          console.log('[Binance WS] Closed');
          resolve(samples);
        };

        setTimeout(() => {
          binanceWs.close();
          resolve(samples);
        }, duration + 5000);
      });
    }, CONFIG);

    console.log(`[Collection] Collected ${samples.length} samples`);

    console.log('\n[Report] Generating report...');

    const report: TestReport = {
      startTime,
      endTime: Date.now(),
      duration: Date.now() - startTime,
      symbol: CONFIG.SYMBOL,
      samples,
      summary: generateSummary(samples),
    };

    const dateStr = new Date(startTime).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const reportsDir = path.join(__dirname, 'reports');
    const reportPath = path.join(reportsDir, `latency-test-${dateStr}.html`);
    const htmlReport = generateHtmlReport(report);

    fs.mkdirSync(reportsDir, { recursive: true });
    fs.writeFileSync(reportPath, htmlReport);

    console.log('\n' + '='.repeat(60));
    console.log('LATENCY TEST COMPLETE');
    console.log('='.repeat(60));
    console.log(`Symbol: ${report.symbol}`);
    console.log(`Duration: ${Math.round(report.duration / 1000)} seconds`);
    console.log(`Samples: ${report.summary.totalSamples}`);
    console.log('');
    console.log('=== RESULTS ===');
    console.log(`Best bid match rate: ${report.summary.bidMatchRate}%`);
    console.log(`Best ask match rate: ${report.summary.askMatchRate}%`);
    console.log(`Both match rate: ${report.summary.bothMatchRate}%`);
    console.log('');
    console.log('Latency (End-to-End):');
    console.log(`  Avg: ${report.summary.e2eLatency.avg}ms`);
    console.log(`  Min: ${report.summary.e2eLatency.min}ms`);
    console.log(`  Max: ${report.summary.e2eLatency.max}ms`);
    console.log(`  P95: ${report.summary.e2eLatency.p95}ms`);
    console.log('');
    console.log('Latency (Server):');
    console.log(`  Avg: ${report.summary.serverLatency.avg}ms`);
    console.log('');
    console.log(`Frontend processing: ~${report.summary.frontendLatency.avg}ms`);
    console.log('');
    console.log(`Status: ${report.summary.status}`);
    console.log(`Report saved to: ${reportPath}`);
    console.log('='.repeat(60));

    if (report.summary.issues.length > 0) {
      console.log('\nIssues:');
      report.summary.issues.forEach(issue => console.log(`  - ${issue}`));
    }

    expect(report.summary.status).not.toBe('FAILED');
  });
});
