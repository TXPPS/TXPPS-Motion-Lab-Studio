/**
 * The names of the editor surfaces, and nothing else.
 *
 * Its own module because two different projects need this union and only one of
 * them can compile a component. `EditorTab` in `state/uiStore.ts` used to be a
 * second copy of the same list, so adding the Channel view broke in three
 * places at once — which is the defect `app/editors.ts` exists to prevent,
 * arriving from the side that registry does not cover.
 *
 * Aliasing `EditorTab` to the registry's own type fixed the duplication and
 * broke `tsconfig.e2e.json`: even an `import type` makes the compiler load the
 * module it names, and that registry names eight `.tsx` components in a project
 * that has no `jsx` setting. A union of string literals has no such graph
 * behind it, which is the whole reason this file is one line of type.
 */
export type EditorId =
  'mixer' | 'piano' | 'drums' | 'score' | 'audio' | 'chords' | 'synth' | 'channel' | 'diagnostics';
