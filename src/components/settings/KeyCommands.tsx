/**
 * Key commands editor.
 *
 * Every shortcut the product has, grouped as the help sheet groups them, with
 * its current binding and a way to change it. Recording a new binding captures
 * the next key combination rather than asking anyone to type "mod+shift+e",
 * and a combination already in use is taken from whoever had it — two actions
 * on one key is never what was meant, and silently ignoring the second is
 * worse than moving the first.
 */
import { useEffect, useState } from 'react';
import { SHORTCUTS, comboLabel, comboOf, type Shortcut } from '../../app/shortcuts';
import { bindingConflicts, effectiveCombo, useKeymapStore } from '../../state/keymapStore';
import { Icon } from '../common/Icon';

const CATEGORIES = [
  'Transport',
  'Editing',
  'Selection',
  'View',
  'Project',
  'Piano roll',
  'Automation',
] as const;

function Row({
  shortcut,
  recording,
  onRecord,
}: {
  shortcut: Shortcut;
  recording: boolean;
  onRecord: (id: string | null) => void;
}) {
  const overrides = useKeymapStore((s) => s.overrides);
  const combo = overrides[shortcut.id] ?? shortcut.combo;
  const changed = combo !== shortcut.combo;

  return (
    <div className={`kc-row${recording ? ' recording' : ''}`} data-testid={`kc-${shortcut.id}`}>
      <span className="kc-desc">
        {shortcut.description}
        {shortcut.when && <span className="kc-when">{shortcut.when}</span>}
      </span>
      <button
        className={`kc-combo${changed ? ' changed' : ''}`}
        onClick={() => onRecord(recording ? null : shortcut.id)}
        title={
          recording
            ? 'Press the keys you want, or Escape to cancel'
            : `Currently ${comboLabel(combo)} — click to change`
        }
        aria-label={`${shortcut.description}: ${comboLabel(combo)}. Click to change.`}
      >
        {recording ? 'Press keys…' : comboLabel(combo)}
      </button>
      <button
        className="icon-btn"
        disabled={!changed}
        title="Back to the default binding"
        aria-label={`Reset ${shortcut.description}`}
        onClick={() => useKeymapStore.getState().clearBinding(shortcut.id)}
      >
        <Icon name="refresh" size={13} />
      </button>
    </div>
  );
}

export function KeyCommands() {
  const [recording, setRecording] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const overrides = useKeymapStore((s) => s.overrides);
  const conflicts = bindingConflicts();

  // While recording, the whole keyboard belongs to this control — including the
  // shortcuts being edited, which must not fire while they are being rebound.
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecording(null);
        return;
      }
      const combo = comboOf(e);
      if (!combo) return;
      useKeymapStore.getState().setBinding(recording, combo);
      setRecording(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording]);

  const visible = (s: Shortcut) =>
    !query ||
    s.description.toLowerCase().includes(query.toLowerCase()) ||
    comboLabel(effectiveCombo(s)).toLowerCase().includes(query.toLowerCase());

  return (
    <div className="key-commands" data-testid="key-commands">
      <div className="kc-head">
        <input
          type="search"
          value={query}
          placeholder="Search shortcuts…"
          aria-label="Search shortcuts"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="btn"
          disabled={Object.keys(overrides).length === 0}
          onClick={() => useKeymapStore.getState().resetAll()}
        >
          Reset all
        </button>
      </div>

      {conflicts.length > 0 && (
        <p className="kc-conflict">
          <Icon name="warning" size={13} />
          {conflicts.length} combination{conflicts.length === 1 ? '' : 's'} bound to more than one
          action. The last one bound wins.
        </p>
      )}

      {CATEGORIES.map((cat) => {
        const rows = SHORTCUTS.filter((s) => s.category === cat && visible(s));
        if (rows.length === 0) return null;
        return (
          <section key={cat}>
            <h4 className="t-label">{cat}</h4>
            {rows.map((s) => (
              <Row key={s.id} shortcut={s} recording={recording === s.id} onRecord={setRecording} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
