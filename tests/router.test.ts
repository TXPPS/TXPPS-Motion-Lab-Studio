import { describe, expect, it } from 'vitest';
import { buildHash, parseHash, QA_FIXTURES } from '../src/app/router';

describe('hash routing', () => {
  it('defaults to the song page', () => {
    expect(parseHash('')).toMatchObject({ page: 'song', fixture: null });
    expect(parseHash('#/')).toMatchObject({ page: 'song' });
    expect(parseHash('#/song')).toMatchObject({ page: 'song' });
  });

  it('resolves every documented page alias', () => {
    expect(parseHash('#/start').page).toBe('start');
    expect(parseHash('#/home').page).toBe('start');
    expect(parseHash('#/mastering').page).toBe('mastering');
    expect(parseHash('#/project').page).toBe('mastering');
    expect(parseHash('#/show').page).toBe('show');
  });

  it('keeps every legacy QA route working, longest id first', () => {
    for (const f of QA_FIXTURES) {
      const r = parseHash(`#/${f}`);
      expect(r.fixture).toBe(f);
      expect(r.debugOverlay).toBe(true);
      expect(r.page).toBe('song');
    }
    // The old ordering bug: `qa-audio-edit` must not resolve to `qa-audio`,
    // and `qa-max` must not resolve to `qa`.
    expect(parseHash('#/qa-audio-edit').fixture).toBe('qa-audio-edit');
    expect(parseHash('#/qa-max').fixture).toBe('qa-max');
    expect(parseHash('#/qa').fixture).toBe('qa');
  });

  it('keeps the legacy single-word flag hashes', () => {
    expect(parseHash('#/phone').forcePhone).toBe(true);
    expect(parseHash('#/diagnostics').openDiagnostics).toBe(true);
    expect(parseHash('#/demo').reseedDemo).toBe(true);
    expect(parseHash('#/debug').debugOverlay).toBe(true);
  });

  it('reads flags from the query form and combines them with a page', () => {
    const r = parseHash('#/mastering?phone&diagnostics');
    expect(r).toMatchObject({ page: 'mastering', forcePhone: true, openDiagnostics: true });
  });

  it('round-trips through buildHash', () => {
    for (const hash of ['#/start', '#/mastering', '#/show', '#/song/qa-huge']) {
      const parsed = parseHash(hash);
      expect(parseHash(buildHash(parsed))).toMatchObject({
        page: parsed.page,
        fixture: parsed.fixture,
      });
    }
    expect(buildHash({ page: 'start' })).toBe('#/start');
    expect(buildHash({ page: 'song', fixture: 'qa-midi' })).toBe('#/song/qa-midi');
  });

  it('ignores unknown tokens rather than failing', () => {
    expect(parseHash('#/nonsense/more').page).toBe('song');
  });
});
