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

  // The backstop shares one pattern with validate-content.mjs, and that
  // pattern is deliberately narrower than /<[^>]+>/: refusing to speak a
  // sentence that merely compares two numbers would be a false alarm at the
  // most expensive possible moment.
  it('does not mistake a bare less-than sign for markup', async () => {
    const { synth } = await load()
    globalThis.fetch.mockResolvedValue(okResponse({
      audio_base64: Buffer.from('x').toString('base64'), alignment: ALIGNMENT,
    }))
    await expect(synth('Three is 3 < 5 today', { tmpDir: dir, id: 'lt' })).resolves.toBeTruthy()
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
