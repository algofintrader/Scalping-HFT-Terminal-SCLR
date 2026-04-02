# SCLR — Real-Time Scalping Terminal

A high-performance cryptocurrency scalping terminal with synchronized Order Book, Clusters, and Tick Chart visualization. Built for Binance Futures.

![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)
![React](https://img.shields.io/badge/React-19-blue)
![Bun](https://img.shields.io/badge/Bun-runtime-black)
![License](https://img.shields.io/badge/License-Source%20Available-orange)

## Features

- **Real-time Order Book** — Virtual Skeleton approach with 5000 rows, 100% local scroll, no network lag
- **Trade Clusters** — 5-minute volume aggregation columns with bid/ask breakdown
- **Tick Chart** — Live trade visualization
- **Synchronized Scroll** — Order Book and Clusters share the same price grid
- **60 FPS Rendering** — RAF-based render loop with batched Zustand updates (~0.1ms flush time)
- **Multi-instrument** — Up to 6 instruments simultaneously in a customizable workspace
- **Gzip Compression** — 10x smaller WebSocket payloads for resync messages
- **Instant Loading** — Always-on data collection, instruments load instantly on subscribe

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                          CLIENT                             │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  OrderBook   │  │   Clusters   │  │  Tick Chart   │     │
│  │  (Virtual    │◄─┤ (Virtualized)│  │              │     │
│  │   Skeleton)  │  │              │  │              │     │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘     │
│         └────────┬────────┘                                 │
│                  ▼                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │          marketData Store (Zustand)                  │   │
│  │  OrderBook { bids, asks, midPrice, revision }       │   │
│  │  Clusters  { columns, revision }                    │   │
│  │  Ticks[]                                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                  ▲                                           │
│         MarketDataBuffer (RAF 60fps)                        │
│                  │ WebSocket                                 │
└──────────────────┼──────────────────────────────────────────┘
                   │
┌──────────────────┼──────────────────────────────────────────┐
│                SERVER                                        │
│                  │                                           │
│  ┌───────────────┴──────────────────────────────────────┐  │
│  │                    handler.ts                         │  │
│  │  Client management · Message routing · Broadcasting   │  │
│  └───┬──────────────────┬──────────────────┬────────────┘  │
│      ▼                  ▼                  ▼               │
│  OrderBookService  ViewportManager   ClusterService        │
│  (full broadcast)  (clusters only)   (trade volumes)       │
│      │                                     │               │
│      └─────────────────┬───────────────────┘               │
│                        ▼                                    │
│              Binance WebSocket/REST                         │
│         depthUpdate · aggTrade streams                      │
└─────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Bun |
| **Server** | Hono + WebSocket |
| **Client** | React 19 + Vite |
| **State** | Zustand |
| **Data Source** | Binance Futures API |
| **Monorepo** | pnpm workspaces + Turborepo |
| **Auth** | JWT + Argon2id |
| **Database** | MongoDB |

## Project Structure

```
sclr/
├── apps/
│   ├── server/                    # Bun + Hono backend
│   │   └── src/
│   │       ├── binance/           # Binance API client
│   │       ├── services/
│   │       │   ├── OrderBookService.ts    # Order book broadcast
│   │       │   ├── ClusterService.ts      # Cluster aggregation
│   │       │   ├── ViewportManager.ts     # Viewport management
│   │       │   └── TickAggregator.ts      # Tick aggregation
│   │       └── ws/
│   │           └── handler.ts     # WebSocket handler
│   │
│   └── web/                       # React + Vite frontend
│       └── src/
│           ├── components/
│           │   ├── SyncedOrderBookV2.tsx   # Virtual Skeleton order book
│           │   ├── SyncedClustersV2.tsx    # Virtualized clusters
│           │   ├── TickChart.tsx           # Tick chart
│           │   └── InstrumentPanelV2.tsx   # Main panel container
│           ├── buffers/
│           │   ├── MarketDataBuffer.ts     # Delta queue
│           │   └── RenderLoop.ts          # RAF 60fps render loop
│           └── stores/
│               ├── marketData.ts  # Market data store
│               └── connection.ts  # WebSocket connection
│
└── packages/
    └── shared/                    # Shared types & protocols
        └── src/types/
            ├── orderbook.ts
            └── clusters.ts
```

## Quick Start

```bash
# 1. Clone
git clone https://github.com/algofintrader/sclrtrade.git
cd sclrtrade

# 2. Install dependencies
pnpm install

# 3. Configure environment
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env

# 4. Run
pnpm dev
```

Open http://localhost:5173 — done. Market data works immediately.

**What works without extra setup:**
- Live order book, clusters, tick chart
- Multi-instrument workspace (up to 6)
- All keyboard shortcuts

**What requires MongoDB + JWT (optional):**
- User registration / login
- Persistent settings across sessions

To enable auth:
```bash
docker run -d --name sclr-mongo -p 27017:27017 mongo:7
echo "JWT_SECRET=$(openssl rand -hex 32)" >> apps/server/.env
# restart pnpm dev
```

### Prerequisites

| Tool | What for | Version | Install |
|------|----------|---------|---------|
| [Bun](https://bun.sh/) | Server runtime | >= 1.0 | `curl -fsSL https://bun.sh/install \| bash` |
| [Node.js](https://nodejs.org/) | Frontend (Vite) | >= 20 | `brew install node` or [nvm](https://github.com/nvm-sh/nvm) |
| [pnpm](https://pnpm.io/) | Package manager | >= 9 | `npm install -g pnpm` |
| [MongoDB](https://www.mongodb.com/) | Auth & settings | any | `docker run -d -p 27017:27017 mongo:7` (optional) |

### Commands

```bash
pnpm dev            # Start server (3001) + web (5173)
pnpm dev:server     # Server only
pnpm dev:web        # Web only
pnpm build          # Production build
pnpm typecheck      # TypeScript check
```

### Deployment

```bash
cp deploy/.deploy.env.example deploy/.deploy.env
# Edit deploy/.deploy.env with your server details

pnpm deploy         # Production
pnpm deploy:dev     # Development
```

## Key Concepts

### Virtual Skeleton (Order Book)

The order book uses a Virtual Skeleton approach for maximum performance:
- Server broadcasts ALL price levels to all subscribers (no server-side filtering)
- Client stores everything locally in Maps for O(1) lookup
- Virtual Skeleton generates 5000 rows for smooth scrolling
- Scroll is 100% local — zero network requests during scroll

### RAF-Based Render Loop

```
WebSocket messages → MarketDataBuffer (queue deltas)
                            ↓
                    RAF tick (60fps)
                            ↓
                    Zustand batch update (single setState per frame)
```

Guarantees max 1 Zustand update per 16ms frame. Result: stable 60 FPS with ~0.1ms average flush time.

### Message Protocol

#### Server → Client

| Type | Description |
|------|-------------|
| `orderbook_resync_v2` | Full order book snapshot on subscribe |
| `orderbook_delta_v2` | Incremental updates (100ms interval) |
| `clusters_snapshot` | Initial cluster data |
| `clusters_delta` | Cluster updates |
| `ticks` | Aggregated tick data |

#### Client → Server

| Type | Description |
|------|-------------|
| `subscribe` | Subscribe to instrument |
| `unsubscribe` | Unsubscribe from instrument |
| `request_resync` | Request full resync |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| **C** | Center order book on mid-price (requires hover on order book) |

## Configuration Constants

```typescript
// Virtual Skeleton
VIRTUAL_ROWS = 5000;                // Virtual row count
CENTER_INDEX = 2500;                // Center index for mid-price
ROW_HEIGHT = 20;                    // Row height in pixels

// Server broadcast
DELTA_BROADCAST_INTERVAL_MS = 100;  // Delta broadcast interval

// Clusters
MAX_COLUMNS = 6;                    // 30 min history (6 × 5 min)
CLUSTER_INTERVAL_MS = 5 * 60 * 1000; // 5-minute column interval
```

## License

This project is licensed under a **Source Available License** — free for non-commercial use. See [LICENSE](LICENSE) for details.
