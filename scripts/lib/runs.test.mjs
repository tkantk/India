import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectRuns, flattenRuns, legacyKey, chainedKey, keysForRun, selectRuns, planRun, planFromCache,
} from './runs.mjs'

const line = (id, text) => ({ id, kind: 'card', text })

describe('collectRuns: the grouping is derived from the content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runs-content-'))
  const placesDir = join(dir, 'places')
  mkdirSync(placesDir)
  const tourPath = join(dir, 'tour.json')
  const uiPath = join(dir, 'ui.json')

  writeFileSync(join(placesDir, 'aaastate.json'), JSON.stringify({
    id: 'aaastate', name: 'Aaastate', type: 'state', capital: 'Aaapur', ambience: 'plains',
    intro: line('aaastate.intro', 'Aaastate welcomes you.'),
    card: {
      animal: line('aaastate.card.animal', 'An animal.'),
      food: line('aaastate.card.food', 'Food.'),
      festival: line('aaastate.card.festival', 'A festival.'),
      hello: line('aaastate.card.hello', 'Hello.'),
    },
    landmarks: Array.from({ length: 5 }, (_, i) => ({
      id: `aaastate.lm${i}`, name: `Spot ${i}`, photoQuery: `Spot ${i}`, scene: 'plains',
      line: line(`aaastate.lm${i}.line`, `Spot ${i}.`),
    })),
  }))
  writeFileSync(tourPath, JSON.stringify({
    beats: [line('tour.01', 'Beat one.'), line('tour.02', 'Beat two.'), line('tour.03', 'Beat three.')],
  }))
  writeFileSync(uiPath, JSON.stringify({ lines: [line('ui.play', 'Play.'), line('ui.pause', 'Pause.')] }))

  const runs = collectRuns({ placesDir, tourPath, uiPath })

  it('puts every place line — intro, card, landmark — in its own run of one', () => {
    const placeRuns = runs.filter((r) => r[0].id.startsWith('aaastate'))
    expect(placeRuns).toHaveLength(10) // intro + 4 card + 5 landmarks
    for (const run of placeRuns) expect(run).toHaveLength(1)
  })

  it("puts every tour beat in ONE run, in the content's own order", () => {
    const tourRun = runs.find((r) => r[0].id === 'tour.01')
    expect(tourRun.map((l) => l.id)).toEqual(['tour.01', 'tour.02', 'tour.03'])
  })

  it('puts every ui line in its own run of one', () => {
    const uiRuns = runs.filter((r) => r[0].id.startsWith('ui.'))
    expect(uiRuns).toHaveLength(2)
    for (const run of uiRuns) expect(run).toHaveLength(1)
  })

  it('tolerates a tree with no tour.json or ui.json at all', () => {
    const bare = collectRuns({ placesDir, tourPath: join(dir, 'nope.json'), uiPath: join(dir, 'nope2.json') })
    expect(bare.every((r) => r.length === 1)).toBe(true)
  })

  it('flattenRuns recovers the old collectLines() order: intro, cards, landmarks, then tour, then ui', () => {
    const ids = flattenRuns(runs).map((l) => l.id)
    expect(ids.slice(0, 10)).toEqual([
      'aaastate.intro', 'aaastate.card.animal', 'aaastate.card.food',
      'aaastate.card.festival', 'aaastate.card.hello',
      'aaastate.lm0.line', 'aaastate.lm1.line', 'aaastate.lm2.line', 'aaastate.lm3.line', 'aaastate.lm4.line',
    ])
    expect(ids.slice(10, 13)).toEqual(['tour.01', 'tour.02', 'tour.03'])
    expect(ids.slice(13)).toEqual(['ui.play', 'ui.pause'])
  })
})

describe('collectRuns against the real, shipped content', () => {
  it("content/tour.json's 14 beats are the one and only multi-line run", () => {
    const runs = collectRuns()
    const multi = runs.filter((r) => r.length > 1)
    expect(multi).toHaveLength(1)
    expect(multi[0]).toHaveLength(14)
    expect(multi[0][0].id).toBe('tour.01')
    expect(multi[0][13].id).toBe('tour.14')
  })

  it('every other run — every place line and every ui line — is a run of one', () => {
    const runs = collectRuns()
    const singles = runs.filter((r) => r.length === 1)
    // Today's handful of places * 10 lines each + a few ui lines; loosely
    // bounded so this does not need updating every time a place is added.
    expect(singles.length).toBeGreaterThan(30)
    for (const run of singles) expect(run).toHaveLength(1)
  })
})

describe('legacyKey: unchanged since before this task', () => {
  it('is exactly sha256(`${signature} ${text}`), truncated to 16 hex chars', () => {
    const signature = 'say:Tara:130'
    const text = 'Hello world.'
    const expected = createHash('sha256').update(`${signature} ${text}`).digest('hex').slice(0, 16)
    expect(legacyKey(signature, text)).toBe(expected)
  })

  // Locks the exact value, not just "matches its own formula" — this is the
  // key ~9,185 characters of already-paid-for audio are cached under, and a
  // refactor that quietly changed the hash shape would turn every one of
  // them into a cache miss (and a re-bill) without a single failing
  // assertion above catching it.
  it('reproduces a fixed, hand-computed value — a regression lock on the real cache format', () => {
    expect(legacyKey('say:Tara:130', 'Hello world.')).toBe('f7ebe05d077e6518')
  })
})

describe('keysForRun: a run of one uses legacyKey, never the chain format', () => {
  it('matches legacyKey exactly for a single-line run', () => {
    const run = [line('solo.card.animal', 'The tiger lives here.')]
    expect(keysForRun(run, 'sig')).toEqual([legacyKey('sig', run[0].text)])
  })
})

describe('chainedKey / keysForRun: the hash chain', () => {
  const sig = 'elevenlabs:v1'
  const run = [
    line('tour.01', 'Beat one.'),
    line('tour.02', 'Beat two.'),
    line('tour.03', 'Beat three.'),
    line('tour.04', 'Beat four.'),
  ]

  it('the first key has no previous key and no signature leak from the run before it', () => {
    const keys = keysForRun(run, sig)
    expect(keys[0]).toBe(chainedKey(sig, 'Beat one.', 'Beat two.', undefined))
  })

  it('each later key folds in its own text, the next text, and the key before it', () => {
    const keys = keysForRun(run, sig)
    expect(keys[1]).toBe(chainedKey(sig, 'Beat two.', 'Beat three.', keys[0]))
    expect(keys[2]).toBe(chainedKey(sig, 'Beat three.', 'Beat four.', keys[1]))
  })

  it("the last key's next text is empty — there is no line after it", () => {
    const keys = keysForRun(run, sig)
    expect(keys[3]).toBe(chainedKey(sig, 'Beat four.', undefined, keys[2]))
  })

  it('editing only the LAST beat changes only its own key and the key of the beat immediately before it', () => {
    const before = keysForRun(run, sig)
    const edited = run.map((l, i) => (i === 3 ? { ...l, text: 'Beat four, rewritten.' } : l))
    const after = keysForRun(edited, sig)
    expect(after[0]).toBe(before[0]) // untouched: own text and next-text both unchanged
    expect(after[1]).toBe(before[1]) // untouched: own text and next-text (beat 3's) both unchanged
    expect(after[2]).not.toBe(before[2]) // its next_text (beat 4's) changed
    expect(after[3]).not.toBe(before[3]) // its own text changed
  })

  it('editing the FIRST beat cascades through the whole run (every key depends on the one before it)', () => {
    const before = keysForRun(run, sig)
    const edited = run.map((l, i) => (i === 0 ? { ...l, text: 'Beat one, rewritten.' } : l))
    const after = keysForRun(edited, sig)
    expect(after.every((k, i) => k !== before[i])).toBe(true)
  })

  it('the chained format never collides with legacyKey, so introducing it is a one-time full-run miss', () => {
    const keys = keysForRun(run, sig)
    for (const [i, l] of run.entries()) expect(keys[i]).not.toBe(legacyKey(sig, l.text))
  })
})

describe('selectRuns: --only widens to the whole run, or errors', () => {
  const place = [line('rajasthan.intro', 'x')]
  const tour = [line('tour.01', 'a'), line('tour.02', 'b'), line('tour.03', 'c')]
  const runs = [place, tour]

  it('with no --only, every run passes through untouched', () => {
    expect(selectRuns(runs, undefined)).toBe(runs)
  })

  it('matching one member of a run selects every member of that run, not just the match', () => {
    const selected = selectRuns(runs, 'tour.02')
    expect(selected).toHaveLength(1)
    expect(selected[0].map((l) => l.id)).toEqual(['tour.01', 'tour.02', 'tour.03'])
  })

  it('matching a run-of-one selects just that run', () => {
    const selected = selectRuns(runs, 'rajasthan')
    expect(selected).toEqual([place])
  })

  it('throws rather than silently selecting nothing on a typo', () => {
    expect(() => selectRuns(runs, 'tour.99')).toThrow(/matched no lines/)
  })
})

describe('planRun: how much of a run needs rendering, and what ids seed it', () => {
  const now = 10_000_000
  const FRESH = now - 1000
  const STALE = now - (3 * 60 * 60 * 1000)

  it('everything cached: nothing to render, no seed ids needed', () => {
    const run = [line('a', 'x'), line('b', 'y')]
    const plan = planRun(run, { matches: [true, true], entries: [{}, {}], now })
    expect(plan).toEqual({ effectiveStart: 2, seedIds: [] })
  })

  it('a run of one that is not cached renders from its own (only) line, no chaining fields', () => {
    const run = [line('a', 'x')]
    const plan = planRun(run, { matches: [false], entries: [{}], now })
    expect(plan).toEqual({ effectiveStart: 0, seedIds: [] })
  })

  it('force renders the whole run from the start regardless of what is cached', () => {
    const run = [line('a', 'x'), line('b', 'y'), line('c', 'z')]
    const plan = planRun(run, { matches: [true, true, true], entries: [{}, {}, {}], force: true, now })
    expect(plan).toEqual({ effectiveStart: 0, seedIds: [] })
  })

  it('a stale suffix renders from the first miss, seeded with the fresh ids before it', () => {
    const run = [line('a', 'x'), line('b', 'y'), line('c', 'z'), line('d', 'w')]
    const entries = [
      { key: 'ka', requestId: 'req_a', renderedAt: FRESH },
      { key: 'kb', requestId: 'req_b', renderedAt: FRESH },
      { key: 'kc', requestId: undefined, renderedAt: undefined },
      { key: 'kd', requestId: undefined, renderedAt: undefined },
    ]
    const plan = planRun(run, { matches: [true, true, false, false], entries, now })
    expect(plan.effectiveStart).toBe(2)
    expect(plan.seedIds).toEqual(['req_a', 'req_b'])
  })

  it('seed ids are capped at three, most recent (closest to the miss) last', () => {
    const run = Array.from({ length: 5 }, (_, i) => line(String(i), String(i)))
    const entries = run.map((_, i) => ({ key: 'k', requestId: `req_${i}`, renderedAt: FRESH }))
    const matches = [true, true, true, true, false]
    const plan = planRun(run, { matches, entries, now })
    expect(plan.effectiveStart).toBe(4)
    expect(plan.seedIds).toEqual(['req_1', 'req_2', 'req_3'])
  })

  it('a stale requestId among the required preceding entries restarts the run from its first line', () => {
    const run = [line('a', 'x'), line('b', 'y'), line('c', 'z')]
    const entries = [
      { key: 'ka', requestId: 'req_a', renderedAt: STALE }, // too old
      { key: 'kb', requestId: 'req_b', renderedAt: FRESH },
      { key: 'kc', requestId: undefined, renderedAt: undefined },
    ]
    const plan = planRun(run, { matches: [true, true, false], entries, now })
    expect(plan.effectiveStart).toBe(0)
    expect(plan.seedIds).toEqual([])
  })

  it('a missing requestId among the required preceding entries also restarts the run', () => {
    const run = [line('a', 'x'), line('b', 'y'), line('c', 'z')]
    const entries = [
      { key: 'ka', requestId: undefined, renderedAt: FRESH }, // cached, but never actually chained (old flat format)
      { key: 'kb', requestId: 'req_b', renderedAt: FRESH },
      { key: 'kc', requestId: undefined, renderedAt: undefined },
    ]
    const plan = planRun(run, { matches: [true, true, false], entries, now })
    expect(plan.effectiveStart).toBe(0)
  })

  it('a run-of-one is never restarted by the freshness check — it has no chain to break', () => {
    const run = [line('a', 'x')]
    const plan = planRun(run, { matches: [false], entries: [{ key: 'ka', requestId: undefined, renderedAt: undefined }], now })
    expect(plan.effectiveStart).toBe(0)
    expect(plan.seedIds).toEqual([])
  })
})

describe('planFromCache: wires a real cache object through planRun', () => {
  it('reads a legacy flat-string cache entry through isCachedLine, for a run of one', () => {
    const run = [line('a', 'x')]
    const cache = { a: 'ka' }
    const keys = ['ka']
    const isCachedLine = (l, k) => cache[l.id] === k
    expect(planFromCache(run, keys, cache, isCachedLine).effectiveStart).toBe(1) // matches: cached
  })

  it('a mismatched legacy entry is a miss, exactly like the object shape would be', () => {
    const run = [line('a', 'x')]
    const cache = { a: 'stale' }
    const keys = ['ka']
    const isCachedLine = (l, k) => cache[l.id] === k
    expect(planFromCache(run, keys, cache, isCachedLine).effectiveStart).toBe(0) // miss: text changed
  })

  it('for a multi-line run, a preceding entry with no requestId at all (the legacy shape) cannot seed a chain, and restarts the run', () => {
    const run = [line('a', 'x'), line('b', 'y')]
    const keys = ['ka', 'kb']
    // 'a' is cached under the OLD flat format (a bare string) — readCacheEntry
    // reports no requestId for it, so it cannot seed continuity into 'b'.
    const cache = { a: 'ka', b: { key: 'stale', requestId: 'req_b', renderedAt: Date.now() } }
    const isCachedLine = (l, k) => (typeof cache[l.id] === 'string' ? cache[l.id] === k : cache[l.id]?.key === k)
    const plan = planFromCache(run, keys, cache, isCachedLine, { now: Date.now() })
    expect(plan.effectiveStart).toBe(0)
    expect(plan.seedIds).toEqual([])
  })
})
