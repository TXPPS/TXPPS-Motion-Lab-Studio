import { useState } from 'react';
import {
  checkMissingMedia,
  deleteUnusedMedia,
  findUnusedMedia,
  checkRecorderSupport,
  checkWaveformPath,
  runExportSmokeTest,
  runInputMonitorSmokeTest,
  runMediaStorageSmokeTest,
  stopAllMediaStreams,
  testMicPermission,
  type CommandResult,
} from '../../diagnostics/commands';
import { diagLog } from '../../state/diagnostics';

interface Command {
  id: string;
  label: string;
  /** Commands that prompt or open hardware are marked so they read as deliberate. */
  gated?: boolean;
  run: () => CommandResult | Promise<CommandResult>;
}

const COMMANDS: Command[] = [
  { id: 'mic', label: 'Test microphone permission', gated: true, run: testMicPermission },
  { id: 'monitor', label: 'Input monitor smoke test', gated: true, run: runInputMonitorSmokeTest },
  { id: 'storage', label: 'Media storage smoke test', run: runMediaStorageSmokeTest },
  { id: 'export', label: 'Export smoke test', run: runExportSmokeTest },
  { id: 'missing', label: 'Check missing media', run: checkMissingMedia },
  { id: 'unused', label: 'Find unused media', run: findUnusedMedia },
  { id: 'prune', label: 'Delete unused media', run: deleteUnusedMedia },
  { id: 'recorder', label: 'Check recorder support', run: checkRecorderSupport },
  { id: 'waveform', label: 'Check waveform path', run: checkWaveformPath },
  { id: 'streams', label: 'Stop all media streams', run: stopAllMediaStreams },
];

/**
 * One-shot checks a user can run when something is wrong. Results stay on
 * screen and are written to the diagnostic log, so they end up in the copyable
 * report rather than only in the moment.
 */
export function DiagnosticCommands() {
  const [results, setResults] = useState<Record<string, CommandResult>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (cmd: Command) => {
    setBusy(cmd.id);
    try {
      const res = await cmd.run();
      setResults((r) => ({ ...r, [cmd.id]: res }));
      diagLog(res.ok ? 'info' : 'warn', `${res.title}: ${res.detail}`);
    } catch (e) {
      const res: CommandResult = {
        ok: false,
        title: cmd.label,
        detail: `Threw: ${e instanceof Error ? e.message : String(e)}`,
      };
      setResults((r) => ({ ...r, [cmd.id]: res }));
      diagLog('error', `${res.title}: ${res.detail}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="diag-commands" data-testid="diag-commands">
      <div className="ps-title">Checks</div>
      <div className="dc-grid">
        {COMMANDS.map((c) => (
          <button
            key={c.id}
            className="btn"
            disabled={busy !== null}
            data-testid={`diag-cmd-${c.id}`}
            onClick={() => void run(c)}
            title={c.gated ? 'Opens the microphone — runs only when you click' : undefined}
          >
            {busy === c.id ? 'Running…' : c.label}
          </button>
        ))}
      </div>
      {Object.entries(results).map(([id, r]) => (
        <div
          className={`dc-result${r.ok ? ' ok' : ' bad'}`}
          key={id}
          data-testid={`diag-res-${id}`}
        >
          <span className="dc-flag">{r.ok ? 'PASS' : 'FAIL'}</span>
          <span className="dc-title">{r.title}</span>
          <span className="dc-detail">{r.detail}</span>
        </div>
      ))}
    </div>
  );
}
