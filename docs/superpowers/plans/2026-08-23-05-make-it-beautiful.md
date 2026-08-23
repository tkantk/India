# Namaste India — Plan 5: Make It Beautiful

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the "picture book" visual direction the owner chose, graft the best ideas from the two he did not, and leave behind a colour *system* that 32 state screens can inherit rather than a hand-painted tour.

**Architecture:** No new subsystems. One candidate direction already exists as working code on a branch; this plan integrates it, adds the tests it lacks, grafts three specific things, and closes three defects that apply whichever direction had won.

**Tech Stack:** Unchanged. React 19, Vite, TypeScript, `motion` from `motion/react`, Vitest.

---

## Why this plan exists

The father, after the first device test: *"it looks a bit bland and the initial screen is also bad."* After the second, once the correctness work was done: *"we should now work on making it nicer."*

Three visual directions were built as real working code in isolated worktrees, screenshotted on four screens each, and judged through two lenses — a six-year-old's experience, and the technical constraints plus the cost of extending to 32 state screens. **He chose "picture book" from the screenshots.**

### What the survey measured, correcting three numbers this project had been repeating

| Claim previously made | What is actually true |
|---|---|
| "the tour is 20 beats" | **14 beats.** The 20 was a count of captured frames. |
| "the palette declares eight colours" | **25 colours** across 28 custom properties. |
| "3 of 20 beats show saturated colour" | The real distribution is measured per beat; median chroma coverage is **2.75%** |

The sharper finding underneath: **of 25 declared colours, 7 are reachable from CSS and 18 are not.** The illustration palette is fully used — but only inside 380px cards on screen for six to twelve seconds. Nothing colours the frame the child actually sits in front of.

And the single highest-leverage object in the codebase: the cream card behind every figure is **one line**, `Reveal.tsx:187`, an SVG `<rect>` inside the art's own svg — so it cannot be restyled from a stylesheet at all. It governs **8 of the 14 beats**. That is why the tiger and the lotus read as the same sticker in the same slot.

Also measured, and worth keeping in view: **the four layer effects are the blandest beats in the tour.** The Ganga, the Himalayas and the three seas all sit under 1% chroma — thin strokes and half-opacity ellipses over beige, nine seconds each, three beats running.

---

## Global Constraints

Every task's requirements implicitly include this section.

### Platform, carried forward

- Node 23+, ESM. `erasableSyntaxOnly`: no enums, no namespaces, no constructor parameter properties. No Node APIs in `src/`.
- `motion` from `motion/react` only. `useReducedMotionConfig()`, never `useReducedMotion()`.
- Never a leading-slash asset path. Vite `base: './'` with `HashRouter`.
- **Never transform an SVG `<g>`; never animate `viewBox` frame by frame.** WebKit's legacy SVG engine cannot give an SVG child a compositor layer.
- **No SVG `<filter>` anywhere.** WebKit blurs on the CPU in three passes.
- `pointer-events: fill` on hit-layer children — skips `CGPathCreateStrokedPath`.
- **Touch targets 104 CSS px, and every control carries a WORD**, not only an icon. The child is six and may not read confidently.
- Nothing on the cue or beat path may throw.
- Cues address a **word index**, never a timestamp.
- **jsdom does no hit testing and no layout.**
- **A test double must be faithful to the real interface it stands in for.** Seven have failed that bar in this project. Two of them let a dead button survive 545 green tests.

### Specific to visual work

- **`var()` does not resolve in an SVG presentation attribute in WebKit.** This is why `src/tour/effects/art/palette.ts` exists as a literal mirror of 24 CSS colours, and why two tests police the mirror. Any new colour that art consumes must go through that mirror, and the tests must still pass.
- **The layout gate is the arbiter.** `npm run tour:strip` checks 12 real iPad viewports and currently exits 0 with no collisions. A visual change that breaks it is wrong, and the fix is to the design, not the gate.
- **Dev and production must render identically.** The chosen direction verified this by rendering `home` and `gate` both ways and comparing — byte-identical. Vite does not bundle CSS in import order, so a rule that works on a laptop can silently lose to another in the built stylesheet. Every task here must re-run that comparison.
- **The map must stay legible as a map.** India's official depiction is enforced by a build gate. Do not obscure or restyle boundaries into ambiguity.
- **Build for 32 screens.** Anything that requires a human to choose a colour per screen is the wrong shape. The answer is a table.

### Known-flaky, so nobody misreads it

`scripts/tts.test.mjs` shells out to the macOS `say` binary with a 10-second hook and times out when the machine is loaded — it failed once during this work with 35 stale Chrome processes running, and passed alone and passed in a full suite on an idle machine. **A file-level failure with zero failing assertions is contention, not a regression.** Re-run before believing it. The same applies to `scripts/build-map.test.mjs`, which drives real Chrome.

---

## File Structure

| Path | Change |
|---|---|
| `src/styles/base.css` | The page material, the frame, the tokens |
| `src/screens/startGate.css` | **New** (294 lines on the candidate branch) — the screen that had no stylesheet |
| `src/screens/StartGate.tsx` | The cover |
| `src/ui/Glyph.tsx` | **New** — drawn control icons replacing Apple's emoji |
| `src/ui/Controls.{tsx,css}` | The bar, in the new material |
| `src/tour/effects/Reveal.tsx` | The card that governs 8 of 14 beats |
| `src/tour/effects/subject.ts` | **New** — the one colour table, grafted from "daylight" |
| `src/tour/effects/art/palette.ts` | The WebKit literal mirror, extended |
| `src/map/map.css` | Land, sea, and borders you can actually see |
| `src/tour/{grandTour,tourStage}.css`, `effects.css` | Stage and effect surfaces |
| `scripts/shot.mjs` | **New** (420 lines) — the screenshot recipe, reusable |
| `scripts/colour-check.mjs` | **New** — the gate that nothing currently has |

---

## Task 1: Land the picture book

**Files:** all of the above except `subject.ts` and `colour-check.mjs`
**Branch:** the work exists at commit `ddc8a93` on `worktree-wf_611b88f3-03b-2`, built from `684bcab`. The working branch has since moved to `41d7028` (Task 7 of Plan 4: `diagnostics.ts`, `cheapMode.ts`, and a `GrandTour.tsx` wiring line). **Expect a conflict in `GrandTour.tsx` and nowhere else.**

**What it already is.** 24 files, +1,415/−65. It replaces the emoji controls with drawn glyphs, gives the start screen its first stylesheet, makes the map's land green in a pale blue sea with brown borders you can see, and gives each reveal its own coloured page instead of the shared cream card. It passes `tsc -b`, 707 tests, and `tour:strip` exit 0, and it verified dev-versus-production renders byte-identical.

**What it is not.** **It added no tests.** It was built as a sketch to be judged from screenshots, and it was judged. Integrating it without tests would be taking the least-verified change in this project's history and putting it under 32 screens.

- [ ] **Step 1: Merge or cherry-pick `ddc8a93` onto the working branch.** Resolve the `GrandTour.tsx` conflict in favour of keeping *both* — Plan 4's `isCheap()` wiring and the direction's change. Read both sides; do not take either wholesale.
- [ ] **Step 2: Prove the gates still hold on the merged tree**, not on the candidate branch: `npx tsc -b` clean, full suite green, `npm run tour:strip` exit 0 with no collisions at any of 12 viewports, `npm run probe:map` 36/36 poles and 0.00% dead.
- [ ] **Step 3: Re-run the dev-versus-production comparison.** `scripts/shot.mjs` supports a `--build` mode; render `gate` and `home` both ways and diff them. They must be byte-identical. This is the load-order trap, and it is the one defect that will not show up on a laptop.
- [ ] **Step 4: Write the tests it lacks.** At minimum: the start gate renders its three phases and the Begin control meets 104px; every control still carries a word; the drawn glyphs render for every control the bar has; the reveal card takes its colour from a prop rather than a constant. Watch each fail first — several will not, and the ones that pass immediately are telling you the assertion is too weak.
- [ ] **Step 5: Commit.**

---

## Task 2: One colour table, grafted from "daylight"

**Files:** create `src/tour/effects/subject.ts`; modify `Reveal.tsx`, `Symbol.tsx`, the art components, `palette.ts`, `ReadAlong` (or wherever the spoken-sentence strip lives)

**Why this and not the look that lost.** The judges split. One preferred "daylight" purely because it has a real colour *system* underneath — a single table saying tiger = orange, lotus = pink — where "picture book" picks each colour by hand inside each drawing file. That is a plumbing difference, invisible in every screenshot, and it is the difference between "pick one of eight page colours from a list" and "a human decides" repeated 32 times.

**Take the winner's look and the loser's plumbing.** Do this **before** the state screens, not after — retrofitting a table across 40 screens is a different and much worse job.

**Interfaces:**
- `subject.ts` exports one map from subject key → its colour set (page, ink, accent). Every reveal, and the strip above the spoken sentence, reads from it.
- Colours that art consumes must still route through `palette.ts`'s literal mirror, because `var()` does not resolve in an SVG presentation attribute in WebKit. The two tests policing that mirror must still pass.

**Also graft daylight's one genuinely original idea**, which neither other direction had: the subject's colour appears both on its picture *and* on the strip above the sentence being read aloud, so a child who cannot yet read can see that the picture and the words belong to each other.

- [ ] **Step 1: Write the failing test.** Every subject in the content has an entry in the table; no subject reads a colour from anywhere else; the strip above the spoken sentence takes the current subject's colour; a subject with no entry fails loudly at build time rather than silently rendering grey. That last one matters — this project has been bitten twice by hand-copied lists that failed silently.
- [ ] **Step 2: Run, fail, implement, pass.**
- [ ] **Step 3: Re-run the strip and the dev-vs-build comparison.**
- [ ] **Step 4: Commit.**

---

## Task 3: The lit cover, and the credit pill

**Files:** `src/screens/StartGate.tsx`, `startGate.css`, the ending screen, `src/map/map.css`

Two grafts from "festival", the direction that lost. Its opening screen was judged the single most beautiful image anyone produced — a marigold garland across the top, three lit diyas along the bottom, a glowing gold button — and a child would reach for that button before you finished the sentence.

**But the night must not spread into the app.** Festival lost precisely because it got worse with every screen: on the map, India became a cream cutout floating in purple with no sea, and stopped looking like a place. On the Delhi screen — the screen all 32 state screens will look like — the night vanished entirely and it became today's app with a purple edge.

**So: the lit treatment applies to the first screen and the ending only**, where there is no map to read and nothing to navigate. Everywhere else stays picture book.

**Second graft:** festival's small dark pill behind the map's credit line, so that text stays readable whatever the map is showing underneath it. That is a real robustness fix, not a decoration — the credit is a licence obligation and it currently sits on whatever colour happens to be there.

- [ ] **Step 1: Write the failing test.** The lit treatment is present on the gate and the ending and **absent everywhere else** — assert the absence explicitly, because that is the failure mode. The credit remains legible: assert the pill exists and that the credit is still a sibling of `.map`, not a child (Plan 3 moved it deliberately).
- [ ] **Step 2: Run, fail, implement, pass.**
- [ ] **Step 3: Screenshot the gate, the ending, the map and a state-like screen** with `scripts/shot.mjs`, and look at them. The test proves the class is absent; only your eyes prove the night did not leak.
- [ ] **Step 4: Commit.**

---

## Task 4: A gate for colour, and the phone start screen

**Files:** create `scripts/colour-check.mjs`; modify `src/screens/startGate.css` / `grandTour.css`; `package.json`

Two defects the judges flagged as applying **whichever direction had won**.

**4a — nothing checks the colours.** None of the three directions added a single test for their own palette. With eight screens the rules hold because a person is looking; with forty they will not. The project already has this pattern working elsewhere — `tour:strip` measures the drawn map, `probe:map` measures tap coverage — so add the equivalent for colour.

At minimum the gate should assert: every subject in `subject.ts` resolves to a real colour; **no two consecutive beats share a page colour** (which is the rule that stops 32 state screens becoming a beige smear); text on every page colour clears a contrast floor; and the `palette.ts` literal mirror still matches its CSS source. Wire it into `package.json` beside the other probes.

**4b — the phone start screen is broken, and colour stops it hiding.** At iPhone size the gold "Show me India" button covers almost the entire country. This is **not new** — it is in today's shipped app — but until now everything was beige and it read as clutter rather than as a mistake. Measured at `390x844`.

Decide and state which: fix it, or declare the app iPad-only and make the phone case degrade honestly rather than badly. **The father tests on an iPad**, so iPad-only is a legitimate answer — but it must be a decision that is written down, not an accident.

- [ ] **Step 1: Write the gate, and watch it fail against the current tree.** If `colour-check` passes on its first run, it is not checking anything — pick a rule it should catch, break it deliberately, and confirm it fires.
- [ ] **Step 2: Fix whatever the gate legitimately catches.**
- [ ] **Step 3: Resolve 4b and record the decision** in `docs/handover.md`.
- [ ] **Step 4: Commit.**

---

## Task 5: Put India in an ocean

**Files:** create `scripts/build-world.mjs`, `src/map/sea.ts`; modify `src/map/MapStage.tsx`, `map.css`, `package.json`
**Test:** `scripts/build-world.test.mjs`

Carried from Plan 3, where it was deferred behind correctness work. The father asked for it directly after the first test: *"around the map it should show blue ocean but not showing that."*

**Why this is not a background colour.** Painting the stage blue would turn Nepal, Bangladesh, Pakistan, Bhutan, Sri Lanka and Myanmar into open sea — and beat 12 names the neighbours and lights them up. A child told "these are India's neighbours" while looking at ocean where Nepal should be is being taught something false. The ocean needs the neighbouring **land** drawn too.

**Note what changed since Plan 3 wrote this:** the chosen direction already puts the land in a pale blue sea. Establish first whether that satisfies the request, or whether real neighbour landmasses are still wanted. **If the picture-book sea is enough, say so and close this task** — do not build a Natural Earth pipeline to solve a problem that a fill already solved.

If it is still wanted:
- `build-world.mjs` fetches Natural Earth 1:50m Admin 0, clips to a box around India, and projects with the **identical projection and viewBox** as `build-map.mjs` — importing the shared projection, not re-deriving it, or the layers will not register.
- A new `svg.sea` layer beneath `svg.base`, `pointer-events: none`, flat fill, muted neighbour landmasses, no gradient, no filter.
- Neighbour polygons must be clipped against India's own depicted boundary so none overlaps Indian territory as the depiction gate defines it.
- Natural Earth is public domain; record it in `NOTICE` and the credits screen anyway.

- [ ] **Step 1: Decide whether this is still needed**, with a screenshot of the current map as evidence. Record the decision either way.
- [ ] **Step 2 (if needed): Write the failing test** — same viewBox, not interactive, no filter, no neighbour polygon overlapping India's depicted boundary.
- [ ] **Step 3: Build it, report the bundle cost, re-run the strip and both probes.**
- [ ] **Step 4: Commit.**

---

## Task 6: Take the diagnostic out and hand over

**Files:** delete `src/audio/diagnostics.{ts,test.ts}`; modify `src/tour/GrandTour.tsx`, `docs/handover.md`

- [ ] **Step 1: Confirm with the owner that the device questions are answered** before deleting the panel. It currently answers three things nothing else can: which WebKit audio bug fires, whether `isCheap()` latched true and so whether the tracing gesture mounted at all, and which taps the gate rejected and by how much. **If any of those is still open, keep the panel and say so.**
- [ ] **Step 2: Remove it and its hook.** Keep the *findings* in `docs/handover.md`; the panel is scaffolding, the evidence is the value.
- [ ] **Step 3: Update the handover for whoever builds the 32 state screens** — including a future session of mine after context is lost. It must carry: the `subject.ts` colour table and how to add a state to it; the `--say-lane` / `--map-floor` framing convention on `:where(.india)`; per-place camera padding derived from `pinR`; the `invite` content field and the dwell timer; runs-of-one narration and the chained cache key; the parked tour position; `scripts/shot.mjs`; and the standing list of gates with what each one does and does not catch — including that `tour:strip` measures position and timing but **never size**, which is how a 2.5× shrink of the Delhi flight went unnoticed.
- [ ] **Step 4: Full suite, every gate, every probe, then deploy.**
- [ ] **Step 5: Commit.**

---

## This plan is done when

- [ ] The first thing the child sees looks like it was designed by someone who cared.
- [ ] The tiger, the lotus and the Hindi script no longer read as the same sticker in the same slot.
- [ ] The state borders are visible, so the map works as a map.
- [ ] A colour gate exists, and it caught something real before it was trusted.
- [ ] Adding the 33rd state means adding a row to a table, not making a judgement.

---

## Deliberately not in this plan

**Real photographs, including animals.** Still outstanding from the first device test — *"the images are fake and not original, the tiger and others are fake"* — and still true: the 20 licence-cleared photographs contain **no animals**. It belongs with the state screens, not here, because that plan needs 32 places × 5 landmarks of photography and the pipeline should be built once for all 160 rather than twice. The symbols are now considerably better looking, which buys the time to do it properly.

**The 32 state screens.** The next plan. Everything in Plans 3, 4 and 5 was shaped so they inherit it: derived art holds, the framing convention, per-place camera padding, a general `Trace({ d })`, runs-of-one narration, the parked position, the `invite` field, and now a colour table.

**The tour's pace.** The paid re-render made the tour 13.5% shorter — 4:05 to 3:32 — by normalising the delivery, and the owner's brief asked for "soothing and slow". A lever now exists that did not before: Plan 4 made timed art follow the media clock, so reducing playback rate no longer desyncs the pictures. That is a one-line change awaiting his verdict, not a plan item.
