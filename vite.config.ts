/// <reference types="vitest/config" />
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * KEEP THE LANDMARK PHOTOGRAPHS OUT OF THE DEPLOYED SITE — FOR NOW.
 *
 * `public/photos/` is 3.5 MB, about a third of everything the build emits,
 * and not one byte of it is referenced by any code in `src/`. The feature
 * that will show them — the landmark cards a child reaches by tapping a
 * state — belongs to a later plan. Until it lands, every visitor pays for
 * twenty photographs nobody looks at, over whatever connection an iPad
 * happens to be on.
 *
 * THEY STAY IN THE REPOSITORY. This deletes them from `dist/`, not from
 * `public/`: they are fetched, licence-checked and credited, the credits page
 * lists all twenty, and re-sourcing them later would mean re-running the
 * Wikimedia pipeline and re-reviewing every one by hand.
 *
 * DO NOT "FIX" THIS BY DELETING THE PLUGIN. When the landmark feature ships,
 * delete it then — and the payload will grow on purpose, in the commit that
 * makes the photographs worth downloading.
 *
 * It runs in `closeBundle` because Vite copies `publicDir` early, in a
 * `renderStart` hook (`prepareOutDir`), so by the time the bundle is closed
 * the copy is already there to remove.
 */
function leavePhotosOutOfTheBuild(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'namaste-india:no-photos-in-dist',
    apply: 'build',
    configResolved(resolved) { config = resolved },
    closeBundle: {
      order: 'post',
      handler() {
        if (!config.build.write) return
        rmSync(resolve(config.root, config.build.outDir, 'photos'), {
          recursive: true,
          force: true,
        })
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), leavePhotosOutOfTheBuild()],
  base: './',
  server: { host: true },
  preview: { host: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    /**
     * Git worktrees live under `.claude/worktrees/`, and each one is a FULL
     * checkout of this repo on another branch. Vitest's default excludes do
     * not cover dot-directories, so without this a bare `npm test` collects
     * every sibling branch's tests as well as our own.
     *
     * Measured, not theorised: with three candidate worktrees on disk the
     * suite reported 2,848 tests across 186 files — including 2 failures and
     * 20 skips belonging to other branches — where the real number was 727
     * across 48. That is not merely noisy: it reports another branch's red as
     * ours, and buries our own red in four times its volume of someone
     * else's green. A test count you cannot trust is worse than no test count.
     *
     * CI is unaffected (it checks out a clean tree with no worktrees), which
     * is exactly why this could have gone unnoticed locally for a long time.
     */
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
})
