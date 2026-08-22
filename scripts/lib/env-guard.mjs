import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The failure this file exists to fix: a user puts ELEVENLABS_API_KEY and
 * ELEVENLABS_VOICE_ID into `.env` at the repo root, exactly as
 * `.env.example` and the README say to — but Node does not read `.env` on
 * its own, so `process.env` never sees them and the script dies on a bare
 * "set X". Someone who already did the right thing gets told to do it again.
 *
 * This tells them which of the two problems they actually have:
 *   - the variable isn't in `.env` at all, or
 *   - it IS in `.env`, but nothing loaded the file into this process.
 * Those have different fixes, and only one of them is "edit .env".
 *
 * Never reads the value out of `.env` — only whether the key is assigned
 * there at all — because the file on disk can hold a real secret and this
 * message may end up in a terminal, a log, or a paste.
 */
export function envHelp(varName, { npmScript, directCommand, cwd = process.cwd() } = {}) {
  const envPath = resolve(cwd, '.env')
  const assignedInDotEnv = existsSync(envPath) &&
    new RegExp(`^\\s*${varName}\\s*=\\s*\\S`, 'm').test(readFileSync(envPath, 'utf8'))

  const howToRun =
    `Run it via its npm alias (\`npm run ${npmScript}\`), which loads .env for you, ` +
    `or, if you run it directly:\n  node --env-file-if-exists=.env ${directCommand}`

  if (assignedInDotEnv) {
    return (
      `${varName} is set in .env, but nothing loaded that file into this process — ` +
      `Node does not read .env on its own. ${howToRun}`
    )
  }
  return (
    `${varName} is not set. Put it in a .env file at the repo root (.env.example is ` +
    `the template) as ${varName}=... . ${howToRun}`
  )
}
