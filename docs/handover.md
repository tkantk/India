# Namaste India — state of play

**Live at https://tkantk.github.io/India/** since 2026-08-22.

Last updated 2026-08-21, at the end of **Plan 1 (asset pipeline)**.

Read this before starting Plan 2. It records what exists, what is deliberately
missing, and the decisions that are waiting on a human.

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
