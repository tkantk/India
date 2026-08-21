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
