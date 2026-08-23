# Namaste India — Plan 4: Make It Work, Round 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix what the second iPad test exposed — a tour that a child's own correct instinct destroys, an invitation with 41ms to answer it, a control that does nothing, and thirteen narration lines that teach something wrong — and land the whole content re-render in one paid pass.

**Architecture:** No new subsystems. One new module (a tour position that outlives the component), one new content field (`invite`), and one behavioural invariant written into the controls. Everything else is repair.

**Tech Stack:** Unchanged. React 19, Vite, TypeScript, `motion` from `motion/react`, Vitest.

---

## Why this plan exists

The father tested the second build with his son and reported four things. Nine agents diagnosed them and every finding was adversarially re-verified against the code. All four were real, and three were worse than described.

His words:

> *"kids tend to touch the map and when we try to play again it again starts from very beginning, kids will touch the map so we should not again start."*
>
> *"it did not give anytime to trace which the lady mentions and swicthes quickly to next and if we touch next nothing happens and then everything starts from the beginning."*
>
> *"you mention Delhi as somewhere all people come to work. Its not correct."*

**His decisions, already made, which this plan implements and does not re-open:**

1. A **deliberate tap** (down and up, no drag) still leaves the tour and flies to that state; the tour remembers where it was and offers "Carry on". An accidental brush or an attempted scroll is ignored entirely.
2. The trace invitation waits **as long as he is tracing** — floor 6s, extended while a finger is on the corridor, ends ~2.5s after lift, hard cap 25s.
3. All **13 narration fixes** land in one render.

---

## Global Constraints

Every task's requirements implicitly include this section.

### Carried forward

- Node 23+, ESM. `erasableSyntaxOnly`: no enums, no namespaces, no constructor parameter properties. No Node APIs in `src/`.
- `motion` from `motion/react` only. `useReducedMotionConfig()`, never `useReducedMotion()`.
- Never a leading-slash asset path. Vite `base: './'` with `HashRouter`.
- **Never transform an SVG `<g>`; never animate `viewBox` frame by frame.** WebKit's legacy SVG engine cannot give an SVG child a compositor layer.
- **No SVG `<filter>` anywhere.** WebKit blurs on the CPU in three passes.
- `pointer-events: fill` on hit-layer children — it sets `canHitStroke=false` and skips `CGPathCreateStrokedPath`.
- Touch targets 104 CSS px for anything the child taps.
- Cues address a **word index**, never a timestamp. Re-rendering narration must never break an animation.
- Nothing on the cue or beat path may throw.
- **jsdom does no hit testing and no layout.**
- **Build for reuse:** the 32 per-state screens are the next plan. A fix that only works for the tour is the wrong fix.

### New, and earned the hard way

- **A test double must be faithful to the real interface it stands in for.** This project has now shipped **four** doubles too incomplete to catch the thing they stood in for: a `useState` mutant survived a missing `act()`; a viewport whose aspect ratio made pass and fail identical; a `matrixTransform` that ignored its matrix; and — the reason Task 4 below exists — `replay` stubbed as an inert `vi.fn()` in **both** `Controls.test.tsx:12` and `GrandTour.test.tsx:119`, which is precisely why 545 green tests never noticed that "Say it again" does nothing. When a double stands in for the thing under test, it must be able to fail.
- **No control may be pressable and produce no observable effect.** `Controls.tsx:6-17` already makes this argument for the play button and fixes it there. The same argument was never applied to the other buttons. Write the invariant into the file.
- **Timed visuals run on the media clock, not the wall clock.** A `setTimeout` measured in wall milliseconds against audio that plays at a variable rate, and that can be paused, will drift and will fire against a stopped clock.
- **Verification must measure size, not only position.** `tour:strip` ran clean through a 2.5× shrink of the tour's headline moment in Plan 3. It asserts where things are and when; it never asserts how big.

### Measured numbers this plan is built on

| Finding | Measurement |
|---|---|
| Room to answer "trace the edge with your finger" | **0.041 s** |
| Finger travel for one lap of the coast | 49 cm portrait / 27 cm landscape |
| Map area that ends the tour on touch | **100%** — 0.00% dead across 41,050 sample points |
| Narration discarded by one touch at beat 9 | 2 m 17 s of a 4 m 05 s tour |
| "Say it again" after a map touch | 0 source nodes, 0 fetches, 0 emits |
| Ladakh's rank among the 36 shapes, while called a "smaller piece" | **7th largest** — bigger than 21 of the 28 states |
| Art lead-out at rate 0.85 | art gone **2.3 s before** the instruction finishes |
| Narration lines with a factual defect | **13** (2 wrong, 2 misleading, 9 imprecise) |
| Tour length the docstring claims / actually is | 2:41 / **4:05** |

---

## File Structure

| Path | Change |
|---|---|
| `content/tour.json`, `content/places/*.json` | The 13 corrected lines; `invite` on tour.02 |
| `content/schema.ts` | `invite: { gesture, min, max }` on the line schema |
| `src/tour/tourPosition.ts` | **New.** A parked beat that outlives the component |
| `src/tour/GrandTour.tsx` | Park on exit, prefer the park on entry, "Carry on", dwell timer |
| `src/map/MapStage.tsx`, `src/map/hitLayer.ts`, `src/map/map.css` | Tap gesture gate; disarm during an invite; the credit link |
| `src/ui/Controls.tsx` | Every control does something; a loading state |
| `src/audio/Narrator.ts` | `lastClip` survives teardown; media-clock scheduling |
| `src/tour/effects/Reveal.tsx` | Holds run on the media clock |
| `scripts/lib/words.mjs`, `scripts/tts.mjs` | Carry `invite`; runs + continuity; the `tts:draft` guard |
| `docs/fact-check.md` | Three rows currently sign off wording the shipped text no longer matches |

---

## Task 1: Correct the thirteen narration lines

**Files:** `content/tour.json`, `content/places/{delhi,rajasthan,kerala}.json`, `docs/fact-check.md`
**Test:** `content/schema.test.ts`, `scripts/build-map.test.mjs` (cue-index assertions)

**Why first.** It is the owner's stated top-ranked failure — accuracy outranks everything — and his son has already come away from `tour.05` believing Delhi is a place people travel to for work. It also blocks nothing, touches no architecture, and can run alongside every other task here.

**Text only. Render nothing.** Task 6 does the single paid pass.

**The two that are wrong:**

- **`tour.05`** — *"Every country has one city where the people who run it come to work. In India that city is New Delhi."* Three faults: the word **capital** never appears, which is the word the father asked for by name in the original brief; "every country has one city" is false (South Africa has three capitals, Bolivia two); and "come to work" is exactly the reading his son took. Replace with: *"Every country has a capital city, where its leaders make the rules. India's capital is New Delhi. It sits inside a bigger place called Delhi."* That last sentence also resolves the Delhi/New Delhi distinction the father raised, and matches what `zoomTo delhi` actually flies to.
- **`tour.04`** — *"Those are smaller pieces."* Measurably false and contradicted by the map on screen: by shoelace area over `src/data/geo.json`, Ladakh is the **7th largest of the 36 shapes** (18,821 sq units against Rajasthan's 37,186), bigger than 21 of the 28 states. Replace with *"Those are pieces of a different kind"* — which is the true distinction and the one beat 4 is actually about.

**The two that are misleading:** `delhi.intro` (*"Haryana wraps around it"* — Delhi has two neighbours; `geo.json` gives `["haryana","uttar-pradesh"]`, and the Kerala and Odisha intros already use the corrected phrasing) and `rajasthan.card.hello` (Khamma Ghani is an **honorific** for elders and guests per the project's own `docs/fact-check.md:54`, not "when you are really pleased to see somebody" — and the language is never named).

**The nine imprecise:** `tour.03`, `tour.14`, `tour.10`, `delhi.card.festival`, `rajasthan.intro`, `rajasthan.chand-baori.line`, `delhi.humayuns-tomb.line`, `kerala.card.animal`, `kerala.card.hello`. Each has a specific replacement in the diagnosis output; use it, and keep every replacement close to the original length so the narration's rhythm survives.

- [ ] **Step 1: Write the failing test.** Assert the corrected text for all 13 lines, and — separately — that every cue's word index still lands on the word it names. `tour.05`'s wording changes length: `zoomTo delhi` moves 19 → 24 and `revealSymbol india-gate` 36 → 40 against the suggested 42-word text. Recompute against whatever you actually write; do not copy those numbers on trust. `tour.04`'s cues at words 4 and 5 and `delhi.intro`'s `lightNeighbour` at word 41 do not move.
- [ ] **Step 2: Run, fail, edit the content, pass.**
- [ ] **Step 3: Update `docs/fact-check.md`.** Three rows currently sign off wording the shipped text no longer matches — a fact-check that certifies text nobody is saying is worse than none.
- [ ] **Step 4: `npm run validate` clean. Commit.**

---

## Task 2: A touch must not destroy the tour

**Files:** `src/tour/tourPosition.ts` (new), `src/tour/GrandTour.tsx`, `src/tour/TourStage.tsx`, `src/map/MapStage.tsx`, `src/map/map.css`, `src/tour/GrandTour.test.tsx`

**The defect, in one line.** `src/tour/GrandTour.tsx:420` is `setAt(null)`. `at` is the only thing in the app that knows which of the fourteen beats is playing, it is plain component state, and both ways back in — `start()` at `:379` and `playPause()` at `:392` — are hardcoded to beat 0.

**The father's decision:** a deliberate tap still leaves the tour and flies to that state, the tour remembers where it was, and an accidental brush or attempted scroll is ignored.

**Interfaces:**
- New module `tourPosition.ts`: `park(beat: number): void`, `parked(): number | null`, `clearPark(): void`. **It must live outside the component.** Component state provably fails: unmount at beat 5 → remount → "Show me India" → beat 1, and that path is reachable *today* through the map's own credit link (`MapStage.tsx:189`; `map.css:195` gives it `pointer-events: auto`) to `#/credits` and back via `Credits.tsx:101`.
- `GrandTour` gains a third big-button label — **"Carry on"** — beside "Show me India" and "Show me again".

**Two joined halves, and the scoping the verifier corrected:**

**2a — gate the gesture.** The pick fires on **`pointerdown`** (`MapStage.tsx:148`) with no movement threshold, so the first frame of a drag counts. Require a real tap: pointerdown then pointerup, same pointer, movement under a small threshold, within a sane time. This alone removes the accidental case, and it is uncontroversial — nobody wants a scroll attempt to end the tour.

**2b — park, on every exit, not just `pick`.** The defect is **not** `pick`-specific, and a fix inside `pick` would leave two other amnesiac paths. All three null `at`: `pick` (`:420`), `goHome` (`:404` — measured: Home, then bar Play, plays tour.01), and the unmount cleanup (`:283`). Park in `pick` and on unmount; **clear** the park in `goHome` (home is documented as the beginning) and in `end` (`:289-301`, completion is completion). Both entries prefer the park over zero.

**Resume the parked beat from its first word**, not the exact millisecond — the father's third decision. Note the verifier's correction to the original diagnosis: this does **not** need a new engine verb. `pause()`/`resume()` already preserve position (measured: >2.9s of a 3s play). The obstacle is the sequencer effect at `:307-369`, which is keyed on `at` and unconditionally calls `n.play()`, tearing down and restarting. Restarting the sentence is also kinder to a distracted child.

**While you are here:** make `.credit__more` inert during a beat, or park before it navigates. It is a live route-change hole in the middle of the map.

- [ ] **Step 1: Write the failing tests.** None of these exist today. Tap at beat N → bar Play resumes beat N. Big button reads "Carry on". Unmount at beat N → remount → "Carry on" → beat N. Home clears the park. Natural completion clears the park. A drag across the map does not pick. A tap on the credit link does not silently lose the beat.
- [ ] **Step 2: Run, fail, implement, pass.**
- [ ] **Step 3: Rewrite the test that encodes the old behaviour.** `GrandTour.test.tsx:202` ("lets a tap on a state abandon the tour") and `:212` assert the stop and were correct when written; the docstring at `:29-31` says *"a tap anywhere on the map ends the tour at once. THE TOUR IS AN OFFER, NEVER A CAGE."* That intent survives — a deliberate tap still leaves. **Rewrite both tests and the docstring deliberately to say what is now true. Do not delete them.**
- [ ] **Step 4: Fix the stale docstring at `:22`** while you are in the file: it says the tour is 2:41; summing `duration` over the 14 tour clips gives **244.58s = 4:05**. That wrong number has already been copied into one diagnosis as though measured.
- [ ] **Step 5: Consider restoring the light-up the father originally asked for.** His brief for this whole project said: *"when the voice says the capital of India is New Delhi, the animation can light up that place and then bring forwards expanding Delhi."* The corrected `tour.05` now flies at word 24 (*"...a bigger place called Delhi"*), which lands well — the flight begins and *"Hold on, we are flying there now"* narrates it. But **nothing happens at word 16, where he actually hears "New Delhi"**, so the light-up half of that brief is still missing. Adding a `highlightState: delhi` cue at word 16 costs one line of content and **no re-render** — cues are resolved from timings, not baked into audio. Do it if it reads well; say so either way.

- [ ] **Step 6: Full suite, commit.**

---

## Task 3: Give him time to trace

**Files:** `content/schema.ts`, `content/tour.json`, `scripts/lib/words.mjs`, `scripts/tts.mjs`, `src/types.ts`, `src/tour/GrandTour.tsx`, `src/tour/TourStage.tsx`, `src/tour/effects/Trace.tsx`, `src/tour/effects/art/Outline.tsx`, `src/map/MapStage.tsx`

**The defect, measured.** `4.145 + 15.865 = 20.010` against a clip duration of `20.0098`. The invitation to trace ends **0.041 s** before the audio does, the outline's hold expires at that same instant, and the overlay sweeps 350ms later. Nothing in the app can hold a beat open past its audio — advance is chained directly on the narrator's `onEnd`.

**The father's decision:** wait as long as he is tracing. Floor 6s, extended while a finger is on the corridor, ends ~2.5s after lift, hard cap 25s.

**Interfaces:**
- `content/schema.ts:42-67` gains an optional `invite: { gesture: string, min: number, max: number }` on the line schema, carried through `scripts/tts.mjs` and `scripts/lib/words.mjs` onto the built `Clip` (`src/types.ts:28-35`). **Not** a hardcoded "beat 2 is special" — the next plan wants this field roughly 32 more times.
- The tracing gesture publishes whether a finger is currently down, read with `useSyncExternalStore` exactly as `GrandTour` already reads `n.playing`.

**Four parts:**

1. **Author the room in content**, per the interface above. Beat 2 gets `invite`.
2. **Put the gap in the sequencer.** `GrandTour.tsx:313-318`'s `advance()` becomes a scheduled advance: `n.onEnd` arms a ref-held timer and only then advances. **Clear it from every path that abandons a beat** — the beat effect's existing cleanup at `:365-368`, `pick` (`:418`), `goHome` (`:401`), `end` (`:289`), `playPause` (`:389`) — **and from replay**, which has no seam today; that is Task 4's dependency and the reason Task 4 comes after this one in the file but must land with it. The two failure paths at `:344` and `:351` bypass the gap entirely: a 404 is not an invitation. Keep the existing `live` guard so a fired timer cannot advance a torn-down beat.
3. **Let the art outlive the audio.** `words.mjs:208`'s `Math.min(next.cue.t, duration)` must become `duration + invite.min` for a beat's final art cue, or the tour holds open on a blank map — which is the same bug in a new costume.
4. **Disarm the map for the duration of the invite.** Without this, the task ships a ten-second window in which defect #2 fires *more* often than today. At minimum drop the `SNAP_PX = 60` sea-snap fallback while inviting; better, treat any touch inside the map as tracing during an invite.

**One correction to carry:** `TOLERANCE = 40` in `Trace.tsx:111` is a **perpendicular half-width**, so the usable corridor is 80 viewBox units — about **9.6 mm** in portrait and 5.3 mm in landscape, not the ~5 mm and ~3 mm an earlier analysis claimed. Trace's own brief says it should reward roughness, not accuracy; widen it if the device test says so, but start from the real number.

- [ ] **Step 1: Write the failing tests.** After tour.02's last word the outline is still mounted and the corridor still live for at least the floor; the dwell extends while a finger is down and ends after lift; the hard cap fires; a pointerdown anywhere on the map during the window does not null `at`; and **no pending advance timer survives pick, home, pause, replay or unmount** — that last one is where this task will leak if it leaks.
- [ ] **Step 2: Run, fail, implement, pass.**
- [ ] **Step 3: Check the gate that could make this all moot.** `art/Outline.tsx:40` mounts `Trace` only when `!isCheap()`. On an iPad that has latched slow, the gesture never mounts at all, every coastal touch becomes a tour-ending pick, and no amount of waiting helps. Establish what `isCheap()` actually returns on the target device — Task 7 surfaces it in the debug panel for exactly this reason.
- [ ] **Step 4: Full suite, `tour:strip`, commit.**

---

## Task 4: No control may be pressable and do nothing

**Files:** `src/audio/Narrator.ts`, `src/ui/Controls.tsx`, `src/tour/GrandTour.tsx`, `src/ui/Controls.test.tsx`, `src/tour/GrandTour.test.tsx`, `src/audio/Narrator.test.ts`

**The defect.** "Say it again" (↺) is a hard no-op in **every** stopped state — at rest, mid-load, after a map tap, after Home, after the tour ends. `Controls.tsx:94` calls `n.replay()` directly, and `replay()` bails on `!this.buffer`, which `stop()` → `teardown()` nulled. Measured: **0 source nodes, 0 fetches, 0 emits.** This is the button the father pressed when he said *"if we touch next nothing happens."*

There is a second, independent window: during `play()`'s await the engine has a clip but no buffer and `playing` is false, so the bar reads "▶ Play" while a beat is in flight and **both** transports are dead. Real on beat 1, which is never prefetched, and on any prefetch miss.

**Why 545 tests missed it.** `Controls.test.tsx:12` and `GrandTour.test.tsx:119` both stub `replay` as an inert `vi.fn()`. The double could not fail. **This is the fourth time in this project** — see Global Constraints.

**Interfaces:**
- Preferred seam is engine-side: keep a `lastClip` alive through `teardown()` so `replay()` answers in every state, app-wide. The 32 state screens will hit this too.
- Add the `onAgain` prop regardless — the screen must know a replay happened so it can cancel Task 3's pending dwell timer. `Controls.tsx:6-17` already argues that only the screen knows what "play" means when nothing is loaded; the identical argument applies to "again" and was never made.
- Publish a `loading` state so the bar can render it instead of a lying "Play".

- [ ] **Step 1: Fix the doubles first, and watch the existing tests go red.** Before writing a line of production code, make `replay` in both doubles behave like the real thing. If nothing fails, the doubles are still wrong.
- [ ] **Step 2: Write the failing tests.** `Narrator.test.ts`: replay-after-stop and replay-during-load. And one screen-level test against the **real** engine: tap the map, then press every control in the bar and assert an observable effect for each. That test is the invariant.
- [ ] **Step 3: Run, fail, implement, pass.**
- [ ] **Step 4: Write the invariant into `Controls.tsx`** as a comment beside the existing play-button argument, so the next person adding a button knows the rule.
- [ ] **Step 5: Commit.**

---

## Task 5: Timed art must run on the media clock

**Files:** `src/tour/effects/Reveal.tsx`, `src/audio/Narrator.ts`, any other effect that hardcodes `setTimeout`

**The defect.** `Reveal.tsx:105-106` schedules holds with plain `setTimeout` in wall milliseconds, while cues fire on rate-scaled media time. At rate 0.85 the beat-2 outline is fully gone at wall 21.19s, but *"…with your finger"* does not finish until wall 23.49s — **the art leaves 2.3 seconds before the instruction ends.** Pause is worse: the hold keeps running against a stopped clock, so the picture vanishes while nothing is playing.

**Why this matters more than its size.** The two controls that trigger it — slow down, and pause — are exactly what a parent reaches for when the child needs *more* time. The app currently punishes the correct parental instinct. It also silently undoes Task 3: an authored ten-second invite is worthless if the art it invites you to touch is scheduled against a clock that does not stop.

**Interfaces:** the narrator exposes a media-clock scheduler, or a tick effects can subscribe to. Effects stop owning wall-clock timers.

- [ ] **Step 1: Write the failing tests.** At rate 0.85 the art is still mounted when the last word of its clip finishes. Across a pause, the hold does not advance. Both must fail against today's code.
- [ ] **Step 2: Run, fail, implement, pass.**
- [ ] **Step 3: Re-run `tour:strip` at the default rate** to confirm nothing regressed at rate 1.0.
- [ ] **Step 4: Commit.**

---

## Task 6: One paid render — continuity and the corrected text together

**Files:** `scripts/tts.mjs`, `scripts/tts-providers/elevenlabs.mjs`, `scripts/tts-providers/say.mjs`, `scripts/lib/cache.mjs`

**This task absorbs Plan 3's Task 7 and must run last.** Both that task and Task 1 here require re-rendering narration. Doing them separately would pay twice and would render the corrected text through the un-chained pipeline, reintroducing the very seam the continuity work exists to remove.

**Order within the task is a hard constraint:** every code change that affects timing must already be landed. Cue anchoring makes re-render safe for *cues*, because they address word indices — it does not cover hand-tuned constants, and this project has already been bitten by exactly that.

**6a — close the `tts:draft` footgun. Do this first; the hazard is live now.** `npm run tts:draft` runs `--provider=say`; the cache key folds in the provider signature, so all 73 lines miss, and the `--yes` gate at `tts.mjs:95-105` sits **inside** `if (providerName === 'elevenlabs')` — so there is no prompt at all. It overwrites every paid clip with the macOS robot voice, and because `say` returns no alignment, `estimateTimings` also rewrites every `starts[]` array, destroying the baseline that would have proved the damage.

The fix is **not** "prompt whenever anything renders" — `--force` is a user explicitly asking, and existing tests depend on it working unprompted. Enforce the narrower invariant: *refuse to silently overwrite clips a different provider produced.* Persist the provider signature as a sidecar cache key (verify nothing iterates the cache treating every key as a line id); when it differs from the current one and clips exist on disk, require `--yes`. A fresh tree must prompt for nothing.

**6b — prosodic continuity.** `synth()` posts only `{ text, model_id, voice_settings }`. The fourteen tour beats are one continuous four-minute read split into fourteen unconditioned requests, rendered through a pool of 4 in queue order, so consecutive beats are frequently generated concurrently by unrelated requests. That is the tone drift.

- **Runs.** `collectLines()` becomes `collectRuns()`. `content/tour.json`'s `beats` array is the **only** multi-line run, because `GrandTour` chains it on `onEnd`. Every place intro, card line, landmark line and UI line is a run of one — nothing plays them consecutively, and conditioning a card line on an intro would make an independently-tapped line open like the continuation of a sentence the child never heard. **Derive the grouping from the content**, so the next plan's 32 places inherit runs-of-one for free.
- **Forward pass only.** Send `previous_request_ids` (up to 3, most recent last) and `next_text`. Do **not** send `previous_text` alongside the ids — it is ignored. Do **not** build `next_request_ids` — it needs ids that do not exist yet and it suppresses `next_text`.
- **Serial within a run, parallel across runs.** Move the pool of 4 from lines to runs. Conditioning requires the previous request to have completed, so a chain is inherently serial.
- **Chain the cache key:** `key_i = sha256(signature + text_i + '|' + nextText_i + '|' + key_{i-1})`. Say plainly in the preflight that the 14 beats are one atomic unit: editing beat 3 re-renders 3 through 14. Keep the chaining marker out of single-line runs so the other 9,185 characters stay cached.
- **Run-aware `--only`.** `--only=tour.07` must widen to the whole run or error; rendering one member alone reintroduces the seam. Store `{ key, requestId, renderedAt }`; reuse ids only under 2 hours old, else restart the run from its first line.

**Cost.** The 13 corrected lines are 2,587 characters ≈ **$0.26**. Worst case for the chained tour run (editing beat 1) is 2,428 characters ≈ **$0.24**. `tour.05` and `tour.04` are both inside the tour run, so expect the whole run. Budget **under $0.60**, and never render without the preflight and `--yes`.

- [ ] **Step 1: Write the failing tests.** Provider-change guard (changed provider with existing clips exits without `--yes`; same run with `--yes` proceeds; `--force` on an unchanged provider unaffected; a fresh tree prompts for nothing). Runs derived from content. Serial within a run. Ids threaded and capped at 3. `previous_text` never sent alongside ids. Cache chaining. `--only` widening. Id expiry. **Mock `fetch`; make no paid call.**
- [ ] **Step 2: Run, fail, implement, pass.**
- [ ] **Step 3: Dry preflight, and show the number before spending it.** Report the character count and dollar figure. Only then `--yes`.
- [ ] **Step 4: Settle the undocumented billing question.** It is not documented whether `previous_text`/`next_text` characters are billed. Compare the `character-cost` sum against the preflight estimate and record the answer.
- [ ] **Step 5: Diff `timings.json`.** Word arrays must be byte-identical **except** for the 13 corrected lines, where they must match the new text. Only `duration`, `starts`, `ends` and derived `hold`s may move elsewhere. A word array changing on an untouched line means something is wrong with the text, not the audio.
- [ ] **Step 6: Listen to the whole tour, start to finish.** The only real test for the thing being fixed. The seams between beats should be inaudible.
- [ ] **Step 6b: Turn the strip gate green again.** `npm run tour:strip` has been **failing since Task 1** and this is the task that fixes it. Task 1 corrected `tour.05` from 38 words to 42 without regenerating the audio, so the cue at word 24 currently lands on word 24 of the *old* recording — the strip reports `tour.05 delhi-arrived word 24/38 "are"` where it should read `"Delhi."`. This red is expected and documented, but **an expected red gate is how a real failure hides**: before you finish, confirm the strip exits 0 and that every cue lands on its intended word, not just tour.05's.

- [ ] **Step 7: Restore the test Task 1 had to skip.** `content/schema.test.ts` skips *"tour.05: zoomTo is art and its hold matches the Delhi ring"* because it asserts hold values against the old 38-word recording, which the corrected text invalidated. It was skipped rather than deleted precisely so this task would restore it. **Recompute the hold numbers against the regenerated timings and un-skip it.** A skipped test carrying a TODO is how coverage quietly dies; do not close this task with it still skipped.

- [ ] **Step 8: Commit.**

---

## Task 7: Small truths and instrumentation

**Files:** `src/audio/diagnostics.ts`, `src/tour/GrandTour.tsx`

- [ ] **Step 1: Surface `isCheap()` in the `?debug=audio` panel.** Nothing currently tells anyone whether the tracing gesture even mounted on the child's device, and that is the first question the next iPad test has to answer. Task 3 depends on knowing it.
- [ ] **Step 2: Confirm the 4:05 docstring fix from Task 2 landed**, and grep for any other duration claim that has drifted.
- [ ] **Step 3: Commit.**

---

## This plan is done when

- [ ] A child can touch the map during the tour and carry on from where he was.
- [ ] An accidental brush or a scroll attempt does nothing at all.
- [ ] "Trace the edge with your finger" is followed by as long as he needs.
- [ ] Every button in the bar does something, in every state.
- [ ] Slowing down or pausing does not make the pictures leave early.
- [ ] Nothing in the narration teaches him something untrue.
- [ ] The tour sounds like one person reading one story.

---

## What comes after, and why it is after

The father asked to *"work on making it nicer and give states there details."* Both are next, and neither is in this plan.

**Phase 2 of Plan 3 — making it nicer.** The palette exists and almost nothing uses it: across 20 beats, **3** show any saturated colour. Every reveal renders in the same cream card, so the tiger, the lotus and the Hindi script all read as the same sticker in the same slot. The start screen still has **no stylesheet at all**. The ocean needs real neighbour landmasses, because a plain blue background would turn Nepal and Bangladesh into sea and contradict beat 12. And the photographs: there are 20, licence-cleared, and **not one is an animal** — which is why the "fake tiger" complaint is still open.

**Plan 5 — the 32 state screens.** Everything in this plan and the last was shaped so those screens inherit it: derived art holds, the framing convention on `:where(.india)`, per-place camera padding, a general `Trace({ d })`, runs-of-one narration, and now a parked tour position and the `invite` field.

**Why this plan comes first.** Nothing on either list matters if the child touches the map and loses the tour. A beautiful screen he cannot get back to is worse than a plain one he can.
