import { beforeEach, describe, expect, it } from 'vitest';
import { buildReport, collectFields } from '../src/diagnostics/report';
import { useDiagnosticsStore } from '../src/state/diagnostics';
import { useProjectStore } from '../src/state/projectStore';
import { createDemoProject } from '../src/model/demoProject';

describe('diagnostics report', () => {
  beforeEach(() => {
    useProjectStore.getState().setProject(createDemoProject(), { markClean: true });
    useDiagnosticsStore.getState().clear();
  });

  it('collects the required diagnostic fields', () => {
    const keys = collectFields().map((f) => f.key);
    for (const required of [
      'App version',
      'Git commit',
      'Build time',
      'Viewport',
      'AudioContext',
      'Transport',
      'MIDI support',
      'Project',
      'Track count',
      'Clip count',
      'IndexedDB',
    ]) {
      expect(keys).toContain(required);
    }
  });

  it('produces a plain-text report with header and project data', () => {
    const report = buildReport();
    expect(report).toContain('TXPPS MotionLab Studio');
    expect(report).toContain('Diagnostic Report');
    expect(report).toContain('MotionLab Demo');
    expect(report).toContain('=== end of report ===');
    // plain text only — no HTML tags
    expect(report).not.toMatch(/<[a-z]+>/i);
  });

  it('includes warnings and errors from the log', () => {
    useDiagnosticsStore.getState().log('warn', 'a test warning');
    useDiagnosticsStore.getState().log('error', 'a test error');
    const report = buildReport();
    expect(report).toContain('a test warning');
    expect(report).toContain('a test error');
  });

  it('caps the log at a bounded size', () => {
    for (let i = 0; i < 500; i++) useDiagnosticsStore.getState().log('info', `entry ${i}`);
    expect(useDiagnosticsStore.getState().entries.length).toBeLessThanOrEqual(200);
  });
});
