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
