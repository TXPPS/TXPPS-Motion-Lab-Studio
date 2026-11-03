import { describe, expect, it } from 'vitest';
import { CONTROL_CSS } from '../render/controlCss';
import { PANEL_CSS } from '../render/panelCss';

describe('phone control visual foundation', () => {
  it('never redefines a dial size custom property in terms of itself', () => {
    // Such a definition is a CSS variable cycle: mobile Chrome/WebKit discard
    // the entire custom property and collapse every unit-specific dial size.
    expect(CONTROL_CSS).not.toMatch(
      /--mw-ctl-size\s*:\s*max\([^;]*var\(--mw-ctl-size/,
    );
    expect(CONTROL_CSS).toContain(
      '.mw-panel .mw-ctl-art { width: max(3.75rem, var(--mw-ctl-size, 3.5rem)); }',
    );
  });

  it('uses readable control labels and numeric readouts, not 10px captions', () => {
    expect(CONTROL_CSS).toContain('font-size: var(--mw-text-xs);');
    expect(CONTROL_CSS).toContain('font-size: var(--mw-text-sm);');
    expect(CONTROL_CSS).toContain('font-variant-numeric: tabular-nums;');
  });

  it('keeps rotary diameter and grid columns aligned in narrow strips', () => {
    expect(PANEL_CSS).toContain(
      "[data-mw-arrangement='strip'] { --mw-ctl-size: 3.75rem; --mw-ctl-min: 4.75rem; }",
    );
    expect(PANEL_CSS).toContain(
      "[data-mw-arrangement='console'] { --mw-ctl-size: 3.5rem; --mw-ctl-min: 4.5rem; }",
    );
  });
});
