import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { findMarkup } from '../lib/markup.mjs'
import { envHelp } from '../lib/env-guard.mjs'

export const name = 'elevenlabs'

/** Creator tier's Multilingual-v2 concurrency limit is 5; tts.mjs asks each
 *  provider how many RUNS it may render at once and uses 4 to leave
 *  headroom. Runs, not lines, since Task 6 moved the pool from lines to
 *  runs — a chained run is inherently serial regardless of this number. */
export const concurrency = 4

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

const TTS_FINAL_HELP = { npmScript: 'tts:final', directCommand: 'scripts/tts.mjs --provider=elevenlabs' }

/**
 * `previousRequestIds` (up to 3, most recent last) and `nextText` are Task
 * 6's prosodic-continuity hooks: forward pass only. `previous_text` is
 * deliberately never sent — ElevenLabs' own docs say it is ignored whenever
 * `previous_request_ids` is present, and sending both would suggest this
 * code does not know that. `next_request_ids` is equally deliberately never
 * built: it would need ids that do not exist yet (the whole point of a
 * forward pass), and its presence suppresses `next_text` being honoured.
 *
 * Capped to 3 here too, defensively, even though tts.mjs's own run planner
 * already caps it — a provider's request body is the one place an
 * over-length list can never leak through by accident.
 */
export async function synth(text, { tmpDir, id, previousRequestIds, nextText }) {
  if (!key()) throw new Error(envHelp('ELEVENLABS_API_KEY', TTS_FINAL_HELP))
  if (!voiceId()) {
    throw new Error(
      `${envHelp('ELEVENLABS_VOICE_ID', TTS_FINAL_HELP)} If you don't have a voice id yet, ` +
      `find one with \`npm run voices\`.`,
    )
  }

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

  const body = { text, model_id: MODEL, voice_settings: SETTINGS }
  if (previousRequestIds?.length) body.previous_request_ids = previousRequestIds.slice(-3)
  if (nextText) body.next_text = nextText

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': key(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
    // The id later members of this same run condition on via
    // `previous_request_ids`. Undocumented whether every response carries
    // one, so a missing header degrades to "no continuity id available for
    // this line" rather than throwing — losing prosodic continuity on one
    // line is a quality regression, not a reason to fail a paid render.
    const requestId = res.headers.get('request-id') ?? null
    return { audioPath, alignment, requestId }
  }
  throw new Error(`ElevenLabs gave up after 5 attempts on "${id}"`)
}
