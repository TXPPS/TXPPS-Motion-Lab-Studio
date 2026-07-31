import { useEffect, useState } from 'react';
import { engine } from '../../audio/engine';
import { midi } from '../../audio/midi';
import { useDiagnosticsStore } from '../../state/diagnostics';
import { useTransportStore } from '../../state/transportStore';
import {
  buildReport,
  collectFields,
  refreshStorageDiagnostics,
  runSmokeTest,
} from '../../diagnostics/report';
import { Icon } from '../common/Icon';
import { RecoveryPanel } from '../recording/RecoveryPanel';

export function DiagnosticsPanel() {
  const entries = useDiagnosticsStore((s) => s.entries);
  const smokeStatus = useDiagnosticsStore((s) => s.smokeStatus);
  const smokeResults = useDiagnosticsStore((s) => s.smokeResults);
  const clear = useDiagnosticsStore((s) => s.clear);
  // re-render periodically so live fields (sources, viewport) stay fresh
  const [, force] = useState(0);
  useTransportStore((s) => s.activeSources);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  // Storage figures need async reads, so they are sampled when the panel opens
  // and on a slow interval rather than on every render.
  useEffect(() => {
    void refreshStorageDiagnostics();
    const id = setInterval(() => void refreshStorageDiagnostics(), 10000);
    return () => clearInterval(id);
  }, []);

  const fields = collectFields();
  const warnings = entries.filter((e) => e.level === 'warn');
  const errors = entries.filter((e) => e.level === 'error');

  const copyReport = async () => {
    const text = buildReport();
    try {
      await navigator.clipboard.writeText(text);
      useDiagnosticsStore.getState().log('info', 'Diagnostic report copied to clipboard');
    } catch {
      // Fallback for browsers/contexts without clipboard permission
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {}
      document.body.removeChild(ta);
    }
  };

  const downloadReport = () => {
    const blob = new Blob([buildReport()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `motionlab-diagnostics-${Date.now()}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="diag" data-testid="diagnostics-panel">
      <div className="diag-actions">
        <button className="btn primary" onClick={copyReport} data-testid="copy-report">
          <Icon name="clipboard" size={13} /> Copy Report
        </button>
        <button className="btn" onClick={downloadReport} data-testid="download-report">
          <Icon name="download" size={13} /> Download
        </button>
        <button
          className="btn"
          onClick={() => void runSmokeTest()}
          disabled={smokeStatus === 'running'}
          data-testid="run-smoke"
        >
          <Icon name="check" size={13} />{' '}
          {smokeStatus === 'running' ? 'Running…' : 'Run Smoke Test'}
        </button>
        <button className="btn" onClick={clear} data-testid="clear-log">
          Clear Log
        </button>
        <button
          className="btn danger"
          onClick={() => {
            engine.panic();
            midi.panic();
          }}
          data-testid="panic"
        >
          <Icon name="zap" size={13} /> Panic Audio
        </button>
      </div>
      <div className="diag-scroll">
        <RecoveryPanel />
        <div className="diag-grid">
          {fields.map((f) => (
            <div className="diag-kv" key={f.key}>
              <span className="k">{f.key}</span>
              <span className={`v ${f.status ?? ''}`} title={f.value} data-testid={`diag-${f.key}`}>
                {f.value}
              </span>
            </div>
          ))}
        </div>

        {smokeResults.length > 0 && (
          <>
            <div className="ps-title" style={{ marginBottom: 4 }}>
              Smoke test — {smokeStatus}
            </div>
            <div className="smoke-results" data-testid="smoke-results">
              {smokeResults.map((r, i) => (
                <div className="row" key={i}>
                  <span className={`badge ${r.pass ? 'pass' : 'fail'}`}>
                    {r.pass ? 'PASS' : 'FAIL'}
                  </span>
                  <span>
                    {r.name}
                    {r.detail ? <span className="hint"> — {r.detail}</span> : ''}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="ps-title" style={{ marginBottom: 4 }}>
          Log — {warnings.length} warnings, {errors.length} errors
        </div>
        <div className="diag-log" data-testid="diag-log">
          {entries.length === 0 && <div className="hint">No log entries.</div>}
          {entries
            .slice()
            .reverse()
            .slice(0, 80)
            .map((e, i) => (
              <div className={`row ${e.level}`} key={i}>
                <span className="t">{new Date(e.time).toLocaleTimeString()}</span>
                <span className="m">{e.message}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
