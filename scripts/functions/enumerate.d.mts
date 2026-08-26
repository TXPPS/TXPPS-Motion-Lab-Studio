/**
 * Types for the Function Ledger's enumeration, so a TypeScript test can read
 * the same denominator the generator does.
 *
 * Written by hand rather than generated because the module is three exported
 * functions and a shape; the alternative was a second enumeration in TypeScript
 * for the sweep to use, which is how the ledger and the soak came to disagree
 * in the first place.
 */
export interface LedgerRow {
  id: string;
  surface: string;
  kind: 'action' | 'store' | 'shortcut' | 'effect' | 'instrument' | 'surface';
  key?: string;
}

export function enumerate(): LedgerRow[];
export function undrivenBy(driven: Set<string>): Map<string, string[]>;
