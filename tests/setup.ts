import 'fake-indexeddb/auto';

// jsdom lacks structuredClone in some versions
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = (v: unknown) => JSON.parse(JSON.stringify(v));
}
