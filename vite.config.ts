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
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/setupTests.ts'] },
})
