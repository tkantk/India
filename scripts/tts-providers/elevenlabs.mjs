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
