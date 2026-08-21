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
  it('rejects a playSfx cue whose sound is missing from sound-credits.json', () => {
    const dir = fixture()
    writeFileSync(join(dir, 'content', 'tour.json'), JSON.stringify({
      beats: [{
        id: 'test-beat', kind: 'tour', text: 'The tiger growls loudly.',
        cues: [{ word: 1, do: 'playSfx', arg: 'totally-fake-sound-id' }],
      }],
    }))
    mkdirSync(join(dir, 'src', 'data'), { recursive: true })
    writeFileSync(join(dir, 'src', 'data', 'sound-credits.json'), JSON.stringify({
      'some-other-sound': { file: 'audio/sfx/some-other-sound.m4a' },
    }))

    const { code, output } = run(dir)
    expect(code).not.toBe(0)
    expect(output).toContain('totally-fake-sound-id')
    expect(output).toContain('has no file in')
  })

  it('rejects a line-open sfx (l.sfx) whose sound is missing from sound-credits.json', () => {
    const dir = fixture()
    writeFileSync(join(dir, 'content', 'ui.json'), JSON.stringify({
      lines: [{ id: 'test-ui', kind: 'ui', text: 'Tap to begin', sfx: 'another-fake-id' }],
    }))
    mkdirSync(join(dir, 'src', 'data'), { recursive: true })
    writeFileSync(join(dir, 'src', 'data', 'sound-credits.json'), JSON.stringify({}))

    const { code, output } = run(dir)
    expect(code).not.toBe(0)
    expect(output).toContain('another-fake-id')
    expect(output).toContain('has no file in')
  })

  it('does not flag a sound reference that resolves to a real credit entry', () => {
    const dir = fixture()
    writeFileSync(join(dir, 'content', 'tour.json'), JSON.stringify({
      beats: [{
        id: 'test-beat', kind: 'tour', text: 'The tiger growls loudly.',
        cues: [{ word: 1, do: 'playSfx', arg: 'tiger-growl' }],
      }],
    }))
    mkdirSync(join(dir, 'src', 'data'), { recursive: true })
    writeFileSync(join(dir, 'src', 'data', 'sound-credits.json'), JSON.stringify({
      'tiger-growl': { file: 'audio/sfx/tiger-growl.m4a' },
    }))

    const { output } = run(dir)
    // content/ui.json is still missing in this fixture, so the run still
    // exits non-zero overall — the point here is narrower: our sound check
    // specifically must not be one of the reported problems.
    expect(output).not.toContain('tiger-growl" has no file in')
  })

  it('rejects any sound reference when sound-credits.json does not exist at all', () => {
    const dir = fixture()
    writeFileSync(join(dir, 'content', 'tour.json'), JSON.stringify({
      beats: [{
        id: 'test-beat', kind: 'tour', text: 'The tiger growls loudly.',
        sfx: 'yet-another-fake-id',
      }],
    }))

    const { code, output } = run(dir)
    expect(code).not.toBe(0)
    expect(output).toContain('sound reference(s)')
    expect(output).toContain('does not exist')
  })
})
