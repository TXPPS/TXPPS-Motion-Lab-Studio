let counter = 0;

/** Compact unique id: time base + counter + randomness. */
export function newId(prefix = ''): string {
  counter = (counter + 1) % 46656;
  const t = Date.now().toString(36);
  const c = counter.toString(36).padStart(3, '0');
  const r = Math.floor(Math.random() * 46656)
    .toString(36)
    .padStart(3, '0');
  return `${prefix}${t}${c}${r}`;
}
