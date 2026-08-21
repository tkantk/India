import type { ReactNode } from 'react'

/**
 * The seam Task 8 fills with real art.
 *
 * Six of the twelve verbs animate something nobody has drawn yet:
 * `revealSymbol`, `unfurlFlag`, `countTo`, `traceRiver`, `raiseMountains`,
 * `showScript`. `cues.ts` never names an artefact directly — it looks the
 * verb up here and hands whatever comes back to `setOverlay`. Task 8 swaps
 * the placeholder renderers below for the real components (`Symbol`,
 * `Counter`, `Flag`, `River`, `Mountains`, `Script`) and never has to open
 * `cues.ts` to do it.
 */
export type OverlayRenderer = (arg: string | undefined) => ReactNode

/** Deliberately plain: a labelled box, not art. Its job is to be unmistakably
 *  a placeholder — `data-verb`/`data-arg` so a test (or a person) can tell
 *  exactly which cue produced it — not to look like anything. */
function Placeholder({ verb, arg }: { verb: string; arg?: string }) {
  return (
    <div className="cue-placeholder" data-verb={verb} data-arg={arg ?? ''}>
      {arg ? `${verb}: ${arg}` : verb}
    </div>
  )
}

export const OVERLAYS: Record<string, OverlayRenderer> = {
  revealSymbol: (arg) => <Placeholder verb="revealSymbol" arg={arg} />,
  unfurlFlag: (arg) => <Placeholder verb="unfurlFlag" arg={arg} />,
  countTo: (arg) => <Placeholder verb="countTo" arg={arg} />,
  traceRiver: (arg) => <Placeholder verb="traceRiver" arg={arg} />,
  raiseMountains: (arg) => <Placeholder verb="raiseMountains" arg={arg} />,
  showScript: (arg) => <Placeholder verb="showScript" arg={arg} />,
}
