# Namaste India — Plan 1: Asset Pipeline & Content Schema

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data foundation for the site — a generated India map, a validated content schema, and scripted pipelines that produce narration audio with word timings, landmark photographs, and sound effects — so that Plan 2 (the React app) has real files to consume from day one.

**Architecture:** Everything is a standalone Node script under `scripts/` that reads `content/*.json` and writes into `src/data/` (small JSON, imported by the app) or `public/` (large binaries, served verbatim). No script is imported by the app at runtime. The app never calls a network API. Narration is provider-swappable behind one interface, so the free macOS draft voice and the paid ElevenLabs voice are interchangeable without touching the app.

**Tech Stack:** Node 23 (ESM, `.mjs`), TypeScript 6, Vite 8, React 19, Vitest, Zod. Build-time only: `mapshaper`, `d3-geo`, `@mapbox/geojson-rewind`. macOS only for audio encoding: `afconvert`, `say`, `python3` + `numpy`.

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from verified research — do not substitute alternatives without re-verifying.

- **Node 23+, ESM everywhere.** Scripts are `.mjs` and use top-level `await`. No CommonJS.
- **`.mjs` scripts import `content/schema.ts` directly**, with the `.ts` extension in the specifier. Node strips types natively from 23.6 onwards, so no loader or build step is needed. This constrains the schema file: no `enum`, no `namespace`, no constructor parameter properties, since native stripping rejects all three.
- **`ffmpeg` and `sox` are NOT installed and must not be required.** Audio work uses `/usr/bin/afconvert` plus `python3` + `numpy` (2.1.3, installed). `afconvert` cannot encode MP3 — AAC in `.m4a` only.
- **Python 3.13 has removed `audioop`.** Do not use `audioop` or `pydub`. Use `numpy` + the `wave` module.
- **Vite `base` MUST be `'./'`** and routing MUST be `HashRouter`. Never mix `'./'` with `BrowserRouter` — deep links break only in production.
- **Never write a leading-slash asset path.** Always `` `${import.meta.env.BASE_URL}audio/x.m4a` ``. A literal `/audio/x.m4a` 404s on a project page.
- **Large binaries live in `public/`, committed as ordinary Git objects.** Git LFS is forbidden: "Git LFS cannot be used with GitHub Pages sites."
- **Every Wikimedia request MUST send a descriptive User-Agent.** Exactly: `NamasteIndia/1.0 (https://github.com/OWNER/REPO; tushar.et1@gmail.com) node-fetch`. An empty UA returns HTTP 403. Requests go in series, never parallel. Send `maxlag=5` and `Accept-Encoding: gzip`.
- **Map data source is DataMeet `States/Admin2.shp`, licence CC BY 4.0.** Attribution string, required verbatim somewhere user-visible: `India state boundaries by DataMeet India community (CC BY 4.0)`.
- **Map depiction gate:** the generated GeoJSON's northern bound MUST be ≈37.07. If it is ≈35.5 the dataset uses the de-facto depiction and MUST be rejected.
- **Narration character budget is 95,000 target / 99,100 ceiling.** `validate-content.mjs` fails the build above the ceiling.
- **Audio delivery format:** mono, 44.1 kHz. Narration AAC `.m4a` at 56 kbps. Sound one-shots `.m4a` at 64 kbps. Ambient beds `.m4a` at 56 kbps.
- **No runtime network calls in the shipped app.** Every asset is bundled.
- **Content JSON is the only place facts live.** No fact, name, or sentence may appear in application code.

---

## File Structure

| Path | Responsibility |
|---|---|
| `content/schema.ts` | Zod schemas + inferred TS types. Single source of truth for content shape. |
| `content/places/<id>.json` | One state or UT: intro, card, 5 landmarks, ambience, cues. |
| `content/tour.json` | The 14 Grand Tour beats. |
| `content/ui.json` | Interface lines and Mor's chatter. |
| `scripts/lib/wiki.mjs` | Wikimedia API client: UA, maxlag, backoff, batching. Shared by photos and sounds. |
| `scripts/lib/words.mjs` | Character alignment → word timings; proportional estimator for draft audio. |
| `scripts/lib/encode.mjs` | `afconvert` wrappers: decode-to-PCM, encode-to-m4a, probe channels/duration. |
| `scripts/build-map.mjs` | DataMeet shapefile → `src/data/geo.json`. |
| `scripts/validate-content.mjs` | Schema, character budget, completeness, cue-index bounds. |
| `scripts/tts.mjs` | Orchestrator: content → audio files + `src/data/timings.json`. Provider-agnostic. |
| `scripts/tts-providers/say.mjs` | Free macOS draft voice. |
| `scripts/tts-providers/elevenlabs.mjs` | Paid final voice, with cost preflight and content-hash cache. |
| `scripts/fetch-photos.mjs` | Landmark photos → `public/photos/` + `src/data/photo-credits.json`. |
| `scripts/contact-sheet.mjs` | Generates `review/photos.html` for the mandatory human check. |
| `scripts/fetch-sounds.mjs` | Animal one-shots and ambient beds → `public/audio/sfx/`, `public/audio/ambience/`. |
| `scripts/lib/loop.py` | numpy equal-power crossfade for seamless ambient loops. |
| `src/data/*.json` | Generated, committed. Imported by the app. |
| `public/audio/`, `public/photos/` | Generated, committed. Served verbatim. |

---

## Task 1: Project scaffold and deploy workflow

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`
- Create: `.github/workflows/deploy.yml`
- Create: `src/lib/assetUrl.ts`
- Test: `src/lib/assetUrl.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `assetUrl(relative: string): string` — the ONLY approved way to build a URL for anything under `public/`. Every later task uses it.

- [ ] **Step 1: Scaffold the project**

```bash
npm create vite@latest . -- --template react-ts
npm install
npm install -D vitest @vitest/coverage-v8 jsdom
npm install react-router-dom motion zod
npm install -D d3-geo @mapbox/geojson-rewind mapshaper
```

- [ ] **Step 2: Write `vite.config.ts`**

`base: './'` makes one build work on a project page, a user page, and a local subdirectory. `host: true` lets an iPad on the same wifi reach the dev and preview servers.

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { host: true },
  preview: { host: true },
  test: { environment: 'jsdom', globals: true },
})
```

- [ ] **Step 3: Write the failing test for `assetUrl`**

`src/lib/assetUrl.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { assetUrl } from './assetUrl'

// Vite normalises base:'./' to '/' when serving, and vitest runs in serve
// mode, so BASE_URL is '/' here and './' in a production build. Assert the
// behaviour against BASE_URL rather than hardcoding either one.
const BASE = import.meta.env.BASE_URL

describe('assetUrl', () => {
  it('joins a relative path onto the Vite base', () => {
    expect(assetUrl('audio/en/tour-01.m4a')).toBe(BASE.replace(/\/$/, '') + '/audio/en/tour-01.m4a')
  })

  it('strips a leading slash, because absolute paths 404 on a GitHub project page', () => {
    expect(assetUrl('/audio/en/tour-01.m4a')).toBe(assetUrl('audio/en/tour-01.m4a'))
  })

  it('never emits a double slash', () => {
    expect(assetUrl('photos/taj.jpg')).not.toMatch(/([^:])\/\//)
  })
})
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run src/lib/assetUrl.test.ts`
Expected: FAIL — `Failed to resolve import "./assetUrl"`.

- [ ] **Step 5: Implement `src/lib/assetUrl.ts`**

```ts
/**
 * The only approved way to reference anything in public/.
 * A literal "/audio/x.m4a" resolves to https://USER.github.io/audio/x.m4a
 * on a project page and 404s. BASE_URL is "./" in production, "/" in dev.
 */
export function assetUrl(relative: string): string {
  const base = import.meta.env.BASE_URL
  return base.replace(/\/$/, '') + '/' + relative.replace(/^\//, '')
}
```

- [ ] **Step 6: Run it and watch it pass**

Run: `npx vitest run src/lib/assetUrl.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Write `.github/workflows/deploy.yml`**

Action versions and SHAs verified to exist on 2026-08-21. `id-token: write` is mandatory — `deploy-pages` mints its token over OIDC.

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          # Must be 24, not 22. `npm run validate` imports content/schema.ts
          # directly and relies on native type stripping, which is unflagged
          # only from Node 23.6 onwards. On Node 22 CI fails from Task 2 on.
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run validate
      - run: npm run test
      - run: npm run build
      - uses: actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d # v6.0.0
      - uses: actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5.0.0
        with:
          path: ./dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128 # v5.0.0
```

- [ ] **Step 8: Add npm scripts to `package.json`**

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "validate": "node scripts/validate-content.mjs",
    "build:map": "node scripts/build-map.mjs",
    "tts:draft": "node scripts/tts.mjs --provider=say",
    "tts:final": "node scripts/tts.mjs --provider=elevenlabs",
    "fetch:photos": "node scripts/fetch-photos.mjs",
    "fetch:sounds": "node scripts/fetch-sounds.mjs"
  }
}
```

`npm run validate` is a no-op stub until Task 2. Create `scripts/validate-content.mjs` containing only `process.exit(0)` so the workflow is green from the first commit.

- [ ] **Step 9: Verify the build works**

Run: `npm run build && ls dist/`
Expected: `dist/index.html` exists and contains `src="./assets/`, not `src="/assets/`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite + React + TypeScript with GitHub Pages deploy

base:'./' plus HashRouter (Plan 2) makes one build work on a project page,
a user page and a local subdirectory with no file edits. Action SHAs pinned."
```

---

## Task 2: Content schema and validator

**Files:**
- Create: `content/schema.ts`
- Create: `scripts/validate-content.mjs` (replaces the Task 1 stub)
- Test: `content/schema.test.ts`

**Interfaces:**
- Consumes: `assetUrl` (not directly — schema is build-time only).
- Produces:
  - Types `Place`, `Landmark`, `Line`, `Cue`, `TourBeat`, `UiLine` (exported from `content/schema.ts`).
  - `LINE_BUDGET: Record<Line['kind'], number>` — the per-clip character ceilings.
  - `PlaceSchema`, `TourSchema`, `UiSchema` — Zod schemas used by the validator.
  - A `Line` always has: `id` (globally unique, `[a-z0-9.-]+`), `kind`, `text`, and optional `cues`.
  - A `Cue` is `{ word: number, do: string, arg?: string }` — **`word` is an index into the line's word array, never a timestamp.**

- [ ] **Step 1: Write the failing test**

`content/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PlaceSchema, LINE_BUDGET, wordsOf } from './schema'

const validLine = { id: 'raj.intro', kind: 'intro' as const, text: 'Rajasthan is a big state.' }

const validPlace = {
  id: 'rajasthan',
  name: 'Rajasthan',
  type: 'state' as const,
  capital: 'Jaipur',
  ambience: 'desert' as const,
  intro: validLine,
  card: {
    animal: { id: 'raj.card.animal', kind: 'card' as const, text: 'The camel lives here.', sfx: 'camel' },
    food: { id: 'raj.card.food', kind: 'card' as const, text: 'Dal baati churma is crunchy.' },
    festival: { id: 'raj.card.festival', kind: 'card' as const, text: 'Teej is a swing festival.' },
    hello: { id: 'raj.card.hello', kind: 'card' as const, text: 'People say Khamma Ghani.', script: 'खम्मा घणी' },
  },
  landmarks: Array.from({ length: 5 }, (_, i) => ({
    id: `raj.lm.${i}`,
    name: `Place ${i}`,
    photoQuery: `Place ${i}, Rajasthan`,
    scene: 'dunes',
    line: { id: `raj.lm.${i}.line`, kind: 'landmark' as const, text: 'It is very big and sandy.' },
  })),
}

describe('PlaceSchema', () => {
  it('accepts a well-formed place', () => {
    expect(PlaceSchema.safeParse(validPlace).success).toBe(true)
  })

  it('rejects a place with four landmarks — every place needs exactly five', () => {
    const short = { ...validPlace, landmarks: validPlace.landmarks.slice(0, 4) }
    expect(PlaceSchema.safeParse(short).success).toBe(false)
  })

  it('rejects an intro longer than its character budget', () => {
    const fat = { ...validPlace, intro: { ...validLine, text: 'x'.repeat(LINE_BUDGET.intro + 1) } }
    expect(PlaceSchema.safeParse(fat).success).toBe(false)
  })

  it('rejects a cue exactly one word past the end', () => {
    // Must be n, not some large number like 99. With 99 the test still passes
    // when the check is loosened from `>= n` to `> n`, so it would not catch
    // the off-by-one that lets an unreachable cue through.
    const n = wordsOf(validLine.text).length
    const bad = {
      ...validPlace,
      intro: { ...validLine, cues: [{ word: n, do: 'revealSymbol', arg: 'camel' }] },
    }
    expect(PlaceSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a wildly out-of-range cue too', () => {
    const bad = {
      ...validPlace,
      intro: { ...validLine, cues: [{ word: 99, do: 'revealSymbol', arg: 'camel' }] },
    }
    expect(PlaceSchema.safeParse(bad).success).toBe(false)
  })

  it('accepts a cue on the last word', () => {
    const n = wordsOf(validLine.text).length
    const ok = {
      ...validPlace,
      intro: { ...validLine, cues: [{ word: n - 1, do: 'revealSymbol', arg: 'camel' }] },
    }
    expect(PlaceSchema.safeParse(ok).success).toBe(true)
  })
})

describe('wordsOf', () => {
  it('splits on whitespace and keeps punctuation attached', () => {
    expect(wordsOf('Hello, big world!')).toEqual(['Hello,', 'big', 'world!'])
  })

  it('collapses runs of whitespace and newlines', () => {
    expect(wordsOf('  a \n  b  ')).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run content/schema.test.ts`
Expected: FAIL — cannot resolve `./schema`.

- [ ] **Step 3: Implement `content/schema.ts`**

```ts
import { z } from 'zod'

/**
 * Per-clip character ceilings. These are a COST constraint, not a style guide:
 * speech synthesis bills per character and the whole script must fit the
 * 99,100-character ceiling. The validator enforces both these and the total.
 */
export const LINE_BUDGET = {
  intro: 400,
  card: 170,
  landmark: 300,
  tour: 230,
  ui: 60,
} as const

export type LineKind = keyof typeof LINE_BUDGET

/** The single definition of "a word", shared by the schema, the validator,
 *  the timing generator and the app. If these ever disagree, cues drift. */
export function wordsOf(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean)
}

const CueSchema = z.object({
  /** Index into wordsOf(line.text). NEVER a timestamp — timestamps change
   *  when the voice is re-rendered; word indices do not. */
  word: z.number().int().nonnegative(),
  do: z.enum([
    'revealSymbol', 'playSfx', 'highlightState', 'highlightAllStates',
    'highlightUnionTerritories', 'zoomTo', 'traceRiver', 'raiseMountains',
    'unfurlFlag', 'countTo', 'showScript', 'lightNeighbour',
  ]),
  arg: z.string().optional(),
})

function lineSchema(kind: LineKind) {
  return z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/, 'ids are lowercase dot/dash separated'),
    kind: z.literal(kind),
    text: z.string().min(1).max(
      LINE_BUDGET[kind],
      `${kind} line exceeds its ${LINE_BUDGET[kind]}-character budget`,
    ),
    cues: z.array(CueSchema).optional(),
    /** Optional one-shot fired when the tile/scene opens, before narration. */
    sfx: z.string().optional(),
    /** Native-script text shown on screen (the "hello" tile). Not narrated. */
    script: z.string().optional(),
  }).superRefine((line, ctx) => {
    const n = wordsOf(line.text).length
    for (const [i, cue] of (line.cues ?? []).entries()) {
      if (cue.word >= n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cues', i, 'word'],
          message: `cue word index ${cue.word} is past the last word (${n - 1}) of "${line.id}"`,
        })
      }
    }
  })
}

export const AMBIENCE = [
  'desert', 'ocean', 'forest', 'mountain', 'river', 'city', 'plains', 'temple', 'island',
] as const

const LandmarkSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
  name: z.string().min(1),
  /** Fully qualified so the photo fetcher does not land on a disambiguation
   *  page — "Rock Garden" returns a botanical garden in the Netherlands. */
  photoQuery: z.string().min(1),
  /** Key into the illustration scene kit (Plan 2). */
  scene: z.string().min(1),
  line: lineSchema('landmark'),
})

export const PlaceSchema = z.object({
  id: z.string().regex(/^[a-z][a-z-]*$/),
  name: z.string().min(1),
  type: z.enum(['state', 'ut']),
  capital: z.string().min(1),
  ambience: z.enum(AMBIENCE),
  intro: lineSchema('intro'),
  card: z.object({
    animal: lineSchema('card'),
    food: lineSchema('card'),
    festival: lineSchema('card'),
    hello: lineSchema('card'),
  }),
  landmarks: z.array(LandmarkSchema).length(5, 'every place needs exactly five landmarks'),
})

export const TourSchema = z.object({ beats: z.array(lineSchema('tour')).min(1) })
export const UiSchema = z.object({ lines: z.array(lineSchema('ui')).min(1) })

export type Place = z.infer<typeof PlaceSchema>
export type Landmark = z.infer<typeof LandmarkSchema>
export type Cue = z.infer<typeof CueSchema>
export type Line = { id: string; kind: LineKind; text: string; cues?: Cue[]; sfx?: string; script?: string }
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run content/schema.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the validator `scripts/validate-content.mjs`**

The schema catches per-line problems. The validator catches whole-corpus problems the schema cannot see: duplicate ids across files, the total character budget, and missing generated artefacts.

```js
#!/usr/bin/env node
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PlaceSchema, TourSchema, UiSchema } from '../content/schema.ts'

const CEILING = 99_100
const TARGET = 95_000
const problems = []
const ids = new Map()
let chars = 0

function line(l, where) {
  if (ids.has(l.id)) problems.push(`duplicate line id "${l.id}" in ${where} and ${ids.get(l.id)}`)
  ids.set(l.id, where)
  chars += l.text.length
}

function walkPlace(p, where) {
  line(p.intro, where)
  for (const l of Object.values(p.card)) line(l, where)
  for (const lm of p.landmarks) line(lm.line, where)
}

const dir = 'content/places'
const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')) : []
for (const f of files) {
  const where = join(dir, f)
  const parsed = PlaceSchema.safeParse(JSON.parse(readFileSync(where, 'utf8')))
  if (!parsed.success) {
    for (const i of parsed.error.issues) problems.push(`${where}: ${i.path.join('.')} — ${i.message}`)
    continue
  }
  if (parsed.data.id !== f.replace(/\.json$/, '')) {
    problems.push(`${where}: id "${parsed.data.id}" does not match its filename`)
  }
  walkPlace(parsed.data, where)
}

for (const [file, schema, key] of [
  ['content/tour.json', TourSchema, 'beats'],
  ['content/ui.json', UiSchema, 'lines'],
]) {
  if (!existsSync(file)) { problems.push(`missing ${file}`); continue }
  const parsed = schema.safeParse(JSON.parse(readFileSync(file, 'utf8')))
  if (!parsed.success) {
    for (const i of parsed.error.issues) problems.push(`${file}: ${i.path.join('.')} — ${i.message}`)
    continue
  }
  for (const l of parsed.data[key]) line(l, file)
}

if (chars > CEILING) {
  problems.push(`narration is ${chars} characters, over the ${CEILING} ceiling — trim before rendering`)
}

console.log(`${files.length} places · ${ids.size} lines · ${chars} characters (target ${TARGET}, ceiling ${CEILING})`)
if (chars > TARGET && chars <= CEILING) {
  console.log(`  note: over the ${TARGET} target — re-render headroom is shrinking`)
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`)
  for (const p of problems) console.error('  ✗ ' + p)
  process.exit(1)
}
console.log('content OK')
```

- [ ] **Step 6: Put `content/` under the type-checker**

`tsconfig.app.json` includes only `src`, so nothing in CI type-checks
`content/schema.ts`. Both the Vitest run and Node's native stripping only
erase types; neither reports a type error. Add `content` to the app
tsconfig's `include` array so `npm run build` covers it:

```jsonc
// tsconfig.app.json
"include": ["src", "content"]
```

Run: `npm run build`
Expected: succeeds. Then prove the check is live by temporarily giving
`wordsOf` a bogus return type (`: number[]`), re-running `npm run build`,
and confirming it now FAILS. Revert the bogus type.

- [ ] **Step 7: Verify the validator runs and reports zero places**

Run: `npm run validate`
Expected: exit 1 with `missing content/tour.json` — correct, nothing is authored yet. This proves the validator actually checks rather than passing vacuously.

- [ ] **Step 8: Commit**

```bash
git add content/schema.ts content/schema.test.ts scripts/validate-content.mjs tsconfig.app.json
git commit -m "feat: content schema with character budgets and word-index cues

Cues address a word index, not a timestamp, so re-rendering the narration
with a different voice cannot desynchronise the animations."
```

---

## Task 3: Generate the India map

**Files:**
- Create: `scripts/build-map.mjs`
- Create: `scripts/lib/geo.mjs`
- Test: `scripts/lib/geo.test.mjs`
- Generates: `src/data/geo.json`

**Interfaces:**
- Consumes: nothing.
- Produces `src/data/geo.json`, shape:

```ts
type Geo = {
  viewBox: [number, number, number, number]   // [0, 0, 1000, 1100]
  attribution: string
  places: Record<string, {                    // keyed by slug, e.g. "rajasthan"
    name: string                              // verbatim ST_NM, e.g. "Jammu & Kashmir"
    type: 'state' | 'ut'
    d: string                                 // SVG path data
    centroid: [number, number]                // label anchor, in viewBox units
    bbox: [number, number, number, number]    // [x, y, w, h] zoom target
    neighbours: string[]                      // slugs, derived from shared borders
  }>
}
```
- Later tasks and Plan 2 rely on `slugify` producing the exact same slug as `content/places/<id>.json` filenames.

- [ ] **Step 1: Write the failing test for the geometry helpers**

`scripts/lib/geo.test.mjs`:

```js
import { describe, it, expect } from 'vitest'
import { slugify, classify, shareBorder, boundsOf } from './geo.mjs'

describe('slugify', () => {
  it('normalises ampersands and spaces the same way for every state', () => {
    expect(slugify('Jammu & Kashmir')).toBe('jammu-kashmir')
    expect(slugify('Andaman & Nicobar')).toBe('andaman-nicobar')
    expect(slugify('Dadra and Nagar Haveli and Daman and Diu'))
      .toBe('dadra-and-nagar-haveli-and-daman-and-diu')
    expect(slugify('Tamil Nadu')).toBe('tamil-nadu')
  })
})

describe('classify', () => {
  it('knows the eight union territories', () => {
    expect(classify('Delhi')).toBe('ut')
    expect(classify('Ladakh')).toBe('ut')
    expect(classify('Jammu & Kashmir')).toBe('ut')
    expect(classify('Puducherry')).toBe('ut')
    expect(classify('Chandigarh')).toBe('ut')
    expect(classify('Lakshadweep')).toBe('ut')
    expect(classify('Andaman & Nicobar')).toBe('ut')
    expect(classify('Dadra and Nagar Haveli and Daman and Diu')).toBe('ut')
  })
  it('treats everything else as a state', () => {
    expect(classify('Rajasthan')).toBe('state')
    expect(classify('Telangana')).toBe('state')
  })
})

describe('shareBorder', () => {
  const square = [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]
  const touching = [[[2, 0], [4, 0], [4, 2], [2, 2], [2, 0]]]
  const distant = [[[9, 9], [10, 9], [10, 10], [9, 10], [9, 9]]]

  it('finds neighbours that share at least two boundary points', () => {
    expect(shareBorder(square, touching, 1e-6)).toBe(true)
  })
  it('does not invent neighbours across open water', () => {
    expect(shareBorder(square, distant, 1e-6)).toBe(false)
  })
})

describe('boundsOf', () => {
  it('returns [x, y, width, height] from an SVG path', () => {
    expect(boundsOf('M10,20L30,20L30,60Z')).toEqual([10, 20, 20, 40])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run scripts/lib/geo.test.mjs`
Expected: FAIL — cannot resolve `./geo.mjs`.

- [ ] **Step 3: Implement `scripts/lib/geo.mjs`**

```js
/** DataMeet's ST_NM strings are internally inconsistent — "Jammu & Kashmir"
 *  uses '&' while "Dadra and Nagar Haveli and Daman and Diu" spells out "and".
 *  Everything downstream joins on the slug, so this must be the only
 *  normalisation in the codebase. */
export function slugify(name) {
  return name
    .replace(/&/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const UNION_TERRITORIES = new Set([
  'andaman-nicobar',
  'chandigarh',
  'dadra-and-nagar-haveli-and-daman-and-diu',
  'delhi',
  'jammu-kashmir',
  'ladakh',
  'lakshadweep',
  'puducherry',
])

export function classify(name) {
  return UNION_TERRITORIES.has(slugify(name)) ? 'ut' : 'state'
}

/** Two places are neighbours if their rings share at least two vertices
 *  within `tol` degrees. Two, not one, so a single touching corner
 *  (e.g. the old Chhattisgarh/UP tripoint) does not count as a border. */
export function shareBorder(ringsA, ringsB, tol = 1e-4) {
  const key = ([x, y]) => `${Math.round(x / tol)}:${Math.round(y / tol)}`
  const seen = new Set()
  for (const ring of ringsA) for (const pt of ring) seen.add(key(pt))
  let hits = 0
  for (const ring of ringsB) {
    for (const pt of ring) {
      if (seen.has(key(pt)) && ++hits >= 2) return true
    }
  }
  return false
}

/** Bounding box of an SVG path, in viewBox units. Used as the zoom target. */
export function boundsOf(d) {
  const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? []
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = nums[i], y = nums[i + 1]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return [minX, minY, maxX - minX, maxY - minY]
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run scripts/lib/geo.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write `scripts/build-map.mjs`**

Three gotchas are load-bearing and all three are commented in the code: `-clean` before `-simplify`, mandatory ring rewinding, and the depiction check.

```js
#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import rewind from '@mapbox/geojson-rewind'
import { geoConicConformal, geoPath, geoBounds } from 'd3-geo'
import { slugify, classify, shareBorder, boundsOf } from './lib/geo.mjs'

const W = 1000, H = 1100
const RAW = 'build/map'
const BASE = 'https://raw.githubusercontent.com/datameet/maps/master/States/Admin2'
const ATTRIBUTION = 'India state boundaries by DataMeet India community (CC BY 4.0)'

mkdirSync(RAW, { recursive: true })
mkdirSync('src/data', { recursive: true })

// 1. Fetch. All five sidecar files are required or the shapefile will not open.
for (const ext of ['shp', 'shx', 'dbf', 'prj', 'cpg']) {
  const out = `${RAW}/Admin2.${ext}`
  if (existsSync(out)) continue
  console.log(`fetching Admin2.${ext}`)
  const res = await fetch(`${BASE}.${ext}`)
  if (!res.ok) throw new Error(`Admin2.${ext}: HTTP ${res.status}`)
  writeFileSync(out, Buffer.from(await res.arrayBuffer()))
}

// 2. Clean, then simplify. ORDER MATTERS: "-simplify ... -clean" silently
//    DISCARDS the simplification and writes an 18 MB file. keep-shapes stops
//    mapshaper deleting Lakshadweep and the smaller Andaman islands.
console.log('simplifying')
execFileSync('npx', [
  'mapshaper', `${RAW}/Admin2.shp`,
  '-clean',
  '-simplify', 'visvalingam', 'percentage=2%', 'keep-shapes',
  '-o', 'precision=0.0001', `${RAW}/india-states.geojson`, 'format=geojson',
], { stdio: 'inherit' })

const raw = JSON.parse(readFileSync(`${RAW}/india-states.geojson`, 'utf8'))

// 3. Rewind rings clockwise. MANDATORY, AND IT MUST COME BEFORE THE GATE.
//    mapshaper emits RFC 7946 (CCW outer rings); d3-geo's spherical clipper
//    needs CW. Two things break on CCW input, not one:
//      a) every polygon renders as its own complement, giving one giant blob;
//      b) geoBounds returns [[-180,-90],[180,90]] — the whole globe — because
//         each ring reads as pole-enclosing. Measured: geoBounds(raw) gives
//         north = 90, geoBounds(fc) gives north = 37.077.
//    So a depiction gate placed before the rewind sees north = 90, passes
//    unconditionally, and would wave through the de-facto dataset it exists
//    to reject. Order is load-bearing.
const fc = rewind(raw, true)

// 4. DEPICTION GATE. The official Survey of India rendering reaches 37.07N
//    (the tip of Gilgit-Baltistan). The de-facto rendering stops at 35.5N.
//    Verified by point-in-polygon: Muzaffarabad and Mirpur fall in
//    Jammu & Kashmir; Gilgit, Skardu, Aksai Chin and the Shaksgam Valley
//    fall in Ladakh. Do not remove this check, and do not move it above
//    the rewind.
const [, [, north]] = geoBounds(fc)
console.log(`northern bound: ${north.toFixed(3)}N`)
if (north < 36.5) {
  throw new Error(
    `northern bound is ${north.toFixed(3)}N, expected ~37.07N. ` +
    `This dataset uses the de-facto depiction, not the official one. Rejected.`,
  )
}
if (fc.features.length !== 36) {
  throw new Error(`expected 36 states and union territories, got ${fc.features.length}`)
}

const projection = geoConicConformal()
  .parallels([12.4729, 35.1728])   // Survey of India LCC standard parallels
  .rotate([-80, 0])                // central meridian 80E
  .precision(2)
  .fitSize([W, H], fc)
const path = geoPath(projection)

const ringsOf = (geom) =>
  geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat()

const places = {}
for (const f of fc.features) {
  const name = f.properties.ST_NM
  const slug = slugify(name)
  // 1 decimal place: 345 KB of path data becomes 262 KB, with no visible change.
  const d = path(f).replace(/(-?\d+\.\d)\d+/g, '$1')
  places[slug] = {
    name,
    type: classify(name),
    d,
    centroid: path.centroid(f).map(n => Math.round(n * 10) / 10),
    bbox: boundsOf(d).map(n => Math.round(n * 10) / 10),
    neighbours: [],
  }
}

// 5. Neighbours, from shared boundary vertices in lon/lat space.
const rings = Object.fromEntries(fc.features.map(f => [slugify(f.properties.ST_NM), ringsOf(f.geometry)]))
const slugs = Object.keys(places)
for (let i = 0; i < slugs.length; i++) {
  for (let j = i + 1; j < slugs.length; j++) {
    if (shareBorder(rings[slugs[i]], rings[slugs[j]])) {
      places[slugs[i]].neighbours.push(slugs[j])
      places[slugs[j]].neighbours.push(slugs[i])
    }
  }
}
for (const p of Object.values(places)) p.neighbours.sort()

writeFileSync('src/data/geo.json',
  JSON.stringify({ viewBox: [0, 0, W, H], attribution: ATTRIBUTION, places }))

const kb = (JSON.stringify(places).length / 1024).toFixed(0)
console.log(`wrote src/data/geo.json — ${slugs.length} places, ${kb} KB`)
console.log(`  rajasthan neighbours: ${places.rajasthan.neighbours.join(', ')}`)
```

- [ ] **Step 6: Run it**

Run: `npm run build:map`
Expected: `wrote src/data/geo.json — 36 places, ~280 KB`, and the Rajasthan neighbour line prints `gujarat, haryana, madhya-pradesh, punjab, uttar-pradesh`.

If the neighbour list is empty, the vertex tolerance is wrong — raise `tol` in `shareBorder` to `1e-3` and re-run. If it lists every state, lower it.

- [ ] **Step 7: Write the generated-output test**

`scripts/build-map.test.mjs`:

```js
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const geo = JSON.parse(readFileSync('src/data/geo.json', 'utf8'))

describe('generated geo.json', () => {
  it('has all 28 states and 8 union territories', () => {
    const places = Object.values(geo.places)
    expect(places).toHaveLength(36)
    expect(places.filter(p => p.type === 'state')).toHaveLength(28)
    expect(places.filter(p => p.type === 'ut')).toHaveLength(8)
  })

  it('includes Ladakh as a separate union territory (post-2019)', () => {
    expect(geo.places.ladakh?.type).toBe('ut')
  })

  it('has merged Dadra & Nagar Haveli with Daman & Diu (post-2020)', () => {
    expect(geo.places['dadra-and-nagar-haveli-and-daman-and-diu']).toBeDefined()
    expect(geo.places['daman-diu']).toBeUndefined()
  })

  it('gives every place a non-trivial path', () => {
    for (const [slug, p] of Object.entries(geo.places)) {
      expect(p.d.length, `${slug} has no path data`).toBeGreaterThan(50)
    }
  })

  it('knows Rajasthan touches five states', () => {
    expect(geo.places.rajasthan.neighbours.sort())
      .toEqual(['gujarat', 'haryana', 'madhya-pradesh', 'punjab', 'uttar-pradesh'])
  })

  it('makes neighbour relationships symmetric', () => {
    for (const [slug, p] of Object.entries(geo.places)) {
      for (const n of p.neighbours) {
        expect(geo.places[n].neighbours, `${n} should list ${slug}`).toContain(slug)
      }
    }
  })

  it('gives island territories no land neighbours', () => {
    expect(geo.places.lakshadweep.neighbours).toEqual([])
    expect(geo.places['andaman-nicobar'].neighbours).toEqual([])
  })

  it('keeps every state inside a sane fraction of the viewBox', () => {
    // This is the automated half of the blob check. If the rings are not
    // rewound clockwise, d3 renders each polygon as its own complement and
    // every bbox balloons to span the whole viewBox — measured: Rajasthan
    // goes from [74.7, 254.3, 286.9, 261.7] to [0, 288.8, 1000, 522.3].
    // Without this assertion all the other tests still pass on a broken map.
    const [, , vw, vh] = geo.viewBox
    for (const [slug, p] of Object.entries(geo.places)) {
      expect(p.bbox[2], `${slug} spans the full viewBox width — rings not rewound?`)
        .toBeLessThan(vw * 0.75)
      expect(p.bbox[3], `${slug} spans the full viewBox height — rings not rewound?`)
        .toBeLessThan(vh * 0.75)
    }
  })

  it('places every state inside the viewBox', () => {
    const [, , vw, vh] = geo.viewBox
    for (const [slug, p] of Object.entries(geo.places)) {
      expect(p.bbox[0], `${slug} starts left of the viewBox`).toBeGreaterThanOrEqual(-1)
      expect(p.bbox[1], `${slug} starts above the viewBox`).toBeGreaterThanOrEqual(-1)
      expect(p.bbox[0] + p.bbox[2], `${slug} runs off the right`).toBeLessThanOrEqual(vw + 1)
      expect(p.bbox[1] + p.bbox[3], `${slug} runs off the bottom`).toBeLessThanOrEqual(vh + 1)
    }
  })

  it('credits DataMeet, as CC BY 4.0 requires', () => {
    expect(geo.attribution).toContain('DataMeet')
    expect(geo.attribution).toContain('CC BY 4.0')
  })
})
```

- [ ] **Step 8: Run it**

Run: `npx vitest run scripts/build-map.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 9: Render a picture and look at it**

The tests prove the data is well-formed. They cannot prove the map looks like India. Write `build/map/preview.html` and open it:

```bash
node -e '
const geo = JSON.parse(require("fs").readFileSync("src/data/geo.json","utf8"));
const paths = Object.entries(geo.places).map(([s,p]) =>
  `<path id="${s}" d="${p.d}" fill="#dfe9f3" stroke="#31465c" stroke-width="0.7"><title>${p.name}</title></path>`
).join("\n");
require("fs").writeFileSync("build/map/preview.html",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${geo.viewBox.join(" ")}" width="600">${paths}</svg>`);
'
open build/map/preview.html
```

**This is a human gate.** Confirm by eye: India is upright, not a single filled blob (that means the rewind failed), Kashmir and Ladakh extend to the full northern claim, the Andamans and Lakshadweep are present, and the north-east states are distinct.

- [ ] **Step 10: Commit**

```bash
git add scripts/lib/geo.mjs scripts/lib/geo.test.mjs scripts/build-map.mjs scripts/build-map.test.mjs src/data/geo.json
git commit -m "feat: generate India map from DataMeet boundaries

Official Survey of India depiction, gated by a northern-bound assertion.
Neighbours are derived from shared boundary vertices, so 'Rajasthan touches
Punjab...' comes from the geometry rather than being typed by hand."
```

---

## Task 4: Word timings

**Files:**
- Create: `scripts/lib/words.mjs`
- Test: `scripts/lib/words.test.mjs`

**Interfaces:**
- Consumes: `wordsOf` from `content/schema.ts` (re-implemented identically here so `.mjs` scripts need no TS loader; the tests assert the two agree).
- Produces:
  - `wordSpans(text): { word: string, start: number, end: number }[]` — character offsets into the original string.
  - `timingsFromAlignment(text, alignment): { words: string[], starts: number[], ends: number[] }` where `alignment` is ElevenLabs' `{ characters, character_start_times_seconds, character_end_times_seconds }`.
  - `estimateTimings(text, duration): { words, starts, ends }` — proportional fallback for the draft voice, which emits no alignment.
  - `cueTimes(cues, timings): { t: number, word: number, do: string, arg?: string }[]` — **the word-index to seconds resolution that makes the whole draft-then-render plan work.**

> **Constraint that makes this task simple: no SSML break tags anywhere in the content.** ElevenLabs' `alignment.characters` is a character-for-character image of the submitted text, so a break tag would shift every index after it. Pacing comes from the `speed: 0.85` voice setting and ordinary punctuation instead. `timingsFromAlignment` asserts `characters.join('') === text` and throws if it ever drifts.

- [ ] **Step 1: Write the failing test**

`scripts/lib/words.test.mjs`:

```js
import { describe, it, expect } from 'vitest'
import { wordSpans, timingsFromAlignment, estimateTimings, cueTimes } from './words.mjs'

describe('wordSpans', () => {
  it('reports the character offsets of each word', () => {
    expect(wordSpans('Hi big sea')).toEqual([
      { word: 'Hi', start: 0, end: 2 },
      { word: 'big', start: 3, end: 6 },
      { word: 'sea', start: 7, end: 10 },
    ])
  })

  it('keeps punctuation attached to its word', () => {
    expect(wordSpans('Look, a tiger!').map(s => s.word)).toEqual(['Look,', 'a', 'tiger!'])
  })

  it('handles leading and repeated whitespace', () => {
    expect(wordSpans('  a   b ')).toEqual([
      { word: 'a', start: 2, end: 3 },
      { word: 'b', start: 6, end: 7 },
    ])
  })
})

describe('timingsFromAlignment', () => {
  const text = 'Hi big'
  const alignment = {
    characters: ['H', 'i', ' ', 'b', 'i', 'g'],
    character_start_times_seconds: [0.0, 0.1, 0.2, 0.3, 0.4, 0.5],
    character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
  }

  it('takes each word start from its first character and end from its last', () => {
    expect(timingsFromAlignment(text, alignment)).toEqual({
      words: ['Hi', 'big'],
      starts: [0.0, 0.3],
      ends: [0.2, 0.6],
    })
  })

  it('throws if the alignment does not match the submitted text', () => {
    const drifted = { ...alignment, characters: ['H', 'i', ' ', 'b', 'i', 'X'] }
    expect(() => timingsFromAlignment(text, drifted)).toThrow(/does not match/)
  })
})

describe('estimateTimings', () => {
  it('spreads the duration across words by character weight', () => {
    const t = estimateTimings('aa bbbb', 6)
    expect(t.words).toEqual(['aa', 'bbbb'])
    expect(t.starts[0]).toBe(0)
    expect(t.ends[1]).toBeCloseTo(6, 5)
    expect(t.ends[1] - t.starts[1]).toBeGreaterThan(t.ends[0] - t.starts[0])
  })

  it('gives a sentence-ending word extra time for the pause after it', () => {
    const withStop = estimateTimings('aa. bb', 6)
    const without = estimateTimings('aa bb', 6)
    expect(withStop.ends[0] - withStop.starts[0])
      .toBeGreaterThan(without.ends[0] - without.starts[0])
  })

  it('never returns a word that starts before the previous one ends', () => {
    const t = estimateTimings('one two three four five', 10)
    for (let i = 1; i < t.starts.length; i++) {
      expect(t.starts[i]).toBeGreaterThanOrEqual(t.ends[i - 1] - 1e-9)
    }
  })
})

describe('agreement with the schema', () => {
  it('splits words exactly as content/schema.ts does', async () => {
    // Two definitions of "a word" exist: wordsOf() drives cue validation and
    // wordSpans() drives the timings. If they ever drift, every cue after the
    // divergence fires on the wrong word.
    const { wordsOf } = await import('../../content/schema.ts')
    for (const t of ['Hi big sea', 'Look, a tiger!', '  a   b ', 'nine hundred and fifty-three.']) {
      expect(wordSpans(t).map(s => s.word)).toEqual(wordsOf(t))
    }
  })
})

describe('cueTimes', () => {
  const timings = { words: ['a', 'b', 'c'], starts: [0, 1, 2], ends: [1, 2, 3] }

  it('resolves a word index to the moment that word begins', () => {
    expect(cueTimes([{ word: 2, do: 'playSfx', arg: 'growl' }], timings))
      .toEqual([{ t: 2, word: 2, do: 'playSfx', arg: 'growl' }])
  })

  it('sorts cues by time so the player can walk them with one cursor', () => {
    const out = cueTimes([
      { word: 2, do: 'playSfx' },
      { word: 0, do: 'unfurlFlag' },
    ], timings)
    expect(out.map(c => c.t)).toEqual([0, 2])
  })

  it('throws on a cue past the end rather than silently dropping it', () => {
    expect(() => cueTimes([{ word: 7, do: 'playSfx' }], timings)).toThrow(/out of range/)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run scripts/lib/words.test.mjs`
Expected: FAIL, cannot resolve `./words.mjs`.

- [ ] **Step 3: Implement `scripts/lib/words.mjs`**

```js
/** Character offsets of each whitespace-delimited word in the ORIGINAL string.
 *  Offsets matter because the speech provider aligns by character. */
export function wordSpans(text) {
  const spans = []
  const re = /\S+/g
  let m
  while ((m = re.exec(text)) !== null) {
    spans.push({ word: m[0], start: m.index, end: m.index + m[0].length })
  }
  return spans
}

/**
 * Fold ElevenLabs' per-character alignment into per-word timings.
 * A word starts when its first character starts and ends when its last ends.
 */
export function timingsFromAlignment(text, alignment) {
  const { characters, character_start_times_seconds: cs, character_end_times_seconds: ce } = alignment
  const joined = characters.join('')
  if (joined !== text) {
    throw new Error(
      `alignment does not match the submitted text.\n  sent: ${JSON.stringify(text)}\n  ` +
      `back: ${JSON.stringify(joined)}\n  ` +
      `This usually means markup was included; content must contain none.`,
    )
  }
  const spans = wordSpans(text)
  return {
    words: spans.map(s => s.word),
    starts: spans.map(s => round(cs[s.start])),
    ends: spans.map(s => round(ce[s.end - 1])),
  }
}

/**
 * Draft-voice fallback: no alignment is available, so spread the measured
 * duration across words by character count, giving punctuation extra weight
 * so the highlight does not run ahead during a pause.
 */
export function estimateTimings(text, duration) {
  const spans = wordSpans(text)
  if (spans.length === 0) return { words: [], starts: [], ends: [] }

  const weights = spans.map(s => {
    let w = s.word.length + 1
    if (/[,;:]$/.test(s.word)) w += 2
    if (/[.!?]$/.test(s.word)) w += 5
    return w
  })
  const total = weights.reduce((a, b) => a + b, 0)

  const starts = [], ends = []
  let t = 0
  for (const w of weights) {
    const dt = (w / total) * duration
    starts.push(round(t))
    t += dt
    ends.push(round(t))
  }
  ends[ends.length - 1] = round(duration)
  return { words: spans.map(s => s.word), starts, ends }
}

/**
 * Resolve authored word-index cues into playback times.
 *
 * This is the join that lets the site be built against a free draft voice and
 * then re-rendered with the paid one: the content only ever says "at word 14",
 * and the times are recomputed from whatever timings the current voice produced.
 */
export function cueTimes(cues, timings) {
  return (cues ?? [])
    .map(c => {
      if (c.word >= timings.starts.length) {
        throw new Error(`cue word index ${c.word} is out of range (${timings.starts.length} words)`)
      }
      return { ...c, t: timings.starts[c.word] }
    })
    .sort((a, b) => a.t - b.t)
}

const round = n => Math.round(n * 1000) / 1000
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run scripts/lib/words.test.mjs`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/words.mjs scripts/lib/words.test.mjs
git commit -m "feat: word timings and word-index cue resolution"
```

---

## Task 5: Audio encoding and the draft voice

**Files:**
- Create: `scripts/lib/encode.mjs`
- Create: `scripts/tts-providers/say.mjs`
- Create: `scripts/tts.mjs`
- Test: `scripts/lib/encode.test.mjs`, `scripts/tts.test.mjs`
- Generates: `public/audio/en/*.m4a`, `src/data/timings.json`

**Interfaces:**
- Consumes: `timingsFromAlignment`, `estimateTimings`, `cueTimes` (Task 4); the content files (Task 2).
- Produces:
  - `encode.mjs`: `toMonoWav(inPath, outPath)`, `toM4a(wavPath, outPath, bitrate)`, `probe(path)`, `durationOf(path)`.
  - A **provider contract** every speech backend implements:
    `synth(text, { tmpDir, id }) -> { audioPath: string, alignment: Alignment | null }` plus `signature(): string`. The provider writes any format it likes to a temp file; `tts.mjs` owns conversion to mono m4a.
  - `src/data/timings.json`, keyed by line id:
    ```ts
    {
      audio: string      // "audio/en/raj.intro.m4a", for assetUrl()
      duration: number
      words: string[]
      starts: number[]
      ends: number[]
      cues: { t: number, word: number, do: string, arg?: string }[]
    }
    ```

- [ ] **Step 1: Write the failing test for the encoder**

`scripts/lib/encode.test.mjs`:

```js
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toMonoWav, toM4a, durationOf, probe } from './encode.mjs'

const dir = mkdtempSync(join(tmpdir(), 'encode-'))
const spoken = join(dir, 'spoken.aiff')

beforeAll(() => {
  execFileSync('say', ['-v', 'Tara', '-r', '130', '-o', spoken, 'Hello little one, this is India.'])
})

describe('encode', () => {
  it('converts to 16-bit mono 44.1 kHz PCM', () => {
    const wav = join(dir, 'mono.wav')
    toMonoWav(spoken, wav)
    expect(existsSync(wav)).toBe(true)
    const p = probe(wav)
    expect(p.channels).toBe(1)
    expect(p.sampleRate).toBe(44100)
  })

  it('encodes AAC into an .m4a smaller than the PCM it came from', () => {
    const wav = join(dir, 'mono2.wav')
    const m4a = join(dir, 'out.m4a')
    toMonoWav(spoken, wav)
    toM4a(wav, m4a, 56000)
    expect(existsSync(m4a)).toBe(true)
    expect(statSync(m4a).size).toBeLessThan(statSync(wav).size)
    expect(probe(m4a).channels).toBe(1)
  })

  it('reports a duration that matches the source within 100 ms', () => {
    const wav = join(dir, 'mono3.wav')
    const m4a = join(dir, 'out3.m4a')
    toMonoWav(spoken, wav)
    toM4a(wav, m4a, 56000)
    expect(Math.abs(durationOf(m4a) - durationOf(wav))).toBeLessThan(0.1)
  })

  it('reports a plausible duration for a short sentence', () => {
    expect(durationOf(spoken)).toBeGreaterThan(1)
    expect(durationOf(spoken)).toBeLessThan(15)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run scripts/lib/encode.test.mjs`
Expected: FAIL, cannot resolve `./encode.mjs`.

- [ ] **Step 3: Implement `scripts/lib/encode.mjs`**

```js
import { execFileSync } from 'node:child_process'

/**
 * afconvert cannot encode MP3 and cannot mix or fade; it is purely a codec
 * front end. ffmpeg and sox are not installed and must not be required.
 * Everything therefore goes through two steps: normalise to mono PCM, then
 * encode AAC. Verified working on macOS 26.5.
 */

/** Decode anything (aiff, mp3, ogg, wav, flac) to 16-bit mono 44.1 kHz PCM. */
export function toMonoWav(input, output) {
  execFileSync('afconvert', [
    '-f', 'WAVE',
    '-d', 'LEI16@44100',
    '-c', '1',                    // mono halves both file size and decoded RAM
    '--src-complexity', 'bats',
    '-r', '127',
    input, output,
  ])
  return output
}

/** Encode mono PCM to web-ready AAC in an .m4a container. */
export function toM4a(wav, output, bitrate = 56000) {
  execFileSync('afconvert', [
    '-f', 'm4af',
    '-d', 'aac',
    '-b', String(bitrate),
    '-q', '127',
    '-s', '2',
    wav, output,
  ])
  return output
}

/** Read channel count, sample rate and duration out of afinfo. */
export function probe(path) {
  const out = execFileSync('afinfo', [path], { encoding: 'utf8' })
  return {
    channels: Number(out.match(/(\d+) ch,/)?.[1] ?? 0),
    sampleRate: Number(out.match(/([\d.]+) Hz/)?.[1] ?? 0),
    duration: Number(out.match(/estimated duration:\s*([\d.]+)/)?.[1] ?? 0),
  }
}

export function durationOf(path) {
  return probe(path).duration
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run scripts/lib/encode.test.mjs`
Expected: PASS, 4 tests.

If `probe` returns zeros, run `afinfo` on the file by hand and adjust the three regexes; `afinfo` output varies slightly by macOS version. Do not proceed with zeros, because `durationOf` feeds the draft timing estimator.

- [ ] **Step 5: Implement the draft provider `scripts/tts-providers/say.mjs`**

```js
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

/**
 * Free local draft voice. Produces no alignment, so tts.mjs falls back to
 * estimateTimings(). Purpose: build and test every animation, cue and
 * transition without spending a single paid character.
 *
 * Tara is macOS's en_IN female voice. 130 wpm against a ~175 default is
 * roughly the pace of the final render at speed 0.85, so cues authored
 * against the draft land in about the right place after the swap.
 */
export const name = 'say'
export const voice = 'Tara'
export const rate = 130

export async function synth(text, { tmpDir, id }) {
  const out = join(tmpDir, `${id}.aiff`)
  execFileSync('say', ['-v', voice, '-r', String(rate), '-o', out, text])
  return { audioPath: out, alignment: null }
}

/** Part of the cache key: change the voice or rate and everything re-renders. */
export const signature = () => `say:${voice}:${rate}`
```

- [ ] **Step 6: Implement the orchestrator `scripts/tts.mjs`**

```js
#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toMonoWav, toM4a, durationOf } from './lib/encode.mjs'
import { timingsFromAlignment, estimateTimings, cueTimes } from './lib/words.mjs'

const arg = (name, fallback) =>
  process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback

const providerName = arg('provider', 'say')
const only = arg('only', null)
const force = process.argv.includes('--force')

const provider = await import(`./tts-providers/${providerName}.mjs`)

// Overridable so the test suite can write to a scratch directory. Without
// this the tests would leave fixture audio in public/ and fixture entries in
// the committed timings file. Production npm scripts pass none of these.
const OUT_DIR = arg('audio-dir', 'public/audio/en')
const TIMINGS = arg('timings', 'src/data/timings.json')
const CACHE = arg('cache', 'build/tts-cache.json')

mkdirSync(OUT_DIR, { recursive: true })
mkdirSync('src/data', { recursive: true })
mkdirSync('build', { recursive: true })

/** Every narrated line in the whole corpus, in a stable order. */
function collectLines() {
  const lines = []
  for (const f of readdirSync('content/places').filter(f => f.endsWith('.json')).sort()) {
    const p = JSON.parse(readFileSync(join('content/places', f), 'utf8'))
    lines.push(p.intro)
    for (const l of Object.values(p.card)) lines.push(l)
    for (const lm of p.landmarks) lines.push(lm.line)
  }
  // Tolerate these being absent: the pipeline is built and tested (Task 5)
  // before the tour and interface copy is written (Task 9). validate-content
  // is what insists they exist.
  if (existsSync('content/tour.json')) {
    lines.push(...JSON.parse(readFileSync('content/tour.json', 'utf8')).beats)
  }
  if (existsSync('content/ui.json')) {
    lines.push(...JSON.parse(readFileSync('content/ui.json', 'utf8')).lines)
  }
  return lines
}

/** Cache key. Regenerating a line costs real money on the paid provider, so
 *  never re-request an unchanged one. Cues are deliberately excluded: moving a
 *  cue changes the timings file but not the audio. */
const keyOf = (line) =>
  createHash('sha256').update(`${provider.signature()} ${line.text}`).digest('hex').slice(0, 16)

// `force` clears the CACHE, so everything re-renders. It must NOT clear
// `previous`: that is also the merge base for `--only`, and zeroing both
// means `--only=rajasthan --force` writes a timings file containing only
// Rajasthan and silently deletes every other place's entry.
const cache = existsSync(CACHE) && !force ? JSON.parse(readFileSync(CACHE, 'utf8')) : {}
const previous = existsSync(TIMINGS) ? JSON.parse(readFileSync(TIMINGS, 'utf8')) : {}
// Start from the previous timings when rendering a subset, or --only=rajasthan
// would write a timings.json containing ONLY Rajasthan and silently delete
// every other clip's entry.
const timings = only ? { ...previous } : {}
const tmp = mkdtempSync(join(tmpdir(), 'tts-'))

let rendered = 0, reused = 0
const lines = collectLines().filter(l => !only || l.id.startsWith(only))
console.log(`${lines.length} lines, provider "${providerName}"`)

if (providerName === 'elevenlabs') {
  const todo = lines.filter(l => !(cache[l.id] === keyOf(l) && existsSync(join('public', `audio/en/${l.id}.m4a`))))
  const chars = todo.reduce((a, l) => a + l.text.length, 0)
  console.log(`  ${todo.length} of ${lines.length} lines need rendering`)
  console.log(`  ${chars.toLocaleString()} characters, about $${(chars / 1000 * 0.10).toFixed(2)}`)
  console.log(`  Creator tier allowance is 220,000 characters per month.`)
  if (!process.argv.includes('--yes')) {
    console.log(`\n  Re-run with --yes to spend these characters.\n`)
    process.exit(0)
  }
}

async function renderLine(line) {
  const key = keyOf(line)
  const abs = join(OUT_DIR, `${line.id}.m4a`)
  // The path stored in timings.json is always the production-relative one,
  // because the app resolves it through assetUrl() regardless of where the
  // build happened to write the file.
  const rel = `audio/en/${line.id}.m4a`

  if (cache[line.id] === key && existsSync(abs) && previous[line.id]) {
    // Audio is unchanged; still recompute cue times in case a cue moved.
    timings[line.id] = { ...previous[line.id], cues: cueTimes(line.cues, previous[line.id]) }
    reused++
    return
  }

  const { audioPath, alignment } = await provider.synth(line.text, { tmpDir: tmp, id: line.id })
  const wav = join(tmp, `${line.id}.wav`)
  toMonoWav(audioPath, wav)
  toM4a(wav, abs, 56000)

  const duration = durationOf(abs)
  // A zero duration means afinfo's output did not match probe()'s regexes —
  // its format varies by macOS version. Left unguarded, estimateTimings
  // would put every word at t=0 and the highlight would never advance.
  if (!(duration > 0)) {
    throw new Error(
      `could not read a duration from ${abs}. Run \`afinfo\` on it by hand and ` +
      `fix the regexes in scripts/lib/encode.mjs — do not ship zero timings.`,
    )
  }
  const t = alignment
    ? timingsFromAlignment(line.text, alignment)
    : estimateTimings(line.text, duration)

  timings[line.id] = { audio: rel, duration, ...t, cues: cueTimes(line.cues, t) }
  cache[line.id] = key
  rendered++
  process.stdout.write(`\r  rendered ${rendered}, reused ${reused}   `)
}

// Creator's Multilingual-v2 concurrency limit is 5, so use 4. The local
// draft voice is CPU-bound and gains nothing from parallelism.
const POOL = providerName === 'elevenlabs' ? 4 : 1
const queue = [...lines]
await Promise.all(Array.from({ length: POOL }, async () => {
  for (let line; (line = queue.shift()); ) await renderLine(line)
}))

rmSync(tmp, { recursive: true, force: true })
writeFileSync(TIMINGS, JSON.stringify(timings))
writeFileSync(CACHE, JSON.stringify(cache, null, 2))

const seconds = Object.values(timings).reduce((a, t) => a + t.duration, 0)
console.log(`\nwrote ${Object.keys(timings).length} clips, ${(seconds / 60).toFixed(1)} minutes of narration`)
console.log(`  ${rendered} rendered, ${reused} reused from cache`)
if (provider.charactersSpent) {
  const spent = provider.charactersSpent()
  console.log(`  ${spent.toLocaleString()} characters billed, about $${(spent / 1000 * 0.10).toFixed(2)}`)
}
```

- [ ] **Step 7: Write the end-to-end test**

`scripts/tts.test.mjs`. This runs the real pipeline over a fixture, proving `say` to `afconvert` to timings works on this machine.

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'

const FIXTURE = 'content/places/testland.json'
const line = (id, kind, text, cues) => ({ id, kind, text, ...(cues ? { cues } : {}) })

beforeAll(() => {
  mkdirSync('content/places', { recursive: true })
  writeFileSync(FIXTURE, JSON.stringify({
    id: 'testland', name: 'Testland', type: 'state', capital: 'Testpur', ambience: 'plains',
    intro: line('testland.intro', 'intro', 'Testland is a friendly place with one big tiger.',
                [{ word: 7, do: 'playSfx', arg: 'tiger-growl' }]),
    card: {
      animal: line('testland.card.animal', 'card', 'The tiger lives here.'),
      food: line('testland.card.food', 'card', 'People eat rice.'),
      festival: line('testland.card.festival', 'card', 'They dance in spring.'),
      hello: line('testland.card.hello', 'card', 'People say hello.'),
    },
    landmarks: Array.from({ length: 5 }, (_, i) => ({
      id: `testland.lm${i}`, name: `Spot ${i}`, photoQuery: `Spot ${i}`, scene: 'plains',
      line: line(`testland.lm${i}.line`, 'landmark', `Spot number ${i} is nice.`),
    })),
  }))
  execFileSync('node', ['scripts/tts.mjs', '--provider=say', '--only=testland'], { stdio: 'inherit' })
})

afterAll(() => { rmSync(FIXTURE, { force: true }) })

describe('tts pipeline with the draft voice', () => {
  const timings = () => JSON.parse(readFileSync('src/data/timings.json', 'utf8'))

  it('produces an audio file for every line', () => {
    for (const id of Object.keys(timings()).filter(k => k.startsWith('testland'))) {
      expect(existsSync(`public/audio/en/${id}.m4a`), `missing audio for ${id}`).toBe(true)
    }
  })

  it('records one timing per word', () => {
    const t = timings()['testland.intro']
    expect(t.words).toEqual('Testland is a friendly place with one big tiger.'.split(' '))
    expect(t.starts).toHaveLength(t.words.length)
    expect(t.ends).toHaveLength(t.words.length)
  })

  it('keeps word timings inside the clip duration', () => {
    const t = timings()['testland.intro']
    expect(t.starts[0]).toBe(0)
    expect(t.ends[t.ends.length - 1]).toBeLessThanOrEqual(t.duration + 0.01)
  })

  it('resolves the word-index cue to a real time inside the clip', () => {
    const t = timings()['testland.intro']
    expect(t.cues).toHaveLength(1)
    expect(t.cues[0].arg).toBe('tiger-growl')
    expect(t.cues[0].t).toBe(t.starts[7])
    expect(t.cues[0].t).toBeGreaterThan(0)
    expect(t.cues[0].t).toBeLessThan(t.duration)
  })

  it('stores a relative audio path that assetUrl can use', () => {
    expect(timings()['testland.intro'].audio).toBe('audio/en/testland.intro.m4a')
    expect(timings()['testland.intro'].audio.startsWith('/')).toBe(false)
  })
})
```

- [ ] **Step 8: Run it**

Run: `npx vitest run scripts/tts.test.mjs`
Expected: PASS, 5 tests. You will hear nothing, because `say -o` writes to a file rather than the speakers.

- [ ] **Step 9: Listen to one clip**

Automated tests cannot tell you whether the voice is pleasant.

Run: `afplay public/audio/en/testland.intro.m4a`
Expected: a slow, clear Indian-English female voice. This is the draft standard, not the final one.

- [ ] **Step 10: Commit**

```bash
git add scripts/lib/encode.mjs scripts/lib/encode.test.mjs scripts/tts-providers/say.mjs scripts/tts.mjs scripts/tts.test.mjs
git commit -m "feat: narration pipeline with a free draft voice

afconvert and say only, since ffmpeg is not installed. Content-hash caching
means an unchanged line is never re-rendered, which matters most once the
paid provider is swapped in."
```

---

## Task 6: The final voice (ElevenLabs)

**Files:**
- Create: `scripts/tts-providers/elevenlabs.mjs`
- Create: `scripts/voices.mjs`
- Test: `scripts/tts-providers/elevenlabs.test.mjs`

**Interfaces:**
- Consumes: the provider contract from Task 5, `synth(text, { tmpDir, id })` and `signature()`.
- Produces: the same contract. `tts.mjs` needs no changes; `--provider=elevenlabs` is the only difference.
- Also produces `scripts/voices.mjs`, a one-off discovery tool run by hand.

**Verified API facts this task depends on:**

| Thing | Value |
|---|---|
| Endpoint | `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps` |
| Auth header | `xi-api-key` |
| Response | `{ audio_base64, alignment, normalized_alignment }` |
| Alignment shape | `{ characters: string[], character_start_times_seconds: number[], character_end_times_seconds: number[] }`, units **seconds** |
| Model | `eleven_multilingual_v2` (10,000 char limit, most stable on long form, supports numeric `speed`; `eleven_v3` does not) |
| Output format | `mp3_44100_64` |
| Voice settings | `stability 0.55`, `similarity_boost 0.75`, `style 0`, `use_speaker_boost true`, `speed 0.85` (range 0.7 to 1.2) |
| Creator tier | $22/month, 220,000 characters, first month $11. Concurrency limit 5, so use a pool of 4 |
| Useful headers | `character-cost`, `current-concurrent-requests`, `maximum-concurrent-requests` |

**Do not hardcode a legacy default voice id.** Default voices are unavailable to accounts created after March 2026 and expire on 31 December 2026.

- [ ] **Step 1: Write `scripts/voices.mjs`, the discovery tool**

Voice ids cannot be obtained from public documentation; the library endpoint returns 401 without a key. This is run once, by hand, and its output goes into `.env`.

```js
#!/usr/bin/env node
/**
 * One-off: find a warm Indian-English narration voice and add it to the account.
 *   ELEVENLABS_API_KEY=... node scripts/voices.mjs
 *   ELEVENLABS_API_KEY=... node scripts/voices.mjs --add <public_user_id> <voice_id>
 */
const key = process.env.ELEVENLABS_API_KEY
if (!key) { console.error('set ELEVENLABS_API_KEY'); process.exit(1) }
const H = { 'xi-api-key': key }
const [, , cmd, ...rest] = process.argv

if (cmd === '--add') {
  const [publicUserId, voiceId] = rest
  const res = await fetch(`https://api.elevenlabs.io/v1/voices/add/${publicUserId}/${voiceId}`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_name: 'Mor Narrator' }),
  })
  console.log(res.status, await res.text())
  console.log('\nPut the returned voice_id in .env as ELEVENLABS_VOICE_ID')
  process.exit(res.ok ? 0 : 1)
}

const q = new URLSearchParams({
  accent: 'indian', language: 'en', use_cases: 'narrative_story',
  page_size: '30', sort: 'trending',
})
const res = await fetch(`https://api.elevenlabs.io/v1/shared-voices?${q}`, { headers: H })
if (!res.ok) { console.error(res.status, await res.text()); process.exit(1) }
const { voices } = await res.json()

if (!voices?.length) {
  console.log('No Indian-accent narrative voices returned. Widen the filter, or design one:')
  console.log('  POST /v1/text-to-voice/design with a prompt such as')
  console.log('  "A warm, gentle Indian English female voice in her thirties,')
  console.log('   soft and unhurried, telling a bedtime story to a small child."')
  process.exit(0)
}
for (const v of voices) {
  console.log(`${v.name.padEnd(22)} ${v.voice_id}  ${v.gender ?? '?'}/${v.age ?? '?'}`)
  console.log(`  ${(v.description ?? '').slice(0, 100)}`)
  console.log(`  preview: ${v.preview_url}`)
  console.log(`  add:     node scripts/voices.mjs --add ${v.public_owner_id} ${v.voice_id}\n`)
}
```

- [ ] **Step 2: Write the failing test**

`scripts/tts-providers/elevenlabs.test.mjs`. `synth` is tested against a stubbed `fetch`, never against the live paid API.

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REAL_FETCH = globalThis.fetch
const dir = mkdtempSync(join(tmpdir(), 'el-'))

async function load() {
  process.env.ELEVENLABS_API_KEY = 'test-key'
  process.env.ELEVENLABS_VOICE_ID = 'test-voice'
  vi.resetModules()
  return import('./elevenlabs.mjs')
}

function okResponse(body, headers = {}) {
  return {
    ok: true, status: 200,
    headers: new Headers({ 'character-cost': '25', ...headers }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

const ALIGNMENT = {
  characters: [...'Hi big'],
  character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
  character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
}

beforeEach(() => { globalThis.fetch = vi.fn() })
afterEach(() => { globalThis.fetch = REAL_FETCH })

describe('elevenlabs provider', () => {
  it('calls the with-timestamps endpoint with the agreed model and settings', async () => {
    const { synth } = await load()
    globalThis.fetch.mockResolvedValue(okResponse({
      audio_base64: Buffer.from('fake-mp3').toString('base64'), alignment: ALIGNMENT,
    }))

    await synth('Hi big', { tmpDir: dir, id: 'x' })

    const [url, init] = globalThis.fetch.mock.calls[0]
    expect(url).toContain('/v1/text-to-speech/test-voice/with-timestamps')
    expect(url).toContain('output_format=mp3_44100_64')
    expect(init.headers['xi-api-key']).toBe('test-key')

    const body = JSON.parse(init.body)
    expect(body.model_id).toBe('eleven_multilingual_v2')
    expect(body.text).toBe('Hi big')
    expect(body.voice_settings).toEqual({
      stability: 0.55, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 0.85,
    })
  })

  it('refuses markup, because break tags would desynchronise the alignment', async () => {
    const { synth } = await load()
    globalThis.fetch.mockResolvedValue(okResponse({
      audio_base64: Buffer.from('x').toString('base64'), alignment: ALIGNMENT,
    }))
    await expect(synth('Hi <break time="1s" /> big', { tmpDir: dir, id: 'y' }))
      .rejects.toThrow(/markup/i)
  })

  it('decodes the base64 audio to a real file and returns the alignment', async () => {
    const { synth } = await load()
    globalThis.fetch.mockResolvedValue(okResponse({
      audio_base64: Buffer.from('fake-mp3-bytes').toString('base64'), alignment: ALIGNMENT,
    }))
    const { audioPath, alignment } = await synth('Hi big', { tmpDir: dir, id: 'z' })
    expect(readFileSync(audioPath).toString()).toBe('fake-mp3-bytes')
    expect(alignment).toEqual(ALIGNMENT)
  })

  it('retries a 429 rather than losing the clip', async () => {
    const { synth } = await load()
    globalThis.fetch
      .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ 'retry-after': '0' }), text: async () => 'system_busy' })
      .mockResolvedValueOnce(okResponse({ audio_base64: Buffer.from('ok').toString('base64'), alignment: ALIGNMENT }))
    const { audioPath } = await synth('Hi big', { tmpDir: dir, id: 'r' })
    expect(readFileSync(audioPath).toString()).toBe('ok')
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('gives up loudly on a 401 instead of writing a broken file', async () => {
    const { synth } = await load()
    globalThis.fetch.mockResolvedValue({ ok: false, status: 401, headers: new Headers(), text: async () => 'unauthorized' })
    await expect(synth('Hi big', { tmpDir: dir, id: 'e' })).rejects.toThrow(/401/)
  })

  it('changes its signature when the voice changes, invalidating the cache', async () => {
    const a = await load()
    const sigA = a.signature()
    process.env.ELEVENLABS_VOICE_ID = 'different-voice'
    vi.resetModules()
    const b = await import('./elevenlabs.mjs')
    expect(b.signature()).not.toBe(sigA)
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run scripts/tts-providers/elevenlabs.test.mjs`
Expected: FAIL, cannot resolve `./elevenlabs.mjs`.

- [ ] **Step 4: Implement `scripts/tts-providers/elevenlabs.mjs`**

```js
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'elevenlabs'

const MODEL = 'eleven_multilingual_v2'
const FORMAT = 'mp3_44100_64'
const SETTINGS = {
  stability: 0.55,        // 0.5 to 0.65; higher is steadier, above ~0.65 goes monotone
  similarity_boost: 0.75,
  style: 0,               // docs recommend keeping this at 0
  use_speaker_boost: true,
  speed: 0.85,            // range 0.7 to 1.2; 0.85 is a gentle, unhurried pace
}

const key = () => process.env.ELEVENLABS_API_KEY
const voiceId = () => process.env.ELEVENLABS_VOICE_ID

/** Any change here must re-render everything, so it all goes in the cache key. */
export const signature = () =>
  `elevenlabs:${voiceId()}:${MODEL}:${FORMAT}:${JSON.stringify(SETTINGS)}`

const sleep = ms => new Promise(r => setTimeout(r, ms))
let spent = 0
export const charactersSpent = () => spent

export async function synth(text, { tmpDir, id }) {
  if (!key()) throw new Error('ELEVENLABS_API_KEY is not set')
  if (!voiceId()) throw new Error('ELEVENLABS_VOICE_ID is not set. Run: node scripts/voices.mjs')

  // alignment.characters is a character-for-character image of what we send.
  // Any markup shifts every index after it and silently breaks word highlighting.
  if (/<[^>]+>/.test(text)) {
    throw new Error(`line "${id}" contains markup; content must be plain text only: ${text}`)
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId()}/with-timestamps` +
              `?output_format=${FORMAT}`

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': key(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: MODEL, voice_settings: SETTINGS }),
    })

    // Two different 429s exist: too_many_concurrent_requests and system_busy.
    // Both are handled the same way, by waiting and retrying.
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after')) || 2 ** attempt
      await sleep(wait * 1000)
      continue
    }
    if (!res.ok) throw new Error(`ElevenLabs ${res.status} on "${id}": ${await res.text()}`)

    const { audio_base64, alignment } = await res.json()
    if (!alignment) throw new Error(`no alignment returned for "${id}"`)

    const audioPath = join(tmpDir, `${id}.mp3`)
    writeFileSync(audioPath, Buffer.from(audio_base64, 'base64'))

    const cost = res.headers.get('character-cost')
    if (cost) spent += Number(cost)
    return { audioPath, alignment }
  }
  throw new Error(`ElevenLabs gave up after 5 attempts on "${id}"`)
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run scripts/tts-providers/elevenlabs.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 6: Verify the preflight refuses to spend without confirmation**

The preflight was written in Task 5 Step 6; this proves it works.

Run: `ELEVENLABS_API_KEY=fake ELEVENLABS_VOICE_ID=fake npm run tts:final`
Expected: prints a character count and a dollar estimate, then exits 0 **without making any HTTP request**.

- [ ] **Step 7: Add `.env` handling**

Create `.env.example` (committed) and confirm `.env` is already in `.gitignore` from the design-spec commit:

```bash
cat > .env.example <<'EOF'
# Get a key at https://elevenlabs.io/app/settings/api-keys
ELEVENLABS_API_KEY=
# Discover and add a voice: node scripts/voices.mjs
ELEVENLABS_VOICE_ID=
EOF
grep -q '^\.env$' .gitignore || echo '.env' >> .gitignore
```

- [ ] **Step 8: Commit**

```bash
git add scripts/tts-providers/elevenlabs.mjs scripts/tts-providers/elevenlabs.test.mjs scripts/voices.mjs .env.example .gitignore
git commit -m "feat: ElevenLabs provider behind the same interface as the draft voice

Word timings come from the with-timestamps alignment rather than estimation.
A preflight prints the cost and refuses to spend without --yes."
```

---

## Task 7: Landmark photographs

**Files:**
- Create: `scripts/lib/wiki.mjs`
- Create: `scripts/fetch-photos.mjs`
- Create: `scripts/contact-sheet.mjs`
- Test: `scripts/lib/wiki.test.mjs`
- Generates: `public/photos/*.jpg`, `src/data/photo-credits.json`, `review/photos.html`

**Interfaces:**
- Consumes: `content/places/*.json` (for `landmark.photoQuery` and `landmark.id`).
- Produces `src/data/photo-credits.json`, keyed by landmark id:
  ```ts
  {
    file: string          // "photos/raj.thar.jpg", for assetUrl()
    width: number         // the ACTUAL delivered width, not the requested one
    artist: string
    licence: string       // machine code, e.g. "cc-by-sa-4.0"
    licenceShort: string  // "CC BY-SA 4.0"
    licenceUrl: string | null
    descriptionUrl: string
    attributionHtml: string
    source: 'pageimages' | 'wikidata-P18' | 'commons-search' | 'override'
  }
  ```
- Also exports from `wiki.mjs`: `api(base, params)`, `vet(imageinfo)`, `attribution(imageinfo)`, `realWidth(url)`, `stripQuery(url)`.

**Three verified traps this task must handle, all of which fail silently:**

1. **Thumbnail bucketing.** Allowed widths are 20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840. `iiurlwidth=900` does *not* error; it returns a URL pointing at **960px** while reporting `thumbwidth: 900`. Always take `thumburl` verbatim and parse the real width out of the `/NNNpx-` segment.
2. **`missing: true` with valid `imageinfo`.** Querying en.wikipedia for a `File:` title hosted on Commons with no local description page returns `missing: true` *and* a complete `imageinfo` array with `imagerepository: "shared"`. Filtering on `p.missing` silently discards good files. Test `!p.imageinfo?.[0]` instead.
3. **Technically valid, factually wrong photograph.** The Pangong Tso lead image is an ISS photograph of Earth. It passes every licence, size and mime check. No API filter catches this, which is why Step 8 is a mandatory human review and not optional.

- [ ] **Step 1: Write the failing test**

`scripts/lib/wiki.test.mjs`. Pure functions only, no network.

```js
import { describe, it, expect } from 'vitest'
import { vet, attribution, realWidth, stripQuery } from './wiki.mjs'

const freeFile = {
  imagerepository: 'shared',
  fileTitle: 'File:Konarka Temple.jpg',
  mime: 'image/jpeg', width: 2048, height: 1365,
  thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/Konarka_Temple.jpg/960px-Konarka_Temple.jpg?utm_source=x',
  extmetadata: {
    License: { value: 'cc-by-sa-4.0' },
    LicenseShortName: { value: 'CC BY-SA 4.0' },
    LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
    Artist: { value: '<a href="/wiki/User:Subham9423">Subham9423</a>' },
    AttributionRequired: { value: 'true' },
  },
  descriptionurl: 'https://commons.wikimedia.org/wiki/File:Konarka_Temple.jpg',
}

describe('realWidth', () => {
  it('reads the width actually delivered, not the width requested', () => {
    expect(realWidth(freeFile.thumburl)).toBe(960)
  })
})

describe('stripQuery', () => {
  it('removes the tracking parameters Wikimedia now appends', () => {
    expect(stripQuery(freeFile.thumburl)).not.toContain('utm_source')
    expect(stripQuery(freeFile.thumburl)).toMatch(/960px-Konarka_Temple\.jpg$/)
  })
})

describe('vet', () => {
  it('accepts a CC BY-SA file hosted on Commons', () => {
    expect(vet(freeFile).ok).toBe(true)
  })

  it('rejects a file uploaded locally to en.wikipedia, where fair-use lives', () => {
    expect(vet({ ...freeFile, imagerepository: 'local' }).ok).toBe(false)
  })

  it('rejects an explicitly non-free file', () => {
    const nonFree = { ...freeFile, extmetadata: { ...freeFile.extmetadata, NonFree: { value: 'true' } } }
    expect(vet(nonFree).ok).toBe(false)
  })

  it('rejects GFDL, which has no machine licence code and cannot be shipped', () => {
    const gfdl = { ...freeFile, extmetadata: { LicenseShortName: { value: 'GFDL 1.2' } } }
    expect(vet(gfdl).ok).toBe(false)
  })

  it('accepts public domain, which carries no LicenseUrl', () => {
    const pd = {
      ...freeFile,
      extmetadata: { License: { value: 'pd' }, LicenseShortName: { value: 'Public domain' },
                     AttributionRequired: { value: 'false' } },
    }
    expect(vet(pd).ok).toBe(true)
  })

  it('rejects a title that looks like a montage rather than a photograph', () => {
    expect(vet({ ...freeFile, fileTitle: 'File:A collage of Mamallapuram town.jpg' }).ok).toBe(false)
  })

  it('rejects an ISS satellite frame, the Pangong Tso failure mode', () => {
    expect(vet({ ...freeFile, fileTitle: 'File:ISS054-E-7809 - View of Earth (cropped).jpg' }).ok).toBe(false)
  })

  it('rejects a TIFF, which browsers cannot display', () => {
    expect(vet({ ...freeFile, mime: 'image/tiff' }).ok).toBe(false)
  })

  it('rejects an image too small to fill a landmark panel', () => {
    expect(vet({ ...freeFile, width: 400 }).ok).toBe(false)
  })

  it('rejects an extreme panorama that cannot be cropped sensibly', () => {
    expect(vet({ ...freeFile, width: 4365, height: 800 }).ok).toBe(false)
  })

  it('rejects a file carrying personality or trademark restrictions', () => {
    const r = { ...freeFile, extmetadata: { ...freeFile.extmetadata, Restrictions: { value: 'personality' } } }
    expect(vet(r).ok).toBe(false)
  })
})

describe('attribution', () => {
  it('builds a credit with the author, a linked licence and a link to the source', () => {
    const a = attribution(freeFile)
    expect(a.artist).toBe('Subham9423')
    expect(a.licence).toBe('cc-by-sa-4.0')
    expect(a.attributionRequired).toBe(true)
    expect(a.attributionHtml).toContain('CC BY-SA 4.0')
    expect(a.attributionHtml).toContain('creativecommons.org/licenses/by-sa/4.0')
    expect(a.attributionHtml).toContain('commons.wikimedia.org/wiki/File:Konarka_Temple.jpg')
  })

  it('makes protocol-relative author links absolute so they work offline', () => {
    const rel = { ...freeFile, extmetadata: { ...freeFile.extmetadata, Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:X">X</a>' } } }
    expect(attribution(rel).attributionHtml).not.toContain('href="//')
  })

  it('tolerates a missing LicenseUrl, as public domain files have', () => {
    const pd = { ...freeFile, extmetadata: { License: { value: 'pd' }, LicenseShortName: { value: 'Public domain' } } }
    expect(() => attribution(pd)).not.toThrow()
    expect(attribution(pd).licenceUrl).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run scripts/lib/wiki.test.mjs`
Expected: FAIL, cannot resolve `./wiki.mjs`.

- [ ] **Step 3: Implement `scripts/lib/wiki.mjs`**

```js
/**
 * Wikimedia client shared by the photo and sound fetchers.
 * Policy: a descriptive User-Agent is mandatory (an empty one returns 403),
 * requests go in series and never in parallel, and maxlag is sent because
 * this is a non-interactive task.
 */
export const UA =
  'NamasteIndia/1.0 (https://github.com/OWNER/REPO; tushar.et1@gmail.com) node-fetch'

export const EN = 'https://en.wikipedia.org/w/api.php'
export const WD = 'https://www.wikidata.org/w/api.php'
export const COMMONS = 'https://commons.wikimedia.org/w/api.php'

export const EM_FILTER = [
  'LicenseShortName', 'License', 'Artist', 'Credit', 'AttributionRequired',
  'UsageTerms', 'LicenseUrl', 'Restrictions', 'Copyrighted', 'NonFree',
].join('|')

const ALLOWED_LICENCE = /^(cc0|pd|cc-by-\d(\.\d)?|cc-by-sa-\d(\.\d)?)$/i
const GOOD_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const NOT_A_PHOTO = /collage|montage|composite|diagram|satellite|\bISS\d{3}|\bmaps?\b|\bplan\b|\bsketch\b|\blogo\b|\bseal\b/i

export const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function api(base, params, tries = 4) {
  const u = new URL(base)
  u.search = new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params })
  for (let i = 0; i < tries; i++) {
    let res
    try {
      res = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' } })
    } catch {
      await sleep(1000 * 2 ** i); continue
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep((Number(res.headers.get('retry-after')) || 2 ** i) * 1000); continue
    }
    const j = await res.json()
    if (j.error?.code === 'maxlag') { await sleep((Number(j.error.lag) || 5) * 1000); continue }
    if (j.error) throw new Error(`${j.error.code}: ${j.error.info}`)
    return j
  }
  throw new Error(`giving up on ${base} after ${tries} attempts`)
}

/** Wikimedia now appends utm_* tracking parameters to returned URLs. */
export const stripQuery = url => { const u = new URL(url); u.search = ''; return u.href }

/** The width actually delivered. iiurlwidth=900 silently gives you 960 while
 *  reporting thumbwidth 900, so never trust the reported number. */
export const realWidth = url => Number(stripQuery(url).match(/\/(\d+)px-/)?.[1]) || null

const text = html => (html ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
const absolutise = html => (html ?? '').replace(/href="\/\//g, 'href="https://')

export function vet(ii) {
  const g = k => ii.extmetadata?.[k]?.value

  // Fair-use uploads live on en.wikipedia, never on Commons. This one check
  // eliminates the entire category.
  if (ii.imagerepository !== 'shared') return { ok: false, why: 'local upload, not Commons' }
  if (String(g('NonFree')).toLowerCase() === 'true') return { ok: false, why: 'NonFree' }

  const short = String(g('LicenseShortName') ?? '')
  if (/fair use|non-?free/i.test(short)) return { ok: false, why: `LicenseShortName "${short}"` }

  // Allowlist, never a denylist. A legitimately-licensed file can have no
  // machine code at all (GFDL), and those must be rejected.
  const code = String(g('License') ?? '').toLowerCase()
  if (!ALLOWED_LICENCE.test(code)) return { ok: false, why: `licence "${code || short || 'unknown'}" not allowlisted` }

  if (/trademark|personality/i.test(String(g('Restrictions') ?? ''))) {
    return { ok: false, why: `Restrictions ${g('Restrictions')}` }
  }
  if (NOT_A_PHOTO.test(ii.fileTitle)) return { ok: false, why: 'title suggests a montage, map or satellite image' }
  if (!GOOD_MIME.has(ii.mime)) return { ok: false, why: `mime ${ii.mime}` }
  if (ii.width < 800) return { ok: false, why: `only ${ii.width}px wide` }

  const ratio = ii.width / ii.height
  if (ratio < 0.5 || ratio > 3) return { ok: false, why: `extreme aspect ratio ${ratio.toFixed(2)}` }

  return { ok: true }
}

export function attribution(ii) {
  const g = k => ii.extmetadata?.[k]?.value
  const code = String(g('License') ?? '').toLowerCase()
  const short = g('LicenseShortName') ?? g('UsageTerms') ?? code
  const url = g('LicenseUrl') ?? null
  const page = ii.descriptionurl
  const isPublicDomain = code === 'pd' || code === 'cc0'
  const artistHtml = absolutise(g('Artist')) || 'Unknown author'
  const licenceHtml = url ? `<a href="${url}" rel="license noopener">${short}</a>` : short

  return {
    artist: text(g('Artist')) || 'Unknown author',
    licence: code || short,
    licenceShort: short,
    licenceUrl: url,
    attributionRequired: String(g('AttributionRequired') ?? (isPublicDomain ? 'false' : 'true')) === 'true',
    descriptionUrl: page,
    attributionHtml: isPublicDomain
      ? `${artistHtml}, <a href="${page}">via Wikimedia Commons</a> (${licenceHtml})`
      : `${artistHtml}, ${licenceHtml}, <a href="${page}">via Wikimedia Commons</a>`,
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run scripts/lib/wiki.test.mjs`
Expected: PASS, 16 tests.

- [ ] **Step 5: Implement `scripts/fetch-photos.mjs`**

```js
#!/usr/bin/env node
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { api, vet, attribution, realWidth, stripQuery, sleep, EN, WD, COMMONS, EM_FILTER, UA } from './lib/wiki.mjs'

const OUT = 'public/photos'
const CREDITS = 'src/data/photo-credits.json'
mkdirSync(OUT, { recursive: true })
mkdirSync('src/data', { recursive: true })

/**
 * Landmarks where all three automatic tiers fail or return the wrong thing.
 * Expect five to ten percent of a 180-name list to end up here. Add entries
 * as the contact sheet review surfaces them; never let the script guess.
 */
const OVERRIDES = {
  // 'Mysore Palace': 'File:Mysore Palace WLM 2022 India 14.jpg',
}

function landmarks() {
  const out = []
  for (const f of readdirSync('content/places').filter(f => f.endsWith('.json')).sort()) {
    for (const lm of JSON.parse(readFileSync(join('content/places', f), 'utf8')).landmarks) {
      out.push({ id: lm.id, name: lm.name, query: lm.photoQuery })
    }
  }
  return out
}

/** Tier 1: the article's curated lead image. Batches 50 titles per request. */
async function leadImages(queries) {
  const found = new Map()
  for (let i = 0; i < queries.length; i += 50) {
    const batch = queries.slice(i, i + 50)
    const j = await api(EN, {
      action: 'query', redirects: '1', titles: batch.join('|'),
      prop: 'pageimages|pageprops', piprop: 'original|name', pilimit: '50', ppprop: 'disambiguation',
    })
    const q = j.query ?? {}
    const hop = new Map([...(q.normalized ?? []), ...(q.redirects ?? [])].map(r => [r.from, r.to]))
    const resolve = t => { const seen = new Set(); while (hop.has(t) && !seen.has(t)) { seen.add(t); t = hop.get(t) } return t }
    const byTitle = new Map((q.pages ?? []).map(p => [p.title, p]))
    for (const name of batch) {
      const p = byTitle.get(resolve(name))
      if (p?.pageimage && !(p.pageprops && 'disambiguation' in p.pageprops)) {
        found.set(name, { file: 'File:' + p.pageimage, source: 'pageimages' })
      }
    }
    await sleep(300)
  }
  return found
}

/** Tier 2: Wikidata P18, "image of this thing". */
async function wikidataP18(name) {
  const j = await api(WD, { action: 'wbgetentities', sites: 'enwiki', titles: name, props: 'claims', languages: 'en' })
  for (const e of Object.values(j.entities ?? {})) {
    const f = e.claims?.P18?.[0]?.mainsnak?.datavalue?.value
    if (f) return { file: 'File:' + f, source: 'wikidata-P18' }
  }
  return null
}

/** Tier 3: Commons search. Noisy. Results arrive unordered; index is the rank. */
async function commonsSearch(name) {
  const j = await api(COMMONS, {
    action: 'query', generator: 'search', gsrnamespace: '6', gsrlimit: '10',
    gsrsearch: `filetype:bitmap ${name}`, prop: 'imageinfo', iiprop: 'url|size|mime',
  })
  const pages = (j.query?.pages ?? []).sort((a, b) => a.index - b.index)
  return pages[0] ? { file: pages[0].title, source: 'commons-search' } : null
}

/** Licence and thumbnail, asked of en.wikipedia because it transparently
 *  resolves Commons files and returns full extmetadata from one host. */
async function fileInfo(titles, width = 900) {
  const out = new Map()
  for (let i = 0; i < titles.length; i += 50) {
    const j = await api(EN, {
      action: 'query', titles: titles.slice(i, i + 50).join('|'),
      prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: String(width), iiextmetadatafilter: EM_FILTER,
    })
    for (const p of j.query?.pages ?? []) {
      // en.wikipedia sets missing:true for Commons files with no local
      // description page, yet still returns full imageinfo. Filtering on
      // p.missing silently discards perfectly good files.
      if (!p.imageinfo?.[0]) continue
      out.set(p.title, { ...p.imageinfo[0], imagerepository: p.imagerepository, fileTitle: p.title })
    }
    await sleep(300)
  }
  return out
}

const list = landmarks()
const credits = existsSync(CREDITS) ? JSON.parse(readFileSync(CREDITS, 'utf8')) : {}
const todo = list.filter(l => !credits[l.id] || !existsSync(join(OUT, `${l.id}.jpg`)))
console.log(`${list.length} landmarks, ${todo.length} still to fetch`)

const leads = await leadImages(todo.map(l => l.query))
const failures = []

for (const lm of todo) {
  const candidates = []
  if (OVERRIDES[lm.query]) candidates.push({ file: OVERRIDES[lm.query], source: 'override' })
  const lead = leads.get(lm.query); if (lead) candidates.push(lead)
  const wd = await wikidataP18(lm.query); if (wd) candidates.push(wd)
  const cs = await commonsSearch(lm.query); if (cs) candidates.push(cs)

  const infos = await fileInfo([...new Set(candidates.map(c => c.file))])
  let chosen = null
  for (const c of candidates) {
    const ii = infos.get(c.file.replace(/_/g, ' '))
    if (!ii) continue
    const v = vet(ii)
    if (!v.ok) { console.log(`    reject ${c.file} (${c.source}): ${v.why}`); continue }
    chosen = { ii, source: c.source }
    break
  }

  if (!chosen) {
    failures.push(lm)
    console.log(`  ${lm.id}: NO USABLE IMAGE, add to OVERRIDES`)
    await sleep(1000)
    continue
  }

  const url = stripQuery(chosen.ii.thumburl ?? chosen.ii.url)
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) { failures.push(lm); console.log(`  ${lm.id}: download HTTP ${res.status}`); continue }
  writeFileSync(join(OUT, `${lm.id}.jpg`), Buffer.from(await res.arrayBuffer()))

  credits[lm.id] = {
    file: `photos/${lm.id}.jpg`,
    width: realWidth(url) ?? chosen.ii.width,
    source: chosen.source,
    fileTitle: chosen.ii.fileTitle,
    ...attribution(chosen.ii),
  }
  console.log(`  ${lm.id}: ${chosen.source}, ${credits[lm.id].licenceShort}`)
  await sleep(1000)
}

writeFileSync(CREDITS, JSON.stringify(credits, null, 2))
console.log(`\n${Object.keys(credits).length} photographs with credits`)
if (failures.length) {
  console.log(`${failures.length} need a hand-picked override:`)
  for (const f of failures) console.log(`  '${f.query}': 'File:...',`)
  process.exitCode = 1
}
```

- [ ] **Step 6: Implement `scripts/contact-sheet.mjs`**

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const credits = JSON.parse(readFileSync('src/data/photo-credits.json', 'utf8'))
mkdirSync('review', { recursive: true })

const cards = Object.entries(credits).map(([id, c]) => `
  <figure>
    <img src="../public/${c.file}" loading="lazy" alt="">
    <figcaption>
      <b>${id}</b><br>
      <span class="lic">${c.licenceShort}</span> &middot; ${c.source}<br>
      <a href="${c.descriptionUrl}" target="_blank" rel="noopener">on Commons</a>
    </figcaption>
  </figure>`).join('')

writeFileSync('review/photos.html', `<!doctype html>
<meta charset="utf-8"><title>Photo review</title>
<style>
  body { font: 14px system-ui; margin: 2rem; background: #faf8f4 }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1.2rem }
  figure { margin: 0; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 4px #0002 }
  img { width: 100%; aspect-ratio: 4/3; object-fit: cover; display: block; background: #eee }
  figcaption { padding: .6rem .7rem; line-height: 1.5 }
  .lic { color: #666 }
</style>
<h1>Photo review: ${Object.keys(credits).length} landmarks</h1>
<p>Check every picture actually shows the place it is labelled with. An ISS
photograph of Earth passes every automated check.</p>
<div class="grid">${cards}</div>`)

console.log('open review/photos.html')
```

- [ ] **Step 7: Run the fetcher against the seeded content**

This step can only run after Task 9 has authored the four seed states. Run it then:

Run: `npm run fetch:photos`
Expected: 20 landmarks fetched, each printing its source tier and licence. Any failures are listed as ready-to-paste `OVERRIDES` entries.

- [ ] **Step 8: Human review of the contact sheet (mandatory gate)**

```bash
node scripts/contact-sheet.mjs && open review/photos.html
```

Look at all 20 pictures. Reject anything that is a map, a montage, a person rather than a place, or the wrong country. For each rejection, find a better file on Commons by hand and add it to `OVERRIDES`, then delete that landmark's entry from `src/data/photo-credits.json` and re-run the fetcher.

**This gate is not optional and cannot be automated.** No licence or size check catches a technically valid photograph of the wrong thing.

- [ ] **Step 9: Commit**

```bash
git add scripts/lib/wiki.mjs scripts/lib/wiki.test.mjs scripts/fetch-photos.mjs scripts/contact-sheet.mjs src/data/photo-credits.json public/photos
git commit -m "feat: licensed landmark photographs from Wikimedia

Three-tier candidate chain with a licence allowlist. Handles thumbnail
bucketing (900 silently becomes 960) and the missing:true-with-valid-imageinfo
trap that would otherwise discard good Commons files."
```

---

## Task 8: Animal sounds and ambient beds

**Files:**
- Create: `scripts/lib/loop.py`
- Create: `scripts/fetch-sounds.mjs`
- Create: `content/sounds.json`
- Test: `scripts/lib/loop.test.mjs`
- Generates: `public/audio/sfx/*.m4a`, `public/audio/ambience/*.m4a`, `src/data/sound-credits.json`

**Interfaces:**
- Consumes: `probe`, `toMonoWav`, `toM4a` from `scripts/lib/encode.mjs` (Task 5); `api`, `UA`, `sleep` from `scripts/lib/wiki.mjs` (Task 7).
- Produces:
  - `content/sounds.json` — the hand-curated wanted list: `{ sfx: [{ id, search, note }], ambience: [{ id, search, note }] }`. `id` values must match the `arg` of every `playSfx` cue and the `ambience` field of every place.
  - `src/data/sound-credits.json`, keyed by sound id, same attribution shape as photos plus `{ file, seconds }`.
  - `scripts/lib/loop.py` — `python3 scripts/lib/loop.py in.wav out.wav <seconds> <crossfade>`.

**Verified constraints:**
- Freesound *previews* download with **no authentication**; only the *search* call needs a free token from `freesound.org/apiv2/apply/`. Preview quality is 128 kbps, above the 56 kbps delivery target, so original files buy nothing.
- Commons audio search is polluted with Wiktionary pronunciations — searching "rhinoceros" returns humans saying the word. Filter titles matching `^(de|en|fr|nl|ru|es|it)-` and `^ll-q`.
- Commons has real Indian field recordings for roughly 8 to 10 of the animals (Indian roller, great hornbill, peacock, house sparrow, hoolock gibbon) and effectively nothing for Nilgiri tahr, Gangetic dolphin, sarus crane or blackbuck.
- Loops need an **equal-power** crossfade (gains `sqrt(t)` and `sqrt(1-t)`). A linear fade dips about 3 dB in the middle on uncorrelated material. Measured effect: head-to-tail level mismatch improved from -16.72 dB to -0.11 dB.
- Normalise beds to about -26 dBFS RMS with a -3 dBFS peak ceiling, and one-shots to -1 dBFS peak. Raw source ambience is wildly inconsistent; one untreated river bed measured -50 dBFS and was inaudible.
- Use a cumsum moving average, not `np.convolve`, for envelope work. `np.convolve` is O(n*m) and hung for over 120 seconds on a 3.3M-sample file; the cumsum version ran in 0.57 seconds.

- [ ] **Step 1: Write the failing test for the loop maths**

`scripts/lib/loop.test.mjs` drives the Python through the shell so the real script is what is tested.

```js
import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probe } from './encode.mjs'

const dir = mkdtempSync(join(tmpdir(), 'loop-'))
const source = join(dir, 'src.wav')

beforeAll(() => {
  // A 20-second tone that fades in and out: the worst case for a naive
  // hard-cut loop, because the head and tail levels differ enormously.
  execFileSync('python3', ['-c', `
import numpy as np, wave
sr, n = 44100, 44100*20
t = np.arange(n)/sr
env = np.minimum(t/3, np.minimum(1, (20-t)/3))
x = (0.4*np.sin(2*np.pi*220*t)*env*32767).astype('<i2')
w = wave.open(${JSON.stringify(source)}, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
w.writeframes(x.tobytes()); w.close()
`])
})

describe('loop.py', () => {
  it('produces a file of exactly the requested length', () => {
    const out = join(dir, 'loop.wav')
    execFileSync('python3', ['scripts/lib/loop.py', source, out, '12', '3'])
    expect(existsSync(out)).toBe(true)
    expect(probe(out).duration).toBeCloseTo(12, 1)
  })

  it('matches the head and tail level, which is what stops the loop clicking', () => {
    const out = join(dir, 'loop2.wav')
    execFileSync('python3', ['scripts/lib/loop.py', source, out, '12', '3'])
    const mismatchDb = Number(execFileSync('python3', ['-c', `
import numpy as np, wave, sys
w = wave.open(${JSON.stringify(out)}); a = np.frombuffer(w.readframes(w.getnframes()), '<i2').astype(np.float32)
n = 4410
rms = lambda v: float(np.sqrt(np.mean(v**2)) + 1e-9)
print(abs(20*np.log10(rms(a[:n])/rms(a[-n:]))))
`], { encoding: 'utf8' }))
    // The naive hard cut on this fixture measures about 16.7 dB of mismatch.
    expect(mismatchDb).toBeLessThan(1.5)
  })

  it('normalises a quiet source up to the target RMS', () => {
    const quiet = join(dir, 'quiet.wav')
    execFileSync('python3', ['-c', `
import numpy as np, wave
sr, n = 44100, 44100*20
t = np.arange(n)/sr
x = (0.0005*np.sin(2*np.pi*300*t)*32767).astype('<i2')
w = wave.open(${JSON.stringify(quiet)}, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
w.writeframes(x.tobytes()); w.close()
`])
    const out = join(dir, 'loud.wav')
    execFileSync('python3', ['scripts/lib/loop.py', quiet, out, '10', '2'])
    const rmsDb = Number(execFileSync('python3', ['-c', `
import numpy as np, wave
w = wave.open(${JSON.stringify(out)}); a = np.frombuffer(w.readframes(w.getnframes()), '<i2').astype(np.float32)/32768
print(20*np.log10(float(np.sqrt(np.mean(a**2)))+1e-12))
`], { encoding: 'utf8' }))
    expect(rmsDb).toBeGreaterThan(-30)
    expect(rmsDb).toBeLessThan(-22)
  })

  it('refuses a source shorter than the requested loop rather than padding silence', () => {
    expect(() => execFileSync('python3', ['scripts/lib/loop.py', source, join(dir, 'x.wav'), '60', '3'],
      { stdio: 'pipe' })).toThrow()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run scripts/lib/loop.test.mjs`
Expected: FAIL, `scripts/lib/loop.py` does not exist.

- [ ] **Step 3: Implement `scripts/lib/loop.py`**

```python
#!/usr/bin/env python3
"""Turn a field recording into a seamless loop of a given length.

ffmpeg and sox are not installed and pydub cannot be used (Python 3.13
removed the audioop module it depends on). numpy plus the wave module does
the whole job.

    python3 scripts/lib/loop.py in.wav out.wav <seconds> <crossfade-seconds>

Input must be 16-bit mono PCM; run it through afconvert first.
"""
import sys, wave
import numpy as np

TARGET_RMS_DBFS = -26.0
PEAK_CEILING_DBFS = -3.0


def read(path):
    with wave.open(path, "rb") as w:
        if w.getsampwidth() != 2 or w.getnchannels() != 1:
            sys.exit(f"{path}: expected 16-bit mono PCM; convert with afconvert first")
        sr = w.getframerate()
        a = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(np.float32) / 32768.0
    return a, sr


def write(path, a, sr):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((np.clip(a, -1.0, 1.0) * 32767).astype("<i2").tobytes())


def normalise(a):
    """Match a common loudness, then pull the peak back under the ceiling.
    Raw ambience arrives anywhere from -50 to -12 dBFS; without this the mix
    is unusable."""
    rms = float(np.sqrt(np.mean(a ** 2))) + 1e-12
    a = a * (10 ** (TARGET_RMS_DBFS / 20) / rms)
    peak = float(np.max(np.abs(a))) + 1e-12
    ceiling = 10 ** (PEAK_CEILING_DBFS / 20)
    if peak > ceiling:
        a = a * (ceiling / peak)
    return a


def seamless(a, sr, seconds, fade):
    """Equal-power crossfade of the tail over the head.

    Gains are sqrt(t) and sqrt(1-t) so that fade_in^2 + fade_out^2 == 1. A
    linear fade dips about 3 dB in the middle on uncorrelated material, which
    is audible as a dip at the loop point.
    """
    want = int(round(seconds * sr))
    n = int(round(fade * sr))
    need = want + n
    if len(a) < need:
        sys.exit(f"source is {len(a)/sr:.1f}s, need at least {need/sr:.1f}s "
                 f"for a {seconds}s loop with a {fade}s crossfade")
    seg = a[:need]
    body, tail = seg[:-n], seg[-n:]
    t = np.linspace(0.0, 1.0, n, dtype=np.float32)
    out = body.copy()
    out[:n] = body[:n] * np.sqrt(t) + tail * np.sqrt(1.0 - t)
    return out


def main():
    src, dst, seconds, fade = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
    a, sr = read(src)
    out = normalise(seamless(a, sr, seconds, fade))
    write(dst, out, sr)
    rms = 20 * np.log10(float(np.sqrt(np.mean(out ** 2))) + 1e-12)
    print(f"{dst}: {len(out)/sr:.2f}s, rms {rms:.1f} dBFS")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run scripts/lib/loop.test.mjs`
Expected: PASS, 4 tests. The second test is the important one: it proves the crossfade removes the level jump that makes loops tick.

- [ ] **Step 5: Write `content/sounds.json`**

The wanted list. `id` values here are the contract with the content cues, so they must match every `playSfx` `arg` and every place's `ambience` value.

```json
{
  "sfx": [
    { "id": "tiger-growl",    "search": "tiger growl",              "note": "national animal, Grand Tour beat 7" },
    { "id": "peacock-call",   "search": "peacock call",             "note": "national bird, Mor himself" },
    { "id": "elephant",       "search": "elephant trumpet",         "note": "Kerala, Assam" },
    { "id": "lion-roar",      "search": "lion roar",                "note": "Gujarat, Asiatic lion" },
    { "id": "camel",          "search": "camel grunt",              "note": "Rajasthan" },
    { "id": "rhino",          "search": "rhinoceros snort",         "note": "Assam" },
    { "id": "hornbill",       "search": "great hornbill",           "note": "Arunachal, Kerala; Commons has a real Indian recording" },
    { "id": "indian-roller",  "search": "Indian roller call",       "note": "Odisha, Karnataka, Telangana; real Indian recording" },
    { "id": "gibbon",         "search": "hoolock gibbon",           "note": "north-east" },
    { "id": "sparrow",        "search": "house sparrow chirp",      "note": "Delhi" },
    { "id": "temple-bell",    "search": "temple bell single",       "note": "used on temple landmarks" },
    { "id": "water-ripple",   "search": "water drop ripple",        "note": "lotus bloom, Grand Tour beat 9" },
    { "id": "chime-correct",  "search": "gentle chime",             "note": "passport stamp earned" },
    { "id": "whoosh-soft",    "search": "soft whoosh",              "note": "state opening animation" }
  ],
  "ambience": [
    { "id": "desert",   "search": "desert wind",           "seconds": 20, "note": "Rajasthan" },
    { "id": "ocean",    "search": "ocean waves beach",     "seconds": 20, "note": "Odisha, Goa, Tamil Nadu" },
    { "id": "forest",   "search": "forest birdsong",       "seconds": 20, "note": "Kerala, north-east" },
    { "id": "mountain", "search": "mountain wind",         "seconds": 20, "note": "Himachal, Ladakh, Sikkim" },
    { "id": "river",    "search": "river stream flowing",  "seconds": 20, "note": "Bihar, UP, West Bengal" },
    { "id": "city",     "search": "city street ambience",  "seconds": 20, "note": "Delhi, Mumbai" },
    { "id": "plains",   "search": "field insects wind",    "seconds": 20, "note": "Punjab, Haryana, MP" },
    { "id": "temple",   "search": "temple bells chanting", "seconds": 20, "note": "Odisha, Tamil Nadu" },
    { "id": "island",   "search": "tropical beach palms",  "seconds": 20, "note": "Andamans, Lakshadweep" }
  ]
}
```

- [ ] **Step 6: Implement `scripts/fetch-sounds.mjs`**

```js
#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { api, sleep, COMMONS, EM_FILTER, UA } from './lib/wiki.mjs'
import { toMonoWav, toM4a } from './lib/encode.mjs'

const want = JSON.parse(readFileSync('content/sounds.json', 'utf8'))
const CREDITS = 'src/data/sound-credits.json'
const credits = existsSync(CREDITS) ? JSON.parse(readFileSync(CREDITS, 'utf8')) : {}
const tmp = mkdtempSync(join(tmpdir(), 'sfx-'))
mkdirSync('public/audio/sfx', { recursive: true })
mkdirSync('public/audio/ambience', { recursive: true })
mkdirSync('src/data', { recursive: true })

const ALLOWED = /^(cc0|public domain|cc by(-sa)? \d(\.\d)?)$/i
/** Commons audio search returns Wiktionary pronunciations: humans saying the
 *  word, not the animal. Without this filter the site ships people talking. */
const PRONUNCIATION = /^(de|en|fr|nl|ru|es|it|pt|pl)-|^ll-q\d+/i

async function commonsAudio(term) {
  const j = await api(COMMONS, {
    action: 'query', generator: 'search', gsrnamespace: '6', gsrlimit: '12',
    gsrsearch: `filetype:audio ${term}`,
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiextmetadatafilter: EM_FILTER,
  })
  const pages = (j.query?.pages ?? []).sort((a, b) => a.index - b.index)
  for (const p of pages) {
    const name = p.title.replace(/^File:/, '')
    if (PRONUNCIATION.test(name)) continue
    const ii = p.imageinfo?.[0]; if (!ii) continue
    const licence = ii.extmetadata?.LicenseShortName?.value ?? ''
    if (!ALLOWED.test(licence.trim())) continue
    return {
      url: ii.url.split('?')[0], fileTitle: p.title, licenceShort: licence,
      artist: (ii.extmetadata?.Artist?.value ?? 'Unknown').replace(/<[^>]*>/g, '').trim(),
      descriptionUrl: ii.descriptionurl,
    }
  }
  return null
}

async function grab(kind, item) {
  if (credits[item.id]) { console.log(`  ${item.id}: already have it`); return }
  const hit = await commonsAudio(item.search)
  await sleep(1000)
  if (!hit) { console.log(`  ${item.id}: NOT FOUND for "${item.search}"`); return }

  const res = await fetch(hit.url, { headers: { 'User-Agent': UA } })
  if (!res.ok) { console.log(`  ${item.id}: download HTTP ${res.status}`); return }
  const raw = join(tmp, `${item.id}.src`)
  writeFileSync(raw, Buffer.from(await res.arrayBuffer()))

  const wav = join(tmp, `${item.id}.wav`)
  toMonoWav(raw, wav)

  const dir = kind === 'sfx' ? 'public/audio/sfx' : 'public/audio/ambience'
  const out = join(dir, `${item.id}.m4a`)

  if (kind === 'ambience') {
    const looped = join(tmp, `${item.id}.loop.wav`)
    execFileSync('python3', ['scripts/lib/loop.py', wav, looped, String(item.seconds ?? 20), '3'],
      { stdio: 'inherit' })
    toM4a(looped, out, 56000)
  } else {
    toM4a(wav, out, 64000)
  }

  credits[item.id] = {
    file: `${kind === 'sfx' ? 'audio/sfx' : 'audio/ambience'}/${item.id}.m4a`,
    kind, ...hit,
  }
  console.log(`  ${item.id}: ${hit.licenceShort} — ${hit.fileTitle}`)
}

console.log('sound effects')
for (const s of want.sfx) await grab('sfx', s)
console.log('ambient beds')
for (const a of want.ambience) await grab('ambience', a)

writeFileSync(CREDITS, JSON.stringify(credits, null, 2))

const missing = [...want.sfx, ...want.ambience].filter(i => !credits[i.id])
console.log(`\n${Object.keys(credits).length} sounds`)
if (missing.length) {
  console.log(`${missing.length} not found on Commons. Get a free Freesound token at`)
  console.log(`https://freesound.org/apiv2/apply/ and hand-pick these:`)
  for (const m of missing) console.log(`  ${m.id}  (${m.search})`)
  process.exitCode = 1
}
```

- [ ] **Step 7: Run it**

Run: `npm run fetch:sounds`
Expected: most sounds fetched with a printed licence; a list of any not found on Commons.

Commons is expected to cover roughly 8 to 10 of the animals and has **no** verified coverage for desert wind, temple bells with chanting or Indian street ambience. For anything missing, get a free Freesound token and hand-pick, downloading `previews.preview-hq-mp3` (no authentication needed) into `build/sounds/` and running it through the same `toMonoWav` and `loop.py` path.

- [ ] **Step 8: Listen to every single one (mandatory gate)**

```bash
for f in public/audio/sfx/*.m4a public/audio/ambience/*.m4a; do echo "$f"; afplay "$f"; done
```

Freesound and Commons are user-uploaded and inconsistently labelled. A clip tagged "tiger" may be a zoo recording with visitors talking, the wrong species, or African savanna rather than Indian forest. For a site teaching a child facts about India, the wrong species is a correctness bug. **Do not automate this step.**

Also confirm each ambient bed loops without a tick, by playing it twice in a row.

- [ ] **Step 9: Commit**

```bash
git add scripts/lib/loop.py scripts/lib/loop.test.mjs scripts/fetch-sounds.mjs content/sounds.json src/data/sound-credits.json public/audio/sfx public/audio/ambience
git commit -m "feat: animal one-shots and seamless ambient beds

Equal-power crossfade in numpy, since ffmpeg is unavailable; measured
head-to-tail mismatch drops from -16.7 dB to -0.1 dB. Commons search is
filtered against Wiktionary pronunciation files."
```

---

## Task 9: Seed content for four places

**Files:**
- Create: `content/places/rajasthan.json`, `content/places/odisha.json`, `content/places/kerala.json`, `content/places/delhi.json`
- Create: `content/tour.json`
- Create: `content/ui.json`

**Interfaces:**
- Consumes: the schema from Task 2, sound ids from Task 8's `content/sounds.json`, and place slugs from Task 3's `src/data/geo.json`.
- Produces: the first real content, and the input to every pipeline above. Plan 2 builds its screens against exactly these four places.

**Writing rules, applied to every line:**
- One idea per sentence. 45 to 70 words per clip.
- Explain the unfamiliar word in the same breath: "a desert, which is a huge place made of sand where it hardly ever rains".
- No dates, no politics, no violence, no superlatives a child cannot check.
- Plain text only. No markup of any kind, because it would break the alignment.
- Stay inside the per-kind character budget; `npm run validate` enforces it.

- [ ] **Step 1: Write `content/tour.json`**

Fourteen beats matching the storyboard in the design spec. Cue word indices must be counted against the actual text, so write the text first and then count. Example beat, with the cue landing on the word "tiger":

```json
{
  "beats": [
    {
      "id": "tour.01",
      "kind": "tour",
      "text": "Namaste! I am Mor, and I am a peacock. Come with me. I want to show you my country, India.",
      "cues": [{ "word": 8, "do": "playSfx", "arg": "peacock-call" }]
    },
    {
      "id": "tour.03",
      "kind": "tour",
      "text": "India is made of twenty-eight states. A state is like a big piece of the country, and each one has its own food, its own festivals, and its own way of saying hello.",
      "cues": [{ "word": 4, "do": "highlightAllStates" }, { "word": 5, "do": "countTo", "arg": "28" }]
    },
    {
      "id": "tour.07",
      "kind": "tour",
      "text": "Our national animal is the tiger. He is orange with black stripes, and he walks so quietly that you would never hear him coming.",
      "cues": [
        { "word": 4, "do": "revealSymbol", "arg": "tiger" },
        { "word": 5, "do": "playSfx", "arg": "tiger-growl" }
      ]
    }
  ]
}
```

Write all fourteen. Beat 5 (New Delhi) needs `{ "do": "zoomTo", "arg": "delhi" }`; beat 6 needs `unfurlFlag`; beat 10 needs `{ "do": "traceRiver", "arg": "ganga" }`; beat 11 needs `raiseMountains`.

- [ ] **Step 2: Write `content/ui.json`**

Short interface lines, 60 characters each: "Tap a state to visit it.", "Well done! You have a new stamp.", "Shall we hear that again?", "Let us go back to India.", plus Mor's encouragements.

- [ ] **Step 3: Write `content/places/rajasthan.json`**

Full worked example; the other three follow the same shape.

```json
{
  "id": "rajasthan",
  "name": "Rajasthan",
  "type": "state",
  "capital": "Jaipur",
  "ambience": "desert",
  "intro": {
    "id": "rajasthan.intro",
    "kind": "intro",
    "text": "This is Rajasthan, the biggest state in all of India. Most of it is desert. A desert is a huge place made of sand, where it hardly ever rains and the sun is very, very hot. Its main city is called Jaipur, and Jaipur is painted pink.",
    "cues": [
      { "word": 20, "do": "revealSymbol", "arg": "dune" },
      { "word": 44, "do": "highlightState", "arg": "rajasthan" }
    ]
  },
  "card": {
    "animal": {
      "id": "rajasthan.card.animal",
      "kind": "card",
      "text": "The camel lives in Rajasthan. He carries his own water inside the big hump on his back, so he can walk across the sand for days.",
      "sfx": "camel"
    },
    "food": {
      "id": "rajasthan.card.food",
      "kind": "card",
      "text": "People here eat dal baati churma. Baati is a crunchy ball of bread. You crack it open with your hands and dip it in warm buttery dal."
    },
    "festival": {
      "id": "rajasthan.card.festival",
      "kind": "card",
      "text": "At the Pushkar fair, thousands of camels come to one town. They are washed, brushed, and even given a haircut before the camel race."
    },
    "hello": {
      "id": "rajasthan.card.hello",
      "kind": "card",
      "text": "In Rajasthan people say Khamma Ghani. It means hello, and it also means I wish you a very long and happy life.",
      "script": "खम्मा घणी"
    }
  },
  "landmarks": [
    {
      "id": "rajasthan.thar",
      "name": "The Thar Desert",
      "photoQuery": "Thar Desert",
      "scene": "dunes",
      "line": {
        "id": "rajasthan.thar.line",
        "kind": "landmark",
        "text": "These hills are not made of mud or rock. They are made of sand, and the wind moves them a little bit every single day. So this desert is never quite the same shape twice."
      }
    },
    {
      "id": "rajasthan.hawa-mahal",
      "name": "Hawa Mahal",
      "photoQuery": "Hawa Mahal",
      "scene": "hawa-mahal",
      "line": {
        "id": "rajasthan.hawa-mahal.line",
        "kind": "landmark",
        "text": "Count the windows. There are nine hundred and fifty-three of them. The wind blows through all of them at once, which is why this palace is called Hawa Mahal, the palace of the wind."
      }
    },
    {
      "id": "rajasthan.amber-fort",
      "name": "Amber Fort",
      "photoQuery": "Amer Fort",
      "scene": "fort",
      "line": {
        "id": "rajasthan.amber-fort.line",
        "kind": "landmark",
        "text": "This fort sits high on a hill so the people inside could see anyone coming from far away. Inside there is a room where one small candle turns into a thousand tiny lights."
      }
    },
    {
      "id": "rajasthan.chand-baori",
      "name": "Chand Baori",
      "photoQuery": "Chand Baori",
      "scene": "stepwell",
      "line": {
        "id": "rajasthan.chand-baori.line",
        "kind": "landmark",
        "text": "This is a well, but instead of a bucket it has stairs. Three thousand five hundred steps go down and down to the cool water at the bottom. In the desert, water is the most precious thing there is."
      }
    },
    {
      "id": "rajasthan.ranthambore",
      "name": "Ranthambore",
      "photoQuery": "Ranthambore National Park",
      "scene": "forest-fort",
      "line": {
        "id": "rajasthan.ranthambore.line",
        "kind": "landmark",
        "text": "Real tigers live here, in a forest with an old broken fort inside it. Tigers like to rest in the shade near the water. If you are very lucky and very quiet, you might see one.",
        "cues": [{ "word": 1, "do": "playSfx", "arg": "tiger-growl" }]
      }
    }
  ]
}
```

- [ ] **Step 4: Write the remaining three**

- **Odisha** — `ambience: "ocean"`, capital Bhubaneswar. Landmarks: Konark Sun Temple (the stone chariot wheel that tells the time), Puri Jagannath Temple, Chilika Lake (dolphins and flamingos), Puri Beach, Udayagiri Caves. Animal: the Indian roller. Food: pakhala bhata. Festival: Rath Yatra. Hello: Namaskar, `ନମସ୍କାର`.
- **Kerala** — `ambience: "forest"`, capital Thiruvananthapuram. Landmarks: the backwaters, Munnar tea hills, Athirappilly Falls, Fort Kochi Chinese fishing nets, Periyar. Animal: the elephant. Food: sadya on a banana leaf. Festival: Onam. Hello: Namaskaram, `നമസ്കാരം`.
- **Delhi** — `type: "ut"`, `ambience: "city"`, capital New Delhi. Landmarks: India Gate, Qutub Minar, Red Fort, Lotus Temple, Humayun's Tomb. Animal: the house sparrow. Food: chole bhature. Festival: Republic Day parade. Hello: Namaste, `नमस्ते`.

- [ ] **Step 5: Validate**

Run: `npm run validate`
Expected: 4 places, 40 place lines plus 14 tour beats plus the interface
lines, a character total well under the target, and `content OK`. If the
character count is missing or zero, the validator is not reading the files.

Fix every reported problem. Common ones: a cue index past the last word, a line over its budget, a duplicate id.

- [ ] **Step 6: Check the cue indices actually point at the intended words**

An index inside range but on the wrong word is invisible to the validator and produces a tiger that growls two words late. Print them:

```bash
node -e '
const fs=require("fs");
for (const f of fs.readdirSync("content/places")) {
  const p=JSON.parse(fs.readFileSync("content/places/"+f,"utf8"));
  const lines=[p.intro,...Object.values(p.card),...p.landmarks.map(l=>l.line)];
  for (const l of lines) for (const c of (l.cues??[])) {
    const w=l.text.trim().split(/\s+/);
    console.log(`${l.id}  word ${c.word} = "${w[c.word]}"  ->  ${c.do} ${c.arg??""}`);
  }
}'
```

Read every line of the output. `word 5 = "tiger." -> playSfx tiger-growl` is right. `word 5 = "the" -> playSfx tiger-growl` is not.

- [ ] **Step 7: Generate the draft audio for all four**

Run: `npm run tts:draft`
Expected: roughly 70 clips and 15 to 20 minutes of narration.

- [ ] **Step 8: Listen to one full state**

```bash
for f in public/audio/en/rajasthan.*.m4a; do echo "$f"; afplay "$f"; done
```

Listen as a parent, not as an engineer. Is any sentence too long to follow? Does any word need explaining? Is any fact wrong? Fix the JSON and re-run `npm run tts:draft` — only changed lines re-render.

- [ ] **Step 9: Fact-check every claim (mandatory gate)**

The spec's success criteria include that a child learns nothing false. Go
through all four files and confirm each checkable claim against a reliable
source. In the Rajasthan example above that means: Rajasthan is India's
largest state by area; Jaipur is the capital; Hawa Mahal has 953 windows;
Chand Baori has about 3,500 steps; Amer Fort's Sheesh Mahal is the mirror
room; Pushkar holds a camel fair; Khamma Ghani is a Rajasthani greeting.

Write the outcome into `docs/fact-check.md` as one line per claim with its
source, so the same claim is never re-checked and Plan 3 has a template:

```markdown
| Line id | Claim | Source | Checked |
|---|---|---|---|
| rajasthan.hawa-mahal.line | 953 windows | Britannica, ASI listing | 2026-08-21 |
```

Anything you cannot confirm gets rewritten until it is true, or removed. A
vague sentence a child enjoys beats a precise one that is wrong.

- [ ] **Step 10: Fetch photographs and sounds for the seed content**

```bash
npm run fetch:photos && node scripts/contact-sheet.mjs && open review/photos.html
npm run fetch:sounds
```

Complete the human review gates from Task 7 Step 8 and Task 8 Step 8 before committing.

- [ ] **Step 11: Run everything**

Run: `npm run validate && npm run test && npm run build`
Expected: content OK, all tests pass, build succeeds.

- [ ] **Step 12: Commit**

```bash
git add content src/data public docs/fact-check.md
git commit -m "content: Rajasthan, Odisha, Kerala and Delhi, plus the Grand Tour

Four complete places with narration, cues, photographs and sounds. This is
the template every remaining state is written against."
```

---

## Definition of done for Plan 1

- [ ] `npm run validate && npm run test && npm run build` all pass.
- [ ] `src/data/geo.json` has 36 places, and the rendered preview looks like India with the official boundary.
- [ ] `src/data/timings.json` has a clip, word timings and resolved cue times for every line of four complete places, the Grand Tour and the interface.
- [ ] `public/photos/` has 20 reviewed photographs and `src/data/photo-credits.json` credits every one.
- [ ] `public/audio/sfx/` and `public/audio/ambience/` have listened-to sounds, and every `playSfx` cue argument and every `ambience` value resolves to a real file.
- [ ] Every human gate has actually been done by a human: the map preview, the photo contact sheet, the sound listen-through, one full state heard end to end, and the fact check.
- [ ] `docs/fact-check.md` records a source for every checkable claim in the four seed places.

---

## What comes next

**Plan 2 — the application.** The React app that consumes everything above: the Web Audio narration engine (a module-scoped singleton outside React, driven by `AudioContext.currentTime` in a rAF loop with a monotonic cue cursor), read-along highlighting via `useSyncExternalStore`, the India map with transform-based zoom, the Grand Tour sequencer, the state and landmark screens, the illustration kit, Mor, the passport, the child controls, and the first deployment to GitHub Pages.

Two things from the research must be carried into Plan 2 and are easy to forget:
- Set `navigator.audioSession.type = 'playback'` inside the unlock gesture, feature-detected. Without it, an iPad with the mute switch on plays **nothing** through Web Audio, which is the highest-severity user-facing failure in the whole design.
- Evict decoded audio buffers for all but the current and next place. Decoded PCM is roughly 24 times the compressed size, and holding several states' worth crashes an older iPad with no catchable error.
- Render the attribution that `src/data/photo-credits.json` and `src/data/sound-credits.json` carry. Every CC BY and CC BY-SA file has `attributionRequired: true`, and the credit must sit near the image rather than only on a colophon page. Show it under the photo when the peek button is open. Display the photographs unmodified and frame them with CSS `object-fit`; cropping or overlaying pixels creates an adaptation, which for CC BY-SA must itself be released under the same licence.

**Plan 3 — the full country and the final voice.** The remaining 32 states and union territories in batches, a fact-verification pass over every claim, the ElevenLabs render, and launch.
