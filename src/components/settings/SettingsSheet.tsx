/**
 * Preferences.
 *
 * Themes, UI scaling, metering and time-display choices already existed in the
 * preference store and were applied to the document at boot — but nothing in
 * the product could reach them, which made them features that did not exist.
 * This is where they live.
 */
import { useEffect, useRef } from 'react';
import { engine } from '../../audio/engine';
import { DEFAULT_PREFS, usePrefsStore, type ThemeChoice } from '../../state/prefsStore';
import { useUiStore } from '../../state/uiStore';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { Icon, type IconName } from '../common/Icon';

const THEMES: { id: ThemeChoice; label: string; icon: IconName; blurb: string }[] = [
  { id: 'system', label: 'System', icon: 'settings', blurb: 'Follow the operating system' },
  { id: 'dark', label: 'Dark', icon: 'moon', blurb: 'The studio default' },
  { id: 'light', label: 'Light', icon: 'sun', blurb: 'For bright rooms' },
  { id: 'contrast', label: 'Contrast', icon: 'palette', blurb: 'Maximum legibility' },
];

const SCALES = [0.85, 0.9, 1, 1.1, 1.25, 1.4];

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="set-row">
      <div className="set-label">
        <span>{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      className={`switch${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    >
      <span className="switch-knob" />
    </button>
  );
}

export function SettingsSheet() {
  const open = useUiStore((s) => s.settingsOpen);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);
  const prefs = usePrefsStore();
  const set = usePrefsStore((s) => s.set);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useUiStore.getState().set({ settingsOpen: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="sheet-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) useUiStore.getState().set({ settingsOpen: false });
      }}
    >
      <div
        className="sheet settings-sheet"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Preferences"
        data-testid="settings-sheet"
      >
        <div className="sheet-head">
          <h2 className="t-heading">Preferences</h2>
          <button
            className="icon-btn"
            onClick={() => useUiStore.getState().set({ settingsOpen: false })}
            aria-label="Close preferences"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="sheet-body">
          <section>
            <h3 className="t-label">Appearance</h3>
            <div className="theme-grid" role="radiogroup" aria-label="Theme">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  className={`theme-card${prefs.theme === t.id ? ' on' : ''}`}
                  role="radio"
                  aria-checked={prefs.theme === t.id}
                  onClick={() => set({ theme: t.id })}
                  title={t.blurb}
                  data-testid={`theme-${t.id}`}
                >
                  <Icon name={t.icon} size={18} />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>

            <Row label="Interface scale" hint="Scales every control, panel and readout">
              <div className="seg" role="group" aria-label="Interface scale">
                {SCALES.map((s) => (
                  <button
                    key={s}
                    className={Math.abs(prefs.uiScale - s) < 0.001 ? 'on' : ''}
                    aria-pressed={Math.abs(prefs.uiScale - s) < 0.001}
                    onClick={() => set({ uiScale: s })}
                  >
                    {Math.round(s * 100)}%
                  </button>
                ))}
              </div>
            </Row>

            <Row label="Reduce motion" hint="Beyond the system setting">
              <Toggle
                on={prefs.reduceMotion}
                onChange={(v) => set({ reduceMotion: v })}
                label="Reduce motion"
              />
            </Row>
          </section>

          <section>
            <h3 className="t-label">Metering &amp; time</h3>
            <Row label="Meter reading" hint="What the channel meters emphasise">
              <div className="seg" role="group" aria-label="Meter reading">
                {(['peak', 'rms', 'lufs'] as const).map((m) => (
                  <button
                    key={m}
                    className={prefs.meterScale === m ? 'on' : ''}
                    aria-pressed={prefs.meterScale === m}
                    onClick={() => set({ meterScale: m })}
                  >
                    {m.toUpperCase()}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Meter fall" hint="Ballistics, in dB per second">
              <input
                type="range"
                min={8}
                max={60}
                step={1}
                value={prefs.meterFallDbPerSec}
                aria-label="Meter fall rate"
                onChange={(e) => set({ meterFallDbPerSec: Number(e.target.value) })}
              />
              <span className="t-num">{prefs.meterFallDbPerSec} dB/s</span>
            </Row>
            <Row label="Primary time display">
              <div className="seg" role="group" aria-label="Primary time display">
                <button
                  className={prefs.primaryTimeDisplay === 'bbt' ? 'on' : ''}
                  aria-pressed={prefs.primaryTimeDisplay === 'bbt'}
                  onClick={() => set({ primaryTimeDisplay: 'bbt' })}
                >
                  Bars
                </button>
                <button
                  className={prefs.primaryTimeDisplay === 'clock' ? 'on' : ''}
                  aria-pressed={prefs.primaryTimeDisplay === 'clock'}
                  onClick={() => set({ primaryTimeDisplay: 'clock' })}
                >
                  Clock
                </button>
              </div>
            </Row>
          </section>

          <section>
            <h3 className="t-label">Editing</h3>
            <Row label="Follow the playhead" hint="Scroll the arrangement during playback">
              <Toggle
                on={prefs.followPlayhead}
                onChange={(v) => set({ followPlayhead: v })}
                label="Follow the playhead"
              />
            </Row>
            <Row label="Confirm destructive edits" hint="Ask before deleting tracks and clips">
              <Toggle
                on={prefs.confirmDestructive}
                onChange={(v) => set({ confirmDestructive: v })}
                label="Confirm destructive edits"
              />
            </Row>
            <Row label="Always show values" hint="Instead of only on hover">
              <Toggle
                on={prefs.alwaysShowValues}
                onChange={(v) => set({ alwaysShowValues: v })}
                label="Always show values"
              />
            </Row>
          </section>

          <section>
            <h3 className="t-label">Audio</h3>
            <Row label="Engine" hint="Sample rate is chosen by the browser">
              <span className="t-num">
                {engine.context
                  ? `${(engine.context.sampleRate / 1000).toFixed(1)} kHz`
                  : 'not started'}
              </span>
            </Row>
            <Row label="Workspace">
              <button className="btn" onClick={() => useWorkspaceStore.getState().reset()}>
                Reset panel layout
              </button>
            </Row>
          </section>
        </div>

        <div className="sheet-foot">
          <button
            className="btn"
            onClick={() => usePrefsStore.getState().reset()}
            title={`Back to ${Math.round(DEFAULT_PREFS.uiScale * 100)}% scale and the system theme`}
          >
            Reset preferences
          </button>
          <span className="grow" />
          <button
            className="btn primary"
            onClick={() => useUiStore.getState().set({ settingsOpen: false })}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
