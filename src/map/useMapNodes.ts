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
 *  the line of narration that triggers it.
 *
 *  Exported because whoever lights the map also has to decide when to let it
 *  go, and "how long the wave takes to cross" is half of that sum. */
export const STAGGER_MS = 70

const LIT = 'lit'

/** The class that turns the glow layer's filter on. See map.css. */
const GLOWING = 'on'

const nodes = new Map<string, SVGPathElement>()
/** The <svg class="glow"> root — the element that carries the filter. */
let glowLayer: SVGSVGElement | null = null
/** The single <path> inside it that carries the geometry. */
let glowPath: SVGPathElement | null = null
/** Whose geometry the glow is currently showing, if anyone's. */
let glowSlug: string | null = null
let wave: ReturnType<typeof setTimeout>[] = []

function stopWave() {
  for (const t of wave) clearTimeout(t)
  wave = []
}

/** The class toggle, with no glow attached. */
function setLit(slug: string, on: boolean): SVGPathElement | null {
  const node = nodes.get(slug)
  // Cues carry authored arguments; a typo in the content must not end a
  // child's tour, so an unknown slug is simply nothing happening.
  if (!node) return null
  node.classList.toggle(LIT, on)
  return node
}

/**
 * Show the glow around one state, or take it away.
 *
 * The `on` class is what puts `filter: drop-shadow()` on the glow layer, and
 * it is added and removed rather than left in place: a filter forces WebKit to
 * composite the element it sits on, and this one is full-screen — about
 * 12.6 MB on a 2048x1536 iPad, which WebKit will drop tiles from under memory
 * pressure. The layer only exists while something is actually glowing.
 *
 * Both references are null in cheap mode, where Task 6 does not render the
 * glow layer at all, so every call here is a no-op.
 */
function showGlow(node: SVGPathElement | null, slug: string | null) {
  if (!glowPath || !glowLayer) return
  if (node && slug) {
    glowPath.setAttribute('d', node.getAttribute('d') ?? '')
    glowLayer.classList.add(GLOWING)
    glowSlug = slug
  } else {
    glowPath.removeAttribute('d')
    glowLayer.classList.remove(GLOWING)
    glowSlug = null
  }
}

function highlight(slug: string, on: boolean) {
  const node = setLit(slug, on)
  if (!node) return
  if (on) showGlow(node, slug)
  else if (glowSlug === slug) showGlow(null, null)
}

/**
 * A staggered wave, with no glow.
 *
 * The glow is single-selection emphasis. Carrying it through a wave would
 * rewrite the layer's geometry once per state — 28 times in two seconds,
 * each one a full-detail visible path (22,038 characters for Madhya Pradesh)
 * re-parsed and re-blurred on the main thread, during the busiest moment of
 * the tour. It is dropped, not chased.
 */
function highlightMany(slugs: string[], staggerMs = STAGGER_MS) {
  stopWave()
  showGlow(null, null)
  slugs.forEach((slug, i) => {
    if (i === 0 || staggerMs <= 0) setLit(slug, true)
    else wave.push(setTimeout(() => setLit(slug, true), i * staggerMs))
  })
}

function clear() {
  stopWave()
  for (const node of nodes.values()) node.classList.remove(LIT)
  showGlow(null, null)
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
  glowLayer = null
  glowPath = null
  glowSlug = null
  if (!root) return
  for (const node of root.querySelectorAll<SVGPathElement>('.base path[data-slug]')) {
    nodes.set(node.dataset.slug!, node)
  }
  glowLayer = root.querySelector<SVGSVGElement>('svg.glow')
  glowPath = root.querySelector<SVGPathElement>('.glow path')
}

/** The map's public surface. Stable for the life of the app — it never
 *  changes identity, so it is safe in any dependency array. */
export function useMapNodes(): MapApi {
  return api
}
