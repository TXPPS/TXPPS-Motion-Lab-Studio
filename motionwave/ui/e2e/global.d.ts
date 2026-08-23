/** What the panel harness exposes for the browser cells to measure. */
interface MwPanelHarness {
  panel: { root: HTMLElement; paint(frame: ReadonlyMap<string, number>): void };
  breakpointsEm: readonly number[];
  minWidthRem: number;
  start(): Promise<void>;
  stopEngine(): Promise<void>;
  paints(): number;
  reads(): number;
  torn(): number;
  lastFrame(): Record<string, number>;
}

interface Window {
  __mwPanel: MwPanelHarness;
}
