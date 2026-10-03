/**
 * What TypeScript is told about the modules `scripts/vite-place-data.mjs`
 * generates at build time. They have no file on disk for the compiler to
 * read, so their shapes are declared here — deliberately loosely (`unknown`
 * for the payloads): the two files that import them, `places.ts` and
 * `clips.ts`, are where the real types are applied, the same `as unknown as`
 * step every JSON import in this app already takes.
 *
 * Pulled in by a `/// <reference>` at the top of each of those two files
 * rather than by being under `src/` alone: `tsconfig.test.json` includes only
 * test files and whatever THEY import, and an ambient declaration nobody
 * imports is invisible to that program.
 *
 * `virtual:place-data/<slug>` is not declared: only the generated index ever
 * imports it, and no TypeScript does.
 */
declare module 'virtual:place-data' {
  /** Every written place, slug and name only, alphabetical by name. */
  export const WRITTEN: { id: string; name: string }[]
  /** One static dynamic import per written place, keyed by slug. */
  export const LOADERS: Map<string, () => Promise<{ default: unknown }>>
}

declare module 'virtual:shared-clips' {
  /** Every clip no place owns: the tour's beats and the interface lines. */
  const clips: Record<string, unknown>
  export default clips
}
