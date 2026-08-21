import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Captured before any execFileSync call overrides a *child's* cwd — this
// process's own cwd never moves, so this always resolves to the real script.
const SCRIPT = join(process.cwd(), 'scripts/validate-content.mjs')

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'validate-content-'))
  mkdirSync(join(dir, 'content'), { recursive: true })
  return dir
}

/** The wanted list. An id here but absent from sound-credits.json is a
 *  tracked gap, not a failure; an id in neither file is a typo. */
function wantedSounds(dir, { sfx = [], ambience = [] }) {
  writeFileSync(join(dir, 'content', 'sounds.json'), JSON.stringify({
    sfx: sfx.map(id => ({ id, search: id })),
    ambience: ambience.map(id => ({ id, search: id })),
  }))
}

function sourcedSounds(dir, ids) {
  mkdirSync(join(dir, 'src', 'data'), { recursive: true })
  writeFileSync(join(dir, 'src', 'data', 'sound-credits.json'), JSON.stringify(
    Object.fromEntries(ids.map(id => [id, { file: `audio/sfx/${id}.m4a` }])),
  ))
}

/** The declared cue vocabulary. Every symbol, greeting, river and scene key
 *  the content is allowed to name. */
function vocab(dir, over = {}) {
  writeFileSync(join(dir, 'content', 'vocab.json'), JSON.stringify({
    revealSymbol: ['tiger', 'peacock'],
    showScript: ['namaste'],
    rivers: ['ganga'],
    scenes: ['plains', 'temple'],
    ...over,
  }))
}

function run(dir) {
  try {
    const stdout = execFileSync('node', [SCRIPT], { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
    return { code: 0, output: stdout }
  } catch (e) {
    // validate-content.mjs writes problem lines with console.error (stderr)
    // and the summary with console.log (stdout); check both.
    return { code: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

describe('validate-content sound references', () => {
  it('rejects a playSfx cue whose sound is in neither file — a typo', () => {
    const dir = fixture()
    writeFileSync(join(dir, 'content', 'tour.json'), JSON.stringify({
      beats: [{
        id: 'test-beat', kind: 'tour', text: 'The tiger growls loudly.',
        cues: [{ word: 1, do: 'playSfx', arg: 'totally-fake-sound-id' }],
      }],
    }))
    wantedSounds(dir, { sfx: ['tiger-growl'] })
    sourcedSounds(dir, ['some-other-sound'])

    const { code, output } = run(dir)
    expect(code).not.toBe(0)
    expect(output).toContain('totally-fake-sound-id')
    expect(output).toContain('typo?')
  })

  it('rejects a line-open sfx (l.sfx) whose sound is in neither file', () => {
    const dir = fixture()
    writeFileSync(join(dir, 'content', 'ui.json'), JSON.stringify({
      lines: [{ id: 'test-ui', kind: 'ui', text: 'Tap to begin', sfx: 'another-fake-id' }],
    }))
    wantedSounds(dir, { sfx: ['chime-correct'] })
    sourcedSounds(dir, [])

    const { code, output } = run(dir)
    expect(code).not.toBe(0)
    expect(output).toContain('another-fake-id')
    expect(output).toContain('typo?')
  })

  it('does not flag a sound reference that resolves to a real credit entry', () => {
    const dir = fixture()
    writeFileSync(join(dir, 'content', 'tour.json'), JSON.stringify({
      beats: [{
        id: 'test-beat', kind: 'tour', text: 'The tiger growls loudly.',
        cues: [{ word: 1, do: 'playSfx', arg: 'tiger-growl' }],
      }],
    }))
    wantedSounds(dir, { sfx: ['tiger-growl'] })
    sourcedSounds(dir, ['tiger-growl'])

    const { output } = run(dir)
    // content/ui.json is still missing in this fixture, so the run still
    // exits non-zero overall — the point here is narrower: our sound check
    // specifically must not be one of the reported problems.
    expect(output).not.toContain('tiger-growl')
  })

  it('reports a wanted-but-unsourced sound as a tracked gap without failing on it', () => {
    const dir = fixture()
    writeFileSync(join(dir, 'content', 'tour.json'), JSON.stringify({
      beats: [{
        id: 'test-beat', kind: 'tour', text: 'The tiger growls loudly.',
        cues: [{ word: 1, do: 'playSfx', arg: 'tiger-growl' }],
      }],
    }))
    writeFileSync(join(dir, 'content', 'ui.json'), JSON.stringify({
      lines: [{ id: 'test-ui', kind: 'ui', text: 'Tap to begin' }],
    }))
    wantedSounds(dir, { sfx: ['tiger-growl'] })
    sourcedSounds(dir, [])
    vocab(dir)

    const { code, output } = run(dir)
    expect(output).toContain('not yet sourced')
    expect(output).toContain('tiger-growl')
    expect(output).not.toContain('typo?')
    // The gap is the only thing wrong with this fixture, so it must still pass.
    expect(code).toBe(0)
    expect(output).toContain('content OK')
  })

  it('treats a sound reference as a typo when sound-credits.json does not exist at all', () => {
    const dir = fixture()
    writeFileSync(join(dir, 'content', 'tour.json'), JSON.stringify({
      beats: [{
        id: 'test-beat', kind: 'tour', text: 'The tiger growls loudly.',
        sfx: 'yet-another-fake-id',
      }],
    }))

    const { code, output } = run(dir)
    expect(code).not.toBe(0)
    expect(output).toContain('yet-another-fake-id')
    expect(output).toContain('typo?')
  })
})

/** A schema-valid place, so these cases fail on the geo check and nothing else. */
function place(dir, id, extraCues = []) {
  mkdirSync(join(dir, 'content', 'places'), { recursive: true })
  writeFileSync(join(dir, 'content', 'places', `${id}.json`), JSON.stringify({
    id, name: id, type: 'state', capital: 'Somewhere', ambience: 'plains',
    intro: {
      id: `${id}.intro`, kind: 'intro', text: 'A place with a neighbour beside it.',
      cues: [{ word: 0, do: 'highlightState', arg: id }, ...extraCues],
    },
    card: {
      animal: { id: `${id}.card.animal`, kind: 'card', text: 'An animal lives here.' },
      food: { id: `${id}.card.food`, kind: 'card', text: 'People eat well.' },
      festival: { id: `${id}.card.festival`, kind: 'card', text: 'They celebrate often.' },
      hello: { id: `${id}.card.hello`, kind: 'card', text: 'People say hello.' },
    },
    landmarks: Array.from({ length: 5 }, (_, i) => ({
      id: `${id}.lm${i}`, name: `Spot ${i}`, photoQuery: `Spot ${i}`, scene: 'plains',
      line: { id: `${id}.lm${i}.line`, kind: 'landmark', text: `Spot number ${i} is nice.` },
    })),
  }))
}

function geo(dir, slugs) {
  mkdirSync(join(dir, 'src', 'data'), { recursive: true })
  writeFileSync(join(dir, 'src', 'data', 'geo.json'), JSON.stringify({
    places: Object.fromEntries(slugs.map(s => [s, { name: s, type: 'state' }])),
  }))
}

describe('validate-content place references', () => {
  it('rejects a place whose id is not a slug in geo.json', () => {
    const dir = fixture()
    place(dir, 'atlantis')
    geo(dir, ['rajasthan', 'kerala'])

    const { code, output } = run(dir)
    expect(code).not.toBe(0)
    expect(output).toContain('place "atlantis" is not a slug')
  })

  it('rejects a lightNeighbour cue naming a state that does not exist', () => {
    const dir = fixture()
    place(dir, 'rajasthan', [{ word: 3, do: 'lightNeighbour', arg: 'gujrat' }])
    geo(dir, ['rajasthan', 'gujarat'])

    const { code, output } = run(dir)
    expect(code).not.toBe(0)
    // The typo, not the correctly-spelled state it was meant to be.
    expect(output).toContain('place "gujrat" is not a slug')
    expect(output).not.toContain('place "rajasthan" is not a slug')
  })

  it('rejects a zoomTo cue in the tour naming a place that does not exist', () => {
    const dir = fixture()
    writeFileSync(join(dir, 'content', 'tour.json'), JSON.stringify({
      beats: [{
        id: 'tour.05', kind: 'tour', text: 'We are flying to New Delhi now.',
        cues: [{ word: 5, do: 'zoomTo', arg: 'new-delhi' }],
      }],
    }))
    geo(dir, ['delhi'])

    const { code, output } = run(dir)
    expect(code).not.toBe(0)
    expect(output).toContain('place "new-delhi" is not a slug')
  })

  it('does not flag place references that all resolve', () => {
    const dir = fixture()
    place(dir, 'rajasthan', [{ word: 3, do: 'lightNeighbour', arg: 'gujarat' }])
    geo(dir, ['rajasthan', 'gujarat'])

    const { output } = run(dir)
    // content/tour.json and content/ui.json are still missing in this fixture,
    // so the run exits non-zero overall; the point here is narrower.
    expect(output).not.toContain('is not a slug')
  })

  it('rejects place references when geo.json has not been generated at all', () => {
    const dir = fixture()
    place(dir, 'rajasthan')

    const { code, output } = run(dir)
    expect(code).not.toBe(0)
    expect(output).toContain('place reference(s)')
    expect(output).toContain('npm run build:map')
  })
})

// Narration must be plain text: ElevenLabs' alignment.characters is a
// character-for-character image of what is sent, so a stray tag shifts every
// index after it and silently breaks word highlighting. The provider still
// carries a backstop, but a check that only fires there aborts a paid pass
// mid-flight, after money has been spent. Here it costs nothing.
describe('validate-content markup check', () => {
  const tour = (dir, text) => writeFileSync(join(dir, 'content', 'tour.json'), JSON.stringify({
    beats: [{ id: 'tour.01', kind: 'tour', text }],
  }))
  const ui = (dir) => writeFileSync(join(dir, 'content', 'ui.json'), JSON.stringify({
    lines: [{ id: 'ui.begin', kind: 'ui', text: 'Tap to begin' }],
  }))

  it('rejects a line containing an HTML tag', () => {
    const dir = fixture()
    tour(dir, 'The tiger is <b>very</b> big indeed.')
    ui(dir)

    const { code, output } = run(dir)
    expect(code).not.toBe(0)
    expect(output).toContain('markup')
    expect(output).toContain('<b>')
  })

  it('rejects a self-closing or unpaired tag just as firmly', () => {
    const dir = fixture()
    tour(dir, 'The river runs on<br> and on.')
    ui(dir)
    vocab(dir)

    const { code, output } = run(dir)
    expect(code).not.toBe(0)
    expect(output).toContain('markup')
    expect(output).toContain('<br>')
  })

  it('accepts a bare less-than sign, which is legitimate prose', () => {
    const dir = fixture()
    tour(dir, 'A baby elephant weighs less than its mother, so 3 < 5 is easy.')
    ui(dir)
    vocab(dir)

    const { code, output } = run(dir)
    expect(output).not.toContain('markup')
    expect(code).toBe(0)
    expect(output).toContain('content OK')
  })
})

// Half the cue vocabulary used to go unchecked: playSfx args and place slugs
// were validated, then the checking stopped. revealSymbol, showScript,
// traceRiver, countTo and landmark.scene were all free text, so a typo was
// silent — the symbol simply never appeared. content/vocab.json declares the
// permitted values, and is also the contract Plan 2 draws its illustrations
// against, so it has to be explicit rather than implied by whatever the seed
// content happens to say today.
describe('validate-content cue vocabulary', () => {
  const beats = (dir, cues, text = 'The tiger and the peacock greet the river today.') =>
    writeFileSync(join(dir, 'content', 'tour.json'), JSON.stringify({
      beats: [{ id: 'tour.01', kind: 'tour', text, cues }],
    }))
  const ui = (dir) => writeFileSync(join(dir, 'content', 'ui.json'), JSON.stringify({
    lines: [{ id: 'ui.begin', kind: 'ui', text: 'Tap to begin' }],
  }))

  it('rejects a revealSymbol arg that is not in the declared vocabulary', () => {
    const dir = fixture()
    beats(dir, [{ word: 1, do: 'revealSymbol', arg: 'tigre' }])
    ui(dir); vocab(dir)

    const { code, output } = run(dir)
    expect(code).not.toBe(0)
    expect(output).toContain('"tigre"')
    expect(output).toContain('vocab.json')
  })

  it('accepts a revealSymbol arg that is declared', () => {
    const dir = fixture()
    beats(dir, [{ word: 1, do: 'revealSymbol', arg: 'tiger' }])
    ui(dir); vocab(dir)

    const { code, output } = run(dir)
    expect(code).toBe(0)
    expect(output).toContain('content OK')
  })

  it('rejects an undeclared showScript greeting and river', () => {
    const dir = fixture()
    beats(dir, [
      { word: 1, do: 'showScript', arg: 'bonjour' },
      { word: 2, do: 'traceRiver', arg: 'thames' },
    ])
    ui(dir); vocab(dir)

    const { code, output } = run(dir)
    expect(code).not.toBe(0)
    expect(output).toContain('"bonjour"')
    expect(output).toContain('"thames"')
  })

  it('rejects a landmark scene key that is not in the kit', () => {
    const dir = fixture()
    place(dir, 'rajasthan')
    geo(dir, ['rajasthan'])
    ui(dir); vocab(dir, { scenes: ['temple'] })

    const { code, output } = run(dir)
    expect(code).not.toBe(0)
    expect(output).toContain('scene "plains"')
  })

  it('rejects a countTo arg that is not a positive whole number', () => {
    const dir = fixture()
    beats(dir, [{ word: 1, do: 'countTo', arg: 'twenty-eight' }])
    ui(dir); vocab(dir)

    const { code, output } = run(dir)
    expect(code).not.toBe(0)
    expect(output).toContain('twenty-eight')
  })

  it('rejects a vocabulary cue with no arg at all', () => {
    const dir = fixture()
    beats(dir, [{ word: 1, do: 'revealSymbol' }])
    ui(dir); vocab(dir)

    expect(run(dir).code).not.toBe(0)
  })

  it('fails loudly when the vocabulary file is missing entirely', () => {
    const dir = fixture()
    beats(dir, [{ word: 1, do: 'revealSymbol', arg: 'tiger' }])
    ui(dir)

    const { code, output } = run(dir)
    expect(code).not.toBe(0)
    expect(output).toContain('content/vocab.json')
  })
})
