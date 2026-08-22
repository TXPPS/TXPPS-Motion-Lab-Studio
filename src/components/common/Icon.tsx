/**
 * Icon set.
 *
 * One inline SVG sprite drawn on a 24×24 grid, 1.8px strokes, round caps —
 * so every glyph in the product reads as one family at 14-20px. Filled glyphs
 * are used only where a solid shape is the meaning (play, record, stop);
 * everything else is stroked so it stays legible at small sizes on a dark
 * surface.
 *
 * No icon font, no sprite fetch: icons are part of the bundle and paint on the
 * first frame, which matters for a tool that opens straight into dense chrome.
 */

interface IconProps {
  name: IconName;
  size?: number;
  /** Override the stroke weight for oversized or hairline placements. */
  weight?: number;
  className?: string;
}

export type IconName =
  // transport
  | 'play'
  | 'pause'
  | 'stop'
  | 'record'
  | 'skipback'
  | 'skipforward'
  | 'rewind'
  | 'forward'
  | 'loop'
  | 'loop-one'
  | 'metronome'
  | 'punch'
  | 'countin'
  // tools
  | 'cursor'
  | 'range'
  | 'scissors'
  | 'eraser'
  | 'pencil'
  | 'paint'
  | 'mute-tool'
  | 'bend'
  | 'listen'
  | 'zoom-in'
  | 'zoom-out'
  | 'hand'
  | 'magnet'
  | 'slip'
  // structure
  | 'marker'
  | 'section'
  | 'chord'
  | 'tempo'
  | 'signature'
  | 'folder'
  | 'folder-open'
  | 'vca'
  | 'group'
  | 'layers'
  | 'scratchpad'
  // channel
  | 'mixer'
  | 'fader'
  | 'knob'
  | 'eq'
  | 'compressor'
  | 'insert'
  | 'send'
  | 'automation'
  | 'solo'
  | 'speaker'
  | 'speaker-off'
  | 'headphones'
  | 'mic'
  | 'input'
  | 'output'
  | 'phase'
  | 'mono'
  | 'sidechain'
  | 'meter'
  | 'analyser'
  | 'tuner'
  // content
  | 'wave'
  | 'piano'
  | 'grid'
  | 'note'
  | 'drum'
  | 'guitar'
  | 'sampler'
  | 'synth'
  | 'score'
  | 'stem'
  | 'sparkle'
  | 'wand'
  // files + data
  | 'save'
  | 'download'
  | 'upload'
  | 'file-audio'
  | 'file-midi'
  | 'cloud'
  | 'database'
  | 'clipboard'
  | 'copy'
  | 'trash'
  | 'search'
  | 'star'
  | 'clock'
  | 'tag'
  // chrome
  | 'plus'
  | 'minus'
  | 'x'
  | 'check'
  | 'chevron-down'
  | 'chevron-up'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevrons-left'
  | 'chevrons-right'
  | 'arrow-up'
  | 'arrow-down'
  | 'dots'
  | 'dots-v'
  | 'undo'
  | 'redo'
  | 'settings'
  | 'sliders'
  | 'wrench'
  | 'help'
  | 'info'
  | 'warning'
  | 'lock'
  | 'unlock'
  | 'link'
  | 'unlink'
  | 'refresh'
  | 'power'
  | 'external'
  | 'home'
  | 'book'
  | 'panel-left'
  | 'panel-right'
  | 'panel-bottom'
  | 'maximize'
  | 'restore'
  | 'zap'
  | 'palette'
  | 'sun'
  | 'moon'
  | 'keyboard'
  | 'logo';

/** Solid glyphs: the shape itself carries the meaning. */
const FILLED: Partial<Record<IconName, string>> = {
  play: 'M8 5.5v13l10.5-6.5z',
  pause: 'M8 6h3v12H8zM13 6h3v12h-3z',
  stop: 'M7 7h10v10H7z',
  record: 'M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10z',
  search:
    'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm5.9 9 3.6 3.6-1.4 1.4-3.6-3.6z',
  cursor: 'M6 3l12 9.2-5.3.8 3 5.6-2.3 1.2-3-5.7-3.7 3.9z',
  scissors:
    'M7 5a3 3 0 1 1-.4 5.97L9.4 12l-2.8 1.03A3 3 0 1 1 7 19a3 3 0 0 1 2.5-4.65L12 13.4l6.7 2.46-.7 1.88L12.6 15l.06.16A3 3 0 0 1 7 19m0-12a1.4 1.4 0 1 0 0 2.8A1.4 1.4 0 0 0 7 7zm0 8.2a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zM18 6.7l.7 1.87L12 11l-1.6-.6z',
  eraser:
    'M15.4 4.6a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 18H7.6l-3-3a2 2 0 0 1 0-2.8zM9.8 8.4l-3.8 3.8 2.4 2.4h2.8l3-3z',
  'speaker-off':
    'M4 9h3.5L12 5v14l-4.5-4H4zm12.2-.7 1.4 1.4-1.8 1.8 1.8 1.8-1.4 1.4-1.8-1.8-1.8 1.8-1.4-1.4 1.8-1.8-1.8-1.8 1.4-1.4 1.8 1.8z',
  speaker: 'M4 9h3.5L12 5v14l-4.5-4H4z',
  marker: 'M6 3h11l-2.2 3.2L17 9.5H6v11H4V3z',
  star: 'M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z',
  'mute-tool': 'M4 9h3.5L12 5v14l-4.5-4H4zm11.5 1.3 1.4-1.4 4.2 4.2-1.4 1.4z',
  sparkle:
    'M12 2.5l1.7 4.6 4.6 1.7-4.6 1.7L12 15.1l-1.7-4.6-4.6-1.7 4.6-1.7zM19 14l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9zM5.5 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8L3 17l1.8-.7z',
};

/** Stroked glyphs: consistent 24×24 geometry, 1.8px, round joins. */
const STROKED: Partial<Record<IconName, string>> = {
  // transport
  skipback: 'M7 5v14M18 6l-8 6 8 6z',
  skipforward: 'M17 5v14M6 6l8 6-8 6z',
  rewind: 'M11 6l-7 6 7 6zM20 6l-7 6 7 6z',
  forward: 'M13 6l7 6-7 6zM4 6l7 6-7 6z',
  loop: 'M17 4l3 3-3 3M7 20l-3-3 3-3M20 7H9a5 5 0 0 0-5 5M4 17h11a5 5 0 0 0 5-5',
  'loop-one': 'M17 4l3 3-3 3M7 20l-3-3 3-3M20 7H9a5 5 0 0 0-5 5M4 17h11a5 5 0 0 0 5-5M12 10.5l1.5-1v5',
  metronome: 'M9 3h6l3 17H6zM12 12l5-6',
  punch: 'M4 12h4M16 12h4M12 4v4M12 16v4M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z',
  countin: 'M5 12h3M11 7v10M16 9v6M20 11v2',
  // tools
  range: 'M5 5v14M19 5v14M8 12h8M8 12l2-2M8 12l2 2M16 12l-2-2M16 12l-2 2',
  pencil: 'M4 20l4-1L20 7l-3-3L5 16zM14 6l3 3',
  paint: 'M6 20c-1.5 0-2.5-1-2.5-2.5S5 15 6 15s2 .8 2 2-.5 3-2 3zM8.5 15.5 19 5l1.5 1.5L10 17z',
  bend: 'M4 18c4 0 5-12 9-12s7 6 7 6M4 18h16',
  listen: 'M4 12h3l3-5 3 10 3-7 2 2h2',
  'zoom-in': 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM16 16l4 4M8.5 11h5M11 8.5v5',
  'zoom-out': 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM16 16l4 4M8.5 11h5',
  hand: 'M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-1V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V16a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5v-4.5a1.5 1.5 0 0 1 2-1.4',
  magnet: 'M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4zM6 8h4M14 8h4',
  slip: 'M4 8h16v8H4zM8 8v8M12 8v8M16 8v8M2 12h2M20 12h2',
  // structure
  section: 'M4 6h6v12H4zM14 6h6v12h-6zM10 12h4',
  chord: 'M6 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM14 15a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM10 17V7l8-2v10',
  tempo: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM12 8v4l3 2',
  signature: 'M9 5c2.5 0 3.5 1.5 3.5 3S11 11 9 11M15 13c-2.5 0-3.5 1.5-3.5 3S13 19 15 19M6 12h12',
  folder: 'M3 6h6l2 2h10v11H3z',
  'folder-open': 'M3 6h6l2 2h10v2H6l-3 9zM3 19l3-9h15l-3 9z',
  vca: 'M5 6l4 12 4-12M16 6v12M19 6v12',
  group: 'M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v5H4zM13 14h7v5h-7z',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 4 9-4',
  scratchpad: 'M5 4h10l4 4v12H5zM15 4v4h4M8 12h8M8 16h5',
  // channel
  mixer: 'M6 4v16M12 4v16M18 4v16M4 9h4M10 15h4M16 7h4',
  fader: 'M12 4v16M8 10h8v3H8z',
  knob: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM12 8v4M6.5 17.5 4.8 19.2M17.5 17.5l1.7 1.7',
  eq: 'M4 18c3 0 3-6 6-6s3 6 6 6 4-9 4-9',
  compressor: 'M4 18L10 8h2l8 10M4 18h16M9 14h6',
  insert: 'M4 12h4l2-4 3 8 2-4h5',
  send: 'M4 12h10M11 8l4 4-4 4M18 5v14',
  automation: 'M4 17c4 0 4-10 8-10s4 6 8 6M6 17a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM12 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM19 14a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
  solo: 'M15.5 7.5A4 4 0 0 0 8 9c0 3.5 8 2 8 5.5a4 4 0 0 1-7.6 1.5',
  headphones: 'M4 15v-3a8 8 0 0 1 16 0v3M4 14h3v6H5a1 1 0 0 1-1-1zM20 14h-3v6h2a1 1 0 0 0 1-1z',
  mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4M9 21h6',
  input: 'M14 4h5v16h-5M11 12H3M8 9l3 3-3 3',
  output: 'M10 4H5v16h5M13 12h8M18 9l3 3-3 3',
  phase: 'M4 12a4 4 0 0 1 8 0 4 4 0 0 0 8 0M4 12a4 4 0 0 0 8 0 4 4 0 0 1 8 0',
  mono: 'M4 12h4M16 12h4M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10z',
  sidechain: 'M4 8h6a4 4 0 0 1 4 4v0a4 4 0 0 0 4 4h2M18 5l3 3-3 3M4 16h4',
  meter: 'M6 20V9M10 20V5M14 20v-8M18 20v-4',
  analyser: 'M4 20V13M7.5 20v-4M11 20V8M14.5 20v-9M18 20V5M21 20v-6',
  tuner: 'M12 20a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM12 12l4-4M12 20v2M4 12H2M22 12h-2',
  // content
  wave: 'M3 12h2l2-6 3 12 3-9 2 5 2-2h4',
  piano: 'M4 5h16v14H4zM8 5v9M12 5v9M16 5v9',
  grid: 'M4 4h16v16H4zM4 10h16M4 15h16M10 4v16',
  note: 'M9 18V6l9-2v11M9 18a2.5 2.5 0 1 1-5 1.2A2.5 2.5 0 0 1 9 18zM18 15a2.5 2.5 0 1 1-5 1.2A2.5 2.5 0 0 1 18 15z',
  drum: 'M4 8c0-2 3.6-3.5 8-3.5S20 6 20 8v8c0 2-3.6 3.5-8 3.5S4 18 4 16zM4 8c0 2 3.6 3.5 8 3.5S20 10 20 8M8 12.5 5 17M16 12.5l3 4.5',
  guitar: 'M14 4l4 4M15.5 6.5 11 11M11 11a4 4 0 1 0-3.6 6.9A3 3 0 1 1 11 11zM4 20l2-2',
  sampler: 'M4 5h16v14H4zM4 12h16M8 5v7M12 12v7M16 5v7',
  synth: 'M4 6h16v6H4zM6 15h2v4H6zM10 15h2v4h-2zM14 15h2v4h-2zM18 15h.01M7 9h10',
  score: 'M5 5v14M9 8h11M9 12h11M9 16h11M5 5c2 0 3 1 3 3s-1 3-3 3',
  stem: 'M12 4v6M12 10 6 16v4M12 10l6 6v4M4 20h4M16 20h4',
  wand: 'M5 19 16 8M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 10l.7 1.3 1.3.7-1.3.7-.7 1.3-.7-1.3-1.3-.7 1.3-.7z',
  // files
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 13l5-5 5 5M5 4h14',
  'file-audio': 'M6 3h8l4 4v14H6zM14 3v4h4M9 15h1.5l2-2v6l-2-2H9zM15 13.5a3 3 0 0 1 0 5',
  'file-midi': 'M6 3h8l4 4v14H6zM14 3v4h4M9 17v-5l1.5 2 1.5-2v5M14.5 12v5',
  cloud: 'M7 18a4 4 0 0 1 0-8 5.5 5.5 0 0 1 10.6 1.5A3.5 3.5 0 0 1 17 18z',
  database: 'M12 4c4.4 0 8 1.1 8 2.5S16.4 9 12 9 4 7.9 4 6.5 7.6 4 12 4zM4 6.5v11C4 19 7.6 20 12 20s8-1 8-2.5v-11M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5',
  clipboard: 'M9 4h6v3H9zM9 5H6v16h12V5h-3',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  clock: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM12 7.5V12l3 2',
  tag: 'M4 4h7l9 9-7 7-9-9zM8 8h.01',
  // chrome
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 13l4 4L19 7',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M6 15l6-6 6 6',
  'chevron-left': 'M15 6l-6 6 6 6',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevrons-left': 'M17 6l-6 6 6 6M11 6l-6 6 6 6',
  'chevrons-right': 'M7 6l6 6-6 6M13 6l6 6-6 6',
  'arrow-up': 'M12 20V5M6 11l6-6 6 6',
  'arrow-down': 'M12 4v15M6 13l6 6 6-6',
  dots: 'M6 12h.01M12 12h.01M18 12h.01',
  'dots-v': 'M12 6v.01M12 12v.01M12 18v.01',
  undo: 'M8 5L3 10l5 5M3 10h11a6 6 0 0 1 0 12h-2',
  redo: 'M16 5l5 5-5 5M21 10H10a6 6 0 0 0 0 12h2',
  settings:
    'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM19.4 14a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.5 13H4a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 5.3 6.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V2a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.2 1z',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M15 4v6M8 14v6',
  wrench: 'M14 7a4 4 0 0 0-5.4 5.2L4 17l3 3 4.8-4.6A4 4 0 0 0 17 10l-3-3z',
  help: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM9.6 9.5a2.5 2.5 0 0 1 4.9.6c0 1.7-2.5 2-2.5 3.4M12 17h.01',
  info: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM12 11v5M12 8h.01',
  warning: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3',
  unlock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 5.7-1.3',
  link: 'M10 13a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 1 0-5.7-5.7L11.4 6M14 11a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.2-1.2',
  unlink: 'M9 15l-1.6 1.6a4 4 0 0 1-5.7-5.7L3.3 9.3M15 9l1.6-1.6a4 4 0 0 1 5.7 5.7L20.7 14.7M5 5l14 14',
  refresh: 'M20 8a8 8 0 1 0 .7 6M20 4v4h-4',
  power: 'M12 4v8M7.5 6.5a7 7 0 1 0 9 0',
  external: 'M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  home: 'M4 11l8-7 8 7v9H4zM10 20v-6h4v6',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM6 17h13',
  'panel-left': 'M4 4h16v16H4zM9 4v16',
  'panel-right': 'M4 4h16v16H4zM15 4v16',
  'panel-bottom': 'M4 4h16v16H4zM4 14h16',
  maximize: 'M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5',
  restore: 'M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5',
  zap: 'M13 3L5 13h5l-1 8 8-10h-5z',
  palette:
    'M12 3a9 9 0 0 0 0 18c1 0 1.6-.7 1.6-1.5 0-.4-.2-.8-.4-1-.3-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8zM7.5 11h.01M10.5 7.5h.01M15 8h.01',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M18 10h.01M7 14h10',
};

export function Icon({ name, size = 16, weight = 1.8, className }: IconProps) {
  if (name === 'logo') {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className={className}>
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
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      focusable="false"
    >
      <path d={filled ?? stroked ?? ''} />
    </svg>
  );
}

/** Every drawable name, for the icon-coverage test and the diagnostics sheet. */
export const ICON_NAMES: IconName[] = [
  ...new Set([...Object.keys(FILLED), ...Object.keys(STROKED), 'logo']),
] as IconName[];
