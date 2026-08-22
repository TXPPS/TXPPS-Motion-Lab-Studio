import { test, expect } from '@playwright/test';

/**
 * Nothing may throw on the way in.
 *
 * A React update loop, an unstable store selector or a missing guard shows up
 * as a page error long before anybody notices the symptom, and the symptom in
 * this product is a blank workspace. Every page, in every theme, at two window
 * shapes, has to boot clean — this suite exists because exactly that class of
 * bug once shipped past a green test run.
 */
const PAGES = ['#/song', '#/start', '#/mastering', '#/show'] as const;
const THEMES = ['dark', 'light', 'contrast'] as const;

/** Warnings the browser itself emits that say nothing about this app. */
const BENIGN = [
  /favicon/i,
  /Download the React DevTools/i,
  /AudioContext was not allowed to start/i,
  /The AudioContext was not allowed/i,
  /Autoplay/i,
];

for (const theme of THEMES) {
  for (const page of PAGES) {
    test(`${page} boots clean in the ${theme} theme`, async ({ page: p }) => {
      const problems: string[] = [];
      p.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      p.on('console', (m) => {
        if (m.type() !== 'error' && m.type() !== 'warning') return;
        const text = m.text();
        if (BENIGN.some((re) => re.test(text))) return;
        problems.push(`${m.type()}: ${text.slice(0, 200)}`);
      });

      await p.addInitScript((t) => {
        try {
          localStorage.setItem('motionlab.prefs.v1', JSON.stringify({ theme: t, uiScale: 1 }));
        } catch {
          /* storage disabled in this context */
        }
      }, theme);

      await p.setViewportSize({ width: 1440, height: 900 });
      await p.goto(`/${page}`);
      await p.waitForSelector('[data-testid="app-root"]');
      await p.waitForTimeout(1400);

      // A short window is where height-dependent layout loops show up.
      await p.setViewportSize({ width: 1024, height: 620 });
      await p.waitForTimeout(900);

      expect(problems, `${page} @ ${theme}: ${problems.join(' | ')}`).toEqual([]);
    });
  }
}
