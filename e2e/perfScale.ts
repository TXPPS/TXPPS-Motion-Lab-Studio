/**
 * Millisecond budgets in these suites are calibrated against Chromium on
 * this CI's software rasterizer. Firefox and especially WebKit-GTK run the
 * same work slower in this container (different JS engines, no GPU), which
 * says nothing about retail Safari/Firefox on real hardware — so timing
 * budgets scale rather than silently skipping the tests. DOM-bound counts
 * (windowing caps) stay unscaled: they are engine-independent guarantees.
 */
export const PERF_SCALE =
  process.env.E2E_BROWSER && process.env.E2E_BROWSER !== 'chromium' ? 3 : 1;
