import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

/**
 * This is the test that would have caught the actual bug: `.env.example`,
 * the README and two scripts all agreed ELEVENLABS_API_KEY /
 * ELEVENLABS_VOICE_ID belong in a `.env` file, but nothing ever loaded that
 * file into `process.env` — Node does not read `.env` on its own. Every
 * npm script that can reach one of those reads died on a bare "set X".
 *
 * The honest check is not "does dotenv exist" (it deliberately doesn't; see
 * package.json) but: every npm script whose underlying file reads
 * `process.env.ELEVENLABS_*`, directly or through the one file it imports
 * to do the actual work, must carry `--env-file-if-exists=.env` — and not
 * the throwing `--env-file=.env`, which would break every contributor with
 * no `.env` who only wants the free draft voice. Both requirements are
 * derived from the real `package.json` and the real script sources below,
 * so a new env-reading script added without the flag fails this suite.
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

/** ELEVENLABS_* names a file's own source reads directly off process.env. */
function directEnvReads(absPath) {
  if (!existsSync(absPath)) return []
  const src = readFileSync(absPath, 'utf8')
  return [...src.matchAll(/process\.env\.(ELEVENLABS_\w+)/g)].map(m => m[1])
}

/**
 * One hop of relative imports out of a file: static `from './x.mjs'`,
 * literal dynamic `import('./x.mjs')`, and the one template-literal dynamic
 * import this codebase actually has — `import(\`./dir/${name}.mjs\`)` in
 * scripts/tts.mjs — resolved with the SAME `flag('name', default)` CLI
 * helper the target file defines, read against the flags a given npm
 * script actually passes. That is how "node scripts/tts.mjs
 * --provider=elevenlabs" is known to load scripts/tts-providers/elevenlabs.mjs
 * (which reads the env vars) while "--provider=say" is known to load
 * say.mjs (which does not), without hardcoding either path here.
 */
function importedFiles(absPath, scriptFlags) {
  if (!existsSync(absPath)) return []
  const src = readFileSync(absPath, 'utf8')
  const dir = dirname(absPath)
  const found = new Set()

  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) found.add(resolve(dir, m[1]))
  for (const m of src.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) found.add(resolve(dir, m[1]))

  for (const m of src.matchAll(/`(\.[^`]*)`/g)) {
    const tmpl = m[1]
    const varMatch = tmpl.match(/\$\{(\w+)\}/)
    if (!varMatch) continue
    const flagDef = src.match(new RegExp(
      `const\\s+${varMatch[1]}\\s*=\\s*flag\\(\\s*['"]([\\w-]+)['"]\\s*,\\s*['"]([\\w.\\-/]*)['"]\\s*\\)`,
    ))
    if (!flagDef) continue
    const [, flagName, defaultValue] = flagDef
    const value = scriptFlags[flagName] ?? defaultValue
    found.add(resolve(dir, tmpl.replace(/\$\{\w+\}/, value)))
  }
  return [...found]
}

/** Parse `"node --flag ... scripts/x.mjs --a=b"`. Null for non-node scripts. */
function parseNodeCommand(command) {
  const tokens = command.trim().split(/\s+/)
  if (tokens[0] !== 'node') return null
  const rest = tokens.slice(1)
  const fileTok = rest.find(t => !t.startsWith('--'))
  if (!fileTok) return null
  const flags = {}
  for (const t of rest) {
    if (!t.startsWith('--') || !t.includes('=')) continue
    const [k, ...v] = t.slice(2).split('=')
    flags[k] = v.join('=')
  }
  return { file: resolve(ROOT, fileTok), flags }
}

/** Every ELEVENLABS_* name a given npm script's command can reach at runtime. */
function envVarsFor(command) {
  const parsed = parseNodeCommand(command)
  if (!parsed) return []
  return [
    ...directEnvReads(parsed.file),
    ...importedFiles(parsed.file, parsed.flags).flatMap(directEnvReads),
  ]
}

const scriptsThatNeedTheFlag = Object.entries(pkg.scripts)
  .filter(([, command]) => envVarsFor(command).length > 0)

describe('npm scripts that read ELEVENLABS_* must load .env themselves', () => {
  it('found at least one such script to check, so this suite is not vacuous', () => {
    expect(scriptsThatNeedTheFlag.length).toBeGreaterThan(0)
  })

  it.each(scriptsThatNeedTheFlag)('"%s" carries --env-file-if-exists=.env, not --env-file', (name, command) => {
    expect(command).toMatch(/--env-file-if-exists=\.env\b/)
    // The throwing variant would break this script for every contributor
    // who has no .env yet — including someone running `npm run voices` to
    // find out what belongs in one.
    expect(command).not.toMatch(/--env-file=\.env\b/)
  })

  it('scripts/tts-providers/elevenlabs.mjs and scripts/voices.mjs are the ones actually driving this', () => {
    // Sanity check on the derivation itself: if these stop matching, the
    // regexes above have drifted from the real source and need attention,
    // not the npm scripts.
    const files = new Set(scriptsThatNeedTheFlag
      .flatMap(([, command]) => {
        const parsed = parseNodeCommand(command)
        return [parsed.file, ...importedFiles(parsed.file, parsed.flags)]
      })
      .filter(f => directEnvReads(f).length > 0))
    expect([...files].sort()).toEqual([
      resolve(ROOT, 'scripts/tts-providers/elevenlabs.mjs'),
      resolve(ROOT, 'scripts/voices.mjs'),
    ].sort())
  })
})
