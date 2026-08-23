import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Controls } from './Controls'

// The double must be FAITHFUL to the real engine's interface. An incomplete
// double is worse than none: production code gets bent around the gap, and
// the very path the task exists to build ends up untested.
let listeners: (() => void)[] = []
const narrator = {
  playing: true, stuck: false,
  // Task 4: the real `loading` is reactive (see `Narrator.ts`'s own
  // `get loading()`) and is what the bar renders instead of a lying "Play"
  // while a clip is in flight with nothing decoded yet to play it with —
  // real on beat 1, which is never prefetched. `false` at rest, like the
  // real engine before anything has ever been asked for.
  loading: false,
  // `true` here matches `playing: true`: this double's baseline is an
  // active session, where "Say it again" has something to act on. The
  // dedicated test below flips it to prove the disabled case.
  canReplay: true,
  pause: vi.fn(), resume: vi.fn(), replay: vi.fn(),
  setRate: vi.fn(), setVolume: vi.fn(),
  resumeContext: vi.fn(async () => true),
  subscribe: (fn: () => void) => { listeners.push(fn); return () => { listeners = listeners.filter(l => l !== fn) } },
  emit: () => listeners.forEach(l => l()),
}
vi.mock('../audio/Narrator', () => ({ getNarrator: () => narrator }))

/**
 * Play and home are the screen's business, not the bar's, so they come in as
 * required props — see Controls.tsx. The bar used to decide "play" for
 * itself with `playing ? pause() : resume()`, and `resume()` does nothing
 * when there is no buffer, so at rest the button was a 104px target that did
 * not respond. No Router is needed any more either.
 */
const onPlayPause = vi.fn()
const onHome = vi.fn()
const mount = () => render(<Controls onPlayPause={onPlayPause} onHome={onHome} />)

beforeEach(() => {
  onPlayPause.mockClear()
  onHome.mockClear()
  narrator.loading = false
  narrator.canReplay = true
})

describe('Controls', () => {
  it('labels every control with a word, not only a symbol', () => {
    mount()
    for (const name of [/pause|play/i, /again/i, /slower|normal/i, /sound/i, /home/i]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('gives every control the full child-sized tap target', () => {
    mount()
    for (const b of screen.getAllByRole('button')) expect(b.className).toContain('tap')
  })

  it('hands play and pause to the screen, which is the only thing that knows what it means', async () => {
    // `playing` is true in the double, so this reads "Pause" — but either way
    // the bar delegates rather than guessing, because at rest the guess was
    // `resume()` on an engine with nothing to resume.
    mount()
    await userEvent.click(screen.getByRole('button', { name: /pause|play/i }))
    expect(onPlayPause).toHaveBeenCalledOnce()
    expect(narrator.pause).not.toHaveBeenCalled()
    expect(narrator.resume).not.toHaveBeenCalled()
  })

  it('hands home to the screen too, so it can actually stop the tour', async () => {
    mount()
    await userEvent.click(screen.getByRole('button', { name: /home/i }))
    expect(onHome).toHaveBeenCalledOnce()
  })

  it('says it again without restarting the whole tour', async () => {
    mount()
    await userEvent.click(screen.getByRole('button', { name: /again/i }))
    expect(narrator.replay).toHaveBeenCalledOnce()
  })

  it("hands replay to the screen when given one, instead of calling the engine directly", async () => {
    // Task 3: `GrandTour` needs a chance to clear a pending invite's dwell
    // timer BEFORE the same clip restarts — `n.replay()` would otherwise
    // leave that timer ticking against audio that has begun again. `onReplay`
    // is optional precisely so every caller before this one keeps working
    // unchanged (the test just above, with no `onReplay` at all).
    narrator.replay.mockClear()
    const onReplay = vi.fn()
    render(<Controls onPlayPause={onPlayPause} onHome={onHome} onReplay={onReplay} />)
    await userEvent.click(screen.getByRole('button', { name: /again/i }))
    expect(onReplay).toHaveBeenCalledOnce()
    expect(narrator.replay).not.toHaveBeenCalled()
  })

  it('slows down and says so in words', async () => {
    mount()
    await userEvent.click(screen.getByRole('button', { name: /slower/i }))
    expect(narrator.setRate).toHaveBeenCalledWith(0.85)
    expect(screen.getByRole('button', { name: /normal speed/i })).toBeInTheDocument()
  })

  it('reports loading honestly instead of a "Play" label the tap could not make good on', async () => {
    // The second defect this task fixes: during `play()`'s own decode the
    // engine has a clip in flight but nothing to play it with — `playing`
    // is false and a naive bar reads "▶ Play" over a beat that has already
    // started, with both transports dead until the load resolves. Real on
    // beat 1, which is never prefetched.
    narrator.playing = false
    mount()
    expect(screen.getByRole('button', { name: /^play$/i })).toBeInTheDocument()
    await act(async () => { narrator.loading = true; narrator.emit() })
    const loadingButton = screen.getByRole('button', { name: /loading/i })
    expect(loadingButton).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^play$/i })).not.toBeInTheDocument()
    // Disabled, not merely relabelled: a tap here cannot do anything either
    // `pause()` or `resume()` would recognise, so it must not silently
    // pretend to.
    await userEvent.click(loadingButton)
    expect(onPlayPause).not.toHaveBeenCalled()
    narrator.playing = true
    narrator.loading = false
  })

  it('disables "say it again" when there is genuinely nothing to repeat', async () => {
    // The coordinator's own catch: at rest, and after Home, `lastClip` has
    // never been set (or was just cleared by `forget()`) — replaying there
    // would either be a true no-op or, worse, resurrect an old beat's audio
    // over a screen that just told the child "back to the start." Disabled
    // is the honest answer, the same rule `loading` already applies above.
    narrator.canReplay = false
    mount()
    const again = screen.getByRole('button', { name: /again/i })
    expect(again).toBeDisabled()
    await userEvent.click(again)
    expect(narrator.replay).not.toHaveBeenCalled()
    narrator.canReplay = true
  })

  /**
   * THE DRAWN GLYPHS, one per control, each beside its own word.
   *
   * `Glyph.tsx` replaced the bar's literal emoji (`▶ ⏸ ⏳ ↺ 🐢 🔊 🔇 🏠`) with
   * marks drawn in the app's own hand — see that file's own note on why the
   * platform ones had to go. Nothing about that swap is allowed to have
   * quietly dropped a label along the way: a glyph is `aria-hidden` on
   * purpose (Glyph.tsx), so if a `control__label` span ever went missing the
   * accessible name would be silently blank, and the "labels every control
   * with a word" test above — which matches on accessible name, computed
   * FROM that very label text — would go on passing for the wrong reason
   * (an empty name still fails `getByRole`'s regex match, so it actually
   * would catch a fully-blank name; what it would NOT catch is a glyph
   * rendered with nothing drawn in it, since aria-hidden art contributes
   * nothing to the accessible name either way). This test looks at the icon
   * slot directly instead of only the label.
   */
  it('draws a glyph in every control, next to its word, not instead of it', () => {
    mount()
    for (const b of screen.getAllByRole('button')) {
      const icon = b.querySelector('.control__icon')
      expect(icon, `${b.textContent} has no icon slot`).toBeTruthy()
      const svg = icon!.querySelector('svg.glyph')
      expect(svg, `${b.textContent} drew no glyph`).toBeTruthy()
      expect(svg!.querySelectorAll('path, circle, rect, ellipse, polygon, line').length,
        `${b.textContent}'s glyph is an empty frame`).toBeGreaterThan(0)

      const label = b.querySelector('.control__label')
      expect(label, `${b.textContent} has no label slot`).toBeTruthy()
      expect(label!.textContent?.trim(), `${b.textContent}'s label is empty`).not.toBe('')
    }
  })

  it('offers a way out when the audio context gets stuck, without a re-mount', async () => {
    // The engine's visibilitychange handler can flip `stuck` with no user
    // action at all, so the bar must react to the subscription — not to being
    // mounted again. Mounting twice would pass even against a polled design.
    mount()
    expect(screen.queryByRole('button', { name: /carry on/i })).not.toBeInTheDocument()
    await act(async () => { narrator.stuck = true; narrator.emit() })
    expect(screen.getByRole('button', { name: /carry on/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /carry on/i }))
    expect(narrator.resumeContext).toHaveBeenCalled()
    narrator.stuck = false
  })
})
