import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Captured before any execFileSync call overrides a *child's* cwd — mirrors
// scripts/validate-content.test.mjs's own convention for testing a
// top-level script that has no exports.
const SCRIPT = join(process.cwd(), 'scripts/fact-check.mjs')

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'fact-check-'))
  mkdirSync(join(dir, 'content', 'places'), { recursive: true })
  mkdirSync(join(dir, 'src', 'data'), { recursive: true })
  return dir
}

/** A minimal but real place file — just enough for fact-check.mjs's own
 *  line-id walk (it does not run PlaceSchema; validate-content.mjs already
 *  owns that gate). */
function place(dir, id) {
  writeFileSync(join(dir, 'content', 'places', `${id}.json`), JSON.stringify({
    id, name: id,
    intro: { id: `${id}.intro`, text: 'An intro line.' },
    card: {
      animal: { id: `${id}.card.animal`, text: 'An animal line.' },
      food: { id: `${id}.card.food`, text: 'A food line.' },
      festival: { id: `${id}.card.festival`, text: 'A festival line.' },
      hello: { id: `${id}.card.hello`, text: 'A hello line.' },
    },
    landmarks: [{ id: `${id}.lm0`, line: { id: `${id}.lm0.line`, text: 'A landmark line.' } }],
  }))
}

/** geo.json places, shaped exactly like src/data/geo.json's own — `d` is a
 *  real SVG path (M...Z, possibly several subpaths) so largestByArea has
 *  something to compute. */
function geo(dir, places) {
  writeFileSync(join(dir, 'src', 'data', 'geo.json'), JSON.stringify({ places }))
}

function factCheck(dir, rows) {
  const file = join(dir, 'content', 'fact-check.json')
  writeFileSync(file, JSON.stringify({ rows }))
  return file
}

function run(dir, file) {
  try {
    const stdout = execFileSync('node', [SCRIPT, file], { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
    return { code: 0, output: stdout }
  } catch (e) {
    // fact-check.mjs writes problems with console.error (stderr) and the
    // summary/mix with console.log (stdout); check both, as
    // validate-content.test.mjs already does for its own script.
    return { code: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

describe('fact-check row shape', () => {
  it('fails a row with no verification at all — not a warning', () => {
    const dir = fixture()
    place(dir, 'rajasthan')
    geo(dir, { rajasthan: { type: 'state', d: 'M0,0L10,0L10,10L0,10Z', neighbours: [] } })
    const file = factCheck(dir, [{ id: 'r1', line: 'rajasthan.intro', claim: 'Something true.' }])

    const { code, output } = run(dir, file)
    expect(code).not.toBe(0)
    expect(output).toContain('missing "verification"')
    expect(output).toContain('must fail, not warn')
  })

  it('fails a verification.type that is not fetched, cited or derived', () => {
    const dir = fixture()
    place(dir, 'rajasthan')
    geo(dir, { rajasthan: { type: 'state', d: 'M0,0L10,0L10,10L0,10Z', neighbours: [] } })
    const file = factCheck(dir, [{
      id: 'r1', line: 'rajasthan.intro', claim: 'Something true.',
      verification: { type: 'trust-me' },
    }])

    const { code, output } = run(dir, file)
    expect(code).not.toBe(0)
    expect(output).toContain('is not one of fetched, cited, derived')
  })

  it('fails a row whose line id does not exist in any content file', () => {
    const dir = fixture()
    place(dir, 'rajasthan')
    geo(dir, { rajasthan: { type: 'state', d: 'M0,0L10,0L10,10L0,10Z', neighbours: [] } })
    const file = factCheck(dir, [{
      id: 'r1', line: 'atlantis.intro', claim: 'Atlantis is a state.',
      verification: { type: 'cited', source: 'x', quote: 'x', location: 'x' },
    }])

    const { code, output } = run(dir, file)
    expect(code).not.toBe(0)
    expect(output).toContain('line id "atlantis.intro" does not exist')
  })

  it('fails a cited row missing quote or location', () => {
    const dir = fixture()
    place(dir, 'rajasthan')
    geo(dir, { rajasthan: { type: 'state', d: 'M0,0L10,0L10,10L0,10Z', neighbours: [] } })
    const file = factCheck(dir, [{
      id: 'r1', line: 'rajasthan.intro', claim: 'Something true.',
      verification: { type: 'cited', source: 'A report' },
    }])

    const { code, output } = run(dir, file)
    expect(code).not.toBe(0)
    expect(output).toContain('missing "quote"')
    expect(output).toContain('missing "location"')
  })

  it('fails a fetched row missing sources', () => {
    const dir = fixture()
    place(dir, 'rajasthan')
    geo(dir, { rajasthan: { type: 'state', d: 'M0,0L10,0L10,10L0,10Z', neighbours: [] } })
    const file = factCheck(dir, [{
      id: 'r1', line: 'rajasthan.intro', claim: 'Something true.',
      verification: { type: 'fetched' },
    }])

    const { code, output } = run(dir, file)
    expect(code).not.toBe(0)
    expect(output).toContain('missing "sources"')
  })

  it('accepts a complete cited row and prints it in the mix', () => {
    const dir = fixture()
    place(dir, 'rajasthan')
    geo(dir, { rajasthan: { type: 'state', d: 'M0,0L10,0L10,10L0,10Z', neighbours: [] } })
    const file = factCheck(dir, [{
      id: 'r1', line: 'rajasthan.intro', claim: 'Something true.',
      verification: { type: 'cited', source: 'A report', quote: 'exact words', location: 'page 3' },
    }])

    const { code, output } = run(dir, file)
    expect(code).toBe(0)
    expect(output).toContain('1 rows: 0 fetched, 1 cited, 0 derived')
    expect(output).toContain('fact-check OK')
  })
})

describe('fact-check derived: neighbours', () => {
  it('passes when geo.json lists the claimed neighbour', () => {
    const dir = fixture()
    place(dir, 'rajasthan')
    geo(dir, {
      rajasthan: { type: 'state', d: 'M0,0L10,0L10,10L0,10Z', neighbours: ['gujarat', 'punjab'] },
    })
    const file = factCheck(dir, [{
      id: 'r1', line: 'rajasthan.intro', claim: 'Gujarat borders Rajasthan.',
      verification: { type: 'derived', check: 'neighbours', place: 'rajasthan', of: ['gujarat'] },
    }])

    const { code, output } = run(dir, file)
    expect(code).toBe(0)
    expect(output).toContain('1 derived')
  })

  it('fails when geo.json does not list the claimed neighbour', () => {
    const dir = fixture()
    place(dir, 'rajasthan')
    geo(dir, { rajasthan: { type: 'state', d: 'M0,0L10,0L10,10L0,10Z', neighbours: ['punjab'] } })
    const file = factCheck(dir, [{
      id: 'r1', line: 'rajasthan.intro', claim: 'Kerala borders Rajasthan.',
      verification: { type: 'derived', check: 'neighbours', place: 'rajasthan', of: ['kerala'] },
    }])

    const { code, output } = run(dir, file)
    expect(code).not.toBe(0)
    expect(output).toContain('missing kerala')
  })
})

describe('fact-check derived: placeCount', () => {
  it('checks state/ut/total counts against geo.json', () => {
    const dir = fixture()
    place(dir, 'rajasthan')
    geo(dir, {
      rajasthan: { type: 'state', d: 'M0,0L10,0L10,10L0,10Z', neighbours: [] },
      delhi: { type: 'ut', d: 'M0,0L10,0L10,10L0,10Z', neighbours: [] },
    })
    const file = factCheck(dir, [
      { id: 'r1', line: 'rajasthan.intro', claim: '1 state.', verification: { type: 'derived', check: 'placeCount', kind: 'state', expect: 1 } },
      { id: 'r2', line: 'rajasthan.intro', claim: '1 ut.', verification: { type: 'derived', check: 'placeCount', kind: 'ut', expect: 1 } },
      { id: 'r3', line: 'rajasthan.intro', claim: '2 total.', verification: { type: 'derived', check: 'placeCount', kind: 'total', expect: 2 } },
    ])

    const { code, output } = run(dir, file)
    expect(code).toBe(0)
    expect(output).toContain('3 derived')
  })

  it('fails when the expected count is wrong', () => {
    const dir = fixture()
    place(dir, 'rajasthan')
    geo(dir, { rajasthan: { type: 'state', d: 'M0,0L10,0L10,10L0,10Z', neighbours: [] } })
    const file = factCheck(dir, [{
      id: 'r1', line: 'rajasthan.intro', claim: '28 states.',
      verification: { type: 'derived', check: 'placeCount', kind: 'state', expect: 28 },
    }])

    const { code, output } = run(dir, file)
    expect(code).not.toBe(0)
    expect(output).toContain('has 1 place(s) of kind "state", expected 28')
  })
})

describe('fact-check derived: largestByArea', () => {
  it('picks the geometrically larger state, not the one listed first', () => {
    const dir = fixture()
    place(dir, 'small')
    place(dir, 'big')
    geo(dir, {
      // A 10x10 square (area 100)...
      small: { type: 'state', d: 'M0,0L10,0L10,10L0,10Z', neighbours: [] },
      // ...versus a 30x30 square (area 900). Deliberately listed after
      // "small" in object order, so a check that just took the first key
      // would get this wrong.
      big: { type: 'state', d: 'M0,0L30,0L30,30L0,30Z', neighbours: [] },
    })
    const file = factCheck(dir, [{
      id: 'r1', line: 'big.intro', claim: 'Big is the largest state.',
      verification: { type: 'derived', check: 'largestByArea', among: 'state', place: 'big' },
    }])

    const { code, output } = run(dir, file)
    expect(code).toBe(0)
  })

  it('fails when the named place is not actually the largest', () => {
    const dir = fixture()
    place(dir, 'small')
    place(dir, 'big')
    geo(dir, {
      small: { type: 'state', d: 'M0,0L10,0L10,10L0,10Z', neighbours: [] },
      big: { type: 'state', d: 'M0,0L30,0L30,30L0,30Z', neighbours: [] },
    })
    const file = factCheck(dir, [{
      id: 'r1', line: 'small.intro', claim: 'Small is the largest state.',
      verification: { type: 'derived', check: 'largestByArea', among: 'state', place: 'small' },
    }])

    const { code, output } = run(dir, file)
    expect(code).not.toBe(0)
    expect(output).toContain('computed geometry ranks "big" largest, not "small"')
  })

  it('excludes a hole from a ring’s area (opposite winding subtracts)', () => {
    // An outer 20x20 square (area 400) with a 10x10 hole wound the other
    // way (area -100): net 300. If the check summed |area| per subpath
    // instead of summing signed areas first, this would come out as 500.
    const dir = fixture()
    place(dir, 'ring')
    place(dir, 'solid')
    geo(dir, {
      ring: { type: 'state', d: 'M0,0L20,0L20,20L0,20ZM5,5L5,15L15,15L15,5Z', neighbours: [] },
      solid: { type: 'state', d: 'M0,0L18,0L18,18L0,18Z', neighbours: [] }, // area 324 < 400 - 100 = 300? no: 324 > 300
    })
    const file = factCheck(dir, [{
      id: 'r1', line: 'solid.intro', claim: 'Solid is bigger than the ring net of its hole.',
      verification: { type: 'derived', check: 'largestByArea', among: 'state', place: 'solid' },
    }])

    const { code } = run(dir, file)
    expect(code).toBe(0)
  })
})

describe('fact-check derived: palindrome', () => {
  it('passes a real palindrome', () => {
    const dir = fixture()
    place(dir, 'kerala')
    geo(dir, { kerala: { type: 'state', d: 'M0,0L10,0L10,10L0,10Z', neighbours: [] } })
    const file = factCheck(dir, [{
      id: 'r1', line: 'kerala.intro', claim: 'Malayalam reads the same backwards.',
      verification: { type: 'derived', check: 'palindrome', word: 'Malayalam' },
    }])

    expect(run(dir, file).code).toBe(0)
  })

  it('fails a non-palindrome', () => {
    const dir = fixture()
    place(dir, 'kerala')
    geo(dir, { kerala: { type: 'state', d: 'M0,0L10,0L10,10L0,10Z', neighbours: [] } })
    const file = factCheck(dir, [{
      id: 'r1', line: 'kerala.intro', claim: 'Kerala reads the same backwards.',
      verification: { type: 'derived', check: 'palindrome', word: 'Kerala' },
    }])

    const { code, output } = run(dir, file)
    expect(code).not.toBe(0)
    expect(output).toContain('is not a palindrome')
  })
})

describe('fact-check reads the real committed content', () => {
  it('every cited/derived row in content/fact-check.json is structurally valid against the real content and geo.json', () => {
    // Runs the real script from the real repo root (so it reads the real
    // src/data/geo.json and content/places/*.json) against a copy of the
    // real content/fact-check.json with the fetched-type rows stripped out
    // — a fast, offline, deterministic check that every cited row is
    // complete and every derived row's claim actually holds against the
    // committed data. The fetched-type rows are exercised for real by
    // `npm run fact:check`, which needs the network and is not repeated
    // here — see task-4-report.md for what that run printed.
    const real = JSON.parse(readFileSync(join(process.cwd(), 'content/fact-check.json'), 'utf8'))
    const offline = real.rows.filter(r => r.verification.type !== 'fetched')
    expect(offline.length).toBeGreaterThan(0)

    const dir = mkdtempSync(join(tmpdir(), 'fact-check-real-'))
    const file = join(dir, 'fact-check.json')
    writeFileSync(file, JSON.stringify({ rows: offline }))

    let result
    try {
      result = { code: 0, output: execFileSync('node', [SCRIPT, file], { cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe' }) }
    } catch (e) {
      result = { code: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` }
    }
    expect(result.code, result.output).toBe(0)
    expect(result.output).toContain('fact-check OK')
  })
})
