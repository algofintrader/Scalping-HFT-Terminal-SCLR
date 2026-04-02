/**
 * Debug utilities for development logging
 * Logs are stripped in production builds
 */

const IS_DEV = import.meta.env.DEV;

/**
 * Debug log - only prints in development mode
 */
export function debugLog(...args: unknown[]): void {
  if (IS_DEV) {
    console.log(...args);
  }
}

/**
 * Debug warn - only prints in development mode
 */
export function debugWarn(...args: unknown[]): void {
  if (IS_DEV) {
    console.warn(...args);
  }
}

/**
 * Debug error - always prints (errors are important)
 */
export function debugError(...args: unknown[]): void {
  console.error(...args);
}

/**
 * Conditional debug logging for specific features
 */
export const DEBUG_FLAGS = {
  SLIDING_WINDOW: IS_DEV,  // Scroll and sliding window logs
  CENTER_KEY: IS_DEV,      // C key for centering
  AUTOSCROLL: IS_DEV,      // Auto-scroll logs
  WS_MESSAGES: false,      // WebSocket messages (very verbose)
  STORE_UPDATES: false,    // Store updates (very verbose)
  VIRTUAL_SKELETON: IS_DEV, // V2: Virtual skeleton logs
} as const;

/**
 * Feature-specific debug log
 */
export function featureLog(feature: keyof typeof DEBUG_FLAGS, ...args: unknown[]): void {
  if (DEBUG_FLAGS[feature]) {
    console.log(`[${feature}]`, ...args);
  }
}
