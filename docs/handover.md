# Namaste India — state of play

**Live at https://tkantk.github.io/India/** since 2026-08-22.

Last updated 2026-08-24, at the end of **Plan 5 (make it beautiful)**,
Task 6 — the last task before the next plan builds the 32 state screens.

Read this before starting that plan. It records what exists, what is
deliberately missing, and the decisions that are waiting on a human. The
oldest material below is from the end of Plan 1 and is kept for the record;
**"Handover: building the 32 state screens"**, further down, is the section
written for you specifically.

**Baseline as of this commit:** 51 test files, 743 passing, 31 skipped, 0
failures, ~12 seconds. `npx tsc -b` clean. `npm run colour:check` clean.
`npm run tour:strip` exits 0.

---

## Handover: building the 32 state screens

Everything in Plans 3, 4 and 5 was deliberately shaped so this plan inherits
it rather than re-discovering it. This section is written for a competent
stranger who has never seen this code — plausibly a future session of me,
after this conversation's context is gone. Read it before you write a line.

### Three fields every place needs — `species`, `short`, `lang`

`content/schema.ts` requires three fields, on every place, that did not
exist before Plan 6's Task 2. All three are REQUIRED, not optional: a place
file missing any one of them fails `npm run validate` immediately, by name,
with the same "fail loudly at build time, never silently" spirit as
`subject.ts`'s own `checkSubjectCoverage()`. They exist now, on the four seed
places, specifically so none of the next 32 places has to be revisited to
add them — adding a field after 32 places are authored means editing 32
files; adding it before the first of them costs four.

**`species`, on `card.animal`.** The precise animal a photo of this card
should show, as ONE LOWERCASE TOKEN (`dromedary`, `asian-elephant`,
`indian-roller`, `house-sparrow` — letters and hyphens only, enforced by a
regex, not a convention). **This is not pedantry, and nobody should ever
"simplify" it back to reusing the card's own English word.** The card's
prose says "camel" because that is how a six-year-old is told the story; the
photo fetcher (Task 5) needs to search for something a stock photo API can
get right, and "camel" alone returns whichever camel it feels like —
measured directly, a bare "camel" query surfaces a two-humped Bactrian, a
species that does not live in Rajasthan and is not the one-humped dromedary
the text is actually about. This is exactly the class of factual error this
project has already been caught making three times, including one that
taught a six-year-old for weeks that a camel's hump stores water (it stores
fat — see the corrected line in `rajasthan.json` itself). `species` is the
field that makes the eventual photo query CORRECT, not merely present. The
four seed values, and why each is what it is, not the card's own English
word:

  - **`rajasthan` → `dromedary`.** The one this field exists for by name — a
    bare "camel" fetches a two-humped Bactrian camel, which is not native to
    Rajasthan or anywhere in India; the dromedary (Camelus dromedarius) is
    the actual one-humped desert camel the Thar is home to.
  - **`kerala` → `asian-elephant`.** "Elephant" alone is a coin flip between
    two different genera — Asian (Elephas maximus, Kerala's real animal,
    smaller ears, one "finger" on the trunk) and African (Loxodonta,
    bigger ears, two "fingers") — and a photo API has no reason to prefer
    the right continent.
  - **`odisha` → `indian-roller`.** The bird is already named precisely in
    the card's own text ("The Indian roller..."), so this is the same word,
    just formalised as the query token — "bird" alone would return anything
    with feathers.
  - **`delhi` → `house-sparrow`.** Same reasoning as Odisha: the text already
    names the species (Passer domesticus, Delhi's own state bird); `species`
    just makes that the thing actually searched for, not "sparrow" in
    general (there are dozens of sparrow species).

**`short`, on every landmark.** The tile-length name a landmark's own shelf
tile actually prints — never `name`, which stays the real, accurate title
used for the photo's alt text and anywhere else the whole title matters.
*"Chhatrapati Shivaji Maharaj Terminus"* is a real Indian landmark name and
does not fit anywhere close to a shelf tile; a rejected candidate's own
screenshots showed real text clipping to *"tival"* ("Festival") for exactly
this reason. `content/schema.ts` enforces TWO ceilings, not one, because a
tile clips on a long WORD, not a long phrase, and the first version of this
field got that backwards.

`scripts/place-strip.mjs` — the real layout gate that drives a real headless
Chrome over the real built CSS — puts the narrowest tile this app ever
renders at 129.6x120px (an iPad mini in portrait, five tiles across a 744px
screen; see that script's own `build/place-layout.json` output). A one-off
calibration pass using the same technique (`getBoundingClientRect` on the
real `.tile__word`, at that same narrowest tile) proved the hazard directly:
`"Brihadeeswarar Temple"` (21 characters — UNDER a 24-character total
budget) clips, because `"Brihadeeswarar"` alone (14 letters, no space to
wrap on) renders at 132.1px, wider than the 129.6px tile itself, while
`"Ajanta and Ellora Caves"` (23 characters, FOUR words, longest word 6
letters) does not clip at all. **`SHORT_WORD_BUDGET` (12 characters) is the
ceiling that actually stops a clip** — every word in `short` must be at most
12 characters — and it is set where it is because truncating the same word
letter by letter found 12 characters ("Brihadeeswar") safe with real margin
(115.3px) while 13 was not reliably safe (two other real 13-letter words
measured 130.2px and 130.4px, a hair either side of the tile's own edge).
`SHORT_BUDGET` (24 characters total) is kept alongside it only as a softer,
cosmetic guard against a short value that is technically clip-free but is
four words wrapped to four lines — not a TILE label any more even though
nothing overflows. Every `short` drafted for the four seed places has a
longest word of 12 characters or fewer (`"Athirappilly"`, in `"Athirappilly
Falls"`) — right at the ceiling, with no room to spare, which is why it was
measured rather than assumed. **Do not "simplify" this back to one
character-count check** — `content/schema.test.ts` pins both
`"Brihadeeswarar Temple"` (must reject) and `"Ajanta and Ellora Caves"`
(must accept) as the specification, by name, so a future edit that only
checks total length fails a real test, not just a comment.

**`lang`, on `card.hello`.** The BCP-47 tag for the language `script` (the
same card's native-script text — `खम्मा घणी`, `നമസ്കാരം`, `ନମସ୍କାର`,
`नमस्ते`) is actually written in. `script` has held the text itself since
Plan 2; nothing ever said what LANGUAGE it was in, which is exactly what
eventually has to pick the right lettering (Devanagari for Hindi, the
Malayalam script for Malayalam, the Odia script for Odia — three visibly
different scripts already live in these four files with nothing
distinguishing them programmatically). The four seed values: `kerala` →
`ml` (Malayalam), `odisha` → `or` (Odia), `delhi` → `hi` (Hindi) — each of
these three unambiguously implies one script in real-world use, so the bare
primary subtag is enough to pick the right lettering on its own.

`rajasthan` → **`raj-Deva`**, not bare `raj`. Rajasthani has no ISO 639-1
code, so `raj` (its BCP-47-valid ISO 639-3 fallback) is still where the tag
starts — but unlike Hindi, Malayalam or Odia, Rajasthani does not
unambiguously imply one script: it has historically been written in more
than one (Devanagari today is standard, but it is not the only one that has
been used), so `raj` alone gives a future renderer nothing to decide
lettering with, which is the one job this field exists to do. `-Deva` (the
BCP-47 script subtag for Devanagari) is added so the tag actually determines
the lettering, matching what `script` already holds (`खम्मा घणी`). Bare
`raj` is still a syntactically valid tag — `BCP47_RE` accepts it, and
`content/schema.test.ts` checks both forms are valid tags — it is just not
the one this app ships, because it does not finish the job.

### The colour table — `src/tour/effects/subject.ts`

One table, `SUBJECTS: Record<string, Subject>`, decides what colour every
subject is drawn in, everywhere it appears. A `Subject` is three roles:
`page` (the card's own background wash — one of eight established page
tones), `ink` (the rule round the card's edge — today always
`PALETTE.inkLine`, kept as its own field rather than a bare import in case a
future direction varies it), and `accent` (the subject's own defining hue —
what is actually orange about the tiger — which drives the read-along
strip's own colour and any non-card art like a river or a sea).

**To add a state:** pick `page` from the eight established page tones
(`matSand`, `matRose`, `matLeaf`, `matSun`, `matSky`, `matStone`, `matTeal`,
or plain `paper`) — never the subject's own colour family, or a pink lotus
sits on a pink page and disappears into it. Pick `accent` from whatever the
state's own art is actually drawn in. Leave `ink` as `PALETTE.inkLine`. Then
add the new key to `content/vocab.json` (or, for a verb that is its own
subject, to `VERB_SUBJECT_KEYS` in `subject.ts`) — `SUBJECTS` itself has no
list of required keys; the requirement is derived from what `vocab.json`
promises content is allowed to name.

**It throws at import time on a gap, and that is a feature, not a bug to
"fix".** `checkSubjectCoverage()` runs unconditionally at the bottom of
`subject.ts` and throws if `SUBJECTS` is missing an entry `vocab.json` or
`VERB_SUBJECT_KEYS` requires. This project has been bitten twice before by a
hand-copied list that failed silently instead (`ART_VERBS` in the timings
generator is the other one) — so this fails loudly, at build time, before a
gap ever reaches a child's iPad. If you add a landmark's `scene` key to
`vocab.json` before giving it a row here, the whole app refuses to build.
That is the point: it is telling you the row is missing, not that something
is broken.

Every colour in the table is a literal hex from `src/tour/effects/art/palette.ts`,
never a CSS `var()` — see "standing rules" below for why. `Symbol.test.tsx`
and `scripts/colour-check.mjs` both fail if a `subject.ts` colour is not
actually one of `PALETTE`'s values, so there is no way to hand-pick a hex
that drifts from the app's own palette without a test catching it.

### The framing convention — `--say-lane` / `--map-floor`, `:where(.india)`

`src/styles/base.css` declares a small set of CSS custom properties on
`:where(.india)` — `--bar-over`, `--credit-lane`, `--floor`, `--say-lines`,
`--say-lane`, `--map-floor`, `--map-ceiling` — that answer one question:
**how much of the screen, at the top and the bottom, is furniture rather
than map?** `--map-floor` is where a map (and anything registered against
its viewBox — a river, a border, a look-down ring) has to stop at the
bottom, so a caption anchored below it has somewhere to sit that is not on
top of the geography. `--say-lane` is how tall that caption is allowed to
get, sized off a fixed number of lines (`--say-lines`) rather than the
caption's own content, so a screen does not have to re-measure itself every
time the words change.

Every one of the 32 state screens needs the same clearance the tour needs —
a fixed control bar at the bottom, a licence credit, a caption — and this is
where those numbers live specifically so a new screen inherits them by
putting `class="india"` on its own root and doing nothing else. The
tour-specific overrides (how many lines `.say` wraps to on a phone, where
Mor stands) stay in `grandTour.css`, next to the reasons for them, as
ordinary `.india` rules.

**Why `:where(.india)` and not plain `.india`.** This is the one piece of
this convention most likely to be "corrected" by someone who does not know
the history, so it is worth being precise. `:where()` gives the whole
selector **zero specificity** — literally the same as no selector at all.
The reason is a fact about Vite, not about CSS in the abstract: **Vite does
not bundle CSS in import order.** It was measured directly: even though
`main.tsx` imports `base.css` before `grandTour.css`, this file's rules land
*after* `grandTour.css`'s in the built stylesheet. A plain `.india` default
here would therefore have the same specificity as, and a later source
position than, `grandTour.css`'s own `@media (max-width: 600px) { .india {
... } }` phone overrides — and same-specificity-later-position **silently
wins**, undoing every one of those overrides in the shipped build even
though it worked in dev. `:where(.india)` makes that structurally
impossible: any plain `.india` rule, in any file, in any order, beats a
`:where(.india)` one. If a state screen ever needs to override one of these
defaults, write it as an ordinary `.india` rule (or scope it to the screen's
own class) — it will always win against the `:where()` defaults, regardless
of where Vite happens to place it in the bundle.

### Per-place camera padding, derived from each place's own `pinR`

`src/map/camera.ts` exports `PLACE_PADDING = 40`, a small constant — but it
is a **floor for a bbox-only flight with no known pin**, not a safety
ceiling for every flight. Do not use it alone for a real place.

The correct call, used by both `cues.ts`'s `zoomTo` and `GrandTour.tsx`'s
`pick`, is:

```ts
const padding = Math.max(PLACE_PADDING, PIN_R[slug]?.pinR ?? 0)
void camera.flyTo(place.bbox, { padding })
```

`pinR` (in `src/data/hit.json`, per place) is how far that place's own tap
target can extend past its bbox edge — and it varies enormously by design:
Andaman & Nicobar's is 112.6 (a scattered archipelago needs a generous pin),
Delhi's is 16.1 (a small state hemmed in by neighbours needs almost none).
**A single global padding large enough to cover the worst place costs every
other place real zoom it did not need to give up.** This was measured, not
assumed: a flat 113 (the ceiling every `pinR` is clamped to) costs Delhi's
flight **2.5x** — 10.38x zoom down to 4.13x — and every one of the 36 places
loses zoom too, a mean of 1.73x smaller. `camera.ts`'s own comment on
`PLACE_PADDING` has the full derivation. When a state screen flies its
camera to one of its own landmarks or a neighbouring state, pass that
place's own `pinR` the same way — never a single hand-picked constant.

### `Trace({ d })` — general, no India in it

`src/tour/effects/Trace.tsx` is the finger-tracing gesture built for the
tour's "trace the edge with your finger" moment (`art/Outline.tsx`), and it
takes a plain SVG path string, `d`, and nothing India-specific. A state
screen that wants a child to trace its own border gets the exact same
gesture for free:

```tsx
<Trace d={someStateBorderD} />
```

That is the whole integration — see `Outline.tsx` for the real usage
(`<Trace d={MAINLAND} />`, where `MAINLAND` is `INDIA_OUTLINE` sliced to its
first ring). `Trace` handles engagement distance, monotonic sweep, the
touch-only gate, reduced-motion, and `isCheap()` — none of that needs
re-deriving per state. It publishes `isTracing()`/`subscribeTracing()`
(`tracing.ts`) for anything that needs to know a finger is currently down,
which is exactly what `GrandTour.tsx`'s invite-dwell timer reads (see
below).

### Runs-of-one narration and the chained cache key

`scripts/lib/runs.mjs`'s `collectRuns()` groups every narrated line in the
whole corpus into **runs**: an ordered sequence of lines that must render
serially, chained together for prosodic continuity. `content/tour.json`'s
14 beats are the **only** multi-line run today — `GrandTour.tsx` really does
play them back to back, on `onEnd`. Every place intro, card line, landmark
line and UI line is a **run of one**: nothing plays two of them
consecutively, so conditioning one on whatever rendered immediately before
it would make it open like the continuation of a sentence the child never
heard.

This matters directly for the 32 state screens because **the grouping is
derived from the content on disk, not hand-listed** — `collectRuns()` walks
every file in `content/places/`. A new `content/places/rajasthan.json` (or
whichever states are still missing) is automatically a set of runs-of-one
the moment it exists; nobody has to update this file to teach it about a
new state.

Why this matters for cost and editing: a run of one uses `legacyKey(signature,
text)` — a plain hash of the line's own text — so **editing one place's
`festival` line re-renders only that one line.** A run of more than one (the
tour) uses `chainedKey(signature, text, nextText, prevKey)`, which folds in
the *next* line's text and the *previous* line's own key — so **editing any
one beat of the tour re-renders that beat and every beat after it in the
chain**, because each key depends on the one before it. This is deliberate
(ElevenLabs' `next_text` is a real prosody lookahead, not bookkeeping — it
audibly affects the segment before it) but it is also why a one-word tour
fix can cost a full tour re-render while a one-word place-card fix costs
exactly one line. If a future state screen ever wants prosodic continuity
across multiple lines (unlikely — a card is tapped independently, not read
straight through), it would have to become a run of more than one on
purpose; by default, keep every new line a run of one and get the cheap key
for free.

### The parked tour position (`tourPosition.ts`) and the `invite` field

`src/tour/tourPosition.ts` is three functions — `park(position)`,
`parked()`, `clearPark()` — over one module-scoped `let`. It knows **nothing
about beats**: it is a plain index into whatever ordered sequence the caller
is walking through. The tour uses it today (leaving mid-beat via the map's
credit link, or any other unmount that does not go through `goHome`/`end`
first, remembers which beat was in the air so "Carry on" can resume it) —
and it is written generically specifically so the 32 state screens can reuse
it as-is for "which landmark card was open when the child left this
screen", without writing a second copy of the same module-scoped-ref
pattern.

`content/schema.ts`'s `InviteSchema` (`gesture`, `min`, `max`) is what a
line's audio can ask the child to do once it ends — authored per line, in
content, never as a hardcoded "this beat is special" in a sequencer. Beat 2
("trace the edge") is the only line that uses it today, but the schema
exists for the next ~32 lines that will, one per state screen probably. The
mechanics live in `GrandTour.tsx`'s `useInviteGap()`: the beat is held open
for at least `invite.min` seconds regardless, longer for as long as a finger
is on `Trace`'s own corridor (read via `isTracing()`), never past
`invite.max`. "Quiet" (no finger down) has to last `SETTLE_MS` (2500ms, a
code constant — the father's own call, "about 2.5s after he lifts") before
the floor+settle path can finish the wait; the hard cap fires regardless. A
new screen that wants the same "wait for a gesture, but not forever" shape
should read `useInviteGap()` as the reference implementation rather than
re-deriving the floor/settle/cap logic from scratch — the comment on that
hook explains at length why it is a ref-based session object and not plain
React state (re-arming a single wait in place on every touch, without
resetting a floor or cap that is already running, cannot be done with an
effect keyed on the touch state without also tearing down and rebuilding
the whole session on every touch).

### `scripts/shot.mjs` and the gate list

None of these are optional pre-flight checks — they are what stands between
"the tests are green" and "the thing actually looks and behaves right in a
real browser." **Know what each one catches, and just as important, what it
does not.**

- **`node scripts/shot.mjs <target> [--w= --h=]`** — not a gate, a tool.
  Photographs one exact moment of the real app (a beat, a word, the gate, the
  end) in headless Chrome, using the same audio-clock shim `tour:strip` uses
  but with a speed knob so you can fast-forward to beat 13 and then drop back
  to real speed a beat early so the art settles naturally before the
  shutter. Use it for "does this CSS change actually look better", not
  `tour:strip`'s three-and-a-half-minute full run.

- **`npm run tour:strip`** — builds, serves the production build, watches
  the *whole* 14-beat tour end to end at real speed in headless Chrome, and
  photographs every beat. It checks: does every cue's art land within two
  words of the word it was authored on (timing); does the camera commit
  seamlessly; does a tap reach the map on every single frame (nothing
  drawn over it ever swallows a tap); and, across a fixed device list, do
  the bar, the credit, Mor and the read-along collide, overflow, or push the
  drawn map off-screen or under the fixed bar (position/layout). **It does
  NOT check size.** The camera-commit watcher logs the new `viewBox` string
  when it changes and the layout checker measures rectangle *widths and
  heights only for furniture collisions* (is the touch target at least
  103.5px, does the bar overflow) — nothing anywhere compares an actual
  camera zoom scale, or an art element's rendered size, against an expected
  value. **This is exactly how the Delhi flight's 2.5x zoom shrink (see
  "per-place camera padding" above) went completely unnoticed through a
  fully green `tour:strip` run**: the cue landed on the right word, nothing
  collided, and the run exited 0 — the flight was simply 2.5x smaller than
  it used to be, and nothing was watching for that. If a state screen adds
  a new camera flight or a new piece of scaled art, do not trust
  `tour:strip` alone to catch a regression in *how big* it ends up on
  screen; look at the actual screenshots it writes to `build/tour/`, or use
  `probe:camera` below.

- **`npm run place:strip`** — the same idea as `tour:strip`, aimed at
  `/place/:slug` instead of the tour, because that route had zero layout
  gating until Plan 6's Task 1b and is about to exist 36 times. Builds,
  serves the production build, and for every place found in
  `content/places/*.json` (derived, not hand-listed — a fifth place lands
  under this gate with no second edit here), navigates straight to
  `#/place/slug` (a real, first-class deep link — see `App.tsx`'s own routing
  comment) at every real iPad viewport in `scripts/lib/devices.mjs` — the
  exact list `tour:strip` uses, imported rather than retyped so the two gates
  cannot silently disagree about what "a real iPad" means. **On its first
  real run it failed 8 of 40 rows**, all landscape, on the exact defect this
  task was inserted to catch: at 1024x768 landscape the licence credit sat
  underneath the caption's own overflowing text (`--say-lines: 4` in
  `place.css`'s landscape breakpoint was never actually measured at the
  narrowest landscape width it covers — the true worst case there is 7
  lines, not 4). The fix was one CSS constant (`--say-lines: 8`, "worst case
  plus one," the same margin the portrait number already carried) plus a
  corrected comment; re-run, 0 problems at 4 places x 10 devices.
  It checks, per place per device: the credit legible and clear of the bar,
  the caption and the name plate (no tile, card or text behind the bar —
  checked per *tile*, not against the shelf's own outer box, which
  deliberately reaches into the bar's padding by design and produced pure
  noise the one time this gate measured it that way instead); every one of
  the nine tiles a real 103.5px+ touch target on-screen with its own label's
  box fully inside the tile's (`.tile` is `overflow: hidden`, so a label
  that pokes out is not a rendering detail, it is invisible text — the
  "Festival" -> "tival" failure mode the task brief that built this gate was
  told about directly); and, learning the `tour:strip` lesson by name, the
  state's own drawn shape (the one path carrying `.lit`, not the whole
  visible country) not clipped by `.map`'s own box and above a **size**
  floor (`fillFraction >= 0.10`, the larger of the shape's own
  width/height as a fraction of the map box's) — real headroom under
  Delhi's own measured 0.188-0.190 (every iPad viewport, three-decimal
  precision — one decimal rounds Delhi to a flat 0.2 and makes any floor at
  that number a permanent false failure on the smallest of the four places)
  while still well above what a 2.5x-class shrink like the tour's own Delhi
  flight would leave behind. **What it does NOT catch.** Phones: the two
  phone rows in `devices.mjs` are excluded from this gate's own device list
  (`IPAD_DEVICES`) on purpose — `place.css` has no phone breakpoint at all,
  the app's own ruling is iPad-only, and gating a brand-new screen against a
  shape nobody designed it for would have meant a shelf/tile redesign this
  task was explicitly told not to do. The 32 places with no `content/`
  file yet (`[data-empty]`, "we have not been to X yet") — the gate only
  ever navigates to the four that exist. Whether a *finger* can actually
  reach the hit layer — `probe:map` owns that; this gate reaches the screen
  by URL, not by a real tap, because nothing it measures (a rect, a label's
  own box, a drawn shape's size) depends on which door was used to arrive.
  Whether the photographs load, whether a tile's animation looks right,
  whether the narration is audible — none of that is a rect.

- **`npm run probe:camera [-- --place=slug]`** — drives the *real*
  `src/map/camera.ts` (type-stripped and inlined, not reimplemented) in
  headless Chrome at three window shapes, and checks the things jsdom
  structurally cannot: is the transform-then-commit seam pixel-seamless at
  the target's corners, does a tap still resolve to the right place after
  the viewBox has changed, does the map recover cleanly if it is torn out
  of the page mid-flight. It also writes five PNGs of the flight in
  progress (`build/camera-flight-*.png`) for a human to eyeball the framing.
  It does compute and print a zoom-factor note (`a fingertip is worth ...
  viewBox units at home and ... here (Nx closer)`) but does **not** assert
  a size threshold against it — that comparison is still something a human
  has to read.

- **`npm run probe:map`** — drives the real `hitLayer.ts` over the real
  geometry in headless Chrome and measures, area-weighted across the whole
  country, how much of it is a dead tap zone (before and after snapping),
  how much is stolen by a neighbouring place, and whether the 269KB of
  *visible* geometry is ever hit-tested (it must never be — that is the
  performance bug the whole hit-layer design exists to avoid). This is the
  tool to re-run once each state gets its own zoomed-in interior geography
  (landmark pins, sub-regions) — it is the only thing that can say whether
  a landmark pin is actually reachable by a six-year-old's fingertip.

- **`npm run colour:check`** — pure arithmetic, no browser: checks that
  every `SUBJECTS` entry resolves to a real `PALETTE` colour, that no two
  *different* consecutive subjects share a page (a repeat of the *same*
  subject, like `countTo` firing three times, is fine — a counting disc
  always looks the same), that `--ink` clears 7:1 AAA contrast on every one
  of the eight page tones, and that `art/palette.ts` still mirrors
  `base.css`. Run this after adding any new `SUBJECTS` row for a state.

- **`scripts/build-world.test.mjs`** — a vitest file, not a standalone
  script, run as part of `npm test`. Asserts the *generated, committed*
  `src/data/world.json` (the background neighbour countries) never overlaps
  India's own depicted boundary by more than a thin seam (0.5% of India's
  area; measured today at 0.075%), never re-draws India itself, and paints
  with flat fill only (no SVG filter, no gradient — see "standing rules").
  It tests the committed output, not a fresh rebuild — same pattern as
  `build-map.test.mjs` for `geo.json` — because neither file is rebuilt by
  `npm test` (no network in CI).

### Test-suite facts worth knowing before you trust a red (or green) run

- **The speech suites are gated behind `CI || TTS_TESTS=1`.**
  `scripts/tts.test.mjs` drives the *real* macOS `say` → `afconvert`
  pipeline, dozens of real synthesis calls — about fifteen minutes, against
  the other 48 files' forty seconds. It runs automatically in CI (where the
  time is cheap) and locally only when you explicitly ask for it with
  `TTS_TESTS=1 npm test`. If you touch the render pipeline
  (`scripts/tts.mjs`, `scripts/lib/cache.mjs`, `scripts/lib/runs.mjs`,
  either provider), run it with that flag before trusting the change.
  Three smaller macOS-only files (`scripts/lib/trim.test.mjs`,
  `loop.test.mjs`, `encode.test.mjs`) `describe.skipIf(!MACOS)` instead —
  they run on any macOS machine, gated only on platform, not on
  `TTS_TESTS`. `scripts/tts-providers/elevenlabs.test.mjs` mocks `fetch`
  entirely and always runs, on any platform.

- **`.claude/worktrees` is excluded in `vite.config.ts`'s `test.exclude`,
  and it matters.** Each git worktree under there is a full checkout of this
  repo on another branch. Vitest's own default excludes do not cover
  dot-directories. Measured directly: with three sibling worktrees on disk,
  a bare `npm test` reported **2,848 tests across 186 files** — including
  failures and skips that belonged to other branches — against a true 743
  across 51. A test count you cannot trust is worse than no test count; if
  a run ever reports numbers wildly different from the baseline at the top
  of this document, check for stray worktrees before assuming the code
  broke.

- **A machine under load produces nondeterministic timeouts that look
  exactly like real failures.** `tour:strip`, `probe:camera` and
  `probe:map` all drive a real headless Chrome against real polling
  `until()` loops with real timeouts (20-180 seconds depending on the
  probe). A loaded machine can make a real, correct run report a timeout
  that a second run does not. **Check `uptime` before believing a red run**
  from any of the browser-driven scripts — a high load average is grounds
  to re-run before debugging the app.

### The standing rules that keep being rediscovered

These have each cost real debugging time at least once. Do not re-derive
them from first principles; the reasons are in the cited files' own
comments if you need the full argument.

- **No SVG `<filter>`, ever, on anything WebKit has to composite.** WebKit's
  legacy SVG engine runs a `<filter>` — including `drop-shadow()` used as a
  filter rather than a CSS property on an HTML box — as a CPU blur, not a
  compositor effect. `MapStage.test.tsx`'s "never puts a CSS filter on an
  SVG child, and keeps drop-shadow last" and `build-world.test.mjs`'s "no
  SVG filter, flat fill only" both guard this from two different angles.
  `--lift` (base.css) is only ever a `box-shadow` on an HTML element or a
  `drop-shadow()` on an `<svg>` **root** — never on an SVG child.

- **Never transform an SVG `<g>` for animation.** `src/map/camera.ts`'s own
  top comment has the full WebKit internals (`LegacyRenderSVGModelObject`
  cannot own a compositor layer; animating `viewBox` triggers a layout
  invalidation on every frame). The pattern this project uses instead —
  transform an HTML wrapper, then commit the target `viewBox` in one frame
  — is `camera.ts`'s whole design, and it is the pattern to copy for any
  new camera-like animation a state screen adds, not a bespoke `<g>`
  transform.

- **`var()` does not resolve in an SVG presentation attribute on WebKit's
  legacy engine.** Both `src/tour/effects/art/palette.ts` and `subject.ts`
  exist because of this: they are literal-hex mirrors of `base.css`'s
  custom properties, kept in sync only by a test (`Symbol.test.tsx`'s
  `paletteDrift`, also called from `colour-check.mjs`). Any new SVG art a
  state screen adds must pull its colours from `palette.ts`, never write
  `fill="var(--something)"` directly — it silently falls back to black on
  an iPad and nowhere else.

- **104px touch targets, always.** `--tap: 104px` in `base.css` is 2cm on a
  264ppi iPad — Nielsen Norman Group's figure for under-nines, four times
  the adult recommendation, not Apple's 44pt. `--big` (the huge play
  button) is `--tap * 2`. Every interactive element gets the `.tap` class
  or an equivalent minimum, and `tour:strip`'s layout probe asserts every
  control is at least 103.5px in both dimensions.

- **Every control carries a word, next to its glyph, never instead of it.**
  `src/ui/Glyph.tsx` and `Controls.tsx`/`Controls.css` are built around
  this; `Controls.test.tsx` has a named test for it
  ("labels every control with a word, not only a symbol"). A six-year-old
  who cannot yet reliably parse an icon-only button gets a word every time.

- **A test double must be faithful, or it is worse than no test.** Eight
  files in this codebase say so explicitly in their own comments
  (`App.test.tsx`, `IndiaScreen.test.tsx`, `camera.test.ts`,
  `cheapMode.test.ts`, `cues.test.ts`, `GrandTour.test.tsx`,
  `GrandTour.controls.test.tsx`, `TourStage.test.tsx`, plus
  `diagnostics.test.ts`'s own fake `AudioContext`, built as a fresh,
  *extended* double specifically because `Narrator.test.ts`'s existing fake
  dropped `addEventListener`, which would have let `diagStateChanges` drift
  untested). The lesson, paid for repeatedly: a double that is missing a
  method or a behaviour the real thing has does not fail loudly — it lets
  the code that depends on that behaviour pass a test that proves nothing.
  When you write a fake for a new state screen's dependencies, model it on
  an existing faithful one rather than stubbing the minimum that makes the
  immediate test pass.

---

## The audio/gesture debug panel — deliberately retained

Plan 4 built `src/audio/diagnostics.ts` (`AudioDebugPanel`, behind
`#/?debug=audio`) to answer three questions a real device test needs to
answer before the panel can be safely deleted. **As of this task, all three
are still open** — the father opened the debug URL during a device test but
never reported back what it said, so nothing here was actually answered:

1. **Which WebKit audio bug fires.** At least four different open WebKit
   bugs (263627, 273511, 281566, 283419) can each produce the symptom
   reported from the first device test ("Tap to carry on" appearing,
   pausing unreliable). The panel's `clockAdvancing` reading — derived only
   from comparing `currentTime` against wall-clock time, never from
   `ctx.state`, because two of those bugs report `state === "running"`
   while `currentTime` is frozen — is the only thing that can say which one
   it actually is on his iPad.
2. **Whether `isCheap()` latched `true`.** If it did, `Outline.tsx`'s
   finger-tracing gesture (and every other `!isCheap()`-gated art effect,
   including `Trace` itself) never mounts at all, and everything Plan 4
   built to react to a traced finger is silently inert on his device.
   Nobody has looked at the panel's `isCheap()` line to find out.
3. **Which taps the gesture gate rejected, and by how much.**
   `hitLayer.ts`'s `TAP_MOVE_PX` (20px) and `TAP_MAX_MS` (900ms) are
   reasoned judgement — deliberately widened from adult platform defaults
   for a six-year-old's less precise touch — not a measurement of any real
   child's thumb. `MapStage.tsx` calls `recordTapRejection()` on every
   rejected tap specifically so a real device session can replace the
   reasoning with a reading; no session has done so yet.

**Do not delete the panel or its test until a device session has actually
reported these three readouts.** When it has, deleting it is exactly the
one-line change both `diagnostics.ts`'s and `GrandTour.tsx`'s own comments
describe: remove the `<AudioDebugPanel />` mount and its import in
`GrandTour.tsx`, remove `recordTapRejection`'s call site in `MapStage.tsx`
(and its import), and delete `src/audio/diagnostics.{ts,test.ts}`.

---

## Decisions from Plan 5, recorded so they are not re-opened by accident

**iPad-only.** Already ruled and written up in "Rulings that should not be
re-opened" below (Plan 5 Task 4) — recorded here again only so it is not
missed: a phone gets an honest warning on the cover screen, not a fixed
layout, because the map screen's own framing has too many measured
constants to re-verify without the very `tour:strip` run that task was
told to run at most once. Revisit only if a future plan actually commits to
a phone-first layout for the map screen.

**The tour is 3:32, not 4:05.** The paid ElevenLabs re-render normalised the
narration's pace for prosodic continuity (the chained-cache-key work
described above) and, as a side effect nobody asked for, shortened the tour
by 13.5% — from 4:05 down to 3:32. The father's original brief asked for
narration that was "soothing and slow," and a 13.5% faster tour is the
opposite of that. This is **awaiting his ear**, not a bug: nobody has
listened to the re-rendered tour and said whether the new pace still reads
as soothing. What changed in Plan 4 that makes this cheap to revisit: timed
art now follows the *media clock* rather than a wall-clock timer, so
lowering the default playback rate is now a safe one-line lever (it will no
longer desync the pictures from the words the way it would have before
Plan 4). If the father says it feels rushed, that is where to look — not a
re-render, just a playback-rate default.

**Real photographs, including animals, are still outstanding.** The first
device test's feedback — *"the images are fake and not original, the tiger
and others are fake"* — is still literally true: the 20 licence-cleared
photographs in `src/data/photo-credits.json` contain **no animals**. This
was deliberately left out of Plan 5 (whose symbols are the SVG illustrations,
not photographs) and belongs with the 32 state screens instead, because that
plan needs roughly 32 places x 5 landmarks of photography (160 total) and
the licence-check-and-credit pipeline (`scripts/fetch-photos.mjs`,
`photo-credits.json`'s `attributionHtml` shape) should be built once for all
160 rather than being built twice — once now for a handful of animal photos
and again for the full set later.

---

## What works today

`npm run validate && npm run test && npm run build` is green. 142 tests.

| Output | What it is |
|---|---|
| `src/data/geo.json` | All 36 states and union territories: SVG path, label centroid, zoom bbox, and land neighbours derived from shared geometry. Official Survey of India depiction, gated on a recorded `northernBound` of 37.077. |
| `src/data/timings.json` | 73 narration clips: audio path, duration, per-word start and end times, and animation cues already resolved from word index to seconds. |
| `src/data/photo-credits.json` | 20 landmark photographs with render-ready `attributionHtml`. |
| `src/data/sound-credits.json` | 11 sounds with the same attribution shape. Seven are CC BY-SA and legally require the credit to be displayed. |
| `content/` | Four complete places (Rajasthan, Odisha, Kerala, Delhi), the 14-beat Grand Tour, interface lines, the sound wanted-list, and the cue vocabulary. |
| `docs/fact-check.md` | One row per checkable claim, with its source. |

Pipelines, all re-runnable: `build:map`, `tts:draft`, `tts:final`, `fetch:photos`,
`fetch:sounds`, `contact-sheet`.

---

## Known gap worth watching on a real device

**The start gate has no escape route.** `StartGate.begin()` awaits `unlock()`,
and only then advances to the audibility check. If `AudioContext.resume()`
never reaches `running` — which WebKit bug 263627 documents as possible, and
which is exactly what the engine's own `stuck` flag exists to handle — the
child stays on "Tap here to begin" forever, with no feedback and no way past.
Every later screen has a way out (Controls surfaces "Tap to carry on"); the
first one does not. Reproduced deliberately in headless Chrome, where a
synthetic click cannot unlock audio: the gate simply never advances.

On a real device a real tap should always unlock, so this may never fire. But
if the iPad test shows any hesitation on that first screen, this is why, and
the fix is a timeout plus a visible retry.

## Waiting on a human

**1. Twelve sound effects could not be sourced.** Wikimedia Commons does not have
usable versions, and its search keeps returning wrong subjects — it offered a
European bison for `tiger-growl`, a 1916 gramophone song for desert wind, a
police siren for city ambience. Those were rejected rather than shipped.

Missing: `tiger-growl`, `lion-roar`, `camel`, `rhino`, `temple-bell`,
`whoosh-soft`, and the `desert`, `mountain`, `city`, `plains`, `temple` and
`island` ambient beds. Five of these are already referenced by the seed content
and are reported as tracked gaps on every `npm run validate`.

The fix is a **free Freesound account**. Only the search endpoint needs a token;
the preview MP3s download without authentication and are 128 kbps, better than
the 56 kbps delivery target. `content/sounds.json` is the wanted list.

**2. Human gates that a machine cannot close.** Three of the five were done or
proxied; two remain genuinely open:

- ✅ The generated map was rendered and visually approved.
- ✅ Photographs were reviewed; two needed hand-picked overrides, recorded in `scripts/fetch-photos.mjs`.
- ✅ Facts were checked and 16 false claims removed.
- ⬜ **Nobody has listened to the audio.** Every clip is verified mono, 44.1 kHz and plausibly long, but no human has heard one.
- ⬜ **Nobody has read the narration aloud to a 6–8 year old.** That is the real test.

**3. Two photographs are weak but not wrong.** `odisha.konark` shows the temple
without its famous wheel; `rajasthan.ranthambore` is an empty landscape with
neither tiger nor fort. Both pass every automated check.

**4. The speech budget.** The four seed places use 11,613 of a 99,100-character
ceiling. Extrapolating, all 36 places land near the target with room to spare.
The paid render costs roughly $9 a pass on a tier giving 220,000 characters for
$22, first month $11.

---

## Carried into Plan 2

- **Lakshadweep and the smaller Andamans are sub-pixel** at 1000x1100. They are
  in the data and correct; the renderer needs a minimum-radius marker or an inset.
- **A missing sound must be a silent no-op, never a crash.** Five referenced
  sounds do not exist yet.
- **Attribution must be rendered.** CC BY and CC BY-SA files carry
  `attributionRequired: true` and the credit belongs near the image, not only on
  a colophon page. Show photographs unmodified and frame with CSS `object-fit` —
  cropping or overlaying creates an adaptation, which for CC BY-SA must itself be
  released under the same licence.
- **`base: './'` requires `HashRouter`.** Mixing it with `BrowserRouter` breaks
  deep links in production only, so it passes local testing and fails live.
  Nothing in this branch enforces that; it is Plan 2's obligation.
- **Content lives in `content/`, not `src/data/`.** The app imports
  `content/places/*.json` and `content/{tour,ui}.json`. `tsconfig.app.json`
  already covers them.
- **The illustration contract is bigger than the plan assumed.** 20 landmarks
  produced 20 near-unique `scene` keys, so the "kit of reusable primitives" is in
  practice closer to one bespoke illustration per landmark — about 180 across 36
  places. Worth deciding the approach before Plan 2 commits to it.
- **Decoded audio memory.** Compressed audio expands roughly 24x when decoded.
  Keep only the current and next place decoded, or an older iPad will crash with
  no catchable error.
- **The iPad mute switch.** Web Audio routes to the ringer channel by default, so
  an iPad with the switch on plays nothing. Set
  `navigator.audioSession.type = 'playback'` inside the unlock gesture,
  feature-detected. This is the highest-severity user-facing failure available.

---

## Rulings that should not be re-opened

**The tour deliberately has no ambient bed.** The engine's ducking machinery
(`DUCK`, `SETTLE_MS`, the settle timer) has no caller in the app and that is
correct, not an oversight — it was raised three times during Plan 2. The Grand
Tour is about the whole country, and every bed sourced so far is wrong for
that: `forest` is Bourne Woods in Surrey, `ocean` is Brazil. A wrong-country
bed under a tour of India is worse than silence. Ambience is authored per
place (`rajasthan.json` carries `desert`) and belongs to the plan that builds
the state screen, where the machinery is used and already tested.

**Small states get generous pins at the cost of their neighbours' edges.** A
child who deliberately taps tiny Sikkim and gets nothing is a worse failure
than one grazing the far edge of West Bengal and getting Sikkim, because
nobody deliberately taps a border sliver. Measured: the deepest intrusion
reaches 58% of the victim's body radius at worst and nothing reaches an inner
fifth.

**The app is iPad-only. A phone gets an honest warning, not a fixed layout.**
Plan 5 Task 4's colour gate made a pre-existing problem visible rather than
new: at `390x844` the map screen's gold "Show me India" button (`--big`,
208px — deliberately, "shrinking the button is not on the table" per
grandTour.css) sits over almost the whole drawn country, because the map
itself has barely more than a button's worth of height left once a phone's
control bar and read-along caption take their share. Beige hid this; colour
did not. Two ways to close it were on the table: shrink or reposition the
button (off the table — it is the tap target for a hand that has not learned
to aim, and the map's own framing is a web of other measured constants this
task could not re-verify without the very tour:strip run it was told to run
at most once), or accept the phone was never the target device and say so.
**Ruling: iPad-only**, matching how the father actually tests this app.
`src/screens/StartGate.tsx`/`startGate.css` now show a short, honest line —
"Namaste India is built for a tablet..." — on the cover screen below 600px,
CSS-only (`display: none` above it), so the iPad experience is byte-for-byte
unchanged. The map screen itself (`grandTour.css`) was deliberately left
alone: the button still fully works on a phone, it is just visually snug, and
that is now a documented choice rather than an accident. Revisit only if a
future plan actually commits to a phone-first layout for the map screen —
that is a real redesign, not a CSS tweak.

## Parked, with rulings

Real but deliberately not fixed:

| Item | Ruling |
|---|---|
| Orphan pruning — deleting a place leaves its audio and cache key | Carry. Harmless until places start being removed. |
| Narration is double lossy-encoded (provider MP3 to AAC) | Carry. Unavoidable without ffmpeg; `afconvert` is MP3-decode-only. |
| `--only` plus a synth failure can drop one still-good timings entry | Carry. Costs one re-render, documented in the code. |
| Ambient beds are not Indian in origin (forest is Surrey, ocean is Brazil) | Carry. Fine for a bed; the user's call. |
| `api()` loses the original network error cause on final failure | Carry. Diagnostics only. |

~~User-Agent still says `github.com/OWNER/REPO`~~ — **done.** The repository
exists, and `scripts/lib/wiki.mjs` now identifies itself as
`https://github.com/tkantk/India` with the issues URL as its contact, which is
a contact [Wikimedia's policy](https://meta.wikimedia.org/wiki/User-Agent_policy)
explicitly accepts. `scripts/lib/wiki.test.mjs` asserts the shape (a contact is
present and non-empty) rather than the literal string, so a future rename does
not silently reintroduce a placeholder.

---

## The one thing not to break

Animation cues are authored as **word indices**, never timestamps. That is what
lets the whole site be built against a free draft voice and then re-rendered with
the paid one — every timestamp changes, no index does. `cueTimes()` in
`scripts/lib/words.mjs` is the seam. If someone "simplifies" cues to timestamps,
the final render silently desynchronises every animation in the project.
