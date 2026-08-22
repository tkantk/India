# Namaste India — Mor's Big Journey

An interactive, narrated map of India, guided by Mor the peacock. Tap a big
play button and take a spoken tour of the country; tap any state to hear
about it and explore its landmarks. It's a static site — no accounts, no
analytics, no runtime network calls.

**Who it's for.** A child of about 6–8, an early reader who can operate the
whole thing alone by listening and tapping, with no adult help required. That
audience drives most of the design decisions in this repository: touch
targets are 104 CSS pixels (not the usual 44) because that's the researched
minimum for a child under nine to reliably hit, and every fact in the
narration has been checked against a primary source and logged in
[`docs/fact-check.md`](docs/fact-check.md).

This is a personal project, built in the open.

## Status

This is a work in progress. Honestly:

- **The narration currently uses a draft voice** — the free macOS `say`
  synthesiser (`npm run tts:draft`), not the final paid render
  (`npm run tts:final`, ElevenLabs). Nobody has listened to the final audio yet.
- **Twelve sound effects are not yet sourced.** Wikimedia Commons doesn't have
  usable recordings for a few (`tiger-growl`, `camel`, several ambient beds),
  and a missing sound is a silent no-op rather than a crash — it just isn't
  there yet.
- Four of 36 states/union territories have complete content (Rajasthan,
  Odisha, Kerala, Delhi); the rest are the next milestone.

For the full, current state of the project — what works, what's deliberately
missing, and the decisions still waiting on a human — see
[`docs/handover.md`](docs/handover.md).

## Running it locally

Requires Node 23.6+ (the build imports `content/schema.ts` directly and
relies on Node's native TypeScript stripping).

```sh
npm install
npm run dev
```

That starts the Vite dev server. Open the URL it prints.

### Building and previewing like an iPad will see it

The production build is what actually ships — `base: './'` and hash routing
matter for GitHub Pages, and neither is exercised by `npm run dev`. To check
the real thing, including from an iPad on the same network:

```sh
npm run build && npx vite preview --host
```

`--host` binds to your LAN so a tablet can open the printed URL directly.

### Tests and checks

```sh
npx vitest run       # test suite
npx tsc -b            # typecheck
npm run validate      # content schema, completeness, character budget
```

## The pipeline scripts

Content (`content/*.json`) is data, not code — application code contains no
facts. A set of standalone Node scripts under `scripts/` turn that content
plus external sources into the files the app actually loads from `src/data/`
and `public/`. None of them run at runtime; they're build-time only, and most
are safely re-runnable.

| Script | Produces |
|---|---|
| `npm run build:map` | `src/data/geo.json` — state/UT boundaries, label positions, zoom boxes and neighbour lists, generated from the DataMeet shapefile |
| `npm run build:hit` | `src/data/hit.json` — a simplified invisible hit layer, so taps stay fast on Safari |
| `npm run build:art` | Tour art (country outline, Ganga, Himalayan summits) drawn in the map's own projection so it lines up with `geo.json` |
| `npm run tts:draft` / `npm run tts:final` | `src/data/timings.json` and narration audio — draft uses the free macOS voice, final uses the paid ElevenLabs provider. Cues are authored as word indices, not timestamps, so switching providers never desyncs an animation |
| `npm run fetch:photos` | `src/data/photo-credits.json` and landmark photographs in `public/photos/`, sourced from Wikimedia Commons and licence-checked |
| `npm run fetch:sounds` | `src/data/sound-credits.json` and sound effects in `public/audio/`, sourced the same way |
| `npm run contact-sheet` / `contact-sheet:art` / `contact-sheet:mor` | Visual review sheets — the licence and schema checks are automated, but only a person can say whether a scene reads as a tiger |
| `npm run tour:strip` | A screenshot of every beat of the Grand Tour, for reviewing the whole sequence at a glance |
| `npm run validate` | Checks content completeness and the narration character budget; fails the build if either is broken |

The two fetch scripts talk to the Wikimedia API and identify themselves with
a descriptive User-Agent, as [Wikimedia's policy](https://meta.wikimedia.org/wiki/User-Agent_policy)
requires (`scripts/lib/wiki.mjs`).

## Attribution

This project depends on data and media it doesn't own, and the licences
require the credit to be visible, not just logged here:

- **India state boundaries** are from the [DataMeet](https://github.com/datameet/maps)
  India community, licensed CC BY 4.0. Required attribution — shown in the
  app itself, near the map — is: *"India state boundaries by DataMeet India
  community (CC BY 4.0)"*.
- **Photographs and sound effects** are sourced from Wikimedia Commons, each
  individually licence-checked at fetch time (only CC0, public domain, CC BY
  and CC BY-SA are accepted; anything unclear is rejected). Per-file artist,
  licence and source-link credits are generated into
  [`src/data/photo-credits.json`](src/data/photo-credits.json) and
  [`src/data/sound-credits.json`](src/data/sound-credits.json), and rendered
  wherever that media is shown.

## License

The application code in this repository has no licence file yet — treat it
as all-rights-reserved unless the owner adds one. The third-party map data,
photographs and sounds it bundles carry the licences described above and in
the generated credits files, independent of whatever licence the code ends
up under.
