import { useRef, useEffect, useCallback, memo } from 'react';
import { useMarketDataStore } from '../stores/marketData';
import { useTranslation } from '../i18n';
import { CLIENT_CONFIG } from '../config';
import type { AggregatedTick } from '@sclr/shared';

interface Props {
  symbol: string;
  priceRange: { min: number; max: number } | null;
  compact?: boolean;
  maxVisibleTicks?: number; // Dynamic number of ticks based on available width
  tickSize?: number; // Price tick size for grid (e.g., 0.10 for BTCUSDT)
}

const { bubbleTextMinUsd, bubblePadding, bubbleMinRadius } = CLIENT_CONFIG.tickChart;
const DEFAULT_MAX_VISIBLE_TICKS = 100; // Default fixed number of visible ticks
const EMPTY_TICKS: AggregatedTick[] = [];
const TARGET_FPS = 30; // Limit to 30fps to save resources
const FRAME_INTERVAL = 1000 / TARGET_FPS;

const GRID_TICKS_INTERVAL = 50; // Grid every 50 ticks

export const TickChart = memo(function TickChart({ symbol, priceRange, compact = false, maxVisibleTicks = DEFAULT_MAX_VISIBLE_TICKS, tickSize = 0.10 }: Props) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(0);
  const ticksRef = useRef<AggregatedTick[]>([]);
  const priceRangeRef = useRef(priceRange);
  const compactRef = useRef(compact);
  const maxVisibleTicksRef = useRef(maxVisibleTicks);
  const tickSizeRef = useRef(tickSize);
  const lastFrameTimeRef = useRef(0);

  // Get ticks directly from store - zustand will trigger re-render when ticks change
  const ticksFromStore = useMarketDataStore((state) => state.symbols[symbol]?.ticks);
  const ticks = ticksFromStore ?? EMPTY_TICKS;

  // Update ALL refs synchronously during render (BEFORE any useEffect/rAF runs)
  // This ensures draw() always reads fresh values
  ticksRef.current = ticks;
  priceRangeRef.current = priceRange;
  compactRef.current = compact;
  maxVisibleTicksRef.current = maxVisibleTicks;
  tickSizeRef.current = tickSize;

  // Draw function uses refs instead of props to avoid recreation
  const draw = useCallback((timestamp?: number) => {
    // Throttle to TARGET_FPS
    if (timestamp) {
      const elapsed = timestamp - lastFrameTimeRef.current;
      if (elapsed < FRAME_INTERVAL) {
        animationRef.current = requestAnimationFrame(draw);
        return;
      }
      lastFrameTimeRef.current = timestamp;
    }

    const canvas = canvasRef.current;
    const container = containerRef.current;
    const currentPriceRange = priceRangeRef.current;
    const currentTicks = ticksRef.current;

    if (!canvas || !container || !currentPriceRange) {
      animationRef.current = requestAnimationFrame(draw);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const { min: minPrice, max: maxPrice } = currentPriceRange;
    const priceSpan = maxPrice - minPrice;

    if (priceSpan === 0) {
      animationRef.current = requestAnimationFrame(draw);
      return;
    }

    const gridStep = tickSizeRef.current * GRID_TICKS_INTERVAL; // e.g. 0.10 * 100 = 10.00
    const firstGridPrice = Math.ceil(minPrice / gridStep) * gridStep;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;

    for (let price = firstGridPrice; price <= maxPrice; price += gridStep) {
      const y = ((maxPrice - price) / priceSpan) * height;

      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    if (currentTicks.length === 0) {
      animationRef.current = requestAnimationFrame(draw);
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();

    const visibleTicks = currentTicks.slice(-maxVisibleTicksRef.current);

    const tickPoints = visibleTicks.map((tick, index) => {
      const price = parseFloat(tick.price);
      const x = visibleTicks.length > 1
        ? (index / (visibleTicks.length - 1)) * width
        : width / 2;
      const y = ((maxPrice - price) / priceSpan) * height;
      return { tick, x, y };
    });

    const lastTick = tickPoints[tickPoints.length - 1];
    if (lastTick) {
      const margin = height * 0.5;
      if (lastTick.y < -margin || lastTick.y > height + margin) {
        animationRef.current = requestAnimationFrame(draw);
        return;
      }
    }

    if (tickPoints.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;

      ctx.moveTo(tickPoints[0]!.x, tickPoints[0]!.y);
      for (let i = 1; i < tickPoints.length; i++) {
        ctx.lineTo(tickPoints[i]!.x, tickPoints[i]!.y);
      }
      ctx.stroke();
    }

    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const { tick, x, y } of tickPoints) {
      const quantity = parseFloat(tick.quantity);
      const price = parseFloat(tick.price);
      const usdValue = quantity * price;

      const isBuy = tick.side === 'buy';
      const bubbleColor = isBuy
        ? 'rgba(0, 200, 83, 0.7)'  // green
        : 'rgba(255, 23, 68, 0.7)'; // red

      if (usdValue >= bubbleTextMinUsd) {
        const text = formatUsdVolume(usdValue);
        const textWidth = ctx.measureText(text).width;
        const radius = textWidth / 2 + bubblePadding;

        ctx.fillStyle = bubbleColor;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'white';
        ctx.fillText(text, x, y);
      } else {
        ctx.fillStyle = bubbleColor;
        ctx.beginPath();
        ctx.arc(x, y, bubbleMinRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();

    animationRef.current = requestAnimationFrame(draw);
  }, []); // Empty deps - uses refs

  // Start animation loop once on mount
  useEffect(() => {
    draw();
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [draw]); // draw is stable (empty deps)

  // Resize observer - registered once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      // Cancel current frame and restart to handle resize
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      draw();
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [draw]); // draw is stable

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      />
      {!priceRange && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: 'var(--text-muted)',
            fontSize: '12px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Spinner />
          <span>{t.common.loading}</span>
        </div>
      )}
    </div>
  );
});

function formatUsdVolume(usd: number): string {
  if (usd >= 1000) return (usd / 1000).toFixed(0) + 'K';
  return Math.round(usd).toString();
}

const Spinner = memo(function Spinner() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      style={{
        animation: 'spin 1s linear infinite',
      }}
    >
      <style>
        {`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="40 60"
        opacity="0.5"
      />
    </svg>
  );
});
