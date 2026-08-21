import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { findMarkup } from '../lib/markup.mjs'

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
let delivered = 0   // responses that returned audio
let priced = 0      // ...of those, how many carried a character-cost header

/**
 * Characters the API said it billed, or null when it did not say.
 *
 * Zero and "unknown" are completely different answers, and returning 0 for
 * both made tts.mjs print "0 characters billed, about $0.00" after a run that
 * may have spent thousands — a false all-clear at the one moment real money
 * is involved. A run that made no request at all is a truthful zero.
 */
export const charactersSpent = () => (priced < delivered ? null : spent)

export async function synth(text, { tmpDir, id }) {
  if (!key()) throw new Error('ELEVENLABS_API_KEY is not set')
  if (!voiceId()) throw new Error('ELEVENLABS_VOICE_ID is not set. Run: node scripts/voices.mjs')

  // Backstop only: validate-content.mjs makes this same check before a single
  // character is spent. Reaching it here means content changed since the last
  // validate, and aborting now costs whatever the run has already billed.
  // Same pattern on both sides, imported from one place, so they cannot drift.
  const tag = findMarkup(text)
  if (tag) {
    throw new Error(`line "${id}" contains markup ${tag}; content must be plain text only: ${text}`)
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

    delivered++
    const cost = res.headers.get('character-cost')
    if (cost) { spent += Number(cost); priced++ }
    return { audioPath, alignment }
  }
  throw new Error(`ElevenLabs gave up after 5 attempts on "${id}"`)
}
