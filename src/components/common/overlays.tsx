import { useEffect, useRef, useState } from 'react';
import { useUiStore } from '../../state/uiStore';

export function DialogHost() {
  const dialog = useUiStore((s) => s.dialog);
  const close = useUiStore((s) => s.closeDialog);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dialog) {
      setValue(dialog.initialValue ?? '');
      setTimeout(() => inputRef.current?.select(), 30);
    }
  }, [dialog]);

  if (!dialog) return null;
  const submit = () => {
    close();
    dialog.onSubmit(value.trim());
  };
  return (
    <div className="modal-overlay" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label={dialog.title}>
        <h3>{dialog.title}</h3>
        {dialog.message && <p>{dialog.message}</p>}
        {dialog.kind === 'prompt' && (
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && value.trim()) submit();
              if (e.key === 'Escape') close();
            }}
            aria-label={dialog.title}
          />
        )}
        <div className="modal-actions">
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button
            className={`btn ${dialog.danger ? 'danger' : 'primary'}`}
            disabled={dialog.kind === 'prompt' && !value.trim()}
            onClick={submit}
          >
            {dialog.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ContextMenuHost() {
  const menu = useUiStore((s) => s.contextMenu);
  const close = useUiStore((s) => s.closeMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menu) {
      setPos(null);
      return;
    }
    // clamp inside viewport after first render
    const el = ref.current;
    const w = el?.offsetWidth ?? 180;
    const h = el?.offsetHeight ?? 200;
    setPos({
      x: Math.min(menu.x, window.innerWidth - w - 8),
      y: Math.min(menu.y, window.innerHeight - h - 8),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const off = () => close();
    window.addEventListener('pointerdown', off, { capture: true });
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('pointerdown', off, { capture: true });
      window.removeEventListener('blur', off);
    };
  }, [menu, close]);

  if (!menu) return null;
  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{
        left: pos?.x ?? menu.x,
        top: pos?.y ?? menu.y,
        visibility: pos ? 'visible' : 'hidden',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      role="menu"
    >
      {menu.items.map((item, i) => (
        <button
          key={i}
          className={item.danger ? 'danger' : ''}
          disabled={item.disabled}
          onClick={() => {
            close();
            item.action();
          }}
          role="menuitem"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function ToastHost() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.level}`} onClick={() => dismiss(t.id)}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
