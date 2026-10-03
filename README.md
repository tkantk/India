# Namaste India: Mor's Big Journey

A narrated, interactive map of India for a child of about 6 to 8: an early
reader who can use the whole thing alone by listening and tapping. A parent
built it for their son, in the open.

**Live at https://tkantk.github.io/India/** (GitHub Pages, redeployed on every
push to `main`). Works on an iPad and on a phone held upright.

## What a child does

- **Starts it.** "Tap here to begin" plays a short sound and asks *"Did you
  hear that?"*, because a web page cannot tell whether an iPad is muted.
- **Takes the Grand Tour.** "Show me India" starts a spoken tour of about three
  and a half minutes, led by Mor the peacock: the shape of the country, its 28
  states and 8 union territories, New Delhi, the flag, the national symbols,
  the Ganga, the Himalaya, the seas, and "hello" in many scripts. The map moves
  in step with the words.
- **Taps any of the 36 states and union territories.** The map flies there.
  Each place has ten narrated pages: an introduction, four cards (animal, food,
  festival, hello) and five landmarks, each landmark with a real photograph.
  The animal card plays that animal's real call where an honest recording
  exists. The map can be dragged and pinched.
- **Reads along.** Every word on screen lights up as it is spoken.
- **Fills the India Passport.** Hearing all ten pages of a place presses a
  stamp (the place's own outline) into a 36-slot passport: "You have explored
  12 of 36!"

Every control carries a word next to its symbol, and every tap target is at
least 104 CSS pixels (about 2 cm on an iPad), the size children under nine can
hit reliably.

## The rules that make it what it is

**Accuracy comes first.** This is for one child learning about his own country.

- Every checkable claim in the narration has a row in
  `content/fact-check.json` (716 rows). `npm run fact:check` re-opens each
  cited web page and fails if it no longer contains the quoted words; other
  rows are recomputed from the map data or name a printed source.
- Every photograph has been looked at beside the exact line spoken over it.
  Replacements are chosen by eye, never by file title.
- Every sound was heard by the owner before it shipped. No script picks a
  photograph or a sound on its own.
- **Nothing fake ships.** A painting, a replica, a pelt or the wrong species
  is never used in place of the real thing. When no honest photograph or
  recording exists, the card shows no photograph or the moment stays silent.
  Four animal cards have no photograph (western tragopan, markhor, sangai,
  clouded leopard), and the lion and the rhino are silent. The one deliberate
  exception is the tiger's roar: no usable wild recording exists, so it is a
  zoo tiger, which the owner chose over silence.

**Privacy.** No accounts, no analytics, no advertising, no third-party scripts,
and no requests to any other server while it runs: everything it needs ships
with the site. The only thing it stores is the passport, in one `localStorage`
key on the device. The only outbound links are the source credits at
`#/credits`.

## How it is built

- **A static site.** React 19, Vite, TypeScript and `motion`. No map library
  and no server. Hash routing with `base: './'` so GitHub Pages needs no
  rewrites.
- **Content is data.** Every sentence, fact and animation cue lives in JSON
  under `content/`: 36 files in `content/places/`, the tour in `tour.json`,
  interface lines in `ui.json`, the wanted sounds in `sounds.json`, and the
  schema in `schema.ts`. Application code contains no facts. `npm run
  validate` enforces the schema, completeness and the narration character
  budget (today 393 lines and 81,434 characters, against a ceiling of 99,100).
- **The map is generated** from DataMeet's state and union territory
  boundaries (post-2019, India's official depiction) by `npm run build:map`,
  including which places border which. Neighbouring countries are drawn muted
  from Natural Earth data.
- **The narration is rendered ahead of time and committed;** the app never
  calls a speech service. `npm run tts:final` renders each line with ElevenLabs
  into `public/audio/en/` (393 clips, about two hours) and writes the word
  timings to `src/data/timings.json`, which drive the read-along. Animation
  cues are written as word positions ("at word 14, show the tiger"), never as
  seconds, so re-recording a line never puts the pictures out of step.
- **Photos and sounds are fetched by scripts** with a licence allowlist.
  Photographs (209) come from Wikimedia Commons. Sounds (32) come from
  Wikimedia Commons, iNaturalist, xeno-canto and Freesound. Allowed: CC0,
  public domain, CC BY, CC BY-SA, and the non-commercial CC BY-NC and
  CC BY-NC-SA, which are marked as such on the credits page. No-derivatives
  licences are never allowed, because every sound is cut and levelled.

## Running it locally

You need Node 24, the version CI uses. Node 23.6 is the minimum, because
`npm run validate` imports `content/schema.ts` using Node's built-in type
stripping. There is no `.nvmrc` or `engines` field.

```sh
npm ci
npm run dev        # Vite dev server
npm test           # the test suite (Vitest)
npm run build      # typecheck, then the production build in dist/
```

`npm test` skips the slow speech-pipeline tests unless `TTS_TESTS=1` is set;
they need macOS.

The production build is what ships, and `npm run dev` does not exercise its
relative asset paths (`base: './'`). To check the real build, including from
an iPad on the same network:

```sh
npm run build && npm run preview -- --host
```

On every push to `main`, `.github/workflows/deploy.yml` runs `npm ci`,
`validate`, `test` and `build`, then publishes `dist/` to GitHub Pages.

## Status

**Done and live:** all 36 places, complete (28 states, 8 union territories, 180
landmarks); the Grand Tour; ElevenLabs narration for every line, with
read-along; 209 photographs and 32 sounds, all credited; the India Passport;
the credits page; layouts for iPad and for phones held upright.

**In progress:** offline use, per-place loading, running the layout checks
(`place:strip`, `tour:strip`) in CI, the games, and a Hindi narration track.

**Known gaps:** the four animal cards without a photograph and the two silent
animals above; a phone turned on its side has no layout designed for it.

---

## Reference

### Scripts

These are build-time tools; none of them is part of the app. The narration
and sound scripts need macOS (`afconvert`, and `say` for the draft voice); the
sound scripts also need Python 3 with NumPy. The browser checks need Google
Chrome (set `CHROME=/path/to/chrome` if it is not in the usual place).

**Content and facts**

| Command | What it does |
|---|---|
| `npm run validate` | Schema, completeness and character budget. Runs in CI. |
| `npm run fact:check` | Re-checks every fact against its source. Needs the network, so it is not in CI. Sources get reworded; a red row means "go and look", and a timeout should be re-run before it is believed. |
| `npm run colour:check` | Checks the app's colours against its shared palette. |

**Map**

| Command | What it does |
|---|---|
| `npm run build:map` | `src/data/geo.json` from the DataMeet boundaries. |
| `npm run build:world` | `src/data/world.json`, the neighbouring land. Run `build:map` first. |
| `npm run build:hit` | `src/data/hit.json`, the simplified tap layer. |
| `npm run build:art` | Tour art (outline, Ganga, peaks) in the map's own projection. |

**Narration**

| Command | What it does |
|---|---|
| `npm run tts:final` | Renders new or changed lines with ElevenLabs. Prints the cost and stops until run with `--yes`, e.g. `npm run tts:final -- --only=kerala --yes`. A changed line re-records its whole place, so the place stays one take. |
| `npm run voices` | Lists ElevenLabs voices. |
| `npm run tts:draft` | The free macOS voice. **Do not run it on this tree:** it writes over the committed narration. The render cache lives in `build/`, which is not committed, so on a fresh clone nothing stops it (`git checkout` restores the files). |

The cache also means a fresh clone sees every line as unrendered, so
`tts:final` will offer to re-record all of it. Read the cost it prints before
passing `--yes`. After any render, `src/data/timings.json` should still hold
393 clips.

To change how a name is said without changing how it is spelled on screen,
add it to `content/pronounce.json`, run `npm test` (which rejects entries that
match nothing), then re-render the places that say it with `--only`.

**Photos**

| Command | What it does |
|---|---|
| `npm run fetch:photos` | Fetches photographs from Commons into `public/photos/` and writes `src/data/photo-credits.json`. It skips anything already present: to replace a photo, delete both its credit entry and its file. Hand-picked choices live in `OVERRIDES` and `NO_PHOTOGRAPH` in `scripts/fetch-photos.mjs`. |
| `node scripts/override-candidates.mjs <id>` | Lists every licensed candidate that passes the checks, for a person to choose from. |
| `npm run contact-sheet`, `contact-sheet:animals` | Review pages of every photograph, written to `review/` (not committed). |

**Sounds**

| Command | What it does |
|---|---|
| `npm run sound:candidates -- <id>` | Gathers licensed candidate recordings for a wanted sound, measures them and draws spectrograms into `build/sound-candidates/`. Chooses nothing. |
| `npm run fetch:sounds` | Fetches exactly the picks in `scripts/sound-picks.json`, cuts and levels them, and writes `src/data/sound-credits.json`. `node scripts/fetch-sounds.mjs --offline` rewrites the credits without downloading. |

Picks are recorded in `scripts/sound-picks.json` with the reason for each.
Nothing is committed or deployed until the owner has listened to the cut that
will ship.

**Browser checks** (headless Chrome; the two strips build and serve the real
production site)

| Command | What it does |
|---|---|
| `npm run tour:strip` | Watches the whole tour and fails on any layout collision, across 12 phone and iPad viewports. |
| `npm run place:strip` | Checks every place on the same 12 viewports (432 rows): touch target sizes, overlaps, the drawn shape, the read-along. Takes most of an hour and uses a fixed port, so run one at a time. |
| `npm run probe:map`, `probe:camera` | Tap accuracy on the map; the camera flight. |
| `npm run shot -- <screen> --w=390 --h=844` | A screenshot of one screen at one size. |
| `npm run contact-sheet:art`, `contact-sheet:mor` | Sheets of the tour art and of Mor, for a person to look at. |

A heavily loaded machine can make these time out. Check `uptime` and re-run
before treating a red result as a bug.

### API keys

Keys go in `.env` at the repository root. `.env` is git-ignored (only
`.env.example` is tracked). The npm aliases that need keys load it themselves
with `--env-file-if-exists=.env`.

| Variable | Needed by |
|---|---|
| `ELEVENLABS_API_KEY` | `tts:final`, `voices` |
| `ELEVENLABS_VOICE_ID` | `tts:final` |
| `FREESOUND_API_KEY` | `sound:candidates` |
| `XENO_CANTO_API_KEY` | `sound:candidates` |

`.env.example` lists only the two ElevenLabs variables. iNaturalist and
Wikimedia Commons need no key. Nothing else needs a key: `dev`, `test`,
`build`, `validate`, `fact:check`, `fetch:photos` and `fetch:sounds` run
without one.

### Licensing

- **Code: MIT** ([`LICENSE`](LICENSE)). This covers `src/`, `scripts/`,
  `content/`, `docs/` and the root configuration, except the generated files
  in `src/data/` that derive from the sources below.
- **Map boundaries: CC BY 4.0**, from the
  [DataMeet](https://github.com/datameet/maps) India community
  (`src/data/geo.json`, `src/data/hit.json`), credited on the map itself.
- **Neighbouring land:** Natural Earth, public domain (`src/data/world.json`).
- **Photographs and sounds** keep their own licences, file by file, in
  `src/data/photo-credits.json` and `src/data/sound-credits.json`. Photographs
  are stored exactly as Wikimedia's thumbnail service delivered them. Every
  sound is edited, so the share-alike ones are offered under their source's
  licence. Eleven sounds are non-commercial only and may not be reused
  commercially.
- **Narration audio:** the scripts are MIT; the recordings were made with
  ElevenLabs, whose terms this repository cannot relicense.

Every source is credited in the app at **`#/credits`** (the "Credits" link
under the map) and in [`NOTICE`](NOTICE).

### Decisions that are settled

These have been argued through and are recorded in `docs/handover.md`. Read
the reasoning there before changing any of them.

- Cues are word positions, never timestamps.
- WebKit's SVG engine on iPad sets hard limits: no SVG `<filter>`, no
  animated transform on an SVG `<g>`, and no CSS `var()` in SVG attributes.
  The camera animates an HTML wrapper and then commits the `viewBox`.
- 104 px touch targets, and a word on every control.
- The Grand Tour has no ambient bed under it; no single background sound is
  right for the whole country.
- The app is responsive (phones and iPads), not iPad-only.
- No script chooses a photograph or a sound.

### Further documentation

- [`docs/handover.md`](docs/handover.md): the full state of play, the rulings,
  the standing rules and the traps. The newest sections are at the end.
- [`docs/superpowers/specs/2026-08-21-namaste-india-design.md`](docs/superpowers/specs/2026-08-21-namaste-india-design.md):
  the design spec (purpose, audience, writing rules, privacy).
- [`docs/superpowers/plans/`](docs/superpowers/plans/): the six
  implementation plans, in order.
- [`docs/fact-check.md`](docs/fact-check.md): the history of what was found
  wrong. `content/fact-check.json` is what `fact:check` actually runs.
- [`docs/landmarks-approved.md`](docs/landmarks-approved.md): how the
  landmarks were chosen.
- [`NOTICE`](NOTICE): every third-party file and its licence.
