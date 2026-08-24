import { assetUrl } from '../lib/assetUrl'
import catalogue from '../data/sound-credits.json'
import type { Clip, Cue } from '../types'

/**
 * The narration engine. It plays one clip at a time, publishes which word is
 * being spoken so the text can light up, and fires animation cues off the
 * audio clock so the tiger growls on the word "tiger".
 *
 * It lives entirely outside React. React reads it through
 * `subscribe`/`getSnapshot` and never pushes state into it.
 */

/** Ambient bed level while the narrator is speaking. */
const DUCK = 0.18
/** Ambient bed level when nobody is speaking. */
const FULL = 0.7
/** Seconds for every gain ramp: long enough not to click, short enough that
 *  the bed is out of the way before the second word. */
const RAMP = 0.25
/** The "slower" button. `AudioBufferSourceNode.playbackRate` has no pitch
 *  correction, so 0.85 drops the pitch about 2.8 semitones — fine for a
 *  playful voice. Below 0.8 it stops sounding like a person. */
const SLOWEST = 0.8
/** The current clip and the next one. Decoded PCM is roughly 24x the
 *  compressed size and exhausting memory kills the tab with no catchable
 *  error. */
const MAX_DECODED = 2
/** How long the ambient bed stays ducked after a line ends, waiting to see
 *  whether another one follows. Fourteen tour beats run back to back, and a
 *  bed that swelled and sank between every sentence would be the loudest
 *  thing in the room. Long enough to bridge a beat change, short enough that
 *  a real silence gets its birdsong back within about a second. */
const SETTLE_MS = 1200

/** `sound-credits.json` is the manifest of the sounds that actually exist.
 *  Content references five that do not (`tiger-growl`, `camel`,
 *  `temple-bell`, and the `desert` and `city` beds); looking them up here
 *  means they are silent without even a 404 in the network log. */
type SoundEntry = { file: string; kind: string }
const SOUNDS = catalogue as unknown as Record<string, SoundEntry>

/** Dev-only guard: a second AudioContext looks exactly like an iOS unlock
 *  bug and is not one. Not enforced under test, where each case wants a
 *  fresh engine around its own fake context. */
let built = 0

export class Narrator {
  /** Set once, by the cue registry. */
  onCue: (cue: Cue) => void = () => {}
  /** Fired when a clip reaches its natural end — not on `pause` or `stop`.
   *  The tour uses it to move to the next beat. */
  onEnd: (() => void) | null = null
  /** Fired when `replay()` actually restarts something — not on either of
   *  its no-op paths (nothing has ever played, or the exact clip asked for
   *  is already mid-load). The engine-side twin of `onEnd`: `GrandTour`
   *  hooks this to abandon Task 3's pending invite wait whenever a replay
   *  happens, no matter which control — or, tomorrow, which of the 32
   *  state screens — triggered it. */
  onAgain: (() => void) | null = null

  private ctx: AudioContext
  private master: GainNode
  private narr: GainNode
  private amb: GainNode
  private fx: GainNode

  /** The live narration node, or null when paused, stopped or finished.
   *  An AudioBufferSourceNode is one-shot: every pause, resume, replay and
   *  seek throws it away and starts a fresh one. */
  private src: AudioBufferSourceNode | null = null
  private ambSrc: AudioBufferSourceNode | null = null

  private clip: Clip | null = null
  private buffer: AudioBuffer | null = null
  /** The most recently requested clip, kept alive THROUGH `teardown()` —
   *  unlike `clip`/`buffer`, `stop()` does not clear it. `replay()` needs
   *  it to answer after every one of the stopped states a control can be
   *  pressed from: at rest before it, mid-load, after a tap, after Home,
   *  after the tour ends. `null` only until something has played for the
   *  first time this session — the one state in which "say it again" has
   *  genuinely nothing to repeat. */
  private lastClip: Clip | null = null
  private cues: Cue[] = []
  private starts: number[] = []

  /**
   * Single source of truth for "there is a decoded buffer ready to reseek,
   * for the clip currently loaded." `replay()`'s fast path and `canReplay`
   * both read THIS rather than each re-deriving their own version of it —
   * they agreed before only because of an unenforced invariant (`buffer`
   * is never set while `clip` is null at any current mutation site), and a
   * future edit that decoupled those two nulling paths could otherwise
   * silently desync what the button claims from what a tap actually does.
   */
  private get hasBuffer(): boolean {
    return this.buffer !== null && this.clip !== null
  }

  /** Media seconds already played when the current node started. */
  private offset = 0
  /** `ctx.currentTime` when the current node started. */
  private startedAt = 0
  private rate = 1
  private curWord = -1
  /** Monotonic index into `cues`. Never rewinds except on replay. */
  private cursor = 0
  private raf = 0
  /** `ctx.currentTime` when the clip last ended NATURALLY (`finish()`), or
   *  `null` otherwise. See `position`'s own note: a `hold` can reach past
   *  the clip's own end (Task 3's `invite.min` extension —
   *  `scripts/lib/words.mjs`'s `cueTimes`), and that overhang has to keep
   *  counting down in real, un-rate-scaled time — there is no more "rate"
   *  once nothing is playing — exactly the span `GrandTour`'s own invite
   *  floor/cap timers already assume is real seconds. `pause()` never sets
   *  this: it is what tells `position` "the clock is still running" rather
   *  than "the clock has stopped," which is the whole difference between
   *  the two. */
  private endedAt: number | null = null
  /** Pending `scheduleAfter` requests: an absolute target in `position`
   *  units, and the callback to run once it is reached. */
  private scheduled = new Set<{ target: number; cb: () => void }>()

  private listeners = new Set<() => void>()
  /** url -> decoded clip, in least-recently-used order. */
  private decoded = new Map<string, AudioBuffer>()
  /** url -> decoded sound effect or bed. These are seconds long, not minutes,
   *  and are kept for the session. `null` records a load that failed, so we
   *  never ask for the same missing file twice. */
  private effects = new Map<string, AudioBuffer | null>()
  private ambientName: string | null = null
  private stuckFlag = false
  /** True from the moment `unlock()` has run once this session — a plain
   *  "has the one required gesture happened yet", never derived from
   *  `ctx.state`. It has to be independent of that: at least two of the
   *  four WebKit bugs the debug panel exists to diagnose report `state ===
   *  "running"` while nothing is actually audible, so `ctx.state` cannot
   *  stand in for "a real gesture unlocked this context" — this flag is
   *  set synchronously, inside the one function documented to require
   *  exactly that. See `PlaceScreen.tsx`, the one screen reachable with no
   *  gesture behind it at all (`/place/:slug` sits outside the start
   *  gate), for the caller this exists for. */
  private everUnlockedFlag = false
  /** True for the span of `play()`'s own decode — a clip has been asked for
   *  and there is no buffer yet to play it with. Without this, the interval
   *  between a beat starting and its audio actually being decoded reads as
   *  "Play" in the bar while a beat is already in flight and both
   *  transports are dead: real on beat 1, which is never prefetched, and on
   *  any prefetch miss. See the `loading` getter, which Controls renders
   *  instead of that lie. */
  private loadingFlag = false
  /** Pending "let the bed back up" from settle(). */
  private settleTimer: ReturnType<typeof setTimeout> | null = null

  /** Diagnostics-only: the last three `statechange` events the context has
   *  actually fired, oldest first. See the getters below. */
  private changeLog: { state: string; at: number }[] = []
  /** Diagnostics-only: timing of the most recent `resumeContext()` call. */
  private resumeStartedAt: number | null = null
  private resumeSettledFlag: boolean | null = null
  private resumeSettledAt: number | null = null

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.connect(ctx.destination)
    this.narr = ctx.createGain()
    this.narr.connect(this.master)
    this.amb = ctx.createGain()
    this.amb.connect(this.master)
    this.fx = ctx.createGain()
    this.fx.connect(this.master)
    this.amb.gain.value = FULL

    // iOS moves a context to "interrupted" for a phone call or Siri and does
    // not always bring it back.
    ctx.addEventListener?.('statechange', this.onStateChange)

    built++
    if (import.meta.env.DEV && import.meta.env.MODE !== 'test' && built > 1) {
      console.warn(
        `[Narrator] built ${built} times. There must be exactly one — use getNarrator(). ` +
        'A second AudioContext presents as "audio does not unlock on iPad", and Safari ' +
        'caps a page at about four.',
      )
    }
  }

  // ---------------------------------------------------------------- unlocking

  /**
   * MUST be called synchronously inside a click/touchend/keydown handler:
   * WebKit only honours the gesture for work started before the first await.
   */
  async unlock(): Promise<void> {
    // Set synchronously, before any of the work below — a subscriber
    // (`PlaceScreen`'s `useSyncExternalStore` on `everUnlocked`) has to see
    // this the instant the gesture happens, not once the async resume below
    // settles, so the play effect it gates can react in the same tick a
    // real device would consider "already unlocked".
    this.everUnlockedFlag = true
    this.emit()

    const nav = navigator as Navigator & { audioSession?: { type: string } }
    // Since iOS 17. Without it Web Audio plays on the *ringer* channel, and an
    // iPad with the side switch set to silent produces absolutely nothing.
    // Feature-detected: no other browser has it.
    try {
      if (nav.audioSession) nav.audioSession.type = 'playback'
    } catch { /* a read-only audioSession is not worth failing the gesture for */ }

    try {
      // One silent sample. This, not resume(), is what actually opens output
      // on an iPad that has never played audio.
      const s = this.ctx.createBufferSource()
      s.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate)
      s.connect(this.ctx.destination)
      s.onended = () => { try { s.disconnect() } catch { /* gone already */ } }
      s.start(0)
    } catch { /* fall through: resumeContext reports whether we are usable */ }

    await this.resumeContext()
  }

  /**
   * Resume the context and report whether it worked. WebKit bug 263627 leaves
   * some contexts stuck in "interrupted" even after a user gesture, so the
   * state is re-read *after* resume() settles rather than assumed.
   */
  async resumeContext(): Promise<boolean> {
    // Diagnostics-only bookkeeping: `resumeSettledFlag` sits at `false` from
    // here until the line after the await, so a `ctx.resume()` that never
    // settles (bug 281566) leaves it `false` forever — that is the signature
    // the panel is built to show, not a bug in the flag.
    this.resumeStartedAt = performance.now()
    this.resumeSettledFlag = false
    try {
      if (this.ctx.state !== 'running') await this.ctx.resume()
    } catch { /* the state check below is the real answer */ }
    this.resumeSettledFlag = true
    this.resumeSettledAt = performance.now()
    const ok = this.ctx.state === 'running'
    this.setStuck(!ok)
    return ok
  }

  /**
   * True when the context could not be resumed. Controls turns this into a
   * full-width "Tap to carry on", because there is no other way out.
   *
   * It is reactive: every change goes through setStuck, which emits. Read it
   * as `useSyncExternalStore(n.subscribe, () => n.stuck)` — a primitive
   * selector, so React compares it correctly. Do not poll it after awaiting
   * resumeContext() instead: the visibilitychange path flips it with no user
   * action at all, and a poll would never see that.
   */
  get stuck(): boolean { return this.stuckFlag }

  /** True once `unlock()` has run at least once this session. See
   *  `everUnlockedFlag`'s own comment for why this is a plain "did the
   *  gesture happen" flag rather than anything read off `ctx.state`.
   *  Reactive the same way `stuck` is: `useSyncExternalStore(n.subscribe,
   *  () => n.everUnlocked)`. */
  get everUnlocked(): boolean { return this.everUnlockedFlag }

  private onStateChange = () => {
    const state: string = this.ctx.state
    // Diagnostics-only: record every state the context actually announces,
    // capped at the last three. An empty log after a long session is itself
    // a finding — bug 283419 is silence with `state` stuck at "running" and
    // no `statechange` ever firing.
    this.changeLog = [...this.changeLog, { state, at: performance.now() }].slice(-3)
    if (state === 'running') this.setStuck(false)
    // "interrupted" is WebKit-only and absent from AudioContextState.
    else if (state === 'interrupted') this.setStuck(true)
  }

  private setStuck(v: boolean) {
    if (v === this.stuckFlag) return
    this.stuckFlag = v
    this.emit()
  }

  // -------------------------------------------------------- diagnostics-only

  /**
   * Everything in this section was built for `?debug=audio` (`src/audio/
   * diagnostics.ts`, Plan 4-6), a read-only panel that answered which
   * WebKit audio bug (if any) fires on a real device and whether the
   * finger-tracing gesture actually mounts. A real device session (the
   * father's iPad) confirmed the answers — no stuck clock, `isCheap()`
   * false, nothing rejected — and the panel was deleted once it had; see
   * `docs/handover.md`'s "the audio/gesture debug panel" for the raw
   * readout. These getters are left in place, harmless and unused, in case
   * a future device regression needs the same read-only instrumentation
   * again. Every member is still read-only on principle: nothing here may
   * change what the engine does, only report it.
   */

  /** Raw `ctx.state`, never coerced or interpreted. The panel's whole point
   *  is showing this next to whether the clock is actually moving — WebKit
   *  reports "running" in at least two of the four bugs while nothing is
   *  happening. */
  get diagState(): string { return this.ctx.state }

  /** Raw `ctx.currentTime` — the audio hardware clock, in seconds. */
  get diagCurrentTime(): number { return this.ctx.currentTime }

  /** The last three `statechange` events the context has actually fired,
   *  oldest first. */
  get diagStateChanges(): { state: string; at: number }[] { return this.changeLog }

  /** `null` before any `resumeContext()` call this session; `false` from the
   *  moment one starts until its underlying `ctx.resume()` returns or
   *  throws; `true` once it has. Bug 281566 is a `resume()` promise that
   *  never settles, which leaves this at `false` for good — that is the
   *  signature, not a stuck flag. */
  get diagResumeSettled(): boolean | null { return this.resumeSettledFlag }

  /** Milliseconds since the most recent `resumeContext()` call started —
   *  frozen once it settles, still counting up for as long as
   *  `diagResumeSettled` reads `false`. `null` before the first call. */
  get diagResumeMs(): number | null {
    if (this.resumeStartedAt === null) return null
    const end = this.resumeSettledFlag ? this.resumeSettledAt! : performance.now()
    return end - this.resumeStartedAt
  }

  // ---------------------------------------------------------------- transport

  /** Start a clip from the beginning. Resolves once it is playing — or once
   *  we know it cannot play, which is silence, not an error. */
  async play(clip: Clip): Promise<void> {
    this.teardown()
    this.clip = clip
    this.lastClip = clip
    this.starts = clip.starts ?? []
    // Sorted because the cue cursor only ever moves forward.
    this.cues = [...(clip.cues ?? [])].sort((a, b) => a.t - b.t)
    this.cursor = 0
    this.offset = 0
    this.setWord(-1)   // the outgoing clip's word must not linger while we decode
    // See `loadingFlag`'s own note: a beat is now in flight with nothing to
    // play it with yet, and that has to be observable the instant it starts,
    // not only once something else happens to emit.
    this.loadingFlag = true
    this.emit()

    await this.resumeContext()
    const buffer = await this.load(clip)
    // A newer play() landed while we were decoding; that one owns the engine,
    // including the bed and `loadingFlag`.
    if (this.clip !== clip) return
    this.loadingFlag = false
    this.emit()
    // Nothing is going to speak, so nothing may stay ducked for it.
    if (!buffer) { this.unduck(); return }

    this.buffer = buffer
    this.duck()
    this.startFrom(0)
    this.tick()
  }

  /** Freeze at the current position. Resuming continues from here. */
  pause(): void {
    if (!this.src) return
    this.stopSource()
    this.unduck()
    this.emit()
  }

  resume(): void {
    if (this.src || !this.buffer || !this.clip) return
    if (this.offset >= this.clip.duration) return
    void this.resumeContext()
    this.duck()
    this.startFrom(this.offset)
    this.tick()
  }

  /**
   * "Say it again" — the same clip from the top, cues included.
   *
   * Answers in every stopped state, not only mid-clip — that used to be the
   * whole bug: `!this.buffer` bailed after `stop()` had thrown the buffer
   * away, at rest, mid-load, after a tap, after Home, after the tour ends.
   * Two paths now:
   *   - The clip is still decoded — playing, paused, or ended with an
   *     invite still open (`finish()` never tears down; only `stopSource()`
   *     runs there) — so this reseeks the existing buffer with no network
   *     trip, exactly as before.
   *   - It is not: `stop()`'s `teardown()` cleared `clip`/`buffer`, or
   *     nothing has ever played. `lastClip` survives `teardown()` for
   *     exactly this moment, so this re-issues a full `play()` for it — the
   *     same fetch-and-decode a fresh beat would need, resolved once it is
   *     audible again. A true no-op only when there is no `lastClip` at all
   *     (nothing has ever played this session — nothing to repeat) or when
   *     the exact clip being asked for is already mid-load (it will start
   *     from the top regardless, once that load resolves).
   */
  async replay(): Promise<void> {
    if (this.hasBuffer) {
      this.stopSource()
      this.cursor = 0
      this.offset = 0
      this.setWord(-1)
      void this.resumeContext()
      this.duck()
      this.startFrom(0)
      this.tick()
      this.onAgain?.()
      return
    }
    const clip = this.lastClip
    if (!clip) return                // nothing has ever played: a true no-op
    if (this.clip === clip) return   // already loading this exact clip
    await this.play(clip)
    this.onAgain?.()
  }

  /** 1 for normal, 0.85 for the "slower" button. */
  setRate(rate: number): void {
    const next = Math.min(1, Math.max(SLOWEST, rate))
    if (next === this.rate) return
    const at = this.position
    if (!this.src) {
      this.rate = next
      this.offset = at
      // Paused: `endedAt` is already null, and stays null — the clock stays
      // frozen at `offset`, same as before. Ended: re-anchor to now, or the
      // next `position` read would double-count everything that elapsed
      // between this call and that read (`offset` already includes it;
      // `endedAt` would still be pointing at the old anchor otherwise).
      if (this.endedAt !== null) this.endedAt = this.ctx.currentTime
      return
    }
    // One-shot node: a rate change is a fresh node from the same position.
    // The new rate lands only after stopSource(), which recomputes the offset
    // off the clock and would otherwise read it back at the wrong rate.
    this.stopSource()
    this.rate = next
    this.startFrom(at)
    this.tick()
  }

  /** Stop the clip. Unlike `forget()` below, `replay()` WILL bring it back —
   *  `lastClip` survives this, on purpose, for a tap and the tour's own
   *  natural end alike. */
  stop(): void {
    this.teardown()
    this.curWord = -1
    this.unduck()
    this.emit()
  }

  /**
   * Forget the last clip too, so `replay()` has nothing left to answer
   * with. NOT part of `stop()` — a tap and the tour's own end both still
   * want `lastClip` to survive, and this is for the one caller that means
   * something stronger than "nothing is playing right now": Home's own
   * promise is "back to the very beginning," and a "Say it again" that
   * quietly resurrected whatever was last said — with no beat on screen,
   * no words lighting up, no visible cause — would contradict that promise
   * rather than honour it. Call this alongside `stop()`, never instead of
   * it. A no-op, without even an `emit()`, when there is nothing to forget.
   */
  forget(): void {
    if (this.lastClip === null) return
    this.lastClip = null
    this.emit()
  }

  /** Tear the current clip down without touching the ambient bed, so that
   *  moving straight from one line to the next does not pump the bed up and
   *  back down between them.
   *
   *  Deliberately does NOT clear `lastClip` — see its own declaration.
   *  `replay()` exists to answer after exactly this call. */
  private teardown() {
    this.stopSource()
    // A line is on its way in; the bed must not rise between the two.
    this.cancelSettle()
    this.clip = null
    this.buffer = null
    this.cues = []
    this.starts = []
    this.cursor = 0
    this.offset = 0
    this.endedAt = null
    this.loadingFlag = false
    // Whatever a beat on its way out was still waiting to hear from the
    // clock, it is not going to be this engine's clock any more: `stop()`
    // and the `play()` about to follow it both mean "that clip is gone," and
    // a target computed against its own timeline must not fire into
    // whatever plays next. Every legitimate caller (`Reveal`'s own effect
    // cleanup, `useStageLife`'s `stop`) already cancels its own
    // registration too — this is defence in depth, not the only guard.
    this.scheduled.clear()
  }

  private startFrom(offset: number) {
    if (!this.buffer) return
    const s = this.ctx.createBufferSource()
    s.buffer = this.buffer
    s.playbackRate.value = this.rate
    s.connect(this.narr)
    s.onended = () => { if (this.src === s) this.finish() }
    this.offset = offset
    this.startedAt = this.ctx.currentTime
    this.endedAt = null
    this.src = s
    s.start(0, offset)
  }

  private stopSource() {
    const s = this.src
    if (!s) return
    this.offset = this.position   // read before src goes null
    this.src = null
    // Null onended BEFORE stop(), or stop() re-enters the finish logic in the
    // middle of a seek and tears down the node we are about to replace.
    s.onended = null
    try { s.stop() } catch { /* already stopped */ }
    try { s.disconnect() } catch { /* already disconnected */ }
    if (this.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  /** The clip ran to its natural end. */
  private finish() {
    const clip = this.clip
    this.stopSource()
    if (clip) this.offset = clip.duration
    // From here, media time IS real time: there is no more "rate" to scale
    // by once nothing is playing. A `scheduleAfter` target past this point
    // (Task 3's `invite.min` extension) still has to keep counting down,
    // rather than freeze here the way a genuine pause does — see
    // `position`'s own note.
    this.endedAt = this.ctx.currentTime
    // Not unduck(): the tour's next beat is usually milliseconds away.
    this.settle()
    this.curWord = -1
    this.emit()
    this.onEnd?.()
    // A pending `scheduleAfter` may still be waiting on time that only
    // starts moving again from here — nothing else is going to restart the
    // loop that polls it.
    this.schedule()
  }

  // ------------------------------------------------------------------- clock

  /**
   * Media-time seconds, off the audio hardware clock.
   *
   * Never `HTMLAudioElement.currentTime` (Firefox quantises it to 2 ms, and to
   * 100 ms under resistFingerprinting) and never `performance.now()` or summed
   * rAF deltas, which drift against the audio clock over a 60-second clip.
   *
   * Three states, not two:
   *  - PLAYING (`src` set): the clock runs at `rate` — this is the branch
   *    `setRate` exists to change.
   *  - PAUSED (`src` null, `endedAt` null): frozen at `offset`. This is the
   *    branch that makes `pause()` actually stop a hold's countdown rather
   *    than merely slow it — nothing here advances no matter how much real
   *    time passes.
   *  - ENDED (`src` null, `endedAt` set by `finish()`): real, un-rate-scaled
   *    time since the clip finished. A `hold` can reach past the clip's own
   *    end (Task 3's `invite.min` extension — `scripts/lib/words.mjs`'s
   *    `cueTimes`), and once nothing is playing there is no more "rate" to
   *    scale that overhang by — the same real-time span `GrandTour`'s own
   *    invite floor/cap timers already assume for it.
   */
  get position(): number {
    if (this.src) return this.offset + (this.ctx.currentTime - this.startedAt) * this.rate
    if (this.endedAt !== null) return this.offset + (this.ctx.currentTime - this.endedAt)
    return this.offset
  }

  get word(): number { return this.curWord }
  get playing(): boolean { return this.src !== null }
  /** A clip has been asked for and there is nothing to play it with yet —
   *  see `loadingFlag`'s own note. Reactive, through the same `emit()` as
   *  everything else here: read it as
   *  `useSyncExternalStore(n.subscribe, () => n.loading)`, never polled. */
  get loading(): boolean { return this.loadingFlag }
  /** Whether `replay()` has anything at all to act on — `hasBuffer` (mid-
   *  clip, paused, or ended with an invite still open) or, failing that,
   *  `lastClip` (a stopped state `replay()` would still fall back to).
   *  Shares `hasBuffer` with `replay()`'s own fast-path check rather than
   *  re-deriving it — see that getter's own note. False only at rest,
   *  before anything has played, and after `forget()` — Controls disables
   *  "Say it again" rather than leaving it to silently no-op, the same
   *  rule `loading` already applies to Play/Pause. */
  get canReplay(): boolean { return this.hasBuffer || this.lastClip !== null }

  /** One scheduler step. Public so tests can drive it by hand; production
   *  drives it from requestAnimationFrame. */
  tick = (): void => {
    const p = this.position

    // A while loop, not a find: when one frame runs long — GC, layout — several
    // cues fall due at once, and every one of them must still fire, in order.
    while (this.cursor < this.cues.length && this.cues[this.cursor].t <= p) {
      const cue = this.cues[this.cursor++]
      try { this.onCue(cue) } catch { /* a broken effect must not stop the clock */ }
    }

    let w = this.curWord
    while (w + 1 < this.starts.length && this.starts[w + 1] <= p) w++
    if (w !== this.curWord) { this.curWord = w; this.emit() }

    // Same reasoning as the cue loop above: every request due by now runs,
    // in whatever order the set holds them, and a callback that throws must
    // not take the others down with it.
    for (const entry of this.scheduled) {
      if (entry.target <= p) {
        this.scheduled.delete(entry)
        try { entry.cb() } catch { /* a broken effect must not stop the clock */ }
      }
    }

    this.schedule()
  }

  private schedule() {
    if (typeof requestAnimationFrame !== 'function') return
    // Nothing to poll for: no audio playing, and nothing waiting on the
    // clock either. `scheduleAfter` is the only other thing that arms this
    // loop while `src` is null — a hold still counting down after the
    // clip's own natural end (see `position`'s own note).
    //
    // Every caller today is cue-driven, so this only ever runs while `tick`
    // is already looping for a clip that is playing or has just ended. A
    // `scheduleAfter` call made from genuinely idle state — nothing playing,
    // nothing having ever ended — would still arm this and keep a per-frame
    // rAF loop alive UNTIL SOMETHING CANCELS IT, since `position` there is
    // just the frozen `offset` and its target can never be reached on its
    // own. Not reachable by anything in this codebase today; worth knowing
    // before the next caller assumes otherwise.
    if (!this.src && this.scheduled.size === 0) return
    // Only ever one loop, however many times tick() is called by hand.
    if (this.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(this.tick)
  }

  /**
   * Run `cb` once at least `seconds` of MEDIA time have passed from right
   * now — scaled by the current rate while playing, frozen for as long as
   * `pause()` holds, and real, un-rate-scaled wall time for any of it that
   * falls after the clip's own natural end. See `position`'s own note for
   * why those are three different clocks and not one.
   *
   * The seam that lets a timed effect stop owning a wall-clock `setTimeout`
   * of its own: `Reveal.tsx`'s hold, and `GrandTour.tsx`'s Mor and
   * highlight-release timers, all use this instead. Piggybacks on the same
   * per-frame loop that already drives cues and the read-along word
   * (`tick`) rather than a timer of its own — `schedule()` keeps that loop
   * alive for as long as anything is playing OR anything is still
   * scheduled, and lets it stop the moment neither is true.
   *
   * Returns a cancel function — idempotent, and safe to call after `cb` has
   * already run.
   */
  scheduleAfter = (seconds: number, cb: () => void): (() => void) => {
    const entry = { target: this.position + Math.max(0, seconds), cb }
    this.scheduled.add(entry)
    this.schedule()
    return () => { this.scheduled.delete(entry) }
  }

  private setWord(w: number) {
    if (w === this.curWord) return
    this.curWord = w
    this.emit()
  }

  // -------------------------------------------------------- React's only seam

  /** Bound: `useSyncExternalStore(n.subscribe, n.getSnapshot, ...)` passes
   *  these unattached. */
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  getSnapshot = (): number => this.curWord

  private emit() {
    for (const fn of this.listeners) fn()
  }

  // ------------------------------------------------------------------- sound

  /** A one-shot effect. Silently does nothing when the file does not exist. */
  async sfx(name: string): Promise<void> {
    const buffer = await this.effect(name, 'sfx')
    if (!buffer) return
    const s = this.ctx.createBufferSource()
    s.buffer = buffer
    s.connect(this.fx)
    s.onended = () => { try { s.disconnect() } catch { /* gone already */ } }
    s.start(0)
  }

  /** Swap the looping ambient bed, or pass null for none. */
  async ambient(name: string | null): Promise<void> {
    if (name === this.ambientName) return
    this.ambientName = name
    this.stopAmbient()
    if (!name) return

    const buffer = await this.effect(name, 'ambience')
    if (!buffer || this.ambientName !== name) return

    const s = this.ctx.createBufferSource()
    s.buffer = buffer
    s.loop = true
    s.connect(this.amb)
    s.start(0)
    this.ambSrc = s
    // Fade in from silence to whichever level is right — the narrator may
    // already be speaking over the top of it.
    this.ramp(this.amb.gain, this.src ? DUCK : FULL, 0)
  }

  private stopAmbient() {
    const s = this.ambSrc
    if (!s) return
    this.ambSrc = null
    s.onended = null
    try { s.stop() } catch { /* already stopped */ }
    try { s.disconnect() } catch { /* already disconnected */ }
  }

  /**
   * Pull the ambient bed down under the narrator, and let it back up after.
   *
   * A GainNode, never `HTMLMediaElement.volume`: Apple's documentation is
   * explicit that volume "is not settable in JavaScript. Reading the volume
   * property always returns 1."
   */
  private duck() { this.cancelSettle(); this.ramp(this.amb.gain, DUCK) }
  private unduck() { this.cancelSettle(); this.ramp(this.amb.gain, FULL) }

  /** Let the bed back up, but only once we are sure nothing follows. Any
   *  duck() — a new line, a resume, a replay — cancels the pending rise, so a
   *  continuous sequence holds one steady level from first word to last. */
  private settle() {
    this.cancelSettle()
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      this.unduck()
    }, SETTLE_MS)
  }

  private cancelSettle() {
    if (this.settleTimer === null) return
    clearTimeout(this.settleTimer)
    this.settleTimer = null
  }

  /** 0..1. The child's sound button; also the mute toggle. */
  setVolume(v: number): void {
    this.ramp(this.master.gain, Math.min(1, Math.max(0, v)))
  }

  /** `from` defaults to wherever the parameter is right now. Anchoring with
   *  setValueAtTime is not optional: without it a linear ramp starts from the
   *  last *scheduled* event instead of the audible value, and jumps. */
  private ramp(param: AudioParam, to: number, from = param.value) {
    const now = this.ctx.currentTime
    param.cancelScheduledValues(now)
    param.setValueAtTime(from, now)
    param.linearRampToValueAtTime(to, now + RAMP)
  }

  // ------------------------------------------------------------------ buffers

  /** Decode ahead — call with the next clip only; the cache holds two. */
  async prefetch(clips: Clip[]): Promise<void> {
    // Sequential: decoding is expensive on an A8X and three at once starves
    // the frame we are trying to keep smooth.
    for (const clip of clips) await this.load(clip)
  }

  /** Drop the decoded audio for clips we are finished with. */
  evict(clips: Clip[]): void {
    for (const clip of clips) this.decoded.delete(assetUrl(clip.audio))
  }

  get decodedCount(): number { return this.decoded.size }

  private async load(clip: Clip): Promise<AudioBuffer | null> {
    const url = assetUrl(clip.audio)
    const hit = this.decoded.get(url)
    if (hit) {
      this.decoded.delete(url)   // re-insert: Map iterates in insertion order,
      this.decoded.set(url, hit) // so oldest-first is our LRU order
      return hit
    }
    const buffer = await this.fetchAndDecode(url)
    if (!buffer) return null
    this.decoded.set(url, buffer)
    while (this.decoded.size > MAX_DECODED) {
      const oldest = this.decoded.keys().next().value
      if (oldest === undefined) break
      this.decoded.delete(oldest)
    }
    return buffer
  }

  private async effect(name: string, kind: 'sfx' | 'ambience'): Promise<AudioBuffer | null> {
    const entry = SOUNDS[name]
    // Not in the manifest means the file was never fetched. Silence.
    if (!entry || entry.kind !== kind) return null
    const url = assetUrl(entry.file)
    const cached = this.effects.get(url)
    if (cached !== undefined) return cached
    const buffer = await this.fetchAndDecode(url)
    this.effects.set(url, buffer)
    return buffer
  }

  /**
   * One asset, or null. Everything is caught: `decodeAudioData` rejects with a
   * bare, message-less EncodingError on some browsers, and a single bad file
   * must degrade to "no sound for this line", never a dead page.
   */
  private async fetchAndDecode(url: string): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      return await this.ctx.decodeAudioData(await res.arrayBuffer())
    } catch {
      return null
    }
  }

  /** Test seam: the ambient bed's gain, so the ducking test can read its
   *  scheduled ramps. */
  get ambientGainForTest(): GainNode { return this.amb }
}

let engine: Narrator | null = null

/**
 * The one and only engine.
 *
 * Module-scoped, never a `useRef` and never a Context. React StrictMode
 * mounts, unmounts and remounts every component in development, so a
 * `useEffect` that creates an AudioContext runs twice and its cleanup closes
 * the first. The symptom looks exactly like an iOS unlock bug and is not one.
 * Safari also caps a page at about four contexts.
 *
 * Call it lazily, from inside the unlock gesture — constructing an
 * AudioContext outside a gesture on iOS gives you a suspended one.
 */
export function getNarrator(): Narrator {
  if (engine) return engine

  const w = window as unknown as {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  const AC = w.AudioContext ?? w.webkitAudioContext
  if (!AC) throw new Error('This browser has no Web Audio.')
  engine = new Narrator(new AC({ latencyHint: 'interactive' }))

  // Coming back from the Home screen, a phone call or Siri, iOS may leave the
  // context suspended or interrupted. Ask for it back; resumeContext records
  // whether we actually got it.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return
    void engine?.resumeContext()
  })

  return engine
}
