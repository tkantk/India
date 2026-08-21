/**
 * Mor, photographed. `npm run contact-sheet:mor`.
 *
 * A test can prove he carries `data-state="showing"`. It cannot tell you
 * whether a six-year-old would like him, whether he still reads as the
 * peacock beat 8 calls "me", or whether he is standing on the play button.
 * This is the page that answers those, and it drives the REAL component
 * through the REAL stylesheet over the REAL map, so what is photographed is
 * what a child gets.
 *
 * Two panels, because they need different worlds:
 *
 *  - THE SHEET (default) — the three states side by side at the size he
 *    really ships at, plus the drawing on its own at 2x next to the beat 8
 *    reveal, so "the same bird" can be checked by eye and not only by the
 *    shape-for-shape test in Mor.test.tsx.
 *
 *  - A DEVICE (`?panel=device`) — the whole screen at one viewport size:
 *    the real map, the real fixed control bar, Mor, and a STAND-IN for the
 *    play button Task 10 has not built yet, drawn at the size the plan
 *    promises (2 x --tap) in the place the plan promises (centred, at the
 *    bottom). It measures the overlaps itself and writes them into the DOM
 *    for the shooting script to read, because "he does not cover a control"
 *    is a number, not an impression.
 *
 * One document per device: `.controls` is `position: fixed`, so it attaches
 * to the viewport, and there is exactly one viewport per document. The outer
 * page puts three of them side by side in iframes — the same reason
 * fixes.tsx does.
 */
import { StrictMode } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { MotionConfig, MotionGlobalConfig } from 'motion/react'
import geo from '../../src/data/geo.json'
import { isCheap, startFrameProbe } from '../../src/lib/cheapMode'
import { MapStage } from '../../src/map/MapStage'
import { OVERLAYS } from '../../src/tour/overlays'
import { Mor } from '../../src/tour/Mor'
import { Peacock, PeacockBody, EYE } from '../../src/tour/effects/art/Peacock'
import { PALETTE as C } from '../../src/tour/effects/art/palette'
import { Controls } from '../../src/ui/Controls'
import '../../src/styles/base.css'
import '../../src/map/map.css'
import '../../src/tour/tourStage.css'
import './mor.css'

/**
 * Every animation lands instantly, before the shutter.
 *
 * Headless Chrome runs no animation frames under a virtual time budget, so
 * without this the sheet photographs Mor's FIRST frame — mid-fan, mid-bob,
 * and for the reveal beside him, an empty card. `skipAnimations` makes Motion
 * apply every target synchronously, so what is photographed is the settled
 * state. It has to be set BEFORE the first render, which is why it is here
 * and not inside a component.
 */
MotionGlobalConfig.skipAnimations = true

/**
 * Latch cheap mode BEFORE the first render, the same way `skipAnimations`
 * above has to be — `isCheap()` is read synchronously inside `Mor`'s render,
 * not from an effect, so the verdict has to already exist.
 *
 * `isCheap()` is the hardware verdict OR the reduced-motion setting
 * (src/lib/cheapMode.ts), and the sheet already has its own cell for the
 * setting below. This is the other half: a device that measured itself as
 * too slow, which a child never toggles and this sheet can otherwise never
 * show. `requestAnimationFrame` is overridden just long enough to feed the
 * probe two seconds of 20 fps — the same technique `cheapMode.test.ts` and
 * `Mor.test.tsx`'s cheap-mode test use — then restored, so nothing else on
 * the page inherits a fake clock.
 */
function latchCheapMode() {
  const real = window.requestAnimationFrame
  let now = 0
  const queue: FrameRequestCallback[] = []
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    queue.push(cb)
    return queue.length
  }) as typeof window.requestAnimationFrame
  startFrameProbe()
  for (let i = 0; i < 200 && queue.length; i++) {
    now += 50 // 20 fps: below the 50 fps floor SLOW_FRAME_MS enforces
    queue.shift()?.(now)
  }
  window.requestAnimationFrame = real
  if (!isCheap()) throw new Error('the sheet failed to latch cheap mode for its own cell')
}

const NOOP = () => {}
const places = Object.entries(geo.places as Record<string, { d: string; type: string }>)

/** The map as the child sees it behind him: the real paths, the real
 *  stylesheet, no hit layer and no camera. Four of these in one document. */
function MapUnder() {
  return (
    <div className="map">
      <div className="stage">
        <svg className="base" viewBox={geo.viewBox.join(' ')} aria-hidden="true">
          {places.map(([slug, p]) => (
            <path key={slug} d={p.d} data-type={p.type} />
          ))}
        </svg>
      </div>
      <p className="credit">{geo.attribution}</p>
    </div>
  )
}

/** One state, in the corner of a stage the size of the map on an iPad. */
function Pose({
  playing,
  showing,
  caption,
}: {
  playing: boolean
  showing: string | null
  caption: string
}) {
  return (
    <figure className="cell">
      <div className="stage-box">
        <div className="tour-stage">
          <MapUnder />
          {showing && <div className="tour-overlay">{OVERLAYS.revealSymbol(showing)}</div>}
          <Mor playing={playing} showing={showing} />
        </div>
        {/* Where the fixed control bar lands. Mor must be clear of this. */}
        <div className="bar-ghost" />
      </div>
      <figcaption dangerouslySetInnerHTML={{ __html: caption }} />
    </figure>
  )
}

/** The drawing on its own, big enough to judge. */
function Plate({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <figure className="cell">
      <div className="plate">{children}</div>
      <figcaption dangerouslySetInnerHTML={{ __html: caption }} />
    </figure>
  )
}

function Sheet() {
  return (
    <>
      <h1>Namaste India — Mor</h1>
      <p className="note">
        The real component, the real stylesheet, over the real map, settled
        (headless Chrome runs no animation frames, so Motion is told to skip
        straight to the target). The hatched band is where the fixed control
        bar lies over the map: he must never be in it.
      </p>

      <h2>The three states, at the size he ships at</h2>
      <div className="row">
        <Pose
          playing={false}
          showing={null}
          caption="<b>idle</b> — nothing is playing. Tail folded away, smallest, waiting."
        />
        <Pose
          playing
          showing={null}
          caption="<b>talking</b> — narration playing. A little bigger, tail lifted, bobbing."
        />
        <Pose
          playing
          showing="tiger"
          caption="<b>showing</b> — a symbol is on stage. Full fan, turned out to frame it."
        />
      </div>

      <h2>Reduced motion, cheap mode, and the drawing itself</h2>
      <div className="row">
        <MotionConfig reducedMotion="always">
          <Pose
            playing
            showing={null}
            caption="<b>reduced motion</b> — the same pose, held. No bob, no blink."
          />
        </MotionConfig>

        {/* Cheap mode is latched module-wide, above, before this page's
            first render — a genuinely different code path from the setting
            (isCheap() OR's a measured verdict with prefers-reduced-motion),
            so this and the cell to its left are not the same claim
            photographed twice: they must simply agree. */}
        <Pose
          playing
          showing={null}
          caption="<b>cheap mode</b> — a slow iPad's own verdict, not the child's setting. Same held pose, same still eye: the standard reduced motion already meets."
        />

        {/* A magnifying glass held over the same corner of the same stage:
            the real component at its real size, enlarged, with none of its
            own CSS overridden. Overriding it would photograph a Mor that
            does not ship. */}
        <figure className="cell">
          <div className="plate">
            <div className="zoom">
              <div className="tour-stage">
                <MapUnder />
                <Mor playing showing="tiger" />
              </div>
            </div>
          </div>
          <figcaption><b>Mor, showing</b> — the same corner at 2x. Nothing overridden.</figcaption>
        </figure>

        <Plate caption="<b>Beat 8's reveal</b> — “and that is me”. The same bird, the same pieces.">
          <Peacock />
        </Plate>

        {/* The head, twice, at the size a magnifying glass would give it: the
            blink is a 4px white dot winking on a 136px bird, so a still of
            the whole of him cannot show it at all. */}
        <figure className="cell">
          <div className="plate plate--pair">
            <svg viewBox="42 44 36 36" aria-hidden="true"><PeacockBody /></svg>
            <svg viewBox="42 44 36 36" aria-hidden="true">
              <PeacockBody
                eye={<ellipse cx={EYE.x} cy={EYE.y} rx={EYE.r} ry={EYE.r * 0.08} fill={C.snow} />}
              />
            </svg>
          </div>
          <figcaption>
            <b>The blink</b> — open, and shut. The white dot squashes flat for
            a fifth of a second about every five, and nothing else moves.
          </figcaption>
        </figure>
      </div>
    </>
  )
}

// --------------------------------------------------------------- a device

/** Task 10's play button, at the size and place the plan promises, so this
 *  sheet can answer "does Mor cover it" before it exists. NOT the real
 *  button — the real one arrives with the tour sequencer. */
function PlayStandIn() {
  return (
    <button type="button" className="tap play-standin">
      Show me India
    </button>
  )
}

const PLAY_CSS = `
.play-standin {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(var(--tap) + 40px);
  width: calc(var(--tap) * 2);
  height: calc(var(--tap) * 2);
  border-radius: 50%;
  background: var(--gold);
  color: var(--ink);
  font-size: var(--text);
  font-weight: 700;
  box-shadow: 0 4px 14px rgba(18, 36, 28, .3);
  z-index: 3;
}`

function Device({ state, tiger }: { state: 'idle' | 'talking' | 'showing'; tiger: boolean }) {
  return (
    <MemoryRouter>
      <style>{PLAY_CSS}</style>
      <main className="india">
        <h1>Namaste India</h1>
        <div className="tour-stage">
          <MapStage onPick={NOOP} />
          {tiger && <div className="tour-overlay">{OVERLAYS.revealSymbol('tiger')}</div>}
          <Mor playing={state !== 'idle'} showing={state === 'showing' ? 'tiger' : null} />
          <PlayStandIn />
        </div>
      </main>
      <Controls />
    </MemoryRouter>
  )
}

/**
 * Overlap, in pixels, between Mor and the two things he must never cover.
 *
 * A setTimeout and not a rAF, because a virtual time budget advances timers
 * and never fires an animation frame — and not a zero one either: React 19
 * commits off a scheduler callback, so a task queued at zero runs while the
 * page is still an empty root and measures nothing at all. That is not a
 * hypothetical; it is what this reported the first time it ran.
 */
function measure() {
  const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null

  /**
   * Where the drawing actually lands on screen. `getBBox()` is the ink in
   * viewBox units; the element's own rect maps those onto the page, mirror
   * and state scale and all, because both are already in it. Reading both x
   * edges and taking min/max is what keeps `scaleX(-1)` from producing a
   * negative width.
   */
  function inkRect(): DOMRect | null {
    const svg = document.querySelector('.mor__art') as SVGSVGElement | null
    if (!svg) return null
    const box = svg.getBBox()
    const el = svg.getBoundingClientRect()
    const [, , vw, vh] = (svg.getAttribute('viewBox') ?? '0 0 120 120').split(' ').map(Number)
    const xs = [box.x, box.x + box.width].map((x) => el.left + (x / vw) * el.width)
    const ys = [box.y, box.y + box.height].map((y) => el.top + (y / vh) * el.height)
    return new DOMRect(
      Math.min(...xs), Math.min(...ys),
      Math.abs(xs[1] - xs[0]), Math.abs(ys[1] - ys[0]),
    )
  }
  /** What a finger put in the middle of Mor actually hits. */
  function throughMor(): { hit: string; passed: boolean } | null {
    const el = document.querySelector('.mor')
    if (!el) return null
    const r = el.getBoundingClientRect()
    const under = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    const name = under
      ? `${under.tagName.toLowerCase()}${under.getAttribute('class') ? `.${under.getAttribute('class')}` : ''}`
      : 'nothing'
    return { hit: name, passed: !under || !el.contains(under) }
  }

  const barEl = document.querySelector('.controls')
  const mor = rect('.mor')
  const bar = rect('.controls')
  const play = rect('.play-standin')
  const ink = inkRect()
  const round = (n: number) => Math.round(n * 10) / 10
  const over = (a: DOMRect | null, b: DOMRect | null) => {
    if (!a || !b) return null
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
    return w > 0 && h > 0 ? { w: round(w), h: round(h) } : null
  }
  const out = {
    viewport: [innerWidth, innerHeight],
    // The element box, which is sized for the OPEN fan and is therefore
    // bigger than the bird whenever the tail is folded — a deliberately
    // pessimistic answer to "does he reach the controls".
    mor: mor && { left: round(mor.left), top: round(mor.top), w: round(mor.width), h: round(mor.height) },
    // And the ink: what is actually drawn. The honest one for "does he cover
    // anything", since the empty half of a folded bird covers nothing.
    ink: ink && { left: round(ink.left), top: round(ink.top), w: round(ink.width), h: round(ink.height) },
    controls: bar && { top: round(bar.top), h: round(bar.height) },
    gapToControls: ink && bar ? round(bar.top - ink.bottom) : null,
    overlapsControls: over(mor, bar),
    inkOverlapsControls: over(ink, bar),
    inkOverlapsPlayStandIn: over(ink, play),
    overlapsPlayStandIn: over(mor, play),
    // Whether a tap aimed at the middle of him reaches the map underneath.
    // He stands over the Bay of Bengal, a fingertip from Tamil Nadu, and
    // `pointer-events` is a computed style jsdom will never have an opinion
    // about — so this is the only place the claim can be checked.
    tapPassesThrough: throughMor(),
    // The bar has five 104px buttons and 56px of gutter in it: below about
    // 590px of viewport it simply does not fit, whatever Mor does — and it
    // is `left: 0; right: 0`, so its own rect is always the viewport width
    // and only its CONTENT overflows. Hence scrollWidth, not width.
    barContentOverflow: barEl ? round(barEl.scrollWidth - barEl.clientWidth) : null,
  }
  const pre = document.createElement('pre')
  pre.id = 'measure'
  pre.hidden = true
  pre.textContent = `MEASURE:${JSON.stringify(out)}`
  document.body.appendChild(pre)
}

// ------------------------------------------------------------------- mount

const params = new URLSearchParams(location.search)
const panel = params.get('panel')
const state = (params.get('state') ?? 'showing') as 'idle' | 'talking' | 'showing'

// The sheet's furniture (mor.css) is scoped under this, so a device panel —
// which IS the app and needs base.css's full-height, fixed-body layout
// untouched — never picks it up.
if (panel !== 'device') document.documentElement.classList.add('sheet')

const root = createRoot(document.getElementById('root')!)

if (panel === 'device') {
  // StrictMode on purpose: the app runs under it, and a double mount is
  // exactly how a stray camera binding or a second AudioContext shows up.
  root.render(
    <StrictMode>
      <MotionConfig reducedMotion="user">
        <Device state={state} tiger={params.get('tiger') === '1'} />
      </MotionConfig>
    </StrictMode>,
  )
  setTimeout(measure, 400)
} else {
  // Only the sheet gets the synthetic slow-hardware verdict — device panels
  // stay faithful to the real app's own probe (never run, so never cheap),
  // which is the whole point of photographing them.
  latchCheapMode()
  root.render(
    <MotionConfig reducedMotion="user">
      <Sheet />
    </MotionConfig>,
  )
}
