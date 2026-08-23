/**
 * Motion Wave — a reader for the token sheet.
 *
 * The design system's values live in `tokens.css` and nowhere else. Anything
 * that needs to reason about them — the theme-completeness guard, the contrast
 * cell of the verification harness — reads them back out of that one file
 * rather than keeping a second copy in TypeScript. A second copy is a copy that
 * drifts, and a palette that has drifted is invisible until somebody opens the
 * light theme and finds a control the same colour as its background.
 *
 * This is deliberately not a CSS parser. It understands the shape this one
 * stylesheet is written in: flat rule blocks of custom-property declarations,
 * optionally wrapped in a single `@media` query. Anything more general would be
 * a dependency, and `motionwave/` does not take those.
 */

/** One rule block's declarations, with the context it was found in. */
export interface TokenBlock {
  /** The selector as written, e.g. `:root` or `:root[data-theme='light']`. */
  readonly selector: string;
  /** The enclosing at-rule prelude, or null at the top level. */
  readonly media: string | null;
  /** Declared custom properties, in source order, values trimmed. */
  readonly declarations: ReadonlyMap<string, string>;
}

/** Removes block comments, so a token named in prose is never read as a declaration. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Every custom-property declaration in a block, keyed by name. A name declared
 * twice in one block keeps the last value, which is what the cascade does.
 */
function readDeclarations(body: string): Map<string, string> {
  const found = new Map<string, string>();
  const declaration = /(--[\w-]+)\s*:\s*([^;}]+)[;}]?/g;
  let match = declaration.exec(body);
  while (match !== null) {
    found.set(match[1], match[2].trim());
    match = declaration.exec(body);
  }
  return found;
}

/**
 * All token-declaring blocks in a sheet, top level and inside `@media`.
 *
 * Written as a hand-rolled scan rather than a regex over the whole file because
 * a `@media` block contains nested braces, and the regex that matches balanced
 * braces does not exist.
 */
export function readTokenBlocks(css: string): TokenBlock[] {
  const source = stripComments(css);
  const blocks: TokenBlock[] = [];
  let media: string | null = null;
  let mediaDepth = 0;
  let index = 0;

  while (index < source.length) {
    const open = source.indexOf('{', index);
    if (open === -1) break;
    const prelude = source.slice(index, open).trim();
    const close = source.indexOf('}', open);

    if (prelude.startsWith('@')) {
      // An at-rule wraps further blocks; remember its prelude and descend.
      media = prelude;
      mediaDepth += 1;
      index = open + 1;
      continue;
    }

    if (close === -1) break;
    const declarations = readDeclarations(source.slice(open + 1, close));
    if (declarations.size > 0) {
      blocks.push({ selector: prelude, media, declarations });
    }
    index = close + 1;

    // Consume the at-rule's own closing brace so its prelude stops applying to
    // the blocks that follow it. Without this every later block in the file
    // would be reported as living inside the last media query seen.
    while (mediaDepth > 0 && source.slice(index).trimStart().startsWith('}')) {
      index = source.indexOf('}', index) + 1;
      mediaDepth -= 1;
      if (mediaDepth === 0) media = null;
    }
  }

  return blocks;
}

/** The declarations of the first block whose selector matches exactly. */
export function blockFor(
  blocks: readonly TokenBlock[],
  selector: string,
  media: string | null = null,
): ReadonlyMap<string, string> | null {
  const found = blocks.find((b) => b.selector === selector && b.media === media);
  return found ? found.declarations : null;
}

/** Every custom property named anywhere in the sheet, in source order. */
export function allTokenNames(blocks: readonly TokenBlock[]): string[] {
  const names: string[] = [];
  for (const block of blocks) {
    for (const name of block.declarations.keys()) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}
