import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useUiStore, type ContextMenuState, type Toast } from '../../state/uiStore';

export function DialogHost() {
  const dialog = useUiStore((s) => s.dialog);
  const close = useUiStore((s) => s.closeDialog);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // A confirm dialog has no input to fall back on, so without this a "Delete
  // track?" moved focus nowhere and the keyboard stayed on the page behind it.
  useFocusTrap(panelRef, !!dialog);

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
      <div
        className="modal"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={dialog.title}
      >
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
  const returnTo = useRef<HTMLElement | null>(null);
  const focusedFor = useRef<ContextMenuState | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  /** The items a keyboard can actually land on, in the order they are read. */
  const choosable = useCallback(
    () => [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])],
    [],
  );

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
    returnTo.current = document.activeElement as HTMLElement | null;
    return () => {
      // Hand focus back to the object the menu was opened on, so choosing an
      // item — or pressing Escape — leaves the keyboard where it started
      // rather than at the top of the document.
      const back = returnTo.current;
      returnTo.current = null;
      focusedFor.current = null;
      back?.focus?.();
    };
  }, [menu]);

  // Focus waits for the clamped position: until `pos` lands the menu is still
  // `visibility: hidden`, and a hidden element cannot take focus.
  useEffect(() => {
    if (!menu || !pos || focusedFor.current === menu) return;
    focusedFor.current = menu;
    choosable()[0]?.focus();
  }, [menu, pos, choosable]);

  useEffect(() => {
    if (!menu) return;
    // Capture phase so app surfaces that stopPropagation cannot keep a stale
    // menu open — but a press INSIDE the menu must not close it, or the menu
    // unmounts between pointerdown and pointerup and the item's click never
    // fires. That exact bug made every menu action dead to a real mouse press
    // until the first e2e test actually clicked one.
    const off = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      close();
    };
    window.addEventListener('pointerdown', off, { capture: true });
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('pointerdown', off, { capture: true });
      window.removeEventListener('blur', off);
    };
  }, [menu, close]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // The global Escape ladder would otherwise keep going past the menu and
      // clear the selection the menu is about to act on.
      e.stopPropagation();
      close();
      return;
    }
    const list = choosable();
    if (list.length === 0) return;
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    let next: HTMLButtonElement | undefined;
    if (e.key === 'ArrowDown') next = list[(at + 1) % list.length];
    else if (e.key === 'ArrowUp')
      next = list[at < 0 ? list.length - 1 : (at - 1 + list.length) % list.length];
    else if (e.key === 'Home') next = list[0];
    else if (e.key === 'End') next = list[list.length - 1];
    else return;
    e.preventDefault();
    next?.focus();
  };

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
      onKeyDown={onKeyDown}
      role="menu"
      aria-orientation="vertical"
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
          data-testid={item.testId}
          // Arrow keys move between items; Tab is not how you walk a menu.
          tabIndex={-1}
        >
          <span className="mi-label">{item.label}</span>
          {item.shortcut && <span className="mi-key">{item.shortcut}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Toasts are the whole feedback channel — a save, a failed import and a
 * refused edit all arrive here and nowhere else — so they are announced.
 *
 * Two regions rather than one: notices queue politely behind whatever is being
 * read, while an error interrupts, because a failure the user never hears is a
 * failure they act on. Both regions stay mounted even when empty; a live region
 * added to the page at the same moment as its text is announced unreliably.
 *
 * The stack lives in the inline styles below rather than in `.toasts` so the
 * two regions read as one column, matching what the CSS drew when there was
 * only one container.
 */
const TOAST_REGION: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 7 };

export function ToastHost() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  const notices = toasts.filter((t) => t.level !== 'error');
  const errors = toasts.filter((t) => t.level === 'error');

  const item = (t: Toast) => (
    <button
      key={t.id}
      type="button"
      className={`toast ${t.level}`}
      style={{ textAlign: 'left' }}
      onClick={() => dismiss(t.id)}
      aria-label={`${t.message}. Dismiss`}
    >
      {t.message}
    </button>
  );

  return (
    <div className="toasts" style={{ gap: 0 }}>
      <div style={TOAST_REGION} role="status" aria-live="polite" aria-atomic="false">
        {notices.map(item)}
      </div>
      <div
        style={{ ...TOAST_REGION, marginTop: notices.length > 0 && errors.length > 0 ? 7 : 0 }}
        role="alert"
        aria-atomic="false"
      >
        {errors.map(item)}
      </div>
    </div>
  );
}
