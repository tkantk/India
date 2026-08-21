/**
 * The node cache: the one place that knows which SVG path is which state.
 *
 * Highlighting a state is a class toggle on a cached element reference, never
 * a React state update. The visible layer is 269 KB of path data across 36
 * paths; putting it behind React state would put the reconciler in the hot
 * path of every cue in the narration, and cues fire off the audio clock while
 * a child is listening.
 *
 * The cache is module-scoped, like the narration engine, for the same reason:
 * there is exactly one map on screen for the whole life of the app, and the
 * cue registry (Task 7) needs to reach it from outside the component that
 * renders it. `MapStage` fills it on mount and empties it on unmount.
 */

export type MapApi = {
  /** slug -> the *visible* path. Highlighting recolours the art, not the hit layer. */
  nodes: Map<string, SVGPathElement>
  highlight(slug: string, on: boolean): void
  /** Staggered wave. Used by highlightAllStates / highlightUnionTerritories. */
  highlightMany(slugs: string[], staggerMs?: number): void
  clear(): void
}

/** 28 states at 70 ms is a wave just under two seconds — about the length of
 *  the line of narration that triggers it. */
const STAGGER_MS = 70

const LIT = 'lit'

const nodes = new Map<string, SVGPathElement>()
let glow: SVGPathElement | null = null
let wave: ReturnType<typeof setTimeout>[] = []

function stopWave() {
  for (const t of wave) clearTimeout(t)
  wave = []
}

function highlight(slug: string, on: boolean) {
  const node = nodes.get(slug)
  // Cues carry authored arguments; a typo in the content must not end a
  // child's tour, so an unknown slug is simply nothing happening.
  if (!node) return
  node.classList.toggle(LIT, on)

  // The glow layer holds one copy of the lit path. Copying the geometry costs
  // a single attribute write; the alternative — a CSS drop-shadow on the
  // visible path itself — would put a filter on a layer WebKit repaints for
  // every other state too. It is absent in cheap mode (Task 6).
  if (!glow) return
  if (on) {
    glow.setAttribute('d', node.getAttribute('d') ?? '')
    glow.dataset.slug = slug
  } else if (glow.dataset.slug === slug) {
    glow.removeAttribute('d')
    delete glow.dataset.slug
  }
}

function highlightMany(slugs: string[], staggerMs = STAGGER_MS) {
  stopWave()
  slugs.forEach((slug, i) => {
    if (i === 0 || staggerMs <= 0) highlight(slug, true)
    else wave.push(setTimeout(() => highlight(slug, true), i * staggerMs))
  })
}

function clear() {
  stopWave()
  for (const node of nodes.values()) node.classList.remove(LIT)
  if (glow) {
    glow.removeAttribute('d')
    delete glow.dataset.slug
  }
}

const api: MapApi = { nodes, highlight, highlightMany, clear }

/**
 * Point the cache at a mounted map, or at nothing. Called by `MapStage` only.
 *
 * One `querySelectorAll` over the visible layer, once — not 36 refs threaded
 * through JSX, which would mean mapping over the paths in React in the first
 * place.
 */
export function bindMapNodes(root: Element | null): void {
  stopWave()
  nodes.clear()
  glow = null
  if (!root) return
  for (const node of root.querySelectorAll<SVGPathElement>('.base path[data-slug]')) {
    nodes.set(node.dataset.slug!, node)
  }
  glow = root.querySelector<SVGPathElement>('.glow path')
}

/** The map's public surface. Stable for the life of the app — it never
 *  changes identity, so it is safe in any dependency array. */
export function useMapNodes(): MapApi {
  return api
}
