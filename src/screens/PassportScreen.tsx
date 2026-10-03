import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { getNarrator } from '../audio/Narrator'
import { Controls } from '../ui/Controls'
import { ReadAlong } from '../ui/ReadAlong'
import { Stamp } from '../passport/Stamp'
import { stampedSlugs } from '../passport/passport'
import geo from '../data/geo.json'
// Only the interface lines this page speaks (`ui.passport`,
// `ui.passport-hint`) — the shared half of the clips, never every place's.
import { SHARED_CLIPS } from '../content/clips'
import './passport.css'

const CLIPS = SHARED_CLIPS
const GEO = geo.places as unknown as Record<string, { name: string }>

/** Every place the map draws — the passport's 36 slots. Derived from the
 *  same geometry the map uses, never hand-listed, so a slot can never exist
 *  for a place the child cannot actually visit, or be missing for one he can. */
const SLUGS = Object.keys(GEO)
const KNOWN = new Set(SLUGS)

/**
 * The one place name too long for a slot. Shown shorter; the button's
 * accessible name still carries the full official name.
 */
const SHORT: Record<string, string> = {
  'dadra-and-nagar-haveli-and-daman-and-diu': 'Dadra, Daman and Diu',
}
const label = (slug: string) => SHORT[slug] ?? GEO[slug].name

/**
 * FIXED SLOTS, alphabetical, never reshuffled. Spec §7: "A passport page with
 * 36 slots." A sticker album works because each sticker has its own place to
 * go: if earned stamps jumped to the front, the empty slots a child is trying
 * to fill would move every time he came back, and "where Kerala goes" would
 * never be a thing he could learn.
 */
const ORDER = [...SLUGS].sort((a, b) => label(a).localeCompare(label(b)))

type Props = {
  /** Tap a slot — stamped or not — to go there. Every slot is a door: the
   *  empty ones are exactly the places worth visiting next. */
  onPick?: (slug: string) => void
  onHome?: () => void
}

/**
 * THE INDIA PASSPORT (design spec §7): "A passport page with 36 slots. Each
 * completed state earns an illustrated stamp. Progress reads 'You have
 * explored 12 of 36!'. Stored in localStorage only."
 *
 * Its narration was written and rendered long before this screen existed —
 * `ui.passport` ("This is your passport. Look how far you have gone!") once
 * there is anything to look at, `ui.passport-hint` ("Every place you finish
 * puts a stamp in here.") while it is still empty, so the very first visit
 * explains what the empty rings are for instead of congratulating a child
 * on nothing.
 *
 * Sound follows the place screen's own rule exactly (see `PlaceScreen`'s
 * `unlocked`): nothing plays until a real gesture has unlocked audio at
 * least once this session. Reached from the map — the normal way in — that
 * is already true. Opened cold from a bookmark, the first tap on Play is the
 * gesture, and the line plays then.
 */
export function PassportScreen({ onPick, onHome }: Props) {
  const n = getNarrator()
  const unlocked = useSyncExternalStore(n.subscribe, () => n.everUnlocked)
  // Read once per visit. Nothing on this screen can earn a stamp, so there
  // is nothing that could change it while it is open.
  const stamped = useMemo(() => new Set(stampedSlugs(KNOWN)), [])
  const count = stamped.size
  const clip = CLIPS[count > 0 ? 'ui.passport' : 'ui.passport-hint'] ?? null
  const [ended, setEnded] = useState(false)

  useEffect(() => {
    if (!clip || !unlocked) return
    setEnded(false)
    let live = true
    const done = () => { if (live) setEnded(true) }
    n.onEnd = done
    void n.play(clip).catch(done)
    return () => {
      live = false
      if (n.onEnd === done) n.onEnd = null
    }
  }, [clip, n, unlocked])

  useEffect(() => () => { n.stop() }, [n])

  /** Controls.tsx's rule: no control may be pressable and do nothing. Cold,
   *  Play is the unlocking gesture; finished, it says the line again. */
  const playPause = useCallback(() => {
    if (!unlocked) { void n.unlock(); return }
    if (n.playing) { n.pause(); return }
    if (ended && clip) { setEnded(false); void n.play(clip); return }
    n.resume()
  }, [clip, ended, n, unlocked])

  const goHome = useCallback(() => {
    n.stop()
    onHome?.()
  }, [n, onHome])

  const visit = useCallback((slug: string) => {
    n.stop()
    onPick?.(slug)
  }, [n, onPick])

  return (
    <main className="passport">
      <header className="passport__head">
        <h1 className="passport__title">My Passport</h1>
        <p className="passport__count" data-testid="passport-count">
          {count === 0 ? (
            'No stamps yet'
          ) : (
            <>
              You have explored <b>{count}</b> of {SLUGS.length}!
            </>
          )}
        </p>
        <div className="passport__say">
          <ReadAlong clip={clip} />
        </div>
      </header>

      <ol className="passport__grid">
        {ORDER.map((slug) => {
          const has = stamped.has(slug)
          return (
            <li key={slug}>
              <button
                type="button"
                className="tap passport__slot"
                data-stamped={has || undefined}
                data-testid={`passport-${slug}`}
                aria-label={`${GEO[slug].name}${has ? ', stamped' : ', not visited yet'}`}
                onClick={() => visit(slug)}
              >
                <Stamp slug={slug} stamped={has} />
                <span className="passport__name">{label(slug)}</span>
              </button>
            </li>
          )
        })}
      </ol>

      <Controls onPlayPause={playPause} onHome={goHome} />
    </main>
  )
}
