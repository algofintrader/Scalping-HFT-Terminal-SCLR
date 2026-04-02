import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { handleWebSocket, closeAllClients } from './ws/handler';
import { tickAggregator } from './services/TickAggregator';
import { symbolManager } from './services/SymbolManager';
import { clusterService } from './services/ClusterService';
import { orderBookService } from './services/OrderBookService';
import { config } from './config';
import { db } from './db';
import guest from './routes/guest';
import auth from './routes/auth';
import user from './routes/user';

const app = new Hono();

// Adaptive rate limit: Binance allows 1200 weight/min, safe limit 50% = 600 weight/min
const SAFE_WEIGHT_PER_MIN = 600;
const DEPTH_WEIGHT = 10; // weight per depth request (limit=100)

function calculateDepthDelay(symbolCount: number): number {
  const maxRequestsPerMin = SAFE_WEIGHT_PER_MIN / DEPTH_WEIGHT;
  const requestsPerCycle = symbolCount; // each symbol needs one depth request
  const cyclesPerMin = maxRequestsPerMin / requestsPerCycle;
  const delayBetweenRequests = Math.ceil(60000 / (cyclesPerMin * requestsPerCycle));
  return Math.max(1000, delayBetweenRequests);
}

// CORS - MUST be before routes
app.use('*', cors({
  origin: config.corsOrigins,
}));

// API routes (nginx strips /api prefix)
app.route('/guest', guest);
app.route('/auth', auth);
app.route('/user', user);

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

app.get('/symbols', (c) => {
  const symbols = symbolManager.getSymbols();
  const symbolsWithInfo = symbols.map(symbol => {
    const info = orderBookService.getSymbolInfoFromCache(symbol as any);
    return {
      symbol,
      tickSize: info?.tickSize ?? null,
      pricePrecision: info?.pricePrecision ?? null,
    };
  });
  return c.json({ symbols: symbolsWithInfo });
});

async function main() {
  console.log(`[Server] Starting on port ${config.port}...`);

  await db.initialize();
  await symbolManager.initialize();

  // Start background data collection async (don't block server start)
  const symbols = symbolManager.getSymbols();
  console.log(`[Server] Will start background collection for ${symbols.length} symbols (async)...`);

  (async () => {
    // Wait 10s before starting to avoid API overload on rapid restarts
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Preload exchangeInfo for all symbols in one request (retries internally)
    const preloadSuccess = await orderBookService.preloadSymbolInfo(symbols as any);

    if (!preloadSuccess) {
      console.warn(`[Server] Preload failed, will load symbol info on demand (slower)`);
    }

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Adaptive delay based on symbol count to stay within rate limits
    const depthDelay = calculateDepthDelay(symbols.length);
    const totalTime = Math.ceil((symbols.length * depthDelay) / 1000);
    console.log(`[Server] Starting background OrderBook collection (${symbols.length} symbols, ${depthDelay}ms delay, ~${totalTime}s total)...`);

    const MAX_SYMBOL_RETRIES = 3;

    for (const symbol of symbols) {
      let success = false;

      for (let attempt = 1; attempt <= MAX_SYMBOL_RETRIES && !success; attempt++) {
        try {
          await orderBookService.subscribe(symbol as any);
          console.log(`[Server] OrderBook subscribed: ${symbol}`);
          success = true;

          // Start clusters immediately (don't wait for all orderbooks)
          if (!clusterService.isSubscribed(symbol as any)) {
            clusterService.subscribe(symbol as any);
            console.log(`[Server] Clusters subscribed: ${symbol}`);
          }

          // Start TickAggregator for background collection
          tickAggregator.subscribe(symbol as any);
          console.log(`[Server] TickAggregator subscribed: ${symbol}`);
        } catch (err) {
          if (attempt < MAX_SYMBOL_RETRIES) {
            const retryDelay = depthDelay * 2;
            console.error(`[Server] OrderBook ${symbol} attempt ${attempt}/${MAX_SYMBOL_RETRIES} failed, retry in ${retryDelay / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          } else {
            console.error(`[Server] OrderBook ${symbol} failed after ${MAX_SYMBOL_RETRIES} attempts, skipping`);
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, depthDelay));
    }

    // Start cluster background collection after OrderBook
    console.log(`[Server] Starting background Clusters collection...`);
    clusterService.startBackgroundCollection(symbols as any);
  })();

  // Start Bun server with WebSocket support
  const server = Bun.serve({
    port: config.port,
    fetch(req, server) {
      // WebSocket upgrade
      if (req.headers.get('upgrade') === 'websocket') {
        const success = server.upgrade(req, { data: { clientId: '', subscriptions: new Set() } });
        if (success) return undefined;
        return new Response('WebSocket upgrade failed', { status: 500 });
      }

      return app.fetch(req);
    },
    websocket: handleWebSocket,
  });

  console.log(`[Server] Running at http://localhost:${server.port}`);
  console.log(`[Server] WebSocket available at ws://localhost:${server.port}`);
  console.log(`[Server] Supported symbols: ${symbolManager.getSymbols().length}`);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('[Server] Shutting down...');

    // 1. Close all client WS connections
    closeAllClients();

    // 2. Stop services (unsubscribe from Binance)
    const symbols = symbolManager.getSymbols();
    for (const symbol of symbols) {
      orderBookService.unsubscribe(symbol as any);
      clusterService.unsubscribe(symbol as any);
      tickAggregator.unsubscribe(symbol as any);
    }

    // 3. Cleanup ClusterService (bounds callback)
    clusterService.cleanup();

    // 4. Stop SymbolManager
    symbolManager.stop();

    // 5. Close DB
    await db.close();

    // 6. Stop server
    server.stop();

    console.log('[Server] Shutdown complete');
    process.exit(0);
  });
}

main().catch(err => {
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});
