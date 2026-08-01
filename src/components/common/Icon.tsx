interface IconProps {
  name: IconName;
  size?: number;
  filled?: boolean;
}

export type IconName =
  | 'play'
  | 'stop'
  | 'skipback'
  | 'loop'
  | 'metronome'
  | 'record'
  | 'search'
  | 'plus'
  | 'x'
  | 'chevron-down'
  | 'chevron-up'
  | 'chevron-left'
  | 'chevron-right'
  | 'trash'
  | 'copy'
  | 'pencil'
  | 'piano'
  | 'mixer'
  | 'wave'
  | 'folder'
  | 'wrench'
  | 'dots'
  | 'grid'
  | 'note'
  | 'save'
  | 'zap'
  | 'download'
  | 'clipboard'
  | 'check'
  | 'undo'
  | 'redo'
  | 'panel-left'
  | 'panel-right'
  | 'panel-bottom'
  | 'logo';

const FILLED: Partial<Record<IconName, string>> = {
  play: 'M8 5.5v13l10.5-6.5z',
  stop: 'M7 7h10v10H7z',
  record: 'M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10z',
  search: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm5.9 9 3.6 3.6-1.4 1.4-3.6-3.6z',
};

const STROKED: Partial<Record<IconName, string>> = {
  skipback: 'M7 5v14M18 6l-8 6 8 6z',
  loop: 'M17 4l3 3-3 3M7 20l-3-3 3-3M20 7H9a5 5 0 0 0-5 5M4 17h11a5 5 0 0 0 5-5',
  metronome: 'M9 3h6l3 17H6zM12 12l5-6',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M6 15l6-6 6 6',
  'chevron-left': 'M15 6l-6 6 6 6',
  'chevron-right': 'M9 6l6 6-6 6',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  pencil: 'M4 20l4-1L20 7l-3-3L5 16zM14 6l3 3',
  piano: 'M4 5h16v14H4zM8 5v9M12 5v9M16 5v9',
  mixer: 'M6 4v16M12 4v16M18 4v16M4 9h4M10 15h4M16 7h4',
  wave: 'M3 12h2l2-6 3 12 3-9 2 5 2-2h4',
  folder: 'M3 6h6l2 2h10v11H3z',
  wrench: 'M14 7a4 4 0 0 0-5.4 5.2L4 17l3 3 4.8-4.6A4 4 0 0 0 17 10l-3-3z',
  dots: 'M6 12h.01M12 12h.01M18 12h.01',
  grid: 'M4 4h16v16H4zM4 10h16M4 15h16M10 4v16',
  note: 'M9 18V6l9-2v11M9 18a2.5 2.5 0 1 1-5 1.2A2.5 2.5 0 0 1 9 18zM18 15a2.5 2.5 0 1 1-5 1.2A2.5 2.5 0 0 1 18 15z',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  zap: 'M13 3L5 13h5l-1 8 8-10h-5z',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  clipboard: 'M9 4h6v3H9zM9 5H6v16h12V5h-3',
  check: 'M5 13l4 4L19 7',
  undo: 'M8 5L3 10l5 5M3 10h11a6 6 0 0 1 0 12h-2',
  redo: 'M16 5l5 5-5 5M21 10H10a6 6 0 0 0 0 12h2',
  'panel-left': 'M4 4h16v16H4zM9 4v16',
  'panel-right': 'M4 4h16v16H4zM15 4v16',
  'panel-bottom': 'M4 4h16v16H4zM4 14h16',
};

export function Icon({ name, size = 16 }: IconProps) {
  if (name === 'logo') {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" rx="12" fill="#1b222b" />
        <path
          d="M8 32 L16 32 L20 18 L26 46 L32 24 L38 40 L42 30 L48 32 L56 32"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="50" cy="15" r="4.5" fill="var(--warm)" />
      </svg>
    );
  }
  const filled = FILLED[name];
  const stroked = STROKED[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={filled ?? stroked ?? ''} />
    </svg>
  );
}
