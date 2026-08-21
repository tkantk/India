// Guards against a Task-1-review regression: the deploy workflow's pinned
// node-version must stay >= 23. `npm run validate` (from Task 2 onward)
// imports content/schema.ts directly and relies on Node's native TypeScript
// stripping, which is unflagged only from Node 23.6 onwards. On Node 22 CI
// fails silently at the `npm run validate` step.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const MIN_NODE_VERSION = 23

const __dirname = dirname(fileURLToPath(import.meta.url))
const WORKFLOW_PATH = join(__dirname, '..', '.github', 'workflows', 'deploy.yml')

/**
 * Extract the node-version pinned in a GitHub Actions workflow YAML string.
 * Deliberately a regex, not a YAML parser — the workflow's node-version is a
 * single scalar `key: value` line, and pulling in a YAML dependency for one
 * field is not worth it.
 */
export function getNodeVersion(yamlText) {
  const match = yamlText.match(/^\s*node-version:\s*['"]?(\d+)/m)
  if (!match) {
    throw new Error('No "node-version:" key found in the given workflow YAML.')
  }
  return Number(match[1])
}

/**
 * Assert the pinned node-version satisfies the Node 23+ global constraint.
 * Defaults to reading the real .github/workflows/deploy.yml so this doubles
 * as a regression guard when called with no arguments.
 */
export function checkNodeVersion(yamlText = readFileSync(WORKFLOW_PATH, 'utf8')) {
  const version = getNodeVersion(yamlText)
  if (version < MIN_NODE_VERSION) {
    throw new Error(
      `.github/workflows/deploy.yml pins node-version: ${version}, but the ` +
      `project's Global Constraints require Node ${MIN_NODE_VERSION}+ (native ` +
      `TypeScript stripping is unflagged only from Node 23.6). Bump node-version ` +
      `to ${MIN_NODE_VERSION} or higher.`
    )
  }
  return version
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const version = checkNodeVersion()
    console.log(`ok: .github/workflows/deploy.yml pins node-version: ${version} (>= ${MIN_NODE_VERSION})`)
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}
