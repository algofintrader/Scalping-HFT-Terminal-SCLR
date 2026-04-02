/**
 * SCLR V2 Smoke Test
 *
 * Console script for basic V2 functionality check.
 *
 * Usage:
 * 1. Open the app in browser
 * 2. Wait 3-5 seconds for loading
 * 3. Open DevTools → Console
 * 4. Paste this script and press Enter
 */

(async function smokeTestV2() {
  console.log('\n%c SCLR V2 Smoke Test ', 'background: #333; color: #0f0; font-size: 14px; padding: 4px 8px;');
  console.log('─'.repeat(50));

  // V2 constants
  const CENTER_INDEX = 2500;
  const ROW_HEIGHT = 20;
  const EXPECTED_SCROLL_TOP = CENTER_INDEX * ROW_HEIGHT; // 50000
  const SCROLL_TOLERANCE = ROW_HEIGHT * 50; // 1000px tolerance

  const results = [];

  // Helper: add result
  function addResult(name, passed, details = '') {
    results.push({
      '#': results.length + 1,
      'Check': name,
      'Status': passed ? '✅' : '❌',
      'Details': details
    });
  }

  // Helper: get store state
  function getMarketDataState() {
    if (typeof window.__marketDataStore === 'undefined') {
      return null;
    }
    return window.__marketDataStore.getState();
  }

  function getUIPreferencesState() {
    if (typeof window.__uiPreferencesStore === 'undefined') {
      return null;
    }
    return window.__uiPreferencesStore.getState();
  }

  function getRenderLoopStats() {
    if (typeof window.__renderLoop === 'undefined') {
      return null;
    }
    return window.__renderLoop.getStats();
  }

  // ─────────────────────────────────────────────────────────────
  // Check 1: Order books centered on start
  // ─────────────────────────────────────────────────────────────
  const orderbooks = document.querySelectorAll('[data-orderbook-scroll]');
  if (orderbooks.length === 0) {
    // Try finding by class or structure
    const scrollContainers = document.querySelectorAll('.orderbook-scroll, [class*="scroll"]');
    addResult(
      'Order books centered',
      false,
      `Scroll containers not found (data-orderbook-scroll). Found ${scrollContainers.length} others.`
    );
  } else {
    let allCentered = true;
    const scrollDetails = [];

    orderbooks.forEach((ob, i) => {
      const scrollTop = ob.scrollTop;
      const diff = Math.abs(scrollTop - EXPECTED_SCROLL_TOP);
      const isCentered = diff <= SCROLL_TOLERANCE;

      if (!isCentered) allCentered = false;
      scrollDetails.push(`OB${i + 1}: ${scrollTop}px (diff: ${diff}px)`);
    });

    addResult(
      'Order books centered',
      allCentered,
      scrollDetails.join(', ') + ` | Expected: ~${EXPECTED_SCROLL_TOP}px`
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Check 2: Chart displays ticks
  // ─────────────────────────────────────────────────────────────
  const state = getMarketDataState();
  if (!state) {
    addResult('Ticks in chart', false, '__marketDataStore not found');
  } else {
    const symbols = Object.keys(state.symbols);
    let totalTicks = 0;
    const ticksPerSymbol = [];

    for (const symbol of symbols) {
      const ticks = state.symbols[symbol]?.ticks ?? [];
      totalTicks += ticks.length;
      ticksPerSymbol.push(`${symbol}: ${ticks.length}`);
    }

    addResult(
      'Ticks in chart',
      totalTicks > 0,
      `Total: ${totalTicks} | ${ticksPerSymbol.join(', ')}`
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Check 3: Clusters updating
  // ─────────────────────────────────────────────────────────────
  if (!state) {
    addResult('Clusters updating', false, '__marketDataStore not found');
  } else {
    const symbols = Object.keys(state.symbols);
    let allHaveClusters = true;
    const clusterDetails = [];

    for (const symbol of symbols) {
      const clusters = state.symbols[symbol]?.clusters;
      const revision = clusters?.revision ?? 0;
      const columnsCount = clusters?.columns?.length ?? 0;

      if (revision === 0) allHaveClusters = false;
      clusterDetails.push(`${symbol}: rev=${revision}, cols=${columnsCount}`);
    }

    addResult(
      'Clusters updating',
      allHaveClusters && symbols.length > 0,
      clusterDetails.join(', ')
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Check 4: Order books updating (revision growing)
  // ─────────────────────────────────────────────────────────────
  if (!state) {
    addResult('Order books updating', false, '__marketDataStore not found');
  } else {
    const symbols = Object.keys(state.symbols);
    const revisionsBefore = {};

    for (const symbol of symbols) {
      revisionsBefore[symbol] = state.symbols[symbol]?.orderbookV2?.revision ?? 0;
    }

    // Wait 500ms and check growth
    await new Promise(resolve => setTimeout(resolve, 500));

    const stateAfter = getMarketDataState();
    let allUpdating = true;
    const updateDetails = [];

    for (const symbol of symbols) {
      const revBefore = revisionsBefore[symbol];
      const revAfter = stateAfter.symbols[symbol]?.orderbookV2?.revision ?? 0;
      const grew = revAfter > revBefore;

      if (!grew && revBefore > 0) allUpdating = false;
      updateDetails.push(`${symbol}: ${revBefore}→${revAfter}`);
    }

    addResult(
      'Order books updating',
      allUpdating && symbols.length > 0,
      updateDetails.join(', ')
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Check 5: No freezes (FPS > 30)
  // ─────────────────────────────────────────────────────────────
  const renderStats = getRenderLoopStats();
  if (!renderStats) {
    addResult('FPS > 30', false, '__renderLoop not found');
  } else {
    const fps = renderStats.fps;
    addResult(
      'FPS > 30',
      fps > 30,
      `FPS: ${fps}, avgFlushTime: ${renderStats.avgFlushTime}ms`
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Check 6: AUTO enabled
  // ─────────────────────────────────────────────────────────────
  const uiState = getUIPreferencesState();
  if (!uiState) {
    addResult('AUTO enabled', false, '__uiPreferencesStore not found');
  } else {
    const autoEnabled = uiState.autoScrollEnabled;
    addResult(
      'AUTO enabled',
      autoEnabled === true,
      `autoScrollEnabled: ${autoEnabled}`
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Output results
  // ─────────────────────────────────────────────────────────────
  console.log('\n');
  console.table(results);

  const passed = results.filter(r => r['Status'] === '✅').length;
  const total = results.length;
  const allPassed = passed === total;

  console.log('─'.repeat(50));
  console.log(
    `%c ${allPassed ? '✅ ALL CHECKS PASSED' : `⚠️ PASSED ${passed}/${total}`} `,
    `background: ${allPassed ? '#0a0' : '#f80'}; color: #fff; font-size: 14px; padding: 4px 8px;`
  );

  if (!allPassed) {
    console.log('\nFailed checks:');
    results.filter(r => r['Status'] === '❌').forEach(r => {
      console.log(`  ❌ ${r['Check']}: ${r['Details']}`);
    });
  }

  return { passed, total, allPassed, results };
})();
