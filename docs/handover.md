# Namaste India — state of play

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
- ⬜ **Nobody has read the narration aloud to the child it is for.** That is the real test.

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

## Parked, with rulings

Real but deliberately not fixed:

| Item | Ruling |
|---|---|
| Orphan pruning — deleting a place leaves its audio and cache key | Carry. Harmless until places start being removed. |
| Narration is double lossy-encoded (provider MP3 to AAC) | Carry. Unavoidable without ffmpeg; `afconvert` is MP3-decode-only. |
| `--only` plus a synth failure can drop one still-good timings entry | Carry. Costs one re-render, documented in the code. |
| Ambient beds are not Indian in origin (forest is Surrey, ocean is Brazil) | Carry. Fine for a bed; the user's call. |
| `api()` loses the original network error cause on final failure | Carry. Diagnostics only. |
| User-Agent still says `github.com/OWNER/REPO` | Fix when the repository exists. |

---

## The one thing not to break

Animation cues are authored as **word indices**, never timestamps. That is what
lets the whole site be built against a free draft voice and then re-rendered with
the paid one — every timestamp changes, no index does. `cueTimes()` in
`scripts/lib/words.mjs` is the seam. If someone "simplifies" cues to timestamps,
the final render silently desynchronises every animation in the project.
