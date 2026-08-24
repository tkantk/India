# Namaste India — Plan 6: The State Screens

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the half of the app that does not exist — a screen for each of the 36 places — and fill it with content that is true.

**Architecture:** One new screen, reusing the machinery three plans were shaped to provide. Two pipelines that already exist, scaled: narration and photography. And one process change, because the thing that fails at this volume is not the code.

**Tech Stack:** Unchanged. React 19, Vite, TypeScript, `motion` from `motion/react`, Vitest.

---

## Why this plan exists

The father asked: *"give states there details."* Tapping a state today flies the camera there and stops.

Three candidate screens were built as working code in isolated worktrees, screenshotted, and judged through two lenses — a six-year-old's experience, and the cost of repeating them 32 times. **He chose "storybook page"** from the screenshots, which both judges also ranked first.

**And he made the one decision that had to come first: the animals are photographs.** Real animal photography on the state screens, drawings kept on the tour. That answers his very first complaint from the first device test — *"the tiger and others are fake"* — which has been open through three plans.

### The hard facts this plan is built on

| | |
|---|---|
| Places with content | **4 of 36** (delhi, kerala, odisha, rajasthan) |
| Lines per place | 10 — one intro, four cards, five landmarks |
| Characters per place | ~2,158, mean 216 per line |
| Narration for the remaining 32 | ~69,000 chars ≈ **$6.91**, likely nearer $3.80 |
| Landmark photographs needed | **160** more (20 exist) |
| Animal photographs needed | **32** — none exist |
| Checkable facts across 36 states | ~570 |
| Lines already fact-checked once that were **still wrong** | **17.8%** |

That last number is the one that governs this plan. A single authoring pass over 32 states ships roughly **57 wrong sentences** to a six-year-old. Accuracy is what the owner has said outranks everything, and he has personally caught three errors this project shipped.

**Worse: the fact-check document itself lied.** It cited Britannica in 14 rows when Britannica had blocked every fetch and no page was ever read. A prose fact-check that nobody can re-run is a record of intentions, not of checks.

---

## Global Constraints

Every task's requirements implicitly include this section.

### Platform

- Node 23+, ESM. `erasableSyntaxOnly`: no enums, no namespaces, no constructor parameter properties. No Node APIs in `src/`.
- `motion` from `motion/react` only. `useReducedMotionConfig()`, never `useReducedMotion()`.
- Never a leading-slash asset path. Vite `base: './'` with `HashRouter`.
- **Never transform an SVG `<g>` for animation; never animate `viewBox` frame by frame. No SVG `<filter>` anywhere.** WebKit's legacy SVG engine cannot composite SVG children and blurs filters on the CPU in three passes.
- **`var()` does not resolve in an SVG presentation attribute in WebKit** — hence `palette.ts`'s literal mirror, policed by a test.
- `pointer-events: fill` on hit-layer children.
- **Touch targets 104 CSS px, and every control carries a WORD.** The child is six and may not read confidently.
- **The app is iPad-only** by explicit ruling; a phone gets an honest message.
- Cues address a **word index**, never a timestamp. This is what makes re-rendering narration safe.
- Nothing on the cue or beat path may throw.
- **jsdom does no hit testing and no layout.**
- **A test double must be faithful to the real interface it stands in for.** Eight have failed that bar in this project; two of them let a dead button survive 545 green tests.

### Reuse, not reinvention

Three plans were shaped so this one inherits their work. Forking any of it is a failure, not a shortcut:
`subject.ts`'s colour table · `--say-lane`/`--map-floor` on `:where(.india)` · per-place camera padding from `pinR` · `Trace({ d })` · the narration singleton, the parked position, the `invite` field and its dwell timer · media-clock scheduling · `scripts/shot.mjs`.

**Read `docs/handover.md` first.** It was written for exactly this piece of work.

### Verification

- Baseline: **51 files, 743 passing, 31 skipped, 0 failures, ~12 seconds.** `tsc -b` clean. `colour:check` clean. `tour:strip` exit 0.
- The 31 skips are the speech suites, gated behind `CI || TTS_TESTS=1` because they are fifteen minutes of real `say` calls. Do not undo that.
- **`tour:strip` hardcodes port 4188 and takes five silent minutes. Run it in the foreground, once, never twice.** `shot.mjs` takes `--port`/`--debug-port`.
- **Check `uptime` before believing a red run.** A loaded machine produces nondeterministic timeouts indistinguishable from real failures; this project lost hours to that once.
- **`tour:strip` measures position and timing but never size.** A 2.5× shrink of the tour's headline moment once sailed through a fully green run.

---

## Ordering, and why it is not negotiable

**Three content fields must exist before a single one of the 32 places is written**, or everything written first has to be revisited: the animal's precise species, a short landmark name for the tile, and a language tag for the greeting's script. That is Task 2, and Tasks 4–6 depend on it.

**The voice and the render speed are settled now.** Re-recording all 393 clips later costs $8–10 and half a month's allowance; two complete re-recordings fit in one month and three do not. "Too fast" is a slider in the app, not a re-recording — Plan 4 made timed art follow the media clock precisely so the playback rate is a safe lever.

---

## Task 1: Land the storybook page

**Source:** commit `45a6b68` on `worktree-wf_85368274-e07-3`. The other two candidates are preserved at `f7547fe` (guided-visit) and `3999722` (poke-around) — **do not delete them**, Task 3 grafts from both.

**What it is.** A route and a `PlaceScreen`: the state lit in its own colour on the real map, in context with its neighbours and the sea; the intro narrated on arrival without asking; four card buttons and five landmark tiles below, pressable in any order. It reuses the colour table, the framing tokens, the narration engine and the control bar. It handles a place with no content yet — *"we haven't been to Gujarat yet"* — with four working buttons, which for months will be the most-visited screen in the feature.

**What it is not.** A sketch built to be photographed. Treat its tests as unproven until you have mutated them.

- [ ] **Step 1: Merge it onto the working branch.** It was built from `592b33a`; expect conflicts only where later work moved. Resolve by keeping both sides.
- [ ] **Step 2: Fix the four defects the judges found**, each of which is visible in its own screenshots:
  - **Sound does not start on a state page opened cold.** The page shows a Pause button but never switches the sound on — reload on a state and it is silent with a dead button. This is the "no control may be pressable and produce no observable effect" invariant from Plan 4, broken again. Candidate B does it right; look at how.
  - **The photograph is too small** on the landmark view.
  - **Finger-tracing is tuned to India's whole outline.** It works on Rajasthan, is patchy on Kerala and dead on Delhi. `Trace({ d })` is general; the tolerance is not.
  - **The three empty cards** — Animal, Food and Festival show nothing. Task 3 fills them.
- [ ] **Step 3: Prove the gates on the merged tree** — `tsc -b`, the full suite, `colour:check`, `tour:strip` exit 0, `probe:map` 36/36 and 0.00% dead. **And confirm the tour is unchanged**: the candidate's own `09-tour-unchanged-home.png` and `10-tour-unchanged-beat2.png` were taken for exactly this.
- [ ] **Step 4: Write the tests it lacks**, and mutate each to prove it can fail.
- [ ] **Step 5: Commit.**

---

## Task 1b: A layout gate for the place screen

**Files:** create `scripts/place-strip.mjs` (or extend `tour-strip.mjs`); `package.json`; `src/screens/place.css`

**Found immediately after Task 1 landed, by rendering the new screen at a viewport nobody had tried.** This task exists because of what that render showed, and it must come before any of the 32 places is written — a gate added afterwards inherits 36 screens' worth of accumulated defects.

**The gap.** `tour-strip.mjs` measures twelve real iPad viewports and has sixteen collision checks, including `creditOverBar`. **None of them look at the place route.** The app has just gained what will be its most-visited screen — 36 of them — with zero layout gating, and it already carries the same class of bug the tour needed a whole task to fix.

**Measured at 1024×768 landscape**, `shot.mjs` reports `shelfBottom=768 barTop=648`, and the render shows the **credit line overlapped by the intro text panel** — the word "pink." sitting on top of "boundaries by DataMeet India community (CC BY 4.0)". That is a licence-attribution obligation, and it is precisely the defect Plan 5's Task 3 fixed on the tour with a dark pill. The fix did not generalise because nothing made it.

**What the gate must measure**, for every place screen at every real iPad viewport:
- the credit legible and overlapped by nothing;
- no tile, card or text behind the control bar;
- every tile a real 104px touch target, and its label not clipped — candidate C's screenshots showed "Festival" rendering as "tival";
- the state's own shape actually drawn and not clipped;
- and, learning from the tour: **the drawn shape's size**, because `tour-strip` measures position and timing but never size, which is how a 2.5× shrink of the Delhi flight sailed through a fully green run.

**Run it against all four existing places**, not one. Delhi is tiny and a union territory, Kerala is long and thin, Rajasthan is large — they fail differently.

- [ ] **Step 1: Write the gate and watch it fail** on the credit overlap above. A gate that passes on its first run against a known defect is not a gate.
- [ ] **Step 2: Fix what it legitimately catches**, starting with the credit.
- [ ] **Step 3: Wire it into `package.json` beside the other probes, and make it print what it measured** — the existing probes are useful precisely because their output is readable.
- [ ] **Step 4: Record in `docs/handover.md` what this gate does and does not catch**, in the same spirit as the existing entries.
- [ ] **Step 5: Commit.**

---

## Task 2: The three fields that must exist before any content is written

**Files:** `content/schema.ts`, `content/places/*.json` (the four that exist), `scripts/validate-content.mjs`, `docs/handover.md`

Adding these after 32 places are authored means revisiting all of them. Adding them now costs four files.

**Interfaces:**
- **`species`** on the animal card — the precise animal, e.g. `dromedary`, not `camel`. **This is not pedantry: "camel" fetches a two-humped Bactrian for Rajasthan**, which is exactly the class of error the owner has caught three times. It drives the photo query and it is what makes the photograph correct rather than merely present.
- **`short`** on each landmark — a tile-length name. *"Chhatrapati Shivaji Maharaj Terminus"* will not fit, and candidate C's screenshots show real text clipping to *"tival"*.
- **`lang`** on the hello card — a BCP-47 tag so Hindi, Malayalam and Odia greetings render in the right lettering. `script` already holds the native text; nothing currently says what language it is.

- [ ] **Step 1: Write the failing test.** Every place has all three; `species` is a single lowercase token, not a sentence; `short` fits the tile budget — pick the number from the rendered tile, not by guessing; `lang` is a valid tag. Validation must **fail loudly** on a missing field, in the same spirit as `subject.ts`.
- [ ] **Step 2: Run, fail, implement, backfill the four existing places, pass.**
- [ ] **Step 3: Record the three fields in `docs/handover.md`** with *why* each exists — especially `species`, so nobody later "simplifies" it back to "camel".
- [ ] **Step 4: Commit.**

---

## Task 3: The grafts, and the cards that show nothing

**Files:** `src/screens/PlaceScreen.tsx`, `place.css`, plus whatever the grafts need

Three things the judges singled out, from all three candidates.

- **From B — the ten beads and the ending.** A wordless row showing how much is left, and *"You have heard everything here. Well done!"* when he has heard it all. Judged the thing that brings a child back for a second visit. **Do not graft B's structure** — its trail locks the child out for two and a half minutes, which is why it lost.
- **From C — the big picture that takes itself away.** Picture large, name in bold beneath, everything else still pressable, and it clears itself when the sentence ends. This fixes A's too-small photograph *and* removes the need for a close button a six-year-old has to find.
- **The three empty cards.** Animal, Food and Festival currently show nothing on A. With `species` from Task 2, the animal card shows a photograph. Decide what Food and Festival show and say why — the tour's drawn symbols are one honest answer.

**A warning carried from B.** Its animal card showed a **dog's paw print** while saying *"the camel lives here"*. It would have made that same wrong-shaped claim for the snow leopard, the dolphin and the hornbill, 36 times. A generic icon standing in for a specific animal is a factual error wearing a decoration's clothes.

- [ ] **Step 1: Write the failing tests** — the beads reflect what has actually been heard; the ending appears only when all ten are; the enlarged picture clears itself on the sentence ending and leaves everything else pressable; no card renders a generic stand-in for a specific animal.
- [ ] **Step 2: Run, fail, implement, pass.**
- [ ] **Step 3: Screenshot and look.** `shot.mjs` with your own `--port`.
- [ ] **Step 4: Commit.**

---

## Task 4: Make the fact-check re-runnable, and fix what is already wrong

**Files:** `docs/fact-check.md` → `content/fact-check.json`; create `scripts/fact-check.mjs`; `content/places/*.json`; `public/photos/`

**This task is why the plan can survive 32 more states.** Nothing else here is unusual engineering; this is.

**4a — the document lied, and could not be caught.** `docs/fact-check.md` cites Britannica in **14 rows** where Britannica blocked every fetch and no page was ever read. That is not a mistake anyone was careless to make — it is what happens when the record of a check is prose that nothing re-runs.

Move the table into data: for each claim, the line id, the assertion, the source URL, and **the exact quoted words the source is supposed to contain**. Then `scripts/fact-check.mjs` re-fetches every source and confirms the quote is still there. A blocked fetch is a **failure**, not a silent pass — that is the single rule that would have caught the Britannica rows.

**4b — 17.8% of already-checked lines were still wrong.** Re-run the corrected process over the four existing places and fix what it finds.

**4c — two of the twenty photographs are the wrong picture.** Konark without its wheel; Ranthambore with neither tiger nor fort. Both sit beside a sentence describing what is not in the frame. Replace them.

- [ ] **Step 1: Write the failing test** — a claim whose source 403s must fail; a claim whose quote has changed must fail; a claim with no source must fail. Prove each by pointing a row at a URL you know blocks.
- [ ] **Step 2: Migrate the table, run it, and record how many rows do not survive.** Report that number honestly — it is the measure of what the prose version was worth.
- [ ] **Step 3: Fix 4b and 4c.**
- [ ] **Step 4: Commit.**

---

## Task 5: 192 photographs

**Files:** `scripts/fetch-photos.mjs`, `content/photos.json`, `src/screens/Credits.tsx`, `NOTICE`

160 landmarks + 32 animals. About ten minutes of machine time, restartable, so a crash costs nothing.

**No human hand-checks a licence, and that is the design.** The script accepts only photographs whose licence is machine-readable and on an approved list, stores them unchanged, and prints the credit exactly as the source wrote it. Hand-checking 160 licences is the plan that does not survive contact.

**What a human must do, because a machine cannot:** look at a contact sheet and answer *"is that actually the thing in the picture."* About 36 decisions in batches, roughly 30 minutes. **That is exactly the check that missed Konark's wheel**, and it is the owner's job, not an agent's.

**The animals are the reason `species` exists.** Query the species, not the common name. And **reject zoo photographs** — a tiger behind concrete answers *"the tiger looks fake"* worse than the drawing already does.

- [ ] **Step 1: Turn the photographs on.** They do not reach the live site today — it is switched off deliberately. The commit that first shows a photo must switch it on **and** fix `Credits.tsx`, which has the number **25 typed into it by hand** and will be wrong the moment this task lands.
- [ ] **Step 2: Write the failing tests** — an unapproved licence is refused; a missing attribution is refused; the credits count is derived, never typed.
- [ ] **Step 3: Fetch, in batches, generating a contact sheet per batch.**
- [ ] **Step 4: Hand the contact sheets to the owner.** Do not proceed past a batch he has not looked at. This is the only place in the plan where an agent must stop and wait for a human.
- [ ] **Step 5: Commit.**

---

## Task 6: Thirty-two places, written to be true

**Files:** `content/places/*.json` (32 new), `content/fact-check.json`

320 lines. This is the task where quality collapses if it is treated as volume.

**Author by slot, not by place.** All 32 animal lines in one pass, then all 32 food lines, then all 32 festivals. Reading 32 animal sentences side by side catches *"the hump holds water"* instantly; reading state by state does not. Every line gets its row in `content/fact-check.json` **as it is written**, not afterwards.

**The owner reads them aloud before they go live, by slot.** ~80 minutes across the whole project, five minutes a state. Nothing anyone builds removes this, and both errors that were plainly wrong so far were the kind only a human read catches.

- [ ] **Step 1: Agree the 32 places and their five landmarks each**, with the owner, before writing a word. A landmark nobody can photograph is a landmark that ships an empty tile.
- [ ] **Step 2: Write by slot**, in batches, each with its fact-check rows.
- [ ] **Step 3: `npm run fact-check` must pass** on every new row before the batch is offered for reading.
- [ ] **Step 4: The owner reads each slot aloud.** Record what he changes — that list is the measure of whether the process works.
- [ ] **Step 5: `npm run validate` clean; `colour:check` clean. Commit per batch, not once at the end.**

---

## Task 7: Render the narration

**Files:** `scripts/tts.mjs` (no change expected), `src/data/timings.json`, `public/audio/en/`

**Each place is its own run of one**, so a place costs only itself — about **$0.22** — and editing one place never re-renders another. That is the design landed in Plan 4, and it is what makes 32 places affordable.

- [ ] **Step 1: Dry preflight. Report the character count and the dollar figure, and stop.** The owner sees the number before it is spent. Both real bills so far came in at ~55% of estimate.
- [ ] **Step 2: Render with `--yes`, per batch.**
- [ ] **Step 3: Diff `timings.json`** — no existing line's word array may move. A change outside the new places means the text changed when it should not have.
- [ ] **Step 4: `tour:strip` exit 0, all cues landing. Commit.**

---

## This plan is done when

- [ ] Tapping any of 36 places opens a screen that tells him what is there.
- [ ] Every animal card shows a photograph of the right animal, not a drawing and not a paw print.
- [ ] Every factual claim has a source that a script re-opens and re-reads.
- [ ] A place that has not been written yet says so kindly, with somewhere to go.
- [ ] Adding the 37th place means adding one file.

---

## Deliberately not in this plan

**The tour's pace.** It is 3:32, down 13.5% from 4:05 after the re-render normalised the delivery, against an original brief asking for "soothing and slow". The lever is the default playback rate — one line, free, and safe since Plan 4 put timed art on the media clock. It waits on the owner's ear, not on a plan.

**Hindi narration.** The switch exists; the recording is its own decision with its own cost.

**Games and quizzes.** Deferred by the owner from the beginning, and still the right call.
