/**
 * SyncedOrderBookV2 - Virtual Skeleton Architecture
 *
 */

import { useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle, useState, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useShallow } from 'zustand/react/shallow';
import { useMarketDataStore, selectOrderBookV2, selectSymbolInfo } from '../stores/marketData';
import { useUIPreferencesStore } from '../stores/uiPreferences';
import { useTranslation } from '../i18n';
import { ORDERBOOK_CONFIG_V2 } from '@sclr/shared';
import { CLIENT_CONFIG } from '../config';
import { featureLog } from '../utils/debug';

const ROW_BASE_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  fontFamily: 'monospace',
};

const CELL_LEFT_STYLE: React.CSSProperties = {
  width: '50%',
  textAlign: 'right',
  color: 'var(--text-primary)',
};

const CELL_RIGHT_STYLE: React.CSSProperties = {
  width: '50%',
  textAlign: 'left',
  color: 'var(--text-primary)',
};

const LOADING_CONTAINER_STYLE: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text-muted)',
  fontSize: '12px',
  flexDirection: 'column',
  gap: '8px',
};

const CONTAINER_STYLE: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  outline: 'none',
};

const SCROLL_CONTAINER_STYLE: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  contain: 'strict',
};

interface Props {
  symbol: string;
  onScroll?: (scrollTop: number) => void;
  onCenterIndexChange?: (index: number) => void;
  onSkeletonCenterChange?: (price: number, scrollTop?: number) => void;
  onVisibleRangeChange?: (range: { min: number; max: number }) => void;
  compact?: boolean;
}

export interface SyncedOrderBookV2Ref {
  scrollTo: (scrollTop: number) => void;
  scrollToCenter: () => void;
}

const { VIRTUAL_ROWS, CENTER_INDEX, EDGE_THRESHOLD, SHIFT_TICKS } = ORDERBOOK_CONFIG_V2;
const ROW_HEIGHT = CLIENT_CONFIG.orderbook.rowHeight;

export const SyncedOrderBookV2 = forwardRef<SyncedOrderBookV2Ref, Props>(
  function SyncedOrderBookV2({ symbol, onScroll, onCenterIndexChange, onSkeletonCenterChange, onVisibleRangeChange, compact = false }, ref) {
    const { t } = useTranslation();
    const scrollRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const isHoveringRef = useRef(false);
    const lastScrollCallbackRef = useRef(0);
    const mouseLeaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const userScrolledRef = useRef(false); // User scrolled while cursor was over the order book

    const autoScrollEnabled = useUIPreferencesStore((s) => s.autoScrollEnabled);
    const { upperThresholdPercent, lowerThresholdPercent } = CLIENT_CONFIG.autoscroll;

    // V2 OrderBook state
    const orderbookV2 = useMarketDataStore(selectOrderBookV2(symbol));

    const symbolInfo = useMarketDataStore(selectSymbolInfo(symbol));

    const bids = orderbookV2?.bids ?? null;
    const asks = orderbookV2?.asks ?? null;
    const bestBid = orderbookV2?.bestBid ?? '0';
    const bestAsk = orderbookV2?.bestAsk ?? '0';
    const tickSize = orderbookV2?.tickSize ?? symbolInfo?.tickSize ?? '0.01';
    const pricePrecision = orderbookV2?.pricePrecision ?? symbolInfo?.pricePrecision ?? 2;

    const tickSizeNum = parseFloat(tickSize);

    const prevTickSizeRef = useRef<number>(tickSizeNum);

    const actualMidPrice = useMemo(() => {
      const bestBidNum = parseFloat(bestBid);
      const bestAskNum = parseFloat(bestAsk);

      if (bestBidNum <= 0 || bestAskNum <= 0 || tickSizeNum <= 0) return 0;

      const mid = (bestBidNum + bestAskNum) / 2;
      return mid - (mid % tickSizeNum);
    }, [bestBid, bestAsk, tickSizeNum]);

    const [skeletonCenterPrice, setSkeletonCenterPrice] = useState<number>(0);

    const skeletonCenterPriceRef = useRef<number>(0);

    const updateSkeletonCenter = useCallback((newPrice: number) => {
      skeletonCenterPriceRef.current = newPrice;  // SYNC (instant)
      setSkeletonCenterPrice(newPrice);           // ASYNC (batched)
    }, []);

    const hasRealTickSize = (orderbookV2?.revision ?? 0) > 0 || symbolInfo?.tickSize != null;

    useEffect(() => {
      if (actualMidPrice > 0 && skeletonCenterPrice === 0 && hasRealTickSize) {
        updateSkeletonCenter(actualMidPrice);
        onSkeletonCenterChange?.(actualMidPrice);
        featureLog('VIRTUAL_SKELETON', `Initialized skeleton center: ${actualMidPrice}, tickSize: ${tickSize}`);
      }
    }, [actualMidPrice, skeletonCenterPrice, hasRealTickSize, onSkeletonCenterChange, tickSize, updateSkeletonCenter]);

    useEffect(() => {
      const prevTickSize = prevTickSizeRef.current;

      if (prevTickSize > 0 && tickSizeNum > 0 && skeletonCenterPrice > 0) {
        const ratio = tickSizeNum / prevTickSize;
        if (ratio < 0.9 || ratio > 1.1) {
          featureLog('VIRTUAL_SKELETON', `TickSize changed significantly: ${prevTickSize} → ${tickSizeNum}, resetting center`);
          updateSkeletonCenter(actualMidPrice);
          onSkeletonCenterChange?.(actualMidPrice);
          hasCenteredRef.current = false; // Reset for re-centering
        }
      }

      prevTickSizeRef.current = tickSizeNum;
    }, [tickSizeNum, skeletonCenterPrice, actualMidPrice, onSkeletonCenterChange, updateSkeletonCenter]);

    const overscanCount = compact ? 5 : 10;

    const virtualizer = useVirtualizer({
      count: VIRTUAL_ROWS,
      getScrollElement: () => scrollRef.current,
      estimateSize: () => ROW_HEIGHT,
      overscan: overscanCount,
    });

    const indexToPrice = useCallback((index: number): string => {
      if (skeletonCenterPrice === 0 || tickSizeNum === 0) return '0';
      const priceNum = skeletonCenterPrice + (CENTER_INDEX - index) * tickSizeNum;
      return priceNum.toFixed(pricePrecision);
    }, [skeletonCenterPrice, tickSizeNum, pricePrecision]);

    const centerIndex = useMemo(() => {
      if (skeletonCenterPrice === 0 || !bestBid || !bestAsk) return CENTER_INDEX;

      const bestBidNum = parseFloat(bestBid);
      const bestAskNum = parseFloat(bestAsk);
      const midPrice = (bestBidNum + bestAskNum) / 2;

      const ticksDiff = (skeletonCenterPrice - midPrice) / tickSizeNum;
      return CENTER_INDEX + Math.round(ticksDiff);
    }, [skeletonCenterPrice, bestBid, bestAsk, tickSizeNum]);

    useEffect(() => {
      if (onCenterIndexChange) {
        onCenterIndexChange(centerIndex);
      }
    }, [centerIndex, onCenterIndexChange]);

    const handleScroll = useCallback(() => {
      if (!scrollRef.current) return;

      const scrollTop = scrollRef.current.scrollTop;
      const scrollHeight = scrollRef.current.scrollHeight;
      const clientHeight = scrollRef.current.clientHeight;
      const now = performance.now();

      if (onScroll && now - lastScrollCallbackRef.current > 33) {
        lastScrollCallbackRef.current = now;
        onScroll(scrollTop);
      }

      const currentCenter = skeletonCenterPriceRef.current;

      if (onVisibleRangeChange && currentCenter > 0 && tickSizeNum > 0) {
        const firstVisibleIndex = Math.floor(scrollTop / ROW_HEIGHT);
        const lastVisibleIndex = Math.ceil((scrollTop + clientHeight) / ROW_HEIGHT);

        const topPrice = currentCenter + (CENTER_INDEX - firstVisibleIndex) * tickSizeNum;
        const bottomPrice = currentCenter + (CENTER_INDEX - lastVisibleIndex) * tickSizeNum;

        onVisibleRangeChange({ min: bottomPrice, max: topPrice });
      }

      const maxScroll = scrollHeight - clientHeight;
      if (maxScroll <= 0) return;

      const scrollRatio = scrollTop / maxScroll;

      if (scrollRatio < EDGE_THRESHOLD && currentCenter > 0) {
        const shift = tickSizeNum * SHIFT_TICKS;
        const newCenter = currentCenter + shift;
        updateSkeletonCenter(newCenter);
        const newScrollTop = scrollRef.current.scrollTop + SHIFT_TICKS * ROW_HEIGHT;
        scrollRef.current.scrollTop = newScrollTop;
        onSkeletonCenterChange?.(newCenter, newScrollTop);
        featureLog('VIRTUAL_SKELETON', `Shift UP: ${currentCenter.toFixed(2)} → ${newCenter.toFixed(2)}`);
      } else if (scrollRatio > (1 - EDGE_THRESHOLD) && currentCenter > 0) {
        const shift = tickSizeNum * SHIFT_TICKS;
        const newCenter = currentCenter - shift;
        if (newCenter > 0) {
          updateSkeletonCenter(newCenter);
          const newScrollTop = scrollRef.current.scrollTop - SHIFT_TICKS * ROW_HEIGHT;
          scrollRef.current.scrollTop = newScrollTop;
          onSkeletonCenterChange?.(newCenter, newScrollTop);
          featureLog('VIRTUAL_SKELETON', `Shift DOWN: ${currentCenter.toFixed(2)} → ${newCenter.toFixed(2)}`);
        }
      }
    }, [onScroll, tickSizeNum, onSkeletonCenterChange, onVisibleRangeChange, updateSkeletonCenter]);

    const scrollToCenter = useCallback(() => {
      if (!scrollRef.current) return;

      if (!hasRealTickSize) {
        featureLog('VIRTUAL_SKELETON', 'Skip centering - no real tickSize yet');
        return;
      }

      if (actualMidPrice > 0) {
        skeletonCenterPriceRef.current = actualMidPrice;
        setSkeletonCenterPrice(actualMidPrice);
        onSkeletonCenterChange?.(actualMidPrice);

        const targetScrollTop = CENTER_INDEX * ROW_HEIGHT - scrollRef.current.clientHeight / 2;
        const safeTarget = Math.max(0, targetScrollTop);
        const prevScrollTop = scrollRef.current.scrollTop;
        scrollRef.current.scrollTop = safeTarget;
        onScroll?.(safeTarget);

        if (onVisibleRangeChange && tickSizeNum > 0) {
          const clientHeight = scrollRef.current.clientHeight;
          const firstVisibleIndex = Math.floor(safeTarget / ROW_HEIGHT);
          const lastVisibleIndex = Math.ceil((safeTarget + clientHeight) / ROW_HEIGHT);

          const topPrice = actualMidPrice + (CENTER_INDEX - firstVisibleIndex) * tickSizeNum;
          const bottomPrice = actualMidPrice + (CENTER_INDEX - lastVisibleIndex) * tickSizeNum;

          onVisibleRangeChange({ min: bottomPrice, max: topPrice });
        }

        featureLog('VIRTUAL_SKELETON', `Centered on mid: ${actualMidPrice.toFixed(pricePrecision)}`);
      }
    }, [actualMidPrice, pricePrecision, onScroll, onSkeletonCenterChange, hasRealTickSize, tickSizeNum, onVisibleRangeChange]);

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      scrollTo: (scrollTop: number) => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollTop;
        }
      },
      scrollToCenter,
    }), [scrollToCenter]);

    const hasCenteredRef = useRef(false);
    useEffect(() => {
      if (skeletonCenterPrice > 0 && !hasCenteredRef.current && scrollRef.current) {
        hasCenteredRef.current = true;
        const targetScrollTop = Math.max(0, CENTER_INDEX * ROW_HEIGHT - scrollRef.current.clientHeight / 2);
        const prevScrollTop = scrollRef.current.scrollTop;
        scrollRef.current.scrollTop = targetScrollTop;
        onScroll?.(targetScrollTop);

        if (onVisibleRangeChange && tickSizeNum > 0) {
          const clientHeight = scrollRef.current.clientHeight;
          const firstVisibleIndex = Math.floor(targetScrollTop / ROW_HEIGHT);
          const lastVisibleIndex = Math.ceil((targetScrollTop + clientHeight) / ROW_HEIGHT);
          const topPrice = skeletonCenterPrice + (CENTER_INDEX - firstVisibleIndex) * tickSizeNum;
          const bottomPrice = skeletonCenterPrice + (CENTER_INDEX - lastVisibleIndex) * tickSizeNum;
          onVisibleRangeChange({ min: bottomPrice, max: topPrice });
        }

        featureLog('VIRTUAL_SKELETON', `Initial centering at ${skeletonCenterPrice.toFixed(pricePrecision)}, scrollTop=${targetScrollTop}`);
      }
    }, [skeletonCenterPrice, pricePrecision, onScroll, onVisibleRangeChange, tickSizeNum]);

    // Reset centering flag on symbol change
    useEffect(() => {
      hasCenteredRef.current = false;
      skeletonCenterPriceRef.current = 0;
      setSkeletonCenterPrice(0);
    }, [symbol]);

    // Cleanup timeout on unmount
    useEffect(() => {
      return () => {
        if (mouseLeaveTimeoutRef.current) {
          clearTimeout(mouseLeaveTimeoutRef.current);
        }
      };
    }, []);

    // Ref to store latest scrollToCenter
    const scrollToCenterRef = useRef<() => void>(scrollToCenter);
    useEffect(() => {
      scrollToCenterRef.current = scrollToCenter;
    }, [scrollToCenter]);

    const lastAutoScrollCheckRef = useRef<number>(0);
    const AUTO_SCROLL_THROTTLE_MS = 200;

    const checkAutoScrollTrigger = useCallback(() => {
      if (!autoScrollEnabled || isHoveringRef.current) return;
      if (!scrollRef.current) return;

      const now = Date.now();
      if (now - lastAutoScrollCheckRef.current < AUTO_SCROLL_THROTTLE_MS) {
        return;
      }
      lastAutoScrollCheckRef.current = now;

      const currentCenter = skeletonCenterPriceRef.current;
      if (currentCenter === 0) return;

      if (!hasRealTickSize) return;

      const currentScrollTop = scrollRef.current.scrollTop;
      const clientHeight = scrollRef.current.clientHeight;

      const bestBidNum = parseFloat(bestBid);
      const bestAskNum = parseFloat(bestAsk);

      if (bestBidNum <= 0 || bestAskNum <= 0 || tickSizeNum <= 0) return;

      const bestAskIndex = CENTER_INDEX + Math.round((currentCenter - bestAskNum) / tickSizeNum);
      const bestBidIndex = CENTER_INDEX + Math.round((currentCenter - bestBidNum) / tickSizeNum);

      const bestAskY = bestAskIndex * ROW_HEIGHT;
      const bestBidY = bestBidIndex * ROW_HEIGHT;

      const viewportTop = currentScrollTop;

      const topThreshold = viewportTop + clientHeight * (1 - upperThresholdPercent);
      const bottomThreshold = viewportTop + clientHeight * (1 - lowerThresholdPercent);

      const shouldAutoScroll = bestAskY < topThreshold || bestBidY > bottomThreshold;

      if (shouldAutoScroll) {
        featureLog('VIRTUAL_SKELETON', `Auto-scroll triggered: askY=${bestAskY}, bidY=${bestBidY}, viewport=[${viewportTop}, ${viewportTop + clientHeight}]`);
        scrollToCenterRef.current();
      }
    }, [autoScrollEnabled, bestBid, bestAsk, tickSizeNum, upperThresholdPercent, lowerThresholdPercent, hasRealTickSize]);

    useEffect(() => {
      checkAutoScrollTrigger();
    }, [bestBid, bestAsk, checkAutoScrollTrigger]);

    useEffect(() => {
      const handleGlobalKeyDown = (e: KeyboardEvent) => {
        if (!isHoveringRef.current) return;

        const activeElement = document.activeElement;
        if (activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA') return;

        if (e.key === 'c' || e.key === 'C' || e.key === 'с' || e.key === 'С') {
          e.preventDefault();
          featureLog('VIRTUAL_SKELETON', 'Centering on mid-price (C key)');
          scrollToCenterRef.current();
        }
      };

      window.addEventListener('keydown', handleGlobalKeyDown);
      return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, []);

    // Listen for global "center all" event
    useEffect(() => {
      const handleCenterAll = () => {
        scrollToCenterRef.current();
      };

      window.addEventListener('sclr:center-all-orderbooks', handleCenterAll);
      return () => window.removeEventListener('sclr:center-all-orderbooks', handleCenterAll);
    }, []);

    const handleMouseEnter = useCallback(() => {
      isHoveringRef.current = true;

      if (mouseLeaveTimeoutRef.current) {
        clearTimeout(mouseLeaveTimeoutRef.current);
        mouseLeaveTimeoutRef.current = null;
      }
    }, []);

    const handleMouseLeave = useCallback(() => {
      isHoveringRef.current = false;

      if (autoScrollEnabled && hasRealTickSize) {
        scrollToCenterRef.current();
      }

      userScrolledRef.current = false;
    }, [autoScrollEnabled, hasRealTickSize]);

    useEffect(() => {
      const scrollContainer = scrollRef.current;
      if (!scrollContainer) return;

      const handleWheel = () => {
        if (isHoveringRef.current) {
          userScrolledRef.current = true;
        }
      };

      scrollContainer.addEventListener('wheel', handleWheel, { passive: true });
      return () => scrollContainer.removeEventListener('wheel', handleWheel);
    }, []);

    if (!bids || !asks || skeletonCenterPrice === 0 || !hasRealTickSize) {
      return (
        <div style={LOADING_CONTAINER_STYLE}>
          <Spinner />
          <span>{t.common.loading}</span>
        </div>
      );
    }

    return (
      <div
        ref={containerRef}
        data-testid="orderbook-v2-container"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={CONTAINER_STYLE}
      >
        <div
          ref={scrollRef}
          data-orderbook-scroll
          onScroll={handleScroll}
          style={SCROLL_CONTAINER_STYLE}
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const price = indexToPrice(virtualRow.index);
              const bidQty = bids.get(price);
              const askQty = asks.get(price);

              let side: 'bid' | 'ask' | 'empty' = 'empty';
              let quantity = '0';

              if (bidQty && parseFloat(bidQty) > 0) {
                side = 'bid';
                quantity = bidQty;
              } else if (askQty && parseFloat(askQty) > 0) {
                side = 'ask';
                quantity = askQty;
              }

              const qty = parseFloat(quantity);

              let background = 'transparent';
              if (side === 'bid') {
                background = 'rgba(0, 200, 83, 0.08)';
              } else if (side === 'ask') {
                background = 'rgba(255, 23, 68, 0.08)';
              }

              const rowStyle: React.CSSProperties = {
                ...ROW_BASE_STYLE,
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
                fontSize: compact ? '9px' : '11px',
                background,
                cursor: side !== 'empty' ? 'pointer' : 'default',
              };

              const paddingRight = compact ? '4px' : '8px';
              const paddingLeft = compact ? '4px' : '8px';

              return (
                <div key={virtualRow.index} style={rowStyle}>
                  <div style={{ ...CELL_LEFT_STYLE, paddingRight }}>
                    {qty > 0 ? formatQuantity(qty) : ''}
                  </div>
                  <div style={{ ...CELL_RIGHT_STYLE, paddingLeft }}>
                    {formatPrice(price, compact)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }
);

function formatPrice(price: string, _compact = false): string {
  return price;
}

function formatQuantity(qty: number): string {
  if (qty >= 1000000) return (qty / 1000000).toFixed(2) + 'M';
  if (qty >= 1000) return (qty / 1000).toFixed(2) + 'K';
  if (qty >= 1) return qty.toFixed(2);
  return qty.toFixed(4);
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
