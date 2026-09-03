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
gap ever reaches a child's iPad. What it actually covers is derived, in
`REQUIRED_KEYS`, from `vocab.json`'s `revealSymbol` (11 keys) and `rivers`
(1) lists plus `VERB_SUBJECT_KEYS` — add one of *those* without a row here
and the whole app refuses to build. That is the point: it is telling you the
row is missing, not that something is broken.

**`scene` keys are NOT covered, and an earlier version of this document
claimed they were.** Corrected 2026-09-03, by reading the code rather than
trusting the sentence: `vocab.json`'s `scenes` list (157 keys today) is read
by exactly one thing — `scripts/validate-content.mjs`, which checks that a
landmark's `scene` is a declared vocabulary word — and by nothing in `src/`
at all. `REQUIRED_KEYS` does not include it. Adding a landmark's `scene` key
without a `SUBJECTS` row does not break the build and never did. **The code
is right and the claim was wrong**, which is the way round it had to be
resolved: covering all 157 would demand 157 bespoke illustrations, exactly
the work that "the illustration contract is bigger than the plan assumed"
(below) deliberately deferred. Landmarks are photographs today, not drawn
scenes, and the `scenes` vocabulary is a reservation for art that does not
exist yet.

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
`festival` line changes only that one line's cache key.** A run of more than
one (the tour) uses `chainedKey(signature, text, nextText, prevKey)`, which
folds in the *next* line's text and the *previous* line's own key — so
**editing any one beat of the tour re-renders that beat and every beat after
it in the chain**, because each key depends on the one before it. This is
deliberate (ElevenLabs' `next_text` is a real prosody lookahead, not
bookkeeping — it audibly affects the segment before it) but it is also why a
one-word tour fix can cost a full tour re-render while a one-word place-card
fix changes only one key. If a future state screen ever wants prosodic
continuity across multiple lines (unlikely — a card is tapped independently,
not read straight through), it would have to become a run of more than one
on purpose; by default, keep every new line a run of one and get the cheap
key for free.

**"Changes only that one line's cache key" is not the same claim as "costs
only that one line's render"** — see the batching rule immediately below,
added after this project's first real ElevenLabs re-render experience: a
cheap key and a seamless-sounding place are different guarantees, and only
one of them was ever actually made by runs-of-one on their own.

### The batching rule — a place re-renders as a whole, and this is NOT conditioning

Added 2026-08-24, after the father reported *"the voice is a bit different a
bit more deep and someplaces its fine"* across the four seed places. The
diagnosis: three of the four places (Delhi, Kerala, Rajasthan) had their
clips split across **two different paid render sessions**, one day apart —
eight lines, corrected for factual accuracy in an earlier plan
(`delhi.card.festival`, `delhi.humayuns-tomb.line`, `delhi.intro`,
`kerala.card.animal`, `kerala.card.hello`, `rajasthan.card.hello`,
`rajasthan.chand-baori.line`, `rajasthan.intro`), were re-rendered a day
after the other twenty-two. Odisha, whose ten lines all came from the same
22 August session, is the one place he said sounds fine.

**The settings did not drift.** `stability 0.55`, `similarity_boost 0.75`,
`speed 0.85`, `use_speaker_boost true`, model `eleven_multilingual_v2`, and
`elevenlabs.mjs`'s own `signature()` (which the cache key folds in) were all
byte-identical across both sessions. The only change on the 23rd was adding
`previous_request_ids`/`next_text` support, and both are empty for a place
line, because places are runs of one (see above) — so neither line of the
two sessions was ever conditioned on the other. **The same request, sent
twice, produced an audibly different take.** ElevenLabs does not reproduce
its own previous output for identical input. This is the whole finding, and
it means a cheap cache key (runs-of-one, above) and a seamless-sounding place
are different guarantees — getting the first one right, on its own, was
never enough to promise the second.

**The rule:** a place must re-render **as a unit** — all ten lines, in one
script invocation — whenever any one of its lines changes. This is
**BATCHING**, and it is deliberately a different rule from **CONDITIONING**
(the runs-of-one section immediately above), even though both now live in
the same two files (`scripts/lib/runs.mjs`, `scripts/tts.mjs`). Do not
confuse them, and do not "simplify" one into the other:

- **Conditioning** decides whether one line's *audio* is chained to
  another's via `previous_request_ids`/`next_text` — whether the request
  sent to the provider references a sibling request at all. This is what
  makes a run a run of *one* versus *many*, and the reasoning for keeping
  every place line a run of one is unchanged and still correct: chaining an
  independently-tapped card line to whatever rendered before it would make
  it open like the continuation of a sentence the child never heard.
  **Batching must never start chaining place lines to fix a drift
  problem** — that would reintroduce exactly the failure mode conditioning
  was built to avoid, to fix a different failure mode entirely.
- **Batching** decides which lines a render *pass* includes and actually
  renders, so that a place's ten independent, unchained, single-line
  requests all still happen in the same sitting. It never appears in a
  request body and never changes a line's own cache key format.

**How it is implemented, and why not the obvious way.** The first draft of
this fix folded a hash of the whole place's text into every one of its
lines' cache keys, so that editing any line changed every line's key at
once. That is wrong, and was caught by `scripts/tts.test.mjs`'s own
partial-failure regression suite before it shipped: changing the key
*format* invalidates it for **every** place immediately, the day the change
lands, including places nobody edited — Odisha would have been re-rendered
(and re-billed) by this fix alone, which is the opposite of "leave Odisha
alone." The actual implementation never touches `keysForRun` or the cache
key format at all:

1. `collectRuns()` tags every place line with a `place` field (that place's
   own `id`) — a plain grouping label, not part of any key.
2. `selectRuns()` widens a narrow `--only` match (`--only=delhi.card.food`)
   to every run sharing that line's `place`, the same way it already widens
   a matched tour beat to the whole chained run — so a place's other nine
   lines are never left out of scope just because the edit was narrow.
3. `applyBatching()` (`scripts/lib/runs.mjs`) is the actual trigger, run
   once per pass in `scripts/tts.mjs` after every run's own cache state is
   known: if any line in a place's group is **genuinely edited** — it *was*
   rendered before (a cache entry exists) but its key no longer matches —
   every line in that group is forced to render, `{ effectiveStart: 0 }`,
   even the ones whose own key still matches perfectly.

**The "genuinely edited" qualifier is load-bearing, not incidental.** A line
with *no* prior cache entry at all — a brand-new place's first-ever render,
or a line a previous run never reached because it failed partway through —
does not count, even though it also needs rendering. The first shape of this
fix treated "needs rendering" and "was edited" as the same signal and got
this wrong: it forced a partially-failed run's already-good, already-cached
lines to re-render (and re-bill) on every retry, which `scripts/tts.test.mjs`
already had a named regression test for ("does not re-render (re-bill) the
completed lines on the next run") — this is the test that caught it.
`scripts/tts.test.mjs`'s own `batching:` describe block now drives the real
pipeline end to end (edit one line, run unscoped, assert all ten lines of
that place re-render while an untouched second place does not) specifically
so this distinction cannot silently regress again.

**What the preflight says.** `npm run tts:final` (dry, no `--yes`) prints a
line per affected place — `"<place>.* is a N-line batch (never chained —
each still its own request): this pass renders all N of its N lines, X
characters, about $Y"` — deliberately worded differently from the existing
chained-run message above it, so the two are never mistaken for each other
on screen either.

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
  flight would leave behind. **UPDATE, phone plan: phones are no longer
  excluded.** This gate used to skip the two phone rows in `devices.mjs`
  (`IPAD_DEVICES`, since deleted) because `place.css` had no phone breakpoint
  at all and the app's own ruling was iPad-only. Both premises are gone —
  see "The app is responsive, deliberately, as of the phone plan" below —
  and this gate now measures every device in `devices.mjs`, phones included,
  with no separate list. Its very first real run against the new phone rows
  failed all eight (four places x two phones): the four/five-across tile row
  gave every tile under half the 103.5px floor. `place.css`'s phone rule (a
  stacked layout — the map keeps a real floor, the shelf becomes a scrolling
  `auto-fit` grid instead of a fixed column count) is what made it pass; see
  that file's own comments for the numbers and why each one is what it is.
  **What it still does not catch.** The 32 places with no `content/`
  file yet (`[data-empty]`, "we have not been to X yet") — the gate only
  ever navigates to the four that exist (though `place.css`'s own phone rule
  covers that page too — see its "the empty page scrolls" comment, added
  after actually looking at one and finding it broken the same way). Whether
  a *finger* can actually reach the hit layer — `probe:map` owns that; this
  gate reaches the screen by URL, not by a real tap, because nothing it
  measures (a rect, a label's own box, a drawn shape's size) depends on
  which door was used to arrive. Whether the photographs load, whether a
  tile's animation looks right, whether the narration is audible — none of
  that is a rect. Phone LANDSCAPE — see `devices.mjs`'s own comment on why
  it is carried, not covered, this round.

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

## The audio/gesture debug panel — answered, and now deleted

Plan 4 built `src/audio/diagnostics.ts` (`AudioDebugPanel`, behind
`#/?debug=audio`) to answer three questions a real device test needed to
answer before the panel could be safely deleted. **2026-08-24: all three are
now answered**, from the father's own screenshot of `#/?debug=audio` on his
iPad:

```
isCheap()  false  (slow false, medianFrame 17.0ms, reducedMotion false)
state      running     clockAdvancing true     stuck false
resume()   settled in 82ms
recent rejected taps: (none)
```

1. **Which WebKit audio bug fires: none of them.** `state` is `running` and
   `clockAdvancing` is `true` — the audio clock is genuinely advancing, not
   one of the two bugs (263627, 283419) that report `state === "running"`
   while `currentTime` sits frozen. `resume()` settled in 82ms, ruling out
   bug 281566 (a `resume()` promise that never settles). `stuck` is `false`.
   No sign of any of the four bugs this panel existed to distinguish between.
2. **Whether `isCheap()` latched `true`: no — `false`.** The finger-tracing
   gesture (`Outline.tsx`'s `Trace`, and every other `!isCheap()`-gated art
   effect) genuinely mounts on his iPad; nothing Plan 4 built for a traced
   finger is silently inert on his device. `medianFrame 17.0ms` is
   comfortably inside a 60fps frame budget, and `reducedMotion` is off.
3. **Which taps the gesture gate rejected: none.** "recent rejected taps:
   (none)" — `hitLayer.ts`'s `TAP_MOVE_PX` (20px) and `TAP_MAX_MS` (900ms),
   reasoned judgement widened from adult platform defaults for a
   six-year-old's less precise touch, are not eating any of his son's real
   taps. The reasoning did not need correcting.

**The panel has been deleted** — `src/audio/diagnostics.{ts,test.ts}`, the
`<AudioDebugPanel />` mount and import in `GrandTour.tsx`, and
`recordTapRejection`'s call site and import in `MapStage.tsx` — exactly the
one-line-each change its own comments described, now that the readout it
existed to produce has actually been read. `Narrator.ts`'s `diag*` getters
(`diagState`, `diagCurrentTime`, `diagStateChanges`, `diagResumeSettled`,
`diagResumeMs`) were left in place, unused but harmless, in case a future
device regression needs the same read-only instrumentation again — see that
section's own updated comment. `hitLayer.ts`'s `TAP_MOVE_PX`/`TAP_MAX_MS`
comments were updated to point here instead of the now-deleted file.

---

## Decisions from Plan 5, recorded so they are not re-opened by accident

**REVERSED — the app is responsive now, not iPad-only.** This was ruled in
Plan 5 Task 4 and overturned in the phone plan that follows Plan 6; see "The
app is responsive, deliberately, as of the phone plan" below, in "Rulings
that should not be re-opened," for the full reasoning and why the original
ruling does not re-derive from the same premises any more.

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

**The app is responsive, deliberately, as of the phone plan.** This reverses
Plan 5 Task 4's "iPad-only" ruling (below, kept struck through rather than
deleted, because the reasoning that replaced it matters as much as the
reversal itself), at the owner's own direct request: *"I saw this does not
open well in Phones. I know this cannot be intented towards phones but kids
can click right. We have to make it responsive enough."* He was right, and
it is worth being precise about **why the original ruling was wrong**, not
just that it was: **it was made by looking at the map screen, before the
place screen existed.** Task 4 measured the map screen's own gold button at
`390x844`, judged it "visually snug" (correctly — the button still worked,
it was merely tight), and extrapolated iPad-only for the whole app from that
one screen. Nobody had built the place screen yet, so nobody could have
looked at it, and when it was finally measured on a phone — `node
scripts/shot.mjs place.rajasthan --w=390 --h=844` — it was not snug, it was
unusable: `map=334x46 say=403px shelfBottom=844 barTop=618`. A 46px sliver
of map, a 403px caption overlapping four rows of tiles, the name plate and
the trail beads floating on top of the words. The old ruling's own
reasoning ("the button still fully works, it is just visually snug") never
applied to this screen at all; it was re-derived onto it by accident,
because a phone user would obviously hit BOTH screens.

**What changed, concretely.** `src/screens/place.css` and
`src/tour/grandTour.css` now carry real `@media (max-width: 600px)` phone
layouts — not a shrunk copy of the iPad one, a genuinely different
arrangement for a tall narrow screen: the map keeps a real, stated minimum
(see `place.css`'s own "the phone" section — 160px stated and defended,
167-199px actually measured on the two phone rows this app gates on, in the
same range, 166-195px, the tour's own phone map already shipped at), the
caption's lane is sized for the SHORT case and scrolls internally for the
two outliers (a 400-character intro can be sixteen lines at this width — see
that section's own measurements — and reserving the true worst case would by
itself cost more of the screen than the map is being given), and the shelf
of nine tiles becomes a CSS Grid (`auto-fit`, `minmax`) that fits as many
104px-or-wider columns as the real width allows and scrolls for the rest,
rather than the iPad's fixed four/five-across rows. Touch targets did not
shrink anywhere — `--tap` is still 104px, checked by the gate at 103.5px on
every device including both phones.

**One bug this surfaced, fixed at its root rather than patched around.**
`grandTour.css`'s phone rule set `--map-ceiling`/`--map-floor` on a BARE
`.india` selector — correct while `IndiaScreen` was the only screen carrying
that class, and silently wrong the moment `PlaceScreen` existed too, because
Vite bundles every screen's CSS into one stylesheet loaded on every route
regardless of which one is on screen, and a bare `.india` rule has enough
specificity to beat base.css's `:where(.india)` formula on the OTHER
screen's own root. `IndiaScreen`'s root is now `className="india tour"` and
`grandTour.css`'s own rules are `.india.tour`, the same two-class shield
`.place` already used for the reverse case — see `IndiaScreen.tsx`'s own
comment for the full account. This had been silently true since the first
day both screens' CSS shipped in one bundle; nothing surfaced it until a
phone breakpoint on `place.css` gave it something to actually corrupt.

**The gates changed too, and this is not optional.** `scripts/lib/devices.mjs`
is the single viewport list both `tour:strip` and `place:strip` import.
`place:strip` used to filter its own two phone rows out
(`IPAD_DEVICES`, since deleted) specifically because this ruling made phones
out of scope; `tour:strip` measured them all along (the tour's own phone
layout already existed and already passed). Both gates now measure every
device in the shared list, phones included, with no separate list — the
exemption dies with the ruling it depended on. `place:strip`'s first real
run against the new phone rows failed all eight (four places x two phones):
the tile grid alone gave every tile under half the required floor. Fixing
`place.css` is what turned that green; see `build/place-layout.json` for the
full measurement.

**Phone landscape is carried, not covered, this round** — a phone on its
side at this size class is wide enough to miss `place.css`'s own
`max-width: 600px` phone rule and short enough to miss the existing
`min-width: 900px` tablet-landscape rule too, so it would fall through to
neither hand-measured layout. See `devices.mjs`'s own comment for the full
reasoning. A genuine third layout for it is real, separate work; nobody
using this app in portrait (which is how the father actually holds a phone,
and how a six-year-old is handed one) is affected by leaving it for later.

~~**The app is iPad-only. A phone gets an honest warning, not a fixed
layout.**~~ Struck through, not deleted — Plan 5 Task 4's original ruling and
its reasoning, both now superseded above:

~~Plan 5 Task 4's colour gate made a pre-existing problem visible rather than
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
Ruling: iPad-only, matching how the father actually tests this app.
`src/screens/StartGate.tsx`/`startGate.css` now show a short, honest line —
"Namaste India is built for a tablet..." — on the cover screen below 600px,
CSS-only (`display: none` above it), so the iPad experience is byte-for-byte
unchanged. The map screen itself (`grandTour.css`) was deliberately left
alone: the button still fully works on a phone, it is just visually snug, and
that is now a documented choice rather than an accident. Revisit only if a
future plan actually commits to a phone-first layout for the map screen —
that is a real redesign, not a CSS tweak.~~ (The cover screen's own phone
paragraph — `.gate__phone-note` — has been deleted along with this ruling;
leaving it in place would have been actively wrong now, not honest.)

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

---

# STATE AT SESSION CLOSE — 3 September 2026 (second session of the day)

Supersedes the earlier close note from the same date. Everything below was
verified at the time of writing, not remembered.

## The headline: the deploy blocker is gone, and the photographs are not fake

The previous close said "DO NOT DEPLOY YET" because all 36 places had text and
only 4 had audio. **That is fixed.** It also listed 160 landmark photographs as
the first outstanding item. **That is fixed too**, and doing it surfaced six
real accuracy defects that had already been written to disk.

## What was done

**1. The narration rendered.** All 32 new places, in one pass.

| | |
|---|---|
| clips | **393** (320 rendered, 73 reused from cache — nothing re-billed) |
| narration | **121.1 minutes** |
| billed | **36,310 characters, $3.63** against a $6.60 preflight estimate |

Every one of the 393 `timings.json` entries was checked to have its audio file
actually on disk. The ~55%-of-estimate pattern from the two previous bills held
exactly. **Worth one look:** the provider billed 29,694 characters FEWER than
the sum of the submitted text. That direction proves `next_text` is not billed
on top of the primary text, but the shortfall is not explained by anything the
script can see — compare against the account's own usage page.

**2. The photographs.** 213 wanted (180 landmarks + 33 distinct species), **210
fetched, 3 deliberately absent**, 0 unresolved failures.

**3. Six accuracy defects found and fixed.** The automatic fetch wrote all six
to disk, and every one of them passed every gate that existed at the time. They
are listed here because the pattern matters more than the individual files:
**each gate this project has built asks a question, and a file that is wrong in
a way nobody has yet asked about sails straight through.**

| what shipped | what it actually was |
|---|---|
| `western-tragopan` | a 17th-century Mughal painting (St. Petersburg Muraqqa) |
| `sangai` | a photograph of a **replica** — then, on the next pass, of the Sangai **Festival** |
| `mishmi-takin` | *"Idu Mishmi **man** on track from Anini"* — a person, matched on the word "Mishmi" |
| `gayal` | the **identical file** as Goa's `gaur`, captioned as a gaur |
| `blackbuck` | correct species, photographed in **Bardiya, Nepal** |
| `lakshadweep.minicoy` | the same NASA MODIS frame as `lakshadweep.from-space` — one place, two tiles, one picture |

## Three fixes to `scripts/lib/wiki.mjs`, all test-first

**A. An explicit statement now outranks a crude rectangle.** `INDIA_BBOX` is
one flat 6–36°N by 68–98°E rectangle, so it contains Nepal, Bhutan, Bangladesh
and much of Pakistan, Tibet and Myanmar entirely; only Sri Lanka had ever been
carved out, and that carve-out's own comment says in as many words that the
others were not guarded. The Nepal blackbuck was geotagged 28.248°N 81.325°E —
genuinely inside the box — while its only Commons category read `Antilope
cervicapra in Nepal`. `localityVerdict` now refutes on that text **before**
consulting the coordinate. Carving Nepal out by bbox is not available as a fix
and should not be attempted: a Nepal rectangle overlaps Bihar, Uttar Pradesh,
Sikkim and north Bengal, so it would reject genuinely Indian photographs.
Requiring the text to name another country **and not India** keeps a range
category ("Mammals of India and Nepal") from refuting anything.

**B. `isZooPhoto` learned the zoos that avoid the word "zoo".** Disney's Animal
Kingdom, Tierpark, Bioparc, aviary, vivarium, breeding centre, pheasantry,
rescue and rehabilitation centres. The Sarahan Pheasantry and Berlin Tierpark
candidates for the two Himalayan birds were passing before this.

**C. `vetAnimal` now asks whether the subject is a living animal at all.** New
`isNotLivingAnimal` rejects paintings, illustrations, engravings, manuscripts,
taxidermied and museum specimens, skeletons, statues, sculptures and replicas.
**It is animal-only, and that restriction is load-bearing** — Jharkhand's
Sohrai houses are a landmark whose whole subject IS a wall painting, so `vet()`
must never learn this rule. There is a named test pinning exactly that.

## Two things that are NOT bugs

**`NO_PHOTOGRAPH` (in `scripts/fetch-photos.mjs`) is a supported end state.**
Three species have no honest free photograph and now say so by name, with the
reason: `Western tragopan` (every candidate captive at the Sarahan Pheasantry,
a 1915 book plate, a GODL stamp, or the Mughal painting), `Markhor` (Augsburg
Zoo, Berlin Tierpark, Padmaja Naidu, or 1904 hunting books), `Sangai` (a
replica, an illustration, a 240px thumbnail, a deer at Disney's Animal Kingdom,
or the festival that shares its name). This table is deliberately separate from
`OVERRIDES`: an override says "the pick was wrong, here is the right file", an
entry here says "every candidate is wrong and the correct answer is none."
**Without it each run re-picks the least-bad wrong file and ships it** — which
is exactly how the sangai arrived at a replica, and then at a festival.
`PlaceScreen.tsx`'s `photo` field is explicitly allowed to be undefined and
renders nothing rather than a stand-in, so this is honest, not a hole.

**The landmark path only ever examined the top search hit.** An animal vets a
pool of ten; a landmark took `commonsSearchMany(name, 10)[0]` and gave up if it
failed. That asymmetry is why all 24 landmark failures reported "NO USABLE
IMAGE" while passing candidates sat directly behind the one that failed.
`scripts/override-candidates.mjs` (new, read-only, writes nothing) vets the
whole pool and prints what passes. **It does not auto-pick, on purpose** —
`OVERRIDES`' own rule is that the script never guesses, and the picks it
enabled prove why: the top-ranked hit was outright wrong in six of the 24. A
British geograph.org.uk photograph outranked every Ladakhi cham dancer; a photo
of Lucknow's *Residency* outranked the Bara Imambara; a waterfall captioned
"**Near** Talakona" outranked Talakona; the Dzukou lily (a different species,
in a different state) outranked the Shirui lily.

## Verified green at close

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `npm test` | **850 passing**, 32 skipped, 0 failures, 53 files |
| `npm run validate` | 36 places · 393 lines · 77,793 chars (ceiling 99,100) |
| `npm run colour:check` | clean |
| photo integrity | 210 credits, 210 files, **0 duplicates**, 0 landmarks missing, 0 missing attribution HTML |
| `npm run place:strip` | **no problems at any of 36 places x 12 devices** (432 rows) |

`place:strip` measures the state's own drawn shape everywhere now — 73-75% of
the map box on every row, far above the 0.10 floor — and the fill-fraction and
clipping checks ran for the first time on the 32 new places, because both live
behind the `ink` measurement that used to come back null. One check inside that
gate is still not running; see "3." above.

The 32 skips are the speech suites behind `CI || TTS_TESTS=1`, as designed.

## `place:strip` — three defects IN THE GATE, found by the render landing

The first full 36-place run after the narration landed reported **325 problem
rows of 432**, every one of them *"the state's own shape is not drawn"*. **The
app was fine.** The screenshots the gate itself writes to `build/place-strip/`
show each page rendering correctly — one state lit, nine tiles, caption and
credit in place. What was broken was the measurement, and it had been latent
since the gate was written.

**1. The ink measurement required EXACTLY ONE lit path in the whole map.** An
intro names its neighbours as it plays (`lightNeighbour`), `useMapNodes.ts`'s
`highlight()` only ever ADDS the class, and nothing clears the previous one
until a different page opens — all deliberate, and all described in
`measureReadAlong`'s own "LEAVE NO TRACE" comment. So Andhra Pradesh's intro
lights Telangana, Delhi's lights Haryana, and the gate called every one of them
"not drawn."

The correlation is **36 of 36**, measured rather than argued: 34 places name at
least one neighbour in their intro (33 in prose plus Ladakh, which says "Jammu
and Kashmir is next door" and carries a `lightNeighbour` cue for it) and every
one of those failed. The only two that never failed on any device are **Andaman
& Nicobar and Lakshadweep** — the island territories whose intros name no
neighbour at all.

**It was the narration render that exposed this.** Before it, 32 of the 36
places had no audio, so no cue ever fired and no neighbour ever lit. This is
the second time in this project a gate turned out to have been passing because
the thing it measures had never actually run.

*Fixed by asking for the shape BY NAME.* Every state path carries `data-slug`
(`hitLayer.ts` writes it), so the gate now selects
`path.lit[data-slug="<slug>"]`. A neighbour being lit at the same time is
correctly irrelevant — it is the app working.

**2. The failure message was unreachable-dead-code wrong.** `litCount` was
recorded only INSIDE the `ink` object, and `ink` is null exactly when the count
is not 1 — so the reporter's `"N states lit, expected exactly 1"` branch could
never execute, and every such row printed the misleading `"the state's own
shape is not drawn"` instead. **"Nothing is drawn" and "three states are lit"
are opposite faults with opposite fixes.** `litCount` and `litSlugs` are now
recorded at row level, always, and the message names which fault it saw.

**3. The read-along check silently skips itself — STILL OPEN, not fixed.**
`hasClip` was a single instantaneous read taken the moment after Play was
pressed, so a clip that had not yet rendered its words was recorded as "no
audio yet" permanently, because the early return never looks again. It now
polls for up to 4 seconds — **and that did not fix it.** Be precise about the
evidence before spending time here:

- **0 of 432 rows have EVER produced a read-along measurement.** All 72 phone
  rows (36 places x 2 phones) report `skipped`, and no row in the file has
  `readAlong.total > 0`. This check has never once run, on any place, before
  or after the narration landed.
- **The thing it checks demonstrably works.** `build/place-strip/west-bengal-390x844.png`,
  written by that very row, shows the read-along mid-sentence with "Bengal,"
  highlighted (`.word[data-current]`), the control bar reading **Pause**, and
  one state lit. So at LAYOUT time the spans exist and narration is playing.
- Therefore `document.querySelectorAll('.read-along .word')` returning 0
  inside `measureReadAlong` is **not** "no audio". `ReadAlong.tsx` renders its
  spans whenever `clip` is non-null (`if (!clip) return null`), independent of
  playback, so either `clip` is null at that exact moment or the probe is not
  seeing the page it thinks it is.

**Why this matters more than it looks.** This is the regression guard for a
real, named, already-shipped defect — read-along highlighting scrolling out of
view on a phone, the thing commit `673f5ee` fixed. That fix is currently
unguarded, and the gate reports "skipped" rather than failing, which is exactly
the silent-pass pattern this project has been bitten by twice before.

**Do not "fix" this by deleting the skip.** The early return exists for a good
reason (a place with genuinely no audio must not hang the whole gate for 20s
and take the other 35 places' layout checks down with it — that happened). The
work is to find out why the spans are invisible to the probe, and the cheapest
next step is a standalone CDP probe against one phone row rather than another
one-hour gate run per iteration.

**A trap for whoever edits `LAYOUT` next: it is a template literal, so a
backslash in it is eaten before Chrome ever sees the source.** The first fix
above used `/#\/place\/([^?/]+)/`, which arrived in the page as `/#/place//`
and threw "Invalid regular expression flags" on the very first row. The slug is
now derived with plain string operations and no backslash at all. If you must
validate this script before a one-hour run, **evaluate the template literal and
parse THAT** — checking the file's raw text passes happily while the string the
browser receives is broken.

## What is left, in order

1. **The owner looks at the contact sheets.** `review/photos.html` (210
   landmarks) and `review/animals.html` (33 species). This is the one check a
   machine cannot do — "is that actually the thing in the picture" — and it is
   the check that caught Konark's missing wheel. The six defects above were
   caught by reading filenames against the narration; a filename can still be
   wrong about its own contents.
2. **Deploy.** No blocker remains once the sheets are approved.

## Open, waiting on the owner

- **Three animal cards have no photograph** (western tragopan, markhor,
  sangai). Honest and supported, but he may prefer a different species for
  Himachal, Jammu & Kashmir and Manipur — each is a one-line `species` change,
  though it would re-render that place's ten narration lines as a batch.
- **`File:Lost Identity -- Keibul Lamjao National Park.jpg`** passes every
  check (4288×3216, CC BY-SA 4.0, categorised only to the sangai's only home)
  but carries no description, so nothing can confirm it shows the deer rather
  than the floating park. One human glance settles it.
- **Twelve sound effects, still unsourced.** Needs a free Freesound account;
  only the search endpoint needs a token. `content/sounds.json` is the list.
- **The tour is 3:32, down from 4:05.** Waiting on his ear; the fix is a
  playback-rate default, one line, free.
- **Nobody has heard the narration, and nobody has read it to a child.** Now
  121 minutes of it.

## Decisions taken this session, so they are not re-opened

- **Sikkim's animal card stays the yak.** The red panda is already one of
  Sikkim's five landmarks; making it the animal card too would spend two of
  that state's six slots on one creature.
- **Both convention-breaking hello cards stay as written.** Nagaland shows
  "Hello" in English because no single one of its languages is the state's;
  Manipur shows four Meitei letters because each is named after a body part.
  Both were judged better than the convention they break.

## Traps a cold start will otherwise walk into

Everything in the previous close note still applies — `place:strip` takes the
better part of an hour and two concurrent runs collide on a hardcoded port;
check `uptime` before believing a red run; `shot.mjs` without `--build` lies
about camera framing; never run `npm run tts:draft`. Add one:

- **`fetch:photos` is incremental and will not revisit a bad photograph.** It
  skips anything already in `photo-credits.json` with a file on disk. To
  replace one, delete BOTH the credit entry and `public/photos/<id>.jpg`, or
  the fix silently does nothing.

---

# AFTER THE FIRST REAL LISTEN — four reports from the owner

He used the deployed app and came back with four things. All four are fixed;
the first two are the ones with a lesson in them.

## 1. `place:strip`'s read-along check had NEVER run — a double invocation

The previous note left this open with the evidence but not the cause. The
cause is one pair of brackets.

`READALONG_SNAPSHOT` is an already-self-invoking expression: it ends in
`})()`. The check called it as `` chrome.eval(`(${READALONG_SNAPSHOT})().total > 0`) ``,
which invokes the IIFE's own RETURN VALUE — `((() => {...})())()` — and
throws `TypeError: (intermediate value)(...) is not a function` every single
time. A bare `.catch(() => false)` then reported that as "no audio yet". The
working call site four lines below uses it bare (`chrome.eval(READALONG_SNAPSHOT)`),
which is why the two behaved differently.

**Diagnosed with `scripts/probe-readalong.mjs`** (new): it replays
`measureReadAlong`'s exact sequence against one phone row and prints the DOM
at each step. It showed **61 word spans present** at the precise moment the
gate reported none. That probe borrows `CLOCK` and `READALONG_SNAPSHOT` out of
`place-strip.mjs` at runtime rather than copying them, so it cannot drift from
the thing it diagnoses.

The catch now rethrows anything that is not a timeout. **The lesson is the
catch, not the brackets:** `.catch(() => false)` on a probe expression turns
every programming error into a plausible-looking negative result.

## 2. The map is explorable on the place screen

*"I clicked on Kerala... the north part gets hidden... no pinch works here."*
Correct, and it had never been possible: `MapStage` only ever recognised taps.

`camera.setView()` (new) commits a viewBox immediately with no flight, because
a finger has to be tracked frame by frame. `clampView()` (new, and unit
tested) is what keeps a child from getting lost: never wider than home, never
tighter than `MAX_SCALE`, never off the edge. It returns the rect it actually
committed, and the caller needs that — the gesture recomputes from the live
view every frame ("the land under your finger stays under your finger"), so a
clamped drag self-corrects instead of banking movement the map never made.

**Opt-in per screen (`explorable`), and the tour deliberately does not get
it**: the tour flies its own camera on cue, so a dragging child would be
fighting the narration for the same viewBox and the next cue would yank it
back.

jsdom cannot test the gesture (no `getScreenCTM`, `createSVGPoint` or
`DOMMatrix`), so `scripts/probe-pan.mjs` (new) drives it in real headless
Chrome — drag pans, pinch zooms, a huge drag stays inside India, and a drag is
not mistaken for a tap. The jsdom tests cover the opt-in and the clamp maths.

## 3. Landmarks now say their own name first

*"Konark... it does not say This is the Sun temple Konark and then describe."*
Measured: **141 of 180 landmark lines never named their landmark**, while
every place intro and every card names its subject.

`scripts/name-the-landmarks.mjs` (new, dry-run by default) generates the
openings. Two things it has to get right:

- **Grammar.** The article comes from the NAME, never from the head noun:
  English drops "the" when a proper name modifies a common one ("Sukhna Lake",
  not "the Sukhna Lake"), and the first run produced exactly that error three
  times. Plurality excludes `-ss` ("Sela Pass" came back as "These are").
- **CUES ARE WORD INDICES.** 19 of those lines carry cues, and prepending
  words shifts every one. Verified: Pakke's hornbill fired on word 30
  ("father") and now fires on word 35 — still "father".

## 4. Pronunciation: spoken spelling and displayed spelling are now separate

The voice was never the problem — it is already Indian-accented ("Tripti",
`accent: indian`). Specific proper nouns are.

`content/pronounce.json` maps a name to how it should be SAID
("Bhubaneswar" → "Bhuba-neshwar"). `scripts/lib/pronounce.mjs` applies it in
`collectRuns`, so the spoken text is what gets hashed into the cache key and a
pronunciation fix re-renders exactly the places that say that word.

**The constraint that shapes the whole design:** `timings.json`'s `words` feed
the read-along, and a child learning to read must never see "Bhuba-neshwar".
So the spoken and displayed spellings are joined BY WORD INDEX, which is why
`respell` refuses any replacement containing whitespace and re-checks the word
count — splitting one word into two would shift every later word's highlight
in that line, silently, and only audibly wrong on a device.

**A table entry that matches nothing is silently useless**, so a test asserts
every name in the table actually occurs in the narration. It caught 43 names
written from general knowledge of India rather than from this content.

**How to add more.** Add the name to `content/pronounce.json`, run
`npm test` (the guard rejects whitespace, self-mappings and orphans), then
`npm run tts:final -- --only=<place>`. Only the places that say that word
re-render, because of the cache key — but each of those re-renders as a whole
batch, so a one-word fix costs that place's ten lines, not one.
