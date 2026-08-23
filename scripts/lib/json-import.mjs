/**
 * ONE MISSING ATTRIBUTE, added transparently, so a gate script can import
 * REAL app source instead of a second copy of it.
 *
 * `scripts/colour-check.mjs` imports `src/tour/effects/subject.ts` directly
 * — the same table the app ships, not a hand-copied stand-in, for the exact
 * reason `subject.ts`'s own banner gives: a hand-copied list is how this
 * project has been bitten before. That file imports `content/vocab.json`
 * with a bare specifier and no `with { type: 'json' }` attribute, which Vite
 * and Vitest both resolve without complaint — but plain Node's ESM loader
 * refuses a JSON import with no attribute at all (`ERR_IMPORT_ATTRIBUTE_
 * MISSING`), and adding the attribute in `subject.ts` itself would be a
 * change made only for this script's convenience, to a file `Symbol.test.tsx`
 * and the running app both also depend on.
 *
 * So the attribute is added here instead, on the way in: a `resolve` hook
 * registered only by the scripts that need it, invisible to everything else
 * that imports `subject.ts`. `scripts/probe-map-hits.mjs` never needed this
 * because `src/map/hitLayer.ts` — the one file it imports directly — carries
 * no JSON import of its own.
 */
export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context)
  if (result.url.endsWith('.json') && context.importAttributes?.type !== 'json') {
    return { ...result, importAttributes: { ...context.importAttributes, type: 'json' } }
  }
  return result
}
