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
  private cues: Cue[] = []
  private starts: number[] = []

  /** Media seconds already played when the current node started. */
  private offset = 0
  /** `ctx.currentTime` when the current node started. */
  private startedAt = 0
  private rate = 1
  private curWord = -1
  /** Monotonic index into `cues`. Never rewinds except on replay. */
  private cursor = 0
  private raf = 0

  private listeners = new Set<() => void>()
  /** url -> decoded clip, in least-recently-used order. */
  private decoded = new Map<string, AudioBuffer>()
  /** url -> decoded sound effect or bed. These are seconds long, not minutes,
   *  and are kept for the session. `null` records a load that failed, so we
   *  never ask for the same missing file twice. */
  private effects = new Map<string, AudioBuffer | null>()
  private ambientName: string | null = null
  private stuckFlag = false
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
   * Everything in this section exists only for `?debug=audio` (see
   * `src/audio/diagnostics.ts`). Every member is read-only: nothing here may
   * change what the engine does, only report it. A probe that could repair
   * the bug it is measuring would destroy the evidence Task 1 exists to
   * collect — that repair work is Task 2's, once the readout says which of
   * the four bugs is actually firing.
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
    this.starts = clip.starts ?? []
    // Sorted because the cue cursor only ever moves forward.
    this.cues = [...(clip.cues ?? [])].sort((a, b) => a.t - b.t)
    this.cursor = 0
    this.offset = 0
    this.setWord(-1)   // the outgoing clip's word must not linger while we decode

    await this.resumeContext()
    const buffer = await this.load(clip)
    // A newer play() landed while we were decoding; that one owns the engine,
    // including the bed.
    if (this.clip !== clip) return
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

  /** "Say it again" — the same clip from the top, cues included. */
  replay(): void {
    if (!this.buffer) return
    this.stopSource()
    this.cursor = 0
    this.offset = 0
    this.setWord(-1)
    void this.resumeContext()
    this.duck()
    this.startFrom(0)
    this.tick()
  }

  /** 1 for normal, 0.85 for the "slower" button. */
  setRate(rate: number): void {
    const next = Math.min(1, Math.max(SLOWEST, rate))
    if (next === this.rate) return
    const at = this.position
    if (!this.src) { this.rate = next; this.offset = at; return }
    // One-shot node: a rate change is a fresh node from the same position.
    // The new rate lands only after stopSource(), which recomputes the offset
    // off the clock and would otherwise read it back at the wrong rate.
    this.stopSource()
    this.rate = next
    this.startFrom(at)
    this.tick()
  }

  /** Stop and forget the clip. `replay()` will not bring it back. */
  stop(): void {
    this.teardown()
    this.curWord = -1
    this.unduck()
    this.emit()
  }

  /** Tear the current clip down without touching the ambient bed, so that
   *  moving straight from one line to the next does not pump the bed up and
   *  back down between them. */
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
    // Not unduck(): the tour's next beat is usually milliseconds away.
    this.settle()
    this.curWord = -1
    this.emit()
    this.onEnd?.()
  }

  // ------------------------------------------------------------------- clock

  /**
   * Media-time seconds, off the audio hardware clock.
   *
   * Never `HTMLAudioElement.currentTime` (Firefox quantises it to 2 ms, and to
   * 100 ms under resistFingerprinting) and never `performance.now()` or summed
   * rAF deltas, which drift against the audio clock over a 60-second clip.
   */
  get position(): number {
    return this.src ? this.offset + (this.ctx.currentTime - this.startedAt) * this.rate : this.offset
  }

  get word(): number { return this.curWord }
  get playing(): boolean { return this.src !== null }

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

    this.schedule()
  }

  private schedule() {
    if (!this.src || typeof requestAnimationFrame !== 'function') return
    // Only ever one loop, however many times tick() is called by hand.
    if (this.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(this.tick)
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
